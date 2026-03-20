import { TrendingUp, TrendingDown } from 'lucide-react';

interface GreeksDashboardProps {
  ticker: string;
}

const greeksData = [
  { name: 'Delta', value: '+0.6523', description: 'Rate of change', color: 'text-blue-500' },
  { name: 'Gamma', value: '+0.0234', description: 'Delta acceleration', color: 'text-purple-500' },
  { name: 'Theta', value: '-0.1234', description: 'Time decay', color: 'text-red-500' },
  { name: 'Vega', value: '+0.2156', description: 'IV sensitivity', color: 'text-emerald-500' },
  { name: 'Rho', value: '+0.0891', description: 'Interest rate', color: 'text-yellow-500' },
  { name: 'IV Rank', value: '67%', description: '52-week rank', color: 'text-orange-500' },
];

export function GreeksDashboard({ ticker }: GreeksDashboardProps) {
  return (
    <div className="h-32 bg-gray-900 rounded-lg border border-gray-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-gray-400" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Greeks & Volatility
        </h3>
      </div>
      
      <div className="grid grid-cols-6 gap-4">
        {greeksData.map((greek) => (
          <div key={greek.name} className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
            <div className="text-gray-400 mb-1" style={{ fontSize: '0.7rem' }}>
              {greek.name}
            </div>
            <div className={`text-xl ${greek.color}`}>
              {greek.value}
            </div>
            <div className="text-gray-500 mt-1" style={{ fontSize: '0.65rem' }}>
              {greek.description}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
