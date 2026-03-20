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
      <div className="rounded-2xl border border-gray-900/80 bg-gray-950/70 p-4 text-sm text-gray-500">
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
            className={`w-full flex items-start gap-2 rounded-2xl border px-3 py-3 transition-colors ${
              isActive ? 'border-emerald-500/40 bg-emerald-500/10 text-white' : 'border-gray-900/80 bg-gray-950/70 text-gray-200 hover:border-gray-800'
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(convo.id)}
              className="flex-1 min-w-0 text-left"
            >
              <p className="text-sm font-semibold">{convo.title || 'Untitled chat'}</p>
              <p className="text-xs text-gray-400 truncate">{convo.preview}</p>
              <p className="text-[0.65rem] text-gray-500 mt-1">
                {new Date(convo.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            </button>
            <button
              type="button"
              onClick={() => onDelete(convo.id)}
              className="h-8 w-8 shrink-0 rounded-full border border-gray-800/70 text-gray-400 hover:text-white flex items-center justify-center"
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
