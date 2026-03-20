import { useState } from 'react';

type Props = {
  children: React.ReactNode;
  activePanel?: string;
  onPanelChange?: (panel: string) => void;
};

const PANELS = [
  { id: 'research', label: 'Market Research', icon: '🔬', phase: 'ideation' },
  { id: 'lab-strategies', label: 'Strategy Pipeline', icon: '📋', phase: 'development' },
  { id: 'lab-editor', label: 'Strategy Editor', icon: '💻', phase: 'development' },
  { id: 'lab-paper', label: 'Paper Trading', icon: '📝', phase: 'paper' },
  { id: 'lab-promotion', label: 'Promotion Gate', icon: '🚀', phase: 'promotion' },
  { id: 'live', label: 'Engine Room', icon: '🔥', phase: 'live' },
  { id: 'monitoring-perf', label: 'Performance Review', icon: '📊', phase: 'monitoring' },
  { id: 'monitoring-ab', label: 'A/B Testing', icon: '⚖️', phase: 'monitoring' },
  { id: 'scanner', label: 'Scanner', icon: '🔍', phase: 'tools' },
  { id: 'chat', label: 'Agent Chat', icon: '🤖', phase: 'agent' },
  { id: 'health', label: 'System Health', icon: '💚', phase: 'monitoring' },
];

const PHASE_LABELS: Record<string, string> = {
  ideation: 'RESEARCH',
  development: 'DEVELOPMENT',
  paper: 'VALIDATION',
  promotion: 'LAUNCH',
  live: 'ENGINE',
  tools: 'TOOLS',
  monitoring: 'MONITORING',
  agent: 'AI AGENT',
};

export function DashboardLayout({ children, activePanel = 'lab-strategies', onPanelChange }: Props) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const groupedPanels = PANELS.reduce((acc, panel) => {
    const phase = panel.phase;
    if (!acc[phase]) acc[phase] = [];
    acc[phase].push(panel);
    return acc;
  }, {} as Record<string, typeof PANELS>);

  const phaseOrder = ['ideation', 'development', 'paper', 'promotion', 'live', 'tools', 'monitoring', 'agent'];

  return (
    <div className="dl-root">
      <aside className={`dl-sidebar ${isCollapsed ? 'collapsed' : ''}`}>
        <div className="dl-sidebar-header">
          {!isCollapsed && (
            <div className="dl-logo">
              <div className="dl-logo-mark">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
                  <line x1="12" y1="22" x2="12" y2="15.5" />
                  <polyline points="22 8.5 12 15.5 2 8.5" />
                </svg>
              </div>
              <span className="dl-logo-text">Lab</span>
            </div>
          )}
          <button
            className="dl-collapse-btn"
            onClick={() => setIsCollapsed(!isCollapsed)}
            title={isCollapsed ? 'Expand' : 'Collapse'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {isCollapsed
                ? <><polyline points="9 18 15 12 9 6" /></>
                : <><polyline points="15 18 9 12 15 6" /></>
              }
            </svg>
          </button>
        </div>

        <nav className="dl-nav">
          {phaseOrder.map(phase => {
            const panels = groupedPanels[phase];
            if (!panels) return null;
            return (
              <div key={phase} className="dl-nav-group">
                {!isCollapsed && (
                  <div className="dl-nav-group-label">{PHASE_LABELS[phase] ?? phase}</div>
                )}
                {panels.map(panel => (
                  <button
                    key={panel.id}
                    type="button"
                    className={`dl-nav-item ${activePanel === panel.id ? 'active' : ''}`}
                    onClick={() => onPanelChange?.(panel.id)}
                    title={isCollapsed ? panel.label : undefined}
                  >
                    <span className="dl-nav-icon">{panel.icon}</span>
                    {!isCollapsed && <span className="dl-nav-label">{panel.label}</span>}
                    {!isCollapsed && activePanel === panel.id && <span className="dl-nav-active-dot" />}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="dl-sidebar-footer">
          <div className="dl-status">
            <span className="dl-status-dot" />
            {!isCollapsed && <span className="dl-status-text">System Online</span>}
          </div>
        </div>
      </aside>

      <main className="dl-main">
        {children}
      </main>

      <style>{`
        .dl-root {
          display: flex;
          min-height: 100vh;
          background: var(--bg-base, #060810);
          color: var(--text-primary, #f0f2f5);
        }

        .dl-sidebar {
          width: 232px;
          background: var(--bg-surface, #0c0e18);
          border-right: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
          display: flex;
          flex-direction: column;
          transition: width var(--transition-smooth, 300ms cubic-bezier(0.4,0,0.2,1));
          overflow: hidden;
          flex-shrink: 0;
        }

        .dl-sidebar.collapsed {
          width: 60px;
        }

        .dl-sidebar-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 1.25rem 0.75rem 1rem;
          min-height: 56px;
        }

        .dl-logo {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          white-space: nowrap;
          overflow: hidden;
        }

        .dl-logo-mark {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          background: linear-gradient(135deg, rgba(16,185,129,0.15), rgba(16,185,129,0.05));
          border: 1px solid rgba(16,185,129,0.2);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #10b981;
          flex-shrink: 0;
        }

        .dl-logo-text {
          font-size: 1rem;
          font-weight: 700;
          letter-spacing: 0.02em;
          color: var(--text-primary, #f0f2f5);
        }

        .dl-collapse-btn {
          background: transparent;
          border: none;
          color: var(--text-tertiary, #555d73);
          cursor: pointer;
          padding: 0.375rem;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 6px;
          transition: all var(--transition-fast, 150ms);
          margin-left: auto;
          flex-shrink: 0;
        }

        .dl-collapse-btn:hover {
          color: var(--text-primary, #f0f2f5);
          background: rgba(255,255,255,0.05);
        }

        .dl-nav {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
          padding: 0 0.5rem;
          overflow-y: auto;
          overflow-x: hidden;
          scrollbar-width: thin;
          scrollbar-color: rgba(255,255,255,0.06) transparent;
        }

        .dl-nav::-webkit-scrollbar { width: 3px; }
        .dl-nav::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 3px; }
        .dl-nav::-webkit-scrollbar-track { background: transparent; }

        .dl-nav-group {
          margin-bottom: 0.375rem;
        }

        .dl-nav-group-label {
          font-size: 0.625rem;
          font-weight: 600;
          color: var(--text-tertiary, #555d73);
          padding: 0.75rem 0.625rem 0.375rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .dl-nav-item {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.5rem 0.625rem;
          border-radius: var(--radius-sm, 6px);
          background: transparent;
          border: 1px solid transparent;
          color: var(--text-secondary, #8b92a5);
          cursor: pointer;
          transition: all var(--transition-fast, 150ms);
          font-size: 0.8125rem;
          text-align: left;
          width: 100%;
          white-space: nowrap;
          height: 34px;
          position: relative;
        }

        .dl-sidebar.collapsed .dl-nav-item {
          justify-content: center;
          padding: 0.5rem 0;
        }

        .dl-nav-item:hover {
          background: rgba(255, 255, 255, 0.04);
          color: var(--text-primary, #f0f2f5);
        }

        .dl-nav-item.active {
          background: var(--accent-muted, rgba(16,185,129,0.12));
          color: var(--accent, #10b981);
          border-color: rgba(16, 185, 129, 0.15);
        }

        .dl-nav-icon {
          font-size: 0.875rem;
          width: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .dl-nav-label {
          font-weight: 500;
          flex: 1;
        }

        .dl-nav-active-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: var(--accent, #10b981);
          flex-shrink: 0;
          box-shadow: 0 0 6px rgba(16,185,129,0.5);
        }

        .dl-sidebar-footer {
          padding: 0.75rem;
          border-top: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
          margin-top: auto;
        }

        .dl-status {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.75rem;
          padding: 0.375rem 0.375rem;
          justify-content: center;
        }

        .dl-sidebar:not(.collapsed) .dl-status {
          justify-content: flex-start;
        }

        .dl-status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent, #10b981);
          box-shadow: 0 0 8px rgba(16, 185, 129, 0.5);
          animation: dl-pulse 3s ease-in-out infinite;
          flex-shrink: 0;
        }

        @keyframes dl-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .dl-status-text {
          color: var(--accent, #10b981);
          white-space: nowrap;
          font-weight: 500;
        }

        .dl-main {
          flex: 1;
          overflow: hidden;
          background: var(--bg-base, #060810);
        }
      `}</style>
    </div>
  );
}
