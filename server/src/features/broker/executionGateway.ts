import { createHash } from 'crypto';

// Execution boundary — the single authorization point for MANUAL broker
// submissions. Research and contract selection never reach here; automation has
// its own governed path (order intents + risk + scheduler lease) and is
// explicitly REJECTED if it tries to submit through the manual gateway.
//
// Every check fails closed. Execution mode and authorization are ALWAYS
// explicit — never inferred from a client-order-id prefix, route, component, or
// environment. A missing/ambiguous mode is a rejection, never a default.

export type ExecutionMode = 'MANUAL' | 'AUTOMATED';
export type OrderSource = 'MANUAL_UI' | 'AUTOMATION_ENGINE';

export const MANUAL_CLIENT_ORDER_PREFIX = 'manual-';
export const AUTOMATION_CLIENT_ORDER_PREFIX = 'auto-';

/** Deterministic reject reasons (stable strings for logs + tests). */
export const GATE_REASON = {
  MISSING_EXECUTION_MODE: 'MISSING_EXECUTION_MODE',
  INVALID_EXECUTION_MODE: 'INVALID_EXECUTION_MODE',
  MISSING_ORDER_SOURCE: 'MISSING_ORDER_SOURCE',
  INVALID_ORDER_SOURCE: 'INVALID_ORDER_SOURCE',
  MODE_SOURCE_MISMATCH: 'MODE_SOURCE_MISMATCH',
  AUTOMATION_MUST_USE_ENGINE_PATH: 'AUTOMATION_MUST_USE_ENGINE_PATH',
  MISSING_AUTHORIZATION_ID: 'MISSING_AUTHORIZATION_ID',
  MISSING_IDEMPOTENCY_KEY: 'MISSING_IDEMPOTENCY_KEY',
  MANUAL_INTENT_NOT_CONFIRMED: 'MANUAL_INTENT_NOT_CONFIRMED',
  PAYLOAD_CHANGED_SINCE_CONFIRMATION: 'PAYLOAD_CHANGED_SINCE_CONFIRMATION',
  MANUAL_TRADING_DISABLED: 'MANUAL_TRADING_DISABLED',
  MONGO_UNAVAILABLE: 'MONGO_UNAVAILABLE',
  MARKET_CLOCK_UNAVAILABLE: 'MARKET_CLOCK_UNAVAILABLE',
} as const;

export type GateReason = (typeof GATE_REASON)[keyof typeof GATE_REASON];

export type ExecutionGateResult =
  | { authorized: true; rejectionReason: null }
  | { authorized: false; rejectionReason: GateReason };

const VALID_MODES: ReadonlySet<string> = new Set<ExecutionMode>(['MANUAL', 'AUTOMATED']);
const VALID_SOURCES: ReadonlySet<string> = new Set<OrderSource>(['MANUAL_UI', 'AUTOMATION_ENGINE']);

export type ManualGateInput = {
  /** Explicit, never inferred. */
  executionMode?: string | null;
  orderSource?: string | null;
  /** The confirmed manual-intent id (authorization) and its idempotency key. */
  authorizationId?: string | null;
  idempotencyKey?: string | null;
  /** Durable manual intent is CONFIRMED. */
  confirmed: boolean;
  /** The confirmed payload hash still matches the payload being submitted. */
  payloadUnchanged: boolean;
  /** Infrastructure / operational gates (all must be healthy). */
  gates: {
    manualTradingEnabled: boolean;
    mongoConnected: boolean;
    clockAvailable: boolean;
  };
};

const reject = (rejectionReason: GateReason): ExecutionGateResult => ({ authorized: false, rejectionReason });

/**
 * Authorize ONE manual broker submission. Pure and deterministic — the route
 * gathers the live gate state and this decides. Order of checks is intentional:
 * identity/authority first (so an automation-claiming or unconfirmed request is
 * rejected before any infrastructure state is considered), then fail-closed
 * infrastructure gates.
 */
export function authorizeManualSubmission(input: ManualGateInput): ExecutionGateResult {
  const mode = input.executionMode;
  const source = input.orderSource;

  if (mode == null || mode === '') return reject(GATE_REASON.MISSING_EXECUTION_MODE);
  if (!VALID_MODES.has(mode)) return reject(GATE_REASON.INVALID_EXECUTION_MODE);
  if (source == null || source === '') return reject(GATE_REASON.MISSING_ORDER_SOURCE);
  if (!VALID_SOURCES.has(source)) return reject(GATE_REASON.INVALID_ORDER_SOURCE);

  // Automation may NEVER submit through the manual gateway — it has its own
  // deterministic, risk-gated, lease-protected path. Reject before anything else.
  if (mode === 'AUTOMATED' || source === 'AUTOMATION_ENGINE') {
    return reject(GATE_REASON.AUTOMATION_MUST_USE_ENGINE_PATH);
  }
  // At this point mode must be MANUAL; source must be MANUAL_UI.
  if (mode !== 'MANUAL') return reject(GATE_REASON.MODE_SOURCE_MISMATCH);
  if (source !== 'MANUAL_UI') return reject(GATE_REASON.MODE_SOURCE_MISMATCH);

  if (!input.authorizationId) return reject(GATE_REASON.MISSING_AUTHORIZATION_ID);
  if (!input.idempotencyKey) return reject(GATE_REASON.MISSING_IDEMPOTENCY_KEY);
  if (!input.confirmed) return reject(GATE_REASON.MANUAL_INTENT_NOT_CONFIRMED);
  if (!input.payloadUnchanged) return reject(GATE_REASON.PAYLOAD_CHANGED_SINCE_CONFIRMATION);

  if (!input.gates.manualTradingEnabled) return reject(GATE_REASON.MANUAL_TRADING_DISABLED);
  if (!input.gates.mongoConnected) return reject(GATE_REASON.MONGO_UNAVAILABLE);
  if (!input.gates.clockAvailable) return reject(GATE_REASON.MARKET_CLOCK_UNAVAILABLE);

  return { authorized: true, rejectionReason: null };
}

/**
 * Deterministic MANUAL client_order_id: same intent + attempt → same id; two
 * intents can never collide. Respects Alpaca's ≤48-char / safe-charset limit by
 * hashing. The id is a correlation identity, NOT an authorization mechanism.
 */
export function manualClientOrderId(intentId: string, attempt: number): string {
  const hash = createHash('sha256').update(`${intentId}:${attempt}`).digest('hex').slice(0, 32);
  return `${MANUAL_CLIENT_ORDER_PREFIX}${hash}`;
}

/** Stable hash of the order fields that must not change between confirm and submit. */
export function orderPayloadHash(order: unknown): string {
  return createHash('sha256').update(JSON.stringify(order ?? null)).digest('hex');
}
