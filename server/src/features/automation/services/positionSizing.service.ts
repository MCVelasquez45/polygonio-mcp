import type { AutomationStrategyConfig } from '../automation.config';

// Deterministic position sizing for a long option (pure function).
//
//   premiumCostPerContract = selectedAsk × 100
//   plannedLossPerContract = premiumCostPerContract × stopLossPct
//   riskBudget             = accountEquity × riskPerTradePct
//   quantity               = floor(riskBudget ÷ plannedLossPerContract)
//
// then capped by buying power and by maxPositionCostPct of equity.
// Quantity is NEVER hardcoded; a result below 1 is a rejection.

export type SizingInputs = {
  accountEquity: number;
  buyingPower: number;
  selectedAsk: number;
  config: Pick<AutomationStrategyConfig['risk'], 'riskPerTradePct' | 'stopLossPct' | 'maxPositionCostPct'>;
};

export type SizingResult = {
  inputs: {
    accountEquity: number;
    buyingPower: number;
    selectedAsk: number;
    riskPerTradePct: number;
    stopLossPct: number;
    maxPositionCostPct: number;
  };
  outputs: {
    premiumCostPerContract: number;
    plannedLossPerContract: number;
    riskBudget: number;
    rawQuantity: number;
    buyingPowerCap: number;
    positionCostCap: number;
    quantity: number;
    totalPositionCost: number;
    rejectedReason: string | null;
  };
};

export function computePositionSize({ accountEquity, buyingPower, selectedAsk, config }: SizingInputs): SizingResult {
  const premiumCostPerContract = selectedAsk * 100;
  const plannedLossPerContract = premiumCostPerContract * config.stopLossPct;
  const riskBudget = accountEquity * config.riskPerTradePct;

  const rawQuantity =
    plannedLossPerContract > 0 ? Math.floor(riskBudget / plannedLossPerContract) : 0;
  const buyingPowerCap =
    premiumCostPerContract > 0 ? Math.floor(buyingPower / premiumCostPerContract) : 0;
  const positionCostCap =
    premiumCostPerContract > 0
      ? Math.floor((accountEquity * config.maxPositionCostPct) / premiumCostPerContract)
      : 0;

  const quantity = Math.max(0, Math.min(rawQuantity, buyingPowerCap, positionCostCap));
  const totalPositionCost = quantity * premiumCostPerContract;

  let rejectedReason: string | null = null;
  if (quantity < 1) {
    if (rawQuantity < 1) rejectedReason = 'risk budget below one contract planned loss';
    else if (buyingPowerCap < 1) rejectedReason = 'insufficient buying power for one contract';
    else rejectedReason = 'max position cost cap below one contract';
  }

  return {
    inputs: {
      accountEquity,
      buyingPower,
      selectedAsk,
      riskPerTradePct: config.riskPerTradePct,
      stopLossPct: config.stopLossPct,
      maxPositionCostPct: config.maxPositionCostPct,
    },
    outputs: {
      premiumCostPerContract: Number(premiumCostPerContract.toFixed(2)),
      plannedLossPerContract: Number(plannedLossPerContract.toFixed(2)),
      riskBudget: Number(riskBudget.toFixed(2)),
      rawQuantity,
      buyingPowerCap,
      positionCostCap,
      quantity,
      totalPositionCost: Number(totalPositionCost.toFixed(2)),
      rejectedReason,
    },
  };
}
