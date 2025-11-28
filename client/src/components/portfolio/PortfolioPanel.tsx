const positions = [
  { symbol: 'AAPL 02/21 200C', qty: 12, cost: 4.1, mark: 5.6, pnl: 1800 },
  { symbol: 'SPY 03/14 520C', qty: -8, cost: 6.3, mark: 4.9, pnl: 1120 },
  { symbol: 'QQQ 02/28 420P', qty: 5, cost: 3.2, mark: 2.1, pnl: -550 },
];

export function PortfolioPanel() {
  const total = positions.reduce((sum, row) => sum + row.pnl, 0);

  return (
    <section className="bg-gray-950 border border-gray-900 rounded-2xl p-6 space-y-4">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Portfolio Risk</p>
        <h2 className="text-2xl font-semibold">Current Book Overview</h2>
        <p className="text-sm text-gray-400">Desk-level view of open option positions, updated from Massive fills.</p>
      </header>
      <div className="rounded-2xl border border-gray-900 bg-gray-950 p-4">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Net P&L</p>
        <p className={`text-3xl font-semibold ${total >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {total >= 0 ? '+' : ''}${total.toFixed(2)}
        </p>
      </div>
      <div className="space-y-3">
        {positions.map(pos => (
          <div key={pos.symbol} className="rounded-2xl border border-gray-900 bg-gray-950 p-4">
            <div className="flex items-center justify-between">
              <p className="text-lg font-semibold">{pos.symbol}</p>
              <p className={`text-sm ${pos.qty > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {pos.qty > 0 ? 'LONG' : 'SHORT'} {Math.abs(pos.qty)}
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-sm text-gray-400">
              <div>
                <p className="text-xs uppercase tracking-widest">Avg cost</p>
                <p className="text-base text-white">${pos.cost.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest">Mark</p>
                <p className="text-base text-white">${pos.mark.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest">Value</p>
                <p className="text-base text-white">${(pos.mark * pos.qty * 100).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest">P&L</p>
                <p className={`text-base font-semibold ${pos.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {pos.pnl >= 0 ? '+' : ''}${pos.pnl.toFixed(2)}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
