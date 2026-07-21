import { Trash2 } from 'lucide-react';
import { ConversationMeta } from '../../types';

type ConversationHistoryProps = {
  conversations: ConversationMeta[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
};

export function ConversationHistory({ conversations, activeId, onSelect, onDelete }: ConversationHistoryProps) {
  if (!conversations.length) {
    return (
      <div className="ai-glass-panel rounded-panel p-4 text-sm leading-relaxed text-intel-ink3">
        No chats yet. Start a thread to brief the desk.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {conversations.map(convo => {
        const isActive = activeId === convo.id;
        return (
          <div
            key={convo.id}
            className={`ai-glass-panel-soft ai-card-elevate w-full flex items-start gap-2 rounded-panel px-3 py-3 ${
              isActive ? 'text-white ring-1 ring-intel-accentLine' : 'text-intel-ink'
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(convo.id)}
              className="ai-focus-ring flex-1 min-w-0 rounded text-left"
            >
              <p className="text-sm font-semibold">{convo.title || 'Untitled chat'}</p>
              <p className="text-xs leading-relaxed text-intel-ink2 truncate">{convo.preview}</p>
              <p className="ai-metadata mt-1 font-mono">
                {new Date(convo.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            </button>
            <button
              type="button"
              onClick={() => onDelete(convo.id)}
              className="ai-glass-button ai-focus-ring h-10 w-10 shrink-0 rounded-md text-intel-ink2 hover:text-white flex items-center justify-center"
              aria-label="Delete chat"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
