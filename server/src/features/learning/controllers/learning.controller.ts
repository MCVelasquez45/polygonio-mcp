import type { NextFunction, Request, Response } from 'express';
import {
  getLearningStatus,
  listLearningTradeReviews,
} from '../analytics/tradeReview.service';
import { getLearningConfidenceCalibration } from '../calibration/calibration.service';
import { getLearningDatasets } from '../datasets/dataset.service';
import { getLearningEventAnalytics } from '../analytics/eventAnalytics.service';
import {
  getLearningRegimeAnalytics,
  getLearningStrategyScorecards,
} from '../scorecards/scorecard.service';

function limitFromQuery(value: unknown, fallback = 100): number {
  const parsed = typeof value === 'string' ? Number(value) : fallback;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function getStatus(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await getLearningStatus());
  } catch (error) {
    next(error);
  }
}

export async function getTrades(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ generatedAt: new Date().toISOString(), reviews: await listLearningTradeReviews(limitFromQuery(req.query.limit)) });
  } catch (error) {
    next(error);
  }
}

export async function getScorecards(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await getLearningStrategyScorecards());
  } catch (error) {
    next(error);
  }
}

export async function getCalibration(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await getLearningConfidenceCalibration());
  } catch (error) {
    next(error);
  }
}

export async function getRegimes(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await getLearningRegimeAnalytics());
  } catch (error) {
    next(error);
  }
}

export async function getEvents(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await getLearningEventAnalytics());
  } catch (error) {
    next(error);
  }
}

export async function getDatasets(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await getLearningDatasets(limitFromQuery(req.query.limit)));
  } catch (error) {
    next(error);
  }
}
