import { Router, type Response } from 'express';
import { buildStrategyContext, getLatestStrategyRun, listStrategyRuns, runStrategyOrchestrator } from '../controllers/orchestrator.service';
import { listRegisteredStrategies } from '../strategies/strategyRegistry.service';

export const strategyOrchestratorRouter = Router();

function sendError(res: Response, error: unknown): void {
  const status = typeof (error as any)?.status === 'number' ? (error as any).status : 500;
  res.status(status).json({ error: (error as Error)?.message ?? 'strategy orchestrator request failed' });
}

function limitFrom(value: unknown, fallback = 50): number {
  const parsed = typeof value === 'string' ? Number(value) : fallback;
  return Number.isFinite(parsed) ? parsed : fallback;
}

strategyOrchestratorRouter.get('/status', async (_req, res) => {
  try {
    const latest = await getLatestStrategyRun();
    res.json({
      status: {
        available: Boolean(latest),
        latestRunId: latest?.runId ?? null,
        latestRecommendation: latest?.recommendation?.action ?? null,
        currentRegime: latest?.marketContext?.regime?.current ?? null,
      },
    });
  } catch (error) {
    sendError(res, error);
  }
});

strategyOrchestratorRouter.get('/recommendations', async (req, res) => {
  try {
    const run = req.query.live === 'true' ? await runStrategyOrchestrator({ persist: false }) : await getLatestStrategyRun();
    if (!run) {
      res.status(404).json({ error: 'STRATEGY_RECOMMENDATION_NOT_FOUND' });
      return;
    }
    res.json({ recommendation: run.recommendation, run });
  } catch (error) {
    sendError(res, error);
  }
});

strategyOrchestratorRouter.get('/strategies', (_req, res) => {
  const strategies = listRegisteredStrategies().map(strategy => ({
    id: strategy.id,
    name: strategy.name,
    description: strategy.description,
    requiredInputs: strategy.requiredInputs,
    supportedAssets: strategy.supportedAssets,
  }));
  res.json({ strategies });
});

strategyOrchestratorRouter.get('/history', async (req, res) => {
  try {
    res.json({ history: await listStrategyRuns(limitFrom(req.query.limit, 50)) });
  } catch (error) {
    sendError(res, error);
  }
});

strategyOrchestratorRouter.get('/evidence', async (_req, res) => {
  try {
    const context = await buildStrategyContext();
    res.json({ context });
  } catch (error) {
    sendError(res, error);
  }
});
