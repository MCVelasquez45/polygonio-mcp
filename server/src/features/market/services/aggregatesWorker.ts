import { getOptionAggregates } from '../../../shared/data/massive';
import { upsertAggregateBars } from './aggregatesStore';
import { getMarketStatusSnapshot } from './marketStatus';
import { getWarmTickers } from './aggregatesWarmList';

// Optional worker that periodically hydrates local aggregate caches so the UI
// can instantly render without waiting for Massive.

type WorkerInterval = {
  multiplier: number;
  timespan: 'minute' | 'hour' | 'day';
  window: number;
};

const DEFAULT_INTERVALS: WorkerInterval[] = [{ multiplier: 1, timespan: 'minute', window: 360 }];

const POLL_INTERVAL_MS = Math.max(60_000, Number(process.env.AGG_WORKER_INTERVAL_MS ?? 180_000));
const REQUEST_DELAY_MS = Math.max(300, Number(process.env.AGG_WORKER_REQUEST_DELAY_MS ?? 800));
const AGG_WORKER_RAW = process.env.AGG_WORKER_ENABLED;
const AGG_WORKER_UNSET = AGG_WORKER_RAW == null || AGG_WORKER_RAW === '';
const AGG_WORKER_DEV_DEFAULT = AGG_WORKER_UNSET && process.env.NODE_ENV !== 'production';
const ENABLED = AGG_WORKER_DEV_DEFAULT || (AGG_WORKER_RAW ?? '').toLowerCase() === 'true';
const BASE_TICKERS = (process.env.AGG_WORKER_TICKERS ?? 'SPY,AAPL,TSLA,NVDA,MSFT,META,QQQ')
  .split(',')
  .map(ticker => ticker.trim().toUpperCase())
  .filter(Boolean);

let timer: NodeJS.Timeout | null = null;

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetches live bars for a given ticker + interval and writes them to Mongo.
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

// Executes a single pass over all configured tickers. Skips minute bars when
// the regular market is closed to avoid wasting quota.
async function runCycle() {
  const tickers = new Set<string>([...BASE_TICKERS, ...getWarmTickers()]);
  if (!tickers.size) return;
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

  for (const ticker of tickers) {
    for (const interval of DEFAULT_INTERVALS) {
      await fetchAndStore(ticker, interval);
      await delay(REQUEST_DELAY_MS);
    }
  }
}

// Public entry: starts the polling loop when `AGG_WORKER_ENABLED=true`.
export function startAggregatesWorker() {
  if (!ENABLED) {
    const reason = AGG_WORKER_UNSET ? 'AGG_WORKER_ENABLED is not set' : `AGG_WORKER_ENABLED=${AGG_WORKER_RAW}`;
    console.log(
      `[AGG-WORKER] disabled (${reason}). This worker pre-warms intraday aggregate caches for faster chart loads.`
    );
    console.log('[AGG-WORKER] To enable, set AGG_WORKER_ENABLED=true.');
    return;
  }
  const tickers = new Set<string>([...BASE_TICKERS, ...getWarmTickers()]);
  if (!tickers.size) {
    console.log('[AGG-WORKER] no tickers configured, skipping start');
    return;
  }
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (AGG_WORKER_DEV_DEFAULT) {
    console.log('[AGG-WORKER] AGG_WORKER_ENABLED not set; auto-enabling in development mode.');
  }
  console.log('[AGG-WORKER] starting', { tickers: Array.from(tickers), pollIntervalMs: POLL_INTERVAL_MS });
  runCycle().catch(error => console.warn('[AGG-WORKER] initial cycle failed', error));
  timer = setInterval(() => {
    runCycle().catch(error => console.warn('[AGG-WORKER] cycle failed', error));
  }, POLL_INTERVAL_MS);
}
