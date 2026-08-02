import { useEffect, useState, type ReactElement } from 'react';
import { CheckCircle2, KeyRound, Laptop, Link2, LockKeyhole, ShieldCheck } from 'lucide-react';
import { getSecurityOverview, type SecurityOverview } from '../../api/brokerage';

function when(value: string | null): string {
  if (!value) return 'No recorded activity';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function SecurityCenter() {
  const [data, setData] = useState<SecurityOverview | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => { getSecurityOverview().then(setData).catch(() => setError(true)); }, []);
  return <div data-testid="security-center">
    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-intel-accent">Security center</p>
    <h2 className="mt-2 text-xl font-semibold text-intel-ink">Access and authorization</h2>
    <p className="mt-2 text-sm leading-6 text-intel-ink3">Review the safeguards protecting your identity, sessions, and brokerage connections.</p>
    {error && <div role="alert" className="mt-4 rounded-md border border-intel-neg/30 bg-intel-neg/10 p-3 text-sm text-intel-neg">Security activity is temporarily unavailable.</div>}
    <div className="mt-5 grid gap-2 sm:grid-cols-2">
      <Control icon={<KeyRound />} label="OAuth authentication" value="Enabled" />
      <Control icon={<LockKeyhole />} label="Token encryption" value={data?.controls.encryption ?? 'AES-256-GCM'} />
      <Control icon={<ShieldCheck />} label="Transport security" value={data?.controls.transport ?? 'TLS 1.3'} />
      <Control icon={<Link2 />} label="Revocable access" value="Enabled" />
    </div>
    <div className="mt-5 grid gap-2 sm:grid-cols-2"><Control icon={<ShieldCheck />} label="Session status" value={data?.sessionStatus ?? 'Active'} /><Control icon={<KeyRound />} label="Last login" value={when(data?.lastLogin ?? null)} /></div>
    <section className="mt-5 rounded-md border border-intel-line bg-intel-bg">
      <div className="flex items-center justify-between border-b border-intel-line px-3 py-3"><div className="flex items-center gap-2 text-sm font-semibold"><Laptop className="h-4 w-4 text-intel-accent" />Connected devices</div><span className="font-mono text-[9px] uppercase tracking-label text-intel-pos">{data?.sessionStatus ?? 'active'}</span></div>
      <div className="divide-y divide-intel-line">{data?.connectedDevices.map(device => <div key={device.id} className="px-3 py-3 text-xs"><p className="truncate text-intel-ink2">{device.device.ua || 'Unknown device'}</p><p className="mt-1 font-mono text-[9px] uppercase tracking-label text-intel-ink3">{device.device.ip || 'IP unavailable'} · {when(device.lastUsedAt)}</p></div>)}{data && !data.connectedDevices.length && <p className="px-3 py-4 text-xs text-intel-ink3">No active devices.</p>}</div>
    </section>
    <section className="mt-5 rounded-md border border-intel-line bg-intel-bg"><div className="border-b border-intel-line px-3 py-3 text-sm font-semibold">Connected brokers</div><div className="divide-y divide-intel-line">{data?.connectedBrokers.map(broker => <div key={broker.id} className="flex items-center justify-between gap-3 px-3 py-3"><div><p className="text-xs font-semibold text-intel-ink">{broker.brokerName}</p><p className="mt-1 font-mono text-[9px] uppercase tracking-label text-intel-ink3">{broker.environment} · OAuth {broker.oauthStatus}</p></div><span className="font-mono text-[9px] uppercase tracking-label text-intel-pos">{broker.status}</span></div>)}{data && !data.connectedBrokers.length && <p className="px-3 py-4 text-xs text-intel-ink3">No connected brokers.</p>}</div></section>
    <section className="mt-5 rounded-md border border-intel-line bg-intel-bg"><div className="border-b border-intel-line px-3 py-3 text-sm font-semibold">Security activity</div><div className="divide-y divide-intel-line">{data?.activity.slice(0, 8).map(item => <div key={item._id} className="flex items-center justify-between gap-3 px-3 py-3"><div className="flex min-w-0 items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-intel-pos" /><p className="truncate text-xs text-intel-ink2">{item.action.replaceAll('_', ' ').toLowerCase()}</p></div><time className="shrink-0 font-mono text-[9px] text-intel-ink3">{when(item.createdAt)}</time></div>)}</div></section>
  </div>;
}

function Control({ icon, label, value }: { icon: ReactElement<{ className?: string }>; label: string; value: string }) {
  return <div className="rounded-md border border-intel-line bg-intel-bg p-3"><div className="flex items-center gap-2 text-intel-accent">{icon}<span className="font-mono text-[9px] uppercase tracking-label text-intel-ink3">{label}</span></div><p className="mt-2 text-sm font-semibold text-intel-ink">{value}</p></div>;
}
