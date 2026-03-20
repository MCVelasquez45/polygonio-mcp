import axios from 'axios';
import { EngineStrategy, EngineStrategyModel, LabStrategyModel } from '../../handoff/models/strategyModel';
import { io } from '../../../index';

// Schedule configuration for screener execution
interface ScheduleConfig {
  type: 'cron' | 'interval' | 'manual';
  pattern?: string; // e.g., '35 9 * * 1-5' for 9:35 AM weekdays
  intervalMs?: number;
}

export class ScreenerScheduler {
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private isRunning: boolean = false;

  async start() {
    console.log('[SCREENER_SCHEDULER] Starting screener scheduler...');
    this.isRunning = true;

    // Load all active screener strategies
    const screeners = await EngineStrategyModel.find({
      strategyType: 'screener',
      status: 'active'
    });

    console.log(`[SCREENER_SCHEDULER] Found ${screeners.length} active screener strategies`);

    for (const strategy of screeners) {
      await this.scheduleStrategy(strategy);
    }
  }

  async scheduleStrategy(strategy: EngineStrategy) {
    const labStrategy = await LabStrategyModel.findById(strategy.labStrategyId);
    if (!labStrategy || !labStrategy.screenerConfig) {
      console.error(`[SCREENER_SCHEDULER] Lab strategy or config not found for ${strategy._id}`);
      return;
    }

    const schedule = labStrategy.screenerConfig.schedule || 'manual';
    console.log(`[SCREENER_SCHEDULER] Scheduling ${strategy.name} with schedule: ${schedule}`);

    if (schedule === 'daily_at_935') {
      // Run at 9:35 AM ET every weekday
      this.scheduleDailyExecution(strategy, labStrategy.screenerConfig);
    } else if (schedule === 'hourly') {
      // Run every hour
      const intervalMs = 60 * 60 * 1000;
      this.scheduleIntervalExecution(strategy, labStrategy.screenerConfig, intervalMs);
    } else if (schedule === 'manual') {
      console.log(`[SCREENER_SCHEDULER] Strategy ${strategy.name} set to manual execution only`);
    }
  }

  private scheduleDailyExecution(strategy: EngineStrategy, screenerConfig: any) {
    // Simplified: Check every minute if it's time to run
    const timer = setInterval(async () => {
      const now = new Date();
      const hour = now.getHours();
      const minute = now.getMinutes();
      const day = now.getDay();

      // Run at 9:35 AM on weekdays (1=Mon, 5=Fri)
      if (hour === 9 && minute === 35 && day >= 1 && day <= 5) {
        await this.executeScreener(strategy, screenerConfig);
      }
    }, 60 * 1000); // Check every minute

    this.timers.set(strategy._id.toString(), timer);
  }

  private scheduleIntervalExecution(strategy: EngineStrategy, screenerConfig: any, intervalMs: number) {
    const timer = setInterval(async () => {
      await this.executeScreener(strategy, screenerConfig);
    }, intervalMs);

    this.timers.set(strategy._id.toString(), timer);
  }

  private async executeScreener(strategy: EngineStrategy, screenerConfig: any) {
    console.log(`[SCREENER_SCHEDULER] Executing screener: ${strategy.name}`);

    try {
      // Call Python screener service
      const response = await axios.post(screenerConfig.endpoint, {
        ...screenerConfig.params,
        symbol: strategy.runtimeConfig.symbols[0]
      });

      const opportunities = response.data;

      if (opportunities && opportunities.length > 0) {
        const best = opportunities[0];
        console.log(`[SCREENER_SCHEDULER] Best opportunity: ${best.ticker} @ ${best.mid}`);

        // Emit to connected clients (for UI monitoring)
        io.emit('screener_signal', {
          strategyId: strategy._id,
          strategyName: strategy.name,
          opportunity: best,
          timestamp: new Date()
        });

        // TODO: Execute trade via broker
        // await broker.submitOrder({
        //   symbol: best.ticker,
        //   side: 'sell',
        //   type: 'limit',
        //   qty: 1,
        //   limit_price: best.mid
        // });

        // Update strategy state
        await EngineStrategyModel.findByIdAndUpdate(strategy._id, {
          'state.lastRun': new Date()
        });
      } else {
        console.log(`[SCREENER_SCHEDULER] No opportunities found for ${strategy.name}`);
      }
    } catch (error: any) {
      console.error(`[SCREENER_SCHEDULER] Error executing screener ${strategy.name}:`, error.message);
    }
  }

  async stop() {
    console.log('[SCREENER_SCHEDULER] Stopping all scheduled screeners...');
    this.isRunning = false;

    for (const [strategyId, timer] of this.timers) {
      clearInterval(timer);
      console.log(`[SCREENER_SCHEDULER] Stopped timer for strategy ${strategyId}`);
    }

    this.timers.clear();
  }

  async manualTrigger(strategyId: string) {
    const strategy = await EngineStrategyModel.findById(strategyId);
    if (!strategy) {
      throw new Error(`Strategy ${strategyId} not found`);
    }

    const labStrategy = await LabStrategyModel.findById(strategy.labStrategyId);
    if (!labStrategy || !labStrategy.screenerConfig) {
      throw new Error('Screener config not found');
    }

    await this.executeScreener(strategy, labStrategy.screenerConfig);
  }
}

// Singleton instance
export const screenerScheduler = new ScreenerScheduler();
