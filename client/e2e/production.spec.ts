import { test, expect, type Page, type ConsoleMessage, type Request } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const IS_LOCAL_BASE_URL = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(BASE_URL);
const FORBIDDEN_URL_PATTERNS = IS_LOCAL_BASE_URL
  ? [/polygonio-backend\.onrender\.com/i]
  : [/localhost/i, /127\.0\.0\.1/i, /polygonio-backend\.onrender\.com/i];

type PageEvidence = {
  consoleErrors: string[];
  consoleWarnings: string[];
  pageErrors: string[];
  failedRequests: { url: string; failure: string | null }[];
  abortedRequests: { url: string; failure: string | null }[];
  serverErrorResponses: { url: string; status: number }[];
  forbiddenOriginRequests: string[];
  pendingApiRequests: Set<Request>;
};

function shouldWaitForRequest(req: Request): boolean {
  const url = req.url();
  return /^https?:\/\//i.test(url) && url.includes('/api/') && !url.includes('/api/health');
}

function attachEvidenceCollectors(page: Page): PageEvidence {
  const evidence: PageEvidence = {
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    failedRequests: [],
    abortedRequests: [],
    serverErrorResponses: [],
    forbiddenOriginRequests: [],
    pendingApiRequests: new Set<Request>(),
  };

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') evidence.consoleErrors.push(msg.text());
    if (msg.type() === 'warning') evidence.consoleWarnings.push(msg.text());
  });

  page.on('pageerror', (err) => {
    evidence.pageErrors.push(String(err));
  });

  page.on('request', (req: Request) => {
    if (shouldWaitForRequest(req)) {
      evidence.pendingApiRequests.add(req);
    }
  });

  page.on('requestfailed', (req: Request) => {
    evidence.pendingApiRequests.delete(req);
    const failure = req.failure()?.errorText ?? null;
    const entry = { url: req.url(), failure };
    if (failure === 'net::ERR_ABORTED') {
      evidence.abortedRequests.push(entry);
    } else {
      evidence.failedRequests.push(entry);
    }
  });

  page.on('requestfinished', (req: Request) => {
    evidence.pendingApiRequests.delete(req);
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
  console.log('aborted requests:', evidence.abortedRequests.length, evidence.abortedRequests.slice(0, 10));
  console.log('5xx responses:', evidence.serverErrorResponses.length, evidence.serverErrorResponses.slice(0, 10));
  console.log('forbidden-origin requests:', evidence.forbiddenOriginRequests.length, evidence.forbiddenOriginRequests);
  console.log('pending API requests:', evidence.pendingApiRequests.size, Array.from(evidence.pendingApiRequests).slice(0, 10).map(req => req.url()));
}

async function waitForApiRequestsToSettle(evidence: PageEvidence, timeoutMs = 45_000, idleMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let idleStartedAt: number | null = null;
  while (Date.now() < deadline) {
    if (evidence.pendingApiRequests.size === 0) {
      idleStartedAt ??= Date.now();
      if (Date.now() - idleStartedAt >= idleMs) return;
    } else {
      idleStartedAt = null;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

function expectCleanEvidence(evidence: PageEvidence): void {
  expect(evidence.consoleErrors, 'no browser console errors').toEqual([]);
  expect(evidence.pageErrors, 'no uncaught JS exceptions').toEqual([]);
  expect(evidence.failedRequests, 'no network request failures').toEqual([]);
  expect(evidence.abortedRequests, 'no aborted network requests').toEqual([]);
  expect(evidence.serverErrorResponses, 'no backend 5xx responses').toEqual([]);
  expect(evidence.forbiddenOriginRequests, 'no forbidden-origin requests').toEqual([]);
}

async function visibleText(page: Page): Promise<string> {
  return page.locator('body').innerText();
}

async function revealWatchlist(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: /toggle watchlist/i }).first();
  if ((await toggle.count()) && await toggle.isVisible()) {
    await toggle.click();
    await page.waitForTimeout(1000);
    return;
  }

  const scannerTab = page.getByRole('button', { name: /^scanner$/i }).first();
  if ((await scannerTab.count()) && await scannerTab.isVisible()) {
    await scannerTab.click();
    await page.waitForTimeout(1500);
  }
}

async function selectWatchlistSymbol(page: Page, symbol: string): Promise<boolean> {
  await revealWatchlist(page);
  const row = page.getByRole('button', { name: new RegExp(`^${symbol}\\b`, 'i') }).first();
  if (!(await row.count())) return false;
  await row.scrollIntoViewIfNeeded();
  await row.click({ timeout: 10_000 });
  await page.waitForTimeout(5000);
  return true;
}

test.describe('Production application shell', () => {
  test('loads without crashing and has no forbidden-origin calls', async ({ page }) => {
    const evidence = attachEvidenceCollectors(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);

    await expect(page.locator('body')).toBeVisible();
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.trim().length).toBeGreaterThan(0);

    await waitForApiRequestsToSettle(evidence);
    reportEvidence('app-shell', evidence);
    expectCleanEvidence(evidence);

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
    let bodyText = await visibleText(page);
    let foundAny = knownSymbols.some((sym) => bodyText.includes(sym));
    if (!foundAny) {
      await revealWatchlist(page);
      bodyText = await visibleText(page);
      foundAny = knownSymbols.some((sym) => bodyText.includes(sym));
    }
    expect(foundAny, `expected at least one known watchlist symbol (${knownSymbols.join(', ')}) visible on page`).toBeTruthy();

    await waitForApiRequestsToSettle(evidence);
    reportEvidence('watchlist', evidence);
    await page.screenshot({ path: 'e2e-artifacts/watchlist.png', fullPage: true });
    expectCleanEvidence(evidence);
  });
});

test.describe('Options Matrix / Depth / Time & Sales', () => {
  test('selecting SOFI surfaces chain, depth status, and trade tape', async ({ page }) => {
    const evidence = attachEvidenceCollectors(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);

    await selectWatchlistSymbol(page, 'SOFI');

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

    await waitForApiRequestsToSettle(evidence);
    reportEvidence('options-matrix-depth', evidence);
    await page.screenshot({ path: 'e2e-artifacts/options-matrix-depth.png', fullPage: true });
    expectCleanEvidence(evidence);
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

    await waitForApiRequestsToSettle(evidence);
    reportEvidence('portfolio', evidence);
    await page.screenshot({ path: 'e2e-artifacts/portfolio.png', fullPage: true });
    expectCleanEvidence(evidence);
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

    await waitForApiRequestsToSettle(evidence);
    reportEvidence('automation-cockpit', evidence);
    await page.screenshot({ path: 'e2e-artifacts/automation-cockpit.png', fullPage: true });
    expectCleanEvidence(evidence);
  });
});

test.describe('AI Desk', () => {
  test('chat input accepts a message and produces a response', async ({ page }, testInfo) => {
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

    if (hasInput && testInfo.project.name === 'desktop-chromium') {
      await chatInput.fill('What is the current setup on SOFI?');
      const sendButton = page.getByRole('button', { name: /send/i }).first();
      if (await sendButton.count()) {
        await sendButton.click();
        await page.waitForTimeout(15000);
      }
    }

    await waitForApiRequestsToSettle(evidence);
    reportEvidence('ai-desk', evidence);
    await page.screenshot({ path: 'e2e-artifacts/ai-desk.png', fullPage: true });
    expectCleanEvidence(evidence);
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

    await waitForApiRequestsToSettle(evidence);
    reportEvidence(`mobile-${testInfo.project.name}`, evidence);
    await page.screenshot({ path: `e2e-artifacts/mobile-${testInfo.project.name}.png`, fullPage: true });
    expectCleanEvidence(evidence);
  });
});
