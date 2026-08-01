import { useSyncExternalStore } from 'react';
import type { OptionLeg } from '../types/market';

// Shared workspace context bus — the single source of truth for "what the
// operator is currently focused on" across every workspace (Trade, Positions,
// Automation, Review, AI Desk).
//
// This deliberately mirrors liveMarketStore's useSyncExternalStore pattern:
// the hot state (which symbol/contract/position/trade is active) lives outside
// the React tree so a focus change re-renders only the panels that subscribe
// to that slice, never the whole application. App.tsx publishes into this bus
// from its existing selection handlers; downstream panels (chart, matrix,
// Greeks, risk, AI) read from it instead of receiving the same value threaded
// through a dozen props.
//
// It does NOT own market data (that stays in liveMarketStore) and it does NOT
// open sockets or fetch — it is pure focus state, so wiring a new consumer
// never creates a duplicate subscription or API client.

/** A selected open position, kept intentionally loose so the bus doesn't couple
 *  to any one portfolio DTO. Panels read the fields they need. */
export type ActivePosition = {
  id: string;
  underlying: string;
  optionSymbol?: string | null;
  /** Lifecycle owner — 'AUTOMATION' | 'MANUAL' | other; passthrough for display. */
  source?: string | null;
} & Record<string, unknown>;

/** A selected trade for the Review workspace (closed trade / lifecycle record). */
export type ActiveTrade = {
  id: string;
  underlying?: string | null;
} & Record<string, unknown>;

export type WorkspaceContext = {
  /** The active underlying symbol (normalized upper-case), or null. */
  activeSymbol: string | null;
  /** The active option contract, or null when only an underlying is selected. */
  activeContract: OptionLeg | null;
  /** The open position the operator is managing, or null. */
  activePosition: ActivePosition | null;
  /** The trade selected in the Review workspace, or null. */
  activeTrade: ActiveTrade | null;
  /** When true, selecting a position/trade also re-centers the chart underlying.
   *  When false, management never interrupts a symbol the operator is studying. */
  linkedMode: boolean;
};

type Listener = () => void;

const LINKED_MODE_KEY = 'workspace:linkedMode';

function readPersistedLinkedMode(): boolean {
  try {
    const raw = window.localStorage.getItem(LINKED_MODE_KEY);
    // Default ON — linked focus is the enterprise default; operators opt out.
    return raw == null ? true : raw === 'true';
  } catch {
    return true;
  }
}

let state: WorkspaceContext = {
  activeSymbol: null,
  activeContract: null,
  activePosition: null,
  activeTrade: null,
  linkedMode: readPersistedLinkedMode(),
};

const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Replace state with a new object only when something actually changed, so
 *  useSyncExternalStore consumers keep a stable reference and don't re-render
 *  on no-op publishes. */
function commit(next: Partial<WorkspaceContext>): void {
  let changed = false;
  const merged = { ...state };
  for (const key of Object.keys(next) as (keyof WorkspaceContext)[]) {
    if (next[key] !== undefined && merged[key] !== next[key]) {
      (merged[key] as unknown) = next[key];
      changed = true;
    }
  }
  if (!changed) return;
  state = merged;
  emit();
}

function normalizeSymbol(symbol: string | null): string | null {
  if (symbol == null) return null;
  const trimmed = symbol.trim().toUpperCase();
  return trimmed.length ? trimmed : null;
}

// ---- publishers (called by App.tsx selection handlers) ----------------------

/** Set the active underlying. Selecting a new underlying clears the active
 *  contract, matching operator expectation that the chain re-scopes. */
export function setActiveSymbol(symbol: string | null): void {
  const next = normalizeSymbol(symbol);
  if (next === state.activeSymbol) return;
  commit({ activeSymbol: next, activeContract: null });
}

/** Set (or clear) the active option contract. */
export function setActiveContract(contract: OptionLeg | null): void {
  commit({ activeContract: contract });
}

/** Set (or clear) the open position under management. */
export function setActivePosition(position: ActivePosition | null): void {
  commit({ activePosition: position });
}

/** Set (or clear) the trade selected for review. */
export function setActiveTrade(trade: ActiveTrade | null): void {
  commit({ activeTrade: trade });
}

/** Toggle or set Linked Mode; persisted locally so it survives reloads. */
export function setLinkedMode(next: boolean): void {
  if (next === state.linkedMode) return;
  try {
    window.localStorage.setItem(LINKED_MODE_KEY, String(next));
  } catch {
    /* non-fatal: persistence is best-effort */
  }
  commit({ linkedMode: next });
}

export function toggleLinkedMode(): void {
  setLinkedMode(!state.linkedMode);
}

// ---- readers ----------------------------------------------------------------

export function getWorkspaceContext(): WorkspaceContext {
  return state;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribe to the whole context. Prefer the narrower hooks below where a
 *  panel only cares about one slice. */
export function useWorkspaceContext(): WorkspaceContext {
  return useSyncExternalStore(subscribe, getWorkspaceContext, getWorkspaceContext);
}

export function useActiveSymbol(): string | null {
  return useSyncExternalStore(subscribe, () => state.activeSymbol, () => state.activeSymbol);
}

export function useActiveContract(): OptionLeg | null {
  return useSyncExternalStore(subscribe, () => state.activeContract, () => state.activeContract);
}

export function useActivePosition(): ActivePosition | null {
  return useSyncExternalStore(subscribe, () => state.activePosition, () => state.activePosition);
}

export function useActiveTrade(): ActiveTrade | null {
  return useSyncExternalStore(subscribe, () => state.activeTrade, () => state.activeTrade);
}

export function useLinkedMode(): boolean {
  return useSyncExternalStore(subscribe, () => state.linkedMode, () => state.linkedMode);
}

/** Test-only: reset the bus to a clean state. Not used in production code. */
export function __resetWorkspaceContextForTests(): void {
  state = {
    activeSymbol: null,
    activeContract: null,
    activePosition: null,
    activeTrade: null,
    linkedMode: true,
  };
  emit();
}
