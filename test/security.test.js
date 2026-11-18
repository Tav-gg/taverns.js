// Security tests: run with `npm test` (builds first). Everything runs against
// local servers on 127.0.0.1; nothing leaves the machine.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { once } = require('node:events');
const { WebSocketServer } = require('ws');

const { Client, Gateway, RESTClient, verifyWebhookSignature } = require('../dist/index.js');
const { pathSegment, route } = require('../dist/url.js');

const ROOT = path.join(__dirname, '..');
const SECRET = 'test-webhook-secret';
const TOKEN = 'tavbot_hidden123';

// ─── Webhook signatures ─────────────────────────────────────

function delivery({ timestamp = Date.now(), secret = SECRET } = {}) {
  const body = JSON.stringify({ event: 'tavern_message', data: { content: 'hi' }, timestamp, botApplicationId: 'app-1' });
  const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  return { body, signature, timestamp: String(timestamp) };
}

test('webhook: a valid delivery is accepted (string, Buffer and Uint8Array bodies)', () => {
  const d = delivery();
  assert.equal(verifyWebhookSignature(d.body, d.signature, SECRET, d.timestamp), true);
  assert.equal(verifyWebhookSignature(Buffer.from(d.body), d.signature, SECRET, d.timestamp), true);
  assert.equal(verifyWebhookSignature(new TextEncoder().encode(d.body), d.signature, SECRET), true);
  assert.equal(verifyWebhookSignature(d.body, d.signature.toUpperCase().replace('SHA256=', 'sha256='), SECRET), true);
});

test('webhook: an empty or missing secret throws instead of verifying', () => {
  const d = delivery({ secret: '' });
  assert.throws(() => verifyWebhookSignature(d.body, d.signature, ''), /secret is empty/);
  assert.throws(() => verifyWebhookSignature(d.body, d.signature, undefined), /secret is empty/);
  assert.throws(() => verifyWebhookSignature(d.body, d.signature, null), /secret is empty/);
});

test('webhook: a parsed JSON body is refused with a clear error', () => {
  const d = delivery();
  assert.throws(() => verifyWebhookSignature(JSON.parse(d.body), d.signature, SECRET), /raw request body/);
});

test('webhook: wrong secret or tampered body is rejected', () => {
  const d = delivery();
  assert.equal(verifyWebhookSignature(d.body, d.signature, 'another-secret'), false);
  assert.equal(verifyWebhookSignature(d.body.replace('hi', 'ho'), d.signature, SECRET), false);
});

test('webhook: freshness uses the signed body timestamp, not the header', () => {
  const old = delivery({ timestamp: Date.now() - 10 * 60 * 1000 });
  const fresh = String(Date.now());
  // Replay of an old delivery with a fresh (unsigned) header
  assert.equal(verifyWebhookSignature(old.body, old.signature, SECRET, fresh), false);
  // Replay with the header removed
  assert.equal(verifyWebhookSignature(old.body, old.signature, SECRET), false);
  assert.equal(verifyWebhookSignature(old.body, old.signature, SECRET, undefined), false);
  // Header that does not match the signed timestamp
  const d = delivery();
  assert.equal(verifyWebhookSignature(d.body, d.signature, SECRET, String(Number(d.timestamp) + 1)), false);
  // maxAge 0 turns the freshness check off
  assert.equal(verifyWebhookSignature(old.body, old.signature, SECRET, undefined, 0), true);
  // A larger window accepts it
  assert.equal(verifyWebhookSignature(old.body, old.signature, SECRET, old.timestamp, 3600), true);
});

test('webhook: a signed body without a numeric timestamp fails the freshness check', () => {
  for (const body of ['{"event":"x"}', '{"timestamp":"123"}', '[]', 'not json']) {
    const signature = 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    assert.equal(verifyWebhookSignature(body, signature, SECRET), false, body);
    assert.equal(verifyWebhookSignature(body, signature, SECRET, undefined, 0), true, body);
  }
});

test('webhook: garbage, non-ASCII and malformed signature headers return false without throwing', () => {
  const d = delivery();
  const hex = d.signature.slice('sha256='.length);
  const headers = [
    undefined, '', 'sha256=', 'sha256', 'md5=' + hex, hex, 'sha256=' + hex.slice(2),
    'sha256=' + hex + '00', 'sha256=' + 'zz'.repeat(32), 'sha256=é' + hex.slice(1),
    'sha256=' + 'ÿ'.repeat(64), 'sha256=\u{1F600}', 'sha256=' + hex + '=', [d.signature, d.signature], [],
  ];
  for (const header of headers) {
    assert.equal(verifyWebhookSignature(d.body, header, SECRET), false, JSON.stringify(header));
  }
  assert.equal(verifyWebhookSignature(d.body, [d.signature], SECRET, [d.timestamp]), true);
  assert.equal(verifyWebhookSignature(d.body, d.signature, SECRET, 'é'), false);
});

// ─── Path escaping ──────────────────────────────────────────

test('pathSegment escapes separators and refuses empty, "." and ".."', () => {
  assert.equal(pathSegment('../x'), '..%2Fx');
  assert.equal(pathSegment('a?b#c'), 'a%3Fb%23c');
  assert.equal(pathSegment('%2e%2e'), '%252e%252e');
  assert.equal(pathSegment(42), '42');
  for (const bad of ['', '.', '..', undefined, null]) {
    assert.throws(() => pathSegment(bad), TypeError, String(bad));
  }
  assert.equal(route`/taverns/${'../x'}/members/${'u'}`, '/taverns/..%2Fx/members/u');
});

test('every interpolated path in rest.ts goes through route``', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'rest.ts'), 'utf8');
  const untagged = source.match(/(?<!route)`\/[^`]*\$\{[^`]*`/g) || [];
  assert.deepEqual(untagged, []);
});

async function withApiServer(fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    req.resume();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const rest = new RESTClient(TOKEN, `http://127.0.0.1:${server.address().port}/api/v1`, { allowInsecure: true });
  try {
    await fn(rest, seen);
  } finally {
    server.close();
  }
}

test('a crafted ID like "../evil" cannot change the route of any REST helper', async () => {
  const E = '../evil';
  const calls = [
    ['getTavern', [E]], ['getChannels', [E]], ['createChannel', [E, { name: 'x' }]],
    ['updateChannel', ['t', E, {}]], ['deleteChannel', ['t', E]],
    ['sendMessage', ['t', E, { content: 'x' }]], ['getMessages', ['t', E]],
    ['editMessage', ['t', E, { content: 'x' }]], ['deleteMessage', ['t', E]],
    ['pinMessage', ['t', E]], ['unpinMessage', ['t', E]], ['getPinnedMessages', ['t', E]],
    ['searchMessages', [E, { query: 'q' }]], ['searchMessages', ['t', { query: 'q', channelId: E }]],
    ['addReaction', ['t', E, 'x']], ['removeReaction', ['t', 'm', E]],
    ['bulkDeleteMessages', ['t', E, ['a']]], ['getMembers', [E]], ['getMember', ['t', E]],
    ['kickMember', ['t', E]], ['banMember', [E, 'u']], ['unbanMember', ['t', E]],
    ['muteMember', [E, 'u']], ['unmuteMember', ['t', E]], ['getRoles', [E]],
    ['createRole', [E, { name: 'r' }]], ['updateRole', ['t', E, {}]], ['deleteRole', ['t', E]],
    ['addMemberRole', ['t', 'u', E]], ['removeMemberRole', ['t', E, 'r']],
    ['createThread', ['t', E, { name: 'x' }]], ['getThreads', ['t', E]], ['getActiveThreads', [E]],
    ['deleteCommand', [E]], ['joinVoice', ['t', E]], ['leaveVoice', [E]],
    ['replyToInteraction', [E, { content: 'x' }]], ['deferInteraction', [E]],
    ['followUpInteraction', [E, { content: 'x' }]],
  ];
  await withApiServer(async (rest, seen) => {
    for (const [method, args] of calls) {
      seen.length = 0;
      await rest[method](...args);
      assert.equal(seen.length, 1, method);
      assert.ok(seen[0].includes('/api/v1/'), `${method}: ${seen[0]}`);
      assert.ok(seen[0].includes('..%2Fevil'), `${method}: ${seen[0]}`);
      assert.ok(!seen[0].includes('/evil'), `${method}: ${seen[0]}`);
    }
  });
});

test('query and fragment characters in an ID stay inside the path segment', async () => {
  await withApiServer(async (rest, seen) => {
    await rest.getMember('t', 'u?admin=1#x');
    assert.deepEqual(seen, ['GET /api/v1/taverns/t/members/u%3Fadmin%3D1%23x']);
    seen.length = 0;
    await rest.removeReaction('t', 'm', '\u{1F44D}');
    assert.deepEqual(seen, ['DELETE /api/v1/taverns/t/messages/m/reactions/%F0%9F%91%8D']);
    await assert.rejects(rest.getTavern('..'), TypeError);
    await assert.rejects(rest.getMember('t', ''), TypeError);
  });
});

// ─── Plain http:// and ws:// URLs ───────────────────────────

test('plain http:// and ws:// URLs are refused unless allowInsecure is set', () => {
  assert.throws(() => new RESTClient(TOKEN, 'http://127.0.0.1:1/api/v1'), /allowInsecure/);
  assert.throws(() => new Gateway({ token: TOKEN, url: 'ws://127.0.0.1:1' }), /allowInsecure/);
  assert.throws(() => new Client({ token: TOKEN, apiUrl: 'http://127.0.0.1:1/api/v1' }), /allowInsecure/);
  assert.throws(() => new Client({ token: TOKEN, wsUrl: 'ws://127.0.0.1:1' }), /allowInsecure/);
  assert.throws(() => new RESTClient(TOKEN, 'ftp://example.com'), /https:\/\//);
  assert.throws(() => new Gateway({ token: TOKEN, url: 'https://example.com' }), /wss:\/\//);
  assert.throws(() => new RESTClient(TOKEN, 'not a url'), /not a valid URL/);

  assert.doesNotThrow(() => new RESTClient(TOKEN));
  assert.doesNotThrow(() => new RESTClient(TOKEN, 'https://example.com/api/v1'));
  assert.doesNotThrow(() => new RESTClient(TOKEN, 'http://127.0.0.1:1/api/v1', { allowInsecure: true }));
  assert.doesNotThrow(() => new Gateway({ token: TOKEN, url: 'ws://127.0.0.1:1', allowInsecure: true }));
  const client = new Client({
    token: TOKEN, apiUrl: 'http://127.0.0.1:1/api/v1', wsUrl: 'ws://127.0.0.1:1', allowInsecure: true,
  });
  client.destroy();
});

// ─── Gateway: authentication failures and the token ────────

test('a refused handshake (HTTP 401) stops reconnecting and never logs the token', async () => {
  const upgrades = [];
  const server = http.createServer();
  server.on('upgrade', (req, socket) => {
    upgrades.push(req.url);
    socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const debug = [];
  const gateway = new Gateway({ token: TOKEN, url: `ws://127.0.0.1:${server.address().port}`, allowInsecure: true });
  gateway.on('debug', (message) => debug.push(message));
  try {
    await assert.rejects(gateway.connect(), /Authentication failed.*HTTP 401/);
    await new Promise((resolve) => setTimeout(resolve, 50)); // let the socket close
    assert.equal(upgrades.length, 1);
    assert.ok(upgrades[0].includes('token='), 'the handshake carries the token');
    assert.equal(gateway.reconnectTimer, null, 'no reconnect scheduled');
    await assert.rejects(gateway.connect(), /Authentication failed/); // same token: refused at once
    assert.equal(upgrades.length, 1);
    assert.ok(!debug.join('\n').includes('hidden123'), 'token in debug output');
  } finally {
    gateway.destroy();
    server.close();
  }
});

async function withWsServer(onConnection, fn) {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(wss, 'listening');
  wss.on('connection', onConnection);
  try {
    await fn(`ws://127.0.0.1:${wss.address().port}`);
  } finally {
    for (const socket of wss.clients) socket.terminate();
    wss.close();
  }
}

test('close codes 4001, 4003 and 4004 stop reconnecting and report authFailed', async () => {
  for (const code of [4001, 4003, 4004]) {
    await withWsServer((socket) => socket.close(code, 'Unauthorized'), async (url) => {
      const debug = [];
      const gateway = new Gateway({ token: TOKEN, url, allowInsecure: true });
      gateway.on('debug', (message) => debug.push(message));
      const failed = once(gateway, 'authFailed');
      await gateway.connect();
      const [err] = await failed;
      assert.match(err.message, new RegExp(`Authentication failed.*${code}`));
      assert.equal(gateway.reconnectTimer, null, `no reconnect after ${code}`);
      assert.ok(!debug.join('\n').includes('hidden123'), 'token in debug output');
      gateway.destroy();
    });
  }
});

test('the client turns a refused token into an error event', async () => {
  await withWsServer((socket) => socket.close(4001, 'Unauthorized'), async (url) => {
    const client = new Client({ token: TOKEN, wsUrl: url, apiUrl: 'http://127.0.0.1:1/api/v1', allowInsecure: true });
    const errored = once(client, 'error');
    await client.gateway.connect();
    const [err] = await errored;
    assert.match(err.message, /Authentication failed/);
    client.destroy();
  });
});

test('an ordinary close still reconnects', async () => {
  await withWsServer((socket) => socket.close(1001, 'restart'), async (url) => {
    const gateway = new Gateway({ token: TOKEN, url, allowInsecure: true });
    const closed = once(gateway, 'close');
    await gateway.connect();
    await closed;
    assert.notEqual(gateway.reconnectTimer, null, 'reconnect scheduled');
    gateway.destroy();
  });
});

// ─── Versions agree ─────────────────────────────────────────

test('package.json, package-lock.json and the User-Agent carry the same version', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const rest = fs.readFileSync(path.join(ROOT, 'src', 'rest.ts'), 'utf8');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.match(rest, new RegExp(`'User-Agent': 'taverns\\.js/${pkg.version.replace(/\./g, '\\.')}'`));
});
