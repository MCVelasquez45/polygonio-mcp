import { ConversationMeta } from '../../types';

type ConversationHistoryProps = {
  conversations: ConversationMeta[];
  activeId: string | null;
  onSelect: (id: string) => void;
};

export function ConversationHistory({ conversations, activeId, onSelect }: ConversationHistoryProps) {
  if (!conversations.length) {
    return (
      <div className="rounded-2xl border border-gray-900 bg-gray-950 p-4 text-sm text-gray-500">
        No chats yet. Start a thread to brief the desk.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {conversations.map(convo => {
        const isActive = activeId === convo.id;
        return (
          <button
            key={convo.id}
            type="button"
            onClick={() => onSelect(convo.id)}
            className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
              isActive ? 'border-emerald-500/40 bg-emerald-500/10 text-white' : 'border-gray-900 bg-gray-950 text-gray-200 hover:border-gray-800'
            }`}
          >
            <p className="text-sm font-semibold">{convo.title || 'Untitled chat'}</p>
            <p className="text-xs text-gray-400 truncate">{convo.preview}</p>
            <p className="text-[0.65rem] text-gray-500 mt-1">
              {new Date(convo.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          </button>
        );
      })}
    </div>
  );
}
