import type { RiskGreekSnapshot, RiskPortfolioSnapshot } from '../types/riskTypes';

function finite(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeGreeks(value: Partial<RiskGreekSnapshot> | null | undefined): RiskGreekSnapshot {
  return {
    delta: finite(value?.delta),
    gamma: finite(value?.gamma),
    theta: finite(value?.theta),
    vega: finite(value?.vega),
    rho: finite(value?.rho),
  };
}

function addGreek(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return Number(((a ?? 0) + (b ?? 0)).toFixed(4));
}

export function aggregateGreeks(positions: RiskPortfolioSnapshot['currentPositions']): RiskGreekSnapshot {
  return positions.reduce(
    (acc, position) => ({
      delta: addGreek(acc.delta, position.greeks.delta),
      gamma: addGreek(acc.gamma, position.greeks.gamma),
      theta: addGreek(acc.theta, position.greeks.theta),
      vega: addGreek(acc.vega, position.greeks.vega),
      rho: addGreek(acc.rho, position.greeks.rho),
    }),
    { delta: null, gamma: null, theta: null, vega: null, rho: null } as RiskGreekSnapshot
  );
}

export function estimateGreekImpact(
  current: RiskGreekSnapshot,
  add: RiskGreekSnapshot,
  contracts: number
): RiskGreekSnapshot {
  return {
    delta: addGreek(current.delta, add.delta == null ? null : add.delta * contracts),
    gamma: addGreek(current.gamma, add.gamma == null ? null : add.gamma * contracts),
    theta: addGreek(current.theta, add.theta == null ? null : add.theta * contracts),
    vega: addGreek(current.vega, add.vega == null ? null : add.vega * contracts),
    rho: addGreek(current.rho, add.rho == null ? null : add.rho * contracts),
  };
}
