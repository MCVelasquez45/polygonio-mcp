import { useCallback, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Share2 } from 'lucide-react';
import type { AgentMeta } from './agentMeta';
import type { AgentReport } from './reportModel';

export type ReportSaveState = { state: 'idle' | 'saving' | 'saved' | 'error'; message?: string };

type AiReportCardProps = {
  meta: AgentMeta;
  report: AgentReport;
  /** Raw reply text — used for Share and as the Level-3 full report body. */
  rawContent: string;
  ticker?: string;
  generatedAt?: number;
  saveState?: ReportSaveState;
  onSave: () => void;
};

const STANCE_STYLES: Record<NonNullable<AgentReport['stance']>, string> = {
  bullish: 'bg-intel-pos/10 text-intel-pos',
  bearish: 'bg-intel-neg/10 text-intel-neg',
  neutral: 'bg-intel-panel2 text-intel-ink2',
};

// Sections already surfaced on the Level-1 card; the detail view skips them so
// expanding never repeats what the trader has read.
const CARD_LEVEL_HEADINGS = new Set(['executive summary', 'summary', 'confidence', 'sources used', 'sources unavailable']);

const LONG_PRESS_MS = 550;

/**
 * Progressive-disclosure report card. Level 1: verdict-first summary
 * (stance, confidence, risk, action). Level 2: full sectioned analysis.
 * Level 3: sources + raw report. Tap header to expand, double-tap to
 * collapse, long-press to save.
 */
export function AiReportCard({ meta, report, rawContent, ticker, generatedAt, saveState, onSave }: AiReportCardProps) {
  const [level, setLevel] = useState<1 | 2 | 3>(1);
  const [shared, setShared] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const Icon = meta.icon;
  const saving = saveState?.state === 'saving';

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleTouchStart = useCallback(() => {
    longPressFired.current = false;
    cancelLongPress();
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      onSave();
    }, LONG_PRESS_MS);
  }, [cancelLongPress, onSave]);

  const handleShare = useCallback(async () => {
    const title = `${meta.label}${ticker ? ` — ${ticker}` : ''}`;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title, text: rawContent });
      } else {
        await navigator.clipboard.writeText(`${title}\n\n${rawContent}`);
      }
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch {
      /* user cancelled the share sheet */
    }
  }, [meta.label, rawContent, ticker]);

  const detailSections = report.sections.filter(section => !CARD_LEVEL_HEADINGS.has(section.heading.toLowerCase()));
  const lastUpdate = generatedAt
    ? new Date(generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'Now';
  const confidenceLabel = report.confidencePct != null ? `${report.confidencePct}%` : 'N/A';

  return (
    <article
      className="ai-glass-panel ai-card-elevate overflow-hidden rounded-panel"
      style={{ borderColor: meta.line }}
      onTouchStart={handleTouchStart}
      onTouchEnd={cancelLongPress}
      onTouchMove={cancelLongPress}
      onDoubleClick={() => setLevel(1)}
      aria-label={`${meta.label} report`}
    >
      {/* ── Header: identity + verdict, always visible ── */}
      <button
        type="button"
        onClick={() => {
          if (longPressFired.current) return;
          setLevel(prev => (prev === 1 ? 2 : 1));
        }}
        className="ai-focus-ring flex w-full items-center gap-3 px-3 py-3 text-left min-h-[56px] transition duration-150 ease-out hover:bg-white/[0.035]"
        style={{ backgroundColor: meta.soft }}
        aria-expanded={level > 1}
      >
        <span
          className="flex h-8 w-8 flex-none items-center justify-center rounded-md"
          style={{ backgroundColor: meta.soft, color: meta.color }}
        >
          <Icon className="h-4.5 w-4.5" aria-hidden="true" style={{ width: 18, height: 18 }} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold leading-tight text-intel-ink">
            {meta.label}
            {ticker ? <span className="ml-2 font-mono text-xs text-intel-ink2">{ticker}</span> : null}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            {report.stance && (
              <span className={`rounded px-1.5 py-[1px] font-mono text-[10px] font-semibold uppercase tracking-label ${STANCE_STYLES[report.stance]}`}>
                {report.stance}
              </span>
            )}
            {report.confidencePct != null && (
              <span className="flex items-center gap-1.5">
                <span className="h-1 w-14 overflow-hidden rounded-full bg-intel-panel2" aria-hidden="true">
                  <span className="block h-full rounded-full" style={{ width: `${report.confidencePct}%`, backgroundColor: meta.color }} />
                </span>
                <span className="font-mono text-[10px] text-intel-ink2">{report.confidencePct}%</span>
              </span>
            )}
            <span className="ai-metadata font-mono uppercase tracking-label">Live Analysis</span>
          </span>
        </span>
        {level === 1 ? (
          <ChevronDown className="h-4 w-4 flex-none text-intel-ink3" aria-hidden="true" />
        ) : (
          <ChevronUp className="h-4 w-4 flex-none text-intel-ink3" aria-hidden="true" />
        )}
      </button>

      <div className="grid grid-cols-3 gap-px border-y border-white/[0.055] bg-white/[0.035]">
        <div className="bg-black/[0.12] px-3 py-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-label text-intel-ink3">Status</p>
          <p className="mt-0.5 truncate text-[11px] text-intel-pos">Current</p>
        </div>
        <div className="bg-black/[0.12] px-3 py-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-label text-intel-ink3">Confidence</p>
          <p className="mt-0.5 font-mono text-[11px] tabular-nums text-intel-ink2">{confidenceLabel}</p>
        </div>
        <div className="bg-black/[0.12] px-3 py-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-label text-intel-ink3">Last Update</p>
          <p className="mt-0.5 font-mono text-[11px] tabular-nums text-intel-ink2">{lastUpdate}</p>
        </div>
      </div>

      {/* ── Level 1: the decision surface ── */}
      <div className="space-y-3 px-3 py-3">
        {report.summary && <p className="text-sm leading-relaxed text-intel-ink">{report.summary}</p>}

        {report.primaryRisk && (
          <p className="flex items-start gap-1.5 text-[12px] leading-snug text-intel-ink2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none text-intel-warn" aria-hidden="true" />
            <span>
              <span className="font-mono text-[10px] font-semibold uppercase tracking-label text-intel-warn">Risk </span>
              {report.primaryRisk}
            </span>
          </p>
        )}
        {report.action && (
          <p className="ai-glass-panel-soft rounded-md px-2.5 py-2 text-[12px] leading-snug text-intel-ink shadow-none">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-label" style={{ color: meta.color }}>
              Action{' '}
            </span>
            {report.action}
          </p>
        )}

        {/* ── Level 2: full sectioned analysis ── */}
        {level >= 2 && (
          <div className="space-y-2 border-t border-white/[0.055] pt-3">
            {report.preamble.length > 0 && (
              <p className="text-[12px] leading-relaxed text-intel-ink2">{report.preamble.join(' ')}</p>
            )}
            {detailSections.map((section, index) => (
              <section key={`${section.heading}-${index}`} className="ai-glass-panel-soft rounded-md px-2.5 py-2 shadow-none">
                <h4 className="ai-section-title font-mono text-[11px]" style={{ color: meta.color }}>
                  {section.heading}
                </h4>
                {section.body.map((line, i) => (
                  <p key={`b-${i}`} className="mt-1 text-[12px] leading-relaxed text-intel-ink2">
                    {line}
                  </p>
                ))}
                {section.bullets.length > 0 && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] leading-relaxed text-intel-ink2">
                    {section.bullets.map((item, i) => (
                      <li key={`li-${i}`}>{item}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}

        {/* ── Level 3: sources ── */}
        {level >= 3 && (report.sourcesUsed.length > 0 || report.sourcesUnavailable.length > 0) && (
          <div className="space-y-1.5 border-t border-white/[0.055] pt-3">
            {report.sourcesUsed.length > 0 && (
              <p className="text-[11px] leading-relaxed text-intel-ink3">
                <span className="font-mono text-[9px] font-semibold uppercase tracking-label text-intel-pos">Sources </span>
                {report.sourcesUsed.join(' · ')}
              </p>
            )}
            {report.sourcesUnavailable.length > 0 && (
              <p className="text-[11px] leading-relaxed text-intel-ink3">
                <span className="font-mono text-[9px] font-semibold uppercase tracking-label text-intel-ink3">Unavailable </span>
                {report.sourcesUnavailable.join(' · ')}
              </p>
            )}
          </div>
        )}

        {/* ── Actions ── */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => setLevel(prev => (prev === 1 ? 2 : prev === 2 ? 3 : 1))}
            className="ai-glass-button ai-focus-ring rounded-md px-3 text-xs font-semibold"
            style={{ borderColor: meta.line, color: meta.color }}
          >
            {level === 1 ? 'View Full Analysis' : level === 2 ? 'Sources & Full Report' : 'Collapse'}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="ai-glass-button ai-focus-ring rounded-md px-3 text-xs font-semibold text-intel-ink2 hover:text-intel-ink disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save Report'}
          </button>
          <button
            type="button"
            onClick={handleShare}
            aria-label="Share report"
            className="ai-glass-button ai-focus-ring flex min-w-[40px] items-center justify-center rounded-md px-2 text-intel-ink2 hover:text-intel-ink"
          >
            <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          {shared && <span className="text-[11px] text-intel-pos">Copied</span>}
          {saveState?.state === 'saved' && saveState.message && (
            <span className="truncate text-[11px] text-intel-accent">Saved: {saveState.message}</span>
          )}
          {saveState?.state === 'error' && saveState.message && (
            <span className="truncate text-[11px] text-intel-neg">{saveState.message}</span>
          )}
        </div>
      </div>
    </article>
  );
}
