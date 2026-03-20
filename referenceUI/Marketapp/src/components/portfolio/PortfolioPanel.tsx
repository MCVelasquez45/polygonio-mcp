import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts';
import { TrendingUp, TrendingDown, DollarSign, Activity } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';

const portfolioStats = {
  totalValue: 54325.67,
  todayPL: 1245.32,
  todayPLPercent: 2.34,
  totalPL: 5432.67,
  totalPLPercent: 11.12,
  buyingPower: 25000.00,
};

const positions = [
  { symbol: 'AAPL 180C 12/20', quantity: 5, cost: 1725, value: 2100, pl: 375, plPercent: 21.74, type: 'call' },
  { symbol: 'TSLA 250P 01/17', quantity: 3, cost: 2670, value: 2220, pl: -450, plPercent: -16.85, type: 'put' },
  { symbol: 'NVDA 500C 02/21', quantity: 2, cost: 2460, value: 2160, pl: -300, plPercent: -12.20, type: 'call' },
  { symbol: 'AMD 120C 01/03', quantity: 4, cost: 2260, value: 2680, pl: 420, plPercent: 18.58, type: 'call' },
  { symbol: 'META 480P 12/20', quantity: 2, cost: 1560, value: 1480, pl: -80, plPercent: -5.13, type: 'put' },
];

const allocationData = [
  { name: 'Calls', value: 65, color: '#10b981' },
  { name: 'Puts', value: 35, color: '#ef4444' },
];

const performanceData = Array.from({ length: 30 }, (_, i) => ({
  day: i + 1,
  value: 50000 + Math.random() * 5000 + (i * 100),
}));

export function PortfolioPanel() {
  return (
    <div className="h-full bg-gray-900 rounded-lg border border-gray-800 flex flex-col overflow-hidden">
      <div className="p-4 border-b border-gray-800">
        <h2 className="text-xl mb-4">Portfolio Overview</h2>
        
        {/* Stats Grid */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center gap-2 text-gray-400 mb-2">
              <DollarSign className="h-4 w-4" />
              <span style={{ fontSize: '0.75rem' }}>Total Value</span>
            </div>
            <div className="text-2xl">${portfolioStats.totalValue.toLocaleString()}</div>
          </div>
          
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center gap-2 text-gray-400 mb-2">
              <Activity className="h-4 w-4" />
              <span style={{ fontSize: '0.75rem' }}>Today's P&L</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-2xl ${portfolioStats.todayPL >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {portfolioStats.todayPL >= 0 ? '+' : ''}${Math.abs(portfolioStats.todayPL).toLocaleString()}
              </span>
              <span className={portfolioStats.todayPL >= 0 ? 'text-emerald-500' : 'text-red-500'}>
                ({portfolioStats.todayPL >= 0 ? '+' : ''}{portfolioStats.todayPLPercent}%)
              </span>
            </div>
          </div>
          
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center gap-2 text-gray-400 mb-2">
              <TrendingUp className="h-4 w-4" />
              <span style={{ fontSize: '0.75rem' }}>Total P&L</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-2xl ${portfolioStats.totalPL >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {portfolioStats.totalPL >= 0 ? '+' : ''}${Math.abs(portfolioStats.totalPL).toLocaleString()}
              </span>
              <span className={portfolioStats.totalPL >= 0 ? 'text-emerald-500' : 'text-red-500'}>
                ({portfolioStats.totalPL >= 0 ? '+' : ''}{portfolioStats.totalPLPercent}%)
              </span>
            </div>
          </div>
          
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center gap-2 text-gray-400 mb-2">
              <DollarSign className="h-4 w-4" />
              <span style={{ fontSize: '0.75rem' }}>Buying Power</span>
            </div>
            <div className="text-2xl">${portfolioStats.buyingPower.toLocaleString()}</div>
          </div>
        </div>
      </div>
      
      <div className="flex-1 grid grid-cols-3 gap-4 p-4 overflow-hidden">
        {/* Performance Chart */}
        <div className="col-span-2 bg-gray-800 rounded-lg p-4 border border-gray-700">
          <h3 className="mb-4">30-Day Performance</h3>
          <ResponsiveContainer width="100%" height="85%">
            <AreaChart data={performanceData}>
              <defs>
                <linearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
              <XAxis dataKey="day" stroke="#6b7280" style={{ fontSize: '0.7rem' }} />
              <YAxis stroke="#6b7280" style={{ fontSize: '0.7rem' }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                formatter={(value: any) => [`$${value.toLocaleString()}`, 'Portfolio Value']}
              />
              <Area type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} fill="url(#portfolioGradient)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        
        {/* Allocation Pie Chart */}
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <h3 className="mb-4">Allocation</h3>
          <ResponsiveContainer width="100%" height="85%">
            <PieChart>
              <Pie
                data={allocationData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={5}
                dataKey="value"
              >
                {allocationData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                formatter={(value: any) => `${value}%`}
              />
              <Legend
                verticalAlign="bottom"
                height={36}
                iconType="circle"
                wrapperStyle={{ fontSize: '0.85rem' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
      
      {/* Positions List */}
      <div className="border-t border-gray-800">
        <div className="p-4">
          <h3 className="mb-3">Open Positions</h3>
        </div>
        <ScrollArea className="h-64">
          <div className="px-4 pb-4 space-y-2">
            {positions.map((pos, idx) => (
              <div key={idx} className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span>{pos.symbol}</span>
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        pos.type === 'call' ? 'bg-emerald-500/20 text-emerald-500' : 'bg-red-500/20 text-red-500'
                      }`}>
                        {pos.type.toUpperCase()}
                      </span>
                    </div>
                    <div className="text-gray-400" style={{ fontSize: '0.85rem' }}>
                      {pos.quantity} contracts × ${(pos.cost / pos.quantity).toFixed(2)} avg
                    </div>
                  </div>
                  
                  <div className="text-center px-4">
                    <div className="text-gray-400 mb-1" style={{ fontSize: '0.75rem' }}>Value</div>
                    <div>${pos.value.toLocaleString()}</div>
                  </div>
                  
                  <div className="text-right">
                    <div className={pos.pl >= 0 ? 'text-emerald-500' : 'text-red-500'}>
                      {pos.pl >= 0 ? '+' : ''}${Math.abs(pos.pl).toFixed(2)}
                    </div>
                    <div className={`${pos.pl >= 0 ? 'text-emerald-500' : 'text-red-500'}`} style={{ fontSize: '0.85rem' }}>
                      {pos.pl >= 0 ? '+' : ''}{pos.plPercent.toFixed(2)}%
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
