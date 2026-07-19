import type { ReactNode } from 'react';
import { Bot, BrainCircuit, LineChart, Layers, ServerCog } from 'lucide-react';

// The approved 4-mode operating model. Internal view ids are unchanged
// ('trading' | 'portfolio' | 'cockpit' | 'intelligence' | 'operations') so
// every existing consumer keeps working — only the operator-facing label,
// icon, and grouping move to the terminal vocabulary.

export type AppView = 'trading' | 'portfolio' | 'cockpit' | 'intelligence' | 'operations';

export type NavMode = {
  id: AppView;
  label: string;
  hint: string;
  icon: ReactNode;
};

/** Primary operating modes — the desk a trader lives in. */
export const PRIMARY_MODES: NavMode[] = [
  { id: 'trading', label: 'Terminal', hint: 'Discover · analyze · execute · manage', icon: <LineChart className="h-[18px] w-[18px]" /> },
  { id: 'portfolio', label: 'Positions', hint: 'The book · aggregate risk · P/L', icon: <Layers className="h-[18px] w-[18px]" /> },
  { id: 'cockpit', label: 'Automation', hint: 'Supervise the machine', icon: <Bot className="h-[18px] w-[18px]" /> },
  { id: 'intelligence', label: 'Intelligence', hint: 'Sessions · journal · research', icon: <BrainCircuit className="h-[18px] w-[18px]" /> },
];

/** Secondary destination — demoted from the primary rail to a footer utility. */
export const SECONDARY_MODES: NavMode[] = [
  { id: 'operations', label: 'System Ops', hint: 'Infra · data health', icon: <ServerCog className="h-[18px] w-[18px]" /> },
];

export const ALL_MODES: NavMode[] = [...PRIMARY_MODES, ...SECONDARY_MODES];

export function modeLabel(view: AppView): string {
  return ALL_MODES.find(m => m.id === view)?.label ?? 'Terminal';
}
