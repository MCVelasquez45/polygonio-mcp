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
  PaperTradingDashboard,
  PromotionGatePanel
} from '../lab';
import { EngineRoomDashboard } from '../engine';
import { PerformanceReviewDashboard, ABTestingPanel } from '../monitoring';
import { type Socket } from 'socket.io-client';
import { toast } from 'sonner';
import { getApiBaseUrl } from '../../api/http';
import { apiClient, futuresApi } from '../../api';

type Props = {
  apiBase?: string;
  onTickerSelect?: (ticker: string) => void;
  socket?: Socket | null;
};

export function Dashboard({ apiBase = getApiBaseUrl(), onTickerSelect, socket }: Props) {
  const [activePanel, setActivePanel] = useState('lab-strategies');
  const [lastActivePanel, setLastActivePanel] = useState('lab-strategies');
  const [showCreationWizard, setShowCreationWizard] = useState(false);
  const [showBacktestConfig, setShowBacktestConfig] = useState(false);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<any>(null);
  const [backtestResultsId, setBacktestResultsId] = useState<string | null>(null);
  const [paperSessionId, setPaperSessionId] = useState<string | null>(null);
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
          hypothesis,
          transcript: transcript || undefined,
          parameter_definitions: Object.keys(paramDefs).length > 0 ? paramDefs : undefined,
          entry_rules: entryRules.length > 0 ? entryRules : undefined,
          exit_rules: exitRules.length > 0 ? exitRules : undefined,
          risk_management: riskManagement.length > 0 ? riskManagement : undefined,
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
      toast.success('Strategy created in Room A.');
      if (created?._id || created?.id) {
        setSelectedStrategyId(String(created._id ?? created.id));
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
    setActivePanel('lab-editor');
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

      const backtest = await futuresApi.runFuturesBacktest({
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

      const paper = await futuresApi.startFuturesPaperSession({
        strategyId: selectedStrategyId,
        strategyName,
        symbol,
        contracts: Number(config.position_size_contracts ?? 1),
        initialCapital: Number(config.initialCapital ?? 100000),
        maxDailyLoss: 5000,
        maxDrawdown: 0.08,
        slippageBps: config.slippageModel === 'zero' ? 0 : config.slippageModel === 'fixed' ? 1 : 2.5,
        feePerContract: config.commissionModel === 'zero' ? 0 : config.commissionModel === 'fixed' ? 1 : 2.5
      });
      setPaperSessionId(paper._id);

      setActivePanel('lab-backtest-results');
      toast.success('Futures backtest completed and paper session started.');
    } catch (error: any) {
      toast.error(`Backtest failed: ${error?.message ?? 'Unknown error'}`);
      setShowBacktestConfig(false);
    }
  };

  const getPanelLabel = () => {
    const labels: Record<string, string> = {
      'lab-strategies': 'Strategy Pipeline',
      'lab-editor': 'Strategy Editor',
      'lab-backtest-results': 'Backtest Results',
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
      case 'lab-editor':
        return (
          <StrategyEditorPanel
            strategyId={selectedStrategyId || undefined}
            onRunBacktest={handleRunBacktest}
            onSave={() => setStrategyListRefreshKey(prev => prev + 1)}
            onBack={() => setActivePanel('lab-strategies')}
          />
        );
      case 'lab-backtest-results':
        return (
          <BacktestResultsPanel
            backtestId={backtestResultsId || undefined}
            strategyId={selectedStrategyId || undefined}
            onDeployToPaper={() => setActivePanel('lab-paper')}
            onClose={() => setActivePanel('lab-editor')}
          />
        );
      case 'lab-paper':
        return (
          <PaperTradingDashboard
            sessionId={paperSessionId || undefined}
            strategyId={selectedStrategyId || undefined}
            strategyName={selectedStrategy?.name}
            onRequestPromotion={() => setActivePanel('lab-promotion')}
          />
        );
      case 'lab-promotion':
        return (
          <PromotionGatePanel
            sessionId={paperSessionId || undefined}
            strategyId={selectedStrategyId || undefined}
            symbol={selectedStrategy?.futuresConfig?.contract ?? 'ES'}
            onPromote={() => setActivePanel('live')}
          />
        );
      case 'live':
        return <EngineRoomDashboard sessionId={paperSessionId || undefined} strategyId={selectedStrategyId || undefined} />;
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
            gap: 1.5rem;
            height: 100%;
          }

          .main-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding-bottom: 1.5rem;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          }

          .main-header h1 {
            margin: 0;
            font-size: 1.5rem;
            font-weight: 700;
            color: #e5e5e5;
          }

          .header-actions {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.85rem;
          }

          .breadcrumb-home {
            color: #6b7280;
          }

          .breadcrumb-sep {
            color: #4b5563;
          }

          .breadcrumb-current {
            color: #10b981;
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
