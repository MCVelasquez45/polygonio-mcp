import { useState } from 'react';
import { ShoppingCart, DollarSign, TrendingUp, AlertCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Label } from '../ui/label';
import { ScrollArea } from '../ui/scroll-area';

interface OrderTicketPanelProps {
  ticker: string;
  selectedContract: any;
}

export function OrderTicketPanel({ ticker, selectedContract }: OrderTicketPanelProps) {
  const [orderType, setOrderType] = useState('limit');
  const [quantity, setQuantity] = useState('1');
  const [limitPrice, setLimitPrice] = useState('');
  const [action, setAction] = useState<'buy' | 'sell'>('buy');
  
  const positions = [
    { symbol: 'AAPL 180C 12/20', quantity: 5, avgCost: 3.45, currentPrice: 4.20, pl: 375, plPercent: 21.74 },
    { symbol: 'TSLA 250P 01/17', quantity: -3, avgCost: 8.90, currentPrice: 7.40, pl: 450, plPercent: 16.85 },
    { symbol: 'NVDA 500C 02/21', quantity: 2, avgCost: 12.30, currentPrice: 10.80, pl: -300, plPercent: -12.20 },
  ];
  
  const totalPL = positions.reduce((sum, pos) => sum + pos.pl, 0);
  
  return (
    <div className="h-full bg-gray-900 rounded-lg border border-gray-800 flex flex-col">
      <Tabs defaultValue="order" className="flex-1 flex flex-col">
        <TabsList className="w-full grid grid-cols-2 bg-gray-800/50">
          <TabsTrigger value="order">Order Ticket</TabsTrigger>
          <TabsTrigger value="positions">Positions</TabsTrigger>
        </TabsList>
        
        <TabsContent value="order" className="flex-1 flex flex-col p-4 space-y-4">
          {/* Selected Contract Info */}
          {selectedContract ? (
            <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
              <div className="text-gray-400 mb-1" style={{ fontSize: '0.7rem' }}>Selected Contract</div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span>{ticker} ${selectedContract.strike} {selectedContract.type === 'call' ? 'Call' : 'Put'}</span>
                    <span className={selectedContract.type === 'call' ? 'text-emerald-500' : 'text-red-500'}>
                      {selectedContract.type === 'call' ? '📈' : '📉'}
                    </span>
                  </div>
                  <div className="text-gray-500" style={{ fontSize: '0.75rem' }}>
                    Exp: {new Date(selectedContract.expiration).toLocaleDateString()}
                  </div>
                </div>
                <div className="text-right">
                  <div className={selectedContract.type === 'call' ? 'text-emerald-500' : 'text-red-500'}>
                    ${selectedContract.last.toFixed(2)}
                  </div>
                  <div className="text-gray-500" style={{ fontSize: '0.75rem' }}>
                    Δ {selectedContract.delta}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 border-dashed text-center text-gray-500">
              Select a contract from the options chain below
            </div>
          )}
          
          {/* Buy/Sell Toggle */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={action === 'buy' ? 'default' : 'outline'}
              onClick={() => setAction('buy')}
              className={action === 'buy' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
            >
              Buy to Open
            </Button>
            <Button
              variant={action === 'sell' ? 'default' : 'outline'}
              onClick={() => setAction('sell')}
              className={action === 'sell' ? 'bg-red-600 hover:bg-red-700' : ''}
            >
              Sell to Open
            </Button>
          </div>
          
          {/* Order Type */}
          <div className="space-y-2">
            <Label>Order Type</Label>
            <Select value={orderType} onValueChange={setOrderType}>
              <SelectTrigger className="bg-gray-800 border-gray-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="market">Market Order</SelectItem>
                <SelectItem value="limit">Limit Order</SelectItem>
                <SelectItem value="stop">Stop Order</SelectItem>
                <SelectItem value="stop-limit">Stop-Limit Order</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {/* Quantity */}
          <div className="space-y-2">
            <Label>Quantity (Contracts)</Label>
            <Input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="bg-gray-800 border-gray-700"
              min="1"
            />
          </div>
          
          {/* Limit Price */}
          {orderType !== 'market' && (
            <div className="space-y-2">
              <Label>Limit Price</Label>
              <Input
                type="number"
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                placeholder="0.00"
                className="bg-gray-800 border-gray-700"
                step="0.01"
              />
            </div>
          )}
          
          {/* Order Summary */}
          {selectedContract && (
            <div className="bg-gray-800/50 rounded-lg p-3 space-y-2 border border-gray-700">
              <div className="flex justify-between text-gray-400" style={{ fontSize: '0.85rem' }}>
                <span>Total Cost</span>
                <span className="text-gray-100">
                  ${((selectedContract.last * 100) * parseInt(quantity || '0')).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-gray-400" style={{ fontSize: '0.85rem' }}>
                <span>Commission</span>
                <span>$0.65</span>
              </div>
              <div className="border-t border-gray-700 pt-2 flex justify-between">
                <span>Total</span>
                <span className="text-lg">
                  ${((selectedContract.last * 100) * parseInt(quantity || '0') + 0.65).toFixed(2)}
                </span>
              </div>
            </div>
          )}
          
          {/* Place Order Button */}
          <Button
            size="lg"
            disabled={!selectedContract}
            className={action === 'buy' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}
          >
            <ShoppingCart className="h-4 w-4 mr-2" />
            {action === 'buy' ? 'Buy' : 'Sell'} {quantity} Contract{parseInt(quantity) !== 1 ? 's' : ''}
          </Button>
          
          <div className="flex items-start gap-2 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <AlertCircle className="h-4 w-4 text-blue-400 mt-0.5 flex-shrink-0" />
            <p className="text-blue-400" style={{ fontSize: '0.75rem' }}>
              This is a demo platform. No real trades will be executed.
            </p>
          </div>
        </TabsContent>
        
        <TabsContent value="positions" className="flex-1 flex flex-col">
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-3">
              {/* P&L Summary */}
              <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                <div className="text-gray-400 mb-2" style={{ fontSize: '0.75rem' }}>Total P&L</div>
                <div className={`text-2xl ${totalPL >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                  {totalPL >= 0 ? '+' : ''}${totalPL.toFixed(2)}
                </div>
              </div>
              
              {/* Positions List */}
              {positions.map((pos, idx) => (
                <div key={idx} className="bg-gray-800 rounded-lg p-3 border border-gray-700">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span>{pos.symbol}</span>
                        {pos.quantity > 0 ? (
                          <span className="text-emerald-500 text-xs">LONG</span>
                        ) : (
                          <span className="text-red-500 text-xs">SHORT</span>
                        )}
                      </div>
                      <div className="text-gray-500" style={{ fontSize: '0.75rem' }}>
                        Qty: {Math.abs(pos.quantity)} × ${pos.avgCost}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={pos.pl >= 0 ? 'text-emerald-500' : 'text-red-500'}>
                        {pos.pl >= 0 ? '+' : ''}${pos.pl.toFixed(2)}
                      </div>
                      <div className={`${pos.pl >= 0 ? 'text-emerald-500' : 'text-red-500'}`} style={{ fontSize: '0.75rem' }}>
                        {pos.pl >= 0 ? '+' : ''}{pos.plPercent.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1">Close</Button>
                    <Button variant="outline" size="sm" className="flex-1">Roll</Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
