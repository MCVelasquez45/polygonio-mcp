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

export async function extractStrategy(payload: { transcript: string; socket_id?: string | null }) {
  const response = await axios.post(`${AGENT_BASE_URL}/extract-strategy`, payload);
  return response.data;
}

type TranscribeAudioPayload = {
  audio_base64: string;
  filename?: string | null;
  mime_type?: string | null;
  language?: string | null;
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Failed to read file.'));
        return;
      }
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

export async function transcribeAudioUpload(file: File, language = 'en'): Promise<{ transcript: string }> {
  const audioBase64 = await fileToBase64(file);
  const payload: TranscribeAudioPayload = {
    audio_base64: audioBase64,
    filename: file.name || 'audio-upload',
    mime_type: file.type || 'application/octet-stream',
    language,
  };
  const response = await axios.post<{ transcript: string }>(`${AGENT_BASE_URL}/transcribe-audio`, payload);
  return response.data;
}
