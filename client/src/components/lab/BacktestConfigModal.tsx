import { useState } from 'react';

type BacktestConfig = {
  startDate: string;
  endDate: string;
  initialCapital: number;
  slippageModel: 'fixed' | 'variable' | 'zero';
  commissionModel: 'fixed' | 'per_share' | 'zero';
  includeAfterHours: boolean;
  benchmark: string;
};

type Props = {
  strategyName: string;
  onRun: (config: BacktestConfig) => void;
  onCancel: () => void;
};

export function BacktestConfigModal({ strategyName, onRun, onCancel }: Props) {
  const [config, setConfig] = useState<BacktestConfig>({
    startDate: '2025-01-01',
    endDate: '2025-12-31',
    initialCapital: 100000,
    slippageModel: 'variable',
    commissionModel: 'per_share',
    includeAfterHours: false,
    benchmark: 'SPY',
  });

  const handleSubmit = () => {
    onRun(config);
  };

  return (
    <div className="backtest-config-overlay">
      <div className="backtest-config-modal">
        <div className="modal-header">
          <h3>⚡ Run Backtest: {strategyName}</h3>
          <button className="close-btn" onClick={onCancel}>×</button>
        </div>

        <div className="modal-body">
          <div className="config-grid">
            <div className="form-group">
              <label>Start Date</label>
              <input
                type="date"
                value={config.startDate}
                onChange={(e) => setConfig({ ...config, startDate: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label>End Date</label>
              <input
                type="date"
                value={config.endDate}
                onChange={(e) => setConfig({ ...config, endDate: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label>Initial Capital</label>
              <input
                type="number"
                value={config.initialCapital}
                onChange={(e) => setConfig({ ...config, initialCapital: parseFloat(e.target.value) })}
              />
            </div>

            <div className="form-group">
              <label>Benchmark Ticker</label>
              <input
                type="text"
                value={config.benchmark}
                onChange={(e) => setConfig({ ...config, benchmark: e.target.value.toUpperCase() })}
              />
            </div>

            <div className="form-group">
              <label>Slippage Model</label>
              <select
                value={config.slippageModel}
                onChange={(e) => setConfig({ ...config, slippageModel: e.target.value as any })}
              >
                <option value="variable">Variable (Volatility based)</option>
                <option value="fixed">Fixed (0.01%)</option>
                <option value="zero">None (Ideal)</option>
              </select>
            </div>

            <div className="form-group">
              <label>Commission Model</label>
              <select
                value={config.commissionModel}
                onChange={(e) => setConfig({ ...config, commissionModel: e.target.value as any })}
              >
                <option value="per_share">$0.005 per share</option>
                <option value="fixed">$1.00 per trade</option>
                <option value="zero">Zero Commission</option>
              </select>
            </div>

            <div className="form-group checkbox-group">
              <label>
                <input
                  type="checkbox"
                  checked={config.includeAfterHours}
                  onChange={(e) => setConfig({ ...config, includeAfterHours: e.target.checked })}
                />
                Include After-Hours Data
              </label>
            </div>
          </div>

          <div className="agent-insight">
            <div className="insight-header">
              <span className="icon">🤖</span>
              <span>Agent Advice</span>
            </div>
            <p>
              For volatility strategies, I recommend using the 'Variable' slippage model to account for liquidity during high-vol events. Also, ensure your date range covers at least one major correction (e.g., Aug 2024 or Mar 2020) to validate drawdown resilience.
            </p>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit}>🚀 Start Backtest</button>
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .backtest-config-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(4px);
  }

  .backtest-config-modal {
    background: #1e1e1e;
    border: 1px solid #333;
    border-radius: 0.75rem;
    width: 600px;
    max-width: 90%;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
    color: #e5e5e5;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.25rem;
    border-bottom: 1px solid #333;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1.1rem;
    color: #e5e5e5;
  }

  .close-btn {
    background: none;
    border: none;
    color: #9ca3af;
    font-size: 1.5rem;
    cursor: pointer;
    line-height: 1;
  }

  .modal-body {
    padding: 1.5rem;
  }

  .config-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.25rem;
    margin-bottom: 1.5rem;
  }

  .form-group label {
    display: block;
    margin-bottom: 0.5rem;
    font-size: 0.85rem;
    color: #9ca3af;
  }

  .form-group input,
  .form-group select {
    width: 100%;
    padding: 0.6rem;
    background: #2d2d2d;
    border: 1px solid #454545;
    border-radius: 4px;
    color: #e5e5e5;
    font-size: 0.9rem;
  }

  .form-group input:focus,
  .form-group select:focus {
    outline: none;
    border-color: #10b981;
  }
  
  .checkbox-group label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    color: #e5e5e5;
  }
  
  .checkbox-group input {
    width: auto;
  }

  .agent-insight {
    background: rgba(16, 185, 129, 0.1);
    border: 1px solid rgba(16, 185, 129, 0.2);
    border-radius: 0.5rem;
    padding: 1rem;
  }

  .insight-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #10b981;
    font-weight: 600;
    font-size: 0.9rem;
    margin-bottom: 0.5rem;
  }

  .agent-insight p {
    margin: 0;
    font-size: 0.85rem;
    color: #cccc;
    line-height: 1.5;
  }

  .modal-footer {
    padding: 1.25rem;
    border-top: 1px solid #333;
    display: flex;
    justify-content: flex-end;
    gap: 1rem;
  }

  .btn-secondary,
  .btn-primary {
    padding: 0.6rem 1.25rem;
    border-radius: 4px;
    font-weight: 500;
    cursor: pointer;
    font-size: 0.9rem;
  }

  .btn-secondary {
    background: transparent;
    border: 1px solid #454545;
    color: #cccccc;
  }

  .btn-secondary:hover {
    background: #2d2d2d;
    color: #ffffff;
  }

  .btn-primary {
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    border: none;
    color: white;
  }

  .btn-primary:hover {
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
  }
`;

export default BacktestConfigModal;
