import { useEffect, useState } from 'react';
import { api } from '../api';
import ChatBot from '../components/ChatBot';
import ChartPane from '../components/ChartPane';
import ConversationHistory from '../components/ConversationHistory';
import { DEFAULT_ASSISTANT_MESSAGE } from '../constants';
import { ChatMessage, ConversationMeta, ConversationPayload, ConversationResponse } from '../types';

const STORAGE_KEY = 'market-copilot.conversations';

export default function Dashboard() {
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [transcripts, setTranscripts] = useState<Record<string, ChatMessage[]>>({});
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [latestInsight, setLatestInsight] = useState('');

  useEffect(() => {
    hydrateConversations();
  }, []);

  useEffect(() => {
    if (!activeConversationId && conversations.length) {
      setActiveConversationId(conversations[0].id);
    }
  }, [conversations, activeConversationId]);

  useEffect(() => {
    if (!conversations.length) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    } catch (error) {
      console.warn('Failed to persist conversations to local storage', error);
    }
  }, [conversations]);

  const activeConversation =
    (activeConversationId && conversations.find(convo => convo.id === activeConversationId)) ||
    conversations[0];

  async function hydrateConversations() {
    try {
      const { data } = await api.get('/api/conversations');
      const list: ConversationMeta[] = (data?.conversations ?? []).map(normalizeConversation);
      if (list.length === 0) {
        const seeded = createConversation();
        setConversations([seeded]);
        setActiveConversationId(seeded.id);
        setTranscripts({
          [seeded.sessionId]: [DEFAULT_ASSISTANT_MESSAGE],
        });
        return;
      }
      setTranscripts({});
      setConversations(list);
      setActiveConversationId(list[0].id);
      await ensureTranscriptLoaded(list[0].sessionId);
    } catch (error) {
      console.warn('Failed to fetch conversations from API, using local cache if available.', error);
      const cached = window.localStorage.getItem(STORAGE_KEY);
      if (cached) {
        try {
          const parsed: ConversationMeta[] = JSON.parse(cached);
          if (parsed.length) {
            setConversations(parsed);
            setActiveConversationId(parsed[0].id);
          }
        } catch (parseError) {
          console.warn('Failed to parse cached conversations', parseError);
        }
      }
      if (!activeConversationId) {
        const seeded = createConversation();
        setConversations([seeded]);
        setActiveConversationId(seeded.id);
        setTranscripts({
          [seeded.sessionId]: [DEFAULT_ASSISTANT_MESSAGE],
        });
      }
    }
  }

  function startNewConversation() {
    const convo = createConversation();
    setConversations(prev => [convo, ...prev]);
    setTranscripts(prev => ({
      ...prev,
      [convo.sessionId]: [DEFAULT_ASSISTANT_MESSAGE],
    }));
    setActiveConversationId(convo.id);
    setLatestInsight('');
  }

  function handleAssistantReply(reply: string) {
    setLatestInsight(reply);
  }

  async function handleConversationSelect(id: string) {
    setActiveConversationId(id);
    const convo = conversations.find(c => c.id === id);
    if (convo) {
      setLatestInsight(convo.preview);
      if (!transcripts[convo.sessionId]) {
        await ensureTranscriptLoaded(convo.sessionId);
      }
    }
  }

  function handleNewChatRequest() {
    startNewConversation();
  }

  function handleMessagesChange(sessionId: string, nextMessages: ChatMessage[]) {
    setTranscripts(prev => ({
      ...prev,
      [sessionId]: nextMessages,
    }));
  }

  function handleConversationUpdate(payload: ConversationPayload) {
    const normalized = normalizeConversation(payload);
    setConversations(prev => {
      const filtered = prev.filter(convo => convo.sessionId !== normalized.sessionId);
      return [normalized, ...filtered];
    });
    setLatestInsight(normalized.preview);
  }

  async function ensureTranscriptLoaded(sessionId: string) {
    if (transcripts[sessionId]) {
      return;
    }
    try {
      const { data } = await api.get<ConversationResponse>(`/api/conversations/${sessionId}`);
      const mapped = mapMessages(data);
      setTranscripts(prev => ({
        ...prev,
        [sessionId]: mapped.length ? mapped : [DEFAULT_ASSISTANT_MESSAGE],
      }));
    } catch (error) {
      console.warn('Failed to fetch conversation transcript', error);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-card">
          <div>
            <p className="eyebrow">Polygon.io Agent</p>
            <h1>Market Copilot</h1>
            <p className="muted">GPT-5 reasoning + live Polygon + FRED data</p>
          </div>
          <span className="status-pill online">Live</span>
        </div>

        <ConversationHistory
          conversations={conversations}
          activeId={activeConversationId ?? ''}
          onSelect={handleConversationSelect}
        />

        <div className="session-card">
          <p className="eyebrow">Session Tips</p>
          <ul>
            <li>Ask about tickers, expirations, or risk scenarios.</li>
            <li>Mention constraints like capital or conviction.</li>
            <li>Say “save a report” to capture long-form output.</li>
          </ul>
        </div>

        <div className="insight-card">
          <p className="eyebrow">Latest Insight</p>
          <p>{latestInsight || 'Start chatting to pin the agent’s takeaways here.'}</p>
        </div>

        <ChartPane report={latestInsight} />
      </aside>

      <main className="conversation-panel">
        {activeConversation && (
          <ChatBot
            key={activeConversation.sessionId}
            sessionId={activeConversation.sessionId}
            conversationTitle={activeConversation.title}
            initialMessages={transcripts[activeConversation.sessionId] ?? [DEFAULT_ASSISTANT_MESSAGE]}
            onAssistantReply={handleAssistantReply}
            onRequestNewChat={handleNewChatRequest}
            onMessagesChange={messages => handleMessagesChange(activeConversation.sessionId, messages)}
            onConversationUpdate={handleConversationUpdate}
          />
        )}
      </main>
    </div>
  );
}

function createConversation(
  title = 'New chat',
  preview = 'Ask the agent anything to get started.',
): ConversationMeta {
  const sessionId = crypto.randomUUID();
  const timestamp = Date.now();
  return {
    id: sessionId,
    sessionId,
    title,
    preview,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function normalizeConversation(payload: ConversationPayload): ConversationMeta {
  return {
    id: payload.sessionId,
    sessionId: payload.sessionId,
    title: payload.title || 'New chat',
    preview: payload.preview || 'Ask the agent anything to get started.',
    createdAt: Date.parse(payload.createdAt),
    updatedAt: Date.parse(payload.updatedAt),
  };
}

function mapMessages(response: ConversationResponse): ChatMessage[] {
  return (response.messages ?? []).map(message => ({
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: Date.parse(message.timestamp),
  }));
}
