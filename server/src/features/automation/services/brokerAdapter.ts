import type {
  ApprovedOrderIntent,
  BrokerAccount,
  BrokerClock,
  BrokerOrder,
  BrokerPosition,
} from '../automation.types';

// THE broker boundary.
//
// Automation code talks to this interface and nothing else. The Alpaca SDK is
// only reachable through features/broker/services/alpaca.ts, which only the
// Alpaca adapter imports. Nothing in features/automation may import the SDK,
// and no adapter may be constructed against a live-trading configuration.

export interface PaperBrokerAdapter {
  /** Human-readable adapter identity. `paper` is always true by construction. */
  describe(): { name: string; mode: 'alpaca-paper' | 'mock'; paper: true };

  getAccount(): Promise<BrokerAccount>;
  getClock(): Promise<BrokerClock>;

  listOpenOrders(): Promise<BrokerOrder[]>;
  getOrder(orderId: string): Promise<BrokerOrder>;
  /** Lookup by our idempotent client_order_id — the reconciliation primitive. */
  getOrderByClientOrderId(clientOrderId: string): Promise<BrokerOrder | null>;
  submitOrder(intent: ApprovedOrderIntent): Promise<BrokerOrder>;
  cancelOrder(orderId: string): Promise<BrokerOrder>;

  listPositions(): Promise<BrokerPosition[]>;
  getPosition(symbol: string): Promise<BrokerPosition | null>;
  closePosition(symbol: string, reason: string): Promise<BrokerOrder>;
}

/** Map a raw Alpaca-style order status onto the journal's closed status set. */
export function mapBrokerStatus(rawStatus: string | null | undefined): BrokerOrder['status'] {
  const raw = String(rawStatus ?? '').toLowerCase();
  switch (raw) {
    case 'new':
    case 'pending_new':
      return 'PENDING_NEW';
    case 'accepted':
    case 'accepted_for_bidding':
    case 'done_for_day':
    case 'calculated':
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
    case 'pending_replace':
      return 'REPLACED';
    default:
      return 'UNKNOWN';
  }
}
