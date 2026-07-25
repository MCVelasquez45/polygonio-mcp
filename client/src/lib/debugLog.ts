const DEBUG_FLAGS = new Set(
  String(import.meta.env.VITE_DEBUG_MARKET ?? '')
    .split(',')
    .map(flag => flag.trim().toLowerCase())
    .filter(Boolean)
);

export function isDebugEnabled(flag: string): boolean {
  return import.meta.env.DEV || DEBUG_FLAGS.has('all') || DEBUG_FLAGS.has(flag.toLowerCase());
}

export function debugLog(flag: string, event: string, context: Record<string, unknown>): void {
  if (!isDebugEnabled(flag)) return;
  console.debug(event, {
    ts: new Date().toISOString(),
    ...context,
  });
}
