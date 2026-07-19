import { useState, useEffect } from 'react';
import { getApiBaseUrl } from '../../api/http';
import { apiClient } from '../../api';

type HandoffRequest = {
  _id: string;
  strategyId: {
    _id: string;
    name: string;
    description?: string;
    strategyType: string;
  };
  requesterId: string;
  status: 'pending' | 'approved' | 'rejected' | 'deployed';
  engineConfig: {
    maxCapital: number;
    riskLimits: {
      maxDrawdown: number;
      maxDailyLoss: number;
    };
    symbols: string[];
  };
  validationProof: {
    sharpeRatio: number;
    expectedValue: number;
    backtestId?: string;
  };
  createdAt: string;
  approvalMeta?: {
    approvedBy: string;
    approvedAt: string;
  };
  rejectionReason?: string;
};

type Props = {
  apiBase?: string;
  refreshIntervalMs?: number;
  onApprove?: (request: HandoffRequest) => void;
  onReject?: (request: HandoffRequest) => void;
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'pending': return '#fbbf24';   // intel-warn
    case 'approved': return '#35d29a';  // intel-pos
    case 'rejected': return '#f87171';  // intel-neg
    case 'deployed': return '#6aa5f5';  // intel-info
    default: return '#94a3b8';          // intel-ink2
  }
}

export function HandoffRequestsPanel({ apiBase = getApiBaseUrl(), refreshIntervalMs = 10000, onApprove, onReject }: Props) {
  const [requests, setRequests] = useState<HandoffRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const fetchRequests = async () => {
    try {
      const { data } = await apiClient.get('/api/handoff/requests', { baseURL: apiBase });
      setRequests(data ?? []);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const approveRequest = async (request: HandoffRequest) => {
    setProcessingId(request._id);
    try {
      await apiClient.post('/api/handoff/approve', {
        requestId: request._id,
        approverId: 'dashboard-user'
      }, {
        baseURL: apiBase
      });
      await fetchRequests();
      onApprove?.(request);
    } catch (err: any) {
      setError(`Approval failed: ${err.message}`);
    } finally {
      setProcessingId(null);
    }
  };

  useEffect(() => {
    fetchRequests();
    const interval = setInterval(fetchRequests, refreshIntervalMs);
    return () => clearInterval(interval);
  }, [apiBase, refreshIntervalMs]);

  const pendingCount = requests.filter(r => r.status === 'pending').length;

  return (
    <div className="handoff-panel">
      <header className="panel-header">
        <div className="header-title">
          <h2>Handoff Requests</h2>
          <p className="header-subtitle">Lab → Engine deployment approvals</p>
        </div>
        <div className="header-stats">
          {pendingCount > 0 && (
            <div className="stat pending-alert">
              <span className="stat-value">{pendingCount}</span>
              <span className="stat-label">Pending</span>
            </div>
          )}
          <div className="stat">
            <span className="stat-value">{requests.length}</span>
            <span className="stat-label">Total</span>
          </div>
        </div>
      </header>

      {error && (
        <div className="error-banner">⚠️ {error}</div>
      )}

      {loading && requests.length === 0 ? (
        <div className="loading-state">Loading handoff requests...</div>
      ) : requests.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">🔄</span>
          <p>No handoff requests</p>
          <span className="empty-hint">Requests appear when strategies are promoted from Lab</span>
        </div>
      ) : (
        <div className="requests-list">
          {requests.map(request => (
            <div key={request._id} className={`request-card ${request.status}`}>
              <div className="request-header">
                <div className="request-title">
                  <span className="strategy-name">
                    {typeof request.strategyId === 'object'
                      ? request.strategyId.name
                      : 'Unknown Strategy'}
                  </span>
                  <span className="request-type">
                    {typeof request.strategyId === 'object'
                      ? request.strategyId.strategyType
                      : ''}
                  </span>
                </div>
                <span
                  className="status-badge"
                  style={{
                    backgroundColor: getStatusColor(request.status) + '20',
                    color: getStatusColor(request.status)
                  }}
                >
                  {request.status}
                </span>
              </div>

              <div className="request-details">
                <div className="detail-group">
                  <span className="detail-label">Validation Proof</span>
                  <div className="proof-stats">
                    <span className="proof-item">
                      <strong>Sharpe:</strong> {request.validationProof.sharpeRatio.toFixed(2)}
                    </span>
                    <span className="proof-item">
                      <strong>EV:</strong> {request.validationProof.expectedValue.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="detail-group">
                  <span className="detail-label">Engine Config</span>
                  <div className="config-stats">
                    <span>Capital: {formatCurrency(request.engineConfig.maxCapital)}</span>
                    <span>Symbols: {request.engineConfig.symbols.join(', ')}</span>
                  </div>
                </div>

                <div className="detail-group">
                  <span className="detail-label">Risk Limits</span>
                  <div className="risk-stats">
                    <span>Max Drawdown: {(request.engineConfig.riskLimits.maxDrawdown * 100).toFixed(0)}%</span>
                    <span>Daily Loss: {formatCurrency(request.engineConfig.riskLimits.maxDailyLoss)}</span>
                  </div>
                </div>
              </div>

              <div className="request-footer">
                <span className="request-meta">
                  Requested {formatDate(request.createdAt)} by {request.requesterId}
                </span>

                {request.status === 'pending' && (
                  <div className="request-actions">
                    <button
                      type="button"
                      className="action-btn approve-btn"
                      onClick={() => approveRequest(request)}
                      disabled={processingId === request._id}
                    >
                      {processingId === request._id ? '⏳' : '✅'} Approve
                    </button>
                    <button
                      type="button"
                      className="action-btn reject-btn"
                      onClick={() => onReject?.(request)}
                      disabled={processingId === request._id}
                    >
                      ❌ Reject
                    </button>
                  </div>
                )}

                {request.status === 'approved' && request.approvalMeta && (
                  <span className="approval-info">
                    Approved by {request.approvalMeta.approvedBy} on {formatDate(request.approvalMeta.approvedAt)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .handoff-panel {
          background: #0b1220;
          border-radius: 12px;
          border: 1px solid #1e293b;
          overflow: hidden;
        }

        .panel-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding: 1.5rem;
          border-bottom: 1px solid #1e293b;
        }

        .header-title h2 {
          margin: 0 0 0.25rem;
          font-size: 1.25rem;
          font-weight: 600;
          color: #e9edf6;
        }

        .header-subtitle {
          margin: 0;
          font-size: 0.85rem;
          color: #94a3b8;
        }

        .header-stats {
          display: flex;
          gap: 2rem;
        }

        .stat {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
        }

        .stat-value {
          font-size: 1.5rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          color: #e9edf6;
        }

        .stat-label {
          font-size: 0.75rem;
          color: #64748b;
          text-transform: uppercase;
        }

        .pending-alert .stat-value {
          color: #fbbf24;
        }

        .error-banner {
          background: rgba(248, 113, 113, 0.1);
          border: 1px solid rgba(248, 113, 113, 0.4);
          color: #f87171;
          padding: 0.75rem 1rem;
          margin: 1rem;
          border-radius: 0.5rem;
          font-size: 0.85rem;
        }

        .loading-state, .empty-state {
          padding: 3rem;
          text-align: center;
          color: #94a3b8;
        }

        .empty-icon {
          font-size: 2.5rem;
          display: block;
          margin-bottom: 1rem;
        }

        .empty-hint {
          font-size: 0.8rem;
          color: #64748b;
        }

        .requests-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          padding: 1rem;
        }

        .request-card {
          background: #111a2b;
          border: 1px solid #1e293b;
          border-radius: 12px;
          padding: 1rem;
        }

        .request-card.pending {
          border-color: rgba(251, 191, 36, 0.4);
        }

        .request-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
        }

        .request-title {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .strategy-name {
          font-size: 1.05rem;
          font-weight: 600;
          color: #e9edf6;
        }

        .request-type {
          font-size: 0.75rem;
          color: #94a3b8;
          background: #020617;
          padding: 0.2rem 0.5rem;
          border-radius: 0.25rem;
        }

        .status-badge {
          font-size: 0.7rem;
          font-weight: 600;
          padding: 0.25rem 0.5rem;
          border-radius: 0.25rem;
          text-transform: uppercase;
        }

        .request-details {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 1rem;
          margin-bottom: 1rem;
          padding: 0.75rem;
          background: #020617;
          border-radius: 0.5rem;
        }

        .detail-group {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }

        .detail-label {
          font-size: 0.7rem;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .proof-stats, .config-stats, .risk-stats {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
          font-size: 0.85rem;
          color: #94a3b8;
          font-variant-numeric: tabular-nums;
        }

        .proof-item strong {
          color: #f5a623;
        }

        .request-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-top: 0.75rem;
          border-top: 1px solid #1e293b;
        }

        .request-meta {
          font-size: 0.75rem;
          color: #64748b;
        }

        .approval-info {
          font-size: 0.75rem;
          color: #35d29a;
        }

        .request-actions {
          display: flex;
          gap: 0.5rem;
        }

        .action-btn {
          padding: 0.5rem 1rem;
          border: 1px solid #1e293b;
          border-radius: 0.5rem;
          background: transparent;
          color: #94a3b8;
          font-size: 0.8rem;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .action-btn:hover:not(:disabled) {
          background: #111a2b;
        }

        .action-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .approve-btn:hover:not(:disabled) {
          border-color: rgba(245, 166, 35, 0.38);
          color: #f5a623;
        }

        .reject-btn:hover:not(:disabled) {
          border-color: rgba(248, 113, 113, 0.4);
          color: #f87171;
        }
      `}</style>
    </div>
  );
}
