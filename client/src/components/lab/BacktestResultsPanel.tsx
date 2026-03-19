import { Fragment, useEffect, useRef, useState } from 'react';
import { createChart, ColorType, LineStyle, LineSeries } from 'lightweight-charts';
import { apiClient, futuresApi } from '../../api';
import type { FuturesBacktestResult, AiSuggestion, StrategyVersion, StressTestScenarioResult } from '../../types/futures';
import { buildBacktestChartSeries } from './backtestChartData';

type Metrics = {
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  trades: number;
  profitFactor: number;
};

type Props = {
  backtestId?: string;
  strategyId?: string;
  onDeployToPaper?: () => void;
  onClose?: () => void;
  onApplySuggestions?: (suggestions: AiSuggestion[]) => void;
  onIterateAndRerun?: (suggestions: AiSuggestion[]) => void;
};

export function BacktestResultsPanel({ backtestId, strategyId, onDeployToPaper, onClose, onApplySuggestions, onIterateAndRerun }: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion[]>([]);
  const [versions, setVersions] = useState<StrategyVersion[]>([]);
  const [backtest, setBacktest] = useState<FuturesBacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());
  const [stressResults, setStressResults] = useState<StressTestScenarioResult[]>([]);
  const [isStressTesting, setIsStressTesting] = useState(false);
  const [compareVersionId, setCompareVersionId] = useState<string | null>(null);
  const [isReverting, setIsReverting] = useState(false);
  const [metrics, setMetrics] = useState<Metrics>({
    totalReturn: 48.2,
    sharpeRatio: 1.42,
    maxDrawdown: -15.8,
    winRate: 58.2,
    trades: 142,
    profitFactor: 1.65
  });

  useEffect(() => {
    if (!backtestId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    futuresApi
      .getFuturesBacktest(backtestId)
      .then(result => {
        if (cancelled) return;
        setBacktest(result);
        setMetrics({
          totalReturn: result.metrics.totalReturnPct * 100,
          sharpeRatio: result.metrics.sharpeRatio,
          maxDrawdown: -Math.abs(result.metrics.maxDrawdownPct * 100),
          winRate: result.metrics.winRatePct * 100,
          trades: result.metrics.tradeCount,
          profitFactor: result.metrics.profitFactor ?? Math.max(0, 1 + result.metrics.totalReturnPct * 2),
        });
      })
      .catch(error => {
        if (cancelled) return;
        setLoadError(error?.message ?? 'Failed to load futures backtest');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [backtestId]);

  // Fetch strategy versions for comparison
  useEffect(() => {
    const sid = strategyId ?? backtest?.strategyId;
    if (!sid) return;
    let cancelled = false;
    futuresApi
      .getStrategyVersions(sid)
      .then(v => { if (!cancelled) setVersions(v); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [strategyId, backtest?.strategyId, backtestId]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 350,
    });

    const strategySeries = chart.addSeries(LineSeries, {
      color: '#10b981',
      lineWidth: 2,
      title: 'Strategy',
    });

    const benchmarkSeries = chart.addSeries(LineSeries, {
      color: '#3b82f6',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      title: 'Benchmark (SPY)',
    });

    const { strategy, benchmark } = buildBacktestChartSeries(backtest?.equityCurve);
    strategySeries.setData(strategy);
    benchmarkSeries.setData(benchmark);

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [backtest]);

  // Auto-select all suggestions when they arrive
  useEffect(() => {
    setSelectedSuggestions(new Set(aiSuggestions.map((_, i) => i)));
  }, [aiSuggestions]);

  const toggleSuggestion = (index: number) => {
    setSelectedSuggestions(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const getSelectedSuggestions = (): AiSuggestion[] =>
    aiSuggestions.filter((_, i) => selectedSuggestions.has(i));

  const handleRevert = async (version: StrategyVersion) => {
    const sid = strategyId ?? backtest?.strategyId;
    if (!sid) return;
    if (!confirm(`Revert strategy to ${version.versionLabel}? This will overwrite current parameters.`)) return;
    setIsReverting(true);
    try {
      await futuresApi.revertToVersion(sid, version.versionNumber);
      // Refresh versions
      const v = await futuresApi.getStrategyVersions(sid);
      setVersions(v);
      alert(`Reverted to ${version.versionLabel}`);
    } catch (error) {
      console.error('Revert error:', error);
      alert('Failed to revert.');
    } finally {
      setIsReverting(false);
    }
  };

  /** Compute param diff between two version snapshots */
  const computeParamDiff = (currentSnap: Record<string, any>, prevSnap: Record<string, any>) => {
    const curParams = currentSnap?.screenerConfig?.params ?? {};
    const prevParams = prevSnap?.screenerConfig?.params ?? {};
    const skipKeys = new Set(['source', 'strategy_template_type', 'hypothesis', 'transcript', 'parameter_definitions']);
    const allKeys = new Set([...Object.keys(curParams), ...Object.keys(prevParams)]);
    const diffs: Array<{ key: string; prev: unknown; cur: unknown; type: 'added' | 'removed' | 'changed' }> = [];

    for (const key of allKeys) {
      if (skipKeys.has(key)) continue;
      const prev = prevParams[key];
      const cur = curParams[key];
      const prevStr = JSON.stringify(prev);
      const curStr = JSON.stringify(cur);
      if (prevStr === curStr) continue;
      if (prev === undefined) diffs.push({ key, prev, cur, type: 'added' });
      else if (cur === undefined) diffs.push({ key, prev, cur, type: 'removed' });
      else diffs.push({ key, prev, cur, type: 'changed' });
    }
    return diffs;
  };

  const runStressTest = async () => {
    const sid = strategyId ?? backtest?.strategyId;
    if (!sid || !backtest) return;
    setIsStressTesting(true);
    try {
      const response = await futuresApi.runStressTest({
        strategyId: sid,
        strategyName: backtest.strategyName,
        symbol: backtest.symbol,
        startDate: backtest.config.startDate,
        endDate: backtest.config.endDate,
        initialCapital: backtest.config.initialCapital,
        slippageBps: backtest.config.slippageBps,
        feePerContract: backtest.config.feePerContract,
      });
      setStressResults(response.scenarios);
    } catch (error) {
      console.error('Stress test error:', error);
      alert('Failed to run stress test.');
    } finally {
      setIsStressTesting(false);
    }
  };

  const runAiAnalysis = async () => {
    const selectedStrategyId = strategyId ?? backtest?.strategyId;
    if (!selectedStrategyId) return;
    setIsAnalyzing(true);
    try {
      const response = await apiClient.post(`/api/lab/strategy/${selectedStrategyId}/ai-review`, {
        backtestResults: backtest?.metrics ?? metrics,
        stressTestResults: stressResults.length > 0 ? stressResults : undefined,
      });
      setAiAnalysis(response.data?.analysis ?? null);
      if (Array.isArray(response.data?.suggestions)) {
        setAiSuggestions(response.data.suggestions);
      }
      // Refresh versions after review (may have been saved to latest version)
      futuresApi.getStrategyVersions(selectedStrategyId).then(setVersions).catch(() => {});
    } catch (error) {
      console.error('AI Review error:', error);
      alert('Failed to run AI analysis.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="backtest-results-panel">
      <div className="panel-header">
        <div className="header-title">
          <h2>Backtest Results</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="subtitle">ID: {backtest?._id ?? backtestId ?? 'BT-20260116-001'}</span>
            {backtest && (
              <span className={`data-source-badge ${backtest.provider === 'polygon' ? 'badge-polygon' : backtest.provider === 'databento' ? 'badge-databento' : 'badge-synthetic'}`}>
                {backtest.provider === 'polygon' ? 'Polygon.io' : backtest.provider === 'databento' ? 'Databento' : 'Synthetic'}
              </span>
            )}
          </div>
        </div>
        <div className="header-actions">
          <button className="btn-secondary" onClick={onClose}>Close</button>
          <button className="btn-primary" onClick={onDeployToPaper}>Deploy to Paper</button>
        </div>
      </div>

      {backtest?.diagnostics?.usedFallbackData && (
        <div className="synthetic-warning">
          <span className="bullet">&#9888;</span>
          <p><strong>Synthetic data:</strong> This backtest used deterministic generated data. Results are illustrative only and will be identical across runs with the same parameters. Connect a real data source for meaningful results.</p>
        </div>
      )}

      <div className="metrics-grid">
        <div className="metric-card">
          <label>Total Return</label>
          <span className={`value ${metrics.totalReturn >= 0 ? 'positive' : 'negative'}`}>
            {metrics.totalReturn >= 0 ? '+' : ''}{metrics.totalReturn.toFixed(2)}%
          </span>
        </div>
        <div className="metric-card">
          <label>Sharpe Ratio</label>
          <span className="value">{metrics.sharpeRatio.toFixed(2)}</span>
        </div>
        <div className="metric-card">
          <label>Max Drawdown</label>
          <span className="value negative">{metrics.maxDrawdown.toFixed(2)}%</span>
        </div>
        <div className="metric-card">
          <label>Win Rate</label>
          <span className="value">{metrics.winRate.toFixed(1)}%</span>
        </div>
        <div className="metric-card">
          <label>Profit Factor</label>
          <span className="value">{(metrics.profitFactor == null || metrics.profitFactor >= 9999) ? '---' : metrics.profitFactor.toFixed(2)}</span>
        </div>
        <div className="metric-card">
          <label>Total Trades</label>
          <span className="value">{metrics.trades}</span>
        </div>
      </div>

      {loading && <div className="analysis-item suggestion"><span className="bullet">…</span><p>Loading futures backtest artifacts...</p></div>}
      {loadError && <div className="analysis-item warning"><span className="bullet">⚠</span><p>{loadError}</p></div>}

      <div className="chart-section">
        <h3>Equity Curve</h3>
        <div ref={chartContainerRef} className="chart-container" />
      </div>

      <div className="analysis-section">
        <div className="section-header">
          <span className="icon">🤖</span>
          <h3>Agent Analysis</h3>
          <button 
            className="btn-ai-action ml-auto" 
            onClick={runAiAnalysis}
            disabled={isAnalyzing}
          >
            {isAnalyzing ? '⚡ Analyzing...' : '✨ Run AI Review'}
          </button>
        </div>
        <div className="analysis-content">
          {aiAnalysis ? (
            <div className="prose prose-invert max-w-none text-sm text-gray-300 whitespace-pre-wrap">
              {aiAnalysis}
            </div>
          ) : (
            <>
              <div className="analysis-item positive">
                <span className="bullet">✓</span>
                <p>Strategy shows consistent alpha across multiple market regimes (Trending, Range-bound).</p>
              </div>
              <div className="analysis-item warning">
                <span className="bullet">⚠</span>
                <p>80% of profits generated in Q4 - suggests potential seasonality or overfitting to specific events.</p>
              </div>
              <div className="analysis-item suggestion">
                <span className="bullet">💡</span>
                <p><strong>Suggestion:</strong> Click 'Run AI Review' for a detailed, backtest-specific analysis from the financial agent.</p>
              </div>
            </>
          )}
        </div>
      </div>

      {aiSuggestions.length > 0 && (
        <div className="suggestions-section">
          <div className="section-header">
            <span className="icon">&#128161;</span>
            <h3>AI Suggestions</h3>
            <span className="suggestion-count">{selectedSuggestions.size}/{aiSuggestions.length} selected</span>
          </div>
          <div className="suggestions-list">
            {aiSuggestions.map((s, i) => (
              <div
                key={i}
                className={`suggestion-card ${selectedSuggestions.has(i) ? 'selected' : 'deselected'}`}
                onClick={() => toggleSuggestion(i)}
              >
                <div className="suggestion-header">
                  <input
                    type="checkbox"
                    className="suggestion-checkbox"
                    checked={selectedSuggestions.has(i)}
                    onChange={() => toggleSuggestion(i)}
                    onClick={e => e.stopPropagation()}
                  />
                  <span className={`suggestion-action ${s.action ?? 'modify'}`}>{s.action ?? 'modify'}</span>
                  <span className="suggestion-field">{s.field}</span>
                </div>
                <div className="suggestion-values">
                  {s.currentValue !== undefined && <span className="current-val">Current: {typeof s.currentValue === 'object' ? JSON.stringify(s.currentValue) : String(s.currentValue)}</span>}
                  <span className="suggested-val">Suggested: {typeof s.suggestedValue === 'object' ? JSON.stringify(s.suggestedValue) : String(s.suggestedValue)}</span>
                </div>
                <p className="suggestion-reasoning">{s.reasoning}</p>
              </div>
            ))}
          </div>
          <div className="suggestions-actions">
            {onApplySuggestions && (
              <button
                className="btn-secondary"
                disabled={selectedSuggestions.size === 0}
                onClick={() => onApplySuggestions(getSelectedSuggestions())}
              >
                Apply to Editor ({selectedSuggestions.size})
              </button>
            )}
            {onIterateAndRerun && (
              <button
                className="btn-primary"
                disabled={selectedSuggestions.size === 0}
                onClick={() => onIterateAndRerun(getSelectedSuggestions())}
              >
                Iterate &amp; Re-run ({selectedSuggestions.size})
              </button>
            )}
          </div>
        </div>
      )}

      {/* Stress Test Section */}
      <div className="stress-test-section">
        <div className="section-header">
          <span className="icon">&#9889;</span>
          <h3>Stress Test</h3>
          <button
            className="btn-ai-action ml-auto"
            onClick={runStressTest}
            disabled={isStressTesting || !backtest}
          >
            {isStressTesting ? 'Running...' : 'Run Stress Test'}
          </button>
        </div>
        {stressResults.length > 0 && (
          <div className="stress-results">
            <table className="version-table stress-table">
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th>Return</th>
                  <th>Sharpe</th>
                  <th>Max DD</th>
                  <th>Win Rate</th>
                  <th>PF</th>
                  <th>Trades</th>
                </tr>
              </thead>
              <tbody>
                {stressResults.map((s, i) => {
                  const isBaseline = s.scenario === 'Baseline';
                  const baseReturn = stressResults[0]?.metrics.totalReturnPct ?? 0;
                  const returnDelta = s.metrics.totalReturnPct - baseReturn;
                  return (
                    <tr key={i} className={`version-row ${isBaseline ? 'current-version' : ''}`} title={s.description}>
                      <td className="version-label">{s.scenario}</td>
                      <td className={s.metrics.totalReturnPct >= 0 ? 'positive' : 'negative'}>
                        {(s.metrics.totalReturnPct * 100).toFixed(2)}%
                        {!isBaseline && (
                          <span className={`stress-delta ${returnDelta >= 0 ? 'improved' : 'regressed'}`}>
                            {returnDelta >= 0 ? '+' : ''}{(returnDelta * 100).toFixed(2)}%
                          </span>
                        )}
                      </td>
                      <td>{s.metrics.sharpeRatio.toFixed(2)}</td>
                      <td className="negative">{(-Math.abs(s.metrics.maxDrawdownPct) * 100).toFixed(2)}%</td>
                      <td>{(s.metrics.winRatePct * 100).toFixed(1)}%</td>
                      <td>{(s.metrics.profitFactor == null || s.metrics.profitFactor >= 9999) ? '---' : s.metrics.profitFactor.toFixed(2)}</td>
                      <td>{s.metrics.tradeCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="stress-note">Scenarios apply parameter overrides to the current strategy configuration. Hover rows for descriptions.</p>
          </div>
        )}
      </div>

      {versions.length > 1 && (
        <div className="version-comparison-section">
          <div className="section-header">
            <span className="icon">&#128202;</span>
            <h3>Version History ({versions.length} versions)</h3>
          </div>
          <div className="version-table-wrapper">
            <table className="version-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Return</th>
                  <th>Sharpe</th>
                  <th>Max DD</th>
                  <th>Win Rate</th>
                  <th>Trades</th>
                </tr>
              </thead>
              <tbody>
                {versions.slice(0, 5).map(v => {
                  const isCurrent = v.backtestId === backtestId;
                  const isExpanded = expandedVersionId === v._id;
                  const currentVersion = versions.find(ver => ver.backtestId === backtestId);
                  const snap = v.snapshot as Record<string, any>;
                  const params = snap?.screenerConfig?.params ?? snap?.futuresConfig ?? {};
                  return (
                    <Fragment key={v._id}>
                      <tr
                        className={`version-row ${isCurrent ? 'current-version' : ''} ${isExpanded ? 'expanded' : ''}`}
                        onClick={() => setExpandedVersionId(isExpanded ? null : v._id)}
                      >
                        <td className="version-label">
                          <span className={`version-chevron ${isExpanded ? 'open' : ''}`}>&#9656;</span>
                          {v.versionLabel}
                        </td>
                        <td className={((v.backtestMetrics?.totalReturnPct ?? 0) >= 0) ? 'positive' : 'negative'}>
                          {((v.backtestMetrics?.totalReturnPct ?? 0) * 100).toFixed(2)}%
                        </td>
                        <td>{(v.backtestMetrics?.sharpeRatio ?? 0).toFixed(2)}</td>
                        <td className="negative">{((v.backtestMetrics?.maxDrawdownPct ?? 0) * -100).toFixed(2)}%</td>
                        <td>{((v.backtestMetrics?.winRatePct ?? 0) * 100).toFixed(1)}%</td>
                        <td>{v.backtestMetrics?.tradeCount ?? 0}</td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${v._id}-detail`} className="version-detail-row">
                          <td colSpan={6}>
                            <div className="version-detail">
                              {/* Metric deltas vs current */}
                              {currentVersion && currentVersion._id !== v._id && (() => {
                                const cm = currentVersion.backtestMetrics;
                                const vm = v.backtestMetrics;
                                if (!cm || !vm) return null;
                                const deltas = [
                                  { label: 'Return', cur: cm.totalReturnPct * 100, prev: vm.totalReturnPct * 100, suffix: '%', higher: true },
                                  { label: 'Sharpe', cur: cm.sharpeRatio, prev: vm.sharpeRatio, suffix: '', higher: true },
                                  { label: 'Max DD', cur: cm.maxDrawdownPct * -100, prev: vm.maxDrawdownPct * -100, suffix: '%', higher: false },
                                  { label: 'Win Rate', cur: cm.winRatePct * 100, prev: vm.winRatePct * 100, suffix: '%', higher: true },
                                ];
                                return (
                                  <div className="version-detail-section">
                                    <h4>Metric Changes vs Current ({currentVersion.versionLabel})</h4>
                                    <div className="delta-grid">
                                      {deltas.map(d => {
                                        const diff = d.cur - d.prev;
                                        const improved = d.higher ? diff > 0 : diff < 0;
                                        return (
                                          <div key={d.label} className="delta-item">
                                            <span className="delta-label">{d.label}</span>
                                            <span className="delta-values">
                                              {d.prev.toFixed(2)}{d.suffix}
                                              <span className="delta-arrow">&rarr;</span>
                                              {d.cur.toFixed(2)}{d.suffix}
                                            </span>
                                            <span className={`delta-diff ${improved ? 'improved' : 'regressed'}`}>
                                              {diff > 0 ? '+' : ''}{diff.toFixed(2)}{d.suffix}
                                            </span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* Param diff vs current version */}
                              {currentVersion && currentVersion._id !== v._id && (() => {
                                const curSnap = currentVersion.snapshot as Record<string, any>;
                                const diffs = computeParamDiff(curSnap, snap);
                                if (diffs.length === 0) return null;
                                return (
                                  <div className="version-detail-section">
                                    <h4>Parameter Changes ({v.versionLabel} &rarr; {currentVersion.versionLabel})</h4>
                                    <div className="params-grid">
                                      {diffs.map(d => (
                                        <div key={d.key} className={`param-row param-diff-${d.type}`}>
                                          <span className="param-key">{d.key}</span>
                                          <span className="param-diff-vals">
                                            {d.type === 'added' ? (
                                              <span className="diff-added">+ {typeof d.cur === 'object' ? JSON.stringify(d.cur) : String(d.cur)}</span>
                                            ) : d.type === 'removed' ? (
                                              <span className="diff-removed">- {typeof d.prev === 'object' ? JSON.stringify(d.prev) : String(d.prev)}</span>
                                            ) : (
                                              <>
                                                <span className="diff-old">{typeof d.prev === 'object' ? JSON.stringify(d.prev) : String(d.prev)}</span>
                                                <span className="delta-arrow">&rarr;</span>
                                                <span className="diff-new">{typeof d.cur === 'object' ? JSON.stringify(d.cur) : String(d.cur)}</span>
                                              </>
                                            )}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* Revert button */}
                              {currentVersion && currentVersion._id !== v._id && (
                                <div className="version-actions">
                                  <button
                                    className="btn-revert"
                                    onClick={(e) => { e.stopPropagation(); handleRevert(v); }}
                                    disabled={isReverting}
                                  >
                                    {isReverting ? 'Reverting...' : `Revert to ${v.versionLabel}`}
                                  </button>
                                  <button
                                    className="btn-compare"
                                    onClick={(e) => { e.stopPropagation(); setCompareVersionId(compareVersionId === v._id ? null : v._id); }}
                                  >
                                    {compareVersionId === v._id ? 'Hide Full Params' : 'Show Full Params'}
                                  </button>
                                </div>
                              )}

                              {/* Full parameters — shown when compare toggled or for current version */}
                              {(compareVersionId === v._id || isCurrent) && (
                                <div className="version-detail-section">
                                  <h4>Parameters at {v.versionLabel}</h4>
                                  <div className="params-grid">
                                    {Object.entries(params).filter(([, val]) => val !== undefined && val !== null && val !== '').length > 0 ? (
                                      Object.entries(params)
                                        .filter(([, val]) => val !== undefined && val !== null && val !== '')
                                        .map(([key, val]) => (
                                          <div key={key} className="param-row">
                                            <span className="param-key">{key}</span>
                                            <span className="param-val">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</span>
                                          </div>
                                        ))
                                    ) : (
                                      <p className="empty-state">No parameters recorded for this version.</p>
                                    )}
                                  </div>
                                  {snap?.screenerConfig?.params?.entry_rules && (
                                    <div className="rules-block">
                                      <span className="rules-label">Entry Rules</span>
                                      <p>{String(snap.screenerConfig.params.entry_rules)}</p>
                                    </div>
                                  )}
                                  {snap?.screenerConfig?.params?.exit_rules && (
                                    <div className="rules-block">
                                      <span className="rules-label">Exit Rules</span>
                                      <p>{String(snap.screenerConfig.params.exit_rules)}</p>
                                    </div>
                                  )}
                                  {snap?.screenerConfig?.params?.risk_management && (
                                    <div className="rules-block">
                                      <span className="rules-label">Risk Management</span>
                                      <p>{String(snap.screenerConfig.params.risk_management)}</p>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* AI Analysis */}
                              <div className="version-detail-section">
                                <h4>AI Analysis</h4>
                                {v.aiReview?.analysis ? (
                                  <>
                                    <div className="version-analysis-text">{v.aiReview.analysis}</div>
                                    {v.aiReview.suggestions && v.aiReview.suggestions.length > 0 && (
                                      <div className="version-suggestions">
                                        <h5>Suggestions</h5>
                                        {v.aiReview.suggestions.map((s, i) => (
                                          <div key={i} className="suggestion-card">
                                            <div className="suggestion-header">
                                              <span className={`suggestion-action ${s.action ?? 'modify'}`}>{s.action ?? 'modify'}</span>
                                              <span className="suggestion-field">{s.field}</span>
                                            </div>
                                            <div className="suggestion-values">
                                              {s.currentValue !== undefined && <span className="current-val">Current: {String(s.currentValue)}</span>}
                                              <span className="suggested-val">Suggested: {String(s.suggestedValue)}</span>
                                            </div>
                                            <p className="suggestion-reasoning">{s.reasoning}</p>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <p className="empty-state">No AI analysis was run for this version.</p>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .btn-ai-action {
    background: rgba(16, 185, 129, 0.15);
    border: 1px solid rgba(16, 185, 129, 0.3);
    color: #10b981;
    padding: 0.25rem 0.75rem;
    border-radius: 2rem;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-ai-action:hover:not(:disabled) {
    background: rgba(16, 185, 129, 0.25);
    transform: translateY(-1px);
  }

  .backtest-results-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #0a0a0f;
    color: #e5e5e5;
    padding: 1.5rem;
    overflow-y: auto;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 2rem;
  }

  .header-title h2 {
    margin: 0 0 0.25rem;
    font-size: 1.5rem;
    background: linear-gradient(90deg, #e5e5e5, #9ca3af);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .subtitle {
    font-size: 0.85rem;
    color: #6b7280;
    font-family: monospace;
  }

  .header-actions {
    display: flex;
    gap: 1rem;
  }

  .btn-secondary, .btn-primary {
    padding: 0.5rem 1rem;
    border-radius: 0.5rem;
    font-weight: 500;
    cursor: pointer;
    font-size: 0.9rem;
    transition: all 0.2s;
  }

  .btn-secondary {
    background: transparent;
    border: 1px solid #333;
    color: #9ca3af;
  }
  
  .btn-secondary:hover { border-color: #666; color: #e5e5e5; }

  .btn-primary {
    background: #10b981;
    border: none;
    color: white;
  }

  .btn-primary:hover { background: #059669; }

  .data-source-badge {
    display: inline-block;
    padding: 0.15rem 0.5rem;
    border-radius: 1rem;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .badge-polygon { background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); }
  .badge-databento { background: rgba(59, 130, 246, 0.15); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.3); }
  .badge-synthetic { background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); }

  .synthetic-warning {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
    padding: 0.75rem 1rem;
    margin-bottom: 1.5rem;
    background: rgba(245, 158, 11, 0.08);
    border: 1px solid rgba(245, 158, 11, 0.2);
    border-radius: 0.5rem;
    color: #fbbf24;
    font-size: 0.85rem;
    line-height: 1.4;
  }

  .synthetic-warning .bullet { font-size: 1.2rem; flex-shrink: 0; }
  .synthetic-warning p { margin: 0; }

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .metric-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    padding: 1rem;
    border-radius: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    overflow: hidden;
  }

  .metric-card label {
    font-size: 0.8rem;
    color: #9ca3af;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .metric-card .value {
    font-size: 1.5rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .value.positive { color: #10b981; }
  .value.negative { color: #ef4444; }

  .chart-section {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 0.75rem;
    padding: 1.5rem;
    margin-bottom: 2rem;
  }

  .chart-section h3 {
    margin: 0 0 1rem;
    font-size: 1.1rem;
    color: #e5e5e5;
  }

  .analysis-section {
    background: rgba(16, 185, 129, 0.05);
    border: 1px solid rgba(16, 185, 129, 0.1);
    border-radius: 0.75rem;
    padding: 1.5rem;
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
    color: #10b981;
  }

  .section-header h3 {
    margin: 0;
    font-size: 1.1rem;
  }

  .analysis-content {
    display: grid;
    gap: 1rem;
  }

  .analysis-item {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
    padding: 0.75rem;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 0.5rem;
  }

  .analysis-item .bullet {
    font-weight: bold;
    font-size: 1.1rem;
  }

  .analysis-item p {
    margin: 0;
    font-size: 0.95rem;
    line-height: 1.5;
    color: #d1d5db;
  }

  .analysis-item.positive .bullet { color: #10b981; }
  .analysis-item.warning .bullet { color: #f59e0b; }
  .analysis-item.suggestion .bullet { color: #3b82f6; }

  .suggestions-section {
    background: rgba(59, 130, 246, 0.05);
    border: 1px solid rgba(59, 130, 246, 0.15);
    border-radius: 0.75rem;
    padding: 1.5rem;
    margin-top: 1.5rem;
  }

  .suggestions-list {
    display: grid;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .suggestion-card {
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 0.5rem;
    padding: 0.75rem 1rem;
  }

  .suggestion-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .suggestion-action {
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    padding: 0.1rem 0.4rem;
    border-radius: 0.25rem;
  }

  .suggestion-action.add { background: rgba(16, 185, 129, 0.2); color: #10b981; }
  .suggestion-action.modify { background: rgba(59, 130, 246, 0.2); color: #3b82f6; }
  .suggestion-action.remove { background: rgba(239, 68, 68, 0.2); color: #ef4444; }

  .suggestion-field { font-weight: 600; color: #e5e5e5; font-size: 0.9rem; }

  .suggestion-values {
    display: flex;
    gap: 1rem;
    font-size: 0.8rem;
    margin-bottom: 0.25rem;
  }

  .current-val { color: #6b7280; }
  .suggested-val { color: #10b981; font-weight: 500; }

  .suggestion-reasoning {
    margin: 0;
    font-size: 0.8rem;
    color: #9ca3af;
    line-height: 1.4;
  }

  .suggestions-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
  }

  .version-comparison-section {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 0.75rem;
    padding: 1.5rem;
    margin-top: 1.5rem;
  }

  .version-table-wrapper {
    overflow-x: auto;
  }

  .version-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }

  .version-table th {
    text-align: left;
    padding: 0.5rem 0.75rem;
    color: #6b7280;
    font-weight: 600;
    text-transform: uppercase;
    font-size: 0.7rem;
    letter-spacing: 0.05em;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .version-table td {
    padding: 0.5rem 0.75rem;
    color: #d1d5db;
    border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  }

  .version-table .current-version td {
    background: rgba(16, 185, 129, 0.06);
    color: #e5e5e5;
    font-weight: 500;
  }

  .version-label {
    color: #9ca3af;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .version-chevron {
    display: inline-block;
    font-size: 0.7rem;
    transition: transform 0.2s;
    color: #6b7280;
  }

  .version-chevron.open { transform: rotate(90deg); }

  .version-row {
    cursor: pointer;
    transition: background 0.15s;
  }

  .version-row:hover td { background: rgba(255, 255, 255, 0.04); }
  .version-row.expanded td { background: rgba(16, 185, 129, 0.04); border-bottom-color: transparent; }

  .version-table .positive { color: #10b981; }
  .version-table .negative { color: #ef4444; }

  .version-detail-row td {
    padding: 0 !important;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .version-detail {
    padding: 1rem 1.25rem;
    background: rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .version-detail-section h4 {
    margin: 0 0 0.6rem;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #6b7280;
    font-weight: 600;
  }

  .version-detail-section h5 {
    margin: 0.75rem 0 0.4rem;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #6b7280;
    font-weight: 600;
  }

  .delta-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.5rem;
  }

  .delta-item {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 0.5rem;
    padding: 0.5rem 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .delta-label {
    font-size: 0.65rem;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
  }

  .delta-values {
    font-size: 0.8rem;
    color: #9ca3af;
  }

  .delta-arrow {
    margin: 0 0.3rem;
    color: #4b5563;
  }

  .delta-diff {
    font-size: 0.75rem;
    font-weight: 600;
  }

  .delta-diff.improved { color: #10b981; }
  .delta-diff.regressed { color: #ef4444; }

  .params-grid {
    display: grid;
    gap: 0;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 0.5rem;
    overflow: hidden;
  }

  .param-row {
    display: flex;
    justify-content: space-between;
    padding: 0.35rem 0.75rem;
    font-size: 0.8rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  }

  .param-row:last-child { border-bottom: none; }

  .param-key {
    color: #9ca3af;
    font-family: monospace;
    font-size: 0.75rem;
  }

  .param-val {
    color: #e5e5e5;
    font-weight: 500;
    font-family: monospace;
    font-size: 0.75rem;
  }

  .rules-block {
    margin-top: 0.6rem;
    padding: 0.6rem 0.75rem;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 0.5rem;
  }

  .rules-label {
    display: block;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #6b7280;
    margin-bottom: 0.3rem;
  }

  .rules-block p {
    margin: 0;
    font-size: 0.8rem;
    color: #d1d5db;
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .version-analysis-text {
    font-size: 0.8rem;
    color: #d1d5db;
    line-height: 1.5;
    white-space: pre-wrap;
    max-height: 200px;
    overflow-y: auto;
    padding: 0.6rem 0.75rem;
    background: rgba(0, 0, 0, 0.15);
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.04);
  }

  .version-suggestions {
    margin-top: 0.5rem;
  }

  .empty-state {
    margin: 0;
    font-size: 0.8rem;
    color: #4b5563;
    font-style: italic;
  }

  /* Suggestion toggles */
  .suggestion-count {
    margin-left: auto;
    font-size: 0.75rem;
    color: #6b7280;
    font-weight: 500;
  }

  .suggestion-checkbox {
    accent-color: #10b981;
    width: 14px;
    height: 14px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .suggestion-card {
    cursor: pointer;
    transition: opacity 0.2s, border-color 0.2s;
  }

  .suggestion-card.selected {
    border-color: rgba(59, 130, 246, 0.25);
  }

  .suggestion-card.deselected {
    opacity: 0.45;
    border-color: rgba(255, 255, 255, 0.03);
  }

  .suggestion-card.deselected:hover {
    opacity: 0.7;
  }

  .suggestions-actions button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* Stress test section */
  .stress-test-section {
    background: rgba(245, 158, 11, 0.05);
    border: 1px solid rgba(245, 158, 11, 0.15);
    border-radius: 0.75rem;
    padding: 1.5rem;
    margin-top: 1.5rem;
  }

  .stress-test-section .section-header {
    color: #f59e0b;
  }

  .stress-table td {
    position: relative;
  }

  .stress-delta {
    display: inline-block;
    font-size: 0.65rem;
    font-weight: 600;
    margin-left: 0.35rem;
    padding: 0.05rem 0.3rem;
    border-radius: 0.2rem;
  }

  .stress-delta.improved {
    color: #10b981;
    background: rgba(16, 185, 129, 0.1);
  }

  .stress-delta.regressed {
    color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
  }

  .stress-note {
    margin: 0.75rem 0 0;
    font-size: 0.72rem;
    color: #6b7280;
    font-style: italic;
  }

  /* Version comparison enhancements */
  .version-actions {
    display: flex;
    gap: 0.5rem;
    padding-top: 0.25rem;
  }

  .btn-revert, .btn-compare {
    padding: 0.35rem 0.75rem;
    border-radius: 0.375rem;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-revert {
    background: rgba(245, 158, 11, 0.12);
    border: 1px solid rgba(245, 158, 11, 0.3);
    color: #f59e0b;
  }

  .btn-revert:hover:not(:disabled) {
    background: rgba(245, 158, 11, 0.22);
  }

  .btn-revert:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-compare {
    background: rgba(59, 130, 246, 0.12);
    border: 1px solid rgba(59, 130, 246, 0.25);
    color: #3b82f6;
  }

  .btn-compare:hover {
    background: rgba(59, 130, 246, 0.22);
  }

  /* Param diff styles */
  .param-diff-vals {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-family: monospace;
    font-size: 0.75rem;
  }

  .param-row.param-diff-added {
    background: rgba(16, 185, 129, 0.06);
    border-left: 2px solid rgba(16, 185, 129, 0.4);
  }

  .param-row.param-diff-removed {
    background: rgba(239, 68, 68, 0.06);
    border-left: 2px solid rgba(239, 68, 68, 0.4);
  }

  .param-row.param-diff-changed {
    background: rgba(59, 130, 246, 0.06);
    border-left: 2px solid rgba(59, 130, 246, 0.4);
  }

  .diff-added { color: #10b981; font-weight: 500; }
  .diff-removed { color: #ef4444; font-weight: 500; text-decoration: line-through; }
  .diff-old { color: #6b7280; }
  .diff-new { color: #10b981; font-weight: 500; }
`;

export default BacktestResultsPanel;
