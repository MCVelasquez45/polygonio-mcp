import { useEffect, useMemo, useState } from 'react';
import { QuoteSnapshot, TradePrint } from '../../types/market';
import type { OptionContractDetail } from '../../types/market';
import { Loader2, ShoppingCart } from 'lucide-react';

type Props = {
  contract?: OptionContractDetail | null;
  quote?: QuoteSnapshot | null;
  trades: TradePrint[];
  isLoading: boolean;
  label?: string;
};

export function OrderTicketPanel({ contract, quote, trades, isLoading, label }: Props) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [quantity, setQuantity] = useState(1);
  const [limitPrice, setLimitPrice] = useState('');

  useEffect(() => {
    setQuantity(1);
    setLimitPrice('');
    setSide('buy');
    setOrderType('market');
  }, [contract?.ticker]);

  const markPrice = useMemo(() => {
    if (quote?.midpoint) return quote.midpoint;
    if (contract?.lastQuote?.bid != null && contract?.lastQuote?.ask != null) {
      return (Number(contract.lastQuote.bid) + Number(contract.lastQuote.ask)) / 2;
    }
    if (contract?.lastTrade?.price) return contract.lastTrade.price;
    return null;
  }, [contract, quote]);

  const workingPrice = orderType === 'limit' && limitPrice ? Number(limitPrice) : markPrice;
  const totalCost = workingPrice != null ? workingPrice * 100 * quantity : null;

  return (
    <section className="bg-gray-950 border border-gray-900 rounded-2xl h-full flex flex-col">
      <header className="p-4 border-b border-gray-900">
        <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Order Ticket</p>
        <p className="text-lg font-semibold text-gray-100">{label ?? contract?.ticker ?? 'Select a contract'}</p>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="grid grid-cols-2 gap-2 text-sm font-semibold">
          <button
            type="button"
            className={`rounded-xl px-3 py-2 border ${
              side === 'buy' ? 'border-emerald-500/60 bg-emerald-500/10 text-white' : 'border-gray-800 text-gray-400'
            }`}
            onClick={() => setSide('buy')}
          >
            Buy to Open
          </button>
          <button
            type="button"
            className={`rounded-xl px-3 py-2 border ${
              side === 'sell' ? 'border-red-500/60 bg-red-500/10 text-white' : 'border-gray-800 text-gray-400'
            }`}
            onClick={() => setSide('sell')}
          >
            Sell to Open
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm font-semibold">
          <button
            type="button"
            className={`rounded-xl px-3 py-2 border ${
              orderType === 'market' ? 'border-emerald-500/60 bg-emerald-500/10 text-white' : 'border-gray-800 text-gray-400'
            }`}
            onClick={() => setOrderType('market')}
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

        {orderType === 'limit' && (
          <label className="flex flex-col gap-1 text-sm">
            Limit price
            <input
              type="number"
              step="0.01"
              min={0}
              value={limitPrice}
              onChange={event => setLimitPrice(event.target.value)}
              className="bg-gray-950 border border-gray-900 rounded-xl px-3 py-2 text-white"
            />
          </label>
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
            <span>{totalCost != null ? `$${totalCost.toFixed(2)}` : '—'}</span>
          </div>
        </div>

        <button
          type="button"
          disabled={!contract || !workingPrice}
          className={`w-full inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold ${
            side === 'buy'
              ? 'bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-800'
              : 'bg-red-600 hover:bg-red-500 disabled:bg-gray-800'
          }`}
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
          {contract ? `${side === 'buy' ? 'Buy' : 'Sell'} ${quantity} contracts` : 'Select a contract'}
        </button>

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
      </div>
    </section>
  );
}
