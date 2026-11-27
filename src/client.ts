/**
 * taverns.js - Client
 *
 * The main entry point for building Tavern bots. Construct with a token,
 * listen for events, and interact with the API.
 *
 * @example
 * ```ts
 * import { Client } from 'taverns.js';
 *
 * const client = new Client({ token: 'tavbot_...' });
 *
 * client.on('ready', () => {
 *   console.log(`Logged in as ${client.user.displayName}`);
 *   console.log(`Connected to ${client.taverns.size} taverns`);
 * });
 *
 * // `content` needs the MESSAGE_CONTENT intent (or a mention of the bot)
 * client.on('messageCreate', (message) => {
 *   if (message.content === '!ping') {
 *     message.reply('Pong!');
 *   }
 * });
 *
 * client.login();
 * ```
 */

import { EventEmitter } from 'events';
import { Collection } from './collection';
import { RESTClient, TavernAPIError } from './rest';
import { Gateway } from './gateway';
import { VoiceManager } from './voice';
import {
  BOT_TOKEN_PREFIX,
  FRIENDLY_EVENT_MAP,
  GatewayAction,
  GatewayEvent,
  DEFAULT_API_URL,
  DEFAULT_WS_URL,
  DMErrorCode,
} from './constants';
import type {
  ClientOptions,
  ClientEvents,
  BotSelf,
  User,
  Tavern,
  Channel,
  Member,
  Message,
  PaginatedMessages,
  InstalledTavern,
  SendMessageOptions,
  EditMessageOptions,
  GetMessagesOptions,
  CreateChannelOptions,
  UpdateChannelOptions,
  Interaction,
  InteractionCallbackData,
  InteractionDeferOptions,
  TypingEvent,
  DmChannel,
  DmMessage,
  DmMessagePage,
  SendDMOptions,
  EditDMOptions,
  GetDMMessagesOptions,
} from './types';

/** How many person-to-DM-channel IDs the client remembers for sendDM(). */
const DM_CHANNEL_CACHE_SIZE = 10_000;

// ─── Extended Message with helper methods ────────────────

/** A message enriched with convenience methods. */
export interface ActionableMessage extends Message {
  /** The tavern this message belongs to. */
  tavernId: string;
  /** Reply to this message in the same channel. */
  reply(content: string | SendMessageOptions): Promise<Message>;
  /** Edit this message (only works for messages sent by the bot). */
  edit(content: string): Promise<Message>;
  /** Delete this message. */
  delete(): Promise<void>;
  /** Pin this message. */
  pin(): Promise<void>;
  /** Unpin this message. */
  unpin(): Promise<void>;
  /** Add a reaction to this message. */
  react(emoji: string): Promise<void>;
}

// ─── Extended direct message with helper methods ─────────

/** A direct message from a person, enriched with convenience methods. */
export interface ActionableDmMessage extends DmMessage {
  /** Reply to this message in the same direct message. */
  reply(content: string | SendDMOptions): Promise<DmMessage>;
}

// ─── Extended Interaction with helper methods ──────────────

/**
 * An interaction enriched with convenience methods. It gets one answer:
 * reply(), or deferReply() and then reply() or followUp() once. To post more,
 * use sendMessage(). An interaction expires after 15 minutes.
 */
export interface ActionableInteraction extends Interaction {
  /** Answer this interaction (once; also after deferReply()). */
  reply(content: string | InteractionCallbackData): Promise<void>;
  /** Acknowledge the interaction and show a loading state; answer it later. */
  deferReply(options?: InteractionDeferOptions): Promise<void>;
  /** Send the answer after deferReply(). Only once, and not after reply(). */
  followUp(content: string | InteractionCallbackData): Promise<void>;
  /** Send a regular message to the channel where the interaction was invoked. */
  sendMessage(options: SendMessageOptions | string): Promise<Message>;
}

// ─── Client ─────────────────────────────────────────────────

export class Client extends EventEmitter {
  /** The REST API client used for HTTP requests. */
  readonly rest: RESTClient;

  /** The WebSocket gateway connection. */
  readonly gateway: Gateway;

  /** Voice halls: `client.voice.join(channelId)` (needs `@livekit/rtc-node`). */
  readonly voice: VoiceManager;

  /** The bot's own user identity. Set after login(). */
  private _user: User | null = null;

  /** The bot application info. Set after login(). */
  private _application: BotSelf | null = null;

  /** Collection of taverns the bot is installed in, keyed by tavern ID. */
  readonly taverns: Collection<string, Tavern> = new Collection();

  /** Collection of all known channels across all taverns, keyed by channel ID. */
  readonly channels: Collection<string, Channel> = new Collection();

  /** Cached members per tavern: Map<tavernId, Collection<userId, Member>> */
  private memberCache = new Map<string, Collection<string, Member>>();

  /** The bot's direct message channel with each person: Map<userId, channelId>. */
  private dmChannels = new Map<string, string>();

  /** createDM() calls in flight, so two sends to one person open one DM. */
  private dmOpens = new Map<string, Promise<DmChannel>>();

  private token: string | null;
  private options: ClientOptions;
  private ready = false;

  constructor(options: ClientOptions = {}) {
    super();
    this.options = options;
    this.token = options.token || null;

    // Initialize REST client
    this.rest = new RESTClient(
      this.token || '',
      options.apiUrl || DEFAULT_API_URL,
      { allowInsecure: options.allowInsecure },
    );

    // Initialize Gateway
    this.gateway = new Gateway({
      token: this.token || '',
      url: options.wsUrl || DEFAULT_WS_URL,
      heartbeatInterval: options.heartbeatInterval || 30_000,
      autoReconnect: options.autoReconnect ?? true,
      maxReconnectAttempts: options.maxReconnectAttempts,
      intents: options.intents,
      allowInsecure: options.allowInsecure,
    });

    // Voice halls
    this.voice = new VoiceManager(
      {
        rest: this.rest,
        tavernIdForChannel: (channelId) => this.findTavernForChannel(channelId) || undefined,
        debug: (message) => this.emit('debug', message),
      },
      options.voice,
    );

    // Wire up gateway events
    this.setupGatewayListeners();
  }

  /**
   * The bot's user identity. Throws if accessed before login().
   */
  get user(): User {
    if (!this._user) {
      throw new Error('Client is not logged in. Call client.login() first.');
    }
    return this._user;
  }

  /**
   * The bot application info. Throws if accessed before login().
   */
  get application(): BotSelf {
    if (!this._application) {
      throw new Error('Client is not logged in. Call client.login() first.');
    }
    return this._application;
  }

  /**
   * Whether the client has completed login and is ready.
   */
  get isReady(): boolean {
    return this.ready;
  }

  /**
   * Log in with the bot token, fetch identity, connect to the gateway,
   * and emit the 'ready' event.
   *
   * @param token - Optional token override (otherwise uses the one from constructor)
   */
  async login(token?: string): Promise<void> {
    if (token) {
      this.token = token;
    }

    if (!this.token) {
      throw new Error('No bot token provided. Pass it to the constructor or login().');
    }

    if (!this.token.startsWith(BOT_TOKEN_PREFIX)) {
      throw new Error(
        `Invalid bot token format. Tokens must start with "${BOT_TOKEN_PREFIX}".`,
      );
    }

    // Update the REST client token
    this.rest.setToken(this.token);

    // Step 1: Fetch bot identity
    this.emit('debug', 'Fetching bot identity...');
    try {
      this._application = await this.rest.getSelf();
      this._user = this._application.user;
    } catch (err) {
      if (err instanceof TavernAPIError && (err.status === 401 || err.status === 403)) {
        throw new Error(`Authentication failed: ${err.message}`);
      }
      throw err;
    }

    // Step 2: Populate taverns cache
    this.emit('debug', `Bot "${this._user.displayName}" has ${this._application.taverns.length} tavern(s)`);
    this.taverns.clear();
    for (const installed of this._application.taverns) {
      this.taverns.set(installed.id, this.installedToTavern(installed));
    }

    // Step 3: Fetch channels for each tavern (parallel, best-effort)
    this.emit('debug', 'Fetching channels for all taverns...');
    await Promise.all(this._application.taverns.map((installed) => this.cacheChannels(installed.id)));

    // Step 4: Connect to the WebSocket gateway
    this.emit('debug', 'Connecting to gateway...');

    // Update gateway token in case it was provided via login() instead of constructor
    this.gateway.setToken(this.token);

    await this.gateway.connect();

    this.ready = true;
    this.emit('ready');
  }

  /**
   * Gracefully disconnect and clean up all resources.
   */
  destroy(): void {
    this.ready = false;
    // Leave every voice hall (best effort; the connections close at once).
    this.voice.destroy().catch(() => undefined);
    this.gateway.destroy();
    this.taverns.clear();
    this.channels.clear();
    this.memberCache.clear();
    this.dmChannels.clear();
    this.dmOpens.clear();
    this._user = null;
    this._application = null;
    this.emit('debug', 'Client destroyed');
    this.removeAllListeners();
  }

  // ─── Type-safe Event Emitter ───────────────────────────

  on<E extends keyof ClientEvents>(event: E, listener: (...args: ClientEvents[E]) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  once<E extends keyof ClientEvents>(event: E, listener: (...args: ClientEvents[E]) => void): this;
  once(event: string, listener: (...args: unknown[]) => void): this;
  once(event: string, listener: (...args: unknown[]) => void): this {
    return super.once(event, listener);
  }

  off<E extends keyof ClientEvents>(event: E, listener: (...args: ClientEvents[E]) => void): this;
  off(event: string, listener: (...args: unknown[]) => void): this;
  off(event: string, listener: (...args: unknown[]) => void): this {
    return super.off(event, listener);
  }

  emit<E extends keyof ClientEvents>(event: E, ...args: ClientEvents[E]): boolean;
  emit(event: string, ...args: unknown[]): boolean;
  emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  // ─── Convenience API Methods ──────────────────────────

  /**
   * Send a message to a channel.
   *
   * @example
   * ```ts
   * await client.sendMessage(tavernId, channelId, { content: 'Hello!' });
   * // Or with reply:
   * await client.sendMessage(tavernId, channelId, {
   *   content: 'Replying!',
   *   replyToId: originalMessageId,
   * });
   * ```
   */
  async sendMessage(tavernId: string, channelId: string, options: SendMessageOptions | string): Promise<Message> {
    const opts: SendMessageOptions = typeof options === 'string' ? { content: options } : options;
    return this.rest.sendMessage(tavernId, channelId, opts);
  }

  /**
   * Get one page of a channel's history, oldest first (`{ messages, hasMore }`).
   */
  async getMessages(tavernId: string, channelId: string, options?: GetMessagesOptions): Promise<PaginatedMessages> {
    return this.rest.getMessages(tavernId, channelId, options);
  }

  /**
   * Edit the text of one of the bot's own messages.
   */
  async editMessage(tavernId: string, messageId: string, options: EditMessageOptions | string): Promise<Message> {
    const opts: EditMessageOptions = typeof options === 'string' ? { content: options } : options;
    return this.rest.editMessage(tavernId, messageId, opts);
  }

  /**
   * Delete a message.
   */
  async deleteMessage(tavernId: string, messageId: string): Promise<void> {
    return this.rest.deleteMessage(tavernId, messageId);
  }

  /**
   * Create a channel in a tavern.
   */
  async createChannel(tavernId: string, options: CreateChannelOptions): Promise<Channel> {
    const channel = await this.rest.createChannel(tavernId, options);
    channel.tavernId = tavernId;
    this.channels.set(channel.id, channel);
    return channel;
  }

  /**
   * Update a channel.
   */
  async updateChannel(tavernId: string, channelId: string, options: UpdateChannelOptions): Promise<Channel> {
    const channel = await this.rest.updateChannel(tavernId, channelId, options);
    channel.tavernId = tavernId;
    this.channels.set(channel.id, channel);
    return channel;
  }

  /**
   * Delete a channel.
   */
  async deleteChannel(tavernId: string, channelId: string): Promise<void> {
    await this.rest.deleteChannel(tavernId, channelId);
    this.channels.delete(channelId);
  }

  /**
   * Get every member of a tavern, keyed by user ID (the API has no pages).
   * The result is cached and kept up to date by memberJoin and memberLeave
   * (with the TAVERN_MEMBERS intent).
   */
  async getMembers(tavernId: string): Promise<Collection<string, Member>> {
    const members = await this.rest.getMembers(tavernId);
    const collection = new Collection<string, Member>();
    for (const member of members) {
      member.tavernId = tavernId;
      collection.set(member.userId, member);
    }
    this.memberCache.set(tavernId, collection);
    return collection;
  }

  /**
   * Get one member of a tavern (a person or a bot) by user ID.
   */
  async getMember(tavernId: string, userId: string): Promise<Member> {
    const member = await this.rest.getMember(tavernId, userId);
    if (member) {
      member.tavernId = tavernId;
      this.memberCache.get(tavernId)?.set(member.userId, member);
    }
    return member;
  }

  // ─── Member Moderation ────────────────────────────────
  // Require the matching granted permission (KICK_MEMBERS / BAN_MEMBERS /
  // MUTE_MEMBERS). The tavern owner is immune to all three — the API rejects
  // any attempt to kick, ban, or mute the owner.

  /** Kick a member from a tavern (requires KICK_MEMBERS). */
  async kickMember(tavernId: string, userId: string, reason?: string): Promise<void> {
    return this.rest.kickMember(tavernId, userId, reason);
  }

  /** Ban a member from a tavern (requires BAN_MEMBERS). */
  async banMember(
    tavernId: string,
    userId: string,
    options?: { reason?: string; deleteMessageSeconds?: number; auto?: boolean },
  ): Promise<void> {
    return this.rest.banMember(tavernId, userId, options);
  }

  /** Unban a member from a tavern (requires BAN_MEMBERS). */
  async unbanMember(tavernId: string, userId: string): Promise<void> {
    return this.rest.unbanMember(tavernId, userId);
  }

  /** Mute/timeout a member (requires MUTE_MEMBERS). */
  async muteMember(
    tavernId: string,
    userId: string,
    options?: {
      reason?: string;
      durationMinutes?: number;
      type?: 'TIMEOUT' | 'VOICE';
      scope?: 'SERVER' | 'VOICE' | 'HALLS';
      channelIds?: string[];
    },
  ): Promise<void> {
    return this.rest.muteMember(tavernId, userId, options);
  }

  /** Remove an active mute from a member (requires MUTE_MEMBERS). */
  async unmuteMember(tavernId: string, userId: string): Promise<void> {
    return this.rest.unmuteMember(tavernId, userId);
  }

  /**
   * Show the bot as typing in a channel. It shows for about 8 seconds; send it
   * again to keep it, or call stopTyping().
   */
  startTyping(tavernId: string, channelId: string): void {
    this.gateway.send(GatewayAction.TYPING_START, { tavernId, channelId });
  }

  /** Stop showing the bot as typing in a channel. */
  stopTyping(tavernId: string, channelId: string): void {
    this.gateway.send(GatewayAction.TYPING_STOP, { tavernId, channelId });
  }

  // ─── Direct Messages ──────────────────────────────────
  // The bot may message a person who is in a tavern where the bot is installed
  // and turned on, and who allows it (or wrote to the bot in the last 24 hours).
  // Anything else rejects with TavernAPIError, code 'CANNOT_DM_USER'. Hitting a
  // DM limit rejects with RateLimitError ({ scope, retryAfter }); the SDK does
  // not resend those for you.

  /**
   * Open the bot's direct message with a person (or get the existing one).
   * The channel ID is remembered, so sendDM() to the same person does not open
   * it again.
   */
  async createDM(userId: string): Promise<DmChannel> {
    const pending = this.dmOpens.get(userId);
    if (pending) return pending;
    const open = this.rest.createDM(userId).then((channel) => {
      this.rememberDMChannel(userId, channel.id);
      return channel;
    });
    this.dmOpens.set(userId, open);
    try {
      return await open;
    } finally {
      this.dmOpens.delete(userId);
    }
  }

  /**
   * Send a direct message to a person. Opens the DM the first time, then
   * reuses the channel.
   *
   * @example
   * ```ts
   * await client.sendDM(userId, 'Your order is ready!');
   * await client.sendDM(userId, { content: 'Your stats:', embeds: [embed] });
   * ```
   */
  async sendDM(userId: string, content: string | SendDMOptions): Promise<DmMessage> {
    const options: SendDMOptions = typeof content === 'string' ? { content } : content;
    const known = this.dmChannels.get(userId);
    if (known) {
      try {
        return await this.rest.sendDMMessage(known, options);
      } catch (err) {
        // The remembered channel is gone: open the DM again, once.
        if (!(err instanceof TavernAPIError) || err.code !== DMErrorCode.DM_CHANNEL_NOT_FOUND) throw err;
        this.dmChannels.delete(userId);
      }
    }
    const channel = await this.createDM(userId);
    return this.rest.sendDMMessage(channel.id, options);
  }

  /** Send a message in a direct message the bot already has open. */
  async sendDMMessage(channelId: string, content: string | SendDMOptions): Promise<DmMessage> {
    const options: SendDMOptions = typeof content === 'string' ? { content } : content;
    return this.rest.sendDMMessage(channelId, options);
  }

  /** Get one of the bot's direct messages. */
  async getDMChannel(channelId: string): Promise<DmChannel> {
    const channel = await this.rest.getDMChannel(channelId);
    if (channel?.recipient?.id) this.rememberDMChannel(channel.recipient.id, channel.id);
    return channel;
  }

  /** Get messages from a direct message, oldest first. */
  async getDMMessages(channelId: string, options?: GetDMMessagesOptions): Promise<DmMessagePage> {
    return this.rest.getDMMessages(channelId, options);
  }

  /** Edit one of the bot's own messages in a direct message. */
  async editDMMessage(channelId: string, messageId: string, content: string | EditDMOptions): Promise<DmMessage> {
    const options: EditDMOptions = typeof content === 'string' ? { content } : content;
    return this.rest.editDMMessage(channelId, messageId, options);
  }

  /** Delete one of the bot's own messages in a direct message. */
  async deleteDMMessage(channelId: string, messageId: string): Promise<void> {
    return this.rest.deleteDMMessage(channelId, messageId);
  }

  private rememberDMChannel(userId: string, channelId: string): void {
    this.dmChannels.delete(userId); // re-insert as the newest entry
    this.dmChannels.set(userId, channelId);
    if (this.dmChannels.size > DM_CHANNEL_CACHE_SIZE) {
      const oldest = this.dmChannels.keys().next().value;
      if (oldest !== undefined) this.dmChannels.delete(oldest);
    }
  }

  // ─── Gateway Event Wiring ─────────────────────────────

  private setupGatewayListeners(): void {
    // Forward gateway lifecycle events
    this.gateway.on('debug', (msg: string) => {
      this.emit('debug', `[Gateway] ${msg}`);
    });

    this.gateway.on('error', (err: Error) => {
      this.emit('error', err);
    });

    this.gateway.on('close', (code: number, reason: string) => {
      this.emit('disconnected', code, reason);
    });

    this.gateway.on('reconnecting', (attempt: number) => {
      this.emit('reconnecting', attempt);
    });

    this.gateway.on('reconnected', () => {
      this.emit('debug', 'Reconnected to gateway');
      // Re-emit ready so the bot knows it can resume
      this.emit('ready');
    });

    this.gateway.on('reconnectFailed', () => {
      this.ready = false;
      this.emit('error', new Error('Failed to reconnect to gateway after maximum attempts'));
    });

    // The token was refused (revoked, regenerated or the bot was disabled): the
    // gateway has stopped reconnecting.
    this.gateway.on('authFailed', (err: Error) => {
      this.ready = false;
      this.emit('error', err);
    });

    // Handle incoming gateway events
    this.gateway.on('event', (eventName: string, data: unknown) => {
      this.handleGatewayEvent(eventName, data);
    });
  }

  private handleGatewayEvent(eventName: string, data: unknown): void {
    // Always emit the raw event
    this.emit('raw', eventName, data);

    // The bot's own voice connections
    this.voice.handleGatewayEvent(eventName, data);

    // Update caches based on events
    this.updateCaches(eventName, data);

    // One wire event for both: `isTyping` says which
    if (eventName === GatewayEvent.TYPING_INDICATOR) {
      const typing = data as TypingEvent;
      this.emit(typing?.isTyping === false ? 'typingStop' : 'typingStart', typing);
      return;
    }

    // Map to friendly event name and emit
    const friendlyName = FRIENDLY_EVENT_MAP[eventName];
    if (friendlyName) {
      // For messageCreate, enrich the message with helper methods
      if (friendlyName === 'messageCreate') {
        const message = this.enrichMessage(data as Message);
        this.emit(friendlyName, message);
      } else if (friendlyName === 'interactionCreate') {
        const interaction = this.enrichInteraction(data as Interaction);
        this.emit(friendlyName, interaction);
      } else if (friendlyName === 'dmMessageCreate') {
        this.emit(friendlyName, this.enrichDmMessage(data as DmMessage));
      } else {
        this.emit(friendlyName, data);
      }
    } else {
      // Emit unknown events as-is (for future event support)
      this.emit(eventName, data);
    }
  }

  /**
   * Update internal caches based on gateway events.
   */
  private updateCaches(eventName: string, data: unknown): void {
    const payload = data as Record<string, unknown>;

    switch (eventName) {
      case GatewayEvent.CHANNEL_CREATED: {
        const channel = payload as unknown as Channel;
        if (channel.id && channel.tavernId) {
          this.channels.set(channel.id, channel);
          const tavern = this.taverns.get(channel.tavernId);
          if (tavern?.channels) {
            tavern.channels.push(channel);
          }
        }
        break;
      }
      case GatewayEvent.CHANNEL_UPDATED: {
        const existing = this.channels.get(payload.id as string);
        if (existing) {
          Object.assign(existing, payload);
        }
        break;
      }
      case GatewayEvent.CHANNEL_DELETED: {
        const channelId = (payload.channelId ?? payload.id) as string;
        this.channels.delete(channelId);
        const tavern = this.taverns.get(payload.tavernId as string);
        if (tavern?.channels) {
          tavern.channels = tavern.channels.filter((c) => c.id !== channelId);
        }
        break;
      }
      case GatewayEvent.TAVERN_UPDATED: {
        const tavern = this.taverns.get((payload.id ?? payload.tavernId) as string);
        if (tavern) {
          Object.assign(tavern, payload);
        }
        break;
      }
      case GatewayEvent.BOT_INSTALLED: {
        // New tavern install (or installed again) - add to cache
        const tavernId = payload.tavernId as string;
        if (!tavernId) break;
        const known = this.taverns.get(tavernId);
        const name = typeof payload.tavernName === 'string' && payload.tavernName ? payload.tavernName : undefined;
        if (known) {
          if (name) known.name = name;
          known.grantedPermissions = payload.grantedPermissions as string;
        } else {
          this.taverns.set(tavernId, {
            id: tavernId,
            name: name ?? 'Unknown',
            slug: '',
            iconUrl: null,
            memberCount: 0,
            grantedPermissions: payload.grantedPermissions as string,
          });
        }
        // Fetch its channels in the background
        void this.cacheChannels(tavernId);
        break;
      }
      case GatewayEvent.BOT_PERMISSIONS_UPDATED: {
        const tavern = this.taverns.get(payload.tavernId as string);
        if (tavern && typeof payload.grantedPermissions === 'string') {
          tavern.grantedPermissions = payload.grantedPermissions;
        }
        break;
      }
      case GatewayEvent.BOT_REMOVED: {
        const removedTavernId = payload.tavernId as string;
        this.taverns.delete(removedTavernId);
        // Remove channels for this tavern
        for (const [id, channel] of this.channels) {
          if (channel.tavernId === removedTavernId) {
            this.channels.delete(id);
          }
        }
        this.memberCache.delete(removedTavernId);
        break;
      }
      case GatewayEvent.MEMBER_JOINED: {
        // `{ tavernId, user, member }`: `member` is the new member's row
        const tavernMembers = this.memberCache.get(payload.tavernId as string);
        const member = payload.member as Member | undefined;
        if (tavernMembers && member?.userId) {
          member.tavernId = payload.tavernId as string;
          tavernMembers.set(member.userId, member);
        }
        // Update member count
        const tavern = this.taverns.get(payload.tavernId as string);
        if (tavern) tavern.memberCount++;
        break;
      }
      case GatewayEvent.MEMBER_LEFT: {
        const tavernMembersLeave = this.memberCache.get(payload.tavernId as string);
        if (tavernMembersLeave) {
          tavernMembersLeave.delete(payload.userId as string);
        }
        const tavernLeave = this.taverns.get(payload.tavernId as string);
        if (tavernLeave && tavernLeave.memberCount > 0) tavernLeave.memberCount--;
        break;
      }
    }
  }

  /**
   * Enrich a raw message with convenience methods like .reply(), .edit(), .delete().
   */
  private enrichMessage(raw: Message): ActionableMessage {
    // Every tavern event names its tavern; the channel cache is the fallback.
    const tavernId = raw.tavernId || this.findTavernForChannel(raw.channelId);
    const message = raw as ActionableMessage;
    message.tavernId = tavernId;

    message.reply = async (content: string | SendMessageOptions): Promise<Message> => {
      const opts: SendMessageOptions = typeof content === 'string'
        ? { content, replyToId: raw.id }
        : { ...content, replyToId: raw.id };
      return this.rest.sendMessage(tavernId, raw.channelId, opts);
    };

    message.edit = async (content: string): Promise<Message> => {
      return this.rest.editMessage(tavernId, raw.id, { content });
    };

    message.delete = async (): Promise<void> => {
      return this.rest.deleteMessage(tavernId, raw.id);
    };

    message.pin = async (): Promise<void> => {
      return this.rest.pinMessage(tavernId, raw.id);
    };

    message.unpin = async (): Promise<void> => {
      return this.rest.unpinMessage(tavernId, raw.id);
    };

    message.react = async (emoji: string): Promise<void> => {
      return this.rest.addReaction(tavernId, raw.id, emoji);
    };

    return message;
  }

  /**
   * Enrich a direct message from a person with .reply(), and remember the
   * person's DM channel for sendDM().
   */
  private enrichDmMessage(raw: DmMessage): ActionableDmMessage {
    const message = raw as ActionableDmMessage;
    if (raw?.sender?.id && raw.channelId && !raw.sender.isBot) {
      this.rememberDMChannel(raw.sender.id, raw.channelId);
    }

    message.reply = async (content: string | SendDMOptions): Promise<DmMessage> => {
      const opts: SendDMOptions = typeof content === 'string'
        ? { content, replyToId: raw.id }
        : { ...content, replyToId: raw.id };
      return this.rest.sendDMMessage(raw.channelId, opts);
    };

    return message;
  }

  /**
   * Enrich a raw interaction with convenience methods like .reply(), .deferReply(), .followUp().
   */
  private enrichInteraction(raw: Interaction): ActionableInteraction {
    const interaction = raw as ActionableInteraction;

    interaction.reply = async (content: string | InteractionCallbackData): Promise<void> => {
      const data: InteractionCallbackData = typeof content === 'string' ? { content } : content;
      return this.rest.replyToInteraction(raw.id, data);
    };

    interaction.deferReply = async (options?: InteractionDeferOptions): Promise<void> => {
      return this.rest.deferInteraction(raw.id, options);
    };

    interaction.followUp = async (content: string | InteractionCallbackData): Promise<void> => {
      const data: InteractionCallbackData = typeof content === 'string' ? { content } : content;
      return this.rest.followUpInteraction(raw.id, data);
    };

    interaction.sendMessage = async (options: SendMessageOptions | string): Promise<Message> => {
      const opts: SendMessageOptions = typeof options === 'string' ? { content: options } : options;
      return this.rest.sendMessage(raw.tavernId, raw.channelId, opts);
    };

    return interaction;
  }

  /**
   * Fetch a tavern's channels and categories into the cache (best effort).
   */
  private async cacheChannels(tavernId: string): Promise<void> {
    try {
      const { channels, categories } = await this.rest.getChannelList(tavernId);
      for (const channel of channels) {
        channel.tavernId = tavernId;
        this.channels.set(channel.id, channel);
      }
      const tavern = this.taverns.get(tavernId);
      if (tavern) {
        tavern.channels = channels;
        tavern.categories = categories;
      }
    } catch (err) {
      this.emit('debug', `Failed to fetch channels for tavern ${tavernId}: ${(err as Error).message}`);
    }
  }

  /**
   * Find the tavern that owns a channel by checking the channels cache.
   */
  private findTavernForChannel(channelId: string): string {
    const channel = this.channels.get(channelId);
    if (channel?.tavernId) return channel.tavernId;

    // Fallback: search tavern channel lists
    for (const [tavernId, tavern] of this.taverns) {
      if (tavern.channels?.some((c) => c.id === channelId)) {
        return tavernId;
      }
    }

    // Last resort: return empty string (the API call will fail with a clear error)
    return '';
  }

  /**
   * Convert an InstalledTavern (from @me response) to the Tavern cache format.
   */
  private installedToTavern(installed: InstalledTavern): Tavern {
    return {
      id: installed.id,
      name: installed.name,
      slug: installed.slug,
      iconUrl: installed.iconUrl,
      memberCount: installed.memberCount,
      grantedPermissions: installed.grantedPermissions,
      installedAt: installed.installedAt,
    };
  }
}
