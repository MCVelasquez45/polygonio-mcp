import { useState } from 'react';
import { Calendar, TrendingUp } from 'lucide-react';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { ScrollArea } from '../ui/scroll-area';
import { OptionsChainRow } from './OptionsChainRow';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';

interface OptionsChainPanelProps {
  ticker: string;
  onContractSelect: (contract: any) => void;
  selectedContract: any;
}

// Mock data generator
const generateOptionsChain = (ticker: string, strikePrice: number) => {
  const strikes: number[] = [];
  for (let i = -10; i <= 10; i++) {
    strikes.push(strikePrice + i * 5);
  }
  
  return strikes.map(strike => {
    const distanceFromATM = Math.abs(strike - strikePrice);
    const isATM = distanceFromATM < 2.5;
    
    // Calls
    const callDelta = Math.max(0.05, 1 - (distanceFromATM / 100));
    const callPrice = Math.max(0.05, (strikePrice - strike) + 5 - (distanceFromATM * 0.3));
    
    // Puts
    const putDelta = -Math.max(0.05, 1 - (distanceFromATM / 100));
    const putPrice = Math.max(0.05, (strike - strikePrice) + 5 - (distanceFromATM * 0.3));
    
    return {
      strike,
      isATM,
      call: {
        bid: Math.max(0.01, callPrice - 0.15),
        ask: callPrice + 0.15,
        last: callPrice,
        volume: Math.floor(Math.random() * 5000) + 100,
        openInterest: Math.floor(Math.random() * 10000) + 500,
        iv: (25 + Math.random() * 15).toFixed(2),
        delta: callDelta.toFixed(3),
        gamma: (0.01 + Math.random() * 0.05).toFixed(4),
        theta: (-0.05 - Math.random() * 0.1).toFixed(4),
        vega: (0.08 + Math.random() * 0.12).toFixed(4),
      },
      put: {
        bid: Math.max(0.01, putPrice - 0.15),
        ask: putPrice + 0.15,
        last: putPrice,
        volume: Math.floor(Math.random() * 5000) + 100,
        openInterest: Math.floor(Math.random() * 10000) + 500,
        iv: (25 + Math.random() * 15).toFixed(2),
        delta: putDelta.toFixed(3),
        gamma: (0.01 + Math.random() * 0.05).toFixed(4),
        theta: (-0.05 - Math.random() * 0.1).toFixed(4),
        vega: (0.08 + Math.random() * 0.12).toFixed(4),
      },
    };
  });
};

const expirations = [
  { label: 'Dec 20, 2024', value: '2024-12-20', dte: 34 },
  { label: 'Dec 27, 2024', value: '2024-12-27', dte: 41 },
  { label: 'Jan 03, 2025', value: '2025-01-03', dte: 48 },
  { label: 'Jan 17, 2025', value: '2025-01-17', dte: 62 },
  { label: 'Feb 21, 2025', value: '2025-02-21', dte: 97 },
  { label: 'Jun 20, 2025', value: '2025-06-20', dte: 216 },
];

export function OptionsChainPanel({ ticker, onContractSelect, selectedContract }: OptionsChainPanelProps) {
  const [selectedExpiration, setSelectedExpiration] = useState(expirations[0].value);
  const [optionType, setOptionType] = useState<'calls' | 'puts'>('calls');
  const currentPrice = 178.45; // Mock current price
  const chain = generateOptionsChain(ticker, currentPrice);

  return (
    <div className="h-full bg-gray-900 rounded-lg border border-gray-800 flex flex-col">
      {/* Header */}
      <div className="p-2 sm:p-3 border-b border-gray-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <h3 className="flex items-center gap-2 text-sm sm:text-base">
            <TrendingUp className="h-4 w-4 text-emerald-500" />
            <span className="hidden sm:inline">Options Chain -</span> {ticker}
          </h3>
          
          <Tabs value={optionType} onValueChange={(v) => setOptionType(v as 'calls' | 'puts')}>
            <TabsList className="bg-gray-800">
              <TabsTrigger value="calls" className="data-[state=active]:bg-emerald-600 text-xs sm:text-sm">Calls</TabsTrigger>
              <TabsTrigger value="puts" className="data-[state=active]:bg-red-600 text-xs sm:text-sm">Puts</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Select value={selectedExpiration} onValueChange={setSelectedExpiration}>
            <SelectTrigger className="w-full sm:w-48 bg-gray-800 border-gray-700 text-xs sm:text-sm">
              <Calendar className="h-3 w-3 sm:h-4 sm:w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {expirations.map(exp => (
                <SelectItem key={exp.value} value={exp.value}>
                  {exp.label} ({exp.dte} DTE)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      
      {/* Column Headers - Hide some columns on mobile */}
      <div className="p-2 sm:p-3 border-b border-gray-800 bg-gray-800/50 overflow-x-auto">
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 sm:gap-4 text-gray-400 min-w-[500px] sm:min-w-0" style={{ fontSize: '0.65rem' }}>
          <div>Strike</div>
          <div className="hidden sm:block">Breakeven</div>
          <div className="hidden sm:block">To breakeven</div>
          <div>% Change</div>
          <div className="hidden sm:block">Change</div>
          <div className="text-right">Price</div>
        </div>
      </div>
      
      {/* Options Chain Rows */}
      <ScrollArea className="flex-1">
        <div className="overflow-x-auto">
          {chain.map((row, index) => {
            // Check if we need to insert the current price separator
            const prevStrike = index > 0 ? chain[index - 1].strike : null;
            const showPriceLine = prevStrike !== null && 
                                 prevStrike < currentPrice && 
                                 row.strike >= currentPrice;
            
            return (
              <div key={row.strike}>
                {showPriceLine && (
                  <div className="flex justify-center py-2 sm:py-3">
                    <div className="px-3 sm:px-6 py-1 sm:py-2 bg-emerald-600 rounded-full text-xs sm:text-sm">
                      Share: ${currentPrice.toFixed(2)}
                    </div>
                  </div>
                )}
                <OptionsChainRow
                  data={row}
                  ticker={ticker}
                  expiration={selectedExpiration}
                  onContractSelect={onContractSelect}
                  selectedContract={selectedContract}
                  currentPrice={currentPrice}
                  optionType={optionType}
                />
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}