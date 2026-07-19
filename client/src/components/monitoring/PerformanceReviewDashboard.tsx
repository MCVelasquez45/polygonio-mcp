import { useState } from 'react';
import { createChart, ColorType, LineStyle } from 'lightweight-charts';
import { DemoDataBadge } from '../shared/DemoDataBadge';

export function PerformanceReviewDashboard() {
  const [selectedPeriod, setSelectedPeriod] = useState('YTD');

  const strategies = [
    { id: '1', name: 'VolArbitrage_v2', sharpe: 1.42, return: 48.2, drawdown: -15.8 },
    { id: '2', name: 'Momentum_v3', sharpe: 1.21, return: 32.5, drawdown: -12.4 },
    { id: '3', name: 'GammaScalp_v1', sharpe: 0.92, return: 18.2, drawdown: -8.5 },
  ];

  return (
    <div className="performance-dashboard">
      <div className="dashboard-header">
        <h2>
          📊 PERFORMANCE REVIEW <DemoDataBadge note="Sharpe, returns, and strategy contributions shown here are illustrative — not live portfolio results." />
        </h2>
        <div className="period-selector">
          {['1M', '3M', '6M', 'YTD', '1Y', 'ALL'].map(period => (
            <button
              key={period}
              className={`period-btn ${selectedPeriod === period ? 'active' : ''}`}
              onClick={() => setSelectedPeriod(period)}
            >
              {period}
            </button>
          ))}
        </div>
      </div>

      <div className="metrics-overview">
        <div className="metric-card">
          <label>Portfolio Sharpe</label>
          <span className="value">1.85</span>
          <span className="sub-text">Top 5% percentile</span>
        </div>
        <div className="metric-card">
          <label>Sortino Ratio</label>
          <span className="value">2.10</span>
          <span className="sub-text">Excellent downside protection</span>
        </div>
        <div className="metric-card">
          <label>Beta to SPY</label>
          <span className="value">0.12</span>
          <span className="sub-text">Low correlation</span>
        </div>
        <div className="metric-card">
          <label>Win Rate</label>
          <span className="value">64%</span>
          <span className="sub-text">Avg Risk/Reward: 1:2.5</span>
        </div>
      </div>

      <div className="charts-container">
        <div className="main-chart-placeholder">
          {/* Placeholder for Lightweight Chart */}
          <div className="placeholder-content">
            <span>Cumulative Returns vs Benchmark (SPY)</span>
            <div className="mock-chart-line"></div>
          </div>
        </div>
      </div>

      <div className="strategy-breakdown">
        <h3>Strategy Contribution</h3>
        <table className="breakdown-table">
          <thead>
            <tr>
              <th>Strategy</th>
              <th>Sharpe</th>
              <th>Total Return</th>
              <th>Max Drawdown</th>
              <th>Correlation Matrix</th>
            </tr>
          </thead>
          <tbody>
            {strategies.map(s => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.sharpe}</td>
                <td className="text-success">+{s.return}%</td>
                <td className="text-error">{s.drawdown}%</td>
                <td>
                  <div className="correlation-heatmap">
                    {/* Mock mini heatmap */}
                    <span className="heat-box low">0.1</span>
                    <span className="heat-box med">0.4</span>
                    <span className="heat-box high">0.8</span>
                    <span className="heat-box high">0.8</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ai-insights">
        <h3>🧠 Agent Insights & Patterns</h3>
        <div className="insight-cards">
          <div className="insight-card">
            <span className="icon">💡</span>
            <div className="content">
              <h4>Volatility Regime Detected</h4>
              <p>Performance degrades when VIX &gt; 35. Consider reducing leverage in high-vol regimes.</p>
            </div>
            <button className="action-btn">Optimize</button>
          </div>
          <div className="insight-card">
            <span className="icon">📈</span>
            <div className="content">
              <h4>Seasonality Pattern</h4>
              <p>Momentum strategies show 15% outperformance in Q4 compared to other quarters.</p>
            </div>
          </div>
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .performance-dashboard {
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
  }

  .dashboard-header h2 { margin: 0; font-size: 1.5rem; letter-spacing: 0.05em; }

  .period-selector {
    display: flex;
    background: #15151a;
    border-radius: 6px;
    padding: 2px;
    border: 1px solid #333;
  }

  .period-btn {
    background: transparent;
    border: none;
    color: #9ca3af;
    padding: 0.5rem 1rem;
    cursor: pointer;
    border-radius: 4px;
    font-size: 0.85rem;
    font-weight: 600;
  }

  .period-btn.active {
    background: #333;
    color: #fff;
  }

  .metrics-overview {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1.5rem;
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

  .metric-card label {
    font-size: 0.75rem;
    color: #9ca3af;
    text-transform: uppercase;
    font-weight: 600;
    margin-bottom: 0.5rem;
  }

  .metric-card .value {
    font-size: 2rem;
    font-weight: 700;
    color: #10b981;
  }

  .metric-card .sub-text {
    font-size: 0.8rem;
    color: #6b7280;
    margin-top: 0.25rem;
  }

  .charts-container {
    height: 300px;
    background: #15151a;
    border: 1px solid #333;
    border-radius: 6px;
    margin-bottom: 2rem;
    padding: 1rem;
    display: flex;
    justify-content: center;
    align-items: center;
  }
  
  .placeholder-content { text-align: center; color: #6b7280; }
  .mock-chart-line { 
    width: 200px; height: 100px; 
    background: linear-gradient(45deg, transparent 40%, rgba(16, 185, 129, 0.2) 100%);
    border-bottom: 2px solid #10b981;
    margin: 1rem auto;
  }

  .strategy-breakdown {
    margin-bottom: 2rem;
  }

  .breakdown-table {
    width: 100%;
    border-collapse: collapse;
    background: #15151a;
    border-radius: 6px;
    overflow: hidden;
  }

  .breakdown-table th, .breakdown-table td {
    padding: 1rem;
    text-align: left;
    border-bottom: 1px solid #2a2a30;
  }

  .text-success { color: #10b981; }
  .text-error { color: #ef4444; }

  .correlation-heatmap { display: flex; gap: 4px; }
  .heat-box { width: 20px; height: 20px; border-radius: 2px; color: transparent; font-size: 0; }
  .heat-box.low { background: #064e3b; }
  .heat-box.med { background: #059669; }
  .heat-box.high { background: #34d399; }

  .ai-insights h3 { margin-bottom: 1rem; color: #9ca3af; font-size: 1rem; }
  
  .insight-cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
  }

  .insight-card {
    background: #1a1a2e;
    border: 1px solid #2a2a40;
    padding: 1.25rem;
    border-radius: 6px;
    display: flex;
    gap: 1rem;
    align-items: flex-start;
  }
  
  .insight-card .icon { font-size: 1.5rem; }
  .insight-card h4 { margin: 0 0 0.5rem 0; color: #e5e5e5; }
  .insight-card p { margin: 0; font-size: 0.9rem; color: #9ca3af; line-height: 1.5; }
  
  .action-btn {
    margin-left: auto;
    background: rgba(16, 185, 129, 0.1);
    color: #10b981;
    border: 1px solid rgba(16, 185, 129, 0.2);
    padding: 0.25rem 0.75rem;
    border-radius: 4px;
    font-size: 0.8rem;
    cursor: pointer;
  }
`;
