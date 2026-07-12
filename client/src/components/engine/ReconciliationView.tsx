import { useState } from 'react';
import { DemoDataBadge } from '../shared/DemoDataBadge';

type PositionRecord = {
  symbol: string;
  systemQty: number;
  brokerQty: number;
  systemAvgPrice: number;
  brokerAvgPrice: number;
  discrepancy: boolean;
};

type TradeRecord = {
  id: string;
  time: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  price: number;
  venue: string;
  status: 'MATCHED' | 'MISSING_IN_BROKER' | 'MISSING_IN_SYSTEM';
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export function ReconciliationView({ isOpen, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<'positions' | 'trades'>('positions');

  const [positions] = useState<PositionRecord[]>([
    { symbol: 'SPY', systemQty: 150, brokerQty: 150, systemAvgPrice: 445.20, brokerAvgPrice: 445.20, discrepancy: false },
    { symbol: 'VXX', systemQty: -200, brokerQty: -200, systemAvgPrice: 22.50, brokerAvgPrice: 22.50, discrepancy: false },
    { symbol: 'AAPL', systemQty: 50, brokerQty: 45, systemAvgPrice: 175.30, brokerAvgPrice: 175.35, discrepancy: true },
    { symbol: 'MSFT', systemQty: 0, brokerQty: 0, systemAvgPrice: 0, brokerAvgPrice: 0, discrepancy: false },
  ]);

  const [trades] = useState<TradeRecord[]>([
    { id: 'T10234', time: '09:30:05', symbol: 'SPY', side: 'BUY', qty: 50, price: 445.10, venue: 'IBKR', status: 'MATCHED' },
    { id: 'T10235', time: '09:32:12', symbol: 'VXX', side: 'SELL', qty: 100, price: 22.45, venue: 'IBKR', status: 'MATCHED' },
    { id: 'T10236', time: '10:15:00', symbol: 'AAPL', side: 'BUY', qty: 5, price: 175.40, venue: 'IBKR', status: 'MISSING_IN_SYSTEM' },
    { id: 'T10237', time: '11:20:45', symbol: 'SPY', side: 'BUY', qty: 50, price: 445.30, venue: 'IBKR', status: 'MATCHED' },
  ]);

  if (!isOpen) return null;

  return (
    <div className="reconciliation-overlay">
      <div className="reconciliation-modal">
        <div className="modal-header">
          <div className="header-title">
            <h3>
              📑 END-OF-DAY RECONCILIATION <DemoDataBadge note="Positions and trades shown here are illustrative — this view is not connected to the broker yet." />
            </h3>
            <span className="date">Date: {new Date().toLocaleDateString()}</span>
          </div>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="summary-banner">
          <div className="summary-item">
            <label>Total Equity Diff</label>
            <span className="value negative">-$87.50</span>
          </div>
          <div className="summary-item">
            <label>Unmatched Trades</label>
            <span className="value warning">1</span>
          </div>
          <div className="summary-item">
            <label>Position Breaks</label>
            <span className="value warning">1</span>
          </div>
          <div className="summary-actions">
            <button className="btn-primary">Auto-Resolve Safe</button>
            <button className="btn-secondary">Export Report</button>
          </div>
        </div>

        <div className="tabs">
          <button
            className={`tab ${activeTab === 'positions' ? 'active' : ''}`}
            onClick={() => setActiveTab('positions')}
          >
            Position Reconciliation
          </button>
          <button
            className={`tab ${activeTab === 'trades' ? 'active' : ''}`}
            onClick={() => setActiveTab('trades')}
          >
            Trade Ledger Match
          </button>
        </div>

        <div className="tab-content">
          {activeTab === 'positions' ? (
            <table className="recon-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>System Qty</th>
                  <th>Broker Qty</th>
                  <th>Diff</th>
                  <th>System Avg Px</th>
                  <th>Broker Avg Px</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.symbol} className={p.discrepancy ? 'row-error' : ''}>
                    <td className="font-bold">{p.symbol}</td>
                    <td>{p.systemQty}</td>
                    <td>{p.brokerQty}</td>
                    <td className={p.discrepancy ? 'text-error' : 'text-success'}>
                      {p.brokerQty - p.systemQty}
                    </td>
                    <td>${p.systemAvgPrice.toFixed(2)}</td>
                    <td>${p.brokerAvgPrice.toFixed(2)}</td>
                    <td>
                      {p.discrepancy ? (
                        <button className="btn-xs btn-fix">Fix</button>
                      ) : (
                        <span className="icon-check">✓</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="recon-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>ID</th>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id} className={t.status !== 'MATCHED' ? 'row-warning' : ''}>
                    <td>{t.time}</td>
                    <td className="font-mono">{t.id}</td>
                    <td className="font-bold">{t.symbol}</td>
                    <td className={t.side === 'BUY' ? 'text-success' : 'text-error'}>{t.side}</td>
                    <td>{t.qty}</td>
                    <td>${t.price.toFixed(2)}</td>
                    <td>
                      <span className={`status-pill ${t.status.toLowerCase()}`}>
                        {t.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td>
                      {t.status !== 'MATCHED' && (
                        <button className="btn-xs btn-fix">Investigate</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="modal-footer">
          <span className="info-text">
            <span className="icon">ℹ️</span>
            System snapshots taken at 16:00:00 EST vs IBKR Final Statement
          </span>
          <div className="footer-actions">
            <button className="btn-text" onClick={onClose}>Cancel</button>
            <button className="btn-success">Sign Off & Close Day</button>
          </div>
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .reconciliation-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
  }

  .reconciliation-modal {
    background: #1e1e24;
    width: 900px;
    max-width: 95vw;
    border-radius: 8px;
    border: 1px solid #333;
    box-shadow: 0 20px 50px rgba(0,0,0,0.5);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    padding: 1.5rem;
    border-bottom: 1px solid #333;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    background: #25252b;
  }

  .header-title h3 { margin: 0; font-size: 1.25rem; color: #fff; }
  .header-title .date { color: #9ca3af; font-size: 0.9rem; margin-top: 0.25rem; display: block; }

  .close-btn {
    background: none; border: none; color: #9ca3af; font-size: 1.5rem; cursor: pointer;
    line-height: 1; padding: 0;
  }
  .close-btn:hover { color: #fff; }

  .summary-banner {
    display: flex;
    gap: 2rem;
    padding: 1.5rem;
    background: #15151a;
    border-bottom: 1px solid #333;
    align-items: center;
  }

  .summary-item { display: flex; flex-direction: column; gap: 0.25rem; }
  .summary-item label { font-size: 0.75rem; color: #9ca3af; text-transform: uppercase; font-weight: 600; }
  .summary-item .value { font-size: 1.25rem; font-weight: 700; color: #e5e5e5; }
  .summary-item .value.negative { color: #ef4444; }
  .summary-item .value.warning { color: #f59e0b; }

  .summary-actions { margin-left: auto; display: flex; gap: 1rem; }

  .tabs {
    display: flex;
    padding: 0 1.5rem;
    border-bottom: 1px solid #333;
    background: #25252b;
  }

  .tab {
    padding: 1rem 1.5rem;
    background: none;
    border: none;
    color: #9ca3af;
    cursor: pointer;
    font-size: 0.9rem;
    border-bottom: 2px solid transparent;
  }
  .tab:hover { color: #e5e5e5; }
  .tab.active { color: #10b981; border-bottom-color: #10b981; }

  .tab-content { padding: 1.5rem; min-height: 300px; }

  .recon-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  .recon-table th { text-align: left; padding: 0.75rem; color: #6b7280; font-weight: 600; border-bottom: 1px solid #333; }
  .recon-table td { padding: 0.75rem; border-bottom: 1px solid #2a2a30; color: #d1d5db; }
  
  .row-error { background: rgba(239, 68, 68, 0.05); }
  .row-warning { background: rgba(245, 158, 11, 0.05); }

  .text-error { color: #ef4444; font-weight: 600; }
  .text-success { color: #10b981; }
  
  .status-pill { padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; }
  .status-pill.matched { background: rgba(16, 185, 129, 0.1); color: #10b981; }
  .status-pill.missing_in_system { background: rgba(245, 158, 11, 0.1); color: #f59e0b; }
  .status-pill.missing_in_broker { background: rgba(239, 68, 68, 0.1); color: #ef4444; }

  .btn-primary { background: #3b82f6; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; font-weight: 500; }
  .btn-primary:hover { background: #2563eb; }
  
  .btn-secondary { background: transparent; border: 1px solid #4b5563; color: #d1d5db; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; }
  .btn-secondary:hover { border-color: #6b7280; }

  .btn-xs { padding: 0.25rem 0.5rem; font-size: 0.75rem; border-radius: 3px; cursor: pointer; border: none; }
  .btn-fix { background: #3b82f6; color: white; }
  .btn-fix:hover { background: #2563eb; }

  .modal-footer {
    padding: 1rem 1.5rem;
    border-top: 1px solid #333;
    background: #25252b;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .info-text { display: flex; align-items: center; gap: 0.5rem; color: #9ca3af; font-size: 0.85rem; }
  .footer-actions { display: flex; gap: 1rem; }

  .btn-text { background: none; border: none; color: #9ca3af; cursor: pointer; }
  .btn-text:hover { color: #e5e5e5; }

  .btn-success { background: #10b981; color: white; border: none; padding: 0.5rem 1.5rem; border-radius: 4px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 6px rgba(16, 185, 129, 0.2); }
  .btn-success:hover { background: #059669; }
`;
