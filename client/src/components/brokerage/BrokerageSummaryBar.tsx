import { useEffect, useState } from 'react';
import { Bot, ShieldCheck } from 'lucide-react';
import { brokerStatus, type BrokerConnection } from '../../api/brokerage';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function BrokerageSummaryBar() {
  const [connection, setConnection] = useState<BrokerConnection | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState({ aiStatus: 'ready', riskScore: 35, recentSignals: 0 });
  useEffect(() => {
    let active = true;
    brokerStatus().then(result => { if (active) { setConnection(result.connections.find(item => item.primary && item.status === 'connected') ?? result.connections.find(item => item.status === 'connected') ?? null); setWorkspaceStatus({ aiStatus: result.aiStatus, riskScore: result.riskScore, recentSignals: result.recentSignals.length }); } }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  if (!connection) return null;
  const metrics = [
    ['Broker', connection.brokerName], ['Buying power', connection.balances.buyingPower == null ? 'Syncing' : usd.format(connection.balances.buyingPower)],
    ['Portfolio value', connection.balances.portfolioValue == null ? 'Syncing' : usd.format(connection.balances.portfolioValue)],
    ["Today's P/L", usd.format(connection.metrics.todayPl)], ['Positions', String(connection.metrics.openPositions)], ['Open orders', String(connection.metrics.openOrders)],
    ['AI status', workspaceStatus.aiStatus], ['Risk score', `${workspaceStatus.riskScore}/100`], ['Recent signals', String(workspaceStatus.recentSignals)],
  ];
  return <section aria-label="Brokerage account summary" className="border-b border-intel-line bg-intel-panel px-3 py-2 md:px-4"><div className="flex items-center gap-2 overflow-x-auto">{metrics.map(([label, value]) => <div key={label} className="min-w-[112px] border-r border-intel-line pr-3 last:border-0"><p className="font-mono text-[8px] uppercase tracking-label text-intel-ink3">{label}</p><p className="mt-0.5 truncate text-xs font-semibold text-intel-ink">{value}</p></div>)}<div className="ml-auto flex min-w-max items-center gap-2 rounded-md border border-intel-pos/20 bg-intel-pos/5 px-2.5 py-1.5"><ShieldCheck className="h-3.5 w-3.5 text-intel-pos" /><span className="font-mono text-[9px] uppercase tracking-label text-intel-pos">OAuth secure</span><Bot className="ml-1 h-3.5 w-3.5 text-intel-accent" /><span className="font-mono text-[9px] uppercase tracking-label text-intel-accent">AI ready</span></div></div></section>;
}
