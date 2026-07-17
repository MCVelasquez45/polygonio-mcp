import { useNow } from '../../hooks/useNow';
import { fmtDuration } from '../../lib/marketFormat';
import { Panel, Pill, statusTone, type CockpitTrade, type OrderCardData } from './cockpitUi';
import { moneyOrReason, numberOrReason, statusOrReason, timestampOrReason } from './cockpitDisplay';

function TimeoutCountdown({ deadline }: { deadline: string | null }) {
  const now = useNow(1000);
  if (!deadline) return null;
  const ms = Date.parse(deadline) - now;
  if (!Number.isFinite(ms)) return null;
  const expired = ms <= 0;
  return (
    <span className={`text-[11px] tabular-nums ${expired ? 'text-red-300' : 'text-amber-200'}`}>
      timeout {expired ? 'elapsed' : `in ${fmtDuration(ms)}`}
    </span>
  );
}

function StatusTimeline({ events }: { events: OrderCardData['statusHistory'] }) {
  if (!events?.length) return null;
  return (
    <div className="mt-2 border-t border-gray-900/60 pt-2">
      <div className="flex flex-wrap gap-1">
        {events.slice(-6).map((e, i) => (
          <span
            key={`${e.status}-${e.at}-${i}`}
            title={`${statusOrReason(e.status, 'Status not captured')} / ${statusOrReason(e.source, 'Source not captured')} / ${timestampOrReason(e.at, 'Timestamp not captured')}`}
            className="rounded border border-gray-800 bg-gray-900/60 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-gray-400"
          >
            {statusOrReason(e.status, 'Status not captured')}
          </span>
        ))}
      </div>
    </div>
  );
}

function OrderCard({
  order,
  role,
  maxRetries,
}: {
  order: OrderCardData | null;
  role: 'ENTRY' | 'EXIT';
  maxRetries?: number | null;
}) {
  if (!order) {
    return (
      <div className="rounded-lg border border-gray-900 bg-black/30 p-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-gray-500">{role}</span>
          <Pill tone="neutral">{role === 'EXIT' ? 'not submitted' : 'not found'}</Pill>
        </div>
        <p className="mt-2 text-[11px] text-gray-600">
          {role === 'EXIT'
            ? 'No active exit order has been submitted for this position.'
            : 'Entry order was not found in broker/order history.'}
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-gray-900 bg-black/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-widest text-gray-500">{role}</span>
        <div className="flex items-center gap-2">
          <TimeoutCountdown deadline={order.timeoutDeadline} />
          <Pill tone={statusTone(order.status)}>{statusOrReason(order.status, 'Status not captured')}</Pill>
        </div>
      </div>
      <div className="mt-1 flex items-baseline justify-between tabular-nums">
        <span className="text-sm text-gray-200">
          {numberOrReason(order.filledQty, 'Filled qty not captured')}/{numberOrReason(order.qty, 'Qty not captured')} @{' '}
          {moneyOrReason(order.avgFillPrice ?? order.limitPrice, 'Fill/limit price not captured')}
        </span>
        <span className="text-[11px] text-gray-500">
          {statusOrReason(order.orderType, 'Order type not captured')} {order.timeInForce ? `/ ${order.timeInForce.toUpperCase()}` : ''}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-500">
        {order.remainingQty != null ? <span>remaining {numberOrReason(order.remainingQty, 'Remaining qty not captured')}</span> : null}
        {role === 'EXIT' && order.attemptCount != null ? (
          <span>retry {order.attemptCount}/{maxRetries ?? 'Max retries not captured'}</span>
        ) : null}
        {order.brokerOrderId ? <span className="truncate" title={order.brokerOrderId}>broker {order.brokerOrderId.slice(0, 8)}</span> : null}
        {order.submittedAt ? <span>{timestampOrReason(order.submittedAt, 'Submitted timestamp not captured')}</span> : null}
      </div>
      <StatusTimeline events={order.statusHistory} />
    </div>
  );
}

/**
 * Execution - the broker's view of this position's orders: entry and exit
 * lifecycle, fills/remaining, retry count, timeout countdown, and the durable
 * status timeline. No Alpaca tab required.
 */
export function ExecutionPanel({ trade }: { trade: CockpitTrade }) {
  const execution = trade.execution;
  return (
    <Panel title="Execution">
      <div className="flex flex-col gap-2">
        <OrderCard role="ENTRY" order={execution?.entry ?? null} />
        <OrderCard role="EXIT" order={execution?.exit ?? null} maxRetries={execution?.maxExitRetries ?? null} />
      </div>
    </Panel>
  );
}
