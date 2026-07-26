import { AutomationPositionModel } from '../../automation/models/automationPosition.model';
import { SECTOR_BY_SYMBOL } from '../../eventIntelligence/classification/classifier.service';
import type { PortfolioContext } from '../types/orchestratorTypes';

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function buildPortfolioContext(): Promise<PortfolioContext> {
  try {
    const positions = await AutomationPositionModel.find({ status: { $in: ['PENDING_ENTRY', 'OPEN', 'EXITING', 'MANUAL_REVIEW'] } })
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();
    const currentPositions = positions.map((position: any) => {
      const underlying = String(position.underlying ?? '').toUpperCase() || null;
      return {
        symbol: String(position.optionSymbol ?? position.symbol ?? ''),
        underlying,
        sector: underlying ? SECTOR_BY_SYMBOL[underlying] ?? null : null,
        quantity: num(position.filledQty ?? position.quantity),
        marketValue: num(position.currentValue ?? position.marketValue),
        unrealizedPnl: num(position.unrealizedPnl),
        delta: num(position.greeks?.delta),
        gamma: num(position.greeks?.gamma),
        theta: num(position.greeks?.theta),
        vega: num(position.greeks?.vega),
      };
    });
    const sectorExposure: Record<string, number> = {};
    for (const position of currentPositions) {
      const sector = position.sector ?? 'Unknown';
      sectorExposure[sector] = (sectorExposure[sector] ?? 0) + Math.abs(position.marketValue ?? 0);
    }
    const greeks = currentPositions.reduce(
      (acc, position) => ({
        delta: acc.delta == null && position.delta == null ? null : (acc.delta ?? 0) + (position.delta ?? 0),
        gamma: acc.gamma == null && position.gamma == null ? null : (acc.gamma ?? 0) + (position.gamma ?? 0),
        theta: acc.theta == null && position.theta == null ? null : (acc.theta ?? 0) + (position.theta ?? 0),
        vega: acc.vega == null && position.vega == null ? null : (acc.vega ?? 0) + (position.vega ?? 0),
      }),
      { delta: null, gamma: null, theta: null, vega: null } as PortfolioContext['greeks']
    );
    const openRisk = currentPositions.reduce((sum, position) => sum + Math.abs(position.marketValue ?? 0), 0);
    return {
      currentPositions,
      buyingPower: null,
      sectorExposure,
      openRisk,
      greeks,
      availableCapital: null,
      maximumDailyLoss: null,
      adjustmentExplanation: currentPositions.length
        ? `Portfolio awareness found ${currentPositions.length} open automation positions and ${Object.keys(sectorExposure).length} sector exposures.`
        : 'No open automation portfolio exposure was found in persisted records.',
    };
  } catch (error) {
    return {
      currentPositions: [],
      buyingPower: null,
      sectorExposure: {},
      openRisk: null,
      greeks: { delta: null, gamma: null, theta: null, vega: null },
      availableCapital: null,
      maximumDailyLoss: null,
      adjustmentExplanation: `Portfolio context unavailable: ${(error as Error)?.message ?? 'unknown error'}.`,
    };
  }
}

export function portfolioSectorPenalty(portfolio: PortfolioContext, sectors: string[]): number {
  const total = Object.values(portfolio.sectorExposure).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return 0;
  const exposure = sectors.reduce((sum, sector) => sum + (portfolio.sectorExposure[sector] ?? 0), 0);
  const ratio = exposure / total;
  return ratio > 0.35 ? Math.min(20, (ratio - 0.35) * 50) : 0;
}
