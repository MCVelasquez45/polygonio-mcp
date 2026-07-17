import { Router } from 'express';
import {
  getAutomation,
  getAutomationVisibility,
  getPositionLive,
  getOperations,
  getOrders,
  getPositions,
  getTimeline,
  getTrades,
  postCancelOrder,
  postClosePosition,
  postEmergencyStop,
  postPause,
  postResume,
} from './portfolio.controller';

// Phase 2C — Portfolio command-center API. One aggregation endpoint plus
// scoped reads and safe, durable control actions. No endpoint calls Alpaca
// directly on behalf of the UI — controls go through the intent journal /
// broker adapter with the same safety guarantees as automation itself.

export const portfolioRouter = Router();

portfolioRouter.get('/operations', getOperations);
portfolioRouter.get('/positions', getPositions);
portfolioRouter.get('/orders', getOrders);
portfolioRouter.get('/automation', getAutomation);
portfolioRouter.get('/automation/visibility', getAutomationVisibility);
portfolioRouter.get('/automation/position/:id/live', getPositionLive);
portfolioRouter.get('/timeline/:sessionId', getTimeline);
portfolioRouter.get('/trades', getTrades);

portfolioRouter.post('/automation/pause', postPause);
portfolioRouter.post('/automation/resume', postResume);
portfolioRouter.post('/automation/emergency-stop', postEmergencyStop);
portfolioRouter.post('/orders/:id/cancel', postCancelOrder);
portfolioRouter.post('/positions/:id/close', postClosePosition);
