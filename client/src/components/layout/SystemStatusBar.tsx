import { memo } from 'react';
import { useSystemStatus } from '../../hooks/useSystemStatus';

// Workspace-level status bar. Each subsystem is an INDEPENDENT domain — no
// shared isOffline/isLive/isConnected boolean collapses them together. The
// options feed can read LIVE while the equity feed reads DELAYED at the same
// time; that's an accurate reflection of the Massive Options Advanced
// entitlement (real-time options, delayed/unauthorized equities), not a
// system failure.

type Tone = 'good' | 'warn' | 'bad' | 'neutral';

const TONE_CLASSES: Record<Tone, string> = {
  good: 'text-intel-pos',
  warn: 'text-intel-warn',
  bad: 'text-intel-neg',
  neutral: 'text-intel-ink3',
};

const TONE_DOT: Record<Tone, string> = {
  good: 'bg-intel-pos',
  warn: 'bg-intel-warn',
  bad: 'bg-intel-neg',
  neutral: 'bg-intel-ink3',
};

function backendTone(status: string): Tone {
  return status === 'ONLINE' ? 'good' : status === 'DEGRADED' ? 'warn' : 'bad';
}
function socketTone(status: string): Tone {
  return status === 'CONNECTED' ? 'good' : status === 'CONNECTING' ? 'warn' : 'bad';
}
function optionsFeedTone(status: string): Tone {
  return status === 'LIVE' ? 'good' : status === 'CONNECTING' ? 'neutral' : 'warn';
}
function equityFeedTone(status: string): Tone {
  if (status === 'REALTIME') return 'good';
  if (status === 'DELAYED' || status === 'SNAPSHOT') return 'warn';
  return 'neutral';
}
function aiTone(status: string): Tone {
  return status === 'ready' ? 'good' : status === 'busy' ? 'warn' : 'bad';
}
function automationTone(status: string): Tone {
  return status === 'RUNNING' ? 'good' : status === 'PAUSED' ? 'warn' : status === 'ERROR' ? 'bad' : 'neutral';
}
function chartTone(tone: ChartTone): Tone {
  return tone === 'live' ? 'good' : tone === 'delayed' || tone === 'snapshot' ? 'warn' : 'neutral';
}

function StatusItem({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]}`} />
      <span className="font-mono text-[9.5px] uppercase tracking-label text-intel-ink3">{label}</span>
      <span className={`font-mono text-[10px] font-semibold uppercase tracking-label ${TONE_CLASSES[tone]}`}>
        {value}
      </span>
    </span>
  );
}

export type ChartTone = 'live' | 'delayed' | 'snapshot' | 'stale';

type Props = {
  chartLabel: string;
  chartStatusTone: ChartTone;
};

export const SystemStatusBar = memo(function SystemStatusBar({ chartLabel, chartStatusTone }: Props) {
  const status = useSystemStatus();

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-intel-line bg-intel-bg px-4 py-1.5"
      role="status"
      aria-label="System status"
    >
      <StatusItem label="Backend" value={status.backend} tone={backendTone(status.backend)} />
      <StatusItem label="Socket.IO" value={status.socket} tone={socketTone(status.socket)} />
      <StatusItem label="Options Feed" value={status.optionsFeed} tone={optionsFeedTone(status.optionsFeed)} />
      <StatusItem label="Equity Feed" value={status.equityFeed} tone={equityFeedTone(status.equityFeed)} />
      <StatusItem label="Chart" value={chartLabel} tone={chartTone(chartStatusTone)} />
      <StatusItem label="AI" value={status.ai === 'ready' ? 'READY' : status.ai === 'busy' ? 'BUSY' : 'ERROR'} tone={aiTone(status.ai)} />
      <StatusItem label="Automation" value={status.automation} tone={automationTone(status.automation)} />
    </div>
  );
});
