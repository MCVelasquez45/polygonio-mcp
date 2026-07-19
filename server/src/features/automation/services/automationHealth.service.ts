import mongoose from 'mongoose';
import { getMarketStatusSnapshot } from '../../market/services/marketStatus';
import type { AutomationHealth, GateStatus } from '../automation.types';
import { assertPaperConfiguration } from './alpacaPaperBrokerAdapter.service';
import type { PaperBrokerAdapter } from './brokerAdapter';
import { getMarketClockDecision } from './marketClock.service';
import { getLastReconciliation } from './reconciliation.service';
import { getAutomationRuntime, isAutomationReady } from './sessionRecovery.service';

// Composite health with separately-reported gates. `automationReady` is the
// AND of the mandatory gates — it can never be true while any of MongoDB,
// broker API, broker mode, market clock, or reconciliation is failing.
// Massive market data is a supporting signal: degraded does not block
// readiness, but it is always reported.

function gate(status: GateStatus, detail: string) {
  return { status, detail };
}

export async function getAutomationHealth(adapterOverride?: PaperBrokerAdapter): Promise<AutomationHealth> {
  const runtime = getAutomationRuntime();
  const adapter = adapterOverride ?? runtime.adapter;

  // Gate 1: MongoDB.
  const mongoUp = mongoose.connection?.readyState === 1;
  const mongodb = gate(mongoUp ? 'pass' : 'fail', mongoUp ? 'connected' : 'disconnected (fail-closed)');

  // Gate 2+3: broker API reachability + broker mode.
  let brokerApi = gate('fail', 'no broker adapter (automation not initialized)');
  let brokerMode: AutomationHealth['gates']['brokerMode'] = {
    ...gate('fail', 'no broker adapter'),
    mode: 'none',
  };
  if (adapter) {
    const description = adapter.describe();
    try {
      if (description.mode === 'alpaca-paper') {
        assertPaperConfiguration();
      }
      brokerMode = {
        ...gate(description.paper ? 'pass' : 'fail', `mode=${description.mode} paper=${description.paper}`),
        mode: description.mode,
      };
    } catch (error) {
      brokerMode = {
        ...gate('fail', (error as Error)?.message?.slice(0, 200) ?? 'live configuration rejected'),
        mode: description.mode,
      };
    }
    try {
      const account = await adapter.getAccount();
      brokerApi = gate('pass', `account ${account.accountIdMasked} reachable (paper=${account.isPaper})`);
    } catch (error) {
      brokerApi = gate('fail', `broker unreachable: ${(error as Error)?.message?.slice(0, 200)}`);
    }
  }

  // Gate 4: market clock (UNKNOWN fails the gate — unknown is never safe).
  let marketClock: AutomationHealth['gates']['marketClock'] = {
    ...gate('fail', 'no broker adapter for clock'),
    state: 'UNKNOWN',
  };
  if (adapter) {
    try {
      const decision = await getMarketClockDecision(adapter);
      marketClock = {
        ...gate(
          decision.state === 'UNKNOWN' ? 'fail' : 'pass',
          `state=${decision.state} canEnter=${decision.canEnter}${
            decision.reasons.length ? ` (${decision.reasons.join('; ')})` : ''
          }`
        ),
        state: decision.state,
      };
    } catch (error) {
      marketClock = {
        ...gate('fail', `clock decision failed: ${(error as Error)?.message?.slice(0, 200)}`),
        state: 'UNKNOWN',
      };
    }
  }

  // Supporting: Massive market data (degraded ≠ blocking).
  let massiveMarketData = gate('degraded', 'unknown');
  try {
    const snapshot = await getMarketStatusSnapshot();
    massiveMarketData =
      snapshot.market === 'unknown'
        ? gate('degraded', "massive reports 'unknown' (silent fallback) — supporting data only")
        : gate('pass', `market=${snapshot.market}`);
  } catch (error) {
    massiveMarketData = gate('degraded', `massive unavailable: ${(error as Error)?.message?.slice(0, 200)}`);
  }

  // Gate 5: reconciliation must have completed (mismatches are handled state).
  const lastRecon = getLastReconciliation();
  const reconciliation: AutomationHealth['gates']['reconciliation'] = {
    ...(!lastRecon
      ? gate('fail', 'startup reconciliation has not run')
      : lastRecon.status === 'FAILED'
        ? gate('fail', `reconciliation FAILED: ${lastRecon.error ?? 'unknown error'}`)
        : lastRecon.mismatches.length
          ? gate(
              'degraded',
              `completed with ${lastRecon.mismatches.length} mismatch(es); ${lastRecon.pausedSessionIds.length} session(s) paused`
            )
          : gate('pass', 'clean')),
    lastRunAt: lastRecon ? lastRecon.finishedAt.toISOString() : null,
  };

  const mandatoryPass =
    mongodb.status === 'pass' &&
    brokerApi.status === 'pass' &&
    brokerMode.status === 'pass' &&
    marketClock.status === 'pass' &&
    reconciliation.status !== 'fail';

  return {
    timestamp: new Date().toISOString(),
    automationReady: mandatoryPass && isAutomationReady(),
    gates: { mongodb, brokerApi, brokerMode, marketClock, massiveMarketData, reconciliation },
  };
}
