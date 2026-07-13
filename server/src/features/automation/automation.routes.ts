import { Router } from 'express';
import {
  getHealth,
  getSessionById,
  getSessionCandidates,
  getSessionContractSelections,
  getSessionEvents,
  getSessionOrders,
  getSessionRiskDecisions,
  getSessions,
  postEvaluateBar,
  postReconcile,
  postSession,
} from './automation.controller';

// Phase 2A+2B surface: observation, health, reconciliation, session
// bookkeeping, and the guarded single-bar decision pipeline.
// There is intentionally NO endpoint that submits broker orders.

export const automationRouter = Router();

automationRouter.get('/health', getHealth);
automationRouter.post('/reconcile', postReconcile);
automationRouter.post('/sessions', postSession);
automationRouter.get('/sessions', getSessions);
automationRouter.get('/sessions/:id', getSessionById);
automationRouter.get('/sessions/:id/events', getSessionEvents);
automationRouter.get('/sessions/:id/orders', getSessionOrders);
// Phase 2B — decision pipeline (read + guarded evaluate)
automationRouter.get('/sessions/:id/candidates', getSessionCandidates);
automationRouter.get('/sessions/:id/contract-selections', getSessionContractSelections);
automationRouter.get('/sessions/:id/risk-decisions', getSessionRiskDecisions);
automationRouter.post('/sessions/:id/evaluate-bar', postEvaluateBar);
