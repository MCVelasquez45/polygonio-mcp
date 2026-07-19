import { useNow } from '../../hooks/useNow';
import { Panel, type CockpitTrade, type HoldCheck } from './cockpitUi';
import { anyExitApproaching } from './ExitIntelligencePanel';

function rationaleLabel(check: HoldCheck): string {
  const label = check.label.trim();
  if (/^no emergency stop$/i.test(label)) return check.ok === false ? 'Emergency stop active' : 'Emergency stop inactive';
  if (/^stop not hit$/i.test(label)) return check.ok === false ? 'Stop hit' : 'Stop not hit';
  if (/^profit target not reached$/i.test(label)) return check.ok === false ? 'Profit target reached' : 'Profit target not reached';
  if (/^not in close-out window$/i.test(label)) return check.ok === false ? 'Close-out window active' : 'Not in close-out window';
  if (/broker reconciled/i.test(label)) return check.ok === false ? 'Broker not reconciled' : 'Broker reconciled';
  return label;
}

function CheckRow({ check }: { check: HoldCheck }) {
  const mark = check.ok;
  const glyph = mark === null ? '?' : mark ? '✓' : '!';
  const tone = mark === null ? 'text-intel-ink3' : mark ? 'text-intel-pos' : 'text-intel-neg';
  return (
    <li className="flex items-center gap-2 py-1 text-sm">
      <span className={`w-4 text-center ${tone}`}>{glyph}</span>
      <span className={mark === false ? 'text-intel-neg' : 'text-intel-ink2'}>
        {rationaleLabel(check)}
        {mark === null ? <span className="ml-1 text-[11px] text-intel-ink3">(not evaluated in latest snapshot)</span> : null}
      </span>
    </li>
  );
}

function Countdown({ nextEvaluationAt }: { nextEvaluationAt: string | null }) {
  const now = useNow(1000);
  if (!nextEvaluationAt) return <span className="tabular-nums text-intel-ink3">Next decision check not scheduled</span>;
  const ms = Date.parse(nextEvaluationAt) - now;
  if (!Number.isFinite(ms)) return <span className="tabular-nums text-intel-ink3">Next decision check unavailable</span>;
  const secs = Math.max(0, Math.round(ms / 1000));
  return <span className="tabular-nums text-intel-ink">{secs === 0 ? 'due now' : `in ${secs}s`}</span>;
}

/**
 * The automation's reasoning: WHY the bot is still holding. Renders the engine's
 * real evaluated conditions (never fabricated), flags when an exit is imminent so
 * the operator sees pressure building, and shows the next decision-check countdown.
 * Rendered as a section inside the shared "Automation Thinking" panel.
 */
export function BotThinkingSection({
  trade,
  nextEvaluationAt,
  mark,
}: {
  trade: CockpitTrade;
  nextEvaluationAt: string | null;
  mark: number | null;
}) {
  const checks = trade.holdRationale ?? [];
  const imminent = anyExitApproaching(trade, mark);

  return (
    <div>
      {imminent ? (
        <div className="mb-2 rounded-md border border-intel-warn/40 bg-intel-warn/10 px-2 py-1 text-[11px] text-intel-warn">
          Exit condition approaching. See Exit Intelligence.
        </div>
      ) : null}
      <p className="mb-1 text-[11px] uppercase tracking-widest text-intel-ink3">Holding because</p>
      {checks.length === 0 ? (
        <p className="text-xs text-intel-ink3">Hold rationale was not captured in the latest automation snapshot.</p>
      ) : (
        <ul>
          {checks.map((c) => (
            <CheckRow key={c.key} check={c} />
          ))}
        </ul>
      )}
      <div className="mt-3 flex items-center justify-between border-t border-intel-line pt-3 text-xs">
        <span className="uppercase tracking-widest text-intel-ink3">Next decision check</span>
        <Countdown nextEvaluationAt={nextEvaluationAt} />
      </div>
    </div>
  );
}

/**
 * Standalone panel wrapper retained for backward compatibility (tests and any
 * direct callers). The cockpit workspace renders {@link BotThinkingSection}
 * inside the merged "Automation Thinking" panel instead.
 */
export function BotThinkingPanel(props: {
  trade: CockpitTrade;
  nextEvaluationAt: string | null;
  mark: number | null;
}) {
  return (
    <Panel title="Automation Thinking">
      <BotThinkingSection {...props} />
    </Panel>
  );
}
