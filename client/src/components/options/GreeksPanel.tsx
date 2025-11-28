import type { OptionContractDetail } from '../../types/market';

const metrics = [
  { key: 'delta', label: 'Delta' },
  { key: 'gamma', label: 'Gamma' },
  { key: 'theta', label: 'Theta' },
  { key: 'vega', label: 'Vega' },
  { key: 'rho', label: 'Rho' },
] as const;

type Props = {
  contract?: OptionContractDetail | null;
  label?: string;
};

export function GreeksPanel({ contract, label }: Props) {
  const greeks = contract?.greeks ?? {};
  const meta = [
    { label: 'Expiration', value: contract?.expiration ? new Date(contract.expiration).toLocaleDateString() : '—' },
    { label: 'Strike', value: contract?.strike ? `$${contract.strike.toFixed(2)}` : '—' },
    { label: 'Implied Vol', value: contract?.impliedVolatility ? `${(contract.impliedVolatility * 100).toFixed(1)}%` : '—' },
    { label: 'Open Interest', value: contract?.openInterest?.toLocaleString() ?? '—' },
  ];

  return (
    <section className="bg-gray-950 border border-gray-900 rounded-2xl p-4 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Greeks + Risk</p>
          <p className="text-lg font-semibold text-gray-100">{label ?? contract?.ticker ?? 'Select a contract'}</p>
        </div>
        {contract?.type && (
          <span className={`px-3 py-1 text-xs rounded-full border ${
            contract.type === 'call'
              ? 'border-emerald-500/40 text-emerald-300'
              : 'border-red-500/40 text-red-300'
          }`}>
            {contract.type.toUpperCase()}
          </span>
        )}
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        {meta.map(item => (
          <div key={item.label} className="rounded-2xl border border-gray-900 bg-gray-950 p-3">
            <p className="text-xs uppercase tracking-widest text-gray-500">{item.label}</p>
            <p className="text-base font-semibold text-white mt-1">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {metrics.map(metric => (
          <div key={metric.key} className="rounded-2xl border border-gray-900 bg-gray-950 p-3">
            <p className="text-xs uppercase tracking-widest text-gray-500">{metric.label}</p>
            <p className="text-xl font-semibold text-white mt-1">
              {greeks[metric.key] != null ? Number(greeks[metric.key]).toFixed(4) : '—'}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
