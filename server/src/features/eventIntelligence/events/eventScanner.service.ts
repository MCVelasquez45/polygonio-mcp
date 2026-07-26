import { fetchMassiveEvents } from '../providers/massiveEventProvider.service';
import { processMarketEvent } from './eventProcessor.service';
import { listWatchlist } from '../../watchlist/watchlist.service';

const SCAN_INTERVAL_MS = Math.max(60_000, Number(process.env.EVENT_INTELLIGENCE_SCAN_INTERVAL_MS ?? 180_000));
let timer: NodeJS.Timeout | null = null;
let scanInFlight: Promise<void> | null = null;

export async function runEventIntelligenceScan(): Promise<void> {
  if (scanInFlight) return scanInFlight;
  scanInFlight = (async () => {
    const watchlist = await listWatchlist().catch(() => []);
    const symbols = watchlist.length ? watchlist.filter(item => item.enabled).map(item => item.symbol) : undefined;
    const events = await fetchMassiveEvents({ symbols, limit: 20 });
    await Promise.all(events.slice(0, 50).map(event => processMarketEvent(event, {
      persist: true,
      triggerDecisionEngine: true,
    }).catch(error => {
      console.warn('[event-intelligence] event processing failed', { eventId: event.id, error: (error as Error)?.message });
    })));
  })();
  try {
    await scanInFlight;
  } finally {
    scanInFlight = null;
  }
}

export function startEventIntelligenceScanner(): void {
  if (timer || process.env.EVENT_INTELLIGENCE_AUTO_START !== 'true') return;
  timer = setInterval(() => {
    runEventIntelligenceScan().catch(error => {
      console.warn('[event-intelligence] scan failed', { error: (error as Error)?.message });
    });
  }, SCAN_INTERVAL_MS);
}

export function stopEventIntelligenceScanner(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
