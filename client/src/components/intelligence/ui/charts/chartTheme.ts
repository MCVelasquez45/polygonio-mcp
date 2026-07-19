// Chart palette. SVG fills need concrete hex values, so these mirror the
// `intel.*` Tailwind tokens (single source of the numbers is tailwind.config.js).
export const CHART = {
  ink: '#e9edf6',
  ink2: '#94a3b8',
  ink3: '#64748b',
  line: '#1e293b',
  panel: '#0b1220',
  accent: '#f5a623',
  pos: '#35d29a',
  neg: '#f87171',
  warn: '#fbbf24',
  info: '#6aa5f5',
} as const;

export const AXIS_TICK = { fill: CHART.ink3, fontSize: 11, fontFamily: 'ui-monospace, Menlo, monospace' } as const;
