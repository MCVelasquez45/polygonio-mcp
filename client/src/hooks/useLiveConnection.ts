import { useEffect, useState } from 'react';
import { getSharedSocket } from '../lib/socket';
import { getLastQuoteAt } from '../lib/liveMarketStore';
import { MARKET_DATA_PROVIDER } from '../lib/marketDataStatus';

// One deterministic view of the shared live-feed connection for the whole app.
//
// Every panel that needs to know "is the stream up?" reads this instead of
// wiring its own connect/disconnect listeners onto the shared socket. The phase
// distinguishes a first connection attempt from an active reconnect so the UI
// can say CONNECTING vs RECONNECTING honestly, and DISCONNECTED only when the
// socket has genuinely given up or dropped.

export type LiveConnectionPhase =
  | 'connected'
  | 'connecting'
  | 'reconnecting'
  | 'disconnected';

export type LiveConnection = {
  /** True only while the socket transport is actually connected. */
  connected: boolean;
  phase: LiveConnectionPhase;
  /** Canonical market-data provider name. */
  provider: string;
  /** Wall-clock ms of the last live quote/trade delivered, or null. */
  lastQuoteAt: number | null;
};

export function useLiveConnection(): LiveConnection {
  const [phase, setPhase] = useState<LiveConnectionPhase>(() =>
    getSharedSocket().connected ? 'connected' : 'connecting'
  );

  useEffect(() => {
    const socket = getSharedSocket();
    // The reconnection lifecycle lives on the manager (`socket.io`). It is absent
    // in some test doubles, so guard it — the connect/disconnect transitions on
    // the socket itself are enough for a correct connected/disconnected view.
    const manager = socket.io;

    const onConnect = () => setPhase('connected');
    const onDisconnect = () => setPhase('disconnected');
    // An attempt after a drop means we are actively reconnecting (retained
    // values are STALE), not freshly connecting.
    const onReconnectAttempt = () => setPhase('reconnecting');
    const onReconnectError = () => setPhase('reconnecting');
    const onReconnectFailed = () => setPhase('disconnected');

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    manager?.on?.('reconnect_attempt', onReconnectAttempt);
    manager?.on?.('reconnect_error', onReconnectError);
    manager?.on?.('reconnect_failed', onReconnectFailed);

    setPhase(socket.connected ? 'connected' : 'connecting');

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      manager?.off?.('reconnect_attempt', onReconnectAttempt);
      manager?.off?.('reconnect_error', onReconnectError);
      manager?.off?.('reconnect_failed', onReconnectFailed);
    };
  }, []);

  return {
    connected: phase === 'connected',
    phase,
    provider: MARKET_DATA_PROVIDER,
    lastQuoteAt: getLastQuoteAt(),
  };
}
