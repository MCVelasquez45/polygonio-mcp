import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, ChevronRight, ExternalLink, LockKeyhole, RefreshCw, ShieldCheck, Unplug, X } from 'lucide-react';
import { connectBroker, disconnectBroker, listBrokers, reconnectBroker, syncBrokers, type BrokerConnection, type BrokerDirectoryEntry } from '../../api/brokerage';

type Props = { mode?: 'onboarding' | 'settings'; onConnected?: () => void };

function money(value: number | null): string {
  return value == null ? 'Pending sync' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

function time(value: string | null): string {
  if (!value) return 'Not yet synced';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function BrokerConnectionCenter({ mode = 'onboarding', onConnected }: Props) {
  const [brokers, setBrokers] = useState<BrokerDirectoryEntry[]>([]);
  const [selected, setSelected] = useState<BrokerDirectoryEntry | null>(null);
  const [environment, setEnvironment] = useState<'paper' | 'live'>('paper');
  const [disconnecting, setDisconnecting] = useState<BrokerConnection | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const next = await listBrokers();
    setBrokers(next);
    if (selected) setSelected(next.find(item => item.provider === selected.provider) ?? null);
    if (next.some(item => item.connections.some(connection => connection.status === 'connected'))) onConnected?.();
  };

  useEffect(() => { load().catch(() => setError('Broker directory is temporarily unavailable. Your workspace and identity remain secure.')); }, []);

  const current = useMemo(() => selected?.connections.find(connection => connection.status !== 'revoked') ?? null, [selected]);

  const begin = async (reconnect = false) => {
    if (!selected) return;
    setBusy(selected.provider); setError(null);
    try {
      const url = reconnect
        ? await reconnectBroker(selected.provider, environment)
        : await connectBroker(selected.provider, environment, mode === 'onboarding' ? '/onboarding' : '/terminal?settings=brokers');
      window.location.assign(url);
    } catch (cause: any) {
      const code = cause?.response?.data?.error;
      setError(code === 'BROKER_OAUTH_NOT_CONFIGURED'
        ? `${selected.name} OAuth is not configured for this deployment. Ask a workspace administrator to complete the provider registration.`
        : `We could not begin ${selected.name} authorization. No brokerage access was changed.`);
      setBusy(null);
    }
  };

  const sync = async (connection: BrokerConnection) => {
    setBusy(connection.id); setError(null);
    try { await syncBrokers(connection.provider); await load(); }
    catch { setError('Portfolio synchronization did not complete. Your existing portfolio cache remains unchanged.'); }
    finally { setBusy(null); }
  };

  const disconnect = async () => {
    if (!disconnecting) return;
    setBusy(disconnecting.id); setError(null);
    try { await disconnectBroker(disconnecting.provider, disconnecting.id); setDisconnecting(null); setSelected(null); await load(); }
    catch { setError('The connection could not be removed. No credentials were deleted.'); }
    finally { setBusy(null); }
  };

  if (selected) {
    return <div data-testid="broker-details" className="animate-in fade-in duration-200">
      <button type="button" onClick={() => setSelected(null)} className="inline-flex items-center gap-2 text-xs text-zinc-400 hover:text-white"><ArrowLeft className="h-4 w-4" />Broker directory</button>
      <div className="mt-6 flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
        <div className="flex items-start gap-4"><BrokerLogo broker={selected} large /><div><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-300">Secure OAuth connection</p><h2 className="mt-2 text-3xl font-semibold text-white">{selected.name}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-zinc-400">{selected.description}</p></div></div>
        {current && <StatusPill status={current.status} />}
      </div>
      {error && <div role="alert" className="mt-5 rounded-md border border-red-400/25 bg-red-400/[0.07] px-4 py-3 text-sm text-red-200">{error}</div>}
      {current?.status === 'connected' ? <div className="mt-7 grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
        <section className="rounded-lg border border-emerald-300/20 bg-emerald-300/[0.025] p-5"><div className="flex items-center gap-2 text-sm font-semibold text-white"><ShieldCheck className="h-4 w-4 text-emerald-300" />Connection verified</div><div className="mt-5 grid gap-3 sm:grid-cols-2"><Metric label="Environment" value={current.environment === 'paper' ? 'Paper trading' : 'Live trading'} /><Metric label="Buying power" value={money(current.balances.buyingPower)} /><Metric label="OAuth status" value={current.oauthStatus} /><Metric label="Last synchronized" value={time(current.lastSync)} /></div></section>
        <section className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5"><h3 className="text-sm font-semibold text-white">Connection controls</h3><div className="mt-4 grid gap-2"><button type="button" disabled={busy === current.id} onClick={() => sync(current)} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/10 text-xs font-semibold text-zinc-200 hover:border-emerald-300/30"><RefreshCw className={`h-4 w-4 ${busy === current.id ? 'animate-spin' : ''}`} />Synchronize portfolio</button><button type="button" onClick={() => begin(true)} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/10 text-xs font-semibold text-zinc-200 hover:border-emerald-300/30"><ExternalLink className="h-4 w-4" />Reconnect OAuth</button><button type="button" onClick={() => setDisconnecting(current)} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-red-400/20 text-xs font-semibold text-red-200 hover:bg-red-400/[0.06]"><Unplug className="h-4 w-4" />Disconnect</button></div></section>
      </div> : <div className="mt-7 grid gap-5 lg:grid-cols-[1fr_.85fr]">
        <section className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5"><h3 className="text-sm font-semibold text-white">Permissions requested</h3><div className="mt-4 grid gap-3 sm:grid-cols-2">{selected.permissions.map(permission => <div key={permission} className="flex items-center gap-2 text-sm text-zinc-300"><Check className="h-4 w-4 text-emerald-300" />{permission}</div>)}</div><div className="mt-6 border-t border-white/[0.07] pt-5"><p className="text-xs font-medium text-zinc-300">Trading environment</p><div className="mt-3 grid grid-cols-2 gap-2">{selected.paperTrading && <EnvironmentButton label="Paper" active={environment === 'paper'} onClick={() => setEnvironment('paper')} />}{selected.liveTrading && <EnvironmentButton label="Live" active={environment === 'live'} onClick={() => setEnvironment('live')} />}</div></div></section>
        <section className="rounded-lg border border-emerald-300/20 bg-emerald-300/[0.025] p-5"><LockKeyhole className="h-5 w-5 text-emerald-300" /><h3 className="mt-4 text-sm font-semibold text-white">Your credentials stay with {selected.name}</h3><p className="mt-2 text-xs leading-5 text-zinc-400">AI-Trader never sees or stores your password. OAuth tokens are encrypted at rest with AES-256-GCM and access can be revoked at any time.</p><button type="button" onClick={() => begin(false)} disabled={!selected.configured || busy === selected.provider} className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-emerald-300 px-4 text-sm font-semibold text-[#07100d] hover:bg-emerald-200 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400">Connect with {selected.name}<ExternalLink className="h-4 w-4" /></button>{!selected.configured && <p className="mt-3 text-center text-[11px] leading-4 text-amber-200/80">Provider registration must be completed by a workspace administrator.</p>}</section>
      </div>}
      <TrustStrip />
      {disconnecting && <DisconnectDialog connection={disconnecting} busy={busy === disconnecting.id} onCancel={() => setDisconnecting(null)} onConfirm={disconnect} />}
    </div>;
  }

  const currentBrokers = brokers.filter(item => item.available);
  const futureBrokers = brokers.filter(item => !item.available);
  return <div data-testid="broker-directory">
    <div><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-300">Broker connection center</p><h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">Connect your brokerage</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">Authorize account access directly with your broker. Select a provider to review assets, environments, and exact permissions before continuing.</p></div>
    {error && <div role="alert" className="mt-5 rounded-md border border-red-400/25 bg-red-400/[0.07] px-4 py-3 text-sm text-red-200">{error}</div>}
    <div className="mt-7 grid gap-3 md:grid-cols-2">{currentBrokers.map(broker => <BrokerCard key={broker.provider} broker={broker} onClick={() => { setSelected(broker); setEnvironment(broker.paperTrading ? 'paper' : 'live'); }} />)}</div>
    <div className="mt-9 border-t border-white/[0.07] pt-6"><h2 className="text-sm font-semibold text-zinc-300">Additional institutions</h2><p className="mt-1 text-xs text-zinc-500">These providers are listed for directory completeness and cannot be selected until an approved OAuth integration is available.</p><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{futureBrokers.map(broker => <div key={broker.provider} className="flex items-center gap-3 rounded-md border border-white/[0.06] bg-white/[0.015] px-3 py-3"><BrokerLogo broker={broker} /><div className="min-w-0"><p className="truncate text-xs font-medium text-zinc-400">{broker.name}</p><p className="font-mono text-[8px] uppercase tracking-wider text-zinc-600">Not enabled</p></div></div>)}</div></div>
    <TrustStrip />
  </div>;
}

function BrokerLogo({ broker, large = false }: { broker: BrokerDirectoryEntry; large?: boolean }) { return <div aria-label={`${broker.name} logo`} className={`flex shrink-0 items-center justify-center rounded-lg border border-white/10 bg-gradient-to-br from-white/[0.09] to-white/[0.025] font-mono font-semibold text-emerald-200 ${large ? 'h-14 w-14 text-base' : 'h-10 w-10 text-xs'}`}>{broker.monogram}</div>; }
function StatusPill({ status }: { status: string }) { const good = status === 'connected'; return <span className={`rounded-full border px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider ${good ? 'border-emerald-300/25 bg-emerald-300/[0.08] text-emerald-300' : 'border-amber-300/25 text-amber-200'}`}>{status}</span>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-md border border-white/[0.07] bg-black/10 px-3 py-3"><p className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">{label}</p><p className="mt-1 truncate text-sm font-medium capitalize text-zinc-200">{value}</p></div>; }
function EnvironmentButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) { return <button type="button" aria-pressed={active} onClick={onClick} className={`h-10 rounded-md border text-xs font-semibold ${active ? 'border-emerald-300/35 bg-emerald-300/[0.08] text-emerald-200' : 'border-white/10 text-zinc-400'}`}>{label}</button>; }
function BrokerCard({ broker, onClick }: { broker: BrokerDirectoryEntry; onClick: () => void }) { const connected = broker.connections.some(item => item.status === 'connected'); return <button type="button" onClick={onClick} className="group rounded-lg border border-white/[0.08] bg-white/[0.02] p-5 text-left transition hover:border-emerald-300/25 hover:bg-emerald-300/[0.025]"><div className="flex items-start justify-between gap-4"><BrokerLogo broker={broker} /><StatusPill status={connected ? 'connected' : broker.configured ? 'OAuth ready' : 'admin setup'} /></div><div className="mt-5 flex items-center justify-between gap-3"><div><h2 className="font-semibold text-white">{broker.name}</h2><p className="mt-1 text-xs text-zinc-500">{broker.assets.join(' · ')}</p></div><ChevronRight className="h-4 w-4 text-zinc-600 transition group-hover:translate-x-0.5 group-hover:text-emerald-300" /></div><div className="mt-4 flex flex-wrap gap-2 text-[9px] uppercase tracking-wider text-zinc-500"><span>OAuth</span>{broker.paperTrading && <span>Paper</span>}{broker.liveTrading && <span>Live</span>}</div></button>; }
function TrustStrip() { return <div className="mt-8 grid gap-3 border-t border-white/[0.07] pt-6 text-xs text-zinc-500 sm:grid-cols-4">{['No passwords stored', 'OAuth authorization', 'AES-256 encrypted', 'Disconnect anytime'].map(item => <div key={item} className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-300/70" />{item}</div>)}</div>; }
function DisconnectDialog({ connection, busy, onCancel, onConfirm }: { connection: BrokerConnection; busy: boolean; onCancel: () => void; onConfirm: () => void }) { return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4" role="presentation"><div role="alertdialog" aria-modal="true" aria-labelledby="disconnect-title" className="w-full max-w-lg rounded-lg border border-white/10 bg-[#0b1018] p-6 shadow-2xl"><div className="flex justify-between"><div><p className="font-mono text-[9px] uppercase tracking-wider text-red-300">Revoke access</p><h2 id="disconnect-title" className="mt-2 text-xl font-semibold text-white">Disconnect {connection.brokerName}?</h2></div><button aria-label="Close disconnect dialog" onClick={onCancel}><X className="h-5 w-5 text-zinc-500" /></button></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><div><p className="text-xs font-semibold text-zinc-300">This removes</p>{['OAuth tokens', 'Broker session', 'Portfolio cache', 'Position cache', 'Buying power cache'].map(item => <p key={item} className="mt-2 flex items-center gap-2 text-xs text-zinc-400"><Check className="h-3 w-3 text-red-300" />{item}</p>)}</div><div><p className="text-xs font-semibold text-zinc-300">This will not remove</p>{['Workspace', 'Journal', 'AI memory', 'Strategies', 'Watchlists', 'Notifications'].map(item => <p key={item} className="mt-2 flex items-center gap-2 text-xs text-zinc-400"><Check className="h-3 w-3 text-emerald-300" />{item}</p>)}</div></div><div className="mt-7 grid grid-cols-2 gap-3"><button onClick={onCancel} className="h-10 rounded-md border border-white/10 text-sm text-zinc-300">Cancel</button><button disabled={busy} onClick={onConfirm} className="h-10 rounded-md bg-red-400 text-sm font-semibold text-[#1b0808] disabled:opacity-60">{busy ? 'Disconnecting…' : 'Disconnect'}</button></div></div></div>; }
