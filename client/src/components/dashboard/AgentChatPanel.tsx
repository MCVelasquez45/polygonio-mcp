import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import { getAgentBaseUrl } from '../../api/agent';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isLoading?: boolean;
};

type Props = {
  apiBase?: string;
  embedded?: boolean;
  context?: any;
  className?: string;
  onClose?: () => void;
};

const QUICK_ACTIONS = [
  { label: 'ES Daily Bars', query: 'Get ES daily data for the last 5 bars' },
  { label: 'ES 4H Bars', query: 'Get ES 4H bars for the last 3 bars to check One Candle Theory patterns' },
  { label: 'SPY Options', query: 'Show me SPY options chain for today sorted by volume' },
  { label: '0-DTE Scan', query: 'Scan best 0-DTE covered call opportunities for SPY' },
  { label: 'NQ Futures', query: 'Get NQ daily data for the last 5 bars' },
];

export function AgentChatPanel({ apiBase = getAgentBaseUrl(), embedded = false, context = {}, className = '', onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const generateId = () => `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const sendMessage = async (query: string) => {
    if (!query.trim() || isLoading) return;

    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: query,
      timestamp: new Date(),
    };

    const loadingMessage: Message = {
      id: generateId(),
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isLoading: true,
    };

    setMessages(prev => [...prev, userMessage, loadingMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await axios.post(`${apiBase}/analyze`, {
        query,
        context: {
          source: 'lab-dashboard',
          ...context
        },
      });

      const assistantMessage: Message = {
        id: generateId(),
        role: 'assistant',
        content: response.data.output || 'No response received.',
        timestamp: new Date(),
      };

      setMessages(prev =>
        prev.slice(0, -1).concat(assistantMessage)
      );
    } catch (error: any) {
      const errorMessage: Message = {
        id: generateId(),
        role: 'assistant',
        content: `**Error:** ${error.response?.data?.detail || error.message || 'Failed to reach the agent. Make sure the agent API is running.'}`,
        timestamp: new Date(),
      };

      setMessages(prev =>
        prev.slice(0, -1).concat(errorMessage)
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleQuickAction = (query: string) => {
    sendMessage(query);
  };

  const clearHistory = () => {
    setMessages([]);
  };

  return (
    <div className={`agent-chat-panel ${embedded ? 'embedded' : ''} ${className}`}>
      <div className={`chat-header ${embedded ? 'embedded' : ''}`}>
        <div className="header-title">
          <span className="header-icon">🤖</span>
          <span>{embedded ? 'Agent Assistant' : 'Market Analysis Agent'}</span>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="clear-btn"
            onClick={clearHistory}
            disabled={messages.length === 0}
            title="Clear History"
          >
            Clear
          </button>
          {embedded && onClose && (
            <button
              type="button"
              className="close-btn"
              onClick={onClose}
              title="Close Chat"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="quick-actions">
        <span className="quick-label">Quick Actions:</span>
        <div className="action-buttons">
          {QUICK_ACTIONS.map((action, idx) => (
            <button
              key={idx}
              type="button"
              className="action-btn"
              onClick={() => handleQuickAction(action.query)}
              disabled={isLoading}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>

      <div className="messages-container">
        {messages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">💬</div>
            <p className="empty-title">No messages yet</p>
            <p className="empty-subtitle">
              Ask about futures (ES, NQ), options, market data, or use quick actions above.
            </p>
          </div>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className={`message ${msg.role}`}>
              <div className="message-header">
                <span className="message-role">{msg.role === 'user' ? 'You' : 'Agent'}</span>
                <span className="message-time">
                  {msg.timestamp.toLocaleTimeString()}
                </span>
              </div>
              <div className="message-content">
                {msg.isLoading ? (
                  <div className="loading-indicator">
                    <span className="loading-dot"></span>
                    <span className="loading-dot"></span>
                    <span className="loading-dot"></span>
                    <span className="loading-text">Analyzing...</span>
                  </div>
                ) : (
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="input-container" onSubmit={handleSubmit}>
        <input
          type="text"
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about ES futures, SPY options, market data..."
          disabled={isLoading}
        />
        <button
          type="submit"
          className="send-btn"
          disabled={isLoading || !input.trim()}
        >
          {isLoading ? '...' : '➤'}
        </button>
      </form>

      <style>{`
        .agent-chat-panel {
          display: flex;
          flex-direction: column;
          height: calc(100vh - 120px);
          background: rgba(17, 17, 24, 0.95);
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.06);
          overflow: hidden;
        }
        
        .agent-chat-panel.embedded {
          height: 100%;
          border-radius: 0;
          border: none;
          border-left: 1px solid #333;
          background: #252526;
        }

        .chat-header.embedded {
           background: #2d2d2d;
           padding: 0.5rem 1rem;
        }

        .close-btn {
          background: transparent;
          border: none;
          color: #9ca3af;
          font-size: 1.2rem;
          cursor: pointer;
          margin-left: 0.5rem;
        }
        .close-btn:hover { color: #e5e5e5; }

        .chat-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem 1.25rem;
          background: rgba(0, 0, 0, 0.3);
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }

        .header-title {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-weight: 600;
          font-size: 1rem;
        }

        .header-icon {
          font-size: 1.2rem;
        }

        .clear-btn {
          padding: 0.4rem 0.75rem;
          background: rgba(239, 68, 68, 0.1);
          color: #f87171;
          border: 1px solid rgba(239, 68, 68, 0.2);
          border-radius: 6px;
          font-size: 0.8rem;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .clear-btn:hover:not(:disabled) {
          background: rgba(239, 68, 68, 0.2);
        }

        .clear-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .quick-actions {
          padding: 0.75rem 1rem;
          background: rgba(0, 0, 0, 0.2);
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        }

        .quick-label {
          font-size: 0.75rem;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .action-buttons {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-top: 0.5rem;
        }

        .action-btn {
          padding: 0.4rem 0.75rem;
          background: rgba(16, 185, 129, 0.08);
          color: #10b981;
          border: 1px solid rgba(16, 185, 129, 0.15);
          border-radius: 6px;
          font-size: 0.8rem;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .action-btn:hover:not(:disabled) {
          background: rgba(16, 185, 129, 0.15);
          border-color: rgba(16, 185, 129, 0.3);
        }

        .action-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .messages-container {
          flex: 1;
          overflow-y: auto;
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: #6b7280;
          text-align: center;
        }

        .empty-icon {
          font-size: 3rem;
          margin-bottom: 0.5rem;
          opacity: 0.5;
        }

        .empty-title {
          font-size: 1.1rem;
          font-weight: 500;
          color: #9ca3af;
        }

        .empty-subtitle {
          font-size: 0.9rem;
          max-width: 300px;
        }

        .message {
          padding: 1rem;
          border-radius: 10px;
          max-width: 90%;
        }

        .message.user {
          align-self: flex-end;
          background: rgba(59, 130, 246, 0.15);
          border: 1px solid rgba(59, 130, 246, 0.2);
        }

        .message.assistant {
          align-self: flex-start;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.06);
        }

        .message-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.5rem;
          font-size: 0.75rem;
        }

        .message-role {
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }

        .message.user .message-role {
          color: #60a5fa;
        }

        .message.assistant .message-role {
          color: #10b981;
        }

        .message-time {
          color: #6b7280;
        }

        .message-content {
          font-size: 0.9rem;
          line-height: 1.6;
          color: #e5e5e5;
        }

        .message-content h1,
        .message-content h2,
        .message-content h3 {
          margin-top: 1rem;
          margin-bottom: 0.5rem;
          color: #f3f4f6;
        }

        .message-content ul,
        .message-content ol {
          padding-left: 1.5rem;
          margin: 0.5rem 0;
        }

        .message-content li {
          margin-bottom: 0.25rem;
        }

        .message-content code {
          background: rgba(0, 0, 0, 0.3);
          padding: 0.2rem 0.4rem;
          border-radius: 4px;
          font-size: 0.85em;
        }

        .message-content pre {
          background: rgba(0, 0, 0, 0.4);
          padding: 1rem;
          border-radius: 8px;
          overflow-x: auto;
          margin: 0.5rem 0;
        }

        .message-content pre code {
          background: none;
          padding: 0;
        }

        .message-content strong {
          color: #f3f4f6;
        }

        .loading-indicator {
          display: flex;
          align-items: center;
          gap: 0.3rem;
        }

        .loading-dot {
          width: 6px;
          height: 6px;
          background: #10b981;
          border-radius: 50%;
          animation: bounce 1.4s infinite ease-in-out;
        }

        .loading-dot:nth-child(1) { animation-delay: 0s; }
        .loading-dot:nth-child(2) { animation-delay: 0.16s; }
        .loading-dot:nth-child(3) { animation-delay: 0.32s; }

        .loading-text {
          margin-left: 0.5rem;
          color: #6b7280;
          font-size: 0.85rem;
        }

        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-6px); }
        }

        .input-container {
          display: flex;
          gap: 0.75rem;
          padding: 1rem;
          background: rgba(0, 0, 0, 0.3);
          border-top: 1px solid rgba(255, 255, 255, 0.06);
        }

        .chat-input {
          flex: 1;
          padding: 0.75rem 1rem;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          color: #e5e5e5;
          font-size: 0.9rem;
          outline: none;
          transition: border-color 0.15s ease;
        }

        .chat-input:focus {
          border-color: rgba(16, 185, 129, 0.4);
        }

        .chat-input::placeholder {
          color: #6b7280;
        }

        .chat-input:disabled {
          opacity: 0.5;
        }

        .send-btn {
          padding: 0 1.25rem;
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 1.1rem;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .send-btn:hover:not(:disabled) {
          transform: scale(1.02);
          box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
        }

        .send-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
