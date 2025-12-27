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
    this.subscriptions.clear();
  }

  subscribe(symbol: string) {
    if (this.subscriptions.has(symbol)) return;
    this.subscriptions.add(symbol);
    this.send({
      action: 'subscribe',
      params: symbol
    });
  }

  unsubscribe(symbol: string) {
    if (!this.subscriptions.has(symbol)) return;
    this.subscriptions.delete(symbol);
    this.send({
      action: 'unsubscribe',
      params: symbol
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
    if (this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    const attempt = this.reconnectAttempts;
    const delayMs = 3000;
    console.warn('[MassiveWS] scheduling reconnect', {
      attempt,
      delayMs,
      url: this.url,
      assetClass: this.assetClass
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  private handleEvent(event: any) {
    if (event?.ev === 'status') {
      this.onStatus?.(event);
      if (event?.status === 'auth_success') {
        this.reconnectAttempts = 0;
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
