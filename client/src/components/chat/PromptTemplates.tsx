import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { getAgentMeta } from './agentMeta';

export type PromptTemplate = {
  id: string;
  label: string;
  prompt: string;
  description?: string;
  /** When set, the server runs this AI agent with a full data package instead of a raw prompt. */
  agentId?: string;
};

type PromptTemplatesProps = {
  templates: PromptTemplate[];
  onSelect: (template: PromptTemplate) => void;
  disabled?: boolean;
  /** Compact renders a single horizontal scroll row (mobile chat). */
  compact?: boolean;
};

/**
 * Desk analyst launcher — one card per agent, carrying the agent's visual
 * identity. Touch targets are ≥48px; on desktop the grid tightens.
 */
export function PromptTemplates({ templates, onSelect, disabled = false, compact = false }: PromptTemplatesProps) {
  const [open, setOpen] = useState(!compact);
  if (!templates.length) return null;

  const cards = templates.map(template => {
    const meta = getAgentMeta(template.agentId);
    const Icon = meta.icon;
    return (
      <button
        key={template.id}
        type="button"
        disabled={disabled}
        onClick={() => onSelect(template)}
        title={template.description}
        className={`ai-glass-panel-soft ai-card-elevate ai-focus-ring flex items-center gap-2 rounded-panel text-left disabled:opacity-40 ${
          compact ? 'min-h-[48px] flex-none px-3' : 'min-h-[48px] px-2.5 py-1.5 md:min-h-[40px]'
        }`}
        style={{ borderColor: meta.line }}
      >
        <span
          className="flex h-7 w-7 flex-none items-center justify-center rounded-md"
          style={{ backgroundColor: meta.soft, color: meta.color }}
        >
          <Icon style={{ width: 15, height: 15 }} aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold text-intel-ink">{meta.shortLabel}</span>
          {!compact && <span className="hidden truncate text-[10px] text-intel-ink3 lg:block">{meta.label}</span>}
        </span>
      </button>
    );
  });

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="ai-focus-ring ai-section-title flex items-center gap-1 self-start rounded font-mono text-intel-ink3 transition duration-150 ease-out hover:text-intel-ink2"
        aria-expanded={open}
      >
        Desk analysts
        {open ? <ChevronDown className="h-3 w-3" aria-hidden="true" /> : <ChevronUp className="h-3 w-3" aria-hidden="true" />}
      </button>
      {open &&
        (compact ? (
          <div className="flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">{cards}</div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">{cards}</div>
        ))}
    </div>
  );
}
