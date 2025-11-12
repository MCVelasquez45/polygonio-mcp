import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { DEFAULT_ASSISTANT_MESSAGE } from '../constants';
import { ChatMessage, ConversationPayload } from '../types';

type ChatBotProps = {
  sessionId: string;
  conversationTitle: string;
  initialMessages: ChatMessage[];
  onAssistantReply?: (reply: string) => void;
  onRequestNewChat: () => void;
  onMessagesChange: (messages: ChatMessage[]) => void;
  onConversationUpdate: (meta: ConversationPayload) => void;
};

export default function ChatBot({
  sessionId,
  conversationTitle,
  initialMessages,
  onAssistantReply,
  onRequestNewChat,
  onMessagesChange,
  onConversationUpdate,
}: ChatBotProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialMessages.length ? initialMessages : [DEFAULT_ASSISTANT_MESSAGE],
  );
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const messagesChangeRef = useRef(onMessagesChange);

  useEffect(() => {
    messagesChangeRef.current = onMessagesChange; // avoid effect churn when parent re-creates the handler
  }, [onMessagesChange]);

  useEffect(() => {
    setMessages(initialMessages.length ? initialMessages : [DEFAULT_ASSISTANT_MESSAGE]);
    setDraft('');
  }, [sessionId, initialMessages]);

  useEffect(() => {
    messagesChangeRef.current?.(messages);
  }, [messages]);

  useEffect(() => {
    if (!timelineRef.current) return;
    timelineRef.current.scrollTo({
      top: timelineRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, loading]);

  async function sendMessage(evt: FormEvent) {
    evt.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || loading) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: trimmed,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };
    console.log('[CLIENT] Chat message submitting:', userMessage);
    setMessages(prev => [...prev, userMessage]);
    setDraft('');
    setLoading(true);

    try {
      console.log('[CLIENT] Sending /api/chat request');
      const { data } = await api.post('/api/chat', { message: userMessage.content, sessionId });
      console.log('[CLIENT] Received /api/chat response:', data);
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data?.reply ?? '(no reply)',
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, assistantMessage]);
      onAssistantReply?.(assistantMessage.content);
      if (data?.conversation) {
        onConversationUpdate(data.conversation);
      }
    } catch (error: any) {
      console.error('[CLIENT] /api/chat request failed:', error);
      const serverMessage =
        typeof error?.response?.data?.error === 'string' ? error.response.data.error : null;
      const isMaxTurnError = serverMessage?.includes('Max turns');
      const fallback =
        serverMessage ??
        'Chat service unavailable. Ensure the FastAPI agent is running on port 5001 and try again.';
      const maxTurnMessage = isMaxTurnError
        ? 'Session limit reached. I started a new thread; please resend your last question.'
        : fallback;
      if (isMaxTurnError) {
        onRequestNewChat();
        const reset = [DEFAULT_ASSISTANT_MESSAGE];
        setMessages(reset);
        setDraft('');
      }
      setMessages(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: maxTurnMessage,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
      console.log('[CLIENT] Chat send cycle finished');
    }
  }

  return (
    <section className="chat-surface">
      <header className="chat-header">
        <div>
          <p className="eyebrow">GPT-5 Polygon Agent</p>
          <strong>{conversationTitle}</strong>
        </div>
        <div className="chat-header-actions">
          <span className="status-pill online">Connected</span>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              onRequestNewChat();
              const reset = [DEFAULT_ASSISTANT_MESSAGE];
              setMessages(reset);
              setDraft('');
            }}
            disabled={loading}
          >
            New chat
          </button>
        </div>
      </header>

      <div className="chat-timeline" ref={timelineRef}>
        {messages.map(message => (
          <div key={message.id} className={`message-row ${message.role}`}>
            <div className="avatar">{message.role === 'assistant' ? 'A' : 'You'}</div>
            <div className="message-bubble">
              {message.role === 'assistant' ? renderStructuredReply(message.content) : <p>{message.content}</p>}
            </div>
          </div>
        ))}

        {loading && (
          <div className="typing-indicator">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>

      <form onSubmit={sendMessage} className="composer">
        <textarea
          rows={1}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Send a message (e.g. “Compare NVDA calls vs puts next week”)."
        />
        <button type="submit" disabled={loading || !draft.trim()}>
          {loading ? 'Thinking…' : 'Send'}
        </button>
      </form>
    </section>
  );
}

function renderStructuredReply(text: string): ReactNode {
  const lines = text.split('\n');
  const elements: ReactNode[] = [];
  let listBuffer: string[] = [];

  const flushList = () => {
    if (listBuffer.length > 0) {
      elements.push(
        <ul key={`list-${elements.length}`} className="message-list">
          {listBuffer.map((item, idx) => (
            <li key={idx}>{item}</li>
          ))}
        </ul>,
      );
      listBuffer = [];
    }
  };

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }
    if (/^[-•]/.test(trimmed)) {
      listBuffer.push(trimmed.replace(/^[-•]+\s*/, ''));
      return;
    }
    flushList();
    const boldMatch = trimmed.match(/^\*\*(.+?)\*\*:\s*(.*)/);
    if (boldMatch) {
      elements.push(
        <p key={`bold-${elements.length}`}>
          <strong>{boldMatch[1]}:</strong> {boldMatch[2]}
        </p>,
      );
    } else {
      elements.push(<p key={`p-${elements.length}`}>{trimmed}</p>);
    }
  });
  flushList();

  return elements;
}
