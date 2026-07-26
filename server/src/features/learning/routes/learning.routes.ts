import { Router } from 'express';
import {
  getCalibration,
  getDatasets,
  getEvents,
  getRegimes,
  getScorecards,
  getStatus,
  getTrades,
} from '../controllers/learning.controller';

export const learningRouter = Router();

learningRouter.get('/status', getStatus);
learningRouter.get('/trades', getTrades);
learningRouter.get('/scorecards', getScorecards);
learningRouter.get('/calibration', getCalibration);
learningRouter.get('/regimes', getRegimes);
learningRouter.get('/events', getEvents);
learningRouter.get('/datasets', getDatasets);
