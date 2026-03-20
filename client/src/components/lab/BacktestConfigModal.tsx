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
    inset: 0;
    background: rgba(4, 6, 12, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(8px);
    animation: bcm-fade-in 200ms ease-out;
  }

  @keyframes bcm-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .backtest-config-modal {
    background: var(--bg-surface, #0c0e18);
    border: 1px solid var(--border-default, rgba(255,255,255,0.09));
    border-radius: var(--radius-xl, 18px);
    width: 600px;
    max-width: 92%;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255,255,255,0.03);
    color: var(--text-primary, #f0f2f5);
    animation: bcm-slide-up 250ms ease-out;
  }

  @keyframes bcm-slide-up {
    from { opacity: 0; transform: translateY(12px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--text-primary, #f0f2f5);
    letter-spacing: -0.01em;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-tertiary, #555d73);
    font-size: 1.25rem;
    cursor: pointer;
    line-height: 1;
    padding: 0.25rem;
    border-radius: 6px;
    transition: all var(--transition-fast, 150ms);
  }

  .close-btn:hover {
    color: var(--text-primary, #f0f2f5);
    background: rgba(255,255,255,0.05);
  }

  .modal-body {
    padding: 1.5rem;
  }

  .config-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    margin-bottom: 1.25rem;
  }

  .form-group label {
    display: block;
    margin-bottom: 0.375rem;
    font-size: 0.8rem;
    color: var(--text-secondary, #8b92a5);
    font-weight: 500;
  }

  .form-group input,
  .form-group select {
    width: 100%;
    padding: 0.5rem 0.625rem;
    background: var(--bg-raised, #111420);
    border: 1px solid var(--border-default, rgba(255,255,255,0.09));
    border-radius: 8px;
    color: var(--text-primary, #f0f2f5);
    font-size: 0.85rem;
    transition: border-color var(--transition-fast, 150ms);
  }

  .form-group input:focus,
  .form-group select:focus {
    outline: none;
    border-color: var(--accent, #10b981);
    box-shadow: 0 0 0 3px rgba(16,185,129,0.08);
  }

  .checkbox-group label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    color: var(--text-primary, #f0f2f5);
    font-size: 0.85rem;
  }

  .checkbox-group input {
    width: auto;
    accent-color: var(--accent, #10b981);
  }

  .futures-config-section {
    margin-bottom: 1.25rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
  }

  .futures-section-title {
    margin: 0 0 0.875rem;
    font-size: 0.8rem;
    color: var(--warning, #f59e0b);
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    font-size: 0.7rem;
  }

  .agent-insight {
    background: var(--accent-muted, rgba(16,185,129,0.12));
    border: 1px solid rgba(16, 185, 129, 0.15);
    border-radius: var(--radius-md, 10px);
    padding: 0.875rem 1rem;
  }

  .insight-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--accent, #10b981);
    font-weight: 600;
    font-size: 0.8rem;
    margin-bottom: 0.375rem;
  }

  .agent-insight p {
    margin: 0;
    font-size: 0.8rem;
    color: var(--text-secondary, #8b92a5);
    line-height: 1.55;
  }

  .modal-footer {
    padding: 1rem 1.5rem;
    border-top: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
    display: flex;
    justify-content: flex-end;
    gap: 0.625rem;
  }

  .btn-secondary,
  .btn-primary {
    padding: 0.5rem 1.125rem;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    font-size: 0.8rem;
    transition: all var(--transition-fast, 150ms);
    letter-spacing: 0.01em;
  }

  .btn-secondary {
    background: var(--bg-raised, #111420);
    border: 1px solid var(--border-default, rgba(255,255,255,0.09));
    color: var(--text-primary, #f0f2f5);
  }

  .btn-secondary:hover {
    background: var(--bg-overlay, #161a28);
    border-color: var(--border-hover, rgba(255,255,255,0.14));
  }

  .btn-primary {
    background: var(--accent, #10b981);
    border: none;
    color: white;
  }

  .btn-primary:hover {
    background: var(--accent-hover, #34d399);
    box-shadow: var(--shadow-glow, 0 0 20px rgba(16,185,129,0.15));
    transform: translateY(-1px);
  }
`;

export default BacktestConfigModal;
