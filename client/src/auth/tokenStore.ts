let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const encoded = `${encodeURIComponent(name)}=`;
  const entry = document.cookie.split('; ').find(part => part.startsWith(encoded));
  return entry ? decodeURIComponent(entry.slice(encoded.length)) : null;
}
