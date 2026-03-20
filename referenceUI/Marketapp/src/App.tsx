import { useState } from 'react';
import { TradingHeader } from './components/trading/TradingHeader';
import { Sidebar } from './components/trading/Sidebar';
import { OptionsChainPanel } from './components/options/OptionsChainPanel';
import { ChartPanel } from './components/charts/ChartPanel';
import { OrderTicketPanel } from './components/trading/OrderTicketPanel';
import { GreeksDashboard } from './components/options/GreeksDashboard';
import { OptionsScanner } from './components/screener/OptionsScanner';
import { PortfolioPanel } from './components/portfolio/PortfolioPanel';

type View = 'trading' | 'scanner' | 'portfolio';

export default function App() {
  const [selectedTicker, setSelectedTicker] = useState('AAPL');
  const [currentView, setCurrentView] = useState<View>('trading');
  const [selectedContract, setSelectedContract] = useState<any>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="h-screen w-full flex flex-col bg-gray-950 text-gray-100">
      <TradingHeader 
        selectedTicker={selectedTicker}
        onTickerChange={setSelectedTicker}
        currentView={currentView}
        onViewChange={setCurrentView}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        isSidebarOpen={isSidebarOpen}
      />
      
      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile Sidebar Overlay */}
        {isSidebarOpen && (
          <div 
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}
        
        {/* Sidebar */}
        <div className={`
          fixed lg:relative inset-y-0 left-0 z-50 lg:z-0
          transform transition-transform duration-300 ease-in-out
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}>
          <Sidebar 
            selectedTicker={selectedTicker}
            onTickerSelect={(ticker) => {
              setSelectedTicker(ticker);
              setIsSidebarOpen(false);
            }}
          />
        </div>
        
        <main className="flex-1 flex flex-col overflow-hidden">
          {currentView === 'trading' && (
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-2 p-2 overflow-auto lg:overflow-hidden">
              {/* Chart and Greeks - Left Side */}
              <div className="lg:col-span-8 flex flex-col gap-2 min-h-[400px] lg:overflow-hidden">
                <ChartPanel ticker={selectedTicker} />
                <GreeksDashboard ticker={selectedTicker} />
              </div>
              
              {/* Order Ticket - Right Side */}
              <div className="lg:col-span-4 min-h-[400px] lg:overflow-hidden">
                <OrderTicketPanel 
                  ticker={selectedTicker}
                  selectedContract={selectedContract}
                />
              </div>
              
              {/* Options Chain - Bottom Full Width */}
              <div className="lg:col-span-12 min-h-[500px] lg:overflow-hidden">
                <OptionsChainPanel 
                  ticker={selectedTicker}
                  onContractSelect={setSelectedContract}
                  selectedContract={selectedContract}
                />
              </div>
            </div>
          )}
          
          {currentView === 'scanner' && (
            <div className="flex-1 overflow-auto lg:overflow-hidden p-2">
              <OptionsScanner onTickerSelect={setSelectedTicker} />
            </div>
          )}
          
          {currentView === 'portfolio' && (
            <div className="flex-1 overflow-auto lg:overflow-hidden p-2">
              <PortfolioPanel />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}