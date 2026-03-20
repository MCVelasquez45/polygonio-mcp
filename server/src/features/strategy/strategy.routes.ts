import express from 'express';
import mongoose from 'mongoose';
import { buildStrategyAst } from './compiler/astBuilder.service';
import { compileDsl } from './compiler/dslCompiler.service';
import { compileRuntimeSpec } from './compiler/runtimeSpecCompiler.service';
import { runMockBacktest } from './backtest/backtestOrchestrator.service';
import { parseStrategyInput, validateStructuredStrategy } from './parser/nlpParser.service';
import { StrategyModel } from './models/strategyModel';
import { StrategyVersionModel } from './models/strategyVersionModel';
import { BacktestRunModel } from './models/backtestRunModel';
import {
  assertStrategySourceType,
  assertStructuredStrategy,
  type StrategySourceType,
  type StructuredStrategy,
  type SpreadConfig,
  type RegimeConfig,
  type TimeRule
} from './types';
import { runStrategyBacktest, type StrategyBacktestInput } from '../futures/services/strategyBacktest.service';

const router = express.Router();

function buildVersionFromSequence(sequence: number) {
  return `1.0.${Math.max(sequence - 1, 0)}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requirePlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readObjectId(value: unknown, label: string): string | undefined {
  const candidate = readOptionalString(value);
  if (!candidate) return undefined;
  if (!mongoose.Types.ObjectId.isValid(candidate)) {
    throw new Error(`${label} is invalid.`);
  }
  return candidate;
}

function readSourceType(value: unknown): StrategySourceType {
  if (value == null || value === '') return 'text';
  assertStrategySourceType(value);
  return value;
}

function serializeStructuredStrategy(strategy: StructuredStrategy) {
  return JSON.stringify(strategy);
}

async function getOrCreateStrategy(args: { strategyId?: string; name: string; description?: string; rawInput: string }) {
  if (args.strategyId) {
    const existing = await StrategyModel.findById(args.strategyId);
    if (existing) {
      return existing;
    }
    // strategyId may be from a different collection (e.g., LabStrategy) — create a new pipeline strategy
  }

  return StrategyModel.create({
    name: args.name,
    description: args.description ?? '',
    status: 'draft',
    pipelineStage: 'draft',
    versionSequence: 0,
    latestVersion: '1.0.0',
    latestInput: args.rawInput
  });
}

function parseRequestBody(body: unknown) {
  requirePlainObject(body, 'Request body');
  return body;
}

function resolveStructuredStrategy(body: Record<string, unknown>): StructuredStrategy {
  const input = readNonEmptyString(body.input, 'Strategy input');
  const sourceType = readSourceType(body.sourceType);
  const serverParsed = parseStrategyInput(input, sourceType);

  if (body.parsedStrategy != null) {
    assertStructuredStrategy(body.parsedStrategy, 'parsedStrategy');
    validateStructuredStrategy(body.parsedStrategy);
    if (serializeStructuredStrategy(body.parsedStrategy) !== serializeStructuredStrategy(serverParsed)) {
      throw new Error('Parsed strategy is stale. Re-parse the current draft before compiling.');
    }
  }

  return serverParsed;
}

router.post('/parse', async (req, res) => {
  try {
    const body = parseRequestBody(req.body);
    const input = readNonEmptyString(body.input, 'Strategy input');
    const sourceType = readSourceType(body.sourceType);
    const parsedStrategy = parseStrategyInput(input, sourceType);
    res.json({ parsedStrategy });
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? 'Unable to parse strategy input.' });
  }
});

function applyExtractionMetadata(strategy: StructuredStrategy, body: Record<string, unknown>): StructuredStrategy {
  // Map extraction-level fields onto the StructuredStrategy for compilation.
  // These come from SIFT extraction output stored in screenerConfig.params.

  // spreadConfig from contract_selection fields
  const cs = body.contractSelection ?? body.contract_selection;
  if (isPlainObject(cs)) {
    const csObj = cs as Record<string, unknown>;
    const spreadStrategy = csObj.spread_strategy ?? csObj.spreadStrategy;
    if (typeof spreadStrategy === 'string' && ['credit_spread', 'debit_spread', 'iron_condor'].includes(spreadStrategy)) {
      const spreadWidth = typeof csObj.spread_width === 'number' ? csObj.spread_width
        : typeof csObj.spreadWidth === 'number' ? csObj.spreadWidth : 5;
      const shortDelta = typeof csObj.short_leg_delta === 'number' ? csObj.short_leg_delta
        : typeof csObj.delta_target === 'number' ? csObj.delta_target : 0.2;
      const contractType = typeof csObj.contract_type === 'string' && csObj.contract_type !== 'call_and_put'
        ? csObj.contract_type as 'call' | 'put' : 'put';
      strategy.spreadConfig = {
        strategy: spreadStrategy as SpreadConfig['strategy'],
        spreadWidth,
        legs: [
          { role: 'short', contractType, strikeSelection: 'delta_target', deltaTarget: shortDelta },
          { role: 'long', contractType, strikeSelection: 'offset', offsetFromShort: spreadWidth },
        ],
      };
    }
  }

  // regimeConfig
  const rc = body.regimeConfig ?? body.regime_config;
  if (isPlainObject(rc)) {
    const rcObj = rc as Record<string, unknown>;
    const riskOnTickers = Array.isArray(rcObj.riskOnTickers) ? rcObj.riskOnTickers
      : Array.isArray(rcObj.risk_on_tickers) ? rcObj.risk_on_tickers : [];
    const riskOffTickers = Array.isArray(rcObj.riskOffTickers) ? rcObj.riskOffTickers
      : Array.isArray(rcObj.risk_off_tickers) ? rcObj.risk_off_tickers : [];
    const leaderTickers = Array.isArray(rcObj.leaderTickers) ? rcObj.leaderTickers
      : Array.isArray(rcObj.leader_tickers) ? rcObj.leader_tickers : [];
    if (riskOnTickers.length > 0 || riskOffTickers.length > 0) {
      strategy.regimeConfig = {
        riskOnTickers: riskOnTickers.map(String),
        riskOffTickers: riskOffTickers.map(String),
        leaderTickers: leaderTickers.map(String),
        riskOnAction: (rcObj.riskOnAction ?? rcObj.risk_on_action ?? 'put_credit_spread') as RegimeConfig['riskOnAction'],
        riskOffAction: (rcObj.riskOffAction ?? rcObj.risk_off_action ?? 'call_credit_spread') as RegimeConfig['riskOffAction'],
      };
    }
  }

  // timeRules
  const tr = body.timeRules ?? body.time_rules;
  if (Array.isArray(tr) && tr.length > 0) {
    strategy.timeRules = tr.map((rule: Record<string, unknown>) => ({
      type: (rule.type ?? 'time_window') as TimeRule['type'],
      ...(rule.startTime ?? rule.start_time ? { startTime: String(rule.startTime ?? rule.start_time) } : {}),
      ...(rule.endTime ?? rule.end_time ? { endTime: String(rule.endTime ?? rule.end_time) } : {}),
      ...(rule.minutesBeforeClose ?? rule.minutes_before_close != null ? { minutesBeforeClose: Number(rule.minutesBeforeClose ?? rule.minutes_before_close) } : {}),
      ...(rule.targetPct ?? rule.target_pct != null ? { targetPct: Number(rule.targetPct ?? rule.target_pct) } : {}),
      ...(rule.multiplier != null ? { multiplier: Number(rule.multiplier) } : {}),
      ...(rule.pctToStrike ?? rule.pct_to_strike != null ? { pctToStrike: Number(rule.pctToStrike ?? rule.pct_to_strike) } : {}),
      ...(rule.minMinutesRemaining ?? rule.min_minutes_remaining != null ? { minMinutesRemaining: Number(rule.minMinutesRemaining ?? rule.min_minutes_remaining) } : {}),
    }));
  }

  return strategy;
}

router.post('/compile', async (req, res) => {
  try {
    const body = parseRequestBody(req.body);
    let parsedStrategy = resolveStructuredStrategy(body);
    parsedStrategy = applyExtractionMetadata(parsedStrategy, body);
    const ast = buildStrategyAst(parsedStrategy);
    const dsl = compileDsl(ast);
    const runtimeSpec = compileRuntimeSpec(ast);

    const strategy = await getOrCreateStrategy({
      strategyId: readObjectId(body.strategyId, 'strategyId'),
      name: readOptionalString(body.name) ?? parsedStrategy.name,
      description: readOptionalString(body.description) ?? parsedStrategy.sourceText,
      rawInput: parsedStrategy.sourceText
    });

    const sequencedStrategy = await StrategyModel.findByIdAndUpdate(
      strategy._id,
      { $inc: { versionSequence: 1 } },
      { new: true }
    );

    if (!sequencedStrategy) {
      throw new Error('Strategy not found.');
    }

    const version = buildVersionFromSequence(sequencedStrategy.versionSequence);
    const versionDoc = await StrategyVersionModel.create({
      strategyId: sequencedStrategy._id,
      version,
      status: 'compiled',
      pipelineStage: 'compiled',
      inputArtifacts: {
        rawInput: parsedStrategy.sourceText,
        sourceType: parsedStrategy.sourceType,
        structured: parsedStrategy
      },
      compiledArtifacts: {
        ast,
        dsl,
        runtimeSpec
      }
    });

    await StrategyModel.findByIdAndUpdate(sequencedStrategy._id, {
      latestVersion: version,
      currentVersionId: versionDoc._id,
      status: 'compiled',
      pipelineStage: 'compiled',
      latestInput: parsedStrategy.sourceText
    });

    const nextStrategy = await StrategyModel.findById(sequencedStrategy._id).lean();
    res.json({
      strategy: nextStrategy,
      version: versionDoc.toObject()
    });
  } catch (error: any) {
    const message = error?.message ?? 'Unable to compile strategy.';
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'A version conflict occurred. Retry the compile request.' });
    }
    const status = message === 'Strategy not found.' ? 404 : message.includes('stale') ? 409 : 400;
    res.status(status).json({ error: message });
  }
});

router.post('/compile-extracted', async (req, res) => {
  try {
    const body = parseRequestBody(req.body);
    const name = readOptionalString(body.name) ?? 'Extracted Strategy';
    const description = readOptionalString(body.description) ?? '';
    const hypothesis = readOptionalString(body.hypothesis) ?? '';

    // Build entry/exit conditions — for extracted strategies, rules are natural language strings.
    // We create passthrough conditions so the RuntimeSpec carries the rules for the executor.
    const rawEntryRules = Array.isArray(body.entry_rules) ? body.entry_rules : [];
    const rawExitRules = Array.isArray(body.exit_rules) ? body.exit_rules : [];

    const entry = rawEntryRules.length > 0 ? [{
      field: 'PRICE' as const,
      operator: 'gt' as const,
      value: 0,
      raw: rawEntryRules.join(' AND '),
      provenance: { source: 'user' as const, reason: 'extracted from transcript' }
    }] : [{
      field: 'PRICE' as const,
      operator: 'gt' as const,
      value: 0,
      raw: 'price > 0 (passthrough)',
      provenance: { source: 'system-generated' as const, reason: 'passthrough for extracted strategy' }
    }];

    const exit = rawExitRules.length > 0 ? [{
      field: 'PRICE' as const,
      operator: 'gt' as const,
      value: 0,
      raw: rawExitRules.join(' AND '),
      provenance: { source: 'user' as const, reason: 'extracted from transcript' }
    }] : [{
      field: 'PRICE' as const,
      operator: 'gt' as const,
      value: 0,
      raw: 'price > 0 (passthrough)',
      provenance: { source: 'system-generated' as const, reason: 'passthrough for extracted strategy' }
    }];

    // Determine trading method and instrument
    const tradingMethod = (body.trading_method ?? body.tradingMethod ?? 'equities') as string;
    const instrument = tradingMethod === 'options' ? 'CALL' as const
      : tradingMethod === 'futures' ? 'FUTURE' as const
      : 'STOCK' as const;

    // Build StructuredStrategy directly from extraction data
    const parsedStrategy: StructuredStrategy = {
      name,
      sourceText: `${name}: ${description}`,
      sourceType: 'transcript',
      action: 'SELL',
      instrument,
      tradingMethod: tradingMethod as any,
      entry,
      exit,
      riskManagement: {
        stopLossPct: 0.1,
        takeProfitPct: 0.2,
        maxBarsInTrade: 120,
      },
      warnings: [],
    };

    // Apply all extraction metadata (spreadConfig, regimeConfig, timeRules, contractSelection)
    const enriched = applyExtractionMetadata(parsedStrategy, body);

    // Also apply contractSelection from extraction
    const cs = body.contract_selection ?? body.contractSelection;
    if (isPlainObject(cs)) {
      const csObj = cs as Record<string, unknown>;
      const underlying = String(body.underlying_ticker ?? body.underlyingTicker ?? csObj.underlying ?? 'SPY');
      const contractType = typeof csObj.contract_type === 'string' && csObj.contract_type !== 'call_and_put'
        ? csObj.contract_type : 'put';
      const dteMin = Number(csObj.dte_min ?? csObj.dteMin ?? 0);
      const dteMax = Number(csObj.dte_max ?? csObj.dteMax ?? 0);
      const deltaTarget = Number(csObj.delta_target ?? csObj.deltaTarget ?? 0.2);
      enriched.contractSelection = {
        method: 'options',
        options: {
          underlying,
          contractType: contractType as 'call' | 'put',
          strikeSelection: 'delta_target',
          deltaTarget,
          dteMin,
          dteMax,
        },
      };
    }

    const ast = buildStrategyAst(enriched);
    const dsl = compileDsl(ast);
    const runtimeSpec = compileRuntimeSpec(ast);

    const strategy = await getOrCreateStrategy({
      strategyId: readObjectId(body.strategyId, 'strategyId'),
      name,
      description,
      rawInput: enriched.sourceText,
    });

    const sequencedStrategy = await StrategyModel.findByIdAndUpdate(
      strategy._id,
      {
        $inc: { versionSequence: 1 },
        tradingMethod: tradingMethod,
      },
      { new: true }
    );

    if (!sequencedStrategy) {
      throw new Error('Strategy not found.');
    }

    const version = buildVersionFromSequence(sequencedStrategy.versionSequence);
    const versionDoc = await StrategyVersionModel.create({
      strategyId: sequencedStrategy._id,
      version,
      status: 'compiled',
      pipelineStage: 'compiled',
      inputArtifacts: {
        rawInput: enriched.sourceText,
        sourceType: enriched.sourceType,
        structured: enriched,
      },
      compiledArtifacts: { ast, dsl, runtimeSpec },
    });

    await StrategyModel.findByIdAndUpdate(sequencedStrategy._id, {
      latestVersion: version,
      currentVersionId: versionDoc._id,
      status: 'compiled',
      pipelineStage: 'compiled',
      latestInput: enriched.sourceText,
    });

    const nextStrategy = await StrategyModel.findById(sequencedStrategy._id).lean();
    res.json({ strategy: nextStrategy, version: versionDoc.toObject() });
  } catch (error: any) {
    const message = error?.message ?? 'Unable to compile extracted strategy.';
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'A version conflict occurred. Retry the compile request.' });
    }
    res.status(400).json({ error: message });
  }
});

router.post('/backtest', async (req, res) => {
  try {
    const body = parseRequestBody(req.body);
    const versionId = readObjectId(body.versionId, 'versionId');
    const strategyId = readObjectId(body.strategyId, 'strategyId');

    if (!versionId && !strategyId) {
      return res.status(400).json({ error: 'strategyId or versionId is required.' });
    }

    const versionDoc = versionId
      ? await StrategyVersionModel.findById(versionId).lean()
      : await StrategyVersionModel.findOne({ strategyId }).sort({ createdAt: -1 }).lean();

    if (!versionDoc) {
      return res.status(404).json({ error: 'Strategy version not found.' });
    }

    validateStructuredStrategy(versionDoc.inputArtifacts.structured);
    const runtimeSpec = versionDoc.compiledArtifacts.runtimeSpec as Record<string, any>;
    const seedKey = `${versionDoc.strategyId.toString()}-${versionDoc.version}`;

    const tradingMethod = runtimeSpec.execution?.tradingMethod;
    let results: Record<string, any>;

    // Extract strategy metadata for the backtest engine
    const structured = versionDoc.inputArtifacts?.structured as Record<string, any> | undefined;
    const entryRaw = structured?.entry;
    const exitRaw = structured?.exit;
    const entryRules: string[] = Array.isArray(entryRaw)
      ? entryRaw.map((r: any) => typeof r === 'string' ? r : r?.raw ?? '').filter(Boolean)
      : [];
    const exitRules: string[] = Array.isArray(exitRaw)
      ? exitRaw.map((r: any) => typeof r === 'string' ? r : r?.raw ?? '').filter(Boolean)
      : [];
    const riskMgmt = runtimeSpec.riskManagement ?? {};
    const riskRules: string[] = [
      riskMgmt.stopLossPct ? `Stop loss at ${riskMgmt.stopLossPct * 100}%` : '',
      riskMgmt.takeProfitPct ? `Take profit at ${riskMgmt.takeProfitPct * 100}%` : '',
    ].filter(Boolean);

    // Build strategy parameters from all available sources
    const contractSelection = runtimeSpec.execution?.contractSelection;
    const spreadConfig = runtimeSpec.execution?.spreadConfig;
    const regimeConfig = runtimeSpec.execution?.regimeConfig;
    const timeRules = runtimeSpec.execution?.timeRules;
    const strategyParams: Record<string, unknown> = {
      ...(spreadConfig ? {
        option_expiry_type: '0DTE',
        strategy_template_type: '0dte',
        option_delta_target: spreadConfig.legs?.[0]?.deltaTarget ?? 0.2,
        spread_width: spreadConfig.spreadWidth ?? 5,
        prefer_put_credit_spread_on_up_day: true,
        prefer_call_credit_spread_on_down_day: true,
      } : {}),
      ...(regimeConfig ? {
        risk_on_tickers: regimeConfig.riskOnTickers,
        risk_off_tickers: regimeConfig.riskOffTickers,
        leader_tickers: regimeConfig.leaderTickers,
      } : {}),
      ...(timeRules ? { time_rules: timeRules } : {}),
    };

    // Resolve symbol from contractSelection
    let symbol = 'ES';
    if (contractSelection?.method === 'options') {
      symbol = contractSelection.options?.underlying ?? 'SPY';
    } else if (contractSelection?.method === 'futures') {
      symbol = contractSelection.futures?.symbol ?? 'ES';
    } else if (contractSelection?.method === 'equities') {
      symbol = contractSelection.equities?.ticker ?? 'SPY';
    }

    if (tradingMethod === 'options' || tradingMethod === 'futures' || spreadConfig) {
      // Use the server-side futures backtest engine (handles credit spreads, iron condors, etc.)
      const backtestInput: StrategyBacktestInput = {
        strategyId: versionDoc.strategyId.toString(),
        strategyName: runtimeSpec.name ?? 'Strategy',
        symbol,
        startDate: process.env.STRATEGY_BACKTEST_FROM || '2025-01-01',
        endDate: process.env.STRATEGY_BACKTEST_TO || '2025-12-31',
        initialCapital: 100000,
        contracts: 1,
        rollPolicy: 'volume',
        rollDaysBefore: 5,
        slippageBps: 2.5,
        feePerContract: 2.5,
        entryRules,
        exitRules,
        riskManagement: riskRules,
        strategyParameters: strategyParams,
      };
      const backtestResult = await runStrategyBacktest(backtestInput);

      // Build diagnostics with clear data source warnings
      const diag = backtestResult.diagnostics ?? {} as Record<string, any>;
      const provider = diag.provider ?? 'unknown';
      const isSynthetic = provider === 'synthetic' || diag.usedFallbackData === true;
      const dataWarning = isSynthetic
        ? 'SYNTHETIC DATA: Results are based on simulated price data, NOT real market prices. '
          + 'This happens when Polygon.io is rate-limited and Databento is not configured. '
          + 'To use real data: (1) wait for Polygon rate limits to reset, or (2) add DATABENTO_API_KEY to your .env file, '
          + 'or (3) upgrade your Polygon/Massive API plan.'
        : undefined;

      // Map to common result shape
      results = {
        pnl: backtestResult.metrics?.totalPnl ?? 0,
        winRate: (backtestResult.metrics?.winRatePct ?? 0) * 100,
        totalTrades: backtestResult.metrics?.tradeCount ?? 0,
        trades: backtestResult.tradeLedger ?? [],
        sharpeRatio: backtestResult.metrics?.sharpeRatio ?? null,
        maxDrawdownPct: (backtestResult.metrics?.maxDrawdownPct ?? 0) * 100,
        equityCurve: backtestResult.equityCurve ?? [],
        diagnostics: {
          ...diag,
          resolvedSymbol: symbol !== backtestInput.symbol ? `${symbol} → ${backtestInput.symbol}` : backtestInput.symbol,
          ...(dataWarning ? { dataWarning } : {}),
        },
        // Also store the full result for the results panel
        _fullResult: backtestResult,
      };
    } else {
      // Equities fallback: existing TypeScript orchestrator
      results = await runMockBacktest(runtimeSpec as any, seedKey);
    }

    const backtestRun = await BacktestRunModel.create({
      strategyId: versionDoc.strategyId,
      versionId: versionDoc._id,
      version: versionDoc.version,
      status: 'completed',
      pipelineStage: 'backtested',
      seedKey,
      executionSnapshot: runtimeSpec,
      results
    });

    await StrategyModel.findByIdAndUpdate(versionDoc.strategyId, {
      status: 'backtested',
      pipelineStage: 'backtested',
      currentVersionId: versionDoc._id,
      latestBacktestRunId: backtestRun._id
    });

    res.json({
      strategyId: versionDoc.strategyId,
      versionId: versionDoc._id,
      backtestRunId: backtestRun._id,
      results
    });
  } catch (error: any) {
    const message = error?.message ?? 'Unable to backtest strategy.';
    const status = message.includes('invalid') ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

router.get('/', async (_req, res) => {
  try {
    const strategies = await StrategyModel.find().sort({ updatedAt: -1 }).lean();
    res.json({ strategies });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Unable to load strategies.' });
  }
});

router.get('/:id/versions', async (req, res) => {
  try {
    const strategyId = readObjectId(req.params.id, 'strategyId');
    if (!strategyId) {
      return res.status(400).json({ error: 'strategyId is required.' });
    }

    const versions = await StrategyVersionModel.find({ strategyId }).sort({ createdAt: -1 }).lean();
    const runs = await BacktestRunModel.find({ strategyId }).sort({ createdAt: -1 }).lean();
    const latestRunByVersionId = new Map<string, Record<string, unknown>>();

    runs.forEach(run => {
      const key = run.versionId.toString();
      if (!latestRunByVersionId.has(key)) {
        latestRunByVersionId.set(key, run);
      }
    });

    res.json({
      versions: versions.map(version => ({
        ...version,
        latestBacktestRun: latestRunByVersionId.get(version._id.toString()) ?? null
      }))
    });
  } catch (error: any) {
    const message = error?.message ?? 'Unable to load strategy versions.';
    const status = message.includes('invalid') ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

export const strategyRouter = router;
