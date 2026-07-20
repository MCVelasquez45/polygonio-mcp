// Registry of AI Desk agents. Each agent declares which context sections the
// orchestrator must gather and the analyst brief that shapes the report.
// Section markers must stay renderable by the client's structured-reply parser
// (**Label**: body lines).

export type AgentDefinition = {
  id: string;
  label: string;
  description: string;
  contexts: string[];
  /** Analyst brief injected into the prompt after the data package. */
  brief: string;
  /** Required report sections, in order. */
  sections: string[];
};

const BASE_SECTIONS_TAIL = ['Risk Assessment', 'Action Items', 'Confidence', 'Sources Used', 'Sources Unavailable'];

export const AI_AGENTS: AgentDefinition[] = [
  {
    id: 'technical-analyst',
    label: 'Technical Analyst',
    description: 'Chart structure, trend, momentum, and a trade thesis for the active timeframe.',
    contexts: ['technical', 'news', 'macro'],
    brief:
      'Act as a senior technical analyst. Read the candle series and computed studies (EMA20/50, VWAP, RSI, MACD, Bollinger, ATR, volume, support/resistance). Identify market structure, trend state, momentum, breakout or reversal setups, and the highest-probability scenario. Give a concrete thesis with entry, stop, and two targets sized off ATR and key levels.',
    sections: ['Executive Summary', 'Market Structure', 'Trend', 'Momentum', 'Key Levels', 'Trading Thesis', 'Entry', 'Stop', 'Targets', ...BASE_SECTIONS_TAIL],
  },
  {
    id: 'options-risk-analyst',
    label: 'Options Risk Analyst',
    description: 'Liquidity, greeks, IV, decay, and assignment risk for the selected contract.',
    contexts: ['options', 'technical', 'portfolio'],
    brief:
      'Act as an options risk manager. Evaluate the selected contract: liquidity (spread, OI, volume), theta decay against the holding window, gamma risk near expiration, vega exposure and volatility-crush risk around events, and assignment risk for ITM shorts. Use the expected-move figure when present. Grade the risk and prescribe a position size and exit plan.',
    sections: ['Executive Summary', 'Liquidity', 'Greeks Exposure', 'Decay Risk', 'Volatility Risk', 'Assignment Risk', 'Risk Grade', 'Position Size', 'Exit Plan', 'Probability', ...BASE_SECTIONS_TAIL],
  },
  {
    id: 'market-catalyst',
    label: 'Market Catalyst Analyst',
    description: 'Why is it moving? News, earnings, congress, macro, and flow ranked by impact.',
    contexts: ['news', 'earnings', 'congress', 'calendar', 'macro', 'technical'],
    brief:
      'Act as a catalyst analyst. Determine why the symbol is moving: rank the primary catalyst and secondary catalysts from the news items (with sentiment), earnings history, congressional activity, macro releases, and price/volume action. Distinguish confirmed catalysts from speculation. Build a short timeline of events.',
    sections: ['Executive Summary', 'Primary Catalyst', 'Secondary Catalysts', 'Timeline', 'Market Reaction', 'Probability', ...BASE_SECTIONS_TAIL],
  },
  {
    id: 'market-recap',
    label: 'Market Recap',
    description: 'Session recap: indices, VIX, yields, breadth proxies, news, and tomorrow’s catalysts.',
    contexts: ['macro', 'news', 'technical', 'calendar', 'intelligence'],
    brief:
      'Act as a desk strategist writing the session recap. Cover the tape (SPX/NDX/DJI/VIX from the indices snapshot), rates (treasury curve), the symbol in focus, notable news with sentiment, what the platform’s own daily report captured, and the catalysts on the economic calendar next. Note explicitly which market segments you have no data for (sector breadth, oil, gold, dollar) rather than inventing them.',
    sections: ['Executive Summary', 'Index Tape', 'Rates & Volatility', 'Symbol In Focus', 'Major News', 'Platform Intelligence', "Tomorrow's Catalysts", ...BASE_SECTIONS_TAIL],
  },
  {
    id: 'congressional-intel',
    label: 'Congressional Intelligence',
    description: 'CapitolTrades positioning around the symbol: who, what, and whether it matters.',
    contexts: ['congress', 'news', 'technical'],
    brief:
      'Act as a congressional-trading analyst. From the CapitolTrades data, summarize recent transactions relevant to the symbol or its sector: representatives, sides, sizes, and timing versus price action. Assess whether the pattern is signal or noise, and derive any trade implications. If congressional data is unavailable, say so plainly and reduce confidence.',
    sections: ['Executive Summary', 'Recent Transactions', 'Pattern Analysis', 'Signal Or Noise', 'Trade Ideas', ...BASE_SECTIONS_TAIL],
  },
  {
    id: 'fed-intel',
    label: 'Fed Intelligence',
    description: 'Rates, inflation, labor, and curve positioning — and what it means for the symbol.',
    contexts: ['macro', 'calendar', 'news', 'technical'],
    brief:
      'Act as a macro strategist. Read the treasury curve (levels and recent direction), realized inflation series, and labor-market series to characterize current Fed policy pressure. Map the upcoming FRED release calendar to event risk. Conclude with a bullish/bearish macro bias for the symbol and its sector. FOMC statements and FedWatch odds are not integrated — do not fabricate them.',
    sections: ['Executive Summary', 'Policy Read', 'Yield Curve', 'Inflation & Labor', 'Upcoming Event Risk', 'Impact On Symbol', 'Macro Bias', ...BASE_SECTIONS_TAIL],
  },
  {
    id: 'trade-thesis',
    label: 'Trade Thesis',
    description: 'Institutional bull/bear thesis synthesizing technicals, options, news, macro, and congress.',
    contexts: ['technical', 'options', 'news', 'macro', 'congress', 'earnings'],
    brief:
      'Act as a portfolio manager writing an institutional trade thesis. Synthesize every data section into a bull case and bear case with explicit evidence, weigh them into a directional stance with probability, and define the catalysts that would confirm or kill the thesis.',
    sections: ['Executive Summary', 'Bull Case', 'Bear Case', 'Catalysts', 'Technical Analysis', 'Options Analysis', 'Macro Analysis', 'Congressional Activity', 'Probability', 'Trading Plan', ...BASE_SECTIONS_TAIL],
  },
  {
    id: 'smart-entry',
    label: 'Smart Entry',
    description: 'Optimal entry, stop, targets, and size from live levels, ATR, and account state.',
    contexts: ['technical', 'options', 'portfolio'],
    brief:
      'Act as an execution trader. Using current levels, ATR, VWAP, support/resistance, the option expected move, and the actual account buying power, compute an optimal entry zone, a stop that respects structure (not arbitrary percentages), two profit targets, position size in contracts or shares risking at most 1-2% of equity, and the resulting risk/reward and expected value.',
    sections: ['Executive Summary', 'Entry', 'Stop', 'Targets', 'Position Size', 'Risk Reward', 'Expected Return', 'Probability', ...BASE_SECTIONS_TAIL],
  },
  {
    id: 'exit-strategy',
    label: 'Exit Strategy',
    description: 'Hold, trim, scale, exit, or roll — judged from live position, greeks, and trend.',
    contexts: ['portfolio', 'options', 'technical', 'automation', 'macro'],
    brief:
      'Act as a risk-first position manager. For the open positions (prioritize the selected symbol if held), weigh unrealized P/L, remaining theta runway, gamma/vega exposure, trend and momentum state, automation signals, and macro backdrop. Recommend exactly one primary action per position — hold, trim, scale, exit, or roll — with triggers.',
    sections: ['Executive Summary', 'Position Review', 'Greeks Exposure', 'Trend Check', 'Recommendation', 'Triggers', ...BASE_SECTIONS_TAIL],
  },
  {
    id: 'portfolio-risk',
    label: 'Portfolio Risk',
    description: 'Concentration, correlation, macro exposure, and recommended adjustments.',
    contexts: ['portfolio', 'automation', 'macro', 'intelligence'],
    brief:
      'Act as a chief risk officer. Review the whole book: concentration by symbol and sector, correlation between positions, directional and volatility exposure, cash versus deployed capital, drawdown state from the automation metrics, and macro sensitivities from the rates/inflation data. Produce an executive risk report with concrete adjustments.',
    sections: ['Executive Summary', 'Concentration', 'Correlation', 'Macro Exposure', 'Volatility Exposure', 'Drawdown State', 'Recommended Adjustments', ...BASE_SECTIONS_TAIL],
  },
];

export function getAgentById(agentId: string): AgentDefinition | undefined {
  return AI_AGENTS.find(agent => agent.id === agentId);
}
