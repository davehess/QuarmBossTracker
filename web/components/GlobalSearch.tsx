'use client';

// Site-wide search box in the header. Debounced query to /api/search; shows a
// categorized dropdown (characters / items / spells) with deep links. Internal
// hits navigate via the router; external hits (PQDI item/spell pages) open in
// a new tab. Keyboard: ↑/↓ to move, Enter to open, Esc to close. Built to
// extend — add a category block here when the API grows (parses, loot, gear).
// Uilnayar 2026-06-22 epic: "a search bar across all pages... any deep-linked
// element should be accessible here."

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

type Hit = { label: string; sub?: string; href: string; external?: boolean };
type Results = { characters: Hit[]; items: Hit[]; spells: Hit[] };

const EMPTY: Results = { characters: [], items: [], spells: [] };
const SECTIONS: { key: keyof Results; label: string; icon: string }[] = [
  { key: 'characters', label: 'Characters', icon: '🧑' },
  { key: 'items',      label: 'Items',      icon: '🗡️' },
  { key: 'spells',     label: 'Spells',     icon: '✨' },
];

export default function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Results>(EMPTY);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);   // index into the flat hit list
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Flatten for keyboard nav, preserving section order.
  const flat: Hit[] = [...results.characters, ...results.items, ...results.spells];

  // Debounced fetch.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults(EMPTY); setLoading(false); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
        if (res.ok) { setResults(await res.json()); setActive(0); }
      } catch { /* network blip — leave prior results */ }
      finally { setLoading(false); }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  // Close on outside click.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Cmd/Ctrl-K focuses the box from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const go = useCallback((hit: Hit) => {
    setOpen(false);
    setQ('');
    if (hit.external) window.open(hit.href, '_blank', 'noreferrer');
    else router.push(hit.href);
  }, [router]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(flat.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') {
      if (flat[active]) { e.preventDefault(); go(flat[active]); }
    }
  }

  const hasAny = flat.length > 0;
  let runningIdx = -1;

  return (
    <div ref={wrapRef} className="relative w-full sm:w-72">
      <input
        ref={inputRef}
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search characters, items, spells…  (⌘K)"
        className="w-full bg-bg border border-border rounded px-2.5 py-1 text-xs text-text placeholder:text-dim focus:border-blue outline-none"
      />
      {open && q.trim().length >= 2 && (
        <div className="absolute right-0 mt-1 w-full sm:w-96 max-h-[70vh] overflow-auto z-50 bg-panel border border-border rounded-lg shadow-xl text-xs">
          {loading && !hasAny && <div className="px-3 py-3 text-dim">Searching…</div>}
          {!loading && !hasAny && <div className="px-3 py-3 text-dim">No matches for “{q.trim()}”.</div>}
          {SECTIONS.map(sec => {
            const hits = results[sec.key];
            if (!hits.length) return null;
            return (
              <div key={sec.key} className="border-b border-border/40 last:border-0">
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-dim bg-bg/40">
                  {sec.icon} {sec.label}
                </div>
                <ul>
                  {hits.map(hit => {
                    runningIdx += 1;
                    const idx = runningIdx;
                    return (
                      <li key={`${sec.key}-${hit.href}-${hit.label}`}>
                        <button
                          type="button"
                          onMouseEnter={() => setActive(idx)}
                          onClick={() => go(hit)}
                          className={`w-full text-left px-3 py-1.5 flex items-baseline justify-between gap-2 ${idx === active ? 'bg-[#1f6feb22]' : 'hover:bg-bg/50'}`}
                        >
                          <span className="text-text truncate">{hit.label}</span>
                          <span className="text-dim text-[10px] shrink-0">{hit.sub}{hit.external ? ' ↗' : ''}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
