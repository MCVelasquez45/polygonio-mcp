import { http } from './http';

export type WatchlistReport = {
  symbol: string;
  headline?: string;
  summary?: string;
  sentiment?: string;
  flow?: string | null;
  contract?: string | null;
  expiry?: string | null;
  ivRank?: number | null;
};

type WatchlistReportsResponse = {
  reports: WatchlistReport[];
  source?: string;
  fetchedAt?: string;
};

export async function getWatchlistReports(
  tickers: string[],
  signal?: AbortSignal
): Promise<WatchlistReportsResponse> {
  const { data } = await http.post<WatchlistReportsResponse>('/api/analysis/watchlist', { tickers }, { signal });
  return data;
}

export type DeskInsight = {
  symbol: string;
  summary: string | null;
  sentiment: { label?: string | null; score?: number | null } | null;
  fedEvent: { title?: string; name?: string; date?: string; impact?: string } | null;
  highlights: string[];
  shortBias?: { label?: string | null; reasons?: string[] } | null;
  source?: string;
  updatedAt?: string;
};

export async function getDeskInsight(symbol: string, signal?: AbortSignal): Promise<DeskInsight> {
  const { data } = await http.post<DeskInsight>('/api/analysis/insight', { symbol }, { signal });
  return data;
}

export type ContractSelectionCandidate = {
  symbol: string;
  type: 'call' | 'put';
  strike: number;
  expiration: string;
  delta: number | null;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  openInterest: number | null;
  volume: number | null;
  iv: number | null;
  dte: number | null;
};

export type ContractSelectionResult = {
  selectedContract: string | null;
  side: 'call' | 'put' | null;
  confidence: number | null;
  reasons: string[];
  warnings: string[];
  source: 'agent' | 'fallback';
};

export async function selectContract(
  payload: {
    ticker: string;
    underlyingPrice: number | null;
    sentiment: 'bullish' | 'bearish' | 'neutral';
    marketRegime?: 'trending' | 'choppy' | 'volatile';
    candidates: ContractSelectionCandidate[];
  },
  signal?: AbortSignal
): Promise<ContractSelectionResult> {
  const { data } = await http.post<ContractSelectionResult>('/api/analysis/contract-select', payload, { signal });
  return data;
}

export type ContractExplanationResult = {
  whatThisTradeDoes: string;
  whatNeedsToHappen: string[];
  mainRisks: string[];
  whyAIChoseThis: string[];
  riskLevel: string | null;
  source: 'agent' | 'fallback';
};

export async function getContractExplanation(
  payload: {
    underlying: string;
    spotPrice: number | null;
    breakeven: number | null;
    breakevenPct: number | null;
    contract: {
      symbol: string;
      type: 'call' | 'put';
      strike: number | null;
      expiration: string | null;
      price: number | null;
    };
    decision: {
      selectedContract: string | null;
      side: 'call' | 'put' | null;
      confidence: number | null;
      reasons: string[];
      warnings: string[];
      source: 'agent' | 'fallback';
      fallbackUsed: boolean;
      constraintsFailed: string[];
    };
    risk: {
      score: number | null;
      label: string | null;
    };
  },
  signal?: AbortSignal
): Promise<ContractExplanationResult> {
  const { data } = await http.post<ContractExplanationResult>('/api/analysis/contract-summary', payload, { signal });
  return data;
}

export type ChecklistFactor = {
  key: string;
  label: string;
  detail: string;
  passed: boolean;
};

export type ChecklistItem = {
  label: string;
  passed: boolean;
};

export type ChecklistCategory = {
  key: string;
  label: string;
  score: number;
  max: number;
  items: ChecklistItem[];
};

export type ChecklistGrade = 'A+' | 'A' | 'B' | 'C';

export type ChecklistResult = {
  symbol: string;
  referenceContract?: string | null;
  price: number | null;
  emaShort: number | null;
  emaMedium: number | null;
  emaLong: number | null;
  support: number | null;
  resistance: number | null;
  optionMetrics: {
    delta: number | null;
    iv: number | null;
    volume: number | null;
    openInterest: number | null;
    spread: number | null;
  };
  sentiment?: { label?: string | null; score?: number | null } | null;
  fedEvent?: { name?: string; title?: string; date?: string; impact?: string } | null;
  categories: ChecklistCategory[];
  totalScore: number;
  maxScore: number;
  grade: ChecklistGrade;
  factors: ChecklistFactor[];
  qualifies: boolean;
  updatedAt: string;
};

type ChecklistResponse = {
  results: ChecklistResult[];
  fetchedAt?: string;
};

export async function runChecklist(
  tickers: string[],
  force = false,
  signal?: AbortSignal
): Promise<ChecklistResponse> {
  const { data } = await http.post<ChecklistResponse>('/api/analysis/checklist', { tickers, force }, { signal });
  return data;
}
