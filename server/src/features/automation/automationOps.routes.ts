import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import {
  getSignalMode,
  getSubmissionEnabled,
} from './automation.config';
import { AutomationSessionModel, RUNNABLE_SESSION_STATUSES } from './models/automationSession.model';
import { AutomationPositionModel } from './models/automationPosition.model';
import { UniverseEvaluationModel } from './models/universeEvaluation.model';
import { OrderIntentModel } from './models/orderIntent.model';
import { logAutomationEvent } from './services/automationAudit.service';
import { getSchedulerStatus } from './services/schedulerController.service';
import { getMonitorStatus } from './services/monitorController.service';
import { isAutomationReady } from './services/sessionRecovery.service';
import { isBrokerTruthCurrent } from './services/orderReconciliation.service';
import { getAutomationUniverse } from '../watchlist/automationUniverseProvider.service';
import { listWatchlist } from '../watchlist/watchlist.service';
import { exchangeTradingDate } from './services/sessionDailyReset.service';
import { getMassiveRequestStats } from '../../shared/data/massive';

// Sprint 2E launch — operational control plane (dashboard status, session
// report, emergency stop). All READ-ONLY except the emergency-stop toggle,
// which only sets a durable session flag — it never calls the broker directly
// (the monitoring scheduler performs the flatten from that flag). Nothing here
// submits an entry.

export const automationOpsRouter = Router();

const AUTOMATION_ENABLED = () => (process.env.AUTOMATION_ENABLED ?? 'true').toLowerCase() !== 'false';

// ---- Operational dashboard status ----------------------------------------
automationOpsRouter.get('/status', async (_req: Request, res: Response) => {
  try {
    const mongoUp = mongoose.connection?.readyState === 1;
    const [emergencyStops, sessions, openPositions, exitingPositions, manualReviewPositions, recoveryFailedPositions, unresolvedIntents, watchlist, lastEval] =
      mongoUp
        ? await Promise.all([
            AutomationSessionModel.find({ 'emergencyStop.active': true }).select('_id emergencyStop'),
            AutomationSessionModel.find({ status: { $in: RUNNABLE_SESSION_STATUSES } }).select('_id status reconciliationStatus'),
            AutomationPositionModel.countDocuments({ status: 'OPEN' }),
            AutomationPositionModel.countDocuments({ status: 'EXITING' }),
            AutomationPositionModel.countDocuments({ status: 'MANUAL_REVIEW' }),
            AutomationPositionModel.countDocuments({ status: 'RECOVERY_FAILED' }),
            OrderIntentModel.countDocuments({ status: { $in: ['SUBMITTING', 'APPROVED_AWAITING_EXECUTION'] } }),
            listWatchlist(),
            UniverseEvaluationModel.findOne().sort({ evaluatedAt: -1 }),
          ])
        : [[], [], 0, 0, 0, 0, 0, [], null];
    const universe = mongoUp ? await getAutomationUniverse() : null;
    const schedulerStatus = getSchedulerStatus();
    const monitorStatus = getMonitorStatus();
    const massiveStats = getMassiveRequestStats();
    const runnableSessions = sessions as any[];
    const reconciliationStatus =
      runnableSessions.length > 0 && runnableSessions.every((s) => s.reconciliationStatus === 'CLEAN')
        ? 'CLEAN'
        : runnableSessions.some((s) => s.reconciliationStatus)
          ? 'NOT_CLEAN'
          : null;
    // Overnight recovery — surfaced as a CRITICAL-but-recoverable state, never as
    // a healthy open position. Any live overnight carry blocks new entries.
    const overnightDocs = mongoUp
      ? await AutomationPositionModel.find({
          overnightRecoveryRequired: true,
          status: { $in: ['PENDING_ENTRY', 'OPEN', 'EXITING', 'MANUAL_REVIEW'] },
        }).select(
          'optionSymbol filledQty avgEntryPrice status overnightDetectedAt overnightReason recoveryExitEligibleAt recoveryExitSubmittedAt exitBrokerOrderId exitAttemptCount lastBrokerReconciledAt lastMarkAt manualReviewReason'
        )
      : [];
    const newEntriesBlocked =
      (openPositions as number) > 0 ||
      (exitingPositions as number) > 0 ||
      (manualReviewPositions as number) > 0 ||
      overnightDocs.length > 0;
    res.json({
      timestamp: new Date().toISOString(),
      automationEnabled: AUTOMATION_ENABLED(),
      submissionEnabled: getSubmissionEnabled(),
      signalMode: getSignalMode(),
      automationReady: isAutomationReady(),
      mongoConnected: mongoUp,
      emergencyStop: {
        active: (emergencyStops as any[]).length > 0,
        sessions: (emergencyStops as any[]).map((s) => ({ sessionId: String(s._id), reason: s.emergencyStop?.reason ?? null })),
      },
      evaluationScheduler: schedulerStatus,
      monitorScheduler: monitorStatus,
      scheduler: {
        intervalMs: schedulerStatus.intervalMs,
        flowWindowMinutes: schedulerStatus.flowWindowMinutes,
        lastTick: schedulerStatus.lastTickAt,
        lastCompletedEvaluation: schedulerStatus.lastCompletedEvaluation,
        lastWindow: schedulerStatus.lastWindow,
        nextWindow: schedulerStatus.nextWindow,
        lastSkipReason: schedulerStatus.lastSkipReason,
        watchlistCount: schedulerStatus.watchlistCount,
        candidateCount: schedulerStatus.candidateCount,
        skipReasons: schedulerStatus.skipReasons,
      },
      monitor: {
        intervalMs: monitorStatus.intervalMs,
        lastRun: monitorStatus.lastRun,
        positionsMonitored: monitorStatus.positionsMonitored,
        exitsTriggered: monitorStatus.exitsTriggered,
        skippedReason: monitorStatus.skippedReason,
      },
      massive: {
        state: massiveStats.state,
        cooldownUntil: massiveStats.cooldownUntil,
        cacheHitRate: massiveStats.cacheHitRate,
        queueDepth: massiveStats.queueDepth,
        activeRequests: massiveStats.activeRequests,
        deduplicatedRequests: massiveStats.deduplicatedRequests,
        cacheHits: massiveStats.cacheHits,
        cacheMisses: massiveStats.cacheMisses,
        '429Count': massiveStats.rateLimitResponses,
        backgroundSuppressed: massiveStats.backgroundDropped,
        requestsByPriority: massiveStats.requestsByPriority,
        pendingRequestsByPriority: massiveStats.pendingRequestsByPriority,
      },
      automation: {
        submissionEnabled: getSubmissionEnabled(),
        brokerConnected: isBrokerTruthCurrent(Date.now()),
        marketOpen: schedulerStatus.lastTick?.marketPhase
          ? ['PRE_CUTOFF', 'POST_ENTRY_CUTOFF'].includes(schedulerStatus.lastTick.marketPhase)
          : null,
        reconciliationStatus,
        ownershipHealthy: (manualReviewPositions as number) === 0 && (recoveryFailedPositions as number) === 0,
      },
      watchlist: {
        total: (watchlist as any[]).length,
        automationEnabled: (watchlist as any[]).filter((w) => w.enabled && w.automationEnabled).length,
        universeSymbols: universe?.symbols ?? [],
        universeEmpty: universe?.empty ?? true,
      },
      positions: {
        open: openPositions,
        exiting: exitingPositions,
        manualReview: manualReviewPositions,
        unresolvedIntents,
      },
      newEntriesBlocked,
      overnightRecovery: {
        active: overnightDocs.length > 0,
        count: overnightDocs.length,
        positions: (overnightDocs as any[]).map((p) => ({
          state: 'OVERNIGHT_RECOVERY_REQUIRED',
          contract: p.optionSymbol,
          quantity: p.filledQty,
          entryPrice: p.avgEntryPrice,
          lifecycleStatus: p.status,
          detectedAt: p.overnightDetectedAt?.toISOString?.() ?? null,
          reason: p.overnightReason ?? null,
          recoveryEligibleAt: p.recoveryExitEligibleAt?.toISOString?.() ?? null,
          recoveryExitSubmittedAt: p.recoveryExitSubmittedAt?.toISOString?.() ?? null,
          exitOrderId: p.exitBrokerOrderId ?? null,
          exitAttemptCount: p.exitAttemptCount ?? 0,
          lastReconciledAt: p.lastBrokerReconciledAt?.toISOString?.() ?? null,
          lastMarkAt: p.lastMarkAt?.toISOString?.() ?? null,
          manualReviewReason: p.manualReviewReason ?? null,
          newEntriesBlocked: true,
        })),
      },
      lastEvaluation: lastEval
        ? {
            outcome: (lastEval as any).outcome,
            at: (lastEval as any).evaluatedAt,
            selectedSymbol: (lastEval as any).selectedSymbol,
            reasonCodes: (lastEval as any).reasonCodes,
            symbolResults: (lastEval as any).symbolResults ?? [],
          }
        : null,
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'status failed' });
  }
});

// ---- Daily session report -------------------------------------------------
automationOpsRouter.get('/report', async (req: Request, res: Response) => {
  try {
    if (mongoose.connection?.readyState !== 1) {
      res.status(503).json({ error: 'mongo unavailable' });
      return;
    }
    const date = typeof req.query.date === 'string' ? req.query.date : exchangeTradingDate(new Date());
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(`${date}T23:59:59.999Z`);
    const evals = await UniverseEvaluationModel.find({ evaluatedAt: { $gte: start, $lte: end } });
    const outcomes: Record<string, number> = {};
    for (const e of evals) outcomes[(e as any).outcome] = (outcomes[(e as any).outcome] ?? 0) + 1;
    const [opened, closed, open, exiting, manualReview] = await Promise.all([
      AutomationPositionModel.countDocuments({ createdAt: { $gte: start, $lte: end } }),
      AutomationPositionModel.countDocuments({ status: 'CLOSED', updatedAt: { $gte: start, $lte: end } }),
      AutomationPositionModel.countDocuments({ status: 'OPEN' }),
      AutomationPositionModel.countDocuments({ status: 'EXITING' }),
      AutomationPositionModel.countDocuments({ status: 'MANUAL_REVIEW' }),
    ]);
    const closedPositions = await AutomationPositionModel.find({ status: 'CLOSED', updatedAt: { $gte: start, $lte: end } }).select('realizedPnl');
    const realizedPnl = closedPositions.reduce((sum, p) => sum + ((p as any).realizedPnl ?? 0), 0);
    const submittedIntents = await OrderIntentModel.countDocuments({ status: 'SUBMITTED', updatedAt: { $gte: start, $lte: end } });
    const approvedIntents = await OrderIntentModel.countDocuments({ createdAt: { $gte: start, $lte: end }, intentType: 'ENTRY' });
    res.json({
      tradingDate: date,
      evaluations: evals.length,
      outcomes,
      approvedIntents,
      ordersSubmitted: submittedIntents,
      positionsOpened: opened,
      positionsClosed: closed,
      openNow: open,
      exitingNow: exiting,
      manualReviewNow: manualReview,
      realizedPnl: Number(realizedPnl.toFixed(2)),
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'report failed' });
  }
});

// ---- Emergency stop (durable flag; monitor performs the flatten) ----------
automationOpsRouter.post('/emergency-stop', async (req: Request, res: Response) => {
  try {
    if (mongoose.connection?.readyState !== 1) {
      res.status(503).json({ error: 'mongo unavailable' });
      return;
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : 'operator emergency stop';
    const result = await AutomationSessionModel.updateMany(
      { status: { $in: RUNNABLE_SESSION_STATUSES } },
      { $set: { emergencyStop: { active: true, reason, at: new Date() } } }
    );
    logAutomationEvent({ service: 'automation-ops', event: 'EMERGENCY_STOP_ACTIVATED', severity: 'critical', payload: { reason, sessions: result.modifiedCount } });
    res.json({ activated: true, sessionsAffected: result.modifiedCount, reason });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'emergency-stop failed' });
  }
});

automationOpsRouter.post('/emergency-stop/clear', async (_req: Request, res: Response) => {
  try {
    if (mongoose.connection?.readyState !== 1) {
      res.status(503).json({ error: 'mongo unavailable' });
      return;
    }
    const result = await AutomationSessionModel.updateMany(
      { 'emergencyStop.active': true },
      { $set: { emergencyStop: { active: false, reason: null, at: new Date() } } }
    );
    logAutomationEvent({ service: 'automation-ops', event: 'EMERGENCY_STOP_CLEARED', severity: 'warning', payload: { sessions: result.modifiedCount } });
    res.json({ cleared: true, sessionsAffected: result.modifiedCount });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'clear failed' });
  }
});
