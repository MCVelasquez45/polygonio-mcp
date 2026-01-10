import axios from 'axios';
import { acquireAiSlot } from '../../shared/ai/controls';
import { logAiAudit } from '../../shared/ai/audit';
// Shared HTTP client used by both analyze/chat routes to reach the external MCP agent service.

// Base URL for the FastAPI agent (defaults to local dev port 5001).
const PYTHON_URL = process.env.AGENT_API_URL || process.env.FASTAPI_URL || process.env.PYTHON_URL || 'http://localhost:5001';

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
  console.log('[SERVER] agentClient.analyze -> POST', `${PYTHON_URL}/analyze`, { query, context });
  return runAiRequest(query, meta, async () => {
    try {
      const { data } = await axios.post(`${PYTHON_URL}/analyze`, { query, context });
      console.log('[SERVER] agentClient.analyze <- response', data);
      return data;
    } catch (error) {
      console.error('[SERVER] agentClient.analyze error', error);
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
  console.log('[SERVER] agentClient.chat -> POST', endpoint, { message, sessionName, context });
  return runAiRequest(message, meta, async () => {
    try {
      const payload: Record<string, unknown> = {
        model: 'gpt-5',
        messages: [{ role: 'user', content: message }],
        context,
      };
      if (sessionName) {
        payload.session_name = sessionName;
      }

      const { data } = await axios.post(endpoint, payload);
      const reply = data?.choices?.[0]?.message?.content ?? '(no reply)';
      console.log('[SERVER] agentClient.chat <- response', reply);
      return { reply, sessionName, raw: data };
    } catch (error) {
      console.error('[SERVER] agentClient.chat error', error);
      throw error;
    }
  });
}
