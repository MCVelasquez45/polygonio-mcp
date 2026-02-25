import type { FuturesSymbol } from '../models/futuresModels';

export type ContractSpecSeed = {
  symbol: FuturesSymbol;
  exchange: string;
  venue: string;
  description: string;
  tickSize: number;
  tickValue: number;
  contractMultiplier: number;
  currency: string;
  sessionTemplate: 'globex' | 'pit' | 'custom';
  maintenanceBreak: { start: string; end: string; timezone: string };
  defaultInitialMargin: number;
  defaultMaintenanceMargin: number;
  active: boolean;
};

export const DEFAULT_FUTURES_CONTRACT_SPECS: ContractSpecSeed[] = [
  {
    symbol: 'ES',
    exchange: 'CME',
    venue: 'Globex',
    description: 'E-mini S&P 500',
    tickSize: 0.25,
    tickValue: 12.5,
    contractMultiplier: 50,
    currency: 'USD',
    sessionTemplate: 'globex',
    maintenanceBreak: { start: '17:00', end: '18:00', timezone: 'America/New_York' },
    defaultInitialMargin: 15000,
    defaultMaintenanceMargin: 13600,
    active: true
  },
  {
    symbol: 'NQ',
    exchange: 'CME',
    venue: 'Globex',
    description: 'E-mini Nasdaq-100',
    tickSize: 0.25,
    tickValue: 5,
    contractMultiplier: 20,
    currency: 'USD',
    sessionTemplate: 'globex',
    maintenanceBreak: { start: '17:00', end: '18:00', timezone: 'America/New_York' },
    defaultInitialMargin: 19000,
    defaultMaintenanceMargin: 17200,
    active: true
  },
  {
    symbol: 'CL',
    exchange: 'NYMEX',
    venue: 'Globex',
    description: 'WTI Crude Oil',
    tickSize: 0.01,
    tickValue: 10,
    contractMultiplier: 1000,
    currency: 'USD',
    sessionTemplate: 'globex',
    maintenanceBreak: { start: '17:00', end: '18:00', timezone: 'America/New_York' },
    defaultInitialMargin: 9000,
    defaultMaintenanceMargin: 8200,
    active: true
  },
  {
    symbol: 'GC',
    exchange: 'COMEX',
    venue: 'Globex',
    description: 'Gold Futures',
    tickSize: 0.1,
    tickValue: 10,
    contractMultiplier: 100,
    currency: 'USD',
    sessionTemplate: 'globex',
    maintenanceBreak: { start: '17:00', end: '18:00', timezone: 'America/New_York' },
    defaultInitialMargin: 12000,
    defaultMaintenanceMargin: 10800,
    active: true
  }
];
