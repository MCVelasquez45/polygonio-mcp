import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { chatApi } from '../../api';
import { DEFAULT_ASSISTANT_MESSAGE } from '../../constants';
import { ChatMessage, ConversationPayload } from '../../types';

export type ChatBotProps = {
  sessionId: string;
  conversationTitle: string;
  initialMessages: ChatMessage[];
  selectedTicker: string;
  onAssistantReply?: (reply: string) => void;
  onRequestNewChat: () => void;
  onMessagesChange: (messages: ChatMessage[]) => void;
  onConversationUpdate: (meta: ConversationPayload) => void;
};

export function ChatBot({
  sessionId,
  conversationTitle,
  initialMessages,
  selectedTicker,
  onAssistantReply,
  onRequestNewChat,
  onMessagesChange,
  onConversationUpdate,
}: ChatBotProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialMessages.length ? initialMessages : [DEFAULT_ASSISTANT_MESSAGE]
  );
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const messagesChangeRef = useRef(onMessagesChange);

  useEffect(() => {
    messagesChangeRef.current = onMessagesChange;
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
    timelineRef.current.scrollTo({ top: timelineRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || loading) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: trimmed,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setDraft('');
    setLoading(true);

    try {
      const data = await chatApi.sendChatMessage({ message: userMessage.content, sessionId });
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
      const serverMessage = typeof error?.response?.data?.error === 'string' ? error.response.data.error : null;
      const isMaxTurnError = serverMessage?.includes('Max turns');
      const fallback =
        serverMessage ?? 'Chat service unavailable. Ensure the FastAPI agent is running and try again.';
      if (isMaxTurnError) {
        onRequestNewChat();
        setMessages([DEFAULT_ASSISTANT_MESSAGE]);
        setDraft('');
      }
      setMessages(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: isMaxTurnError
            ? 'Session limit reached. I started a new thread; please resend your last question.'
            : fallback,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <header className="flex flex-col gap-2 border-b border-gray-900 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-gray-500">GPT-5 Desk</p>
            <p className="text-lg font-semibold">{conversationTitle}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300">Live</span>
            <button
              type="button"
              className="text-xs px-3 py-1 rounded-full border border-gray-800 text-gray-300 hover:text-white"
              onClick={() => {
                onRequestNewChat();
                setMessages([DEFAULT_ASSISTANT_MESSAGE]);
                setDraft('');
              }}
              disabled={loading}
            >
              New chat
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500">
          Context: watching <span className="text-gray-100 font-medium">{selectedTicker}</span>. Reference tickers, expirations, or
          constraints when you ask a question.
        </p>
      </header>

      <div ref={timelineRef} className="flex-1 overflow-y-auto space-y-4 p-4">
        {messages.map(message => (
          <div key={message.id} className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse text-right' : 'text-left'}`}>
            <div
              className={`h-9 w-9 rounded-2xl flex items-center justify-center text-sm font-semibold ${
                message.role === 'assistant'
                  ? 'bg-emerald-500/15 text-emerald-200'
                  : 'bg-gray-800 text-gray-200'
              }`}
            >
              {message.role === 'assistant' ? 'AI' : 'You'}
            </div>
            <div
              className={`flex-1 rounded-2xl border px-4 py-3 text-sm leading-relaxed ${
                message.role === 'assistant'
                  ? 'border-gray-900 bg-gray-950 text-gray-100'
                  : 'border-emerald-500/30 bg-emerald-500/10 text-white'
              }`}
            >
              {message.role === 'assistant' ? renderStructuredReply(message.content) : <p>{message.content}</p>}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            Thinking…
          </div>
        )}
      </div>

      <form onSubmit={sendMessage} className="border-t border-gray-900 p-4 flex flex-col gap-3">
        <textarea
          rows={3}
          value={draft}
          onChange={event => setDraft(event.target.value)}
          placeholder={`Ask the desk about ${selectedTicker} or any risk scenario.`}
          className="w-full rounded-2xl border border-gray-800 bg-gray-950 p-3 text-sm text-gray-100 focus:border-emerald-500 focus:outline-none"
        />
        <div className="flex items-center justify-between gap-3 text-xs text-gray-500">
          <span>{loading ? 'Streaming response…' : 'Agent taps Massive + Polygon data per turn.'}</span>
          <button
            type="submit"
            disabled={loading || !draft.trim()}
            className="px-4 py-2 rounded-full bg-emerald-600 text-white text-sm font-semibold disabled:bg-gray-800"
          >
            {loading ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}

function renderStructuredReply(text: string): ReactNode {
  const lines = text.split('\n');
  const elements: ReactNode[] = [];
  let listBuffer: string[] = [];

  const flushList = () => {
    if (!listBuffer.length) return;
    elements.push(
      <ul key={`list-${elements.length}`} className="list-disc space-y-1 pl-5 text-left">
        {listBuffer.map((item, idx) => (
          <li key={idx}>{item}</li>
        ))}
      </ul>
    );
    listBuffer = [];
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
        </p>
      );
    } else {
      elements.push(<p key={`p-${elements.length}`}>{trimmed}</p>);
    }
  });

  flushList();
  return elements;
}
