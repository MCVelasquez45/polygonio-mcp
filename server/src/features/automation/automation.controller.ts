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

export async function getSessionCandidates(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Number(req.query.limit ?? 100);
    res.json(await automationService.getSessionCandidates(req.params.id, Number.isFinite(limit) ? limit : 100));
  } catch (error) {
    handleError(error, res, next);
  }
}

export async function getSessionContractSelections(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Number(req.query.limit ?? 50);
    res.json(
      await automationService.getSessionContractSelections(req.params.id, Number.isFinite(limit) ? limit : 50)
    );
  } catch (error) {
    handleError(error, res, next);
  }
}

export async function getSessionRiskDecisions(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Number(req.query.limit ?? 100);
    res.json(await automationService.getSessionRiskDecisions(req.params.id, Number.isFinite(limit) ? limit : 100));
  } catch (error) {
    handleError(error, res, next);
  }
}

function evaluateBarEnabled(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    (process.env.AUTOMATION_EVALUATE_BAR_ENABLED ?? '').toLowerCase() === 'true'
  );
}

function fixturesAllowed(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    (process.env.AUTOMATION_ALLOW_FIXTURES ?? '').toLowerCase() === 'true'
  );
}

/**
 * Development/test-controlled single-bar evaluation.
 * - The endpoint itself is disabled unless explicitly enabled.
 * - Fixture payloads (bars/chain/account) are ONLY honored under the fixture
 *   gate; otherwise authoritative market data is loaded server-side. The
 *   client can never inject indicator values — indicators are always computed
 *   here from bars.
 */
export async function postEvaluateBar(req: Request, res: Response, next: NextFunction) {
  try {
    if (!evaluateBarEnabled()) {
      res.status(403).json({
        error: 'evaluate-bar is disabled. Set AUTOMATION_EVALUATE_BAR_ENABLED=true in development.',
        code: 'AUTOMATION_EVALUATE_BAR_DISABLED',
      });
      return;
    }
    const rawFixture = req.body?.fixture;
    if (rawFixture != null && !fixturesAllowed()) {
      res.status(403).json({
        error: 'fixtures are only accepted under NODE_ENV=test or AUTOMATION_ALLOW_FIXTURES=true',
        code: 'AUTOMATION_FIXTURES_DISABLED',
      });
      return;
    }
    if (rawFixture != null && (!Array.isArray(rawFixture.bars) || typeof rawFixture.chain !== 'object')) {
      res.status(400).json({ error: 'fixture requires bars[] and chain{}' });
      return;
    }
    const result = await automationService.evaluateBar(req.params.id, rawFixture ?? undefined);
    res.status(200).json({
      candidate: result.candidate,
      duplicate: result.duplicate,
      selection: result.selection,
      riskDecision: result.riskDecision,
      orderIntent: result.orderIntent,
    });
  } catch (error) {
    handleError(error, res, next);
  }
}
