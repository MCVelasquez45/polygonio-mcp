export type AggregateBar = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type IndicatorPoint = {
  timestamp: number;
  value: number | null;
  meta?: Record<string, unknown>;
};

export type IndicatorSeries = {
  latest: number | null;
  trend?: 'rising' | 'falling' | 'flat';
  values: IndicatorPoint[];
};

export type IndicatorKey = 'sma' | 'ema' | 'rsi' | 'macd' | 'vwap' | 'atr';

export type IndicatorBundle = {
  ticker: string;
} & Partial<Record<IndicatorKey, IndicatorSeries>>;

export type TradePrint = {
  id: string;
  price: number;
  size: number;
  timestamp: number;
  exchange?: string;
  conditions?: string[];
};

export type QuoteBookEntry = {
  timestamp: number | null;
  bidPrice: number | null;
  askPrice: number | null;
  bidSize: number | null;
  askSize: number | null;
  bidExchange?: string;
  askExchange?: string;
  spread: number | null;
  midpoint: number | null;
};

export type QuoteSnapshot = QuoteBookEntry & {
  ticker: string;
  updated?: number | null;
  quotes?: QuoteBookEntry[];
};

export type OptionLeg = {
  ticker: string;
  strike: number;
  type: 'call' | 'put';
  expiration: string;
  underlying?: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  mark?: number | null;
  lastPrice: number | null;
  iv: number | null;
  change?: number | null;
  changePercent?: number | null;
  breakeven?: number | null;
  toBreakevenPercent?: number | null;
  inTheMoney?: boolean;
  greeks?: Record<string, number>;
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
  rho?: number | null;
  volume?: number | null;
  openInterest?: number | null;
  lastTrade?: {
    price?: number | null;
    size?: number | null;
    sip_timestamp?: number | null;
  };
  snapshot?: Record<string, unknown>;
};

export type OptionChainStrike = {
  strike: number | null;
  call?: OptionLeg;
  put?: OptionLeg;
};

export type OptionChainExpirationGroup = {
  expiration: string;
  dte: number | null;
  strikes: OptionChainStrike[];
};

export type OptionChainData = {
  ticker: string;
  underlyingPrice: number | null;
  expirations: OptionChainExpirationGroup[];
  metadata?: {
    limit?: number;
    referenceContracts?: number;
    referencePages?: number;
    referenceComplete?: boolean;
    snapshotPages?: number;
    snapshotComplete?: boolean;
    expiration?: string | null;
  };
};

export type OptionContractDetail = {
  ticker: string;
  underlying?: string;
  expiration?: string;
  type?: string;
  strike?: number;
  openInterest?: number;
  breakEvenPrice?: number;
  impliedVolatility?: number;
  day?: Record<string, unknown>;
  greeks?: Record<string, number>;
  lastQuote?: Record<string, unknown>;
  lastTrade?: {
    price?: number;
    size?: number;
    sip_timestamp?: number;
  };
};

export type WatchlistSnapshot =
  | {
      entryType: 'underlying';
      ticker: string;
      name?: string;
      price: number | null;
      change: number | null;
      changePercent: number | null;
      iv?: number | null;
      volume?: number | null;
      openInterest?: number | null;
      referenceContract?: string;
      referenceMid?: number | null;
      error?: string;
    }
  | {
      entryType: 'contract';
      ticker: string;
      contract: string;
      name?: string;
      underlying: string;
      strike: number | null;
      expiration?: string;
      type?: string;
      price: number | null;
      bid: number | null;
      ask: number | null;
      mid: number | null;
      change: number | null;
      changePercent: number | null;
      iv?: number | null;
      volume?: number | null;
      openInterest?: number | null;
      error?: string;
    };
