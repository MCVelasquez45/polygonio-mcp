import { getApiBaseUrl, http } from './http';

export type AgentResponse = {
  query: string;
  output: string;
  session_name?: string | null;
};

const AGENT_API_BASE_PATH = '/api/agent';

export function getAgentBaseUrl(): string {
  return `${getApiBaseUrl().replace(/\/+$/, '')}/api`;
}

export async function runAgentScan(query: string): Promise<AgentResponse> {
  const response = await http.post<AgentResponse>('/api/analyze', {
    query,
    context: { source: 'web-ui' }
  });
  return response.data;
}

export async function startAgentExtraction(payload: { transcript: string; socket_id?: string | null }) {
  const response = await http.post(`${AGENT_API_BASE_PATH}/extract-strategy-async`, payload);
  return response.data;
}

export async function extractStrategy(payload: { transcript: string; socket_id?: string | null }) {
  const response = await http.post(`${AGENT_API_BASE_PATH}/extract-strategy`, payload);
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
  const response = await http.post<{ transcript: string }>(`${AGENT_API_BASE_PATH}/transcribe-audio`, payload);
  return response.data;
}

// ---------------------------------------------------------------------------
// SIFT — Structured Information extraction From Transcripts
// ---------------------------------------------------------------------------

export type SiftField = {
  id: string;
  type: string;
  prompt: string;
};

export type SiftExtractRequest = {
  transcript: string;
  fields: SiftField[];
  phase_name?: string;
  context?: string;
  provider?: string;
  model?: string;
};

export type SiftExtractResponse = {
  data: Record<string, unknown>;
  provider: string;
  model: string;
};

export type SiftTemplateExtractRequest = {
  transcript: string;
  template?: string;
  provider?: string;
  model?: string;
};

export type SiftTemplateExtractResponse = {
  data: Record<string, unknown>;
  template: string;
  provider: string;
  model: string;
};

export type SiftTemplateInfo = {
  fields: SiftField[];
  field_count: number;
};

/** Stateless extraction with custom fields. */
export async function siftExtract(payload: SiftExtractRequest): Promise<SiftExtractResponse> {
  const response = await http.post<SiftExtractResponse>(`${AGENT_API_BASE_PATH}/sift/extract`, payload);
  return response.data;
}

/** Extract using a built-in template (e.g. "trading-strategy", "meeting-notes"). */
export async function siftExtractTemplate(
  payload: SiftTemplateExtractRequest
): Promise<SiftTemplateExtractResponse> {
  const response = await http.post<SiftTemplateExtractResponse>(
    `${AGENT_API_BASE_PATH}/sift/extract-template`,
    payload
  );
  return response.data;
}

/** List all available SIFT extraction templates. */
export async function siftListTemplates(): Promise<Record<string, SiftTemplateInfo>> {
  const response = await http.get<{ templates: Record<string, SiftTemplateInfo> }>(
    `${AGENT_API_BASE_PATH}/sift/templates`
  );
  return response.data.templates;
}

/** List available AI providers and their status. */
export async function siftListProviders(): Promise<
  Array<{ name: string; available: boolean; model: string | null }>
> {
  const response = await http.get<{
    providers: Array<{ name: string; available: boolean; model: string | null }>;
  }>(`${AGENT_API_BASE_PATH}/sift/providers`);
  return response.data.providers;
}
