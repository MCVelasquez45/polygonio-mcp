// Parses AI Desk agent replies (**Section**: body lines, per the server
// orchestrator contract in server/src/features/assistant/orchestrator/agents.ts)
// into a structured report the card UI can progressively disclose.

export type ReportSection = {
  heading: string;
  body: string[];
  bullets: string[];
};

export type AgentReport = {
  /** True when the reply has enough recognizable sections to render as a card. */
  isReport: boolean;
  summary: string | null;
  confidencePct: number | null;
  confidenceText: string | null;
  stance: 'bullish' | 'bearish' | 'neutral' | null;
  primaryRisk: string | null;
  action: string | null;
  sourcesUsed: string[];
  sourcesUnavailable: string[];
  /** Every parsed section in report order (detail view). */
  sections: ReportSection[];
  /** Lines before the first section marker (free-form preamble). */
  preamble: string[];
};

const SUMMARY_HEADINGS = ['executive summary', 'summary'];
const RISK_HEADINGS = ['risk assessment', 'key risk', 'primary risk'];
const ACTION_HEADINGS = ['action items', 'recommendation', 'suggested action', 'recommended action', 'trading plan'];
const CONFIDENCE_HEADINGS = ['confidence'];
const SOURCES_USED_HEADINGS = ['sources used', 'data sources'];
const SOURCES_UNAVAILABLE_HEADINGS = ['sources unavailable'];
const STANCE_HEADINGS = ['macro bias', 'executive summary', 'recommendation', 'trading thesis', 'signal or noise', 'summary'];

const SECTION_LINE = /^\*\*(.+?)\*\*:?\s*(.*)$/;
const MD_HEADING_LINE = /^#{2,4}\s+(.+?)\s*:?\s*$/;
const BULLET_LINE = /^[-•*]\s+/;

export function parseAgentReport(text: string): AgentReport {
  const sections: ReportSection[] = [];
  const preamble: string[] = [];
  let current: ReportSection | null = null;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const marker = line.match(SECTION_LINE) ?? line.match(MD_HEADING_LINE);
    if (marker) {
      current = { heading: marker[1].replace(/\*+/g, '').trim(), body: [], bullets: [] };
      sections.push(current);
      const rest = (marker[2] ?? '').trim();
      if (rest) current.body.push(rest);
      continue;
    }
    if (!current) {
      preamble.push(line);
      continue;
    }
    if (BULLET_LINE.test(line)) {
      current.bullets.push(line.replace(BULLET_LINE, '').replace(/\*\*/g, '').trim());
    } else {
      current.body.push(line.replace(/\*\*/g, ''));
    }
  }

  const find = (names: string[]) =>
    sections.find(section => names.includes(section.heading.toLowerCase())) ?? null;
  const sectionText = (section: ReportSection | null) => {
    if (!section) return null;
    const joined = [...section.body, ...section.bullets].join(' ').trim();
    return joined || null;
  };
  const firstPoint = (section: ReportSection | null) => {
    if (!section) return null;
    return (section.bullets[0] ?? section.body[0] ?? '').trim() || null;
  };

  const summarySection = find(SUMMARY_HEADINGS);
  const confidenceRaw = sectionText(find(CONFIDENCE_HEADINGS));
  const confidenceMatch = confidenceRaw?.match(/(\d{1,3})\s*(?:%|percent)/i) ?? null;
  let confidencePct = confidenceMatch ? Math.min(100, Number(confidenceMatch[1])) : null;
  if (confidencePct == null && confidenceRaw) {
    const lowered = confidenceRaw.toLowerCase();
    if (lowered.includes('high')) confidencePct = 80;
    else if (lowered.includes('medium') || lowered.includes('moderate')) confidencePct = 60;
    else if (lowered.includes('low')) confidencePct = 35;
  }

  const stanceSource = STANCE_HEADINGS.map(name => sectionText(find([name])))
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  let stance: AgentReport['stance'] = null;
  const bullish = /bullish|long bias|uptrend|accumulate|buy/.test(stanceSource);
  const bearish = /bearish|short bias|downtrend|reduce exposure|sell|exit now/.test(stanceSource);
  if (bullish && !bearish) stance = 'bullish';
  else if (bearish && !bullish) stance = 'bearish';
  else if (stanceSource.includes('neutral') || (bullish && bearish)) stance = 'neutral';

  const listItems = (section: ReportSection | null) => {
    if (!section) return [];
    if (section.bullets.length) return section.bullets;
    const joined = section.body.join(' ');
    return joined
      .split(/[;,]\s+/)
      .map(item => item.trim())
      .filter(Boolean);
  };

  const knownCount = [summarySection, find(RISK_HEADINGS), find(ACTION_HEADINGS), find(CONFIDENCE_HEADINGS)].filter(Boolean).length;

  return {
    isReport: sections.length >= 3 && knownCount >= 2,
    summary: sectionText(summarySection),
    confidencePct,
    confidenceText: confidenceRaw,
    stance,
    primaryRisk: firstPoint(find(RISK_HEADINGS)),
    action: firstPoint(find(ACTION_HEADINGS)),
    sourcesUsed: listItems(find(SOURCES_USED_HEADINGS)),
    sourcesUnavailable: listItems(find(SOURCES_UNAVAILABLE_HEADINGS)),
    sections,
    preamble,
  };
}
