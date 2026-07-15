// Central constants for the automation safety foundation (Phase 2A).
// No trading strategy logic lives in this feature yet — by design, nothing in
// this module may translate a market signal into a broker submission.

export const AUTOMATION_SERVICE_PREFIX = 'automation';

export const AUTOMATION_COLLECTIONS = {
  sessions: 'automation_sessions',
  orderIntents: 'automation_order_intents',
  brokerOrders: 'automation_broker_orders',
  events: 'automation_events',
  // Sprint 2E — the watchlist IS the authoritative automation universe.
  watchlist: 'automation_watchlist',
} as const;

// Environment keys (documented in docs/automation/phase-2a-safety-foundation.md).
export const AUTOMATION_ENV = {
  enabled: 'AUTOMATION_ENABLED', // default 'true'; 'false' disables init entirely
  broker: 'AUTOMATION_BROKER', // 'alpaca-paper' (default) | 'mock'
  clockTtlMs: 'AUTOMATION_CLOCK_TTL_MS',
  brokerTimeoutMs: 'AUTOMATION_BROKER_TIMEOUT_MS',
} as const;

// Market-clock decisions are cached briefly so health polling doesn't hammer
// the broker; staleness beyond MAX_AGE blocks entries.
export const CLOCK_DECISION_TTL_MS = Number(process.env.AUTOMATION_CLOCK_TTL_MS ?? 15_000);
export const CLOCK_DECISION_MAX_AGE_MS = 60_000;

export const BROKER_CALL_TIMEOUT_MS = Number(process.env.AUTOMATION_BROKER_TIMEOUT_MS ?? 8_000);

// Idempotency keys are derived from exactly these inputs, in this order.
export const IDEMPOTENCY_KEY_FIELDS = [
  'automationSessionId',
  'strategyVersionId',
  'underlying',
  'signalDirection',
  'closedBarTimestamp',
  'intentType',
] as const;

// client_order_id sent to the broker. Alpaca allows up to 48 chars.
export const CLIENT_ORDER_ID_PREFIX = 'at2a-';

// Log-redaction: any key matching this pattern is masked in structured events.
export const SENSITIVE_KEY_PATTERN = /key|secret|token|password|authorization|credential|cookie/i;
