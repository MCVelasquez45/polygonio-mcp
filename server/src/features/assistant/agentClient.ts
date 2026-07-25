import axios from 'axios';
import { acquireAiSlot } from '../../shared/ai/controls';
import { logAiAudit } from '../../shared/ai/audit';
// Shared HTTP client used by both analyze/chat routes to reach the external MCP agent service.

// Base URL for the FastAPI agent (defaults to local dev port 5001).
const PYTHON_URL = process.env.AGENT_API_URL || process.env.FASTAPI_URL || process.env.PYTHON_URL || 'http://localhost:5001';
const AGENT_CHAT_TIMEOUT_MS = Math.max(30_000, Number(process.env.AGENT_CHAT_TIMEOUT_MS ?? 180_000));
const DEFAULT_AGENT_CHAT_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 15_000, 20_000, 30_000];
let agentWarmupTimer: NodeJS.Timeout | null = null;

export type AiRequestMeta = {
  userKey?: string;
  feature?: string;
};

type AiGuardedError = Error & { response?: { status?: number; data?: unknown } };

function estimateSize(value: unknown): number | null {
  if (typeof value === 'string') return value.length;
  if (value == null) return null;
  try {
    return JSON.stringify(value).length;
  } catch {
    return null;
  }
}

function buildLimitError(message: string, retryAfterMs?: number): AiGuardedError {
  const error = new Error(message) as AiGuardedError;
  error.response = {
    status: 429,
    data: { error: message, retryAfterMs }
  };
  return error;
}

function logAgentClient(event: string, context: Record<string, unknown>, severity: 'info' | 'error' = 'info'): void {
  const payload = {
    timestamp: new Date().toISOString(),
    component: 'server',
    module: 'agent-client',
    event,
    severity,
    context,
  };
  const writer = severity === 'error' ? console.error : console.info;
  writer(JSON.stringify(payload));
}

function parseRetryDelays(value: string | undefined): number[] {
  if (!value) return DEFAULT_AGENT_CHAT_RETRY_DELAYS_MS;
  const delays = value
    .split(',')
    .map(part => Number(part.trim()))
    .filter(delay => Number.isFinite(delay) && delay >= 0);
  return delays.length > 0 ? delays : DEFAULT_AGENT_CHAT_RETRY_DELAYS_MS;
}

export function getAgentChatRetryDelaysMs(): number[] {
  const configuredRetries = Number(process.env.AGENT_CHAT_RETRIES);
  const delays = parseRetryDelays(process.env.AGENT_CHAT_RETRY_DELAYS_MS);
  if (Number.isFinite(configuredRetries) && configuredRetries >= 0) {
    return delays.slice(0, configuredRetries);
  }
  return delays;
}

export function isAgentChatRetryableError(error: any): boolean {
  const status = Number(error?.response?.status);
  return status === 502 || status === 503 || status === 504 || error?.code === 'ECONNABORTED';
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function agentHealthEndpoint(): string {
  return `${PYTHON_URL.replace(/\/+$/, '')}/health`;
}

export function isAgentWarmupEnabled(): boolean {
  return (
    process.env.AGENT_WARMUP_ENABLED === 'true' ||
    (process.env.AGENT_WARMUP_ENABLED !== 'false' && process.env.NODE_ENV === 'production')
  );
}

export function getAgentWarmupIntervalMs(): number {
  return Math.max(60_000, Number(process.env.AGENT_WARMUP_INTERVAL_MS ?? 300_000));
}

export async function warmAgentOnce(reason = 'manual'): Promise<boolean> {
  const endpoint = agentHealthEndpoint();
  const startedAt = Date.now();
  const timeoutMs = Math.max(1_000, Number(process.env.AGENT_WARMUP_TIMEOUT_MS ?? 15_000));
  logAgentClient('AGENT_WARMUP_STARTED', { endpoint, reason, timeoutMs });
  try {
    const response = await axios.get(endpoint, {
      timeout: timeoutMs,
      validateStatus: () => true,
    });
    const ok = response.status >= 200 && response.status < 300;
    logAgentClient(ok ? 'AGENT_WARMUP_SUCCEEDED' : 'AGENT_WARMUP_DEGRADED', {
      endpoint,
      reason,
      status: response.status,
      latencyMs: Date.now() - startedAt,
    }, ok ? 'info' : 'error');
    return ok;
  } catch (error: any) {
    logAgentClient(
      'AGENT_WARMUP_FAILED',
      {
        endpoint,
        reason,
        code: error?.code ?? null,
        message: error?.response?.data?.error ?? error?.message ?? 'AI agent warmup failed',
        latencyMs: Date.now() - startedAt,
      },
      'error'
    );
    return false;
  }
}

export function startAgentWarmup(): void {
  if (agentWarmupTimer) return;
  const enabled = isAgentWarmupEnabled();
  if (!enabled) {
    logAgentClient('AGENT_WARMUP_DISABLED', {
      nodeEnv: process.env.NODE_ENV ?? null,
      configured: process.env.AGENT_WARMUP_ENABLED ?? null,
    });
    return;
  }

  void warmAgentOnce('startup');
  const intervalMs = getAgentWarmupIntervalMs();
  agentWarmupTimer = setInterval(() => {
    void warmAgentOnce('interval');
  }, intervalMs);
  agentWarmupTimer.unref?.();
  logAgentClient('AGENT_WARMUP_SCHEDULED', { intervalMs });
}

export function stopAgentWarmup(): void {
  if (!agentWarmupTimer) return;
  clearInterval(agentWarmupTimer);
  agentWarmupTimer = null;
  logAgentClient('AGENT_WARMUP_STOPPED', {});
}

async function runAiRequest<T>(
  input: string,
  meta: AiRequestMeta | undefined,
  task: () => Promise<T>
): Promise<T> {
  const feature = meta?.feature ?? 'ai.request';
  const userKey = meta?.userKey ?? 'anonymous';
  const guard = acquireAiSlot(userKey, feature);
  if (!guard.allowed) {
    const message =
      guard.reason === 'daily_limit'
        ? 'AI daily budget reached. Try again tomorrow.'
        : guard.reason === 'rate_limit'
        ? 'AI rate limit reached. Please wait before retrying.'
        : 'AI service is busy. Please retry in a moment.';
    void logAiAudit({
      feature,
      userKey,
      status: 'blocked',
      inputChars: input.length,
      outputChars: null,
      durationMs: null,
      error: message
    });
    throw buildLimitError(message, guard.retryAfterMs);
  }

  const startedAt = Date.now();
  try {
    const result = await task();
    void logAiAudit({
      feature,
      userKey,
      status: 'ok',
      inputChars: input.length,
      outputChars: estimateSize(result),
      durationMs: Date.now() - startedAt
    });
    return result;
  } catch (error: any) {
    void logAiAudit({
      feature,
      userKey,
      status: 'error',
      inputChars: input.length,
      outputChars: null,
      durationMs: Date.now() - startedAt,
      error: error?.response?.data?.error ?? error?.message ?? 'AI request failed'
    });
    throw error;
  } finally {
    guard.release?.();
  }
}

/**
 * Sends analysis prompts to the Python agent and returns its structured response.
 * The payload mirrors what the FastAPI service expects: `{ query: string }`.
 * Any transport error is logged and re-thrown so Express error middleware can
 * produce the appropriate HTTP status.
 */
export async function agentAnalyze(
  query: string,
  context?: Record<string, unknown>,
  meta?: AiRequestMeta
) {
  logAgentClient('AGENT_ANALYZE_REQUEST_STARTED', {
    endpoint: `${PYTHON_URL}/analyze`,
    hasContext: Boolean(context),
    inputChars: query.length,
  });
  return runAiRequest(query, meta, async () => {
    try {
      const { data } = await axios.post(`${PYTHON_URL}/analyze`, { query, context });
      logAgentClient('AGENT_ANALYZE_REQUEST_SUCCEEDED', {
        endpoint: `${PYTHON_URL}/analyze`,
        responseChars: estimateSize(data),
      });
      return data;
    } catch (error) {
      logAgentClient(
        'AGENT_ANALYZE_REQUEST_FAILED',
        {
          endpoint: `${PYTHON_URL}/analyze`,
          status: (error as any)?.response?.status ?? null,
          code: (error as any)?.code ?? null,
          message: (error as any)?.response?.data?.error ?? (error as any)?.message ?? 'AI analyze request failed',
        },
        'error'
      );
      throw error;
    }
  });
}

/**
 * Sends a conversational prompt to the agent; optionally keeps the conversation grouped
 * via `sessionName` so the downstream service can preserve context. The API
 * contract follows OpenAI's Chat Completions style (`messages`, `model`, etc.).
 * Returns the parsed reply text along with the raw response for auditing.
 */
export async function agentChat(
  message: string,
  sessionName?: string,
  context?: Record<string, unknown>,
  meta?: AiRequestMeta
) {
  const endpoint = `${PYTHON_URL}/v1/chat/completions`;
  const retryDelaysMs = getAgentChatRetryDelaysMs();
  logAgentClient('AGENT_CHAT_REQUEST_STARTED', {
    endpoint,
    sessionName,
    hasContext: Boolean(context),
    retryBudget: retryDelaysMs.length,
  });
  return runAiRequest(message, meta, async () => {
    let lastError: any = null;
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
      const payload: Record<string, unknown> = {
        model: 'gpt-5',
        messages: [{ role: 'user', content: message }],
        context,
      };
      if (sessionName) {
        payload.session_name = sessionName;
      }

      try {
        const { data } = await axios.post(endpoint, payload, { timeout: AGENT_CHAT_TIMEOUT_MS });
        const reply = data?.choices?.[0]?.message?.content ?? '(no reply)';
        logAgentClient('AGENT_CHAT_REQUEST_SUCCEEDED', {
          endpoint,
          sessionName,
          attempt: attempt + 1,
          replyChars: reply.length,
        });
        return { reply, sessionName, raw: data };
      } catch (error: any) {
        lastError = error;
        const status = error?.response?.status;
        const retryable = isAgentChatRetryableError(error);
        const nextDelayMs = retryDelaysMs[attempt] ?? null;
        logAgentClient(
          'AGENT_CHAT_REQUEST_FAILED',
          {
            endpoint,
            status,
            code: error?.code ?? null,
            attempt: attempt + 1,
            retryable,
            nextDelayMs,
            message: error?.response?.data?.error ?? error?.message ?? 'AI chat request failed',
          },
          retryable && nextDelayMs != null ? 'info' : 'error'
        );
        if (!retryable || nextDelayMs == null) {
          throw error;
        }
        await wait(nextDelayMs);
      }
    }
    throw lastError;
  });
}
