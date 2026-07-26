import { randomUUID } from 'crypto';
import { REQUEST_PRIORITY } from '../../shared/data/massive';
import { computeDteEt, expirationWindowForDte } from '../../shared/time/tradingCalendar';
import { getOptionChainWindow } from '../marketData/optionsMarketDataOrchestrator.service';
import { getMarketStatusSnapshot } from '../market/services/marketStatus';
import { listWatchlist } from '../watchlist/watchlist.service';
import type { DecisionContractSnapshot, DecisionEngineScanInput, DecisionScan } from './types';
import { detectCandidateOpportunities } from './scoring.service';
import { rankDecisionCandidates } from './ranking.service';
import { appendDecisionScan } from './journal.service';

const DEFAULT_SCAN_INTERVAL_MS = Math.max(30_000, Number(process.env.DECISION_ENGINE_SCAN_INTERVAL_MS ?? 120_000));
let timer: NodeJS.Timeout | null = null;
let scanInFlight: Promise<DecisionScan> | null = null;

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function timestampToIso(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e17 ? Math.floor(value / 1e6) : value > 1e14 ? Math.floor(value / 1e3) : value < 1e12 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }
  return null;
}

function normalizeLeg(leg: any, type: 'call' | 'put', now: number): DecisionContractSnapshot | null {
  if (!leg?.ticker) return null;
  const bid = finite(leg.bid);
  const ask = finite(leg.ask);
  const mid = finite(leg.mid) ?? finite(leg.snapshot?.last_quote?.midpoint) ?? (bid != null && ask != null ? (bid + ask) / 2 : null);
  const spread = bid != null && ask != null ? Number((ask - bid).toFixed(4)) : null;
  return {
    symbol: String(leg.ticker).toUpperCase(),
    type,
    strike: finite(leg.strike),
    expiration: typeof leg.expiration === 'string' ? leg.expiration : null,
    dte: computeDteEt(typeof leg.expiration === 'string' ? leg.expiration : null, now),
    bid,
    ask,
    mid,
    spread,
    spreadPct: spread != null && mid != null && mid > 0 ? Number((spread / mid).toFixed(4)) : null,
    volume: finite(leg.volume ?? leg.day?.volume),
    openInterest: finite(leg.openInterest ?? leg.open_interest),
    iv: finite(leg.iv ?? leg.impliedVolatility ?? leg.implied_volatility),
    delta: finite(leg.delta ?? leg.greeks?.delta),
    gamma: finite(leg.gamma ?? leg.greeks?.gamma),
    theta: finite(leg.theta ?? leg.greeks?.theta),
    vega: finite(leg.vega ?? leg.greeks?.vega),
    quoteTimestamp: timestampToIso(leg.quoteTimestamp ?? leg.snapshot?.last_quote?.last_updated),
  };
}

async function buildLiveScanInput(now: number): Promise<DecisionEngineScanInput> {
  const [marketStatus, watchlistDocs] = await Promise.all([getMarketStatusSnapshot(), listWatchlist()]);
  const enabled = watchlistDocs
    .filter(item => item.enabled)
    .sort((a, b) => a.priority - b.priority || a.symbol.localeCompare(b.symbol));
  const chains: DecisionEngineScanInput['chains'] = {};

  await Promise.all(enabled.map(async item => {
    const minDte = item.minDTE ?? 7;
    const maxDte = item.maxDTE ?? 21;
    const window = expirationWindowForDte(now, minDte, maxDte);
    const response = await getOptionChainWindow({
      underlying: item.symbol,
      expirationGte: window.gte,
      expirationLte: window.lte,
      limit: 250,
      priority: REQUEST_PRIORITY.VISIBLE_UI,
    });
    const contracts: DecisionContractSnapshot[] = [];
    for (const group of response.expirations ?? []) {
      if (typeof group.dte === 'number' && (group.dte < minDte || group.dte > maxDte)) continue;
      for (const row of group.strikes ?? []) {
        const call = normalizeLeg((row as any).call, 'call', now);
        const put = normalizeLeg((row as any).put, 'put', now);
        if (call) contracts.push(call);
        if (put) contracts.push(put);
      }
    }
    chains[item.symbol] = {
      underlyingPrice: response.underlyingPrice,
      underlyingTimeframe: response.underlyingContext?.timeframe ?? null,
      complete: response.completeness?.complete !== false,
      contracts,
    };
  }));

  return {
    now,
    marketStatus: marketStatus.market,
    watchlist: enabled.map(item => ({
      symbol: item.symbol,
      priority: item.priority,
      minConfidence: item.minConfidence,
      maxSpreadPercent: item.maxSpreadPercent,
      minimumOpenInterest: item.minimumOpenInterest,
      minimumVolume: item.minimumVolume,
      maximumIV: item.maximumIV,
      riskProfile: item.riskProfile,
    })),
    chains,
  };
}

export function buildDecisionScan(input: DecisionEngineScanInput): DecisionScan {
  const candidates = detectCandidateOpportunities(input);
  const ranking = rankDecisionCandidates(candidates);
  const timestamp = new Date(input.now ?? Date.now()).toISOString();
  const noTradeReason = ranking.bestOpportunity
    ? null
    : candidates.length
      ? 'No candidate cleared all decision-engine gates.'
      : 'No candidate opportunities were detected from the supplied watchlist and market data.';
  return {
    scanId: randomUUID(),
    timestamp,
    watchlist: input.watchlist.map(item => item.symbol.trim().toUpperCase()),
    relatedEvents: input.eventContext ?? [],
    candidates,
    ranking,
    winner: ranking.bestOpportunity,
    rejections: ranking.rejectedCandidates,
    aiReasoning: candidates.map(candidate => candidate.aiResearch),
    noTradeReason,
    dataSources: ['watchlist', 'options-chain', 'quotes', 'open-interest', 'iv', 'greeks', 'market-status'],
    schemaVersion: 1,
  };
}

export async function runDecisionEngineScan(input?: DecisionEngineScanInput): Promise<DecisionScan> {
  if (scanInFlight && !input) return scanInFlight;
  const run = (async () => {
    const now = input?.now ?? Date.now();
    const scanInput = input ?? await buildLiveScanInput(now);
    const scan = buildDecisionScan(scanInput);
    return appendDecisionScan(scan);
  })();
  if (!input) scanInFlight = run;
  try {
    return await run;
  } finally {
    if (!input) scanInFlight = null;
  }
}

export async function runDecisionEngineEventReevaluation(
  eventContext: NonNullable<DecisionEngineScanInput['eventContext']>
): Promise<DecisionScan> {
  const now = Date.now();
  const input = await buildLiveScanInput(now);
  input.eventContext = eventContext;
  return runDecisionEngineScan(input);
}

export function startDecisionEngineScanner(): void {
  if (timer || process.env.DECISION_ENGINE_AUTO_START !== 'true') return;
  timer = setInterval(() => {
    runDecisionEngineScan().catch(error => {
      console.warn('[decision-engine] scan failed', { error: (error as Error)?.message });
    });
  }, DEFAULT_SCAN_INTERVAL_MS);
}

export function stopDecisionEngineScanner(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
