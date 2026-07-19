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
      <div className="rounded-panel border border-intel-line bg-intel-panel p-4 text-sm text-intel-ink3">
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
            className={`w-full flex items-start gap-2 rounded-panel border px-3 py-3 transition-colors ${
              isActive ? 'border-intel-accentLine bg-intel-accentSoft text-white' : 'border-intel-line bg-intel-panel text-intel-ink hover:border-intel-line'
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(convo.id)}
              className="flex-1 min-w-0 text-left"
            >
              <p className="text-sm font-semibold">{convo.title || 'Untitled chat'}</p>
              <p className="text-xs text-intel-ink2 truncate">{convo.preview}</p>
              <p className="text-[0.65rem] text-intel-ink3 mt-1">
                {new Date(convo.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            </button>
            <button
              type="button"
              onClick={() => onDelete(convo.id)}
              className="h-8 w-8 shrink-0 rounded-full border border-intel-line text-intel-ink2 hover:text-white flex items-center justify-center"
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
