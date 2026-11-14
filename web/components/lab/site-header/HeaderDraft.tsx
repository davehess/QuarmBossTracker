'use client';

// The redesigned top bar, three versions in one component (design lab draft: site-header).
//   a  Doors stay      the doors (Raid, Stats, Prep, /me, Admin) stay in the bar when folded; a door opens an overlay
//                      panel with a hint per link; downloads and the rest sit in ONE account menu, Sign out last.
//   b  Tonight         A plus a pill beside the brand: is a raid on, and when is the next one.
//   c  Jump box        brand, one search-or-jump field, the account menu; the doors live in the box's empty state.
//
// Everything arrives as props, so the lab (made-up data, forced size) and the real site (SiteHeader, behind ?hdr=)
// run the same code. `fixed` is the lab's switch: it pins the size, the fold and the open panel, and stops links
// from navigating. Without it the bar measures the window and the scroll itself.
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { HINTS, jumpFilter, raidPill, type JumpPage, type NavGroup } from '@/lib/siteHeaderView';

export type HeaderOpen = { kind: 'group'; id: string } | { kind: 'account' } | { kind: 'jump' } | null;
export type HeaderSize = 'wide' | 'mid' | 'phone';
export type HeaderKey = 'a' | 'b' | 'c';

export type HeaderDraftProps = {
  variant: HeaderKey;
  groups: NavGroup[];
  showMe: boolean;
  showAdmin: boolean;
  authBadge: ReactNode;
  tour: ReactNode;
  search: ReactNode;
  timezone: ReactNode;
  accountName?: string;
  /** Lab only: pin the size, the fold and the open panel. */
  fixed?: { size: HeaderSize; folded: boolean; open?: HeaderOpen };
  path?: string;
  now?: string;       // ISO time; the real site leaves it out and the bar reads the clock
  recent?: string[];  // lab only; the real site keeps its own list for the browser tab
};

const useIso = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const DOWNLOADS = [
  { href: '/mimic?direct=1', label: 'Windows' },
  { href: '/mimic/beta?direct=1', label: 'Windows beta' },
  { href: '/mimic/linux?direct=1', label: 'Linux and Steam Deck' },
];
const RECENT_KEY = 'wp-hdr-recent';

export default function HeaderDraft(p: HeaderDraftProps) {
  const livePath = usePathname();
  const router = useRouter();
  const lab = !!p.fixed;
  const path = p.path ?? livePath ?? '/';
  const [size, setSize] = useState<HeaderSize>(p.fixed?.size ?? 'wide');
  const [folded, setFolded] = useState(p.fixed?.folded ?? false);
  const [open, setOpen] = useState<HeaderOpen>(p.fixed?.open ?? null);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>(p.recent ?? []);
  const [nowIso, setNowIso] = useState<string | null>(p.now ?? null);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const pages = useMemo<JumpPage[]>(() => {
    const out: JumpPage[] = [];
    for (const g of p.groups) for (const i of g.items) out.push({ href: i.href, label: i.label, group: g.label, hint: HINTS[i.href] });
    out.push({ href: '/me', label: '/me', group: 'You', hint: HINTS['/me'] });
    if (p.showAdmin) out.push({ href: '/admin', label: 'Admin', group: 'You', hint: HINTS['/admin'] });
    out.push({ href: '/feedback', label: 'Feedback', group: 'You' });
    if (p.showMe) out.push({ href: '/test-server', label: 'Test server', group: 'You' });
    out.push({ href: '/', label: 'Home', group: 'You' });
    return out;
  }, [p.groups, p.showAdmin, p.showMe]);
  const pageOf = (pa: string) => pages.filter((x) => x.href !== '/').find((x) => pa === x.href || pa.startsWith(x.href + '/'));

  // The real site: measure the window and the scroll. The lab pins both.
  useIso(() => {
    if (lab) return;
    const wide = window.matchMedia('(min-width: 1100px)');
    const mid = window.matchMedia('(min-width: 640px)');
    const sync = () => { setSize(wide.matches ? 'wide' : mid.matches ? 'mid' : 'phone'); setFolded(window.scrollY > 24); };
    sync();
    wide.addEventListener('change', sync); mid.addEventListener('change', sync);
    window.addEventListener('scroll', sync, { passive: true });
    return () => { wide.removeEventListener('change', sync); mid.removeEventListener('change', sync); window.removeEventListener('scroll', sync); };
  }, [lab]);
  useEffect(() => {
    if (lab || p.variant !== 'b') return;
    const tick = () => setNowIso(new Date().toISOString());
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [lab, p.variant]);
  useEffect(() => {
    if (lab) return;
    setOpen(null); setQ('');
    try {
      const raw = JSON.parse(sessionStorage.getItem(RECENT_KEY) || '[]') as string[];
      const here = pageOf(path)?.href;
      const next = here ? [here, ...raw.filter((h) => h !== here)].slice(0, 6) : raw;
      sessionStorage.setItem(RECENT_KEY, JSON.stringify(next));
      setRecent(next);
    } catch { /* storage can be blocked: the list just stays empty */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, lab]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(null); input.current?.blur(); } };
    const onDown = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(null); };
    document.addEventListener('keydown', onKey); document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open]);
  useEffect(() => {
    if (lab || p.variant !== 'c') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
      if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault(); input.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lab, p.variant]);

  const phone = size === 'phone';
  const h = phone ? 'h-10' : 'h-9';
  const isOn = (href: string) => path === href || path.startsWith(href + '/');
  const stay = (e: React.MouseEvent) => { if (lab) e.preventDefault(); };
  const panelPos = (side: 'left' | 'right', w: string) =>
    phone ? 'left-0 right-0 border-x-0' : `${side === 'left' ? 'left-4' : 'right-4'} ${w} rounded-b-md`;
  const panelCls = 'absolute top-full z-40 max-h-[80vh] overflow-y-auto border border-border bg-panel shadow-lg';
  const rowCls = (on: boolean) =>
    `flex ${phone ? 'min-h-[44px]' : 'min-h-[36px]'} flex-col justify-center rounded px-3 py-1.5 no-underline transition-colors ` +
    (on ? 'bg-accent text-white' : 'text-text hover:bg-border/50');
  const doorCls = (on: boolean) =>
    `inline-flex shrink-0 items-center gap-1 rounded border px-2.5 ${h} text-sm whitespace-nowrap transition-colors ` +
    (on ? 'border-accent bg-accent text-white' : 'border-border bg-panel text-text hover:bg-border/50');

  const chev = (up: boolean) => (
    <svg viewBox="0 0 10 6" width="9" height="6" aria-hidden="true" className={up ? 'rotate-180' : ''}>
      <path d="M1 1.2 5 4.8 9 1.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  // ── pieces ──
  const brand = (
    <Link href="/" onClick={stay} aria-label="WolfPack.quest, home" className="flex shrink-0 items-center gap-2 no-underline">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/mimic-logo.png" alt="" width={30} height={30} className="h-7 w-7 rounded-md sm:h-[30px] sm:w-[30px]" />
      {size === 'wide' && !folded && (
        <span className="whitespace-nowrap text-xl font-bold text-blue">WolfPack<span className="text-dim">.quest</span></span>
      )}
    </Link>
  );

  const pill = (() => {
    if (p.variant !== 'b' || !nowIso) return null;
    const r = raidPill(nowIso);
    const tone = r.tone === 'green' ? 'border-green text-green' : r.tone === 'gold' ? 'border-gold text-gold' : 'border-border text-text';
    return (
      <Link href={r.href} onClick={stay} data-raid-pill={r.state}
            className={`inline-flex shrink-0 items-center rounded border bg-panel px-3 ${h} text-sm no-underline whitespace-nowrap hover:bg-border/50 ${tone}`}>
        {size === 'wide' ? r.long : r.short}
      </Link>
    );
  })();

  const doors = (
    <nav aria-label="Sections" className="flex shrink-0 items-center gap-1 sm:gap-1.5">
      {p.groups.map((g) => {
        const on = open?.kind === 'group' && open.id === g.id;
        return (
          <button key={g.id} type="button" aria-expanded={on} aria-controls={`hdr-${g.id}`}
                  onClick={() => setOpen(on ? null : { kind: 'group', id: g.id })}
                  className={doorCls(on || g.items.some((i) => isOn(i.href)))}>
            {g.label}{!phone && chev(on)}
          </button>
        );
      })}
      <Link href="/me" onClick={stay} className={doorCls(isOn('/me'))}>/me</Link>
      {p.showAdmin && <Link href="/admin" onClick={stay} className={doorCls(isOn('/admin'))}>Admin</Link>}
    </nav>
  );

  const acctOpen = open?.kind === 'account';
  const account = (
    <button type="button" aria-expanded={acctOpen} aria-controls="hdr-account" aria-label="Account menu"
            onClick={() => setOpen(acctOpen ? null : { kind: 'account' })}
            className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded border ${h} text-sm transition-colors ${phone ? 'w-10' : 'px-3'} ` +
              (acctOpen ? 'border-accent bg-accent text-white' : 'border-border bg-panel text-text hover:bg-border/50')}>
      {phone ? (
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <circle cx="8" cy="5.4" r="2.6" /><path d="M2.6 13.6c.6-2.6 2.6-3.8 5.4-3.8s4.8 1.2 5.4 3.8" />
        </svg>
      ) : (<>{p.showMe ? (p.accountName ?? 'Account') : 'More'}{chev(acctOpen)}</>)}
    </button>
  );

  const jumpField = (
    <input ref={input} value={q} role="combobox" aria-expanded={open?.kind === 'jump'} aria-controls="hdr-jump"
           aria-label="Jump to a page" autoComplete="off" spellCheck={false}
           placeholder={phone ? 'Jump to a page' : 'Jump to a page (press /)'}
           onChange={(e) => { setQ(e.target.value); setActive(0); setOpen({ kind: 'jump' }); }}
           onFocus={() => setOpen({ kind: 'jump' })}
           onKeyDown={(e) => {
             const n = hits.length;
             if (e.key === 'ArrowDown' && n) { e.preventDefault(); setActive((a) => (a + 1) % n); }
             else if (e.key === 'ArrowUp' && n) { e.preventDefault(); setActive((a) => (a + n - 1) % n); }
             else if (e.key === 'Enter' && hits[active] && !lab) { router.push(hits[active].href); setOpen(null); setQ(''); input.current?.blur(); }
           }}
           className={`min-w-0 flex-1 rounded border border-border bg-panel px-3 ${h} text-sm text-text placeholder:text-text focus:border-blue focus:outline-none sm:max-w-xl`} />
  );

  const here = pageOf(path)?.href;
  const hits = p.variant === 'c' ? jumpFilter(q, pages, recent.filter((r) => r !== here)) : [];

  // ── panels ──
  const groupPanel = (() => {
    if (p.variant === 'c' || open?.kind !== 'group') return null;
    const g = p.groups.find((x) => x.id === open.id);
    if (!g) return null;
    return (
      <div id={`hdr-${g.id}`} className={`${panelCls} ${panelPos('left', 'w-[36rem]')}`}>
        {phone && p.search ? <div className="border-b border-border p-2 [&>*]:!w-full">{p.search}</div> : null}
        <div className={`grid gap-0.5 p-2 ${phone ? '' : 'grid-cols-2'}`}>
          {g.items.map((i) => (
            <Link key={i.href} href={i.href} onClick={stay} className={rowCls(isOn(i.href))}>
              <span className="text-sm">{i.label}</span>
              <span className={`text-xs ${isOn(i.href) ? 'text-white' : 'text-dim'}`}>{HINTS[i.href]}</span>
            </Link>
          ))}
        </div>
      </div>
    );
  })();

  const accountPanel = acctOpen ? (
    <div id="hdr-account" className={`${panelCls} ${panelPos('right', 'w-[20rem]')}`}>
      <div className="p-2">
        {p.showMe && p.accountName && <div className="px-3 py-1 text-xs text-dim">Signed in as {p.accountName}</div>}
        <Link href="/feedback" onClick={stay} className={rowCls(isOn('/feedback'))}><span className="text-sm">Feedback</span></Link>
        <a href="https://wolfpack.opendkp.com" target="_blank" rel="noreferrer" className={rowCls(false)}><span className="text-sm">OpenDKP (opens in a new tab)</span></a>
        {p.showMe && <Link href="/test-server" onClick={stay} className={rowCls(isOn('/test-server'))}><span className="text-sm">Test server</span></Link>}
        <div className="mt-1 border-t border-border pt-1">{p.timezone}{p.tour}</div>
        <div className="mt-1 border-t border-border pt-1">
          <div className="px-3 py-1 text-xs text-dim">Download miMIC</div>
          {DOWNLOADS.map((d) => (
            <a key={d.href} href={d.href} target="_blank" rel="noreferrer" onClick={stay} className={rowCls(false)}><span className="text-sm">{d.label}</span></a>
          ))}
        </div>
        <div className="mt-1 border-t border-border p-3 [&_a]:inline-flex [&_a]:min-h-[40px] [&_a]:items-center [&_button]:min-h-[40px] [&_button]:px-4 [&_button]:text-sm [&_form]:justify-between [&_span]:inline">
          {p.authBadge}
        </div>
      </div>
    </div>
  ) : null;

  const jumpPanel = (() => {
    if (p.variant !== 'c' || open?.kind !== 'jump') return null;
    const rec = hits;
    const yours: NavGroup = { id: 'you', label: 'You', items: [{ href: '/me', label: '/me' }, ...(p.showAdmin ? [{ href: '/admin', label: 'Admin' }] : [])] };
    const chip = (href: string, label: string) => (
      <Link key={href} href={href} onClick={stay} className={doorCls(isOn(href))}>{label}</Link>
    );
    return (
      <div id="hdr-jump" role="listbox" className={`${panelCls} ${panelPos('left', 'w-[40rem]')}`}>
        <div className="p-2">
          {q.trim() ? (
            rec.length ? rec.map((pg, i) => (
              <Link key={pg.href} href={pg.href} onClick={stay} role="option" aria-selected={i === active}
                    className={`${rowCls(i === active)} !flex-row !items-center justify-between gap-3`}>
                <span className="text-sm">{pg.label}</span>
                <span className={`text-xs ${i === active ? 'text-white' : 'text-dim'}`}>{pg.group}</span>
              </Link>
            )) : <div className="px-3 py-3 text-sm text-text">No page called &ldquo;{q.trim()}&rdquo;</div>
          ) : (
            <>
              {rec.length > 0 && (
                <div className="mb-2">
                  <div className="px-3 py-1 text-xs text-dim">Recent</div>
                  {rec.map((pg) => (
                    <Link key={pg.href} href={pg.href} onClick={stay} className={`${rowCls(false)} !flex-row !items-center justify-between gap-3`}>
                      <span className="text-sm">{pg.label}</span><span className="text-xs text-dim">{pg.group}</span>
                    </Link>
                  ))}
                </div>
              )}
              <div className={`grid gap-x-3 gap-y-2 px-1 pb-1 ${phone ? 'grid-cols-1' : 'grid-cols-2'}`}>
                {[...p.groups, yours].map((g) => (
                  <div key={g.id}>
                    <div className="px-2 pb-1 text-xs text-dim">{g.label}</div>
                    <div className="flex flex-wrap gap-1.5">{g.items.map((i) => chip(i.href, i.label))}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    );
  })();

  return (
    <div ref={wrap} className="relative border-b border-border/60 bg-bg">
      <div className="mx-auto flex max-w-[1800px] items-center gap-2 px-3 py-2 sm:px-4">
        {brand}
        {size !== 'phone' && pill}
        {p.variant === 'c' ? jumpField : doors}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {p.variant !== 'c' && !phone && p.search}
          {!p.showMe && !phone && p.authBadge}
          {account}
        </div>
      </div>
      {size === 'phone' && pill && <div className="flex px-3 pb-2 [&>a]:flex-1 [&>a]:justify-center">{pill}</div>}
      {groupPanel}{accountPanel}{jumpPanel}
    </div>
  );
}
