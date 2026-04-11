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
} from './types';

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

export class RESTClient extends EventEmitter {
  private token: string;
  private baseUrl: string;
  private buckets = new Map<string, RateLimitBucket>();
  private globalRateLimit: number | null = null;

  constructor(token: string, baseUrl: string = DEFAULT_API_URL) {
    super();
    this.token = token;
    this.baseUrl = baseUrl;
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
    return this.get<Tavern>(`/taverns/${tavernId}`);
  }

  // ─── Channels ──────────────────────────────────────────

  /** List all channels in a tavern. */
  async getChannels(tavernId: string): Promise<Channel[]> {
    return this.get<Channel[]>(`/taverns/${tavernId}/channels`);
  }

  /** Create a new channel in a tavern. */
  async createChannel(tavernId: string, options: CreateChannelOptions): Promise<Channel> {
    return this.post<Channel>(`/taverns/${tavernId}/channels`, options);
  }

  /** Update a channel. */
  async updateChannel(tavernId: string, channelId: string, options: UpdateChannelOptions): Promise<Channel> {
    return this.patch<Channel>(`/taverns/${tavernId}/channels/${channelId}`, options);
  }

  /** Delete a channel. */
  async deleteChannel(tavernId: string, channelId: string): Promise<void> {
    await this.delete(`/taverns/${tavernId}/channels/${channelId}`);
  }

  // ─── Messages ──────────────────────────────────────────

  /** Send a message to a channel. */
  async sendMessage(tavernId: string, channelId: string, options: SendMessageOptions): Promise<Message> {
    return this.post<Message>(`/taverns/${tavernId}/channels/${channelId}/messages`, options);
  }

  /** Get messages from a channel. */
  async getMessages(tavernId: string, channelId: string, options?: GetMessagesOptions): Promise<Message[]> {
    const query: Record<string, string | number | undefined> = {};
    if (options?.limit) query.limit = options.limit;
    if (options?.before) query.before = options.before;
    if (options?.after) query.after = options.after;
    return this.get<Message[]>(`/taverns/${tavernId}/channels/${channelId}/messages`, query);
  }

  /** Edit a message. */
  async editMessage(tavernId: string, messageId: string, options: EditMessageOptions): Promise<Message> {
    return this.patch<Message>(`/taverns/${tavernId}/messages/${messageId}`, options);
  }

  /** Delete a message. */
  async deleteMessage(tavernId: string, messageId: string): Promise<void> {
    await this.delete(`/taverns/${tavernId}/messages/${messageId}`);
  }

  /** Pin a message. */
  async pinMessage(tavernId: string, messageId: string): Promise<void> {
    await this.post(`/taverns/${tavernId}/messages/${messageId}/pin`);
  }

  /** Unpin a message. */
  async unpinMessage(tavernId: string, messageId: string): Promise<void> {
    await this.delete(`/taverns/${tavernId}/messages/${messageId}/pin`);
  }

  /** Get pinned messages in a channel. */
  async getPinnedMessages(tavernId: string, channelId: string): Promise<Message[]> {
    return this.get<Message[]>(`/taverns/${tavernId}/channels/${channelId}/pins`);
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
      return this.get(`/taverns/${tavernId}/channels/${options.channelId}/messages/search`, query);
    }
    return this.get(`/taverns/${tavernId}/messages/search`, query);
  }

  /** Add a reaction to a message. */
  async addReaction(tavernId: string, messageId: string, emoji: string): Promise<void> {
    await this.post(`/taverns/${tavernId}/messages/${messageId}/reactions`, { emoji });
  }

  /** Remove a reaction from a message. */
  async removeReaction(tavernId: string, messageId: string, emoji: string): Promise<void> {
    await this.delete(`/taverns/${tavernId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`);
  }

  /** Bulk delete messages in a channel. */
  async bulkDeleteMessages(tavernId: string, channelId: string, messageIds: string[]): Promise<void> {
    await this.post(`/taverns/${tavernId}/channels/${channelId}/messages/bulk-delete`, { messageIds });
  }

  // ─── Members ───────────────────────────────────────────

  /** List members of a tavern. */
  async getMembers(tavernId: string, options?: { limit?: number; after?: string }): Promise<Member[]> {
    const query: Record<string, string | number | undefined> = {};
    if (options?.limit) query.limit = options.limit;
    if (options?.after) query.after = options.after;
    return this.get<Member[]>(`/taverns/${tavernId}/members`, query);
  }

  /** Get a specific member. */
  async getMember(tavernId: string, userId: string): Promise<Member> {
    return this.get<Member>(`/taverns/${tavernId}/members/${userId}`);
  }

  /** Kick a member from a tavern. */
  async kickMember(tavernId: string, userId: string, reason?: string): Promise<void> {
    await this.delete(`/taverns/${tavernId}/members/${userId}`, reason ? { reason } : undefined);
  }

  /** Ban a member from a tavern. */
  async banMember(tavernId: string, userId: string, reason?: string): Promise<void> {
    await this.post(`/taverns/${tavernId}/bans/${userId}`, reason ? { reason } : undefined);
  }

  /** Unban a member from a tavern. */
  async unbanMember(tavernId: string, userId: string): Promise<void> {
    await this.delete(`/taverns/${tavernId}/bans/${userId}`);
  }

  // ─── Roles ─────────────────────────────────────────────

  /** List roles in a tavern. */
  async getRoles(tavernId: string): Promise<Role[]> {
    return this.get<Role[]>(`/taverns/${tavernId}/roles`);
  }

  /** Create a new role in a tavern. */
  async createRole(tavernId: string, options: CreateRoleOptions): Promise<Role> {
    return this.post<Role>(`/taverns/${tavernId}/roles`, options);
  }

  /** Update a role. */
  async updateRole(tavernId: string, roleId: string, options: UpdateRoleOptions): Promise<Role> {
    return this.patch<Role>(`/taverns/${tavernId}/roles/${roleId}`, options);
  }

  /** Delete a role. */
  async deleteRole(tavernId: string, roleId: string): Promise<void> {
    await this.delete(`/taverns/${tavernId}/roles/${roleId}`);
  }

  /** Add a role to a member. */
  async addMemberRole(tavernId: string, userId: string, roleId: string): Promise<void> {
    await this.post(`/taverns/${tavernId}/members/${userId}/roles/${roleId}`);
  }

  /** Remove a role from a member. */
  async removeMemberRole(tavernId: string, userId: string, roleId: string): Promise<void> {
    await this.delete(`/taverns/${tavernId}/members/${userId}/roles/${roleId}`);
  }

  // ─── Threads ───────────────────────────────────────────

  /** Create a thread in a channel. */
  async createThread(
    tavernId: string,
    channelId: string,
    options: { name: string; rootMessageId?: string; starterMessage?: string; autoArchiveDuration?: number; isPrivate?: boolean },
  ): Promise<Channel> {
    return this.post<Channel>(`/taverns/${tavernId}/channels/${channelId}/threads`, options);
  }

  /** List threads in a channel. */
  async getThreads(tavernId: string, channelId: string): Promise<Channel[]> {
    return this.get<Channel[]>(`/taverns/${tavernId}/channels/${channelId}/threads`);
  }

  /** Get active threads across the tavern. */
  async getActiveThreads(tavernId: string): Promise<Channel[]> {
    return this.get<Channel[]>(`/taverns/${tavernId}/active-threads`);
  }

  // ─── Bot Commands (Slash Commands) ─────────────────────

  /** Register or overwrite all slash commands for this bot. */
  async registerCommands(commands: Omit<BotCommand, 'id' | 'version'>[]): Promise<BotCommand[]> {
    return this.put<BotCommand[]>('/bots/@me/commands', commands);
  }

  /** Get all registered commands for this bot. */
  async getCommands(): Promise<BotCommand[]> {
    return this.get<BotCommand[]>('/bots/@me/commands');
  }

  /** Delete a registered command by ID. */
  async deleteCommand(commandId: string): Promise<void> {
    await this.delete(`/bots/@me/commands/${commandId}`);
  }

  // ─── Interactions ─────────────────────────────────────

  /** Reply to an interaction. */
  async replyToInteraction(interactionId: string, data: InteractionCallbackData): Promise<void> {
    await this.post(`/interactions/${interactionId}/callback`, data);
  }

  /** Acknowledge an interaction with a deferred response (shows loading state). */
  async deferInteraction(interactionId: string): Promise<void> {
    await this.post(`/interactions/${interactionId}/defer`);
  }

  /** Send a follow-up message after replying or deferring an interaction. */
  async followUpInteraction(interactionId: string, data: InteractionCallbackData): Promise<void> {
    await this.post(`/interactions/${interactionId}/followup`, data);
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
        'User-Agent': 'taverns.js/0.1.0',
      },
    };

    if (bodyStr) {
      (requestOptions.headers as Record<string, string>)['Content-Length'] = Buffer.byteLength(bodyStr).toString();
    }

    return new Promise<T>((resolve, reject) => {
      const req = transport.request(requestOptions, (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');

          // Update rate limit tracking
          this.updateRateLimits(bucketKey, res.headers);

          const status = res.statusCode || 0;

          // Handle 429 (rate limited)
          if (status === 429) {
            const retryAfter = this.parseRetryAfter(res.headers);
            const isGlobal = res.headers['x-ratelimit-global'] === 'true';

            if (isGlobal) {
              this.globalRateLimit = Date.now() + retryAfter;
            }

            if (retryCount < 5) {
              this.emit('debug', `Rate limited (attempt ${retryCount + 1}), retrying in ${retryAfter}ms`);
              this.sleep(retryAfter).then(() => {
                this.request<T>(options, retryCount + 1).then(resolve, reject);
              });
              return;
            }

            reject(new TavernAPIError('Rate limited', status, raw));
            return;
          }

          // Handle 204 (no content)
          if (status === 204 || !raw) {
            resolve(undefined as T);
            return;
          }

          // Parse JSON response
          let data: unknown;
          try {
            data = JSON.parse(raw);
          } catch {
            if (status >= 200 && status < 300) {
              resolve(undefined as T);
              return;
            }
            reject(new TavernAPIError(`HTTP ${status}: ${raw}`, status, raw));
            return;
          }

          // Success
          if (status >= 200 && status < 300) {
            resolve(data as T);
            return;
          }

          // Server errors - retry with backoff
          if (status >= 500 && retryCount < 3) {
            const backoff = Math.min(1000 * Math.pow(2, retryCount), 10000);
            this.emit('debug', `Server error ${status}, retrying in ${backoff}ms (attempt ${retryCount + 1})`);
            this.sleep(backoff).then(() => {
              this.request<T>(options, retryCount + 1).then(resolve, reject);
            });
            return;
          }

          // Client/server error
          const errorMessage = typeof data === 'object' && data !== null && 'message' in data
            ? String((data as { message: string }).message)
            : `HTTP ${status}`;

          reject(new TavernAPIError(errorMessage, status, raw));
        });
      });

      req.on('error', (error) => {
        // Network errors - retry with backoff
        if (retryCount < 3) {
          const backoff = Math.min(1000 * Math.pow(2, retryCount), 10000);
          this.emit('debug', `Network error: ${error.message}, retrying in ${backoff}ms`);
          this.sleep(backoff).then(() => {
            this.request<T>(options, retryCount + 1).then(resolve, reject);
          });
          return;
        }
        reject(error);
      });

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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ─── API Error ──────────────────────────────────────────────

export class TavernAPIError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'TavernAPIError';
    this.status = status;
    this.body = body;
  }
}
