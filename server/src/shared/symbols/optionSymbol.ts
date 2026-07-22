export type OptionRight = 'call' | 'put';

export type ParsedOptionSymbol = {
  /** Internal canonical compact OCC symbol, without provider prefix. */
  canonical: string;
  /** Massive/Polygon-compatible provider symbol. */
  massive: string;
  /** Alpaca Trading API symbol. */
  alpaca: string;
  /** Stable Mongo/automation comparison key. */
  mongoKey: string;
  underlying: string;
  expiration: string;
  expirationYYMMDD: string;
  right: OptionRight;
  strike: number;
};

const COMPACT_OCC_RE = /^([A-Z0-9.]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

function cleanInput(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

/** Strip only known provider prefixes. Do not remove other punctuation here. */
export function toInternalOptionSymbol(value: string | null | undefined): string {
  const normalized = cleanInput(value);
  return normalized.startsWith('O:') ? normalized.slice(2) : normalized;
}

export function parseOptionSymbol(value: string | null | undefined): ParsedOptionSymbol | null {
  const canonical = toInternalOptionSymbol(value);
  const match = canonical.match(COMPACT_OCC_RE);
  if (!match) return null;
  const [, underlying, yy, mm, dd, cp, strikeRaw] = match;
  const strike = Number(strikeRaw) / 1000;
  if (!Number.isFinite(strike)) return null;
  return {
    canonical,
    massive: `O:${canonical}`,
    alpaca: canonical,
    mongoKey: canonical,
    underlying,
    expiration: `20${yy}-${mm}-${dd}`,
    expirationYYMMDD: `${yy}${mm}${dd}`,
    right: cp === 'C' ? 'call' : 'put',
    strike,
  };
}

export function isOptionSymbol(value: string | null | undefined): boolean {
  return parseOptionSymbol(value) != null;
}

export function isMassiveOptionSymbol(value: string | null | undefined): boolean {
  const normalized = cleanInput(value);
  return normalized.startsWith('O:') && isOptionSymbol(normalized);
}

export function toMassiveOptionSymbol(value: string | null | undefined): string | null {
  const parsed = parseOptionSymbol(value);
  return parsed ? parsed.massive : null;
}

export function toAlpacaOptionSymbol(value: string | null | undefined): string | null {
  const parsed = parseOptionSymbol(value);
  return parsed ? parsed.alpaca : null;
}

export function toMongoOptionSymbolKey(value: string | null | undefined): string {
  return parseOptionSymbol(value)?.mongoKey ?? toInternalOptionSymbol(value);
}

export function underlyingFromOptionSymbol(value: string | null | undefined): string | null {
  return parseOptionSymbol(value)?.underlying ?? null;
}

export function expirationFromOptionSymbol(value: string | null | undefined): string | null {
  return parseOptionSymbol(value)?.expiration ?? null;
}

export function optionRightFromSymbol(value: string | null | undefined): OptionRight | null {
  return parseOptionSymbol(value)?.right ?? null;
}
