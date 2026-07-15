import { http } from './http';

// Governed MANUAL paper-trading client. Selecting/viewing a contract never
// calls these. The order lifecycle is explicit: create a durable intent →
// confirm → submit (server-side execution gateway). Automation is separate.

export type ManualIntentInput = {
  optionSymbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  orderType: string;
  limitPrice?: number | null;
  timeInForce?: 'day' | 'gtc';
  positionIntent?: string;
  marketDataSource?: string | null;
};

export type ManualIntent = {
  id: string;
  status: 'CREATED' | 'CONFIRMED' | 'SUBMITTING' | 'SUBMITTED' | 'REJECTED' | 'FAILED';
  executionMode: 'MANUAL';
  orderSource: 'MANUAL_UI';
  optionSymbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  orderType: string;
  limitPrice: number | null;
  timeInForce: string;
  payloadHash: string;
  clientOrderId: string | null;
  brokerOrderId: string | null;
  rejectionReason: string | null;
};

export type ManualSubmitResponse = {
  outcome: 'SUBMITTED' | 'ALREADY_SUBMITTED' | 'REJECTED' | 'FAILED';
  reason?: string;
  intent: ManualIntent;
  brokerOrder?: unknown;
};

export async function createManualIntent(input: ManualIntentInput): Promise<ManualIntent> {
  const { data } = await http.post<{ intent: ManualIntent }>('/api/trading/manual/intents', input);
  return data.intent;
}

export async function confirmManualIntent(intentId: string): Promise<ManualIntent> {
  const { data } = await http.post<{ intent: ManualIntent }>(`/api/trading/manual/intents/${intentId}/confirm`, {});
  return data.intent;
}

export async function submitManualIntent(intentId: string): Promise<ManualSubmitResponse> {
  const { data } = await http.post<ManualSubmitResponse>(`/api/trading/manual/intents/${intentId}/submit`, {});
  return data;
}

/**
 * Full explicit manual submission: create → confirm → submit. Call ONLY from a
 * deliberate user confirmation action — never from selection, mount, or effects.
 */
export async function submitManualPaperOrder(input: ManualIntentInput): Promise<ManualSubmitResponse> {
  const intent = await createManualIntent(input);
  await confirmManualIntent(intent.id);
  return submitManualIntent(intent.id);
}
