import { fmtSignedPercent, finiteOrNull } from '../../lib/marketFormat';
import { Panel, Pill, type CockpitTrade, type ExitTrigger } from './cockpitUi';
import { moneyOrReason } from './cockpitDisplay';

/** Within this percent of a priced trigger, the rule reads as APPROACHING. */
const APPROACH_PCT = 8;
/** Fill the proximity bar over this window (further out reads as "safe"). */
const PROXIMITY_WINDOW_PCT = 30;

type Evaluated = {
  state: 'TRIGGERED' | 'APPROACHING' | 'ARMED' | 'OFF';
  distancePct: number | null;
  proximity: number; // 0 = far, 1 = at trigger
};

function evaluate(trigger: ExitTrigger, mark: number | null): Evaluated {
  if (!trigger.armed) return { state: 'OFF', distancePct: null, proximity: 0 };
  if (trigger.kind === 'monitor' || trigger.kind === 'trailing' || trigger.kind === 'time') {
    return { state: 'ARMED', distancePct: null, proximity: 0 };
  }
  const trig = finiteOrNull(trigger.triggerPrice);
  if (trig === null || mark === null || mark <= 0) return { state: 'ARMED', distancePct: null, proximity: 0 };

  const crossed = trigger.kind === 'below' ? mark <= trig : mark >= trig;
  const distancePct = (Math.abs(mark - trig) / mark) * 100;
  const proximity = Math.max(0, Math.min(1, 1 - distancePct / PROXIMITY_WINDOW_PCT));
  if (crossed) return { state: 'TRIGGERED', distancePct: 0, proximity: 1 };
  if (distancePct <= APPROACH_PCT) return { state: 'APPROACHING', distancePct, proximity };
  return { state: 'ARMED', distancePct, proximity };
}

function stateTone(state: Evaluated['state']): 'good' | 'warn' | 'bad' | 'neutral' {
  if (state === 'TRIGGERED') return 'bad';
  if (state === 'APPROACHING') return 'warn';
  if (state === 'ARMED') return 'good';
  return 'neutral';
}

function ProximityBar({ proximity, state }: { proximity: number; state: Evaluated['state'] }) {
  const color = state === 'TRIGGERED' ? 'bg-red-500' : state === 'APPROACHING' ? 'bg-amber-400' : 'bg-emerald-500';
  return (
    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-gray-800">
      <div className={`h-full transition-all duration-500 ${color}`} style={{ width: `${Math.round(proximity * 100)}%` }} />
    </div>
  );
}

function TriggerRow({ trigger, mark }: { trigger: ExitTrigger; mark: number | null }) {
  const evald = evaluate(trigger, mark);
  const label =
    trigger.kind === 'trailing'
      ? trigger.armed
        ? 'ON'
        : 'OFF'
      : trigger.kind === 'time' && trigger.triggerAt
        ? new Date(trigger.triggerAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
        : evald.state;
  const priced = trigger.kind === 'below' || trigger.kind === 'above';
  return (
    <div className="border-b border-gray-900/60 py-2 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-gray-200">{trigger.label}</span>
        <Pill tone={trigger.kind === 'trailing' && !trigger.armed ? 'neutral' : stateTone(evald.state)}>{label}</Pill>
      </div>
      {priced && trigger.armed ? (
        <>
          <div className="mt-0.5 flex items-center justify-between text-[11px] tabular-nums text-gray-500">
            <span>Trigger {moneyOrReason(trigger.triggerPrice, 'Trigger price not captured')}</span>
            <span>{evald.distancePct === null ? 'Distance unavailable' : fmtSignedPercent(trigger.kind === 'below' ? -evald.distancePct : evald.distancePct)}</span>
          </div>
          <ProximityBar proximity={evald.proximity} state={evald.state} />
        </>
      ) : null}
    </div>
  );
}

/**
 * Current exit strategy - replaces the blank exit reason while open. Shows every
 * active trigger, its live distance from the streamed mark, and a proximity bar
 * that escalates as the mark nears a stop/target.
 */
export function ExitIntelligencePanel({ trade, mark }: { trade: CockpitTrade; mark: number | null }) {
  const triggers = trade.exitTriggers ?? [];
  return (
    <Panel title="Exit Intelligence">
      {triggers.length === 0 ? (
        <p className="text-xs text-gray-600">Exit policy was not captured for this position.</p>
      ) : (
        <div>
          {triggers.map((t) => (
            <TriggerRow key={t.key} trigger={t} mark={mark} />
          ))}
        </div>
      )}
    </Panel>
  );
}

/** Exposed for Bot Thinking's "exit imminent" cue. */
export function anyExitApproaching(trade: CockpitTrade, mark: number | null): boolean {
  return (trade.exitTriggers ?? []).some((t) => {
    const e = evaluate(t, mark);
    return e.state === 'APPROACHING' || e.state === 'TRIGGERED';
  });
}
