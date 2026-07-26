import { Router, type Response } from 'express';
import {
  getAutonomousActive,
  getAutonomousCurrent,
  getAutonomousHealth,
  getAutonomousMetrics,
  getAutonomousPending,
  getAutonomousPipelineById,
  getAutonomousRecentDecisions,
  getAutonomousStatus,
  getAutonomousTimeline,
} from '../coordinator/autonomousCoordinator.service';

export const autonomousTradingRouter = Router();

function sendError(res: Response, error: unknown): void {
  const status = typeof (error as any)?.status === 'number' ? (error as any).status : 500;
  res.status(status).json({ error: (error as Error)?.message ?? 'autonomous trading request failed' });
}

function limitFrom(value: unknown, fallback = 50): number {
  const parsed = typeof value === 'string' ? Number(value) : fallback;
  return Number.isFinite(parsed) ? parsed : fallback;
}

autonomousTradingRouter.get('/status', async (_req, res) => {
  try {
    res.json({ status: await getAutonomousStatus() });
  } catch (error) {
    sendError(res, error);
  }
});

autonomousTradingRouter.get('/current', async (_req, res) => {
  try {
    res.json(await getAutonomousCurrent());
  } catch (error) {
    sendError(res, error);
  }
});

autonomousTradingRouter.get('/active', async (_req, res) => {
  try {
    res.json(await getAutonomousActive());
  } catch (error) {
    sendError(res, error);
  }
});

autonomousTradingRouter.get('/pending', async (_req, res) => {
  try {
    res.json(await getAutonomousPending());
  } catch (error) {
    sendError(res, error);
  }
});

autonomousTradingRouter.get('/recent-decisions', async (req, res) => {
  try {
    res.json(await getAutonomousRecentDecisions(limitFrom(req.query.limit, 20)));
  } catch (error) {
    sendError(res, error);
  }
});

autonomousTradingRouter.get('/timeline', async (req, res) => {
  try {
    res.json(await getAutonomousTimeline(limitFrom(req.query.limit, 100)));
  } catch (error) {
    sendError(res, error);
  }
});

autonomousTradingRouter.get('/metrics', async (_req, res) => {
  try {
    res.json(await getAutonomousMetrics());
  } catch (error) {
    sendError(res, error);
  }
});

autonomousTradingRouter.get('/health', async (_req, res) => {
  try {
    res.json(await getAutonomousHealth());
  } catch (error) {
    sendError(res, error);
  }
});

autonomousTradingRouter.get('/pipeline/:pipelineId', async (req, res) => {
  try {
    res.json(await getAutonomousPipelineById(req.params.pipelineId));
  } catch (error) {
    sendError(res, error);
  }
});

