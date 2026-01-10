import { Router } from 'express';
// Assistant router: validates analyze requests and forwards them to the Python agent service.
import { agentAnalyze } from './agentClient';
import { resolveAiUserKey } from '../../shared/ai/controls';

const router = Router();

// POST /api/analyze
// ------------------
// Accepts `{ query: string }`, validates the payload, forwards it to the
// agent client, and streams the agent's JSON response back to the browser.
// Any exception is forwarded to Express error middleware so the client gets
// a consistent error envelope.

router.post('/', async (req, res, next) => {
  try {
    const { query, context } = req.body;
    // Basic guardrail to avoid hammering the agent with empty payloads.
    if (typeof query !== 'string' || !query.trim()) {
      console.log('[SERVER] /api/analyze validation failed:', req.body);
      return res.status(400).json({ error: 'query is required' });
    }
    console.log('[SERVER] /api/analyze forwarding payload:', { query, hasContext: Boolean(context) });
    const userKey = resolveAiUserKey(req);
    const data = await agentAnalyze(query, context, { userKey, feature: 'assistant.analyze' });
    console.log('[SERVER] /api/analyze response from agent:', data);
    res.json(data);
  } catch (error) {
    console.error('[SERVER] /api/analyze error:', error);
    next(error);
  }
});

export default router;
