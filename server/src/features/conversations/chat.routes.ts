import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { agentChat } from '../assistant/agentClient';
import { appendMessages } from './services/conversationStore';

// Handles `/api/chat` requests and persists transcripts for later retrieval.

const router = Router();

router.post('/', async (req, res, next) => {
  try {
    const { message, sessionId, context } = req.body;
    if (typeof message !== 'string' || !message.trim()) {
      console.log('[SERVER] /api/chat validation failed:', req.body);
      return res.status(400).json({ error: 'message is required' });
    }

    const resolvedSessionId =
      typeof sessionId === 'string' && sessionId.trim().length > 0 ? sessionId.trim() : randomUUID();

    console.log('[SERVER] /api/chat forwarding payload:', {
      message,
      sessionId: resolvedSessionId,
      hasContext: Boolean(context),
    });

    const data = await agentChat(message, resolvedSessionId, context);
    console.log('[SERVER] /api/chat response from agent:', data);

    const conversation = await appendMessages(
      resolvedSessionId,
      message,
      data.reply ?? '(no reply)',
    );

    res.json({
      reply: data.reply,
      sessionId: resolvedSessionId,
      conversation: {
        ...conversation,
        createdAt: conversation.createdAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
      },
    });
  } catch (error: any) {
    const errorDetail =
      error?.response?.data?.error ||
      error?.response?.data?.detail ||
      error?.message ||
      'Unknown error';
    console.error('[SERVER] /api/chat error:', errorDetail);
    res.status(error?.response?.status || 500).json({ error: errorDetail });
  }
});

router.post('/report', async (req, res, next) => {
  try {
    const { content, title, sessionId, context } = req.body ?? {};
    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }
    const safeTitle = typeof title === 'string' && title.trim() ? title.trim() : 'AI Desk Report';
    const prompt = [
      'Save a report using the save_analysis_report tool.',
      `Title: ${safeTitle}`,
      'Content:',
      content.trim(),
      'Return only the confirmation string from save_analysis_report.',
    ].join('\n');

    const data = await agentChat(prompt, sessionId, context);
    res.json({ result: data.reply ?? '(no reply)' });
  } catch (error: any) {
    const errorDetail =
      error?.response?.data?.error ||
      error?.response?.data?.detail ||
      error?.message ||
      'Unknown error';
    console.error('[SERVER] /api/chat/report error:', errorDetail);
    res.status(error?.response?.status || 500).json({ error: errorDetail });
  }
});

export default router;
