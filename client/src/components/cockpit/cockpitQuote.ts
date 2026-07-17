import { useEffect, useMemo, useState } from 'react';
import { useNow } from '../../hooks/useNow';
import { useCockpitLiveSubscription } from '../../hooks/useCockpitLiveSubscription';
import { useLiveQuote } from '../../lib/liveMarketStore';
import { getSharedSocket } from '../../lib/socket';
import { finiteOrNull, freshnessOf, type QuoteFreshness } from '../../lib/marketFormat';
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
    hasQuote: source !== 'unavailable',
    liveFeedConnected,
    unavailableReason,
  };
}

export function useCockpitQuote(trade: CockpitTrade): CockpitQuoteState {
  useCockpitLiveSubscription(trade.optionSymbol);
  const liveQuote = useLiveQuote(trade.optionSymbol);
  const now = useNow(1000);
  const [liveFeedConnected, setLiveFeedConnected] = useState(() => getSharedSocket().connected);

  useEffect(() => {
    const socket = getSharedSocket();
    const onConnect = () => setLiveFeedConnected(true);
    const onDisconnect = () => setLiveFeedConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    setLiveFeedConnected(socket.connected);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

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
