export function getExpirationTimestamp(expiration: string | null | undefined): number | null {
  if (!expiration) return null;
  const date = new Date(`${expiration}T00:00:00Z`);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

export function formatExpirationDate(
  expiration: string | null | undefined,
  options: Intl.DateTimeFormatOptions = {}
) {
  const timestamp = getExpirationTimestamp(expiration);
  if (timestamp == null) {
    return expiration ?? '—';
  }
  return new Date(timestamp).toLocaleDateString(undefined, { timeZone: 'UTC', ...options });
}

export function computeExpirationDte(expiration: string | null | undefined) {
  const timestamp = getExpirationTimestamp(expiration);
  if (timestamp == null) return null;
  return Math.round((timestamp - Date.now()) / 86_400_000);
}
