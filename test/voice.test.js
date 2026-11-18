// Voice tests: run with `npm test` (builds first). A fake media module stands
// in for @livekit/rtc-node, so no network or native code is used.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const {
  VoiceManager,
  loadRtc,
  ffmpegArgs,
  speakerFromIdentity,
  resolveFfmpegPath,
} = require('../dist/voice.js');
const { Client, PermissionsBitField } = require('../dist/index.js');

const TAVERN = 'tavern-1';
const HALL = 'hall-1';
const BOT = '0b0b0b0b-1111-4222-8333-444444444444';
const MEMBER = '11111111-2222-4333-8444-555555555555';
const FRAME_BYTES_STEREO = 960 * 2 * 2;

/** A stand-in for @livekit/rtc-node with the parts the SDK uses. */
function fakeRtc() {
  const rooms = [];
  const sources = [];
  class Room extends EventEmitter {
    constructor() {
      super();
      this.remoteParticipants = new Map();
      this.published = [];
      this.unpublished = [];
      this.localParticipant = {
        publishTrack: async (track, options) => {
          this.published.push({ track, options });
          return { sid: `TR_local_${this.published.length}` };
        },
        unpublishTrack: async (sid) => {
          this.unpublished.push(sid);
        },
      };
      rooms.push(this);
    }
    async connect(url, token, options) {
      this.connectArgs = { url, token, options };
    }
    async disconnect() {
      this.disconnected = true;
    }
  }
  class AudioSource {
    constructor(sampleRate, channels, queueMs) {
      Object.assign(this, { sampleRate, channels, queueMs, frames: [], cleared: 0 });
      sources.push(this);
    }
    async captureFrame(frame) {
      this.frames.push(frame);
      await new Promise((resolve) => setImmediate(resolve));
    }
    clearQueue() {
      this.cleared++;
    }
    async waitForPlayout() {}
    async close() {}
  }
  class AudioFrame {
    constructor(data, sampleRate, channels, samplesPerChannel) {
      Object.assign(this, { data, sampleRate, channels, samplesPerChannel });
    }
  }
  class TrackPublishOptions {}
  class AudioStream {
    constructor(track, options) {
      this.track = track;
      this.options = options;
    }
    async *[Symbol.asyncIterator]() {
      for (const frame of this.track.frames) yield frame;
    }
  }
  return {
    rooms,
    sources,
    Room,
    AudioSource,
    AudioFrame,
    AudioStream,
    TrackPublishOptions,
    LocalAudioTrack: { createAudioTrack: (name, source) => ({ name, source, close: async () => {} }) },
    TrackSource: { SOURCE_CAMERA: 1, SOURCE_MICROPHONE: 2, SOURCE_SCREENSHARE: 3, SOURCE_SCREENSHARE_AUDIO: 4 },
    RoomEvent: {
      Disconnected: 'disconnected',
      TrackPublished: 'trackPublished',
      TrackSubscribed: 'trackSubscribed',
      TrackUnsubscribed: 'trackUnsubscribed',
      ActiveSpeakersChanged: 'activeSpeakersChanged',
    },
  };
}

function joinAnswer(overrides = {}) {
  return {
    url: 'wss://media.example',
    token: 'media-token',
    identity: `${BOT}:bot`,
    room: `tavern_${HALL}`,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    listening: false,
    ...overrides,
  };
}

function setup({ answer = joinAnswer(), channels = { [HALL]: TAVERN } } = {}) {
  const rtc = fakeRtc();
  const calls = [];
  const host = {
    rest: {
      joinVoice: async (tavernId, channelId) => {
        calls.push(['join', tavernId, channelId]);
        return typeof answer === 'function' ? answer() : answer;
      },
      leaveVoice: async (tavernId) => {
        calls.push(['leave', tavernId]);
        return { success: true, left: true };
      },
    },
    tavernIdForChannel: (channelId) => channels[channelId],
    debug: () => {},
  };
  const voice = new VoiceManager(host, { rtc });
  return { rtc, calls, voice };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('join connects without auto-subscribing; the first play publishes one stereo microphone-source track', async () => {
  const { rtc, calls, voice } = setup({ answer: joinAnswer({ canSpeak: true }) });
  const connection = await voice.join(HALL);

  assert.deepEqual(calls, [['join', TAVERN, HALL]]);
  const room = rtc.rooms[0];
  assert.deepEqual(room.connectArgs, {
    url: 'wss://media.example',
    token: 'media-token',
    options: { autoSubscribe: false, dynacast: false },
  });
  assert.equal(connection.state, 'connected');
  assert.equal(connection.canSpeak, true);
  assert.equal(room.published.length, 0, 'nothing is published before the first play');

  await connection.playPCM(Buffer.alloc(FRAME_BYTES_STEREO));
  await connection.playPCM(Buffer.alloc(FRAME_BYTES_STEREO));
  assert.equal(room.published.length, 1, 'one track, reused by later plays');
  assert.equal(room.published[0].options.source, rtc.TrackSource.SOURCE_MICROPHONE);
  assert.equal(rtc.sources.length, 1);
  assert.equal(rtc.sources[0].sampleRate, 48000);
  assert.equal(rtc.sources[0].channels, 2);
  assert.equal(connection.identity, `${BOT}:bot`);
  assert.equal(voice.get(TAVERN), connection);
  await connection.leave();
});

test('an answer without canSpeak (older servers) means the bot may speak', async () => {
  const { voice } = setup();
  const connection = await voice.join(HALL);
  assert.equal(connection.canSpeak, true);
  await connection.leave();
});

test('listen-only (canSpeak false): joins and hears, never publishes, and play explains why it cannot', async () => {
  const { rtc, voice } = setup({ answer: joinAnswer({ listening: true, canSpeak: false }) });
  const connection = await voice.join(HALL);
  const room = rtc.rooms[0];
  assert.equal(connection.state, 'connected');
  assert.equal(connection.canSpeak, false);
  assert.equal(connection.listening, true);

  const subscribed = [];
  room.emit(
    'trackPublished',
    { sid: 'mic', source: rtc.TrackSource.SOURCE_MICROPHONE, setSubscribed: (on) => subscribed.push(on) },
    { identity: MEMBER },
  );
  assert.deepEqual(subscribed, [true], 'it still hears the hall');

  await assert.rejects(connection.playPCM(Buffer.alloc(FRAME_BYTES_STEREO)), (error) => {
    assert.match(error.message, /does not have the Speak permission/);
    assert.equal(error.code, 'VOICE_CANNOT_SPEAK');
    return true;
  });
  // Refused before ffmpeg is even looked for
  await assert.rejects(
    connection.play('song.mp3', { ffmpegPath: 'definitely-not-ffmpeg-binary' }),
    /does not have the Speak permission/,
  );
  assert.equal(room.published.length, 0);
  assert.equal(rtc.sources.length, 0);
  assert.equal(connection.playing, false);
  await connection.leave();
});

test('losing Speak stops what plays and drops the track; getting it back lets the next play publish again', async () => {
  const { rtc, voice } = setup({ answer: joinAnswer({ canSpeak: true }) });
  const connection = await voice.join(HALL);
  const room = rtc.rooms[0];
  const changes = [];
  connection.on('canSpeak', (on) => changes.push(on));

  const input = new PassThrough();
  const playing = connection.playPCM(input);
  input.write(Buffer.alloc(FRAME_BYTES_STEREO));
  for (let i = 0; i < 4; i++) await tick();
  assert.equal(room.published.length, 1);

  voice.handleGatewayEvent('bot_voice_updated', { tavernId: TAVERN, channelId: HALL, listening: false, canSpeak: false });
  assert.equal(await playing, 'stopped');
  for (let i = 0; i < 2; i++) await tick();
  assert.equal(connection.canSpeak, false);
  assert.deepEqual(changes, [false]);
  assert.deepEqual(room.unpublished, ['TR_local_1']);
  assert.equal(connection.state, 'connected', 'the bot stays in the hall');
  await assert.rejects(connection.playPCM(Buffer.alloc(FRAME_BYTES_STEREO)), /Speak permission/);

  voice.handleGatewayEvent('bot_voice_updated', { tavernId: TAVERN, channelId: HALL, listening: false, canSpeak: true });
  assert.deepEqual(changes, [false, true]);
  assert.equal(await connection.playPCM(Buffer.alloc(FRAME_BYTES_STEREO)), 'finished');
  assert.equal(room.published.length, 2, 'a new track is published');
  await connection.leave();
});

test('bot_voice_updated changes listening and canSpeak independently', async () => {
  const { voice } = setup({ answer: joinAnswer({ listening: false, canSpeak: true }) });
  const connection = await voice.join(HALL);
  const events = [];
  connection.on('listening', (on) => events.push(['listening', on]));
  connection.on('canSpeak', (on) => events.push(['canSpeak', on]));

  voice.handleGatewayEvent('bot_voice_updated', { tavernId: TAVERN, channelId: HALL, canSpeak: false });
  assert.equal(connection.listening, false);
  voice.handleGatewayEvent('bot_voice_updated', { tavernId: TAVERN, channelId: HALL, listening: true });
  assert.equal(connection.canSpeak, false);
  voice.handleGatewayEvent('bot_voice_updated', { tavernId: TAVERN, channelId: HALL, listening: true, canSpeak: false });

  assert.deepEqual(events, [
    ['canSpeak', false],
    ['listening', true],
  ]);
  await connection.leave();
});

test('Speak lost while the first track is being published: the play fails and nothing stays published', async () => {
  const { rtc, voice } = setup({ answer: joinAnswer({ canSpeak: true }) });
  const connection = await voice.join(HALL);
  const room = rtc.rooms[0];
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  room.localParticipant.publishTrack = async (track, options) => {
    room.published.push({ track, options });
    await gate;
    return { sid: 'TR_slow' };
  };

  const playing = connection.playPCM(Buffer.alloc(FRAME_BYTES_STEREO));
  await tick();
  voice.handleGatewayEvent('bot_voice_updated', { tavernId: TAVERN, channelId: HALL, listening: false, canSpeak: false });
  release();
  await assert.rejects(playing, /Speak permission/);
  assert.deepEqual(room.unpublished, ['TR_slow']);
  assert.equal(rtc.sources[0].frames.length, 0, 'no audio was sent');
  await connection.leave();
});

test('a renewal follows a change of canSpeak', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let answers = 0;
  const { voice } = setup({
    answer: () => {
      answers++;
      return joinAnswer({ canSpeak: answers === 1, expiresAt: new Date(Date.now() + 600_000).toISOString() });
    },
  });
  const connection = await voice.join(HALL);
  const changes = [];
  connection.on('canSpeak', (on) => changes.push(on));
  assert.equal(connection.canSpeak, true);

  t.mock.timers.tick(480_000);
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(connection.canSpeak, false);
  assert.deepEqual(changes, [false]);
  await connection.leave();
});

test('ADMINISTRATOR does not include Listen in voice halls', () => {
  const admin = new PermissionsBitField(1n << 30n);
  assert.equal(admin.has('ADMINISTRATOR'), true);
  assert.equal(admin.has('SPEAK'), true);
  assert.equal(admin.has('CONNECT_VOICE'), true);
  assert.equal(admin.has('LISTEN_VOICE'), false);
  assert.equal(admin.hasAll('SPEAK', 'LISTEN_VOICE'), false);
  const adminWithListen = admin.add('LISTEN_VOICE');
  assert.equal(adminWithListen.has('LISTEN_VOICE'), true);
  assert.equal(adminWithListen.hasAll('SPEAK', 'LISTEN_VOICE'), true);
});

test('join needs the tavern when the hall is not cached', async () => {
  const { voice } = setup({ channels: {} });
  await assert.rejects(voice.join(HALL), /pass \{ tavernId \}/);
  const connection = await voice.join(HALL, { tavernId: TAVERN });
  assert.equal(connection.tavernId, TAVERN);
  await connection.leave();
});

test('playPCM sends 20 ms stereo frames and pads the last one; resolves finished', async () => {
  const { rtc, voice } = setup();
  const connection = await voice.join(HALL);
  const events = [];
  connection.on('playing', () => events.push('playing'));
  connection.on('idle', (result) => events.push(`idle:${result}`));

  const pcm = Buffer.alloc(Math.floor(FRAME_BYTES_STEREO * 3.5));
  pcm.writeInt16LE(1234, 0);
  const result = await connection.playPCM(pcm);

  assert.equal(result, 'finished');
  const frames = rtc.sources[0].frames;
  assert.equal(frames.length, 4);
  for (const frame of frames) {
    assert.equal(frame.sampleRate, 48000);
    assert.equal(frame.channels, 2);
    assert.equal(frame.samplesPerChannel, 960);
    assert.equal(frame.data.length, 1920);
  }
  assert.equal(frames[0].data[0], 1234);
  assert.deepEqual(events, ['playing', 'idle:finished']);
  await connection.leave();
});

test('mono PCM is copied to both channels', async () => {
  const { rtc, voice } = setup();
  const connection = await voice.join(HALL);
  const mono = Buffer.alloc(960 * 2);
  mono.writeInt16LE(-42, 0);
  await connection.playPCM(mono, { channels: 1 });

  const [frame] = rtc.sources[0].frames;
  assert.equal(frame.data[0], -42);
  assert.equal(frame.data[1], -42);
  await connection.leave();
});

test('pause, resume and stop control a stream that is still arriving', async () => {
  const { rtc, voice } = setup();
  const connection = await voice.join(HALL);
  const input = new PassThrough();
  const playing = connection.playPCM(input);

  input.write(Buffer.alloc(FRAME_BYTES_STEREO));
  await tick();
  await tick();
  assert.equal(rtc.sources[0].frames.length, 1);

  assert.equal(connection.pause(), true);
  assert.equal(connection.paused, true);
  input.write(Buffer.alloc(FRAME_BYTES_STEREO * 2));
  await tick();
  await tick();
  assert.equal(rtc.sources[0].frames.length, 1, 'nothing is sent while paused');

  assert.equal(connection.resume(), true);
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(rtc.sources[0].frames.length, 3);

  connection.stop();
  assert.equal(await playing, 'stopped');
  assert.ok(rtc.sources[0].cleared >= 2);
  assert.equal(connection.playing, false);
  await connection.leave();
});

test('leave tells the server, closes the media connection and emits disconnected once', async () => {
  const { rtc, calls, voice } = setup();
  const connection = await voice.join(HALL);
  const reasons = [];
  connection.on('disconnected', (reason) => reasons.push(reason));

  await connection.leave();
  await connection.leave();

  assert.deepEqual(calls.at(-1), ['leave', TAVERN]);
  assert.equal(calls.filter(([kind]) => kind === 'leave').length, 1);
  assert.equal(rtc.rooms[0].disconnected, true);
  assert.deepEqual(reasons, ['left']);
  assert.equal(voice.get(TAVERN), undefined);
});

test('a server notice ends the connection with its reason', async () => {
  const { voice } = setup();
  const connection = await voice.join(HALL);
  const reasons = [];
  connection.on('disconnected', (reason) => reasons.push(reason));

  voice.handleGatewayEvent('bot_voice_disconnected', { tavernId: TAVERN, channelId: 'other-hall', reason: 'moderator' });
  assert.equal(connection.state, 'connected', 'another hall is not this connection');
  voice.handleGatewayEvent('bot_voice_disconnected', { tavernId: TAVERN, channelId: HALL, reason: 'moderator' });
  await tick();

  assert.deepEqual(reasons, ['moderator']);
  assert.equal(voice.get(TAVERN), undefined);
});

test('joining another hall of the same tavern moves the connection', async () => {
  const { rtc, voice } = setup({ channels: { [HALL]: TAVERN, 'hall-2': TAVERN } });
  const first = await voice.join(HALL);
  const reasons = [];
  first.on('disconnected', (reason) => reasons.push(reason));

  const second = await voice.join('hall-2');

  assert.deepEqual(reasons, ['moved']);
  assert.equal(rtc.rooms[0].disconnected, true);
  assert.equal(voice.get(TAVERN), second);
  await second.leave();
});

test('listening: subscribes to microphone and screen-share audio only, and hands out per-speaker frames', async () => {
  const { rtc, voice } = setup({ answer: joinAnswer({ listening: true }) });
  const connection = await voice.join(HALL);
  assert.equal(connection.listening, true);
  const room = rtc.rooms[0];

  const subscribed = [];
  const publication = (sid, source) => ({ sid, source, setSubscribed: (on) => subscribed.push([sid, on]) });
  room.emit('trackPublished', publication('mic', rtc.TrackSource.SOURCE_MICROPHONE), { identity: MEMBER });
  room.emit('trackPublished', publication('cam', rtc.TrackSource.SOURCE_CAMERA), { identity: MEMBER });
  room.emit('trackPublished', publication('screen', rtc.TrackSource.SOURCE_SCREENSHARE), { identity: MEMBER });
  room.emit('trackPublished', publication('screen-audio', rtc.TrackSource.SOURCE_SCREENSHARE_AUDIO), { identity: `${MEMBER}:obs` });
  assert.deepEqual(subscribed, [
    ['mic', true],
    ['screen-audio', true],
  ]);

  const heard = [];
  connection.on('audio', (frame) => heard.push(frame));
  const pcm = new Int16Array(960);
  pcm[0] = 7;
  const track = { frames: [{ data: pcm, sampleRate: 48000, channels: 1, samplesPerChannel: 960 }] };
  room.emit('trackSubscribed', track, publication('mic', rtc.TrackSource.SOURCE_MICROPHONE), { identity: MEMBER });
  room.emit('trackSubscribed', track, publication('bot-mic', rtc.TrackSource.SOURCE_MICROPHONE), { identity: `${MEMBER.replace('1111', '9999')}:bot` });
  for (let i = 0; i < 4; i++) await tick();

  assert.equal(heard.length, 2);
  assert.deepEqual(
    { userId: heard[0].userId, isBot: heard[0].isBot, source: heard[0].source, first: heard[0].pcm[0], rate: heard[0].sampleRate },
    { userId: MEMBER, isBot: false, source: 'microphone', first: 7, rate: 48000 },
  );
  assert.equal(heard[1].isBot, true);
  await connection.leave();
});

test('listening: speaking events start and stop per speaker, never for the bot itself', async () => {
  const { rtc, voice } = setup({ answer: joinAnswer({ listening: true }) });
  const connection = await voice.join(HALL);
  const events = [];
  connection.on('speaking', (event) => events.push([event.userId, event.speaking]));
  const room = rtc.rooms[0];

  room.emit('activeSpeakersChanged', [{ identity: MEMBER }, { identity: `${BOT}:bot` }]);
  room.emit('activeSpeakersChanged', []);

  assert.deepEqual(events, [
    [MEMBER, true],
    [MEMBER, false],
  ]);
  await connection.leave();
});

test('not listening: never subscribes; a grant that arrives later turns hearing on', async () => {
  const { rtc, voice } = setup();
  const connection = await voice.join(HALL);
  const room = rtc.rooms[0];
  const subscribed = [];
  const mic = { sid: 'mic', source: rtc.TrackSource.SOURCE_MICROPHONE, setSubscribed: (on) => subscribed.push(on) };
  room.remoteParticipants.set(MEMBER, { identity: MEMBER, trackPublications: new Map([['mic', mic]]) });
  room.emit('trackPublished', mic, { identity: MEMBER });
  assert.deepEqual(subscribed, []);

  const changes = [];
  connection.on('listening', (on) => changes.push(on));
  voice.handleGatewayEvent('bot_voice_updated', { tavernId: TAVERN, channelId: HALL, listening: true });
  assert.deepEqual(changes, [true]);
  assert.deepEqual(subscribed, [true]);
  await connection.leave();
});

test('renews before the token expires and closes when a renewal is refused', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let answers = 0;
  const { voice } = setup({
    answer: () => {
      answers++;
      if (answers === 3) throw Object.assign(new Error('Forbidden'), { status: 403 });
      return joinAnswer({ expiresAt: new Date(Date.now() + 600_000).toISOString() });
    },
  });
  const connection = await voice.join(HALL);
  const renewed = [];
  const reasons = [];
  connection.on('renewed', (at) => renewed.push(at));
  connection.on('disconnected', (reason) => reasons.push(reason));

  t.mock.timers.tick(480_000);
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(renewed.length, 1);

  t.mock.timers.tick(480_000);
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(reasons, ['renewal_refused']);
});

test('a missing media package is explained', () => {
  assert.throws(() => loadRtc(), /npm install @livekit\/rtc-node/);
});

test('a missing ffmpeg is explained', async () => {
  const { voice } = setup();
  const connection = await voice.join(HALL);
  await assert.rejects(
    connection.play('song.mp3', { ffmpegPath: 'definitely-not-ffmpeg-binary' }),
    /ffmpeg was not found/,
  );
  assert.equal(connection.playing, false);
  await connection.leave();
});

test('ffmpeg is asked for 48 kHz stereo s16le, with reconnects for URLs only', () => {
  assert.deepEqual(ffmpegArgs('song.mp3'), [
    '-hide_banner', '-loglevel', 'error', '-i', 'song.mp3', '-vn',
    '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', '48000', '-ac', '2', 'pipe:1',
  ]);
  const url = ffmpegArgs('https://example.com/a.ogg', { volume: 0.5, seek: 30 });
  assert.ok(url.includes('-reconnect'));
  assert.deepEqual(url.slice(3, 5), ['-ss', '30']);
  assert.ok(url.join(' ').includes('-af volume=0.5'));
  assert.equal(ffmpegArgs(null)[ffmpegArgs(null).indexOf('-i') + 1], 'pipe:0');
  assert.throws(() => ffmpegArgs('a.mp3', { volume: -1 }), RangeError);
  assert.equal(resolveFfmpegPath('/opt/ffmpeg'), '/opt/ffmpeg');
});

test('speaker identities map to user ids', () => {
  assert.deepEqual(speakerFromIdentity(MEMBER), { userId: MEMBER, isBot: false });
  assert.deepEqual(speakerFromIdentity(`${BOT}:bot`), { userId: BOT, isBot: true });
  assert.deepEqual(speakerFromIdentity(`${MEMBER}:obs`), { userId: MEMBER, isBot: false });
});

test('the client exposes voice and the Listen in voice halls permission', () => {
  const client = new Client({ token: 'tavbot_example', voice: { rtc: fakeRtc() } });
  assert.ok(client.voice instanceof VoiceManager);
  assert.equal(new PermissionsBitField(1n << 45n).has('LISTEN_VOICE'), true);
  client.destroy();
});
