import { getOptionOrders, type OptionOrder } from './alpaca';
import { http } from './http';

export const LEGACY_SUBMISSION_DISABLED_MESSAGE =
  'This submission path is disabled. Use the governed order ticket.';

type OrderHistoryParams = { status?: string; limit?: number };
type OrderHistoryResponse = { orders: OptionOrder[] };
type OrderHistoryErrorClass = 'canceled' | 'legacy-disabled' | 'structural' | 'network' | 'unknown';

const NETWORK_BACKOFF_BASE_MS = 2_000;
const NETWORK_BACKOFF_MAX_MS = 30_000;

const inFlight = new Map<string, Promise<OrderHistoryResponse>>();
let backendUnavailable = false;
let networkFailureCount = 0;
let healthProbeTimer: ReturnType<typeof setTimeout> | null = null;

function keyFor(params: OrderHistoryParams = {}) {
  return JSON.stringify({ status: params.status ?? '', limit: params.limit ?? '' });
}

export function isHttpCancellation(error: any): boolean {
  return error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError' || error?.name === 'AbortError';
}

export function isLegacySubmissionDisabled(error: any): boolean {
  return (
    error?.response?.status === 410 &&
    (error?.response?.data?.error === 'DIRECT_BROKER_SUBMISSION_DISABLED' ||
      String(error?.config?.url ?? '').includes('/api/broker/alpaca/options/orders'))
  );
}

export function classifyOrderHistoryError(error: any): OrderHistoryErrorClass {
  if (isHttpCancellation(error)) return 'canceled';
  if (isLegacySubmissionDisabled(error)) return 'legacy-disabled';
  if (!error?.response) return 'network';
  const status = Number(error.response.status);
  if (Number.isFinite(status) && status >= 400 && status < 500) return 'structural';
  return 'unknown';
}

async function probeHealth(): Promise<boolean> {
  try {
    await http.get('/health', { timeout: 3_000 });
    backendUnavailable = false;
    networkFailureCount = 0;
    return true;
  } catch {
    return false;
  }
}

function scheduleHealthProbe() {
  if (healthProbeTimer) return;
  const delay = Math.min(
    NETWORK_BACKOFF_MAX_MS,
    NETWORK_BACKOFF_BASE_MS * 2 ** Math.max(0, networkFailureCount - 1)
  );
  healthProbeTimer = setTimeout(() => {
    healthProbeTimer = null;
    void probeHealth().then(healthy => {
      if (!healthy) {
        networkFailureCount += 1;
        scheduleHealthProbe();
      }
    });
  }, delay);
}

export function getOptionOrdersDeduped(
  params?: OrderHistoryParams,
  signal?: AbortSignal
): Promise<OrderHistoryResponse> {
  const key = keyFor(params);
  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = getOptionOrders(params, signal).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, request);
  return request;
}

export async function getOptionOrdersForPolling(
  params?: OrderHistoryParams,
  signal?: AbortSignal
): Promise<OrderHistoryResponse> {
  if (backendUnavailable) {
    scheduleHealthProbe();
    const error = new Error('Backend unavailable; order-history polling paused until /health succeeds') as Error & {
      code?: string;
    };
    error.code = 'BACKEND_UNAVAILABLE';
    throw error;
  }

  try {
    const response = await getOptionOrdersDeduped(params, signal);
    backendUnavailable = false;
    networkFailureCount = 0;
    return response;
  } catch (error: any) {
    if (classifyOrderHistoryError(error) === 'network') {
      backendUnavailable = true;
      networkFailureCount += 1;
      scheduleHealthProbe();
    }
    throw error;
  }
}

export function resetOrderHistoryPollingForTests() {
  inFlight.clear();
  backendUnavailable = false;
  networkFailureCount = 0;
  if (healthProbeTimer) {
    clearTimeout(healthProbeTimer);
    healthProbeTimer = null;
  }
}
