import type { StructuredStrategy } from './types';

type Props = {
  draftInput: string;
  parsedStrategy: StructuredStrategy | null;
  isParsing: boolean;
  onDraftChange: (value: string) => void;
  onParse: () => void;
};

export function StrategyInputPanel({ draftInput, parsedStrategy, isParsing, onDraftChange, onParse }: Props) {
  return (
    <section className="rounded-2xl border border-gray-900 bg-gray-950/70 p-4 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Strategy Input</p>
        <h2 className="text-lg font-semibold text-white">Natural Language Hypothesis</h2>
      </div>

      <textarea
        value={draftInput}
        onChange={event => onDraftChange(event.target.value)}
        rows={6}
        placeholder="Buy calls when RSI < 30 and price touches VWAP. Exit when RSI > 55."
        className="w-full rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3 text-sm text-gray-100 outline-none focus:border-emerald-500/60"
      />

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-gray-500">
          Input can come from text, transcripts, or voice later. This MVP uses the same parse pipeline for all three.
        </p>
        <button
          type="button"
          onClick={onParse}
          disabled={isParsing}
          className="rounded-full border border-emerald-500/40 px-4 py-2 text-sm text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-60"
        >
          {isParsing ? 'Parsing...' : 'Parse Strategy'}
        </button>
      </div>

      {parsedStrategy && (
        <div className="rounded-2xl border border-gray-900 bg-gray-900/40 p-3 text-xs text-gray-300 space-y-2">
          <p className="font-semibold text-white">{parsedStrategy.name}</p>
          <p>
            Instrument: <span className="text-emerald-200">{parsedStrategy.instrument}</span>
          </p>
          <p>
            Entry rules: <span className="text-white">{parsedStrategy.entry.length}</span> · Exit rules:{' '}
            <span className="text-white">{parsedStrategy.exit.length}</span>
          </p>
          {parsedStrategy.warnings.length > 0 && (
            <ul className="space-y-1 text-amber-200">
              {parsedStrategy.warnings.map(warning => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
