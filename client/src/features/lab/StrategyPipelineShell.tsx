import { useEffect } from 'react';
import { StrategyInputPanel } from './StrategyInputPanel';
import { StrategyCompilePanel } from './StrategyCompilePanel';
import { StrategyBacktestPanel } from './StrategyBacktestPanel';
import { useStrategyLabStore } from './store/useStrategyLabStore';
import type { StrategyPipelineStage, StrategyRecord, StrategyVersionRecord } from './types';

const STAGES: StrategyPipelineStage[] = ['draft', 'parsed', 'compiled', 'backtested'];

export function StrategyPipelineShell() {
  const {
    strategies,
    versions,
    selectedStrategyId,
    selectedVersionId,
    pipelineStage,
    draftInput,
    parsedStrategy,
    compiledStrategy,
    latestBacktestRun,
    backtestResults,
    isLoading,
    isParsing,
    isCompiling,
    isBacktesting,
    error,
    setDraftInput,
    startNewDraft,
    loadStrategies,
    selectStrategy,
    parseDraft,
    compileDraft,
    backtestSelected
  } = useStrategyLabStore();

  useEffect(() => {
    void loadStrategies();
  }, [loadStrategies]);

  return (
    <div className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="rounded-2xl border border-gray-900 bg-gray-950/70 p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Stored Strategies</p>
            <h2 className="text-lg font-semibold text-white">Pipeline Registry</h2>
          </div>
          <button
            type="button"
            onClick={startNewDraft}
            className="rounded-full border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/10"
          >
            New Draft
          </button>
        </div>

        <div className="space-y-2">
          {isLoading && !strategies.length ? (
            <p className="text-sm text-gray-500">Loading strategies...</p>
          ) : strategies.length ? (
            strategies.map((strategy: StrategyRecord) => (
              <button
                key={strategy._id}
                type="button"
                onClick={() => void selectStrategy(strategy._id)}
                className={`w-full rounded-2xl border px-3 py-3 text-left ${selectedStrategyId === strategy._id
                  ? 'border-emerald-500/40 bg-emerald-500/10'
                  : 'border-gray-900 bg-gray-900/30 hover:border-gray-700'
                  }`}
              >
                <p className="font-medium text-white">{strategy.name}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {strategy.pipelineStage} · v{strategy.latestVersion}
                </p>
              </button>
            ))
          ) : (
            <p className="text-sm text-gray-500">No strategies compiled yet.</p>
          )}
        </div>

        {versions.length > 0 && (
          <div className="rounded-2xl border border-gray-900 bg-gray-900/30 p-3">
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Versions</p>
            <div className="mt-2 space-y-1">
              {versions.map((version: StrategyVersionRecord) => (
                <div
                  key={version._id}
                  className={`rounded-xl px-3 py-2 text-xs ${selectedVersionId === version._id ? 'bg-sky-500/10 text-sky-100' : 'text-gray-400'
                    }`}
                >
                  v{version.version} · {version.pipelineStage}
                  {version.latestBacktestRun ? ' · backtest run' : ''}
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>

      <section className="space-y-4">
        <div className="rounded-2xl border border-gray-900 bg-gray-950/70 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {STAGES.map(stage => (
              <div
                key={stage}
                className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.2em] ${pipelineStage === stage
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
                  : 'border-gray-800 text-gray-500'
                  }`}
              >
                {stage}
              </div>
            ))}
          </div>
          {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
        </div>

        <StrategyInputPanel
          draftInput={draftInput}
          parsedStrategy={parsedStrategy}
          isParsing={isParsing}
          onDraftChange={setDraftInput}
          onParse={() => void parseDraft()}
        />

        <StrategyCompilePanel
          parsedStrategy={parsedStrategy}
          compiledStrategy={compiledStrategy}
          selectedVersionId={selectedVersionId}
          isCompiling={isCompiling}
          onCompile={() => void compileDraft()}
        />

        <StrategyBacktestPanel
          canRun={Boolean(compiledStrategy && (selectedVersionId || selectedStrategyId))}
          isBacktesting={isBacktesting}
          backtestRun={latestBacktestRun}
          backtestResults={backtestResults}
          onRun={() => void backtestSelected()}
        />
      </section>
    </div>
  );
}
