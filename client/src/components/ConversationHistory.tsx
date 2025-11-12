import { ConversationMeta } from '../types';

type ConversationHistoryProps = {
  conversations: ConversationMeta[];
  activeId: string;
  onSelect: (id: string) => void;
};

export default function ConversationHistory({ conversations, activeId, onSelect }: ConversationHistoryProps) {
  return (
    <section className="history-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p className="eyebrow">Recent chats</p>
        <span style={{ fontSize: '0.85rem', color: 'rgba(15, 23, 42, 0.5)' }}>{conversations.length}</span>
      </div>
      <div className="history-list">
        {conversations.map(convo => (
          <button
            key={convo.id}
            className={`history-item ${activeId === convo.id ? 'active' : ''}`}
            onClick={() => onSelect(convo.id)}
          >
            <div className="history-avatar">{convo.title.charAt(0).toUpperCase()}</div>
            <div className="history-copy">
              <strong>{convo.title}</strong>
              <p>{convo.preview}</p>
              <span>{new Date(convo.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </button>
        ))}
        {conversations.length === 0 && <p className="placeholder">No conversations yet.</p>}
      </div>
    </section>
  );
}
