import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  SlidersHorizontal,
  WalletCards,
} from 'lucide-react';
import { useAuth } from './AuthContext';
import type { WorkspaceSummary } from './authApi';

const STEPS = ['Welcome', 'Broker', 'AI profile', 'Risk controls', 'Ready'] as const;

const fieldClass = 'mt-1.5 h-11 w-full rounded-md border border-white/10 bg-[#0d131c] px-3 text-sm text-white outline-none focus:border-emerald-300/50 focus:ring-1 focus:ring-emerald-300/20';

export function OnboardingScreen() {
  const auth = useAuth();
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [experience, setExperience] = useState(auth.user?.profile.tradingExperience ?? 'none');
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [riskTolerance, setRiskTolerance] = useState<'conservative' | 'balanced' | 'aggressive'>('balanced');
  const [personality, setPersonality] = useState<'institutional' | 'research' | 'execution' | 'automation'>('institutional');
  const [maximumDailyLoss, setMaximumDailyLoss] = useState(500);
  const [maximumPositionSize, setMaximumPositionSize] = useState(5000);
  const [automationAllowed, setAutomationAllowed] = useState(false);

  useEffect(() => {
    auth.getWorkspace()
      .then(next => {
        setWorkspace(next);
        setStep(Math.min(next.onboarding.currentStep, 4));
        setRiskTolerance(next.aiProfile.riskTolerance);
        setPersonality(next.aiProfile.personality);
        setMaximumDailyLoss(next.riskProfile.maximumDailyLoss);
        setMaximumPositionSize(next.riskProfile.maximumPositionSize);
        setAutomationAllowed(next.riskProfile.automationAllowed);
      })
      .catch(() => setError('Workspace provisioning could not be verified. Try again.'))
      .finally(() => setBusy(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const brokerConnected = workspace?.brokerOnboarding.status === 'connected';
  const alpacaConnection = workspace?.brokerOnboarding.connections?.find(connection => connection.provider === 'alpaca');
  const paperConnection = workspace?.brokerOnboarding.connections?.find(connection => connection.provider === 'paper');
  const progress = useMemo(() => `${Math.round(((step + 1) / STEPS.length) * 100)}%`, [step]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch {
      setError('The workspace update did not complete. Your prior settings are safe; please retry.');
    } finally {
      setBusy(false);
    }
  };

  const continueFromWelcome = () => run(async () => {
    const next = await auth.updateOnboarding({ currentStep: 1, timezone });
    setWorkspace(next);
    setStep(1);
  });

  const connectPaper = () => run(async () => {
    const next = await auth.connectPaperBroker();
    setWorkspace(next);
  });

  const connectAlpaca = () => run(async () => {
    const next = await auth.connectAlpacaBroker();
    setWorkspace(next);
  });

  const continueFromBroker = () => run(async () => {
    const next = await auth.updateOnboarding({ currentStep: 2 });
    setWorkspace(next);
    setStep(2);
  });

  const saveAiProfile = () => run(async () => {
    const next = await auth.updateOnboarding({
      currentStep: 3,
      timezone,
      tradingExperience: experience,
      aiProfile: { riskTolerance, personality },
    });
    setWorkspace(next);
    setStep(3);
  });

  const saveRisk = () => run(async () => {
    const next = await auth.updateOnboarding({
      currentStep: 4,
      riskProfile: {
        maximumDailyLoss,
        maximumPositionSize,
        automationAllowed,
        paperTrading: true,
        emergencyStop: true,
      },
    });
    setWorkspace(next);
    setStep(4);
  });

  const launch = () => run(async () => {
    const next = await auth.completeOnboarding();
    window.localStorage.setItem('ai-trader.workspace-layouts', JSON.stringify(next.layouts));
    window.history.replaceState({}, '', '/terminal');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });

  if (!workspace && busy) {
    return <div className="flex min-h-screen items-center justify-center bg-[#06080c] text-sm text-zinc-400"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Provisioning secure workspace…</div>;
  }

  return (
    <main className="min-h-screen bg-[#06080c] text-zinc-100">
      <header className="border-b border-white/[0.07] bg-[#090c12] px-5 py-4 sm:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md border border-emerald-300/25 bg-emerald-300/[0.08] font-mono text-xs font-semibold text-emerald-300">AT</div>
            <div><p className="text-sm font-semibold text-white">AI-Trader</p><p className="font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-500">Operator provisioning</p></div>
          </div>
          <div className="hidden items-center gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-emerald-300 sm:flex"><ShieldCheck className="h-4 w-4" />Identity verified</div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-8 sm:px-8 lg:grid-cols-[230px_1fr] lg:py-12">
        <aside>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">Workspace setup</p>
          <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full bg-emerald-400 transition-all" style={{ width: progress }} /></div>
          <ol className="mt-5 grid grid-cols-5 gap-2 lg:grid-cols-1">
            {STEPS.map((label, index) => (
              <li key={label} className={`flex items-center gap-3 rounded-md px-2 py-2 text-xs ${index === step ? 'bg-white/[0.05] text-white' : index < step ? 'text-emerald-300' : 'text-zinc-600'}`}>
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[9px] ${index <= step ? 'border-emerald-400/40' : 'border-white/10'}`}>{index < step ? <Check className="h-3 w-3" /> : index + 1}</span>
                <span className="hidden lg:inline">{label}</span>
              </li>
            ))}
          </ol>
          <div className="mt-7 hidden border-t border-white/[0.07] pt-5 text-xs leading-5 text-zinc-500 lg:block">Estimated time<br /><span className="font-medium text-zinc-300">2–3 minutes</span></div>
        </aside>

        <section className="min-h-[560px] rounded-lg border border-white/[0.08] bg-[#090d14] p-5 shadow-2xl shadow-black/30 sm:p-8 lg:p-10">
          {error && <div role="alert" className="mb-6 rounded-md border border-red-400/20 bg-red-400/[0.07] px-4 py-3 text-sm text-red-200">{error}</div>}

          {step === 0 && <div className="max-w-2xl">
            <div className="flex h-12 w-12 items-center justify-center rounded-md border border-emerald-300/20 bg-emerald-300/[0.07]"><Building2 className="h-5 w-5 text-emerald-300" /></div>
            <p className="mt-8 font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-300">Identity verified</p>
            <h1 className="mt-3 text-3xl font-semibold text-white sm:text-4xl">Welcome to AI-Trader</h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-zinc-400">Let’s configure your governed trading workspace. Organization, membership, audit profile, AI memory, journal, layouts, and watchlists have already been provisioned.</p>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">{['Enterprise workspace', 'Default watchlist', 'Audit logging'].map(item => <div key={item} className="rounded-md border border-white/[0.07] bg-white/[0.02] px-4 py-4 text-xs text-zinc-300"><CheckCircle2 className="mb-3 h-4 w-4 text-emerald-400" />{item}</div>)}</div>
            <button onClick={continueFromWelcome} disabled={busy} className="mt-9 inline-flex h-11 items-center gap-2 rounded-md bg-emerald-300 px-5 text-sm font-semibold text-[#07100d] hover:bg-emerald-200 disabled:opacity-50">Continue <ArrowRight className="h-4 w-4" /></button>
          </div>}

          {step === 1 && <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-300">Broker connection</p><h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">Select an execution environment</h1><p className="mt-3 text-sm text-zinc-400">Connect the deployment’s governed Alpaca account, or start safely in an isolated simulator.</p>
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-emerald-300/20 bg-emerald-300/[0.035] p-5"><div className="flex items-start justify-between"><Building2 className="h-5 w-5 text-emerald-300" /><span className="font-mono text-[9px] uppercase tracking-wider text-emerald-300">{auth.alpacaConfigured ? (auth.alpacaPaper ? 'Paper account' : 'Live account') : 'Unavailable'}</span></div><h2 className="mt-5 font-semibold text-white">Alpaca</h2><p className="mt-1 text-xs leading-5 text-zinc-500">{auth.alpacaConfigured ? 'Verify the configured account and import status, type, currency, and buying power.' : 'Deployment credentials are not configured. Choose the simulator or ask an administrator.'}</p><button onClick={connectAlpaca} disabled={busy || !auth.alpacaConfigured || alpacaConnection?.status === 'connected'} className="mt-5 h-9 rounded-md border border-emerald-300/30 px-3 text-xs font-semibold text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50">{alpacaConnection?.status === 'connected' ? 'Alpaca Connected' : 'Connect Alpaca'}</button>{alpacaConnection?.status === 'connected' && <p className="mt-3 font-mono text-[9px] text-zinc-500">{alpacaConnection.accountType} · {alpacaConnection.currency ?? 'USD'} · {alpacaConnection.buyingPower == null ? 'Buying power unavailable' : `$${alpacaConnection.buyingPower.toLocaleString()} buying power`}</p>}</div>
              <div className="rounded-md border border-emerald-300/20 bg-emerald-300/[0.035] p-5"><div className="flex items-start justify-between"><WalletCards className="h-5 w-5 text-emerald-300" /><span className="font-mono text-[9px] uppercase tracking-wider text-emerald-300">Available</span></div><h2 className="mt-5 font-semibold text-white">Paper Trading</h2><p className="mt-1 text-xs leading-5 text-zinc-500">$100,000 simulated buying power · No live capital</p><button onClick={connectPaper} disabled={busy || paperConnection?.status === 'connected'} className="mt-5 h-9 rounded-md border border-emerald-300/30 px-3 text-xs font-semibold text-emerald-200 disabled:opacity-70">{paperConnection?.status === 'connected' ? 'Paper Connected' : 'Start Paper Workspace'}</button></div>
              {['Tradier', 'Interactive Brokers', 'Tastytrade'].map(provider => <div key={provider} className="rounded-md border border-white/[0.07] bg-white/[0.015] p-5"><div className="flex items-start justify-between"><Building2 className="h-5 w-5 text-zinc-600" /><span className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">Coming soon</span></div><h2 className="mt-5 font-semibold text-zinc-300">{provider}</h2><p className="mt-1 text-xs text-zinc-600">Provider connection is not enabled in this deployment.</p></div>)}
            </div>
            <button onClick={continueFromBroker} disabled={busy || !brokerConnected} className="mt-7 inline-flex h-11 items-center gap-2 rounded-md bg-emerald-300 px-5 text-sm font-semibold text-[#07100d] disabled:cursor-not-allowed disabled:opacity-40">Continue <ArrowRight className="h-4 w-4" /></button>
          </div>}

          {step === 2 && <div className="max-w-2xl">
            <Bot className="h-6 w-6 text-emerald-300" /><p className="mt-5 font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-300">AI profile</p><h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">Calibrate your operator profile</h1>
            <div className="mt-7 grid gap-5 sm:grid-cols-2"><label className="text-xs text-zinc-300">Trading experience<select aria-label="Trading experience" className={fieldClass} value={experience} onChange={event => setExperience(event.target.value as typeof experience)}>{['none','beginner','intermediate','advanced','professional'].map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></label><label className="text-xs text-zinc-300">Risk tolerance<select aria-label="Risk tolerance" className={fieldClass} value={riskTolerance} onChange={event => setRiskTolerance(event.target.value as typeof riskTolerance)}>{['conservative','balanced','aggressive'].map(value => <option key={value}>{value}</option>)}</select></label><label className="text-xs text-zinc-300">AI personality<select aria-label="AI personality" className={fieldClass} value={personality} onChange={event => setPersonality(event.target.value as typeof personality)}>{['institutional','research','execution','automation'].map(value => <option key={value}>{value}</option>)}</select></label><label className="text-xs text-zinc-300">Timezone<input aria-label="Timezone" className={fieldClass} value={timezone} onChange={event => setTimezone(event.target.value)} /></label></div>
            <button onClick={saveAiProfile} disabled={busy} className="mt-8 inline-flex h-11 items-center gap-2 rounded-md bg-emerald-300 px-5 text-sm font-semibold text-[#07100d] disabled:opacity-50">Save AI profile <ArrowRight className="h-4 w-4" /></button>
          </div>}

          {step === 3 && <div className="max-w-2xl">
            <SlidersHorizontal className="h-6 w-6 text-emerald-300" /><p className="mt-5 font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-300">Risk controls</p><h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">Set hard operating boundaries</h1><p className="mt-3 text-sm text-zinc-400">Emergency stop remains enabled. Alert categories are provisioned with secure defaults and can be refined later.</p>
            <div className="mt-7 grid gap-5 sm:grid-cols-2"><label className="text-xs text-zinc-300">Maximum daily loss ($)<input aria-label="Maximum daily loss" className={fieldClass} type="number" min="0" value={maximumDailyLoss} onChange={event => setMaximumDailyLoss(Number(event.target.value))} /></label><label className="text-xs text-zinc-300">Maximum position size ($)<input aria-label="Maximum position size" className={fieldClass} type="number" min="0" value={maximumPositionSize} onChange={event => setMaximumPositionSize(Number(event.target.value))} /></label></div>
            <label className="mt-6 flex items-center justify-between rounded-md border border-white/[0.08] bg-white/[0.02] p-4 text-sm text-zinc-300"><span><span className="block font-medium text-white">Allow automation</span><span className="mt-1 block text-xs text-zinc-500">AI may submit paper orders within configured risk limits.</span></span><input aria-label="Allow automation" className="h-4 w-4 accent-emerald-400" type="checkbox" checked={automationAllowed} onChange={event => setAutomationAllowed(event.target.checked)} /></label>
            <button onClick={saveRisk} disabled={busy} className="mt-8 inline-flex h-11 items-center gap-2 rounded-md bg-emerald-300 px-5 text-sm font-semibold text-[#07100d] disabled:opacity-50">Initialize workspace <ArrowRight className="h-4 w-4" /></button>
          </div>}

          {step === 4 && <div className="max-w-2xl">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-300/30 bg-emerald-300/[0.08]"><Check className="h-6 w-6 text-emerald-300" /></div><p className="mt-7 font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-300">Provisioning complete</p><h1 className="mt-3 text-3xl font-semibold text-white sm:text-4xl">Workspace ready</h1>
            <div className="mt-7 divide-y divide-white/[0.06] rounded-md border border-white/[0.08]">{['Identity verified', `${alpacaConnection?.status === 'connected' ? 'Alpaca' : 'Paper'} broker connected`, 'AI initialized', 'Risk profile created', 'Default watchlist created', 'Journal and memory seeded', 'Five layouts synchronized'].map(item => <div key={item} className="flex items-center gap-3 px-4 py-3 text-sm text-zinc-300"><CheckCircle2 className="h-4 w-4 text-emerald-400" />{item}</div>)}</div>
            <button onClick={launch} disabled={busy} className="mt-8 inline-flex h-11 items-center gap-2 rounded-md bg-emerald-300 px-5 text-sm font-semibold text-[#07100d] disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}Launch Trading Workspace <ArrowRight className="h-4 w-4" /></button>
          </div>}
        </section>
      </div>
    </main>
  );
}
