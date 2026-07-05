'use client';

// Themed autocomplete for the "main" character inputs on /admin/links.
//
// Replaces the native <datalist>, which renders its own browser-controlled
// popup — on Chrome Android that popup collapses to a floating grey pill that
// overlaps the field when the query narrows to a single match (Uilnayar
// 2026-07-05: "you lose the background on the text and it just overlays").
// It can't be styled or repositioned with CSS. This renders a normal absolute
// dropdown below the field instead, identical on desktop + mobile.
//
// The inner <input> keeps a real `name` so the surrounding server-action form
// still submits its value via FormData — the dropdown only fills that input.

import { useState, useRef, useId } from 'react';

export default function MainCombobox({
  name,
  options,
  defaultValue = '',
  placeholder,
  className = '',
}: {
  name: string;
  options: string[];
  defaultValue?: string;
  placeholder?: string;
  className?: string;
}) {
  const [val, setVal] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();

  const q = val.trim().toLowerCase();
  const matches = q
    ? options.filter(o => o.toLowerCase().includes(q) && o.toLowerCase() !== q).slice(0, 8)
    : [];

  function choose(v: string) {
    setVal(v);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || matches.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(matches[active]); }
    else if (e.key === 'Escape') { setOpen(false); setActive(-1); }
  }

  return (
    <div className="relative inline-block">
      <input
        type="text"
        name={name}
        value={val}
        onChange={e => { setVal(e.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        className={`bg-bg border border-border rounded px-2 py-1 text-xs w-44 ${className}`}
      />
      {open && matches.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 top-full mt-1 z-30 w-full max-h-52 overflow-auto rounded border border-border bg-panel shadow-lg"
        >
          {matches.map((o, i) => (
            <li key={o} role="option" aria-selected={i === active}>
              <button
                type="button"
                // mousedown, not click: fires before the input's blur, so the
                // selection lands before the dropdown would otherwise close.
                onMouseDown={e => { e.preventDefault(); choose(o); }}
                onMouseEnter={() => setActive(i)}
                className={`block w-full text-left px-2 py-1.5 text-xs ${i === active ? 'bg-[#1f6feb33] text-blue' : 'text-text hover:bg-[#21262d]'}`}
              >
                {o}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
