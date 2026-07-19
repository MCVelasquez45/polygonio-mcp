import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { chatApi } from '../../api';
import { DEFAULT_ASSISTANT_MESSAGE } from '../../constants';
import { ChatContext, ChatMessage, ConversationPayload } from '../../types';
import { PromptTemplates, type PromptTemplate } from './PromptTemplates';

export type ChatBotProps = {
  sessionId: string;
  conversationTitle: string;
  initialMessages: ChatMessage[];
  selectedTicker: string;
  context?: ChatContext;
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
  context,
  onAssistantReply,
  onRequestNewChat,
  onMessagesChange,
  onConversationUpdate,
}: ChatBotProps) {
  const promptTemplates: PromptTemplate[] = [
    {
      id: 'chart-read',
      label: 'Analyze this chart',
      prompt: 'Explain what is happening on this chart and call out any risks or trend shifts.',
      description: 'Quick technical read for the active chart and timeframe.',
    },
    {
      id: 'option-risk',
      label: 'Option risk review',
      prompt: 'Review the risk/reward for the selected option contract. Highlight IV, greeks, and key risk.',
      description: 'Summarize risk/reward on the selected contract.',
    },
    {
      id: 'why-move',
      label: 'Why did it move?',
      prompt: 'Why is this ticker moving today? Provide likely catalysts and key levels.',
      description: 'Check news, momentum, and levels for the active ticker.',
    },
    {
      id: 'daily-recap',
      label: 'Daily recap',
      prompt: 'Give me a concise daily recap for this ticker with trend, momentum, and notable events.',
      description: 'Short daily summary for the active ticker.',
    },
    {
      id: 'capitol-activity',
      label: 'Congressional activity',
      prompt: 'Summarize recent congressional trading activity relevant to this ticker and any notable patterns.',
      description: 'Pulls recent Capitol Trades activity and highlights relevance.',
    },
    {
      id: 'fed-move',
      label: 'Fed movement',
      prompt: 'Summarize the latest Fed movement and how it may affect this ticker or sector.',
      description: 'Quick macro read tied to the active symbol.',
    },
  ];
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialMessages.length ? initialMessages : [DEFAULT_ASSISTANT_MESSAGE]
  );
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [reportStatus, setReportStatus] = useState<
    Record<string, { state: 'idle' | 'saving' | 'saved' | 'error'; message?: string }>
  >({});
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const messagesChangeRef = useRef(onMessagesChange);

  useEffect(() => {
    messagesChangeRef.current = onMessagesChange;
  }, [onMessagesChange]);

  useEffect(() => {
    setMessages(initialMessages.length ? initialMessages : [DEFAULT_ASSISTANT_MESSAGE]);
    setDraft('');
    setReportStatus({});
  }, [sessionId, initialMessages]);

  useEffect(() => {
    messagesChangeRef.current?.(messages);
  }, [messages]);

  useEffect(() => {
    if (!timelineRef.current) return;
    timelineRef.current.scrollTo({ top: timelineRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  async function sendUserMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: trimmed,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setLoading(true);

    try {
      const data = await chatApi.sendChatMessage({ message: userMessage.content, sessionId, context });
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
        serverMessage ?? 'AI Desk request failed before a server response. Check the HTTP failure log and try again.';
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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || loading) return;
    const next = draft;
    setDraft('');
    await sendUserMessage(next);
  }

  async function handleSaveReport(message: ChatMessage) {
    if (reportStatus[message.id]?.state === 'saving') return;
    setReportStatus(prev => ({ ...prev, [message.id]: { state: 'saving' } }));
    try {
      const title = `${selectedTicker} ${conversationTitle}`.trim();
      const response = await chatApi.saveChatReport({
        content: message.content,
        title,
        sessionId,
        context,
      });
      const resultText = response?.result ?? 'Report saved';
      setReportStatus(prev => ({
        ...prev,
        [message.id]: { state: 'saved', message: extractReportName(resultText) ?? resultText },
      }));
    } catch (error: any) {
      const fallback = error?.response?.data?.error ?? error?.message ?? 'Failed to save report';
      setReportStatus(prev => ({ ...prev, [message.id]: { state: 'error', message: fallback } }));
    }
  }

  return (
    <div className="flex flex-col h-full">
      <header className="flex flex-col gap-2 border-b border-intel-line p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-intel-ink3">GPT-5 Desk</p>
            <p className="text-lg font-semibold">{conversationTitle}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-md bg-intel-pos/10 px-1.5 py-[1px] font-mono text-[10px] font-semibold uppercase tracking-label text-intel-pos">
              <span className="h-1.5 w-1.5 rounded-full bg-intel-pos motion-safe:animate-livering" aria-hidden="true" />
              Live
            </span>
            <button
              type="button"
              className="rounded-md border border-intel-line px-2 py-0.5 font-mono text-[10px] text-intel-ink2 hover:border-intel-accentLine hover:text-intel-ink"
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
        <p className="text-xs text-intel-ink3">
          Context: watching <span className="text-intel-ink font-medium">{selectedTicker}</span>. Reference tickers, expirations, or
          constraints when you ask a question.
        </p>
      </header>

      <div ref={timelineRef} className="flex-1 overflow-y-auto space-y-4 p-4">
        {messages.map(message => (
          <div key={message.id} className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse text-right' : 'text-left'}`}>
            <div
              className={`h-9 w-9 rounded-panel flex items-center justify-center text-sm font-semibold ${
                message.role === 'assistant'
                  ? 'bg-intel-accentSoft text-intel-accent'
                  : 'bg-intel-panel2 text-intel-ink'
              }`}
            >
              {message.role === 'assistant' ? 'AI' : 'You'}
            </div>
            <div
              className={`flex-1 rounded-panel border px-4 py-3 text-sm leading-relaxed ${
                message.role === 'assistant'
                  ? 'border-intel-line bg-intel-panel text-intel-ink'
                  : 'border-intel-accentLine bg-intel-accentSoft text-white'
              }`}
            >
              {message.role === 'assistant' ? (
                <div className="space-y-2">
                  <div>{renderStructuredReply(message.content)}</div>
                  <div className="flex items-center gap-2 text-[0.65rem] text-intel-ink2">
                    <button
                      type="button"
                      onClick={() => handleSaveReport(message)}
                      className="rounded-md border border-intel-line px-1.5 py-[1px] font-mono text-[10px] text-intel-ink2 hover:border-intel-accentLine hover:text-intel-ink disabled:opacity-40"
                      disabled={reportStatus[message.id]?.state === 'saving'}
                    >
                      {reportStatus[message.id]?.state === 'saving' ? 'Saving…' : 'Save report'}
                    </button>
                    {reportStatus[message.id]?.state === 'saved' && reportStatus[message.id]?.message && (
                      <span className="text-intel-accent">Saved: {reportStatus[message.id]?.message}</span>
                    )}
                    {reportStatus[message.id]?.state === 'error' && reportStatus[message.id]?.message && (
                      <span className="text-intel-neg">{reportStatus[message.id]?.message}</span>
                    )}
                  </div>
                </div>
              ) : (
                <p>{message.content}</p>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-xs text-intel-ink3">
            <span className="h-2 w-2 animate-pulse rounded-full bg-intel-accent" />
            Thinking…
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-intel-line p-4 flex flex-col gap-3">
        <PromptTemplates
          templates={promptTemplates}
          disabled={loading}
          onSelect={prompt => {
            setDraft('');
            void sendUserMessage(prompt);
          }}
        />
        <textarea
          rows={3}
          value={draft}
          onChange={event => setDraft(event.target.value)}
          placeholder={`Ask the desk about ${selectedTicker} or any risk scenario.`}
          className="w-full rounded-panel border border-intel-line bg-intel-panel p-3 text-sm text-intel-ink focus:border-intel-accentLine focus:outline-none"
        />
        <div className="flex items-center justify-between gap-3 text-xs text-intel-ink3">
          <span>{loading ? 'Streaming response…' : 'Agent taps Massive + Polygon data per turn.'}</span>
          <button
            type="submit"
            disabled={loading || !draft.trim()}
            className="rounded-panel bg-intel-accent px-4 py-2 text-sm font-semibold text-intel-bg disabled:bg-intel-panel2 disabled:text-intel-ink3"
          >
            {loading ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}

function renderStructuredReply(text: string): ReactNode {
  const deskSections = new Set([
    'summary',
    'trend',
    'momentum',
    'support',
    'resistance',
    'expected move',
    'key risk',
    'suggested action',
    'conclusion',
  ]);
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
      const heading = boldMatch[1].trim();
      const body = boldMatch[2].trim();
      if (deskSections.has(heading.toLowerCase())) {
        elements.push(
          <div key={`section-${elements.length}`} className="rounded-md border border-intel-lineSoft bg-intel-bg/30 px-2.5 py-2">
            <p className="font-mono text-[9px] font-semibold uppercase tracking-label text-intel-ai">{heading}</p>
            {body ? <p className="mt-1 text-[13px] leading-relaxed text-intel-ink2">{body}</p> : null}
          </div>
        );
      } else {
        elements.push(
          <p key={`bold-${elements.length}`}>
            <strong>{heading}:</strong> {body}
          </p>
        );
      }
    } else {
      elements.push(<p key={`p-${elements.length}`}>{trimmed}</p>);
    }
  });

  flushList();
  return elements;
}

function extractReportName(resultText: string): string | null {
  const match = resultText.match(/Report saved:\s*(.+)$/i);
  if (!match) return null;
  const rawPath = match[1].trim();
  const parts = rawPath.split(/[\\/]/);
  return parts[parts.length - 1] || rawPath;
}
