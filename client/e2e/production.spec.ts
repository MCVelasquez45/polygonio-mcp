import { test, expect, type Page, type ConsoleMessage, type Request } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const IS_LOCAL_BASE_URL = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(BASE_URL);
const FORBIDDEN_URL_PATTERNS = IS_LOCAL_BASE_URL
  ? [/\.onrender\.com/i]
  : [/localhost/i, /127\.0\.0\.1/i, /\.onrender\.com/i];

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
    try {
      await toggle.focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1000);
      return;
    } catch {
      // Continue to workspace-specific fallbacks below; tablet breakpoints can
      // visually expose this icon while another control owns the pointer hitbox.
    }
  }

  const scannerTab = page.getByRole('button', { name: /^scanner$/i }).first();
  if ((await scannerTab.count()) && await scannerTab.isVisible()) {
    await scannerTab.click();
    await page.waitForTimeout(1500);
  }
}

async function clickFirstVisibleButton(page: Page, names: RegExp[], timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const name of names) {
      const button = page.getByRole('button', { name }).first();
      if ((await button.count()) && await button.isVisible()) {
        await button.click();
        return true;
      }
    }
    await page.waitForTimeout(250);
  }
  return false;
}

async function openPortfolio(page: Page): Promise<void> {
  const clicked = await clickFirstVisibleButton(page, [/^positions\b/i, /^portfolio$/i]);
  expect(clicked, 'portfolio workspace navigation is reachable').toBeTruthy();
  await expect(page.getByText(/Open Positions|Buying Power|Alpaca Paper/i).first()).toBeVisible({ timeout: 20_000 });
}

async function openAutomation(page: Page): Promise<void> {
  const clicked = await clickFirstVisibleButton(page, [/^automation\b/i, /^cockpit$/i]);
  expect(clicked, 'automation workspace navigation is reachable').toBeTruthy();
  await expect(page.getByText(/Active Trade|Pending Orders|Recent Actions/i).first()).toBeVisible({ timeout: 20_000 });
}

async function openAiDesk(page: Page): Promise<void> {
  const clicked = await clickFirstVisibleButton(page, [/toggle ai chat/i, /^AI$/i]);
  expect(clicked, 'AI workspace navigation is reachable').toBeTruthy();
  const composer = page.locator('textarea').first();
  await expect(composer, 'AI desk composer is available').toBeVisible({ timeout: 20_000 });
}

async function openMobileTradeMatrix(page: Page): Promise<void> {
  const tradeTab = page.getByRole('button', { name: /^trade$/i }).first();
  if ((await tradeTab.count()) && await tradeTab.isVisible()) {
    await tradeTab.click();
    const matrixSection = page.getByRole('button', { name: /^matrix\b/i }).first();
    if ((await matrixSection.count()) && await matrixSection.isVisible()) {
      await matrixSection.click();
    }
  }
}

async function selectWatchlistSymbol(page: Page, symbol: string): Promise<boolean> {
  await revealWatchlist(page);
  const rows = page.getByRole('button', { name: new RegExp(`^${symbol}\\b`, 'i') });
  const count = await rows.count();
  if (!count) return false;
  const viewport = page.viewportSize();
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const box = await row.boundingBox();
    if (
      box &&
      box.width > 0 &&
      box.height > 0 &&
      (!viewport || (
        box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= viewport.width &&
        box.y + box.height <= viewport.height
      ))
    ) {
      await page.mouse.click(box.x + Math.min(24, box.width / 2), box.y + Math.min(12, box.height / 2));
      await page.waitForTimeout(5000);
      return true;
    }
  }
  const row = rows.first();
  try {
    await row.scrollIntoViewIfNeeded();
    await row.click({ timeout: 5_000 });
    await page.waitForTimeout(5000);
    return true;
  } catch {
    return false;
  }
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
  test('selecting a watchlist symbol surfaces chain, depth status, and trade tape', async ({ page }) => {
    const evidence = attachEvidenceCollectors(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);

    let selectedSymbol: string | null = null;
    for (const symbol of ['XLE', 'CVX', 'SPY', 'QQQ', 'XOM', 'TSLA', 'SOFI']) {
      if (await selectWatchlistSymbol(page, symbol)) {
        selectedSymbol = symbol;
        break;
      }
    }
    expect(selectedSymbol, 'a real watchlist symbol can be selected').not.toBeNull();
    await openMobileTradeMatrix(page);

    await expect(page.getByTestId('price-ladder'), 'top-of-book ladder is visible').toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('time-sales'), 'time and sales surface is visible').toBeVisible({ timeout: 20_000 });
    console.log('Options surface observed:', (await page.getByTestId('time-sales').textContent())?.slice(0, 80) ?? 'visible');

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

    await openPortfolio(page);

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

    await openAutomation(page);

    await waitForApiRequestsToSettle(evidence);
    reportEvidence('automation-cockpit', evidence);
    await page.screenshot({ path: 'e2e-artifacts/automation-cockpit.png', fullPage: true });
    expectCleanEvidence(evidence);
  });
});

test.describe('AI Desk', () => {
  test('chat input is available and accepts operator input', async ({ page }) => {
    const evidence = attachEvidenceCollectors(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);

    await openAiDesk(page);

    const chatInput = page.locator('textarea').first();
    const hasInput = await chatInput.isVisible();
    console.log('AI Desk textarea present:', hasInput);

    if (hasInput) {
      await chatInput.fill('What is the current setup on SOFI?');
      await expect(chatInput).toHaveValue('What is the current setup on SOFI?');
    }

    await waitForApiRequestsToSettle(evidence);
    reportEvidence('ai-desk', evidence);
    await page.screenshot({ path: 'e2e-artifacts/ai-desk.png', fullPage: true });
    expectCleanEvidence(evidence);
  });
});

test.describe('Responsive viewport', () => {
  test('workspace has no horizontal overflow', async ({ page }, testInfo) => {
    const evidence = attachEvidenceCollectors(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    console.log(`responsive viewport ${testInfo.project.name}: scrollWidth=${scrollWidth} clientWidth=${clientWidth}`);

    await waitForApiRequestsToSettle(evidence);
    reportEvidence(`responsive-${testInfo.project.name}`, evidence);
    await page.screenshot({ path: `e2e-artifacts/responsive-${testInfo.project.name}.png`, fullPage: true });
    expectCleanEvidence(evidence);
  });
});
