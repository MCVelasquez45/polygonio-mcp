import { useEffect, useState } from 'react';
import { RadioTower } from 'lucide-react';
import { getEventIntelligenceContext, type EventIntelligenceRecord, type EventMarketContext } from '../../api/eventIntelligence';
import { fmtNumber, fmtPercent } from '../../lib/marketFormat';
import { Panel, Pill, Stat } from './cockpitUi';

function toneForSentiment(label: string): 'good' | 'bad' | 'neutral' | 'warn' {
  if (label === 'bullish') return 'good';
  if (label === 'bearish') return 'bad';
  if (label === 'neutral') return 'neutral';
  return 'warn';
}

function EventRow({ record }: { record: EventIntelligenceRecord }) {
  return (
    <tr className="border-t border-intel-lineSoft">
      <td className="py-1 pr-2">
        <div className="font-medium text-intel-ink">{record.event.title}</div>
        <div className="mt-0.5 flex flex-wrap gap-1 text-[11px] text-intel-ink3">
          <span>{record.event.category}</span>
          <span>{new Date(record.event.timestamp).toLocaleTimeString([], { hour12: false })}</span>
        </div>
      </td>
      <td className="py-1 text-right tabular-nums text-intel-ink2">{record.event.importance.toFixed(1)}</td>
      <td className="py-1 text-right tabular-nums text-intel-ink2">{fmtPercent(record.event.confidence * 100)}</td>
      <td className="py-1 pl-2"><Pill tone={toneForSentiment(record.event.sentiment.label)}>{record.event.sentiment.label}</Pill></td>
      <td className="py-1 pl-2 text-[11px] text-intel-ink3">{record.impact.affectedSymbols.slice(0, 6).join(', ') || 'None'}</td>
      <td className="py-1 pl-2 text-[11px] text-intel-ink3">{record.impact.affectedEtfs.slice(0, 5).join(', ') || 'None'}</td>
      <td className="py-1 pl-2"><Pill tone={record.decisionTrigger.triggered ? 'good' : 'neutral'}>{record.decisionTrigger.status}</Pill></td>
    </tr>
  );
}

export function EventIntelligencePanel() {
  const [context, setContext] = useState<EventMarketContext | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    getEventIntelligenceContext()
      .then(result => {
        if (!active) return;
        setContext(result);
        setStatus(result ? 'ready' : 'empty');
      })
      .catch(() => {
        if (!active) return;
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, []);

  const events = context?.highImportanceEvents ?? [];
  return (
    <Panel title="Event intelligence" badge={<RadioTower className="h-4 w-4 text-intel-ink3" aria-hidden="true" />}>
      {status === 'loading' ? <p className="text-xs text-intel-ink3">Loading market events.</p> : null}
      {status === 'error' ? <p className="text-xs text-intel-ink3">Event intelligence unavailable.</p> : null}
      {status === 'empty' ? <p className="text-xs text-intel-ink3">No event context has been journaled yet.</p> : null}
      {status === 'ready' && context ? (
        <div className="flex min-w-0 flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Breaking events" value={events.length} tone={events.length ? 'good' : 'muted'} />
            <Stat label="Symbols" value={fmtNumber(context.affectedSymbols.length)} />
            <Stat label="ETFs" value={fmtNumber(context.affectedEtfs.length)} />
            <Stat label="Sectors" value={fmtNumber(context.affectedSectors.length)} />
            <Stat label="Decision trigger" value={context.latestTrigger?.status ?? 'None'} size="sm" />
          </div>
          {events.length ? (
            <div className="overflow-x-auto border-t border-intel-line pt-3">
              <table className="min-w-[860px] w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-widest text-intel-ink3">
                    <th className="py-1 pr-2 text-left font-normal">Event timeline</th>
                    <th className="py-1 text-right font-normal">Importance</th>
                    <th className="py-1 text-right font-normal">Confidence</th>
                    <th className="py-1 pl-2 text-left font-normal">Sentiment</th>
                    <th className="py-1 pl-2 text-left font-normal">Symbols</th>
                    <th className="py-1 pl-2 text-left font-normal">ETFs</th>
                    <th className="py-1 pl-2 text-left font-normal">Trigger</th>
                  </tr>
                </thead>
                <tbody>{events.slice(0, 8).map(record => <EventRow key={record.event.id} record={record} />)}</tbody>
              </table>
            </div>
          ) : (
            <p className="border-t border-intel-line pt-3 text-xs text-intel-ink3">No high-importance events are currently active.</p>
          )}
        </div>
      ) : null}
    </Panel>
  );
}
