import { useState } from 'react';

type CheckItem = {
  id: string;
  label: string;
  status: 'passed' | 'failed' | 'pending';
  value: string;
};

type Approver = {
  role: string;
  name: string;
  status: 'approved' | 'pending' | 'rejected';
  date?: string;
};

export function PromotionGatePanel() {
  const [checks] = useState<CheckItem[]>([
    { id: '1', label: 'Minimum paper trading period (15 days)', status: 'passed', value: '15 days' },
    { id: '2', label: 'Sharpe ratio > 1.0 for duration', status: 'passed', value: '1.38' },
    { id: '3', label: 'Max drawdown < 5%', status: 'passed', value: '3.2%' },
    { id: '4', label: 'Fill rate > 95%', status: 'passed', value: '97%' },
    { id: '5', label: 'Latency < 100ms', status: 'passed', value: '45ms' },
  ]);

  const [approvers, setApprovers] = useState<Approver[]>([
    { role: 'Quant Review', name: 'Alex Chen', status: 'approved', date: 'Jan 15, 9:30' },
    { role: 'Risk Manager', name: 'Morgan Lee', status: 'pending' },
    { role: 'Portfolio Mgr', name: 'Taylor Kim', status: 'pending' },
  ]);

  const handleApprove = (index: number) => {
    const newApprovers = [...approvers];
    newApprovers[index].status = 'approved';
    newApprovers[index].date = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: false });
    setApprovers(newApprovers);
  };

  return (
    <div className="promotion-gate">
      <div className="gate-header">
        <div className="header-content">
          <h2>🚀 PROMOTION GATE: VolArbitrage_v2</h2>
          <div className="promotion-path">
            <span className="path-node">Paper Trading</span>
            <span className="arrow">→</span>
            <span className="path-node live">Live Trading</span>
          </div>
        </div>
      </div>

      <div className="gate-content">
        {/* Automated Checks */}
        <div className="section">
          <div className="section-header">
            <h3>AUTOMATED CHECKS</h3>
            <span className="status-label passed">ALL PASSED</span>
          </div>
          <div className="checks-list">
            {checks.map((check) => (
              <div key={check.id} className="check-item">
                <span className="check-icon">{check.status === 'passed' ? '✓' : '○'}</span>
                <span className="check-label">{check.label}</span>
                <span className={`check-value ${check.status}`}>{check.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Approval Chain */}
        <div className="section">
          <h3>APPROVAL CHAIN</h3>
          <div className="approval-list">
            {approvers.map((approver, i) => (
              <div key={i} className="approval-item">
                <div className="approver-info">
                  <span className="role-badge">{i + 1}</span>
                  <span className="role-name">{approver.role}</span>
                  <span className="person-name">{approver.name}</span>
                </div>
                <div className="approval-status">
                  {approver.status === 'pending' ? (
                    <button className="btn-approve" onClick={() => handleApprove(i)}>Approve</button>
                  ) : (
                    <span className="approved-text">
                      Approved <span className="date">{approver.date}</span>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Agent Report */}
        <div className="agent-report">
          <div className="report-header">
            <span className="icon">🤖</span>
            <h3>AGENT READINESS REPORT</h3>
            <span className="score">Score: 92/100</span>
          </div>
          <div className="report-body">
            <div className="recommendation">
              Recommendation: <strong className="highlight">PROMOTE with high confidence</strong>
            </div>
            <div className="report-section">
              <h4>Key Findings</h4>
              <ul>
                <li>Strategy performed within 5% of backtest expectations</li>
                <li>Execution quality exceeded model assumptions</li>
                <li>No regime-specific underperformance detected</li>
              </ul>
            </div>
            <div className="report-section">
              <h4>Risk Assessment</h4>
              <ul>
                <li>Worst-case daily loss (95% CI): $8,500</li>
                <li>Correlation with existing strategies: 0.12 (low)</li>
              </ul>
            </div>
          </div>
          <button className="btn-full-report">View Full Report</button>
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .promotion-gate {
    padding: 1.5rem;
    color: #e5e5e5;
    background: #0a0a0f;
    height: 100%;
    overflow-y: auto;
  }

  .gate-header {
    margin-bottom: 2rem;
    border-bottom: 1px solid #333;
    padding-bottom: 1.5rem;
  }

  .header-content h2 {
    margin: 0 0 1rem;
    font-size: 1.5rem;
    color: #e5e5e5;
  }

  .promotion-path {
    display: flex;
    align-items: center;
    gap: 1rem;
    font-size: 0.9rem;
    color: #9ca3af;
  }

  .path-node {
    background: #1f2937;
    padding: 0.4rem 1rem;
    border-radius: 4px;
    font-weight: 500;
  }

  .path-node.live {
    background: rgba(16, 185, 129, 0.1);
    color: #10b981;
    border: 1px solid rgba(16, 185, 129, 0.2);
  }

  .section {
    background: #15151a;
    border: 1px solid #333;
    border-radius: 0.75rem;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .section h3 {
    margin: 0;
    font-size: 0.9rem;
    color: #9ca3af;
    letter-spacing: 0.05em;
  }

  .status-label.passed {
    color: #10b981;
    font-size: 0.8rem;
    font-weight: 600;
    background: rgba(16, 185, 129, 0.1);
    padding: 0.2rem 0.6rem;
    border-radius: 4px;
  }

  .checks-list { display: grid; gap: 0.75rem; }

  .check-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem;
    background: rgba(255, 255, 255, 0.02);
    border-radius: 4px;
  }

  .check-icon { color: #10b981; font-weight: bold; }
  .check-label { flex: 1; color: #d1d5db; font-size: 0.9rem; }
  .check-value { font-family: monospace; font-size: 0.9rem; }
  .check-value.passed { color: #10b981; }

  .approval-list { display: grid; gap: 1rem; margin-top: 1rem; }

  .approval-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    background: rgba(255, 255, 255, 0.02);
    border-radius: 4px;
    border-left: 3px solid #333;
  }

  .approver-info { display: flex; align-items: center; gap: 1rem; }
  .role-badge { 
    width: 24px; height: 24px; 
    background: #333; 
    border-radius: 50%; 
    display: flex; 
    align-items: center; 
    justify-content: center;
    font-size: 0.8rem;
    color: #9ca3af;
  }
  .role-name { font-weight: 600; color: #e5e5e5; font-size: 0.9rem; }
  .person-name { color: #9ca3af; font-size: 0.9rem; }

  .btn-approve {
    background: #3b82f6;
    color: white;
    border: none;
    padding: 0.4rem 1rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
  }
  .btn-approve:hover { background: #2563eb; }

  .approved-text { color: #10b981; font-size: 0.9rem; font-weight: 500; }
  .approved-text .date { color: #6b7280; font-weight: normal; font-size: 0.85rem; margin-left: 0.5rem; }

  .agent-report {
    background: rgba(16, 185, 129, 0.05);
    border: 1px solid rgba(16, 185, 129, 0.1);
    border-radius: 0.75rem;
    padding: 1.5rem;
  }

  .report-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
    border-bottom: 1px solid rgba(16, 185, 129, 0.1);
    padding-bottom: 1rem;
  }

  .report-header h3 { margin: 0; color: #10b981; font-size: 1.1rem; flex: 1; }
  .score { font-weight: bold; color: #10b981; font-size: 1.1rem; }

  .recommendation { margin-bottom: 1.5rem; font-size: 1rem; color: #e5e5e5; }
  .highlight { color: #10b981; }

  .report-section { margin-bottom: 1.5rem; }
  .report-section h4 { margin: 0 0 0.5rem; color: #9ca3af; font-size: 0.9rem; text-transform: uppercase; }
  .report-section ul { margin: 0; padding-left: 1.2rem; color: #d1d5db; font-size: 0.95rem; }
  .report-section li { margin-bottom: 0.4rem; }

  .btn-full-report {
    width: 100%;
    padding: 0.75rem;
    background: rgba(16, 185, 129, 0.1);
    color: #10b981;
    border: 1px solid rgba(16, 185, 129, 0.2);
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
  }
  .btn-full-report:hover { background: rgba(16, 185, 129, 0.2); }
`;

export default PromotionGatePanel;
