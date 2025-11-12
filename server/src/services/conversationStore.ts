import { randomUUID } from 'node:crypto';
import { getCollection } from './mongo';

export type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
};

export type ConversationDocument = {
  sessionId: string;
  title: string;
  preview: string;
  createdAt: Date;
  updatedAt: Date;
  messages: ConversationMessage[];
};

export type ConversationSummary = {
  sessionId: string;
  title: string;
  preview: string;
  createdAt: Date;
  updatedAt: Date;
};

function conversationsCollection() {
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
): Promise<ConversationSummary> {
  const now = new Date();
  const preview = derivePreview(assistantContent);
  const title = deriveTitle(userContent);

  await conversationsCollection().updateOne(
    { sessionId },
    {
      $setOnInsert: {
        sessionId,
        title,
        createdAt: now,
      },
      $set: {
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
    { sessionId },
    { projection: { _id: 0, messages: 0 } },
  );
  if (!doc) {
    throw new Error('Failed to fetch conversation after update.');
  }
  return doc;
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const cursor = conversationsCollection()
    .find({}, { projection: { _id: 0, messages: 0 } })
    .sort({ updatedAt: -1 });
  return cursor.toArray();
}

export async function getConversation(sessionId: string): Promise<ConversationDocument | null> {
  const doc = await conversationsCollection().findOne({ sessionId }, { projection: { _id: 0 } });
  return doc ?? null;
}
