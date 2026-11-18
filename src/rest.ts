/**
 * taverns.js - REST Client
 *
 * HTTP client for the Taverns API.
 * Handles bot token authentication, rate limiting, and retries.
 */

import { EventEmitter } from 'events';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { DEFAULT_API_URL } from './constants';
import { checkBaseUrl, route } from './url';
import type {
  BotSelf,
  InstalledTavern,
  Tavern,
  Channel,
  Member,
  Role,
  Message,
  SendMessageOptions,
  EditMessageOptions,
  GetMessagesOptions,
  SearchMessagesOptions,
  CreateChannelOptions,
  UpdateChannelOptions,
  CreateRoleOptions,
  UpdateRoleOptions,
  BotCommand,
  InteractionCallbackData,
  DmChannel,
  DmMessage,
  DmMessagePage,
  SendDMOptions,
  EditDMOptions,
  GetDMMessagesOptions,
} from './types';
import type { VoiceJoinResponse } from './voice';

// ─── Rate Limit Tracking ────────────────────────────────────

interface RateLimitBucket {
  limit: number;
  remaining: number;
  reset: number; // epoch ms
  retryAfter?: number;
}

interface RequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

export interface RESTClientOptions {
  /**
   * Accept a plain http:// API URL. The bot token is then sent unencrypted,
   * so use this for local development only. Default: false.
   */
  allowInsecure?: boolean;
}

// ─── Retries ────────────────────────────────────────────────

/** Retries after a 429 (the API did not act on the request; any method). */
const MAX_RATE_LIMIT_RETRIES = 5;
/** Retries after a server error or a connection failure. */
const MAX_ERROR_RETRIES = 3;

/**
 * Methods that are sent again after a server error (5xx) or a lost connection,
 * when the first attempt may already have reached the API. Reading is harmless
 * and the API's PUT routes set or replace a value. POST, PATCH and DELETE are
 * not repeated then: a second POST could post a message or ban someone twice,
 * and a repeated DELETE (a kick, an unban) fails with 404 although the first
 * one worked.
 */
const REPEATABLE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT']);

/** Error codes for a host name that did not resolve or a refused connection. */
const NOT_SENT_CODES: ReadonlySet<string> = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

/**
 * True when a request error proves the request was never sent: the host name
 * did not resolve or the server refused the connection. Node reports a failed
 * connection to several addresses as one error with an `errors` list; every
 * attempt in it must match.
 *
 * @internal Exported for the tests.
 */
export function isNotSentError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, errors } = error as { code?: unknown; errors?: unknown };
  if (Array.isArray(errors) && errors.length > 0) {
    return errors.every((inner) => isNotSentError(inner));
  }
  return typeof code === 'string' && NOT_SENT_CODES.has(code);
}

export class RESTClient extends EventEmitter {
  private token: string;
  private baseUrl: string;
  private buckets = new Map<string, RateLimitBucket>();
  private globalRateLimit: number | null = null;

  /**
   * IDs passed to the helper methods are escaped as single path segments, so
   * user input cannot change the route. The low-level get/post/patch/put/delete
   * methods send the path you give them as is.
   *
   * Retries: a request answered with 429 is sent again after the wait the API
   * asks for. After a server error (5xx) or a dropped connection, only GET and
   * PUT requests are sent again. POST, PATCH and DELETE requests are sent again
   * only when the connection could not be opened at all, so a message, a kick
   * or a ban is never sent twice. A request over a direct message limit is not
   * sent again: it rejects at once with RateLimitError (see `scope`).
   */
  constructor(token: string, baseUrl: string = DEFAULT_API_URL, options: RESTClientOptions = {}) {
    super();
    checkBaseUrl(baseUrl, 'api', options.allowInsecure ?? false);
    this.token = token;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /** Update the bot token (used when login() provides a new token). */
  setToken(token: string): void {
    this.token = token;
  }

  // ─── Core HTTP Methods ──────────────────────────────────

  async get<T = unknown>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    return this.request<T>({ method: 'GET', path, query });
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: 'POST', path, body });
  }

  async patch<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: 'PATCH', path, body });
  }

  async put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: 'PUT', path, body });
  }

  async delete<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: 'DELETE', path, body });
  }

  // ─── Bot Identity ──────────────────────────────────────

  /** Get the bot's own profile and installed taverns. */
  async getSelf(): Promise<BotSelf> {
    return this.get<BotSelf>('/bots/@me');
  }

  /** Get the list of taverns the bot is installed in. */
  async getMyTaverns(): Promise<InstalledTavern[]> {
    return this.get<InstalledTavern[]>('/bots/@me/taverns');
  }

  // ─── Taverns ───────────────────────────────────────────

  /** Get a tavern by ID. */
  async getTavern(tavernId: string): Promise<Tavern> {
    return this.get<Tavern>(route`/taverns/${tavernId}`);
  }

  // ─── Channels ──────────────────────────────────────────

  /** List all channels in a tavern. */
  async getChannels(tavernId: string): Promise<Channel[]> {
    return this.get<Channel[]>(route`/taverns/${tavernId}/channels`);
  }

  /** Create a new channel in a tavern. */
  async createChannel(tavernId: string, options: CreateChannelOptions): Promise<Channel> {
    return this.post<Channel>(route`/taverns/${tavernId}/channels`, options);
  }

  /** Update a channel. */
  async updateChannel(tavernId: string, channelId: string, options: UpdateChannelOptions): Promise<Channel> {
    return this.patch<Channel>(route`/taverns/${tavernId}/channels/${channelId}`, options);
  }

  /** Delete a channel. */
  async deleteChannel(tavernId: string, channelId: string): Promise<void> {
    await this.delete(route`/taverns/${tavernId}/channels/${channelId}`);
  }

  // ─── Messages ──────────────────────────────────────────

  /** Send a message to a channel. */
  async sendMessage(tavernId: string, channelId: string, options: SendMessageOptions): Promise<Message> {
    return this.post<Message>(route`/taverns/${tavernId}/channels/${channelId}/messages`, options);
  }

  /** Get messages from a channel. */
  async getMessages(tavernId: string, channelId: string, options?: GetMessagesOptions): Promise<Message[]> {
    const query: Record<string, string | number | undefined> = {};
    if (options?.limit) query.limit = options.limit;
    if (options?.before) query.before = options.before;
    if (options?.after) query.after = options.after;
    return this.get<Message[]>(route`/taverns/${tavernId}/channels/${channelId}/messages`, query);
  }

  /** Edit a message. */
  async editMessage(tavernId: string, messageId: string, options: EditMessageOptions): Promise<Message> {
    return this.patch<Message>(route`/taverns/${tavernId}/messages/${messageId}`, options);
  }

  /** Delete a message. */
  async deleteMessage(tavernId: string, messageId: string): Promise<void> {
    await this.delete(route`/taverns/${tavernId}/messages/${messageId}`);
  }

  /** Pin a message. */
  async pinMessage(tavernId: string, messageId: string): Promise<void> {
    await this.post(route`/taverns/${tavernId}/messages/${messageId}/pin`);
  }

  /** Unpin a message. */
  async unpinMessage(tavernId: string, messageId: string): Promise<void> {
    await this.delete(route`/taverns/${tavernId}/messages/${messageId}/pin`);
  }

  /** Get pinned messages in a channel. */
  async getPinnedMessages(tavernId: string, channelId: string): Promise<Message[]> {
    return this.get<Message[]>(route`/taverns/${tavernId}/channels/${channelId}/pins`);
  }

  /** Search messages in a tavern or specific channel. */
  async searchMessages(tavernId: string, options: SearchMessagesOptions): Promise<{ messages: Message[]; total: number }> {
    const query: Record<string, string | number | undefined> = {
      query: options.query,
    };
    if (options.senderId) query.senderId = options.senderId;
    if (options.limit) query.limit = options.limit;
    if (options.offset) query.offset = options.offset;

    if (options.channelId) {
      return this.get(route`/taverns/${tavernId}/channels/${options.channelId}/messages/search`, query);
    }
    return this.get(route`/taverns/${tavernId}/messages/search`, query);
  }

  /** Add a reaction to a message. */
  async addReaction(tavernId: string, messageId: string, emoji: string): Promise<void> {
    await this.post(route`/taverns/${tavernId}/messages/${messageId}/reactions`, { emoji });
  }

  /** Remove a reaction from a message. */
  async removeReaction(tavernId: string, messageId: string, emoji: string): Promise<void> {
    await this.delete(route`/taverns/${tavernId}/messages/${messageId}/reactions/${emoji}`);
  }

  /** Bulk delete messages in a channel. */
  async bulkDeleteMessages(tavernId: string, channelId: string, messageIds: string[]): Promise<void> {
    await this.post(route`/taverns/${tavernId}/channels/${channelId}/messages/bulk-delete`, { messageIds });
  }

  // ─── Members ───────────────────────────────────────────

  /** List members of a tavern. */
  async getMembers(tavernId: string, options?: { limit?: number; after?: string }): Promise<Member[]> {
    const query: Record<string, string | number | undefined> = {};
    if (options?.limit) query.limit = options.limit;
    if (options?.after) query.after = options.after;
    return this.get<Member[]>(route`/taverns/${tavernId}/members`, query);
  }

  /** Get a specific member. */
  async getMember(tavernId: string, userId: string): Promise<Member> {
    return this.get<Member>(route`/taverns/${tavernId}/members/${userId}`);
  }

  /**
   * Kick a member from a tavern. Requires the bot to have KICK_MEMBERS.
   * The tavern owner can never be kicked.
   */
  async kickMember(tavernId: string, userId: string, reason?: string): Promise<void> {
    await this.delete(route`/taverns/${tavernId}/members/${userId}`, reason ? { reason } : undefined);
  }

  /**
   * Ban a member from a tavern. Requires the bot to have BAN_MEMBERS.
   * The tavern owner can never be banned.
   */
  async banMember(
    tavernId: string,
    userId: string,
    options?: { reason?: string; deleteMessageSeconds?: number; auto?: boolean },
  ): Promise<void> {
    await this.post(route`/taverns/${tavernId}/bans`, { userId, ...options });
  }

  /** Unban a member from a tavern. */
  async unbanMember(tavernId: string, userId: string): Promise<void> {
    await this.delete(route`/taverns/${tavernId}/bans/${userId}`);
  }

  /**
   * Mute (timeout) a member. Requires the bot to have MUTE_MEMBERS.
   * `durationMinutes` omitted = permanent. The tavern owner can never be muted.
   */
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
    await this.post(route`/taverns/${tavernId}/mutes`, { userId, ...options });
  }

  /** Remove an active mute from a member. */
  async unmuteMember(tavernId: string, userId: string): Promise<void> {
    await this.delete(route`/taverns/${tavernId}/mutes/${userId}`);
  }

  // ─── Roles ─────────────────────────────────────────────

  /** List roles in a tavern. */
  async getRoles(tavernId: string): Promise<Role[]> {
    return this.get<Role[]>(route`/taverns/${tavernId}/roles`);
  }

  /** Create a new role in a tavern. */
  async createRole(tavernId: string, options: CreateRoleOptions): Promise<Role> {
    return this.post<Role>(route`/taverns/${tavernId}/roles`, options);
  }

  /** Update a role. */
  async updateRole(tavernId: string, roleId: string, options: UpdateRoleOptions): Promise<Role> {
    return this.patch<Role>(route`/taverns/${tavernId}/roles/${roleId}`, options);
  }

  /** Delete a role. */
  async deleteRole(tavernId: string, roleId: string): Promise<void> {
    await this.delete(route`/taverns/${tavernId}/roles/${roleId}`);
  }

  /** Add a role to a member. */
  async addMemberRole(tavernId: string, userId: string, roleId: string): Promise<void> {
    await this.post(route`/taverns/${tavernId}/members/${userId}/roles/${roleId}`);
  }

  /** Remove a role from a member. */
  async removeMemberRole(tavernId: string, userId: string, roleId: string): Promise<void> {
    await this.delete(route`/taverns/${tavernId}/members/${userId}/roles/${roleId}`);
  }

  // ─── Threads ───────────────────────────────────────────

  /** Create a thread in a channel. */
  async createThread(
    tavernId: string,
    channelId: string,
    options: { name: string; rootMessageId?: string; starterMessage?: string; autoArchiveDuration?: number; isPrivate?: boolean },
  ): Promise<Channel> {
    return this.post<Channel>(route`/taverns/${tavernId}/channels/${channelId}/threads`, options);
  }

  /** List threads in a channel. */
  async getThreads(tavernId: string, channelId: string): Promise<Channel[]> {
    return this.get<Channel[]>(route`/taverns/${tavernId}/channels/${channelId}/threads`);
  }

  /** Get active threads across the tavern. */
  async getActiveThreads(tavernId: string): Promise<Channel[]> {
    return this.get<Channel[]>(route`/taverns/${tavernId}/active-threads`);
  }

  // ─── Bot Commands (Slash Commands) ─────────────────────

  /** Register or overwrite all slash commands for this bot. */
  async registerCommands(commands: Omit<BotCommand, 'id' | 'version'>[]): Promise<BotCommand[]> {
    const result = await this.put<BotCommand[]>('/bots/@me/commands', commands);
    return result ?? [];
  }

  /** Get all registered commands for this bot. */
  async getCommands(): Promise<BotCommand[]> {
    return this.get<BotCommand[]>('/bots/@me/commands');
  }

  /** Delete a registered command by ID. */
  async deleteCommand(commandId: string): Promise<void> {
    await this.delete(route`/bots/@me/commands/${commandId}`);
  }

  // ─── Voice ─────────────────────────────────────────────

  /**
   * Join (or renew) a voice hall. Returns the media connection details; most
   * bots use `client.voice.join()` instead, which connects and renews for you.
   */
  async joinVoice(tavernId: string, channelId: string): Promise<VoiceJoinResponse> {
    return this.post<VoiceJoinResponse>(route`/bots/@me/taverns/${tavernId}/voice/${channelId}/join`);
  }

  /** Leave the bot's voice hall in a tavern. */
  async leaveVoice(tavernId: string): Promise<{ success: boolean; left: boolean }> {
    return this.post<{ success: boolean; left: boolean }>(route`/bots/@me/taverns/${tavernId}/voice/leave`);
  }

  // ─── Interactions ─────────────────────────────────────

  /** Reply to an interaction. */
  async replyToInteraction(interactionId: string, data: InteractionCallbackData): Promise<void> {
    await this.post(route`/interactions/${interactionId}/callback`, data);
  }

  /** Acknowledge an interaction with a deferred response (shows loading state). */
  async deferInteraction(interactionId: string): Promise<void> {
    await this.post(route`/interactions/${interactionId}/defer`);
  }

  /** Send a follow-up message after replying or deferring an interaction. */
  async followUpInteraction(interactionId: string, data: InteractionCallbackData): Promise<void> {
    await this.post(route`/interactions/${interactionId}/followup`, data);
  }

  // ─── Direct Messages ──────────────────────────────────
  // A bot may message a person who shares a tavern with it and allows it (see
  // the Direct Messages guide). Refusals reject with TavernAPIError, code
  // 'CANNOT_DM_USER'; DM limits reject with RateLimitError (not retried).

  /** Open the bot's direct message with a person, or get the existing one. */
  async createDM(userId: string): Promise<DmChannel> {
    return this.post<DmChannel>('/bots/@me/dms', { userId });
  }

  /** Get one of the bot's direct messages. */
  async getDMChannel(channelId: string): Promise<DmChannel> {
    return this.get<DmChannel>(route`/bots/@me/dms/${channelId}`);
  }

  /** Get messages from a direct message, oldest first. */
  async getDMMessages(channelId: string, options?: GetDMMessagesOptions): Promise<DmMessagePage> {
    const query: Record<string, string | number | undefined> = {};
    if (options?.before) query.before = options.before;
    if (options?.limit) query.limit = options.limit;
    return this.get<DmMessagePage>(route`/bots/@me/dms/${channelId}/messages`, query);
  }

  /** Send a message in a direct message the bot already has open. */
  async sendDMMessage(channelId: string, options: SendDMOptions): Promise<DmMessage> {
    return this.post<DmMessage>(route`/bots/@me/dms/${channelId}/messages`, options);
  }

  /** Edit one of the bot's own messages in a direct message. */
  async editDMMessage(channelId: string, messageId: string, options: EditDMOptions): Promise<DmMessage> {
    return this.patch<DmMessage>(route`/bots/@me/dms/${channelId}/messages/${messageId}`, options);
  }

  /** Delete one of the bot's own messages in a direct message. */
  async deleteDMMessage(channelId: string, messageId: string): Promise<void> {
    await this.delete(route`/bots/@me/dms/${channelId}/messages/${messageId}`);
  }

  // ─── Internal Request Logic ────────────────────────────

  private async request<T>(options: RequestOptions, retryCount = 0): Promise<T> {
    // Check global rate limit
    if (this.globalRateLimit && Date.now() < this.globalRateLimit) {
      const waitMs = this.globalRateLimit - Date.now();
      this.emit('debug', `Global rate limit hit, waiting ${waitMs}ms`);
      await this.sleep(waitMs);
    }

    // Check bucket rate limit
    const bucketKey = `${options.method}:${options.path.split('/').slice(0, 4).join('/')}`;
    const bucket = this.buckets.get(bucketKey);
    if (bucket && bucket.remaining <= 0 && Date.now() < bucket.reset) {
      const waitMs = bucket.reset - Date.now();
      this.emit('debug', `Bucket rate limit hit for ${bucketKey}, waiting ${waitMs}ms`);
      await this.sleep(waitMs);
    }

    // Build URL
    let url = `${this.baseUrl}${options.path}`;
    if (options.query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) params.append(key, String(value));
      }
      const queryString = params.toString();
      if (queryString) url += `?${queryString}`;
    }

    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    const bodyStr = options.body ? JSON.stringify(options.body) : undefined;

    const requestOptions: https.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method,
      headers: {
        'Authorization': `Bot ${this.token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'taverns.js/0.3.0', // keep in step with package.json (a test checks)
      },
    };

    if (bodyStr) {
      (requestOptions.headers as Record<string, string>)['Content-Length'] = Buffer.byteLength(bodyStr).toString();
    }

    const repeatable = REPEATABLE_METHODS.has(options.method);

    return new Promise<T>((resolve, reject) => {
      const retry = (delayMs: number, reason: string): void => {
        this.emit('debug', `${reason}, retrying ${options.method} in ${delayMs}ms (attempt ${retryCount + 1})`);
        this.sleep(delayMs)
          .then(() => this.request<T>(options, retryCount + 1))
          .then(resolve, reject);
      };

      // True once a connection to the server is open; from then on the request
      // may have reached the API.
      let connected = false;
      // Set once the answer or an error has been handled, so a late error
      // never sends a finished request again.
      let finished = false;

      const onConnectionError = (error: Error): void => {
        if (finished) return;
        finished = true;
        // A lost connection may come after the API received the request, so
        // only methods that are safe to repeat are sent again. Any request is
        // sent again when the connection was never opened (the host name did
        // not resolve, or the server refused the connection).
        const notSent = !connected && isNotSentError(error);
        if ((repeatable || notSent) && retryCount < MAX_ERROR_RETRIES) {
          retry(this.backoff(retryCount), `Network error: ${error.message}`);
          return;
        }
        reject(error);
      };

      const req = transport.request(requestOptions, (res) => {
        const chunks: Buffer[] = [];

        // The connection closed before the whole answer arrived
        res.on('error', onConnectionError);
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          if (finished) return;
          finished = true;
          const raw = Buffer.concat(chunks).toString('utf-8');

          // Update rate limit tracking
          this.updateRateLimits(bucketKey, res.headers);

          const status = res.statusCode || 0;

          // 429: the API refused the request without acting on it, so it is
          // sent again after the wait, whatever the method.
          if (status === 429) {
            const retryAfter = this.parseRetryAfter(res.headers);
            const isGlobal = res.headers['x-ratelimit-global'] === 'true';
            const limitError = RateLimitError.fromResponse(raw, retryAfter, isGlobal);

            // A direct message limit is not waited out: the wait can be hours,
            // and every refused request counts against the bot. The caller
            // decides (scope and retryAfter say which limit and how long).
            if (limitError.code === DM_RATE_LIMITED) {
              reject(limitError);
              return;
            }

            if (isGlobal) {
              this.globalRateLimit = Date.now() + retryAfter;
            }

            if (retryCount < MAX_RATE_LIMIT_RETRIES) {
              retry(retryAfter, 'Rate limited');
              return;
            }

            reject(limitError);
            return;
          }

          // Success (204 and empty bodies resolve to undefined)
          if (status >= 200 && status < 300) {
            if (status === 204 || !raw) {
              resolve(undefined as T);
              return;
            }
            try {
              resolve(JSON.parse(raw) as T);
            } catch {
              resolve(undefined as T);
            }
            return;
          }

          // Server error: the API may have acted on the request before it
          // failed, so only methods that are safe to repeat are sent again.
          if (status >= 500 && repeatable && retryCount < MAX_ERROR_RETRIES) {
            retry(this.backoff(retryCount), `Server error ${status}`);
            return;
          }

          let errorMessage = `HTTP ${status}`;
          try {
            const data: unknown = JSON.parse(raw);
            if (typeof data === 'object' && data !== null && 'message' in data) {
              errorMessage = String((data as { message: unknown }).message);
            }
          } catch {
            if (raw) errorMessage = `HTTP ${status}: ${raw}`;
          }

          reject(new TavernAPIError(errorMessage, status, raw));
        });
      });

      req.on('socket', (socket) => {
        if (!socket.connecting) {
          connected = true; // a kept-alive connection was reused
        } else {
          socket.once('connect', () => {
            connected = true;
          });
        }
      });

      req.on('error', onConnectionError);

      if (bodyStr) {
        req.write(bodyStr);
      }

      req.end();
    });
  }

  private updateRateLimits(bucketKey: string, headers: http.IncomingHttpHeaders): void {
    const limit = headers['x-ratelimit-limit'];
    const remaining = headers['x-ratelimit-remaining'];
    const reset = headers['x-ratelimit-reset'];

    if (limit !== undefined && remaining !== undefined) {
      this.buckets.set(bucketKey, {
        limit: Number(limit),
        remaining: Number(remaining),
        reset: reset ? Number(reset) * 1000 : Date.now() + 1000,
      });
    }
  }

  private parseRetryAfter(headers: http.IncomingHttpHeaders): number {
    const retryAfter = headers['retry-after'];
    if (retryAfter) {
      const seconds = Number(retryAfter);
      return isNaN(seconds) ? 5000 : seconds * 1000;
    }
    return 5000;
  }

  /** Wait before retry number `retryCount + 1`: 1 s, 2 s, 4 s, at most 10 s. */
  private backoff(retryCount: number): number {
    return Math.min(1000 * Math.pow(2, retryCount), 10000);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ─── API Error ──────────────────────────────────────────────

const DM_RATE_LIMITED = 'BOT_DM_RATE_LIMITED';

/** An upper-case error token such as `CANNOT_DM_USER`. */
const ERROR_CODE_RE = /^[A-Z][A-Z0-9_]+$/;

function parseErrorBody(raw: string): Record<string, unknown> | null {
  try {
    const data: unknown = JSON.parse(raw);
    return typeof data === 'object' && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The error code of an answer body: `code`, or an `error` that is a code. */
function errorCodeOf(data: Record<string, unknown> | null): string | undefined {
  if (!data) return undefined;
  if (typeof data.code === 'string' && data.code) return data.code;
  if (typeof data.error === 'string' && ERROR_CODE_RE.test(data.error)) return data.error;
  return undefined;
}

export class TavernAPIError extends Error {
  readonly status: number;
  readonly body: string;
  /**
   * The error code the API sent, when it sent one (for example
   * `'CANNOT_DM_USER'`; see `DMErrorCode`). Undefined otherwise.
   */
  readonly code?: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'TavernAPIError';
    this.status = status;
    this.body = body;
    this.code = errorCodeOf(parseErrorBody(body));
  }
}

/**
 * A request refused with 429. Requests over the general limit are sent again
 * for you first; this is thrown when the retries run out. Requests over a
 * direct message limit (`code` `'BOT_DM_RATE_LIMITED'`) are not sent again:
 * this is thrown at once, with the limit in `scope`.
 */
export class RateLimitError extends TavernAPIError {
  /** Seconds to wait before trying again. */
  readonly retryAfter: number;
  /** Which limit was hit, when the API says (for direct messages: `user_burst`, `user_hourly`, `unanswered`, `global`, `open_burst`, `open_daily`). */
  readonly scope?: string;
  /** True when the limit covers every request of the bot. */
  readonly global: boolean;

  constructor(message: string, body: string, retryAfter: number, scope?: string, global = false) {
    super(message, 429, body);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
    this.scope = scope;
    this.global = global;
  }

  /** @internal Build the error from a 429 answer (`retryAfterMs` from the header). */
  static fromResponse(raw: string, retryAfterMs: number, global: boolean): RateLimitError {
    const data = parseErrorBody(raw);
    const bodyRetry = data && typeof data.retryAfter === 'number' && Number.isFinite(data.retryAfter)
      ? data.retryAfter
      : undefined;
    const retryAfter = bodyRetry ?? retryAfterMs / 1000;
    const scope = data && typeof data.scope === 'string' ? data.scope : undefined;
    const message = data && typeof data.message === 'string' && data.message ? data.message : 'Rate limited';
    return new RateLimitError(message, raw, retryAfter, scope, global);
  }
}
