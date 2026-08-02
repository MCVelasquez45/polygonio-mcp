import test from 'node:test';
import assert from 'node:assert/strict';

const { getIdentityConfig, resetIdentityConfigCache } = await import(
  '../dist/shared/identity/config.js'
);

const managedKeys = [
  'NODE_ENV',
  'SESSION_SECRET',
  'IDENTITY_JWT_SECRET',
  'IDENTITY_ENCRYPTION_KEY',
];
const original = Object.fromEntries(managedKeys.map(key => [key, process.env[key]]));

function clearManagedEnvironment() {
  for (const key of managedKeys) delete process.env[key];
  resetIdentityConfigCache();
}

test.after(() => {
  clearManagedEnvironment();
  for (const [key, value] of Object.entries(original)) {
    if (value !== undefined) process.env[key] = value;
  }
});

test('legacy SESSION_SECRET supplies deterministic development-only identity keys', () => {
  clearManagedEnvironment();
  process.env.NODE_ENV = 'development';
  process.env.SESSION_SECRET = 'legacy-local-session-secret-at-least-32-bytes';

  const first = getIdentityConfig();
  assert.equal(first.jwtSecret, process.env.SESSION_SECRET);
  assert.equal(first.encryptionKey?.length, 32);
  const firstEncryptionKey = first.encryptionKey?.toString('hex');

  resetIdentityConfigCache();
  const second = getIdentityConfig();
  assert.equal(second.encryptionKey?.toString('hex'), firstEncryptionKey);
});

test('production does not accept SESSION_SECRET as an identity-secret substitute', () => {
  clearManagedEnvironment();
  process.env.NODE_ENV = 'production';
  process.env.SESSION_SECRET = 'legacy-local-session-secret-at-least-32-bytes';

  assert.throws(() => getIdentityConfig(), /IDENTITY_JWT_SECRET is required in production/);
});
