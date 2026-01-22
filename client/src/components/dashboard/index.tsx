import { useState } from 'react';
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

type Props = {
  apiBase?: string;
  onTickerSelect?: (ticker: string) => void;
};

export function Dashboard({ apiBase = 'http://localhost:3000', onTickerSelect }: Props) {
  const [activePanel, setActivePanel] = useState('lab-strategies');
  const [lastActivePanel, setLastActivePanel] = useState('lab-strategies');
  const [showCreationWizard, setShowCreationWizard] = useState(false);
  const [showBacktestConfig, setShowBacktestConfig] = useState(false);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null);
  const [backtestResultsId, setBacktestResultsId] = useState<string | null>(null);

  const handlePanelChange = (panelId: string) => {
    if (panelId !== 'chat') {
      setLastActivePanel(panelId);
    }
    setActivePanel(panelId);
  };

  const handleCreateStrategy = () => {
    setShowCreationWizard(true);
  };

  const handleWizardComplete = (strategy: any) => {
    console.log('Strategy created:', strategy);
    setShowCreationWizard(false);
    // TODO: Save to backend
  };

  const handleSelectStrategy = (strategy: any) => {
    setSelectedStrategyId(strategy.id);
    setActivePanel('lab-editor');
  };

  const handleRunBacktest = () => {
    setShowBacktestConfig(true);
  };

  const handleStartBacktest = (config: any) => {
    console.log('Starting backtest with:', config);
    setShowBacktestConfig(false);
    // Simulate backtest run and show results
    setBacktestResultsId('BT-20250116-001');
    setActivePanel('lab-backtest-results');
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
          />
        );
      case 'lab-editor':
        return (
          <StrategyEditorPanel
            strategyId={selectedStrategyId || undefined}
            onRunBacktest={handleRunBacktest}
            onSave={(code) => console.log('Save code', code)}
          />
        );
      case 'lab-backtest-results':
        return (
          <BacktestResultsPanel
            backtestId={backtestResultsId || undefined}
            onClose={() => setActivePanel('lab-editor')}
          />
        );
      case 'lab-paper':
        return <PaperTradingDashboard />;
      case 'lab-promotion':
        return <PromotionGatePanel />;
      case 'live':
        return <EngineRoomDashboard />;
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
        return <StrategyListPanel onCreateNew={handleCreateStrategy} />;
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
          .dashboard-content {
            display: flex;
            flex-direction: column;
            gap: 1.5rem;
            height: 100%;
          }

          .breadcrumb {
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
            color: #e5e5e5;
            font-weight: 500;
          }
        `}</style>
      </DashboardLayout>

      {showCreationWizard && (
        <StrategyCreationWizard
          onComplete={handleWizardComplete}
          onCancel={() => setShowCreationWizard(false)}
        />
      )}

      {showBacktestConfig && (
        <BacktestConfigModal
          strategyName="VolArbitrage_v2"
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

