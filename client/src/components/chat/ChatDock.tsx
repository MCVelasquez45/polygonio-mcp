import { X } from 'lucide-react';
import { ChatContext, ChatMessage, ConversationMeta, ConversationPayload } from '../../types';
import { DEFAULT_ASSISTANT_MESSAGE } from '../../constants';
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
  if (!isOpen) return null;

  const activeConversation = activeConversationId
    ? conversations.find(convo => convo.id === activeConversationId)
    : conversations[0];

  const currentMessages = activeConversation
    ? transcripts[activeConversation.sessionId] ?? [DEFAULT_ASSISTANT_MESSAGE]
    : [DEFAULT_ASSISTANT_MESSAGE];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative h-full w-full max-w-6xl bg-intel-panel border-l border-intel-line backdrop-blur-md flex flex-col md:flex-row">
        <aside className="w-full md:w-80 border-r border-intel-line p-4 pt-16 md:pt-6 space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-intel-ink3">Conversations</p>
              <p className="text-lg font-semibold">AI Desk</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="text-xs px-3 py-1 rounded-full border border-intel-line text-intel-ink2 hover:text-white"
                onClick={onRequestNewChat}
              >
                New
              </button>
              <button
                type="button"
                onClick={onClose}
                className="h-9 w-9 rounded-full border border-intel-line bg-transparent text-intel-ink2 hover:text-white flex items-center justify-center"
                aria-label="Close chat"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <ConversationHistory
            conversations={conversations}
            activeId={activeConversation?.id ?? null}
            onSelect={onConversationSelect}
            onDelete={onConversationDelete}
          />
          <div className="rounded-panel border border-intel-line bg-intel-panel p-4 space-y-2 text-sm">
            <p className="text-xs uppercase tracking-[0.3em] text-intel-ink3">Latest Insight</p>
            <p className="text-intel-ink whitespace-pre-line">
              {latestInsight || 'Ask the desk about any ticker, spread, or risk scenario to capture a note here.'}
            </p>
          </div>
        </aside>
        <main className="flex-1 flex flex-col pt-16 md:pt-0">
          {activeConversation ? (
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
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-intel-ink3">
              Start a new conversation to chat with the desk.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
