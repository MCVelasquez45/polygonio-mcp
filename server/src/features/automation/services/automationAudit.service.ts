import mongoose from 'mongoose';
import { AUTOMATION_SERVICE_PREFIX, SENSITIVE_KEY_PATTERN } from '../automation.constants';
import { AutomationEventModel } from '../models/automationEvent.model';
import type { AutomationEventInput, AutomationEventSeverity } from '../automation.types';

// Structured, redacted audit logging.
//
// Every event: (1) is printed as a single JSON line with an ISO timestamp,
// (2) is appended to the automation_events collection when Mongo is up.
// Console logging never throws into the trading path; Mongo persistence is
// fire-and-forget with a console fallback marker on failure.

const MAX_STRING_LENGTH = 2_000;
const MAX_DEPTH = 6;

function isMongoConnected(): boolean {
  return mongoose.connection?.readyState === 1;
}

/**
 * Recursively redacts sensitive values by key pattern and masks anything that
 * looks like a credential. Also bounds depth/length so a pathological payload
 * cannot blow up the journal.
 */
export function redactPayload(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth > MAX_DEPTH) return '[max-depth]';
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 100).map(item => redactPayload(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = '[redacted]';
      } else {
        out[key] = redactPayload(val, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

/** Masks an account identifier to its last 4 characters. */
export function maskAccountId(accountId: string | null | undefined): string {
  if (!accountId) return '[none]';
  const raw = String(accountId);
  return raw.length <= 4 ? '****' : `****${raw.slice(-4)}`;
}

export type LoggedAutomationEvent = {
  timestamp: string;
  service: string;
  event: string;
  severity: AutomationEventSeverity;
  automationSessionId?: string;
  intentId?: string;
  brokerOrderId?: string;
  symbol?: string;
  payload?: unknown;
};

/**
 * Emit a structured automation event: JSON console line + Mongo append.
 * Returns the console-shaped record (useful for tests).
 */
export function logAutomationEvent(input: AutomationEventInput): LoggedAutomationEvent {
  const severity = input.severity ?? 'info';
  const safePayload = input.payload ? (redactPayload(input.payload) as Record<string, unknown>) : undefined;

  const record: LoggedAutomationEvent = {
    timestamp: new Date().toISOString(),
    service: `${AUTOMATION_SERVICE_PREFIX}-${input.service}`,
    event: input.event,
    severity,
    ...(input.automationSessionId ? { automationSessionId: input.automationSessionId } : {}),
    ...(input.intentId ? { intentId: input.intentId } : {}),
    ...(input.brokerOrderId ? { brokerOrderId: input.brokerOrderId } : {}),
    ...(input.symbol ? { symbol: input.symbol } : {}),
    ...(safePayload ? { payload: safePayload } : {}),
  };

  const line = JSON.stringify(record);
  if (severity === 'critical') {
    console.error(line);
  } else if (severity === 'warning') {
    console.warn(line);
  } else {
    console.log(line);
  }

  if (isMongoConnected()) {
    AutomationEventModel.create({
      timestamp: new Date(record.timestamp),
      service: record.service,
      event: record.event,
      severity,
      automationSessionId: input.automationSessionId ?? null,
      intentId: input.intentId ?? null,
      brokerOrderId: input.brokerOrderId ?? null,
      symbol: input.symbol ?? null,
      payload: safePayload ?? {},
    }).catch(error => {
      console.warn(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          service: `${AUTOMATION_SERVICE_PREFIX}-audit`,
          event: 'AUDIT_PERSIST_FAILED',
          severity: 'warning',
          payload: { message: (error as Error)?.message?.slice(0, 300) },
        })
      );
    });
  }

  return record;
}

/** Query helper for the session events endpoint. */
export async function listSessionEvents(automationSessionId: string, limit = 100) {
  return AutomationEventModel.find({ automationSessionId })
    .sort({ timestamp: -1 })
    .limit(Math.min(Math.max(limit, 1), 500))
    .lean();
}
