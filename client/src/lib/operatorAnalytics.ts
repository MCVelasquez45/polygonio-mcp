import { track } from '@vercel/analytics';

export const OPERATOR_ANALYTICS_EVENTS = [
  'Application Loaded',
  'Automation Viewed',
  'Automation Started',
  'Automation Stopped',
  'Cockpit Viewed',
  'AI Desk Viewed',
  'Strategy Viewed',
  'Risk Viewed',
  'Trade Lifecycle Viewed',
  'Reports Viewed',
  'Operator Expanded Advanced Details',
  'Shadow Mode Enabled',
  'Paper Mode Enabled',
] as const;

export type OperatorAnalyticsEvent = (typeof OPERATOR_ANALYTICS_EVENTS)[number];

type PropertyValue = string | number | boolean | null | undefined;
type OperatorAnalyticsProperties = Record<string, PropertyValue>;

const trackedOnce = new Set<string>();

function safeProperties(properties?: OperatorAnalyticsProperties): OperatorAnalyticsProperties | undefined {
  if (!properties) return undefined;
  const allowed: OperatorAnalyticsProperties = {};
  for (const [key, value] of Object.entries(properties)) {
    allowed[key] = typeof value === 'string' ? value.slice(0, 80) : value;
  }
  return allowed;
}

export function trackOperatorEvent(event: OperatorAnalyticsEvent, properties?: OperatorAnalyticsProperties): void {
  track(event, safeProperties(properties));
}

export function trackOperatorEventOnce(event: OperatorAnalyticsEvent, properties?: OperatorAnalyticsProperties): void {
  const key = `${event}:${JSON.stringify(safeProperties(properties) ?? {})}`;
  if (trackedOnce.has(key)) return;
  trackedOnce.add(key);
  trackOperatorEvent(event, properties);
}
