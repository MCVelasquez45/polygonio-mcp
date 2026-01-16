import express from 'express';
import { EngineStrategyModel } from '../handoff/models/strategyModel';
import { screenerScheduler } from './services/screenerScheduler';

const router = express.Router();

/**
 * GET /api/engine/strategies
 * List all engine strategies with their current status.
 */
router.get('/strategies', async (req, res) => {
  try {
    const { status, type } = req.query;
    const filter: Record<string, any> = {};

    if (status) filter.status = status;
    if (type) filter.strategyType = type;

    const strategies = await EngineStrategyModel.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      count: strategies.length,
      strategies
    });
  } catch (error: any) {
    console.error('[Engine] Error fetching strategies:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/engine/strategies/:id
 * Get detailed info for a specific strategy.
 */
router.get('/strategies/:id', async (req, res) => {
  try {
    const strategy = await EngineStrategyModel.findById(req.params.id).lean();

    if (!strategy) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    res.json(strategy);
  } catch (error: any) {
    console.error('[Engine] Error fetching strategy:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/engine/strategies/:id/trigger
 * Manually trigger a screener strategy execution.
 */
router.post('/strategies/:id/trigger', async (req, res) => {
  try {
    const strategyId = req.params.id;

    const strategy = await EngineStrategyModel.findById(strategyId);
    if (!strategy) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    if (strategy.strategyType !== 'screener') {
      return res.status(400).json({
        error: 'Only screener strategies can be manually triggered',
        strategyType: strategy.strategyType
      });
    }

    // Trigger the screener asynchronously
    screenerScheduler.manualTrigger(strategyId)
      .then(() => {
        console.log(`[Engine] Manual trigger completed for ${strategyId}`);
      })
      .catch(err => {
        console.error(`[Engine] Manual trigger failed for ${strategyId}:`, err);
      });

    res.json({
      message: 'Screener trigger initiated',
      strategyId,
      triggeredAt: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[Engine] Error triggering strategy:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/engine/strategies/:id/status
 * Update strategy status (pause/resume).
 */
router.patch('/strategies/:id/status', async (req, res) => {
  try {
    const { status } = req.body;

    if (!['active', 'paused', 'stopped'].includes(status)) {
      return res.status(400).json({
        error: 'Invalid status. Must be: active, paused, or stopped'
      });
    }

    const strategy = await EngineStrategyModel.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!strategy) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    res.json({
      message: `Strategy status updated to ${status}`,
      strategy
    });
  } catch (error: any) {
    console.error('[Engine] Error updating strategy status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/engine/status
 * Get overall engine status and summary.
 */
router.get('/status', async (req, res) => {
  try {
    const [
      totalStrategies,
      activeScreeners,
      activeQuant,
      pausedStrategies
    ] = await Promise.all([
      EngineStrategyModel.countDocuments(),
      EngineStrategyModel.countDocuments({ strategyType: 'screener', status: 'active' }),
      EngineStrategyModel.countDocuments({ strategyType: 'quant', status: 'active' }),
      EngineStrategyModel.countDocuments({ status: 'paused' })
    ]);

    res.json({
      totalStrategies,
      activeScreeners,
      activeQuant,
      pausedStrategies,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[Engine] Error fetching status:', error);
    res.status(500).json({ error: error.message });
  }
});

export const engineRouter = router;
