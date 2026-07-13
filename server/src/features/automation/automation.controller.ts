import type { Request, Response, NextFunction } from 'express';
import { AutomationError } from './automation.errors';
import * as automationService from './automation.service';

// Thin HTTP layer: validation + status mapping only. All behavior lives in
// automation.service and below.

function handleError(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof AutomationError) {
    res.status(error.httpStatus).json({ error: error.message, code: error.code });
    return;
  }
  next(error);
}

export async function getHealth(_req: Request, res: Response, next: NextFunction) {
  try {
    const payload = await automationService.health();
    res.status(payload.automationReady ? 200 : 503).json(payload);
  } catch (error) {
    handleError(error, res, next);
  }
}

export async function postReconcile(_req: Request, res: Response, next: NextFunction) {
  try {
    const report = await automationService.reconcileNow();
    res.status(report.status === 'FAILED' ? 500 : 200).json(report);
  } catch (error) {
    handleError(error, res, next);
  }
}

export async function postSession(req: Request, res: Response, next: NextFunction) {
  try {
    const { strategyVersionId, underlying } = req.body ?? {};
    if (typeof strategyVersionId !== 'string' || !strategyVersionId.trim()) {
      res.status(400).json({ error: 'strategyVersionId is required' });
      return;
    }
    if (typeof underlying !== 'string' || !/^[A-Za-z.]{1,10}$/.test(underlying.trim())) {
      res.status(400).json({ error: 'underlying must be a 1-10 letter symbol' });
      return;
    }
    const session = await automationService.createSession({
      strategyVersionId: strategyVersionId.trim(),
      underlying: underlying.trim(),
    });
    res.status(201).json(session);
  } catch (error) {
    handleError(error, res, next);
  }
}

export async function getSessions(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Number(req.query.limit ?? 50);
    res.json(await automationService.listSessions(Number.isFinite(limit) ? limit : 50));
  } catch (error) {
    handleError(error, res, next);
  }
}

export async function getSessionById(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await automationService.getSession(req.params.id));
  } catch (error) {
    handleError(error, res, next);
  }
}

export async function getSessionEvents(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Number(req.query.limit ?? 100);
    res.json(await automationService.getSessionEvents(req.params.id, Number.isFinite(limit) ? limit : 100));
  } catch (error) {
    handleError(error, res, next);
  }
}

export async function getSessionOrders(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Number(req.query.limit ?? 100);
    res.json(await automationService.getSessionOrders(req.params.id, Number.isFinite(limit) ? limit : 100));
  } catch (error) {
    handleError(error, res, next);
  }
}
