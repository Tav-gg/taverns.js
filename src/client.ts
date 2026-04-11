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
import {
  BOT_TOKEN_PREFIX,
  FRIENDLY_EVENT_MAP,
  GatewayEvent,
  DEFAULT_API_URL,
  DEFAULT_WS_URL,
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
  InstalledTavern,
  SendMessageOptions,
  EditMessageOptions,
  GetMessagesOptions,
  CreateChannelOptions,
  UpdateChannelOptions,
  Interaction,
  InteractionCallbackData,
} from './types';

// ─── Extended Message with helper methods ────────────────

/** A message enriched with convenience methods. */
export interface ActionableMessage extends Message {
  /** The tavern this message belongs to. */
  tavernId: string;
  /** Reply to this message in the same channel. */
  reply(content: string): Promise<Message>;
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

// ─── Extended Interaction with helper methods ──────────────

/** An interaction enriched with convenience methods. */
export interface ActionableInteraction extends Interaction {
  /** Reply to this interaction. */
  reply(content: string | InteractionCallbackData): Promise<void>;
  /** Acknowledge the interaction and show a loading state. */
  deferReply(): Promise<void>;
  /** Send a follow-up message after replying or deferring. */
  followUp(content: string | InteractionCallbackData): Promise<void>;
}

// ─── Client ─────────────────────────────────────────────────

export class Client extends EventEmitter {
  /** The REST API client used for HTTP requests. */
  readonly rest: RESTClient;

  /** The WebSocket gateway connection. */
  readonly gateway: Gateway;

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
    );

    // Initialize Gateway
    this.gateway = new Gateway({
      token: this.token || '',
      url: options.wsUrl || DEFAULT_WS_URL,
      heartbeatInterval: options.heartbeatInterval || 30_000,
      autoReconnect: options.autoReconnect ?? true,
      maxReconnectAttempts: options.maxReconnectAttempts,
      intents: options.intents,
    });

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
    const channelFetches = this._application.taverns.map(async (installed) => {
      try {
        const channels = await this.rest.getChannels(installed.id);
        for (const channel of channels) {
          channel.tavernId = installed.id;
          this.channels.set(channel.id, channel);
        }
        // Attach channels to the tavern object
        const tavern = this.taverns.get(installed.id);
        if (tavern) {
          tavern.channels = channels;
        }
      } catch (err) {
        this.emit('debug', `Failed to fetch channels for tavern ${installed.id}: ${(err as Error).message}`);
      }
    });
    await Promise.all(channelFetches);

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
    this.gateway.destroy();
    this.taverns.clear();
    this.channels.clear();
    this.memberCache.clear();
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
   * Get messages from a channel.
   */
  async getMessages(tavernId: string, channelId: string, options?: GetMessagesOptions): Promise<Message[]> {
    return this.rest.getMessages(tavernId, channelId, options);
  }

  /**
   * Edit a message.
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
   * Get members of a tavern (with caching).
   */
  async getMembers(tavernId: string, options?: { limit?: number; after?: string }): Promise<Collection<string, Member>> {
    const members = await this.rest.getMembers(tavernId, options);
    const collection = new Collection<string, Member>();
    for (const member of members) {
      collection.set(member.userId, member);
    }
    this.memberCache.set(tavernId, collection);
    return collection;
  }

  /**
   * Get a specific member of a tavern.
   */
  async getMember(tavernId: string, userId: string): Promise<Member> {
    return this.rest.getMember(tavernId, userId);
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

    // Handle incoming gateway events
    this.gateway.on('event', (eventName: string, data: unknown) => {
      this.handleGatewayEvent(eventName, data);
    });
  }

  private handleGatewayEvent(eventName: string, data: unknown): void {
    // Always emit the raw event
    this.emit('raw', eventName, data);

    // Update caches based on events
    this.updateCaches(eventName, data);

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
        this.channels.delete(payload.id as string);
        const tavern = this.taverns.get(payload.tavernId as string);
        if (tavern?.channels) {
          tavern.channels = tavern.channels.filter((c) => c.id !== payload.id);
        }
        break;
      }
      case GatewayEvent.TAVERN_UPDATED: {
        const tavern = this.taverns.get(payload.id as string);
        if (tavern) {
          Object.assign(tavern, payload);
        }
        break;
      }
      case GatewayEvent.BOT_INSTALLED: {
        // New tavern install - add to cache
        const tavernId = payload.tavernId as string;
        if (tavernId && !this.taverns.has(tavernId)) {
          this.taverns.set(tavernId, {
            id: tavernId,
            name: (payload.tavernName as string) || 'Unknown',
            slug: '',
            iconUrl: null,
            memberCount: 0,
            grantedPermissions: payload.grantedPermissions as string,
          });
          // Fetch full tavern data in background
          this.rest.getChannels(tavernId).then((channels) => {
            for (const channel of channels) {
              channel.tavernId = tavernId;
              this.channels.set(channel.id, channel);
            }
            const tavern = this.taverns.get(tavernId);
            if (tavern) tavern.channels = channels;
          }).catch((err) => {
            this.emit('debug', `Failed to fetch channels for new tavern ${tavernId}: ${(err as Error).message}`);
          });
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
        const tavernMembers = this.memberCache.get(payload.tavernId as string);
        if (tavernMembers) {
          const member: Member = {
            id: payload.userId as string,
            userId: payload.userId as string,
            tavernId: payload.tavernId as string,
            status: 'ACTIVE' as any,
            user: {
              id: payload.userId as string,
              displayName: payload.displayName as string,
              avatarUrl: (payload.avatarUrl as string) || null,
              isBot: payload.isBot as boolean,
            },
          };
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
    const tavernId = this.findTavernForChannel(raw.channelId);
    const message = raw as ActionableMessage;
    message.tavernId = tavernId;

    message.reply = async (content: string): Promise<Message> => {
      return this.rest.sendMessage(tavernId, raw.channelId, {
        content,
        replyToId: raw.id,
      });
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
   * Enrich a raw interaction with convenience methods like .reply(), .deferReply(), .followUp().
   */
  private enrichInteraction(raw: Interaction): ActionableInteraction {
    const interaction = raw as ActionableInteraction;

    interaction.reply = async (content: string | InteractionCallbackData): Promise<void> => {
      const data: InteractionCallbackData = typeof content === 'string' ? { content } : content;
      return this.rest.replyToInteraction(raw.id, data);
    };

    interaction.deferReply = async (): Promise<void> => {
      return this.rest.deferInteraction(raw.id);
    };

    interaction.followUp = async (content: string | InteractionCallbackData): Promise<void> => {
      const data: InteractionCallbackData = typeof content === 'string' ? { content } : content;
      return this.rest.followUpInteraction(raw.id, data);
    };

    return interaction;
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
