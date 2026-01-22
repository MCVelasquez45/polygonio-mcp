import { useState } from 'react';

type StrategyType = 'momentum' | 'mean_reversion' | 'volatility' | '0dte' | 'spreads' | 'custom';

type WizardStep = 'type' | 'details' | 'parameters' | 'review';

type StrategyTemplate = {
  id: StrategyType;
  name: string;
  description: string;
  icon: string;
  suggestedParameters: Record<string, any>;
};

const STRATEGY_TEMPLATES: StrategyTemplate[] = [
  {
    id: 'momentum',
    name: 'Momentum',
    description: 'Trend-following strategies that capitalize on market momentum',
    icon: '📈',
    suggestedParameters: {
      lookback_period: 20,
      entry_threshold: 0.02,
      position_size: 0.05,
      stop_loss: 0.03,
    },
  },
  {
    id: 'mean_reversion',
    name: 'Mean Reversion',
    description: 'Counter-trend strategies that bet on price reverting to mean',
    icon: '📊',
    suggestedParameters: {
      lookback_period: 14,
      z_score_threshold: 2.0,
      position_size: 0.03,
      take_profit: 0.02,
    },
  },
  {
    id: 'volatility',
    name: 'Volatility',
    description: 'Strategies based on volatility patterns and term structure',
    icon: '🌊',
    suggestedParameters: {
      contango_threshold: 0.05,
      lookback_period: 20,
      position_size: 0.02,
      vix_ceiling: 35,
    },
  },
  {
    id: '0dte',
    name: '0-DTE Scalping',
    description: 'Same-day expiration options trading strategies',
    icon: '⏱',
    suggestedParameters: {
      entry_time_start: '9:35',
      entry_time_end: '11:00',
      delta_target: 0.3,
      stop_loss_pct: 50,
    },
  },
  {
    id: 'spreads',
    name: 'Options Spreads',
    description: 'Multi-leg options strategies like verticals, iron condors',
    icon: '🎯',
    suggestedParameters: {
      min_credit: 0.30,
      max_width: 5,
      days_to_expiry: 30,
      delta_short: 0.15,
    },
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Start from scratch with a blank strategy template',
    icon: '🔧',
    suggestedParameters: {},
  },
];

type Props = {
  onComplete?: (strategy: any) => void;
  onCancel?: () => void;
};

export function StrategyCreationWizard({ onComplete, onCancel }: Props) {
  const [step, setStep] = useState<WizardStep>('type');
  const [selectedType, setSelectedType] = useState<StrategyType | null>(null);
  const [strategyDetails, setStrategyDetails] = useState({
    name: '',
    description: '',
    hypothesis: '',
  });
  const [parameters, setParameters] = useState<Record<string, any>>({});
  const [agentSuggestion, setAgentSuggestion] = useState<string | null>(null);

  const selectedTemplate = STRATEGY_TEMPLATES.find(t => t.id === selectedType);

  const handleTypeSelect = (type: StrategyType) => {
    setSelectedType(type);
    const template = STRATEGY_TEMPLATES.find(t => t.id === type);
    if (template) {
      setParameters(template.suggestedParameters);
      // Simulate agent suggestion
      setTimeout(() => {
        setAgentSuggestion(getAgentSuggestion(type));
      }, 500);
    }
  };

  const getAgentSuggestion = (type: StrategyType): string => {
    const suggestions: Record<StrategyType, string> = {
      momentum: 'Based on current market conditions (VIX: 22), momentum strategies are showing strong performance. Consider using 5-min bars for entry timing.',
      mean_reversion: 'SPY has been in a tight range this week. Mean reversion strategies may find opportunities during high-volatility events.',
      volatility: 'VIX term structure shows contango of 6.2%. Short volatility strategies historically perform well in this regime.',
      '0dte': 'Current 0-DTE implied volatility is elevated. Consider targeting 30-delta options for better risk/reward.',
      spreads: 'With earnings season approaching, consider widening your spreads or reducing position sizes.',
      custom: 'I can help you build your custom strategy. What market conditions are you targeting?',
    };
    return suggestions[type];
  };

  const handleNext = () => {
    const steps: WizardStep[] = ['type', 'details', 'parameters', 'review'];
    const currentIndex = steps.indexOf(step);
    if (currentIndex < steps.length - 1) {
      setStep(steps[currentIndex + 1]);
    }
  };

  const handleBack = () => {
    const steps: WizardStep[] = ['type', 'details', 'parameters', 'review'];
    const currentIndex = steps.indexOf(step);
    if (currentIndex > 0) {
      setStep(steps[currentIndex - 1]);
    }
  };

  const handleComplete = () => {
    const strategy = {
      type: selectedType,
      ...strategyDetails,
      parameters,
      status: 'draft',
      version: 'v1.0',
      createdAt: new Date().toISOString(),
    };
    onComplete?.(strategy);
  };

  const renderStepIndicator = () => {
    const steps = [
      { id: 'type', label: 'Type' },
      { id: 'details', label: 'Details' },
      { id: 'parameters', label: 'Parameters' },
      { id: 'review', label: 'Review' },
    ];

    return (
      <div className="step-indicator">
        {steps.map((s, index) => (
          <div key={s.id} className={`step ${step === s.id ? 'active' : ''} ${steps.findIndex(x => x.id === step) > index ? 'completed' : ''}`}>
            <div className="step-number">{index + 1}</div>
            <span className="step-label">{s.label}</span>
          </div>
        ))}
      </div>
    );
  };

  const renderTypeStep = () => (
    <div className="wizard-content type-selection">
      <h3>Choose Strategy Type</h3>
      <p className="subtitle">Select a template or start from scratch</p>

      <div className="template-grid">
        {STRATEGY_TEMPLATES.map(template => (
          <div
            key={template.id}
            className={`template-card ${selectedType === template.id ? 'selected' : ''}`}
            onClick={() => handleTypeSelect(template.id)}
          >
            <span className="template-icon">{template.icon}</span>
            <h4>{template.name}</h4>
            <p>{template.description}</p>
          </div>
        ))}
      </div>

      {agentSuggestion && (
        <div className="agent-suggestion">
          <div className="suggestion-header">
            <span className="agent-icon">🤖</span>
            <span>Agent Suggestion</span>
          </div>
          <p>{agentSuggestion}</p>
        </div>
      )}
    </div>
  );

  const renderDetailsStep = () => (
    <div className="wizard-content details-form">
      <h3>Strategy Details</h3>
      <p className="subtitle">Define your strategy name and hypothesis</p>

      <div className="form-group">
        <label>Strategy Name</label>
        <input
          type="text"
          value={strategyDetails.name}
          onChange={(e) => setStrategyDetails({ ...strategyDetails, name: e.target.value })}
          placeholder="e.g., VolArbitrage_v1"
        />
      </div>

      <div className="form-group">
        <label>Description</label>
        <textarea
          value={strategyDetails.description}
          onChange={(e) => setStrategyDetails({ ...strategyDetails, description: e.target.value })}
          placeholder="Brief description of what the strategy does..."
          rows={3}
        />
      </div>

      <div className="form-group">
        <label>Trading Hypothesis</label>
        <textarea
          value={strategyDetails.hypothesis}
          onChange={(e) => setStrategyDetails({ ...strategyDetails, hypothesis: e.target.value })}
          placeholder="e.g., When VIX term structure shows contango > 5%, shorting VXX generates positive returns..."
          rows={4}
        />
        <span className="form-hint">💡 A clear hypothesis helps validate your strategy during backtesting</span>
      </div>
    </div>
  );

  const renderParametersStep = () => (
    <div className="wizard-content parameters-form">
      <h3>Strategy Parameters</h3>
      <p className="subtitle">Configure initial parameters (can be optimized later)</p>

      <div className="parameters-grid">
        {Object.entries(parameters).map(([key, value]) => (
          <div key={key} className="form-group">
            <label>{key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</label>
            <input
              type={typeof value === 'number' ? 'number' : 'text'}
              value={value}
              onChange={(e) => setParameters({
                ...parameters,
                [key]: typeof value === 'number' ? parseFloat(e.target.value) : e.target.value
              })}
              step={typeof value === 'number' && value < 1 ? 0.01 : 1}
            />
          </div>
        ))}
      </div>

      <div className="agent-suggestion">
        <div className="suggestion-header">
          <span className="agent-icon">🤖</span>
          <span>Parameter Optimization</span>
        </div>
        <p>These are suggested starting parameters. After backtesting, I can help optimize them using Bayesian optimization while avoiding overfitting.</p>
      </div>
    </div>
  );

  const renderReviewStep = () => (
    <div className="wizard-content review-summary">
      <h3>Review & Create</h3>
      <p className="subtitle">Confirm your strategy configuration</p>

      <div className="review-section">
        <h4>Strategy Type</h4>
        <div className="review-value">
          <span className="review-icon">{selectedTemplate?.icon}</span>
          <span>{selectedTemplate?.name}</span>
        </div>
      </div>

      <div className="review-section">
        <h4>Details</h4>
        <div className="review-details">
          <div><strong>Name:</strong> {strategyDetails.name || 'Unnamed Strategy'}</div>
          <div><strong>Description:</strong> {strategyDetails.description || 'No description'}</div>
          <div><strong>Hypothesis:</strong> {strategyDetails.hypothesis || 'No hypothesis defined'}</div>
        </div>
      </div>

      <div className="review-section">
        <h4>Parameters</h4>
        <div className="parameters-review">
          {Object.entries(parameters).map(([key, value]) => (
            <div key={key} className="param-item">
              <span className="param-key">{key.replace(/_/g, ' ')}</span>
              <span className="param-value">{value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="next-steps">
        <h4>What's Next?</h4>
        <ul>
          <li>📝 Strategy will be created in <strong>Draft</strong> status</li>
          <li>💻 Open in Strategy Editor to write or refine code</li>
          <li>🔬 Run backtests to validate your hypothesis</li>
          <li>📊 Paper trade before going live</li>
        </ul>
      </div>
    </div>
  );

  return (
    <div className="strategy-wizard-overlay">
      <div className="strategy-wizard">
        <div className="wizard-header">
          <h2>✨ Create New Strategy</h2>
          <button className="close-btn" onClick={onCancel}>×</button>
        </div>

        {renderStepIndicator()}

        <div className="wizard-body">
          {step === 'type' && renderTypeStep()}
          {step === 'details' && renderDetailsStep()}
          {step === 'parameters' && renderParametersStep()}
          {step === 'review' && renderReviewStep()}
        </div>

        <div className="wizard-footer">
          <button
            className="btn-secondary"
            onClick={step === 'type' ? onCancel : handleBack}
          >
            {step === 'type' ? 'Cancel' : '← Back'}
          </button>

          {step !== 'review' ? (
            <button
              className="btn-primary"
              onClick={handleNext}
              disabled={step === 'type' && !selectedType}
            >
              Next →
            </button>
          ) : (
            <button className="btn-primary create" onClick={handleComplete}>
              🚀 Create Strategy
            </button>
          )}
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .strategy-wizard-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(4px);
  }

  .strategy-wizard {
    background: linear-gradient(180deg, #111118 0%, #0d0d12 100%);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 1rem;
    width: 90%;
    max-width: 800px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
  }

  .wizard-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .wizard-header h2 {
    margin: 0;
    font-size: 1.25rem;
    color: #e5e5e5;
  }

  .close-btn {
    background: none;
    border: none;
    color: #6b7280;
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
  }

  .close-btn:hover {
    color: #e5e5e5;
    background: rgba(255, 255, 255, 0.05);
  }

  .step-indicator {
    display: flex;
    justify-content: center;
    gap: 2rem;
    padding: 1.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .step {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #6b7280;
  }

  .step.active {
    color: #10b981;
  }

  .step.completed {
    color: #10b981;
  }

  .step-number {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.05);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.875rem;
    font-weight: 600;
  }

  .step.active .step-number {
    background: #10b981;
    color: white;
  }

  .step.completed .step-number {
    background: rgba(16, 185, 129, 0.2);
    color: #10b981;
  }

  .step-label {
    font-size: 0.875rem;
    font-weight: 500;
  }

  .wizard-body {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
  }

  .wizard-content h3 {
    margin: 0 0 0.5rem;
    font-size: 1.1rem;
    color: #e5e5e5;
  }

  .subtitle {
    color: #6b7280;
    margin: 0 0 1.5rem;
    font-size: 0.9rem;
  }

  .template-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .template-card {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.75rem;
    padding: 1.25rem;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: center;
  }

  .template-card:hover {
    border-color: rgba(16, 185, 129, 0.3);
    background: rgba(255, 255, 255, 0.04);
  }

  .template-card.selected {
    border-color: #10b981;
    background: rgba(16, 185, 129, 0.1);
  }

  .template-icon {
    font-size: 2rem;
    display: block;
    margin-bottom: 0.75rem;
  }

  .template-card h4 {
    margin: 0 0 0.5rem;
    font-size: 1rem;
    color: #e5e5e5;
  }

  .template-card p {
    margin: 0;
    font-size: 0.8rem;
    color: #9ca3af;
    line-height: 1.4;
  }

  .agent-suggestion {
    background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(16, 185, 129, 0.05) 100%);
    border: 1px solid rgba(16, 185, 129, 0.2);
    border-radius: 0.75rem;
    padding: 1rem;
    margin-top: 1rem;
  }

  .suggestion-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    font-weight: 600;
    color: #10b981;
    font-size: 0.9rem;
  }

  .agent-icon {
    font-size: 1rem;
  }

  .agent-suggestion p {
    margin: 0;
    color: #9ca3af;
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .form-group {
    margin-bottom: 1.25rem;
  }

  .form-group label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 500;
    color: #e5e5e5;
    font-size: 0.9rem;
  }

  .form-group input,
  .form-group textarea {
    width: 100%;
    padding: 0.75rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.5rem;
    color: #e5e5e5;
    font-size: 0.9rem;
    transition: border-color 0.15s ease;
  }

  .form-group input:focus,
  .form-group textarea:focus {
    outline: none;
    border-color: #10b981;
  }

  .form-hint {
    display: block;
    margin-top: 0.5rem;
    font-size: 0.8rem;
    color: #6b7280;
  }

  .parameters-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1rem;
  }

  .review-section {
    margin-bottom: 1.5rem;
  }

  .review-section h4 {
    margin: 0 0 0.75rem;
    font-size: 0.9rem;
    color: #9ca3af;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .review-value {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1rem;
    color: #e5e5e5;
  }

  .review-icon {
    font-size: 1.25rem;
  }

  .review-details {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    font-size: 0.9rem;
    color: #e5e5e5;
  }

  .review-details strong {
    color: #9ca3af;
    font-weight: 500;
  }

  .parameters-review {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.5rem;
  }

  .param-item {
    display: flex;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 0.375rem;
  }

  .param-key {
    color: #9ca3af;
    font-size: 0.85rem;
    text-transform: capitalize;
  }

  .param-value {
    color: #e5e5e5;
    font-weight: 500;
    font-size: 0.85rem;
  }

  .next-steps {
    background: rgba(255, 255, 255, 0.02);
    border-radius: 0.75rem;
    padding: 1rem;
    margin-top: 1rem;
  }

  .next-steps h4 {
    margin: 0 0 0.75rem;
    font-size: 0.9rem;
    color: #e5e5e5;
  }

  .next-steps ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .next-steps li {
    padding: 0.5rem 0;
    color: #9ca3af;
    font-size: 0.875rem;
  }

  .wizard-footer {
    display: flex;
    justify-content: space-between;
    padding: 1.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .btn-secondary,
  .btn-primary {
    padding: 0.75rem 1.5rem;
    border-radius: 0.5rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    font-size: 0.9rem;
  }

  .btn-secondary {
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: #9ca3af;
  }

  .btn-secondary:hover {
    border-color: rgba(255, 255, 255, 0.3);
    color: #e5e5e5;
  }

  .btn-primary {
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    border: none;
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary.create {
    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
    box-shadow: 0 4px 12px rgba(245, 158, 11, 0.2);
  }
`;

export default StrategyCreationWizard;
