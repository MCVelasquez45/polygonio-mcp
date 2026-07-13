import { Router } from 'express';
import {
  getHealth,
  getSessionById,
  getSessionEvents,
  getSessionOrders,
  getSessions,
  postReconcile,
  postSession,
} from './automation.controller';

// Phase 2A surface: observation, health, reconciliation, session bookkeeping.
// There is intentionally NO endpoint that submits broker orders.

export const automationRouter = Router();

automationRouter.get('/health', getHealth);
automationRouter.post('/reconcile', postReconcile);
automationRouter.post('/sessions', postSession);
automationRouter.get('/sessions', getSessions);
automationRouter.get('/sessions/:id', getSessionById);
automationRouter.get('/sessions/:id/events', getSessionEvents);
automationRouter.get('/sessions/:id/orders', getSessionOrders);
