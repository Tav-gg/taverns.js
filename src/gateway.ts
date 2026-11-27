/**
 * taverns.js - Gateway (WebSocket Client)
 *
 * Manages the WebSocket connection to the Tavern gateway.
 * Handles authentication, heartbeats, auto-reconnection with exponential
 * backoff, and event dispatching.
 *
 * How the gateway behaves:
 * - It checks the token during the handshake and refuses a bad one with
 *   HTTP 401 or 403. That is the only refusal that stops reconnecting.
 * - It pings the socket every 25 seconds (the `ws` library answers) and
 *   closes it after 75 seconds without hearing from it. It answers the
 *   `ping` action with a `pong` event.
 * - Every close it makes (1000 when a socket reaches its age limit, 1001,
 *   1008, 1009, 1012 when the service restarts) is followed by a reconnect.
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { DEFAULT_WS_URL, GatewayAction } from './constants';
import { checkBaseUrl } from './url';

/** The event the gateway answers a `ping` with. */
const PONG_EVENT = 'pong';

/**
 * A connection that has received nothing for this long (no event, no ping
 * from the gateway, no answer to our own ping) is treated as dead and
 * reconnected. The gateway itself gives up on a silent socket after 75 s.
 */
const MIN_SILENCE_TIMEOUT = 75_000;

export interface GatewayOptions {
  /** Bot token (tavbot_...) */
  token: string;
  /** WebSocket URL (default: wss://ws.tav.gg) */
  url?: string;
  /**
   * How often to send a heartbeat and a ping, in milliseconds (default: 30000).
   * A connection silent for 75 s (or two intervals and 15 s, if longer) is
   * reconnected.
   */
  heartbeatInterval?: number;
  /** Whether to auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Maximum reconnect attempts before giving up (default: Infinity) */
  maxReconnectAttempts?: number;
  /** Gateway intents bitfield (session-level filtering, not persisted) */
  intents?: bigint;
  /**
   * Accept a plain ws:// URL. The bot token is then sent unencrypted, so use
   * this for local development only. Default: false.
   */
  allowInsecure?: boolean;
}

enum ConnectionState {
  DISCONNECTED = 0,
  CONNECTING = 1,
  CONNECTED = 2,
  RECONNECTING = 3,
}

export class Gateway extends EventEmitter {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private state: ConnectionState = ConnectionState.DISCONNECTED;
  private reconnectAttempts = 0;
  private destroyed = false;
  /** Set when the gateway refused the token; cleared by setToken(). */
  private authError: Error | null = null;
  /** When anything last arrived on the socket (an event, a ping, a pong). */
  private lastReceivedAt = 0;
  /** When our last `ping` was sent (0: none waiting for its `pong`). */
  private pingSentAt = 0;
  private _latency = -1;

  private token: string;
  private readonly url: string;
  private readonly heartbeatInterval: number;
  private autoReconnect: boolean;
  private readonly maxReconnectAttempts: number;
  private readonly intents?: bigint;

  constructor(options: GatewayOptions) {
    super();
    this.token = options.token;
    this.url = options.url || DEFAULT_WS_URL;
    checkBaseUrl(this.url, 'gateway', options.allowInsecure ?? false);
    this.heartbeatInterval = options.heartbeatInterval || 30_000;
    this.autoReconnect = options.autoReconnect ?? true;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? Infinity;
    this.intents = options.intents;
  }

  /** Whether the gateway is currently connected. */
  get connected(): boolean {
    return this.state === ConnectionState.CONNECTED;
  }

  /** Round trip of the last ping in milliseconds, or -1 before the first pong. */
  get latency(): number {
    return this._latency;
  }

  /** How long a silent connection is kept before it is reconnected. */
  private get silenceTimeout(): number {
    return Math.max(MIN_SILENCE_TIMEOUT, this.heartbeatInterval * 2 + 15_000);
  }

  /** Update the bot token (used when login() provides a new token). */
  setToken(token: string): void {
    this.token = token;
    this.authError = null;
  }

  /**
   * Connect to the gateway.
   * Resolves once the WebSocket connection is open.
   *
   * If the gateway refuses the token (HTTP 401 or 403 on the handshake), the
   * gateway stops reconnecting and emits `authFailed`; call setToken() with a
   * valid token before connecting again.
   */
  connect(): Promise<void> {
    if (this.destroyed) {
      return Promise.reject(new Error('Gateway has been destroyed'));
    }

    if (this.authError) {
      return Promise.reject(this.authError);
    }

    if (this.state === ConnectionState.CONNECTED || this.state === ConnectionState.CONNECTING) {
      return Promise.resolve();
    }

    this.state = ConnectionState.CONNECTING;
    this.emit('debug', `Connecting to gateway: ${this.url}`);

    return new Promise((resolve, reject) => {
      // The token is never written to debug output: only the base URL above is.
      let wsUrl = `${this.url}${this.url.includes('?') ? '&' : '?'}token=${encodeURIComponent(this.token)}`;
      if (this.intents !== undefined) {
        wsUrl += `&intents=${this.intents.toString()}`;
      }

      try {
        this.ws = new WebSocket(wsUrl);
      } catch (err) {
        this.state = ConnectionState.DISCONNECTED;
        reject(err);
        return;
      }

      const onOpen = (): void => {
        this.state = ConnectionState.CONNECTED;
        this.reconnectAttempts = 0;
        this.lastReceivedAt = Date.now();
        this.pingSentAt = 0;
        this.startHeartbeat();
        this.emit('debug', 'Gateway connection established');
        cleanup();
        resolve();
      };

      const onError = (err: Error): void => {
        this.emit('debug', `Gateway connection error: ${err.message}`);
        if (this.state === ConnectionState.CONNECTING) {
          // The handshake answer, e.g. "Unexpected server response: 401"
          const status = /Unexpected server response: (\d{3})/.exec(err.message)?.[1];
          if (status === '401' || status === '403') {
            this.authError = new Error(
              `Authentication failed: the gateway refused the bot token (HTTP ${status}). Not reconnecting.`,
            );
          }
          cleanup();
          this.state = ConnectionState.DISCONNECTED;
          reject(this.authError ?? err);
        }
      };

      const onClose = (code: number, reason: Buffer): void => {
        const reasonStr = reason.toString('utf-8');
        this.emit('debug', `Gateway closed during connect: ${code} ${reasonStr}`);
        if (this.state === ConnectionState.CONNECTING) {
          cleanup();
          this.state = ConnectionState.DISCONNECTED;
          reject(this.authError ?? new Error(`WebSocket closed: ${code} ${reasonStr}`));
        }
      };

      const cleanup = (): void => {
        this.ws?.removeListener('open', onOpen);
        this.ws?.removeListener('error', onError);
        this.ws?.removeListener('close', onClose);
        // Re-attach permanent handlers
        if (this.ws) {
          this.ws.on('message', this.onMessage.bind(this));
          this.ws.on('close', this.onClose.bind(this));
          this.ws.on('error', this.onError.bind(this));
          // The gateway's pings (answered by `ws`) also prove the link is alive.
          this.ws.on('ping', this.onAlive.bind(this));
          this.ws.on('pong', this.onAlive.bind(this));
        }
      };

      this.ws.once('open', onOpen);
      this.ws.once('error', onError);
      this.ws.once('close', onClose);
    });
  }

  /**
   * Send a JSON message to the gateway.
   */
  send(action: string, data?: unknown): void {
    if (!this.ws || this.state !== ConnectionState.CONNECTED) {
      this.emit('debug', `Cannot send "${action}": not connected`);
      return;
    }

    const payload = JSON.stringify({ action, data });
    try {
      this.ws.send(payload);
    } catch (err) {
      this.emit('debug', `Failed to send "${action}": ${(err as Error).message}`);
    }
  }

  /**
   * Gracefully disconnect and clean up. The gateway cannot be reused after this.
   */
  destroy(): void {
    this.destroyed = true;
    this.autoReconnect = false;
    this.cleanup();
    this.state = ConnectionState.DISCONNECTED;
    this.emit('debug', 'Gateway destroyed');
    this.removeAllListeners();
  }

  /**
   * Disconnect without destroying (allows reconnection).
   */
  disconnect(): void {
    this.cleanup();
    this.state = ConnectionState.DISCONNECTED;
    this.emit('debug', 'Gateway disconnected');
  }

  // ─── Internal ──────────────────────────────────────────

  private onAlive(): void {
    this.lastReceivedAt = Date.now();
  }

  private onMessage(data: WebSocket.Data): void {
    this.lastReceivedAt = Date.now();
    let raw: string;
    if (data instanceof Buffer) {
      raw = data.toString('utf-8');
    } else if (data instanceof ArrayBuffer) {
      raw = Buffer.from(data).toString('utf-8');
    } else if (Array.isArray(data)) {
      raw = Buffer.concat(data).toString('utf-8');
    } else {
      raw = String(data);
    }

    let payload: { event?: string; action?: string; data?: unknown };
    try {
      payload = JSON.parse(raw);
    } catch {
      this.emit('debug', `Received non-JSON message: ${raw.substring(0, 200)}`);
      return;
    }

    const eventName = payload.event || payload.action;
    if (!eventName) {
      this.emit('debug', `Received message without event/action: ${raw.substring(0, 200)}`);
      return;
    }

    // The answer to our ping: kept here, not passed on as an event.
    if (eventName === PONG_EVENT) {
      if (this.pingSentAt) {
        this._latency = Date.now() - this.pingSentAt;
        this.pingSentAt = 0;
      }
      this.emit('debug', `Received pong (${this._latency} ms)`);
      return;
    }

    this.emit('debug', `Gateway event: ${eventName}`);
    this.emit('event', eventName, payload.data);
  }

  private onClose(code: number, reason: Buffer): void {
    const reasonStr = reason.toString('utf-8');
    this.emit('debug', `Gateway closed: ${code} ${reasonStr}`);
    this.stopHeartbeat();
    this.state = ConnectionState.DISCONNECTED;
    this.emit('close', code, reasonStr);

    // Every close the gateway makes is followed by a reconnect: a token that
    // is no longer valid is refused on the next handshake (HTTP 401 or 403),
    // which stops it. A refused handshake is reported by connect(); do not
    // retry it.
    if (this.authError) {
      return;
    }

    if (this.autoReconnect && !this.destroyed) {
      this.scheduleReconnect();
    }
  }

  private onError(err: Error): void {
    this.emit('debug', `Gateway error: ${err.message}`);
    this.emit('error', err);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      // Nothing heard for too long: the connection is gone without a close.
      // Dropping the socket fires `close` (1006), which reconnects.
      const silentFor = Date.now() - this.lastReceivedAt;
      if (silentFor > this.silenceTimeout) {
        this.emit('debug', `Nothing received for ${silentFor} ms, reconnecting`);
        this.ws?.terminate();
        return;
      }
      // The heartbeat keeps the bot shown online; the ping measures the link.
      this.send(GatewayAction.HEARTBEAT);
      this.pingSentAt = Date.now();
      this.send(GatewayAction.PING);
      this.emit('debug', 'Sent heartbeat');
    }, this.heartbeatInterval);

    // Prevent the timer from keeping the process alive
    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectAttempts++;

    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      this.emit('debug', `Max reconnect attempts (${this.maxReconnectAttempts}) reached, giving up`);
      this.emit('reconnectFailed');
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (max)
    const baseDelay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30_000);
    // Add jitter (0-25% of base delay)
    const jitter = Math.floor(Math.random() * baseDelay * 0.25);
    const delay = baseDelay + jitter;

    this.state = ConnectionState.RECONNECTING;
    this.emit('debug', `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.emit('reconnecting', this.reconnectAttempts);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;

      if (this.destroyed) return;

      try {
        await this.connect();
        this.emit('reconnected');
      } catch (err) {
        this.emit('debug', `Reconnect attempt ${this.reconnectAttempts} failed: ${(err as Error).message}`);
        if (this.authError) {
          this.state = ConnectionState.DISCONNECTED;
          this.emit('authFailed', this.authError);
          return;
        }
        if (!this.destroyed && this.autoReconnect) {
          this.scheduleReconnect();
        }
      }
    }, delay);

    if (this.reconnectTimer.unref) {
      this.reconnectTimer.unref();
    }
  }

  private cleanup(): void {
    this.stopHeartbeat();
    this.pingSentAt = 0;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        try {
          this.ws.close(1000, 'Client disconnect');
        } catch {
          // Ignore close errors
        }
      }
      this.ws = null;
    }
  }
}
