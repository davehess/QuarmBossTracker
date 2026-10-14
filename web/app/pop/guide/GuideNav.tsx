'use client';

// The sidebar for the PoP checklist's sections (the guild lead, 2026-10-14: "Give a sidebar nav for the different
// sections to drop down. It should be a simple set of clicks."). A left column on a wide screen; on a phone one
// "Jump to a section" drop-down above the list. Both are the same list, built from GUIDE_NAV (the same tree the
// page draws its sections from, web/lib/popGuideSections.ts), so they cannot disagree about what exists.
//
// One click on a name opens that <details> and scrolls to it; the arrow beside a section opens or closes it
// without moving the page. A section's sub-list shows in the sidebar while the section is open on the page, and
// that is read FROM the page (the toggle event), so opening a section by its own heading drops the list too.
// The address bar follows (#tier-2, #tier-2-valor): a link opens what it names on arrival, and the back button
// steps through the sections you jumped to.

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { GUIDE_NAV, openParents } from '@/lib/popGuideSections';

export type NavCount = { done: number; total: number; next: boolean };

// Every collapsible this page draws carries data-gd (the Seer box and a quest chain's own folds do not), so
// "Expand all" and "Collapse all" touch the sections and nothing else.
const allSections = () => Array.from(document.querySelectorAll<HTMLDetailsElement>('details[data-gd]'));

/** Open whatever hides the element an id names, then bring it into view. A step's row scrolls as its whole line. */
export function openAndScroll(id: string, push = false) {
  const el = document.getElementById(id);
  if (!el) return;
  openParents(el);
  if (push && window.location.hash !== `#${id}`) {
    try { window.history.pushState(null, '', `#${id}`); } catch { /* the hash is only a convenience */ }
  }
  requestAnimationFrame(() => (id.startsWith('guide-') ? el.closest('li') ?? el : el).scrollIntoView({ block: 'start' }));
}

function useOpenIds(): ReadonlySet<string> {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    const read = () => setOpen(new Set(allSections().filter(d => d.open).map(d => d.id)));
    read();
    // toggle does not bubble, so it is heard on the way down.
    document.addEventListener('toggle', read, true);
    return () => document.removeEventListener('toggle', read, true);
  }, []);
  return open;
}

/** A link to #tier-2-valor opens it on arrival and again when the hash changes (back, forward, a pasted link). */
function useHashOpen() {
  useEffect(() => {
    const go = () => {
      let id = '';
      try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { /* a bad escape names nothing */ }
      if (id) openAndScroll(id);
    };
    go();
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
  }, []);
}

function setAll(on: boolean) {
  for (const d of allSections()) d.open = on;
}

function toggleSection(id: string) {
  const d = document.getElementById(id) as HTMLDetailsElement | null;
  if (d) d.open = !d.open;
}

function Tools() {
  return (
    <div className="flex gap-3 text-xs">
      <button type="button" onClick={() => setAll(true)} className="text-blue hover:underline py-1">Expand all</button>
      <button type="button" onClick={() => setAll(false)} className="text-blue hover:underline py-1">Collapse all</button>
    </div>
  );
}

function NavList({ counts, open, onPick }: { counts: Record<string, NavCount>; open: ReadonlySet<string>; onPick?: () => void }) {
  const jump = (e: MouseEvent, id: string) => {
    e.preventDefault();
    openAndScroll(id, true);
    onPick?.();
  };
  return (
    <ul className="flex flex-col gap-0.5 text-sm">
      {GUIDE_NAV.map(s => {
        const c = counts[s.id];
        const isOpen = open.has(s.id);
        return (
          <li key={s.id}>
            <div className="flex items-stretch">
              <a href={`#${s.id}`} onClick={e => jump(e, s.id)}
                 className="flex-1 min-w-0 flex items-baseline gap-2 rounded px-2 py-2 lg:py-1 text-text no-underline hover:bg-bg focus:outline focus:outline-2 focus:outline-blue">
                <span aria-hidden className="inline-block w-2 h-2 rounded-full shrink-0 self-center" style={{ background: s.color }} />
                <span className="min-w-0">{s.title}</span>
                {c?.next && <span className="text-gold text-[11px]" title="The Seer text you pasted rings a next step in here">▶</span>}
                {c && <span className={`ml-auto shrink-0 text-[11px] ${c.done === c.total ? 'text-green' : 'text-dim'}`}>{c.done}/{c.total}</span>}
              </a>
              <button type="button" onClick={() => toggleSection(s.id)} aria-expanded={isOpen}
                      aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${s.title}`}
                      className="w-9 lg:w-7 shrink-0 text-dim hover:text-text rounded focus:outline focus:outline-2 focus:outline-blue">
                <span aria-hidden>{isOpen ? '▾' : '▸'}</span>
              </button>
            </div>
            {isOpen && s.subs.length > 0 && (
              <ul className="ml-4 mb-1 border-l border-border flex flex-col">
                {s.subs.map(g => {
                  const gc = counts[g.id];
                  return (
                    <li key={g.id}>
                      <a href={`#${g.id}`} onClick={e => jump(e, g.id)}
                         className="flex items-baseline gap-2 pl-3 pr-2 py-1.5 lg:py-0.5 text-xs text-dim hover:text-text no-underline focus:outline focus:outline-2 focus:outline-blue">
                        <span className="min-w-0">{g.title}</span>
                        {gc?.next && <span className="text-gold">▶</span>}
                        {gc && <span className={`ml-auto shrink-0 text-[11px] ${gc.done === gc.total ? 'text-green' : ''}`}>{gc.done}/{gc.total}</span>}
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function GuideNav({ counts }: { counts: Record<string, NavCount> }) {
  const open = useOpenIds();
  useHashOpen();
  const sheet = useRef<HTMLDetailsElement>(null);
  return (
    <>
      {/* Phone: one drop-down above the list. It closes after a pick so the section is what you see. */}
      <details ref={sheet} className="lg:hidden bg-panel border border-border rounded-lg">
        <summary className="cursor-pointer select-none p-3 text-sm text-text flex items-baseline justify-between gap-2">
          <span className="font-semibold">Jump to a section</span>
          <span className="text-xs text-dim">tiers and Knowledge</span>
        </summary>
        <nav aria-label="Checklist sections" className="p-3 pt-0 flex flex-col gap-2 max-h-[70vh] overflow-y-auto">
          <Tools />
          <NavList counts={counts} open={open} onPick={() => { if (sheet.current) sheet.current.open = false; }} />
        </nav>
      </details>
      {/* Wide screen: a column that stays beside the list. top-24 clears the site bar and the beta banner. */}
      <aside className="hidden lg:block lg:w-64 shrink-0 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto bg-panel border border-border rounded-lg p-3">
        <nav aria-label="Checklist sections" className="flex flex-col gap-2">
          <Tools />
          <NavList counts={counts} open={open} />
        </nav>
      </aside>
    </>
  );
}
