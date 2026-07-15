import { UNIVERSE_SYMBOL_PATTERN } from '../automation/automation.config';
import {
  ACTIVE_WATCHLIST_STRATEGY,
  WATCHLIST_STRATEGIES,
  WatchlistItemModel,
  type WatchlistItemDocument,
  type WatchlistStrategy,
} from './watchlist.model';
import { invalidateAutomationUniverseCache } from './automationUniverseProvider.service';

// The Watchlist Service — the ONLY writer/reader of watchlist documents.
// Every mutation invalidates the Automation Universe Provider cache so changes
// take effect immediately (no server restart, no waiting for the TTL refresh).

export class WatchlistValidationError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'WatchlistValidationError';
  }
}

export type WatchlistUpsertInput = {
  symbol: string;
  enabled?: boolean;
  automationEnabled?: boolean;
  priority?: number;
  strategy?: WatchlistStrategy;
  minConfidence?: number;
  maxPositionSize?: number;
  maxSpreadPercent?: number;
  maxDTE?: number;
  minDTE?: number;
  notes?: string;
};

function normalizeSymbol(raw: string): string {
  const symbol = String(raw ?? '').trim().toUpperCase();
  if (!UNIVERSE_SYMBOL_PATTERN.test(symbol)) {
    throw new WatchlistValidationError(`Invalid symbol: ${JSON.stringify(raw)}`);
  }
  return symbol;
}

/** Validate the mutable automation fields; returns a clean $set patch. */
function validatePatch(input: Partial<WatchlistUpsertInput>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const num = (key: keyof WatchlistUpsertInput, min: number, max: number) => {
    const value = input[key];
    if (value === undefined) return;
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max) {
      throw new WatchlistValidationError(`${String(key)} must be a number in [${min}, ${max}]`);
    }
    patch[key] = n;
  };
  if (input.enabled !== undefined) patch.enabled = Boolean(input.enabled);
  if (input.automationEnabled !== undefined) patch.automationEnabled = Boolean(input.automationEnabled);
  num('priority', 0, 100_000);
  num('minConfidence', 0, 1);
  num('maxPositionSize', 0, 1_000_000);
  num('maxSpreadPercent', 0, 100);
  num('maxDTE', 0, 1_000);
  num('minDTE', 0, 1_000);
  if (input.strategy !== undefined) {
    if (!WATCHLIST_STRATEGIES.includes(input.strategy)) {
      throw new WatchlistValidationError(`Unknown strategy: ${input.strategy}`);
    }
    patch.strategy = input.strategy;
  }
  if (input.notes !== undefined) patch.notes = String(input.notes).slice(0, 500);
  if (
    input.minDTE !== undefined &&
    input.maxDTE !== undefined &&
    Number(input.minDTE) > Number(input.maxDTE)
  ) {
    throw new WatchlistValidationError('minDTE must be ≤ maxDTE');
  }
  return patch;
}

/** All watchlist items, priority ascending then symbol (full list for the UI). */
export async function listWatchlist(): Promise<WatchlistItemDocument[]> {
  return WatchlistItemModel.find().sort({ priority: 1, symbol: 1 });
}

export type WatchlistItemView = Record<string, unknown> & {
  symbol: string;
  automationStatus: string;
  position: {
    optionSymbol: string;
    status: string;
    filledQty: number;
    realizedPnl: number | null;
    unrealizedPnl: number | null;
  } | null;
};

/**
 * Watchlist enriched with a LIVE automation status derived from broker truth
 * (the AutomationPosition collection), NEVER from intent status. Evaluation-phase
 * states (MONITORING/WAITING_FOR_BASELINE/EVALUATING/INTENT_APPROVED) come from the
 * stored telemetry; lifecycle states (ORDER_SUBMITTED..POSITION_CLOSED/EXITING) are
 * computed from the actual position. This is what the dashboard renders.
 */
export async function listWatchlistWithLiveStatus(): Promise<WatchlistItemView[]> {
  const { AutomationPositionModel } = await import('../automation/models/automationPosition.model');
  const [items, positions] = await Promise.all([
    listWatchlist(),
    AutomationPositionModel.find({ status: { $in: ['PENDING_ENTRY', 'OPEN', 'EXITING', 'MANUAL_REVIEW'] } }),
  ]);
  // Prefer the most "advanced" live position per underlying.
  const rank: Record<string, number> = { OPEN: 4, EXITING: 3, PENDING_ENTRY: 2, MANUAL_REVIEW: 1 };
  const byUnderlying = new Map<string, (typeof positions)[number]>();
  for (const pos of positions) {
    const cur = byUnderlying.get(pos.underlying);
    if (!cur || (rank[pos.status] ?? 0) > (rank[cur.status] ?? 0)) byUnderlying.set(pos.underlying, pos);
  }
  return items.map(doc => {
    const item = doc.toObject() as Record<string, unknown>;
    const pos = byUnderlying.get(doc.symbol);
    let automationStatus: string;
    if (!doc.enabled || !doc.automationEnabled) {
      automationStatus = 'DISABLED';
    } else if (pos) {
      automationStatus =
        pos.status === 'OPEN'
          ? 'POSITION_OPEN'
          : pos.status === 'EXITING'
            ? 'EXITING'
            : pos.status === 'MANUAL_REVIEW'
              ? 'MANUAL_REVIEW'
              : pos.filledQty > 0
                ? 'PARTIALLY_FILLED'
                : 'ORDER_SUBMITTED';
    } else {
      automationStatus = String(doc.automationStatus);
    }
    return {
      ...item,
      automationStatus,
      position: pos
        ? {
            optionSymbol: pos.optionSymbol,
            status: pos.status,
            filledQty: pos.filledQty,
            realizedPnl: pos.realizedPnl,
            unrealizedPnl: pos.unrealizedPnl,
          }
        : null,
    } as WatchlistItemView;
  });
}

/** Upsert a symbol. New symbols default to automationEnabled=false (opt-in). */
export async function upsertWatchlistItem(input: WatchlistUpsertInput): Promise<WatchlistItemDocument> {
  const symbol = normalizeSymbol(input.symbol);
  const patch = validatePatch(input);
  const doc = await WatchlistItemModel.findOneAndUpdate(
    { symbol },
    { $set: patch, $setOnInsert: { symbol } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  invalidateAutomationUniverseCache();
  return doc!;
}

/** Patch an existing symbol's automation fields. Throws 404 semantics via null. */
export async function updateWatchlistItem(
  rawSymbol: string,
  input: Partial<WatchlistUpsertInput>
): Promise<WatchlistItemDocument | null> {
  const symbol = normalizeSymbol(rawSymbol);
  const patch = validatePatch(input);
  const doc = await WatchlistItemModel.findOneAndUpdate({ symbol }, { $set: patch }, { new: true });
  if (doc) invalidateAutomationUniverseCache();
  return doc;
}

/** Remove a symbol from the watchlist entirely. */
export async function removeWatchlistItem(rawSymbol: string): Promise<boolean> {
  const symbol = normalizeSymbol(rawSymbol);
  const result = await WatchlistItemModel.deleteOne({ symbol });
  if (result.deletedCount) invalidateAutomationUniverseCache();
  return result.deletedCount > 0;
}

/**
 * The automation universe query: enabled AND automationEnabled symbols, ranked
 * by priority (ascending — lower number = higher priority) then symbol. This is
 * the ONLY query the universe provider uses to build the scheduler's universe.
 */
export async function getAutomationWatchlistItems(): Promise<WatchlistItemDocument[]> {
  return WatchlistItemModel.find({ enabled: true, automationEnabled: true }).sort({ priority: 1, symbol: 1 });
}

/** Telemetry writer — records the last evaluation outcome for the UI. Never gates. */
export async function recordWatchlistEvaluation(
  symbol: string,
  update: {
    at: Date;
    signal?: WatchlistItemDocument['lastSignal'];
    status?: WatchlistItemDocument['automationStatus'];
    traded?: boolean;
  }
): Promise<void> {
  const patch: Record<string, unknown> = { lastEvaluationAt: update.at };
  if (update.signal !== undefined) {
    patch.lastSignal = update.signal;
    patch.lastSignalAt = update.at;
  }
  if (update.status !== undefined) patch.automationStatus = update.status;
  if (update.traded) patch.lastTradeAt = update.at;
  await WatchlistItemModel.updateOne({ symbol: symbol.toUpperCase() }, { $set: patch }).catch(() => undefined);
}

export { ACTIVE_WATCHLIST_STRATEGY };
