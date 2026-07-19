import { Router } from 'express';
import { deleteConversation, getConversation, listConversations } from './services/conversationStore';
import { resolveAiUserKey } from '../../shared/ai/controls';

// Exposes `/api/conversations` endpoints for listing past chat sessions.

const router = Router();

function normalizeSymbol(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim().toUpperCase() : null;
}

router.get('/', async (req, res, next) => {
  try {
    const userKey = resolveAiUserKey(req);
    const symbol = normalizeSymbol(req.query.symbol);
    const conversations = await listConversations({ userKey, symbol });
    res.json({
      conversations: conversations.map(doc => ({
        sessionId: doc.sessionId,
        symbol: doc.symbol ?? null,
        title: doc.title,
        preview: doc.preview,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const userKey = resolveAiUserKey(req);
    const conversation = await getConversation(sessionId, userKey);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json({
      sessionId: conversation.sessionId,
      symbol: conversation.symbol ?? null,
      title: conversation.title,
      preview: conversation.preview,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      messages: conversation.messages.map(message => ({
        id: message.id,
        role: message.role,
        content: message.content,
        timestamp: message.timestamp.toISOString(),
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }
    const userKey = resolveAiUserKey(req);
    const deleted = await deleteConversation(sessionId, userKey);
    if (!deleted) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
