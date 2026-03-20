import { useState } from 'react';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Button } from '../ui/button';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface ChartPanelProps {
  ticker: string;
}

// Generate mock candlestick data
const generateChartData = () => {
  const data = [];
  let price = 170;
  
  for (let i = 0; i < 100; i++) {
    const change = (Math.random() - 0.48) * 3;
    price += change;
    
    data.push({
      time: new Date(Date.now() - (100 - i) * 3600000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      price: price,
      volume: Math.floor(Math.random() * 1000000) + 500000,
      high: price + Math.random() * 2,
      low: price - Math.random() * 2,
      open: price + (Math.random() - 0.5),
      close: price,
    });
  }
  
  return data;
};

const timeframes = ['1D', '5D', '1M', '3M', '6M', '1Y', 'ALL'];
const indicators = ['None', 'SMA', 'EMA', 'BB', 'VWAP'];

export function ChartPanel({ ticker }: ChartPanelProps) {
  const [selectedTimeframe, setSelectedTimeframe] = useState('1D');
  const [selectedIndicator, setSelectedIndicator] = useState('None');
  const [chartType, setChartType] = useState<'area' | 'candlestick'>('area');
  
  const data = generateChartData();
  const currentPrice = data[data.length - 1].price;
  const openPrice = data[0].price;
  const change = currentPrice - openPrice;
  const changePercent = (change / openPrice) * 100;
  
  return (
    <div className="h-96 bg-gray-900 rounded-lg border border-gray-800 flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">${currentPrice.toFixed(2)}</span>
              <span className={`flex items-center gap-1 ${change >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {change >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                {change >= 0 ? '+' : ''}{change.toFixed(2)} ({changePercent.toFixed(2)}%)
              </span>
            </div>
            <div className="text-gray-500" style={{ fontSize: '0.75rem' }}>
              {ticker}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Timeframe Buttons */}
          <div className="flex gap-1">
            {timeframes.map(tf => (
              <Button
                key={tf}
                variant={selectedTimeframe === tf ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setSelectedTimeframe(tf)}
                className="h-7 px-3"
              >
                {tf}
              </Button>
            ))}
          </div>
          
          {/* Indicator Selector */}
          <div className="flex gap-1 ml-2 border-l border-gray-700 pl-2">
            {indicators.map(ind => (
              <Button
                key={ind}
                variant={selectedIndicator === ind ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setSelectedIndicator(ind)}
                className="h-7 px-3"
              >
                {ind}
              </Button>
            ))}
          </div>
        </div>
      </div>
      
      {/* Chart */}
      <div className="flex-1 p-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={change >= 0 ? "#10b981" : "#ef4444"} stopOpacity={0.3}/>
                <stop offset="95%" stopColor={change >= 0 ? "#10b981" : "#ef4444"} stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
            <XAxis 
              dataKey="time" 
              stroke="#6b7280"
              style={{ fontSize: '0.7rem' }}
              tickLine={false}
            />
            <YAxis 
              stroke="#6b7280"
              style={{ fontSize: '0.7rem' }}
              tickLine={false}
              domain={['auto', 'auto']}
              tickFormatter={(value) => `$${value.toFixed(2)}`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1f2937',
                border: '1px solid #374151',
                borderRadius: '8px',
              }}
              labelStyle={{ color: '#9ca3af' }}
              itemStyle={{ color: change >= 0 ? '#10b981' : '#ef4444' }}
            />
            <ReferenceLine 
              y={openPrice} 
              stroke="#6b7280" 
              strokeDasharray="3 3"
              label={{ value: 'Open', fill: '#6b7280', fontSize: 10 }}
            />
            <Area
              type="monotone"
              dataKey="price"
              stroke={change >= 0 ? "#10b981" : "#ef4444"}
              strokeWidth={2}
              fill="url(#colorPrice)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      
      {/* Volume Chart */}
      <div className="h-20 px-4 pb-2 border-t border-gray-800">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <Bar dataKey="volume" fill="#6b7280" opacity={0.5} />
            <XAxis dataKey="time" hide />
            <YAxis hide />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1f2937',
                border: '1px solid #374151',
                borderRadius: '8px',
              }}
              formatter={(value: any) => value.toLocaleString()}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
