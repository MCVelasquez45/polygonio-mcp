import { useMemo } from 'react';
import { useNow } from '../../hooks/useNow';
import { useCockpitLiveSubscription } from '../../hooks/useCockpitLiveSubscription';
import { useLiveConnection } from '../../hooks/useLiveConnection';
import { useLiveQuote } from '../../lib/liveMarketStore';
import { finiteOrNull, freshnessOf, type QuoteFreshness } from '../../lib/marketFormat';
import { deriveMarketDataStatus, type MarketDataStatus } from '../../lib/marketDataStatus';
import type { QuoteSnapshot } from '../../types/market';
import type { CockpitTrade } from './cockpitUi';
import { QUOTE_PROVIDER_UNAVAILABLE } from './cockpitDisplay';

const QUOTE_FRESH_THRESHOLD_MS = 10_000;

export type CockpitQuoteState = {
  symbol: string;
  quote: QuoteSnapshot | null;
  source: 'live' | 'snapshot' | 'unavailable';
  bid: number | null;
  ask: number | null;
  mid: number | null;
  mark: number | null;
  spreadAbs: number | null;
  spreadPct: number | null;
  bidSize: number | null;
  askSize: number | null;
  quoteAgeMs: number | null;
  lastUpdate: number | null;
  freshness: QuoteFreshness;
  /** Unified market-data status: LIVE / SNAPSHOT / DELAYED / STALE / DISCONNECTED (null = no quote). */
  status: MarketDataStatus | null;
  hasQuote: boolean;
  liveFeedConnected: boolean;
  unavailableReason: string | null;
};

export function buildCockpitQuoteState(
  trade: CockpitTrade,
  liveQuote: QuoteSnapshot | null,
  now: number,
  liveFeedConnected = true
): CockpitQuoteState {
  const symbol = trade.optionSymbol;
  const liveBid = finiteOrNull(liveQuote?.bidPrice);
  const liveAsk = finiteOrNull(liveQuote?.askPrice);
  const liveMid =
    finiteOrNull(liveQuote?.midpoint) ?? (liveBid !== null && liveAsk !== null ? (liveBid + liveAsk) / 2 : null);

  const snapshotBid = finiteOrNull(trade.currentBid);
  const snapshotAsk = finiteOrNull(trade.currentAsk);
  const snapshotMid =
    finiteOrNull(trade.currentMid) ?? (snapshotBid !== null && snapshotAsk !== null ? (snapshotBid + snapshotAsk) / 2 : null);

  const bid = liveBid ?? snapshotBid;
  const ask = liveAsk ?? snapshotAsk;
  const mid = liveMid ?? snapshotMid;
  const mark = mid ?? finiteOrNull(trade.currentMark);
  const spreadAbs = bid !== null && ask !== null ? ask - bid : null;
  const spreadPct =
    spreadAbs !== null && mid !== null && mid > 0
      ? (spreadAbs / mid) * 100
      : finiteOrNull(trade.currentSpreadPct);

  const liveTs = finiteOrNull(liveQuote?.timestamp);
  const snapshotTs = trade.lastQuoteTimestamp ? Date.parse(trade.lastQuoteTimestamp) : null;
  const lastUpdate = liveTs ?? (Number.isFinite(snapshotTs) ? snapshotTs : null);
  const quoteAgeMs = liveTs !== null ? now - liveTs : finiteOrNull(trade.quoteAgeMs);
  const source = liveQuote ? 'live' : bid !== null || ask !== null || mid !== null || mark !== null ? 'snapshot' : 'unavailable';
  const unavailableReason = source !== 'unavailable'
    ? null
    : liveFeedConnected
      ? `${QUOTE_PROVIDER_UNAVAILABLE} No NBBO tick has been received for this contract yet.`
      : `${QUOTE_PROVIDER_UNAVAILABLE} The live quote socket is disconnected and retrying.`;

  // Unified status, derived from how the value actually arrived + its age +
  // whether the live link is up. A live option quote on a connected socket is
  // LIVE; the same contract on a dropped socket is DISCONNECTED (value retained).
  const { status } = deriveMarketDataStatus({
    source: source === 'live' ? 'stream' : source === 'snapshot' ? 'rest' : null,
    ageMs: quoteAgeMs,
    connected: liveFeedConnected,
    staleThresholdMs: QUOTE_FRESH_THRESHOLD_MS,
  });

  return {
    symbol,
    quote: liveQuote,
    source,
    bid,
    ask,
    mid,
    mark,
    spreadAbs,
    spreadPct,
    bidSize: finiteOrNull(liveQuote?.bidSize),
    askSize: finiteOrNull(liveQuote?.askSize),
    quoteAgeMs,
    lastUpdate,
    freshness: freshnessOf(quoteAgeMs, QUOTE_FRESH_THRESHOLD_MS),
    status,
    hasQuote: source !== 'unavailable',
    liveFeedConnected,
    unavailableReason,
  };
}

export function useCockpitQuote(trade: CockpitTrade): CockpitQuoteState {
  useCockpitLiveSubscription(trade.optionSymbol);
  const liveQuote = useLiveQuote(trade.optionSymbol);
  const now = useNow(1000);
  // One shared connection source for the whole app — a reconnect surfaces as
  // DISCONNECTED here honestly, instead of each panel tracking its own boolean.
  const { connected: liveFeedConnected } = useLiveConnection();

  return useMemo(
    () => buildCockpitQuoteState(trade, liveQuote, now, liveFeedConnected),
    [
      trade,
      liveQuote,
      now,
      liveFeedConnected,
    ]
  );
}
