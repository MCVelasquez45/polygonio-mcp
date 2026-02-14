import express from 'express';
import axios from 'axios';
import { LabStrategyModel } from '../handoff/models/strategyModel';

const router = express.Router();

// Create a new Lab strategy
router.post('/strategy/create', async (req, res) => {
  try {
    const { name, description, strategyType, ownerId, modelConfig, screenerConfig, zonexiConfig, futuresConfig } = req.body;

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

    if (strategyType === 'zonexi' && !zonexiConfig) {
      return res.status(400).json({ error: 'zonexiConfig required for zonexi strategies' });
    }

    if (strategyType === 'futures' && !futuresConfig) {
      return res.status(400).json({ error: 'futuresConfig required for futures strategies' });
    }

    const strategy = new LabStrategyModel({
      name,
      description: description || '',
      strategyType,
      ownerId: ownerId || 'ai_agent',
      status: 'development',
      modelConfig: strategyType === 'quant' ? modelConfig : undefined,
      screenerConfig: strategyType === 'screener' ? screenerConfig : undefined,
      zonexiConfig: strategyType === 'zonexi' ? zonexiConfig : undefined,
      futuresConfig: strategyType === 'futures' ? futuresConfig : undefined
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

// AI Analysis of Backtest Results
router.post('/strategy/:id/ai-review', async (req, res) => {
  try {
    const { backtestResults } = req.body;
    const strategy = await LabStrategyModel.findById(req.params.id);
    
    if (!strategy) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    const agentUrl = process.env.PYTHON_URL || 'http://localhost:5001';
    
    const prompt = `
Please perform a detailed financial analysis of the following backtest results for the strategy "${strategy.name}".
Identify strengths, weaknesses, and specific parameter optimizations to improve performance.

STRATEGY DESCRIPTION:
${strategy.description}

BACKTEST RESULTS (JSON):
${JSON.stringify(backtestResults || strategy.backtestResults, null, 2)}

FORMAT:
- Summary of performance
- 3 key insights (positive or warning)
- 2 specific parameter optimization suggestions
`;

    const response = await axios.post(`${agentUrl}/analyze`, {
      query: prompt,
      session_name: `review_${strategy._id}`
    });

    res.json({
      analysis: response.data.output,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[LAB] AI Review failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Webhook for AI Agent to notify extraction completion
router.post('/notify-extraction', (req, res) => {
  const { socketId, data, status, error } = req.body;
  const io = req.app.get('io');

  if (!io) {
    console.warn('[LAB] io instance not found in app, cannot notify client');
    return res.status(500).json({ error: 'Socket.io not initialized on server' });
  }

  if (socketId) {
    console.log(`[LAB] Notifying client ${socketId} about extraction ${status}`);
    io.to(socketId).emit('strategy-extracted', { data, status, error });
  } else {
    // Broadcast if no socketId (rare case for manual transcript paste if we want)
    console.log('[LAB] Broadcasting extraction completion');
    io.emit('strategy-extracted', { data, status, error });
  }

  res.json({ ok: true });
});

export const labRouter = router;
