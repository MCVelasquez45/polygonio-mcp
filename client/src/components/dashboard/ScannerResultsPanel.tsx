import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { runAgentScan } from '../../api/agent';

type ScannerSignal = {
  strategyId: string;
  strategyName: string;
  opportunity: {
    ticker: string;
    expiration: string;
    strike: number;
    delta?: number | null;
    bid: number;
    ask: number;
    mid: number;
    open_interest: number;
    iv?: number | null;
    spot: number;
    premium_yield: number;
    breakeven: number;
    max_profit: number;
    pop_est?: number | null;
  };
  timestamp: string;
};

type Props = {
  socketUrl?: string;
  maxSignals?: number;
  onTickerSelect?: (ticker: string) => void;
};

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatPrice(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

export function ScannerResultsPanel({ socketUrl = 'http://localhost:3000', maxSignals = 20, onTickerSelect }: Props) {
  const [signals, setSignals] = useState<ScannerSignal[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastSignalTime, setLastSignalTime] = useState<Date | null>(null);
  const [agentThinking, setAgentThinking] = useState(false);
  const [agentResponse, setAgentResponse] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(socketUrl, {
      transports: ['websocket', 'polling']
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[ScannerResults] Socket connected');
      setConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('[ScannerResults] Socket disconnected');
      setConnected(false);
    });

    socket.on('screener_signal', (signal: ScannerSignal) => {
      console.log('[ScannerResults] Received signal:', signal);
      setSignals(prev => {
        const updated = [signal, ...prev].slice(0, maxSignals);
        return updated;
      });
      setLastSignalTime(new Date());
    });

    return () => {
      socket.disconnect();
    };
  }, [socketUrl, maxSignals]);

  const clearSignals = () => {
    setSignals([]);
    setAgentResponse(null);
  };

  const handleRunScan = async () => {
    setAgentThinking(true);
    setAgentResponse(null);
    try {
      // Trigger the 0-DTE scan via the Agent
      const result = await runAgentScan("Scan for the best 0-DTE covered call candidates for SPY.");
      setAgentResponse(result.output);
    } catch (err) {
      console.error("Agent scan failed", err);
      setAgentResponse("Error: Failed to run AI scan. Please ensure the agent is running.");
    } finally {
      setAgentThinking(false);
    }
  };

  return (
    <div className="scanner-panel">
      <header className="panel-header">
        <div className="header-title">
          <h2>Live Scanner Results</h2>
          <p className="header-subtitle">Real-time screener opportunities</p>
        </div>
        <div className="header-controls">
          <button
            type="button"
            className="btn-run-scan"
            onClick={handleRunScan}
            disabled={agentThinking}
          >
            {agentThinking ? 'Scanning...' : '✨ Run AI 0-DTE Scan'}
          </button>

          <div className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
            <span className="status-dot"></span>
            <span className="status-text">{connected ? 'Connected' : 'Disconnected'}</span>
          </div>
          {signals.length > 0 && (
            <button type="button" className="clear-btn" onClick={clearSignals}>
              Clear
            </button>
          )}
        </div>
      </header>

      {agentResponse && (
        <div className="agent-insight">
          <div className="agent-header">
            <span className="agent-icon">🤖</span>
            <span className="agent-title">AI Agent Analysis</span>
            <button className="close-agent" onClick={() => setAgentResponse(null)}>×</button>
          </div>
          <div className="agent-content">
            {agentResponse.split('\n').map((line, i) => (
              <p key={i} className="agent-line">{line}</p>
            ))}
          </div>
        </div>
      )}

      {signals.length === 0 && !agentThinking ? (
        <div className="empty-state">
          <span className="empty-icon">🔍</span>
          <p>Waiting for scanner signals...</p>
          <span className="empty-hint">
            {connected
              ? 'Signals appear when screeners find opportunities'
              : 'Connecting to server...'}
          </span>
        </div>
      ) : (
        <div className="signals-list">
          {signals.map((signal, idx) => (
            <div
              key={`${signal.strategyId}-${signal.timestamp}-${idx}`}
              className="signal-card"
              onClick={() => onTickerSelect?.(signal.opportunity.ticker.replace('O:', '').slice(0, 4))}
            >
              <div className="signal-header">
                <div className="signal-title">
                  <span className="signal-ticker">{signal.opportunity.ticker}</span>
                  <span className="signal-strategy">{signal.strategyName}</span>
                </div>
                <span className="signal-time">{formatTime(signal.timestamp)}</span>
              </div>

              <div className="signal-details">
                <div className="detail-row">
                  <div className="detail-item highlight">
                    <span className="detail-label">Premium Yield</span>
                    <span className="detail-value yield">{formatPercent(signal.opportunity.premium_yield)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Strike</span>
                    <span className="detail-value">{formatPrice(signal.opportunity.strike)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Bid/Ask</span>
                    <span className="detail-value">
                      {formatPrice(signal.opportunity.bid)} / {formatPrice(signal.opportunity.ask)}
                    </span>
                  </div>
                </div>

                <div className="detail-row">
                  <div className="detail-item">
                    <span className="detail-label">Spot</span>
                    <span className="detail-value">{formatPrice(signal.opportunity.spot)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Breakeven</span>
                    <span className="detail-value">{formatPrice(signal.opportunity.breakeven)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Max Profit</span>
                    <span className="detail-value positive">{formatPrice(signal.opportunity.max_profit)}</span>
                  </div>
                </div>

                <div className="detail-row">
                  {signal.opportunity.delta != null && (
                    <div className="detail-item">
                      <span className="detail-label">Delta</span>
                      <span className="detail-value">{signal.opportunity.delta.toFixed(2)}</span>
                    </div>
                  )}
                  {signal.opportunity.pop_est != null && (
                    <div className="detail-item">
                      <span className="detail-label">POP Est</span>
                      <span className="detail-value">{formatPercent(signal.opportunity.pop_est)}</span>
                    </div>
                  )}
                  <div className="detail-item">
                    <span className="detail-label">OI</span>
                    <span className="detail-value">{signal.opportunity.open_interest.toLocaleString()}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Expiry</span>
                    <span className="detail-value">{signal.opportunity.expiration}</span>
                  </div>
                </div>
              </div>

              <div className="signal-cta">
                <span className="cta-text">Click to load in trading view →</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {lastSignalTime && (
        <div className="panel-footer">
          Last signal: {lastSignalTime.toLocaleTimeString()}
        </div>
      )}

      <style>{`
        .agent-insight {
          margin: 1rem;
          background: rgba(124, 58, 237, 0.1); /* Violet tint */
          border: 1px solid rgba(124, 58, 237, 0.3);
          border-radius: 0.5rem;
          color: #e5e5e5;
          font-size: 0.9rem;
          overflow: hidden;
        }
        .agent-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1rem;
          background: rgba(124, 58, 237, 0.15);
          border-bottom: 1px solid rgba(124, 58, 237, 0.2);
        }
        .agent-title {
          font-weight: 600;
          color: #a78bfa;
          flex: 1;
        }
        .close-agent {
          background: none;
          border: none;
          color: #a78bfa;
          font-size: 1.2rem;
          cursor: pointer;
        }
        .agent-content {
          padding: 1rem;
          white-space: pre-wrap;
          line-height: 1.5;
        }
        .agent-line {
          margin: 0 0 0.5rem 0;
        }
        .btn-run-scan {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.4rem 0.85rem;
            background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%);
            border: 1px solid #5b21b6;
            color: white;
            border-radius: 0.375rem;
            font-size: 0.75rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }
        .btn-run-scan:hover {
            filter: brightness(1.1);
            transform: translateY(-1px);
        }
        .btn-run-scan:disabled {
            opacity: 0.7;
            cursor: wait;
        }
        
        .scanner-panel {
          background: #111118;
          border-radius: 1rem;
          border: 1px solid rgba(255, 255, 255, 0.06);
          overflow: hidden;
        }

        .panel-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding: 1.5rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }

        .header-title h2 {
          margin: 0 0 0.25rem;
          font-size: 1.25rem;
          font-weight: 600;
        }

        .header-subtitle {
          margin: 0;
          font-size: 0.85rem;
          color: #9ca3af;
        }

        .header-controls {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .connection-status {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.8rem;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .connection-status.connected .status-dot {
          background: #10b981;
          box-shadow: 0 0 8px rgba(16, 185, 129, 0.5);
          animation: pulse 2s ease-in-out infinite;
        }

        .connection-status.connected .status-text {
          color: #10b981;
        }

        .connection-status.disconnected .status-dot {
          background: #ef4444;
        }

        .connection-status.disconnected .status-text {
          color: #ef4444;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .clear-btn {
          padding: 0.4rem 0.75rem;
          background: transparent;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 0.375rem;
          color: #9ca3af;
          font-size: 0.75rem;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .clear-btn:hover {
          border-color: rgba(255, 255, 255, 0.2);
          color: #e5e5e5;
        }

        .empty-state {
          padding: 4rem 2rem;
          text-align: center;
          color: #9ca3af;
        }

        .empty-icon {
          font-size: 3rem;
          display: block;
          margin-bottom: 1rem;
        }

        .empty-hint {
          font-size: 0.8rem;
          color: #6b7280;
        }

        .signals-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          padding: 1rem;
          max-height: 600px;
          overflow-y: auto;
        }

        .signal-card {
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0.02) 100%);
          border: 1px solid rgba(16, 185, 129, 0.2);
          border-radius: 0.75rem;
          padding: 1rem;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .signal-card:hover {
          border-color: rgba(16, 185, 129, 0.4);
          transform: translateY(-1px);
        }

        .signal-card:first-child {
          animation: slideIn 0.3s ease;
        }

        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .signal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.75rem;
        }

        .signal-title {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .signal-ticker {
          font-size: 1rem;
          font-weight: 600;
          color: #10b981;
        }

        .signal-strategy {
          font-size: 0.75rem;
          color: #9ca3af;
          background: rgba(255, 255, 255, 0.05);
          padding: 0.2rem 0.5rem;
          border-radius: 0.25rem;
        }

        .signal-time {
          font-size: 0.75rem;
          color: #6b7280;
        }

        .signal-details {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .detail-row {
          display: flex;
          gap: 1.5rem;
          flex-wrap: wrap;
        }

        .detail-item {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
          min-width: 80px;
        }

        .detail-item.highlight {
          background: rgba(16, 185, 129, 0.1);
          padding: 0.35rem 0.5rem;
          border-radius: 0.375rem;
          margin: -0.35rem;
        }

        .detail-label {
          font-size: 0.65rem;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .detail-value {
          font-size: 0.85rem;
          font-weight: 500;
        }

        .detail-value.yield {
          color: #10b981;
          font-size: 1rem;
          font-weight: 700;
        }

        .detail-value.positive {
          color: #10b981;
        }

        .signal-cta {
          margin-top: 0.75rem;
          padding-top: 0.5rem;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
        }

        .cta-text {
          font-size: 0.75rem;
          color: #6b7280;
        }

        .panel-footer {
          padding: 0.75rem 1rem;
          text-align: right;
          font-size: 0.75rem;
          color: #6b7280;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
        }
      `}</style>
    </div>
  );
}
