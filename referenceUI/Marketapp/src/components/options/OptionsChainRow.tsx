interface OptionsChainRowProps {
  data: any;
  ticker: string;
  expiration: string;
  onContractSelect: (contract: any) => void;
  selectedContract: any;
  currentPrice: number;
  optionType: 'calls' | 'puts';
}

export function OptionsChainRow({ data, ticker, expiration, onContractSelect, selectedContract, currentPrice, optionType }: OptionsChainRowProps) {
  const { strike, call, put } = data;
  
  const option = optionType === 'calls' ? call : put;
  const breakeven = optionType === 'calls' 
    ? strike + option.last 
    : strike - option.last;
  const toBreakeven = ((breakeven - currentPrice) / currentPrice * 100).toFixed(2);
  const priceChange = (Math.random() - 0.5) * option.last * 0.2; // Mock change
  const percentChange = (priceChange / option.last * 100).toFixed(2);
  
  const handleClick = () => {
    const contract = {
      type: optionType === 'calls' ? 'call' : 'put',
      ticker,
      strike,
      expiration,
      ...option,
    };
    
    // Toggle selection - if clicking same contract, deselect it
    if (isSelected) {
      onContractSelect(null);
    } else {
      onContractSelect(contract);
    }
  };
  
  const isSelected = selectedContract?.type === (optionType === 'calls' ? 'call' : 'put') && 
                     selectedContract?.strike === strike;
  
  const isProfitable = parseFloat(percentChange) > 0;
  
  return (
    <div className={`border-b border-gray-800/50 ${isSelected ? 'bg-gray-800/70' : ''}`}>
      <button
        onClick={handleClick}
        className={`w-full p-2 sm:p-3 hover:bg-gray-800/50 transition-colors text-left`}
      >
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 sm:gap-4 items-center min-w-[500px] sm:min-w-0">
          <div className="text-gray-100 text-xs sm:text-sm">
            ${strike.toFixed(2)}
          </div>
          <div className="text-gray-300 text-xs sm:text-sm hidden sm:block">
            ${breakeven.toFixed(2)}
          </div>
          <div className="text-gray-400 text-xs sm:text-sm hidden sm:block">
            {toBreakeven}%
          </div>
          <div className={`${isProfitable ? 'text-emerald-500' : 'text-red-500'} text-xs sm:text-sm`}>
            {isProfitable ? '+' : ''}{percentChange}%
          </div>
          <div className={`${isProfitable ? 'text-emerald-500' : 'text-red-500'} text-xs sm:text-sm hidden sm:block`}>
            {isProfitable ? '+' : ''}${priceChange.toFixed(2)}
          </div>
          <div className="flex items-center justify-end gap-1 sm:gap-2">
            <span className={`${
              isProfitable ? 'text-emerald-500 border-emerald-500' : 'text-orange-500 border-orange-500'
            } px-2 sm:px-3 py-0.5 sm:py-1 rounded border text-xs sm:text-sm`}>
              ${option.last.toFixed(2)}
            </span>
            <button 
              className={`w-6 h-6 sm:w-8 sm:h-8 rounded border ${
                isProfitable ? 'border-emerald-500 text-emerald-500' : 'border-orange-500 text-orange-500'
              } hover:bg-gray-800 flex items-center justify-center text-xs sm:text-base`}
              onClick={(e) => {
                e.stopPropagation();
                // Handle quick add
              }}
            >
              +
            </button>
          </div>
        </div>
      </button>
      
      {/* Expanded Contract Details */}
      {isSelected && (
        <div className="px-3 sm:px-6 py-3 sm:py-4 bg-gray-800/30 border-t border-gray-700">
          <div className="mb-3 sm:mb-4">
            <div className="text-xs sm:text-sm text-gray-400 mb-3">
              {ticker} ${strike.toFixed(2)} {optionType === 'calls' ? 'Call' : 'Put'} {new Date(expiration).toLocaleDateString()}
            </div>
          </div>
          
          {/* Price Information Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-6 mb-4 sm:mb-6">
            <div>
              <div className="text-gray-500 mb-1" style={{ fontSize: '0.7rem' }}>Bid</div>
              <div className="text-gray-100 text-xs sm:text-sm">${option.bid.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-gray-500 mb-1" style={{ fontSize: '0.7rem' }}>Ask</div>
              <div className="text-gray-100 text-xs sm:text-sm">${option.ask.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-gray-500 mb-1" style={{ fontSize: '0.7rem' }}>Mark</div>
              <div className="text-gray-100 text-xs sm:text-sm">${((option.bid + option.ask) / 2).toFixed(2)}</div>
            </div>
            <div>
              <div className="text-gray-500 mb-1" style={{ fontSize: '0.7rem' }}>High</div>
              <div className="text-gray-100 text-xs sm:text-sm">${(option.last * 1.08).toFixed(2)}</div>
            </div>
            <div>
              <div className="text-gray-500 mb-1" style={{ fontSize: '0.7rem' }}>Low</div>
              <div className="text-gray-100 text-xs sm:text-sm">${(option.last * 0.94).toFixed(2)}</div>
            </div>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-6 mb-4 sm:mb-6">
            <div>
              <div className="text-gray-500 mb-1" style={{ fontSize: '0.7rem' }}>Last trade</div>
              <div className="text-gray-100 text-xs sm:text-sm">${option.last.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-gray-500 mb-1" style={{ fontSize: '0.7rem' }}>Previous close</div>
              <div className="text-gray-100 text-xs sm:text-sm">${(option.last * 0.98).toFixed(2)}</div>
            </div>
            <div>
              <div className="text-gray-500 mb-1" style={{ fontSize: '0.7rem' }}>Volume</div>
              <div className="text-gray-100 text-xs sm:text-sm">{option.volume.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-gray-500 mb-1" style={{ fontSize: '0.7rem' }}>Implied volatility</div>
              <div className="text-gray-100 text-xs sm:text-sm">{option.iv}%</div>
            </div>
            <div>
              <div className="text-gray-500 mb-1" style={{ fontSize: '0.7rem' }}>Open interest</div>
              <div className="text-gray-100 text-xs sm:text-sm">{option.openInterest.toLocaleString()}</div>
            </div>
          </div>
          
          {/* The Greeks */}
          <div className="pt-3 sm:pt-4 border-t border-gray-700">
            <div className="text-gray-400 mb-2 sm:mb-3 text-xs sm:text-sm">The Greeks</div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-6">
              <div>
                <div className="text-gray-500 mb-1" style={{ fontSize: '0.7rem' }}>Delta</div>
                <div className="text-gray-100 text-xs sm:text-sm">{option.delta}</div>
              </div>
              <div>
                <div className="text-gray-500 mb-1" style={{ fontSize: '0.7rem' }}>Gamma</div>
                <div className="text-gray-100 text-xs sm:text-sm">{option.gamma}</div>
              </div>
              <div>
                <div className="text-gray-500 mb-1" style={{ fontSize: '0.7rem' }}>Theta</div>
                <div className="text-gray-100 text-xs sm:text-sm">{option.theta}</div>
              </div>
              <div>
                <div className="text-gray-500 mb-1" style={{ fontSize: '0.7rem' }}>Vega</div>
                <div className="text-gray-100 text-xs sm:text-sm">{option.vega}</div>
              </div>
              <div>
                <div className="text-gray-500 mb-1" style={{ fontSize: '0.7rem' }}>Rho</div>
                <div className="text-gray-100 text-xs sm:text-sm">{(Math.random() * 0.01).toFixed(4)}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}