export type LogSeverity = 'debug' | 'info' | 'warning' | 'error' | 'critical';

export const SENSITIVE_KEY_PATTERN = /key|secret|token|password|authorization|credential|cookie/i;

const MAX_STRING_LENGTH = 2_000;
const MAX_DEPTH = 6;

export function redactForLog(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth > MAX_DEPTH) return '[max-depth]';
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 100).map(item => redactForLog(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : redactForLog(val, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function serializeErrorForLog(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const withStatus = error as Error & { status?: unknown; code?: unknown; response?: { status?: unknown } };
    return redactForLog({
      name: error.name,
      message: error.message,
      status: withStatus.status ?? withStatus.response?.status ?? null,
      code: withStatus.code ?? null,
    }) as Record<string, unknown>;
  }
  return { message: String(redactForLog(error)) };
}

export function writeStructuredLog(entry: {
  component: string;
  module: string;
  event: string;
  severity?: LogSeverity;
  requestId?: string;
  sessionId?: string;
  tradeId?: string;
  context?: Record<string, unknown>;
}): void {
  const severity = entry.severity ?? 'info';
  const record = {
    timestamp: new Date().toISOString(),
    component: entry.component,
    module: entry.module,
    event: entry.event,
    severity,
    ...(entry.requestId ? { requestId: entry.requestId } : {}),
    ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
    ...(entry.tradeId ? { tradeId: entry.tradeId } : {}),
    ...(entry.context ? { context: redactForLog(entry.context) } : {}),
  };
  const line = JSON.stringify(record);
  if (severity === 'critical' || severity === 'error') {
    console.error(line);
  } else if (severity === 'warning') {
    console.warn(line);
  } else if (severity === 'debug') {
    console.debug(line);
  } else {
    console.log(line);
  }
}
