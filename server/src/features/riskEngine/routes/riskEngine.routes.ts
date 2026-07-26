import { Router, type Response } from 'express';
import {
  buildRiskApprovalQueue,
  buildRiskPortfolioSnapshot,
  getLatestRiskApproval,
  getRiskEngineStatus,
  getRiskRuleSet,
  listRiskApprovals,
  runRiskReview,
} from '../controllers/riskEngine.service';

export const riskEngineRouter = Router();

function sendError(res: Response, error: unknown): void {
  const status = typeof (error as any)?.status === 'number' ? (error as any).status : 500;
  res.status(status).json({ error: (error as Error)?.message ?? 'risk engine request failed' });
}

function limitFrom(value: unknown, fallback = 50): number {
  const parsed = typeof value === 'string' ? Number(value) : fallback;
  return Number.isFinite(parsed) ? parsed : fallback;
}

riskEngineRouter.get('/status', async (_req, res) => {
  try {
    res.json({ status: await getRiskEngineStatus() });
  } catch (error) {
    sendError(res, error);
  }
});

riskEngineRouter.get('/portfolio', async (_req, res) => {
  try {
    res.json({ portfolio: await buildRiskPortfolioSnapshot() });
  } catch (error) {
    sendError(res, error);
  }
});

riskEngineRouter.get('/exposure', async (_req, res) => {
  try {
    const portfolio = await buildRiskPortfolioSnapshot();
    res.json({ exposure: portfolio.exposure });
  } catch (error) {
    sendError(res, error);
  }
});

riskEngineRouter.get('/greeks', async (_req, res) => {
  try {
    const portfolio = await buildRiskPortfolioSnapshot();
    res.json({ greeks: portfolio.greeks, currentPositions: portfolio.currentPositions });
  } catch (error) {
    sendError(res, error);
  }
});

riskEngineRouter.get('/risk-budget', async (_req, res) => {
  try {
    const portfolio = await buildRiskPortfolioSnapshot();
    res.json({ riskBudget: portfolio.riskBudget });
  } catch (error) {
    sendError(res, error);
  }
});

riskEngineRouter.get('/rules', (_req, res) => {
  res.json({ rules: getRiskRuleSet() });
});

riskEngineRouter.get('/history', async (req, res) => {
  try {
    res.json({ history: await listRiskApprovals(limitFrom(req.query.limit, 50)) });
  } catch (error) {
    sendError(res, error);
  }
});

riskEngineRouter.get('/approval-queue', async (req, res) => {
  try {
    const queue = await buildRiskApprovalQueue();
    const latestApproval = await getLatestRiskApproval();
    const preview = req.query.preview === 'true' && queue.pending[0] ? await runRiskReview({ recommendation: queue.pending[0], persist: false }) : null;
    res.json({ queue, latestApproval, preview: preview?.approval ?? null });
  } catch (error) {
    sendError(res, error);
  }
});
