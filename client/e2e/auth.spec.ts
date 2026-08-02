import { expect, test, type Page } from '@playwright/test';

async function mockAnonymousIdentity(page: Page): Promise<void> {
  await page.route('**/api/auth/config', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ googleConfigured: true, googleClientId: 'test-client', alpacaConfigured: true, alpacaPaper: true }),
  }));
  await page.route('**/api/auth/csrf', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'set-cookie': 'id_csrf=e2e-csrf; Path=/; SameSite=Lax' },
    body: JSON.stringify({ csrfToken: 'e2e-csrf' }),
  }));
  await page.route('**/api/auth/refresh', route => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'SESSION_INVALID' }),
  }));
}

function returningUser() {
  return {
    id: 'returning-operator',
    email: 'returning@example.com',
    emailVerified: true,
    status: 'active',
    roles: ['admin'],
    profile: { name: 'Returning Operator', avatarUrl: null, timezone: 'UTC', tradingExperience: 'advanced', preferredTheme: 'dark', workspaceName: 'Returning Desk' },
    hasPassword: true,
    oauthProviders: ['google'],
    lastLoginAt: new Date(0).toISOString(),
    createdAt: new Date(0).toISOString(),
    firstLogin: false,
    onboardingCompletedAt: new Date(0).toISOString(),
  };
}

test.describe('Enterprise identity gateway', () => {
  test.beforeEach(async ({ page }) => {
    await mockAnonymousIdentity(page);
  });

  test('renders an accessible responsive login without overflow', async ({ page }, testInfo) => {
    await page.goto('/auth/login');

    await expect(page.getByRole('heading', { name: 'Sign in to AI-Trader' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Continue with Microsoft' })).toBeDisabled();
    await expect(page.getByLabel('Work email')).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await page.screenshot({ path: `e2e-artifacts/auth-login-${testInfo.project.name}.png`, fullPage: true });
  });

  test('never exposes backend identity error codes to operators', async ({ page }) => {
    await page.route('**/api/auth/login', route => route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'EMAIL_VERIFICATION_REQUIRED' }),
    }));
    await page.goto('/auth/login');
    await page.getByLabel('Work email').fill('operator@example.com');
    await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
    await page.getByRole('button', { name: 'Sign in securely' }).click();

    await expect(page.getByRole('alert')).toContainText('Check your inbox and verify your email');
    await expect(page.locator('body')).not.toContainText('EMAIL_VERIFICATION_REQUIRED');
  });

  test('supports account creation and recovery navigation', async ({ page }) => {
    await page.goto('/auth/login');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Establish your identity' })).toBeVisible();
    await expect(page.getByLabel('Full name')).toBeVisible();

    await page.getByRole('button', { name: 'Recover account' }).click();
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send recovery link' })).toBeVisible();
  });

  test('submits email registration, verification, recovery and reset flows', async ({ page }) => {
    await page.route('**/api/auth/register', async route => {
      expect(route.request().postDataJSON()).toMatchObject({
        email: 'new.operator@example.com',
        name: 'New Operator',
      });
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    await page.route('**/api/auth/verify-email', async route => {
      expect(route.request().postDataJSON()).toEqual({ token: 'e2e-verify-token' });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: returningUser() }) });
    });
    await page.route('**/api/auth/forgot-password', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }));
    await page.route('**/api/auth/reset-password', async route => {
      expect(route.request().postDataJSON()).toMatchObject({ token: 'e2e-reset-token', password: 'new secure recovery phrase' });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.goto('/auth/register');
    await page.getByLabel('Work email').fill('new.operator@example.com');
    await page.getByLabel('Full name').fill('New Operator');
    await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
    await page.getByRole('button', { name: 'Create secure account' }).click();
    await expect(page.getByRole('status')).toContainText('Check your inbox');

    await page.goto('/auth/verify?token=e2e-verify-token');
    await page.getByRole('button', { name: 'Verify email' }).click();
    await expect(page).toHaveURL(/\/auth\/login$/);
    await expect(page.getByRole('status')).toContainText('Email verified');

    await page.goto('/auth/forgot');
    await page.getByLabel('Work email').fill('new.operator@example.com');
    await page.getByRole('button', { name: 'Send recovery link' }).click();
    await expect(page.getByRole('status')).toContainText('recovery link');

    await page.goto('/auth/reset?token=e2e-reset-token');
    await page.getByLabel('Password', { exact: true }).fill('new secure recovery phrase');
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page).toHaveURL(/\/auth\/login$/);
    await expect(page.getByRole('status')).toContainText('Password updated');
  });

  test('redirects an anonymous protected route to login', async ({ page }) => {
    await page.goto('/terminal?__identity=real');
    await expect(page).toHaveURL(/\/auth\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in to AI-Trader' })).toBeVisible();
  });

  test('restores a returning session across refresh and supports logout on every viewport', async ({ page }) => {
    const user = returningUser();
    let refreshRequests = 0;
    await page.unroute('**/api/auth/config');
    await page.unroute('**/api/auth/csrf');
    await page.unroute('**/api/auth/refresh');
    await page.route(/^https?:\/\/[^/]+:4001\/api\//, route => {
      const path = new URL(route.request().url()).pathname;
      let body: object = {};
      if (path === '/api/auth/config') body = { googleConfigured: true, googleClientId: 'test-client', alpacaConfigured: true, alpacaPaper: true };
      if (path === '/api/auth/csrf') body = { csrfToken: 'e2e-csrf' };
      if (path === '/api/auth/refresh') {
        refreshRequests += 1;
        body = { accessToken: 'restored-token', accessTokenExpiresInSec: 900, sessionId: 'restored-session', user };
      }
      if (path === '/api/auth/sessions') body = { sessions: [] };
      if (path === '/api/auth/workspace') body = { workspace: null };
      if (path === '/api/auth/logout') body = { ok: true };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await page.goto('/auth/login');
    await expect(page).toHaveURL(/\/terminal$/);
    expect(refreshRequests).toBe(1);
    // Preserve the real-identity override across reload. The broad E2E harness
    // otherwise supplies its synthetic terminal identity outside auth routes.
    await page.evaluate(() => window.history.replaceState({}, '', '/terminal?__identity=real'));
    await page.reload();
    await expect.poll(() => refreshRequests).toBe(2);
    await expect(page).toHaveURL(/\/terminal\?__identity=real$/);
    await page.getByRole('button', { name: 'Open operator profile' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Logout', exact: true }).click();
    await expect(page).toHaveURL(/\/auth\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in to AI-Trader' })).toBeVisible();
  });

  test('wires the Google button to the backend authorization endpoint', async ({ page }) => {
    const googleStart = page.waitForRequest(request => request.url().includes('/api/auth/google?'));
    await page.route('**/api/auth/google?*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Google authorization started</title>' }));
    await page.goto('/auth/login');
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    expect((await googleStart).url()).toContain('returnTo=%2Fauth%2Flogin');
  });

  test('forces first-login onboarding and launches a provisioned paper workspace', async ({ page }) => {
    const user: any = {
      id: 'operator-1',
      email: 'operator@example.com',
      emailVerified: true,
      status: 'active',
      roles: ['admin'],
      profile: { name: 'Operator', avatarUrl: null, timezone: 'UTC', tradingExperience: 'none', preferredTheme: 'dark', workspaceName: 'Operator Desk' },
      hasPassword: true,
      oauthProviders: [],
      lastLoginAt: null,
      createdAt: new Date(0).toISOString(),
      firstLogin: true,
      onboardingCompletedAt: null,
    };
    const workspace: any = {
      organization: { id: 'org-1', name: 'Operator Desk', slug: 'operator-desk', status: 'active' },
      membership: { roles: ['admin'] },
      defaults: {
        watchlist: ['SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA'].map(symbol => ({ symbol, label: symbol, enabled: true })),
        aiMemory: { status: 'ready', seedVersion: 'v3', preferences: { riskPosture: 'balanced', automationMode: 'paper', assistantTone: 'institutional' } },
        journal: { status: 'ready', seedVersion: 'v3', firstEntry: 'Workspace initialized.' },
      },
      brokerOnboarding: { status: 'not_started', providers: [], connections: [] },
      onboarding: { status: 'not_started', currentStep: 0, completedAt: null },
      aiProfile: { riskTolerance: 'balanced', preferredMarkets: ['stocks', 'options'], preferredStrategies: ['research'], personality: 'institutional', marketHours: 'regular' },
      riskProfile: { maximumDailyLoss: 500, maximumPositionSize: 5000, instruments: 'stocks_options', paperTrading: true, automationAllowed: false, defaultStrategy: 'manual', emergencyStop: true },
      notifications: { emailAlerts: true, tradeAlerts: true, automationAlerts: true, aiSuggestions: true, brokerDisconnect: true, marginCalls: true, systemMaintenance: true },
      layouts: ['trading', 'ai', 'research', 'portfolio', 'automation'].map(key => ({ key, label: `${key} layout`, version: 1 })),
    };

    await page.route('**/api/auth/login', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accessToken: 'access-token', accessTokenExpiresInSec: 900, sessionId: 'session-1', user }),
    }));
    await page.route('**/api/auth/workspace', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workspace }) }));
    await page.route('**/api/auth/onboarding', async route => {
      const body = route.request().postDataJSON();
      workspace.onboarding.status = 'in_progress';
      workspace.onboarding.currentStep = body.currentStep;
      if (body.aiProfile) Object.assign(workspace.aiProfile, body.aiProfile);
      if (body.riskProfile) Object.assign(workspace.riskProfile, body.riskProfile);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workspace }) });
    });
    await page.route('**/api/auth/onboarding/broker/paper', route => {
      workspace.brokerOnboarding.status = 'connected';
      workspace.brokerOnboarding.connections = [{ provider: 'paper', label: 'Paper Trading', status: 'connected', accountId: 'paper-1', accountType: 'paper', paper: true, buyingPower: 100000, currency: 'USD' }];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workspace }) });
    });
    await page.route('**/api/auth/onboarding/broker/alpaca', route => {
      workspace.brokerOnboarding.status = 'connected';
      workspace.brokerOnboarding.connections.push({ provider: 'alpaca', label: 'Alpaca', status: 'connected', accountId: 'alpaca-1', accountType: 'margin', paper: true, buyingPower: 250000.5, currency: 'USD' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workspace }) });
    });
    await page.route('**/api/auth/onboarding/complete', route => {
      workspace.onboarding.status = 'complete';
      user.firstLogin = false;
      user.onboardingCompletedAt = new Date().toISOString();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workspace, user }) });
    });

    await page.goto('/auth/login');
    await page.getByLabel('Work email').fill('operator@example.com');
    await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
    await page.getByRole('button', { name: 'Sign in securely' }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole('heading', { name: 'Welcome to AI-Trader' })).toBeVisible();

    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: 'Start Paper Workspace' }).click();
    await expect(page.getByRole('button', { name: 'Paper Connected' })).toBeVisible();
    await page.getByRole('button', { name: 'Connect Alpaca' }).click();
    await expect(page.getByRole('button', { name: 'Alpaca Connected' })).toBeVisible();
    await expect(page.getByText('$250,000.5 buying power')).toBeVisible();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: 'Save AI profile' }).click();
    await page.getByRole('button', { name: 'Initialize workspace' }).click();
    await expect(page.getByRole('heading', { name: 'Workspace ready' })).toBeVisible();
    await page.screenshot({ path: 'e2e-artifacts/onboarding-ready.png', fullPage: true });
    await page.getByRole('button', { name: /Launch Trading Workspace/ }).click();
    await expect(page).toHaveURL(/\/terminal$/);
  });
});
