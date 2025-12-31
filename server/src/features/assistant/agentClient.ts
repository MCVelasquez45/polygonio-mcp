import axios from 'axios';
// Shared HTTP client used by both analyze/chat routes to reach the external MCP agent service.

// Base URL for the FastAPI agent (defaults to local dev port 5001).
const PYTHON_URL = process.env.PYTHON_URL || 'http://localhost:5001';

/**
 * Sends analysis prompts to the Python agent and returns its structured response.
 * The payload mirrors what the FastAPI service expects: `{ query: string }`.
 * Any transport error is logged and re-thrown so Express error middleware can
 * produce the appropriate HTTP status.
 */
export async function agentAnalyze(query: string, context?: Record<string, unknown>) {
  console.log('[SERVER] agentClient.analyze -> POST', `${PYTHON_URL}/analyze`, { query, context });
  try {
    const { data } = await axios.post(`${PYTHON_URL}/analyze`, { query, context });
    console.log('[SERVER] agentClient.analyze <- response', data);
    return data;
  } catch (error) {
    console.error('[SERVER] agentClient.analyze error', error);
    throw error;
  }
}

/**
 * Sends a conversational prompt to the agent; optionally keeps the conversation grouped
 * via `sessionName` so the downstream service can preserve context. The API
 * contract follows OpenAI's Chat Completions style (`messages`, `model`, etc.).
 * Returns the parsed reply text along with the raw response for auditing.
 */
export async function agentChat(message: string, sessionName?: string, context?: Record<string, unknown>) {
  const endpoint = `${PYTHON_URL}/v1/chat/completions`;
  console.log('[SERVER] agentClient.chat -> POST', endpoint, { message, sessionName, context });
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
}
