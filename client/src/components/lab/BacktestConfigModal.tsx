import { useState } from 'react';

type BacktestConfig = {
  startDate: string;
  endDate: string;
  initialCapital: number;
  slippageModel: 'fixed' | 'variable' | 'zero';
  commissionModel: 'fixed' | 'per_share' | 'zero';
  includeAfterHours: boolean;
  benchmark: string;
  tradingMethod?: 'equities' | 'options' | 'futures';
  // Futures fields
  contractType?: string;
  rollStrategy?: 'volume' | 'calendar' | 'open_interest';
  marginPerContract?: number;
  // Options fields
  underlying?: string;
  optionType?: 'call' | 'put';
  strikeSelection?: 'atm' | 'otm_1' | 'otm_2' | 'itm_1' | 'delta_target';
  deltaTarget?: number;
  dteMin?: number;
  dteMax?: number;
};

type Props = {
  strategyName: string;
  strategyType?: string;
  tradingMethod?: string;
  onRun: (config: BacktestConfig) => void;
  onCancel: () => void;
};

export function BacktestConfigModal({ strategyName, strategyType, tradingMethod, onRun, onCancel }: Props) {
  const isFutures = tradingMethod === 'futures' || strategyType === 'futures' || strategyType === 'Futures';
  const isOptions = tradingMethod === 'options' || strategyType === 'options' || strategyType === '0dte' || strategyType === 'spreads';

  const [config, setConfig] = useState<BacktestConfig>({
    startDate: '2025-01-01',
    endDate: '2025-12-31',
    initialCapital: 100000,
    slippageModel: 'variable',
    commissionModel: 'per_share',
    includeAfterHours: false,
    benchmark: isFutures ? 'ES' : 'SPY',
    tradingMethod: isFutures ? 'futures' : isOptions ? 'options' : 'equities',
    ...(isFutures ? {
      contractType: 'ES',
      rollStrategy: 'volume' as const,
      marginPerContract: 15000,
    } : {}),
    ...(isOptions ? {
      underlying: 'SPY',
      optionType: 'call' as const,
      strikeSelection: 'atm' as const,
      dteMin: 7,
      dteMax: 45,
    } : {}),
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
                {isFutures ? 'Include Globex Session Data' : 'Include After-Hours Data'}
              </label>
            </div>
          </div>

          {isFutures && (
            <div className="futures-config-section">
              <h4 className="futures-section-title">Futures Configuration</h4>
              <div className="config-grid">
                <div className="form-group">
                  <label>Contract</label>
                  <select
                    value={config.contractType ?? 'ES'}
                    onChange={(e) => setConfig({ ...config, contractType: e.target.value })}
                  >
                    <option value="ES">E-mini S&P 500 (ES)</option>
                    <option value="NQ">E-mini Nasdaq 100 (NQ)</option>
                    <option value="CL">Crude Oil (CL)</option>
                    <option value="GC">Gold (GC)</option>
                    <option value="ZB">30-Year T-Bond (ZB)</option>
                    <option value="RTY">E-mini Russell 2000 (RTY)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Roll Strategy</label>
                  <select
                    value={config.rollStrategy ?? 'volume'}
                    onChange={(e) => setConfig({ ...config, rollStrategy: e.target.value as 'volume' | 'calendar' | 'open_interest' })}
                  >
                    <option value="volume">Volume-based</option>
                    <option value="calendar">Calendar (fixed date)</option>
                    <option value="open_interest">Open Interest</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Margin per Contract ($)</label>
                  <input
                    type="number"
                    value={config.marginPerContract ?? 15000}
                    onChange={(e) => setConfig({ ...config, marginPerContract: parseFloat(e.target.value) })}
                  />
                </div>
              </div>
            </div>
          )}

          {isOptions && (
            <div className="futures-config-section">
              <h4 className="futures-section-title" style={{ color: '#8b5cf6' }}>Options Configuration</h4>
              <div className="config-grid">
                <div className="form-group">
                  <label>Underlying Ticker</label>
                  <input
                    type="text"
                    value={config.underlying ?? 'SPY'}
                    onChange={(e) => setConfig({ ...config, underlying: e.target.value.toUpperCase() })}
                    placeholder="SPY"
                  />
                </div>

                <div className="form-group">
                  <label>Option Type</label>
                  <select
                    value={config.optionType ?? 'call'}
                    onChange={(e) => setConfig({ ...config, optionType: e.target.value as 'call' | 'put' })}
                  >
                    <option value="call">Call</option>
                    <option value="put">Put</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Strike Selection</label>
                  <select
                    value={config.strikeSelection ?? 'atm'}
                    onChange={(e) => setConfig({ ...config, strikeSelection: e.target.value as any })}
                  >
                    <option value="atm">ATM (At the Money)</option>
                    <option value="otm_1">OTM +1 Strike</option>
                    <option value="otm_2">OTM +2 Strikes</option>
                    <option value="itm_1">ITM -1 Strike</option>
                    <option value="delta_target">Delta Target</option>
                  </select>
                </div>

                {config.strikeSelection === 'delta_target' && (
                  <div className="form-group">
                    <label>Delta Target</label>
                    <input
                      type="number"
                      step="0.05"
                      min="0.05"
                      max="0.95"
                      value={config.deltaTarget ?? 0.30}
                      onChange={(e) => setConfig({ ...config, deltaTarget: parseFloat(e.target.value) })}
                    />
                  </div>
                )}

                <div className="form-group">
                  <label>Min DTE (Days to Expiry)</label>
                  <input
                    type="number"
                    min="0"
                    value={config.dteMin ?? 7}
                    onChange={(e) => setConfig({ ...config, dteMin: parseInt(e.target.value) })}
                  />
                </div>

                <div className="form-group">
                  <label>Max DTE (Days to Expiry)</label>
                  <input
                    type="number"
                    min="1"
                    value={config.dteMax ?? 45}
                    onChange={(e) => setConfig({ ...config, dteMax: parseInt(e.target.value) })}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="agent-insight">
            <div className="insight-header">
              <span className="icon">🤖</span>
              <span>Agent Advice</span>
            </div>
            <p>
              {isFutures
                ? 'For futures strategies, ensure your backtest covers contract roll periods to validate roll logic. Use volume-based rolls for liquid contracts like ES/NQ, and account for margin requirements in position sizing. Include Globex session data to capture overnight moves.'
                : isOptions
                ? 'For options strategies, ATM contracts provide the highest delta exposure but cost more in premium. OTM contracts are cheaper but need larger moves to profit. Keep DTE above 7 to avoid extreme theta decay, and ensure your date range covers varying IV environments.'
                : 'For volatility strategies, I recommend using the \'Variable\' slippage model to account for liquidity during high-vol events. Also, ensure your date range covers at least one major correction (e.g., Aug 2024 or Mar 2020) to validate drawdown resilience.'}
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

  .futures-config-section {
    margin-bottom: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid #333;
  }

  .futures-section-title {
    margin: 0 0 1rem;
    font-size: 0.9rem;
    color: #f59e0b;
    font-weight: 600;
    letter-spacing: 0.03em;
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
