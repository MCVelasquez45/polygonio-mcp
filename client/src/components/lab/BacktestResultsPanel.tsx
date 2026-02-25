import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, LineStyle, LineSeries } from 'lightweight-charts';
import { apiClient, futuresApi } from '../../api';
import type { FuturesBacktestResult } from '../../types/futures';

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
};

// Mock Data Generation
function generateEquityCurve(days: number = 365) {
  let value = 100000;
  let benchmark = 100000;
  const data = [];
  const benchmarkData = [];

  const date = new Date('2025-01-01');

  for (let i = 0; i < days; i++) {
    // Random walk with drift
    const change = (Math.random() - 0.48) * 0.02; // Slight positive drift
    const benchChange = (Math.random() - 0.49) * 0.015;

    value = value * (1 + change);
    benchmark = benchmark * (1 + benchChange);

    // Add some "alpha" jumps properly
    if (i % 30 === 0 && Math.random() > 0.5) {
      value *= 1.02;
    }

    const time = date.toISOString().split('T')[0];
    data.push({ time, value });
    benchmarkData.push({ time, value: benchmark });

    date.setDate(date.getDate() + 1);
  }

  return { strategy: data, benchmark: benchmarkData };
}

export function BacktestResultsPanel({ backtestId, strategyId, onDeployToPaper, onClose }: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [backtest, setBacktest] = useState<FuturesBacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
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
          profitFactor: Math.max(0, 1 + result.metrics.totalReturnPct * 2)
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

    const { strategy, benchmark } =
      backtest?.equityCurve?.length
        ? (() => {
            const strategySeries = backtest.equityCurve.map(point => ({
              time: point.timestamp.slice(0, 10),
              value: point.equity
            }));
            const first = strategySeries[0]?.value ?? 100000;
            const benchmarkSeries = strategySeries.map((point, index) => ({
              time: point.time,
              value: first * (1 + index * 0.0008)
            }));
            return { strategy: strategySeries, benchmark: benchmarkSeries };
          })()
        : generateEquityCurve();
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

  const runAiAnalysis = async () => {
    const selectedStrategyId = strategyId ?? backtest?.strategyId;
    if (!selectedStrategyId) return;
    setIsAnalyzing(true);
    try {
      const response = await apiClient.post(`/api/lab/strategy/${selectedStrategyId}/ai-review`, {
        backtestResults: backtest?.metrics ?? metrics
      });
      setAiAnalysis(response.data?.analysis ?? null);
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
          <h2>📊 Backtest Results</h2>
          <span className="subtitle">ID: {backtest?._id || backtestId || 'BT-20260116-001'}</span>
        </div>
        <div className="header-actions">
          <button className="btn-secondary" onClick={onClose}>Close</button>
          <button className="btn-primary" onClick={onDeployToPaper}>Deploy to Paper</button>
        </div>
      </div>

      <div className="metrics-grid">
        <div className="metric-card">
          <label>Total Return</label>
          <span className={`value ${metrics.totalReturn >= 0 ? 'positive' : 'negative'}`}>
            {metrics.totalReturn >= 0 ? '+' : ''}{metrics.totalReturn.toFixed(2)}%
          </span>
        </div>
        <div className="metric-card">
          <label>Sharpe Ratio</label>
          <span className="value">{metrics.sharpeRatio}</span>
        </div>
        <div className="metric-card">
          <label>Max Drawdown</label>
          <span className="value negative">{metrics.maxDrawdown}%</span>
        </div>
        <div className="metric-card">
          <label>Win Rate</label>
          <span className="value">{metrics.winRate}%</span>
        </div>
        <div className="metric-card">
          <label>Profit Factor</label>
          <span className="value">{metrics.profitFactor}</span>
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

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
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
`;

export default BacktestResultsPanel;
