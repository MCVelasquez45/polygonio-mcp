import { useState } from 'react';
import { DemoDataBadge } from '../shared/DemoDataBadge';

type StrategyVersion = {
  id: string;
  version: string;
  created: string;
  sharpe: number;
  returns: number;
  changes: string[];
};

export function ABTestingPanel() {
  const [baseVersion, setBaseVersion] = useState('v2.1');
  const [testVersion, setTestVersion] = useState('v2.2-beta');

  const versions: StrategyVersion[] = [
    { id: '1', version: 'v2.0', created: '2025-01-01', sharpe: 1.35, returns: 42.1, changes: ['Initial release'] },
    { id: '2', version: 'v2.1', created: '2025-01-15', sharpe: 1.42, returns: 48.2, changes: ['Added regime filter'] },
    { id: '3', version: 'v2.2-beta', created: '2025-01-28', sharpe: 1.55, returns: 52.4, changes: ['Optimized stop-loss', 'New ML signal'] },
  ];

  const getMetricDiff = (v1: string, v2: string, metric: 'sharpe' | 'returns') => {
    const ver1 = versions.find(v => v.version === v1);
    const ver2 = versions.find(v => v.version === v2);
    if (!ver1 || !ver2) return 0;
    return ver2[metric] - ver1[metric];
  };

  const renderDiff = (val: number, isPercent = false) => {
    const isPositive = val > 0;
    return (
      <span className={`diff ${isPositive ? 'positive' : 'negative'}`}>
        {isPositive ? '+' : ''}{val.toFixed(2)}{isPercent ? '%' : ''}
      </span>
    );
  };

  return (
    <div className="ab-testing-panel">
      <div className="header">
        <h2>
          ⚖️ A/B TESTING & VERSION HISTORY <DemoDataBadge note="Version metrics and diffs shown here are illustrative — not real strategy history." />
        </h2>
        <div className="controls">
          <div className="control-group">
            <label>Baseline (A)</label>
            <select value={baseVersion} onChange={e => setBaseVersion(e.target.value)}>
              {versions.map(v => <option key={v.id} value={v.version}>{v.version}</option>)}
            </select>
          </div>
          <span className="vs">VS</span>
          <div className="control-group">
            <label>Challenger (B)</label>
            <select value={testVersion} onChange={e => setTestVersion(e.target.value)}>
              {versions.map(v => <option key={v.id} value={v.version}>{v.version}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="comparison-grid">
        <div className="card">
          <h3>Sharpe Ratio Comparison</h3>
          <div className="comp-row">
            <div className="ver-box">
              <span className="label">{baseVersion}</span>
              <span className="value">{versions.find(v => v.version === baseVersion)?.sharpe}</span>
            </div>
            <div className="arrow">→</div>
            <div className="ver-box">
              <span className="label">{testVersion}</span>
              <span className="value">{versions.find(v => v.version === testVersion)?.sharpe}</span>
            </div>
          </div>
          <div className="result">
            Improvement: {renderDiff(getMetricDiff(baseVersion, testVersion, 'sharpe'))}
          </div>
        </div>

        <div className="card">
          <h3>Total Returns Comparison</h3>
          <div className="comp-row">
            <div className="ver-box">
              <span className="label">{baseVersion}</span>
              <span className="value">{versions.find(v => v.version === baseVersion)?.returns}%</span>
            </div>
            <div className="arrow">→</div>
            <div className="ver-box">
              <span className="label">{testVersion}</span>
              <span className="value">{versions.find(v => v.version === testVersion)?.returns}%</span>
            </div>
          </div>
          <div className="result">
            Improvement: {renderDiff(getMetricDiff(baseVersion, testVersion, 'returns'), true)}
          </div>
        </div>
      </div>

      <div className="version-timeline">
        <h3>Strategy Evolution</h3>
        <div className="timeline-list">
          {versions.slice().reverse().map((v, i) => (
            <div key={v.id} className="timeline-item">
              <div className="timeline-marker"></div>
              <div className="timeline-content">
                <div className="timeline-header">
                  <span className="version-tag">{v.version}</span>
                  <span className="date">{v.created}</span>
                </div>
                <ul className="changes-list">
                  {v.changes.map((c, idx) => <li key={idx}>{c}</li>)}
                </ul>
                <div className="mini-metrics">
                  <span>Sharpe: {v.sharpe}</span>
                  <span>Ret: {v.returns}%</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .ab-testing-panel {
    padding: 2rem;
    background: #0a0a0f;
    color: #e5e5e5;
    min-height: 100%;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 3rem;
    border-bottom: 1px solid #333;
    padding-bottom: 1.5rem;
  }
  
  .header h2 { margin: 0; font-size: 1.25rem; letter-spacing: 0.05em; }

  .controls { display: flex; align-items: center; gap: 1.5rem; }
  .control-group { display: flex; flex-direction: column; gap: 0.5rem; }
  .control-group label { font-size: 0.75rem; color: #9ca3af; text-transform: uppercase; font-weight: 600; }
  
  select {
    background: #15151a;
    border: 1px solid #333;
    color: #fff;
    padding: 0.5rem 2rem 0.5rem 1rem;
    border-radius: 4px;
    font-size: 1rem;
    cursor: pointer;
  }

  .vs { font-weight: 900; color: #6b7280; font-size: 0.9rem; margin-top: 1rem; }

  .comparison-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2rem;
    margin-bottom: 3rem;
  }

  .card {
    background: #15151a;
    border: 1px solid #333;
    border-radius: 8px;
    padding: 2rem;
  }

  .card h3 { margin: 0 0 1.5rem 0; font-size: 1rem; color: #9ca3af; text-align: center; }

  .comp-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  .ver-box { text-align: center; }
  .ver-box .label { display: block; font-size: 0.8rem; color: #6b7280; margin-bottom: 0.5rem; }
  .ver-box .value { font-size: 2rem; font-weight: 700; }

  .arrow { color: #333; font-size: 1.5rem; }

  .result { text-align: center; padding-top: 1rem; border-top: 1px solid #333; font-weight: 600; }
  .diff.positive { color: #10b981; }
  .diff.negative { color: #ef4444; }

  .version-timeline h3 { margin-bottom: 1.5rem; color: #9ca3af; font-size: 1rem; }

  .timeline-list {
    position: relative;
    padding-left: 1.5rem;
    border-left: 2px solid #333;
  }

  .timeline-item {
    position: relative;
    margin-bottom: 2rem;
  }

  .timeline-marker {
    position: absolute;
    left: -23px;
    top: 5px;
    width: 12px;
    height: 12px;
    background: #3b82f6;
    border-radius: 50%;
    border: 2px solid #0a0a0f;
  }

  .timeline-content {
    background: #1a1a2e;
    padding: 1rem;
    border-radius: 6px;
    border: 1px solid #2a2a40;
  }

  .timeline-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }

  .version-tag { background: rgba(59, 130, 246, 0.1); color: #3b82f6; padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 600; font-size: 0.85rem; }
  .date { color: #6b7280; font-size: 0.85rem; }

  .changes-list { margin: 0 0 1rem 0; padding-left: 1.25rem; font-size: 0.9rem; color: #d1d5db; }
  
  .mini-metrics {
    display: flex;
    gap: 1rem;
    font-size: 0.8rem;
    color: #9ca3af;
    background: rgba(0,0,0,0.2);
    padding: 0.5rem;
    border-radius: 4px;
  }
`;
