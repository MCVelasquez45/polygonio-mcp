import { getOptionAggregates } from './massive';
import { upsertAggregateBars } from './aggregatesStore';
import { getMarketStatusSnapshot } from './marketStatus';

type WorkerInterval = {
  multiplier: number;
  timespan: 'minute' | 'hour' | 'day';
  window: number;
};

const DEFAULT_INTERVALS: WorkerInterval[] = [{ multiplier: 1, timespan: 'minute', window: 360 }];

const POLL_INTERVAL_MS = Math.max(60_000, Number(process.env.AGG_WORKER_INTERVAL_MS ?? 180_000));
const REQUEST_DELAY_MS = Math.max(300, Number(process.env.AGG_WORKER_REQUEST_DELAY_MS ?? 800));
const ENABLED = (process.env.AGG_WORKER_ENABLED ?? '').toLowerCase() === 'true';
const TICKERS = (process.env.AGG_WORKER_TICKERS ?? 'SPY,AAPL,TSLA,NVDA,MSFT,META,QQQ')
  .split(',')
  .map(ticker => ticker.trim().toUpperCase())
  .filter(Boolean);

let timer: NodeJS.Timeout | null = null;

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchAndStore(ticker: string, config: WorkerInterval) {
  try {
    const { results } = await getOptionAggregates(
      ticker,
      config.multiplier,
      config.timespan,
      config.window
    );
    if (results.length) {
      await upsertAggregateBars(ticker, config.multiplier, config.timespan, results, {
        source: 'massive'
      });
      console.log('[AGG-WORKER] stored bars', {
        ticker,
        multiplier: config.multiplier,
        timespan: config.timespan,
        count: results.length
      });
    }
  } catch (error) {
    console.warn('[AGG-WORKER] fetch failed', {
      ticker,
      multiplier: config.multiplier,
      timespan: config.timespan,
      error: (error as Error)?.message ?? error
    });
  }
}

async function runCycle() {
  if (!TICKERS.length) return;
  try {
    const status = await getMarketStatusSnapshot();
    const intradayClosed = status.market !== 'open' && !status.afterHours && !status.preMarket;
    if (intradayClosed) {
      console.log('[AGG-WORKER] market closed, skipping minute intervals');
      return;
    }
  } catch (error) {
    console.warn('[AGG-WORKER] market status lookup failed', error);
  }

  for (const ticker of TICKERS) {
    for (const interval of DEFAULT_INTERVALS) {
      await fetchAndStore(ticker, interval);
      await delay(REQUEST_DELAY_MS);
    }
  }
}

export function startAggregatesWorker() {
  if (!ENABLED) {
    console.log('[AGG-WORKER] disabled (set AGG_WORKER_ENABLED=true to enable background ingestion)');
    return;
  }
  if (!TICKERS.length) {
    console.log('[AGG-WORKER] no tickers configured, skipping start');
    return;
  }
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  console.log('[AGG-WORKER] starting', { tickers: TICKERS, pollIntervalMs: POLL_INTERVAL_MS });
  runCycle().catch(error => console.warn('[AGG-WORKER] initial cycle failed', error));
  timer = setInterval(() => {
    runCycle().catch(error => console.warn('[AGG-WORKER] cycle failed', error));
  }, POLL_INTERVAL_MS);
}
