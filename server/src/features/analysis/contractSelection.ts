import { agentAnalyze } from '../assistant/agentClient';

type Candidate = {
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

type ContractSelectionRequest = {
  ticker: string;
  underlyingPrice: number | null;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  marketRegime?: 'trending' | 'choppy' | 'volatile';
  candidates: Candidate[];
};

type ContractSelectionResult = {
  selectedContract: string | null;
  side: 'call' | 'put' | null;
  confidence: number | null;
  reasons: string[];
  warnings: string[];
  source: 'agent' | 'fallback';
};

const SYSTEM_PROMPT = `
You are an institutional options selection engine operating within a systematic trading platform.
Your responsibility is to select a SINGLE options contract that optimizes execution quality, liquidity,
and risk-adjusted exposure given the current market context.

SELECTION MANDATE
- Align with directional bias (bullish -> calls, bearish -> puts)
- Prioritize contracts with superior exit liquidity
- Minimize bid-ask friction and slippage
- Favor near-the-money exposure with efficient delta
- Reject contracts that introduce unnecessary execution risk

LIQUIDITY CONSTRAINTS (NON-NEGOTIABLE)
- Reject contracts with wide bid-ask spreads
- Reject contracts with insufficient open interest
- Reject contracts where exit quality is compromised

OUTPUT REQUIREMENTS
Return ONLY valid JSON with:
{
  "selectedContract": string | null,
  "side": "call" | "put" | null,
  "confidence": number | null,
  "reasons": string[],
  "warnings": string[]
}
`;

function buildPrompt(context: ContractSelectionRequest) {
  return `${SYSTEM_PROMPT}\n\nContext:\n${JSON.stringify(context, null, 2)}\n\nSelect the best contract and explain why.`;
}

function parseJsonFromText(raw: string): any | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Attempt to salvage JSON from a response that includes extra text.
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

export async function selectContract(payload: ContractSelectionRequest): Promise<ContractSelectionResult> {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  if (!candidates.length) {
    return {
      selectedContract: null,
      side: null,
      confidence: null,
      reasons: ['No eligible contracts supplied.'],
      warnings: ['Candidate list empty after filtering.'],
      source: 'fallback'
    };
  }

  const prompt = buildPrompt(payload);
  const response = await agentAnalyze(prompt, { contractSelection: payload });
  const output = response?.output ?? response?.result ?? response?.reply ?? response;
  const parsed = parseJsonFromText(typeof output === 'string' ? output : '');

  if (parsed && typeof parsed === 'object') {
    return {
      selectedContract: typeof parsed.selectedContract === 'string' ? parsed.selectedContract : null,
      side: parsed.side === 'call' || parsed.side === 'put' ? parsed.side : null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.filter(Boolean) : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter(Boolean) : [],
      source: 'agent'
    };
  }

  return {
    selectedContract: null,
    side: null,
    confidence: null,
    reasons: ['AI response could not be parsed.'],
    warnings: ['Falling back to deterministic selection.'],
    source: 'fallback'
  };
}
