const scannerRows = [
  {
    symbol: 'NVDA',
    contract: 'O:NVDA250307C00500000',
    expiry: '2025-03-07',
    ivRank: 72,
    flow: '+$18.5M',
    comment: 'Call sweeps stacked at 500 strike; momentum desk watching for breakout.',
  },
  {
    symbol: 'TSLA',
    contract: 'O:TSLA250314P00200000',
    expiry: '2025-03-14',
    ivRank: 54,
    flow: '-$7.3M',
    comment: 'Put protection rolling higher as implied vol cools.',
  },
  {
    symbol: 'SPY',
    contract: 'O:SPY250221C00525000',
    expiry: '2025-02-21',
    ivRank: 33,
    flow: '+$24.9M',
    comment: 'Gamma flip expected above 525 — dealers likely to chase delta.',
  },
];

type Props = {
  onTickerSelect?: (ticker: string) => void;
};

export function OptionsScanner({ onTickerSelect }: Props) {
  return (
    <section className="bg-gray-950 border border-gray-900 rounded-2xl p-6 space-y-4">
      <div className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Options Scanner</p>
        <h2 className="text-2xl font-semibold">Live flows + vol regimes</h2>
        <p className="text-sm text-gray-400">Signals update as Massive publishes new contract trades. Click a ticker to load it on the desk.</p>
      </div>

      <div className="space-y-3">
        {scannerRows.map(row => (
          <button
            key={row.contract}
            type="button"
            onClick={() => onTickerSelect?.(row.symbol)}
            className="w-full text-left rounded-2xl border border-gray-900 bg-gray-950 p-4 hover:border-emerald-500/50 transition-colors"
          >
            <div className="flex flex-wrap gap-3 items-center justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-gray-500">{row.symbol}</p>
                <p className="text-lg font-semibold text-white">{row.contract}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-400">Expires {new Date(row.expiry).toLocaleDateString()}</p>
                <p className="text-base font-semibold text-emerald-400">{row.flow}</p>
              </div>
              <div className="text-sm text-gray-300 flex-1 min-w-full border-t border-gray-900 pt-3">
                {row.comment}
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
