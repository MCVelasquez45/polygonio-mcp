import { randomUUID } from 'crypto';
import { computeDteEt } from '../../shared/time/tradingCalendar';
import type {
  AiResearchOutput,
  CandidateOpportunity,
  DecisionContractSnapshot,
  DecisionEngineReasonCode,
  DecisionEngineScanInput,
  DecisionMarketContext,
  DecisionScores,
  ExplainedScore,
} from './types';

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Number(value.toFixed(2))));
}

function grade(score: number, unavailable = false): ExplainedScore['grade'] {
  if (unavailable) return 'UNAVAILABLE';
  if (score >= 75) return 'STRONG';
  if (score >= 50) return 'ACCEPTABLE';
  return 'WEAK';
}

function score(
  key: ExplainedScore['key'],
  value: number,
  explanation: string,
  inputs: ExplainedScore['inputs'],
  unavailable = false
): ExplainedScore {
  const normalized = unavailable ? 0 : clampScore(value);
  return {
    key,
    score: normalized,
    maxScore: 100,
    grade: grade(normalized, unavailable),
    explanation,
    inputs,
  };
}

function spreadPct(contract: DecisionContractSnapshot): number | null {
  if (finite(contract.spreadPct) != null) return contract.spreadPct;
  const bid = finite(contract.bid);
  const ask = finite(contract.ask);
  const mid = finite(contract.mid) ?? (bid != null && ask != null ? (bid + ask) / 2 : null);
  if (bid == null || ask == null || mid == null || mid <= 0) return null;
  return (ask - bid) / mid;
}

function inferDirection(contract: DecisionContractSnapshot): CandidateOpportunity['direction'] {
  return contract.type === 'call' ? 'BULLISH' : 'BEARISH';
}

function calculateLiquidity(contract: DecisionContractSnapshot, minimumOi: number, minimumVolume: number): ExplainedScore {
  const oi = finite(contract.openInterest);
  const volume = finite(contract.volume);
  if (oi == null && volume == null) {
    return score('liquidity', 0, 'Liquidity cannot be scored because volume and open interest were not supplied.', {
      volume: null,
      openInterest: null,
      minimumVolume,
      minimumOpenInterest: minimumOi,
    }, true);
  }
  const oiScore = oi == null ? 0 : Math.min(60, (oi / Math.max(1, minimumOi)) * 45 + Math.min(15, oi / 1000));
  const volumeScore = volume == null ? 0 : Math.min(40, (volume / Math.max(1, minimumVolume)) * 35 + Math.min(5, volume / 5000));
  return score('liquidity', oiScore + volumeScore, 'Higher volume and open interest improve fill reliability and reduce exit risk.', {
    volume,
    openInterest: oi,
    minimumVolume,
    minimumOpenInterest: minimumOi,
  });
}

function calculateSpread(contract: DecisionContractSnapshot, maxSpreadPct: number): ExplainedScore {
  const pct = spreadPct(contract);
  if (pct == null) {
    return score('spread', 0, 'Spread cannot be scored because bid and ask were not both supplied.', {
      bid: contract.bid,
      ask: contract.ask,
      spreadPct: null,
      maxSpreadPct,
    }, true);
  }
  const value = pct <= 0 ? 100 : 100 * (1 - Math.min(1, pct / Math.max(0.0001, maxSpreadPct)));
  return score('spread', value, 'Tighter bid/ask spreads score higher because they reduce slippage before execution.', {
    bid: contract.bid,
    ask: contract.ask,
    spreadPct: pct,
    maxSpreadPct,
  });
}

function calculateVolatility(contract: DecisionContractSnapshot, maximumIV: number | null): ExplainedScore {
  const iv = finite(contract.iv);
  if (iv == null) {
    return score('volatility', 50, 'IV was not supplied; volatility score is neutral and marked by inputs.', {
      iv: null,
      maximumIV,
    });
  }
  const ceiling = maximumIV ?? 0.85;
  const value = iv <= ceiling ? 100 - Math.max(0, iv - 0.25) * 70 : Math.max(0, 45 - (iv - ceiling) * 100);
  return score('volatility', value, 'IV below the configured ceiling scores better; elevated IV reduces risk/reward quality.', {
    iv,
    maximumIV: ceiling,
  });
}

function calculateRisk(contract: DecisionContractSnapshot, liquidity: ExplainedScore, spread: ExplainedScore, volatility: ExplainedScore): ExplainedScore {
  const theta = finite(contract.theta);
  const delta = finite(contract.delta);
  const thetaPenalty = theta == null ? 8 : Math.min(22, Math.abs(theta) * 100);
  const deltaPenalty = delta == null ? 6 : Math.max(0, (Math.abs(delta) - 0.65) * 60);
  const base = liquidity.score * 0.3 + spread.score * 0.3 + volatility.score * 0.25 + 15;
  return score('risk', base - thetaPenalty - deltaPenalty, 'Risk score rewards tradability and penalizes high theta decay or extreme delta exposure.', {
    theta,
    delta,
    liquidityScore: liquidity.score,
    spreadScore: spread.score,
    volatilityScore: volatility.score,
  });
}

function calculateTrend(inputTrend: DecisionMarketContext['trend'], contract: DecisionContractSnapshot): ExplainedScore {
  const delta = finite(contract.delta);
  let value = 50;
  if (inputTrend === 'BULLISH' && contract.type === 'call') value = 75;
  if (inputTrend === 'BEARISH' && contract.type === 'put') value = 75;
  if (inputTrend === 'BULLISH' && contract.type === 'put') value = 35;
  if (inputTrend === 'BEARISH' && contract.type === 'call') value = 35;
  if (delta != null) value += Math.max(-15, Math.min(15, (Math.abs(delta) - 0.35) * 50));
  return score('trend', value, 'Trend score uses supplied market context plus contract delta as directional exposure evidence.', {
    suppliedTrend: inputTrend,
    contractType: contract.type,
    delta,
  });
}

function calculateMomentum(inputMomentum: DecisionMarketContext['momentum'], contract: DecisionContractSnapshot): ExplainedScore {
  const volume = finite(contract.volume);
  let value = inputMomentum === 'POSITIVE' ? 72 : inputMomentum === 'NEGATIVE' ? 38 : 52;
  if (volume != null) value += Math.min(18, Math.log10(Math.max(1, volume)) * 4);
  return score('momentum', value, 'Momentum score uses supplied momentum context and contract volume participation.', {
    suppliedMomentum: inputMomentum,
    volume,
  });
}

function calculateConfidence(scores: Omit<DecisionScores, 'confidence' | 'overall'>): ExplainedScore {
  const value =
    scores.liquidity.score * 0.2 +
    scores.trend.score * 0.15 +
    scores.momentum.score * 0.15 +
    scores.spread.score * 0.2 +
    scores.volatility.score * 0.1 +
    scores.risk.score * 0.2;
  return score('confidence', value, 'Confidence is a weighted blend of explainable market, contract, and risk scores.', {
    liquidityScore: scores.liquidity.score,
    trendScore: scores.trend.score,
    momentumScore: scores.momentum.score,
    spreadScore: scores.spread.score,
    volatilityScore: scores.volatility.score,
    riskScore: scores.risk.score,
  });
}

function buildScores(args: {
  contract: DecisionContractSnapshot;
  marketContext: DecisionMarketContext;
  maxSpreadPct: number;
  minimumOi: number;
  minimumVolume: number;
  maximumIV: number | null;
}): DecisionScores {
  const liquidity = calculateLiquidity(args.contract, args.minimumOi, args.minimumVolume);
  const trend = calculateTrend(args.marketContext.trend, args.contract);
  const momentum = calculateMomentum(args.marketContext.momentum, args.contract);
  const spread = calculateSpread(args.contract, args.maxSpreadPct);
  const volatility = calculateVolatility(args.contract, args.maximumIV);
  const risk = calculateRisk(args.contract, liquidity, spread, volatility);
  const confidence = calculateConfidence({ liquidity, trend, momentum, spread, volatility, risk });
  const overall = score('overall', confidence.score, 'Overall score equals the final explainable confidence score for ranking.', {
    confidenceScore: confidence.score,
  });
  return { liquidity, trend, momentum, spread, volatility, risk, confidence, overall };
}

function reasonCodes(args: {
  contract: DecisionContractSnapshot;
  scores: DecisionScores;
  minConfidence: number;
  maxSpreadPct: number;
  minimumOi: number;
  minimumVolume: number;
  maximumIV: number | null;
  marketStatus: string;
  chainComplete: boolean;
}): DecisionEngineReasonCode[] {
  const codes: DecisionEngineReasonCode[] = [];
  if (args.marketStatus !== 'open') codes.push('MARKET_CLOSED');
  if (!args.chainComplete) codes.push('INCOMPLETE_CHAIN');
  if (finite(args.contract.bid) == null || finite(args.contract.ask) == null) codes.push('NO_BID_ASK');
  if ((finite(args.contract.volume) ?? 0) < args.minimumVolume) codes.push('LOW_VOLUME');
  if ((finite(args.contract.openInterest) ?? 0) < args.minimumOi) codes.push('LOW_OPEN_INTEREST');
  const pct = spreadPct(args.contract);
  if (pct == null || pct > args.maxSpreadPct) codes.push('HIGH_SPREAD');
  const iv = finite(args.contract.iv);
  if (args.maximumIV != null && iv != null && iv > args.maximumIV) codes.push('HIGH_IV');
  if (args.scores.confidence.score / 100 < args.minConfidence) codes.push('LOW_CONFIDENCE');
  if (args.scores.risk.score < 45) codes.push('ELEVATED_RISK');
  if (args.scores.trend.score < 45) codes.push('WEAK_TREND');
  if (args.scores.momentum.score < 45) codes.push('WEAK_MOMENTUM');
  return [...new Set(codes)];
}

export function rejectionExplanation(code: DecisionEngineReasonCode, contract: DecisionContractSnapshot): string {
  const label = contract.symbol;
  const map: Record<DecisionEngineReasonCode, string> = {
    LOW_VOLUME: `${label} was rejected because supplied contract volume is below the configured minimum.`,
    HIGH_SPREAD: `${label} was rejected because the bid/ask spread is too wide for an explainable entry.`,
    LOW_CONFIDENCE: `${label} was rejected because blended confidence is below the watchlist threshold.`,
    POOR_RISK_REWARD: `${label} was rejected because the expected reward does not justify the observed risk.`,
    HIGH_IV: `${label} was rejected because supplied IV is above the configured ceiling.`,
    LOW_OPEN_INTEREST: `${label} was rejected because open interest is below the configured minimum.`,
    MARKET_CLOSED: `${label} was rejected because the market is not open.`,
    BUYING_POWER: `${label} was rejected because buying power is insufficient for the position-size policy.`,
    DATA_UNAVAILABLE: `${label} was rejected because required market data was unavailable.`,
    INCOMPLETE_CHAIN: `${label} was rejected because the option-chain window was incomplete.`,
    STALE_QUOTE: `${label} was rejected because the quote was stale.`,
    NO_BID_ASK: `${label} was rejected because bid/ask data was not supplied.`,
    LOW_LIQUIDITY: `${label} was rejected because liquidity quality is too low.`,
    WEAK_TREND: `${label} was rejected because supplied trend context does not support the contract.`,
    WEAK_MOMENTUM: `${label} was rejected because momentum evidence is weak.`,
    ELEVATED_RISK: `${label} was rejected because risk score is elevated after spread, IV, delta, and theta checks.`,
  };
  return map[code];
}

function expectedMove(contract: DecisionContractSnapshot): AiResearchOutput['expectedMove'] {
  const iv = finite(contract.iv);
  const dte = finite(contract.dte);
  if (iv == null || dte == null) {
    return {
      source: 'UNAVAILABLE',
      value: null,
      explanation: 'Expected move was not calculated because supplied IV or DTE is missing.',
    };
  }
  return {
    source: 'SUPPLIED_IV',
    value: Number((iv * Math.sqrt(Math.max(1, dte) / 365)).toFixed(4)),
    explanation: 'Expected move uses supplied IV and DTE only; no price or Greek was inferred.',
  };
}

export function generateAiResearch(candidate: Omit<CandidateOpportunity, 'aiResearch'>): AiResearchOutput {
  const bullishReasons: string[] = [];
  const bearishReasons: string[] = [];
  const risks: string[] = [];
  if (candidate.direction === 'BULLISH') bullishReasons.push('Candidate is a call contract, so its payoff direction is bullish.');
  if (candidate.direction === 'BEARISH') bearishReasons.push('Candidate is a put contract, so its payoff direction is bearish.');
  if (candidate.scores.liquidity.score >= 70) bullishReasons.push(candidate.scores.liquidity.explanation);
  if (candidate.scores.trend.score >= 70) bullishReasons.push(candidate.scores.trend.explanation);
  if (candidate.scores.spread.score < 55) risks.push(candidate.scores.spread.explanation);
  if (candidate.scores.volatility.score < 55) risks.push(candidate.scores.volatility.explanation);
  if (candidate.scores.risk.score < 55) risks.push(candidate.scores.risk.explanation);
  if (candidate.rejectionCodes.length) risks.push(...candidate.rejectionCodes.map(code => rejectionExplanation(code, candidate.contract)));
  return {
    symbol: candidate.symbol,
    contract: candidate.contract.symbol,
    confidence: candidate.confidence,
    bullishReasons,
    bearishReasons,
    risks,
    marketContext: candidate.marketContext,
    expectedMove: expectedMove(candidate.contract),
    recommendation: candidate.recommendation,
    explanation: candidate.thesis,
  };
}

function normalizeContract(raw: DecisionContractSnapshot, now: number): DecisionContractSnapshot {
  const bid = finite(raw.bid);
  const ask = finite(raw.ask);
  const mid = finite(raw.mid) ?? (bid != null && ask != null ? Number(((bid + ask) / 2).toFixed(4)) : null);
  const spread = finite(raw.spread) ?? (bid != null && ask != null ? Number((ask - bid).toFixed(4)) : null);
  return {
    ...raw,
    bid,
    ask,
    mid,
    spread,
    spreadPct: finite(raw.spreadPct) ?? (spread != null && mid != null && mid > 0 ? Number((spread / mid).toFixed(4)) : null),
    dte: finite(raw.dte) ?? computeDteEt(raw.expiration, now),
    volume: finite(raw.volume),
    openInterest: finite(raw.openInterest),
    iv: finite(raw.iv),
    delta: finite(raw.delta),
    gamma: finite(raw.gamma),
    theta: finite(raw.theta),
    vega: finite(raw.vega),
  };
}

export function detectCandidateOpportunities(input: DecisionEngineScanInput): CandidateOpportunity[] {
  const now = input.now ?? Date.now();
  const marketStatus = input.marketStatus ?? 'unknown';
  const candidates: CandidateOpportunity[] = [];
  for (const item of input.watchlist) {
    const symbol = item.symbol.trim().toUpperCase();
    const chain = input.chains[symbol];
    if (!chain) continue;
    const marketContext: DecisionMarketContext = {
      marketStatus,
      underlyingPrice: chain.underlyingPrice,
      underlyingTimeframe: chain.underlyingTimeframe ?? null,
      sector: item.sector ?? null,
      marketBreadth: item.marketBreadth ?? null,
      news: item.news ?? [],
      trend: 'UNKNOWN',
      momentum: 'UNKNOWN',
    };
    const maxSpreadPct = Math.max(0.0001, (item.maxSpreadPercent ?? 10) / 100);
    const minimumOi = item.minimumOpenInterest ?? 200;
    const minimumVolume = item.minimumVolume ?? 25;
    const minConfidence = item.minConfidence ?? 0.5;
    const maximumIV = item.maximumIV ?? null;
    for (const rawContract of chain.contracts) {
      const contract = normalizeContract(rawContract, now);
      const scores = buildScores({
        contract,
        marketContext,
        maxSpreadPct,
        minimumOi,
        minimumVolume,
        maximumIV,
      });
      const codes = reasonCodes({
        contract,
        scores,
        minConfidence,
        maxSpreadPct,
        minimumOi,
        minimumVolume,
        maximumIV,
        marketStatus,
        chainComplete: chain.complete !== false,
      });
      const direction = inferDirection(contract);
      const recommendation: CandidateOpportunity['recommendation'] =
        codes.length === 0 && direction === 'BULLISH'
          ? 'BUY_CALL'
          : codes.length === 0 && direction === 'BEARISH'
            ? 'BUY_PUT'
            : scores.overall.score >= 60
              ? 'WATCH'
              : 'AVOID';
      const thesis = codes.length
        ? `${contract.symbol} is not actionable: ${codes.map(code => rejectionExplanation(code, contract)).join(' ')}`
        : `${contract.symbol} is actionable because the supplied contract data clears liquidity, spread, volatility, and confidence gates.`;
      const candidateBase = {
        id: randomUUID(),
        symbol,
        contract,
        direction,
        watchlistRank: item.priority ?? null,
        scores,
        confidence: Number((scores.confidence.score / 100).toFixed(4)),
        overallScore: scores.overall.score,
        recommendation,
        thesis,
        rejectionCodes: codes,
        rejectionExplanation: codes[0] ? rejectionExplanation(codes[0], contract) : null,
        marketContext,
      };
      candidates.push({ ...candidateBase, aiResearch: generateAiResearch(candidateBase) });
    }
  }
  return candidates.sort((a, b) => b.overallScore - a.overallScore || a.contract.symbol.localeCompare(b.contract.symbol));
}
