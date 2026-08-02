// Cryptographic primitives for the Identity Platform.
//
// - Opaque token generation (refresh / email / api tokens): 256-bit random,
//   stored only as a SHA-256 hash so a DB leak never yields usable tokens.
// - Timing-safe comparison for all token/CSRF equality checks.
// - AES-256-GCM envelope encryption for at-rest secrets (broker credentials
//   scaffold). Never store third-party secrets in plaintext.

import { createHash, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'crypto';
import { getIdentityConfig } from './config';

/** Cryptographically-strong URL-safe opaque token (default 32 bytes / 256-bit). */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Deterministic SHA-256 hex hash used to index/compare opaque tokens. */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time string equality (safe for secrets/tokens/CSRF). */
export function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type EnvelopeCiphertext = {
  v: 1;
  iv: string; // base64
  tag: string; // base64
  data: string; // base64
};

/**
 * AES-256-GCM envelope encryption using the configured master key.
 * Throws if IDENTITY_ENCRYPTION_KEY is not configured — callers that persist
 * secrets must fail closed rather than store plaintext.
 */
export function encryptSecret(plaintext: string): EnvelopeCiphertext {
  const key = requireEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: data.toString('base64'),
  };
}

export function decryptSecret(envelope: EnvelopeCiphertext): string {
  const key = requireEncryptionKey();
  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const data = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final(),
  ]);
  return data.toString('utf8');
}

export function isEncryptionConfigured(): boolean {
  return getIdentityConfig().encryptionKey !== null;
}

function requireEncryptionKey(): Buffer {
  const key = getIdentityConfig().encryptionKey;
  if (!key) {
    throw new Error(
      'IDENTITY_ENCRYPTION_KEY is not configured. Cannot encrypt/decrypt secrets. ' +
        'Generate with: openssl rand -base64 32'
    );
  }
  return key;
}
