import { runStrategyOrchestrator } from '../controllers/orchestrator.service';

const INTERVAL_MS = Math.max(60_000, Number(process.env.STRATEGY_ORCHESTRATOR_INTERVAL_MS ?? 180_000));
let timer: NodeJS.Timeout | null = null;

export function startStrategyOrchestratorScheduler(): void {
  if (timer || process.env.STRATEGY_ORCHESTRATOR_AUTO_START !== 'true') return;
  timer = setInterval(() => {
    runStrategyOrchestrator().catch(error => {
      console.warn('[strategy-orchestrator] run failed', { error: (error as Error)?.message });
    });
  }, INTERVAL_MS);
}

export function stopStrategyOrchestratorScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
