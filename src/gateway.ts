/**
 * taverns.js - Gateway (WebSocket Client)
 *
 * Manages the WebSocket connection to the Tavern gateway.
 * Handles authentication, heartbeats, auto-reconnection with exponential
 * backoff, and event dispatching.
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { DEFAULT_WS_URL, GatewayAction } from './constants';

export interface GatewayOptions {
  /** Bot token (tavbot_...) */
  token: string;
  /** WebSocket URL (default: wss://ws.tav.gg) */
  url?: string;
  /** Heartbeat interval in milliseconds (default: 30000) */
  heartbeatInterval?: number;
  /** Whether to auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Maximum reconnect attempts before giving up (default: Infinity) */
  maxReconnectAttempts?: number;
  /** Gateway intents bitfield (session-level filtering, not persisted) */
  intents?: bigint;
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
    this.heartbeatInterval = options.heartbeatInterval || 30_000;
    this.autoReconnect = options.autoReconnect ?? true;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? Infinity;
    this.intents = options.intents;
  }

  /** Whether the gateway is currently connected. */
  get connected(): boolean {
    return this.state === ConnectionState.CONNECTED;
  }

  /** Update the bot token (used when login() provides a new token). */
  setToken(token: string): void {
    this.token = token;
  }

  /**
   * Connect to the gateway.
   * Resolves once the WebSocket connection is open.
   */
  connect(): Promise<void> {
    if (this.destroyed) {
      return Promise.reject(new Error('Gateway has been destroyed'));
    }

    if (this.state === ConnectionState.CONNECTED || this.state === ConnectionState.CONNECTING) {
      return Promise.resolve();
    }

    this.state = ConnectionState.CONNECTING;
    this.emit('debug', `Connecting to gateway: ${this.url}`);

    return new Promise((resolve, reject) => {
      let wsUrl = `${this.url}?token=${encodeURIComponent(this.token)}`;
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
        this.startHeartbeat();
        this.emit('debug', 'Gateway connection established');
        cleanup();
        resolve();
      };

      const onError = (err: Error): void => {
        this.emit('debug', `Gateway connection error: ${err.message}`);
        if (this.state === ConnectionState.CONNECTING) {
          cleanup();
          this.state = ConnectionState.DISCONNECTED;
          reject(err);
        }
      };

      const onClose = (code: number, reason: Buffer): void => {
        const reasonStr = reason.toString('utf-8');
        this.emit('debug', `Gateway closed during connect: ${code} ${reasonStr}`);
        if (this.state === ConnectionState.CONNECTING) {
          cleanup();
          this.state = ConnectionState.DISCONNECTED;
          reject(new Error(`WebSocket closed: ${code} ${reasonStr}`));
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

  private onMessage(data: WebSocket.Data): void {
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

    this.emit('debug', `Gateway event: ${eventName}`);
    this.emit('event', eventName, payload.data);
  }

  private onClose(code: number, reason: Buffer): void {
    const reasonStr = reason.toString('utf-8');
    this.emit('debug', `Gateway closed: ${code} ${reasonStr}`);
    this.stopHeartbeat();
    this.state = ConnectionState.DISCONNECTED;
    this.emit('close', code, reasonStr);

    // Auth failures should not trigger reconnect
    if (code === 4001 || code === 4003 || code === 4004) {
      this.emit('debug', `Authentication error (${code}), not reconnecting`);
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
      this.send(GatewayAction.HEARTBEAT);
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
