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
  type StructuredStrategy
} from './types';

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
    if (!existing) {
      throw new Error('Strategy not found.');
    }
    return existing;
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

router.post('/compile', async (req, res) => {
  try {
    const body = parseRequestBody(req.body);
    const parsedStrategy = resolveStructuredStrategy(body);
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
    const runtimeSpec = versionDoc.compiledArtifacts.runtimeSpec;
    const seedKey = `${versionDoc.strategyId.toString()}-${versionDoc.version}`;
    const results = await runMockBacktest(runtimeSpec, seedKey);

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
