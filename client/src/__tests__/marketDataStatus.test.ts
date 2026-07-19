import { describe, expect, it } from 'vitest';
import {
  deriveMarketDataStatus,
  fmtQuoteAge,
  marketDataAgeLabel,
  marketDataStatusLabel,
  DEFAULT_STREAM_STALE_MS,
} from '../lib/marketDataStatus';

describe('deriveMarketDataStatus', () => {
  it('returns null (no quote) only when there is no source', () => {
    expect(deriveMarketDataStatus({ source: null, ageMs: 1234 }).status).toBeNull();
    expect(deriveMarketDataStatus({ source: null, ageMs: null }).status).toBeNull();
  });

  it('LIVE: streamed, connected, fresh', () => {
    expect(
      deriveMarketDataStatus({ source: 'stream', ageMs: 200, connected: true }).status
    ).toBe('LIVE');
  });

  it('never fabricates LIVE: a fresh streamed value with the link DOWN is DISCONNECTED', () => {
    // Age is well within the fresh threshold, but the socket is down — the only
    // honest status is DISCONNECTED, never LIVE.
    expect(
      deriveMarketDataStatus({ source: 'stream', ageMs: 200, connected: false }).status
    ).toBe('DISCONNECTED');
  });

  it('STALE: streamed + connected but older than the threshold', () => {
    expect(
      deriveMarketDataStatus({
        source: 'stream',
        ageMs: DEFAULT_STREAM_STALE_MS + 1,
        connected: true,
      }).status
    ).toBe('STALE');
  });

  it('DELAYED: provider flags the stream as delayed', () => {
    expect(
      deriveMarketDataStatus({ source: 'stream', ageMs: 200, connected: true, delayed: true }).status
    ).toBe('DELAYED');
  });

  it('SNAPSHOT: REST value within threshold, regardless of socket', () => {
    expect(deriveMarketDataStatus({ source: 'rest', ageMs: 500, connected: false }).status).toBe(
      'SNAPSHOT'
    );
  });

  it('REST is never LIVE and never DISCONNECTED by the socket', () => {
    const s = deriveMarketDataStatus({ source: 'rest', ageMs: 500, connected: false }).status;
    expect(s).not.toBe('LIVE');
    expect(s).not.toBe('DISCONNECTED');
  });

  it('REST goes STALE past its (larger) threshold', () => {
    expect(deriveMarketDataStatus({ source: 'rest', ageMs: 120_000 }).status).toBe('STALE');
  });

  it('a value of unknown age is still SNAPSHOT/LIVE, not "No quote"', () => {
    expect(deriveMarketDataStatus({ source: 'rest', ageMs: null }).status).toBe('SNAPSHOT');
    expect(
      deriveMarketDataStatus({ source: 'stream', ageMs: null, connected: true }).status
    ).toBe('LIVE');
  });

  it('is provider-agnostic: the SAME quote upgrades REST→SNAPSHOT to stream→LIVE with no other change', () => {
    // The day an equity stream entitlement turns on, the exact same symbol flows
    // through source:'stream' and the UI reports LIVE automatically.
    const asRest = deriveMarketDataStatus({ source: 'rest', ageMs: 300, connected: true });
    const asStream = deriveMarketDataStatus({ source: 'stream', ageMs: 300, connected: true });
    expect(asRest.status).toBe('SNAPSHOT');
    expect(asStream.status).toBe('LIVE');
  });
});

describe('fmtQuoteAge', () => {
  it('renders absent/negative ages as null (never a fake age)', () => {
    expect(fmtQuoteAge(null)).toBeNull();
    expect(fmtQuoteAge(undefined)).toBeNull();
    expect(fmtQuoteAge(-5)).toBeNull();
  });

  it('renders compact relative phrases', () => {
    expect(fmtQuoteAge(500)).toBe('just now');
    expect(fmtQuoteAge(1500)).toBe('just now');
    expect(fmtQuoteAge(18_000)).toBe('18s ago');
    expect(fmtQuoteAge(161_000)).toBe('2m 41s ago');
    expect(fmtQuoteAge(3_900_000)).toBe('1h 5m ago');
  });
});

describe('labels', () => {
  it('marketDataStatusLabel', () => {
    expect(marketDataStatusLabel('LIVE')).toBe('Live');
    expect(marketDataStatusLabel('DISCONNECTED')).toBe('Disconnected');
    expect(marketDataStatusLabel(null)).toBe('No quote');
  });

  it('marketDataAgeLabel uses fresh vs retained framing', () => {
    expect(marketDataAgeLabel('LIVE', 500)).toBe('Updated just now');
    expect(marketDataAgeLabel('SNAPSHOT', 18_000)).toBe('Updated 18s ago');
    expect(marketDataAgeLabel('STALE', 161_000)).toBe('Last update 2m 41s ago');
    expect(marketDataAgeLabel('DISCONNECTED', 161_000)).toBe('Last update 2m 41s ago');
  });

  it('marketDataAgeLabel prefers an explicit delay note for DELAYED', () => {
    expect(marketDataAgeLabel('DELAYED', 500, '15-minute delayed')).toBe('15-minute delayed');
  });
});
