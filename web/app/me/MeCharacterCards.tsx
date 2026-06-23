'use client';

// Client-side layout controller for the /me character cards. The server
// renders each card's pieces (header / buffs-zone summary / full details) and
// hands them here as ReactNode slots; this component owns the *presentation*:
//   • which characters are shown (hide the ones you don't care about)
//   • their order (default level-desc from the server; drag-and-drop to set
//     your own)
//   • collapsed (header + buffs/zone only) vs expanded (everything)
//
// Preferences persist to localStorage (per Discord account), so the page
// remembers your layout without a server round-trip. Zero deps — drag-and-drop
// is the native HTML5 API. (Uilnayar 2026-06-23: "select which toons to
// display, order, minimize to header+buffs/zone, drag to reorder.")

import { useEffect, useMemo, useRef, useState } from 'react';

export type MeCard = {
  name: string;
  level: number | null;
  header: React.ReactNode;   // always shown
  summary: React.ReactNode;  // buffs/zone — shown when collapsed
  details: React.ReactNode;  // full panel grid — shown when expanded
};

type Prefs = { order: string[]; hidden: string[]; collapsed: string[] };

export default function MeCharacterCards({ items, storageKey }: { items: MeCard[]; storageKey: string }) {
  const allNames = useMemo(() => items.map(i => i.name), [items]);
  const byName = useMemo(() => new Map(items.map(i => [i.name, i])), [items]);
  const key = `me:cards:${storageKey || 'default'}:v1`;

  // Initial state matches the server render (server order, all shown/expanded)
  // so SSR + first client render agree; saved prefs apply in an effect.
  const [order, setOrder] = useState<string[]>(allNames);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [reorder, setReorder] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const dragName = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const p = JSON.parse(raw) as Prefs;
        const known = new Set(allNames);
        const saved = (p.order || []).filter(n => known.has(n));
        const missing = allNames.filter(n => !saved.includes(n));  // new chars → end
        setOrder([...saved, ...missing]);
        setHidden(new Set((p.hidden || []).filter(n => known.has(n))));
        setCollapsed(new Set((p.collapsed || []).filter(n => known.has(n))));
      }
    } catch { /* ignore corrupt prefs */ }
    setLoaded(true);
  }, [key, allNames]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(key, JSON.stringify({ order, hidden: [...hidden], collapsed: [...collapsed] }));
    } catch { /* quota / private mode — non-fatal */ }
  }, [order, hidden, collapsed, loaded, key]);

  function toggleHidden(name: string) {
    setHidden(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  }
  function toggleCollapsed(name: string) {
    setCollapsed(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  }
  const visible = order.filter(n => byName.has(n) && !hidden.has(n));
  const allCollapsed = visible.length > 0 && visible.every(n => collapsed.has(n));
  function setAllCollapsed(on: boolean) {
    setCollapsed(on ? new Set(visible) : new Set());
  }
  function resetLayout() {
    setOrder(allNames);
    setHidden(new Set());
    setCollapsed(new Set());
  }

  // Drag-and-drop reorder (native HTML5). Reordering operates on the full
  // `order` array so hidden characters keep their relative position.
  function onDragStart(name: string) { dragName.current = name; setDragging(name); }
  function onDragEnter(target: string) {
    const src = dragName.current;
    if (!src || src === target) return;
    setOrder(prev => {
      const from = prev.indexOf(src);
      const to = prev.indexOf(target);
      if (from < 0 || to < 0) return prev;
      const next = prev.slice();
      next.splice(from, 1);
      next.splice(to, 0, src);
      return next;
    });
  }
  function onDragEnd() { dragName.current = null; setDragging(null); }

  return (
    <div className="space-y-4">
      {/* Layout toolbar */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <button
          type="button"
          onClick={() => { setReorder(r => !r); setShowPicker(false); }}
          className={`px-2.5 py-1 rounded border ${reorder ? 'border-gold text-gold bg-gold/10' : 'border-border text-dim hover:border-blue hover:text-blue'}`}
        >
          {reorder ? '✓ Done reordering' : '↕ Reorder'}
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => { setShowPicker(s => !s); setReorder(false); }}
            className="px-2.5 py-1 rounded border border-border text-dim hover:border-blue hover:text-blue"
          >
            👁 Show/hide{hidden.size > 0 ? ` (${visible.length}/${allNames.length})` : ''} ▾
          </button>
          {showPicker && (
            <div className="absolute z-20 mt-1 bg-bg border border-border rounded-lg p-2 shadow-lg min-w-[12rem] max-h-72 overflow-auto">
              {order.filter(n => byName.has(n)).map(n => (
                <label key={n} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-panel cursor-pointer">
                  <input type="checkbox" checked={!hidden.has(n)} onChange={() => toggleHidden(n)} />
                  <span className="text-text">{n}</span>
                  {byName.get(n)!.level != null && <span className="text-dim text-[10px]">L{byName.get(n)!.level}</span>}
                </label>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setAllCollapsed(!allCollapsed)}
          className="px-2.5 py-1 rounded border border-border text-dim hover:border-blue hover:text-blue"
        >
          {allCollapsed ? '⊞ Expand all' : '⊟ Collapse all'}
        </button>
        <button
          type="button"
          onClick={resetLayout}
          className="px-2.5 py-1 rounded border border-border/60 text-dim/70 hover:text-dim"
          title="Reset to the default level-descending layout, all shown + expanded"
        >
          ↺ Reset
        </button>
        {reorder && <span className="text-dim text-[11px]">Drag a card by its ⠿ handle to reorder.</span>}
      </div>

      {visible.length === 0 && (
        <div className="bg-panel border border-border rounded-lg p-4 text-sm text-dim">
          All characters hidden. Use <span className="text-blue">Show/hide</span> to bring some back.
        </div>
      )}

      {visible.map(name => {
        const card = byName.get(name)!;
        const isCollapsed = collapsed.has(name);
        return (
          <section
            key={name}
            draggable={reorder}
            onDragStart={() => onDragStart(name)}
            onDragEnter={() => onDragEnter(name)}
            onDragOver={e => { if (reorder) e.preventDefault(); }}
            onDragEnd={onDragEnd}
            className={`bg-panel border rounded-lg ${dragging === name ? 'opacity-50 border-gold' : 'border-border'} ${reorder ? 'cursor-move ring-1 ring-gold/20' : ''}`}
          >
            <div className="flex items-stretch">
              {reorder && (
                <div className="flex items-center px-2 text-gold/70 select-none border-r border-border/60" title="Drag to reorder">
                  ⠿
                </div>
              )}
              <div className="flex-1 min-w-0">
                {/* Header row: server-rendered header + a collapse toggle */}
                <div className="px-4 py-3 border-b border-border flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">{card.header}</div>
                  <button
                    type="button"
                    onClick={() => toggleCollapsed(name)}
                    className="shrink-0 px-2 py-0.5 rounded border border-border text-dim text-[11px] hover:border-blue hover:text-blue"
                    title={isCollapsed ? 'Expand all stats' : 'Minimize to header + buffs/zone'}
                  >
                    {isCollapsed ? '▸ Expand' : '▾ Minimize'}
                  </button>
                </div>
                {isCollapsed ? <div className="p-0">{card.summary}</div> : card.details}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
