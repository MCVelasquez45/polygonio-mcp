import { useEffect, useMemo, useState } from 'react';
import type { QuoteSnapshot, TradePrint, OptionContractDetail } from '../../types/market';
import { AlertTriangle, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { getBrokerAccount, submitOptionOrder, type SubmitOptionsOrderPayload } from '../../api/alpaca';

type Props = {
  contract?: OptionContractDetail | null;
  quote?: QuoteSnapshot | null;
  trades: TradePrint[];
  isLoading: boolean;
  label?: string;
  spotPrice?: number | null;
  marketClosed?: boolean;
  afterHours?: boolean;
  nextOpen?: string | null;
};

type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';
type OrderIntent = 'buy_to_open' | 'sell_to_open' | 'buy_to_close' | 'sell_to_close';
type QtyMode = 'shares' | 'contracts' | 'dollars';
type OrderClass = 'simple' | 'bracket' | 'oco' | 'oto' | 'mleg';

type OrderDraftLeg = {
  symbol: string;
  qty: number;
  side: 'buy' | 'sell';
  position_intent: OrderIntent;
};

type OrderDraft = {
  instrument: string;
  assetType: 'stock' | 'option';
  side: 'buy' | 'sell';
  intent: OrderIntent;
  qtyMode: QtyMode;
  qty: number;
  orderType: OrderType;
  prices: {
    limit?: number;
    stop?: number;
    trail?: {
      type: 'percent' | 'amount';
      value: number;
    };
  };
  timeInForce: 'day' | 'gtc';
  orderClass: OrderClass;
  legs?: OrderDraftLeg[];
  riskProfile?: string;
  aiConfidence?: number;
};

function formatCountdown(value?: string | null): string | null {
  if (!value) return null;
  const target = Date.parse(value);
  if (Number.isNaN(target)) return null;
  const delta = target - Date.now();
  if (delta <= 0) return new Date(target).toLocaleString();
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `in ${days}d ${remainingHours}h`;
}

function resolveDefaultLegPrice(
  contract?: OptionContractDetail | null,
  quote?: QuoteSnapshot | null,
  spotPrice?: number | null
) {
  if (quote?.midpoint != null) return quote.midpoint;
  if (contract?.lastTrade?.price != null) return contract.lastTrade.price;
  if (contract?.lastQuote?.bid != null && contract.lastQuote.ask != null) {
    return (Number(contract.lastQuote.bid) + Number(contract.lastQuote.ask)) / 2;
  }
  if (spotPrice != null) return spotPrice;
  return null;
}

export function OrderTicketPanel({
  contract,
  quote,
  trades,
  isLoading,
  label,
  spotPrice,
  marketClosed,
  afterHours,
  nextOpen
}: Props) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<OrderType>('limit');
  const [timeInForce, setTimeInForce] = useState<'day' | 'gtc'>('day');
  const [qtyMode, setQtyMode] = useState<QtyMode>('contracts');
  const [quantity, setQuantity] = useState(1);
  const [limitPrice, setLimitPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [trailType, setTrailType] = useState<'percent' | 'amount'>('percent');
  const [trailValue, setTrailValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submissionResult, setSubmissionResult] = useState<{ status: 'success' | 'error'; message: string } | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [riskOpen, setRiskOpen] = useState(false);
  const [buyingPower, setBuyingPower] = useState<number | null>(null);
  const [buyingPowerLoading, setBuyingPowerLoading] = useState(false);

  useEffect(() => {
    setQuantity(1);
    setSide('buy');
    setOrderType('limit');
    setTimeInForce('day');
    setQtyMode(contract?.ticker ? 'contracts' : 'shares');
    setLimitPrice(resolveDefaultLegPrice(contract, quote, spotPrice)?.toFixed(2) ?? '');
    setStopPrice('');
    setTrailValue('');
    setSubmissionResult(null);
  }, [contract?.ticker]);

  useEffect(() => {
    if (marketClosed && orderType === 'market') {
      setOrderType('limit');
    }
  }, [marketClosed, orderType]);

  useEffect(() => {
    let cancelled = false;
    setBuyingPowerLoading(true);
    getBrokerAccount()
      .then(account => {
        if (cancelled) return;
        const power = Number(account.buying_power ?? 0);
        setBuyingPower(Number.isFinite(power) ? power : null);
      })
      .catch(() => {
        if (!cancelled) setBuyingPower(null);
      })
      .finally(() => {
        if (!cancelled) setBuyingPowerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const markPrice = useMemo(() => {
    if (quote?.midpoint) return quote.midpoint;
    if (contract?.lastQuote?.bid != null && contract?.lastQuote?.ask != null) {
      return (Number(contract.lastQuote.bid) + Number(contract.lastQuote.ask)) / 2;
    }
    if (contract?.lastTrade?.price) return contract.lastTrade.price;
    if (spotPrice != null) return spotPrice;
    return null;
  }, [contract, quote, spotPrice]);

  const assetType: OrderDraft['assetType'] = contract?.ticker ? 'option' : 'stock';
  const primaryQtyMode: QtyMode = assetType === 'option' ? 'contracts' : 'shares';
  const notionalDisabled = assetType !== 'stock';
  const multiplier = contract?.ticker ? 100 : 1;
  const limitValue = Number.isFinite(Number(limitPrice)) ? Number(limitPrice) : null;
  const stopValue = Number.isFinite(Number(stopPrice)) ? Number(stopPrice) : null;
  const trailValueNum = Number.isFinite(Number(trailValue)) ? Number(trailValue) : null;
  const requiresLimit = orderType === 'limit' || orderType === 'stop_limit';
  const requiresStop = orderType === 'stop' || orderType === 'stop_limit';
  const requiresTrail = orderType === 'trailing_stop';
  const estimatePrice = requiresLimit
    ? limitValue
    : requiresStop
    ? stopValue
    : markPrice;
  const estimatedCost =
    estimatePrice != null && quantity > 0 ? estimatePrice * quantity * multiplier : null;
  const estimatedLabel = side === 'sell' ? 'Estimated Credit' : 'Estimated Cost';
  const insufficientFunds =
    side === 'buy' &&
    estimatedCost != null &&
    buyingPower != null &&
    Number.isFinite(buyingPower) &&
    estimatedCost > buyingPower;
  const priceForBreakeven = limitValue ?? markPrice ?? null;
  const breakevenPrice =
    contract?.strike != null && priceForBreakeven != null
      ? contract.type?.toLowerCase() === 'put'
        ? contract.strike - priceForBreakeven
        : contract.strike + priceForBreakeven
      : null;
  const costBasis = estimatedCost;
  const maxLoss =
    side === 'buy' && estimatedCost != null ? estimatedCost : null;
  const orderTypeLabel = {
    market: 'Market',
    limit: 'Limit',
    stop: 'Stop',
    stop_limit: 'Stop Limit',
    trailing_stop: 'Trailing Stop'
  }[orderType];
  const quantityLabel =
    qtyMode === 'dollars' ? 'Dollars' : assetType === 'option' ? 'Contracts' : 'Shares';
  const symbolDisplay = contract?.ticker ?? label ?? '—';
  const marketPriceDisplay = markPrice != null ? `$${markPrice.toFixed(2)}` : '—';
  const canSubmit =
    Boolean(contract?.ticker) &&
    quantity > 0 &&
    (!requiresLimit || limitValue != null) &&
    (!requiresStop || stopValue != null) &&
    (!requiresTrail || trailValueNum != null) &&
    !insufficientFunds &&
    !submitting;

  function buildOrderDraft(): OrderDraft | null {
    if (!contract?.ticker) return null;
    const intent: OrderIntent = side === 'buy' ? 'buy_to_open' : 'sell_to_close';
    const prices: OrderDraft['prices'] = {};
    if (requiresLimit && limitValue != null) prices.limit = limitValue;
    if (requiresStop && stopValue != null) prices.stop = stopValue;
    if (requiresTrail && trailValueNum != null) {
      prices.trail = { type: trailType, value: trailValueNum };
    }
    return {
      instrument: contract.ticker,
      assetType,
      side,
      intent,
      qtyMode,
      qty: quantity,
      orderType,
      prices,
      timeInForce,
      orderClass: 'simple',
      legs: [
        {
          symbol: contract.ticker,
          qty: 1,
          side,
          position_intent: intent
        }
      ]
    };
  }

  function mapOrderDraftToPayload(draft: OrderDraft): SubmitOptionsOrderPayload {
    const trail = draft.prices.trail;
    const orderClass: SubmitOptionsOrderPayload['order_class'] =
      draft.orderClass === 'mleg' ? 'multi-leg' : 'simple';
    return {
      legs: draft.legs ?? [
        {
          symbol: draft.instrument,
          qty: 1,
          side: draft.side,
          position_intent: draft.intent
        }
      ],
      quantity: draft.qty,
      time_in_force: draft.timeInForce,
      order_type: draft.orderType,
      order_class: orderClass,
      limit_price: draft.prices.limit != null ? Number(draft.prices.limit.toFixed(2)) : undefined,
      stop_price: draft.prices.stop != null ? Number(draft.prices.stop.toFixed(2)) : undefined,
      trail_price:
        trail && trail.type === 'amount' ? Number(trail.value.toFixed(2)) : undefined,
      trail_percent:
        trail && trail.type === 'percent' ? Number(trail.value.toFixed(2)) : undefined,
      client_order_id: `mcp-${Date.now()}`
    };
  }

  async function handleSubmit() {
    const draft = buildOrderDraft();
    if (!draft) return;
    setSubmitting(true);
    setSubmissionResult(null);
    try {
      const payload = mapOrderDraftToPayload(draft);
      console.log('[CLIENT] submitting Alpaca options order', payload);
      await submitOptionOrder(payload);
      setSubmissionResult({ status: 'success', message: 'Order submitted to Alpaca paper trading.' });
    } catch (error: any) {
      const message = error?.response?.data?.message ?? error?.message ?? 'Failed to submit order';
      setSubmissionResult({ status: 'error', message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="bg-gray-950 border border-gray-900 rounded-2xl h-full flex flex-col">
      <header className="p-4 border-b border-gray-900">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Order Ticket</p>
            <p className="text-lg font-semibold text-gray-100">{label ?? contract?.ticker ?? 'Select a contract'}</p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {(marketClosed || afterHours) && (
          <div
            className={`rounded-xl border px-3 py-2 text-xs ${
              marketClosed
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
                : 'border-sky-500/40 bg-sky-500/10 text-sky-100'
            }`}
          >
            <p className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-3.5 w-3.5" />
              {marketClosed ? 'Market closed — orders queue until open.' : 'After-hours session — liquidity is thin.'}
            </p>
            {nextOpen && (
              <p className="mt-1">
                Next open {formatCountdown(nextOpen) ?? `on ${new Date(nextOpen).toLocaleString()}`}.
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 text-sm font-semibold">
          <button
            type="button"
            className={`rounded-xl px-3 py-2 border ${
              side === 'buy' ? 'border-emerald-500/60 bg-emerald-500/10 text-white' : 'border-gray-800 text-gray-400'
            }`}
            onClick={() => setSide('buy')}
          >
            Buy
          </button>
          <button
            type="button"
            className={`rounded-xl px-3 py-2 border ${
              side === 'sell' ? 'border-red-500/60 bg-red-500/10 text-white' : 'border-gray-800 text-gray-400'
            }`}
            onClick={() => setSide('sell')}
          >
            Sell
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="rounded-xl border border-gray-900 bg-gray-950 px-3 py-2">
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Symbol</p>
            <p className="text-sm text-white">{symbolDisplay}</p>
          </div>
          <div className="rounded-xl border border-gray-900 bg-gray-950 px-3 py-2">
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Market Price</p>
            <p className="text-sm text-white">{marketPriceDisplay}</p>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Quantity Mode</p>
          <div className="grid grid-cols-2 gap-2 text-sm font-semibold">
            <button
              type="button"
              className={`rounded-xl px-3 py-2 border ${
                qtyMode === primaryQtyMode
                  ? 'border-emerald-500/60 bg-emerald-500/10 text-white'
                  : 'border-gray-800 text-gray-400'
              }`}
              onClick={() => setQtyMode(primaryQtyMode)}
            >
              {primaryQtyMode === 'contracts' ? 'Contracts' : 'Shares'}
            </button>
            <button
              type="button"
              disabled={notionalDisabled}
              className={`rounded-xl px-3 py-2 border ${
                qtyMode === 'dollars'
                  ? 'border-emerald-500/60 bg-emerald-500/10 text-white'
                  : 'border-gray-800 text-gray-400'
              } ${notionalDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              onClick={() => setQtyMode('dollars')}
            >
              Dollars
            </button>
          </div>
          {notionalDisabled && (
            <p className="text-xs text-gray-500">Notional sizing is available for stock orders only.</p>
          )}
        </div>

        <label className="flex flex-col gap-1 text-sm">
          Quantity ({quantityLabel.toLowerCase()})
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={event => setQuantity(Number(event.target.value) || 1)}
            className="bg-gray-950 border border-gray-900 rounded-xl px-3 py-2 text-white"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Order Type
          <select
            value={orderType}
            onChange={event => setOrderType(event.target.value as OrderType)}
            className="bg-gray-950 border border-gray-900 rounded-xl px-3 py-2 text-white"
          >
            <option value="market" disabled={marketClosed}>Market</option>
            <option value="limit">Limit</option>
            <option value="stop">Stop</option>
            <option value="stop_limit">Stop Limit</option>
            <option value="trailing_stop">Trailing Stop</option>
          </select>
        </label>

        {requiresStop && (
          <label className="flex flex-col gap-1 text-sm">
            Stop Price
            <input
              type="number"
              step="0.01"
              min={0}
              value={stopPrice}
              onChange={event => setStopPrice(event.target.value)}
              className="bg-gray-950 border border-gray-900 rounded-xl px-3 py-2 text-white"
            />
            {marketPriceDisplay !== '—' && (
              <span className="text-xs text-gray-500">Market: {marketPriceDisplay}</span>
            )}
          </label>
        )}

        {requiresLimit && (
          <label className="flex flex-col gap-1 text-sm">
            Limit Price
            <input
              type="number"
              step="0.01"
              min={0}
              value={limitPrice}
              onChange={event => setLimitPrice(event.target.value)}
              className="bg-gray-950 border border-gray-900 rounded-xl px-3 py-2 text-white"
            />
            {marketPriceDisplay !== '—' && (
              <span className="text-xs text-gray-500">Market: {marketPriceDisplay}</span>
            )}
          </label>
        )}

        {orderType === 'stop_limit' && (
          <p className="text-xs text-gray-500">Stop = trigger. Limit = protection.</p>
        )}
        {orderType === 'stop' && (
          <p className="text-xs text-gray-500">Stop = trigger. Executes at market once hit.</p>
        )}

        {requiresTrail && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Trailing Stop</p>
            <div className="grid grid-cols-2 gap-2 text-sm font-semibold">
              <button
                type="button"
                className={`rounded-xl px-3 py-2 border ${
                  trailType === 'percent'
                    ? 'border-emerald-500/60 bg-emerald-500/10 text-white'
                    : 'border-gray-800 text-gray-400'
                }`}
                onClick={() => setTrailType('percent')}
              >
                Trail %
              </button>
              <button
                type="button"
                className={`rounded-xl px-3 py-2 border ${
                  trailType === 'amount'
                    ? 'border-emerald-500/60 bg-emerald-500/10 text-white'
                    : 'border-gray-800 text-gray-400'
                }`}
                onClick={() => setTrailType('amount')}
              >
                Trail $
              </button>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              Trail {trailType === 'percent' ? '%' : '$'}
              <input
                type="number"
                step="0.01"
                min={0}
                value={trailValue}
                onChange={event => setTrailValue(event.target.value)}
                className="bg-gray-950 border border-gray-900 rounded-xl px-3 py-2 text-white"
              />
            </label>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Time in Force</p>
          <div className="grid grid-cols-2 gap-2 text-sm font-semibold">
            <button
              type="button"
              className={`rounded-xl px-3 py-2 border ${
                timeInForce === 'day'
                  ? 'border-emerald-500/60 bg-emerald-500/10 text-white'
                  : 'border-gray-800 text-gray-400'
              }`}
              onClick={() => setTimeInForce('day')}
            >
              DAY
            </button>
            <button
              type="button"
              className={`rounded-xl px-3 py-2 border ${
                timeInForce === 'gtc'
                  ? 'border-emerald-500/60 bg-emerald-500/10 text-white'
                  : 'border-gray-800 text-gray-400'
              }`}
              onClick={() => setTimeInForce('gtc')}
            >
              GTC
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-gray-900 bg-gray-950 px-3 py-2 text-sm space-y-2">
          <div className="flex justify-between text-gray-400">
            <span>{estimatedLabel}</span>
            <span>{estimatedCost != null ? `$${estimatedCost.toFixed(2)}` : '—'}</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Buying Power</span>
            <span>
              {buyingPowerLoading ? '…' : buyingPower != null ? `$${buyingPower.toFixed(2)}` : '—'}
            </span>
          </div>
          {insufficientFunds && (
            <p className="text-xs text-red-300">
              Estimated cost exceeds buying power. Adjust size or price.
            </p>
          )}
        </div>

        <div className="border border-gray-900 rounded-2xl">
          <button
            type="button"
            onClick={() => setRiskOpen(open => !open)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300"
          >
            <span>Risk Preview</span>
            {riskOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {riskOpen && (
            <div className="px-4 pb-4 space-y-2 text-sm text-gray-400">
              <div className="flex justify-between">
                <span>Max Loss</span>
                <span>{maxLoss != null ? `$${maxLoss.toFixed(2)}` : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span>Cost Basis</span>
                <span>{costBasis != null ? `$${costBasis.toFixed(2)}` : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span>Breakeven</span>
                <span>{breakevenPrice != null ? `$${breakevenPrice.toFixed(2)}` : '—'}</span>
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          disabled={!canSubmit}
          className={`w-full inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold ${
            side === 'buy'
              ? 'bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-800'
              : 'bg-red-600 hover:bg-red-500 disabled:bg-gray-800'
          }`}
          onClick={() => setReviewOpen(true)}
        >
          {submitting || isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Review Order'}
        </button>
        {submissionResult && (
          <div
            className={`text-sm rounded-xl px-3 py-2 ${
              submissionResult.status === 'success'
                ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/40'
                : 'bg-red-500/10 text-red-300 border border-red-500/40'
            }`}
          >
            {submissionResult.message}
          </div>
        )}
      </div>
      {reviewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-2xl border border-gray-900 bg-gray-950 p-5 space-y-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Review Order</p>
              <p className="text-lg font-semibold text-white mt-1">
                {side === 'buy' ? 'Buy' : 'Sell'} {symbolDisplay}
              </p>
            </div>
            <div className="space-y-2 text-sm text-gray-300">
              <div className="flex justify-between">
                <span>Quantity</span>
                <span>{quantity} {quantityLabel}</span>
              </div>
              <div className="flex justify-between">
                <span>Order Type</span>
                <span>{orderTypeLabel}</span>
              </div>
              {requiresStop && (
                <div className="flex justify-between">
                  <span>Stop Price</span>
                  <span>{stopValue != null ? `$${stopValue.toFixed(2)}` : '—'}</span>
                </div>
              )}
              {requiresLimit && (
                <div className="flex justify-between">
                  <span>Limit Price</span>
                  <span>{limitValue != null ? `$${limitValue.toFixed(2)}` : '—'}</span>
                </div>
              )}
              {requiresTrail && (
                <div className="flex justify-between">
                  <span>Trail</span>
                  <span>{trailValueNum != null ? `${trailValueNum.toFixed(2)}${trailType === 'percent' ? '%' : ''}` : '—'}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Time in Force</span>
                <span>{timeInForce.toUpperCase()}</span>
              </div>
              <div className="flex justify-between">
                <span>{estimatedLabel}</span>
                <span>{estimatedCost != null ? `$${estimatedCost.toFixed(2)}` : '—'}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-xl border border-gray-800 px-3 py-2 text-sm text-gray-300"
                onClick={() => setReviewOpen(false)}
              >
                Back
              </button>
              <button
                type="button"
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold ${
                  side === 'buy' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'
                }`}
                onClick={() => {
                  setReviewOpen(false);
                  void handleSubmit();
                }}
                disabled={!canSubmit}
              >
                {submitting ? 'Submitting…' : 'Submit Order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
