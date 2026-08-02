import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.IDENTITY_JWT_SECRET = 'test-identity-secret-at-least-32-bytes-long';
process.env.IDENTITY_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:4000/api/auth/google/callback';

const { initMongo, closeMongo } = await import('../dist/shared/db/mongo.js');
const { beginGoogleOAuth, consumeGoogleOAuthAttempt } = await import('../dist/features/identity/services/oauthService.js');
const { verifyGoogleOAuthState } = await import('../dist/shared/identity/oauthState.js');
const { OAuthAttemptModel } = await import('../dist/features/identity/models/oauthAttempt.model.js');

let mongod;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await initMongo(mongod.getUri(), 'oauth-security-test');
});

test.after(async () => {
  await closeMongo();
  await mongod?.stop();
});

test.beforeEach(async () => {
  await OAuthAttemptModel.deleteMany({});
});

test('Google authorization request uses signed state, PKCE, OIDC nonce, and one-time server state', async () => {
  const authorizationUrl = new URL(await beginGoogleOAuth('/workspace'));
  const state = authorizationUrl.searchParams.get('state');
  const statePayload = verifyGoogleOAuthState(state ?? '');

  assert.equal(authorizationUrl.origin, 'https://accounts.google.com');
  assert.equal(authorizationUrl.searchParams.get('response_type'), 'code');
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(authorizationUrl.searchParams.get('code_challenge'));
  assert.ok(statePayload?.nonce);
  assert.equal(authorizationUrl.searchParams.get('nonce'), statePayload?.nonce);
  assert.equal(statePayload?.returnTo, '/workspace');

  const codeVerifier = await consumeGoogleOAuthAttempt(state ?? '');
  assert.ok(codeVerifier);
  assert.equal(await consumeGoogleOAuthAttempt(state ?? ''), null);
});

test('Google authorization return paths cannot become open redirects', async () => {
  const authorizationUrl = new URL(await beginGoogleOAuth('https://attacker.example/steal'));
  const state = authorizationUrl.searchParams.get('state');
  assert.equal(verifyGoogleOAuthState(state ?? '')?.returnTo, '/');
});
