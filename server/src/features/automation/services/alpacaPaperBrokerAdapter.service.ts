import {
  cancelAlpacaOrder,
  closeAlpacaPosition,
  getAlpacaAccount,
  getAlpacaClock,
  getAlpacaEnvironment,
  getAlpacaOrder,
  getAlpacaOrderByClientOrderId,
  listAlpacaOptionOrders,
  listAlpacaOptionPositions,
  submitAlpacaOptionsOrder,
} from '../../broker/services/alpaca';
import { BROKER_CALL_TIMEOUT_MS } from '../automation.constants';
import { BrokerUnavailableError, LiveTradingBlockedError } from '../automation.errors';
import type {
  ApprovedOrderIntent,
  BrokerAccount,
  BrokerClock,
  BrokerOrder,
  BrokerPosition,
} from '../automation.types';
import { logAutomationEvent, maskAccountId } from './automationAudit.service';
import { mapBrokerStatus, type PaperBrokerAdapter } from './brokerAdapter';

// Alpaca PAPER adapter. This file is the only place in features/automation
// that touches the Alpaca-backed service module, and it structurally refuses
// to exist against a live configuration.

const LIVE_HOST_PATTERN = /(^|\/\/)api\.alpaca\.markets/i;
const PAPER_HOST_PATTERN = /paper-api\.alpaca\.markets/i;

/**
 * Hard runtime guard. Throws LiveTradingBlockedError when the resolved Alpaca
 * configuration is anything other than unambiguous paper mode.
 */
export function assertPaperConfiguration(): void {
  const env = getAlpacaEnvironment();
  if (!env.paper) {
    throw new LiveTradingBlockedError('ALPACA_PAPER=false — automation only supports paper trading');
  }
  if (env.baseUrl) {
    if (LIVE_HOST_PATTERN.test(env.baseUrl) && !PAPER_HOST_PATTERN.test(env.baseUrl)) {
      throw new LiveTradingBlockedError('base URL points at the live Alpaca API');
    }
  }
}

function withTimeout<T>(promise: Promise<T>, label: string, ms = BROKER_CALL_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new BrokerUnavailableError(`${label} timed out after ${ms}ms`)),
      ms
    );
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function toNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const ts = Date.parse(String(value));
  return Number.isNaN(ts) ? null : new Date(ts);
}

function normalizeOrder(raw: any): BrokerOrder {
  const side = String(raw?.side ?? '').toLowerCase() === 'sell' ? 'SELL' : 'BUY';
  return {
    brokerOrderId: String(raw?.id ?? ''),
    clientOrderId: raw?.client_order_id ? String(raw.client_order_id) : null,
    symbol: String(raw?.symbol ?? ''),
    side,
    qty: toNumber(raw?.qty) ?? 0,
    filledQty: toNumber(raw?.filled_qty) ?? 0,
    avgFillPrice: toNumber(raw?.filled_avg_price),
    status: mapBrokerStatus(raw?.status),
    rawStatus: String(raw?.status ?? 'unknown'),
    orderType: String(raw?.type ?? raw?.order_type ?? 'unknown'),
    limitPrice: toNumber(raw?.limit_price),
    timeInForce: String(raw?.time_in_force ?? 'day'),
    submittedAt: toDate(raw?.submitted_at ?? raw?.created_at),
    updatedAt: toDate(raw?.updated_at ?? raw?.filled_at ?? raw?.canceled_at),
  };
}

function normalizePosition(raw: any): BrokerPosition {
  const qty = toNumber(raw?.qty) ?? 0;
  return {
    symbol: String(raw?.symbol ?? ''),
    qty: Math.abs(qty),
    side: qty < 0 || String(raw?.side ?? '').toLowerCase() === 'short' ? 'short' : 'long',
    avgEntryPrice: toNumber(raw?.avg_entry_price),
    marketValue: toNumber(raw?.market_value),
    unrealizedPnl: toNumber(raw?.unrealized_pl),
    assetClass: String(raw?.asset_class ?? raw?.assetClass ?? 'unknown'),
  };
}

export function createAlpacaPaperBrokerAdapter(): PaperBrokerAdapter {
  // Guard at construction AND before every submit — belt and braces.
  assertPaperConfiguration();

  return {
    describe() {
      return { name: 'alpaca', mode: 'alpaca-paper', paper: true as const };
    },

    async getAccount(): Promise<BrokerAccount> {
      const raw: any = await withTimeout(getAlpacaAccount(), 'getAccount');
      return {
        accountIdMasked: maskAccountId(raw?.account_number ?? raw?.id),
        buyingPower: toNumber(raw?.buying_power),
        equity: toNumber(raw?.equity),
        cash: toNumber(raw?.cash),
        currency: String(raw?.currency ?? 'USD'),
        isPaper: true,
      };
    },

    async getClock(): Promise<BrokerClock> {
      const raw: any = await withTimeout(getAlpacaClock(), 'getClock');
      return {
        asOf: toDate(raw?.timestamp) ?? new Date(),
        isOpen: Boolean(raw?.is_open),
        nextOpen: toDate(raw?.next_open),
        nextClose: toDate(raw?.next_close),
        source: 'alpaca-paper',
      };
    },

    async listOpenOrders(): Promise<BrokerOrder[]> {
      const raw = await withTimeout(listAlpacaOptionOrders({ status: 'open', limit: 200 }), 'listOpenOrders');
      return (Array.isArray(raw) ? raw : []).map(normalizeOrder);
    },

    async getOrder(orderId: string): Promise<BrokerOrder> {
      const raw = await withTimeout(getAlpacaOrder(orderId), 'getOrder');
      return normalizeOrder(raw);
    },

    async getOrderByClientOrderId(clientOrderId: string): Promise<BrokerOrder | null> {
      try {
        const raw = await withTimeout(getAlpacaOrderByClientOrderId(clientOrderId), 'getOrderByClientOrderId');
        return raw ? normalizeOrder(raw) : null;
      } catch (error: any) {
        if (error?.response?.status === 404 || error?.statusCode === 404) return null;
        throw error;
      }
    },

    async submitOrder(intent: ApprovedOrderIntent): Promise<BrokerOrder> {
      // Re-assert on the hot path: configuration may have been mutated at runtime.
      assertPaperConfiguration();
      logAutomationEvent({
        service: 'broker',
        event: 'BROKER_SUBMIT_ATTEMPT',
        intentId: intent.intentId,
        symbol: intent.symbol,
        payload: {
          clientOrderId: intent.clientOrderId,
          side: intent.side,
          quantity: intent.quantity,
          orderType: intent.orderType,
        },
      });
      const raw = await withTimeout(
        submitAlpacaOptionsOrder({
          legs: [
            {
              symbol: intent.symbol,
              qty: intent.quantity,
              side: intent.side.toLowerCase() as 'buy' | 'sell',
            },
          ],
          quantity: intent.quantity,
          time_in_force: intent.timeInForce,
          order_type: intent.orderType,
          limit_price: intent.limitPrice ?? undefined,
          client_order_id: intent.clientOrderId,
        }),
        'submitOrder'
      );
      return normalizeOrder(raw);
    },

    async cancelOrder(orderId: string): Promise<BrokerOrder> {
      await withTimeout(cancelAlpacaOrder(orderId), 'cancelOrder');
      // Alpaca cancel returns 204; fetch the order for its authoritative state.
      const raw = await withTimeout(getAlpacaOrder(orderId), 'cancelOrder:refetch');
      return normalizeOrder(raw);
    },

    async listPositions(): Promise<BrokerPosition[]> {
      const raw = await withTimeout(listAlpacaOptionPositions(), 'listPositions');
      return (Array.isArray(raw) ? raw : []).map(normalizePosition);
    },

    async getPosition(symbol: string): Promise<BrokerPosition | null> {
      const positions = await this.listPositions();
      const target = symbol.toUpperCase().replace(/^O:/, '');
      return positions.find(pos => pos.symbol.toUpperCase().replace(/^O:/, '') === target) ?? null;
    },

    async closePosition(symbol: string, reason: string): Promise<BrokerOrder> {
      assertPaperConfiguration();
      logAutomationEvent({
        service: 'broker',
        event: 'BROKER_CLOSE_POSITION_ATTEMPT',
        symbol,
        severity: 'warning',
        payload: { reason },
      });
      const raw = await withTimeout(closeAlpacaPosition(symbol), 'closePosition');
      return normalizeOrder(raw);
    },
  };
}
