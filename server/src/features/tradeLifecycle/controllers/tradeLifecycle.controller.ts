import type { Request, Response, NextFunction } from 'express';
import {
  getLifecycleStatus,
  listLifecycleActive,
  listLifecycleEvaluations,
  listLifecycleHistory,
  listLifecyclePending,
  listLifecycleTimeline,
} from '../positionManager/lifecycleOwner.service';

function limitFromQuery(value: unknown, fallback = 100): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function getStatus(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await getLifecycleStatus());
  } catch (error) {
    next(error);
  }
}

export async function getActive(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ trades: await listLifecycleActive() });
  } catch (error) {
    next(error);
  }
}

export async function getPending(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ trades: await listLifecyclePending() });
  } catch (error) {
    next(error);
  }
}

export async function getHistory(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ trades: await listLifecycleHistory(limitFromQuery(req.query.limit)) });
  } catch (error) {
    next(error);
  }
}

export async function getTimeline(req: Request, res: Response, next: NextFunction) {
  try {
    const tradeId = typeof req.query.tradeId === 'string' ? req.query.tradeId : undefined;
    res.json({ events: await listLifecycleTimeline(tradeId, limitFromQuery(req.query.limit, 200)) });
  } catch (error) {
    next(error);
  }
}

export async function getEvaluations(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ evaluations: await listLifecycleEvaluations(limitFromQuery(req.query.limit)) });
  } catch (error) {
    next(error);
  }
}
