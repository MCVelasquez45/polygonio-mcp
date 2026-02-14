import { useState, useEffect } from 'react';

type Position = {
  symbol: string;
  side: 'LONG' | 'SHORT';
  qty: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  timeOpen: string;
};

type Metric = {
  label: string;
  value: string;
  subValue?: string;
  trend: 'positive' | 'negative' | 'neutral';
};

type ComparisonRow = {
  metric: string;
  paper: string;
  backtest: string;
  deviation: string;
  status: 'pass' | 'fail' | 'warning';
};

export function PaperTradingDashboard() {
  // Mock Real-time Data
  const [metrics, setMetrics] = useState<Metric[]>([
    { label: 'TODAY P&L', value: '+$1,842', subValue: '+1.84%', trend: 'positive' },
    { label: 'WEEK P&L', value: '+$4,523', subValue: '+4.52%', trend: 'positive' },
    { label: 'TOTAL P&L', value: '+$12,450', subValue: '+12.45%', trend: 'positive' },
    { label: 'READINESS', value: '82/100', subValue: 'PROMOTION READY', trend: 'positive' },
  ]);

  const [positions, setPositions] = useState<Position[]>([
    { symbol: 'VXX', side: 'SHORT', qty: 150, entryPrice: 25.42, currentPrice: 25.18, pnl: 36, timeOpen: '2h 15m' },
    { symbol: 'SPY', side: 'LONG', qty: 10, entryPrice: 452.10, currentPrice: 453.20, pnl: 11, timeOpen: '2h 15m' },
  ]);

  const [comparisons, setComparisons] = useState<ComparisonRow[]>([
    { metric: 'Sharpe Ratio', paper: '1.38', backtest: '1.42', deviation: '-2.8%', status: 'pass' },
    { metric: 'Win Rate', paper: '62%', backtest: '58%', deviation: '+6.9%', status: 'pass' },
    { metric: 'Avg Slippage', paper: '1.2 bps', backtest: '1.0 bps', deviation: '+20%', status: 'warning' },
  ]);

  return (
    <div className="paper-dashboard">
      <div className="dashboard-header">
        <div className="header-left">
          <h2>📝 PAPER TRADING: VolArbitrage_v2</h2>
          <span className="status-badge">Day 12 of 15 ●</span>
        </div>
        <div className="header-right">
          <button className="btn-danger">Pause Trading</button>
          <button className="btn-primary">Request Promotion →</button>
        </div>
      </div>

      {/* Live Metrics Grid */}
      <div className="metrics-grid">
        {metrics.map((m, i) => (
          <div key={i} className="metric-card">
            <span className="metric-label">{m.label}</span>
            <span className={`metric-value ${m.trend}`}>{m.value}</span>
            <span className="metric-sub">{m.subValue}</span>
          </div>
        ))}
      </div>

      {/* Current Positions */}
      <div className="section">
        <h3>CURRENT POSITIONS</h3>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Side</th>
                <th>Qty</th>
                <th>Entry</th>
                <th>Current</th>
                <th>P&L</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p, i) => (
                <tr key={i}>
                  <td className="font-mono">{p.symbol}</td>
                  <td><span className={`badge ${p.side.toLowerCase()}`}>{p.side}</span></td>
                  <td>{p.qty}</td>
                  <td>${p.entryPrice.toFixed(2)}</td>
                  <td>${p.currentPrice.toFixed(2)}</td>
                  <td className={p.pnl >= 0 ? 'positive' : 'negative'}>
                    {p.pnl >= 0 ? '+' : '-'}${Math.abs(p.pnl)}
                  </td>
                  <td>{p.timeOpen}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Backtest Comparison */}
      <div className="section">
        <h3>VS BACKTEST COMPARISON</h3>
        <div className="comparison-table">
          <div className="comp-header">
            <span>Metric</span>
            <span>Paper Trading</span>
            <span>Backtest</span>
            <span>Deviation</span>
          </div>
          {comparisons.map((row, i) => (
            <div key={i} className="comp-row">
              <span>{row.metric}</span>
              <span className="font-mono">{row.paper}</span>
              <span className="font-mono text-gray">{row.backtest}</span>
              <span className={`status ${row.status}`}>
                {row.deviation} {row.status === 'pass' ? '✓' : '⚠'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Agent Monitor */}
      <div className="agent-monitor">
        <div className="monitor-header">
          <span className="icon">🤖</span>
          <h3>AGENT MONITOR</h3>
        </div>
        <div className="monitor-feed">
          <div className="feed-item">
            <span className="time">● Live</span>
            <p>Market conditions favorable: contango at 6.5%</p>
          </div>
          <div className="feed-item">
            <span className="time">10:30</span>
            <p>Execution quality excellent: 0.8 bps slippage</p>
          </div>
          <div className="feed-item warning">
            <span className="time">09:15</span>
            <p>VIX approaching threshold - monitoring closely</p>
          </div>
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .paper-dashboard {
    padding: 1.5rem;
    color: #e5e5e5;
    background: #0a0a0f;
    height: 100%;
    overflow-y: auto;
  }

  .dashboard-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
    border-bottom: 1px solid #333;
    padding-bottom: 1rem;
  }

  .header-left h2 {
    margin: 0;
    font-size: 1.25rem;
    color: #e5e5e5;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .status-badge {
    font-size: 0.85rem;
    color: #10b981;
    background: rgba(16, 185, 129, 0.1);
    padding: 0.25rem 0.75rem;
    border-radius: 1rem;
    margin-top: 0.5rem;
    display: inline-block;
  }

  .header-right {
    display: flex;
    gap: 1rem;
  }

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .metric-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    padding: 1.25rem;
    border-radius: 0.75rem;
    display: flex;
    flex-direction: column;
  }

  .metric-label { font-size: 0.75rem; color: #9ca3af; letter-spacing: 0.05em; }
  .metric-value { font-size: 1.75rem; font-weight: 600; margin: 0.5rem 0; }
  .metric-sub { font-size: 0.85rem; color: #6b7280; }
  
  .metric-value.positive { color: #10b981; }
  .metric-value.negative { color: #ef4444; }

  .section { margin-bottom: 2rem; }
  .section h3 { font-size: 0.9rem; color: #9ca3af; margin-bottom: 1rem; letter-spacing: 0.05em; }

  .table-container {
    background: #15151a;
    border-radius: 0.75rem;
    overflow: hidden;
    border: 1px solid #333;
  }

  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 1rem; text-align: left; border-bottom: 1px solid #2a2a2a; }
  th { font-weight: 500; color: #9ca3af; font-size: 0.85rem; }
  td { font-size: 0.9rem; }
  
  .badge { padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
  .badge.long { background: rgba(16, 185, 129, 0.2); color: #10b981; }
  .badge.short { background: rgba(239, 68, 68, 0.2); color: #ef4444; }

  .comparison-table {
    display: flex;
    flex-direction: column;
    background: #15151a;
    border-radius: 0.75rem;
    border: 1px solid #333;
  }

  .comp-header, .comp-row {
    display: grid;
    grid-template-columns: 1.5fr 1fr 1fr 1fr;
    padding: 1rem;
    align-items: center;
  }

  .comp-header { border-bottom: 1px solid #333; color: #9ca3af; font-size: 0.85rem; font-weight: 500; }
  .comp-row { border-bottom: 1px solid #2a2a2a; font-size: 0.9rem; }
  .comp-row:last-child { border-bottom: none; }
  
  .status.pass { color: #10b981; }
  .status.warning { color: #f59e0b; }
  .status.fail { color: #ef4444; }

  .agent-monitor {
    background: rgba(16, 185, 129, 0.05);
    border: 1px solid rgba(16, 185, 129, 0.1);
    border-radius: 0.75rem;
    padding: 1.5rem;
  }

  .monitor-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; color: #10b981; }
  .monitor-header h3 { margin: 0; font-size: 1rem; }

  .feed-item { display: flex; gap: 1rem; margin-bottom: 0.75rem; font-size: 0.9rem; }
  .feed-item .time { color: #6b7280; font-family: monospace; min-width: 60px; }
  .feed-item.warning .time { color: #f59e0b; }

  .btn-primary, .btn-danger {
    padding: 0.5rem 1rem;
    border-radius: 0.5rem;
    font-weight: 500;
    cursor: pointer;
    font-size: 0.9rem;
    border: none;
  }

  .btn-primary { background: #10b981; color: white; }
  .btn-primary:hover { background: #059669; }
  
  .btn-danger { background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); }
  .btn-danger:hover { background: rgba(239, 68, 68, 0.2); }
  
  .font-mono { font-family: 'JetBrains Mono', monospace; }
  .text-gray { color: #6b7280; }
`;

export default PaperTradingDashboard;
