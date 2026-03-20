import { Star, TrendingUp, TrendingDown, MessageSquare, List, Bell, Send } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';
import { Input } from '../ui/input';

interface SidebarProps {
  selectedTicker: string;
  onTickerSelect: (ticker: string) => void;
}

const watchlist = [
  { symbol: 'AAPL', name: 'Apple Inc.', price: 178.45, change: 2.34, changePercent: 1.33, volume: '52.4M' },
  { symbol: 'TSLA', name: 'Tesla Inc.', price: 242.84, change: -3.21, changePercent: -1.30, volume: '98.2M' },
  { symbol: 'MSFT', name: 'Microsoft Corp.', price: 378.91, change: 5.67, changePercent: 1.52, volume: '28.1M' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', price: 495.22, change: 8.45, changePercent: 1.74, volume: '41.3M' },
  { symbol: 'SPY', name: 'SPDR S&P 500', price: 458.12, change: 1.23, changePercent: 0.27, volume: '78.5M' },
  { symbol: 'AMD', name: 'AMD Inc.', price: 118.67, change: -2.11, changePercent: -1.75, volume: '62.8M' },
  { symbol: 'META', name: 'Meta Platforms', price: 482.33, change: 6.89, changePercent: 1.45, volume: '15.7M' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', price: 175.43, change: 2.87, changePercent: 1.66, volume: '44.2M' },
];

interface Alert {
  id: string;
  type: 'economic' | 'congress' | 'social' | 'market';
  title: string;
  content: string;
  timestamp: string;
  ticker?: string;
  impact?: 'high' | 'medium' | 'low';
}

const mockAlerts: Alert[] = [
  {
    id: '1',
    type: 'economic',
    title: 'CPI Data Released',
    content: 'Consumer Price Index came in at 3.2%, above expectations of 3.1%. Markets reacting positively.',
    timestamp: '2 min ago',
    impact: 'high',
  },
  {
    id: '2',
    type: 'congress',
    title: 'Congressional Trade Alert',
    content: 'Rep. Nancy Pelosi disclosed purchase of NVDA call options worth $1M-5M.',
    timestamp: '15 min ago',
    ticker: 'NVDA',
    impact: 'medium',
  },
  {
    id: '3',
    type: 'social',
    title: 'Presidential Tweet',
    content: '@POTUS: "Great progress on infrastructure. American innovation leading the way in tech and manufacturing."',
    timestamp: '1 hour ago',
    impact: 'medium',
  },
  {
    id: '4',
    type: 'market',
    title: 'Fed Minutes Released',
    content: 'Federal Reserve indicates potential rate cut in Q2 2025. Bond yields dropping.',
    timestamp: '2 hours ago',
    impact: 'high',
  },
  {
    id: '5',
    type: 'congress',
    title: 'Senate Trading Activity',
    content: 'Sen. Mark Warner disclosed sale of TSLA shares worth $500K-1M.',
    timestamp: '3 hours ago',
    ticker: 'TSLA',
    impact: 'low',
  },
  {
    id: '6',
    type: 'economic',
    title: 'Jobs Report Preview',
    content: 'Non-farm payrolls expected tomorrow at 8:30 AM ET. Consensus: 180K new jobs.',
    timestamp: '4 hours ago',
    impact: 'high',
  },
];

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

const initialChatMessages: ChatMessage[] = [
  {
    id: '1',
    role: 'assistant',
    content: "Hi! I'm your market intelligence assistant. Ask me about any ticker, options strategies, or market conditions.",
    timestamp: '10:00 AM',
  },
];

export function Sidebar({ selectedTicker, onTickerSelect }: SidebarProps) {
  const [view, setView] = useState<'watchlist' | 'chat'>('watchlist');
  const [chatTab, setChatTab] = useState<'chat' | 'alerts'>('alerts');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(initialChatMessages);
  const [chatInput, setChatInput] = useState('');

  const handleSendMessage = () => {
    if (!chatInput.trim()) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: chatInput,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setChatMessages(prev => [...prev, userMessage]);
    setChatInput('');

    // Simulate AI response
    setTimeout(() => {
      const aiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Analyzing ${selectedTicker}... Based on current market data, I can provide insights on price action, options flow, and technical indicators. What specific aspect would you like to explore?`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setChatMessages(prev => [...prev, aiMessage]);
    }, 1000);
  };

  const getImpactColor = (impact?: string) => {
    switch (impact) {
      case 'high': return 'text-red-500';
      case 'medium': return 'text-yellow-500';
      case 'low': return 'text-blue-500';
      default: return 'text-gray-500';
    }
  };

  const getAlertIcon = (type: string) => {
    switch (type) {
      case 'economic': return '📊';
      case 'congress': return '🏛️';
      case 'social': return '🐦';
      case 'market': return '💹';
      default: return '📢';
    }
  };

  return (
    <div className="w-full sm:w-64 lg:w-72 bg-gray-900 border-r border-gray-800 flex flex-col h-full">
      <div className="p-2 sm:p-3 border-b border-gray-800">
        <div className="flex items-center gap-1 sm:gap-2 mb-2 sm:mb-3">
          <Button 
            variant={view === 'watchlist' ? 'default' : 'ghost'} 
            size="sm" 
            className="flex-1 text-xs sm:text-sm"
            onClick={() => setView('watchlist')}
          >
            <List className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
            <span className="hidden xs:inline">Watchlist</span>
          </Button>
          <Button 
            variant={view === 'chat' ? 'default' : 'ghost'} 
            size="sm" 
            className="flex-1 text-xs sm:text-sm"
            onClick={() => setView('chat')}
          >
            <MessageSquare className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
            <span className="hidden xs:inline">Intel</span>
          </Button>
        </div>
        
        {view === 'chat' && (
          <Tabs value={chatTab} onValueChange={(v) => setChatTab(v as 'chat' | 'alerts')}>
            <TabsList className="w-full bg-gray-800">
              <TabsTrigger value="alerts" className="flex-1 text-xs">
                <Bell className="h-3 w-3 mr-1" />
                Alerts
              </TabsTrigger>
              <TabsTrigger value="chat" className="flex-1 text-xs">
                <MessageSquare className="h-3 w-3 mr-1" />
                Chat
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>
      
      <ScrollArea className="flex-1">
        {view === 'watchlist' ? (
          <div className="p-2 space-y-1">
            {watchlist.map((stock) => (
              <button
                key={stock.symbol}
                onClick={() => onTickerSelect(stock.symbol)}
                className={`w-full p-3 rounded-lg transition-colors text-left ${
                  selectedTicker === stock.symbol
                    ? 'bg-gray-800 border border-emerald-500/30'
                    : 'hover:bg-gray-800/50 border border-transparent'
                }`}
              >
                <div className="flex items-start justify-between mb-1">
                  <div>
                    <div className="flex items-center gap-2">
                      <span>{stock.symbol}</span>
                      {stock.change > 0 ? (
                        <TrendingUp className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <TrendingDown className="h-3 w-3 text-red-500" />
                      )}
                    </div>
                    <div className="text-gray-500" style={{ fontSize: '0.75rem' }}>
                      {stock.name}
                    </div>
                  </div>
                  <div className="text-right">
                    <div>${stock.price.toFixed(2)}</div>
                    <div
                      className={stock.change > 0 ? 'text-emerald-500' : 'text-red-500'}
                      style={{ fontSize: '0.75rem' }}
                    >
                      {stock.change > 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                    </div>
                  </div>
                </div>
                <div className="text-gray-500" style={{ fontSize: '0.7rem' }}>
                  Vol: {stock.volume}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="p-2">
            {chatTab === 'alerts' ? (
              <div className="space-y-2">
                {mockAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="p-3 bg-gray-800/50 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors cursor-pointer"
                    onClick={() => alert.ticker && onTickerSelect(alert.ticker)}
                  >
                    <div className="flex items-start gap-2 mb-2">
                      <span className="text-lg">{getAlertIcon(alert.type)}</span>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm">{alert.title}</span>
                          {alert.impact && (
                            <span className={`text-xs ${getImpactColor(alert.impact)}`}>
                              ●
                            </span>
                          )}
                        </div>
                        <p className="text-gray-400 text-xs leading-relaxed mb-2">
                          {alert.content}
                        </p>
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500 text-xs">{alert.timestamp}</span>
                          {alert.ticker && (
                            <span className="text-emerald-500 text-xs">{alert.ticker}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 mb-3">
                  <div className="text-blue-400 text-xs mb-1">Watching: {selectedTicker}</div>
                  <div className="text-gray-400 text-xs">
                    Ask me about price targets, options strategies, or market sentiment.
                  </div>
                </div>
                
                {chatMessages.map((message) => (
                  <div
                    key={message.id}
                    className={`${
                      message.role === 'user' 
                        ? 'ml-4 bg-emerald-600 text-white' 
                        : 'mr-4 bg-gray-800 text-gray-100'
                    } rounded-lg p-3`}
                  >
                    <div className="text-sm mb-1">{message.content}</div>
                    <div className="text-xs opacity-60">{message.timestamp}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {view === 'chat' && chatTab === 'chat' && (
        <div className="p-3 border-t border-gray-800">
          <div className="flex gap-2">
            <Input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Ask about market data..."
              className="bg-gray-800 border-gray-700 text-sm"
            />
            <Button 
              size="icon" 
              onClick={handleSendMessage}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}