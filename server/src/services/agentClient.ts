import axios from 'axios';

const PYTHON_URL = process.env.PYTHON_URL || 'http://localhost:5001';

export async function agentAnalyze(query: string) {
  console.log('[SERVER] agentClient.analyze -> POST', `${PYTHON_URL}/analyze`, query);
  try {
    const { data } = await axios.post(`${PYTHON_URL}/analyze`, { query });
    console.log('[SERVER] agentClient.analyze <- response', data);
    return data;
  } catch (error) {
    console.error('[SERVER] agentClient.analyze error', error);
    throw error;
  }
}

export async function agentChat(message: string, sessionName?: string) {
  const endpoint = `${PYTHON_URL}/v1/chat/completions`;
  console.log('[SERVER] agentClient.chat -> POST', endpoint, { message, sessionName });
  try {
    const payload: Record<string, unknown> = {
      model: 'gpt-5',
      messages: [{ role: 'user', content: message }]
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
