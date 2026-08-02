import { useEffect, useState } from 'react';
import { Building2, Link2, LogOut, MonitorSmartphone, UserRound, X } from 'lucide-react';
import { useAuth } from './AuthContext';
import type { SessionSummary, WorkspaceSummary } from './authApi';

export function ProfileMenu() {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [name, setName] = useState(auth.user?.profile.name ?? '');
  const [workspaceName, setWorkspaceName] = useState(auth.user?.profile.workspaceName ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(auth.user?.profile.name ?? '');
    setWorkspaceName(auth.user?.profile.workspaceName ?? '');
  }, [auth.user?.profile.name, auth.user?.profile.workspaceName]);

  useEffect(() => {
    if (!open) return;
    auth.listSessions().then(setSessions).catch(() => setSessions([]));
    auth.getWorkspace().then(setWorkspace).catch(() => setWorkspace(null));
  }, [auth, open]);

  const saveProfile = async () => {
    setBusy(true);
    try {
      await auth.updateProfile({ name, workspaceName });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    await auth.revokeSession(id);
    setSessions(prev => prev.filter(session => session.id !== id));
  };

  const initials = (auth.user?.profile.name || auth.user?.email || 'A').slice(0, 2).toUpperCase();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open operator profile"
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-intel-line px-2.5 text-sm text-intel-ink2 transition hover:border-intel-accentLine hover:text-intel-accent"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-intel-accentSoft font-mono text-[10px] text-intel-accent">{initials}</span>
        <span className="hidden max-w-[120px] truncate sm:inline">{auth.user?.profile.name || auth.user?.email}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/70 sm:px-3 sm:py-3" onClick={() => setOpen(false)} role="presentation">
          <aside
            role="dialog"
            aria-modal="true"
            className="flex h-full w-full flex-col border-l border-intel-line bg-intel-panel shadow-2xl sm:max-w-[440px] sm:rounded-panel sm:border"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-intel-line px-4 py-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-eyebrow text-intel-ink3">Identity</p>
                <h2 className="mt-1 text-lg font-semibold text-intel-ink">Profile</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-intel-line text-intel-ink2 hover:border-intel-accentLine hover:text-intel-accent" aria-label="Close profile">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
              <section className="rounded-md border border-intel-line bg-intel-bg p-3">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <UserRound className="h-4 w-4 text-intel-accent" />
                  Account
                </div>
                <label className="block">
                  <span className="text-xs uppercase tracking-label text-intel-ink3">Name</span>
                  <input className="mt-1 h-10 w-full rounded-md border border-intel-line bg-intel-panel px-3 text-sm outline-none focus:border-intel-accentLine" value={name} onChange={event => setName(event.target.value)} />
                </label>
                <label className="mt-3 block">
                  <span className="text-xs uppercase tracking-label text-intel-ink3">Workspace</span>
                  <input className="mt-1 h-10 w-full rounded-md border border-intel-line bg-intel-panel px-3 text-sm outline-none focus:border-intel-accentLine" value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} />
                </label>
                <button type="button" disabled={busy} onClick={saveProfile} className="mt-3 h-9 rounded-md border border-intel-accentLine px-3 text-sm font-semibold text-intel-accent disabled:opacity-60">Save profile</button>
              </section>

              <section className="rounded-md border border-intel-line bg-intel-bg p-3">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Building2 className="h-4 w-4 text-intel-accent" />
                  Workspace
                </div>
                <div className="grid gap-2 text-sm text-intel-ink2">
                  <div className="flex items-center justify-between gap-3 rounded-md border border-intel-lineSoft bg-intel-panel px-3 py-2">
                    <span>Organization</span>
                    <span className="truncate font-medium text-intel-ink">{workspace?.organization.name ?? auth.user?.profile.workspaceName ?? 'Workspace'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-md border border-intel-lineSoft bg-intel-panel px-3 py-2">
                    <span>Watchlist seed</span>
                    <span className="font-mono text-[11px] text-intel-ink">{workspace?.defaults.watchlist.map(item => item.symbol).join(' · ') || 'Prepared'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-md border border-intel-lineSoft bg-intel-panel px-3 py-2">
                    <span>AI memory</span>
                    <span className="font-mono text-[11px] uppercase tracking-label text-intel-pos">{workspace?.defaults.aiMemory.status ?? 'ready'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-md border border-intel-lineSoft bg-intel-panel px-3 py-2">
                    <span>Journal</span>
                    <span className="font-mono text-[11px] uppercase tracking-label text-intel-pos">{workspace?.defaults.journal.status ?? 'ready'}</span>
                  </div>
                </div>
              </section>

              <section className="rounded-md border border-intel-line bg-intel-bg">
                <div className="flex items-center justify-between gap-2 border-b border-intel-line px-3 py-2">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Link2 className="h-4 w-4 text-intel-accent" />
                    Connect Broker
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-label text-intel-ink3">Post-login</span>
                </div>
                <div className="grid gap-2 p-3 sm:grid-cols-2">
                  {(workspace?.brokerOnboarding.providers ?? [
                    { provider: 'alpaca', label: 'Alpaca', enabled: true },
                    { provider: 'tradier', label: 'Tradier', enabled: true },
                    { provider: 'ibkr', label: 'IBKR', enabled: true },
                    { provider: 'tastytrade', label: 'Tastytrade', enabled: true },
                    { provider: 'paper', label: 'Paper', enabled: true },
                  ]).map(provider => (
                    <button
                      key={provider.provider}
                      type="button"
                      disabled
                      className="flex h-10 items-center justify-between rounded-md border border-intel-lineSoft bg-intel-panel px-3 text-left text-sm text-intel-ink2 disabled:cursor-not-allowed disabled:opacity-80"
                    >
                      <span>{provider.label}</span>
                      <span className="font-mono text-[10px] uppercase tracking-label text-intel-ink3">Ready</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-md border border-intel-line bg-intel-bg">
                <div className="flex items-center gap-2 border-b border-intel-line px-3 py-2 text-sm font-semibold">
                  <MonitorSmartphone className="h-4 w-4 text-intel-accent" />
                  Device sessions
                </div>
                <div className="divide-y divide-intel-line">
                  {sessions.map(session => (
                    <div key={session.id} className="px-3 py-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-intel-ink">{session.device.ua || 'Unknown device'}</p>
                          <p className="mt-1 font-mono text-[10px] uppercase tracking-label text-intel-ink3">{session.current ? 'Current · ' : ''}{session.device.ip || 'Unknown IP'}</p>
                        </div>
                        {!session.current && (
                          <button type="button" onClick={() => revoke(session.id)} className="rounded-md border border-intel-line px-2 py-1 text-xs text-intel-ink2 hover:border-intel-neg/50 hover:text-intel-neg">Revoke</button>
                        )}
                      </div>
                    </div>
                  ))}
                  {!sessions.length && <div className="px-3 py-4 text-sm text-intel-ink3">No active sessions found.</div>}
                </div>
              </section>
            </div>

            <div className="grid grid-cols-2 gap-2 border-t border-intel-line px-4 py-3">
              <button type="button" onClick={auth.logoutAll} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-intel-line text-sm font-semibold text-intel-ink2 hover:border-intel-neg/50 hover:text-intel-neg">
                <LogOut className="h-4 w-4" />
                Logout all
              </button>
              <button type="button" onClick={auth.logout} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-intel-accentLine bg-intel-accent text-sm font-semibold text-intel-bg">
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
