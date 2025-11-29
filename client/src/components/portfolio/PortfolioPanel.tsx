import { useEffect, useMemo, useState } from 'react';
import { getBrokerAccount, getOptionPositions } from '../../api/alpaca';

type PositionView = {
  symbol: string;
  qty: number;
  side: 'long' | 'short';
  avgCost: number;
  mark: number;
  marketValue: number;
  unrealizedPnl: number;
};

export function PortfolioPanel() {
  const [positions, setPositions] = useState<PositionView[]>([]);
  const [accountSummary, setAccountSummary] = useState<{ buyingPower: number; equity: number; cash: number }>({
    buyingPower: 0,
    equity: 0,
    cash: 0
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [account, positionResponse] = await Promise.all([getBrokerAccount(), getOptionPositions()]);
        if (cancelled) return;
        const normalizedPositions: PositionView[] = positionResponse.positions?.map(pos => ({
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
      } catch (err: any) {
        if (!cancelled) {
          const message = err?.response?.data?.error ?? err?.message ?? 'Failed to load Alpaca account';
          setError(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalPnl = useMemo(() => positions.reduce((sum, row) => sum + row.unrealizedPnl, 0), [positions]);

  return (
    <section className="bg-gray-950 border border-gray-900 rounded-2xl p-6 space-y-4">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Portfolio Risk</p>
        <h2 className="text-2xl font-semibold">Current Book Overview</h2>
        <p className="text-sm text-gray-400">Live view of Alpaca paper positions & buying power.</p>
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
        {positions.map(pos => (
          <div key={pos.symbol} className="rounded-2xl border border-gray-900 bg-gray-950 p-4">
            <div className="flex items-center justify-between">
              <p className="text-lg font-semibold">{pos.symbol}</p>
              <p className={`text-sm ${pos.side === 'long' ? 'text-emerald-400' : 'text-red-400'}`}>
                {pos.side.toUpperCase()} {Math.abs(pos.qty)}
              </p>
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
                <p className="text-xs uppercase tracking-widest">P&L</p>
                <p className={`text-base font-semibold ${pos.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {pos.unrealizedPnl >= 0 ? '+' : ''}${pos.unrealizedPnl.toFixed(2)}
                </p>
              </div>
            </div>
          </div>
        ))}
        {!positions.length && !loading && <p className="text-sm text-gray-500">No option positions in Alpaca paper account.</p>}
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
