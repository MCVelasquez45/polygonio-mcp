import { useState } from 'react';
import { Search, Filter, TrendingUp, Volume2, Zap } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { ScrollArea } from '../ui/scroll-area';
import { Label } from '../ui/label';

interface OptionsScannerProps {
  onTickerSelect: (ticker: string) => void;
}

const scanResults = [
  { ticker: 'AAPL', strike: 180, type: 'call', expiry: '12/20/24', ivRank: 78, volume: 12543, oi: 45321, premium: 4.25, unusual: true },
  { ticker: 'TSLA', strike: 250, type: 'put', expiry: '01/17/25', ivRank: 82, volume: 8765, oi: 23456, premium: 8.90, unusual: true },
  { ticker: 'NVDA', strike: 500, type: 'call', expiry: '12/27/24', ivRank: 65, volume: 6543, oi: 34567, premium: 12.30, unusual: false },
  { ticker: 'AMD', strike: 120, type: 'call', expiry: '01/03/25', ivRank: 71, volume: 5432, oi: 28901, premium: 5.65, unusual: true },
  { ticker: 'META', strike: 480, type: 'put', expiry: '12/20/24', ivRank: 58, volume: 4321, oi: 19876, premium: 7.80, unusual: false },
  { ticker: 'AMZN', strike: 175, type: 'call', expiry: '02/21/25', ivRank: 69, volume: 7654, oi: 41234, premium: 6.45, unusual: true },
  { ticker: 'MSFT', strike: 380, type: 'call', expiry: '01/17/25', ivRank: 54, volume: 3210, oi: 25678, premium: 9.20, unusual: false },
  { ticker: 'SPY', strike: 460, type: 'put', expiry: '12/27/24', ivRank: 48, volume: 9876, oi: 56789, premium: 3.75, unusual: false },
];

const presetScans = [
  { name: 'High IV Rank', icon: TrendingUp, description: 'IV Rank > 70%' },
  { name: 'Unusual Volume', icon: Volume2, description: 'Volume > 5x avg' },
  { name: 'Earnings Plays', icon: Zap, description: 'Earnings this week' },
  { name: 'Weekly Expiry', icon: Filter, description: 'Exp < 7 days' },
];

export function OptionsScanner({ onTickerSelect }: OptionsScannerProps) {
  const [selectedScan, setSelectedScan] = useState('High IV Rank');
  const [minIVRank, setMinIVRank] = useState('50');
  const [minVolume, setMinVolume] = useState('1000');
  
  return (
    <div className="h-full bg-gray-900 rounded-lg border border-gray-800 flex">
      {/* Filters Sidebar */}
      <div className="w-80 border-r border-gray-800 flex flex-col">
        <div className="p-4 border-b border-gray-800">
          <h3 className="flex items-center gap-2 mb-4">
            <Search className="h-5 w-5 text-emerald-500" />
            Options Scanner
          </h3>
          
          {/* Preset Scans */}
          <div className="space-y-2">
            <Label className="text-gray-400" style={{ fontSize: '0.75rem' }}>Preset Scans</Label>
            {presetScans.map((scan) => (
              <Button
                key={scan.name}
                variant={selectedScan === scan.name ? 'default' : 'outline'}
                className="w-full justify-start gap-2"
                onClick={() => setSelectedScan(scan.name)}
              >
                <scan.icon className="h-4 w-4" />
                <div className="text-left flex-1">
                  <div>{scan.name}</div>
                  <div className="text-xs text-gray-400">{scan.description}</div>
                </div>
              </Button>
            ))}
          </div>
        </div>
        
        <ScrollArea className="flex-1 p-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Strategy Type</Label>
              <Select defaultValue="all">
                <SelectTrigger className="bg-gray-800 border-gray-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Strategies</SelectItem>
                  <SelectItem value="calls">Calls Only</SelectItem>
                  <SelectItem value="puts">Puts Only</SelectItem>
                  <SelectItem value="spreads">Spreads</SelectItem>
                  <SelectItem value="straddles">Straddles</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label>Min IV Rank (%)</Label>
              <Input
                type="number"
                value={minIVRank}
                onChange={(e) => setMinIVRank(e.target.value)}
                className="bg-gray-800 border-gray-700"
                min="0"
                max="100"
              />
            </div>
            
            <div className="space-y-2">
              <Label>Min Volume</Label>
              <Input
                type="number"
                value={minVolume}
                onChange={(e) => setMinVolume(e.target.value)}
                className="bg-gray-800 border-gray-700"
                min="0"
              />
            </div>
            
            <div className="space-y-2">
              <Label>Expiration Range</Label>
              <Select defaultValue="all">
                <SelectTrigger className="bg-gray-800 border-gray-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Expirations</SelectItem>
                  <SelectItem value="weekly">Weekly (0-7 DTE)</SelectItem>
                  <SelectItem value="monthly">Monthly (7-45 DTE)</SelectItem>
                  <SelectItem value="leaps">LEAPS (180+ DTE)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label>Premium Range</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Min"
                  className="bg-gray-800 border-gray-700"
                />
                <Input
                  placeholder="Max"
                  className="bg-gray-800 border-gray-700"
                />
              </div>
            </div>
            
            <Button className="w-full gap-2">
              <Search className="h-4 w-4" />
              Run Scan
            </Button>
          </div>
        </ScrollArea>
      </div>
      
      {/* Results */}
      <div className="flex-1 flex flex-col">
        <div className="p-4 border-b border-gray-800">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="mb-1">Scan Results</h3>
              <p className="text-gray-500" style={{ fontSize: '0.85rem' }}>
                Found {scanResults.length} opportunities
              </p>
            </div>
            <Button variant="outline" size="sm">
              Export Results
            </Button>
          </div>
        </div>
        
        <ScrollArea className="flex-1">
          <div className="p-4">
            <div className="grid gap-3">
              {scanResults.map((result, idx) => (
                <button
                  key={idx}
                  onClick={() => onTickerSelect(result.ticker)}
                  className="bg-gray-800 hover:bg-gray-800/70 rounded-lg p-4 border border-gray-700 transition-colors text-left"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">{result.ticker}</span>
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          result.type === 'call' ? 'bg-emerald-500/20 text-emerald-500' : 'bg-red-500/20 text-red-500'
                        }`}>
                          {result.type.toUpperCase()}
                        </span>
                        {result.unusual && (
                          <span className="px-2 py-0.5 rounded text-xs bg-yellow-500/20 text-yellow-500">
                            UNUSUAL
                          </span>
                        )}
                      </div>
                      <div className="text-gray-400" style={{ fontSize: '0.85rem' }}>
                        ${result.strike} Strike · Exp {result.expiry}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xl">${result.premium.toFixed(2)}</div>
                      <div className="text-gray-400" style={{ fontSize: '0.85rem' }}>Premium</div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <div className="text-gray-400" style={{ fontSize: '0.75rem' }}>IV Rank</div>
                      <div className="text-blue-400">{result.ivRank}%</div>
                    </div>
                    <div>
                      <div className="text-gray-400" style={{ fontSize: '0.75rem' }}>Volume</div>
                      <div>{result.volume.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-gray-400" style={{ fontSize: '0.75rem' }}>Open Interest</div>
                      <div>{result.oi.toLocaleString()}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
