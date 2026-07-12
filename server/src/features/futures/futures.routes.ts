import express from 'express';
import { LabStrategyModel, StrategyVersionModel } from '../handoff/models/strategyModel';
import { getContractSpec, listActiveContractSpecs } from './services/contractSpecs.service';
import { getFuturesBacktest, listBacktestsByStrategy, runFuturesBacktest, runStressTest } from './services/futuresBacktest.service';
import {
  controlFuturesPaperSession,
  deployFuturesSessionToEngine,
  generateFuturesPromotionReport,
  getFuturesEngineStatus,
  getFuturesPaperSession,
  listFuturesPaperSessions,
  startFuturesPaperSession
} from './services/paperRuntime.service';
import { requireAdmin, requireTrader } from '../../shared/auth';

const router = express.Router();

router.get('/contracts', async (_req, res) => {
  try {
    const specs = await listActiveContractSpecs();
    res.json({ count: specs.length, specs });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Unable to list futures contract specs' });
  }
});

router.post('/backtest', async (req, res) => {
  try {
    const body = req.body ?? {};
    const strategyId = String(body.strategyId ?? '').trim();
    const symbol = String(body.symbol ?? '').trim().toUpperCase();
    const strategyName = String(body.strategyName ?? 'Unnamed Futures Strategy').trim();
    const startDate = String(body.startDate ?? '').trim();
    const endDate = String(body.endDate ?? '').trim();
    const initialCapital = Number(body.initialCapital ?? 100000);
    const contracts = Number(body.contracts ?? 1);
    const rollPolicy =
      body.rollPolicy === 'calendar' || body.rollPolicy === 'open_interest' ? body.rollPolicy : 'volume';
    const rollDaysBefore = Number(body.rollDaysBefore ?? 5);
    const slippageBps = Number(body.slippageBps ?? 1.5);
    const feePerContract = Number(body.feePerContract ?? 2.5);
    const lookback = Number(body.lookback ?? 10);

    if (!strategyId || !symbol || !startDate || !endDate) {
      return res.status(400).json({ error: 'strategyId, symbol, startDate, and endDate are required' });
    }

    const spec = await getContractSpec(symbol);
    if (!spec) {
      return res.status(400).json({ error: `Unsupported futures symbol '${symbol}'` });
    }

    // Load strategy rules from the database for the hybrid signal engine
    let entryRules: string[] = [];
    let exitRules: string[] = [];
    let riskManagement: string[] = [];
    let strategyParameters: Record<string, unknown> = {};

    try {
      const strategy = await LabStrategyModel.findById(strategyId).lean();
      if (strategy) {
        const sc = (strategy as any).screenerConfig;
        const params = sc?.params ?? {};
        entryRules = Array.isArray(params.entry_rules) ? params.entry_rules : [];
        exitRules = Array.isArray(params.exit_rules) ? params.exit_rules : [];
        riskManagement = Array.isArray(params.risk_management) ? params.risk_management : [];
        // Pass all non-reserved params as strategy parameters
        // Keep strategy_template_type — used by credit spread detection
        const { entry_rules, exit_rules, risk_management, source, hypothesis, transcript, parameter_definitions, ...rest } = params;
        strategyParameters = rest;
      }
    } catch (err) {
      console.warn('[FUTURES] Could not load strategy rules, using defaults:', (err as any)?.message);
    }

    const result = await runFuturesBacktest({
      strategyId,
      strategyName,
      symbol,
      startDate,
      endDate,
      initialCapital,
      contracts,
      rollPolicy,
      rollDaysBefore,
      slippageBps,
      feePerContract,
      lookback,
      entryRules,
      exitRules,
      riskManagement,
      strategyParameters,
    });

    // Auto-create strategy version on successful backtest
    try {
      const strategyDoc = await LabStrategyModel.findById(strategyId).lean();
      if (strategyDoc) {
        const latestVersion = await StrategyVersionModel.findOne({ strategyId })
          .sort({ versionNumber: -1 }).lean();
        const nextVersion = ((latestVersion as any)?.versionNumber ?? 0) + 1;
        await StrategyVersionModel.create({
          strategyId,
          versionNumber: nextVersion,
          versionLabel: `v${nextVersion}`,
          snapshot: {
            name: (strategyDoc as any).name,
            description: (strategyDoc as any).description,
            strategyType: (strategyDoc as any).strategyType,
            screenerConfig: (strategyDoc as any).screenerConfig,
            futuresConfig: (strategyDoc as any).futuresConfig,
            modelConfig: (strategyDoc as any).modelConfig,
          },
          backtestId: result._id,
          backtestMetrics: result.metrics,
        });
      }
    } catch (vErr) {
      console.warn('[FUTURES] Version creation failed:', (vErr as any)?.message);
    }

    res.json(result);
  } catch (error: any) {
    console.error('[FUTURES] Backtest failed:', error);
    res.status(500).json({ error: error?.message ?? 'Futures backtest failed' });
  }
});

router.get('/backtests/strategy/:strategyId', async (req, res) => {
  try {
    const backtests = await listBacktestsByStrategy(req.params.strategyId);
    res.json(backtests);
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Unable to list backtests' });
  }
});

router.get('/backtest/:id', async (req, res) => {
  try {
    const backtest = await getFuturesBacktest(req.params.id);
    if (!backtest) return res.status(404).json({ error: 'Backtest not found' });
    res.json(backtest);
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Unable to load futures backtest' });
  }
});

router.post('/backtest/stress-test', async (req, res) => {
  try {
    const body = req.body ?? {};
    const strategyId = String(body.strategyId ?? '').trim();
    const symbol = String(body.symbol ?? '').trim().toUpperCase();
    const strategyName = String(body.strategyName ?? 'Unnamed').trim();
    const startDate = String(body.startDate ?? '').trim();
    const endDate = String(body.endDate ?? '').trim();
    const initialCapital = Number(body.initialCapital ?? 100000);
    const slippageBps = Number(body.slippageBps ?? 1.5);
    const feePerContract = Number(body.feePerContract ?? 2.5);

    if (!strategyId || !symbol || !startDate || !endDate) {
      return res.status(400).json({ error: 'strategyId, symbol, startDate, and endDate are required' });
    }

    // Load strategy rules
    let entryRules: string[] = [];
    let exitRules: string[] = [];
    let riskManagement: string[] = [];
    let strategyParameters: Record<string, unknown> = {};

    try {
      const strategy = await LabStrategyModel.findById(strategyId).lean();
      if (strategy) {
        const sc = (strategy as any).screenerConfig;
        const params = sc?.params ?? {};
        entryRules = Array.isArray(params.entry_rules) ? params.entry_rules : [];
        exitRules = Array.isArray(params.exit_rules) ? params.exit_rules : [];
        riskManagement = Array.isArray(params.risk_management) ? params.risk_management : [];
        const { entry_rules, exit_rules, risk_management, source, hypothesis, transcript, parameter_definitions, ...rest } = params;
        strategyParameters = rest;
      }
    } catch (err) {
      console.warn('[FUTURES] Could not load strategy rules for stress test:', (err as any)?.message);
    }

    const results = await runStressTest({
      strategyId,
      strategyName,
      symbol,
      startDate,
      endDate,
      initialCapital,
      contracts: 1,
      rollPolicy: 'volume',
      rollDaysBefore: 5,
      slippageBps,
      feePerContract,
      entryRules,
      exitRules,
      riskManagement,
      strategyParameters,
    });

    res.json({ scenarios: results });
  } catch (error: any) {
    console.error('[FUTURES] Stress test failed:', error);
    res.status(500).json({ error: error?.message ?? 'Stress test failed' });
  }
});

router.post('/paper/start', requireTrader, async (req, res) => {
  try {
    const body = req.body ?? {};
    const strategyId = String(body.strategyId ?? '').trim();
    const strategyName = String(body.strategyName ?? '').trim();
    const symbol = String(body.symbol ?? '').trim().toUpperCase();
    const contracts = Number(body.contracts ?? 1);
    const initialCapital = Number(body.initialCapital ?? 100000);
    const maxDailyLoss = Number(body.maxDailyLoss ?? 5000);
    const maxDrawdown = Number(body.maxDrawdown ?? 0.08);
    const slippageBps = Number(body.slippageBps ?? 1.5);
    const feePerContract = Number(body.feePerContract ?? 2.5);

    if (!strategyId || !strategyName || !symbol) {
      return res.status(400).json({ error: 'strategyId, strategyName, and symbol are required' });
    }

    const spec = await getContractSpec(symbol);
    if (!spec) return res.status(400).json({ error: `Unsupported futures symbol '${symbol}'` });

    // Load strategy rules for strategy-aware paper trading
    let strategyRules: { entry_rules: string[]; exit_rules: string[]; risk_management: string[]; parameters: Record<string, unknown> } | undefined;
    try {
      const strategy = await LabStrategyModel.findById(strategyId).lean();
      if (strategy) {
        const sc = (strategy as any).screenerConfig;
        const params = sc?.params ?? {};
        const entryRules = Array.isArray(params.entry_rules) ? params.entry_rules : [];
        const exitRules = Array.isArray(params.exit_rules) ? params.exit_rules : [];
        const riskManagement = Array.isArray(params.risk_management) ? params.risk_management : [];
        const { entry_rules, exit_rules, risk_management, source, hypothesis, transcript, parameter_definitions, ...rest } = params;
        strategyRules = { entry_rules: entryRules, exit_rules: exitRules, risk_management: riskManagement, parameters: rest };
      }
    } catch (err) {
      console.warn('[FUTURES] Could not load strategy rules for paper session:', (err as any)?.message);
    }

    const backtestId = body.backtestId ? String(body.backtestId).trim() : undefined;
    const versionLabel = body.versionLabel ? String(body.versionLabel).trim() : undefined;

    const session = await startFuturesPaperSession({
      strategyId,
      strategyName,
      backtestId,
      versionLabel,
      symbol,
      contracts,
      initialCapital,
      maxDailyLoss,
      maxDrawdown,
      slippageBps,
      feePerContract,
      mode: 'lab-paper',
      strategyRules,
    });

    res.json(session);
  } catch (error: any) {
    console.error('[FUTURES] Paper start failed:', error);
    res.status(500).json({ error: error?.message ?? 'Unable to start futures paper session' });
  }
});

router.get('/paper/sessions', async (req, res) => {
  try {
    const strategyId = typeof req.query.strategyId === 'string' ? req.query.strategyId : undefined;
    const sessions = await listFuturesPaperSessions(strategyId);
    res.json({ sessions });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Unable to list futures paper sessions' });
  }
});

router.get('/paper/:sessionId', async (req, res) => {
  try {
    const session = await getFuturesPaperSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Paper session not found' });
    res.json(session);
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Unable to fetch futures paper session' });
  }
});

router.post('/paper/:sessionId/control', requireTrader, async (req, res) => {
  try {
    const action = req.body?.action as 'pause' | 'resume' | 'stop' | 'emergency_stop';
    if (!['pause', 'resume', 'stop', 'emergency_stop'].includes(action)) {
      return res.status(400).json({ error: "action must be one of: 'pause', 'resume', 'stop', 'emergency_stop'" });
    }

    const updated = await controlFuturesPaperSession(req.params.sessionId, action);
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Unable to control futures paper session' });
  }
});

router.post('/promotion/check', requireAdmin, async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId ?? '').trim();
    const strategyId = String(req.body?.strategyId ?? '').trim();
    if (!sessionId || !strategyId) {
      return res.status(400).json({ error: 'sessionId and strategyId are required' });
    }

    const report = await generateFuturesPromotionReport(sessionId, strategyId);
    res.json(report);
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Unable to generate promotion report' });
  }
});

router.post('/deploy', requireAdmin, async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId ?? '').trim();
    const strategyId = String(req.body?.strategyId ?? '').trim();
    const symbol = String(req.body?.symbol ?? '').trim().toUpperCase();
    if (!sessionId || !strategyId || !symbol) {
      return res.status(400).json({ error: 'sessionId, strategyId, and symbol are required' });
    }

    const deployment = await deployFuturesSessionToEngine({ sessionId, strategyId, symbol });
    res.json(deployment);
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Unable to deploy futures session' });
  }
});

router.get('/status', async (_req, res) => {
  try {
    const status = await getFuturesEngineStatus();
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Unable to load futures engine status' });
  }
});

router.post('/strategy/create', requireAdmin, async (req, res) => {
  try {
    const body = req.body ?? {};
    const name = String(body.name ?? '').trim();
    const description = String(body.description ?? '').trim();
    const ownerId = String(body.ownerId ?? 'ai_agent');
    const futuresConfig = body.futuresConfig ?? {};

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const symbol = String(futuresConfig.contract ?? '').trim().toUpperCase();
    const spec = await getContractSpec(symbol);
    if (!spec) {
      return res.status(400).json({ error: `Unsupported futures contract '${symbol}'` });
    }

    const strategy = await LabStrategyModel.create({
      name,
      description,
      ownerId,
      strategyType: 'futures',
      status: 'development',
      futuresConfig: {
        contract: symbol,
        exchange: futuresConfig.exchange ?? spec.exchange,
        tickSize: Number(futuresConfig.tickSize ?? spec.tickSize),
        tickValue: Number(futuresConfig.tickValue ?? spec.tickValue),
        contractSize: Number(futuresConfig.contractSize ?? spec.contractMultiplier),
        marginRequired: Number(futuresConfig.marginRequired ?? spec.defaultInitialMargin),
        tradingHours: String(futuresConfig.tradingHours ?? 'globex'),
        rollStrategy:
          futuresConfig.rollStrategy === 'calendar' || futuresConfig.rollStrategy === 'open_interest'
            ? futuresConfig.rollStrategy
            : 'volume',
        rollDaysBefore: Number(futuresConfig.rollDaysBefore ?? 5)
      }
    });

    res.json(strategy);
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Unable to create futures strategy' });
  }
});

export const futuresRouter = router;
