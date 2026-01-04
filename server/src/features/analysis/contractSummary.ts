import { agentAnalyze } from '../assistant/agentClient';

type ContractExplanationInput = {
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
};

type ContractExplanationResult = {
  whatThisTradeDoes: string;
  whatNeedsToHappen: string[];
  mainRisks: string[];
  whyAIChoseThis: string[];
  riskLevel: string | null;
  source: 'agent' | 'fallback';
};

const SYSTEM_PROMPT = `
You are a beginner-friendly trading explainer.

Your job is to explain a professional options decision in plain language.
Assume the user is learning and needs clarity, not jargon.

OUTPUT (STRICT JSON):
{
  "whatThisTradeDoes": string,
  "whatNeedsToHappen": string[],
  "mainRisks": string[],
  "whyAIChoseThis": string[],
  "riskLevel": string | null
}

Rules:
- Be concise. No filler.
- Avoid jargon; if you mention it, explain it briefly.
- Use the provided numbers only; do not invent data.
- Use decision.reasons and decision.warnings as your sources for "why" and "risks".
- Include 2 to 4 bullets per list at most.
`;

function buildPrompt(context: ContractExplanationInput) {
  return `${SYSTEM_PROMPT}\n\nContext:\n${JSON.stringify(context, null, 2)}\n\nReturn JSON only.`;
}

function parseJsonFromText(raw: string): any | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function buildFallbackSummary(input: ContractExplanationInput): ContractExplanationResult {
  const direction = input.contract.type === 'call' ? 'up' : 'down';
  const whatThisTradeDoes = `This trade makes money if ${input.underlying} moves ${direction}.`;
  const whatNeedsToHappen: string[] = [];
  const mainRisks: string[] = [];
  const whyAIChoseThis: string[] = [];

  if (input.breakeven != null) {
    const needsAbove = input.contract.type === 'call';
    whatNeedsToHappen.push(
      `${input.underlying} needs to move ${needsAbove ? 'above' : 'below'} about $${input.breakeven.toFixed(2)}.`
    );
  }
  whatNeedsToHappen.push('The move should happen before time decay reduces the option value.');

  if (input.decision.fallbackUsed) {
    mainRisks.push('This was a fallback choice because ideal contracts were not available.');
  }
  if (input.decision.warnings.length) {
    mainRisks.push(...input.decision.warnings.slice(0, 2));
  }

  if (input.decision.reasons.length) {
    whyAIChoseThis.push(...input.decision.reasons.slice(0, 3));
  }
  if (!whyAIChoseThis.length) {
    whyAIChoseThis.push('This was the best available contract under current constraints.');
  }

  return {
    whatThisTradeDoes,
    whatNeedsToHappen: whatNeedsToHappen.slice(0, 3),
    mainRisks: mainRisks.slice(0, 3),
    whyAIChoseThis: whyAIChoseThis.slice(0, 3),
    riskLevel: input.risk.label
      ? `${input.risk.label}${input.risk.score != null ? ` — ${Math.round(input.risk.score * 100)}%` : ''}`
      : null,
    source: 'fallback'
  };
}

export async function summarizeContract(input: ContractExplanationInput): Promise<ContractExplanationResult> {
  const prompt = buildPrompt(input);
  try {
    const response = await agentAnalyze(prompt, { contractSummary: input });
    const output = response?.output ?? response?.result ?? response?.reply ?? response;
    const parsed = parseJsonFromText(typeof output === 'string' ? output : '');
    if (parsed && typeof parsed === 'object') {
      return {
        whatThisTradeDoes: typeof parsed.whatThisTradeDoes === 'string' ? parsed.whatThisTradeDoes : '',
        whatNeedsToHappen: Array.isArray(parsed.whatNeedsToHappen) ? parsed.whatNeedsToHappen.filter(Boolean) : [],
        mainRisks: Array.isArray(parsed.mainRisks) ? parsed.mainRisks.filter(Boolean) : [],
        whyAIChoseThis: Array.isArray(parsed.whyAIChoseThis) ? parsed.whyAIChoseThis.filter(Boolean) : [],
        riskLevel: typeof parsed.riskLevel === 'string' ? parsed.riskLevel : null,
        source: 'agent'
      };
    }
  } catch (error) {
    console.warn('[CONTRACT SUMMARY] agent failed', error);
  }
  return buildFallbackSummary(input);
}
