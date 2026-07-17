// Human-readable rendering of an OCC option symbol, e.g.
//   O:SPY260724C00600000  ->  { underlying: 'SPY', expiration: '2026-07-24',
//                               type: 'CALL', strike: 600 }
// Pure string math - no network, no allocation beyond the result.

export type ParsedOcc = {
  underlying: string;
  expiration: string | null; // YYYY-MM-DD
  type: 'CALL' | 'PUT' | null;
  strike: number | null;
};

const OCC = /^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

export function parseOcc(optionSymbol: string | null | undefined): ParsedOcc | null {
  if (!optionSymbol) return null;
  const bare = optionSymbol.toUpperCase().replace(/^O:/, '');
  const m = bare.match(OCC);
  if (!m) return { underlying: bare, expiration: null, type: null, strike: null };
  const [, underlying, yy, mm, dd, cp, strikeRaw] = m;
  return {
    underlying,
    expiration: `20${yy}-${mm}-${dd}`,
    type: cp === 'C' ? 'CALL' : 'PUT',
    // OCC strike is price × 1000 (8 digits).
    strike: Number(strikeRaw) / 1000,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function expirationLabel(expiration: string | null): string | null {
  if (!expiration) return null;
  const [year, month, day] = expiration.split('-').map((part) => Number(part));
  if (!year || !month || !day || month < 1 || month > 12) return null;
  return `${MONTHS[month - 1]} ${day} ${year}`;
}

/** Readable contract label: `SPY Jul 24 2026 $600 Call`. Falls back to raw. */
export function contractLabel(optionSymbol: string | null | undefined): string {
  const p = parseOcc(optionSymbol);
  if (!p || p.strike === null || !p.type) return String(optionSymbol ?? 'Contract symbol not captured');
  const strike = Number.isInteger(p.strike) ? String(p.strike) : p.strike.toFixed(2);
  const expiry = expirationLabel(p.expiration);
  const side = p.type === 'CALL' ? 'Call' : 'Put';
  return expiry ? `${p.underlying} ${expiry} $${strike} ${side}` : `${p.underlying} $${strike} ${side}`;
}
