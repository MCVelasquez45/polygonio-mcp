import type { BrokerProvider } from '../identity/models/brokerConnection.model';

export type OAuthBrokerConfig = {
  provider: Exclude<BrokerProvider, 'paper'>;
  clientId: string | null;
  clientSecret: string | null;
  authorizeUrl: string;
  tokenUrl: string;
  revokeUrl: string | null;
  apiBaseUrl: string;
  redirectUri: string;
  scopes: string[];
};

const defaults: Record<Exclude<BrokerProvider, 'paper'>, Omit<OAuthBrokerConfig, 'provider' | 'clientId' | 'clientSecret' | 'redirectUri'>> = {
  alpaca: { authorizeUrl: 'https://app.alpaca.markets/oauth/authorize', tokenUrl: 'https://api.alpaca.markets/oauth/token', revokeUrl: null, apiBaseUrl: 'https://api.alpaca.markets', scopes: ['account:write', 'trading'] },
  tradier: { authorizeUrl: 'https://api.tradier.com/v1/oauth/authorize', tokenUrl: 'https://api.tradier.com/v1/oauth/accesstoken', revokeUrl: null, apiBaseUrl: 'https://api.tradier.com', scopes: ['read', 'trade'] },
  ibkr: { authorizeUrl: '', tokenUrl: '', revokeUrl: null, apiBaseUrl: '', scopes: ['account', 'portfolio', 'trading'] },
  tastytrade: { authorizeUrl: '', tokenUrl: '', revokeUrl: null, apiBaseUrl: 'https://api.tastytrade.com', scopes: ['account', 'portfolio', 'trading'] },
};

function optional(name: string): string | null {
  const value = process.env[name];
  return value?.trim() ? value.trim() : null;
}

function csv(value: string | null, fallback: string[]): string[] {
  return value ? value.split(/[ ,]+/).map(item => item.trim()).filter(Boolean) : fallback;
}

export function getBrokerOAuthConfig(provider: Exclude<BrokerProvider, 'paper'>): OAuthBrokerConfig {
  const key = provider.toUpperCase();
  const base = defaults[provider];
  const apiOrigin = (optional('IDENTITY_API_BASE_URL') ?? 'http://localhost:4000').replace(/\/+$/, '');
  return {
    provider,
    clientId: optional(`${key}_OAUTH_CLIENT_ID`),
    clientSecret: optional(`${key}_OAUTH_CLIENT_SECRET`),
    authorizeUrl: optional(`${key}_OAUTH_AUTHORIZE_URL`) ?? base.authorizeUrl,
    tokenUrl: optional(`${key}_OAUTH_TOKEN_URL`) ?? base.tokenUrl,
    revokeUrl: optional(`${key}_OAUTH_REVOKE_URL`) ?? base.revokeUrl,
    apiBaseUrl: optional(`${key}_OAUTH_API_BASE_URL`) ?? base.apiBaseUrl,
    redirectUri: optional(`${key}_OAUTH_REDIRECT_URI`) ?? `${apiOrigin}/api/brokers/${provider}/callback`,
    scopes: csv(optional(`${key}_OAUTH_SCOPES`), base.scopes),
  };
}

export function isBrokerOAuthConfigured(provider: Exclude<BrokerProvider, 'paper'>): boolean {
  const config = getBrokerOAuthConfig(provider);
  return Boolean(config.clientId && config.clientSecret && config.authorizeUrl && config.tokenUrl && config.apiBaseUrl);
}
