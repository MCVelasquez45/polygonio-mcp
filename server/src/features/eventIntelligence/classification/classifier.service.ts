import type { EventCategory, EventSentimentLabel, NormalizedMarketEvent } from '../types/eventTypes';

const CATEGORY_RULES: Array<{ category: EventCategory; patterns: RegExp[]; sectors?: string[] }> = [
  { category: 'Federal Reserve', patterns: [/federal reserve/i, /\bfed\b/i, /fomc/i, /powell/i] },
  { category: 'Economic', patterns: [/inflation/i, /cpi\b/i, /ppi\b/i, /payroll/i, /unemployment/i, /treasury yield/i, /gdp/i] },
  { category: 'Earnings', patterns: [/earnings/i, /eps\b/i, /revenue/i, /quarterly results/i] },
  { category: 'Guidance', patterns: [/guidance/i, /outlook/i, /forecast/i] },
  { category: 'Merger', patterns: [/merger/i, /merge/i] },
  { category: 'Acquisition', patterns: [/acqui[rs]/i, /takeover/i, /buyout/i] },
  { category: 'SEC Filing', patterns: [/\bsec\b/i, /\b10-k\b/i, /\b10-q\b/i, /\b8-k\b/i, /filing/i] },
  { category: 'Insider Activity', patterns: [/insider/i, /form 4/i] },
  { category: 'Analyst Upgrade', patterns: [/upgrade/i, /raises rating/i, /price target raised/i] },
  { category: 'Analyst Downgrade', patterns: [/downgrade/i, /cuts rating/i, /price target cut/i] },
  { category: 'Product Launch', patterns: [/launch/i, /unveils/i, /introduces/i] },
  { category: 'Supply Chain', patterns: [/supply chain/i, /shortage/i, /supplier/i, /logistics/i] },
  { category: 'Commodity', patterns: [/commodity/i, /gold/i, /copper/i, /wheat/i] },
  { category: 'Oil', patterns: [/\boil\b/i, /crude/i, /opec/i, /ceasefire/i], sectors: ['Energy'] },
  { category: 'Natural Disaster', patterns: [/hurricane/i, /earthquake/i, /wildfire/i, /flood/i] },
  { category: 'Cybersecurity', patterns: [/cyber/i, /hack/i, /ransomware/i, /breach/i] },
  { category: 'Government Policy', patterns: [/government/i, /policy/i, /regulation/i, /white house/i] },
  { category: 'Tariffs', patterns: [/tariff/i, /trade war/i, /import duty/i] },
  { category: 'Litigation', patterns: [/lawsuit/i, /litigation/i, /settlement/i, /court/i] },
  { category: 'AI', patterns: [/\bai\b/i, /artificial intelligence/i, /gpu/i], sectors: ['Technology'] },
  { category: 'Technology', patterns: [/software/i, /semiconductor/i, /cloud/i, /chip/i], sectors: ['Technology'] },
  { category: 'Healthcare', patterns: [/fda/i, /drug/i, /clinical/i, /healthcare/i, /biotech/i], sectors: ['Healthcare'] },
  { category: 'Financial', patterns: [/bank/i, /credit/i, /loan/i, /financial/i], sectors: ['Financial'] },
  { category: 'Energy', patterns: [/energy/i, /solar/i, /natural gas/i], sectors: ['Energy'] },
  { category: 'Transportation', patterns: [/airline/i, /rail/i, /shipping/i, /transport/i], sectors: ['Transportation'] },
  { category: 'Consumer', patterns: [/consumer/i, /retail/i, /restaurant/i], sectors: ['Consumer'] },
  { category: 'Geopolitical', patterns: [/war/i, /iran/i, /russia/i, /china/i, /ceasefire/i, /sanction/i] },
];

const SECTOR_BY_SYMBOL: Record<string, string> = {
  XLE: 'Energy',
  CVX: 'Energy',
  XOM: 'Energy',
  OXY: 'Energy',
  USO: 'Energy',
  XLK: 'Technology',
  NVDA: 'Technology',
  AMD: 'Technology',
  MSFT: 'Technology',
  AAPL: 'Technology',
  XLF: 'Financial',
  JPM: 'Financial',
  BAC: 'Financial',
  XLV: 'Healthcare',
  UNH: 'Healthcare',
  XLY: 'Consumer',
  XLP: 'Consumer',
  XLI: 'Transportation',
};

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean).map(value => value.trim()).filter(Boolean))].sort();
}

export function classifyEventText(title: string, summary: string | null = null): { category: EventCategory; sectors: string[]; confidence: number } {
  const text = `${title} ${summary ?? ''}`;
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some(pattern => pattern.test(text))) {
      return { category: rule.category, sectors: rule.sectors ?? [], confidence: 0.85 };
    }
  }
  return { category: 'News', sectors: [], confidence: 0.55 };
}

export function inferSentiment(value: unknown, title = '', summary: string | null = null): NormalizedMarketEvent['sentiment'] {
  const raw = String(value ?? '').toLowerCase();
  const text = `${title} ${summary ?? ''}`.toLowerCase();
  let label: EventSentimentLabel = 'unknown';
  let score: number | null = null;
  if (raw.includes('positive') || raw.includes('bullish')) {
    label = 'bullish';
    score = 0.65;
  } else if (raw.includes('negative') || raw.includes('bearish')) {
    label = 'bearish';
    score = -0.65;
  } else if (raw.includes('neutral')) {
    label = 'neutral';
    score = 0;
  } else if (/(beats|raises|approval|ceasefire|upgrade|record)/i.test(text)) {
    label = 'bullish';
    score = 0.45;
  } else if (/(misses|cuts|downgrade|lawsuit|breach|war|tariff|shortage)/i.test(text)) {
    label = 'bearish';
    score = -0.45;
  }
  return { label, score, explanation: label === 'unknown' ? 'No supplied or keyword sentiment was available.' : 'Sentiment derived from supplied provider signal or event text.' };
}

export function enrichEventClassification(event: NormalizedMarketEvent): NormalizedMarketEvent {
  const classified = classifyEventText(event.title, event.summary);
  const symbolSectors = event.symbols.map(symbol => SECTOR_BY_SYMBOL[symbol.toUpperCase()]).filter(Boolean);
  return {
    ...event,
    category: event.category === 'News' ? classified.category : event.category,
    sectors: uniq([...event.sectors, ...classified.sectors, ...symbolSectors]),
    confidence: Math.max(event.confidence, classified.confidence),
  };
}

export { SECTOR_BY_SYMBOL };
