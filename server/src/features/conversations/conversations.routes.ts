import { Router } from 'express';
import { deleteConversation, getConversation, listConversations } from './services/conversationStore';

// Exposes `/api/conversations` endpoints for listing past chat sessions.

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const conversations = await listConversations();
    res.json({
      conversations: conversations.map(doc => ({
        sessionId: doc.sessionId,
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
    const conversation = await getConversation(sessionId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json({
      sessionId: conversation.sessionId,
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
    const deleted = await deleteConversation(sessionId);
    if (!deleted) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
