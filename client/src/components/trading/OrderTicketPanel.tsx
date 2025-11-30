import { useEffect, useMemo, useState } from 'react';
import { QuoteSnapshot, TradePrint } from '../../types/market';
import type { OptionContractDetail } from '../../types/market';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Info,
  Loader2,
  Plus,
  ShoppingCart,
  Trash2
} from 'lucide-react';
import { submitOptionOrder } from '../../api/alpaca';

type Props = {
  contract?: OptionContractDetail | null;
  quote?: QuoteSnapshot | null;
  trades: TradePrint[];
  isLoading: boolean;
  label?: string;
  marketClosed?: boolean;
  afterHours?: boolean;
  nextOpen?: string | null;
};

type TicketLeg = {
  id: string;
  symbol: string;
  action: 'buy' | 'sell';
  ratio: number;
  limitPrice: string;
  mark?: number | null;
  description?: string;
};

const HELP_TEXT = {
  orderType: {
    title: 'Order Type',
    body: 'Market orders chase the next available fill, while limit orders only execute at your price. Options are best entered with limit orders to control slippage.'
  },
  duration: {
    title: 'Duration',
    body: 'DAY orders expire at today’s close if unfilled. GTC remains working until canceled. Stick with DAY for thin contracts so stale orders do not fill overnight.'
  },
  quantity: {
    title: 'Quantity',
    body: 'One contract controls 100 shares. Multiply your limit price by 100 × contracts to estimate exposure.'
  },
  legs: {
    title: 'Leg Builder',
    body: 'Add legs to create spreads or complex orders. Each leg can buy or sell a ratio of contracts.'
  },
  summary: {
    title: 'Order Summary',
    body: 'Shows mark, bid/ask, estimated debit/credit, and regulatory fees (OCC + ORF) so you know your total before submitting.'
  }
} as const;

const LEARN_MORE = [
  { topic: 'Order Type', explanation: 'Market vs. Limit', recommendation: 'Always use limit for options to avoid wide fills.' },
  { topic: 'Duration', explanation: 'DAY vs. GTC', recommendation: 'Use DAY for illiquid contracts so they cancel automatically.' },
  { topic: 'Strike Price', explanation: 'Price where the option converts to stock', recommendation: 'Beginners should stay near ATM strikes.' },
  { topic: 'Expiration', explanation: 'Contract lifetime / theta decay', recommendation: 'Target 21‑45 DTE to balance decay and movement.' },
  { topic: 'Bid / Ask', explanation: 'Shows liquidity depth', recommendation: 'Avoid symbols with missing bids or asks.' },
  { topic: 'Spread', explanation: 'Bid vs. ask distance', recommendation: 'Favor spreads tighter than 20‑25% of the price.' }
];

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

export function OrderTicketPanel({ contract, quote, trades, isLoading, label, marketClosed, afterHours, nextOpen }: Props) {
  const [orderType, setOrderType] = useState<'market' | 'limit'>('limit');
  const [timeInForce, setTimeInForce] = useState<'day' | 'gtc'>('day');
  const [quantity, setQuantity] = useState(1);
  const [legs, setLegs] = useState<TicketLeg[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submissionResult, setSubmissionResult] = useState<{ status: 'success' | 'error'; message: string } | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [learnMoreOpen, setLearnMoreOpen] = useState(false);

  useEffect(() => {
    setQuantity(1);
    setOrderType('limit');
    setTimeInForce('day');
    setSubmissionResult(null);
    if (contract?.ticker) {
      setLegs([
        {
          id: createLegId(),
          symbol: contract.ticker,
          action: 'buy',
          ratio: 1,
          limitPrice: resolveDefaultLegPrice(contract, quote)?.toFixed(2) ?? '',
          mark: resolveDefaultLegPrice(contract, quote),
          description: `${contract.type?.toUpperCase() ?? ''} · ${contract.expiration ?? ''}`
        }
      ]);
    } else {
      setLegs([]);
    }
  }, [contract?.ticker]);

  useEffect(() => {
    if (marketClosed && orderType !== 'limit') {
      setOrderType('limit');
    }
  }, [marketClosed, orderType]);

  const markPrice = useMemo(() => {
    if (quote?.midpoint) return quote.midpoint;
    if (contract?.lastQuote?.bid != null && contract?.lastQuote?.ask != null) {
      return (Number(contract.lastQuote.bid) + Number(contract.lastQuote.ask)) / 2;
    }
    if (contract?.lastTrade?.price) return contract.lastTrade.price;
    return null;
  }, [contract, quote]);

  const legTotals = useMemo(() => {
    return legs.map(leg => {
      const referencePrice = leg.mark ?? markPrice ?? null;
      const inputPrice =
        orderType === 'limit'
          ? leg.limitPrice
            ? Number(leg.limitPrice)
            : referencePrice
          : referencePrice;
      const dollars = inputPrice != null ? inputPrice : null;
      if (dollars == null) {
        return { leg, price: null, total: 0 };
      }
      const signed = leg.action === 'sell' ? 1 : -1;
      return {
        leg,
        price: dollars,
        total: signed * dollars * leg.ratio
      };
    });
  }, [legs, markPrice, orderType]);

  const spreadValue = legTotals.reduce((sum, entry) => sum + entry.total, 0);
  const orderNotional = spreadValue * quantity * 100;
  const orderDirection = orderNotional >= 0 ? 'credit' : 'debit';
  const absNotional = Math.abs(orderNotional);
  const totalContracts = quantity * legs.reduce((sum, leg) => sum + leg.ratio, 0);
  const occFee = totalContracts * 0.04;
  const orfFee = totalContracts * 0.04;
  const workingPrice =
    quantity > 0 && legs.length ? Math.abs(spreadValue / (quantity || 1)) : null;
  const estimatedNet = orderDirection === 'credit' ? absNotional - occFee - orfFee : absNotional + occFee + orfFee;
  const warnings = computeWarnings({ quote, contract, legs, spread: quote?.spread ?? null });

  async function handleSubmit() {
    if (!legs.length) return;
    setSubmitting(true);
    setSubmissionResult(null);
    try {
      const payload = {
        legs: legTotals.map(entry => ({
          symbol: entry.leg.symbol,
          qty: entry.leg.ratio,
          side: entry.leg.action,
          type: orderType,
          ...(orderType === 'limit' && entry.price != null ? { limit_price: Number(entry.price.toFixed(2)) } : {})
        })),
        quantity,
        time_in_force: timeInForce,
        order_type: orderType,
        order_class: legs.length > 1 ? 'multi-leg' : 'simple',
        limit_price: orderType === 'limit' && workingPrice != null ? Number(workingPrice.toFixed(2)) : undefined,
        client_order_id: `mcp-${Date.now()}`
      };
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

  function updateLeg(id: string, next: Partial<TicketLeg>) {
    setLegs(current => current.map(leg => (leg.id === id ? { ...leg, ...next } : leg)));
  }

  function removeLeg(id: string) {
    setLegs(current => current.filter(leg => leg.id !== id));
  }

  function addLeg() {
    setLegs(current => [
      ...current,
      {
        id: createLegId(),
        symbol: contract?.ticker ?? '',
        action: current.length ? current[current.length - 1].action : 'buy',
        ratio: 1,
        limitPrice: markPrice != null ? markPrice.toFixed(2) : '',
        mark: markPrice ?? null,
        description: ''
      }
    ]);
  }

  return (
    <section className="bg-gray-950 border border-gray-900 rounded-2xl h-full flex flex-col">
      <header className="p-4 border-b border-gray-900">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Order Ticket</p>
            <p className="text-lg font-semibold text-gray-100">{label ?? contract?.ticker ?? 'Select a contract'}</p>
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              className="form-checkbox text-emerald-500 rounded border-gray-700"
              checked={showHelp}
              onChange={event => setShowHelp(event.target.checked)}
            />
            Show tips
          </label>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm font-semibold">
          <button
            type="button"
            className={`rounded-xl px-3 py-2 border ${
              orderType === 'market'
                ? 'border-emerald-500/60 bg-emerald-500/10 text-white'
                : 'border-gray-800 text-gray-400'
            } ${marketClosed ? 'opacity-40 cursor-not-allowed' : ''}`}
            onClick={() => !marketClosed && setOrderType('market')}
            disabled={marketClosed}
          >
            Market
          </button>
          <button
            type="button"
            className={`rounded-xl px-3 py-2 border ${
              orderType === 'limit' ? 'border-emerald-500/60 bg-emerald-500/10 text-white' : 'border-gray-800 text-gray-400'
            }`}
            onClick={() => setOrderType('limit')}
          >
            Limit
          </button>
        </div>
        {showHelp && <InfoTooltip topic="orderType" />}
        {(marketClosed || afterHours) && (
          <p className="text-[11px] text-amber-200">
            {marketClosed
              ? 'Market orders are paused until the opening bell.'
              : 'Limit orders recommended during after-hours to control fills.'}
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm font-semibold">
          <button
            type="button"
            className={`rounded-xl px-3 py-2 border ${
              timeInForce === 'day' ? 'border-emerald-500/60 bg-emerald-500/10 text-white' : 'border-gray-800 text-gray-400'
            }`}
            onClick={() => setTimeInForce('day')}
          >
            DAY
          </button>
          <button
            type="button"
            className={`rounded-xl px-3 py-2 border ${
              timeInForce === 'gtc' ? 'border-emerald-500/60 bg-emerald-500/10 text-white' : 'border-gray-800 text-gray-400'
            }`}
            onClick={() => setTimeInForce('gtc')}
          >
            GTC
          </button>
        </div>
        {showHelp && <InfoTooltip topic="duration" />}

        <label className="flex flex-col gap-1 text-sm">
          Quantity (contracts)
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={event => setQuantity(Number(event.target.value) || 1)}
            className="bg-gray-950 border border-gray-900 rounded-xl px-3 py-2 text-white"
          />
        </label>
        {showHelp && <InfoTooltip topic="quantity" />}

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Legs</p>
            <button
              type="button"
              onClick={addLeg}
              className="inline-flex items-center gap-2 text-xs px-3 py-1 rounded-full border border-emerald-500/40 text-emerald-300"
            >
              <Plus className="h-3 w-3" /> Add Leg
            </button>
          </div>
          {!legs.length && <p className="text-xs text-gray-500">Select a contract or add a leg to build an order.</p>}
          {showHelp && <InfoTooltip topic="legs" />}
          {legs.map((leg, index) => (
            <div key={leg.id} className="border border-gray-900 rounded-2xl p-3 space-y-2">
              <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-gray-500">
                <span>Leg {index + 1}</span>
                {legs.length > 1 && (
                  <button type="button" onClick={() => removeLeg(leg.id)} className="text-red-400 hover:text-red-300">
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-sm">
                  Symbol
                  <input
                    type="text"
                    value={leg.symbol}
                    onChange={event => updateLeg(leg.id, { symbol: event.target.value.toUpperCase() })}
                    className="bg-gray-950 border border-gray-900 rounded-xl px-3 py-2 text-white"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Ratio Qty
                  <input
                    type="number"
                    min={1}
                    value={leg.ratio}
                    onChange={event => updateLeg(leg.id, { ratio: Math.max(1, Number(event.target.value) || 1) })}
                    className="bg-gray-950 border border-gray-900 rounded-xl px-3 py-2 text-white"
                  />
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-[0.3em] text-gray-500">Action</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={`flex-1 rounded-xl px-3 py-2 border ${
                        leg.action === 'buy'
                          ? 'border-emerald-500/60 bg-emerald-500/10 text-white'
                          : 'border-gray-800 text-gray-400'
                      }`}
                      onClick={() => updateLeg(leg.id, { action: 'buy' })}
                    >
                      Buy
                    </button>
                    <button
                      type="button"
                      className={`flex-1 rounded-xl px-3 py-2 border ${
                        leg.action === 'sell'
                          ? 'border-red-500/60 bg-red-500/10 text-white'
                          : 'border-gray-800 text-gray-400'
                      }`}
                      onClick={() => updateLeg(leg.id, { action: 'sell' })}
                    >
                      Sell
                    </button>
                  </div>
                </div>
                {orderType === 'limit' && (
                  <label className="flex flex-col gap-1">
                    Limit Price
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={leg.limitPrice}
                      onChange={event => updateLeg(leg.id, { limitPrice: event.target.value })}
                      className="bg-gray-950 border border-gray-900 rounded-xl px-3 py-2 text-white"
                    />
                  </label>
                )}
                <div className="text-sm text-gray-400">
                  <p className="text-xs uppercase tracking-[0.3em]">Mark</p>
                  <p className="text-white text-base">
                    {leg.mark != null ? `$${leg.mark.toFixed(2)}` : markPrice != null ? `$${markPrice.toFixed(2)}` : '—'}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {!!warnings.length && (
          <div className="space-y-2">
            {warnings.map(warning => (
              <div key={warning} className="flex items-start gap-2 rounded-2xl border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm text-yellow-200">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <p>{warning}</p>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-2xl border border-gray-900 bg-gray-950 p-3 text-sm space-y-2">
          <div className="flex justify-between text-gray-400">
            <span>Mark</span>
            <span>{markPrice ? `$${markPrice.toFixed(2)}` : '—'}</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Bid / Ask</span>
            <span>
              {quote?.bidPrice != null ? `$${quote.bidPrice.toFixed(2)}` : '—'} / {quote?.askPrice != null ? `$${quote.askPrice.toFixed(2)}` : '—'}
            </span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Spread</span>
            <span>{quote?.spread != null ? `$${quote.spread.toFixed(2)}` : '—'}</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Est. notional</span>
            <span>
              {Number.isFinite(orderNotional) ? `${orderDirection === 'credit' ? '+' : '-'}$${Math.abs(orderNotional).toFixed(2)}` : '—'}
            </span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Estimated {orderDirection === 'credit' ? 'Credit' : 'Cost'}</span>
            <span>{Number.isFinite(estimatedNet) ? `$${estimatedNet.toFixed(2)}` : '—'}</span>
          </div>
          <div className="flex justify-between text-gray-400 text-xs">
            <span>OCC Fee</span>
            <span>${occFee.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-gray-400 text-xs">
            <span>ORF</span>
            <span>${orfFee.toFixed(2)}</span>
          </div>
          {showHelp && <InfoTooltip topic="summary" />}
        </div>

        <button
          type="button"
          disabled={!legs.length || submitting}
          className={`w-full inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold ${
            orderNotional >= 0
              ? 'bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-800'
              : 'bg-red-600 hover:bg-red-500 disabled:bg-gray-800'
          }`}
          onClick={handleSubmit}
        >
          {submitting || isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
          {legs.length ? `Submit ${orderDirection === 'credit' ? 'Credit' : 'Debit'} Order` : 'Add a leg to trade'}
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

        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Recent Prints</p>
          <div className="space-y-1">
            {trades.slice(0, 5).map((trade, index) => {
              const fallbackKey = `${trade.timestamp ?? 'unknown'}-${index}`;
              return (
                <div key={trade.id || fallbackKey} className="flex items-center justify-between text-xs text-gray-400">
                  <span>{new Date(trade.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  <span>${trade.price.toFixed(2)}</span>
                  <span>{trade.size}x</span>
                </div>
              );
            })}
            {!trades.length && <p className="text-xs text-gray-500">No prints available.</p>}
          </div>
        </div>
        <div className="border border-gray-900 rounded-2xl">
          <button
            type="button"
            onClick={() => setLearnMoreOpen(value => !value)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300"
          >
            <span>Learn about this order panel</span>
            {learnMoreOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {learnMoreOpen && (
            <div className="px-4 pb-4">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-gray-400">
                  <thead>
                    <tr className="text-gray-500 uppercase tracking-[0.3em] text-[10px]">
                      <th className="py-2 pr-2">Topic</th>
                      <th className="py-2 pr-2">Explanation</th>
                      <th className="py-2">Beginner Tip</th>
                    </tr>
                  </thead>
                  <tbody>
                    {LEARN_MORE.map(row => (
                      <tr key={row.topic} className="border-t border-gray-900">
                        <td className="py-2 pr-2 text-white font-semibold">{row.topic}</td>
                        <td className="py-2 pr-2">{row.explanation}</td>
                        <td className="py-2 text-emerald-200">{row.recommendation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function resolveDefaultLegPrice(contract?: OptionContractDetail | null, quote?: QuoteSnapshot | null) {
  if (quote?.midpoint != null) return quote.midpoint;
  if (contract?.lastTrade?.price != null) return contract.lastTrade.price;
  if (contract?.lastQuote?.bid != null && contract.lastQuote.ask != null) {
    return (Number(contract.lastQuote.bid) + Number(contract.lastQuote.ask)) / 2;
  }
  return null;
}

function createLegId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `leg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type TooltipTopics = keyof typeof HELP_TEXT;

function InfoTooltip({ topic }: { topic: TooltipTopics }) {
  const info = HELP_TEXT[topic];
  const [open, setOpen] = useState(false);
  if (!info) return null;
  return (
    <div className="relative inline-flex mt-1">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex items-center gap-1 text-xs text-emerald-300"
      >
        <Info className="h-3 w-3" /> Learn more
      </button>
      <div
        className={`absolute z-20 top-6 left-0 w-64 rounded-xl border border-emerald-500/40 bg-gray-900 p-3 text-xs text-gray-200 shadow-lg transition-opacity ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <p className="text-emerald-300 font-semibold mb-1">{info.title}</p>
        <p>{info.body}</p>
      </div>
    </div>
  );
}

function computeWarnings({
  quote,
  contract,
  legs,
  spread
}: {
  quote?: QuoteSnapshot | null;
  contract?: OptionContractDetail | null;
  legs: TicketLeg[];
  spread: number | null;
}): string[] {
  const warnings: string[] = [];
  if (quote && (quote.bidPrice == null || quote.askPrice == null)) {
    warnings.push('This contract has missing bid/ask quotes. Consider switching expirations or using DAY limit orders.');
  }
  if (spread != null && quote?.midpoint != null && spread > quote.midpoint * 0.25) {
    warnings.push('Spread is wider than 25% of the mid. You may need to price aggressively or avoid this symbol.');
  }
  const legVolumeZero = contract?.day && typeof (contract.day as any).volume === 'number' && (contract.day as any).volume === 0;
  if (legVolumeZero) {
    warnings.push('No intraday volume reported for this contract. Liquidity could be limited.');
  }
  if (!legs.length) {
    warnings.push('Add a leg to define what you want to trade.');
  }
  return warnings;
}
