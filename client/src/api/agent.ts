import axios from 'axios';
import { getApiBaseUrl } from './http';

export type AgentResponse = {
  query: string;
  output: string;
  session_name?: string | null;
};

const AGENT_BASE_URL =
  (typeof import.meta.env.VITE_AGENT_URL === 'string' && import.meta.env.VITE_AGENT_URL.trim()) ||
  `${getApiBaseUrl().replace(/\/+$/, '')}`.replace(/:4000$/, ':5001');

export function getAgentBaseUrl(): string {
  return AGENT_BASE_URL;
}

export async function runAgentScan(query: string): Promise<AgentResponse> {
  // Direct call to Agent API (CORS enabled)
  const response = await axios.post<AgentResponse>(`${AGENT_BASE_URL}/analyze`, {
    query,
    context: { source: 'web-ui' }
  });
  return response.data;
}

export async function startAgentExtraction(payload: { transcript: string; socket_id?: string | null }) {
  const response = await axios.post(`${AGENT_BASE_URL}/extract-strategy-async`, payload);
  return response.data;
}
