import {
  fetchReferenceContracts,
  normalizeReferenceContract,
  REQUEST_PRIORITY,
  type RequestPriority,
} from '../../shared/data/massive';

// Reference (static) option-contract definitions: strike, expiration, type,
// exercise style. These do not change over a contract's life, so they are
// cached for hours and NEVER re-fetched as part of a quote/snapshot refresh.
// Cached by underlying + expiration window (+type) — the orchestrator's unit
// of work.

export const REFERENCE_CACHE_TTL_MS = Math.max(
  60_000,
  Number(process.env.OPTIONS_REFERENCE_CACHE_TTL_MS ?? 6 * 60 * 60 * 1000)
);

type ReferenceEntry = {
  cachedAt: number;
  contracts: any[];
  pagesFetched: number;
  exhausted: boolean;
  nextCursor: string | null;
};

const cache = new Map<string, ReferenceEntry>();

function keyOf(args: {
  underlying: string;
  expirationGte?: string;
  expirationLte?: string;
  contractType?: 'call' | 'put';
}): string {
  return [
    args.underlying.toUpperCase(),
    args.expirationGte ?? '',
    args.expirationLte ?? '',
    args.contractType ?? 'both',
  ].join('|');
}

export async function getReferenceContracts(args: {
  underlying: string;
  expirationGte?: string;
  expirationLte?: string;
  contractType?: 'call' | 'put';
  maxPages?: number;
  priority?: RequestPriority;
}): Promise<ReferenceEntry & { fromCache: boolean }> {
  const key = keyOf(args);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.cachedAt < REFERENCE_CACHE_TTL_MS) {
    return { ...cached, fromCache: true };
  }

  const underlying = args.underlying.toUpperCase();
  const params: Record<string, any> = {
    underlying_ticker: underlying,
    limit: 1000,
    order: 'asc',
    sort: 'ticker',
    expired: false,
  };
  if (args.expirationGte) params['expiration_date.gte'] = args.expirationGte;
  if (args.expirationLte) params['expiration_date.lte'] = args.expirationLte;
  if (args.contractType) params.contract_type = args.contractType;

  const { results, pagesFetched, exhausted, nextCursor } = await fetchReferenceContracts(params, {
    maxPages: args.maxPages ?? 10,
    cacheTtlMs: REFERENCE_CACHE_TTL_MS,
    priority: args.priority ?? REQUEST_PRIORITY.BACKGROUND,
  });

  const normalized = results
    .map((contract: any) => normalizeReferenceContract(contract, underlying))
    .filter(Boolean);

  const entry: ReferenceEntry = {
    cachedAt: Date.now(),
    contracts: normalized,
    pagesFetched,
    exhausted,
    nextCursor,
  };
  cache.set(key, entry);
  return { ...entry, fromCache: false };
}

export function referenceCacheAgeMs(): number | null {
  let newest: number | null = null;
  for (const entry of cache.values()) {
    const age = Date.now() - entry.cachedAt;
    if (newest == null || age < newest) newest = age;
  }
  return newest;
}

export function clearReferenceCache(): void {
  cache.clear();
}
