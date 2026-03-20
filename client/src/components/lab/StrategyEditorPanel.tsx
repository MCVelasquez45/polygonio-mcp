import { useState, useEffect, type Dispatch, type SetStateAction } from 'react';
import { apiClient } from '../../api';
import { toast } from 'sonner';

type Props = {
  strategyId?: string;
  onRunBacktest?: () => void;
  onSave?: () => void;
  onBack?: () => void;
  onCompile?: (extractionData: Record<string, unknown>) => void;
};

const RESERVED_PARAM_KEYS = new Set([
  'source', 'strategy_template_type', 'hypothesis', 'transcript',
  'parameter_definitions', 'entry_rules', 'exit_rules', 'risk_management'
]);

const STATUS_DISPLAY: Record<string, { label: string; color: string }> = {
  development: { label: 'Draft', color: '#6b7280' },
  validated: { label: 'Validated', color: '#10b981' },
  failed: { label: 'Failed', color: '#ef4444' },
};

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

function formatLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\./g, ' > ')
    .replace(/\b\w/g, l => l.toUpperCase());
}

export function StrategyEditorPanel({ strategyId, onRunBacktest, onSave, onBack, onCompile }: Props) {
  const [strategy, setStrategy] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [parameters, setParameters] = useState<Record<string, unknown>>({});
  const [paramDefs, setParamDefs] = useState<Record<string, string>>({});
  const [entryRules, setEntryRules] = useState<string[]>([]);
  const [exitRules, setExitRules] = useState<string[]>([]);
  const [riskRules, setRiskRules] = useState<string[]>([]);
  const [newParamKey, setNewParamKey] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!strategyId) {
      setLoading(false);
      return;
    }
    fetchStrategy();
  }, [strategyId]);

  const fetchStrategy = async () => {
    try {
      setLoading(true);
      const res = await apiClient.get(`/api/lab/strategy/${strategyId}`);
      const data = res.data;
      setStrategy(data);

      setName((data.name as string) ?? '');
      setDescription((data.description as string) ?? '');

      const sc = data.screenerConfig as Record<string, unknown> | undefined;
      const params = (sc?.params ?? {}) as Record<string, unknown>;
      setHypothesis(typeof params.hypothesis === 'string' ? params.hypothesis : '');
      setParamDefs(
        params.parameter_definitions && typeof params.parameter_definitions === 'object' && !Array.isArray(params.parameter_definitions)
          ? { ...(params.parameter_definitions as Record<string, string>) }
          : {}
      );
      setEntryRules(Array.isArray(params.entry_rules) ? [...params.entry_rules] : []);
      setExitRules(Array.isArray(params.exit_rules) ? [...params.exit_rules] : []);
      setRiskRules(Array.isArray(params.risk_management) ? [...params.risk_management] : []);

      const tunable: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(params)) {
        if (!RESERVED_PARAM_KEYS.has(k)) tunable[k] = v;
      }
      setParameters(tunable);
      setDirty(false);
    } catch (err: unknown) {
      console.error('[EDITOR] Failed to fetch strategy:', err);
      toast.error('Failed to load strategy');
    } finally {
      setLoading(false);
    }
  };

  const markDirty = () => { if (!dirty) setDirty(true); };

  const updateParam = (key: string, raw: string, original: unknown) => {
    let parsed: unknown = raw;
    if (typeof original === 'number') {
      const n = parseFloat(raw);
      parsed = isNaN(n) ? raw : n;
    } else if (typeof original === 'boolean') {
      parsed = raw === 'true';
    }
    setParameters(prev => ({ ...prev, [key]: parsed }));
    markDirty();
  };

  const deleteParam = (key: string) => {
    setParameters(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setParamDefs(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    markDirty();
  };

  const addParameter = () => {
    const key = newParamKey.trim().replace(/\s+/g, '_').toLowerCase();
    if (!key) return;
    if (key in parameters) {
      toast.error(`Parameter "${key}" already exists`);
      return;
    }
    setParameters(prev => ({ ...prev, [key]: '' }));
    setNewParamKey('');
    markDirty();
  };

  const updateRule = (
    setter: Dispatch<SetStateAction<string[]>>,
    index: number,
    value: string
  ) => {
    setter(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    markDirty();
  };

  const addRule = (setter: Dispatch<SetStateAction<string[]>>) => {
    setter(prev => [...prev, '']);
    markDirty();
  };

  const removeRule = (
    setter: Dispatch<SetStateAction<string[]>>,
    index: number
  ) => {
    setter(prev => prev.filter((_, i) => i !== index));
    markDirty();
  };

  const toggleSection = (section: string) => {
    setCollapsed(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const handleSave = async () => {
    if (!strategyId || saving) return;
    setSaving(true);

    try {
      const sc = (strategy?.screenerConfig ?? {}) as Record<string, unknown>;
      const existingParams = (sc.params ?? {}) as Record<string, unknown>;

      const updatedParams: Record<string, unknown> = {
        source: existingParams.source ?? 'strategy_creation_wizard',
        strategy_template_type: existingParams.strategy_template_type ?? 'custom',
        transcript: existingParams.transcript,
        hypothesis,
        parameter_definitions: paramDefs,
        entry_rules: entryRules.filter(r => r.trim()),
        exit_rules: exitRules.filter(r => r.trim()),
        risk_management: riskRules.filter(r => r.trim()),
        ...parameters,
      };

      const payload: Record<string, unknown> = {
        name,
        description,
        screenerConfig: { ...sc, params: updatedParams },
      };

      await apiClient.patch(`/api/lab/strategy/${strategyId}`, payload);

      setStrategy(prev => ({
        ...prev,
        name,
        description,
        screenerConfig: { ...sc, params: updatedParams },
      }));

      setDirty(false);
      toast.success('Strategy saved');
      onSave?.();
    } catch (err: unknown) {
      const msg = (err as Record<string, Record<string, Record<string, string>>>)?.response?.data?.error
        ?? (err as Error)?.message
        ?? 'Unknown error';
      toast.error(`Save failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const strategyType = (strategy?.strategyType as string) ?? 'custom';
  const strategyStatus = STATUS_DISPLAY[(strategy?.status as string) ?? 'development'] ?? STATUS_DISPLAY.development;

  const renderRulesSection = (
    title: string,
    id: string,
    rules: string[],
    setter: (value: string[] | ((prev: string[]) => string[])) => void
  ) => (
    <div className="sed-section">
      <div className="sed-section-header" onClick={() => toggleSection(id)}>
        <span className="sed-section-arrow">{collapsed[id] ? '\u25B8' : '\u25BE'}</span>
        <h3>{title}</h3>
        <span className="sed-section-count">{rules.length}</span>
      </div>
      {!collapsed[id] && (
        <div className="sed-section-body">
          {rules.map((rule, i) => (
            <div key={`${id}-${i}`} className="sed-rule-row">
              <span className="sed-rule-number">{i + 1}.</span>
              <input
                className="sed-rule-input"
                value={rule}
                onChange={e => updateRule(setter, i, e.target.value)}
                placeholder={`${title.replace(/s$/, '')}...`}
              />
              <button
                className="sed-rule-delete"
                onClick={() => removeRule(setter, i)}
                title="Remove rule"
              >
                &#215;
              </button>
            </div>
          ))}
          {rules.length === 0 && (
            <div className="sed-empty-section">No {title.toLowerCase()} defined yet.</div>
          )}
          <button
            className="sed-btn sed-btn-small sed-add-rule-btn"
            onClick={() => addRule(setter)}
          >
            + Add Rule
          </button>
        </div>
      )}
    </div>
  );

  const buildRulesText = () => {
    const parts: string[] = [];
    if (entryRules.length) parts.push(entryRules.map(r => `Buy when ${r}`).join('. '));
    if (exitRules.length) parts.push(exitRules.map(r => `Exit when ${r}`).join('. '));
    if (riskRules.length) parts.push(riskRules.join('. '));
    return parts.join('. ') + '.';
  };

  if (loading) {
    return (
      <div className="sed-panel">
        <div className="sed-loading">
          <div className="sed-spinner" />
          <p>Loading strategy...</p>
        </div>
        <style>{editorStyles}</style>
      </div>
    );
  }

  if (!strategy) {
    return (
      <div className="sed-panel">
        <div className="sed-empty">
          <p>Strategy not found</p>
          {onBack && (
            <button className="sed-btn sed-btn-secondary" onClick={onBack}>
              Back to Strategies
            </button>
          )}
        </div>
        <style>{editorStyles}</style>
      </div>
    );
  }

  return (
    <div className="sed-panel">
      {/* Toolbar */}
      <div className="sed-toolbar">
        <div className="sed-toolbar-left">
          {onBack && (
            <button className="sed-back-btn" onClick={onBack} title="Back to strategies">
              &#8592;
            </button>
          )}
          <input
            className="sed-name-input"
            value={name}
            onChange={e => { setName(e.target.value); markDirty(); }}
            placeholder="Strategy name..."
          />
          <span
            className="sed-status-badge"
            style={{ backgroundColor: `${strategyStatus.color}20`, color: strategyStatus.color }}
          >
            {strategyStatus.label}
          </span>
          <span className="sed-type-badge">{strategyType}</span>
        </div>
        <div className="sed-toolbar-right">
          {dirty && <span className="sed-unsaved-dot" title="Unsaved changes" />}
          <button
            className="sed-btn sed-btn-secondary"
            onClick={handleSave}
            disabled={saving || !dirty}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button className="sed-btn sed-btn-primary" onClick={onRunBacktest}>
            Run Backtest
          </button>
          {onCompile && (entryRules.length > 0 || exitRules.length > 0) && (
            <button
              className="sed-btn sed-btn-secondary"
              onClick={() => {
                const sc = strategy?.screenerConfig as Record<string, unknown> | undefined;
                const params = (sc?.params ?? {}) as Record<string, unknown>;
                onCompile({
                  name,
                  description,
                  hypothesis,
                  strategyId,
                  entry_rules: entryRules,
                  exit_rules: exitRules,
                  risk_management: riskRules,
                  trading_method: params.trading_method,
                  underlying_ticker: params.underlying_ticker ?? params.underlying_symbol,
                  contract_selection: params.contract_selection,
                  regime_config: params.regime_config,
                  time_rules: params.time_rules,
                  parameters: { ...parameters },
                  parameter_definitions: { ...paramDefs },
                });
              }}
              title="Compile strategy with all extraction data into AST, DSL, and RuntimeSpec"
            >
              Compile
            </button>
          )}
        </div>
      </div>

      {/* Metadata Row */}
      {(() => {
        const sc = strategy?.screenerConfig as Record<string, unknown> | undefined;
        const params = (sc?.params ?? {}) as Record<string, unknown>;
        const tm = params.trading_method as string | undefined;
        const ticker = (params.underlying_ticker || params.underlying_symbol || '') as string;
        if (!tm && !ticker) return null;
        return (
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', padding: '0.5rem 1rem', borderBottom: '1px solid #333', fontSize: '0.8rem' }}>
            {tm && <span style={{ textTransform: 'capitalize', padding: '2px 10px', borderRadius: '4px', background: tm === 'options' ? 'rgba(139,92,246,0.15)' : tm === 'futures' ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.15)', color: tm === 'options' ? '#a78bfa' : tm === 'futures' ? '#fbbf24' : '#6ee7b7' }}>{tm}</span>}
            {ticker && <span style={{ color: '#9ca3af' }}>Underlying: <strong style={{ color: '#e5e5e5' }}>{ticker}</strong></span>}
          </div>
        );
      })()}

      {/* Content */}
      <div className="sed-content">
        {/* Overview Section */}
        <div className="sed-section">
          <div className="sed-section-header" onClick={() => toggleSection('overview')}>
            <span className="sed-section-arrow">{collapsed.overview ? '\u25B8' : '\u25BE'}</span>
            <h3>Overview</h3>
          </div>
          {!collapsed.overview && (
            <div className="sed-section-body">
              <div className="sed-field">
                <label>Description</label>
                <textarea
                  value={description}
                  onChange={e => { setDescription(e.target.value); markDirty(); }}
                  placeholder="Describe what this strategy does..."
                  rows={3}
                />
              </div>
              <div className="sed-field">
                <label>Trading Hypothesis</label>
                <textarea
                  value={hypothesis}
                  onChange={e => { setHypothesis(e.target.value); markDirty(); }}
                  placeholder="The core market belief this strategy relies on..."
                  rows={3}
                />
              </div>
            </div>
          )}
        </div>

        {/* Parameters Section */}
        <div className="sed-section">
          <div className="sed-section-header" onClick={() => toggleSection('params')}>
            <span className="sed-section-arrow">{collapsed.params ? '\u25B8' : '\u25BE'}</span>
            <h3>Parameters</h3>
            <span className="sed-section-count">{Object.keys(parameters).length}</span>
          </div>
          {!collapsed.params && (
            <div className="sed-section-body">
              <div className="sed-params-grid">
                {Object.entries(parameters).map(([key, value]) => (
                  <div key={key} className="sed-param-card">
                    <div className="sed-param-header">
                      <span className="sed-param-key">{formatLabel(key)}</span>
                      <button
                        className="sed-param-delete"
                        onClick={() => deleteParam(key)}
                        title="Remove parameter"
                      >
                        &#215;
                      </button>
                    </div>
                    {typeof value === 'boolean' ? (
                      <select
                        className="sed-param-input"
                        value={String(value)}
                        onChange={e => updateParam(key, e.target.value, value)}
                      >
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : (
                      <input
                        className="sed-param-input"
                        type={typeof value === 'number' ? 'number' : 'text'}
                        value={displayValue(value)}
                        onChange={e => updateParam(key, e.target.value, value)}
                        step={typeof value === 'number' && Math.abs(value) < 1 ? 0.01 : undefined}
                      />
                    )}
                    {paramDefs[key] && (
                      <div className="sed-param-def">{paramDefs[key]}</div>
                    )}
                  </div>
                ))}
              </div>

              {Object.keys(parameters).length === 0 && (
                <div className="sed-empty-section">No parameters defined yet.</div>
              )}

              <div className="sed-add-row">
                <input
                  className="sed-add-input"
                  placeholder="New parameter name..."
                  value={newParamKey}
                  onChange={e => setNewParamKey(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addParameter(); }}
                />
                <button
                  className="sed-btn sed-btn-small"
                  onClick={addParameter}
                  disabled={!newParamKey.trim()}
                >
                  + Add
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Entry Rules */}
        {renderRulesSection('Entry Rules', 'entry', entryRules, setEntryRules)}

        {/* Exit Rules */}
        {renderRulesSection('Exit Rules', 'exit', exitRules, setExitRules)}

        {/* Risk Management */}
        {renderRulesSection('Risk Management', 'risk', riskRules, setRiskRules)}

        {/* Futures Config (read-only display if present) */}
        {strategyType === 'futures' && strategy.futuresConfig && (
          <div className="sed-section">
            <div className="sed-section-header" onClick={() => toggleSection('futures')}>
              <span className="sed-section-arrow">{collapsed.futures ? '\u25B8' : '\u25BE'}</span>
              <h3>Futures Configuration</h3>
            </div>
            {!collapsed.futures && (
              <div className="sed-section-body">
                <div className="sed-params-grid">
                  {Object.entries(strategy.futuresConfig as Record<string, unknown>).map(([key, value]) => (
                    <div key={key} className="sed-param-card">
                      <span className="sed-param-key">{formatLabel(key)}</span>
                      <div className="sed-param-value-display">{displayValue(value)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <style>{editorStyles}</style>
    </div>
  );
}

const editorStyles = `
  .sed-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #0a0a0f;
    color: #e5e5e5;
  }

  .sed-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(255, 255, 255, 0.02);
    flex-shrink: 0;
  }

  .sed-toolbar-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex: 1;
    min-width: 0;
  }

  .sed-toolbar-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-shrink: 0;
  }

  .sed-back-btn {
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #9ca3af;
    width: 32px;
    height: 32px;
    border-radius: 0.375rem;
    cursor: pointer;
    font-size: 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
    flex-shrink: 0;
  }

  .sed-back-btn:hover {
    color: #e5e5e5;
    border-color: rgba(255, 255, 255, 0.25);
    background: rgba(255, 255, 255, 0.05);
  }

  .sed-name-input {
    background: transparent;
    border: 1px solid transparent;
    color: #e5e5e5;
    font-size: 1.1rem;
    font-weight: 600;
    padding: 0.375rem 0.5rem;
    border-radius: 0.375rem;
    min-width: 180px;
    max-width: 400px;
    transition: border-color 0.15s;
  }

  .sed-name-input:hover {
    border-color: rgba(255, 255, 255, 0.1);
  }

  .sed-name-input:focus {
    outline: none;
    border-color: #10b981;
  }

  .sed-status-badge {
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
  }

  .sed-type-badge {
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.7rem;
    font-weight: 500;
    color: #9ca3af;
    background: rgba(255, 255, 255, 0.05);
    white-space: nowrap;
  }

  .sed-unsaved-dot {
    width: 8px;
    height: 8px;
    background: #f59e0b;
    border-radius: 50%;
    animation: sed-pulse-unsaved 2s infinite;
  }

  @keyframes sed-pulse-unsaved {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .sed-btn {
    padding: 0.5rem 1rem;
    border-radius: 0.5rem;
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    border: none;
    white-space: nowrap;
  }

  .sed-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .sed-btn-primary {
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    color: white;
  }

  .sed-btn-primary:hover:not(:disabled) {
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
    transform: translateY(-1px);
  }

  .sed-btn-secondary {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.15) !important;
    color: #e5e5e5;
  }

  .sed-btn-secondary:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.25) !important;
  }

  .sed-btn-small {
    padding: 0.375rem 0.75rem;
    font-size: 0.8rem;
    background: rgba(16, 185, 129, 0.1);
    border: 1px solid rgba(16, 185, 129, 0.3) !important;
    color: #10b981;
    border-radius: 0.375rem;
  }

  .sed-btn-small:hover:not(:disabled) {
    background: rgba(16, 185, 129, 0.2);
  }

  .sed-content {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .sed-section {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 0.75rem;
    overflow: hidden;
  }

  .sed-section-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
    cursor: pointer;
    user-select: none;
    transition: background 0.15s;
  }

  .sed-section-header:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .sed-section-header h3 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    flex: 1;
  }

  .sed-section-arrow {
    color: #6b7280;
    font-size: 0.85rem;
    width: 16px;
    text-align: center;
  }

  .sed-section-count {
    background: rgba(255, 255, 255, 0.08);
    padding: 0.125rem 0.5rem;
    border-radius: 1rem;
    font-size: 0.75rem;
    color: #9ca3af;
  }

  .sed-section-body {
    padding: 0 1.25rem 1.25rem;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
    padding-top: 1rem;
  }

  .sed-field {
    margin-bottom: 1rem;
  }

  .sed-field:last-child {
    margin-bottom: 0;
  }

  .sed-field label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 500;
    color: #9ca3af;
    font-size: 0.85rem;
  }

  .sed-field textarea,
  .sed-field input[type="text"] {
    width: 100%;
    padding: 0.75rem;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.5rem;
    color: #e5e5e5;
    font-size: 0.9rem;
    line-height: 1.5;
    resize: vertical;
    transition: border-color 0.15s;
    font-family: inherit;
  }

  .sed-field textarea:focus,
  .sed-field input[type="text"]:focus {
    outline: none;
    border-color: #10b981;
  }

  /* Parameters grid */
  .sed-params-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .sed-param-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 0.5rem;
    padding: 0.75rem;
    transition: border-color 0.15s;
  }

  .sed-param-card:hover {
    border-color: rgba(255, 255, 255, 0.12);
  }

  .sed-param-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .sed-param-key {
    font-size: 0.8rem;
    color: #9ca3af;
    font-weight: 500;
  }

  .sed-param-delete {
    background: none;
    border: none;
    color: #4b5563;
    cursor: pointer;
    font-size: 1.1rem;
    padding: 0 0.25rem;
    border-radius: 0.25rem;
    transition: color 0.15s;
    line-height: 1;
  }

  .sed-param-delete:hover {
    color: #ef4444;
  }

  .sed-param-input,
  select.sed-param-input {
    width: 100%;
    padding: 0.5rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.375rem;
    color: #e5e5e5;
    font-size: 0.9rem;
    font-weight: 500;
    transition: border-color 0.15s;
  }

  .sed-param-input:focus,
  select.sed-param-input:focus {
    outline: none;
    border-color: #10b981;
  }

  .sed-param-def {
    margin-top: 0.5rem;
    font-size: 0.75rem;
    color: #6b7280;
    line-height: 1.4;
    font-style: italic;
  }

  .sed-param-value-display {
    font-size: 0.9rem;
    color: #e5e5e5;
    font-weight: 500;
    margin-top: 0.5rem;
  }

  /* Add parameter row */
  .sed-add-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .sed-add-input {
    flex: 1;
    padding: 0.5rem 0.75rem;
    background: rgba(255, 255, 255, 0.03);
    border: 1px dashed rgba(255, 255, 255, 0.1);
    border-radius: 0.375rem;
    color: #e5e5e5;
    font-size: 0.85rem;
    transition: border-color 0.15s;
  }

  .sed-add-input::placeholder {
    color: #4b5563;
  }

  .sed-add-input:focus {
    outline: none;
    border-color: #10b981;
    border-style: solid;
  }

  /* Rules */
  .sed-rule-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .sed-rule-number {
    color: #6b7280;
    font-size: 0.8rem;
    min-width: 24px;
    text-align: right;
    flex-shrink: 0;
  }

  .sed-rule-input {
    flex: 1;
    padding: 0.5rem 0.75rem;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.375rem;
    color: #e5e5e5;
    font-size: 0.85rem;
    transition: border-color 0.15s;
  }

  .sed-rule-input:focus {
    outline: none;
    border-color: #10b981;
  }

  .sed-rule-delete {
    background: none;
    border: none;
    color: #4b5563;
    cursor: pointer;
    font-size: 1.1rem;
    padding: 0.25rem;
    border-radius: 0.25rem;
    transition: color 0.15s;
    flex-shrink: 0;
    line-height: 1;
  }

  .sed-rule-delete:hover {
    color: #ef4444;
  }

  .sed-add-rule-btn {
    margin-top: 0.5rem;
  }

  .sed-empty-section {
    color: #4b5563;
    font-size: 0.85rem;
    padding: 1rem 0;
    text-align: center;
  }

  /* Loading & Empty states */
  .sed-loading, .sed-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 300px;
    color: #6b7280;
    gap: 1rem;
  }

  .sed-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid rgba(16, 185, 129, 0.2);
    border-top-color: #10b981;
    border-radius: 50%;
    animation: sed-spin 1s linear infinite;
  }

  @keyframes sed-spin {
    to { transform: rotate(360deg); }
  }
`;

export default StrategyEditorPanel;
