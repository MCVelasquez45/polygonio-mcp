import { EMPTY } from '../../../lib/intelligenceFormat';

export type InsightKind = 'strength' | 'weakness' | 'suggestion';

const KIND_STYLE: Record<InsightKind, { icon: string; cls: string }> = {
  strength: { icon: '+', cls: 'text-intel-pos' },
  weakness: { icon: '!', cls: 'text-intel-warn' },
  suggestion: { icon: '→', cls: 'text-intel-info' },
};

/** Renders the lessons layer (strengths / weaknesses / suggestions) as scannable insight lines. */
export function InsightList({ items, kind, emptyNoun }: { items: string[]; kind: InsightKind; emptyNoun: string }) {
  if (!items.length) {
    return <p className="text-sm text-intel-ink2">{EMPTY.panel(emptyNoun)}</p>;
  }
  const style = KIND_STYLE[kind];
  return (
    <ul className="flex flex-col">
      {items.map((item, i) => (
        <li
          key={`${item}-${i}`}
          className="flex gap-2.5 border-t border-intel-lineSoft py-2 text-sm text-intel-ink first:border-t-0"
        >
          <span className={`flex-none font-mono font-bold ${style.cls}`} aria-hidden="true">{style.icon}</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
