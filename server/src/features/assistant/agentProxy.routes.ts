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
const AGENT_HEALTH_CACHE_TTL_MS = Math.max(1_000, Number(process.env.AGENT_HEALTH_CACHE_TTL_MS ?? 15_000));
const AGENT_HEALTH_STALE_OK_MS = Math.max(
  AGENT_HEALTH_CACHE_TTL_MS,
  Number(process.env.AGENT_HEALTH_STALE_OK_MS ?? 120_000)
);
type AiHealthSnapshot = {
  status: 'unknown' | 'ok' | 'degraded' | 'down';
  agentReachable: boolean | null;
  openaiConfigured: boolean;
  agentStatus: number | null;
  latencyMs: number | null;
  checkedAt: string | null;
  error: string | null;
  cached: boolean;
  stale: boolean;
  cacheAgeMs: number | null;
};

let lastAiHealthSnapshot: AiHealthSnapshot = {
  status: 'unknown',
  agentReachable: null,
  openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
  agentStatus: null,
  latencyMs: null,
  checkedAt: null,
  error: null,
  cached: false,
  stale: false,
  cacheAgeMs: null,
};
let lastSuccessfulAiHealthSnapshot: AiHealthSnapshot | null = null;
let aiHealthProbeInFlight: Promise<AiHealthSnapshot> | null = null;

export function getAiHealthSnapshot(): AiHealthSnapshot {
  return { ...lastAiHealthSnapshot };
}

function snapshotAgeMs(snapshot: AiHealthSnapshot | null, now = Date.now()): number | null {
  if (!snapshot?.checkedAt) return null;
  const checkedAt = Date.parse(snapshot.checkedAt);
  if (!Number.isFinite(checkedAt)) return null;
  return Math.max(0, now - checkedAt);
}

function withCacheMetadata(snapshot: AiHealthSnapshot, cached: boolean, stale: boolean, cacheAgeMs: number | null): AiHealthSnapshot {
  return { ...snapshot, cached, stale, cacheAgeMs };
}

function getFreshSuccessfulSnapshot(now = Date.now()): AiHealthSnapshot | null {
  const ageMs = snapshotAgeMs(lastSuccessfulAiHealthSnapshot, now);
  if (ageMs == null || ageMs > AGENT_HEALTH_CACHE_TTL_MS || !lastSuccessfulAiHealthSnapshot) return null;
  return withCacheMetadata(lastSuccessfulAiHealthSnapshot, true, false, ageMs);
}

function getStaleSuccessfulSnapshot(now = Date.now()): AiHealthSnapshot | null {
  const ageMs = snapshotAgeMs(lastSuccessfulAiHealthSnapshot, now);
  if (ageMs == null || ageMs > AGENT_HEALTH_STALE_OK_MS || !lastSuccessfulAiHealthSnapshot) return null;
  return withCacheMetadata(lastSuccessfulAiHealthSnapshot, true, true, ageMs);
}

async function probeAgentHealth(): Promise<AiHealthSnapshot> {
  if (aiHealthProbeInFlight) return aiHealthProbeInFlight;
  const startedAt = Date.now();
  const openaiConfigured = Boolean(process.env.OPENAI_API_KEY);

  aiHealthProbeInFlight = (async () => {
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
        cached: false,
        stale: false,
        cacheAgeMs: null,
      };
      if (agentReachable) lastSuccessfulAiHealthSnapshot = payload;
      const stale = agentReachable ? null : getStaleSuccessfulSnapshot();
      lastAiHealthSnapshot = stale ?? payload;
      return lastAiHealthSnapshot;
    } catch (error: any) {
      const stale = getStaleSuccessfulSnapshot();
      if (stale) {
        lastAiHealthSnapshot = stale;
        return stale;
      }
      const payload: AiHealthSnapshot = {
        status: 'down',
        agentReachable: false,
        openaiConfigured,
        agentStatus: null,
        error: error?.code || error?.message || 'agent_unreachable',
        latencyMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
        cached: false,
        stale: false,
        cacheAgeMs: null,
      };
      lastAiHealthSnapshot = payload;
      return payload;
    } finally {
      aiHealthProbeInFlight = null;
    }
  })();

  return aiHealthProbeInFlight;
}

export function resetAiHealthForTests(): void {
  lastAiHealthSnapshot = {
    status: 'unknown',
    agentReachable: null,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    agentStatus: null,
    latencyMs: null,
    checkedAt: null,
    error: null,
    cached: false,
    stale: false,
    cacheAgeMs: null,
  };
  lastSuccessfulAiHealthSnapshot = null;
  aiHealthProbeInFlight = null;
}

router.get('/health', async (_req, res) => {
  const cached = getFreshSuccessfulSnapshot();
  if (cached) {
    lastAiHealthSnapshot = cached;
    res.status(200).json(cached);
    return;
  }

  const payload = await probeAgentHealth();
  res.status(200).json(payload);
});

router.post('/extract-strategy-async', forwardPost('/extract-strategy-async'));
router.post('/extract-strategy', forwardPost('/extract-strategy'));
router.post('/transcribe-audio', forwardPost('/transcribe-audio'));
router.post('/sift/extract', forwardPost('/sift/extract'));
router.post('/sift/extract-template', forwardPost('/sift/extract-template'));
router.get('/sift/templates', forwardGet('/sift/templates'));
router.get('/sift/providers', forwardGet('/sift/providers'));

export default router;
