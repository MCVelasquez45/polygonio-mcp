// Password hashing (Argon2id) + policy for the Identity Platform.
//
// Uses @node-rs/argon2 (prebuilt binaries; no native build in Docker/CI).
// Argon2id is the OWASP-recommended algorithm for password storage.

import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';
import { getIdentityConfig } from './config';

const MIN_LENGTH = 12;
const MAX_LENGTH = 200; // guard against DoS via giant inputs before hashing

// A small denylist of the most common passwords. Not exhaustive — a defense in
// depth alongside the length requirement, not a replacement for a real breach
// corpus check (which can be added later behind the same interface).
const COMMON_DENYLIST = new Set([
  'password', 'password1', 'password123', '123456789012', 'qwertyuiop12',
  'letmein12345', 'administrator', 'tradingpass1', 'welcome12345', 'changeme1234',
]);

export type PasswordPolicyResult = { ok: true } | { ok: false; reason: string };

export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  if (typeof password !== 'string') return { ok: false, reason: 'Password is required.' };
  if (password.length < MIN_LENGTH) {
    return { ok: false, reason: `Password must be at least ${MIN_LENGTH} characters.` };
  }
  if (password.length > MAX_LENGTH) {
    return { ok: false, reason: `Password must be at most ${MAX_LENGTH} characters.` };
  }
  if (COMMON_DENYLIST.has(password.toLowerCase())) {
    return { ok: false, reason: 'Password is too common. Choose something less guessable.' };
  }
  return { ok: true };
}

export async function hashPassword(password: string): Promise<string> {
  const cfg = getIdentityConfig();
  return argonHash(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: cfg.argonMemoryCost,
    timeCost: cfg.argonTimeCost,
    parallelism: cfg.argonParallelism,
  });
}

export async function verifyPassword(hashValue: string, password: string): Promise<boolean> {
  if (!hashValue) return false;
  try {
    return await argonVerify(hashValue, password);
  } catch {
    // Malformed hash or mismatch — treat as failed verification.
    return false;
  }
}
