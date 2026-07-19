import { randomUUID } from 'node:crypto';
import { getCollection, isMongoReady } from '../../../shared/db/mongo';

export type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
};

export type ConversationDocument = {
  sessionId: string;
  userKey?: string;
  symbol?: string | null;
  title: string;
  preview: string;
  createdAt: Date;
  updatedAt: Date;
  messages: ConversationMessage[];
};

export type ConversationSummary = {
  sessionId: string;
  userKey?: string;
  symbol?: string | null;
  title: string;
  preview: string;
  createdAt: Date;
  updatedAt: Date;
};

function conversationsCollection() {
  if (!isMongoReady()) {
    throw new Error('Conversations require MongoDB. Start MongoDB or set MONGO_URI.');
  }
  return getCollection<ConversationDocument>('conversations');
}

function deriveTitle(userInput: string, fallback = 'New chat'): string {
  const firstLine = userInput.split('\n').find(Boolean)?.trim();
  if (!firstLine) {
    return fallback;
  }
  return firstLine.slice(0, 80);
}

function derivePreview(reply: string): string {
  const line = reply.split('\n').find(Boolean)?.trim();
  return (line || reply).slice(0, 140);
}

export async function appendMessages(
  sessionId: string,
  userContent: string,
  assistantContent: string,
  metadata: { userKey?: string; symbol?: string | null } = {},
): Promise<ConversationSummary> {
  const now = new Date();
  const preview = derivePreview(assistantContent);
  const title = deriveTitle(userContent);
  const userKey = metadata.userKey?.trim() || 'unknown';
  const symbol = metadata.symbol?.trim().toUpperCase() || null;

  await conversationsCollection().updateOne(
    { sessionId, userKey },
    {
      $setOnInsert: {
        sessionId,
        userKey,
        symbol,
        title,
        createdAt: now,
      },
      $set: {
        userKey,
        symbol,
        preview,
        updatedAt: now,
      },
      $push: {
        messages: {
          $each: [
            {
              id: randomUUID(),
              role: 'user',
              content: userContent,
              timestamp: now,
            },
            {
              id: randomUUID(),
              role: 'assistant',
              content: assistantContent,
              timestamp: now,
            },
          ],
          $slice: -400,
        },
      },
    },
    { upsert: true },
  );

  const doc = await conversationsCollection().findOne(
    { sessionId, userKey },
    { projection: { _id: 0, messages: 0 } },
  );
  if (!doc) {
    throw new Error('Failed to fetch conversation after update.');
  }
  return doc;
}

export async function listConversations(filters: { userKey?: string; symbol?: string | null } = {}): Promise<ConversationSummary[]> {
  const query: Record<string, unknown> = {};
  if (filters.userKey) query.userKey = filters.userKey;
  if (filters.symbol) query.symbol = filters.symbol.trim().toUpperCase();
  const cursor = conversationsCollection()
    .find(query, { projection: { _id: 0, messages: 0 } })
    .sort({ updatedAt: -1 });
  return cursor.toArray();
}

export async function getConversation(sessionId: string, userKey?: string): Promise<ConversationDocument | null> {
  const query: Record<string, unknown> = { sessionId };
  if (userKey) query.userKey = userKey;
  const doc = await conversationsCollection().findOne(query, { projection: { _id: 0 } });
  return doc ?? null;
}

export async function deleteConversation(sessionId: string, userKey?: string): Promise<boolean> {
  const query: Record<string, unknown> = { sessionId };
  if (userKey) query.userKey = userKey;
  const result = await conversationsCollection().deleteOne(query);
  return (result.deletedCount ?? 0) > 0;
}
