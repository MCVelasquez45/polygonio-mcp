import { memo, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import type { QuoteSnapshot, OptionContractDetail } from '../../types/market';
import { AlertTriangle, Loader2, Minus, Plus } from 'lucide-react';
import { getBrokerAccount } from '../../api/alpaca';
import { submitManualPaperOrder } from '../../api/manualTrading';
import { useLiveQuote } from '../../lib/liveMarketStore';

type Props = {
  contract?: OptionContractDetail | null;
  isLoading: boolean;
  label?: string;
  spotPrice?: number | null;
  marketClosed?: boolean;
  afterHours?: boolean;
  nextOpen?: string | null;
  onOrderSubmitted?: (ticker: string, side: string, qty: number, price: number) => void;
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

// memo: the ticket subscribes to its own contract's live quote via the store —
// unrelated app renders should not re-render the order form.
export const OrderTicketPanel = memo(function OrderTicketPanel({
  contract,
  isLoading,
  label,
  spotPrice,
  marketClosed,
  afterHours,
  nextOpen,
  onOrderSubmitted
}: Props) {
  // Live + REST-fallback quotes both land in the shared store.
  const quote: QuoteSnapshot | null = useLiveQuote(contract?.ticker ?? null);
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
  const orderTypeLabels: Record<OrderType, string> = {
    market: 'Market',
    limit: 'Limit',
    stop: 'Stop',
    stop_limit: 'Stop Limit',
    trailing_stop: 'Trailing Stop'
  };
  const orderTypeLabel = orderTypeLabels[orderType];
  const quantityLabel =
    qtyMode === 'dollars' ? 'Dollars' : assetType === 'option' ? 'Contracts' : 'Shares';
  const symbolDisplay = contract?.ticker ?? label ?? '—';
  const marketPriceDisplay = markPrice != null ? `$${markPrice.toFixed(2)}` : '—';

  // Live top-of-book for the price ladder — prefer the streaming quote, fall
  // back to the contract's last quote. The ladder is the institutional
  // signature: click bid/mid/ask to arm a limit at that price.
  const lastQuoteBid = contract?.lastQuote && typeof contract.lastQuote.bid === 'number' ? (contract.lastQuote.bid as number) : null;
  const lastQuoteAsk = contract?.lastQuote && typeof contract.lastQuote.ask === 'number' ? (contract.lastQuote.ask as number) : null;
  const bidPx = quote?.bidPrice ?? lastQuoteBid;
  const askPx = quote?.askPrice ?? lastQuoteAsk;
  const midPx = markPrice;
  const spreadPx = quote?.spread ?? (bidPx != null && askPx != null ? askPx - bidPx : null);
  const bidSize = quote?.bidSize ?? null;
  const askSize = quote?.askSize ?? null;
  // Price step: nickels above $3 (option convention), pennies below.
  const priceTick = midPx != null && midPx >= 3 ? 0.05 : 0.01;
  const armLimitAt = (value: number | null) => {
    if (value == null || !Number.isFinite(value)) return;
    setOrderType(prev => (prev === 'limit' || prev === 'stop_limit' ? prev : 'limit'));
    setLimitPrice(value.toFixed(2));
  };
  const bumpLimit = (dir: 1 | -1) => {
    const base = limitValue ?? midPx ?? 0;
    setLimitPrice(Math.max(0, base + dir * priceTick).toFixed(2));
  };
  const QTY_CHIPS = assetType === 'option' ? [1, 2, 5, 10] : [10, 25, 50, 100];
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

  // Explicit MANUAL submission ONLY. Never called from an effect, mount, quote
  // update, or selection — solely from the confirmation dialog's dedicated
  // button. Routes through the governed manual lifecycle (create → confirm →
  // submit) behind the server-side execution gateway; the browser never holds
  // execution authority and never calls the broker directly.
  async function handleConfirmManualOrder() {
    const draft = buildOrderDraft();
    if (!draft) return;
    setSubmitting(true);
    setSubmissionResult(null);
    try {
      const result = await submitManualPaperOrder({
        optionSymbol: draft.instrument,
        side: draft.side,
        quantity: draft.qty,
        orderType: draft.orderType,
        limitPrice: draft.prices.limit != null ? Number(draft.prices.limit.toFixed(2)) : null,
        timeInForce: draft.timeInForce,
        positionIntent: draft.intent,
        marketDataSource: 'massive'
      });
      if (result.outcome === 'SUBMITTED' || result.outcome === 'ALREADY_SUBMITTED') {
        setSubmissionResult({ status: 'success', message: 'Manual paper order submitted to Alpaca paper trading.' });
        if (onOrderSubmitted && draft.instrument) {
          onOrderSubmitted(draft.instrument, draft.side, draft.qty, draft.prices.limit || markPrice || 0);
        }
      } else {
        setSubmissionResult({ status: 'error', message: result.reason ?? 'Manual order was blocked by the execution gateway.' });
      }
      return result;
    } catch (error: any) {
      const message = error?.response?.data?.message ?? error?.response?.data?.reason ?? error?.message ?? 'Failed to submit order';
      setSubmissionResult({ status: 'error', message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="bg-intel-panel border border-intel-line rounded-panel h-full flex flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-intel-line px-3 py-2.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-intel-ink3">Ticket</span>
          <span className="truncate font-mono text-[15px] font-semibold tracking-wide text-intel-ink">
            {symbolDisplay}
          </span>
        </div>
        <span className="shrink-0 rounded-sm bg-intel-raised px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-label text-intel-ink2">
          {assetType === 'option' ? 'Option' : 'Equity'}
        </span>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {(marketClosed || afterHours) && (
          <div
            className={`flex items-center gap-2 border-l-2 px-2.5 py-1.5 text-[11px] ${marketClosed
              ? 'border-intel-warn bg-intel-warn/10 text-intel-warn'
              : 'border-intel-info bg-intel-info/10 text-intel-info'
              }`}
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="font-medium">
              {marketClosed ? 'Market closed — orders queue until open.' : 'After-hours — thin liquidity.'}
              {nextOpen && marketClosed ? ` Opens ${formatCountdown(nextOpen) ?? new Date(nextOpen).toLocaleString()}.` : ''}
            </span>
          </div>
        )}

        {/* ── Price ladder: click BID/MID/ASK to arm a limit ─────────────── */}
        <div className="grid grid-cols-3 overflow-hidden rounded-panel border border-intel-line">
          {([
            ['Bid', bidPx, bidSize, 'pos', () => armLimitAt(bidPx)],
            ['Mid', midPx, null, 'ink', () => armLimitAt(midPx)],
            ['Ask', askPx, askSize, 'neg', () => armLimitAt(askPx)],
          ] as const).map(([lbl, px, sz, tone, onClick], i) => {
            const armed = requiresLimit && px != null && limitValue != null && Math.abs(limitValue - px) < 1e-6;
            const toneText = tone === 'pos' ? 'text-intel-pos' : tone === 'neg' ? 'text-intel-neg' : 'text-intel-ink';
            return (
              <button
                key={lbl}
                type="button"
                onClick={onClick}
                disabled={px == null}
                className={`flex flex-col items-center gap-0.5 px-1.5 py-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  i < 2 ? 'border-r border-intel-line' : ''
                } ${armed ? 'bg-intel-info/15' : 'hover:bg-intel-panel2'}`}
              >
                <span className="font-mono text-[8.5px] uppercase tracking-label text-intel-ink3">{lbl}</span>
                <span className={`font-mono tabular-nums text-[13px] font-semibold leading-none ${toneText}`}>
                  {px != null ? px.toFixed(2) : '—'}
                </span>
                <span className="font-mono text-[9px] tabular-nums leading-none text-intel-ink3">
                  {sz != null ? `×${sz}` : ' '}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between px-0.5 font-mono text-[10px] tabular-nums text-intel-ink3">
          <span>SPREAD {spreadPx != null ? spreadPx.toFixed(2) : '—'}</span>
          <span>LAST {marketPriceDisplay}</span>
        </div>

        {/* ── Side: hard split toggle ────────────────────────────────────── */}
        <div className="grid grid-cols-2 overflow-hidden rounded-panel border border-intel-line font-mono text-[13px] font-semibold uppercase tracking-label">
          <button
            type="button"
            className={`py-2 transition-colors ${side === 'buy' ? 'bg-intel-pos text-intel-bg' : 'text-intel-ink3 hover:bg-intel-panel2'}`}
            onClick={() => setSide('buy')}
          >
            Buy
          </button>
          <button
            type="button"
            className={`py-2 transition-colors ${side === 'sell' ? 'bg-intel-neg text-intel-bg' : 'text-intel-ink3 hover:bg-intel-panel2'}`}
            onClick={() => setSide('sell')}
          >
            Sell
          </button>
        </div>

        {/* ── Order type: compact pills ─────────────────────────────────── */}
        <div>
          <p className="mb-1 font-mono text-[9px] uppercase tracking-label text-intel-ink3">Order Type</p>
          <div className="grid grid-cols-5 gap-1 font-mono text-[10px] font-semibold uppercase">
            {([
              ['market', 'Mkt'],
              ['limit', 'Lmt'],
              ['stop', 'Stp'],
              ['stop_limit', 'StpL'],
              ['trailing_stop', 'Trl'],
            ] as const).map(([val, lbl]) => {
              const disabled = val === 'market' && Boolean(marketClosed);
              const activeT = orderType === val;
              return (
                <button
                  key={val}
                  type="button"
                  disabled={disabled}
                  onClick={() => setOrderType(val)}
                  className={`rounded-sm py-1.5 tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    activeT ? 'bg-intel-accent text-intel-bg' : 'bg-intel-panel2 text-intel-ink2 hover:text-intel-ink'
                  }`}
                >
                  {lbl}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Quantity: steppers + quick chips ──────────────────────────── */}
        <div>
          <div className="mb-1 flex items-center justify-between font-mono text-[9px] uppercase tracking-label text-intel-ink3">
            <span>Quantity · {quantityLabel}</span>
            {assetType === 'stock' && (
              <div className="flex overflow-hidden rounded-sm border border-intel-line">
                <button
                  type="button"
                  onClick={() => setQtyMode(primaryQtyMode)}
                  className={`px-1.5 py-0.5 ${qtyMode !== 'dollars' ? 'bg-intel-raised text-intel-ink' : 'text-intel-ink3'}`}
                >
                  Shares
                </button>
                <button
                  type="button"
                  onClick={() => setQtyMode('dollars')}
                  className={`px-1.5 py-0.5 ${qtyMode === 'dollars' ? 'bg-intel-raised text-intel-ink' : 'text-intel-ink3'}`}
                >
                  $
                </button>
              </div>
            )}
          </div>
          <div className="flex items-stretch gap-1">
            <button
              type="button"
              onClick={() => setQuantity(q => Math.max(1, q - 1))}
              className="flex w-9 items-center justify-center rounded-panel border border-intel-line text-intel-ink2 hover:bg-intel-panel2"
              aria-label="Decrease quantity"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuantity(Number(event.target.value) || 1)}
              className="min-w-0 flex-1 rounded-panel border border-intel-line bg-intel-panel2 px-2 py-2 text-center font-mono tabular-nums text-[15px] font-semibold text-intel-ink focus:border-intel-accentLine focus-visible:outline-none"
            />
            <button
              type="button"
              onClick={() => setQuantity(q => q + 1)}
              className="flex w-9 items-center justify-center rounded-panel border border-intel-line text-intel-ink2 hover:bg-intel-panel2"
              aria-label="Increase quantity"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-1 grid grid-cols-4 gap-1 font-mono text-[10px]">
            {QTY_CHIPS.map(n => (
              <button
                key={n}
                type="button"
                onClick={() => setQuantity(n)}
                className={`rounded-sm py-1 tabular-nums transition-colors ${
                  quantity === n ? 'bg-intel-raised text-intel-ink' : 'bg-intel-panel2 text-intel-ink3 hover:text-intel-ink2'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* ── Limit price with tick steppers ────────────────────────────── */}
        {requiresLimit && (
          <div>
            <p className="mb-1 font-mono text-[9px] uppercase tracking-label text-intel-ink3">Limit Price</p>
            <div className="flex items-stretch gap-1">
              <button
                type="button"
                onClick={() => bumpLimit(-1)}
                className="flex w-9 items-center justify-center rounded-panel border border-intel-line text-intel-ink2 hover:bg-intel-panel2"
                aria-label="Decrease limit"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <input
                type="number"
                step="0.01"
                min={0}
                value={limitPrice}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setLimitPrice(event.target.value)}
                className="min-w-0 flex-1 rounded-panel border border-intel-line bg-intel-panel2 px-2 py-2 text-center font-mono tabular-nums text-[15px] font-semibold text-intel-ink focus:border-intel-accentLine focus-visible:outline-none"
              />
              <button
                type="button"
                onClick={() => bumpLimit(1)}
                className="flex w-9 items-center justify-center rounded-panel border border-intel-line text-intel-ink2 hover:bg-intel-panel2"
                aria-label="Increase limit"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* ── Stop price ────────────────────────────────────────────────── */}
        {requiresStop && (
          <div>
            <p className="mb-1 font-mono text-[9px] uppercase tracking-label text-intel-ink3">Stop Price</p>
            <input
              type="number"
              step="0.01"
              min={0}
              value={stopPrice}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setStopPrice(event.target.value)}
              className="w-full rounded-panel border border-intel-line bg-intel-panel2 px-2 py-2 text-center font-mono tabular-nums text-[15px] font-semibold text-intel-warn focus:border-intel-accentLine focus-visible:outline-none"
            />
            <p className="mt-1 font-mono text-[10px] text-intel-ink3">
              {orderType === 'stop_limit' ? 'Stop = trigger · Limit = protection' : 'Executes at market once hit'}
            </p>
          </div>
        )}

        {/* ── Trailing stop ─────────────────────────────────────────────── */}
        {requiresTrail && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="font-mono text-[9px] uppercase tracking-label text-intel-ink3">Trailing Stop</p>
              <div className="flex overflow-hidden rounded-sm border border-intel-line font-mono text-[10px]">
                <button
                  type="button"
                  onClick={() => setTrailType('percent')}
                  className={`px-2 py-0.5 ${trailType === 'percent' ? 'bg-intel-raised text-intel-ink' : 'text-intel-ink3'}`}
                >
                  %
                </button>
                <button
                  type="button"
                  onClick={() => setTrailType('amount')}
                  className={`px-2 py-0.5 ${trailType === 'amount' ? 'bg-intel-raised text-intel-ink' : 'text-intel-ink3'}`}
                >
                  $
                </button>
              </div>
            </div>
            <input
              type="number"
              step="0.01"
              min={0}
              value={trailValue}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setTrailValue(event.target.value)}
              className="w-full rounded-panel border border-intel-line bg-intel-panel2 px-2 py-2 text-center font-mono tabular-nums text-[15px] font-semibold text-intel-warn focus:border-intel-accentLine focus-visible:outline-none"
            />
          </div>
        )}

        {/* ── Time in force ─────────────────────────────────────────────── */}
        <div>
          <p className="mb-1 font-mono text-[9px] uppercase tracking-label text-intel-ink3">Time in Force</p>
          <div className="grid grid-cols-2 gap-1 font-mono text-[11px] font-semibold uppercase">
            {(['day', 'gtc'] as const).map(tif => (
              <button
                key={tif}
                type="button"
                onClick={() => setTimeInForce(tif)}
                className={`rounded-sm py-1.5 tracking-label transition-colors ${
                  timeInForce === tif ? 'bg-intel-raised text-intel-ink' : 'bg-intel-panel2 text-intel-ink3 hover:text-intel-ink2'
                }`}
              >
                {tif}
              </button>
            ))}
          </div>
        </div>

        {/* ── Always-on risk read-out ───────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-intel-line pt-2.5 font-mono text-[11px] tabular-nums">
          <span className="text-intel-ink3">{estimatedLabel}</span>
          <span className={`text-right font-semibold ${insufficientFunds ? 'text-intel-neg' : 'text-intel-ink'}`}>
            {estimatedCost != null ? `$${estimatedCost.toFixed(2)}` : '—'}
          </span>
          <span className="text-intel-ink3">Buying Power</span>
          <span className="text-right text-intel-ink2">
            {buyingPowerLoading ? '…' : buyingPower != null ? `$${buyingPower.toFixed(2)}` : '—'}
          </span>
          <span className="text-intel-ink3">Max Loss</span>
          <span className="text-right text-intel-ink2">{maxLoss != null ? `$${maxLoss.toFixed(2)}` : '—'}</span>
          {breakevenPrice != null && (
            <>
              <span className="text-intel-ink3">Breakeven</span>
              <span className="text-right text-intel-ink2">${breakevenPrice.toFixed(2)}</span>
            </>
          )}
        </div>
        {insufficientFunds && (
          <p className="font-mono text-[10px] text-intel-neg">Cost exceeds buying power — adjust size or price.</p>
        )}

        {/* ── Action-labeled submit ─────────────────────────────────────── */}
        <button
          type="button"
          disabled={!canSubmit}
          aria-label={`Review order — ${side} ${quantity} ${symbolDisplay} · ${orderTypeLabel}`}
          className={`w-full rounded-panel px-3 py-3 font-mono text-[13px] font-semibold uppercase tracking-label text-intel-bg transition-colors disabled:cursor-not-allowed disabled:bg-intel-panel2 disabled:text-intel-ink3 ${
            side === 'buy' ? 'bg-intel-pos hover:brightness-110' : 'bg-intel-neg hover:brightness-110'
          }`}
          onClick={() => setReviewOpen(true)}
        >
          {submitting || isLoading ? (
            <Loader2 className="mx-auto h-4 w-4 animate-spin" />
          ) : (
            `${side} ${quantity} ${symbolDisplay} · ${orderTypeLabel}`
          )}
        </button>
        {submissionResult && (
          <div
            className={`border-l-2 px-2.5 py-1.5 font-mono text-[11px] ${submissionResult.status === 'success'
              ? 'border-intel-pos bg-intel-pos/10 text-intel-pos'
              : 'border-intel-neg bg-intel-neg/10 text-intel-neg'
              }`}
          >
            {submissionResult.message}
          </div>
        )}
      </div>
      {reviewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-2xl border border-intel-divider bg-intel-panel p-5 space-y-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-intel-ink3">Review Order</p>
              <p className="text-lg font-semibold text-white mt-1">
                {side === 'buy' ? 'Buy' : 'Sell'} {symbolDisplay}
              </p>
            </div>
            <div className="space-y-2 text-sm text-intel-ink2">
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
                className="flex-1 rounded-panel border border-intel-line px-3 py-2 text-sm text-intel-ink2"
                onClick={() => setReviewOpen(false)}
              >
                Back
              </button>
              <button
                type="button"
                className={`flex-1 rounded-panel px-3 py-2 text-sm font-semibold ${side === 'buy' ? 'bg-intel-pos hover:bg-intel-pos' : 'bg-intel-neg hover:bg-intel-neg'
                  }`}
                onClick={() => {
                  setReviewOpen(false);
                  void handleConfirmManualOrder();
                }}
                disabled={!canSubmit}
              >
                {submitting ? 'Submitting…' : 'Submit Manual Paper Order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
});
