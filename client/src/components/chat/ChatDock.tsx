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
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative h-full w-full max-w-6xl bg-gray-950 border-l border-gray-900 flex flex-col md:flex-row">
        <div className="absolute right-4 top-4 z-10">
          <button
            type="button"
            onClick={onClose}
            className="h-10 w-10 rounded-full border border-gray-800 bg-gray-950 text-gray-300 hover:text-white"
            aria-label="Close chat"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <aside className="w-full md:w-80 border-r border-gray-900 p-4 pt-16 md:pt-6 space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Conversations</p>
              <p className="text-lg font-semibold">AI Desk</p>
            </div>
            <button
              type="button"
              className="text-xs px-3 py-1 rounded-full border border-gray-800 text-gray-300 hover:text-white"
              onClick={onRequestNewChat}
            >
              New
            </button>
          </div>
          <ConversationHistory
            conversations={conversations}
            activeId={activeConversation?.id ?? null}
            onSelect={onConversationSelect}
          />
          <div className="rounded-2xl border border-gray-900 bg-gray-950 p-4 space-y-2 text-sm">
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Latest Insight</p>
            <p className="text-gray-200 whitespace-pre-line">
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
            <div className="flex-1 flex items-center justify-center text-sm text-gray-500">
              Start a new conversation to chat with the desk.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
