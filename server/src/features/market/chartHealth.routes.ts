import express from 'express';
import { getAllBufferStats, getAllDataQualityMetrics, buildDataQualityMetrics } from './services/chartHub/buffer';
import { getRecentDataQualityLogs, computeQualityScore } from './services/chartHub/health';

const router = express.Router();

/**
 * GET /api/chart/health
 * Returns health metrics for all actively monitored symbols/timeframes.
 */
router.get('/', (req, res) => {
  try {
    const metrics = getAllDataQualityMetrics();
    const withScores = metrics.map(m => ({
      ...m,
      qualityScore: computeQualityScore(m)
    }));

    res.json({
      count: withScores.length,
      metrics: withScores,
      timestamp: Date.now()
    });
  } catch (error: any) {
    console.error('[ChartHealth] Error fetching health metrics:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/chart/health/logs
 * Returns recent data quality events (gaps, anomalies, mode changes).
 */
router.get('/logs', (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const logs = getRecentDataQualityLogs(limit);

    res.json({
      count: logs.length,
      logs
    });
  } catch (error: any) {
    console.error('[ChartHealth] Error fetching logs:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/chart/health/stats
 * Returns buffer statistics for all active charts.
 */
router.get('/stats', (req, res) => {
  try {
    const stats = getAllBufferStats();

    res.json({
      count: stats.length,
      buffers: stats,
      timestamp: Date.now()
    });
  } catch (error: any) {
    console.error('[ChartHealth] Error fetching stats:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/chart/health/:symbol
 * Returns detailed health info for a specific symbol.
 * Requires timeframe query param (default: 5/minute).
 */
router.get('/:symbol', (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const timeframe = (req.query.timeframe as string) || '5/minute';
    const key = `${symbol}:${timeframe}`;

    const metrics = buildDataQualityMetrics(key);

    if (!metrics) {
      return res.status(404).json({
        error: 'No active buffer for this symbol/timeframe',
        symbol,
        timeframe
      });
    }

    const qualityScore = computeQualityScore(metrics);

    res.json({
      ...metrics,
      qualityScore,
      key
    });
  } catch (error: any) {
    console.error('[ChartHealth] Error fetching symbol health:', error);
    res.status(500).json({ error: error.message });
  }
});

export const chartHealthRouter = router;
