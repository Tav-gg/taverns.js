// REST retry tests: run with `npm test` (builds first). Everything runs against
// local servers on 127.0.0.1; nothing leaves the machine.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');

const { RESTClient, TavernAPIError } = require('../dist/index.js');
const { isNotSentError } = require('../dist/rest.js');

const TOKEN = 'tavbot_hidden123';

// How the test server answers a request it has fully received.
const answers = {
  ok: (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  },
  serverError: (req, res) => {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end('{"message":"Internal server error"}');
  },
  emptyServerError: (req, res) => {
    res.writeHead(500);
    res.end();
  },
  badGateway: (req, res) => {
    res.writeHead(502, { 'content-type': 'text/html' });
    res.end('<html>502 Bad Gateway</html>');
  },
  // The connection closes after the request arrived, before any answer
  dropped: (req) => {
    req.socket.destroy();
  },
  // The connection closes in the middle of the answer
  cutOff: (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': '100' });
    res.write('{"ok":');
    setTimeout(() => res.socket.destroy(), 10);
  },
};
const FAILURES = ['serverError', 'emptyServerError', 'badGateway', 'dropped', 'cutOff'];

/**
 * Runs a local API. `plan` lists how to answer each request in turn (the last
 * entry repeats). Every request is recorded once its whole body has arrived.
 * `rest.sleep` is replaced so retries do not wait in real time; `waits` records
 * the delays the client asked for.
 */
async function withApi(fn) {
  const state = { plan: ['ok'], seen: [] };
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      state.seen.push({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString('utf8') });
      const answer = state.plan[Math.min(state.seen.length - 1, state.plan.length - 1)];
      answers[answer](req, res);
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const rest = new RESTClient(TOKEN, `http://127.0.0.1:${server.address().port}/api/v1`, { allowInsecure: true });
  const waits = [];
  rest.sleep = async (ms) => {
    waits.push(ms);
  };
  const reset = (...plan) => {
    state.plan = plan;
    state.seen = [];
    waits.length = 0;
  };
  try {
    await fn({ rest, reset, seen: () => state.seen, waits });
  } finally {
    for (const socket of sockets) socket.destroy();
    server.close();
  }
}

// Calls that must never be sent twice after the API may have received them
const ONCE_ONLY = [
  ['POST sendMessage', (rest) => rest.sendMessage('t', 'c', { content: 'hello' })],
  ['POST banMember', (rest) => rest.banMember('t', 'u', { reason: 'spam' })],
  ['POST muteMember', (rest) => rest.muteMember('t', 'u', { durationMinutes: 10 })],
  ['POST low-level post', (rest) => rest.post('/custom', { a: 1 })],
  ['PATCH editMessage', (rest) => rest.editMessage('t', 'm', { content: 'edited' })],
  ['DELETE kickMember', (rest) => rest.kickMember('t', 'u', 'spam')],
  ['DELETE unbanMember', (rest) => rest.unbanMember('t', 'u')],
  ['DELETE deleteMessage', (rest) => rest.deleteMessage('t', 'm')],
];

test('POST, PATCH and DELETE are sent once when the server fails after receiving them', async () => {
  await withApi(async ({ rest, reset, seen, waits }) => {
    for (const [name, call] of ONCE_ONLY) {
      for (const failure of FAILURES) {
        reset(failure, 'ok');
        await assert.rejects(call(rest), `${name} after ${failure} should fail`);
        await new Promise((resolve) => setTimeout(resolve, 20)); // a resend would arrive here
        assert.equal(seen().length, 1, `${name} after ${failure}: requests seen`);
        assert.deepEqual(waits, [], `${name} after ${failure}: no retry`);
      }
    }
  });
});

test('a server error is reported as TavernAPIError, also with an empty body', async () => {
  await withApi(async ({ rest, reset, seen }) => {
    reset('emptyServerError');
    await assert.rejects(rest.sendMessage('t', 'c', { content: 'x' }), (err) => {
      assert.ok(err instanceof TavernAPIError);
      assert.equal(err.status, 500);
      return true;
    });
    assert.equal(seen().length, 1);

    reset('serverError');
    await assert.rejects(rest.banMember('t', 'u'), { name: 'TavernAPIError', status: 500, message: 'Internal server error' });

    reset('badGateway');
    await assert.rejects(rest.unbanMember('t', 'u'), { status: 502, message: /^HTTP 502: <html>/ });
  });
});

test('GET and PUT are sent again after a server error or a lost connection', async () => {
  await withApi(async ({ rest, reset, seen, waits }) => {
    for (const failure of FAILURES) {
      reset(failure, 'ok');
      assert.deepEqual(await rest.getChannels('t'), { ok: true }, failure);
      assert.equal(seen().length, 2, `GET after ${failure}`);
      assert.deepEqual(waits, [1000], `GET after ${failure}`);

      reset(failure, 'ok');
      await rest.registerCommands([{ name: 'ping', description: 'Ping' }]);
      assert.equal(seen().length, 2, `PUT after ${failure}`);
      assert.equal(seen()[0].method, 'PUT');
      assert.equal(seen()[1].body, seen()[0].body, 'the same body is sent again');
    }
  });
});

test('retries back off and stop after three', async () => {
  await withApi(async ({ rest, reset, seen, waits }) => {
    reset('serverError');
    await assert.rejects(rest.getMember('t', 'u'), { name: 'TavernAPIError', status: 500 });
    assert.equal(seen().length, 4);
    assert.deepEqual(waits, [1000, 2000, 4000]);
  });
});

test('a 429 is sent again after the wait for every method, with the same body', async () => {
  const sockets = new Set();
  let count = 0;
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      seen.push(`${req.method} ${Buffer.concat(chunks).toString('utf8')}`);
      count += 1;
      if (count % 2 === 1) {
        res.writeHead(429, { 'retry-after': '2', 'content-type': 'application/json' });
        res.end('{"message":"Rate limit exceeded"}');
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      }
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const rest = new RESTClient(TOKEN, `http://127.0.0.1:${server.address().port}/api/v1`, { allowInsecure: true });
  const waits = [];
  rest.sleep = async (ms) => {
    waits.push(ms);
  };
  try {
    await rest.sendMessage('t', 'c', { content: 'hello' });
    await rest.editMessage('t', 'm', { content: 'edited' });
    await rest.kickMember('t', 'u', 'spam');
    await rest.getChannels('t');
    assert.deepEqual(seen, [
      'POST {"content":"hello"}', 'POST {"content":"hello"}',
      'PATCH {"content":"edited"}', 'PATCH {"content":"edited"}',
      'DELETE {"reason":"spam"}', 'DELETE {"reason":"spam"}',
      'GET ', 'GET ',
    ]);
    assert.deepEqual(waits, [2000, 2000, 2000, 2000]);
  } finally {
    for (const socket of sockets) socket.destroy();
    server.close();
  }
});

test('a POST is sent again when the connection was refused', async () => {
  // Find a free port, then leave it closed so the first connection is refused
  const probe = http.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  probe.close();
  await once(probe, 'close');

  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      seen.push(`${req.method} ${req.url} ${Buffer.concat(chunks).toString('utf8')}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"id":"m1"}');
    });
  });

  const rest = new RESTClient(TOKEN, `http://127.0.0.1:${port}/api/v1`, { allowInsecure: true });
  const waits = [];
  rest.sleep = async (ms) => {
    waits.push(ms);
    if (!server.listening) {
      server.listen(port, '127.0.0.1'); // the API comes up before the retry
      await once(server, 'listening');
    }
  };
  try {
    assert.deepEqual(await rest.sendMessage('t', 'c', { content: 'hello' }), { id: 'm1' });
    assert.deepEqual(waits, [1000]);
    assert.deepEqual(seen, ['POST /api/v1/taverns/t/channels/c/messages {"content":"hello"}']);
  } finally {
    server.close();
  }
});

test('only errors from before the request was sent count as not sent', () => {
  for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']) {
    assert.equal(isNotSentError(Object.assign(new Error(code), { code })), true, code);
  }
  for (const code of ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'EHOSTUNREACH', 'ERR_STREAM_DESTROYED', undefined]) {
    assert.equal(isNotSentError(Object.assign(new Error('x'), { code })), false, String(code));
  }
  // A connection tried on several addresses: every attempt must have been refused
  const refused = { code: 'ECONNREFUSED' };
  assert.equal(isNotSentError({ code: 'ECONNREFUSED', errors: [refused, refused] }), true);
  assert.equal(isNotSentError({ code: 'ECONNREFUSED', errors: [refused, { code: 'ETIMEDOUT' }] }), false);
  assert.equal(isNotSentError(null), false);
  assert.equal(isNotSentError('ECONNREFUSED'), false);
});
