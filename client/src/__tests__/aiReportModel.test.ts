import { describe, expect, it } from 'vitest';
import { agentIdFromText } from '../components/chat/agentMeta';
import { parseAgentReport } from '../components/chat/reportModel';

const FED_REPORT = `**Executive Summary**: Policy pressure is easing; the curve supports a long bias for SPY into the next CPI print.

**Policy Read**: Real rates are drifting lower while labor cools at the margin.

**Yield Curve**:
- 2s10s re-steepened to +18bp
- Front end pricing two cuts by year-end

**Inflation & Labor**: Core CPI 2.9% y/y and falling; payrolls decelerating without breaking.

**Macro Bias**: Bullish for SPY over the next two weeks.

**Risk Assessment**:
- Next CPI print running hot would unwind the steepener
- Refunding announcement supply shock

**Action Items**:
- Stay long; add on dips toward the 20-day EMA

**Confidence**: 84% — curve, inflation, and labor all point the same way.

**Sources Used**: treasury-yields, inflation, labor-market, news
**Sources Unavailable**: FOMC minutes, FedWatch odds`;

describe('parseAgentReport', () => {
  it('recognizes an orchestrator report and extracts the card fields', () => {
    const report = parseAgentReport(FED_REPORT);
    expect(report.isReport).toBe(true);
    expect(report.summary).toContain('Policy pressure is easing');
    expect(report.confidencePct).toBe(84);
    expect(report.stance).toBe('bullish');
    expect(report.primaryRisk).toContain('Next CPI');
    expect(report.action).toContain('Stay long');
    expect(report.sourcesUsed).toContain('treasury-yields');
    expect(report.sourcesUnavailable.join(' ')).toContain('FOMC');
  });

  it('keeps every section in order for the detail view', () => {
    const report = parseAgentReport(FED_REPORT);
    const headings = report.sections.map(section => section.heading);
    expect(headings[0]).toBe('Executive Summary');
    expect(headings).toContain('Yield Curve');
    const curve = report.sections.find(section => section.heading === 'Yield Curve');
    expect(curve?.bullets).toHaveLength(2);
  });

  it('maps qualitative confidence to a percentage', () => {
    const report = parseAgentReport(
      '**Executive Summary**: x\n**Risk Assessment**: y\n**Action Items**: z\n**Confidence**: High'
    );
    expect(report.confidencePct).toBe(80);
  });

  it('does not promote plain chat replies to report cards', () => {
    const report = parseAgentReport('Sure — SPY closed at 743.29, up 0.16% on the session.');
    expect(report.isReport).toBe(false);
  });
});

describe('agentIdFromText', () => {
  it('recovers the agent from the launching user message', () => {
    expect(agentIdFromText('Fed Intelligence report — SPY')).toBe('fed-intel');
    expect(agentIdFromText('Technical Analyst report — TSLA')).toBe('technical-analyst');
    expect(agentIdFromText('what is the vix?')).toBeNull();
  });
});
