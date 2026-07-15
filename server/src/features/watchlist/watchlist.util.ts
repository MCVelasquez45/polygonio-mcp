/** Read a numeric env var, clamped to [min, max], falling back to `fallback`. */
export function envNumberClamped(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const parsed = raw == null || raw.trim() === '' ? fallback : Number(raw);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, value));
}
