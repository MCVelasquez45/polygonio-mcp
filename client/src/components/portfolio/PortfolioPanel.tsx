import { useCallback, useEffect, useMemo, useState } from 'react';
import { getBrokerAccount, getBrokerClock, getOptionOrders, getOptionPositions, submitOptionOrder } from '../../api/alpaca';

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
  status: string;
  source?: string | null;
  submittedAt?: string | null;
  filledAt?: string | null;
  expiresAt?: string | null;
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
          const limitPrice = toOptionalNumber(order.limit_price);
          return {
            id: order.id ?? `${order.symbol ?? 'order'}-${order.submitted_at ?? order.created_at ?? ''}`,
            symbol: order.symbol ?? '-',
            orderType: formatOrderType(order.type ?? order.order_type ?? null, limitPrice),
            side: order.side ?? '-',
            qty: toNumber(order.qty, 0),
            filledQty: toNumber(order.filled_qty, 0),
            avgFillPrice: toOptionalNumber(order.filled_avg_price),
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

  useEffect(() => {
    void loadPortfolio();
  }, [loadPortfolio]);

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
          orderType: 'market',
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
            <button
              type="button"
              onClick={() => loadPortfolio()}
              className="px-3 py-1.5 text-xs rounded-full border border-gray-800 text-gray-300 hover:bg-gray-900"
              disabled={loading || ordersLoading}
            >
              Refresh
            </button>
            {lastUpdated && <p className="text-[11px] text-gray-500 mt-1">Last refresh {lastUpdated}</p>}
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
        {positions.map(pos => (
          <div key={pos.symbol} className="rounded-2xl border border-gray-900 bg-gray-950 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-lg font-semibold">{pos.symbol}</p>
                <p className={`text-xs mt-1 ${pos.side === 'long' ? 'text-emerald-400' : 'text-red-400'}`}>
                  {pos.side.toUpperCase()} {Math.abs(pos.qty)}
                </p>
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
                <p className="text-xs uppercase tracking-widest">Avg cost</p>
                <p className="text-base text-white">${pos.avgCost.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest">Mark</p>
                <p className="text-base text-white">${pos.mark.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest">Value</p>
                <p className="text-base text-white">${pos.marketValue.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest">P&amp;L</p>
                <p className={`text-base font-semibold ${pos.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {pos.unrealizedPnl >= 0 ? '+' : ''}${pos.unrealizedPnl.toFixed(2)}
                </p>
              </div>
            </div>
          </div>
        ))}
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
      <p className="text-2xl font-semibold text-white">${value.toFixed(2)}</p>
    </div>
  );
}
