// Shared types for the automation safety foundation.
// All state enums are explicit string unions persisted verbatim in Mongo.

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export type AutomationSessionStatus =
  | 'CREATED'
  | 'READY'
  | 'PAUSED'
  | 'STOPPED'
  | 'EMERGENCY_STOPPED'
  | 'UNAVAILABLE';

export type SessionHealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';

export type ReconciliationStatus = 'PENDING' | 'CLEAN' | 'MISMATCH' | 'MANUAL_REVIEW' | 'FAILED';

export type AutomationMode = 'paper';

// ---------------------------------------------------------------------------
// Order intents (local, persisted BEFORE any broker request)
// ---------------------------------------------------------------------------

export type IntentType = 'ENTRY' | 'EXIT';
export type IntentDirection = 'BUY' | 'SELL';
export type IntentOrderType = 'market' | 'limit';
export type IntentTimeInForce = 'day' | 'gtc';

export type OrderIntentStatus =
  | 'CREATED'
  // Phase 2B: risk-approved by the deterministic pipeline; execution is
  // deferred to Phase 2C. Never submitted by any Phase 2A/2B code path.
  | 'APPROVED_AWAITING_EXECUTION'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'BROKER_REJECTED'
  | 'FAILED'
  | 'MANUAL_REVIEW'
  | 'COMPLETED';

export type IdempotencyKeyInput = {
  automationSessionId: string;
  strategyVersionId: string;
  underlying: string;
  signalDirection: IntentDirection;
  closedBarTimestamp: string | number | Date;
  intentType: IntentType;
  /**
   * Optional discriminator that scopes the idempotency key beyond the six
   * canonical fields. ENTRY intents omit it (keys unchanged — backward
   * compatible). EXIT intents pass a position-and-attempt scope so each exit
   * order for a position maps to exactly one deterministic broker identity and
   * a bounded retry produces a distinct, still-idempotent client_order_id.
   */
  idempotencyScope?: string | null;
};

export type CreateOrderIntentInput = IdempotencyKeyInput & {
  optionSymbol?: string | null;
  quantity: number;
  orderType: IntentOrderType;
  limitPrice?: number | null;
  timeInForce: IntentTimeInForce;
};

// ---------------------------------------------------------------------------
// Broker boundary
// ---------------------------------------------------------------------------

// The ONLY order states this journal accepts. These are broker-truth states:
// nothing internal (signal, socket event, scheduler tick) may produce them.
export type BrokerOrderStatus =
  | 'CREATED'
  | 'SUBMITTING'
  | 'ACCEPTED'
  | 'PENDING_NEW'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCEL_PENDING'
  | 'CANCELLED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'REPLACED'
  | 'UNKNOWN'
  | 'MANUAL_REVIEW';

export type BrokerAccount = {
  /** Masked — never the full account identifier. */
  accountIdMasked: string;
  buyingPower: number | null;
  equity: number | null;
  cash: number | null;
  currency: string;
  isPaper: boolean;
};

export type BrokerClock = {
  asOf: Date;
  isOpen: boolean;
  nextOpen: Date | null;
  nextClose: Date | null;
  source: 'alpaca-paper' | 'mock';
};

export type BrokerOrder = {
  brokerOrderId: string;
  clientOrderId: string | null;
  symbol: string;
  side: IntentDirection;
  qty: number;
  filledQty: number;
  avgFillPrice: number | null;
  status: BrokerOrderStatus;
  /** Raw status string exactly as the broker reported it. */
  rawStatus: string;
  orderType: string;
  limitPrice: number | null;
  timeInForce: string;
  submittedAt: Date | null;
  updatedAt: Date | null;
};

export type BrokerPosition = {
  symbol: string;
  qty: number;
  side: 'long' | 'short';
  avgEntryPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  assetClass: string;
};

/**
 * The only payload `submitOrder` accepts: a persisted, risk-approved intent.
 * Phase 2A has no risk engine wiring, so the only legal producers are tests
 * and explicit operator actions — never market signals.
 */
export type ApprovedOrderIntent = {
  intentId: string;
  idempotencyKey: string;
  clientOrderId: string;
  symbol: string;
  side: IntentDirection;
  quantity: number;
  orderType: IntentOrderType;
  limitPrice?: number | null;
  timeInForce: IntentTimeInForce;
  intentType: IntentType;
};

// ---------------------------------------------------------------------------
// Market clock
// ---------------------------------------------------------------------------

export type MarketClockState = 'OPEN' | 'CLOSED' | 'UNKNOWN';

export type MarketClockDecision = {
  state: MarketClockState;
  /** Entries are permitted ONLY when this is true. Unknown never permits. */
  canEnter: boolean;
  reasons: string[];
  decidedAt: Date;
  stale: boolean;
  broker: {
    ok: boolean;
    isOpen: boolean | null;
    nextOpen: Date | null;
    nextClose: Date | null;
    error?: string;
  };
  massive: {
    ok: boolean;
    market: string | null;
    conflictsWithBroker: boolean;
  };
};

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export type GateStatus = 'pass' | 'fail' | 'degraded';

export type AutomationHealth = {
  timestamp: string;
  automationReady: boolean;
  gates: {
    mongodb: { status: GateStatus; detail: string };
    brokerApi: { status: GateStatus; detail: string };
    brokerMode: { status: GateStatus; detail: string; mode: string };
    marketClock: { status: GateStatus; detail: string; state: MarketClockState };
    massiveMarketData: { status: GateStatus; detail: string };
    reconciliation: { status: GateStatus; detail: string; lastRunAt: string | null };
  };
};

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export type ReconciliationMismatch = {
  kind:
    | 'LOCAL_ORDER_MISSING_AT_BROKER'
    | 'BROKER_ORDER_MISSING_LOCALLY'
    | 'AUTOMATION_POSITION_ORDER_MISSING'
    | 'STATUS_CONFLICT';
  detail: string;
  automationSessionId?: string | null;
  intentId?: string | null;
  brokerOrderId?: string | null;
  clientOrderId?: string | null;
  symbol?: string | null;
  resolution: 'IMPORTED' | 'MANUAL_REVIEW' | 'SESSION_PAUSED' | 'FLAGGED';
};

export type ReconciliationReport = {
  startedAt: Date;
  finishedAt: Date;
  status: ReconciliationStatus;
  sessionsScanned: number;
  intentsScanned: number;
  brokerOpenOrders: number;
  /** Count of AUTOMATION-owned live positions proven against broker orders. */
  automationPositionsReconciled: number;
  matchedOrders: number;
  mismatches: ReconciliationMismatch[];
  pausedSessionIds: string[];
  error?: string;
};

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type AutomationEventSeverity = 'info' | 'warning' | 'critical';

export type AutomationEventInput = {
  service: string;
  event: string;
  severity?: AutomationEventSeverity;
  automationSessionId?: string | null;
  intentId?: string | null;
  brokerOrderId?: string | null;
  symbol?: string | null;
  payload?: Record<string, unknown>;
};
