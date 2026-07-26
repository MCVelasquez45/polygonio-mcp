import { Router } from 'express';
import {
  getActive,
  getEvaluations,
  getHistory,
  getPending,
  getStatus,
  getTimeline,
} from '../controllers/tradeLifecycle.controller';

export const tradeLifecycleRouter = Router();

tradeLifecycleRouter.get('/status', getStatus);
tradeLifecycleRouter.get('/active', getActive);
tradeLifecycleRouter.get('/pending', getPending);
tradeLifecycleRouter.get('/history', getHistory);
tradeLifecycleRouter.get('/timeline', getTimeline);
tradeLifecycleRouter.get('/evaluations', getEvaluations);
