// Unified market-data status model for the whole application.
//
// The status of any quote is a PURE FUNCTION of three honest inputs:
//   1. how the latest retained value arrived  (`source`: 'stream' | 'rest')
//   2. how old that value is                  (`ageMs`)
//   3. whether the live provider link is up   (`connected`)
//
// Nothing here is hard-coded to an asset class. Options happen to arrive via
// 'stream' today and equities via 'rest', but the day a stock-stream
// entitlement is enabled, equity quotes flow through the same 'stream' path
// and this function reports LIVE for them automatically — no redesign, no
// per-symbol special-casing. That is the entire point: the UI reflects the
// data flow that actually exists, and never fabricates a LIVE badge.

import { finiteOrNull } from './marketFormat';

export type MarketDataStatus =
  | 'LIVE' // streaming, connected, fresh within threshold
  | 'SNAPSHOT' // REST-fetched point-in-time value, within threshold
  | 'DELAYED' // provider explicitly marks the data as delayed (e.g. 15-min)
  | 'STALE' // last value retained, freshness threshold exceeded
  | 'DISCONNECTED'; // streaming provider link is down; last value retained

/** How the latest retained value for a symbol actually arrived. */
export type MarketDataSource = 'stream' | 'rest';

/** Default age past which a streamed value is considered STALE. */
export const DEFAULT_STREAM_STALE_MS = 10_000;
/** Default age past which a REST snapshot is considered STALE. */
export const DEFAULT_REST_STALE_MS = 60_000;

/** Canonical provider name — single-sourced so the UI stays provider-agnostic. */
export const MARKET_DATA_PROVIDER = 'Massive';

export type MarketDataStatusInput = {
  /** 'stream' | 'rest' | null (null == no value has been retained at all). */
  source: MarketDataSource | null;
  /** Age of the latest retained value in ms, or null when there is no value. */
  ageMs: number | null;
  /** Is the live streaming link up? Only meaningful for `source: 'stream'`. */
  connected?: boolean;
  /** Provider explicitly flags this data as delayed (e.g. delayed-only equity). */
  delayed?: boolean;
  /** Age past which the value is STALE. Defaults by source. */
  staleThresholdMs?: number;
};

export type MarketDataStatusResult = {
  /** null == no data at all; caller renders a "No quote" placeholder. */
  status: MarketDataStatus | null;
  ageMs: number | null;
};

/**
 * Derive the market-data status from the honest facts about the latest value.
 *
 * Precedence is deterministic:
 *  - No value                                   -> null
 *  - stream + link down                         -> DISCONNECTED (value retained)
 *  - stream|rest + older than threshold         -> STALE
 *  - provider-flagged delayed                   -> DELAYED
 *  - stream + connected + fresh                 -> LIVE
 *  - rest + fresh                               -> SNAPSHOT
 *
 * REST snapshots never depend on the socket: a REST value is SNAPSHOT/DELAYED/
 * STALE regardless of the live socket, because it did not come from the socket.
 */
export function deriveMarketDataStatus(input: MarketDataStatusInput): MarketDataStatusResult {
  // The ONLY "no data" gate is the absence of a source. A value can exist with
  // an unknown age (a REST snapshot without a timestamp); that is still a
  // SNAPSHOT, never "No quote".
  if (input.source === null) return { status: null, ageMs: null };

  const rawAge = finiteOrNull(input.ageMs);
  const ageMs = rawAge !== null && rawAge >= 0 ? rawAge : null;
  const threshold =
    input.staleThresholdMs ??
    (input.source === 'stream' ? DEFAULT_STREAM_STALE_MS : DEFAULT_REST_STALE_MS);
  // Stale only when we actually know the age and it exceeds the threshold.
  const isStale = ageMs !== null && ageMs > threshold;

  if (input.source === 'stream') {
    // A streamed feed with its provider link down is DISCONNECTED, not LIVE —
    // even if the last value is still within the freshness threshold. We retain
    // the value for display but never claim it is live.
    if (input.connected === false) return { status: 'DISCONNECTED', ageMs };
    if (isStale) return { status: 'STALE', ageMs };
    if (input.delayed) return { status: 'DELAYED', ageMs };
    return { status: 'LIVE', ageMs };
  }

  // source === 'rest'
  if (isStale) return { status: 'STALE', ageMs };
  if (input.delayed) return { status: 'DELAYED', ageMs };
  return { status: 'SNAPSHOT', ageMs };
}

const STATUS_LABEL: Record<MarketDataStatus, string> = {
  LIVE: 'Live',
  SNAPSHOT: 'Snapshot',
  DELAYED: 'Delayed',
  STALE: 'Stale',
  DISCONNECTED: 'Disconnected',
};

/** Short human status word, e.g. for a badge title. */
export function marketDataStatusLabel(status: MarketDataStatus | null): string {
  return status ? STATUS_LABEL[status] : 'No quote';
}

/**
 * Compact relative age phrase: 'just now', '18s ago', '2m 41s ago', '1h 4m ago'.
 * Returns null when the age is absent or negative (never renders a fake age).
 */
export function fmtQuoteAge(ageMs: number | null | undefined): string | null {
  const ms = finiteOrNull(ageMs);
  if (ms === null || ms < 0) return null;
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 2) return 'just now';
  if (totalSeconds < 60) return `${totalSeconds}s ago`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s ago`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${remMinutes}m ago`;
}

/**
 * Full freshness sub-label composed from status + age, honoring the operator's
 * expected phrasing:
 *   LIVE/SNAPSHOT/DELAYED -> "Updated <age>"   (fresh-facing verbs)
 *   STALE/DISCONNECTED    -> "Last update <age>" (retained-value framing)
 * `delayLabel` overrides the age line for DELAYED (e.g. "15-minute delayed").
 */
export function marketDataAgeLabel(
  status: MarketDataStatus | null,
  ageMs: number | null | undefined,
  delayLabel?: string
): string | null {
  if (status === 'DELAYED' && delayLabel) return delayLabel;
  const age = fmtQuoteAge(ageMs);
  if (age === null) return null;
  if (status === 'STALE' || status === 'DISCONNECTED') return `Last update ${age}`;
  return `Updated ${age}`;
}
