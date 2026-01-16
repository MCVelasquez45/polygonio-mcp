import { EngineStrategy, EngineStrategyModel, LabStrategy, LabStrategyModel } from '../../handoff/models/strategyModel';

// Placeholder for Market Data Type
interface Candle {
  symbol: string;
  close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  timestamp: number;
}

export class StrategyExecutor {
  private engineStrategy: EngineStrategy;
  private labStrategy: LabStrategy | null = null;
  private isRunning: boolean = false;
  private currentPosition: number = 0;

  constructor(engineStrategy: EngineStrategy) {
    this.engineStrategy = engineStrategy;
  }

  async initialize() {
    // Load the parent Lab Strategy to get the Model Config
    const labStrategy = await LabStrategyModel.findById(this.engineStrategy.labStrategyId);
    if (!labStrategy) {
      throw new Error(`Lab Strategy ${this.engineStrategy.labStrategyId} not found`);
    }

    // This executor only handles quant strategies
    if (labStrategy.strategyType !== 'quant' || !labStrategy.modelConfig) {
      throw new Error(`Strategy ${labStrategy.name} is not a quant strategy or missing modelConfig`);
    }

    this.labStrategy = labStrategy;
    console.log(`[EXECUTOR] Initialized ${this.engineStrategy.name} (Model: ${labStrategy.modelConfig.type})`);
  }

  async start() {
    if (!this.labStrategy) await this.initialize();
    this.isRunning = true;
    console.log(`[EXECUTOR] Started strategy ${this.engineStrategy._id}`);

    // In a real implementation, we would subscribe to the specific symbol here
    // marketDataService.subscribe(this.engineStrategy.runtimeConfig.symbols[0], this.onCandle.bind(this));
  }

  async stop() {
    this.isRunning = false;
    console.log(`[EXECUTOR] Stopped strategy ${this.engineStrategy._id}`);
  }

  async onCandle(candle: Candle) {
    if (!this.isRunning || !this.labStrategy) return;

    // 1. Feature Extraction (Simplified)
    // Real implementation: FeatureEngine.update(candle) -> extract features
    const features = { log_return: 0.001 }; // Mock

    // 2. Model Prediction
    const signal = this.predict(features);

    // 3. Risk Check
    if (!this.checkRisk(signal)) return;

    // 4. Execution
    await this.execute(signal, candle.close);
  }

  private predict(features: any): number {
    const config = this.labStrategy?.modelConfig;
    if (!config) return 0;

    // AR1 / Linear Regression Logic
    if (config.type === 'AR1') {
      const weight = config.parameters.weights[0] || 0;
      const bias = config.parameters.bias || 0;
      const prediction = (features.log_return * weight) + bias;
      return prediction;
    }
    return 0;
  }

  private checkRisk(signal: number): boolean {
    const limits = this.engineStrategy.runtimeConfig.riskLimits;
    // Mock check: if daily loss > maxDailyLoss
    // if (currentLoss > limits.maxDailyLoss) return false;
    return true;
  }

  private async execute(signal: number, price: number) {
    // Taker Logic: if signal is strong enough, take liquidity
    const threshold = 0.0001;

    if (signal > threshold && this.currentPosition <= 0) {
      console.log(`[EXECUTOR] BUY Signal (${signal.toFixed(5)}) @ ${price}`);
      // await broker.submitOrder(...)
      this.currentPosition = 1;
    } else if (signal < -threshold && this.currentPosition >= 0) {
      console.log(`[EXECUTOR] SELL Signal (${signal.toFixed(5)}) @ ${price}`);
      // await broker.submitOrder(...)
      this.currentPosition = -1;
    }
  }
}
