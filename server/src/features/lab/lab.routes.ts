import express from 'express';
import { LabStrategyModel } from '../handoff/models/strategyModel';

const router = express.Router();

// Create a new Lab strategy
router.post('/strategy/create', async (req, res) => {
  try {
    const { name, description, strategyType, ownerId, modelConfig, screenerConfig } = req.body;

    // Validate required fields
    if (!name || !strategyType) {
      return res.status(400).json({ error: 'name and strategyType are required' });
    }

    if (strategyType === 'quant' && !modelConfig) {
      return res.status(400).json({ error: 'modelConfig required for quant strategies' });
    }

    if (strategyType === 'screener' && !screenerConfig) {
      return res.status(400).json({ error: 'screenerConfig required for screener strategies' });
    }

    const strategy = new LabStrategyModel({
      name,
      description: description || '',
      strategyType,
      ownerId: ownerId || 'ai_agent',
      status: 'development',
      modelConfig: strategyType === 'quant' ? modelConfig : undefined,
      screenerConfig: strategyType === 'screener' ? screenerConfig : undefined
    });

    await strategy.save();
    res.json(strategy);
  } catch (error: any) {
    console.error('[LAB] Create strategy failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// List Lab strategies
router.get('/strategies', async (req, res) => {
  try {
    const { strategyType, status } = req.query;
    const filter: any = {};

    if (strategyType) filter.strategyType = strategyType;
    if (status) filter.status = status;

    const strategies = await LabStrategyModel.find(filter).sort({ createdAt: -1 });
    res.json(strategies);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get a single strategy
router.get('/strategy/:id', async (req, res) => {
  try {
    const strategy = await LabStrategyModel.findById(req.params.id);
    if (!strategy) {
      return res.status(404).json({ error: 'Strategy not found' });
    }
    res.json(strategy);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update strategy (e.g., add backtest results)
router.patch('/strategy/:id', async (req, res) => {
  try {
    const { status, backtestResults } = req.body;
    const update: any = {};

    if (status) update.status = status;
    if (backtestResults) update.backtestResults = backtestResults;

    const strategy = await LabStrategyModel.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true }
    );

    if (!strategy) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    res.json(strategy);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a strategy
router.delete('/strategy/:id', async (req, res) => {
  try {
    const strategy = await LabStrategyModel.findByIdAndDelete(req.params.id);
    if (!strategy) {
      return res.status(404).json({ error: 'Strategy not found' });
    }
    res.json({ message: 'Strategy deleted', id: req.params.id });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export const labRouter = router;
