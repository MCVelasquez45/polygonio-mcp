import { useAutomationVisibility } from '../../hooks/useAutomationVisibility';
import { CockpitWorkspace } from './CockpitWorkspace';
import { Panel, Pill, selectActiveTrade, statusTone } from './cockpitUi';
import { statusOrReason } from './cockpitDisplay';

function HealthItem({ label, value, healthy }: { label: string; value: string; healthy: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-300">
      <span className={`h-1.5 w-1.5 rounded-full ${healthy ? 'bg-emerald-400' : 'bg-gray-600'}`} />
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-200">{value}</span>
    </span>
  );
}

function titleStatus(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function AutomationHealthStrip({ visibility, connected }: { visibility: ReturnType<typeof useAutomationVisibility>['visibility']; connected: boolean }) {
  const engine = (visibility?.engineStatus ?? {}) as any;
  const automationRaw = statusOrReason(engine.automationState, 'status unavailable');
  const brokerRaw = statusOrReason(engine.broker?.state, 'status unavailable');
  const marketRaw = statusOrReason(engine.market, 'status unavailable');
  const dataRaw = statusOrReason(engine.massive?.state, 'provider status unavailable');
  const visibilityRaw = connected ? 'connected' : 'visibility stream disconnected';

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-gray-900 bg-black/30 px-4 py-2">
      <HealthItem label="Automation" value={titleStatus(automationRaw)} healthy={['RUNNING', 'READY'].includes(automationRaw.toUpperCase())} />
      <HealthItem label="Broker" value={titleStatus(brokerRaw)} healthy={brokerRaw.toUpperCase() === 'CONNECTED'} />
      <HealthItem label="Market" value={titleStatus(marketRaw)} healthy={marketRaw.toUpperCase() === 'OPEN'} />
      <HealthItem label="Data" value={titleStatus(dataRaw)} healthy={['CONNECTED', 'ACTIVE', 'READY'].includes(dataRaw.toUpperCase())} />
      <HealthItem label="Cockpit" value={titleStatus(visibilityRaw)} healthy={connected} />
    </div>
  );
}

/** Detail-pane content when no position is open. */
function IdleCockpit({
  engineState,
  lastOutcome,
  connected,
}: {
  engineState?: string | null;
  lastOutcome?: string | null;
  connected: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 py-16 text-center">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${connected ? 'animate-pulse bg-emerald-400' : 'bg-gray-600'}`} />
        <span className="text-sm uppercase tracking-[0.3em] text-gray-400">
          {engineState ? String(engineState) : 'Standby'} - no active position
        </span>
      </div>
      <p className="max-w-md text-xs text-gray-600">
        No active options position is open. The cockpit will populate when automation opens or reconciles a position.
      </p>
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-widest text-gray-500">Last evaluation</span>
        <Pill tone={statusTone(lastOutcome)}>{lastOutcome ?? 'No evaluation captured'}</Pill>
      </div>
    </div>
  );
}

export function CockpitLayout() {
  const { visibility, connected, error, refresh } = useAutomationVisibility();
  const trade = selectActiveTrade(visibility);
  const engineState = (visibility?.engineStatus as any)?.state ?? (visibility?.engineStatus as any)?.automationState;
  const lastOutcome = visibility?.watchlistEvaluation?.outcome ?? null;
  const buyingPower = Number((visibility?.engineStatus as any)?.broker?.account?.buyingPower) || null;
  const nextEvaluationAt = (visibility?.engineStatus as any)?.scheduler?.nextTick ?? null;
  const sessionId =
    (visibility?.engineStatus as any)?.session?.id ?? trade?.automationSessionId ?? null;

  return (
    <div className="flex h-full min-w-0 flex-col gap-3">
      <AutomationHealthStrip visibility={visibility} connected={connected} />
      <div className="min-w-0">
        {error ? (
          <Panel title="Cockpit">
            <p className="text-sm text-red-300">{error}</p>
          </Panel>
        ) : trade ? (
          <CockpitWorkspace
            trade={trade}
            buyingPower={buyingPower}
            nextEvaluationAt={nextEvaluationAt}
            sessionId={sessionId}
            onActed={() => void refresh()}
          />
        ) : (
          <Panel title="Active Trade" badge={<Pill tone={connected ? 'good' : 'neutral'}>{connected ? 'Ready' : 'Disconnected'}</Pill>}>
            <IdleCockpit engineState={engineState} lastOutcome={lastOutcome} connected={connected} />
          </Panel>
        )}
      </div>
    </div>
  );
}
