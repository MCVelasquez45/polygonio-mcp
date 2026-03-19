import { useSyncExternalStore } from 'react';
import * as strategyApi from '../api/strategy';
import type { BacktestResult, BacktestRunRecord, StrategyPipelineStage, StrategyRecord, StrategyVersionRecord, StructuredStrategy } from '../types';

type StrategyLabStoreState = {
  strategies: StrategyRecord[];
  versions: StrategyVersionRecord[];
  selectedStrategyId: string | null;
  selectedVersionId: string | null;
  pipelineStage: StrategyPipelineStage;
  draftInput: string;
  parsedStrategy: StructuredStrategy | null;
  compiledStrategy: StrategyVersionRecord['compiledArtifacts'] | null;
  latestBacktestRun: BacktestRunRecord | null;
  backtestResults: BacktestResult | null;
  isLoading: boolean;
  isParsing: boolean;
  isCompiling: boolean;
  isBacktesting: boolean;
  error: string | null;
};

type StrategyLabStore = StrategyLabStoreState & {
  setDraftInput: (value: string) => void;
  startNewDraft: () => void;
  loadStrategies: () => Promise<void>;
  selectStrategy: (strategyId: string) => Promise<void>;
  parseDraft: () => Promise<void>;
  compileDraft: () => Promise<void>;
  backtestSelected: () => Promise<void>;
};

const listeners = new Set<() => void>();

let state: StrategyLabStoreState = {
  strategies: [],
  versions: [],
  selectedStrategyId: null,
  selectedVersionId: null,
  pipelineStage: 'draft',
  draftInput: '',
  parsedStrategy: null,
  compiledStrategy: null,
  latestBacktestRun: null,
  backtestResults: null,
  isLoading: false,
  isParsing: false,
  isCompiling: false,
  isBacktesting: false,
  error: null,
};

function setState(update: Partial<StrategyLabStoreState>) {
  state = { ...state, ...update };
  listeners.forEach(listener => listener());
}

function getState() {
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function syncFromVersion(version: StrategyVersionRecord | null) {
  if (!version) {
    return {
      selectedVersionId: null,
      parsedStrategy: null,
      compiledStrategy: null,
      latestBacktestRun: null,
      backtestResults: null,
      draftInput: '',
      pipelineStage: 'draft' as StrategyPipelineStage
    };
  }

  return {
      selectedVersionId: version._id,
      parsedStrategy: version.inputArtifacts.structured,
      compiledStrategy: version.compiledArtifacts,
      latestBacktestRun: version.latestBacktestRun ?? null,
      backtestResults: version.latestBacktestRun?.results ?? null,
      draftInput: version.inputArtifacts.rawInput ?? '',
      pipelineStage: version.latestBacktestRun?.pipelineStage ?? version.pipelineStage
    };
  }

const actions = {
  setDraftInput: (value: string) =>
    setState({
      draftInput: value,
      parsedStrategy: null,
      compiledStrategy: null,
      latestBacktestRun: null,
      backtestResults: null,
      selectedVersionId: null,
      pipelineStage: 'draft',
      error: null
    }),
  startNewDraft: () =>
    setState({
      selectedStrategyId: null,
      selectedVersionId: null,
      versions: [],
      draftInput: '',
      parsedStrategy: null,
      compiledStrategy: null,
      latestBacktestRun: null,
      backtestResults: null,
      pipelineStage: 'draft',
      error: null
    }),
  loadStrategies: async () => {
    setState({ isLoading: true, error: null });
    try {
      const strategies = await strategyApi.listStrategies();
      setState({ strategies });
    } catch (error: any) {
      setState({ error: error?.response?.data?.error ?? error?.message ?? 'Unable to load strategies.' });
    } finally {
      setState({ isLoading: false });
    }
  },
  selectStrategy: async (strategyId: string) => {
    setState({ isLoading: true, error: null, selectedStrategyId: strategyId });
    try {
      const versions = await strategyApi.getStrategyVersions(strategyId);
      const latestVersion = versions[0] ?? null;
      setState({
        versions,
        ...syncFromVersion(latestVersion)
      });
    } catch (error: any) {
      setState({ error: error?.response?.data?.error ?? error?.message ?? 'Unable to load versions.' });
    } finally {
      setState({ isLoading: false });
    }
  },
  parseDraft: async () => {
    const draftInput = getState().draftInput.trim();
    if (!draftInput) {
      setState({ error: 'Enter a strategy hypothesis before parsing.' });
      return;
    }
    setState({ isParsing: true, error: null });
    try {
      const { parsedStrategy } = await strategyApi.parseStrategy(draftInput);
      setState({
        parsedStrategy,
        compiledStrategy: null,
        latestBacktestRun: null,
        backtestResults: null,
        pipelineStage: 'parsed'
      });
    } catch (error: any) {
      setState({ error: error?.response?.data?.error ?? error?.message ?? 'Unable to parse strategy.' });
    } finally {
      setState({ isParsing: false });
    }
  },
  compileDraft: async () => {
    const { draftInput, parsedStrategy, selectedStrategyId } = getState();
    if (!draftInput.trim()) {
      setState({ error: 'Enter a strategy hypothesis before compiling.' });
      return;
    }
    setState({ isCompiling: true, error: null });
    try {
      const { strategy, version } = await strategyApi.compileStrategy({
        input: draftInput,
        parsedStrategy,
        strategyId: selectedStrategyId
      });
      const strategies = await strategyApi.listStrategies();
      setState({
        strategies,
        selectedStrategyId: strategy._id,
        versions: [version],
        ...syncFromVersion(version)
      });
    } catch (error: any) {
      setState({ error: error?.response?.data?.error ?? error?.message ?? 'Unable to compile strategy.' });
    } finally {
      setState({ isCompiling: false });
    }
  },
  backtestSelected: async () => {
    const { selectedStrategyId, selectedVersionId, versions } = getState();
    if (!selectedStrategyId && !selectedVersionId) {
      setState({ error: 'Compile a strategy version before running a backtest.' });
      return;
    }
    setState({ isBacktesting: true, error: null });
    try {
      const response = await strategyApi.backtestStrategy({
        strategyId: selectedStrategyId,
        versionId: selectedVersionId
      });
      const nextVersions = selectedStrategyId ? await strategyApi.getStrategyVersions(selectedStrategyId) : versions;
      const latestVersion =
        nextVersions.find((version: StrategyVersionRecord) => version._id === response.versionId) ?? nextVersions[0] ?? null;
      const strategies = await strategyApi.listStrategies();
      setState({
        strategies,
        versions: nextVersions,
        ...syncFromVersion(latestVersion ?? null),
        pipelineStage: latestVersion?.latestBacktestRun?.pipelineStage ?? 'backtested'
      });
    } catch (error: any) {
      setState({ error: error?.response?.data?.error ?? error?.message ?? 'Unable to run backtest.' });
    } finally {
      setState({ isBacktesting: false });
    }
  }
};

export function useStrategyLabStore(): StrategyLabStore {
  const snapshot = useSyncExternalStore(subscribe, getState, getState);
  return {
    ...snapshot,
    ...actions
  };
}
