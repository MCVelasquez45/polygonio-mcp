// Google OAuth (Authorization Code flow) via the official google-auth-library.
//
// The provider abstraction (OAuthProfile) keeps the rest of the system provider-
// agnostic so future providers (GitHub, Microsoft, enterprise SSO) drop in
// behind the same shape. Live wiring requires GOOGLE_CLIENT_ID /
// GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI.

import { OAuth2Client } from 'google-auth-library';
import { getIdentityConfig, isGoogleOAuthConfigured } from '../../../shared/identity/config';
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

/** Build the Google consent-screen URL, carrying our signed state. */
export function buildGoogleAuthUrl(state: string): string {
  return client().generateAuthUrl({
    access_type: 'offline',
    prompt: 'select_account',
    scope: ['openid', 'email', 'profile'],
    state,
  });
}

/**
 * Exchange an authorization code for tokens, verify the ID token, and return a
 * normalized, verified OAuth profile. Throws on any failure (invalid code,
 * unverified email, audience mismatch).
 */
export async function exchangeGoogleCode(code: string): Promise<OAuthProfile> {
  const cfg = getIdentityConfig();
  const oauth = client();
  const { tokens } = await oauth.getToken(code);
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

export async function verifyGoogleCredential(idToken: string): Promise<OAuthProfile> {
  const cfg = getIdentityConfig();
  const oauth = client();
  const ticket = await oauth.verifyIdToken({
    idToken,
    audience: cfg.googleClientId!,
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.sub) {
    throw new Error('Google ID token had no subject.');
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
