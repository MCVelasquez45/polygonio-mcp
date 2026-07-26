import { Router, type Response } from 'express';
import { getDecisionScanById, getLatestDecisionScan, listDecisionScans } from './journal.service';
import { buildDecisionScan, runDecisionEngineScan } from './scanner.service';
import type { DecisionEngineScanInput } from './types';

export const decisionEngineRouter = Router();

function sendError(res: Response, error: unknown): void {
  const status = typeof (error as any)?.status === 'number' ? (error as any).status : 500;
  res.status(status).json({ error: (error as Error)?.message ?? 'decision engine request failed' });
}

decisionEngineRouter.get('/latest', async (_req, res) => {
  try {
    const scan = await getLatestDecisionScan();
    if (!scan) {
      res.status(404).json({ error: 'DECISION_SCAN_NOT_FOUND' });
      return;
    }
    res.json({ scan });
  } catch (error) {
    sendError(res, error);
  }
});

decisionEngineRouter.get('/scans', async (req, res) => {
  try {
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 50;
    res.json({ scans: await listDecisionScans(Number.isFinite(limit) ? limit : 50) });
  } catch (error) {
    sendError(res, error);
  }
});

decisionEngineRouter.get('/scans/:scanId', async (req, res) => {
  try {
    const scan = await getDecisionScanById(req.params.scanId);
    if (!scan) {
      res.status(404).json({ error: 'DECISION_SCAN_NOT_FOUND' });
      return;
    }
    res.json({ scan });
  } catch (error) {
    sendError(res, error);
  }
});

decisionEngineRouter.post('/scan', async (_req, res) => {
  try {
    const scan = await runDecisionEngineScan();
    res.status(201).json({ scan });
  } catch (error) {
    sendError(res, error);
  }
});

decisionEngineRouter.post('/validate', (req, res) => {
  try {
    const input = req.body as DecisionEngineScanInput;
    if (!Array.isArray(input?.watchlist) || !input?.chains || typeof input.chains !== 'object') {
      res.status(400).json({ error: 'watchlist and chains are required' });
      return;
    }
    res.json({ scan: buildDecisionScan(input) });
  } catch (error) {
    sendError(res, error);
  }
});
