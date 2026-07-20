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
  const [agentTemplates, setAgentTemplates] = useState<PromptTemplate[]>(FALLBACK_AGENT_TEMPLATES);
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

  // Agent registry is server-owned; fall back to the static list when offline.
  useEffect(() => {
    let cancelled = false;
    chatApi
      .listAiAgents()
      .then(agents => {
        if (cancelled || !agents.length) return;
        setAgentTemplates(
          agents.map(agent => ({
            id: agent.id,
            agentId: agent.id,
            label: agent.label,
            description: agent.description,
            prompt: '',
          }))
        );
      })
      .catch(() => {
        /* keep fallback templates */
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  async function sendUserMessage(text: string, agentId?: string) {
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
      const data = await chatApi.sendChatMessage({ message: userMessage.content, sessionId, context, agentId });
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
          templates={agentTemplates}
          disabled={loading}
          onSelect={template => {
            setDraft('');
            if (template.agentId) {
              void sendUserMessage(`${template.label} report — ${selectedTicker}`, template.agentId);
            } else {
              void sendUserMessage(template.prompt);
            }
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

// Mirrors the server registry (GET /api/chat/agents); used until it loads or
// when the request fails so the desk is never left without analyst buttons.
const FALLBACK_AGENT_TEMPLATES: PromptTemplate[] = [
  { id: 'technical-analyst', agentId: 'technical-analyst', label: 'Technical Analyst', prompt: '', description: 'Chart structure, trend, momentum, and a trade thesis.' },
  { id: 'options-risk-analyst', agentId: 'options-risk-analyst', label: 'Options Risk Analyst', prompt: '', description: 'Liquidity, greeks, IV, decay, and assignment risk.' },
  { id: 'market-catalyst', agentId: 'market-catalyst', label: 'Market Catalyst Analyst', prompt: '', description: 'Why is it moving? Catalysts ranked by impact.' },
  { id: 'market-recap', agentId: 'market-recap', label: 'Market Recap', prompt: '', description: 'Session recap with indices, rates, news, and catalysts.' },
  { id: 'congressional-intel', agentId: 'congressional-intel', label: 'Congressional Intelligence', prompt: '', description: 'CapitolTrades positioning around the symbol.' },
  { id: 'fed-intel', agentId: 'fed-intel', label: 'Fed Intelligence', prompt: '', description: 'Rates, inflation, labor — and the macro bias for the symbol.' },
  { id: 'trade-thesis', agentId: 'trade-thesis', label: 'Trade Thesis', prompt: '', description: 'Institutional bull/bear thesis across all data sources.' },
  { id: 'smart-entry', agentId: 'smart-entry', label: 'Smart Entry', prompt: '', description: 'Optimal entry, stop, targets, and position size.' },
  { id: 'exit-strategy', agentId: 'exit-strategy', label: 'Exit Strategy', prompt: '', description: 'Hold, trim, scale, exit, or roll — with triggers.' },
  { id: 'portfolio-risk', agentId: 'portfolio-risk', label: 'Portfolio Risk', prompt: '', description: 'Concentration, correlation, and macro exposure review.' },
];

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
    // AI Desk V2 agent report sections
    'executive summary',
    'confidence',
    'bull case',
    'bear case',
    'catalysts',
    'technical analysis',
    'options analysis',
    'macro analysis',
    'congressional activity',
    'risk assessment',
    'trading plan',
    'action items',
    'sources used',
    'sources unavailable',
    'market structure',
    'key levels',
    'trading thesis',
    'entry',
    'stop',
    'targets',
    'position size',
    'risk reward',
    'expected return',
    'probability',
    'liquidity',
    'greeks exposure',
    'decay risk',
    'volatility risk',
    'assignment risk',
    'risk grade',
    'exit plan',
    'primary catalyst',
    'secondary catalysts',
    'timeline',
    'market reaction',
    'index tape',
    'rates & volatility',
    'symbol in focus',
    'major news',
    'platform intelligence',
    "tomorrow's catalysts",
    'recent transactions',
    'pattern analysis',
    'signal or noise',
    'trade ideas',
    'policy read',
    'yield curve',
    'inflation & labor',
    'upcoming event risk',
    'impact on symbol',
    'macro bias',
    'position review',
    'trend check',
    'recommendation',
    'triggers',
    'concentration',
    'correlation',
    'macro exposure',
    'volatility exposure',
    'drawdown state',
    'recommended adjustments',
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
