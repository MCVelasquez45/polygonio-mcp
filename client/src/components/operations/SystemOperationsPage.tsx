import { getApiBaseUrl } from '../../api/http';
import { DataHealthPanel } from '../dashboard/DataHealthPanel';
import { EngineRoomDashboard } from '../engine';
import { AutomationCommandCenter } from '../portfolio/AutomationCommandCenter';
import { PageHeader, SectionHeader } from '../intelligence/ui';

type Props = {
  apiBase?: string;
};

export function SystemOperationsPage({ apiBase = getApiBaseUrl() }: Props) {
  return (
    <div className="flex flex-col gap-4 pb-24" data-testid="system-operations-workspace">
      <PageHeader
        eyebrow="System Operations"
        title="Platform Health"
        description="Scheduler, provider, broker, queue, cache, worker, timeline, and diagnostic telemetry live here so trading and portfolio workspaces stay operator-focused."
      />

      <section className="flex flex-col gap-3">
        <SectionHeader title="Automation Control Plane" />
        <AutomationCommandCenter />
      </section>

      <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
        <section className="flex min-w-0 flex-col gap-3">
          <SectionHeader title="Provider And API Health" />
          <DataHealthPanel apiBase={apiBase} />
        </section>

        <section className="flex min-w-0 flex-col gap-3">
          <SectionHeader title="Futures Engine Room" />
          <EngineRoomDashboard />
        </section>
      </div>
    </div>
  );
}
