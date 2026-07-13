import WebSocket from 'ws';

type MassiveWsOptions = {
  url?: string;
  apiKey: string;
  assetClass?: string;
  onMessage: (payload: any) => void;
  onStatus?: (payload: any) => void;
  onError?: (error: any) => void;
  onConnect?: () => void;
};

type SubscriptionSet = Set<string>;

export type MassiveWsState = {
  url: string;
  assetClass: string;
  connected: boolean;
  connecting: boolean;
  authenticated: boolean;
  reconnectAttempts: number;
  nextReconnectAt: string | null;
  lastEventAt: string | null;
  subscriptionCount: number;
};

export class MassiveWsClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly url: string;
  private readonly apiKey: string;
  private readonly assetClass: string;
  private readonly onMessage: (payload: any) => void;
  private readonly onStatus?: (payload: any) => void;
  private readonly onError?: (error: any) => void;
  private readonly onConnect?: () => void;
  private readonly subscriptions: SubscriptionSet = new Set();
  private connecting = false;
  private reconnectAttempts = 0;
  private authenticated = false;
  private nextReconnectAt: number | null = null;
  private lastEventAt: number | null = null;
  private stopped = false;

  constructor(options: MassiveWsOptions) {
    this.apiKey = options.apiKey;
    this.assetClass = options.assetClass ?? 'stocks';
    this.url = options.url ?? `wss://socket.massive.com/${this.assetClass}`;
    this.onMessage = options.onMessage;
    this.onStatus = options.onStatus;
    this.onError = options.onError;
    this.onConnect = options.onConnect;
  }

  connect() {
    if (this.connecting || this.ws) return;
    this.stopped = false;
    this.connecting = true;
    const socket = new WebSocket(this.url);
    this.ws = socket;

    socket.on('open', () => {
      this.connecting = false;
      this.authenticate();
    });

    socket.on('message', raw => {
      try {
        const payload = JSON.parse(raw.toString());
        if (Array.isArray(payload)) {
          payload.forEach(event => this.handleEvent(event));
        } else {
          this.handleEvent(payload);
        }
      } catch (error) {
        console.error('[MassiveWS] failed to parse message', { error, raw: raw.toString() });
      }
    });

    socket.on('close', () => {
      this.connecting = false;
      this.authenticated = false;
      this.ws = null;
      this.scheduleReconnect();
    });

    socket.on('error', error => {
      this.onError?.(error);
      if (this.ws && this.ws.readyState !== WebSocket.CLOSING && this.ws.readyState !== WebSocket.CLOSED) {
        this.ws.close();
      }
    });
  }

  disconnect() {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.connecting = false;
    this.authenticated = false;
    this.nextReconnectAt = null;
    this.subscriptions.clear();
  }

  /** Structured connection state for health reporting. */
  getState(): MassiveWsState {
    return {
      url: this.url,
      assetClass: this.assetClass,
      connected: this.ws?.readyState === WebSocket.OPEN,
      connecting: this.connecting,
      authenticated: this.authenticated,
      reconnectAttempts: this.reconnectAttempts,
      nextReconnectAt: this.nextReconnectAt ? new Date(this.nextReconnectAt).toISOString() : null,
      lastEventAt: this.lastEventAt ? new Date(this.lastEventAt).toISOString() : null,
      subscriptionCount: this.subscriptions.size,
    };
  }

  getSubscriptions(): string[] {
    return Array.from(this.subscriptions);
  }

  subscribe(params: string) {
    if (this.subscriptions.has(params)) return;
    this.subscriptions.add(params);
    this.send({
      action: 'subscribe',
      params
    });
  }

  unsubscribe(params: string) {
    if (!this.subscriptions.has(params)) return;
    this.subscriptions.delete(params);
    this.send({
      action: 'unsubscribe',
      params
    });
  }

  private authenticate() {
    this.send({
      action: 'auth',
      params: this.apiKey
    });
  }

  private resubscribeAll() {
    if (!this.subscriptions.size) return;
    const params = Array.from(this.subscriptions).join(',');
    this.send({
      action: 'subscribe',
      params
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.stopped) return;
    this.reconnectAttempts += 1;
    const attempt = this.reconnectAttempts;
    // Bounded exponential backoff with jitter, capped at 60 s. The client
    // NEVER permanently gives up: while consumers hold subscriptions the feed
    // must keep trying (health reporting marks the stream DEGRADED/UNAVAILABLE
    // in the meantime — see optionsDataHealth).
    const base = Math.min(3000 * Math.pow(2, Math.min(attempt - 1, 5)), 60_000);
    const jitter = Math.round(base * (Math.random() * 0.4 - 0.2)); // ±20%
    const delayMs = Math.max(1_000, base + jitter);
    this.nextReconnectAt = Date.now() + delayMs;
    // Only log the first 5 attempts and then every 5th to reduce noise
    if (attempt <= 5 || attempt % 5 === 0) {
      console.warn('[MassiveWS] scheduling reconnect', {
        attempt,
        delayMs,
        url: this.url,
        assetClass: this.assetClass
      });
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.nextReconnectAt = null;
      this.connect();
    }, delayMs);
  }

  private handleEvent(event: any) {
    this.lastEventAt = Date.now();
    if (event?.ev === 'status') {
      this.onStatus?.(event);
      if (event?.status === 'auth_success') {
        this.reconnectAttempts = 0;
        this.authenticated = true;
        this.onConnect?.();
        this.resubscribeAll();
      }
      return;
    }
    this.onMessage(event);
  }

  private send(payload: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      this.ws.send(JSON.stringify(payload));
    } catch (error) {
      console.error('[MassiveWS] failed to send payload', { payload, error });
    }
  }
}
