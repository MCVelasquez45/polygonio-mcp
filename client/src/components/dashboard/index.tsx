import { useState, useEffect } from 'react';
import { DashboardLayout } from './DashboardLayout';
import { DataHealthPanel } from './DataHealthPanel';
import { ActiveStrategiesPanel } from './ActiveStrategiesPanel';
import { HandoffRequestsPanel } from './HandoffRequestsPanel';
import { ScannerResultsPanel } from './ScannerResultsPanel';
import { AgentChatPanel } from './AgentChatPanel';
import {
  StrategyListPanel,
  StrategyCreationWizard,
  StrategyEditorPanel,
  BacktestConfigModal,
  BacktestResultsPanel,
  BacktestHistoryPanel,
  PaperTradingDashboard,
  PaperSessionHistoryPanel,
  PromotionGatePanel
} from '../lab';
import { EngineRoomDashboard } from '../engine';
import { compileExtractedStrategy } from '../../features/lab/api/strategy';
import { PerformanceReviewDashboard, ABTestingPanel } from '../monitoring';
import { type Socket } from 'socket.io-client';
import { toast } from 'sonner';
import { getApiBaseUrl } from '../../api/http';
import { apiClient, futuresApi } from '../../api';
import type { AiSuggestion } from '../../types/futures';
import { AlpacaPaperTradingDashboard } from '../lab/AlpacaPaperTradingDashboard';
import { OptionsPaperDashboard } from '../lab/OptionsPaperDashboard';

type Props = {
  apiBase?: string;
  onTickerSelect?: (ticker: string) => void;
  socket?: Socket | null;
  authRole?: 'viewer' | 'trader' | 'admin';
  canTrade?: boolean;
  canAdmin?: boolean;
};

export function Dashboard({
  apiBase = getApiBaseUrl(),
  onTickerSelect,
  socket,
  authRole = 'viewer',
  canTrade = false,
  canAdmin = false
}: Props) {
  const [activePanel, setActivePanel] = useState('lab-strategies');
  const [lastActivePanel, setLastActivePanel] = useState('lab-strategies');
  const [showCreationWizard, setShowCreationWizard] = useState(false);
  const [showBacktestConfig, setShowBacktestConfig] = useState(false);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<any>(null);
  const [backtestResultsId, setBacktestResultsId] = useState<string | null>(null);
  const [paperSessionId, setPaperSessionId] = useState<string | null>(null);
  const [alpacaPaperSessionId, setAlpacaPaperSessionId] = useState<string | null>(null);
  const [alpacaSessionType, setAlpacaSessionType] = useState<'equity' | 'options'>('equity');
  const [backgroundExtraction, setBackgroundExtraction] = useState<{
    data?: any;
    status: 'idle' | 'processing' | 'completed' | 'error';
    error?: string;
  }>({ status: 'idle' });
  const [wizardInitialData, setWizardInitialData] = useState<any>(null);
  const [strategyListRefreshKey, setStrategyListRefreshKey] = useState(0);
  const [isCreatingStrategy, setIsCreatingStrategy] = useState(false);

  const handlePanelChange = (panelId: string) => {
    if (panelId !== 'chat') {
      setLastActivePanel(panelId);
    }
    setActivePanel(panelId);
  };

  const handleCreateStrategy = () => {
    if (!canAdmin) {
      toast.error(`Strategy creation requires admin access. Current role: ${authRole}.`);
      return;
    }
    setShowCreationWizard(true);
  };

  const handleWizardComplete = async (strategy: any) => {
    if (isCreatingStrategy) return;
    setIsCreatingStrategy(true);
    const strategyType = strategy?.type === 'futures' ? 'futures' : 'screener';
    const strategyName = typeof strategy?.name === 'string' && strategy.name.trim()
      ? strategy.name.trim()
      : 'Untitled Strategy';
    const strategyDescription = typeof strategy?.description === 'string' ? strategy.description : '';
    const hypothesis = typeof strategy?.hypothesis === 'string' ? strategy.hypothesis : '';
    const transcript = typeof strategy?.transcript === 'string' ? strategy.transcript : '';
    const strategyParams =
      strategy?.parameters && typeof strategy.parameters === 'object' && !Array.isArray(strategy.parameters)
        ? strategy.parameters
        : {};
    const paramDefs =
      strategy?.parameterDefinitions && typeof strategy.parameterDefinitions === 'object'
        ? strategy.parameterDefinitions
        : {};

    const entryRules = Array.isArray(strategy?.entryRules) ? strategy.entryRules.filter((r: string) => r?.trim()) : [];
    const exitRules = Array.isArray(strategy?.exitRules) ? strategy.exitRules.filter((r: string) => r?.trim()) : [];
    const riskManagement = Array.isArray(strategy?.riskManagement) ? strategy.riskManagement.filter((r: string) => r?.trim()) : [];

    const payload: any = {
      name: strategyName,
      description: strategyDescription,
      strategyType,
      ownerId: 'lab_user',
    };

    if (strategyType === 'futures') {
      payload.futuresConfig = {
        contract: String(strategyParams.contract ?? 'ES'),
      };
    } else {
      payload.screenerConfig = {
        screener_type: 'transcript_strategy',
        endpoint: 'manual://strategy-wizard',
        params: {
          source: 'strategy_creation_wizard',
          strategy_template_type: strategy?.type ?? 'custom',
          trading_method: strategy?.tradingMethod ?? (strategy?.type === 'futures' ? 'futures' : strategy?.type === 'options' ? 'options' : 'equities'),
          hypothesis,
          transcript: transcript || undefined,
          parameter_definitions: Object.keys(paramDefs).length > 0 ? paramDefs : undefined,
          entry_rules: entryRules.length > 0 ? entryRules : undefined,
          exit_rules: exitRules.length > 0 ? exitRules : undefined,
          risk_management: riskManagement.length > 0 ? riskManagement : undefined,
          // Extraction-specific fields
          underlying_ticker: strategy?.underlying_ticker || undefined,
          contract_selection: strategy?.contract_selection || undefined,
          regime_config: strategy?.regime_config || undefined,
          time_rules: strategy?.time_rules || undefined,
          ...strategyParams
        },
        schedule: 'manual'
      };
    }

    try {
      const response = await apiClient.post('/api/lab/strategy/create', payload);
      const created = response.data;
      setShowCreationWizard(false);
      setWizardInitialData(null);
      setStrategyListRefreshKey(prev => prev + 1);

      const createdId = String(created?._id ?? created?.id ?? '');
      if (createdId) {
        setSelectedStrategyId(createdId);

        // Auto-compile if we have extraction data
        const hasExtractionData = strategy?.contract_selection || strategy?.regime_config;
        if (hasExtractionData) {
          try {
            const compileResult = await compileExtractedStrategy({
              strategyId: createdId,
              name: strategyName,
              description: strategyDescription,
              hypothesis,
              entry_rules: entryRules,
              exit_rules: exitRules,
              risk_management: riskManagement,
              trading_method: strategy?.tradingMethod ?? 'equities',
              underlying_ticker: strategy?.underlying_ticker,
              contract_selection: strategy?.contract_selection,
              regime_config: strategy?.regime_config,
              time_rules: strategy?.time_rules,
            });
            toast.success(`Strategy created and compiled (${compileResult.version.version})`);
          } catch (compileErr: any) {
            console.warn('Auto-compile failed:', compileErr);
            toast.success('Strategy created. Open editor to compile.');
          }
        } else {
          toast.success('Strategy created in Room A.');
        }
      }
    } catch (error: any) {
      console.error('Failed to create strategy:', error);
      const detail =
        error?.response?.data?.error ||
        error?.response?.data?.detail ||
        error?.message ||
        'Unknown error';
      toast.error(`Failed to create strategy: ${detail}`);
    } finally {
      setIsCreatingStrategy(false);
    }
  };

  const handleSelectStrategy = (strategy: any) => {
    setSelectedStrategyId(strategy.id ?? strategy._id);
    setSelectedStrategy(strategy);
    setActivePanel('lab-backtest-history');
  };

  const handleCompileNotify = () => {
    setStrategyListRefreshKey(prev => prev + 1);
  };

  const handleOpenWizardWithData = (data: any) => {
    setWizardInitialData(data);
    setShowCreationWizard(true);
  };

  const handleExtractionStart = () => {
    setBackgroundExtraction(prev => ({ ...prev, status: 'processing' }));
    toast.loading('AI is processing your strategy...', {
      id: 'ai-extraction',
      description: 'You can continue using the app while I work.',
      action: {
        label: 'View',
        onClick: () => setShowCreationWizard(true)
      }
    });
  };

  // Socket listener for background extraction
  useEffect(() => {
    if (!socket) return;

    const handleExtraction = (payload: any) => {
      console.log('[DASHBOARD] Received background extraction:', payload);
      setBackgroundExtraction({
        data: payload.data,
        status: payload.status,
        error: payload.error
      });

      if (payload.status === 'completed') {
        toast.success('AI Strategy Ready!', {
          id: 'ai-extraction',
          description: 'Click to review the extracted parameters.',
          duration: 10000,
          action: {
            label: 'Review',
            onClick: () => handleOpenWizardWithData(payload.data)
          }
        });
      } else if (payload.status === 'error') {
        toast.error('AI Extraction Failed', {
          id: 'ai-extraction',
          description: payload.error || 'There was an error processing your transcript.'
        });
      }
    };

    socket.on('strategy-extracted', handleExtraction);

    return () => {
      socket.off('strategy-extracted', handleExtraction);
    };
  }, [socket]);

  const handleApplySuggestions = async (suggestions: AiSuggestion[]) => {
    if (!selectedStrategyId) return;
    try {
      await futuresApi.applySuggestions(selectedStrategyId, suggestions);
      toast.success('Suggestions applied to strategy.');
      setStrategyListRefreshKey(prev => prev + 1);
      setActivePanel('lab-editor');
    } catch (error: any) {
      toast.error(`Failed to apply suggestions: ${error?.message ?? 'Unknown error'}`);
    }
  };

  const handleIterateAndRerun = async (suggestions: AiSuggestion[]) => {
    if (!selectedStrategyId) return;
    try {
      toast.loading('Applying suggestions and re-running backtest...', { id: 'iterate' });
      await futuresApi.applySuggestions(selectedStrategyId, suggestions);
      setStrategyListRefreshKey(prev => prev + 1);

      const strategyName = selectedStrategy?.name ?? 'FuturesStrategy';
      const symbol =
        selectedStrategy?.futuresConfig?.contract ??
        selectedStrategy?.parameters?.contract ??
        'ES';

      const backtest = await futuresApi.runStrategyBacktest({
        strategyId: selectedStrategyId,
        strategyName,
        symbol,
        startDate: '2024-01-01',
        endDate: '2025-12-31',
        initialCapital: 100000,
        contracts: 1,
        rollPolicy: 'volume',
        rollDaysBefore: 5,
        slippageBps: 1.5,
        feePerContract: 2.5,
      });
      setBacktestResultsId(backtest._id);
      setActivePanel('lab-backtest-results');
      toast.success('Iteration complete — new backtest results ready.', { id: 'iterate' });
    } catch (error: any) {
      toast.error(`Iteration failed: ${error?.message ?? 'Unknown error'}`, { id: 'iterate' });
    }
  };

  const handleRunBacktest = () => {
    setShowBacktestConfig(true);
  };

  const handleStartBacktest = async (config: any) => {
    if (!selectedStrategyId) return;
    try {
      setShowBacktestConfig(false);
      const strategyName = selectedStrategy?.name ?? 'FuturesStrategy';
      const symbol =
        selectedStrategy?.futuresConfig?.contract ??
        config.contractType ??
        selectedStrategy?.parameters?.contract ??
        'ES';

      const backtest = await futuresApi.runStrategyBacktest({
        strategyId: selectedStrategyId,
        strategyName,
        symbol,
        startDate: config.startDate,
        endDate: config.endDate,
        initialCapital: Number(config.initialCapital ?? 100000),
        contracts: Number(config.position_size_contracts ?? 1),
        rollPolicy: config.rollStrategy ?? 'volume',
        rollDaysBefore: Number(config.roll_days_before_expiry ?? 5),
        slippageBps: config.slippageModel === 'zero' ? 0 : config.slippageModel === 'fixed' ? 1 : 2.5,
        feePerContract: config.commissionModel === 'zero' ? 0 : config.commissionModel === 'fixed' ? 1 : 2.5
      });
      setBacktestResultsId(backtest._id);

      setActivePanel('lab-backtest-results');
      toast.success('Backtest completed — deploy to paper from results when ready.');
    } catch (error: any) {
      toast.error(`Backtest failed: ${error?.message ?? 'Unknown error'}`);
      setShowBacktestConfig(false);
    }
  };

  const getPanelLabel = () => {
    const labels: Record<string, string> = {
      'lab-strategies': 'Strategy Pipeline',
      'lab-editor': 'Strategy Editor',
      'lab-backtest-history': 'Backtest History',
      'lab-backtest-results': 'Backtest Results',
      'lab-paper-history': 'Paper Sessions',
      'lab-paper': 'Paper Trading Monitor',
      'lab-promotion': 'Promotion Gate',
      'live': 'Engine Room',
      'monitoring-perf': 'Performance Review',
      'monitoring-ab': 'A/B Testing & History',
      'health': 'Data Health',
      'strategies': 'Active Strategies',
      'handoffs': 'Handoff Requests',
      'scanner': 'Scanner Results',
      'chat': 'Agent Chat',
    };
    return labels[activePanel] || activePanel;
  };

  const renderPanel = () => {
    switch (activePanel) {
      case 'lab-strategies':
        return (
          <StrategyListPanel
            onCreateNew={handleCreateStrategy}
            onSelectStrategy={handleSelectStrategy}
            refreshKey={strategyListRefreshKey}
          />
        );
      case 'lab-backtest-history':
        return selectedStrategyId ? (
          <BacktestHistoryPanel
            strategyId={selectedStrategyId}
            strategyName={selectedStrategy?.name}
            onSelectBacktest={(backtestId) => {
              setBacktestResultsId(backtestId);
              setActivePanel('lab-backtest-results');
            }}
            onRunNew={handleRunBacktest}
            onBack={() => setActivePanel('lab-strategies')}
            onEditStrategy={() => setActivePanel('lab-editor')}
            onViewPaperSessions={() => setActivePanel('lab-paper-history')}
          />
        ) : null;
      case 'lab-editor':
        return (
          <StrategyEditorPanel
            strategyId={selectedStrategyId || undefined}
            onRunBacktest={handleRunBacktest}
            onSave={() => setStrategyListRefreshKey(prev => prev + 1)}
            onBack={() => setActivePanel('lab-backtest-history')}
            onCompile={handleCompileNotify}
          />
        );
      case 'lab-backtest-results':
        return (
          <BacktestResultsPanel
            backtestId={backtestResultsId || undefined}
            strategyId={selectedStrategyId || undefined}
            canTrade={canTrade}
            onDeployToPaper={(sessionId, sessionType) => {
              setAlpacaPaperSessionId(sessionId);
              setAlpacaSessionType(sessionType);
              setActivePanel('lab-paper');
            }}
            onClose={() => setActivePanel(selectedStrategyId ? 'lab-backtest-history' : 'lab-strategies')}
            onApplySuggestions={handleApplySuggestions}
            onIterateAndRerun={handleIterateAndRerun}
          />
        );
      case 'lab-paper-history':
        return selectedStrategyId ? (
          <PaperSessionHistoryPanel
            strategyId={selectedStrategyId}
            strategyName={selectedStrategy?.name}
            onSelectSession={(sessionId, kind) => {
              if (kind === 'futures') {
                setPaperSessionId(sessionId);
                setAlpacaPaperSessionId(null);
                setAlpacaSessionType('equity');
              } else if (kind === 'options') {
                setAlpacaPaperSessionId(sessionId);
                setAlpacaSessionType('options');
              } else {
                setAlpacaPaperSessionId(sessionId);
                setAlpacaSessionType('equity');
              }
              setActivePanel('lab-paper');
            }}
            onBack={() => setActivePanel('lab-backtest-history')}
          />
        ) : null;
      case 'lab-paper':
        return alpacaPaperSessionId && alpacaSessionType === 'options' ? (
          <OptionsPaperDashboard
            sessionId={alpacaPaperSessionId}
            strategyId={selectedStrategyId || undefined}
            strategyName={selectedStrategy?.name}
            canTrade={canTrade}
            onBack={() => setActivePanel(selectedStrategyId ? 'lab-paper-history' : 'lab-backtest-results')}
          />
        ) : alpacaPaperSessionId ? (
          <AlpacaPaperTradingDashboard
            sessionId={alpacaPaperSessionId}
            strategyId={selectedStrategyId || undefined}
            strategyName={selectedStrategy?.name}
            canTrade={canTrade}
            onBack={() => setActivePanel(selectedStrategyId ? 'lab-paper-history' : 'lab-backtest-results')}
          />
        ) : (
          <PaperTradingDashboard
            sessionId={paperSessionId || undefined}
            strategyId={selectedStrategyId || undefined}
            strategyName={selectedStrategy?.name}
            canTrade={canTrade}
            onRequestPromotion={() => setActivePanel('lab-promotion')}
          />
        );
      case 'lab-promotion':
        return (
          <PromotionGatePanel
            sessionId={paperSessionId || undefined}
            strategyId={selectedStrategyId || undefined}
            symbol={selectedStrategy?.futuresConfig?.contract ?? 'ES'}
            canAdmin={canAdmin}
            onPromote={() => setActivePanel('live')}
          />
        );
      case 'live':
        return <EngineRoomDashboard sessionId={paperSessionId || undefined} strategyId={selectedStrategyId || undefined} canAdmin={canAdmin} />;
      case 'monitoring-perf':
        return <PerformanceReviewDashboard />;
      case 'monitoring-ab':
        return <ABTestingPanel />;
      case 'health':
        return <DataHealthPanel apiBase={apiBase} />;
      case 'strategies':
        return <ActiveStrategiesPanel apiBase={apiBase} />;
      case 'handoffs':
        return <HandoffRequestsPanel apiBase={apiBase} />;
      case 'scanner':
        return <ScannerResultsPanel socketUrl={apiBase} onTickerSelect={onTickerSelect} />;
      case 'chat':
        return <AgentChatPanel apiBase={apiBase} context={{ source: lastActivePanel }} />;
      default:
        return <StrategyListPanel onCreateNew={handleCreateStrategy} refreshKey={strategyListRefreshKey} />;
    }
  };

  return (
    <>
      <DashboardLayout
        activePanel={activePanel}
        onPanelChange={handlePanelChange}
      >
        <div className="dashboard-main">
          <div className="main-header">
            <h1>{getPanelLabel()}</h1>
            <div className="header-actions">
              <span className="breadcrumb-home">The Lab</span>
              <span className="breadcrumb-sep">/</span>
              <span className="breadcrumb-current">{getPanelLabel()}</span>
            </div>
          </div>

          {renderPanel()}
        </div>

        <style>{`
          .dashboard-main {
            display: flex;
            flex-direction: column;
            height: 100%;
            overflow: hidden;
          }

          .main-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1.5rem 2rem;
            border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
            background: var(--bg-surface, #0c0e18);
            flex-shrink: 0;
          }

          .main-header h1 {
            margin: 0;
            font-size: 1.375rem;
            font-weight: 700;
            color: var(--text-primary, #f0f2f5);
            letter-spacing: -0.01em;
          }

          .header-actions {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.8rem;
          }

          .breadcrumb-home {
            color: var(--text-tertiary, #555d73);
          }

          .breadcrumb-sep {
            color: var(--text-tertiary, #555d73);
            opacity: 0.5;
          }

          .breadcrumb-current {
            color: var(--accent, #10b981);
            font-weight: 600;
          }
        `}</style>
      </DashboardLayout>

      {showCreationWizard && (
        <StrategyCreationWizard
          initialData={wizardInitialData}
          socketId={socket?.id}
          isProcessing={backgroundExtraction.status === 'processing'}
          isSubmitting={isCreatingStrategy}
          onExtractionStart={handleExtractionStart}
          onComplete={handleWizardComplete}
          onCancel={() => {
            setShowCreationWizard(false);
            setWizardInitialData(null);
          }}
        />
      )}

      {showBacktestConfig && (
        <BacktestConfigModal
          strategyName={selectedStrategy?.name ?? 'FuturesStrategy'}
          strategyType={selectedStrategy?.type === 'futures' || selectedStrategy?.strategyType === 'futures' ? 'futures' : undefined}
          onRun={handleStartBacktest}
          onCancel={() => setShowBacktestConfig(false)}
        />
      )}
    </>
  );
}

// Export all dashboard components for individual use
export { DashboardLayout } from './DashboardLayout';
export { DataHealthPanel } from './DataHealthPanel';
export { ActiveStrategiesPanel } from './ActiveStrategiesPanel';
export { HandoffRequestsPanel } from './HandoffRequestsPanel';
export { ScannerResultsPanel } from './ScannerResultsPanel';
export { AgentChatPanel } from './AgentChatPanel';
