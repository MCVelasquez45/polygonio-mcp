import type { StrategyDefinition, StrategyEvaluation, StrategyEvaluationContext, StrategyDirection } from '../types/orchestratorTypes';
import { portfolioSectorPenalty } from '../portfolio/portfolioContext.service';

type StrategyProfile = {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  directionBias?: StrategyDirection;
  sectors?: string[];
  assets?: StrategyDefinition['supportedAssets'];
  baseExpectedReturn?: number;
  baseRisk?: number;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function eventFit(context: StrategyEvaluationContext, keywords: string[]): number {
  const text = context.eventContext.latestEvents.map(event => `${event.title} ${event.category}`).join(' ').toLowerCase();
  if (!text) return 0.35;
  return keywords.some(keyword => text.includes(keyword.toLowerCase())) ? 0.9 : 0.45;
}

function directionFromContext(context: StrategyEvaluationContext, bias?: StrategyDirection): StrategyDirection {
  if (bias) return bias;
  const bearish = context.sentiment.bearish;
  const bullish = context.sentiment.bullish;
  if (bearish > bullish) return 'BEARISH';
  if (bullish > bearish) return 'BULLISH';
  return 'NEUTRAL';
}

function makeStrategy(profile: StrategyProfile): StrategyDefinition {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    requiredInputs: ['eventContext', 'decisionContext', 'portfolio', 'watchlist', 'marketRegime'],
    supportedAssets: profile.assets ?? ['equity', 'option', 'etf'],
    evaluate(context: StrategyEvaluationContext): StrategyEvaluation {
      const fit = eventFit(context, profile.keywords);
      const decisionBoost = context.decisionContext.bestOpportunity ? context.decisionContext.bestOpportunity.confidence * 0.2 : 0;
      const regimeBoost = context.marketRegime.confidence * 0.15;
      const sectorPenalty = portfolioSectorPenalty(context.portfolio, profile.sectors ?? []);
      const confidence = clamp01(fit * 0.55 + decisionBoost + regimeBoost - sectorPenalty / 100);
      const evidenceScore = Math.max(0, Math.min(100, confidence * 70 + (context.eventContext.latestEvents[0]?.importance ?? 0) * 0.3));
      const risk = clamp01((profile.baseRisk ?? 0.35) + sectorPenalty / 100 + (context.portfolio.openRisk ? 0.08 : 0));
      const expectedReturn = clamp01((profile.baseExpectedReturn ?? 0.45) + confidence * 0.25 - risk * 0.12);
      const rejected = confidence < 0.38;
      return {
        strategyId: profile.id,
        name: profile.name,
        direction: directionFromContext(context, profile.directionBias),
        confidence,
        risk,
        expectedReturn,
        positionSize: rejected ? 0 : clamp01(0.02 + confidence * 0.08 - risk * 0.03),
        evidenceScore,
        reasoning: [
          `${profile.name} event fit is ${(fit * 100).toFixed(1)}%.`,
          context.marketRegime.explanation,
          context.portfolio.adjustmentExplanation,
          sectorPenalty ? `Portfolio sector exposure reduced confidence by ${sectorPenalty.toFixed(1)} points.` : 'No portfolio sector concentration penalty applied.',
        ],
        rejected,
        rejectionReason: rejected ? 'Strategy evidence below attention threshold.' : null,
      };
    },
  };
}

const PROFILES: StrategyProfile[] = [
  { id: 'momentum', name: 'Momentum', description: 'Follows broad directional strength.', keywords: ['momentum', 'upgrade', 'record'], baseExpectedReturn: 0.5 },
  { id: 'trend-following', name: 'Trend Following', description: 'Follows persistent market direction.', keywords: ['trend', 'breakout', 'higher'], baseExpectedReturn: 0.48 },
  { id: 'breakout', name: 'Breakout', description: 'Targets expansion from a range.', keywords: ['breakout', 'surge', 'volume'], baseRisk: 0.42 },
  { id: 'pullback', name: 'Pullback', description: 'Waits for continuation after retracement.', keywords: ['pullback', 'dip', 'retest'], directionBias: 'NEUTRAL' },
  { id: 'mean-reversion', name: 'Mean Reversion', description: 'Looks for stretched moves to normalize.', keywords: ['overbought', 'oversold', 'range'], directionBias: 'NEUTRAL', baseRisk: 0.3 },
  { id: 'high-volume', name: 'High Volume', description: 'Prioritizes unusual participation.', keywords: ['volume', 'surge', 'earnings'] },
  { id: 'gamma-expansion', name: 'Gamma Expansion', description: 'Focuses on convexity expansion in options.', keywords: ['gamma', 'options', 'ai'], assets: ['option'], baseRisk: 0.5 },
  { id: 'volatility-compression', name: 'Volatility Compression', description: 'Watches low volatility setups.', keywords: ['compression', 'low volatility', 'calm'], directionBias: 'NEUTRAL' },
  { id: 'news-momentum', name: 'News Momentum', description: 'Trades attention after meaningful news.', keywords: ['news', 'ceasefire', 'launch', 'earnings'], baseExpectedReturn: 0.55 },
  { id: 'macro-rotation', name: 'Macro Rotation', description: 'Rotates based on macro data.', keywords: ['inflation', 'treasury', 'fed', 'macro'], assets: ['etf', 'macro'] },
  { id: 'oil-commodity', name: 'Oil / Commodity', description: 'Maps oil and commodity events to energy assets.', keywords: ['oil', 'crude', 'opec', 'commodity'], sectors: ['Energy'], assets: ['commodity', 'etf', 'equity'] },
  { id: 'fed-reaction', name: 'Fed Reaction', description: 'Evaluates Fed-sensitive moves.', keywords: ['fed', 'fomc', 'powell', 'treasury'], assets: ['macro', 'etf'] },
  { id: 'sector-rotation', name: 'Sector Rotation', description: 'Compares sector-level opportunity.', keywords: ['sector', 'energy', 'financial', 'technology'], assets: ['etf', 'equity'] },
  { id: 'options-flow', name: 'Options Flow', description: 'Uses decision engine options opportunity context.', keywords: ['options', 'flow', 'contract'], assets: ['option'] },
  { id: 'ai-consensus', name: 'AI Consensus', description: 'Aggregates agreement from intelligence layers.', keywords: ['ai', 'consensus', 'news', 'macro', 'oil'], baseRisk: 0.28 },
];

export const STRATEGY_REGISTRY: StrategyDefinition[] = PROFILES.map(makeStrategy);

export function listRegisteredStrategies(): StrategyDefinition[] {
  return STRATEGY_REGISTRY;
}
