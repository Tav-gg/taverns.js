// Direct message tests: run with `npm test` (builds first). Everything runs
// against a local server on 127.0.0.1; nothing leaves the machine.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');

const {
  Client,
  RESTClient,
  TavernAPIError,
  RateLimitError,
  GatewayIntents,
  DMErrorCode,
} = require('../dist/index.js');

const TOKEN = 'tavbot_hidden123';
const PERSON = '11111111-2222-4333-8444-555555555555';
const OTHER = '22222222-3333-4444-8555-666666666666';
const BOT_USER = '0b0b0b0b-1111-4222-8333-444444444444';

function dmChannel(id, userId) {
  return {
    id,
    type: 'dm',
    recipient: { id: userId, displayName: 'Ana', avatarUrl: null },
    createdAt: '2026-11-18T00:00:00.000Z',
    lastMessageAt: null,
  };
}

function dmMessage(overrides = {}) {
  return {
    id: 'm1',
    channelId: 'dm-1',
    content: 'hi',
    filteredContent: null,
    status: 'SENT',
    replyToId: null,
    replyTo: null,
    embeds: [],
    attachments: [],
    createdAt: '2026-11-18T00:00:00.000Z',
    editedAt: null,
    sender: { id: PERSON, displayName: 'Ana', avatarUrl: null, isBot: false },
    ...overrides,
  };
}

/**
 * Runs a local API. `answer(req, body)` returns `{ status, headers?, json? }`.
 * Every request is recorded as `{ method, url, body }` (body parsed as JSON).
 * `sleep` is replaced on the REST client so a retry would not wait in real time.
 */
async function withApi(answer, fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const body = text ? JSON.parse(text) : undefined;
      seen.push({ method: req.method, url: req.url, body });
      const out = answer(req, body, seen.length) || { status: 200, json: {} };
      res.writeHead(out.status, { 'content-type': 'application/json', ...(out.headers || {}) });
      res.end(out.json === undefined ? '' : JSON.stringify(out.json));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const apiUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  const waits = [];
  const client = new Client({ token: TOKEN, apiUrl, allowInsecure: true, autoReconnect: false });
  client.rest.sleep = async (ms) => {
    waits.push(ms);
  };
  try {
    await fn({ client, rest: client.rest, seen, waits, apiUrl });
  } finally {
    server.close();
  }
}

/** A tiny API for the DM routes: opens dm-<n> per person and echoes sends. */
function dmApi() {
  const channels = new Map();
  return (req, body) => {
    if (req.method === 'POST' && req.url === '/api/v1/bots/@me/dms') {
      if (!channels.has(body.userId)) channels.set(body.userId, `dm-${channels.size + 1}`);
      return { status: 200, json: dmChannel(channels.get(body.userId), body.userId) };
    }
    const send = /^\/api\/v1\/bots\/@me\/dms\/([^/]+)\/messages$/.exec(req.url);
    if (req.method === 'POST' && send) {
      return {
        status: 201,
        json: dmMessage({ id: 'sent', channelId: send[1], content: body.content ?? '', sender: { id: BOT_USER, displayName: 'Bot', avatarUrl: null, isBot: true } }),
      };
    }
    return { status: 200, json: {} };
  };
}

// ─── Intents ────────────────────────────────────────────────

test('DIRECT_MESSAGES is bit 16 and is in DEFAULT and ALL', () => {
  assert.equal(GatewayIntents.DIRECT_MESSAGES, 65536n);
  assert.equal(GatewayIntents.DEFAULT, 0x17FF9n);
  assert.equal(GatewayIntents.DEFAULT, 98297n);
  assert.equal(GatewayIntents.ALL, 0x1FFFFn);
  assert.equal(GatewayIntents.ALL, 131071n);
  assert.equal(GatewayIntents.DEFAULT & GatewayIntents.DIRECT_MESSAGES, GatewayIntents.DIRECT_MESSAGES);
  // DEFAULT still leaves out the privileged intents
  assert.equal(GatewayIntents.DEFAULT & GatewayIntents.MESSAGE_CONTENT, 0n);
  assert.equal(GatewayIntents.DEFAULT & GatewayIntents.TAVERN_MEMBERS, 0n);
  // Bit 12 stays TAVERN_TYPING
  assert.equal(GatewayIntents.TAVERN_TYPING, 4096n);
});

// ─── REST routes ────────────────────────────────────────────

test('createDM opens the DM with POST /bots/@me/dms', async () => {
  await withApi(dmApi(), async ({ rest, seen }) => {
    const channel = await rest.createDM(PERSON);
    assert.equal(channel.id, 'dm-1');
    assert.equal(channel.recipient.id, PERSON);
    assert.deepEqual(seen, [{ method: 'POST', url: '/api/v1/bots/@me/dms', body: { userId: PERSON } }]);
  });
});

test('sendDM opens the DM once per person, then reuses the channel', async () => {
  await withApi(dmApi(), async ({ client, seen }) => {
    const first = await client.sendDM(PERSON, 'hello');
    assert.equal(first.channelId, 'dm-1');
    assert.equal(first.content, 'hello');
    assert.deepEqual(seen.map((r) => `${r.method} ${r.url}`), [
      'POST /api/v1/bots/@me/dms',
      'POST /api/v1/bots/@me/dms/dm-1/messages',
    ]);
    assert.deepEqual(seen[1].body, { content: 'hello' });

    seen.length = 0;
    await client.sendDM(PERSON, { content: 'again', embeds: [{ title: 'Stats' }], replyToId: 'm1', nonce: 'n-1' });
    assert.deepEqual(seen.map((r) => `${r.method} ${r.url}`), ['POST /api/v1/bots/@me/dms/dm-1/messages']);
    assert.deepEqual(seen[0].body, { content: 'again', embeds: [{ title: 'Stats' }], replyToId: 'm1', nonce: 'n-1' });

    seen.length = 0;
    await client.sendDM(OTHER, 'hi there');
    assert.deepEqual(seen.map((r) => `${r.method} ${r.url}`), [
      'POST /api/v1/bots/@me/dms',
      'POST /api/v1/bots/@me/dms/dm-2/messages',
    ]);
  });
});

test('two sendDM calls at once to one person open the DM once', async () => {
  await withApi(dmApi(), async ({ client, seen }) => {
    await Promise.all([client.sendDM(PERSON, 'a'), client.sendDM(PERSON, 'b')]);
    assert.equal(seen.filter((r) => r.url === '/api/v1/bots/@me/dms').length, 1);
    assert.equal(seen.filter((r) => r.url === '/api/v1/bots/@me/dms/dm-1/messages').length, 2);
  });
});

test('sendDM opens the DM again when the remembered channel is gone', async () => {
  const api = dmApi();
  let gone = false;
  await withApi((req, body) => {
    if (gone && req.method === 'POST' && req.url === '/api/v1/bots/@me/dms/dm-1/messages') {
      gone = false;
      return { status: 404, json: { statusCode: 404, code: 'DM_CHANNEL_NOT_FOUND', error: 'DM_CHANNEL_NOT_FOUND', message: 'Direct message not found' } };
    }
    return api(req, body);
  }, async ({ client, seen }) => {
    await client.sendDM(PERSON, 'one');
    gone = true;
    seen.length = 0;
    const sent = await client.sendDM(PERSON, 'two');
    assert.equal(sent.content, 'two');
    assert.deepEqual(seen.map((r) => `${r.method} ${r.url}`), [
      'POST /api/v1/bots/@me/dms/dm-1/messages',
      'POST /api/v1/bots/@me/dms',
      'POST /api/v1/bots/@me/dms/dm-1/messages',
    ]);
  });
});

test('getDMChannel, getDMMessages, editDMMessage and deleteDMMessage use the DM routes', async () => {
  await withApi((req) => {
    if (req.method === 'GET' && req.url === '/api/v1/bots/@me/dms/dm-1') return { status: 200, json: dmChannel('dm-1', PERSON) };
    if (req.method === 'GET') return { status: 200, json: { messages: [dmMessage()], hasMore: true } };
    if (req.method === 'PATCH') return { status: 200, json: dmMessage({ id: 'm9', content: 'edited' }) };
    if (req.method === 'DELETE') return { status: 200, json: { deleted: true } };
    return { status: 500, json: {} };
  }, async ({ client, seen }) => {
    const channel = await client.getDMChannel('dm-1');
    assert.equal(channel.recipient.id, PERSON);

    const page = await client.getDMMessages('dm-1', { before: 'm5', limit: 20 });
    assert.equal(page.hasMore, true);
    assert.equal(page.messages[0].id, 'm1');

    const edited = await client.editDMMessage('dm-1', 'm9', 'edited');
    assert.equal(edited.content, 'edited');
    await client.rest.editDMMessage('dm-1', 'm9', { embeds: [{ title: 'New' }] });

    assert.equal(await client.deleteDMMessage('dm-1', 'm9'), undefined);

    assert.deepEqual(seen.map((r) => `${r.method} ${r.url}`), [
      'GET /api/v1/bots/@me/dms/dm-1',
      'GET /api/v1/bots/@me/dms/dm-1/messages?before=m5&limit=20',
      'PATCH /api/v1/bots/@me/dms/dm-1/messages/m9',
      'PATCH /api/v1/bots/@me/dms/dm-1/messages/m9',
      'DELETE /api/v1/bots/@me/dms/dm-1/messages/m9',
    ]);
    assert.deepEqual(seen[2].body, { content: 'edited' });
    assert.deepEqual(seen[3].body, { embeds: [{ title: 'New' }] });
  });
});

test('a crafted ID cannot change the route of a DM helper', async () => {
  await withApi(() => ({ status: 200, json: {} }), async ({ rest, seen }) => {
    const E = '../evil';
    await rest.getDMChannel(E);
    await rest.getDMMessages(E);
    await rest.sendDMMessage(E, { content: 'x' });
    await rest.editDMMessage(E, 'm', { content: 'x' });
    await rest.editDMMessage('c', E, { content: 'x' });
    await rest.deleteDMMessage(E, 'm');
    await rest.deleteDMMessage('c', E);
    assert.equal(seen.length, 7);
    for (const r of seen) {
      assert.ok(r.url.includes('..%2Fevil'), r.url);
      assert.ok(!r.url.includes('/evil'), r.url);
    }
  });
});

// ─── Errors ─────────────────────────────────────────────────

test('a DM limit rejects at once with RateLimitError carrying scope and retryAfter', async () => {
  await withApi(() => ({
    status: 429,
    headers: { 'retry-after': '3600' },
    json: {
      statusCode: 429,
      code: 'BOT_DM_RATE_LIMITED',
      error: 'BOT_DM_RATE_LIMITED',
      message: 'You are sending direct messages too fast.',
      scope: 'unanswered',
      retryAfter: 3600,
    },
  }), async ({ rest, seen, waits }) => {
    await assert.rejects(rest.sendDMMessage('dm-1', { content: 'x' }), (err) => {
      assert.ok(err instanceof RateLimitError);
      assert.ok(err instanceof TavernAPIError);
      assert.equal(err.status, 429);
      assert.equal(err.code, DMErrorCode.BOT_DM_RATE_LIMITED);
      assert.equal(err.scope, 'unanswered');
      assert.equal(err.retryAfter, 3600);
      assert.equal(err.message, 'You are sending direct messages too fast.');
      return true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20)); // a resend would arrive here
    assert.equal(seen.length, 1, 'not sent again');
    assert.deepEqual(waits, [], 'no wait');
  });
});

test('a DM limit without a body retryAfter takes the Retry-After header', async () => {
  await withApi(() => ({
    status: 429,
    headers: { 'retry-after': '5' },
    json: { statusCode: 429, code: 'BOT_DM_RATE_LIMITED', error: 'BOT_DM_RATE_LIMITED', message: 'Slow down', scope: 'open_burst' },
  }), async ({ client, seen }) => {
    await assert.rejects(client.sendDM(PERSON, 'x'), { name: 'RateLimitError', scope: 'open_burst', retryAfter: 5 });
    assert.equal(seen.length, 1);
  });
});

test('the general rate limit is still waited out, then rejects with RateLimitError', async () => {
  await withApi(() => ({
    status: 429,
    headers: { 'retry-after': '2' },
    json: { statusCode: 429, message: 'Rate limit exceeded. Retry after 2 seconds.', error: 'Too Many Requests' },
  }), async ({ rest, seen, waits }) => {
    await assert.rejects(rest.sendDMMessage('dm-1', { content: 'x' }), (err) => {
      assert.ok(err instanceof RateLimitError);
      assert.equal(err.retryAfter, 2);
      assert.equal(err.scope, undefined);
      assert.equal(err.code, undefined, '"Too Many Requests" is not an error code');
      return true;
    });
    assert.equal(seen.length, 6, 'the first try and 5 retries');
    assert.deepEqual(waits, [2000, 2000, 2000, 2000, 2000]);
  });
});

test('403 CANNOT_DM_USER reaches the caller as TavernAPIError with code', async () => {
  await withApi(() => ({
    status: 403,
    json: { statusCode: 403, code: 'CANNOT_DM_USER', error: 'CANNOT_DM_USER', message: 'Cannot send messages to this user' },
  }), async ({ client, seen }) => {
    await assert.rejects(client.sendDM(PERSON, 'hi'), (err) => {
      assert.ok(err instanceof TavernAPIError);
      assert.ok(!(err instanceof RateLimitError));
      assert.equal(err.status, 403);
      assert.equal(err.code, DMErrorCode.CANNOT_DM_USER);
      assert.equal(err.message, 'Cannot send messages to this user');
      return true;
    });
    // Nothing was remembered: the next send tries to open the DM again
    await assert.rejects(client.sendDM(PERSON, 'hi'), { code: 'CANNOT_DM_USER' });
    assert.deepEqual(seen.map((r) => r.url), ['/api/v1/bots/@me/dms', '/api/v1/bots/@me/dms']);
  });
});

test('error codes are read from `code`, or from an `error` that is a code', () => {
  assert.equal(new TavernAPIError('x', 403, '{"code":"BOT_DM_DISABLED","error":"Forbidden"}').code, 'BOT_DM_DISABLED');
  assert.equal(new TavernAPIError('x', 403, '{"error":"BOT_DM_REVIEW_REQUIRED"}').code, 'BOT_DM_REVIEW_REQUIRED');
  assert.equal(new TavernAPIError('x', 403, '{"error":"Forbidden"}').code, undefined);
  assert.equal(new TavernAPIError('x', 500, '').code, undefined);
  assert.equal(new TavernAPIError('x', 502, '<html>').code, undefined);
});

// ─── Gateway events ─────────────────────────────────────────

test('dm_message_create becomes dmMessageCreate with reply(), and remembers the channel', async () => {
  await withApi(dmApi(), async ({ client, seen }) => {
    const received = [];
    client.on('dmMessageCreate', (message) => received.push(message));
    client.gateway.emit('event', 'dm_message_create', dmMessage({ id: 'm1', channelId: 'dm-7', content: 'help' }));

    assert.equal(received.length, 1);
    const message = received[0];
    assert.equal(message.content, 'help');
    assert.equal(message.sender.id, PERSON);
    assert.equal(typeof message.reply, 'function');

    const sent = await message.reply('On it!');
    assert.equal(sent.channelId, 'dm-7');
    assert.deepEqual(seen[0], {
      method: 'POST',
      url: '/api/v1/bots/@me/dms/dm-7/messages',
      body: { content: 'On it!', replyToId: 'm1' },
    });

    await message.reply({ content: 'More', embeds: [{ title: 'Help' }] });
    assert.deepEqual(seen[1].body, { content: 'More', embeds: [{ title: 'Help' }], replyToId: 'm1' });

    // The person's channel is known now: sendDM does not open it again
    seen.length = 0;
    await client.sendDM(PERSON, 'later');
    assert.deepEqual(seen.map((r) => `${r.method} ${r.url}`), ['POST /api/v1/bots/@me/dms/dm-7/messages']);
  });
});

test('dm_message_update and dm_message_delete become dmMessageUpdate and dmMessageDelete', async () => {
  await withApi(dmApi(), async ({ client }) => {
    const events = [];
    client.on('dmMessageUpdate', (message) => events.push(['update', message]));
    client.on('dmMessageDelete', (event) => events.push(['delete', event]));
    client.on('raw', (name) => events.push(['raw', name]));

    const edited = dmMessage({ content: 'edited', editedAt: '2026-11-18T00:01:00.000Z' });
    client.gateway.emit('event', 'dm_message_update', edited);
    client.gateway.emit('event', 'dm_message_delete', { id: 'm1', channelId: 'dm-1' });

    assert.deepEqual(events, [
      ['raw', 'dm_message_update'],
      ['update', edited],
      ['raw', 'dm_message_delete'],
      ['delete', { id: 'm1', channelId: 'dm-1' }],
    ]);
  });
});

test('RESTClient exports the DM helpers', () => {
  const rest = new RESTClient(TOKEN);
  for (const name of ['createDM', 'getDMChannel', 'getDMMessages', 'sendDMMessage', 'editDMMessage', 'deleteDMMessage']) {
    assert.equal(typeof rest[name], 'function', name);
  }
});
