'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

// Four top-level categories (Hitya, 2026-08-28). Sixteen chips wrapped to three
// rows on desktop and six on a phone, which pushed the page's whole first
// viewport below the fold. Everything is still one click away — the difference
// is that you now choose a category first.
//
// Grouping is a judgment call: Raid is what you touch DURING one, Stats is what
// happened, Prep is what you do beforehand. Hitya has ruled on three so far —
// Buffs is Raid; Quartermaster and /who are Prep (2026-08-28). Say so if a
// destination is filed wrong; nothing here is load-bearing beyond the label.
export type Item = { href: string; label: string };
export type Group = { id: string; label: string; items: Item[] };

// ⚠ Exported: the compact header's Menu renders the SAME array. Two copies of
// the site's navigation is how one of them goes stale.
export const GROUPS: Group[] = [
  {
    id: 'raid', label: 'Raid',
    items: [
      { href: '/raid',          label: 'Raid HQ' },
      { href: '/boards',        label: 'Spawn boards' },
      { href: '/buffs',         label: 'Buffs' },
      { href: '/rolls',         label: 'Rolls' },
    ],
  },
  {
    id: 'stats', label: 'Stats',
    items: [
      { href: '/parses',       label: 'Parses' },
      { href: '/leaderboards', label: 'Ranks' },
      { href: '/pvp',          label: 'PvP' },
      { href: '/roster',       label: 'Roster' },
      { href: '/fun',          label: 'Fun' },
    ],
  },
  {
    id: 'prep', label: 'Prep',
    items: [
      { href: '/guide',         label: 'Raid guide' },
      { href: '/db',            label: 'Database' },
      { href: '/quartermaster', label: 'Quartermaster' },
      { href: '/who',           label: '/who' },
      { href: '/pop',           label: 'PoP flags' },
      { href: '/roadmap',       label: 'Roadmap' },
    ],
  },
];

// Tighter horizontal padding below sm: five top-level chips wrapped to two
// rows at 360px, which cost 36px of a phone's first viewport (measured
// 2026-08-28). Vertical padding is untouched — these are tap targets.
const chip =
  'px-2 sm:px-3 py-1.5 rounded border text-xs sm:text-sm transition-colors whitespace-nowrap';
const chipIdle   = 'bg-panel border-border text-text hover:bg-[#21262d]';
const chipActive = 'bg-accent border-accent text-white';

export default function Nav({ showAdmin = false, showMe = false }: { showAdmin?: boolean; showMe?: boolean }) {
  const path = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  // ⚠ Hover and tap fight each other, and both directions were live bugs until
  // the real page was driven in both profiles:
  //   · hover device — mouseenter opens, and the click after it toggled it SHUT
  //   · touch device — a tap emits COMPATIBILITY mouse events, so mouseenter
  //     opened the group and the same tap's click toggled it shut. Guarding
  //     mouseenter was not enough: onFocus was a FOURTH way in, and a tap
  //     focuses the button, so the click still arrived with the group already
  //     open and closed it. onFocus-to-open is gone — keyboard users get the
  //     same click every other user gets (Enter/Space fires it), which is the
  //     ordinary disclosure pattern and leaves exactly two entry points.
  // So hover only opens where hover actually exists, and click only toggles
  // where it does not. Neither reads wrong from the source; both are obvious
  // the moment you drive it.
  const [canHover, setCanHover] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    const sync = () => setCanHover(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const inGroup = (g: Group) => g.items.some(i => path === i.href || path?.startsWith(i.href + '/'));

  // Pointer devices open on hover; touch has no hover, so a tap toggles. Both
  // paths set the same state — there is no hover-only route to any link.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open]);

  // Navigating closes the panel; without this it survives the route change.
  useEffect(() => { setOpen(null); }, [path]);

  const shown = GROUPS.find(g => g.id === open);

  return (
    <div ref={wrap} onMouseLeave={() => { if (canHover) setOpen(null); }}>
      <nav className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        <Link href="/" className={`${chip} ${path === '/' ? chipActive : chipIdle}`}>Home</Link>

        {GROUPS.map(g => {
          const on = open === g.id;
          return (
            <button
              key={g.id}
              type="button"
              aria-expanded={on}
              aria-controls={`nav-${g.id}`}
              onClick={() => setOpen(on && !canHover ? null : g.id)}
              onMouseEnter={() => { if (canHover) setOpen(g.id); }}
              className={`${chip} ${on || inGroup(g) ? chipActive : chipIdle} inline-flex items-center gap-1.5`}
            >
              {g.label}
              <svg viewBox="0 0 10 6" width="9" height="6" aria-hidden="true"
                   className={`transition-transform ${on ? 'rotate-180' : ''}`}>
                <path d="M1 1.2 5 4.8 9 1.2" fill="none" stroke="currentColor" strokeWidth="1.4"
                      strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          );
        })}

        {/* ⚠ Always rendered. The brief is four top-level doors — Raid, Stats,
            Prep and /me (Hitya) — and gating this one on `showMe` quietly made
            it three for every signed-out visitor, which is how it went missing.
            /me redirects to `/auth/signin?next=/me` on its own, so a signed-out
            click lands on sign-in and comes back here rather than dead-ending;
            for a prospective member it is the invitation, not a broken link. */}
        <Link href="/me" className={`${chip} ${path?.startsWith('/me') ? chipActive : chipIdle}`}>/me</Link>
        {showAdmin && <Link href="/admin" className={`${chip} ${path?.startsWith('/admin') ? chipActive : chipIdle}`}>Admin</Link>}
        {showMe   && <Link href="/test-server" className={`${chip} ${chipIdle} opacity-70`}>Test server</Link>}
      </nav>

      {/* The revealed row. Rendered in flow rather than absolutely positioned so
          it can never cover the page's first viewport on a phone. */}
      {shown && (
        <div id={`nav-${shown.id}`}
             className="mt-1.5 flex flex-wrap gap-1.5 sm:gap-2 border-t border-border/60 pt-2">
          {shown.items.map(i => {
            const active = path === i.href || path?.startsWith(i.href + '/');
            return (
              <Link key={i.href} href={i.href}
                    className={`${chip} ${active ? chipActive : chipIdle}`}>
                {i.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
