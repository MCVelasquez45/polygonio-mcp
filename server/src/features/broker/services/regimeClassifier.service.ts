/**
 * Regime classifier — determines risk-on / risk-off / mixed market regime
 * by fetching real-time sector ETF and mega-cap leader data from Alpaca.
 *
 * Uses the strategy's regime_config (extracted by SIFT) to know which
 * tickers to watch and what action to take in each regime.
 */

import { getAlpacaSnapshots } from './alpaca';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RegimeConfig = {
  risk_on_tickers: string[];   // e.g. ["XLK","XLF","XLY","SMH","ARKK"]
  risk_off_tickers: string[];  // e.g. ["XLP","XLV","XLC","XLU"]
  leader_tickers: string[];    // e.g. ["NVDA","AAPL","MSFT","GOOG","AMZN","META","TSLA"]
  risk_on_action: string;      // e.g. "put_credit_spread"
  risk_off_action: string;     // e.g. "call_credit_spread"
};

export type RegimeResult = {
  regime: 'risk_on' | 'risk_off' | 'mixed';
  confidence: number;          // 0-1
  action: 'put_credit_spread' | 'call_credit_spread' | 'no_trade';
  details: {
    riskOnScore: number;       // % of risk-on tickers that are green
    riskOffScore: number;      // % of risk-off tickers that are green
    leaderScore: number;       // % of leader tickers that are green
    leaderBias: 'bullish' | 'bearish' | 'neutral';
    tickerChanges: Array<{ symbol: string; changePct: number; group: string }>;
  };
  timestamp: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractChangePct(snapshot: any): number {
  // Alpaca snapshot has dailyBar.c (close) and prevDailyBar.c (prev close)
  const current = snapshot?.dailyBar?.c ?? snapshot?.dailyBar?.ClosePrice ?? snapshot?.latestTrade?.Price ?? snapshot?.latestTrade?.p ?? 0;
  const prev = snapshot?.prevDailyBar?.c ?? snapshot?.prevDailyBar?.ClosePrice ?? 0;
  if (!prev || !current) return 0;
  return ((current - prev) / prev) * 100;
}

// ---------------------------------------------------------------------------
// Main classifier
// ---------------------------------------------------------------------------

export async function classifyRegime(config: RegimeConfig): Promise<RegimeResult> {
  const allTickers = [
    ...config.risk_on_tickers,
    ...config.risk_off_tickers,
    ...config.leader_tickers,
  ];
  const uniqueTickers = [...new Set(allTickers.map(t => t.toUpperCase()))];

  // Fetch all snapshots in one batch call
  const snapshots = await getAlpacaSnapshots(uniqueTickers);

  // Build a map of symbol -> changePct
  const changeMap = new Map<string, number>();
  if (Array.isArray(snapshots)) {
    for (const snap of snapshots) {
      const symbol = snap?.symbol ?? snap?.Symbol ?? '';
      if (symbol) {
        changeMap.set(symbol.toUpperCase(), extractChangePct(snap));
      }
    }
  }
  // Also handle Map return type from some SDK versions
  if (snapshots instanceof Map) {
    for (const [symbol, snap] of snapshots as any) {
      changeMap.set(symbol.toUpperCase(), extractChangePct(snap));
    }
  }

  const tickerChanges: RegimeResult['details']['tickerChanges'] = [];

  // Score risk-on tickers (what % are green)
  let riskOnGreen = 0;
  for (const ticker of config.risk_on_tickers) {
    const pct = changeMap.get(ticker.toUpperCase()) ?? 0;
    tickerChanges.push({ symbol: ticker, changePct: pct, group: 'risk_on' });
    if (pct > 0.05) riskOnGreen++;
  }
  const riskOnScore = config.risk_on_tickers.length > 0
    ? riskOnGreen / config.risk_on_tickers.length
    : 0;

  // Score risk-off tickers
  let riskOffGreen = 0;
  for (const ticker of config.risk_off_tickers) {
    const pct = changeMap.get(ticker.toUpperCase()) ?? 0;
    tickerChanges.push({ symbol: ticker, changePct: pct, group: 'risk_off' });
    if (pct > 0.05) riskOffGreen++;
  }
  const riskOffScore = config.risk_off_tickers.length > 0
    ? riskOffGreen / config.risk_off_tickers.length
    : 0;

  // Score leaders (heavily weighted — NVDA/AAPL drive SPX)
  let leaderGreen = 0;
  let leaderRed = 0;
  for (const ticker of config.leader_tickers) {
    const pct = changeMap.get(ticker.toUpperCase()) ?? 0;
    tickerChanges.push({ symbol: ticker, changePct: pct, group: 'leader' });
    if (pct > 0.1) leaderGreen++;
    else if (pct < -0.1) leaderRed++;
  }
  const leaderScore = config.leader_tickers.length > 0
    ? leaderGreen / config.leader_tickers.length
    : 0;
  const leaderBias: 'bullish' | 'bearish' | 'neutral' =
    leaderGreen > leaderRed ? 'bullish' : leaderRed > leaderGreen ? 'bearish' : 'neutral';

  // Classify regime
  let regime: RegimeResult['regime'];
  let confidence: number;
  let action: RegimeResult['action'];

  if (riskOnScore >= 0.6 && riskOffScore < 0.5) {
    // Clear risk-on: offensive sectors green, defensive not dominant
    regime = 'risk_on';
    confidence = Math.min(1, (riskOnScore + leaderScore) / 2);
    action = config.risk_on_action as RegimeResult['action'];
  } else if (riskOffScore >= 0.6 && riskOnScore < 0.5) {
    // Clear risk-off: defensive sectors green, offensive lagging
    regime = 'risk_off';
    confidence = Math.min(1, (riskOffScore + (1 - leaderScore)) / 2);
    action = config.risk_off_action as RegimeResult['action'];
  } else {
    // Mixed — defer to leaders (as the strategy describes)
    regime = 'mixed';
    if (leaderBias === 'bullish') {
      action = config.risk_on_action as RegimeResult['action'];
      confidence = leaderScore * 0.7;
    } else if (leaderBias === 'bearish') {
      action = config.risk_off_action as RegimeResult['action'];
      confidence = (1 - leaderScore) * 0.7;
    } else {
      action = 'no_trade';
      confidence = 0.3;
    }
  }

  return {
    regime,
    confidence,
    action,
    details: {
      riskOnScore,
      riskOffScore,
      leaderScore,
      leaderBias,
      tickerChanges,
    },
    timestamp: new Date().toISOString(),
  };
}
