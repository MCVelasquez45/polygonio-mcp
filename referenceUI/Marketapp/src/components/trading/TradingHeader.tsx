import { Search, TrendingUp, ScanSearch, Briefcase, Settings, Menu } from 'lucide-react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';

interface TradingHeaderProps {
  selectedTicker: string;
  onTickerChange: (ticker: string) => void;
  currentView: 'trading' | 'scanner' | 'portfolio';
  onViewChange: (view: 'trading' | 'scanner' | 'portfolio') => void;
  onToggleSidebar: () => void;
  isSidebarOpen: boolean;
}

export function TradingHeader({ selectedTicker, onTickerChange, currentView, onViewChange, onToggleSidebar, isSidebarOpen }: TradingHeaderProps) {
  return (
    <header className="h-14 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-2 sm:px-4">
      <div className="flex items-center gap-2 sm:gap-4">
        {/* Mobile Menu Button */}
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onToggleSidebar}
        >
          <Menu className="h-5 w-5" />
        </Button>
        
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 sm:h-6 sm:w-6 text-emerald-500" />
          <span className="text-base sm:text-xl tracking-tight hidden xs:block">
            Options<span className="text-emerald-500">Trader</span>
          </span>
        </div>
        
        <div className="hidden md:flex items-center gap-1 ml-4">
          <Button
            variant={currentView === 'trading' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => onViewChange('trading')}
            className="gap-2"
          >
            <TrendingUp className="h-4 w-4" />
            <span className="hidden lg:inline">Trading</span>
          </Button>
          <Button
            variant={currentView === 'scanner' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => onViewChange('scanner')}
            className="gap-2"
          >
            <ScanSearch className="h-4 w-4" />
            <span className="hidden lg:inline">Scanner</span>
          </Button>
          <Button
            variant={currentView === 'portfolio' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => onViewChange('portfolio')}
            className="gap-2"
          >
            <Briefcase className="h-4 w-4" />
            <span className="hidden lg:inline">Portfolio</span>
          </Button>
        </div>
      </div>
      
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="relative">
          <Search className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 h-3 w-3 sm:h-4 sm:w-4 text-gray-400" />
          <Input
            placeholder="Ticker..."
            className="pl-7 sm:pl-9 w-20 sm:w-32 md:w-48 lg:w-64 bg-gray-800 border-gray-700 text-sm"
            defaultValue={selectedTicker}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onTickerChange(e.currentTarget.value.toUpperCase());
              }
            }}
          />
        </div>
        
        <Button variant="ghost" size="icon" className="hidden sm:flex">
          <Settings className="h-5 w-5" />
        </Button>
      </div>
      
      {/* Mobile Bottom Nav */}
      <div className="fixed bottom-0 left-0 right-0 h-14 bg-gray-900 border-t border-gray-800 flex md:hidden items-center justify-around z-30">
        <Button
          variant={currentView === 'trading' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => onViewChange('trading')}
          className="flex-col h-12 gap-1"
        >
          <TrendingUp className="h-4 w-4" />
          <span className="text-xs">Trading</span>
        </Button>
        <Button
          variant={currentView === 'scanner' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => onViewChange('scanner')}
          className="flex-col h-12 gap-1"
        >
          <ScanSearch className="h-4 w-4" />
          <span className="text-xs">Scanner</span>
        </Button>
        <Button
          variant={currentView === 'portfolio' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => onViewChange('portfolio')}
          className="flex-col h-12 gap-1"
        >
          <Briefcase className="h-4 w-4" />
          <span className="text-xs">Portfolio</span>
        </Button>
      </div>
    </header>
  );
}