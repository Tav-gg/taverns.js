/**
 * taverns.js - Voice
 *
 * Play audio in a tavern's voice halls, and (when the tavern allows it) hear
 * them.
 *
 * A bot joins one voice hall per tavern. It needs Connect there, plus Speak to
 * play or Listen to hear (one of the two is enough: a bot with Connect and
 * Listen but no Speak joins listen-only).
 *
 * Playing: with Speak (`connection.canSpeak`), the first play publishes a
 * single audio track (48 kHz PCM, or any file or URL ffmpeg can read).
 * Hearing: only when the bot requests the "Listen in voice halls" permission
 * (`LISTEN_VOICE`) and the tavern grants it explicitly (Administrator does not
 * include it); members then see a "listening" marker on the bot.
 *
 * Needs the optional package `@livekit/rtc-node` (`npm install
 * @livekit/rtc-node`). Playing files or URLs also needs ffmpeg: on your PATH,
 * in the `FFMPEG_PATH` environment variable, passed as `ffmpegPath`, or the
 * optional `ffmpeg-static` package.
 *
 * @example
 * ```ts
 * const connection = await client.voice.join(voiceHallId);
 * await connection.play('./music/intro.mp3');
 * await connection.leave();
 * ```
 */

import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import type { Readable } from 'stream';

/** Every voice hall carries 48 kHz audio. */
export const VOICE_SAMPLE_RATE = 48000;

/** One audio frame is 20 ms. */
const FRAME_MS = 20;
const SAMPLES_PER_FRAME = (VOICE_SAMPLE_RATE * FRAME_MS) / 1000; // 960 per channel
/** The bot always publishes stereo; mono input is copied to both sides. */
const PUBLISH_CHANNELS = 2;
/** How much audio is buffered ahead of what plays (keeps pause and stop quick). */
const SOURCE_QUEUE_MS = 400;
/** Renew the hall's token this long before it expires. */
const RENEW_BEFORE_MS = 120_000;
/** After a failed renewal, try again this often until the token expires. */
const RENEW_RETRY_MS = 15_000;
/** The server keeps a seat this long past `expiresAt` for a late renewal. */
const SESSION_GRACE_MS = 120_000;
/** A removal from the room waits this long for the server's reason. */
const REMOVAL_REASON_WAIT_MS = 1_500;

// ─── Public types ───────────────────────────────────────────

/** The answer to `POST /bots/@me/taverns/:tavernId/voice/:channelId/join`. */
export interface VoiceJoinResponse {
  /** Media server URL. */
  url: string;
  /** Media token: publishes the microphone source only when `canSpeak`; subscribes only when `listening`. */
  token: string;
  /** The bot's identity in the hall: `<botUserId>:bot`. */
  identity: string;
  /** The hall's room name. */
  room: string;
  /** ISO time the token expires. Join again before it to stay (the SDK does). */
  expiresAt: string;
  /** The bot can hear the hall (the tavern granted Listen in voice halls). */
  listening: boolean;
  /**
   * The bot may play audio here (it has Speak in the hall). False for a
   * listen-only bot: its token cannot publish. Older servers leave it out,
   * which means true.
   */
  canSpeak?: boolean;
}

/** Why a voice connection ended. */
export type VoiceDisconnectReason =
  /** You called `leave()` (or `client.voice.leave()`). */
  | 'left'
  /** You joined another hall of the same tavern. */
  | 'moved'
  /** A moderator disconnected the bot. */
  | 'moderator'
  /** The bot lost access: uninstalled, turned off, kicked or banned, lost View or Connect in the hall, or may neither play nor hear there. */
  | 'access_removed'
  /** The bot application was disabled or banned. */
  | 'bot_disabled'
  /** The connection was not renewed in time. */
  | 'expired'
  /** The media server reported the bot gone from the room. */
  | 'left_room'
  /** A renewal was refused (the hall is gone or the bot may no longer use it). */
  | 'renewal_refused'
  /** The media connection dropped. */
  | 'connection_lost';

/** Options for `client.voice` (pass as `new Client({ voice: { ... } })`). */
export interface VoiceOptions {
  /** Path to the ffmpeg binary for `play()`. Default: `FFMPEG_PATH`, then `ffmpeg-static`, then `ffmpeg` on PATH. */
  ffmpegPath?: string;
  /**
   * The `@livekit/rtc-node` module to use. Default: `require('@livekit/rtc-node')`.
   * @internal Mostly for tests.
   */
  rtc?: unknown;
}

/** Options for `connection.playPCM()`. */
export interface PlayPcmOptions {
  /** Channels in the input: 1 (mono) or 2 (stereo, interleaved). Default 2. */
  channels?: 1 | 2;
}

/** Options for `connection.play()`. */
export interface PlayOptions {
  /** Volume multiplier (1 = unchanged, 0.5 = half). */
  volume?: number;
  /** Start this many seconds in. */
  seek?: number;
  /** Override the ffmpeg binary for this call. */
  ffmpegPath?: string;
}

/** How a playback ended: it played to the end, or `stop()` (or a new play, or leaving) cut it. */
export type PlaybackResult = 'finished' | 'stopped';

/** Where a heard sound comes from. */
export type VoiceAudioSource = 'microphone' | 'screen_share_audio';

/** A 20 ms frame of what one speaker said (only while listening). */
export interface VoiceAudioFrame {
  /** The speaker's user id (a bot's user id for another bot). */
  userId: string;
  /** Their identity in the room. */
  identity: string;
  /** Another bot is speaking. */
  isBot: boolean;
  source: VoiceAudioSource;
  /** 48 kHz signed 16-bit PCM, mono. */
  pcm: Int16Array;
  sampleRate: number;
  channels: number;
  samplesPerChannel: number;
}

/** Someone started or stopped speaking (only while listening). */
export interface VoiceSpeakingEvent {
  userId: string;
  identity: string;
  isBot: boolean;
  speaking: boolean;
}

/** Events a `VoiceConnection` emits. */
export interface VoiceConnectionEvents {
  /** Connected (ready to play when `canSpeak`, to hear when `listening`). */
  ready: [];
  /** The connection ended. */
  disconnected: [reason: VoiceDisconnectReason];
  /** A playback started. */
  playing: [];
  /** A playback ended (finished or stopped); nothing is playing. */
  idle: [result: PlaybackResult];
  paused: [];
  resumed: [];
  /** The token was renewed. */
  renewed: [expiresAt: Date];
  /** The tavern granted or took away Listen in voice halls. */
  listening: [listening: boolean];
  /** The bot gained or lost Speak in the hall (losing it stops what is playing). */
  canSpeak: [canSpeak: boolean];
  /** A frame of what someone said (listening only). */
  audio: [frame: VoiceAudioFrame];
  /** Someone started or stopped speaking (listening only). */
  speaking: [event: VoiceSpeakingEvent];
  error: [error: Error];
}

/** What the voice code needs from the client. */
export interface VoiceHost {
  rest: {
    joinVoice(tavernId: string, channelId: string): Promise<VoiceJoinResponse>;
    leaveVoice(tavernId: string): Promise<unknown>;
  };
  /** The tavern a known channel belongs to. */
  tavernIdForChannel(channelId: string): string | undefined;
  debug(message: string): void;
}

/** An API error with an HTTP status (taverns.js `TavernAPIError` has one). */
interface HttpLikeError extends Error {
  status?: number;
}

// The media library is optional and loaded at run time, so it is typed loosely here.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Rtc = any;

const RTC_MISSING =
  'Voice needs the optional package @livekit/rtc-node. Install it next to taverns.js: npm install @livekit/rtc-node';

/** Load `@livekit/rtc-node`, or explain how to install it. */
export function loadRtc(override?: unknown): Rtc {
  if (override) return override;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@livekit/rtc-node');
  } catch (error) {
    const err = new Error(RTC_MISSING);
    (err as Error & { cause?: unknown }).cause = error;
    throw err;
  }
}

/** The ffmpeg binary to run: explicit, `FFMPEG_PATH`, the `ffmpeg-static` package, or `ffmpeg` on PATH. */
export function resolveFfmpegPath(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bundled = require('ffmpeg-static');
    if (typeof bundled === 'string' && bundled) return bundled;
  } catch {
    // Not installed: fall back to PATH.
  }
  return 'ffmpeg';
}

/** The user id behind a room identity: `<id>:bot` and `<id>:obs` carry it before the colon. */
export function speakerFromIdentity(identity: string): { userId: string; isBot: boolean } {
  if (identity.endsWith(':bot')) return { userId: identity.slice(0, -4), isBot: true };
  if (identity.endsWith(':obs')) return { userId: identity.slice(0, -4), isBot: false };
  return { userId: identity, isBot: false };
}

/** The ffmpeg arguments that turn `input` into 48 kHz stereo s16le on stdout. */
export function ffmpegArgs(input: string | null, options: PlayOptions = {}): string[] {
  const args = ['-hide_banner', '-loglevel', 'error'];
  if (options.seek && options.seek > 0) args.push('-ss', String(options.seek));
  if (input && /^https?:\/\//i.test(input)) {
    args.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5');
  }
  args.push('-i', input ?? 'pipe:0', '-vn');
  if (options.volume !== undefined && options.volume !== 1) {
    if (!Number.isFinite(options.volume) || options.volume < 0) throw new RangeError('volume must be a number >= 0');
    args.push('-af', `volume=${options.volume}`);
  }
  args.push('-f', 's16le', '-acodec', 'pcm_s16le', '-ar', String(VOICE_SAMPLE_RATE), '-ac', String(PUBLISH_CHANNELS), 'pipe:1');
  return args;
}

/** The error play() throws for a bot without Speak in the hall. */
function cannotSpeakError(): Error {
  const error = new Error(
    'This bot cannot play audio in this voice hall: it does not have the Speak permission there ' +
      '(it is connected listen-only). Check connection.canSpeak before playing.',
  );
  (error as Error & { code?: string }).code = 'VOICE_CANNOT_SPEAK';
  return error;
}

// ─── Playback control ───────────────────────────────────────

class Playback {
  stopped = false;
  paused = false;
  private resumeWaiters: Array<() => void> = [];
  private stopHooks: Array<() => void> = [];

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.release();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.paused = false;
    this.release();
    for (const hook of this.stopHooks.splice(0)) {
      try {
        hook();
      } catch {
        // A hook never fails the stop.
      }
    }
  }

  onStop(hook: () => void): void {
    if (this.stopped) hook();
    else this.stopHooks.push(hook);
  }

  /** Resolves at once, or when resumed or stopped. */
  whilePaused(): Promise<void> {
    if (!this.paused || this.stopped) return Promise.resolve();
    return new Promise((resolve) => this.resumeWaiters.push(resolve));
  }

  private release(): void {
    for (const resolve of this.resumeWaiters.splice(0)) resolve();
  }
}

type PcmInput = Readable | AsyncIterable<Uint8Array> | Iterable<Uint8Array> | Uint8Array;

async function* chunksOf(input: PcmInput): AsyncGenerator<Uint8Array> {
  if (input instanceof Uint8Array) {
    yield input;
    return;
  }
  for await (const chunk of input as AsyncIterable<Uint8Array | string>) {
    if (typeof chunk === 'string') throw new TypeError('PCM input must be bytes, not text');
    yield chunk;
  }
}

/** Little-endian bytes to samples (copied, so the source buffer's alignment never matters). */
function toSamples(bytes: Uint8Array): Int16Array {
  const samples = new Int16Array(bytes.length >> 1);
  new Uint8Array(samples.buffer).set(bytes.subarray(0, samples.length * 2));
  return samples;
}

/** Mono to interleaved stereo. */
function upmix(mono: Int16Array): Int16Array {
  const stereo = new Int16Array(mono.length * 2);
  for (let i = 0; i < mono.length; i++) {
    stereo[2 * i] = mono[i];
    stereo[2 * i + 1] = mono[i];
  }
  return stereo;
}

// ─── VoiceConnection ────────────────────────────────────────

/**
 * The bot's place in one voice hall. Get one from `client.voice.join()`.
 *
 * It renews itself before its token expires, and emits `disconnected` once
 * when it ends, with the reason.
 */
export class VoiceConnection extends EventEmitter {
  readonly tavernId: string;
  readonly channelId: string;
  /** The bot's identity in the hall (`<botUserId>:bot`). */
  readonly identity: string;
  /** The hall's room name. */
  readonly room: string;
  /** When the current token expires (renewed automatically). */
  expiresAt: Date;
  /** The bot can hear the hall (Listen in voice halls granted). */
  listening: boolean;
  /** The bot may play here (Speak in the hall). False for a listen-only bot: `play()` throws. */
  canSpeak: boolean;
  state: 'connecting' | 'connected' | 'disconnected' = 'connecting';

  private readonly rtc: Rtc;
  private readonly host: VoiceHost;
  private readonly options: VoiceOptions;
  private readonly onEnded: (connection: VoiceConnection) => void;
  private readonly join: VoiceJoinResponse;
  private roomHandle: Rtc = null;
  private source: Rtc = null;
  private track: Rtc = null;
  private publication: Rtc = null;
  private publishing: Promise<void> | null = null;
  private playback: Playback | null = null;
  private renewTimer: NodeJS.Timeout | null = null;
  private removalTimer: NodeJS.Timeout | null = null;
  private serverReason: VoiceDisconnectReason | null = null;
  private readonly streams = new Map<string, { cancel: () => void }>();
  private speaking = new Set<string>();

  /** @internal Use `client.voice.join()`. */
  constructor(
    rtc: Rtc,
    host: VoiceHost,
    options: VoiceOptions,
    tavernId: string,
    channelId: string,
    join: VoiceJoinResponse,
    onEnded: (connection: VoiceConnection) => void,
  ) {
    super();
    this.rtc = rtc;
    this.host = host;
    this.options = options;
    this.tavernId = tavernId;
    this.channelId = channelId;
    this.join = join;
    this.identity = join.identity;
    this.room = join.room;
    this.expiresAt = new Date(join.expiresAt);
    this.listening = !!join.listening;
    this.canSpeak = join.canSpeak !== false;
    this.onEnded = onEnded;
  }

  /** Something is playing (paused or not). */
  get playing(): boolean {
    return !!this.playback && !this.playback.stopped;
  }

  /** The current playback is paused. */
  get paused(): boolean {
    return !!this.playback?.paused;
  }

  // Type-safe events.
  on<E extends keyof VoiceConnectionEvents>(event: E, listener: (...args: VoiceConnectionEvents[E]) => void): this;
  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }
  once<E extends keyof VoiceConnectionEvents>(event: E, listener: (...args: VoiceConnectionEvents[E]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this {
    return super.once(event, listener);
  }
  emit<E extends keyof VoiceConnectionEvents>(event: E, ...args: VoiceConnectionEvents[E]): boolean;
  emit(event: string, ...args: any[]): boolean {
    // An 'error' with no listener would throw; report it as debug output instead.
    if (event === 'error' && this.listenerCount('error') === 0) {
      this.host.debug(`[Voice] ${(args[0] as Error)?.message ?? args[0]}`);
      return false;
    }
    return super.emit(event, ...args);
  }

  /** @internal Connect to the hall. The audio track is published on the first play. */
  async connect(): Promise<void> {
    const rtc = this.rtc;
    const room = new rtc.Room();
    this.roomHandle = room;
    room.on(rtc.RoomEvent.Disconnected, (reason: unknown) => this.onRoomDisconnected(reason));
    room.on(rtc.RoomEvent.TrackPublished, (publication: Rtc, participant: Rtc) =>
      this.maybeSubscribe(publication, participant),
    );
    room.on(rtc.RoomEvent.TrackSubscribed, (track: Rtc, publication: Rtc, participant: Rtc) =>
      this.startHearing(track, publication, participant),
    );
    room.on(rtc.RoomEvent.TrackUnsubscribed, (_track: Rtc, publication: Rtc) => this.stopHearing(publication?.sid));
    room.on(rtc.RoomEvent.ActiveSpeakersChanged, (speakers: Rtc[]) => this.onSpeakers(speakers));

    // Subscriptions are chosen here (audio only), never automatic. The bot's
    // audio is not end-to-end encrypted; members see that in the apps.
    await room.connect(this.join.url, this.join.token, { autoSubscribe: false, dynacast: false });

    this.state = 'connected';
    this.scheduleRenewal();
    if (this.listening) this.subscribeToAll();
    this.emit('ready');
  }

  /**
   * Play raw PCM: 48 kHz, signed 16-bit little-endian, mono or interleaved
   * stereo. Accepts a stream, an async iterable of chunks, or one buffer.
   * Stops whatever was playing. Resolves when it has played (`'finished'`)
   * or was cut short (`'stopped'`).
   */
  async playPCM(input: PcmInput, options: PlayPcmOptions = {}): Promise<PlaybackResult> {
    const channels = options.channels ?? 2;
    if (channels !== 1 && channels !== 2) throw new RangeError('channels must be 1 or 2');
    this.requireConnected();
    this.requireSpeak();
    this.stop();
    const playback = new Playback();
    this.playback = playback;
    if (typeof (input as Readable).destroy === 'function') {
      playback.onStop(() => (input as Readable).destroy());
    }
    this.emit('playing');
    let result: PlaybackResult = 'stopped';
    try {
      await this.ensurePublished();
      if (!playback.stopped) result = await this.pump(chunksOf(input), channels, playback);
    } finally {
      if (this.playback === playback) this.playback = null;
      playback.stop();
      this.emit('idle', result);
    }
    return result;
  }

  /**
   * Play a file path, an http(s) URL, or a readable stream of any format
   * ffmpeg reads. Never pass text a member typed straight in: ffmpeg can open
   * local files and many protocols. Stops whatever was playing.
   */
  async play(input: string | Readable, options: PlayOptions = {}): Promise<PlaybackResult> {
    this.requireConnected();
    this.requireSpeak();
    const binary = resolveFfmpegPath(options.ffmpegPath ?? this.options.ffmpegPath);
    const args = ffmpegArgs(typeof input === 'string' ? input : null, options);
    const child = spawn(binary, args, { stdio: [typeof input === 'string' ? 'ignore' : 'pipe', 'pipe', 'pipe'] });

    let spawnError: Error | null = null;
    let stderr = '';
    const exited = new Promise<number | null>((resolve) => {
      child.once('error', (error: NodeJS.ErrnoException) => {
        spawnError =
          error.code === 'ENOENT'
            ? new Error(
                `ffmpeg was not found ("${binary}"). Install ffmpeg and put it on your PATH, set FFMPEG_PATH, ` +
                  'pass { ffmpegPath }, or npm install ffmpeg-static.',
              )
            : error;
        resolve(null);
      });
      child.once('close', (code) => resolve(code));
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-2000);
    });
    if (typeof input !== 'string' && child.stdin) {
      child.stdin.on('error', () => undefined); // ffmpeg closing early is not our error
      input.pipe(child.stdin);
    }

    const stopChild = () => {
      if (child.exitCode === null && !child.killed) child.kill();
    };
    let result: PlaybackResult;
    try {
      result = await this.playPCM(child.stdout!, { channels: 2 });
    } finally {
      stopChild();
    }
    const code = await exited;
    if (spawnError) throw spawnError;
    if (result === 'finished' && code !== 0 && code !== null) {
      throw new Error(`ffmpeg exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`);
    }
    return result;
  }

  /** Pause the current playback. Returns false when nothing is playing. */
  pause(): boolean {
    if (!this.playback || this.playback.stopped || this.playback.paused) return false;
    this.playback.pause();
    this.clearQueue();
    this.emit('paused');
    return true;
  }

  /** Resume a paused playback. Returns false when nothing is paused. */
  resume(): boolean {
    if (!this.playback || !this.playback.paused) return false;
    this.playback.resume();
    this.emit('resumed');
    return true;
  }

  /** Stop the current playback (its promise resolves `'stopped'`). */
  stop(): void {
    const playback = this.playback;
    if (!playback) return;
    this.playback = null;
    playback.stop();
    this.clearQueue();
  }

  /** Leave the hall: the bot leaves the room and the hall's member list. */
  async leave(): Promise<void> {
    if (this.state === 'disconnected') return;
    const tavernId = this.tavernId;
    await this.close('left');
    try {
      await this.host.rest.leaveVoice(tavernId);
    } catch (error) {
      this.host.debug(`[Voice] leave ${tavernId}: ${(error as Error).message}`);
    }
  }

  // ─── Internals ──────────────────────────────────────────

  /** @internal A server event about this connection. */
  onServerEvent(event: string, data: Record<string, unknown>): void {
    if (event === 'bot_voice_disconnected') {
      this.serverReason = (data.reason as VoiceDisconnectReason) ?? 'connection_lost';
      void this.close(this.serverReason);
      return;
    }
    if (event === 'bot_voice_updated') {
      if (typeof data.listening === 'boolean') this.applyListening(data.listening);
      if (typeof data.canSpeak === 'boolean') this.applySpeak(data.canSpeak);
    }
  }

  /** @internal End without calling the server (it already knows, or `leave()` tells it). */
  async close(reason: VoiceDisconnectReason): Promise<void> {
    if (this.state === 'disconnected') return;
    this.state = 'disconnected';
    if (this.renewTimer) clearTimeout(this.renewTimer);
    if (this.removalTimer) clearTimeout(this.removalTimer);
    this.renewTimer = null;
    this.removalTimer = null;
    this.stop();
    for (const stream of this.streams.values()) stream.cancel();
    this.streams.clear();
    this.speaking.clear();
    try {
      await this.roomHandle?.disconnect();
    } catch {
      // Already gone.
    }
    try {
      await this.track?.close?.(false);
      await this.source?.close?.();
    } catch {
      // Already closed.
    }
    this.onEnded(this);
    this.emit('disconnected', reason);
  }

  private requireConnected(): void {
    if (this.state !== 'connected') throw new Error('This voice connection is not connected');
  }

  private requireSpeak(): void {
    if (!this.canSpeak) throw cannotSpeakError();
  }

  /** Publish the audio track once (on the first play), if the bot may speak. */
  private async ensurePublished(): Promise<void> {
    if (this.track) return;
    if (!this.publishing) {
      this.publishing = this.publishTrack().finally(() => {
        this.publishing = null;
      });
    }
    await this.publishing;
  }

  private async publishTrack(): Promise<void> {
    const rtc = this.rtc;
    const source = new rtc.AudioSource(VOICE_SAMPLE_RATE, PUBLISH_CHANNELS, SOURCE_QUEUE_MS);
    const track = rtc.LocalAudioTrack.createAudioTrack('taverns-bot-audio', source);
    const publishOptions = new rtc.TrackPublishOptions();
    publishOptions.source = rtc.TrackSource.SOURCE_MICROPHONE;
    publishOptions.dtx = false; // music has quiet passages; keep sending them
    const publication = await this.roomHandle.localParticipant.publishTrack(track, publishOptions);
    if (!this.canSpeak || this.state !== 'connected') {
      // Speak was taken away (or the connection ended) while publishing
      await this.dropTrack(track, source, publication);
      this.requireConnected();
      this.requireSpeak();
    }
    this.source = source;
    this.track = track;
    this.publication = publication;
  }

  /** Unpublish and close a track (the server may already have removed it). */
  private async dropTrack(track: Rtc, source: Rtc, publication: Rtc): Promise<void> {
    try {
      if (publication?.sid) await this.roomHandle?.localParticipant?.unpublishTrack?.(publication.sid);
    } catch {
      // Already unpublished.
    }
    try {
      await track?.close?.(false);
      await source?.close?.();
    } catch {
      // Already closed.
    }
  }

  private applySpeak(canSpeak: boolean): void {
    if (canSpeak === this.canSpeak) return;
    this.canSpeak = canSpeak;
    if (!canSpeak) {
      // The server stops the track; stop playing and let the next play (once
      // Speak is back) publish a new one.
      this.stop();
      const { track, source, publication } = this;
      this.track = null;
      this.source = null;
      this.publication = null;
      void this.dropTrack(track, source, publication);
    }
    this.emit('canSpeak', canSpeak);
  }

  private applyListening(listening: boolean): void {
    if (listening === this.listening) return;
    this.listening = listening;
    this.emit('listening', listening);
    if (listening) {
      this.subscribeToAll();
    } else {
      for (const stream of this.streams.values()) stream.cancel();
      this.streams.clear();
      this.speaking.clear();
    }
  }

  private clearQueue(): void {
    try {
      this.source?.clearQueue?.();
    } catch {
      // Nothing queued.
    }
  }

  private async pump(input: AsyncIterable<Uint8Array>, channels: 1 | 2, playback: Playback): Promise<PlaybackResult> {
    const rtc = this.rtc;
    const source = this.source; // kept: losing Speak drops this.source mid-play
    const frameBytes = SAMPLES_PER_FRAME * channels * 2;
    let pending: Buffer = Buffer.alloc(0);
    const send = async (bytes: Uint8Array) => {
      const samples = toSamples(bytes);
      const stereo = channels === 1 ? upmix(samples) : samples;
      const frame = new rtc.AudioFrame(stereo, VOICE_SAMPLE_RATE, PUBLISH_CHANNELS, SAMPLES_PER_FRAME);
      await source.captureFrame(frame);
    };

    try {
      for await (const chunk of input) {
        if (playback.stopped) break;
        pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk]);
        while (pending.length >= frameBytes) {
          await playback.whilePaused();
          if (playback.stopped || this.state !== 'connected') break;
          const bytes = pending.subarray(0, frameBytes);
          pending = pending.subarray(frameBytes);
          await send(bytes);
        }
        if (playback.stopped || this.state !== 'connected') break;
      }
    } catch (error) {
      // stop() destroys the input, which ends its iterator with an error.
      if (playback.stopped || this.state !== 'connected') return 'stopped';
      throw error;
    }
    if (playback.stopped || this.state !== 'connected') return 'stopped';
    // The last partial frame, padded with silence.
    if (pending.length >= 2) {
      const padded = new Uint8Array(frameBytes);
      padded.set(pending.subarray(0, Math.min(pending.length, frameBytes) & ~1));
      await send(padded);
    }
    await source.waitForPlayout?.();
    return playback.stopped ? 'stopped' : 'finished';
  }

  private scheduleRenewal(): void {
    if (this.renewTimer) clearTimeout(this.renewTimer);
    const wait = Math.max(5_000, this.expiresAt.getTime() - Date.now() - RENEW_BEFORE_MS);
    this.renewTimer = setTimeout(() => void this.renew(), wait);
    this.renewTimer.unref?.();
  }

  private async renew(): Promise<void> {
    if (this.state !== 'connected') return;
    try {
      const answer = await this.host.rest.joinVoice(this.tavernId, this.channelId);
      if (this.state !== 'connected') return;
      this.expiresAt = new Date(answer.expiresAt);
      this.applyListening(!!answer.listening);
      this.applySpeak(answer.canSpeak !== false);
      this.emit('renewed', this.expiresAt);
      this.scheduleRenewal();
    } catch (error) {
      const status = (error as HttpLikeError).status ?? 0;
      if (status === 400 || status === 403 || status === 404) {
        void this.close('renewal_refused');
        return;
      }
      if (Date.now() >= this.expiresAt.getTime() + SESSION_GRACE_MS) {
        void this.close('expired');
        return;
      }
      this.host.debug(`[Voice] renewal failed (${(error as Error).message}); retrying`);
      this.renewTimer = setTimeout(() => void this.renew(), RENEW_RETRY_MS);
      this.renewTimer.unref?.();
    }
  }

  private onRoomDisconnected(reason: unknown): void {
    if (this.state === 'disconnected') return;
    // The server usually says why (a moderator, lost access) a moment later.
    if (this.serverReason) {
      void this.close(this.serverReason);
      return;
    }
    this.removalTimer = setTimeout(() => {
      void this.close(this.serverReason ?? 'connection_lost');
    }, REMOVAL_REASON_WAIT_MS);
    this.removalTimer.unref?.();
    this.host.debug(`[Voice] media connection closed (${String(reason)})`);
  }

  private isHeardSource(source: unknown): VoiceAudioSource | null {
    const sources = this.rtc.TrackSource;
    if (source === sources.SOURCE_MICROPHONE) return 'microphone';
    if (source === sources.SOURCE_SCREENSHARE_AUDIO) return 'screen_share_audio';
    return null;
  }

  private maybeSubscribe(publication: Rtc, _participant: Rtc): void {
    if (!this.listening || this.state === 'disconnected') return;
    // Audio only: microphones and screen-share sound, never cameras or screens.
    if (!this.isHeardSource(publication?.source)) return;
    try {
      publication.setSubscribed(true);
    } catch (error) {
      this.emit('error', error as Error);
    }
  }

  private subscribeToAll(): void {
    const participants: Map<string, Rtc> | undefined = this.roomHandle?.remoteParticipants;
    if (!participants) return;
    for (const participant of participants.values()) {
      for (const publication of participant.trackPublications?.values?.() ?? []) {
        this.maybeSubscribe(publication, participant);
      }
    }
  }

  private startHearing(track: Rtc, publication: Rtc, participant: Rtc): void {
    const source = this.isHeardSource(publication?.source);
    if (!source || !this.listening) {
      try {
        publication?.setSubscribed?.(false);
      } catch {
        // Ignore.
      }
      return;
    }
    const key = publication?.sid ?? `${participant?.identity}:${source}`;
    this.streams.get(key)?.cancel();
    const identity: string = participant?.identity ?? '';
    const { userId, isBot } = speakerFromIdentity(identity);
    const stream = new this.rtc.AudioStream(track, { sampleRate: VOICE_SAMPLE_RATE, numChannels: 1 });
    const iterator: AsyncIterator<Rtc> = stream[Symbol.asyncIterator]();
    let cancelled = false;
    this.streams.set(key, {
      cancel: () => {
        cancelled = true;
        void iterator.return?.();
      },
    });
    void (async () => {
      try {
        while (!cancelled) {
          const next = await iterator.next();
          if (next.done || cancelled) break;
          const frame = next.value;
          this.emit('audio', {
            userId,
            identity,
            isBot,
            source,
            pcm: frame.data,
            sampleRate: frame.sampleRate,
            channels: frame.channels,
            samplesPerChannel: frame.samplesPerChannel,
          });
        }
      } catch (error) {
        if (!cancelled) this.emit('error', error as Error);
      } finally {
        if (this.streams.get(key)?.cancel && cancelled === false) this.streams.delete(key);
      }
    })();
  }

  private stopHearing(sid: string | undefined): void {
    if (!sid) return;
    this.streams.get(sid)?.cancel();
    this.streams.delete(sid);
  }

  private onSpeakers(speakers: Rtc[]): void {
    if (!this.listening) return;
    const now = new Set<string>();
    for (const speaker of speakers ?? []) {
      const identity: string = speaker?.identity ?? '';
      if (!identity || identity === this.identity) continue;
      now.add(identity);
    }
    for (const identity of now) {
      if (!this.speaking.has(identity)) {
        this.emit('speaking', { ...speakerFromIdentity(identity), identity, speaking: true });
      }
    }
    for (const identity of this.speaking) {
      if (!now.has(identity)) {
        this.emit('speaking', { ...speakerFromIdentity(identity), identity, speaking: false });
      }
    }
    this.speaking = now;
  }
}

// ─── VoiceManager ───────────────────────────────────────────

/**
 * `client.voice`: join and leave voice halls. One connection per tavern;
 * joining another hall of the same tavern moves the bot there.
 */
export class VoiceManager {
  private readonly host: VoiceHost;
  private readonly options: VoiceOptions;
  private readonly connections = new Map<string, VoiceConnection>();
  private readonly joining = new Map<string, Promise<VoiceConnection>>();

  /** @internal Created by the Client. */
  constructor(host: VoiceHost, options: VoiceOptions = {}) {
    this.host = host;
    this.options = options;
  }

  /**
   * Join a voice hall and connect. `tavernId` is needed only when the hall
   * is not in the client's channel cache.
   */
  async join(channelId: string, options: { tavernId?: string } = {}): Promise<VoiceConnection> {
    const tavernId = options.tavernId ?? this.host.tavernIdForChannel(channelId);
    if (!tavernId) {
      throw new Error(`Unknown voice hall ${channelId}: pass { tavernId } to voice.join()`);
    }
    const inFlight = this.joining.get(tavernId);
    if (inFlight) await inFlight.catch(() => undefined);

    const current = this.connections.get(tavernId);
    if (current && current.channelId === channelId && current.state === 'connected') return current;

    const attempt = this.connect(tavernId, channelId, current);
    this.joining.set(tavernId, attempt);
    try {
      return await attempt;
    } finally {
      if (this.joining.get(tavernId) === attempt) this.joining.delete(tavernId);
    }
  }

  /** The bot's connection in a tavern, if any. */
  get(tavernId: string): VoiceConnection | undefined {
    return this.connections.get(tavernId);
  }

  /** Every open connection. */
  get all(): VoiceConnection[] {
    return [...this.connections.values()];
  }

  /** Leave the bot's voice hall in a tavern (also tells the server when no connection is open here). */
  async leave(tavernId: string): Promise<void> {
    const connection = this.connections.get(tavernId);
    if (connection) {
      await connection.leave();
      return;
    }
    await this.host.rest.leaveVoice(tavernId);
  }

  /** Leave every voice hall. */
  async destroy(): Promise<void> {
    await Promise.all(this.all.map((connection) => connection.leave()));
  }

  /** @internal Route the server's voice events to their connection. */
  handleGatewayEvent(event: string, data: unknown): void {
    if (event !== 'bot_voice_disconnected' && event !== 'bot_voice_updated') return;
    const payload = (data ?? {}) as Record<string, unknown>;
    const connection = this.connections.get(String(payload.tavernId ?? ''));
    if (!connection || connection.channelId !== payload.channelId) return;
    connection.onServerEvent(event, payload);
  }

  private async connect(tavernId: string, channelId: string, previous?: VoiceConnection): Promise<VoiceConnection> {
    const rtc = loadRtc(this.options.rtc);
    // The server moves the bot; close the old media connection first.
    if (previous && previous.state !== 'disconnected') await previous.close('moved');

    const answer = await this.host.rest.joinVoice(tavernId, channelId);
    const connection = new VoiceConnection(rtc, this.host, this.options, tavernId, channelId, answer, (ended) => {
      if (this.connections.get(tavernId) === ended) this.connections.delete(tavernId);
    });
    this.connections.set(tavernId, connection);
    try {
      await connection.connect();
    } catch (error) {
      await connection.close('connection_lost');
      await this.host.rest.leaveVoice(tavernId).catch(() => undefined);
      throw error;
    }
    this.host.debug(
      `[Voice] joined ${channelId} in ${tavernId} (can speak: ${connection.canSpeak}, listening: ${connection.listening})`,
    );
    return connection;
  }
}
