// Google OAuth (Authorization Code flow) via the official google-auth-library.
//
// The provider abstraction (OAuthProfile) keeps the rest of the system provider-
// agnostic so future providers (GitHub, Microsoft, enterprise SSO) drop in
// behind the same shape. Live wiring requires GOOGLE_CLIENT_ID /
// GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI.

import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { getIdentityConfig, isGoogleOAuthConfigured } from '../../../shared/identity/config';
import { decryptSecret, encryptSecret, safeEquals, sha256 } from '../../../shared/identity/crypto';
import { createGoogleOAuthState, normalizeReturnTo, verifyGoogleOAuthState } from '../../../shared/identity/oauthState';
import { OAuthAttemptModel } from '../models/oauthAttempt.model';
import type { OAuthProfile } from './userService';

let cachedClient: OAuth2Client | null = null;

function client(): OAuth2Client {
  const cfg = getIdentityConfig();
  if (!isGoogleOAuthConfigured()) {
    throw new Error('Google OAuth is not configured (GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI).');
  }
  if (!cachedClient) {
    cachedClient = new OAuth2Client({
      clientId: cfg.googleClientId!,
      clientSecret: cfg.googleClientSecret!,
      redirectUri: cfg.googleRedirectUri!,
    });
  }
  return cachedClient;
}

export async function beginGoogleOAuth(returnTo?: string): Promise<string> {
  const oauth = client();
  const state = createGoogleOAuthState(normalizeReturnTo(returnTo));
  const statePayload = verifyGoogleOAuthState(state);
  if (!statePayload) throw new Error('Unable to create OAuth state.');
  const { codeVerifier, codeChallenge } = await oauth.generateCodeVerifierAsync();

  await OAuthAttemptModel.create({
    provider: 'google',
    stateHash: sha256(state),
    codeVerifierCiphertext: encryptSecret(codeVerifier),
    expiresAt: new Date(statePayload.exp),
  });

  return oauth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'select_account',
    scope: ['openid', 'email', 'profile'],
    state,
    nonce: statePayload.nonce,
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });
}

export async function consumeGoogleOAuthAttempt(state: string): Promise<string | null> {
  const attempt = await OAuthAttemptModel.findOneAndDelete({
    provider: 'google',
    stateHash: sha256(state),
    expiresAt: { $gt: new Date() },
  });
  return attempt ? decryptSecret(attempt.codeVerifierCiphertext) : null;
}

/**
 * Exchange an authorization code for tokens, verify the ID token, and return a
 * normalized, verified OAuth profile. Throws on any failure (invalid code,
 * unverified email, audience mismatch).
 */
export async function exchangeGoogleCode(
  code: string,
  codeVerifier: string,
  expectedNonce: string
): Promise<OAuthProfile> {
  const cfg = getIdentityConfig();
  const oauth = client();
  const { tokens } = await oauth.getToken({ code, codeVerifier });
  if (!tokens.id_token) {
    throw new Error('Google did not return an ID token.');
  }
  const ticket = await oauth.verifyIdToken({
    idToken: tokens.id_token,
    audience: cfg.googleClientId!,
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.sub) {
    throw new Error('Google ID token had no subject.');
  }
  if (!payload.nonce || !safeEquals(payload.nonce, expectedNonce)) {
    throw new Error('Google ID token nonce did not match the authorization request.');
  }
  if (!payload.email || payload.email_verified === false) {
    throw new Error('Google account email is missing or unverified.');
  }
  return {
    provider: 'google',
    subject: payload.sub,
    email: payload.email,
    name: payload.name,
  };
}

/** Test/hot-reload helper. */
export function resetOAuthClientCache(): void {
  cachedClient = null;
}
