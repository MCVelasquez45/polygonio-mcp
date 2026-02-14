import axios from 'axios';

export type AgentResponse = {
  query: string;
  output: string;
  session_name?: string | null;
};

const AGENT_API_URL = 'http://localhost:5001/analyze';

export async function runAgentScan(query: string): Promise<AgentResponse> {
  // Direct call to Agent API (CORS enabled)
  const response = await axios.post<AgentResponse>(AGENT_API_URL, {
    query,
    context: { source: 'web-ui' }
  });
  return response.data;
}
