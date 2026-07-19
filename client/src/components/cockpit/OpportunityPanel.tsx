import { fmtNumber, fmtPercent, finiteOrNull } from '../../lib/marketFormat';
import { Panel, Stat, Pill, type CockpitTrade, type OpportunityCandidate } from './cockpitUi';
import { contractLabel } from './occSymbol';
import { greekOrReason, moneyOrReason, numberOrReason, percentOrReason } from './cockpitDisplay';

function ConfidencePct({ value }: { value: number | null }) {
  // Options-flow score is 0..1; render as a percent "confidence".
  if (value === null) return <>Confidence not captured</>;
  return <>{fmtPercent(value <= 1 ? value * 100 : value)}</>;
}

function CandidateRow({ c }: { c: OpportunityCandidate }) {
  const reasons = (c.rejectionReasons ?? []).map((reason) => reason.replaceAll('_', ' ').toLowerCase());
  const verdict = c.selected ? 'winner' : c.passed ? 'passed' : reasons.length ? reasons.join(', ') : 'rejected';
  return (
    <tr className="border-t border-intel-lineSoft">
      <td className="py-1">
        <span className="flex items-center gap-2">
          {c.selected ? <Pill tone="good">SELECTED</Pill> : <span className="w-1" />}
          <span className={c.selected ? 'text-intel-ink' : 'text-intel-ink2'}>{contractLabel(c.symbol)}</span>
        </span>
      </td>
      <td className="py-1 text-right tabular-nums text-intel-ink2">{c.score === null ? 'Not captured' : c.score.toFixed(2)}</td>
      <td className="py-1 text-right tabular-nums text-intel-ink2">{greekOrReason(c.delta, 'Not captured')}</td>
      <td className="py-1 text-right tabular-nums text-intel-ink2">{numberOrReason(c.openInterest, 'Not captured')}</td>
      <td className="py-1 text-right tabular-nums text-intel-ink2">{percentOrReason(c.spreadPct, 'Not captured')}</td>
      <td className="py-1 pl-2 text-[11px] text-intel-ink3">
        {verdict}
      </td>
    </tr>
  );
}

/**
 * Opportunity - the entry thesis, preserved immutably from the moment the bot
 * chose this trade: signal confidence, the winning contract's score, and how it
 * beat the other candidates (with the reason each runner-up was rejected).
 */
export function OpportunityPanel({ trade }: { trade: CockpitTrade }) {
  const opp = trade.opportunity;
  const hasAttribution = Boolean(
    opp &&
      (opp.strategy ||
        opp.direction ||
        opp.signalConfidence !== null ||
        opp.selectedContractSymbol ||
        opp.selectedContractScore !== null ||
        opp.consideredCount !== null ||
        opp.passedCount !== null ||
        opp.noSelectionReason ||
        opp.candidates.length)
  );
  if (!opp || !hasAttribution) {
    return (
      <Panel title="Opportunity: why this trade exists">
        <p className="text-xs text-intel-ink3">No contract attribution is available for this position.</p>
      </Panel>
    );
  }
  const beaten = Math.max(0, (finiteOrNull(opp.consideredCount) ?? 0) - 1);
  const selectedContract = opp.selectedContractSymbol ?? trade.optionSymbol ?? null;
  const directionTone = opp.direction === 'BULLISH' ? 'good' : opp.direction === 'BEARISH' ? 'bad' : 'neutral';
  const hasFlow =
    finiteOrNull(opp.flow.netPremiumTilt) !== null ||
    finiteOrNull(opp.flow.volumeRatio) !== null ||
    finiteOrNull(opp.flow.callPremium) !== null ||
    finiteOrNull(opp.flow.putPremium) !== null ||
    finiteOrNull(opp.flow.ivSkew) !== null;
  return (
    <Panel title="Opportunity: why this trade exists">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(220px,0.6fr)]">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-intel-ink3">Selected contract</div>
          <div className="mt-1 text-base font-semibold text-intel-ink">
            {selectedContract ? contractLabel(selectedContract) : 'Selection not captured'}
          </div>
          <div className="mt-1 truncate text-[11px] text-intel-ink3" title={selectedContract ?? undefined}>
            {selectedContract ?? 'Selected contract symbol not captured'}
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-2 md:justify-end">
          {opp.direction ? <Pill tone={directionTone}>{opp.direction}</Pill> : null}
          {opp.noSelectionReason ? <Pill tone="warn">{opp.noSelectionReason}</Pill> : null}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {opp.signalConfidence !== null ? <Stat label="Signal confidence" value={<ConfidencePct value={opp.signalConfidence} />} /> : null}
        {opp.selectedContractScore !== null ? <Stat label="Contract score" value={opp.selectedContractScore.toFixed(2)} /> : null}
        {opp.strategy ? <Stat label="Strategy" value={opp.strategy} size="sm" /> : null}
        {opp.consideredCount !== null ? (
          <Stat
            label="Considered"
            value={fmtNumber(opp.consideredCount)}
            sub={opp.passedCount !== null ? `${fmtNumber(opp.passedCount)} passed` : 'Passed count not captured'}
          />
        ) : null}
      </div>

      {hasFlow ? (
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-intel-line pt-3 sm:grid-cols-5">
          {opp.flow.netPremiumTilt !== null ? <Stat label="Flow tilt" value={numberOrReason(opp.flow.netPremiumTilt, 'Not captured', 2)} /> : null}
          {opp.flow.volumeRatio !== null ? <Stat label="Volume ratio" value={`${fmtNumber(opp.flow.volumeRatio, 2)}x`} /> : null}
          {opp.flow.callPremium !== null ? <Stat label="Call premium" value={moneyOrReason(opp.flow.callPremium, 'Not captured', 0)} /> : null}
          {opp.flow.putPremium !== null ? <Stat label="Put premium" value={moneyOrReason(opp.flow.putPremium, 'Not captured', 0)} /> : null}
          {opp.flow.ivSkew !== null ? <Stat label="IV skew" value={numberOrReason(opp.flow.ivSkew, 'Not captured', 2)} /> : null}
        </div>
      ) : (
        <p className="mt-3 border-t border-intel-line pt-3 text-xs text-intel-ink3">
          Flow metrics were not captured with this contract selection.
        </p>
      )}

      {opp.candidates.length ? (
        <div className="mt-3 border-t border-intel-line pt-3">
          <p className="mb-1 text-[11px] uppercase tracking-widest text-intel-ink3">
            Contract beat {beaten} other{beaten === 1 ? '' : 's'}
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-[680px] w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest text-intel-ink3">
                  <th className="py-1 text-left font-normal">Contract</th>
                  <th className="py-1 text-right font-normal">Score</th>
                  <th className="py-1 text-right font-normal">Delta</th>
                  <th className="py-1 text-right font-normal">OI</th>
                  <th className="py-1 text-right font-normal">Spread</th>
                  <th className="py-1 pl-2 text-left font-normal">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {opp.candidates.map((c) => (
                  <CandidateRow key={c.symbol} c={c} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}
