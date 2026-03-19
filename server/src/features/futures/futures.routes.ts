import express from 'express';
import { LabStrategyModel } from '../handoff/models/strategyModel';
import { getContractSpec, listActiveContractSpecs } from './services/contractSpecs.service';
import { getFuturesBacktest, runFuturesBacktest } from './services/futuresBacktest.service';
import {
  controlFuturesPaperSession,
  deployFuturesSessionToEngine,
  generateFuturesPromotionReport,
  getFuturesEngineStatus,
  getFuturesPaperSession,
  startFuturesPaperSession
} from './services/paperRuntime.service';

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
      lookback
    });

    res.json(result);
  } catch (error: any) {
    console.error('[FUTURES] Backtest failed:', error);
    res.status(500).json({ error: error?.message ?? 'Futures backtest failed' });
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

router.post('/paper/start', async (req, res) => {
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

    const session = await startFuturesPaperSession({
      strategyId,
      strategyName,
      symbol,
      contracts,
      initialCapital,
      maxDailyLoss,
      maxDrawdown,
      slippageBps,
      feePerContract,
      mode: 'lab-paper'
    });

    res.json(session);
  } catch (error: any) {
    console.error('[FUTURES] Paper start failed:', error);
    res.status(500).json({ error: error?.message ?? 'Unable to start futures paper session' });
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

router.post('/paper/:sessionId/control', async (req, res) => {
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

router.post('/promotion/check', async (req, res) => {
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

router.post('/deploy', async (req, res) => {
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

router.post('/strategy/create', async (req, res) => {
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
