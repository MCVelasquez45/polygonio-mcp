import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { chatApi } from '../../api';
import { DEFAULT_ASSISTANT_MESSAGE } from '../../constants';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { getLiveQuoteSnapshot, getLiveTradeSnapshot } from '../../lib/liveMarketStore';
import { setAiStatus } from '../../lib/aiStatusStore';
import { ChatContext, ChatMessage, ConversationPayload } from '../../types';
import { agentIdFromText, getAgentMeta } from './agentMeta';
import { AiReportCard, type ReportSaveState } from './AiReportCard';
import { parseAgentReport } from './reportModel';
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
  /** Hide the desk header (the mobile shell provides its own chrome). */
  hideHeader?: boolean;
  /** External agent launch (mobile Quick Actions). A new nonce fires the run. */
  launchRequest?: { agentId: string; label: string; nonce: number } | null;
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
  hideHeader = false,
  launchRequest = null,
}: ChatBotProps) {
  const [agentTemplates, setAgentTemplates] = useState<PromptTemplate[]>(FALLBACK_AGENT_TEMPLATES);
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialMessages.length ? initialMessages : [DEFAULT_ASSISTANT_MESSAGE]
  );
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null);
  const [reportStatus, setReportStatus] = useState<Record<string, ReportSaveState>>({});
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const messagesChangeRef = useRef(onMessagesChange);
  const isMobile = useIsMobile();

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

  // Quick Actions elsewhere in the shell hand an agent run to the chat.
  const consumedLaunchNonce = useRef(0);
  useEffect(() => {
    if (!launchRequest || launchRequest.nonce === consumedLaunchNonce.current) return;
    consumedLaunchNonce.current = launchRequest.nonce;
    if (loading) return;
    void sendUserMessage(`${launchRequest.label} report — ${selectedTicker}`, launchRequest.agentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchRequest]);

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
    setPendingAgentId(agentId ?? null);
    setAiStatus('busy');

    try {
      const data = await chatApi.sendChatMessage({
        message: userMessage.content,
        sessionId,
        context: enrichContextWithLiveMarket(context, selectedTicker),
        agentId,
      });
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data?.reply ?? '(no reply)',
        timestamp: Date.now(),
        agentId,
      };
      setMessages(prev => [...prev, assistantMessage]);
      onAssistantReply?.(assistantMessage.content);
      if (data?.conversation) {
        onConversationUpdate(data.conversation);
      }
      setAiStatus('ready');
    } catch (error: any) {
      setAiStatus('error');
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
      setPendingAgentId(null);
    }
  }

  function submitDraft() {
    if (!draft.trim() || loading) return;
    const next = draft;
    setDraft('');
    void sendUserMessage(next);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submitDraft();
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

  // Hydrated transcripts carry no agentId — recover it from the launching user
  // message ("Fed Intelligence report — SPY") so saved reports keep their card.
  const resolvedAgentIds = useMemo(() => {
    const ids = new Map<string, string | null>();
    let lastUserText = '';
    for (const message of messages) {
      if (message.role === 'user') {
        lastUserText = message.content;
      } else {
        ids.set(message.id, message.agentId ?? agentIdFromText(lastUserText));
      }
    }
    return ids;
  }, [messages]);

  const pendingMeta = pendingAgentId ? getAgentMeta(pendingAgentId) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!hideHeader && (
        <header className="ai-glass-panel-soft flex flex-none items-center justify-between gap-3 border-x-0 border-t-0 px-4 py-3">
          <div className="min-w-0">
            <p className="ai-section-title font-mono text-intel-ink3">AI Desk</p>
            <p className="truncate text-lg font-semibold leading-tight text-intel-ink">
              {conversationTitle}
              <span className="ml-2 font-mono text-[11px] font-normal text-intel-ink2">{selectedTicker}</span>
            </p>
          </div>
          <div className="flex flex-none items-center gap-2">
            <span className="inline-flex min-h-[24px] items-center gap-1 rounded-md border border-intel-pos/25 bg-intel-pos/10 px-2 font-mono text-[10px] font-semibold uppercase tracking-label text-intel-pos">
              <span className="h-1.5 w-1.5 rounded-full bg-intel-pos motion-safe:animate-livering" aria-hidden="true" />
              Live
            </span>
            <button
              type="button"
              className="ai-glass-button ai-focus-ring rounded-md px-3 font-mono text-[10px] font-semibold text-intel-ink2 hover:text-intel-ink"
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
        </header>
      )}

      {/* Conversation scrolls independently; composer below never moves. */}
      <div ref={timelineRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 md:p-4">
        {messages.map(message => {
          if (message.role === 'user') {
            return (
              <div key={message.id} className="flex justify-end">
                <p className="ai-glass-panel-soft max-w-[85%] rounded-panel px-3 py-2 text-right text-sm leading-relaxed text-white shadow-none">
                  {message.content}
                </p>
              </div>
            );
          }
          const agentId = resolvedAgentIds.get(message.id) ?? null;
          const report = parseAgentReport(message.content);
          if (agentId || report.isReport) {
            return (
              <AiReportCard
                key={message.id}
                meta={getAgentMeta(agentId)}
                report={report}
                rawContent={message.content}
                ticker={selectedTicker}
                generatedAt={message.timestamp}
                saveState={reportStatus[message.id]}
                onSave={() => handleSaveReport(message)}
              />
            );
          }
          return (
            <div key={message.id} className="flex justify-start">
              <div className="ai-glass-panel-soft ai-card-elevate max-w-[92%] rounded-panel px-3 py-2 text-sm leading-relaxed text-intel-ink">
                {renderStructuredReply(message.content)}
              </div>
            </div>
          );
        })}
        {loading && (
          <div className="ai-glass-panel-soft flex items-center gap-2 rounded-panel px-3 py-2 text-xs text-intel-ink2">
            <span
              className="h-2 w-2 animate-pulse rounded-full"
              style={{ backgroundColor: pendingMeta?.color ?? '#a98bf5' }}
            />
            {pendingMeta ? `${pendingMeta.label} is reading the tape…` : 'Thinking…'}
          </div>
        )}
      </div>

      {/* Composer — pinned, keyboard-safe; safe-area handled by the host shell. */}
      <form onSubmit={handleSubmit} className="ai-glass-panel-strong flex flex-none flex-col gap-2 border-x-0 border-b-0 p-3 md:p-4">
        <PromptTemplates
          templates={agentTemplates}
          disabled={loading}
          compact={isMobile}
          onSelect={template => {
            setDraft('');
            if (template.agentId) {
              void sendUserMessage(`${template.label} report — ${selectedTicker}`, template.agentId);
            } else {
              void sendUserMessage(template.prompt);
            }
          }}
        />
        <div className="flex items-end gap-2">
          <textarea
            rows={isMobile ? 1 : 2}
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !isMobile) {
                event.preventDefault();
                submitDraft();
              }
            }}
            placeholder={`Ask the desk about ${selectedTicker}…`}
            aria-label={`Ask the AI desk about ${selectedTicker}`}
            className="ai-focus-ring min-h-[48px] w-full flex-1 resize-none rounded-panel border border-white/[0.07] bg-white/[0.045] px-3 py-3 text-base leading-relaxed text-intel-ink placeholder:text-intel-ink3 transition duration-150 ease-out focus:border-intel-accentLine focus:bg-white/[0.065] md:min-h-10 md:py-2 md:text-sm"
          />
          <button
            type="submit"
            disabled={loading || !draft.trim()}
            className="ai-glass-button ai-focus-ring min-h-[48px] flex-none rounded-panel px-4 text-sm font-semibold text-intel-ink disabled:text-intel-ink3 md:min-h-10"
          >
            {loading ? '…' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}

function compactQuote(symbol: string | null | undefined) {
  const quote = getLiveQuoteSnapshot(symbol);
  if (!quote) return null;
  return {
    bidPrice: quote.bidPrice,
    askPrice: quote.askPrice,
    midpoint: quote.midpoint,
    spread: quote.spread,
    bidSize: quote.bidSize,
    askSize: quote.askSize,
    timestamp: quote.timestamp,
  };
}

function enrichContextWithLiveMarket(context: ChatContext | undefined, selectedTicker: string): ChatContext {
  const quoteSymbol = context?.chart?.symbol ?? selectedTicker;
  const optionSymbol = context?.option?.ticker ?? null;
  const optionTrade = getLiveTradeSnapshot(optionSymbol);
  return {
    ...(context ?? {}),
    liveMarket: {
      quoteSymbol,
      optionSymbol,
      quote: compactQuote(quoteSymbol),
      optionQuote: compactQuote(optionSymbol),
      optionLastTrade: optionTrade
        ? {
            price: optionTrade.price,
            size: optionTrade.size,
            timestamp: optionTrade.timestamp,
          }
        : null,
      readAt: Date.now(),
    },
  };
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

// Legacy renderer for free-form (non-agent) replies: keeps **Label**: lines
// readable without promoting them to a full report card.
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
        <div key={`section-${elements.length}`} className="ai-glass-panel-soft rounded-md px-2.5 py-2 shadow-none">
          <p className="ai-section-title font-mono text-[11px] text-intel-ai">{boldMatch[1].trim()}</p>
          {boldMatch[2].trim() ? <p className="mt-1 text-[13px] leading-relaxed text-intel-ink2">{boldMatch[2].trim()}</p> : null}
        </div>
      );
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
