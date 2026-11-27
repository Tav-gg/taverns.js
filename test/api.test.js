// API contract tests: run with `npm test` (builds first). They check that the
// SDK sends what the Taverns API takes and reads what it answers. Everything
// runs against local servers on 127.0.0.1; nothing leaves the machine.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { WebSocketServer } = require('ws');

const { Client, Gateway, GatewayIntents, GatewayEvent, FRIENDLY_EVENT_MAP } = require('../dist/index.js');

const TOKEN = 'tavbot_hidden123';
const TAVERN = '11111111-1111-4111-8111-111111111111';
const HALL = '22222222-2222-4222-8222-222222222222';
const PERSON = '33333333-3333-4333-8333-333333333333';
const MESSAGE = '44444444-4444-4444-8444-444444444444';
const ROLE = '55555555-5555-4555-8555-555555555555';
const BOT_USER = '66666666-6666-4666-8666-666666666666';

function channel(id, overrides = {}) {
  return { id, name: 'general', type: 'TEXT', tavernId: TAVERN, position: 0, ...overrides };
}

function memberRow(userId, overrides = {}) {
  return {
    id: `member-of-${userId}`,
    userId,
    nickname: null,
    joinedAt: '2026-11-27T00:00:00.000Z',
    user: { id: userId, displayName: 'Ana', avatarUrl: null, username: 'ana' },
    roles: [],
    isOnline: true,
    status: 'ONLINE',
    isOwner: false,
    isBot: false,
    activity: null,
    ...overrides,
  };
}

/**
 * Runs a local API. `answer(req, body)` returns `{ status, json? }` or nothing
 * (200 with `{}`). Every request is recorded as `{ method, url, body }`.
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
      const out = answer(req, body) || { status: 200, json: {} };
      res.writeHead(out.status, { 'content-type': 'application/json' });
      res.end(out.json === undefined ? '' : JSON.stringify(out.json));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const apiUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  const client = new Client({ token: TOKEN, apiUrl, allowInsecure: true, autoReconnect: false });
  try {
    await fn({ client, rest: client.rest, seen });
  } finally {
    client.destroy();
    server.close();
  }
}

function query(url) {
  return Object.fromEntries(new URL(url, 'http://x').searchParams);
}

/** Feed one gateway event to the client, as if it came over the socket. */
function deliver(client, event, data) {
  client.gateway.emit('event', event, data);
}

// ─── Intents ────────────────────────────────────────────────

test('intent bits match the API (bits 0 to 16)', () => {
  const expected = [
    'TAVERN_MESSAGES', 'MESSAGE_CONTENT', 'TAVERN_MEMBERS', 'TAVERN_MODERATION', 'TAVERN_CHANNELS',
    'TAVERN_THREADS', 'TAVERN_FORUMS', 'TAVERN_ROLES', 'TAVERN_SETTINGS', 'TAVERN_EVENTS', 'TAVERN_VOICE',
    'TAVERN_BROADCASTS', 'TAVERN_TYPING', 'TAVERN_REACTIONS', 'TAVERN_PINS', 'INTERACTIONS', 'DIRECT_MESSAGES',
  ];
  expected.forEach((name, bit) => assert.equal(GatewayIntents[name], 1n << BigInt(bit), name));
  const flags = Object.keys(GatewayIntents).filter((key) => key !== 'DEFAULT' && key !== 'ALL');
  assert.deepEqual(flags.sort(), [...expected].sort(), 'no intent the API does not know');
  assert.equal(GatewayIntents.DEFAULT, 0x17FF9n);
  assert.equal(GatewayIntents.ALL, 0x1FFFFn);
});

// ─── Channels ───────────────────────────────────────────────

test('getChannels reads `channels` from the { channels, categories } answer', async () => {
  const category = { id: 'cat-1', name: 'Text', position: 0, tavernId: TAVERN };
  await withApi(() => ({ status: 200, json: { channels: [channel(HALL)], categories: [category] } }), async ({ rest, seen }) => {
    assert.deepEqual(await rest.getChannels(TAVERN), [channel(HALL)]);
    assert.deepEqual(await rest.getCategories(TAVERN), [category]);
    assert.deepEqual(await rest.getChannelList(TAVERN), { channels: [channel(HALL)], categories: [category] });
    assert.deepEqual(seen.map((r) => r.url), Array(3).fill(`/api/v1/taverns/${TAVERN}/channels`));
  });
  // An unexpected answer gives empty lists, not a crash
  await withApi(() => ({ status: 200, json: {} }), async ({ rest }) => {
    assert.deepEqual(await rest.getChannelList(TAVERN), { channels: [], categories: [] });
  });
});

test('login caches channels, and message.reply() reaches the right tavern', async () => {
  const self = {
    id: 'app-1',
    name: 'Bot',
    description: null,
    user: { id: BOT_USER, displayName: 'Bot', avatarUrl: null, isBot: true },
    taverns: [{ id: TAVERN, name: 'Inn', slug: 'inn', iconUrl: null, memberCount: 3, grantedPermissions: '0', installedAt: '' }],
  };
  const api = (req) => {
    if (req.url === '/api/v1/bots/@me') return { status: 200, json: self };
    if (req.url === `/api/v1/taverns/${TAVERN}/channels`) {
      return { status: 200, json: { channels: [channel(HALL)], categories: [] } };
    }
    return { status: 201, json: { id: 'sent' } };
  };
  await withApi(api, async ({ client, seen }) => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(wss, 'listening');
    // A client on this API and a local gateway
    const bot = new Client({
      token: TOKEN, apiUrl: client.rest.baseUrl, wsUrl: `ws://127.0.0.1:${wss.address().port}`,
      allowInsecure: true, autoReconnect: false,
    });
    try {
      await bot.login();
      assert.equal(bot.channels.get(HALL).tavernId, TAVERN);
      assert.deepEqual(bot.taverns.get(TAVERN).categories, []);

      const created = once(bot, 'messageCreate');
      deliver(bot, 'tavern_message', {
        id: MESSAGE, channelId: HALL, tavernId: TAVERN, content: '!ping', sender: { id: PERSON, displayName: 'Ana', avatarUrl: null },
      });
      const [message] = await created;
      assert.equal(message.tavernId, TAVERN);
      await message.reply('Pong!');
      assert.deepEqual(seen.at(-1), {
        method: 'POST',
        url: `/api/v1/taverns/${TAVERN}/channels/${HALL}/messages`,
        body: { content: 'Pong!', replyToId: MESSAGE },
      });
    } finally {
      bot.destroy();
      for (const socket of wss.clients) socket.terminate();
      wss.close();
    }
  });
});

test('a message event names its tavern, so reply() works even before the channel is cached', async () => {
  await withApi(() => ({ status: 201, json: { id: 'sent' } }), async ({ client, seen }) => {
    const created = once(client, 'messageCreate');
    deliver(client, 'tavern_message', { id: MESSAGE, channelId: HALL, tavernId: TAVERN, content: 'hi', sender: { id: PERSON } });
    const [message] = await created;
    await message.react('\u{1F44D}');
    await message.pin();
    assert.deepEqual(seen.map((r) => `${r.method} ${r.url}`), [
      `POST /api/v1/taverns/${TAVERN}/messages/${MESSAGE}/reactions`,
      `POST /api/v1/taverns/${TAVERN}/messages/${MESSAGE}/pin`,
    ]);
  });
});

test('deleting a channel removes it from the cache (the event carries channelId)', async () => {
  await withApi(() => undefined, async ({ client }) => {
    client.taverns.set(TAVERN, { id: TAVERN, name: 'Inn', slug: 'inn', iconUrl: null, memberCount: 1, channels: [channel(HALL)] });
    client.channels.set(HALL, channel(HALL));
    const deleted = once(client, 'channelDelete');
    deliver(client, 'tavern_channel_deleted', { tavernId: TAVERN, channelId: HALL });
    const [event] = await deleted;
    assert.equal(event.channelId, HALL);
    assert.equal(client.channels.has(HALL), false);
    assert.deepEqual(client.taverns.get(TAVERN).channels, []);
  });
});

// ─── Messages ───────────────────────────────────────────────

test('getMessages returns the { messages, hasMore } page and sends the paging options', async () => {
  const page = { messages: [{ id: MESSAGE }], hasMore: true, hasMoreBefore: true, hasMoreAfter: false };
  await withApi(() => ({ status: 200, json: page }), async ({ client, seen }) => {
    const result = await client.getMessages(TAVERN, HALL, { limit: 20, before: MESSAGE });
    assert.deepEqual(result, page);
    assert.deepEqual(query(seen[0].url), { limit: '20', before: MESSAGE });
    await client.rest.getMessages(TAVERN, HALL, { after: MESSAGE, direction: 'forward' });
    assert.deepEqual(query(seen[1].url), { after: MESSAGE, direction: 'forward' });
  });
});

test('editMessage sends only the content (the API edits text only)', async () => {
  await withApi(() => undefined, async ({ rest, seen }) => {
    await rest.editMessage(TAVERN, MESSAGE, { content: 'new', embeds: [{ title: 'x' }], replyToId: 'r' });
    assert.deepEqual(seen[0], { method: 'PATCH', url: `/api/v1/taverns/${TAVERN}/messages/${MESSAGE}`, body: { content: 'new' } });
  });
});

test('sendMessage can send embeds without content', async () => {
  await withApi(() => undefined, async ({ rest, seen }) => {
    await rest.sendMessage(TAVERN, HALL, { embeds: [{ title: 'Stats' }] });
    assert.deepEqual(seen[0].body, { embeds: [{ title: 'Stats' }] });
  });
});

test('searchMessages sends q, fromUserId and the offset cursor to the tavern search', async () => {
  const answer = { messages: [{ id: MESSAGE }], hasMore: true, total: 7, nextOffset: MESSAGE, engine: 'index' };
  await withApi(() => ({ status: 200, json: answer }), async ({ rest, seen }) => {
    const result = await rest.searchMessages(TAVERN, {
      q: 'dragon', fromUserId: PERSON, channelId: HALL, has: ['image', 'link'], limit: 10, offset: MESSAGE, includeThreads: false,
    });
    assert.deepEqual(result, { messages: [{ id: MESSAGE }], hasMore: true, total: 7, nextOffset: MESSAGE });
    assert.equal(new URL(seen[0].url, 'http://x').pathname, `/api/v1/taverns/${TAVERN}/messages/search`);
    assert.deepEqual(query(seen[0].url), {
      q: 'dragon', fromUserId: PERSON, channelId: HALL, has: 'image,link', limit: '10', offset: MESSAGE, includeThreads: 'false',
    });

    // The 0.3 names still work, and nothing the API does not take is sent
    await rest.searchMessages(TAVERN, { query: 'dragon', senderId: PERSON });
    assert.deepEqual(query(seen[1].url), { q: 'dragon', fromUserId: PERSON });
  });
  await withApi(() => ({ status: 200, json: {} }), async ({ rest }) => {
    assert.deepEqual(await rest.searchMessages(TAVERN, { q: 'x' }), { messages: [], hasMore: false, total: null, nextOffset: null });
  });
});

// ─── Members ────────────────────────────────────────────────

test('getMembers lists every member without paging parameters', async () => {
  await withApi(() => ({ status: 200, json: [memberRow(PERSON)] }), async ({ client, seen }) => {
    const members = await client.getMembers(TAVERN);
    assert.equal(seen[0].url, `/api/v1/taverns/${TAVERN}/members`);
    assert.equal(members.get(PERSON).id, `member-of-${PERSON}`);
    assert.equal(members.get(PERSON).tavernId, TAVERN);
  });
});

test('searchMembers sends q and limit and returns the members', async () => {
  const found = { id: 'm', userId: PERSON, displayName: 'Ana', avatarUrl: null, nickname: null, username: 'ana' };
  await withApi(() => ({ status: 200, json: { members: [found], count: 1 } }), async ({ rest, seen }) => {
    assert.deepEqual(await rest.searchMembers(TAVERN, 'an', { limit: 5 }), [found]);
    assert.deepEqual(query(seen[0].url), { q: 'an', limit: '5' });
  });
});

test('getMember, kick with a reason, and roles by user ID use the member routes', async () => {
  await withApi((req) => (req.method === 'GET' ? { status: 200, json: memberRow(PERSON) } : undefined), async ({ client, rest, seen }) => {
    const member = await client.getMember(TAVERN, PERSON);
    assert.equal(member.userId, PERSON);
    await rest.kickMember(TAVERN, PERSON, 'spam');
    await rest.kickMember(TAVERN, PERSON);
    await rest.addMemberRole(TAVERN, PERSON, ROLE);
    await rest.removeMemberRole(TAVERN, PERSON, ROLE);
    assert.deepEqual(seen, [
      { method: 'GET', url: `/api/v1/taverns/${TAVERN}/members/${PERSON}`, body: undefined },
      { method: 'DELETE', url: `/api/v1/taverns/${TAVERN}/members/${PERSON}`, body: { reason: 'spam' } },
      { method: 'DELETE', url: `/api/v1/taverns/${TAVERN}/members/${PERSON}`, body: undefined },
      { method: 'POST', url: `/api/v1/taverns/${TAVERN}/members/${PERSON}/roles/${ROLE}`, body: undefined },
      { method: 'DELETE', url: `/api/v1/taverns/${TAVERN}/members/${PERSON}/roles/${ROLE}`, body: undefined },
    ]);
  });
});

test('memberJoin carries { user, member } and fills the member cache', async () => {
  await withApi(() => ({ status: 200, json: [] }), async ({ client }) => {
    client.taverns.set(TAVERN, { id: TAVERN, name: 'Inn', slug: 'inn', iconUrl: null, memberCount: 1 });
    await client.getMembers(TAVERN); // start the cache
    const joined = once(client, 'memberJoin');
    const row = memberRow(PERSON);
    deliver(client, 'tavern_member_joined', { tavernId: TAVERN, user: { id: PERSON, displayName: 'Ana', avatarUrl: null }, member: row });
    const [event] = await joined;
    assert.equal(event.user.displayName, 'Ana');
    assert.equal(client.memberCache.get(TAVERN).get(PERSON).id, row.id);
    assert.equal(client.taverns.get(TAVERN).memberCount, 2);
  });
});

// ─── Roles ──────────────────────────────────────────────────

test('reorderRoles sends { roles: [{ id, position }] }', async () => {
  await withApi(() => undefined, async ({ rest, seen }) => {
    await rest.reorderRoles(TAVERN, [{ id: ROLE, position: 3, name: 'extra' }]);
    assert.deepEqual(seen[0], {
      method: 'PATCH',
      url: `/api/v1/taverns/${TAVERN}/roles/reorder`,
      body: { roles: [{ id: ROLE, position: 3 }] },
    });
  });
});

test('role events: roleCreate, roleUpdate and roleDelete (with roleId)', async () => {
  await withApi(() => undefined, async ({ client }) => {
    const events = [];
    for (const name of ['roleCreate', 'roleUpdate', 'roleDelete']) client.on(name, (event) => events.push([name, event]));
    deliver(client, 'tavern_role_created', { tavernId: TAVERN, role: { id: ROLE, name: 'Mods' } });
    deliver(client, 'tavern_role_updated', { tavernId: TAVERN, id: ROLE, name: 'Mods' });
    deliver(client, 'tavern_role_deleted', { tavernId: TAVERN, roleId: ROLE });
    assert.deepEqual(events, [
      ['roleCreate', { tavernId: TAVERN, role: { id: ROLE, name: 'Mods' } }],
      ['roleUpdate', { tavernId: TAVERN, id: ROLE, name: 'Mods' }],
      ['roleDelete', { tavernId: TAVERN, roleId: ROLE }],
    ]);
  });
});

// ─── Typing, installs and permissions ───────────────────────

test('tavern_typing_indicator becomes typingStart or typingStop', async () => {
  await withApi(() => undefined, async ({ client }) => {
    const events = [];
    client.on('typingStart', (event) => events.push(['start', event.userId]));
    client.on('typingStop', (event) => events.push(['stop', event.userId]));
    deliver(client, 'tavern_typing_indicator', { tavernId: TAVERN, channelId: HALL, userId: PERSON, displayName: 'Ana', isTyping: true });
    deliver(client, 'tavern_typing_indicator', { tavernId: TAVERN, channelId: HALL, userId: PERSON, isTyping: false });
    assert.deepEqual(events, [['start', PERSON], ['stop', PERSON]]);
    assert.equal(GatewayEvent.TYPING_INDICATOR, 'tavern_typing_indicator');
    assert.equal(Object.values(FRIENDLY_EVENT_MAP).includes('typingStart'), false);
  });
});

test('startTyping and stopTyping send the typing actions', async () => {
  await withApi(() => undefined, async ({ client }) => {
    const sent = [];
    client.gateway.send = (action, data) => sent.push([action, data]);
    client.startTyping(TAVERN, HALL);
    client.stopTyping(TAVERN, HALL);
    assert.deepEqual(sent, [
      ['tavern_typing_start', { tavernId: TAVERN, channelId: HALL }],
      ['tavern_typing_stop', { tavernId: TAVERN, channelId: HALL }],
    ]);
  });
});

test('bot_installed names the tavern; bot_permissions_updated emits botPermissionsUpdated', async () => {
  await withApi(() => ({ status: 200, json: { channels: [channel(HALL)], categories: [] } }), async ({ client }) => {
    const installed = once(client, 'botInstalled');
    deliver(client, 'bot_installed', { tavernId: TAVERN, tavernName: 'Inn', grantedPermissions: '3072' });
    await installed;
    assert.equal(client.taverns.get(TAVERN).name, 'Inn');
    assert.equal(client.taverns.get(TAVERN).grantedPermissions, '3072');

    const updated = once(client, 'botPermissionsUpdated');
    deliver(client, 'bot_permissions_updated', { tavernId: TAVERN, grantedPermissions: '8' });
    const [event] = await updated;
    assert.deepEqual(event, { tavernId: TAVERN, grantedPermissions: '8' });
    assert.equal(client.taverns.get(TAVERN).grantedPermissions, '8');

    await new Promise((resolve) => setTimeout(resolve, 50)); // the channel fetch
    assert.equal(client.channels.get(HALL).tavernId, TAVERN);
  });
});

// ─── Interactions ───────────────────────────────────────────

test('interactions: embed-only replies, ephemeral defers and one follow-up route', async () => {
  await withApi(() => undefined, async ({ client, seen }) => {
    const created = once(client, 'interactionCreate');
    deliver(client, 'interaction_create', { id: 'i1', commandName: 'stats', tavernId: TAVERN, channelId: HALL, userId: PERSON, options: {} });
    const [interaction] = await created;
    await interaction.deferReply({ ephemeral: true });
    await interaction.followUp({ embeds: [{ title: 'Stats' }] });
    await client.rest.deferInteraction('i2');
    await client.rest.replyToInteraction('i2', { embeds: [{ title: 'Only an embed' }] });
    assert.deepEqual(seen, [
      { method: 'POST', url: '/api/v1/interactions/i1/defer', body: { ephemeral: true } },
      { method: 'POST', url: '/api/v1/interactions/i1/followup', body: { embeds: [{ title: 'Stats' }] } },
      { method: 'POST', url: '/api/v1/interactions/i2/defer', body: undefined },
      { method: 'POST', url: '/api/v1/interactions/i2/callback', body: { embeds: [{ title: 'Only an embed' }] } },
    ]);
  });
});

test('getThreads asks for archived threads only when told to', async () => {
  await withApi(() => ({ status: 200, json: [] }), async ({ rest, seen }) => {
    await rest.getThreads(TAVERN, HALL);
    await rest.getThreads(TAVERN, HALL, { includeArchived: true });
    assert.deepEqual(seen.map((r) => r.url), [
      `/api/v1/taverns/${TAVERN}/channels/${HALL}/threads`,
      `/api/v1/taverns/${TAVERN}/channels/${HALL}/threads?includeArchived=true`,
    ]);
  });
});

// ─── Gateway heartbeat ──────────────────────────────────────

async function withGateway(onFrame, fn) {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(wss, 'listening');
  const frames = [];
  wss.on('connection', (socket) => {
    socket.on('message', (raw) => {
      const frame = JSON.parse(raw.toString('utf8'));
      frames.push(frame.action);
      onFrame(socket, frame);
    });
  });
  try {
    await fn(`ws://127.0.0.1:${wss.address().port}`, frames, wss);
  } finally {
    for (const socket of wss.clients) socket.terminate();
    wss.close();
  }
}

test('heartbeats also ping; the pong is measured and not passed on as an event', async () => {
  await withGateway(
    (socket, frame) => {
      if (frame.action === 'ping') socket.send(JSON.stringify({ event: 'pong', data: { t: Date.now() } }));
    },
    async (url, frames) => {
      const gateway = new Gateway({ token: TOKEN, url, allowInsecure: true, heartbeatInterval: 30 });
      const events = [];
      gateway.on('event', (name) => events.push(name));
      try {
        await gateway.connect();
        await new Promise((resolve) => setTimeout(resolve, 120));
        assert.ok(frames.includes('heartbeat'), 'heartbeat sent');
        assert.ok(frames.includes('ping'), 'ping sent');
        assert.ok(gateway.latency >= 0, 'latency measured');
        assert.deepEqual(events, [], 'pong is not an event');
      } finally {
        gateway.destroy();
      }
    },
  );
});

test('a connection that goes silent is dropped and reconnected', async () => {
  // The server answers nothing and sends no pings
  await withGateway(
    () => undefined,
    async (url) => {
      const gateway = new Gateway({ token: TOKEN, url, allowInsecure: true, heartbeatInterval: 20 });
      try {
        await gateway.connect();
        // Pretend the last frame arrived long ago
        gateway.lastReceivedAt = Date.now() - 10 * 60 * 1000;
        const [code] = await once(gateway, 'close');
        assert.equal(code, 1006, 'dropped without a close frame');
        assert.notEqual(gateway.reconnectTimer, null, 'reconnect scheduled');
      } finally {
        gateway.destroy();
      }
    },
  );
});

test('the gateway’s own pings keep a quiet connection alive', async () => {
  await withGateway(
    () => undefined,
    async (url, frames, wss) => {
      const gateway = new Gateway({ token: TOKEN, url, allowInsecure: true, heartbeatInterval: 20 });
      try {
        await gateway.connect();
        const before = gateway.lastReceivedAt;
        await new Promise((resolve) => setTimeout(resolve, 5));
        for (const socket of wss.clients) socket.ping();
        await new Promise((resolve) => setTimeout(resolve, 30));
        assert.ok(gateway.lastReceivedAt > before, 'a ping from the gateway counts as traffic');
        assert.equal(gateway.connected, true);
      } finally {
        gateway.destroy();
      }
    },
  );
});
