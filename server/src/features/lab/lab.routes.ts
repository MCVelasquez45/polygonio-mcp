import express from 'express';
import axios from 'axios';
import { LabStrategyModel, StrategyVersionModel } from '../handoff/models/strategyModel';
import { getContractSpec } from '../futures/services/contractSpecs.service';

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

    let normalizedFuturesConfig: any = undefined;
    if (strategyType === 'futures') {
      const contract = String(futuresConfig?.contract ?? '').trim().toUpperCase();
      if (!contract) {
        return res.status(400).json({ error: 'futuresConfig.contract is required' });
      }
      const spec = await getContractSpec(contract);
      if (!spec) {
        return res.status(400).json({ error: `Unsupported futures contract '${contract}'` });
      }

      normalizedFuturesConfig = {
        contract,
        exchange: futuresConfig?.exchange ?? spec.exchange,
        tickSize: Number(futuresConfig?.tickSize ?? spec.tickSize),
        tickValue: Number(futuresConfig?.tickValue ?? spec.tickValue),
        contractSize: Number(futuresConfig?.contractSize ?? spec.contractMultiplier),
        marginRequired: Number(futuresConfig?.marginRequired ?? spec.defaultInitialMargin),
        tradingHours: String(futuresConfig?.tradingHours ?? 'globex'),
        rollStrategy:
          futuresConfig?.rollStrategy === 'calendar' || futuresConfig?.rollStrategy === 'open_interest'
            ? futuresConfig.rollStrategy
            : 'volume',
        rollDaysBefore: Number(futuresConfig?.rollDaysBefore ?? 5)
      };
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
      futuresConfig: strategyType === 'futures' ? normalizedFuturesConfig : undefined
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

// Update strategy — supports full field updates
router.patch('/strategy/:id', async (req, res) => {
  try {
    const {
      name, description, status, backtestResults,
      screenerConfig, modelConfig, zonexiConfig, futuresConfig,
    } = req.body;

    const update: any = {};

    if (typeof name === 'string') update.name = name;
    if (typeof description === 'string') update.description = description;
    if (status) update.status = status;
    if (backtestResults) update.backtestResults = backtestResults;
    if (screenerConfig) update.screenerConfig = screenerConfig;
    if (modelConfig) update.modelConfig = modelConfig;
    if (zonexiConfig) update.zonexiConfig = zonexiConfig;
    if (futuresConfig) update.futuresConfig = futuresConfig;

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

// Archive a strategy (soft delete — keeps data, hides from active list)
router.post('/strategy/:id/archive', async (req, res) => {
  try {
    const strategy = await LabStrategyModel.findById(req.params.id);
    if (!strategy) {
      return res.status(404).json({ error: 'Strategy not found' });
    }
    strategy.status = 'archived';
    await strategy.save();
    res.json({ message: 'Strategy archived', id: req.params.id, status: 'archived' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Unarchive a strategy
router.post('/strategy/:id/unarchive', async (req, res) => {
  try {
    const strategy = await LabStrategyModel.findById(req.params.id);
    if (!strategy) {
      return res.status(404).json({ error: 'Strategy not found' });
    }
    strategy.status = 'development';
    await strategy.save();
    res.json({ message: 'Strategy unarchived', id: req.params.id, status: 'development' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a strategy (permanent — also cleans up related sessions)
router.delete('/strategy/:id', async (req, res) => {
  try {
    const strategy = await LabStrategyModel.findByIdAndDelete(req.params.id);
    if (!strategy) {
      return res.status(404).json({ error: 'Strategy not found' });
    }
    // Clean up related data
    const { StrategyVersionModel } = await import('../handoff/models/strategyModel');
    await StrategyVersionModel.deleteMany({ strategyId: req.params.id });
    res.json({ message: 'Strategy deleted', id: req.params.id });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// AI Analysis of Backtest Results — enhanced with structured suggestions
router.post('/strategy/:id/ai-review', async (req, res) => {
  try {
    const { backtestResults, stressTestResults } = req.body;
    const strategy = await LabStrategyModel.findById(req.params.id);

    if (!strategy) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    // Extract strategy rules and params for richer analysis context
    const sc = (strategy as any).screenerConfig;
    const params = sc?.params ?? {};
    const entryRules = Array.isArray(params.entry_rules) ? params.entry_rules : [];
    const exitRules = Array.isArray(params.exit_rules) ? params.exit_rules : [];
    const riskManagement = Array.isArray(params.risk_management) ? params.risk_management : [];

    const agentUrl = process.env.PYTHON_URL || 'http://localhost:5001';

    const prompt = `
Analyze these backtest results for the strategy "${strategy.name}".

STRATEGY CONFIGURATION:
- Type: ${(strategy as any).strategyType}
- Description: ${strategy.description}
- Entry Rules: ${JSON.stringify(entryRules)}
- Exit Rules: ${JSON.stringify(exitRules)}
- Risk Management: ${JSON.stringify(riskManagement)}
- Parameters: ${JSON.stringify(Object.fromEntries(
      Object.entries(params).filter(([k]) =>
        !['source', 'strategy_template_type', 'hypothesis', 'transcript', 'parameter_definitions', 'entry_rules', 'exit_rules', 'risk_management'].includes(k)
      )
    ))}

BACKTEST RESULTS:
${JSON.stringify(backtestResults ?? strategy.backtestResults, null, 2)}
${Array.isArray(stressTestResults) && stressTestResults.length > 0 ? `
STRESS TEST RESULTS:
The following scenarios were run against the same bar data with parameter overrides.
Flag any scenarios where the strategy breaks down (large drawdown, low win rate, negative return) and incorporate those failure modes into your suggestions.
${JSON.stringify(stressTestResults, null, 2)}
` : ''}
Respond in TWO sections:

SECTION 1 - ANALYSIS (plain text):
- Performance summary (2-3 sentences)
- 3 key insights (each prefixed with a checkmark for positive or warning triangle for concerns)
- Risk assessment

SECTION 2 - SUGGESTIONS (JSON array):
Return a JSON array wrapped in \`\`\`json ... \`\`\` with objects like:
[
  {
    "field": "parameters.sma_lookback",
    "currentValue": 10,
    "suggestedValue": 20,
    "action": "modify",
    "reasoning": "A longer lookback period reduces false signals in choppy markets."
  }
]
Include 2-4 specific, actionable suggestions. Use field paths like "parameters.X", "entry_rules", "exit_rules", or "risk_management".
`;

    const response = await axios.post(`${agentUrl}/analyze`, {
      query: prompt,
      session_name: `review_${strategy._id}`
    });

    const output = response.data.output ?? '';

    // Parse structured suggestions from the response
    let suggestions: any[] = [];
    const jsonMatch = output.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        suggestions = JSON.parse(jsonMatch[1].trim());
        if (!Array.isArray(suggestions)) suggestions = [];
      } catch {
        suggestions = [];
      }
    }

    // Extract analysis text (everything before the JSON block)
    const analysis = jsonMatch
      ? output.slice(0, output.indexOf('```json')).trim()
      : output.trim();

    // Save review to the latest version if one exists
    try {
      const latestVersion = await StrategyVersionModel.findOne({ strategyId: req.params.id })
        .sort({ versionNumber: -1 });
      if (latestVersion) {
        latestVersion.set('aiReview', { analysis, suggestions });
        await latestVersion.save();
      }
    } catch (err) {
      console.warn('[LAB] Could not save AI review to version:', (err as any)?.message);
    }

    res.json({
      analysis,
      suggestions,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[LAB] AI Review failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// --- Strategy Versioning Endpoints ---

// List all versions for a strategy
router.get('/strategy/:id/versions', async (req, res) => {
  try {
    const versions = await StrategyVersionModel.find({ strategyId: req.params.id })
      .sort({ versionNumber: -1 })
      .lean();
    res.json(versions);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Compare two versions
router.get('/strategy/:id/versions/compare', async (req, res) => {
  try {
    const v1Num = Number(req.query.v1);
    const v2Num = Number(req.query.v2);
    if (!v1Num || !v2Num) {
      return res.status(400).json({ error: 'v1 and v2 query params are required (version numbers)' });
    }

    const [v1, v2] = await Promise.all([
      StrategyVersionModel.findOne({ strategyId: req.params.id, versionNumber: v1Num }).lean(),
      StrategyVersionModel.findOne({ strategyId: req.params.id, versionNumber: v2Num }).lean(),
    ]);

    if (!v1 || !v2) {
      return res.status(404).json({ error: 'One or both versions not found' });
    }

    // Compute metric deltas
    const m1 = v1.backtestMetrics ?? {} as any;
    const m2 = v2.backtestMetrics ?? {} as any;
    const deltas: Record<string, { v1: number; v2: number; delta: number }> = {};
    for (const key of ['totalReturnPct', 'sharpeRatio', 'maxDrawdownPct', 'winRatePct', 'totalPnl', 'tradeCount', 'profitFactor']) {
      const a = (m1 as any)[key] ?? 0;
      const b = (m2 as any)[key] ?? 0;
      deltas[key] = { v1: a, v2: b, delta: b - a };
    }

    res.json({ v1, v2, deltas });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Revert strategy to a specific version
router.post('/strategy/:id/versions/:versionNumber/revert', async (req, res) => {
  try {
    const version = await StrategyVersionModel.findOne({
      strategyId: req.params.id,
      versionNumber: Number(req.params.versionNumber),
    }).lean();

    if (!version) {
      return res.status(404).json({ error: 'Version not found' });
    }

    const snapshot = version.snapshot as any;
    const update: any = {};
    if (snapshot.name) update.name = snapshot.name;
    if (snapshot.description) update.description = snapshot.description;
    if (snapshot.screenerConfig) update.screenerConfig = snapshot.screenerConfig;
    if (snapshot.futuresConfig) update.futuresConfig = snapshot.futuresConfig;
    if (snapshot.modelConfig) update.modelConfig = snapshot.modelConfig;

    const strategy = await LabStrategyModel.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!strategy) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    res.json({ message: `Reverted to ${version.versionLabel}`, strategy });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Apply AI suggestions to a strategy
router.post('/strategy/:id/apply-suggestions', async (req, res) => {
  try {
    const { suggestions } = req.body;
    if (!Array.isArray(suggestions) || suggestions.length === 0) {
      return res.status(400).json({ error: 'suggestions array is required' });
    }

    const strategy = await LabStrategyModel.findById(req.params.id);
    if (!strategy) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    const sc = ((strategy as any).screenerConfig ?? {}) as any;
    const params = { ...(sc.params ?? {}) };

    for (const suggestion of suggestions) {
      const field = String(suggestion.field ?? '');
      const value = suggestion.suggestedValue;
      const action = suggestion.action ?? 'modify';

      if (field.startsWith('parameters.')) {
        const paramKey = field.replace('parameters.', '');
        if (action === 'remove') {
          delete params[paramKey];
        } else {
          params[paramKey] = value;
        }
      } else if (field === 'entry_rules') {
        if (action === 'add' && typeof value === 'string') {
          const rules = Array.isArray(params.entry_rules) ? [...params.entry_rules] : [];
          rules.push(value);
          params.entry_rules = rules;
        } else if (action === 'modify' && Array.isArray(value)) {
          params.entry_rules = value;
        }
      } else if (field === 'exit_rules') {
        if (action === 'add' && typeof value === 'string') {
          const rules = Array.isArray(params.exit_rules) ? [...params.exit_rules] : [];
          rules.push(value);
          params.exit_rules = rules;
        } else if (action === 'modify' && Array.isArray(value)) {
          params.exit_rules = value;
        }
      } else if (field === 'risk_management') {
        if (action === 'add' && typeof value === 'string') {
          const rules = Array.isArray(params.risk_management) ? [...params.risk_management] : [];
          rules.push(value);
          params.risk_management = rules;
        } else if (action === 'modify' && Array.isArray(value)) {
          params.risk_management = value;
        }
      }
    }

    sc.params = params;
    (strategy as any).screenerConfig = sc;
    await strategy.save();

    res.json({ message: `Applied ${suggestions.length} suggestions`, strategy });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// In-memory store for pending extractions so clients can poll if they miss the socket event.
const pendingExtractions: Map<string, { data: any; status: string; error?: string; ts: number }> = new Map();

// Webhook for AI Agent to notify extraction completion
router.post('/notify-extraction', (req, res) => {
  const { socketId, data, status, error } = req.body;
  const io = req.app.get('io');

  if (!io) {
    console.warn('[LAB] io instance not found in app, cannot notify client');
    return res.status(500).json({ error: 'Socket.io not initialized on server' });
  }

  // Persist the result so the client can poll for it
  const extractionId = socketId ?? `broadcast_${Date.now()}`;
  pendingExtractions.set(extractionId, { data, status, error, ts: Date.now() });

  // Clean up entries older than 10 minutes
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, entry] of pendingExtractions) {
    if (entry.ts < cutoff) pendingExtractions.delete(key);
  }

  if (socketId) {
    const targetSocket = io.sockets.sockets.get(socketId);
    if (targetSocket) {
      console.log(`[LAB] Notifying client ${socketId} about extraction ${status}`);
      targetSocket.emit('strategy-extracted', { data, status, error });
    } else {
      // Socket ID is stale — broadcast to all connected clients instead
      console.warn(`[LAB] Socket ${socketId} not found (likely reconnected), broadcasting to all clients`);
      io.emit('strategy-extracted', { data, status, error });
    }
  } else {
    console.log('[LAB] Broadcasting extraction completion');
    io.emit('strategy-extracted', { data, status, error });
  }

  res.json({ ok: true });
});

// Poll endpoint for clients that missed the socket event
router.get('/pending-extraction/:socketId', (req, res) => {
  const entry = pendingExtractions.get(req.params.socketId);
  if (!entry) {
    return res.json({ found: false });
  }
  pendingExtractions.delete(req.params.socketId);
  res.json({ found: true, ...entry });
});

export const labRouter = router;
