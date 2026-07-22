import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { agentChat } from '../assistant/agentClient';
import { AI_AGENTS } from '../assistant/orchestrator/agents';
import { runAgent } from '../assistant/orchestrator/orchestrator.service';
import { resolveAiUserKey } from '../../shared/ai/controls';
import { isOptionSymbol } from '../../shared/symbols/optionSymbol';
import { appendMessages } from './services/conversationStore';

// Handles `/api/chat` requests and persists transcripts for later retrieval.

const router = Router();

function normalizeChatSymbol(context: any): string | null {
  const candidates = [
    context?.selectedTicker,
    context?.symbol,
    context?.ticker,
    context?.chart?.symbol,
    context?.option?.underlying,
    context?.option?.ticker,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      const normalized = value.trim().toUpperCase();
      return isOptionSymbol(normalized) && typeof context?.option?.underlying === 'string'
        ? context.option.underlying.trim().toUpperCase()
        : normalized;
    }
  }
  return null;
}

function describeChatUpstreamError(error: any): { status: number; error: string; upstreamStatus: number | null } {
  const status = Number(error?.response?.status) || 500;
  const upstreamStatus = Number(error?.response?.status) || null;
  const responseData = error?.response?.data;
  const upstreamMessage =
    typeof responseData?.error === 'string'
      ? responseData.error
      : typeof responseData?.detail === 'string'
      ? responseData.detail
      : typeof responseData === 'string'
      ? responseData.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
      : null;

  if (status === 502 || status === 503 || status === 504 || error?.code === 'ECONNABORTED') {
    return {
      status,
      upstreamStatus,
      error: upstreamMessage || 'AI agent upstream timed out or returned a temporary gateway error. Please retry.',
    };
  }

  return {
    status,
    upstreamStatus,
    error: upstreamMessage || error?.message || 'Unknown chat service error',
  };
}

// AI Desk agent registry — drives the client's agent buttons.
router.get('/agents', (_req, res) => {
  res.json({
    agents: AI_AGENTS.map(agent => ({
      id: agent.id,
      label: agent.label,
      description: agent.description,
      contexts: agent.contexts,
    })),
  });
});

router.post('/', async (req, res, next) => {
  try {
    const { message, sessionId, context, agentId } = req.body;
    if (typeof message !== 'string' || !message.trim()) {
      console.log('[SERVER] /api/chat validation failed:', req.body);
      return res.status(400).json({ error: 'message is required' });
    }

    const resolvedSessionId =
      typeof sessionId === 'string' && sessionId.trim().length > 0 ? sessionId.trim() : randomUUID();
    const userKey = resolveAiUserKey(req);
    const symbol = normalizeChatSymbol(context);
    const agentSessionName = [userKey, symbol, resolvedSessionId].filter(Boolean).join(':');

    console.log('[SERVER] /api/chat forwarding payload:', {
      sessionId: resolvedSessionId,
      symbol,
      agentId: typeof agentId === 'string' ? agentId : null,
      hasContext: Boolean(context),
    });

    const data =
      typeof agentId === 'string' && agentId.trim()
        ? await runAgent(
            agentId.trim(),
            {
              symbol: symbol ?? '',
              timeframe: typeof context?.chart?.timeframe === 'string' ? context.chart.timeframe : null,
              contract: typeof context?.option?.ticker === 'string' ? context.option.ticker : null,
              liveMarket: context?.liveMarket ?? null,
            },
            { userKey, sessionName: agentSessionName }
          )
        : await agentChat(message, agentSessionName, context, {
            userKey,
            feature: 'assistant.chat'
          });
    console.log('[SERVER] /api/chat response from agent:', data);

    const conversation = await appendMessages(
      resolvedSessionId,
      message,
      data.reply ?? '(no reply)',
      { userKey, symbol },
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
    const detail = describeChatUpstreamError(error);
    console.error('[SERVER] /api/chat error:', {
      status: detail.status,
      upstreamStatus: detail.upstreamStatus,
      code: error?.code,
      error: detail.error,
    });
    res.status(detail.status).json({
      error: detail.error,
      upstreamStatus: detail.upstreamStatus,
    });
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

    const userKey = resolveAiUserKey(req);
    const data = await agentChat(prompt, sessionId, context, {
      userKey,
      feature: 'assistant.report'
    });
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
