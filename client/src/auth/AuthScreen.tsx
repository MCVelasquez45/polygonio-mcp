import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { useAuth } from './AuthContext';

type AuthMode = 'login' | 'register' | 'forgot' | 'reset' | 'verify';

function currentMode(): { mode: AuthMode; token: string | null; error: string | null } {
  if (typeof window === 'undefined') return { mode: 'login', token: null, error: null };
  const url = new URL(window.location.href);
  const token = url.searchParams.get('token');
  const error = url.searchParams.get('error');
  if (url.pathname.includes('/auth/register')) return { mode: 'register', token, error };
  if (url.pathname.includes('/auth/forgot')) return { mode: 'forgot', token, error };
  if (url.pathname.includes('/auth/reset')) return { mode: 'reset', token, error };
  if (url.pathname.includes('/auth/verify')) return { mode: 'verify', token, error };
  return { mode: 'login', token, error };
}

function navigate(mode: AuthMode): void {
  const path = mode === 'login' ? '/auth/login' : `/auth/${mode}`;
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function friendlyError(error: unknown): string {
  const code = String((error as any)?.response?.data?.error ?? '');
  if (code === 'EMAIL_VERIFICATION_REQUIRED') return 'Check your inbox and verify your email before signing in.';
  if (code === 'INVALID_CREDENTIALS') return 'The email or password is incorrect.';
  if (code === 'PASSWORD_POLICY_FAILED') return 'Use at least 12 characters, or choose a longer passphrase.';
  if (code === 'GOOGLE_OAUTH_NOT_CONFIGURED') return 'Google sign-in is temporarily unavailable. Use email sign-in instead.';
  if (code === 'IDENTITY_STORE_UNAVAILABLE') return 'Secure sign-in is temporarily unavailable. Please try again shortly.';
  if (code === 'INVALID_OR_EXPIRED_TOKEN') return 'This secure link has expired. Request a new one to continue.';
  if (code === 'CSRF_VALIDATION_FAILED') return 'Your secure session expired. Refresh the page and try again.';
  return 'We could not complete the request. Please try again.';
}

function modeCopy(mode: AuthMode): { eyebrow: string; title: string; body: string; cta: string } {
  if (mode === 'register') {
    return {
      eyebrow: 'Create account',
      title: 'Establish your identity',
      body: 'Verify your account first. Your trading workspace is provisioned securely after sign-in.',
      cta: 'Create secure account',
    };
  }
  if (mode === 'forgot') {
    return {
      eyebrow: 'Account recovery',
      title: 'Reset your password',
      body: 'We will send a time-limited recovery link if the address belongs to an account.',
      cta: 'Send recovery link',
    };
  }
  if (mode === 'reset') {
    return {
      eyebrow: 'Account recovery',
      title: 'Set a new password',
      body: 'Choose a strong passphrase. Existing device sessions will be revoked automatically.',
      cta: 'Update password',
    };
  }
  if (mode === 'verify') {
    return {
      eyebrow: 'Email verification',
      title: 'Confirm your identity',
      body: 'Verify ownership of your email address before entering the trading workspace.',
      cta: 'Verify email',
    };
  }
  return {
    eyebrow: 'Institutional access',
    title: 'Sign in to AI-Trader',
    body: 'Enter your research, risk, and execution workspace through a verified operator identity.',
    cta: 'Sign in securely',
  };
}

const MARKET_ROWS = [
  ['SPY', '604.81', '+0.42%'],
  ['QQQ', '532.19', '+0.67%'],
  ['NVDA', '182.73', '+1.18%'],
  ['AAPL', '231.44', '-0.16%'],
] as const;

export function AuthScreen() {
  const auth = useAuth();
  const [route, setRoute] = useState(currentMode);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(route.error ? 'Google sign-in was not completed. Please try again.' : null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(false);

  useEffect(() => {
    const listener = () => setRoute(currentMode());
    window.addEventListener('popstate', listener);
    return () => window.removeEventListener('popstate', listener);
  }, []);

  const copy = useMemo(() => modeCopy(route.mode), [route.mode]);

  const setMode = (mode: AuthMode) => {
    setError(null);
    setMessage(null);
    setPassword('');
    navigate(mode);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (route.mode === 'login') {
        await auth.login({ email, password, rememberMe });
        return;
      }
      if (route.mode === 'register') {
        await auth.register({ email, password, name });
        setMessage('Check your inbox to verify your email and activate your account.');
        return;
      }
      if (route.mode === 'forgot') {
        await auth.forgotPassword(email);
        setMessage('If the address belongs to an account, a recovery link is on its way.');
        return;
      }
      if (route.mode === 'reset') {
        await auth.resetPassword(route.token ?? '', password);
        navigate('login');
        setMessage('Password updated. Sign in with your new credential.');
        return;
      }
      await auth.verifyEmail(route.token ?? '');
      navigate('login');
      setMessage('Email verified. You can now sign in.');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const startGoogle = () => {
    setOauthBusy(true);
    setError(null);
    auth.signInWithGoogle();
  };

  const passwordMode = route.mode !== 'forgot' && route.mode !== 'verify';

  return (
    <main className="min-h-screen overflow-hidden bg-[#06080c] text-intel-ink">
      <div className="grid min-h-screen lg:grid-cols-[minmax(440px,580px)_1fr]">
        <section className="relative z-10 flex min-h-screen flex-col border-r border-white/[0.07] bg-[#090c12] px-5 py-5 sm:px-10 sm:py-7 lg:px-14">
          <header className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-emerald-300/25 bg-emerald-300/[0.08] font-mono text-sm font-semibold text-emerald-300">
                AT
              </div>
              <div>
                <p className="text-[15px] font-semibold text-white">AI-Trader</p>
                <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-500">Identity control</p>
              </div>
            </div>
            <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Systems operational
            </div>
          </header>

          <div className="mx-auto flex w-full max-w-[440px] flex-1 items-center py-10 sm:py-14">
            <form onSubmit={submit} className="w-full" aria-busy={busy || oauthBusy}>
              <div className="mb-7">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-300">{copy.eyebrow}</p>
                <h1 className="mt-3 text-3xl font-semibold leading-tight text-white sm:text-[34px]">{copy.title}</h1>
                <p className="mt-3 max-w-md text-sm leading-6 text-zinc-400">{copy.body}</p>
              </div>

              {route.mode === 'login' && (
                <div className="space-y-2.5">
                  <button
                    type="button"
                    onClick={startGoogle}
                    disabled={!auth.googleConfigured || oauthBusy || busy}
                    aria-label="Continue with Google"
                    className="group inline-flex h-12 w-full items-center justify-center gap-3 rounded-md border border-zinc-600 bg-white px-4 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-300/60 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-500"
                  >
                    {oauthBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center rounded-full border border-zinc-300 text-xs font-bold">G</span>}
                    {oauthBusy ? 'Connecting to Google...' : 'Continue with Google'}
                  </button>
                  <button
                    type="button"
                    disabled
                    aria-label="Continue with Microsoft"
                    className="inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-md border border-white/10 bg-white/[0.025] px-4 text-sm font-medium text-zinc-500 disabled:cursor-not-allowed"
                  >
                    <Building2 className="h-4 w-4" />
                    Continue with Microsoft
                    <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-600">Soon</span>
                  </button>
                </div>
              )}

              {route.mode === 'login' && (
                <div className="my-6 flex items-center gap-3 font-mono text-[9px] uppercase tracking-[0.15em] text-zinc-600">
                  <span className="h-px flex-1 bg-white/[0.08]" />
                  Or use email
                  <span className="h-px flex-1 bg-white/[0.08]" />
                </div>
              )}

              <div className="space-y-4">
                {route.mode !== 'reset' && route.mode !== 'verify' && (
                  <label className="block">
                    <span className="text-xs font-medium text-zinc-300">Work email</span>
                    <div className="relative mt-1.5">
                      <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
                      <input
                        className="h-11 w-full rounded-md border border-white/10 bg-[#0d1118] pl-10 pr-3 text-sm text-white outline-none transition placeholder:text-zinc-700 hover:border-white/20 focus:border-emerald-300/50 focus:ring-1 focus:ring-emerald-300/20"
                        type="email"
                        value={email}
                        onChange={event => setEmail(event.target.value)}
                        autoComplete="email"
                        placeholder="name@company.com"
                        required
                      />
                    </div>
                  </label>
                )}

                {route.mode === 'register' && (
                  <label className="block">
                    <span className="text-xs font-medium text-zinc-300">Full name</span>
                    <input
                      className="mt-1.5 h-11 w-full rounded-md border border-white/10 bg-[#0d1118] px-3.5 text-sm text-white outline-none transition placeholder:text-zinc-700 hover:border-white/20 focus:border-emerald-300/50 focus:ring-1 focus:ring-emerald-300/20"
                      value={name}
                      onChange={event => setName(event.target.value)}
                      autoComplete="name"
                      placeholder="Your name"
                      required
                    />
                  </label>
                )}

                {passwordMode && (
                  <div className="block">
                    <label htmlFor="identity-password" className="text-xs font-medium text-zinc-300">Password</label>
                    <div className="relative mt-1.5">
                      <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
                      <input
                        id="identity-password"
                        className="h-11 w-full rounded-md border border-white/10 bg-[#0d1118] pl-10 pr-11 text-sm text-white outline-none transition placeholder:text-zinc-700 hover:border-white/20 focus:border-emerald-300/50 focus:ring-1 focus:ring-emerald-300/20"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={event => setPassword(event.target.value)}
                        autoComplete={route.mode === 'login' ? 'current-password' : 'new-password'}
                        placeholder={route.mode === 'login' ? 'Enter your password' : 'At least 12 characters'}
                        minLength={route.mode === 'login' ? undefined : 12}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(value => !value)}
                        className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-zinc-500 hover:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-300/40"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {route.mode === 'login' && (
                <div className="mt-4 flex items-center justify-between gap-3 text-xs">
                  <label className="inline-flex items-center gap-2 text-zinc-400">
                    <input className="h-4 w-4 accent-emerald-400" type="checkbox" checked={rememberMe} onChange={event => setRememberMe(event.target.checked)} />
                    Remember this device
                  </label>
                  <button type="button" onClick={() => setMode('forgot')} className="text-emerald-300 transition hover:text-emerald-200">
                    Forgot password?
                  </button>
                </div>
              )}

              {message && (
                <div role="status" className="mt-5 flex gap-2.5 rounded-md border border-emerald-400/20 bg-emerald-400/[0.07] px-3.5 py-3 text-sm leading-5 text-emerald-200">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{message}</span>
                </div>
              )}
              {error && (
                <div role="alert" className="mt-5 rounded-md border border-red-400/20 bg-red-400/[0.07] px-3.5 py-3 text-sm leading-5 text-red-200">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={busy || oauthBusy}
                className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-emerald-300/40 bg-emerald-300 px-4 text-sm font-semibold text-[#07100d] transition hover:bg-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-200/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : route.mode === 'forgot' ? <Mail className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
                {busy ? 'Securing request...' : copy.cta}
                {!busy && <ArrowRight className="h-4 w-4" />}
              </button>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-zinc-500">
                {route.mode !== 'login' && <button type="button" onClick={() => setMode('login')} className="hover:text-emerald-300">Sign in</button>}
                {route.mode !== 'register' && <button type="button" onClick={() => setMode('register')} className="hover:text-emerald-300">Create account</button>}
                {route.mode !== 'forgot' && route.mode !== 'login' && <button type="button" onClick={() => setMode('forgot')} className="hover:text-emerald-300">Recover account</button>}
              </div>
            </form>
          </div>

          <footer className="grid grid-cols-3 gap-2 border-t border-white/[0.07] pt-4 font-mono text-[9px] uppercase tracking-[0.1em] text-zinc-600">
            {['Encrypted sessions', 'Role-based access', 'Audit-ready'].map(label => (
              <span key={label} className="flex items-center gap-1.5"><Check className="h-3 w-3 text-emerald-400" />{label}</span>
            ))}
          </footer>
        </section>

        <section className="relative hidden min-h-screen overflow-hidden bg-[#05070a] lg:block" aria-label="AI-Trader workspace preview">
          <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:42px_42px]" />
          <div className="relative flex h-full flex-col px-10 py-8 xl:px-14 xl:py-10">
            <div className="flex items-center justify-between border-b border-white/[0.07] pb-5">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-600">AI-Trader / Command workspace</p>
                <p className="mt-1.5 text-sm font-medium text-zinc-300">Institutional market operations</p>
              </div>
              <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.12em] text-emerald-300">
                <ShieldCheck className="h-4 w-4" /> Verified access only
              </div>
            </div>

            <div className="flex flex-1 items-center py-12">
              <div className="w-full max-w-4xl">
                <div className="max-w-2xl">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-300">Research / Risk / Execution</p>
                  <h2 className="mt-5 text-4xl font-semibold leading-[1.15] text-white xl:text-5xl">One controlled workspace for every trading decision.</h2>
                  <p className="mt-5 max-w-xl text-base leading-7 text-zinc-400">Market context, governed AI analysis, and paper execution stay connected to one accountable operator identity.</p>
                </div>

                <div className="mt-12 border-y border-white/[0.08] bg-black/20">
                  <div className="grid grid-cols-[1.2fr_1fr_1fr] border-b border-white/[0.07] px-4 py-2.5 font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-600">
                    <span>Instrument</span><span className="text-right">Last</span><span className="text-right">Session</span>
                  </div>
                  {MARKET_ROWS.map(([symbol, price, change]) => (
                    <div key={symbol} className="grid h-12 grid-cols-[1.2fr_1fr_1fr] items-center border-b border-white/[0.05] px-4 last:border-0">
                      <span className="flex items-center gap-2 text-sm font-semibold text-zinc-200"><TrendingUp className="h-3.5 w-3.5 text-zinc-600" />{symbol}</span>
                      <span className="text-right font-mono text-xs text-zinc-300">{price}</span>
                      <span className={`text-right font-mono text-xs ${change.startsWith('+') ? 'text-emerald-300' : 'text-red-300'}`}>{change}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 border-t border-white/[0.08] pt-5">
              {[
                ['Identity', 'Verified'],
                ['Session', 'Rotating'],
                ['Execution', 'Paper mode'],
              ].map(([label, value]) => (
                <div key={label} className="border-r border-white/[0.07] px-4 first:pl-0 last:border-0">
                  <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-600">{label}</p>
                  <p className="mt-1.5 text-sm font-medium text-zinc-300">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
