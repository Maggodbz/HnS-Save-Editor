// Searchable single-select (keyboard friendly). Used for species, moves and items.
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';

export interface Option {
  value: number;
  label: string;
  hint?: string;
  icon?: ReactNode;
  keywords?: string;
}

interface Props {
  options: Option[];
  value: number | null;
  onChange: (value: number) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel: string;
  /** Rendered in the closed state instead of the plain label. */
  renderValue?: (o: Option | undefined) => ReactNode;
  autoFocus?: boolean;
}

const MAX_SHOWN = 80;

export function Combobox({ options, value, onChange, placeholder, disabled, ariaLabel, renderValue, autoFocus }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, MAX_SHOWN);
    const starts: Option[] = [];
    const contains: Option[] = [];
    for (const o of options) {
      const hay = `${o.label} ${o.keywords ?? ''}`.toLowerCase();
      if (o.label.toLowerCase().startsWith(q)) starts.push(o);
      else if (hay.includes(q)) contains.push(o);
    }
    return [...starts, ...contains].slice(0, MAX_SHOWN);
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  useEffect(() => { if (autoFocus) openList(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function openList() {
    if (disabled) return;
    setQuery('');
    setActive(Math.max(0, options.slice(0, MAX_SHOWN).findIndex((o) => o.value === value)));
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function choose(o: Option | undefined) {
    if (!o) return;
    onChange(o.value);
    setOpen(false);
  }

  return (
    <div className={`combobox ${open ? 'open' : ''}`} ref={rootRef}>
      {!open ? (
        <button type="button" className="combobox-trigger" onClick={openList} disabled={disabled} aria-label={ariaLabel}>
          {renderValue ? renderValue(selected) : (
            <>
              {selected?.icon}
              <span className="combobox-label">{selected?.label ?? placeholder ?? 'Select…'}</span>
            </>
          )}
          <span className="chev" aria-hidden>▾</span>
        </button>
      ) : (
        <>
          <input
            ref={inputRef}
            className="combobox-input"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-label={ariaLabel}
            placeholder={selected?.label ?? 'Search…'}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); choose(filtered[active]); }
              else if (e.key === 'Escape') setOpen(false);
            }}
          />
          <ul className="combobox-list" id={listId} role="listbox" ref={listRef}>
            {filtered.length === 0 && <li className="combobox-empty">No matches</li>}
            {filtered.map((o, i) => (
              <li
                key={o.value}
                role="option"
                data-index={i}
                aria-selected={o.value === value}
                className={`${i === active ? 'active' : ''} ${o.value === value ? 'selected' : ''}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => { e.preventDefault(); choose(o); }}
              >
                {o.icon}
                <span className="combobox-label">{o.label}</span>
                {o.hint && <span className="combobox-hint">{o.hint}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
