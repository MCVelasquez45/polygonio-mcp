import type { CandidateOpportunity, DecisionRanking, RejectedCandidate } from './types';
import { rejectionExplanation } from './scoring.service';

export function rankDecisionCandidates(candidates: CandidateOpportunity[]): DecisionRanking {
  const accepted = candidates
    .filter(candidate => candidate.rejectionCodes.length === 0)
    .sort((a, b) => b.overallScore - a.overallScore || a.contract.symbol.localeCompare(b.contract.symbol));
  const rejectedCandidates: RejectedCandidate[] = candidates
    .filter(candidate => candidate.rejectionCodes.length > 0)
    .map(candidate => {
      const reasonCode = candidate.rejectionCodes[0];
      return {
        candidate,
        reasonCode,
        explanation: candidate.rejectionExplanation ?? rejectionExplanation(reasonCode, candidate.contract),
      };
    })
    .sort((a, b) => b.candidate.overallScore - a.candidate.overallScore || a.candidate.contract.symbol.localeCompare(b.candidate.contract.symbol));

  return {
    bestOpportunity: accepted[0] ?? null,
    secondBest: accepted[1] ?? null,
    thirdBest: accepted[2] ?? null,
    top10: accepted.slice(0, 10),
    rejectedCandidates,
  };
}
