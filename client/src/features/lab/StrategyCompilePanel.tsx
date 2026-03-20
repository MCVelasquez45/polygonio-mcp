import type { StrategyVersionRecord, StructuredStrategy } from './types';

type Props = {
  parsedStrategy: StructuredStrategy | null;
  compiledStrategy: StrategyVersionRecord['compiledArtifacts'] | null;
  selectedVersionId: string | null;
  isCompiling: boolean;
  onCompile: () => void;
};

function renderJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function StrategyCompilePanel({
  parsedStrategy,
  compiledStrategy,
  selectedVersionId,
  isCompiling,
  onCompile
}: Props) {
  return (
    <section className="rounded-2xl border border-gray-900 bg-gray-950/70 p-4 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Compile</p>
          <h2 className="text-lg font-semibold text-white">Structured JSON → AST → DSL</h2>
        </div>
        <button
          type="button"
          onClick={onCompile}
          disabled={isCompiling || !parsedStrategy}
          className="rounded-full border border-sky-500/40 px-4 py-2 text-sm text-sky-200 hover:bg-sky-500/10 disabled:opacity-60"
        >
          {isCompiling ? 'Compiling...' : selectedVersionId ? 'Recompile Version' : 'Compile Strategy'}
        </button>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ArtifactCard title="Structured JSON" value={parsedStrategy ? renderJson(parsedStrategy) : 'Parse a strategy to inspect JSON.'} />
        <ArtifactCard title="AST" value={compiledStrategy?.ast ? renderJson(compiledStrategy.ast) : 'Compile a strategy to inspect the AST.'} />
        <ArtifactCard title="DSL" value={compiledStrategy?.dsl ?? 'Compile a strategy to inspect the DSL.'} />
      </div>
    </section>
  );
}

function ArtifactCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-900 bg-gray-900/40 p-4 min-h-[18rem]">
      <p className="text-xs uppercase tracking-[0.3em] text-gray-500">{title}</p>
      <pre className="mt-3 whitespace-pre-wrap break-words text-xs text-gray-200">{value}</pre>
    </div>
  );
}
