import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analysisApi, marketApi } from '../../api';
import { getBrokerAccount, getBrokerClock, getOptionOrders, getOptionPositions, submitOptionOrder } from '../../api/alpaca';
import type { DeskInsight } from '../../api/analysis';
import type { WatchlistSnapshot } from '../../types/market';

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
    return `Limit @ $${limitPrice.toFixed(2)}`;
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatTimestamp(value?: string | null) {
  if (!value) return '-';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return '-';
  return new Date(parsed).toLocaleString();
}

function getUnderlyingSymbol(symbol: string) {
  const normalized = symbol.toUpperCase();
  const cleaned = normalized.startsWith('O:') ? normalized.slice(2) : normalized;
  const match = cleaned.match(/^([A-Z]+)(?=\d)/);
  return match?.[1] ?? normalized;
}

function resolveSentimentStyles(label?: string | null) {
  if (label === 'bullish') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
  if (label === 'bearish') return 'border-red-500/30 bg-red-500/10 text-red-200';
  return 'border-gray-800 bg-gray-900/40 text-gray-300';
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

function formatCurrency(value: number, digits = 2) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value);
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

function getTakeProfitPnl(position: PositionView, limitPrice: number | null) {
  if (limitPrice == null || !Number.isFinite(limitPrice)) return null;
  const qty = Math.max(1, Math.abs(position.qty));
  const direction = position.side === 'long' ? 1 : -1;
  const delta = (limitPrice - position.avgCost) * direction;
  const pnl = delta * qty * 100;
  const pct = position.avgCost ? (delta / position.avgCost) * 100 : null;
  return { pnl, pct };
}

function buildPositionInsight(position: PositionView) {
  if (!Number.isFinite(position.avgCost) || !Number.isFinite(position.mark)) return null;
  const qty = Math.max(1, Math.abs(position.qty));
  const entryValue = position.avgCost * qty * 100;
  const currentValue = position.mark * qty * 100;
  const direction = position.side === 'short' ? -1 : 1;
  const pnl = (position.mark - position.avgCost) * direction * qty * 100;
  const pct = entryValue ? (pnl / entryValue) * 100 : null;
  return {
    entryValue,
    currentValue,
    pnl,
    pct,
    title: 'Avg cost × contracts × 100 vs current mark × contracts × 100. P&L is unrealized until you sell.'
  };
}

export function PortfolioPanel() {
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
  const [error, setError] = useState<string | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [isMarketOpen, setIsMarketOpen] = useState<boolean | null>(null);
  const [nextOpen, setNextOpen] = useState<string | null>(null);
  const [positionInsights, setPositionInsights] = useState<Record<string, DeskInsight>>({});
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const positionInsightCacheRef = useRef<Map<string, { insight: DeskInsight; fetchedAt: number }>>(new Map());
  const [insightsRefreshId, setInsightsRefreshId] = useState(0);
  const lastInsightsRefreshRef = useRef(0);
  const [insightsUpdatedAt, setInsightsUpdatedAt] = useState<number | null>(null);
  const [positionSnapshots, setPositionSnapshots] = useState<Record<string, WatchlistSnapshot>>({});
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);

  const loadPortfolio = useCallback(async () => {
    setLoading(true);
    setOrdersLoading(true);
    setError(null);
    setOrdersError(null);
    try {
      const [account, positionResponse, ordersResponse, clockResponse] = await Promise.all([
        getBrokerAccount(),
        getOptionPositions(),
        getOptionOrders({ status: 'all', limit: 20 }),
        getBrokerClock()
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
    positionInsightCacheRef.current.clear();
    setInsightsRefreshId(prev => prev + 1);
  }, []);

  useEffect(() => {
    void loadPortfolio();
  }, [loadPortfolio]);

  useEffect(() => {
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
          if (error?.response?.status === 429) {
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
  }, [positions, insightsRefreshId]);

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

  const handleClosePosition = useCallback(
    async (position: PositionView) => {
      if (closingSymbol) return;
      if (isMarketOpen === false) {
        setError('Options market orders are only allowed during market hours.');
        return;
      }
      setClosingSymbol(position.symbol);
      setError(null);
      try {
        const qty = Math.max(1, Math.abs(position.qty));
        const side = position.side === 'long' ? 'sell' : 'buy';
        const intent = position.side === 'long' ? 'sell_to_close' : 'buy_to_close';
        await submitOptionOrder({
          order_type: 'market',
          legs: [
            {
              symbol: position.symbol,
              qty,
              side,
              position_intent: intent
            }
          ]
        });
        await loadPortfolio();
      } catch (err: any) {
        const payloadMessage = err?.response?.data?.message;
        const message =
          payloadMessage === 'options market orders are only allowed during market hours'
            ? 'Options market orders are only allowed during market hours.'
            : err?.response?.data?.error ?? err?.message ?? 'Failed to close position';
        setError(message);
      } finally {
        setClosingSymbol(null);
      }
    },
    [closingSymbol, isMarketOpen, loadPortfolio]
  );

  const totalPnl = useMemo(() => positions.reduce((sum, row) => sum + row.unrealizedPnl, 0), [positions]);

  return (
    <section className="bg-gray-950 border border-gray-900 rounded-2xl p-6 space-y-4">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Portfolio Risk</p>
            <h2 className="text-2xl font-semibold">Current Book Overview</h2>
            <p className="text-sm text-gray-400">Live view of Alpaca paper positions & buying power.</p>
          </div>
          <div className="text-right">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => loadPortfolio()}
                className="px-3 py-1.5 text-xs rounded-full border border-gray-800 text-gray-300 hover:bg-gray-900"
                disabled={loading || ordersLoading}
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={handleRefreshInsights}
                className="px-3 py-1.5 text-xs rounded-full border border-gray-800 text-gray-300 hover:border-emerald-500/40 hover:text-white disabled:opacity-60"
                disabled={insightsLoading}
              >
                Refresh sentiment
              </button>
            </div>
            {lastUpdated && <p className="text-[11px] text-gray-500 mt-1">Last refresh {lastUpdated}</p>}
            {insightsUpdatedAt && (
              <p className="text-[11px] text-gray-500">Sentiment updated {new Date(insightsUpdatedAt).toLocaleTimeString()}</p>
            )}
            {insightsError && <p className="text-[11px] text-amber-200">{insightsError}</p>}
          </div>
        </div>
      </header>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Buying Power" value={accountSummary.buyingPower} />
        <StatCard label="Equity" value={accountSummary.equity} />
        <StatCard label="Cash" value={accountSummary.cash} />
      </div>
      <div className="rounded-2xl border border-gray-900 bg-gray-950 p-4">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Net Unrealized P&L</p>
        <p className={`text-3xl font-semibold ${totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
        </p>
      </div>
      {error && <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/40 rounded-xl px-3 py-2">{error}</div>}
      {loading && <p className="text-sm text-gray-400">Loading Alpaca account…</p>}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Active Positions</p>
        </div>
        {isMarketOpen === false && (
          <div className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">
            Options market orders pause outside market hours. Next open: {nextOpen ? formatTimestamp(nextOpen) : 'TBD'}.
          </div>
        )}
        {positions.map(pos => {
          const underlyingSymbol = getUnderlyingSymbol(pos.symbol);
          const insight = positionInsights[underlyingSymbol];
          const sentimentLabel = insight?.sentiment?.label ?? null;
          const shortInterestElevated =
            insight?.shortBias?.reasons?.some(reason => reason.toLowerCase().includes('short interest')) ?? false;
          const takeProfitOrder = getTakeProfitOrder(orders, pos);
          const takeProfitPnl = getTakeProfitPnl(pos, takeProfitOrder?.limitPrice ?? null);
          const contract = parseOptionContract(pos.symbol);
          const snapshot = positionSnapshots[underlyingSymbol];
          const underlyingSpot =
            snapshot && snapshot.entryType === 'underlying' ? snapshot.price : null;
          const insightLine = buildPositionInsight(pos);
          const breakevenPrice =
            contract && typeof pos.avgCost === 'number'
              ? contract.type === 'Call'
                ? contract.strike + pos.avgCost
                : contract.strike - pos.avgCost
              : pos.avgCost;
          return (
            <div key={pos.symbol} className="rounded-2xl border border-gray-900 bg-gray-950 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-lg font-semibold">{pos.symbol}</p>
                <p className={`text-xs mt-1 ${pos.side === 'long' ? 'text-emerald-400' : 'text-red-400'}`}>
                  {pos.side.toUpperCase()} {Math.abs(pos.qty)}
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-gray-400">
                  <span className="text-gray-500 uppercase tracking-widest">Contract:</span>
                  <span className="text-gray-200">{pos.symbol}</span>
                  <span className="text-gray-500 uppercase tracking-widest">Expiration:</span>
                  <span className="text-gray-200">{contract?.expiry ?? '—'}</span>
                  <span className="text-gray-500 uppercase tracking-widest">Underlying:</span>
                  <span className="text-gray-200">{contract?.underlying ?? underlyingSymbol}</span>
                  <span className="text-gray-500 uppercase tracking-widest">Strike:</span>
                  <span className="text-gray-200">{contract?.strike != null ? contract.strike.toFixed(2) : '—'}</span>
                  <span className="text-gray-500 uppercase tracking-widest">Underlying Price:</span>
                  <span className="text-gray-200">
                    {underlyingSpot != null ? `$${underlyingSpot.toFixed(2)}` : snapshotsLoading ? '…' : '—'}
                  </span>
                  <span className="text-gray-500 uppercase tracking-widest">Type:</span>
                  <span className="text-gray-200">{contract?.type?.toLowerCase() ?? '—'}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px]">
                  <span className={`inline-flex items-center gap-2 rounded-full border px-2 py-0.5 ${resolveSentimentStyles(sentimentLabel)}`}>
                    {insightsLoading ? 'Sentiment…' : `Sentiment: ${sentimentLabel ?? 'neutral'}`}
                  </span>
                  {shortInterestElevated && (
                    <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-200">
                      Short interest high
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleClosePosition(pos)}
                className="px-3 py-1.5 text-xs rounded-full border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-40"
                disabled={closingSymbol === pos.symbol || isMarketOpen === false}
              >
                {closingSymbol === pos.symbol ? 'Closing…' : 'Close Position'}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-sm text-gray-400">
              <div>
                <p
                  className="text-xs uppercase tracking-widest"
                  title="What you paid per share. 1 contract = 100 shares."
                >
                  Avg cost
                </p>
                <p className="text-base text-white">${pos.avgCost.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest" title="Current option price (what you could sell for now).">
                  Mark
                </p>
                <p className="text-base text-white">${pos.mark.toFixed(2)}</p>
              </div>
              <div>
                <p
                  className="text-xs uppercase tracking-widest"
                  title="Current total value = mark × contracts × 100."
                >
                  Value
                </p>
                <p className="text-base text-white">${pos.marketValue.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest" title="Unrealized gain/loss so far.">
                  P&amp;L
                </p>
                <p className={`text-base font-semibold ${pos.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {pos.unrealizedPnl >= 0 ? '+' : ''}${pos.unrealizedPnl.toFixed(2)}
                </p>
              </div>
            </div>
            {insightLine && (
              <p
                className="mt-2 inline-flex flex-wrap items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300"
                title={insightLine.title}
              >
                <span>Paid {formatCurrency(insightLine.entryValue)}</span>
                <span className="text-emerald-200">,</span>
                <span>Now worth {formatCurrency(insightLine.currentValue)}</span>
                <span className="text-emerald-200">→</span>
                <span className={insightLine.pnl >= 0 ? 'text-emerald-300' : 'text-red-300'}>
                  {insightLine.pnl >= 0 ? '+' : ''}
                  {formatCurrency(insightLine.pnl)}
                  {typeof insightLine.pct === 'number' ? ` (${insightLine.pct.toFixed(2)}%)` : ''}
                </span>
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-400">
              <span title="Underlying price you need to break even at expiration.">
                Breakeven {breakevenPrice != null ? `$${breakevenPrice.toFixed(2)}` : `$${pos.avgCost.toFixed(2)}`}
              </span>
              <span title="Your open limit order price for taking profit.">
                TP {takeProfitOrder?.limitPrice != null ? `$${takeProfitOrder.limitPrice.toFixed(2)}` : '—'}
              </span>
              {takeProfitPnl && (
                <span className={takeProfitPnl.pnl >= 0 ? 'text-emerald-300' : 'text-red-300'}>
                  {takeProfitPnl.pnl >= 0 ? '+' : ''}${takeProfitPnl.pnl.toFixed(2)}
                  {typeof takeProfitPnl.pct === 'number' ? ` (${takeProfitPnl.pct.toFixed(2)}%)` : ''}
                </span>
              )}
              <span className="text-[10px] text-gray-500">{takeProfitOrder ? 'Limit set' : 'No limit'}</span>
            </div>
          </div>
          );
        })}
        {!positions.length && !loading && <p className="text-sm text-gray-500">No option positions in Alpaca paper account.</p>}
      </div>
      <div className="rounded-2xl border border-gray-900 bg-gray-950 p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Recent Orders</p>
        </div>
        {ordersError && (
          <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/40 rounded-xl px-3 py-2 mb-3">
            {ordersError}
          </div>
        )}
        {ordersLoading ? (
          <p className="text-sm text-gray-400">Loading recent orders…</p>
        ) : orders.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-gray-300">
              <thead className="text-xs uppercase tracking-widest text-gray-500">
                <tr>
                  <th className="text-left py-2">Asset</th>
                  <th className="text-left py-2">Order Type</th>
                  <th className="text-left py-2">Side</th>
                  <th className="text-right py-2">Qty</th>
                  <th className="text-right py-2">Filled</th>
                  <th className="text-right py-2">Avg Fill</th>
                  <th className="text-left py-2">Status</th>
                  <th className="text-left py-2">Source</th>
                  <th className="text-left py-2">Submitted</th>
                  <th className="text-left py-2">Filled At</th>
                  <th className="text-left py-2">Expires</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(order => (
                  <tr key={order.id} className="border-t border-gray-900/60">
                    <td className="py-2 pr-4 font-medium text-white">{order.symbol}</td>
                    <td className="py-2 pr-4">{order.orderType}</td>
                    <td className="py-2 pr-4">{order.side}</td>
                    <td className="py-2 pr-4 text-right">{order.qty.toFixed(2)}</td>
                    <td className="py-2 pr-4 text-right">{order.filledQty.toFixed(2)}</td>
                    <td className="py-2 pr-4 text-right">
                      {order.avgFillPrice != null ? `$${order.avgFillPrice.toFixed(2)}` : '-'}
                    </td>
                    <td className="py-2 pr-4">{order.status}</td>
                    <td className="py-2 pr-4">{order.source ?? '-'}</td>
                    <td className="py-2 pr-4">{formatTimestamp(order.submittedAt)}</td>
                    <td className="py-2 pr-4">{formatTimestamp(order.filledAt)}</td>
                    <td className="py-2 pr-4">{formatTimestamp(order.expiresAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-500">No recent option orders.</p>
        )}
      </div>
    </section>
  );
}

type StatProps = { label: string; value: number };

function StatCard({ label, value }: StatProps) {
  return (
    <div className="rounded-2xl border border-gray-900 bg-gray-950 p-4">
      <p className="text-xs uppercase tracking-[0.3em] text-gray-500">{label}</p>
      <p className="text-2xl font-semibold text-white">{formatCurrency(value, 2)}</p>
    </div>
  );
}
