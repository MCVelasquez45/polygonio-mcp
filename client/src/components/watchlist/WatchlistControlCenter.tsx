import { useCallback, useEffect, useState } from 'react';
import {
  listWatchlist,
  setAutomationEnabled,
  setPriority,
  upsertWatchlistItem,
  removeWatchlistItem,
  type WatchlistItem,
  type WatchlistAutomationStatus,
} from '../../api/watchlist';

// Sprint 2E — the Watchlist page as the Automation Control Center.
//
// The server watchlist is the authoritative automation universe; this panel
// curates it. Every change (enable/disable automation, priority) is applied via
// the API and is effective with NO server restart. The panel is additive and
// self-contained — mount it wherever the watchlist lives:
//
//   import { WatchlistControlCenter } from './components/watchlist/WatchlistControlCenter';
//   <WatchlistControlCenter />

const STATUS_LABEL: Record<WatchlistAutomationStatus, string> = {
  DISABLED: '🔴 Disabled',
  WAITING_FOR_BASELINE: '🟡 Waiting for Baseline',
  MONITORING: '🟢 Monitoring',
  EVALUATING: '🔵 Evaluating',
  POSITION_OPEN: '🟠 Position Open',
};

function fmt(ts: string | null): string {
  return ts ? new Date(ts).toLocaleTimeString() : '—';
}

export function WatchlistControlCenter() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newSymbol, setNewSymbol] = useState('');

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      setItems(await listWatchlist(signal));
      setError(null);
    } catch (e: any) {
      if (e?.name !== 'CanceledError') setError(e?.message ?? 'Failed to load watchlist');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    // Poll so live evaluation status (last signal / status) stays fresh.
    const timer = setInterval(() => void refresh(), 15_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refresh]);

  const toggleAutomation = async (item: WatchlistItem) => {
    await setAutomationEnabled(item.symbol, !item.automationEnabled);
    await refresh();
  };

  const changePriority = async (item: WatchlistItem, priority: number) => {
    if (!Number.isFinite(priority)) return;
    await setPriority(item.symbol, priority);
    await refresh();
  };

  const addSymbol = async () => {
    const symbol = newSymbol.trim().toUpperCase();
    if (!symbol) return;
    await upsertWatchlistItem({ symbol, enabled: true, automationEnabled: false });
    setNewSymbol('');
    await refresh();
  };

  const remove = async (symbol: string) => {
    await removeWatchlistItem(symbol);
    await refresh();
  };

  return (
    <div className="watchlist-control-center" style={{ padding: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Automation Control Center</h2>
        <div>
          <input
            value={newSymbol}
            onChange={e => setNewSymbol(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void addSymbol()}
            placeholder="Add symbol (e.g. SPY)"
            aria-label="Add symbol"
            style={{ marginRight: 8 }}
          />
          <button onClick={() => void addSymbol()}>Add</button>
        </div>
      </header>

      {error && <div role="alert" style={{ color: '#c0392b', marginBottom: 8 }}>{error}</div>}
      {loading ? (
        <div>Loading watchlist…</div>
      ) : items.length === 0 ? (
        <div>No symbols yet. Add one to start autonomous monitoring.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
              <th>Symbol</th>
              <th>Automation</th>
              <th>Strategy</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Last Eval</th>
              <th>Last Signal</th>
              <th>Last Trade</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.symbol} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td><strong>{item.symbol}</strong></td>
                <td>
                  <button onClick={() => void toggleAutomation(item)}>
                    {item.automationEnabled ? 'Disable' : 'Enable'}
                  </button>
                </td>
                <td>{item.strategy}</td>
                <td>
                  <input
                    type="number"
                    value={item.priority}
                    onChange={e => void changePriority(item, Number(e.target.value))}
                    aria-label={`${item.symbol} priority`}
                    style={{ width: 64 }}
                  />
                </td>
                <td>{STATUS_LABEL[item.automationEnabled ? item.automationStatus : 'DISABLED']}</td>
                <td>{fmt(item.lastEvaluationAt)}</td>
                <td>{item.lastSignal ?? '—'}</td>
                <td>{fmt(item.lastTradeAt)}</td>
                <td><button onClick={() => void remove(item.symbol)} aria-label={`Remove ${item.symbol}`}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p style={{ marginTop: 12, fontSize: 12, color: '#777' }}>
        The user curates the watchlist; the scheduler continuously evaluates enabled symbols and the deterministic
        engine decides. Changes apply without a server restart.
      </p>
    </div>
  );
}

export default WatchlistControlCenter;
