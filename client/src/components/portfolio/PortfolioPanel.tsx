import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { analysisApi, marketApi, portfolioApi } from '../../api';
import { getBrokerAccount, getBrokerClock, getOptionOrders, getOptionPositions } from '../../api/alpaca';
import {
  confirmManualIntent,
  createManualIntent,
  submitManualIntent,
  type ManualIntent,
} from '../../api/manualTrading';
import type { DeskInsight } from '../../api/analysis';
import type { PortfolioOperations, PortfolioRisk } from '../../api/portfolio';
import type { WatchlistSnapshot } from '../../types/market';
import {
  ActionButton,
  AlertBanner,
  DangerousActionButton,
  PnlValue,
  RefreshButton,
} from '../intelligence/ui';
import { MarketDataDot } from '../intelligence/ui/LiveStatus';
import { DonutChart } from '../intelligence/ui/charts/MicroCharts';
import type { ChartDatum } from '../intelligence/ui/charts/Charts';
import {
  fmtSignedUsd,
  fmtUsd,
  fmtNum,
  pnlTone,
  toneText,
  type Tone,
} from '../../lib/intelligenceFormat';
import { useCockpitLiveSubscription } from '../../hooks/useCockpitLiveSubscription';
import { useLiveConnection } from '../../hooks/useLiveConnection';
import { useNow } from '../../hooks/useNow';
import { useLiveQuote } from '../../lib/liveMarketStore';
import { finiteOrNull } from '../../lib/marketFormat';
import { deriveMarketDataStatus } from '../../lib/marketDataStatus';

type PositionView = {
  symbol: string;
  qty: number;
  side: 'long' | 'short';
  avgCost: number;
  mark: number;
  marketValue: number;
  unrealizedPnl: number;
};

type OrderView = {
  id: string;
  symbol: string;
  orderType: string;
  side: string;
  qty: number;
  filledQty: number;
  avgFillPrice: number | null;
  limitPrice: number | null;
  status: string;
  source?: string | null;
  submittedAt?: string | null;
  filledAt?: string | null;
  expiresAt?: string | null;
};

const INSIGHT_TTL_MS = 60 * 60 * 1000;

type Props = {
  aiEnabled?: boolean;
  sentimentEnabled?: boolean;
  onOpenSystemOperations?: () => void;
};

function toNumber(value: string | number | null | undefined, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toOptionalNumber(value: string | number | null | undefined) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatOrderType(type?: string | null, limitPrice?: number | null) {
  if (!type) return 'Market';
  const normalized = type.toLowerCase();
  if (normalized === 'limit' && typeof limitPrice === 'number') {
    return `Limit @ ${fmtUsd(limitPrice)}`;
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

/** Turn a raw broker status code (`PARTIALLY_FILLED`) into readable text (`Partially filled`). */
function formatOrderStatus(status?: string | null) {
  if (!status || status === '-') return '—';
  const words = status.replace(/[_-]+/g, ' ').trim().toLowerCase();
  if (!words) return '—';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Tone for an order status cell: filled = pos, working = warn, dead = muted. */
function orderStatusTone(status?: string | null): string {
  const normalized = status?.toLowerCase() ?? '';
  if (normalized === 'filled' || normalized === 'partially_filled') return 'text-intel-pos';
  if (['canceled', 'cancelled', 'expired', 'rejected'].includes(normalized)) return 'text-intel-ink3';
  return 'text-intel-warn';
}

/**
 * Present the order source to an operator. Known source codes map to plain
 * words; anything else (a raw broker client_order_id) is hidden behind a
 * generic label — the raw value stays available in a title tooltip.
 */
function formatOrderSource(source?: string | null) {
  if (!source) return '—';
  const normalized = source.trim().toUpperCase().replace(/[_-]+/g, ' ');
  if (normalized.includes('AUTOMATION')) return 'AUTO';
  if (normalized.includes('MANUAL')) return 'MANUAL';
  // A raw client_order_id (long/opaque token) is not operator-facing.
  if (/[0-9a-f]{8}/i.test(source) || source.length > 24) return 'BROKER';
  return normalized;
}

function formatTimestamp(value?: string | null) {
  if (!value) return 'Not recorded';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return 'Not recorded';
  return new Date(parsed).toLocaleString();
}

/** Compact blotter timestamp: `Jul 18 14:32` (local). */
function fmtWhen(value?: string | null) {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return '—';
  const d = new Date(parsed);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: '2-digit' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

function getUnderlyingSymbol(symbol: string) {
  const normalized = symbol.toUpperCase();
  const cleaned = normalized.startsWith('O:') ? normalized.slice(2) : normalized;
  const match = cleaned.match(/^([A-Z]+)(?=\d)/);
  return match?.[1] ?? normalized;
}

function normalizePositionSymbol(symbol: string) {
  return symbol.toUpperCase().replace(/^O:/, '');
}

function sentimentTone(label?: string | null): Tone {
  if (label === 'bullish') return 'pos';
  if (label === 'bearish') return 'neg';
  return 'neutral';
}

function parseOptionContract(symbol: string) {
  const normalized = symbol.toUpperCase();
  const cleaned = normalized.startsWith('O:') ? normalized.slice(2) : normalized;
  const match = cleaned.match(/^([A-Z]+)(\d{6})([CP])(\d{8})$/);
  if (!match) return null;
  const [, underlying, dateRaw, typeRaw, strikeRaw] = match;
  const year = Number(`20${dateRaw.slice(0, 2)}`);
  const month = Number(dateRaw.slice(2, 4));
  const day = Number(dateRaw.slice(4, 6));
  const expiry = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const strike = Number(strikeRaw) / 1000;
  return {
    underlying,
    expiry,
    type: typeRaw === 'C' ? 'Call' : 'Put',
    strike
  };
}

function isAbortError(error: any): boolean {
  return error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError' || error?.name === 'AbortError';
}

function isOpenOrder(status?: string | null) {
  if (!status) return false;
  const normalized = status.toLowerCase();
  return !['filled', 'canceled', 'cancelled', 'expired', 'rejected'].includes(normalized);
}

function getTakeProfitOrder(orders: OrderView[], position: PositionView) {
  const desiredSide = position.side === 'long' ? 'sell' : 'buy';
  const desiredPrefix = desiredSide.toLowerCase();
  return orders.find(order => {
    if (order.symbol !== position.symbol) return false;
    if (!isOpenOrder(order.status)) return false;
    const orderSide = order.side?.toLowerCase() ?? '';
    if (!orderSide.startsWith(desiredPrefix)) return false;
    return typeof order.limitPrice === 'number';
  });
}

/**
 * Map an Alpaca OSI option symbol (e.g. `SPY260724C00600000`) to the live-feed
 * key (`O:SPY260724C00600000`). The Massive stream and the shared quote store
 * key options with the `O:` prefix; the broker returns them without it.
 */
function toLiveOptionSymbol(symbol: string): string {
  return `O:${symbol.toUpperCase().replace(/^O:/, '')}`;
}

/** Roll up the per-session risk rows into a single book-level view. */
function aggregateRisk(risk: PortfolioRisk[] | null | undefined) {
  if (!risk || risk.length === 0) return null;
  let dailyRealizedPnl = 0;
  let consecutiveLossCount = 0;
  let currentDrawdown = 0;
  let maxDrawdown = 0;
  let emergencyStop = false;
  for (const row of risk) {
    dailyRealizedPnl += Number(row.dailyRealizedPnl ?? 0);
    consecutiveLossCount = Math.max(consecutiveLossCount, Number(row.consecutiveLossCount ?? 0));
    currentDrawdown = Math.max(currentDrawdown, Number(row.currentDrawdown ?? 0));
    maxDrawdown = Math.max(maxDrawdown, Number(row.maxDrawdown ?? 0));
    emergencyStop = emergencyStop || Boolean(row.emergencyStop);
  }
  return { dailyRealizedPnl, consecutiveLossCount, currentDrawdown, maxDrawdown, emergencyStop };
}

const BLOTTER_LABEL = 'font-mono text-[10px] uppercase tracking-label text-intel-ink3';
const TH = `py-2 pr-3 text-left ${BLOTTER_LABEL} font-normal`;
const TH_R = `py-2 pr-3 text-right ${BLOTTER_LABEL} font-normal`;
const TD = 'py-1.5 pr-3 whitespace-nowrap';
const TD_R = 'py-1.5 pr-3 whitespace-nowrap text-right tabular-nums';

/** One cell of the account summary strip: micro-label over a mono numeral. */
function AccountStat({
  label,
  value,
  tone = 'neutral' as Tone,
  title,
}: {
  label: string;
  value: string;
  tone?: Tone;
  title?: string;
}) {
  return (
    <div className="min-w-0 px-4 py-1" title={title}>
      <div className={BLOTTER_LABEL}>{label}</div>
      <div className={`mt-1 truncate font-mono text-sm font-semibold tabular-nums ${toneText(tone)}`}>{value}</div>
    </div>
  );
}

/**
 * One position row in the blotter, streamed live. Options ARE stream-entitled,
 * so this subscribes the contract to the shared live feed and overlays the
 * streamed NBBO mid on top of the REST snapshot (live ?? snapshot). The DATA
 * cell tells the operator whether the marks are LIVE, SNAPSHOT (no tick yet),
 * STALE, or DISCONNECTED — never a fake LIVE.
 */
function PositionBlotterRow({
  pos,
  source,
  spot,
  spotLoading,
  sentimentLabel,
  sentimentLoading,
  takeProfitPrice,
  closing,
  closeDisabled,
  onClose,
}: {
  pos: PositionView;
  source: 'AUTO' | 'MANUAL';
  spot: number | null;
  spotLoading: boolean;
  sentimentLabel: string | null;
  sentimentLoading: boolean;
  takeProfitPrice: number | null;
  closing: boolean;
  closeDisabled: boolean;
  onClose: () => void;
}) {
  const liveSymbol = toLiveOptionSymbol(pos.symbol);
  useCockpitLiveSubscription(liveSymbol);
  const liveQuote = useLiveQuote(liveSymbol);
  const { connected } = useLiveConnection();
  const now = useNow(1000);

  const liveBid = finiteOrNull(liveQuote?.bidPrice);
  const liveAsk = finiteOrNull(liveQuote?.askPrice);
  const liveMid =
    finiteOrNull(liveQuote?.midpoint) ??
    (liveBid !== null && liveAsk !== null ? (liveBid + liveAsk) / 2 : null);

  const snapshotMark = finiteOrNull(pos.mark);
  const mark = liveMid ?? snapshotMark;
  const qty = Math.max(1, Math.abs(pos.qty));
  const direction = pos.side === 'short' ? -1 : 1;
  const entry = finiteOrNull(pos.avgCost);
  const value = mark !== null ? mark * qty * 100 : finiteOrNull(pos.marketValue);
  const pnl =
    mark !== null && entry !== null
      ? (mark - entry) * direction * qty * 100
      : finiteOrNull(pos.unrealizedPnl);
  const entryValue = entry !== null ? entry * qty * 100 : null;
  const pnlPct = pnl !== null && entryValue ? (pnl / entryValue) * 100 : null;

  const liveTs = finiteOrNull(liveQuote?.timestamp);
  const ageMs = liveTs !== null ? now - liveTs : null;
  const { status } = deriveMarketDataStatus({
    source: liveQuote ? 'stream' : snapshotMark !== null ? 'rest' : null,
    ageMs,
    connected,
  });

  const contract = parseOptionContract(pos.symbol);
  const breakeven =
    contract && entry !== null
      ? contract.type === 'Call'
        ? contract.strike + entry
        : contract.strike - entry
      : entry;

  return (
    <tr className="border-b border-intel-lineSoft font-mono text-xs text-intel-ink2 transition-colors hover:bg-intel-panel2">
      <td className={`${TD} font-semibold text-intel-ink`}>{pos.symbol}</td>
      <td className={TD}>
        <span className={source === 'AUTO' ? 'text-intel-accent' : 'text-intel-ink2'}>{source}</span>
      </td>
      <td className={TD}>
        <span className={pos.side === 'long' ? 'text-intel-pos' : 'text-intel-neg'}>{pos.side.toUpperCase()}</span>
      </td>
      <td className={TD_R}>{Math.abs(pos.qty)}</td>
      <td className={TD}>{contract ? (contract.type === 'Call' ? 'C' : 'P') : '—'}</td>
      <td className={TD_R}>{contract ? fmtNum(contract.strike, 2) : '—'}</td>
      <td className={TD}>{contract?.expiry ?? '—'}</td>
      <td className={TD_R}>{spot != null ? fmtUsd(spot) : spotLoading ? '…' : '—'}</td>
      <td className={TD_R}>{fmtUsd(pos.avgCost)}</td>
      <td
        className={`${TD_R} text-intel-ink`}
        title={liveBid !== null || liveAsk !== null ? `BID ${fmtUsd(liveBid)} · ASK ${fmtUsd(liveAsk)}` : undefined}
      >
        {fmtUsd(mark)}
      </td>
      <td className={`${TD_R} text-intel-ink`}>{fmtUsd(value)}</td>
      <td className={TD_R}>
        <PnlValue value={pnl} pct={pnlPct} />
      </td>
      <td className={TD_R} title="Underlying price you need to break even at expiration.">
        {breakeven != null ? fmtUsd(breakeven) : '—'}
      </td>
      <td className={TD_R} title="Your open limit order price for taking profit.">
        {takeProfitPrice != null ? fmtUsd(takeProfitPrice) : '—'}
      </td>
      <td className={TD}>
        <span className={toneText(sentimentTone(sentimentLabel))}>
          {sentimentLoading ? '…' : sentimentLabel === 'bullish' ? 'BULL' : sentimentLabel === 'bearish' ? 'BEAR' : 'NEUT'}
        </span>
      </td>
      <td className={TD}>
        <MarketDataDot status={status} ageMs={ageMs} />
      </td>
      <td className="py-1 pr-2 text-right">
        <button
          type="button"
          aria-label={`Close position ${pos.symbol}`}
          onClick={onClose}
          disabled={closing || closeDisabled}
          className="rounded border border-intel-neg/40 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-intel-neg transition hover:bg-intel-neg/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {closing ? '…' : 'Close'}
        </button>
      </td>
    </tr>
  );
}

export function PortfolioPanel({ aiEnabled = true, sentimentEnabled = true, onOpenSystemOperations }: Props) {
  const [positions, setPositions] = useState<PositionView[]>([]);
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [accountSummary, setAccountSummary] = useState<{ buyingPower: number; equity: number; cash: number }>({
    buyingPower: 0,
    equity: 0,
    cash: 0
  });
  const [loading, setLoading] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [closingSymbol, setClosingSymbol] = useState<string | null>(null);
  const [closeDialogPosition, setCloseDialogPosition] = useState<PositionView | null>(null);
  const [closeIntent, setCloseIntent] = useState<ManualIntent | null>(null);
  const [closeCreating, setCloseCreating] = useState(false);
  const [closeSubmitting, setCloseSubmitting] = useState(false);
  const [closeDialogError, setCloseDialogError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [isMarketOpen, setIsMarketOpen] = useState<boolean | null>(null);
  const [nextOpen, setNextOpen] = useState<string | null>(null);
  const [positionInsights, setPositionInsights] = useState<Record<string, DeskInsight>>({});
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const positionInsightCacheRef = useRef<Map<string, { insight: DeskInsight; fetchedAt: number }>>(new Map());
  const closeCreatingRef = useRef(false);
  const closeSubmittingRef = useRef(false);
  const [insightsRefreshId, setInsightsRefreshId] = useState(0);
  const lastInsightsRefreshRef = useRef(0);
  const [insightsUpdatedAt, setInsightsUpdatedAt] = useState<number | null>(null);
  const [positionSnapshots, setPositionSnapshots] = useState<Record<string, WatchlistSnapshot>>({});
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  // Per-contract greeks for open positions (Massive contract snapshots via the
  // watchlist endpoint, which returns delta/gamma/theta/vega for O: symbols).
  const [contractGreeks, setContractGreeks] = useState<Record<string, { delta: number | null; gamma: number | null; theta: number | null; vega: number | null }>>({});
  const [portfolioOperations, setPortfolioOperations] = useState<PortfolioOperations | null>(null);
  const insightsAllowed = aiEnabled && sentimentEnabled;

  const loadPortfolio = useCallback(async () => {
    setLoading(true);
    setOrdersLoading(true);
    setError(null);
    setOrdersError(null);
    try {
      const [account, positionResponse, ordersResponse, clockResponse, operationsResponse] = await Promise.all([
        getBrokerAccount(),
        getOptionPositions(),
        getOptionOrders({ status: 'all', limit: 20 }),
        getBrokerClock(),
        portfolioApi.getOperations().catch(() => null)
      ]);
      const normalizedPositions: PositionView[] =
        positionResponse.positions?.map(pos => ({
          symbol: pos.symbol,
          qty: Number(pos.qty ?? 0),
          side: pos.side,
          avgCost: Number(pos.avg_entry_price ?? 0),
          mark: Number(pos.current_price ?? 0),
          marketValue: Number(pos.market_value ?? 0),
          unrealizedPnl: Number(pos.unrealized_pl ?? 0)
        })) ?? [];
      setPositions(normalizedPositions);
      setAccountSummary({
        buyingPower: Number(account.buying_power ?? 0),
        equity: Number(account.equity ?? 0),
        cash: Number(account.cash ?? 0)
      });
      const normalizedOrders: OrderView[] =
        ordersResponse.orders?.map(order => {
          const legSymbol = order.symbol ?? order.legs?.[0]?.symbol ?? '-';
          const limitPrice = toOptionalNumber(order.limit_price ?? order.legs?.[0]?.limit_price);
          const orderSide = order.side ?? order.legs?.[0]?.side ?? order.position_intent ?? '-';
          return {
            id: order.id ?? `${legSymbol ?? 'order'}-${order.submitted_at ?? order.created_at ?? ''}`,
            symbol: legSymbol ?? '-',
            orderType: formatOrderType(order.type ?? order.order_type ?? null, limitPrice),
            side: orderSide ?? '-',
            qty: toNumber(order.qty, 0),
            filledQty: toNumber(order.filled_qty, 0),
            avgFillPrice: toOptionalNumber(order.filled_avg_price),
            limitPrice,
            status: order.status ?? '-',
            source: order.source ?? order.client_order_id ?? null,
            submittedAt: order.submitted_at ?? order.created_at ?? null,
            filledAt: order.filled_at ?? null,
            expiresAt: order.expired_at ?? order.canceled_at ?? null
          };
        }) ?? [];
      setOrders(normalizedOrders);
      setPortfolioOperations(operationsResponse);
      setIsMarketOpen(Boolean(clockResponse?.is_open));
      setNextOpen(clockResponse?.next_open ?? null);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err: any) {
      const message = err?.response?.data?.error ?? err?.message ?? 'Failed to load Alpaca account';
      setError(message);
    } finally {
      setLoading(false);
      setOrdersLoading(false);
    }
  }, []);

  const handleRefreshInsights = useCallback(() => {
    if (!insightsAllowed) {
      setInsightsError('AI sentiment is disabled in Settings.');
      return;
    }
    positionInsightCacheRef.current.clear();
    setInsightsRefreshId(prev => prev + 1);
  }, [insightsAllowed]);

  useEffect(() => {
    void loadPortfolio();
  }, [loadPortfolio]);

  useEffect(() => {
    if (!insightsAllowed) {
      setInsightsLoading(false);
      setInsightsError(null);
      return;
    }
    const symbols = Array.from(
      new Set(positions.map(position => getUnderlyingSymbol(position.symbol)).filter(Boolean))
    );
    if (!symbols.length) {
      setPositionInsights({});
      setInsightsLoading(false);
      setInsightsUpdatedAt(null);
      setInsightsError(null);
      return;
    }
    const refreshRequested = lastInsightsRefreshRef.current !== insightsRefreshId;
    if (refreshRequested) {
      lastInsightsRefreshRef.current = insightsRefreshId;
    }
    const now = Date.now();
    const cached: Record<string, DeskInsight> = {};
    const toFetch: string[] = [];
    let latestCachedAt: number | null = null;
    symbols.forEach(symbol => {
      const entry = positionInsightCacheRef.current.get(symbol);
      if (!refreshRequested && entry && now - entry.fetchedAt < INSIGHT_TTL_MS) {
        cached[symbol] = entry.insight;
        if (latestCachedAt == null || entry.fetchedAt > latestCachedAt) {
          latestCachedAt = entry.fetchedAt;
        }
      } else {
        toFetch.push(symbol);
      }
    });
    setPositionInsights(cached);
    setInsightsUpdatedAt(latestCachedAt);
    if (!toFetch.length) {
      setInsightsLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    let rateLimited = false;
    setInsightsLoading(true);
    setInsightsError(null);
    Promise.all(
      toFetch.map(async symbol => {
        try {
          const insight = await analysisApi.getDeskInsight(symbol, controller.signal);
          return [symbol, insight] as const;
        } catch (error) {
          if (isAbortError(error)) return null;
          if ((error as { response?: { status?: number } })?.response?.status === 429) {
            rateLimited = true;
            return null;
          }
          return null;
        }
      })
    )
      .then(entries => {
        if (cancelled) return;
        const fetchedAt = Date.now();
        setPositionInsights(prev => {
          const next = { ...prev };
          entries.forEach(entry => {
            if (!entry) return;
            const [symbol, insight] = entry;
            positionInsightCacheRef.current.set(symbol, { insight, fetchedAt });
            next[symbol] = insight;
          });
          return next;
        });
        if (rateLimited) {
          setInsightsError('AI request limit reached. Try again soon.');
        } else {
          setInsightsUpdatedAt(fetchedAt);
        }
      })
      .finally(() => {
        if (!cancelled) setInsightsLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [positions, insightsRefreshId, insightsAllowed]);

  useEffect(() => {
    const symbols = Array.from(
      new Set(positions.map(position => getUnderlyingSymbol(position.symbol)).filter(Boolean))
    );
    if (!symbols.length) {
      setPositionSnapshots({});
      return;
    }
    let cancelled = false;
    setSnapshotsLoading(true);
    marketApi
      .getWatchlistSnapshots(symbols)
      .then(payload => {
        if (cancelled) return;
        const next: Record<string, WatchlistSnapshot> = {};
        payload.entries?.forEach(entry => {
          if (entry?.ticker) {
            next[entry.ticker.toUpperCase()] = entry;
          }
        });
        setPositionSnapshots(next);
      })
      .catch(() => {
        if (!cancelled) setPositionSnapshots({});
      })
      .finally(() => {
        if (!cancelled) setSnapshotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [positions]);

  // Fetch contract-level greeks for the open book. Batched through the same
  // snapshot endpoint (≤25 symbols) and refreshed when positions change.
  useEffect(() => {
    const contracts = positions.map(position => toLiveOptionSymbol(position.symbol));
    if (!contracts.length) {
      setContractGreeks({});
      return;
    }
    let cancelled = false;
    marketApi
      .getWatchlistSnapshots(contracts.slice(0, 25))
      .then(payload => {
        if (cancelled) return;
        const next: Record<string, { delta: number | null; gamma: number | null; theta: number | null; vega: number | null }> = {};
        payload.entries?.forEach(entry => {
          if (entry?.entryType !== 'contract') return;
          const key = normalizePositionSymbol(entry.contract ?? entry.ticker ?? '');
          if (!key) return;
          const greeks = (entry as { greeks?: Record<string, number | null> }).greeks ?? {};
          next[key] = {
            delta: typeof greeks.delta === 'number' ? greeks.delta : null,
            gamma: typeof greeks.gamma === 'number' ? greeks.gamma : null,
            theta: typeof greeks.theta === 'number' ? greeks.theta : null,
            vega: typeof greeks.vega === 'number' ? greeks.vega : null,
          };
        });
        setContractGreeks(next);
      })
      .catch(() => {
        if (!cancelled) setContractGreeks({});
      });
    return () => {
      cancelled = true;
    };
  }, [positions]);

  const handleClosePosition = useCallback(
    (position: PositionView) => {
      if (closingSymbol) return;
      if (isMarketOpen === false) {
        setError('Options market orders are only allowed during market hours.');
        return;
      }
      setError(null);
      setCloseDialogError(null);
      setCloseIntent(null);
      setCloseDialogPosition(position);
    },
    [closingSymbol, isMarketOpen]
  );

  const handleCancelCloseDialog = useCallback(() => {
    if (closeCreating || closeSubmitting) return;
    setCloseDialogPosition(null);
    setCloseIntent(null);
    setCloseDialogError(null);
  }, [closeCreating, closeSubmitting]);

  const handleCreateCloseIntent = useCallback(async () => {
    const position = closeDialogPosition;
    if (!position || closeIntent || closeCreatingRef.current) return;
    closeCreatingRef.current = true;
    setCloseCreating(true);
    setClosingSymbol(position.symbol);
    setCloseDialogError(null);
    try {
      const qty = Math.max(1, Math.abs(position.qty));
      const side = position.side === 'long' ? 'sell' : 'buy';
      const positionIntent = position.side === 'long' ? 'sell_to_close' : 'buy_to_close';
      const intent = await createManualIntent({
        executionMode: 'MANUAL',
        orderSource: 'MANUAL_UI',
        action: 'CLOSE_POSITION',
        optionSymbol: position.symbol,
        side,
        quantity: qty,
        brokerPositionQuantity: qty,
        orderType: 'market',
        timeInForce: 'day',
        positionIntent,
        marketDataSource: 'alpaca-paper-position'
      });
      setCloseIntent(intent);
    } catch (err: any) {
      const message = err?.response?.data?.message ?? err?.response?.data?.error ?? err?.message ?? 'Failed to create close intent';
      setCloseDialogError(message);
    } finally {
      closeCreatingRef.current = false;
      setCloseCreating(false);
      setClosingSymbol(null);
    }
  }, [closeDialogPosition, closeIntent]);

  const handleConfirmCloseIntent = useCallback(async () => {
    const position = closeDialogPosition;
    const intent = closeIntent;
    if (!position || !intent || closeSubmittingRef.current) return;
    closeSubmittingRef.current = true;
    setCloseSubmitting(true);
    setClosingSymbol(position.symbol);
    setCloseDialogError(null);
    try {
      await confirmManualIntent(intent.id);
      const result = await submitManualIntent(intent.id);
      if (result.outcome !== 'SUBMITTED' && result.outcome !== 'ALREADY_SUBMITTED') {
        setCloseDialogError(result.reason ?? 'Manual close was blocked by the execution gateway.');
        setCloseIntent(result.intent ?? intent);
        return;
      }
      await loadPortfolio();
      setCloseDialogPosition(null);
      setCloseIntent(null);
    } catch (err: any) {
      const payloadMessage = err?.response?.data?.message ?? err?.response?.data?.reason;
      const message =
        err?.response?.status === 410
          ? 'This submission path is disabled. Use the governed order ticket.'
          : payloadMessage === 'options market orders are only allowed during market hours'
            ? 'Options market orders are only allowed during market hours.'
            : err?.response?.data?.error ?? payloadMessage ?? err?.message ?? 'Failed to close position';
      setCloseDialogError(message);
    } finally {
      closeSubmittingRef.current = false;
      setCloseSubmitting(false);
      setClosingSymbol(null);
    }
  }, [closeDialogPosition, closeIntent, loadPortfolio]);

  const totalPnl = useMemo(() => positions.reduce((sum, row) => sum + row.unrealizedPnl, 0), [positions]);
  const totalMarketValue = useMemo(
    () => positions.reduce((sum, row) => sum + Math.abs(row.marketValue), 0),
    [positions]
  );
  const risk = useMemo(() => aggregateRisk(portfolioOperations?.risk), [portfolioOperations]);

  const automationPositionSymbols = useMemo(() => {
    const rows = portfolioOperations?.automationContext?.positionsBySymbol ?? [];
    return new Set(
      rows
        .filter(row => row.source === 'AUTOMATION')
        .map(row => normalizePositionSymbol(row.symbol))
    );
  }, [portfolioOperations]);
  const automationPositions = useMemo(
    () => positions.filter(position => automationPositionSymbols.has(normalizePositionSymbol(position.symbol))),
    [positions, automationPositionSymbols]
  );
  const manualPositions = useMemo(
    () => positions.filter(position => !automationPositionSymbols.has(normalizePositionSymbol(position.symbol))),
    [positions, automationPositionSymbols]
  );
  // Blotter order: automation book first, then manual.
  const blotterRows = useMemo(
    () => [
      ...automationPositions.map(pos => ({ pos, source: 'AUTO' as const })),
      ...manualPositions.map(pos => ({ pos, source: 'MANUAL' as const })),
    ],
    [automationPositions, manualPositions]
  );

  // Book greeks exposure: Σ greek × signed contracts × 100. Null (shown as em
  // dash) when any open position is missing that greek — a partial sum would
  // misstate the book.
  const bookGreeks = useMemo(() => {
    if (!positions.length) return null;
    const sums = { delta: 0, gamma: 0, theta: 0, vega: 0 };
    const complete = { delta: true, gamma: true, theta: true, vega: true };
    for (const pos of positions) {
      const greeks = contractGreeks[normalizePositionSymbol(pos.symbol)];
      const signedContracts = (pos.side === 'short' ? -1 : 1) * Math.max(1, Math.abs(pos.qty));
      (['delta', 'gamma', 'theta', 'vega'] as const).forEach(key => {
        const value = greeks?.[key];
        if (value == null) {
          complete[key] = false;
        } else {
          sums[key] += value * signedContracts * 100;
        }
      });
    }
    return {
      delta: complete.delta ? sums.delta : null,
      gamma: complete.gamma ? sums.gamma : null,
      theta: complete.theta ? sums.theta : null,
      vega: complete.vega ? sums.vega : null,
    };
  }, [positions, contractGreeks]);

  // Allocation donut — positions by absolute market value.
  const allocationData = useMemo<ChartDatum[]>(
    () =>
      positions
        .map(pos => ({ label: getUnderlyingSymbol(pos.symbol), value: Math.abs(pos.marketValue) }))
        .filter(datum => datum.value > 0),
    [positions]
  );

  // Exposure split — automation vs manual, long vs short.
  const exposure = useMemo(() => {
    const sumValue = (rows: PositionView[]) => rows.reduce((sum, r) => sum + Math.abs(r.marketValue), 0);
    const longRows = positions.filter(p => p.side === 'long');
    const shortRows = positions.filter(p => p.side === 'short');
    return {
      automation: { count: automationPositions.length, value: sumValue(automationPositions) },
      manual: { count: manualPositions.length, value: sumValue(manualPositions) },
      long: { count: longRows.length, value: sumValue(longRows) },
      short: { count: shortRows.length, value: sumValue(shortRows) },
    };
  }, [positions, automationPositions, manualPositions]);

  const closeDialogQuantity = closeDialogPosition ? Math.max(1, Math.abs(closeDialogPosition.qty)) : 0;
  const closeDialogAction =
    closeDialogPosition?.side === 'short' ? 'Buy to close' : 'Sell to close';
  const closeDialogActionLower =
    closeDialogPosition?.side === 'short' ? 'buy to close' : 'sell to close';

  return (
    <div className="flex flex-col gap-3">
      {closeDialogPosition && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-panel border border-intel-line bg-intel-panel p-5 shadow-xl">
            <div className="space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-eyebrow text-intel-ink3">Governed Close</p>
              <h3 className="text-xl font-semibold text-intel-ink">Close {closeDialogPosition.symbol}</h3>
              <div className="rounded-lg border border-intel-line bg-intel-panel2 p-3 text-sm text-intel-ink2">
                <p>{closeDialogAction}: {closeDialogQuantity} contract{closeDialogQuantity === 1 ? '' : 's'}</p>
                <p>Account: Alpaca Paper</p>
              </div>
              {closeIntent ? (
                <div className="rounded-lg border border-intel-pos/30 bg-intel-pos/10 p-3 text-xs text-intel-pos">
                  <p>Manual close intent created.</p>
                  <p className="mt-1 break-all">Authorization: {closeIntent.authorizationId}</p>
                  <p className="mt-1 break-all">Idempotency: {closeIntent.idempotencyKey}</p>
                </div>
              ) : (
                <p className="text-sm text-intel-ink2">
                  This creates a MANUAL close intent first. No broker order is submitted until you confirm it.
                </p>
              )}
              {closeDialogError && (
                <div className="rounded-lg border border-intel-neg/40 bg-intel-neg/10 px-3 py-2 text-sm text-intel-neg">
                  {closeDialogError}
                </div>
              )}
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <ActionButton
                onClick={handleCancelCloseDialog}
                disabled={closeCreating || closeSubmitting}
              >
                Cancel
              </ActionButton>
              {!closeIntent ? (
                <ActionButton
                  variant="primary"
                  onClick={handleCreateCloseIntent}
                  disabled={closeCreating}
                >
                  {closeCreating ? 'Creating intent…' : 'Create close intent'}
                </ActionButton>
              ) : (
                <DangerousActionButton
                  onClick={handleConfirmCloseIntent}
                  disabled={closeSubmitting}
                >
                  {closeSubmitting ? 'Submitting close…' : `Confirm ${closeDialogActionLower}`}
                </DangerousActionButton>
              )}
            </div>
          </div>
        </div>
      )}

      {/* WORKSPACE TOOLBAR — status left, actions right. No hero, no copy. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-mono text-xs font-semibold uppercase tracking-eyebrow text-intel-ink">Positions</span>
          <span className={BLOTTER_LABEL}>Alpaca Paper</span>
          {isMarketOpen != null && (
            <span
              className={`font-mono text-[10px] uppercase tracking-label ${isMarketOpen ? 'text-intel-pos' : 'text-intel-warn'}`}
              title={!isMarketOpen && nextOpen ? `Next open: ${formatTimestamp(nextOpen)}` : undefined}
            >
              Market {isMarketOpen ? 'Open' : 'Closed'}
            </span>
          )}
          {risk?.emergencyStop ? (
            <span className="font-mono text-[10px] uppercase tracking-label text-intel-neg">Emergency stop engaged</span>
          ) : risk ? (
            <span className="font-mono text-[10px] uppercase tracking-label text-intel-pos">Risk nominal</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="font-mono text-[11px] text-intel-ink3">Refreshed {lastUpdated}</span>
          )}
          <ActionButton
            onClick={handleRefreshInsights}
            disabled={insightsLoading || !insightsAllowed}
            className="h-8"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Sentiment
          </ActionButton>
          <RefreshButton onClick={() => loadPortfolio()} busy={loading || ordersLoading} />
        </div>
      </div>

      {error && <AlertBanner tone="error">{error}</AlertBanner>}
      {insightsError && <AlertBanner tone="warn">{insightsError}</AlertBanner>}

      {/* ACCOUNT SUMMARY STRIP — the numbers a trader checks first, one row. */}
      <div className="rounded-panel bg-intel-panel py-2">
        <div className="grid grid-cols-2 gap-y-2 divide-intel-divider sm:grid-cols-5 sm:divide-x xl:grid-cols-10">
          <AccountStat label="Equity" value={fmtUsd(accountSummary.equity)} />
          <AccountStat label="Cash" value={fmtUsd(accountSummary.cash)} tone={accountSummary.cash < 0 ? 'neg' : 'neutral'} />
          <AccountStat label="Buying Power" value={fmtUsd(accountSummary.buyingPower)} />
          <AccountStat
            label="Day Realized"
            value={risk ? fmtSignedUsd(risk.dailyRealizedPnl) : '—'}
            tone={risk ? pnlTone(risk.dailyRealizedPnl) : 'neutral'}
          />
          <AccountStat label="Open P/L" value={fmtSignedUsd(totalPnl)} tone={pnlTone(totalPnl)} />
          <AccountStat label="Exposure" value={fmtUsd(totalMarketValue)} title="Total absolute market value of open option positions." />
          <AccountStat label="Positions" value={fmtNum(positions.length)} />
          <AccountStat label="Drawdown" value={risk ? fmtUsd(risk.currentDrawdown) : '—'} />
          <AccountStat label="Max DD" value={risk ? fmtUsd(risk.maxDrawdown) : '—'} />
          <AccountStat
            label="Loss Streak"
            value={risk ? fmtNum(risk.consecutiveLossCount) : '—'}
            tone={risk && risk.consecutiveLossCount >= 3 ? 'neg' : risk && risk.consecutiveLossCount > 0 ? 'warn' : 'neutral'}
          />
        </div>
        {/* Book greeks — net portfolio exposure per unit move / day / vol pt. */}
        {bookGreeks && (
          <div className="mt-2 grid grid-cols-2 gap-y-2 divide-intel-divider border-t border-intel-divider pt-2 sm:grid-cols-4 sm:divide-x">
            <AccountStat
              label="Net Δ Delta"
              value={bookGreeks.delta != null ? fmtNum(bookGreeks.delta, 1) : '—'}
              tone={bookGreeks.delta != null ? pnlTone(bookGreeks.delta) : 'neutral'}
              title="Share-equivalent directional exposure: Σ delta × contracts × 100. Positive = long the underlying."
            />
            <AccountStat
              label="Net Γ Gamma"
              value={bookGreeks.gamma != null ? fmtNum(bookGreeks.gamma, 1) : '—'}
              title="Delta change per $1 underlying move: Σ gamma × contracts × 100."
            />
            <AccountStat
              label="Net Θ Theta"
              value={bookGreeks.theta != null ? fmtSignedUsd(bookGreeks.theta) : '—'}
              tone={bookGreeks.theta != null ? pnlTone(bookGreeks.theta) : 'neutral'}
              title="Time decay per day at current marks: Σ theta × contracts × 100."
            />
            <AccountStat
              label="Net V Vega"
              value={bookGreeks.vega != null ? fmtSignedUsd(bookGreeks.vega) : '—'}
              tone={bookGreeks.vega != null ? pnlTone(bookGreeks.vega) : 'neutral'}
              title="P/L per 1-point implied-vol move: Σ vega × contracts × 100."
            />
          </div>
        )}
      </div>

      {/* POSITIONS BLOTTER */}
      <section className="rounded-panel bg-intel-panel">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-intel-divider px-4 py-2.5">
          <div className="flex items-center gap-3">
            <span className={BLOTTER_LABEL}>Open Positions</span>
            <span className="font-mono text-[11px] tabular-nums text-intel-ink2">{positions.length}</span>
            {automationPositions.length > 0 && (
              <span className="font-mono text-[10px] text-intel-ink3">
                <span className="text-intel-accent">{automationPositions.length} auto</span>
                {' · '}
                {manualPositions.length} manual
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {isMarketOpen === false && (
              <span className="font-mono text-[10px] uppercase tracking-label text-intel-warn">
                Market orders pause until open{nextOpen ? ` · ${fmtWhen(nextOpen)}` : ''}
              </span>
            )}
            {insightsUpdatedAt ? (
              <span className="font-mono text-[10px] text-intel-ink3">
                Sentiment {new Date(insightsUpdatedAt).toLocaleTimeString()}
              </span>
            ) : !insightsAllowed ? (
              <span className="font-mono text-[10px] text-intel-ink3">Sentiment disabled</span>
            ) : null}
          </div>
        </div>
        <div className="overflow-x-auto px-4 pb-2">
          <table className="w-full min-w-[1180px]">
            <thead>
              <tr className="border-b border-intel-line">
                <th className={TH}>Contract</th>
                <th className={TH}>Src</th>
                <th className={TH}>Side</th>
                <th className={TH_R}>Qty</th>
                <th className={TH}>C/P</th>
                <th className={TH_R}>Strike</th>
                <th className={TH}>Exp</th>
                <th className={TH_R}>Spot</th>
                <th className={TH_R}>Avg Cost</th>
                <th className={TH_R}>Mark</th>
                <th className={TH_R}>Value</th>
                <th className={TH_R}>Open P/L</th>
                <th className={TH_R}>B/E</th>
                <th className={TH_R}>TP</th>
                <th className={TH}>Sent</th>
                <th className={TH}>Data</th>
                <th className="py-2 pr-2" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {blotterRows.map(({ pos, source }) => {
                const underlyingSymbol = getUnderlyingSymbol(pos.symbol);
                const insight = positionInsights[underlyingSymbol];
                const snapshot = positionSnapshots[underlyingSymbol];
                const spot = snapshot && snapshot.entryType === 'underlying' ? snapshot.price : null;
                const takeProfitOrder = getTakeProfitOrder(orders, pos);
                return (
                  <PositionBlotterRow
                    key={pos.symbol}
                    pos={pos}
                    source={source}
                    spot={spot ?? null}
                    spotLoading={snapshotsLoading}
                    sentimentLabel={insight?.sentiment?.label ?? null}
                    sentimentLoading={insightsLoading}
                    takeProfitPrice={takeProfitOrder?.limitPrice ?? null}
                    closing={closingSymbol === pos.symbol}
                    closeDisabled={isMarketOpen === false}
                    onClose={() => handleClosePosition(pos)}
                  />
                );
              })}
              {!blotterRows.length && (
                <tr>
                  <td colSpan={17} className="py-6 text-center font-mono text-xs text-intel-ink3">
                    {loading ? 'Loading broker positions…' : 'No open option positions — rows appear when automation or a manual trade opens one.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ORDERS BLOTTER + EXPOSURE */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="rounded-panel bg-intel-panel">
          <div className="flex items-center justify-between border-b border-intel-divider px-4 py-2.5">
            <div className="flex items-center gap-3">
              <span className={BLOTTER_LABEL}>Orders</span>
              <span className="font-mono text-[11px] tabular-nums text-intel-ink2">{orders.length}</span>
            </div>
            {ordersLoading && <span className="font-mono text-[10px] text-intel-ink3">Loading…</span>}
          </div>
          {ordersError && (
            <div className="px-4 pt-3">
              <AlertBanner tone="error">{ordersError}</AlertBanner>
            </div>
          )}
          <div className="overflow-x-auto px-4 pb-2">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="border-b border-intel-line">
                  <th className={TH}>Contract</th>
                  <th className={TH}>Type</th>
                  <th className={TH}>Side</th>
                  <th className={TH_R}>Qty</th>
                  <th className={TH_R}>Filled</th>
                  <th className={TH_R}>Avg Fill</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Src</th>
                  <th className={TH}>Submitted</th>
                  <th className={TH}>Filled At</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(order => (
                  <tr key={order.id} className="border-b border-intel-lineSoft font-mono text-xs text-intel-ink2">
                    <td className={`${TD} font-semibold text-intel-ink`}>{order.symbol}</td>
                    <td className={TD}>{order.orderType}</td>
                    <td className={TD}>
                      <span className={order.side.toLowerCase().startsWith('buy') ? 'text-intel-pos' : 'text-intel-neg'}>
                        {order.side.toUpperCase()}
                      </span>
                    </td>
                    <td className={TD_R}>{fmtNum(order.qty, 0)}</td>
                    <td className={TD_R}>{fmtNum(order.filledQty, 0)}</td>
                    <td className={TD_R}>{order.avgFillPrice != null ? fmtUsd(order.avgFillPrice) : '—'}</td>
                    <td className={`${TD} ${orderStatusTone(order.status)}`}>{formatOrderStatus(order.status)}</td>
                    <td className={TD} title={order.source ?? undefined}>{formatOrderSource(order.source)}</td>
                    <td className={TD} title={formatTimestamp(order.submittedAt)}>{fmtWhen(order.submittedAt)}</td>
                    <td className={TD} title={formatTimestamp(order.filledAt)}>{fmtWhen(order.filledAt)}</td>
                  </tr>
                ))}
                {!orders.length && !ordersLoading && (
                  <tr>
                    <td colSpan={10} className="py-6 text-center font-mono text-xs text-intel-ink3">
                      No recent option orders.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="flex flex-col rounded-panel bg-intel-panel">
          <div className="flex items-center justify-between border-b border-intel-divider px-4 py-2.5">
            <span className={BLOTTER_LABEL}>Exposure & Allocation</span>
            <span className="font-mono text-[11px] tabular-nums text-intel-ink2">{fmtUsd(totalMarketValue)}</span>
          </div>
          <div className="grid grid-cols-2 gap-px border-b border-intel-divider bg-intel-divider">
            {[
              { label: 'Automation', row: exposure.automation, cls: 'text-intel-accent' },
              { label: 'Manual', row: exposure.manual, cls: 'text-intel-ink' },
              { label: 'Long', row: exposure.long, cls: 'text-intel-pos' },
              { label: 'Short', row: exposure.short, cls: exposure.short.count ? 'text-intel-neg' : 'text-intel-ink' },
            ].map(({ label, row, cls }) => (
              <div key={label} className="bg-intel-panel px-4 py-2.5">
                <div className={BLOTTER_LABEL}>{label}</div>
                <div className={`mt-1 font-mono text-sm font-semibold tabular-nums ${cls}`}>
                  {fmtNum(row.count)} <span className="text-intel-ink3">·</span> {fmtUsd(row.value)}
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-1 flex-col justify-between px-4 py-3">
            {allocationData.length ? (
              <DonutChart data={allocationData} height={150} valueFormatter={fmtUsd} />
            ) : (
              <p className="py-6 text-center font-mono text-xs text-intel-ink3">No open positions to allocate.</p>
            )}
            {onOpenSystemOperations && (
              <button
                type="button"
                onClick={onOpenSystemOperations}
                className="mt-2 self-end font-mono text-[11px] uppercase tracking-label text-intel-ink3 transition hover:text-intel-accent"
              >
                System Operations →
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
