import type { BrokerProvider } from '../identity/models/brokerConnection.model';

export type BrokerAsset = 'Stocks' | 'Options' | 'Futures' | 'Crypto';

export type BrokerDirectoryEntry = {
  provider: string;
  name: string;
  monogram: string;
  assets: BrokerAsset[];
  oauthSupported: boolean;
  paperTrading: boolean;
  liveTrading: boolean;
  available: boolean;
  permissions: string[];
  description: string;
};

export const BROKER_DIRECTORY: BrokerDirectoryEntry[] = [
  { provider: 'alpaca', name: 'Alpaca', monogram: 'A', assets: ['Stocks', 'Options', 'Crypto'], oauthSupported: true, paperTrading: true, liveTrading: true, available: true, permissions: ['Read Account', 'Read Buying Power', 'Read Positions', 'Read Orders', 'Submit Orders'], description: 'API-first brokerage for equities, options, and digital assets.' },
  { provider: 'ibkr', name: 'Interactive Brokers', monogram: 'IB', assets: ['Stocks', 'Options', 'Futures'], oauthSupported: true, paperTrading: true, liveTrading: true, available: true, permissions: ['Read Account', 'Read Buying Power', 'Read Positions', 'Read Orders', 'Submit Orders'], description: 'Global multi-asset execution and institutional account access.' },
  { provider: 'tradier', name: 'Tradier', monogram: 'TR', assets: ['Stocks', 'Options'], oauthSupported: true, paperTrading: true, liveTrading: true, available: true, permissions: ['Read Account', 'Read Balances', 'Read Positions', 'Read Orders', 'Submit Orders'], description: 'Equity and options brokerage with delegated OAuth access.' },
  { provider: 'tastytrade', name: 'tastytrade', monogram: 'TT', assets: ['Stocks', 'Options', 'Futures', 'Crypto'], oauthSupported: true, paperTrading: false, liveTrading: true, available: true, permissions: ['Read Account', 'Read Buying Power', 'Read Positions', 'Read Orders', 'Submit Orders'], description: 'Derivatives-focused brokerage and multi-asset execution.' },
  { provider: 'robinhood', name: 'Robinhood', monogram: 'RH', assets: ['Stocks', 'Options', 'Crypto'], oauthSupported: false, paperTrading: false, liveTrading: true, available: false, permissions: [], description: 'Retail equities, options, and crypto brokerage.' },
  { provider: 'schwab', name: 'Charles Schwab', monogram: 'CS', assets: ['Stocks', 'Options'], oauthSupported: false, paperTrading: false, liveTrading: true, available: false, permissions: [], description: 'Full-service investing and brokerage accounts.' },
  { provider: 'tradestation', name: 'TradeStation', monogram: 'TS', assets: ['Stocks', 'Options', 'Futures', 'Crypto'], oauthSupported: false, paperTrading: true, liveTrading: true, available: false, permissions: [], description: 'Active trading across multiple asset classes.' },
  { provider: 'webull', name: 'Webull', monogram: 'WB', assets: ['Stocks', 'Options', 'Crypto'], oauthSupported: false, paperTrading: true, liveTrading: true, available: false, permissions: [], description: 'Multi-asset brokerage and market access.' },
  { provider: 'fidelity', name: 'Fidelity', monogram: 'F', assets: ['Stocks', 'Options'], oauthSupported: false, paperTrading: false, liveTrading: true, available: false, permissions: [], description: 'Investment and brokerage account access.' },
  { provider: 'moomoo', name: 'Moomoo', monogram: 'M', assets: ['Stocks', 'Options'], oauthSupported: false, paperTrading: true, liveTrading: true, available: false, permissions: [], description: 'Equities and options trading platform.' },
  { provider: 'etrade', name: 'E*Trade', monogram: 'ET', assets: ['Stocks', 'Options', 'Futures'], oauthSupported: false, paperTrading: false, liveTrading: true, available: false, permissions: [], description: 'Brokerage and active trading accounts.' },
  { provider: 'public', name: 'Public', monogram: 'P', assets: ['Stocks', 'Options', 'Crypto'], oauthSupported: false, paperTrading: false, liveTrading: true, available: false, permissions: [], description: 'Investing platform for stocks, options, and crypto.' },
];

export const ACTIVE_BROKER_PROVIDERS = new Set<BrokerProvider>(['alpaca', 'ibkr', 'tradier', 'tastytrade']);

export function getBrokerEntry(provider: string): BrokerDirectoryEntry | null {
  return BROKER_DIRECTORY.find(item => item.provider === provider) ?? null;
}
