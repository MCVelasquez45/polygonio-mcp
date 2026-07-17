/**
 * Exit Intelligence (M5): the proximity/escalation logic and that Bot Thinking
 * renders the real hold-rationale checks from the shared cockpit mark.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { ExitIntelligencePanel } from '../components/cockpit/ExitIntelligencePanel';
import { BotThinkingPanel } from '../components/cockpit/BotThinkingPanel';
import type { CockpitTrade } from '../components/cockpit/cockpitUi';

const SYM = 'O:SPY260724C00600000';

const trade: CockpitTrade = {
  positionId: 'p1',
  underlying: 'SPY',
  optionSymbol: SYM,
  currentMark: 6.4,
  exitTriggers: [
    { key: 'STOP_LOSS', label: 'Stop Loss', kind: 'below', triggerPrice: 4.28, armed: true },
    { key: 'PROFIT_TARGET', label: 'Profit Target', kind: 'above', triggerPrice: 6.55, armed: true },
    { key: 'TRAILING', label: 'Trailing Stop', kind: 'trailing', triggerPrice: null, armed: false },
    { key: 'RISK', label: 'Risk Exit', kind: 'monitor', triggerPrice: null, armed: true },
  ],
  holdRationale: [
    { key: 'stop', label: 'Stop not hit', ok: true },
    { key: 'target', label: 'Profit target not reached', ok: true },
    { key: 'emergency', label: 'No emergency stop', ok: true },
  ],
};

describe('ExitIntelligencePanel', () => {
  it('renders each armed trigger with its label', () => {
    render(<ExitIntelligencePanel trade={trade} mark={6.4} />);
    expect(screen.getByText('Stop Loss')).toBeInTheDocument();
    expect(screen.getByText('Profit Target')).toBeInTheDocument();
    expect(screen.getByText('Trailing Stop')).toBeInTheDocument();
    expect(screen.getByText('OFF')).toBeInTheDocument();
    cleanup();
  });

  it('flags the profit target as APPROACHING as the mark nears it', () => {
    render(<ExitIntelligencePanel trade={trade} mark={6.5} />);
    expect(screen.getByText('APPROACHING')).toBeInTheDocument();
    cleanup();
  });
});

describe('BotThinkingPanel', () => {
  it('renders hold-rationale checks and a next-eval countdown', () => {
    const soon = new Date(Date.now() + 14000).toISOString();
    render(<BotThinkingPanel trade={trade} nextEvaluationAt={soon} mark={6.4} />);
    expect(screen.getByText('Stop not hit')).toBeInTheDocument();
    expect(screen.getByText('Profit target not reached')).toBeInTheDocument();
    expect(screen.getByText(/in \d+s/)).toBeInTheDocument();
    cleanup();
  });

  it('shows the exit-imminent banner when a trigger is approaching', () => {
    render(<BotThinkingPanel trade={trade} nextEvaluationAt={null} mark={6.5} />);
    expect(screen.getByText(/Exit condition approaching/)).toBeInTheDocument();
    cleanup();
  });

  it('normalizes emergency-stop rationale wording to match state', () => {
    render(
      <BotThinkingPanel
        trade={{
          ...trade,
          holdRationale: [{ key: 'emergency', label: 'No emergency stop', ok: false }],
        }}
        nextEvaluationAt={null}
        mark={6.4}
      />
    );
    expect(screen.getByText('Emergency stop active')).toBeInTheDocument();
    expect(screen.queryByText('No emergency stop')).not.toBeInTheDocument();
    cleanup();
  });
});
