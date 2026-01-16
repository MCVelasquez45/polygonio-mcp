import { useState } from 'react';
import { DashboardLayout } from './DashboardLayout';
import { DataHealthPanel } from './DataHealthPanel';
import { ActiveStrategiesPanel } from './ActiveStrategiesPanel';
import { HandoffRequestsPanel } from './HandoffRequestsPanel';
import { ScannerResultsPanel } from './ScannerResultsPanel';

type Props = {
  apiBase?: string;
  onTickerSelect?: (ticker: string) => void;
};

export function Dashboard({ apiBase = 'http://localhost:3000', onTickerSelect }: Props) {
  const [activePanel, setActivePanel] = useState('health');

  const renderPanel = () => {
    switch (activePanel) {
      case 'health':
        return <DataHealthPanel apiBase={apiBase} />;
      case 'strategies':
        return <ActiveStrategiesPanel apiBase={apiBase} />;
      case 'handoffs':
        return <HandoffRequestsPanel apiBase={apiBase} />;
      case 'scanner':
        return <ScannerResultsPanel socketUrl={apiBase} onTickerSelect={onTickerSelect} />;
      default:
        return <DataHealthPanel apiBase={apiBase} />;
    }
  };

  return (
    <DashboardLayout activePanel={activePanel} onPanelChange={setActivePanel}>
      <div className="dashboard-content">
        <div className="breadcrumb">
          <span className="breadcrumb-home">Dashboard</span>
          <span className="breadcrumb-sep">/</span>
          <span className="breadcrumb-current">
            {activePanel === 'health' && 'Data Health'}
            {activePanel === 'strategies' && 'Active Strategies'}
            {activePanel === 'handoffs' && 'Handoff Requests'}
            {activePanel === 'scanner' && 'Scanner Results'}
          </span>
        </div>

        {renderPanel()}
      </div>

      <style>{`
        .dashboard-content {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
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
  );
}

// Export all dashboard components for individual use
export { DashboardLayout } from './DashboardLayout';
export { DataHealthPanel } from './DataHealthPanel';
export { ActiveStrategiesPanel } from './ActiveStrategiesPanel';
export { HandoffRequestsPanel } from './HandoffRequestsPanel';
export { ScannerResultsPanel } from './ScannerResultsPanel';
