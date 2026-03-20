type FocusState = {
  symbol: string;
  timeframe: string;
  sessionMode: 'regular' | 'extended';
};

const socketFocus = new Map<string, FocusState>();
const focusSockets = new Map<string, Set<string>>();
const symbolFocusKeys = new Map<string, Set<string>>();

export function getFocusKey(focus: FocusState): string {
  return `${focus.symbol}:${focus.timeframe}`;
}

export function getFocusForSocket(socketId: string): FocusState | null {
  return socketFocus.get(socketId) ?? null;
}

export function setFocus(socketId: string, focus: FocusState): { previous: FocusState | null; key: string } {
  const previous = socketFocus.get(socketId) ?? null;
  socketFocus.set(socketId, focus);
  const key = getFocusKey(focus);
  const sockets = focusSockets.get(key) ?? new Set<string>();
  sockets.add(socketId);
  focusSockets.set(key, sockets);

  const symbolKeys = symbolFocusKeys.get(focus.symbol) ?? new Set<string>();
  symbolKeys.add(key);
  symbolFocusKeys.set(focus.symbol, symbolKeys);

  if (previous) {
    removeSocketFromFocus(socketId, previous);
  }

  return { previous, key };
}

export function clearFocus(socketId: string): FocusState | null {
  const previous = socketFocus.get(socketId) ?? null;
  if (previous) {
    removeSocketFromFocus(socketId, previous);
  }
  socketFocus.delete(socketId);
  return previous;
}

export function getSocketsForKey(key: string): Set<string> {
  return focusSockets.get(key) ?? new Set<string>();
}

export function getFocusKeysForSymbol(symbol: string): Set<string> {
  return symbolFocusKeys.get(symbol) ?? new Set<string>();
}

export function getFocusForSocketId(socketId: string): FocusState | null {
  return socketFocus.get(socketId) ?? null;
}

function removeSocketFromFocus(socketId: string, focus: FocusState) {
  const key = getFocusKey(focus);
  const sockets = focusSockets.get(key);
  if (sockets) {
    sockets.delete(socketId);
    if (sockets.size === 0) {
      focusSockets.delete(key);
      const symbolKeys = symbolFocusKeys.get(focus.symbol);
      if (symbolKeys) {
        symbolKeys.delete(key);
        if (symbolKeys.size === 0) {
          symbolFocusKeys.delete(focus.symbol);
        } else {
          symbolFocusKeys.set(focus.symbol, symbolKeys);
        }
      }
    } else {
      focusSockets.set(key, sockets);
    }
  }
}
