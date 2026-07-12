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
    return Math.min(headerDelay, opts.maxMs);
  }
  const backoff = opts.baseMs * Math.pow(2, Math.max(0, attempt));
  return Math.min(backoff, opts.maxMs);
}
