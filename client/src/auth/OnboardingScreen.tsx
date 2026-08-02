import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Bot, Check, CheckCircle2, Loader2, LockKeyhole, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { BrokerConnectionCenter } from '../components/brokerage/BrokerConnectionCenter';
import { useAuth } from './AuthContext';
import type { WorkspaceSummary } from './authApi';

const STEPS = ['Welcome', 'Broker', 'Risk', 'Initialize'];

function friendlyError(error: any): string {
  const code = error?.response?.data?.error;
  if (code === 'BROKER_CONNECTION_REQUIRED') return 'Connect a brokerage before initializing the trading terminal.';
  return 'Workspace provisioning could not complete. Your identity and saved configuration remain unchanged.';
}

export function OnboardingScreen() {
  const auth = useAuth();
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [experience, setExperience] = useState<WorkspaceSummary['aiProfile']['personality']>('institutional');
  const [riskTolerance, setRiskTolerance] = useState<WorkspaceSummary['aiProfile']['riskTolerance']>('balanced');
  const [maximumDailyLoss, setMaximumDailyLoss] = useState(500);
  const [maximumPositionSize, setMaximumPositionSize] = useState(5000);
  const [automationAllowed, setAutomationAllowed] = useState(false);

  const loadWorkspace = async () => {
    const next = await auth.getWorkspace();
    setWorkspace(next);
    setMaximumDailyLoss(next.riskProfile.maximumDailyLoss);
    setMaximumPositionSize(next.riskProfile.maximumPositionSize);
    setAutomationAllowed(next.riskProfile.automationAllowed);
    setRiskTolerance(next.aiProfile.riskTolerance);
    setExperience(next.aiProfile.personality);
    const callback = new URLSearchParams(window.location.search).get('connection');
    const connected = next.brokerOnboarding.connections.some(connection => connection.status === 'connected' && connection.provider !== 'paper');
    if (callback === 'success' && connected) setStep(2);
    else setStep(Math.min(3, next.onboarding.currentStep));
    return next;
  };

  useEffect(() => { loadWorkspace().catch(error => setError(friendlyError(error))).finally(() => setBusy(false)); }, []);

  const connected = useMemo(() => workspace?.brokerOnboarding.connections.some(connection => connection.status === 'connected' && connection.provider !== 'paper') ?? false, [workspace]);
  const progress = `${((step + 1) / STEPS.length) * 100}%`;
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(null); try { await action(); } catch (cause) { setError(friendlyError(cause)); } finally { setBusy(false); } };

  const continueWelcome = () => run(async () => { const next = await auth.updateOnboarding({ currentStep: 1 }); setWorkspace(next); setStep(1); });
  const saveRisk = () => run(async () => {
    const next = await auth.updateOnboarding({
      currentStep: 3,
      tradingExperience: auth.user?.profile.tradingExperience === 'none' ? 'intermediate' : auth.user?.profile.tradingExperience,
      aiProfile: { riskTolerance, personality: experience },
      riskProfile: { maximumDailyLoss, maximumPositionSize, automationAllowed, paperTrading: nextEnvironment(workspace) === 'paper', emergencyStop: true },
    });
    setWorkspace(next); setStep(3);
  });
  const launch = () => run(async () => {
    const next = await auth.completeOnboarding();
    window.localStorage.setItem('ai-trader.workspace-layouts', JSON.stringify(next.layouts));
    window.history.replaceState({}, '', '/terminal');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });

  if (!workspace && busy) return <div className="flex min-h-screen items-center justify-center bg-[#06080c] text-sm text-zinc-400"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Provisioning secure workspace…</div>;

  return <main className="min-h-screen bg-[#06080c] text-zinc-100">
    <header className="border-b border-white/[0.07] bg-[#090c12] px-5 py-4 sm:px-8"><div className="mx-auto flex max-w-6xl items-center justify-between gap-4"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-md border border-emerald-300/25 bg-emerald-300/[0.08] font-mono text-xs font-semibold text-emerald-300">AT</div><div><p className="text-sm font-semibold text-white">AI-Trader</p><p className="font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-500">Enterprise brokerage onboarding</p></div></div><div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-emerald-300"><ShieldCheck className="h-4 w-4" />Identity verified</div></div></header>
    <div className="mx-auto grid max-w-6xl gap-8 px-5 py-8 sm:px-8 lg:grid-cols-[220px_1fr] lg:py-12">
      <aside><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">Secure setup</p><div className="mt-4 h-1 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full bg-emerald-400 transition-all" style={{ width: progress }} /></div><ol className="mt-5 grid grid-cols-4 gap-2 lg:grid-cols-1">{STEPS.map((label, index) => <li key={label} className={`flex items-center gap-3 rounded-md px-2 py-2 text-xs ${index === step ? 'bg-white/[0.05] text-white' : index < step ? 'text-emerald-300' : 'text-zinc-600'}`}><span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[9px] ${index <= step ? 'border-emerald-400/40' : 'border-white/10'}`}>{index < step ? <Check className="h-3 w-3" /> : index + 1}</span><span className="hidden lg:inline">{label}</span></li>)}</ol><div className="mt-7 hidden border-t border-white/[0.07] pt-5 text-xs leading-5 text-zinc-500 lg:block">Protected by OAuth<br /><span className="font-medium text-zinc-300">No passwords shared</span></div></aside>
      <section className="min-h-[600px] rounded-lg border border-white/[0.08] bg-[#090d14] p-5 shadow-2xl shadow-black/30 sm:p-8 lg:p-10">
        {error && <div role="alert" className="mb-6 rounded-md border border-red-400/20 bg-red-400/[0.07] px-4 py-3 text-sm text-red-200">{error}</div>}
        {step === 0 && <div className="max-w-2xl"><div className="flex h-12 w-12 items-center justify-center rounded-md border border-emerald-300/20 bg-emerald-300/[0.07]"><ShieldCheck className="h-5 w-5 text-emerald-300" /></div><p className="mt-8 font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-300">Workspace established</p><h1 className="mt-3 text-3xl font-semibold text-white sm:text-4xl">Welcome to AI-Trader</h1><p className="mt-4 text-base text-zinc-300">Your secure workspace has been created.</p><div className="mt-8 divide-y divide-white/[0.06] rounded-md border border-white/[0.08]">{['Identity Verified', 'Secure Workspace', 'AI Memory Initialized', 'Portfolio Engine Ready'].map(item => <div key={item} className="flex items-center gap-3 px-4 py-3 text-sm text-zinc-300"><CheckCircle2 className="h-4 w-4 text-emerald-400" />{item}</div>)}</div><div className="mt-8"><p className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">Next step</p><p className="mt-1 text-lg font-semibold text-white">Connect Your Brokerage</p></div><button onClick={continueWelcome} disabled={busy} className="mt-6 inline-flex h-11 items-center gap-2 rounded-md bg-emerald-300 px-5 text-sm font-semibold text-[#07100d] hover:bg-emerald-200 disabled:opacity-50">Open Broker Connection Center <ArrowRight className="h-4 w-4" /></button></div>}
        {step === 1 && <div><BrokerConnectionCenter onConnected={() => loadWorkspace().catch(() => undefined)} />{connected && <button type="button" onClick={() => setStep(2)} className="mt-7 inline-flex h-11 items-center gap-2 rounded-md bg-emerald-300 px-5 text-sm font-semibold text-[#07100d]">Continue to risk profile <ArrowRight className="h-4 w-4" /></button>}</div>}
        {step === 2 && <div className="max-w-2xl"><SlidersHorizontal className="h-6 w-6 text-emerald-300" /><p className="mt-5 font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-300">Risk profile</p><h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">Set hard operating boundaries</h1><p className="mt-3 text-sm leading-6 text-zinc-400">These limits govern AI recommendations and automated execution. Emergency stop remains enabled.</p><div className="mt-7 grid gap-5 sm:grid-cols-2"><label className="text-xs text-zinc-300">Risk tolerance<select aria-label="Risk tolerance" className={fieldClass} value={riskTolerance} onChange={event => setRiskTolerance(event.target.value as typeof riskTolerance)}>{['conservative', 'balanced', 'aggressive'].map(value => <option key={value}>{value}</option>)}</select></label><label className="text-xs text-zinc-300">AI operating mode<select aria-label="AI operating mode" className={fieldClass} value={experience} onChange={event => setExperience(event.target.value as typeof experience)}>{['institutional', 'research', 'execution', 'automation'].map(value => <option key={value}>{value}</option>)}</select></label><label className="text-xs text-zinc-300">Maximum daily loss ($)<input aria-label="Maximum daily loss" className={fieldClass} type="number" min="0" value={maximumDailyLoss} onChange={event => setMaximumDailyLoss(Number(event.target.value))} /></label><label className="text-xs text-zinc-300">Maximum position size ($)<input aria-label="Maximum position size" className={fieldClass} type="number" min="0" value={maximumPositionSize} onChange={event => setMaximumPositionSize(Number(event.target.value))} /></label></div><label className="mt-6 flex items-center justify-between rounded-md border border-white/[0.08] bg-white/[0.02] p-4 text-sm text-zinc-300"><span><span className="block font-medium text-white">Allow automated execution</span><span className="mt-1 block text-xs text-zinc-500">Orders remain constrained by broker permissions and risk limits.</span></span><input aria-label="Allow automated execution" className="h-4 w-4 accent-emerald-400" type="checkbox" checked={automationAllowed} onChange={event => setAutomationAllowed(event.target.checked)} /></label><button onClick={saveRisk} disabled={busy} className="mt-8 inline-flex h-11 items-center gap-2 rounded-md bg-emerald-300 px-5 text-sm font-semibold text-[#07100d] disabled:opacity-50">Initialize AI workspace <ArrowRight className="h-4 w-4" /></button></div>}
        {step === 3 && <div className="max-w-2xl"><div className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-300/30 bg-emerald-300/[0.08]"><Bot className="h-6 w-6 text-emerald-300" /></div><p className="mt-7 font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-300">Initialization complete</p><h1 className="mt-3 text-3xl font-semibold text-white sm:text-4xl">Trading terminal ready</h1><div className="mt-7 divide-y divide-white/[0.06] rounded-md border border-white/[0.08]">{['Broker OAuth verified', 'Portfolio synchronized', 'Risk profile created', 'Trading preferences applied', 'AI memory initialized', 'Market context ready', 'Strategy engine ready', 'Journal and notifications ready'].map(item => <div key={item} className="flex items-center gap-3 px-4 py-3 text-sm text-zinc-300"><CheckCircle2 className="h-4 w-4 text-emerald-400" />{item}</div>)}</div><button onClick={launch} disabled={busy || !connected} className="mt-8 inline-flex h-11 items-center gap-2 rounded-md bg-emerald-300 px-5 text-sm font-semibold text-[#07100d] disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}Launch Trading Terminal <ArrowRight className="h-4 w-4" /></button></div>}
      </section>
    </div>
  </main>;
}

const fieldClass = 'mt-2 h-11 w-full rounded-md border border-white/[0.1] bg-[#06090e] px-3 text-sm text-white outline-none focus:border-emerald-300/40';
function nextEnvironment(workspace: WorkspaceSummary | null): 'paper' | 'live' { return workspace?.brokerOnboarding.connections.find(connection => connection.status === 'connected' && connection.provider !== 'paper')?.paper === false ? 'live' : 'paper'; }
