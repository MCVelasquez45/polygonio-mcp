import {
  finiteOrNull,
  fmtDuration,
  fmtGreek,
  fmtMoney,
  fmtNumber,
  fmtPercent,
  fmtSignedMoney,
  fmtSize,
} from '../../lib/marketFormat';

export const QUOTE_PROVIDER_UNAVAILABLE = 'No live quote is currently available from the provider.';

export function moneyOrReason(value: unknown, reason: string, digits = 2): string {
  return finiteOrNull(value) === null ? reason : fmtMoney(value, digits);
}

export function signedMoneyOrReason(value: unknown, reason: string, digits = 2): string {
  return finiteOrNull(value) === null ? reason : fmtSignedMoney(value, digits);
}

export function numberOrReason(value: unknown, reason: string, digits = 0): string {
  return finiteOrNull(value) === null ? reason : fmtNumber(value, digits);
}

export function percentOrReason(value: unknown, reason: string, digits = 1): string {
  return finiteOrNull(value) === null ? reason : fmtPercent(value, digits);
}

export function greekOrReason(value: unknown, reason: string, digits = 2): string {
  return finiteOrNull(value) === null ? reason : fmtGreek(value, digits);
}

export function sizeOrReason(value: unknown, reason: string): string {
  return finiteOrNull(value) === null ? reason : fmtSize(value);
}

export function durationOrReason(value: unknown, reason: string): string {
  return finiteOrNull(value) === null ? reason : fmtDuration(value);
}

export function timestampOrReason(value: number | string | null | undefined, reason: string): string {
  const ms = typeof value === 'number' ? value : value ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) return reason;
  return new Date(ms).toLocaleTimeString([], { hour12: false });
}

export function statusOrReason(value: string | null | undefined, reason: string): string {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed : reason;
}
