import type { ReactNode } from 'react';

type RecordListProps<T> = {
  items: T[];
  getKey: (item: T) => string;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  renderItem: (item: T, selected: boolean) => ReactNode;
  /** Accessible name for the selector region. */
  label: string;
  /** Cap the DOM to this many rows (guards against unbounded lists). */
  max?: number;
};

/**
 * Accessible record selector for the list→detail sidebar pattern shared by
 * every intelligence page. Adds the `aria-current` + focus states the original
 * inline button lists lacked, and caps rendered rows.
 */
export function RecordList<T>({
  items,
  getKey,
  selectedKey,
  onSelect,
  renderItem,
  label,
  max = 50,
}: RecordListProps<T>) {
  const visible = items.slice(0, max);
  return (
    <ul className="flex max-h-[72vh] flex-col gap-2 overflow-auto pr-1" aria-label={label}>
      {visible.map(item => {
        const key = getKey(item);
        const selected = key === selectedKey;
        return (
          <li key={key}>
            <button
              type="button"
              onClick={() => onSelect(key)}
              aria-current={selected ? 'true' : undefined}
              className={`w-full rounded-lg border p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-intel-accent ${
                selected
                  ? 'border-intel-accentLine bg-intel-accentSoft'
                  : 'border-intel-line bg-intel-panel2 hover:border-intel-ink3'
              }`}
            >
              {renderItem(item, selected)}
            </button>
          </li>
        );
      })}
      {items.length > max && (
        <li className="px-1 py-2 font-mono text-[11px] text-intel-ink3">
          Showing {max} of {items.length}
        </li>
      )}
    </ul>
  );
}
