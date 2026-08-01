import { expect, test, type Page } from '@playwright/test';

async function mockAnonymousIdentity(page: Page): Promise<void> {
  await page.route('**/api/auth/config', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ googleConfigured: true, googleClientId: 'test-client' }),
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

test.describe('Enterprise identity gateway', () => {
  test.beforeEach(async ({ page }) => {
    await mockAnonymousIdentity(page);
  });

  test('renders an accessible responsive login without overflow', async ({ page }) => {
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
});
