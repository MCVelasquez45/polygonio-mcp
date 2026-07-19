import { DatabaseZap } from 'lucide-react';
import { ConnectionBadge, MarketDataBadge } from './ui';
import { fmtQuoteAge } from '../../lib/marketDataStatus';
import type { LiveConnectionPhase } from '../../hooks/useLiveConnection';

// A single honest summary of where market data is coming from right now. Every
// line reflects real state: the option stream's socket phase, the equity
// snapshot channel (REST by entitlement — never LIVE), the provider, the broker
// link, and the wall-clock age of the last quote the live feed delivered.

function StreamState({ phase }: { phase: LiveConnectionPhase }) {
  if (phase === 'connected') return <ConnectionBadge connected label="Streams" />;
  if (phase === 'reconnecting' || phase === 'connecting') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-intel-warn/40 px-2.5 py-1 font-mono text-[11px] tracking-wide text-intel-warn">
        <span className="h-1.5 w-1.5 rounded-full bg-intel-warn" aria-hidden="true" />
        Streams · {phase === 'reconnecting' ? 'Reconnecting' : 'Connecting'}
      </span>
    );
  }
  return <ConnectionBadge connected={false} label="Streams" />;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-intel-lineSoft py-1.5 last:border-b-0">
      <span className="font-mono text-[10px] uppercase tracking-label text-intel-ink3">{label}</span>
      <span className="text-sm text-intel-ink2">{children}</span>
    </div>
  );
}

export function MarketDataHealthCard({
  phase,
  brokerConnected,
  provider,
  lastQuoteAt,
  nowMs,
  className = '',
}: {
  phase: LiveConnectionPhase;
  brokerConnected: boolean | null;
  provider: string;
  lastQuoteAt: number | null;
  nowMs: number;
  className?: string;
}) {
  const lastQuoteLabel =
    lastQuoteAt != null ? fmtQuoteAge(nowMs - lastQuoteAt) ?? 'just now' : 'No quotes yet';
  return (
    <div className={`rounded-panel border border-intel-line bg-intel-panel p-4 ${className}`}>
      <div className="mb-3 flex items-center gap-2">
        <DatabaseZap className="h-4 w-4 text-intel-accent" aria-hidden="true" />
        <span className="text-sm font-semibold text-intel-ink">Market Data Health</span>
      </div>
      <Row label="Live option streams">
        <StreamState phase={phase} />
      </Row>
      <Row label="Equity snapshots">
        {/* Equities are REST by entitlement on this plan — honestly SNAPSHOT. */}
        <MarketDataBadge status="SNAPSHOT" />
      </Row>
      <Row label="Provider">
        <span className="font-mono text-[12px] text-intel-ink">{provider}</span>
      </Row>
      <Row label="Broker">
        <ConnectionBadge connected={brokerConnected} label="Broker" />
      </Row>
      <Row label="Last successful quote">
        <span className="font-mono text-[12px] tabular-nums text-intel-ink">{lastQuoteLabel}</span>
      </Row>
    </div>
  );
}
