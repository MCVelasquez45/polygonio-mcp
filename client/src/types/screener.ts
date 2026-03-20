export type Opportunity = {
  ticker: string;
  expiration: string;
  strike: number;
  delta: number | null;
  bid: number;
  ask: number;
  mid: number;
  open_interest: number;
  iv: number | null;
  spot: number;
  premium_yield: number;
  breakeven: number;
  max_profit: number;
  pop_est: number | null;
};

export type ScreenParams = {
  symbol: string;
  expiration_days: number;
  min_otm_pct: number;
  max_otm_pct: number;
  delta_lo: number;
  delta_hi: number;
  min_bid: number;
  min_open_interest: number;
  max_spread_to_mid: number;
  rank_metric: "premium_yield" | "max_profit" | "pop_est";
};
