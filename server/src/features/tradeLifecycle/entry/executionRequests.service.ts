import { submitApprovedIntent } from '../../automation/services/orderSubmission.service';
import { submitExit } from '../../automation/services/positionManager.service';
import type { PaperBrokerAdapter } from '../../automation/services/brokerAdapter';
import type { AutomationPositionDocument, ExitReason } from '../../automation/models/automationPosition.model';
import type { MarketSessionState } from '../../automation/services/marketSession.service';
import { getTradeLifecycleFlags } from '../types/config';

export async function requestLifecycleEntry(input: {
  intentId: string;
  adapter: PaperBrokerAdapter;
  ownsLease: boolean;
  marketSession: MarketSessionState;
}) {
  const flags = getTradeLifecycleFlags();
  if (!flags.AUTONOMOUS_ENTRY_ENABLED) {
    return { submitted: false, refusedReason: 'AUTONOMOUS_ENTRY_ENABLED=false' };
  }
  return submitApprovedIntent(input.intentId, input.adapter, {
    ownsLease: input.ownsLease,
    marketSession: input.marketSession,
  });
}

export async function requestLifecycleExit(input: {
  position: AutomationPositionDocument;
  adapter: PaperBrokerAdapter;
  reason: ExitReason;
  now?: Date;
}) {
  const flags = getTradeLifecycleFlags();
  if (!flags.AUTONOMOUS_EXIT_ENABLED) {
    return { submitted: false, refusedReason: 'AUTONOMOUS_EXIT_ENABLED=false' };
  }
  const intent = await submitExit(input.position, input.adapter, input.reason, input.now ?? new Date());
  return { submitted: Boolean(intent), intent };
}
