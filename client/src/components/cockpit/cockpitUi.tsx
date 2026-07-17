import type { ReactNode } from 'react';
import type { AutomationVisibility } from '../../api/portfolio';
import type { QuoteFreshness } from '../../lib/marketFormat';

// Shared presentational primitives for the operator cockpit. Dark-theme tokens
// keep this surface aligned with the rest of the trading workstation.

/**
 * The server's activeTrades entries are `any` on the wire; this is the shape the
 * cockpit actually reads. Fields land across milestones, so each panel handles
 * missing data with a source-specific explanation rather than a placeholder.
 */
export type CockpitTrade = {
  positionId: string;
  underlying: string;
  optionSymbol: string;
  direction?: 'BULLISH' | 'BEARISH' | string | null;
  contracts?: number | null;
  orderedQuantity?: number | null;
  filledQty?: number | null;
  entryPrice?: number | null;
  currentMark?: number | null;
  currentBid?: number | null;
  currentAsk?: number | null;
  currentMid?: number | null;
  currentSpreadPct?: number | null;
  unrealizedPnl?: number | null;
  unrealizedPnlPct?: number | null;
  mfe?: number | null;
  mae?: number | null;
  stopPrice?: number | null;
  targetPrice?: number | null;
  trailingStop?: boolean;
  brokerStatus?: string | null;
  lifecycleStatus?: string | null;
  exitReason?: string | null;
  daysToExpiration?: number | null;
  entryTime?: string | null;
  filledTime?: string | null;
  lastQuoteTimestamp?: string | null;
  lastUpdateTimestamp?: string | null;
  quoteAgeMs?: number | null;
  quoteFresh?: boolean | null;
  brokerOrderIds?: { entry: string | null; exit: string | null };
  clientOrderIds?: { entry: string | null; exit: string | null };
  intentId?: string | null;
  exitIntentId?: string | null;
  automationSessionId?: string | null;
  exitTriggers?: ExitTrigger[];
  holdRationale?: HoldCheck[];
  execution?: {
    entry: OrderCardData | null;
    exit: OrderCardData | null;
    maxExitRetries?: number | null;
  };
  opportunity?: OpportunityData;
  marketContext?: MarketContextData;
};

export type OpportunityCandidate = {
  symbol: string;
  passed: boolean;
  score: number | null;
  delta: number | null;
  spreadPct: number | null;
  openInterest: number | null;
  rejectionReasons: string[];
  selected: boolean;
};

export type OpportunityData = {
  strategy: string | null;
  direction: string | null;
  signalConfidence: number | null; // 0..1
  selectedContractSymbol: string | null;
  selectedContractScore: number | null;
  consideredCount: number | null;
  passedCount: number | null;
  noSelectionReason: string | null;
  candidates: OpportunityCandidate[];
  flow: {
    netPremiumTilt: number | null;
    volumeRatio: number | null;
    callPremium: number | null;
    putPremium: number | null;
    ivSkew: number | null;
  };
};

export type MarketContextData = {
  trend: 'UP' | 'DOWN' | 'FLAT' | null;
  relativeVolume: number | null;
  flowScore: number | null;
  regime: string | null;
  underlyingDelayed: boolean;
};

export type OrderStatusEvent = {
  at: string | null;
  status: string | null;
  rawStatus: string | null;
  source: string | null;
};

export type OrderCardData = {
  role: 'ENTRY' | 'EXIT';
  status: string | null;
  rawStatus: string | null;
  intentStatus: string | null;
  orderType: string | null;
  limitPrice: number | null;
  timeInForce: string | null;
  qty: number | null;
  filledQty: number | null;
  remainingQty: number | null;
  avgFillPrice: number | null;
  attemptCount: number | null;
  brokerOrderId: string | null;
  clientOrderId: string | null;
  submittedAt: string | null;
  updatedAt: string | null;
  timeoutMs: number | null;
  timeoutDeadline: string | null;
  statusHistory: OrderStatusEvent[];
};

export type ExitTrigger = {
  key: string;
  label: string;
  kind: 'below' | 'above' | 'trailing' | 'time' | 'monitor';
  triggerPrice: number | null;
  triggerAt?: string | null;
  armed: boolean;
};

export type HoldCheck = {
  key: string;
  label: string;
  ok: boolean | null;
};

/** The single position the cockpit focuses on (max 1 concurrent by design). */
export function selectActiveTrade(
  visibility: AutomationVisibility | null,
  positionId?: string | null
): CockpitTrade | null {
  const trades = (visibility?.activeTrades ?? []) as CockpitTrade[];
  if (!trades.length) return null;
  if (positionId) return trades.find((t) => t.positionId === positionId) ?? trades[0];
  return trades[0];
}

export function Panel({
  title,
  badge,
  actions,
  children,
  className = '',
}: {
  title: string;
  badge?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-gray-900 bg-gray-950 p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.28em] text-gray-500">{title}</h3>
          {badge}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  tone = 'neutral',
  size = 'md',
  sub,
}: {
  label: string;
  value: ReactNode;
  tone?: 'neutral' | 'good' | 'bad' | 'muted';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  sub?: ReactNode;
}) {
  const toneClass =
    tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : tone === 'muted' ? 'text-gray-500' : 'text-white';
  const sizeClass =
    size === 'xl' ? 'text-3xl' : size === 'lg' ? 'text-xl' : size === 'sm' ? 'text-xs' : 'text-sm';
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-widest text-gray-500">{label}</span>
      <span className={`font-semibold tabular-nums ${sizeClass} ${toneClass}`}>{value}</span>
      {sub ? <span className="text-[11px] text-gray-500 tabular-nums">{sub}</span> : null}
    </div>
  );
}

const PILL_TONES: Record<string, string> = {
  good: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  warn: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  bad: 'border-red-500/40 bg-red-500/10 text-red-300',
  neutral: 'border-gray-800 bg-gray-900/70 text-gray-300',
};

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'good' | 'warn' | 'bad' | 'neutral';
}) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${PILL_TONES[tone]}`}>
      {children}
    </span>
  );
}

/** Maps a status string to a pill tone using the same vocabulary as the command center. */
export function statusTone(value?: string | null): 'good' | 'warn' | 'bad' | 'neutral' {
  const v = String(value ?? '').toUpperCase();
  if (['FILLED', 'OPEN', 'RUNNING', 'READY', 'CLEAN', 'ACCEPTED', 'ACTIVE', 'CONNECTED'].includes(v)) return 'good';
  if (['PENDING_NEW', 'PARTIALLY_FILLED', 'SUBMITTING', 'PENDING_ENTRY', 'EXITING', 'PAUSED', 'CANCEL_PENDING', 'WORKING'].includes(v))
    return 'warn';
  if (['REJECTED', 'CANCELLED', 'EXPIRED', 'MANUAL_REVIEW', 'RECOVERY_FAILED', 'STOPPED', 'ERROR', 'DISCONNECTED'].includes(v))
    return 'bad';
  return 'neutral';
}

/** Small colored dot for quote freshness. */
export function FreshnessDot({ freshness }: { freshness: QuoteFreshness }) {
  const cls =
    freshness === 'FRESH'
      ? 'bg-emerald-400'
      : freshness === 'STALE'
        ? 'bg-amber-400'
        : 'bg-gray-600';
  const label = freshness === 'FRESH' ? 'Live' : freshness === 'STALE' ? 'Stale' : 'Provider unavailable';
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
      <span className={`h-1.5 w-1.5 rounded-full ${freshness === 'FRESH' ? 'animate-pulse' : ''} ${cls}`} />
      {label}
    </span>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'warn' | 'bad' | 'neutral' }) {
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-widest ${PILL_TONES[tone]}`}>
      {children}
    </span>
  );
}

/** Broker order statuses that are terminal (no further action possible). */
export const BROKER_TERMINAL = new Set(['FILLED', 'CANCELLED', 'EXPIRED', 'REJECTED', 'REPLACED']);
