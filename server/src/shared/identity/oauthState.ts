import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { getIdentityConfig } from './config';

type GoogleOAuthState = {
  nonce: string;
  returnTo: string;
  exp: number;
};

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function sign(payload: string): string {
  return createHmac('sha256', getIdentityConfig().jwtSecret).update(payload).digest('base64url');
}

export function createGoogleOAuthState(returnTo?: string): string {
  const safeReturnTo = normalizeReturnTo(returnTo);
  const payload = base64urlJson({
    nonce: randomBytes(16).toString('base64url'),
    returnTo: safeReturnTo,
    exp: Date.now() + 10 * 60 * 1000,
  } satisfies GoogleOAuthState);
  return `${payload}.${sign(payload)}`;
}

export function verifyGoogleOAuthState(value: string): GoogleOAuthState | null {
  const [payload, signature] = String(value ?? '').split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<GoogleOAuthState>;
    if (!parsed.nonce || !parsed.returnTo || !parsed.exp) return null;
    if (parsed.exp < Date.now()) return null;
    return { nonce: parsed.nonce, returnTo: normalizeReturnTo(parsed.returnTo), exp: parsed.exp };
  } catch {
    return null;
  }
}

export function normalizeReturnTo(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw || !raw.startsWith('/')) return '/';
  if (raw.startsWith('//')) return '/';
  return raw.slice(0, 256);
}
