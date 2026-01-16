import { useState, useEffect } from 'react';

type Props = {
  children: React.ReactNode;
  activePanel?: string;
  onPanelChange?: (panel: string) => void;
};

const PANELS = [
  { id: 'health', label: 'Data Health', icon: '📊' },
  { id: 'strategies', label: 'Strategies', icon: '🎯' },
  { id: 'handoffs', label: 'Handoffs', icon: '🔄' },
  { id: 'scanner', label: 'Scanner', icon: '🔍' },
];

export function DashboardLayout({ children, activePanel = 'health', onPanelChange }: Props) {
  return (
    <div className="dashboard-layout">
      <aside className="dashboard-sidebar">
        <div className="dashboard-logo">
          <span className="logo-icon">⚡</span>
          <span className="logo-text">Control Center</span>
        </div>

        <nav className="dashboard-nav">
          {PANELS.map(panel => (
            <button
              key={panel.id}
              type="button"
              className={`nav-item ${activePanel === panel.id ? 'active' : ''}`}
              onClick={() => onPanelChange?.(panel.id)}
            >
              <span className="nav-icon">{panel.icon}</span>
              <span className="nav-label">{panel.label}</span>
            </button>
          ))}
        </nav>

        <div className="dashboard-footer">
          <div className="status-indicator live">
            <span className="status-dot"></span>
            <span className="status-text">System Online</span>
          </div>
        </div>
      </aside>

      <main className="dashboard-main">
        {children}
      </main>

      <style>{`
        .dashboard-layout {
          display: flex;
          min-height: 100vh;
          background: #0a0a0f;
          color: #e5e5e5;
        }

        .dashboard-sidebar {
          width: 240px;
          background: linear-gradient(180deg, #111118 0%, #0d0d12 100%);
          border-right: 1px solid rgba(255, 255, 255, 0.06);
          display: flex;
          flex-direction: column;
          padding: 1.5rem 0;
        }

        .dashboard-logo {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0 1.5rem 1.5rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          margin-bottom: 1rem;
        }

        .logo-icon {
          font-size: 1.5rem;
        }

        .logo-text {
          font-size: 1.1rem;
          font-weight: 600;
          letter-spacing: -0.02em;
        }

        .dashboard-nav {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          padding: 0 0.75rem;
        }

        .nav-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.75rem 1rem;
          border-radius: 0.5rem;
          background: transparent;
          border: none;
          color: #9ca3af;
          cursor: pointer;
          transition: all 0.15s ease;
          font-size: 0.9rem;
          text-align: left;
          width: 100%;
        }

        .nav-item:hover {
          background: rgba(255, 255, 255, 0.04);
          color: #e5e5e5;
        }

        .nav-item.active {
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(16, 185, 129, 0.05) 100%);
          color: #10b981;
          border: 1px solid rgba(16, 185, 129, 0.2);
        }

        .nav-icon {
          font-size: 1.1rem;
        }

        .nav-label {
          font-weight: 500;
        }

        .dashboard-footer {
          padding: 1rem 1.5rem;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
        }

        .status-indicator {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.8rem;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          animation: pulse 2s ease-in-out infinite;
        }

        .status-indicator.live .status-dot {
          background: #10b981;
          box-shadow: 0 0 8px rgba(16, 185, 129, 0.5);
        }

        .status-indicator.live .status-text {
          color: #10b981;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .dashboard-main {
          flex: 1;
          padding: 1.5rem;
          overflow-y: auto;
        }
      `}</style>
    </div>
  );
}
