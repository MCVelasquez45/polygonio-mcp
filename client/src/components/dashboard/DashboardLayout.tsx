import { useState, useEffect } from 'react';

type Props = {
  children: React.ReactNode;
  activePanel?: string;
  onPanelChange?: (panel: string) => void;
};

const PANELS = [
  { id: 'research', label: 'Market Research', icon: '🔬', phase: 'ideation' },
  { id: 'lab-strategies', label: 'Strategy Pipeline', icon: '📋', phase: 'development' },
  { id: 'lab-editor', label: 'Strategy Editor', icon: '💻', phase: 'development' },
  { id: 'lab-compiler', label: 'Strategy Compiler', icon: '⚙️', phase: 'development' },
  { id: 'lab-paper', label: 'Paper Trading', icon: '📝', phase: 'paper' },
  { id: 'lab-promotion', label: 'Promotion Gate', icon: '🚀', phase: 'promotion' },
  // Phase 6: Live (Engine Room)
  { id: 'live', label: 'Engine Room', icon: '🔥', phase: 'live' },
  // Phase 7: Monitoring
  { id: 'monitoring-perf', label: 'Performance Review', icon: '📊', phase: 'monitoring' },
  { id: 'monitoring-ab', label: 'A/B Testing', icon: '⚖️', phase: 'monitoring' },
  { id: 'scanner', label: 'Scanner', icon: '🔍', phase: 'tools' },
  // Agent & Monitoring
  { id: 'chat', label: 'Agent Chat', icon: '🤖', phase: 'agent' },
  { id: 'health', label: 'System Health', icon: '💚', phase: 'monitoring' },
];

export function DashboardLayout({ children, activePanel = 'lab-strategies', onPanelChange }: Props) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Group panels by phase
  const groupedPanels = PANELS.reduce((acc, panel) => {
    const phase = panel.phase;
    if (!acc[phase]) acc[phase] = [];
    acc[phase].push(panel);
    return acc;
  }, {} as Record<string, typeof PANELS>);

  const renderNavGroup = (title: string, phase: string) => (
    <div className="nav-group">
      <div className="nav-group-title">{title}</div>
      {groupedPanels[phase]?.map(panel => (
        <button
          key={panel.id}
          type="button"
          className={`nav-item ${activePanel === panel.id ? 'active' : ''}`}
          onClick={() => onPanelChange?.(panel.id)}
          title={isCollapsed ? panel.label : undefined}
        >
          <span className="nav-icon">{panel.icon}</span>
          {!isCollapsed && <span className="nav-label">{panel.label}</span>}
        </button>
      ))}
    </div>
  );

  return (
    <div className="dashboard-layout">
      <aside className={`dashboard-sidebar ${isCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          {!isCollapsed && (
            <div className="dashboard-logo">
              <span className="logo-text">Control Center</span>
            </div>
          )}
          <button
            className="collapse-toggle"
            onClick={() => setIsCollapsed(!isCollapsed)}
            title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          >
            {isCollapsed ? '»' : '«'}
          </button>
        </div>

        <nav className="dashboard-nav">
          {renderNavGroup('THE LAB', 'ideation')}
          {renderNavGroup('DEVELOPMENT', 'development')}
          {renderNavGroup('VALIDATION', 'paper')}
          {renderNavGroup('PROMOTION', 'promotion')}
          {renderNavGroup('ENGINE ROOM', 'live')}
          {renderNavGroup('TOOLS', 'tools')}
          {groupedPanels['monitoring'] && (
            <>
              {!isCollapsed && <div className="nav-divider" />}
              {groupedPanels['monitoring'].map(panel => (
                <button
                  key={panel.id}
                  className={`nav-item ${activePanel === panel.id ? 'active' : ''}`}
                  onClick={() => onPanelChange?.(panel.id)}
                  title={isCollapsed ? panel.label : undefined}
                >
                  <span className="nav-icon">{panel.icon}</span>
                  {!isCollapsed && <span className="nav-label">{panel.label}</span>}
                </button>
              ))}
            </>
          )}
        </nav>

        <div className="dashboard-footer">
          <div className="status-indicator live">
            <span className="status-dot"></span>
            {!isCollapsed && <span className="status-text">System Online</span>}
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
          background: #0a0a0f; // Matches global bg
          color: #e5e5e5;
        }

        .dashboard-sidebar {
          width: 240px;
          background: #0f0f13; // Slightly lighter/distinct from main sidebar
          border-right: 1px solid #1f1f26;
          display: flex;
          flex-direction: column;
          padding: 1rem 0;
          transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          overflow: hidden;
        }

        .dashboard-sidebar.collapsed {
          width: 64px;
        }

        .sidebar-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 1rem 1rem;
          min-height: 48px;
        }

        .dashboard-logo {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          white-space: nowrap;
          overflow: hidden;
        }

        .logo-text {
          font-size: 0.85rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: #6b7280;
        }

        .collapse-toggle {
          background: transparent;
          border: none;
          color: #6b7280;
          cursor: pointer;
          font-size: 1.2rem;
          padding: 0.25rem;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          transition: color 0.2s;
          margin-left: auto;
        }

        .collapse-toggle:hover {
          color: #e5e5e5;
          background: rgba(255,255,255,0.05);
        }

        .dashboard-nav {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          padding: 0 0.5rem;
          overflow-y: auto;
          overflow-x: hidden;
        }

        /* Hide Scrollbar for cleaner look */
        .dashboard-nav::-webkit-scrollbar {
          width: 4px;
        }
        .dashboard-nav::-webkit-scrollbar-thumb {
          background-color: #333;
          border-radius: 4px;
        }
        .dashboard-nav::-webkit-scrollbar-track {
          background-color: transparent;
        }

        .nav-group {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          margin-bottom: 0.5rem;
        }

        .nav-group-title {
          font-size: 0.7rem; // Tiny header
          font-weight: 700;
          color: #4b5563;
          padding: 0.5rem 0.75rem 0.25rem;
          letter-spacing: 0.05em;
          white-space: nowrap;
          opacity: 1;
          transition: opacity 0.2s;
        }

        .dashboard-sidebar.collapsed .nav-group-title {
          display: none; // Hide headers when collapsed
        }
        
        // Add a divider when collapsed to separate groups implicitly if needed
        .dashboard-sidebar.collapsed .nav-group {
            margin-bottom: 0.75rem;
            border-bottom: 1px solid #1f1f26;
            padding-bottom: 0.75rem;
        }
        .dashboard-sidebar.collapsed .nav-group:last-child {
            border-bottom: none;
        }

        .nav-divider {
          height: 1px;
          background: #1f1f26;
          margin: 0.5rem 0;
        }

        .nav-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.5rem 0.75rem;
          border-radius: 6px;
          background: transparent;
          border: none;
          color: #9ca3af;
          cursor: pointer;
          transition: all 0.2s ease;
          font-size: 0.85rem;
          text-align: left;
          width: 100%;
          white-space: nowrap;
          height: 36px; // Fixed height for consistency
        }
        
        .dashboard-sidebar.collapsed .nav-item {
            justify-content: center;
            padding: 0.5rem 0;
        }

        .nav-item:hover {
          background: rgba(255, 255, 255, 0.04);
          color: #e5e5e5;
        }

        .nav-item.active {
          background: rgba(16, 185, 129, 0.1);
          color: #10b981;
          border: 1px solid rgba(16, 185, 129, 0.1);
        }
        
        .dashboard-sidebar.collapsed .nav-item.active {
             background: rgba(16, 185, 129, 0.1);
             border: none; // Cleaner icon-only active state
        }

        .nav-icon {
          font-size: 1rem;
          width: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .nav-label {
          font-weight: 500;
          opacity: 1;
          transition: opacity 0.2s;
        }

        .dashboard-footer {
          padding: 1rem;
          border-top: 1px solid #1f1f26;
          margin-top: auto;
        }

        .status-indicator {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.8rem;
          justify-content: center; // Center icon when collapsed
        }
        
         .dashboard-sidebar:not(.collapsed) .status-indicator {
            justify-content: flex-start;
         }

        .status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #10b981;
          box-shadow: 0 0 8px rgba(16, 185, 129, 0.4);
        }
        
        .status-indicator.live .status-text {
             color: #10b981;
             white-space: nowrap;
        }

        .dashboard-main {
          flex: 1;
          padding: 0;
          overflow: hidden;
          background: #0a0a0f;
          /* Add subtle shadow/separation from sidebar */
           box-shadow: -20px 0 40px -10px rgba(0,0,0,0.5);
           z-index: 10;
        }
      `}</style>
    </div >
  );
}
