import axios from 'axios';

export type FuturesBar = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type FuturesBarResponse = {
  provider: 'databento' | 'synthetic';
  bars: FuturesBar[];
  usedFallbackData: boolean;
  sourceMessage: string;
};

type FetchBarsInput = {
  symbol: string;
  startDate: string;
  endDate: string;
};

const DATABENTO_BASE_URL = process.env.DATABENTO_BASE_URL || 'https://hist.databento.com';

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function seededRandom(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function generateSyntheticBars(input: FetchBarsInput): FuturesBar[] {
  const start = new Date(`${input.startDate}T00:00:00Z`);
  const end = new Date(`${input.endDate}T00:00:00Z`);
  const seed = hashSeed(`${input.symbol}:${input.startDate}:${input.endDate}`);
  const random = seededRandom(seed);

  const baseBySymbol: Record<string, number> = {
    ES: 5000,
    NQ: 21000,
    CL: 75,
    GC: 2300
  };
  let price = baseBySymbol[input.symbol.toUpperCase()] ?? 1000;

  const bars: FuturesBar[] = [];
  for (let date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const day = date.getUTCDay();
    if (day === 0 || day === 6) continue;
    const drift = (random() - 0.49) * 0.02;
    const open = price;
    const close = Math.max(0.01, open * (1 + drift));
    const high = Math.max(open, close) * (1 + random() * 0.005);
    const low = Math.min(open, close) * (1 - random() * 0.005);
    const volume = Math.round(10000 + random() * 45000);
    bars.push({ timestamp: `${toIsoDate(date)}T00:00:00.000Z`, open, high, low, close, volume });
    price = close;
  }
  return bars;
}

function normalizeDatabentoCsv(csv: string): FuturesBar[] {
  const lines = csv.trim().split('\n');
  if (lines.length <= 1) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  const idx = (name: string) => headers.findIndex(h => h === name);

  const tsIndex = idx('ts_event') >= 0 ? idx('ts_event') : idx('ts_recv');
  const openIndex = idx('open');
  const highIndex = idx('high');
  const lowIndex = idx('low');
  const closeIndex = idx('close');
  const volumeIndex = idx('volume');

  if ([tsIndex, openIndex, highIndex, lowIndex, closeIndex, volumeIndex].some(i => i < 0)) {
    return [];
  }

  return lines
    .slice(1)
    .map(line => line.split(','))
    .map(cols => ({
      timestamp: cols[tsIndex],
      open: Number(cols[openIndex]),
      high: Number(cols[highIndex]),
      low: Number(cols[lowIndex]),
      close: Number(cols[closeIndex]),
      volume: Number(cols[volumeIndex])
    }))
    .filter(bar => Number.isFinite(bar.open) && Number.isFinite(bar.close) && bar.timestamp);
}

export async function fetchFuturesDailyBars(input: FetchBarsInput): Promise<FuturesBarResponse> {
  const apiKey = process.env.DATABENTO_API_KEY;
  if (!apiKey) {
    return {
      provider: 'synthetic',
      bars: generateSyntheticBars(input),
      usedFallbackData: true,
      sourceMessage: 'DATABENTO_API_KEY not configured. Using deterministic synthetic bars.'
    };
  }

  const dataset = process.env.DATABENTO_DATASET || 'GLBX.MDP3';
  const schema = process.env.DATABENTO_SCHEMA || 'ohlcv-1d';
  const symbols = `${input.symbol}.FUT`;

  try {
    const response = await axios.get(`${DATABENTO_BASE_URL}/v0/timeseries.get_range`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'text/csv'
      },
      params: {
        dataset,
        schema,
        stype_in: 'raw_symbol',
        symbols,
        start: input.startDate,
        end: input.endDate,
        limit: 5000,
        encoding: 'csv'
      },
      timeout: 30_000
    });

    const bars = normalizeDatabentoCsv(typeof response.data === 'string' ? response.data : '');
    if (bars.length) {
      return {
        provider: 'databento',
        bars,
        usedFallbackData: false,
        sourceMessage: `Loaded ${bars.length} bars from Databento (${dataset}/${schema}).`
      };
    }

    return {
      provider: 'synthetic',
      bars: generateSyntheticBars(input),
      usedFallbackData: true,
      sourceMessage: 'Databento returned no parsable rows. Using deterministic synthetic bars.'
    };
  } catch (error: any) {
    return {
      provider: 'synthetic',
      bars: generateSyntheticBars(input),
      usedFallbackData: true,
      sourceMessage: `Databento request failed (${error?.message ?? 'unknown error'}). Using deterministic synthetic bars.`
    };
  }
}
