import { getRiskRuleSet } from '../limits/riskRules.service';
import { RiskApprovalModel } from '../storage/riskApproval.model';
import type { ApprovalPackage, RiskJournalRecord, RiskPortfolioSnapshot, RiskRecommendationInput } from '../types/riskTypes';

export async function appendRiskJournalRecord(
  recommendation: RiskRecommendationInput,
  approval: ApprovalPackage,
  portfolio: RiskPortfolioSnapshot,
  now = new Date()
): Promise<RiskJournalRecord> {
  const rules = getRiskRuleSet(now);
  const record: RiskJournalRecord = {
    approvalId: approval.approvalId,
    timestamp: approval.timestamp,
    recommendation,
    approval,
    rejection: approval.reasons,
    reasonCodes: approval.reasons.map(reason => reason.code),
    portfolioSnapshot: portfolio,
    exposure: portfolio.exposure,
    greeks: portfolio.greeks,
    buyingPower: portfolio.buyingPower,
    riskBudget: portfolio.riskBudget,
    ruleVersion: rules.ruleVersion,
    schemaVersion: 1,
  };
  return RiskApprovalModel.create(record);
}

export async function getLatestRiskApproval(): Promise<RiskJournalRecord | null> {
  return RiskApprovalModel.findOne({}).sort({ timestamp: -1, createdAt: -1 }).lean();
}

export async function listRiskApprovals(limit = 50): Promise<RiskJournalRecord[]> {
  return RiskApprovalModel.find({})
    .sort({ timestamp: -1, createdAt: -1 })
    .limit(Math.max(1, Math.min(250, limit)))
    .lean();
}
