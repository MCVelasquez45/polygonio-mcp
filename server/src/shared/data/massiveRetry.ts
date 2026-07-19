import axios from 'axios';

// Single authoritative retry policy for all Massive HTTP access.
//
// Massive is a Polygon-compatible API. Its public docs do not publish a numeric
// rate-limit policy, so this follows the HTTP standard for 429 (honor the
// `Retry-After` header when present) plus transient 5xx / network timeouts.
// Both the shared REST wrapper (`massive.ts`) and the aggregates provider
// (`massiveProvider.ts`) use these helpers so retry behavior can never drift
// between call sites again.

/** HTTP statuses worth retrying: rate-limit + transient upstream failures. */
export const MASSIVE_RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * Thrown when Massive reports the request is outside the account's plan
 * (HTTP 403 or a `status: "NOT_AUTHORIZED"` body). These are NEVER retried:
 * retrying an entitlement failure only burns rate-limit budget.
 */
export class MassiveEntitlementError extends Error {
  readonly isEntitlementError = true as const;
  readonly httpStatus: number | null;
  readonly path: string;

  constructor(path: string, httpStatus: number | null, providerMessage?: string) {
    super(
      `Massive entitlement failure for ${path}` +
        (providerMessage ? `: ${providerMessage}` : '') +
        (httpStatus != null ? ` (HTTP ${httpStatus})` : '')
    );
    this.name = 'MassiveEntitlementError';
    this.httpStatus = httpStatus;
    this.path = path;
  }
}

/** Detects a plan/entitlement failure from an HTTP error or a 2xx body. */
export function isEntitlementFailure(httpStatus: number | null | undefined, body: unknown): boolean {
  if (httpStatus === 403) return true;
  if (body && typeof body === 'object') {
    const status = (body as Record<string, unknown>).status;
    if (typeof status === 'string' && status.toUpperCase() === 'NOT_AUTHORIZED') return true;
  }
  return false;
}

/**
 * Full jitter around a base delay: uniform in [base * (1 - spread), base * (1 + spread)].
 * Prevents synchronized retry bursts from amplifying provider throttling.
 */
export function applyRetryJitter(baseMs: number, spread = 0.25, rand: () => number = Math.random): number {
  if (!Number.isFinite(baseMs) || baseMs <= 0) return 0;
  const s = Math.min(Math.max(spread, 0), 1);
  const factor = 1 - s + rand() * 2 * s;
  return Math.round(baseMs * factor);
}

/**
 * Parse a `Retry-After` header into milliseconds. Supports the two documented
 * forms: delta-seconds (e.g. "5") and an HTTP-date. Returns null if absent or
 * unparseable.
 */
export function parseRetryAfterMs(header: unknown): number | null {
  if (header == null) return null;
  if (typeof header === 'number' && Number.isFinite(header)) {
    return header * 1000;
  }
  if (typeof header === 'string') {
    const seconds = Number(header);
    if (!Number.isNaN(seconds)) {
      return seconds * 1000;
    }
    const date = new Date(header);
    if (!Number.isNaN(date.getTime())) {
      const delta = date.getTime() - Date.now();
      if (delta > 0) return delta;
    }
  }
  return null;
}

/** Read the `Retry-After` header from an axios error (case-insensitive). */
function retryAfterHeader(error: unknown): unknown {
  if (!axios.isAxiosError(error)) return undefined;
  const headers = error.response?.headers;
  if (!headers) return undefined;
  return headers['retry-after'] ?? headers['Retry-After'];
}

/**
 * Whether a Massive request error should be retried, given the attempt index
 * (0-based) and the caller's max retry budget. Retries network timeouts and
 * any status in {@link MASSIVE_RETRYABLE_STATUS} — including 429.
 */
export function isRetryableMassiveError(error: unknown, attempt: number, maxRetries: number): boolean {
  if (attempt >= maxRetries) return false;
  if (error instanceof MassiveEntitlementError) return false;
  if (!axios.isAxiosError(error)) return false;
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return true;
  }
  const status = error.response?.status;
  return typeof status === 'number' && MASSIVE_RETRYABLE_STATUS.has(status);
}

/**
 * How long to wait before the next retry. Honors `Retry-After` when the server
 * sends it (this is the correct behavior for 429); otherwise uses exponential
 * backoff. The result is always clamped to `[0, maxMs]`.
 */
export function resolveMassiveRetryDelayMs(
  error: unknown,
  attempt: number,
  opts: { baseMs: number; maxMs: number }
): number {
  const headerDelay = parseRetryAfterMs(retryAfterHeader(error));
  if (typeof headerDelay === 'number' && headerDelay > 0) {
    // Provider-directed retry time is authoritative (never clamped below it);
    // jitter only upward so we never retry *before* the provider asked us to.
    return headerDelay + applyRetryJitter(headerDelay * 0.1);
  }
  const backoff = opts.baseMs * Math.pow(2, Math.max(0, attempt));
  return applyRetryJitter(Math.min(backoff, opts.maxMs));
}
