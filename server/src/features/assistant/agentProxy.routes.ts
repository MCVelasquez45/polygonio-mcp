import axios from 'axios';
import { Router, type RequestHandler } from 'express';

const router = Router();
const AGENT_URL = (process.env.AGENT_API_URL || process.env.FASTAPI_URL || process.env.PYTHON_URL || 'http://localhost:5001').replace(
  /\/+$/,
  ''
);
const AGENT_PROXY_TIMEOUT_MS = Number(process.env.AGENT_PROXY_TIMEOUT_MS ?? 120_000);

function agentEndpoint(path: string): string {
  return `${AGENT_URL}${path}`;
}

function forwardPost(path: string): RequestHandler {
  return async (req, res, next) => {
    try {
      const response = await axios.post(agentEndpoint(path), req.body, {
        timeout: AGENT_PROXY_TIMEOUT_MS,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
      });
      res.status(response.status).json(response.data);
    } catch (error) {
      next(error);
    }
  };
}

function forwardGet(path: string): RequestHandler {
  return async (_req, res, next) => {
    try {
      const response = await axios.get(agentEndpoint(path), {
        timeout: AGENT_PROXY_TIMEOUT_MS,
        validateStatus: () => true,
      });
      res.status(response.status).json(response.data);
    } catch (error) {
      next(error);
    }
  };
}

// AI Engine health probe for the operator status bar. The AI chat/analysis
// path runs THROUGH the Python agent service (agentClient POSTs to
// `${PYTHON_URL}/v1/chat/completions`), so agent reachability is the honest
// "can the AI actually run" signal — not the outcome of the last user chat.
// Kept on a short timeout so a hung agent never stalls the badge.
const AGENT_HEALTH_TIMEOUT_MS = Number(process.env.AGENT_HEALTH_TIMEOUT_MS ?? 4_000);
type AiHealthSnapshot = {
  status: 'unknown' | 'ok' | 'degraded' | 'down';
  agentReachable: boolean | null;
  openaiConfigured: boolean;
  agentStatus: number | null;
  latencyMs: number | null;
  checkedAt: string | null;
  error: string | null;
};

let lastAiHealthSnapshot: AiHealthSnapshot = {
  status: 'unknown',
  agentReachable: null,
  openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
  agentStatus: null,
  latencyMs: null,
  checkedAt: null,
  error: null,
};

export function getAiHealthSnapshot(): AiHealthSnapshot {
  return { ...lastAiHealthSnapshot };
}

router.get('/health', async (_req, res) => {
  const startedAt = Date.now();
  const openaiConfigured = Boolean(process.env.OPENAI_API_KEY);
  try {
    const response = await axios.get(agentEndpoint('/health'), {
      timeout: AGENT_HEALTH_TIMEOUT_MS,
      validateStatus: () => true,
    });
    const agentReachable = response.status >= 200 && response.status < 300;
    const payload: AiHealthSnapshot = {
      status: agentReachable && openaiConfigured ? 'ok' : 'degraded',
      agentReachable,
      openaiConfigured,
      agentStatus: response.status,
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
      error: null,
    };
    lastAiHealthSnapshot = payload;
    res.status(agentReachable ? 200 : 503).json(payload);
  } catch (error: any) {
    const payload: AiHealthSnapshot = {
      status: 'down',
      agentReachable: false,
      openaiConfigured,
      agentStatus: null,
      error: error?.code || error?.message || 'agent_unreachable',
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    };
    lastAiHealthSnapshot = payload;
    res.status(503).json(payload);
  }
});

router.post('/extract-strategy-async', forwardPost('/extract-strategy-async'));
router.post('/extract-strategy', forwardPost('/extract-strategy'));
router.post('/transcribe-audio', forwardPost('/transcribe-audio'));
router.post('/sift/extract', forwardPost('/sift/extract'));
router.post('/sift/extract-template', forwardPost('/sift/extract-template'));
router.get('/sift/templates', forwardGet('/sift/templates'));
router.get('/sift/providers', forwardGet('/sift/providers'));

export default router;
