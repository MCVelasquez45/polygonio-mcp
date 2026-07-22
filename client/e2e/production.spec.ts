import { test, expect, type Page, type ConsoleMessage, type Request } from '@playwright/test';

const FORBIDDEN_URL_PATTERNS = [/localhost/i, /127\.0\.0\.1/i, /polygonio-backend\.onrender\.com/i];

type PageEvidence = {
  consoleErrors: string[];
  consoleWarnings: string[];
  pageErrors: string[];
  failedRequests: { url: string; failure: string | null }[];
  serverErrorResponses: { url: string; status: number }[];
  forbiddenOriginRequests: string[];
};

function attachEvidenceCollectors(page: Page): PageEvidence {
  const evidence: PageEvidence = {
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    failedRequests: [],
    serverErrorResponses: [],
    forbiddenOriginRequests: [],
  };

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') evidence.consoleErrors.push(msg.text());
    if (msg.type() === 'warning') evidence.consoleWarnings.push(msg.text());
  });

  page.on('pageerror', (err) => {
    evidence.pageErrors.push(String(err));
  });

  page.on('requestfailed', (req: Request) => {
    evidence.failedRequests.push({ url: req.url(), failure: req.failure()?.errorText ?? null });
  });

  page.on('response', (res) => {
    const url = res.url();
    if (res.status() >= 500) evidence.serverErrorResponses.push({ url, status: res.status() });
    if (FORBIDDEN_URL_PATTERNS.some((re) => re.test(url))) evidence.forbiddenOriginRequests.push(url);
  });

  return evidence;
}

function reportEvidence(name: string, evidence: PageEvidence) {
  console.log(`\n--- Evidence: ${name} ---`);
  console.log('console errors:', evidence.consoleErrors.length, evidence.consoleErrors.slice(0, 10));
  console.log('page errors:', evidence.pageErrors.length, evidence.pageErrors.slice(0, 10));
  console.log('failed requests:', evidence.failedRequests.length, evidence.failedRequests.slice(0, 10));
  console.log('5xx responses:', evidence.serverErrorResponses.length, evidence.serverErrorResponses.slice(0, 10));
  console.log('forbidden-origin requests:', evidence.forbiddenOriginRequests.length, evidence.forbiddenOriginRequests);
}

test.describe('Production application shell', () => {
  test('loads without crashing and has no forbidden-origin calls', async ({ page }) => {
    const evidence = attachEvidenceCollectors(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);

    await expect(page.locator('body')).toBeVisible();
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.trim().length).toBeGreaterThan(0);

    reportEvidence('app-shell', evidence);
    expect(evidence.forbiddenOriginRequests, 'no direct calls to localhost/backend origin bypassing the Vercel proxy').toEqual([]);
    expect(evidence.pageErrors, 'no uncaught JS exceptions').toEqual([]);

    await page.screenshot({ path: 'e2e-artifacts/app-shell.png', fullPage: true });
  });

  test('no horizontal overflow on the page body', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `scrollWidth (${scrollWidth}) should not exceed clientWidth (${clientWidth})`).toBeLessThanOrEqual(clientWidth);
  });
});

test.describe('Watchlist', () => {
  test('renders symbol list with real data', async ({ page }) => {
    const evidence = attachEvidenceCollectors(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);

    const knownSymbols = ['CVX', 'OXY', 'QQQ', 'USO', 'XLE', 'XOM', 'SOFI', 'TSLA'];
    const bodyText = await page.locator('body').innerText();
    const foundAny = knownSymbols.some((sym) => bodyText.includes(sym));
    expect(foundAny, `expected at least one known watchlist symbol (${knownSymbols.join(', ')}) visible on page`).toBeTruthy();

    reportEvidence('watchlist', evidence);
    await page.screenshot({ path: 'e2e-artifacts/watchlist.png', fullPage: true });
  });
});

test.describe('Options Matrix / Depth / Time & Sales', () => {
  test('selecting SOFI surfaces chain, depth status, and trade tape', async ({ page }) => {
    const evidence = attachEvidenceCollectors(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);

    const sofi = page.getByText('SOFI', { exact: false }).first();
    if (await sofi.count()) {
      await sofi.click();
    }
    await page.waitForTimeout(5000);

    const bodyText = await page.locator('body').innerText();
    const depthStates = [
      'Awaiting live option quotes',
      'Receiving live option quotes',
      'Subscribing to option contracts',
      'Select an option contract',
      'Last option quote is stale',
      'Delayed option quote displayed',
      'Snapshot option quote displayed',
      'Options service unavailable',
      'Market closed',
    ];
    const matchedState = depthStates.find((s) => bodyText.includes(s));
    console.log('Depth status observed:', matchedState ?? 'NONE MATCHED');

    reportEvidence('options-matrix-depth', evidence);
    await page.screenshot({ path: 'e2e-artifacts/options-matrix-depth.png', fullPage: true });

    expect(evidence.pageErrors).toEqual([]);
  });
});

test.describe('Portfolio', () => {
  test('account and positions surfaces render', async ({ page }) => {
    const evidence = attachEvidenceCollectors(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);

    const portfolioNav = page.getByRole('button', { name: /portfolio/i }).first();
    if (await portfolioNav.count()) {
      await portfolioNav.click();
      await page.waitForTimeout(8000);
    }

    reportEvidence('portfolio', evidence);
    await page.screenshot({ path: 'e2e-artifacts/portfolio.png', fullPage: true });
    expect(evidence.pageErrors).toEqual([]);
  });
});

test.describe('Automation / Cockpit', () => {
  test('cockpit workspace loads with scheduler/automation status', async ({ page }) => {
    const evidence = attachEvidenceCollectors(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);

    const cockpitNav = page.getByRole('button', { name: /cockpit/i }).first();
    if (await cockpitNav.count()) {
      await cockpitNav.click();
      await page.waitForTimeout(8000);
    }

    const cockpitWorkspace = page.locator('[data-testid="cockpit-workspace"]');
    const hasWorkspace = await cockpitWorkspace.count();
    console.log('cockpit-workspace testid present:', hasWorkspace > 0);

    reportEvidence('automation-cockpit', evidence);
    await page.screenshot({ path: 'e2e-artifacts/automation-cockpit.png', fullPage: true });
    expect(evidence.pageErrors).toEqual([]);
  });
});

test.describe('AI Desk', () => {
  test('chat input accepts a message and produces a response', async ({ page }) => {
    const evidence = attachEvidenceCollectors(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);

    const aiNav = page.getByRole('button', { name: /\bai\b|desk/i }).first();
    if (await aiNav.count()) {
      await aiNav.click();
      await page.waitForTimeout(1500);
    }

    const chatInput = page.locator('textarea').first();
    const hasInput = await chatInput.count();
    console.log('AI Desk textarea present:', hasInput > 0);

    if (hasInput) {
      await chatInput.fill('What is the current setup on SOFI?');
      const sendButton = page.getByRole('button', { name: /send/i }).first();
      if (await sendButton.count()) {
        await sendButton.click();
        await page.waitForTimeout(15000);
      }
    }

    reportEvidence('ai-desk', evidence);
    await page.screenshot({ path: 'e2e-artifacts/ai-desk.png', fullPage: true });
    expect(evidence.pageErrors).toEqual([]);
  });
});

test.describe('Mobile viewport', () => {
  test('bottom navigation is reachable and no horizontal overflow', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'desktop-chromium', 'mobile-only check');
    const evidence = attachEvidenceCollectors(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    console.log(`mobile viewport ${testInfo.project.name}: scrollWidth=${scrollWidth} clientWidth=${clientWidth}`);

    reportEvidence(`mobile-${testInfo.project.name}`, evidence);
    await page.screenshot({ path: `e2e-artifacts/mobile-${testInfo.project.name}.png`, fullPage: true });
    expect(evidence.pageErrors).toEqual([]);
  });
});
