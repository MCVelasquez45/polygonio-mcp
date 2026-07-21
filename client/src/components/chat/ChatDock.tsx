import { useState } from 'react';
import { History, X } from 'lucide-react';
import { ChatContext, ChatMessage, ConversationMeta, ConversationPayload } from '../../types';
import { DEFAULT_ASSISTANT_MESSAGE } from '../../constants';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { ChatBot } from './ChatBot';
import { ConversationHistory } from './ConversationHistory';

type ChatDockProps = {
  isOpen: boolean;
  onClose: () => void;
  conversations: ConversationMeta[];
  transcripts: Record<string, ChatMessage[]>;
  activeConversationId: string | null;
  onConversationSelect: (id: string) => void;
  onRequestNewChat: () => void;
  onMessagesChange: (sessionId: string, messages: ChatMessage[]) => void;
  onConversationUpdate: (meta: ConversationPayload) => void;
  onAssistantReply: (reply: string) => void;
  onConversationDelete: (id: string) => void;
  latestInsight: string;
  selectedTicker: string;
  context?: ChatContext;
};

export function ChatDock({
  isOpen,
  onClose,
  conversations,
  transcripts,
  activeConversationId,
  onConversationSelect,
  onRequestNewChat,
  onMessagesChange,
  onConversationUpdate,
  onAssistantReply,
  onConversationDelete,
  latestInsight,
  selectedTicker,
  context,
}: ChatDockProps) {
  const isMobile = useIsMobile();
  const [historyOpen, setHistoryOpen] = useState(false);
  if (!isOpen) return null;

  const activeConversation = activeConversationId
    ? conversations.find(convo => convo.id === activeConversationId)
    : conversations[0];

  const currentMessages = activeConversation
    ? transcripts[activeConversation.sessionId] ?? [DEFAULT_ASSISTANT_MESSAGE]
    : [DEFAULT_ASSISTANT_MESSAGE];

  const historyPanel = (
    <>
      <ConversationHistory
        conversations={conversations}
        activeId={activeConversation?.id ?? null}
        onSelect={id => {
          onConversationSelect(id);
          setHistoryOpen(false);
        }}
        onDelete={onConversationDelete}
      />
      <div className="ai-glass-panel ai-card-elevate rounded-panel p-4 space-y-2 text-sm">
        <p className="ai-section-title text-intel-ink3">Latest Insight</p>
        <p className="text-sm leading-relaxed text-intel-ink whitespace-pre-line">
          {latestInsight || 'Ask the desk about any ticker, spread, or risk scenario to capture a note here.'}
        </p>
      </div>
    </>
  );

  const chatBot = activeConversation ? (
    <ChatBot
      sessionId={activeConversation.sessionId}
      conversationTitle={activeConversation.title || 'Market Chat'}
      initialMessages={currentMessages}
      selectedTicker={selectedTicker}
      context={context}
      onAssistantReply={onAssistantReply}
      onRequestNewChat={onRequestNewChat}
      onMessagesChange={messages => onMessagesChange(activeConversation.sessionId, messages)}
      onConversationUpdate={onConversationUpdate}
      hideHeader={isMobile}
    />
  ) : (
    <div className="flex-1 flex items-center justify-center text-sm text-intel-ink3">
      Start a new conversation to chat with the desk.
    </div>
  );

  // ── Mobile: full-height sheet. One column — chat owns the screen, the
  // composer is always visible, history lives behind a toggle. dvh (not vh)
  // keeps the composer above the iOS URL bar; safe-area pads the bottom.
  if (isMobile) {
    return (
      <div className="fixed inset-0 z-50 flex h-[100dvh] flex-col bg-intel-bg/70 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
        <header className="ai-glass-panel-strong flex flex-none items-center justify-between gap-2 border-x-0 border-t-0 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <div className="min-w-0">
            <p className="ai-section-title font-mono text-intel-ink3">AI Desk</p>
            <p className="truncate text-lg font-semibold leading-tight text-intel-ink">
              {activeConversation?.title || 'Market Chat'}
              <span className="ml-2 font-mono text-[11px] font-normal text-intel-ink2">{selectedTicker}</span>
            </p>
          </div>
          <div className="flex flex-none items-center gap-1.5">
            <button
              type="button"
              onClick={() => setHistoryOpen(prev => !prev)}
              aria-label="Conversation history"
              aria-expanded={historyOpen}
              className={`ai-glass-button ai-focus-ring flex h-12 w-12 items-center justify-center rounded-md ${
                historyOpen ? 'text-intel-accent' : 'text-intel-ink2'
              }`}
            >
              <History className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onRequestNewChat}
              className="ai-glass-button ai-focus-ring h-12 rounded-md px-3 text-xs font-semibold text-intel-ink2"
            >
              New
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close chat"
              className="ai-glass-button ai-focus-ring flex h-12 w-12 items-center justify-center rounded-md text-intel-ink2"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </header>
        {historyOpen ? (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">{historyPanel}</div>
        ) : (
          <div className="min-h-0 flex-1">{chatBot}</div>
        )}
      </div>
    );
  }

  // ── Desktop: right-hand workstation drawer with a persistent history rail.
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[1px]" onClick={onClose} />
      <div className="ai-glass-panel-strong relative h-full w-full max-w-6xl border-y-0 border-r-0 flex">
        <aside className="w-80 border-r border-white/[0.06] bg-black/[0.08] p-4 pt-6 space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between">
            <div>
              <p className="ai-section-title text-intel-ink3">Conversations</p>
              <p className="text-lg font-semibold leading-tight text-intel-ink">AI Desk</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="ai-glass-button ai-focus-ring rounded-md px-3 text-xs font-semibold text-intel-ink2 hover:text-white"
                onClick={onRequestNewChat}
              >
                New
              </button>
              <button
                type="button"
                onClick={onClose}
                className="ai-glass-button ai-focus-ring h-10 w-10 rounded-md text-intel-ink2 hover:text-white flex items-center justify-center"
                aria-label="Close chat"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          {historyPanel}
        </aside>
        <main className="flex-1 flex flex-col min-w-0">{chatBot}</main>
      </div>
    </div>
  );
}
