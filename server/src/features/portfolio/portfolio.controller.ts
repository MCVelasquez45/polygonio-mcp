import type { Request, Response, NextFunction } from 'express';
import * as portfolio from './portfolio.service';

// Phase 2C — Portfolio command-center HTTP layer. Thin: validation + status
// mapping only. Every control routes through durable state / the broker adapter
// (never a direct Alpaca call from the UI).

function fail(res: Response, error: unknown) {
  const message = (error as Error)?.message ?? 'portfolio operation failed';
  res.status(400).json({ error: message });
}

export async function getOperations(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await portfolio.getPortfolioOperations());
  } catch (error) {
    next(error);
  }
}

export async function getPositions(_req: Request, res: Response, next: NextFunction) {
  try {
    const ops = await portfolio.getPortfolioOperations();
    res.json({ positions: ops.automationContext.positionsBySymbol });
  } catch (error) {
    next(error);
  }
}

export async function getOrders(_req: Request, res: Response, next: NextFunction) {
  try {
    const ops = await portfolio.getPortfolioOperations();
    res.json({ orders: ops.automationContext.ordersWithContext });
  } catch (error) {
    next(error);
  }
}

export async function getAutomation(_req: Request, res: Response, next: NextFunction) {
  try {
    const ops = await portfolio.getPortfolioOperations();
    res.json({ sessions: ops.automationContext.sessions, health: ops.health, risk: ops.risk });
  } catch (error) {
    next(error);
  }
}

export async function getAutomationVisibility(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await portfolio.getAutomationVisibility());
  } catch (error) {
    next(error);
  }
}

export async function getPositionLive(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await portfolio.getPositionLiveSnapshot(req.params.id));
  } catch (error) {
    next(error);
  }
}

export async function getTimeline(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Number(req.query.limit ?? 200);
    res.json(await portfolio.getSessionTimeline(req.params.sessionId, Number.isFinite(limit) ? limit : 200));
  } catch (error) {
    next(error);
  }
}

export async function getTrades(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Number(req.query.limit ?? 100);
    res.json({ trades: await portfolio.getClosedTrades(Number.isFinite(limit) ? limit : 100) });
  } catch (error) {
    next(error);
  }
}

export async function postPause(req: Request, res: Response, next: NextFunction) {
  try {
    const { sessionId, reason } = req.body ?? {};
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
    res.json(await portfolio.pauseSessionEntries(sessionId, reason ?? ''));
  } catch (error) {
    fail(res, error);
  }
}

export async function postResume(req: Request, res: Response, next: NextFunction) {
  try {
    const { sessionId } = req.body ?? {};
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
    res.json(await portfolio.resumeSession(sessionId));
  } catch (error) {
    fail(res, error);
  }
}

export async function postEmergencyStop(req: Request, res: Response, next: NextFunction) {
  try {
    const { sessionId, reason } = req.body ?? {};
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
    res.json(await portfolio.emergencyStopSession(sessionId, reason ?? ''));
  } catch (error) {
    fail(res, error);
  }
}

export async function postCancelOrder(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await portfolio.cancelAutomationOrder(req.params.id));
  } catch (error) {
    fail(res, error);
  }
}

export async function postClosePosition(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await portfolio.closeAutomationPosition(req.params.id));
  } catch (error) {
    fail(res, error);
  }
}
