import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import { ALL_MODES, type AppView } from './navModes';

// Keyboard-first navigation (⌘K / Ctrl-K). Jump to any mode or load a symbol
// without touching the mouse — the primitive that separates a terminal from a
// dashboard. Purely presentational: it calls back into App's existing view and
// ticker handlers.

type Props = {
  open: boolean;
  onClose: () => void;
  onViewChange: (view: AppView) => void;
  onTickerSubmit: (ticker: string) => void;
};

type Command = { id: string; label: string; hint: string; run: () => void };

export function CommandPalette({ open, onClose, onViewChange, onTickerSubmit }: Props) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      // Focus after paint so the field is ready to type into immediately.
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const q = query.trim();
    const modeCommands: Command[] = ALL_MODES.map(m => ({
      id: `mode:${m.id}`,
      label: `Go to ${m.label}`,
      hint: m.hint,
      run: () => {
        onViewChange(m.id);
        onClose();
      },
    }));
    const symbol = q.toUpperCase().replace(/[^A-Z0-9.:]/g, '');
    const symbolCommand: Command[] =
      symbol.length >= 1 && /[A-Z]/.test(symbol)
        ? [
            {
              id: `symbol:${symbol}`,
              label: `Load symbol ${symbol}`,
              hint: 'Open in Terminal',
              run: () => {
                onViewChange('trading');
                onTickerSubmit(symbol);
                onClose();
              },
            },
          ]
        : [];
    const filtered = q
      ? modeCommands.filter(c => c.label.toLowerCase().includes(q.toLowerCase()))
      : modeCommands;
    return [...symbolCommand, ...filtered];
  }, [query, onViewChange, onTickerSubmit, onClose]);

  useEffect(() => {
    if (cursor >= commands.length) setCursor(0);
  }, [commands.length, cursor]);

  if (!open) return null;

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor(c => (c + 1) % Math.max(commands.length, 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor(c => (c - 1 + Math.max(commands.length, 1)) % Math.max(commands.length, 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      commands[cursor]?.run();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 px-4 pt-[12vh]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-panel border border-intel-line bg-intel-panel shadow-2xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-intel-line px-4 py-3">
          <Search className="h-4 w-4 text-intel-ink3" />
          <input
            ref={inputRef}
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a mode or load a symbol…"
            className="w-full bg-transparent text-sm text-intel-ink placeholder:text-intel-ink3 focus:outline-none"
            aria-label="Command or symbol"
          />
          <kbd className="rounded border border-intel-line bg-intel-panel2 px-1.5 py-0.5 font-mono text-[10px] text-intel-ink3">
            ESC
          </kbd>
        </div>
        <ul className="max-h-[52vh] overflow-y-auto py-1">
          {commands.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-intel-ink3">No matches</li>
          ) : (
            commands.map((command, index) => (
              <li key={command.id}>
                <button
                  type="button"
                  onClick={command.run}
                  onMouseEnter={() => setCursor(index)}
                  className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left ${
                    index === cursor ? 'bg-intel-accentSoft' : ''
                  }`}
                >
                  <span className="flex flex-col">
                    <span className={`text-sm ${index === cursor ? 'text-intel-accent' : 'text-intel-ink'}`}>
                      {command.label}
                    </span>
                    <span className="text-[11px] text-intel-ink3">{command.hint}</span>
                  </span>
                  {index === cursor ? <CornerDownLeft className="h-3.5 w-3.5 text-intel-accent" /> : null}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
