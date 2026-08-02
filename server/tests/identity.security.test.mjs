import test from 'node:test';
import assert from 'node:assert/strict';

process.env.IDENTITY_JWT_SECRET = 'test-identity-secret-at-least-32-bytes-long';

const rbac = await import('../dist/shared/identity/rbac.js');
const password = await import('../dist/shared/identity/password.js');
const oauthState = await import('../dist/shared/identity/oauthState.js');
const crypto = await import('../dist/shared/identity/crypto.js');

test('RBAC role inheritance grants expected permissions', () => {
  assert.equal(rbac.rolesHaveAllPermissions(['viewer'], ['workspace:read']), true);
  assert.equal(rbac.rolesHaveAllPermissions(['viewer'], ['order:create']), false);
  assert.equal(rbac.rolesHaveAllPermissions(['trader'], ['workspace:read', 'order:create']), true);
  assert.equal(rbac.rolesHaveAllPermissions(['admin'], ['audit:read', 'automation:control']), true);
});

test('legacy role mapping preserves existing requestIdentity role union', () => {
  assert.deepEqual(rbac.toLegacyRoles(['admin']).sort(), ['administrator', 'operator'].sort());
  assert.deepEqual(rbac.toLegacyRoles(['analyst']), ['viewer']);
});

test('password policy rejects weak inputs and accepts passphrases', () => {
  assert.equal(password.checkPasswordPolicy('short').ok, false);
  assert.equal(password.checkPasswordPolicy('password123').ok, false);
  assert.equal(password.checkPasswordPolicy('correct horse battery staple').ok, true);
});

test('OAuth state is signed, expires through verification logic, and rejects open redirects', () => {
  const state = oauthState.createGoogleOAuthState('/workspace?view=trading');
  assert.equal(oauthState.verifyGoogleOAuthState(state)?.returnTo, '/workspace?view=trading');
  assert.equal(oauthState.verifyGoogleOAuthState(`${state}tampered`), null);
  const unsafe = oauthState.createGoogleOAuthState('https://evil.example');
  assert.equal(oauthState.verifyGoogleOAuthState(unsafe)?.returnTo, '/');
});

test('token hashes are deterministic and safeEquals is exact', () => {
  assert.equal(crypto.sha256('token'), crypto.sha256('token'));
  assert.notEqual(crypto.sha256('token'), crypto.sha256('other'));
  assert.equal(crypto.safeEquals('abc', 'abc'), true);
  assert.equal(crypto.safeEquals('abc', 'abcd'), false);
});
