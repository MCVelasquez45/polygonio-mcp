import type { LucideIcon } from 'lucide-react';
import {
  Briefcase,
  Crosshair,
  DoorOpen,
  Gavel,
  Landmark,
  LineChart,
  Lightbulb,
  MessageSquare,
  Newspaper,
  ShieldAlert,
  Zap,
} from 'lucide-react';

// Visual identity for each desk agent. Hues are report identities (who wrote
// this), deliberately distinct from the semantic P/L channels — they are
// applied as inline accent colors, never as chrome.
export type AgentMeta = {
  id: string;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  /** Accent hex — icon, confidence bar, section headings. */
  color: string;
  /** Translucent tint for chips and card headers. */
  soft: string;
  /** Border tint. */
  line: string;
};

function identity(id: string, label: string, shortLabel: string, icon: LucideIcon, rgb: [number, number, number]): AgentMeta {
  const [r, g, b] = rgb;
  return {
    id,
    label,
    shortLabel,
    icon,
    color: `rgb(${r},${g},${b})`,
    soft: `rgba(${r},${g},${b},0.12)`,
    line: `rgba(${r},${g},${b},0.38)`,
  };
}

export const AGENT_META: Record<string, AgentMeta> = {
  'technical-analyst': identity('technical-analyst', 'Technical Analyst', 'Technical', LineChart, [106, 165, 245]), // blue
  'options-risk-analyst': identity('options-risk-analyst', 'Options Risk', 'Risk', ShieldAlert, [249, 146, 69]), // orange
  'fed-intel': identity('fed-intel', 'Fed Intelligence', 'Fed', Landmark, [169, 139, 245]), // purple
  'congressional-intel': identity('congressional-intel', 'Congress Intelligence', 'Congress', Gavel, [53, 210, 154]), // green
  'trade-thesis': identity('trade-thesis', 'Trade Thesis', 'Thesis', Lightbulb, [245, 200, 66]), // gold
  'exit-strategy': identity('exit-strategy', 'Exit Strategy', 'Exit', DoorOpen, [248, 113, 113]), // red
  'portfolio-risk': identity('portfolio-risk', 'Portfolio Risk', 'Portfolio', Briefcase, [147, 163, 186]), // gray
  'smart-entry': identity('smart-entry', 'Smart Entry', 'Entry', Crosshair, [52, 201, 223]), // cyan
  'market-catalyst': identity('market-catalyst', 'Market Catalyst', 'Catalyst', Zap, [251, 191, 36]), // amber
  'market-recap': identity('market-recap', 'Market Recap', 'Daily', Newspaper, [148, 199, 220]), // slate-blue
};

export const DEFAULT_AGENT_META: AgentMeta = identity('desk', 'Desk Analysis', 'Desk', MessageSquare, [169, 139, 245]);

export function getAgentMeta(agentId?: string | null): AgentMeta {
  if (agentId && AGENT_META[agentId]) return AGENT_META[agentId];
  return DEFAULT_AGENT_META;
}

/** Resolve an agent id from its display label ("Fed Intelligence report — SPY"). */
export function agentIdFromText(text: string): string | null {
  const lowered = text.toLowerCase();
  for (const meta of Object.values(AGENT_META)) {
    if (lowered.startsWith(meta.label.toLowerCase())) return meta.id;
  }
  return null;
}
