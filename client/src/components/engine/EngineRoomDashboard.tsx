import { useState, useEffect } from 'react';
import { ReconciliationView } from './ReconciliationView';

type StrategyStatus = {
  id: string;
  name: string;
  status: 'live' | 'paused' | 'error';
  allocation: number;
  pnl: number;
  sharpe: number;
  riskLevel: 'LOW' | 'MED' | 'HIGH';
};

type Alert = {
  id: string;
  time: string;
  source: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
};

export function EngineRoomDashboard() {
  const [showReconciliation, setShowReconciliation] = useState(false);
  const [strategies, setStrategies] = useState<StrategyStatus[]>([
    { id: '1', name: 'VolArbitrage_v2', status: 'live', allocation: 200000, pnl: 1842, sharpe: 1.38, riskLevel: 'LOW' },
    { id: '2', name: 'Momentum_v3', status: 'live', allocation: 150000, pnl: 856, sharpe: 1.24, riskLevel: 'MED' },
    { id: '3', name: 'GammaScalp_v1', status: 'paused', allocation: 100000, pnl: -234, sharpe: 0.92, riskLevel: 'HIGH' },
  ]);

  const [alerts, setAlerts] = useState<Alert[]>([
    { id: '1', time: '09:42', source: 'VolArbitrage_v2', message: 'Entry signal triggered [VXX short]', severity: 'info' },
    { id: '2', time: '09:38', source: 'Market data', message: 'VIX contango expanded to 7.2%', severity: 'info' },
    { id: '3', time: '09:15', source: 'GammaScalp_v1', message: 'Approaching daily loss limit (80%)', severity: 'warning' },
    { id: '4', time: '09:00', source: 'System', message: 'Market open, all strategies active', severity: 'info' },
  ]);

  return (
    <div className="engine-room">
      <div className="dashboard-header">
        <div className="header-left">
          <h2>🔥 ENGINE ROOM</h2>
          <div className="live-indicator">
            <span className="dot"></span>
            <span>LIVE</span>
          </div>
          <span className="time">09:45:32</span>
        </div>
        <div className="header-right">
          <button
            className="btn-secondary mr-4"
            onClick={() => setShowReconciliation(true)}
          >
            📋 EOD Recon
          </button>
          <button className="btn-emergency">EMERGENCY STOP</button>
        </div>
      </div>

      <ReconciliationView
        isOpen={showReconciliation}
        onClose={() => setShowReconciliation(false)}
      />

      {/* Portfolio Overview */}
      <div className="metrics-grid">
        <div className="metric-card">
          <label>TODAY P&L</label>
          <span className="value positive">+$12,450</span>
          <span className="sub-value">+0.42%</span>
        </div>
        <div className="metric-card">
          <label>MTD P&L</label>
          <span className="value positive">+$45,230</span>
          <span className="sub-value">+1.53%</span>
        </div>
        <div className="metric-card">
          <label>YTD P&L</label>
          <span className="value positive">+$234,500</span>
          <span className="sub-value">+7.92%</span>
        </div>
        <div className="metric-card risk-card">
          <label>RISK UTILIZATION</label>
          <span className="value">65%</span>
          <div className="progress-bar">
            <div className="fill" style={{ width: '65%' }}></div>
          </div>
        </div>
      </div>

      {/* Live Strategies */}
      <div className="section">
        <div className="section-header">
          <h3>LIVE STRATEGIES</h3>
          <button className="btn-secondary">+ Deploy Strategy</button>
        </div>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Strategy</th>
                <th>Status</th>
                <th>Allocation</th>
                <th>Today P&L</th>
                <th>Sharpe</th>
                <th>Risk</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {strategies.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium">{s.name}</td>
                  <td>
                    <span className={`status-badge ${s.status}`}>
                      {s.status.toUpperCase()}
                    </span>
                  </td>
                  <td>${s.allocation.toLocaleString()}</td>
                  <td className={s.pnl >= 0 ? 'positive' : 'negative'}>
                    {s.pnl >= 0 ? '+' : '-'}${Math.abs(s.pnl)}
                  </td>
                  <td>{s.sharpe}</td>
                  <td>
                    <span className={`risk-badge ${s.riskLevel.toLowerCase()}`}>
                      {s.riskLevel}
                    </span>
                  </td>
                  <td>
                    <button className="btn-icon">⚙️</button>
                    <button className="btn-icon">⏸</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom Section: Alerts & Agent */}
      <div className="bottom-grid">
        {/* Alert Center */}
        <div className="panel alerts">
          <h3>ALERT CENTER</h3>
          <div className="alert-list">
            {alerts.map((alert) => (
              <div key={alert.id} className={`alert-item ${alert.severity}`}>
                <span className="alert-time">{alert.time}</span>
                <span className="alert-source">{alert.source}:</span>
                <span className="alert-message">{alert.message}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Agent Monitor & Circuit Breakers */}
        <div className="panel combined-readiness">
          <div className="sub-panel">
            <div className="panel-head">
              <span className="icon">🤖</span>
              <h3>AGENT MONITOR</h3>
            </div>
            <p className="agent-text">
              "All strategies operating within expected parameters. VIX contango favorable for VolArb strategy."
            </p>
            <button className="btn-ask">Ask Agent...</button>
          </div>

          <div className="divider"></div>

          <div className="sub-panel">
            <h3>CIRCUIT BREAKERS</h3>
            <div className="cb-list">
              <div className="cb-item">
                <span>Portfolio Stop</span>
                <div className="cb-bar"><div className="fill" style={{ width: '65%' }}></div></div>
                <span>65%</span>
              </div>
              <div className="cb-item">
                <span>Strategy Limits</span>
                <div className="cb-bar"><div className="fill safe" style={{ width: '35%' }}></div></div>
                <span>35%</span>
              </div>
              <div className="cb-item">
                <span>Sector Exposure</span>
                <div className="cb-bar"><div className="fill safe" style={{ width: '45%' }}></div></div>
                <span>45%</span>
              </div>
            </div>
            <div className="system-status">All systems nominal ✓</div>
          </div>
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .engine-room {
    padding: 1.5rem;
    color: #e5e5e5;
    background: #0a0a0f;
    min-height: 100%;
  }

  .dashboard-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
    border-bottom: 2px solid #ef4444; /* Engine room red accent */
    padding-bottom: 1rem;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 1.5rem;
  }

  .header-left h2 { margin: 0; font-size: 1.5rem; letter-spacing: 0.05em; }

  .live-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
    padding: 0.25rem 0.75rem;
    border-radius: 1rem;
    font-size: 0.85rem;
    font-weight: 700;
    border: 1px solid rgba(239, 68, 68, 0.2);
  }

  .live-indicator .dot {
    width: 8px; height: 8px; background: #ef4444; border-radius: 50%;
    animation: flash 1s infinite alternate;
  }

  @keyframes flash { from { opacity: 1; } to { opacity: 0.3; } }

  .time { font-family: monospace; color: #9ca3af; font-size: 1.1rem; }

  .btn-emergency {
    background: #ef4444; color: white; border: none; padding: 0.5rem 1.5rem;
    font-weight: 700; border-radius: 4px; cursor: pointer;
    box-shadow: 0 0 15px rgba(239, 68, 68, 0.3);
  }
  .btn-emergency:hover { background: #dc2626; }

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .metric-card {
    background: #15151a;
    border: 1px solid #333;
    padding: 1.25rem;
    border-radius: 6px;
    display: flex;
    flex-direction: column;
  }

  .metric-card label { color: #9ca3af; font-size: 0.75rem; font-weight: 600; margin-bottom: 0.5rem; }
  .metric-card .value { font-size: 1.8rem; font-weight: 600; }
  .metric-card .value.positive { color: #10b981; }
  .metric-card .sub-value { font-size: 0.9rem; color: #10b981; margin-top: 0.25rem; }

  .risk-card .progress-bar {
    height: 6px; background: #333; border-radius: 3px; margin-top: 1rem; overflow: hidden;
  }
  .risk-card .fill { height: 100%; background: #f59e0b; }

  .section { margin-bottom: 2rem; }
  .section-header { display: flex; justify-content: space-between; margin-bottom: 1rem; }
  .section h3, .panel h3 { margin: 0; font-size: 0.9rem; color: #9ca3af; letter-spacing: 0.05em; }

  .btn-secondary {
    background: transparent; color: #10b981; border: 1px solid #10b981;
    padding: 0.4rem 1rem; border-radius: 4px; cursor: pointer; font-size: 0.85rem;
  }
  .btn-secondary:hover { background: rgba(16, 185, 129, 0.1); }

  .table-container { background: #15151a; border-radius: 6px; border: 1px solid #333; overflow: hidden; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 1rem; text-align: left; border-bottom: 1px solid #2a2a2a; }
  th { color: #9ca3af; font-size: 0.8rem; text-transform: uppercase; }
  .status-badge { padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 700; }
  .status-badge.live { background: rgba(16, 185, 129, 0.2); color: #10b981; }
  .status-badge.paused { background: rgba(245, 158, 11, 0.2); color: #f59e0b; }
  
  .risk-badge { font-size: 0.75rem; font-weight: 600; }
  .risk-badge.low { color: #10b981; }
  .risk-badge.med { color: #f59e0b; }
  .risk-badge.high { color: #ef4444; }

  .btn-icon { background: none; border: none; cursor: pointer; font-size: 1.1rem; opacity: 0.7; }
  .btn-icon:hover { opacity: 1; }

  .bottom-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }

  .panel { background: #15151a; border: 1px solid #333; border-radius: 6px; padding: 1.5rem; }
  
  .alerts .alert-list { margin-top: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
  .alert-item { font-size: 0.9rem; display: flex; gap: 0.75rem; }
  .alert-time { font-family: monospace; color: #6b7280; }
  .alert-source { color: #9ca3af; font-weight: 600; }
  .alert-item.warning { color: #f59e0b; }
  .alert-item.info { color: #e5e5e5; }

  .combined-readiness { display: flex; gap: 2rem; }
  .sub-panel { flex: 1; display: flex; flex-direction: column; }
  .divider { width: 1px; background: #333; }
  
  .panel-head { display: flex; gap: 0.5rem; align-items: center; color: #10b981; margin-bottom: 0.5rem; }
  .agent-text { font-style: italic; color: #d1d5db; line-height: 1.5; font-size: 0.95rem; }
  .btn-ask { 
    margin-top: auto; background: #2a2a30; border: 1px solid #444; color: #bbb;
    padding: 0.5rem; border-radius: 4px; text-align: left; cursor: pointer;
  }

  .cb-list { margin-top: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
  .cb-item { display: grid; grid-template-columns: 100px 1fr 40px; gap: 1rem; align-items: center; font-size: 0.85rem; }
  .cb-bar { height: 6px; background: #333; border-radius: 3px; overflow: hidden; }
  .cb-bar .fill { height: 100%; background: #f59e0b; }
  .cb-bar .fill.safe { background: #10b981; }
  
  .system-status { margin-top: 1rem; color: #10b981; font-weight: 600; font-size: 0.9rem; text-align: right; }
`;

export default EngineRoomDashboard;
