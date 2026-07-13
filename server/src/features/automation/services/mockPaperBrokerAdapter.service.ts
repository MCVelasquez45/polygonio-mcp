import { BrokerUnavailableError } from '../automation.errors';
import type {
  ApprovedOrderIntent,
  BrokerClock,
  BrokerOrder,
  BrokerOrderStatus,
  BrokerPosition,
} from '../automation.types';
import type { PaperBrokerAdapter } from './brokerAdapter';

// Deterministic mock broker for tests. No network, no randomness, no clocks —
// every behavior is scripted by the test. Simulates: accept, reject, partial
// fill, full fill, cancel, expire, timeout, duplicate client_order_id,
// open/orphaned positions, and open/closed/unknown market clock states.

export type MockOrderScript = {
  /** Outcome applied at submit time. Default: 'accept'. */
  onSubmit?: 'accept' | 'reject' | 'timeout' | 'fill' | 'partial_fill';
  rejectReason?: string;
  /** Sequence of statuses returned by successive getOrder polls (after submit). */
  pollSequence?: Array<{
    rawStatus: string;
    filledQty?: number;
    avgFillPrice?: number;
  }>;
};

export type MockClockState = 'open' | 'closed' | 'unknown';

type StoredOrder = BrokerOrder & {
  pollScript: MockOrderScript['pollSequence'];
  pollIndex: number;
  /** Cumulative filled qty already reflected in the position book (increment guard). */
  appliedQty: number;
};

let orderSeq = 0;

export class MockPaperBrokerAdapter implements PaperBrokerAdapter {
  private orders = new Map<string, StoredOrder>();
  private byClientId = new Map<string, string>();
  private positions = new Map<string, BrokerPosition>();
  private scripts = new Map<string, MockOrderScript>();
  private defaultScript: MockOrderScript = { onSubmit: 'accept' };
  private clockState: MockClockState = 'open';
  private clockFails = false;
  private accountFails = false;
  /** Price a market order (no limit) fills at — the prevailing price stand-in. */
  private marketFillPrice = 1;

  public submitCalls = 0;

  describe() {
    return { name: 'mock', mode: 'mock' as const, paper: true as const };
  }

  // ---- test controls -------------------------------------------------------

  setClock(state: MockClockState) {
    this.clockState = state;
  }

  /** Makes getClock() throw — simulates a broker outage / unknown market state. */
  failClock(fail = true) {
    this.clockFails = fail;
  }

  failAccount(fail = true) {
    this.accountFails = fail;
  }

  scriptOrder(clientOrderId: string, script: MockOrderScript) {
    this.scripts.set(clientOrderId, script);
  }

  setDefaultScript(script: MockOrderScript) {
    this.defaultScript = script;
  }

  /** Price a market order fills at (used for market exits with no limit price). */
  setMarketFillPrice(price: number) {
    this.marketFillPrice = price;
  }

  /** Seed a position with no corresponding order — an orphan for reconciliation. */
  seedPosition(position: Partial<BrokerPosition> & { symbol: string }) {
    this.positions.set(position.symbol.toUpperCase(), {
      symbol: position.symbol.toUpperCase(),
      qty: position.qty ?? 1,
      side: position.side ?? 'long',
      avgEntryPrice: position.avgEntryPrice ?? 1,
      marketValue: position.marketValue ?? null,
      unrealizedPnl: position.unrealizedPnl ?? null,
      assetClass: position.assetClass ?? 'us_option',
    });
  }

  /** Seed a broker-side order the local journal knows nothing about. */
  seedUnknownOrder(partial: Partial<BrokerOrder> & { symbol: string }): BrokerOrder {
    const order = this.buildOrder(partial.symbol, {
      clientOrderId: partial.clientOrderId ?? null,
      side: partial.side ?? 'BUY',
      qty: partial.qty ?? 1,
      rawStatus: partial.rawStatus ?? 'new',
      status: partial.status ?? 'PENDING_NEW',
    });
    this.orders.set(order.brokerOrderId, { ...order, pollScript: undefined, pollIndex: 0, appliedQty: order.filledQty });
    if (order.clientOrderId) this.byClientId.set(order.clientOrderId, order.brokerOrderId);
    return order;
  }

  // ---- PaperBrokerAdapter --------------------------------------------------

  async getAccount() {
    if (this.accountFails) throw new BrokerUnavailableError('mock account unavailable');
    return {
      accountIdMasked: '****MOCK',
      buyingPower: 100_000,
      equity: 100_000,
      cash: 100_000,
      currency: 'USD',
      isPaper: true as const,
    };
  }

  async getClock(): Promise<BrokerClock> {
    if (this.clockFails || this.clockState === 'unknown') {
      throw new BrokerUnavailableError('mock clock unavailable');
    }
    return {
      asOf: new Date('2026-07-10T15:00:00.000Z'),
      isOpen: this.clockState === 'open',
      nextOpen: new Date('2026-07-13T13:30:00.000Z'),
      nextClose: new Date('2026-07-10T20:00:00.000Z'),
      source: 'mock',
    };
  }

  async listOpenOrders(): Promise<BrokerOrder[]> {
    return [...this.orders.values()]
      .filter(order => ['PENDING_NEW', 'ACCEPTED', 'PARTIALLY_FILLED', 'CANCEL_PENDING'].includes(order.status))
      .map(order => this.snapshot(order));
  }

  async getOrder(orderId: string): Promise<BrokerOrder> {
    const stored = this.orders.get(orderId);
    if (!stored) throw new BrokerUnavailableError(`mock order ${orderId} not found`);
    // Advance the scripted poll sequence, if any.
    if (stored.pollScript && stored.pollIndex < stored.pollScript.length) {
      const step = stored.pollScript[stored.pollIndex];
      stored.pollIndex += 1;
      stored.rawStatus = step.rawStatus;
      stored.status = this.mapStatus(step.rawStatus);
      if (step.filledQty != null) stored.filledQty = step.filledQty;
      if (step.avgFillPrice != null) stored.avgFillPrice = step.avgFillPrice;
      stored.updatedAt = new Date();
      // Reflect newly-filled quantity in the position book, exactly like a real
      // broker whose position appears once fills confirm on the order.
      const increment = stored.filledQty - stored.appliedQty;
      if (increment > 0) {
        this.applyFillToPositions(stored, increment, stored.avgFillPrice ?? this.marketFillPrice);
        stored.appliedQty = stored.filledQty;
      }
    }
    return this.snapshot(stored);
  }

  async getOrderByClientOrderId(clientOrderId: string): Promise<BrokerOrder | null> {
    const id = this.byClientId.get(clientOrderId);
    if (!id) return null;
    return this.getOrder(id);
  }

  async submitOrder(intent: ApprovedOrderIntent): Promise<BrokerOrder> {
    this.submitCalls += 1;

    // Duplicate client_order_id: brokers return the existing order, never a new one.
    const existingId = this.byClientId.get(intent.clientOrderId);
    if (existingId) {
      return this.snapshot(this.orders.get(existingId)!);
    }

    const script = this.scripts.get(intent.clientOrderId) ?? this.defaultScript;
    const outcome = script.onSubmit ?? 'accept';

    if (outcome === 'timeout') {
      throw new BrokerUnavailableError('mock submit timed out');
    }

    let rawStatus = 'accepted';
    let filledQty = 0;
    let avgFillPrice: number | null = null;
    if (outcome === 'reject') {
      rawStatus = 'rejected';
    } else if (outcome === 'fill') {
      rawStatus = 'filled';
      filledQty = intent.quantity;
      avgFillPrice = intent.limitPrice ?? this.marketFillPrice;
    } else if (outcome === 'partial_fill') {
      rawStatus = 'partially_filled';
      filledQty = Math.max(1, Math.floor(intent.quantity / 2));
      avgFillPrice = intent.limitPrice ?? this.marketFillPrice;
    }

    const order = this.buildOrder(intent.symbol, {
      clientOrderId: intent.clientOrderId,
      side: intent.side,
      qty: intent.quantity,
      rawStatus,
      status: this.mapStatus(rawStatus),
      filledQty,
      avgFillPrice,
      orderType: intent.orderType,
      limitPrice: intent.limitPrice ?? null,
      timeInForce: intent.timeInForce,
    });
    this.orders.set(order.brokerOrderId, {
      ...order,
      pollScript: script.pollSequence,
      pollIndex: 0,
      appliedQty: filledQty,
    });
    this.byClientId.set(intent.clientOrderId, order.brokerOrderId);

    if (rawStatus === 'filled' || rawStatus === 'partially_filled') {
      this.applyFillToPositions(order, filledQty, avgFillPrice ?? 1);
    }
    return order;
  }

  async cancelOrder(orderId: string): Promise<BrokerOrder> {
    const stored = this.orders.get(orderId);
    if (!stored) throw new BrokerUnavailableError(`mock order ${orderId} not found`);
    if (!['FILLED', 'REJECTED', 'EXPIRED'].includes(stored.status)) {
      stored.rawStatus = 'canceled';
      stored.status = 'CANCELLED';
      stored.updatedAt = new Date();
    }
    return this.snapshot(stored);
  }

  async listPositions(): Promise<BrokerPosition[]> {
    return [...this.positions.values()].map(pos => ({ ...pos }));
  }

  async getPosition(symbol: string): Promise<BrokerPosition | null> {
    const found = this.positions.get(symbol.toUpperCase());
    return found ? { ...found } : null;
  }

  async closePosition(symbol: string, _reason: string): Promise<BrokerOrder> {
    const key = symbol.toUpperCase();
    const pos = this.positions.get(key);
    if (!pos) throw new BrokerUnavailableError(`mock position ${symbol} not found`);
    this.positions.delete(key);
    const order = this.buildOrder(key, {
      clientOrderId: null,
      side: pos.side === 'long' ? 'SELL' : 'BUY',
      qty: pos.qty,
      rawStatus: 'filled',
      status: 'FILLED',
      filledQty: pos.qty,
      avgFillPrice: pos.avgEntryPrice ?? 1,
    });
    this.orders.set(order.brokerOrderId, { ...order, pollScript: undefined, pollIndex: 0, appliedQty: order.filledQty });
    return order;
  }

  // ---- internals -----------------------------------------------------------

  private buildOrder(
    symbol: string,
    overrides: Partial<BrokerOrder> & { rawStatus: string; status: BrokerOrderStatus }
  ): BrokerOrder {
    orderSeq += 1;
    return {
      brokerOrderId: `mock-order-${orderSeq}`,
      clientOrderId: overrides.clientOrderId ?? null,
      symbol: symbol.toUpperCase(),
      side: overrides.side ?? 'BUY',
      qty: overrides.qty ?? 1,
      filledQty: overrides.filledQty ?? 0,
      avgFillPrice: overrides.avgFillPrice ?? null,
      status: overrides.status,
      rawStatus: overrides.rawStatus,
      orderType: overrides.orderType ?? 'limit',
      limitPrice: overrides.limitPrice ?? null,
      timeInForce: overrides.timeInForce ?? 'day',
      submittedAt: new Date(),
      updatedAt: new Date(),
    };
  }

  private snapshot(order: StoredOrder | BrokerOrder): BrokerOrder {
    const { pollScript: _script, pollIndex: _idx, appliedQty: _applied, ...rest } = order as StoredOrder;
    return { ...rest };
  }

  private mapStatus(rawStatus: string): BrokerOrderStatus {
    switch (rawStatus) {
      case 'new':
      case 'pending_new':
        return 'PENDING_NEW';
      case 'accepted':
        return 'ACCEPTED';
      case 'partially_filled':
        return 'PARTIALLY_FILLED';
      case 'filled':
        return 'FILLED';
      case 'pending_cancel':
        return 'CANCEL_PENDING';
      case 'canceled':
      case 'cancelled':
        return 'CANCELLED';
      case 'rejected':
        return 'REJECTED';
      case 'expired':
        return 'EXPIRED';
      case 'replaced':
        return 'REPLACED';
      default:
        return 'UNKNOWN';
    }
  }

  private applyFillToPositions(order: BrokerOrder, filledQty: number, price: number) {
    const key = order.symbol.toUpperCase();
    const existing = this.positions.get(key);
    const delta = order.side === 'BUY' ? filledQty : -filledQty;
    const nextQty = (existing ? (existing.side === 'short' ? -existing.qty : existing.qty) : 0) + delta;
    if (nextQty === 0) {
      this.positions.delete(key);
      return;
    }
    this.positions.set(key, {
      symbol: key,
      qty: Math.abs(nextQty),
      side: nextQty < 0 ? 'short' : 'long',
      avgEntryPrice: price,
      marketValue: null,
      unrealizedPnl: null,
      assetClass: 'us_option',
    });
  }
}
