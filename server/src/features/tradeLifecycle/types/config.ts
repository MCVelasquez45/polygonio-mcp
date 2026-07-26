import type { TradeLifecycleFlags } from './lifecycleTypes';

function envBool(name: keyof TradeLifecycleFlags, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getTradeLifecycleFlags(): TradeLifecycleFlags {
  return {
    TRADE_LIFECYCLE_ENABLED: envBool('TRADE_LIFECYCLE_ENABLED', true),
    TRADE_LIFECYCLE_AUTOSTART: envBool('TRADE_LIFECYCLE_AUTOSTART', false),
    AUTONOMOUS_MONITORING: envBool('AUTONOMOUS_MONITORING', true),
    AUTONOMOUS_ENTRY_ENABLED: envBool('AUTONOMOUS_ENTRY_ENABLED', false),
    AUTONOMOUS_EXIT_ENABLED: envBool('AUTONOMOUS_EXIT_ENABLED', false),
  };
}

export function getTradeLifecycleScheduleMs(): number {
  return Math.max(5_000, envNumber('TRADE_LIFECYCLE_EVALUATION_INTERVAL_MS', 30_000));
}
