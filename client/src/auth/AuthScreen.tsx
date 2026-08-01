import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useAuth } from './AuthContext';

type AuthMode = 'login' | 'register' | 'forgot' | 'reset' | 'verify';

function currentMode(): { mode: AuthMode; token: string | null; error: string | null } {
  if (typeof window === 'undefined') return { mode: 'login', token: null, error: null };
  const url = new URL(window.location.href);
  const path = url.pathname;
  const token = url.searchParams.get('token');
  const error = url.searchParams.get('error');
  if (path.includes('/auth/register')) return { mode: 'register', token, error };
  if (path.includes('/auth/forgot')) return { mode: 'forgot', token, error };
  if (path.includes('/auth/reset')) return { mode: 'reset', token, error };
  if (path.includes('/auth/verify')) return { mode: 'verify', token, error };
  return { mode: 'login', token, error };
}

function navigate(mode: AuthMode): void {
  const path =
    mode === 'register'
      ? '/auth/register'
      : mode === 'forgot'
        ? '/auth/forgot'
        : mode === 'reset'
          ? '/auth/reset'
          : mode === 'verify'
            ? '/auth/verify'
            : '/auth/login';
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function friendlyError(error: unknown): string {
  const code = String((error as any)?.response?.data?.error ?? '');
  if (code === 'EMAIL_VERIFICATION_REQUIRED') return 'Verify your email before signing in. You can request a new verification link below.';
  if (code === 'INVALID_CREDENTIALS') return 'The email or password did not match our records.';
  if (code === 'PASSWORD_POLICY_FAILED') return 'Use a longer password or passphrase before continuing.';
  if (code === 'GOOGLE_OAUTH_NOT_CONFIGURED') return 'Google sign-in is not available in this environment yet.';
  if (code === 'IDENTITY_STORE_UNAVAILABLE') return 'Secure sign-in is temporarily unavailable. Try again shortly.';
  if (code === 'INVALID_OR_EXPIRED_TOKEN') return 'This secure link is invalid or has expired.';
  return 'We could not complete that request. Review the details and try again.';
}

function modeCopy(mode: AuthMode): { eyebrow: string; title: string; body: string; cta: string } {
  if (mode === 'register') {
    return {
      eyebrow: 'New workspace',
      title: 'Create your trading workspace',
      body: 'Start with identity, then connect market data, broker access, and automation controls inside the secured terminal.',
      cta: 'Create account',
    };
  }
  if (mode === 'forgot') {
    return {
      eyebrow: 'Credential recovery',
      title: 'Reset your password',
      body: 'Enter the email for your AI-Trader account and we will send a time-limited recovery link.',
      cta: 'Send reset link',
    };
  }
  if (mode === 'reset') {
    return {
      eyebrow: 'New credential',
      title: 'Set a new password',
      body: 'Choose a strong passphrase. Existing device sessions will be revoked after the reset.',
      cta: 'Update password',
    };
  }
  if (mode === 'verify') {
    return {
      eyebrow: 'Account verification',
      title: 'Verify your email',
      body: 'Confirm ownership of this email address before enabling workspace access.',
      cta: 'Verify email',
    };
  }
  return {
    eyebrow: 'Secure sign in',
    title: 'Access AI-Trader',
    body: 'Use enterprise identity controls to enter your research, portfolio, and execution workspaces.',
    cta: 'Sign in',
  };
}

export function AuthScreen() {
  const auth = useAuth();
  const [route, setRoute] = useState(currentMode);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
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
        await auth.register({ email, password, name, workspaceName: 'AI-Trader Workspace' });
        setMessage('Your account request was received. Check your email to verify access.');
        return;
      }
      if (route.mode === 'forgot') {
        await auth.forgotPassword(email);
        setMessage('If an account exists for that email, a recovery link has been sent.');
        return;
      }
      if (route.mode === 'reset') {
        await auth.resetPassword(route.token ?? '', password);
        setMessage('Your password has been updated. Sign in with the new credential.');
        setMode('login');
        return;
      }
      if (route.mode === 'verify') {
        await auth.verifyEmail(route.token ?? '');
        setMessage('Your email is verified. Sign in to continue.');
        setMode('login');
      }
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

  return (
    <main className="min-h-screen bg-[#05070b] text-intel-ink">
      <div className="grid min-h-screen lg:grid-cols-[minmax(380px,520px)_1fr]">
        <section className="flex min-h-screen flex-col border-r border-intel-line bg-intel-bg px-5 py-5 sm:px-8">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-intel-accentLine bg-intel-accentSoft">
                <ShieldCheck className="h-5 w-5 text-intel-accent" />
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-eyebrow text-intel-ink3">AI-Trader</p>
                <h1 className="text-base font-semibold text-intel-ink">Identity Gateway</h1>
              </div>
            </div>
            <span className="hidden rounded-md border border-intel-line px-2 py-1 font-mono text-[10px] uppercase tracking-label text-intel-ink3 sm:inline">
              V3
            </span>
          </div>

          <div className="flex flex-1 items-center py-8">
            <form onSubmit={submit} className="w-full space-y-5">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-eyebrow text-intel-accent">{copy.eyebrow}</p>
                <h2 className="mt-2 text-2xl font-semibold text-intel-ink sm:text-3xl">{copy.title}</h2>
                <p className="mt-3 max-w-md text-sm leading-6 text-intel-ink2">{copy.body}</p>
              </div>

              {route.mode === 'login' && (
                <div className="grid gap-2">
                  <button
                    type="button"
                    onClick={startGoogle}
                    disabled={!auth.googleConfigured || oauthBusy || busy}
                    aria-label="Continue with Google"
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-intel-line bg-intel-panel text-sm font-semibold text-intel-ink transition hover:border-intel-accentLine disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {oauthBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <span aria-hidden="true" className="font-semibold">G</span>}
                    Continue with Google
                  </button>
                  <button
                    type="button"
                    disabled
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-intel-lineSoft bg-intel-panel/70 text-sm font-semibold text-intel-ink3 disabled:cursor-not-allowed"
                  >
                    <Building2 className="h-4 w-4" />
                    Continue with Microsoft
                  </button>
                </div>
              )}

              {route.mode === 'login' && (
                <div className="flex items-center gap-3 text-xs uppercase tracking-label text-intel-ink3">
                  <span className="h-px flex-1 bg-intel-line" />
                  Email sign in
                  <span className="h-px flex-1 bg-intel-line" />
                </div>
              )}

              {route.mode !== 'reset' && route.mode !== 'verify' && (
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-label text-intel-ink3">Email</span>
                  <input
                    className="mt-1 h-11 w-full rounded-md border border-intel-line bg-intel-panel px-3 text-sm text-intel-ink outline-none transition focus:border-intel-accentLine"
                    type="email"
                    value={email}
                    onChange={event => setEmail(event.target.value)}
                    autoComplete="email"
                    required
                  />
                </label>
              )}

              {route.mode === 'register' && (
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-label text-intel-ink3">Full name</span>
                  <input
                    className="mt-1 h-11 w-full rounded-md border border-intel-line bg-intel-panel px-3 text-sm text-intel-ink outline-none transition focus:border-intel-accentLine"
                    value={name}
                    onChange={event => setName(event.target.value)}
                    autoComplete="name"
                  />
                </label>
              )}

              {route.mode !== 'forgot' && route.mode !== 'verify' && (
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-label text-intel-ink3">Password</span>
                  <input
                    className="mt-1 h-11 w-full rounded-md border border-intel-line bg-intel-panel px-3 text-sm text-intel-ink outline-none transition focus:border-intel-accentLine"
                    type="password"
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    autoComplete={route.mode === 'login' ? 'current-password' : 'new-password'}
                    required
                  />
                </label>
              )}

              {route.mode === 'login' && (
                <div className="flex items-center justify-between gap-3 text-sm">
                  <label className="inline-flex items-center gap-2 text-intel-ink2">
                    <input type="checkbox" checked={rememberMe} onChange={event => setRememberMe(event.target.checked)} />
                    Remember this device
                  </label>
                  <button type="button" onClick={() => setMode('forgot')} className="text-intel-accent hover:text-intel-ink">
                    Forgot password?
                  </button>
                </div>
              )}

              {message && (
                <div className="flex gap-2 rounded-md border border-intel-pos/30 bg-intel-pos/10 px-3 py-2 text-sm text-intel-pos">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{message}</span>
                </div>
              )}
              {error && (
                <div className="rounded-md border border-intel-neg/30 bg-intel-neg/10 px-3 py-2 text-sm text-intel-neg">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={busy || oauthBusy}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-intel-accentLine bg-intel-accent px-4 text-sm font-semibold text-intel-bg transition hover:brightness-110 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : route.mode === 'forgot' ? <Mail className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
                {busy ? 'Securing request...' : copy.cta}
                {!busy && <ArrowRight className="h-4 w-4" />}
              </button>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-intel-ink3">
                {route.mode !== 'login' && <button type="button" onClick={() => setMode('login')} className="hover:text-intel-accent">Sign in</button>}
                {route.mode !== 'register' && <button type="button" onClick={() => setMode('register')} className="hover:text-intel-accent">Create account</button>}
                {route.mode !== 'forgot' && route.mode !== 'login' && <button type="button" onClick={() => setMode('forgot')} className="hover:text-intel-accent">Forgot password</button>}
              </div>
            </form>
          </div>

          <div className="grid gap-2 border-t border-intel-line pt-4 text-xs text-intel-ink3 sm:grid-cols-3">
            <div className="flex items-center gap-2"><LockKeyhole className="h-3.5 w-3.5 text-intel-accent" /> HttpOnly sessions</div>
            <div className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-intel-accent" /> CSRF protected</div>
            <div className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-intel-accent" /> Audit logged</div>
          </div>
        </section>

        <section className="hidden min-h-screen flex-col justify-between overflow-hidden bg-[#080d14] px-10 py-8 lg:flex">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-eyebrow text-intel-ink3">Institutional trading operations</p>
            <span className="rounded-md border border-intel-line px-2 py-1 font-mono text-[10px] uppercase tracking-label text-intel-ink3">Secure workspace</span>
          </div>
          <div className="max-w-3xl">
            <p className="font-mono text-[11px] uppercase tracking-eyebrow text-intel-accent">Research · Risk · Execution</p>
            <h3 className="mt-4 max-w-2xl text-5xl font-semibold leading-tight text-intel-ink">
              Identity-controlled access for AI-assisted trading desks.
            </h3>
            <p className="mt-5 max-w-xl text-base leading-7 text-intel-ink2">
              Each operator enters through verified identity, rotating sessions, role-based permissions, and device visibility before reaching trading workspaces.
            </p>
          </div>
          <div className="grid max-w-3xl grid-cols-3 gap-3">
            {[
              ['Session restore', 'Rotating refresh tokens keep access durable without exposing long-lived bearer credentials.'],
              ['Workspace defaults', 'Organization, watchlist seed, journal, and AI memory are prepared after first login.'],
              ['Broker ready', 'Alpaca, Tradier, IBKR, Tastytrade, and paper paths are staged after authentication.'],
            ].map(([title, body]) => (
              <div key={title} className="rounded-md border border-intel-line bg-intel-panel/80 p-4">
                <p className="text-sm font-semibold text-intel-ink">{title}</p>
                <p className="mt-2 text-xs leading-5 text-intel-ink3">{body}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
