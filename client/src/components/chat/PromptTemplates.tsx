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
      <p className="text-[0.6rem] uppercase tracking-[0.4em] text-gray-500">Quick prompts</p>
      <div className="flex flex-wrap gap-2">
        {templates.map(template => (
          <button
            key={template.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(template.prompt)}
            className="rounded-full border border-gray-800/80 bg-gray-950/70 px-3 py-1 text-[0.7rem] font-semibold text-gray-300 hover:text-white disabled:opacity-40"
            title={template.description}
          >
            {template.label}
          </button>
        ))}
      </div>
    </div>
  );
}
