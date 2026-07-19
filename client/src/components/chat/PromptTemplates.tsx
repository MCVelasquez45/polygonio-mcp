export type PromptTemplate = {
  id: string;
  label: string;
  prompt: string;
  description?: string;
};

type PromptTemplatesProps = {
  templates: PromptTemplate[];
  onSelect: (prompt: string) => void;
  disabled?: boolean;
};

export function PromptTemplates({ templates, onSelect, disabled = false }: PromptTemplatesProps) {
  if (!templates.length) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-[9px] font-semibold uppercase tracking-label text-intel-ink3">Quick prompts</p>
      <div className="flex flex-wrap gap-1.5">
        {templates.map(template => (
          <button
            key={template.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(template.prompt)}
            className="rounded-md border border-intel-line bg-intel-panel px-2 py-0.5 font-mono text-[10px] font-semibold text-intel-ink2 hover:border-intel-accentLine hover:text-intel-ink disabled:opacity-40"
            title={template.description}
          >
            {template.label}
          </button>
        ))}
      </div>
    </div>
  );
}
