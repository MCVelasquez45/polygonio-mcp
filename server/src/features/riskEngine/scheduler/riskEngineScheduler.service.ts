import { runRiskReview } from '../controllers/riskEngine.service';

let timer: NodeJS.Timeout | null = null;

function intervalMs(): number {
  const parsed = Number(process.env.RISK_ENGINE_INTERVAL_MS ?? 120_000);
  return Number.isFinite(parsed) ? Math.max(30_000, parsed) : 120_000;
}

export function startRiskEngineScheduler(): void {
  if ((process.env.RISK_ENGINE_AUTO_START ?? 'false').toLowerCase() !== 'true') return;
  if (timer) return;
  timer = setInterval(() => {
    runRiskReview().catch(error => {
      console.warn('[RiskEngine] scheduled review failed', { message: (error as Error)?.message ?? 'unknown error' });
    });
  }, intervalMs());
}

export function stopRiskEngineScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
