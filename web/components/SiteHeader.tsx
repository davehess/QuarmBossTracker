'use client';

// The whole top bar, in two shapes (Hitya, 2026-08-28).
//
// FULL, at the top of a wide window — one row: brand, the three download
// channels, the link categories in the middle, then the clock, the utility
// chips and the account block.
//
// COMPACT, "when you scroll down collapse it to one bar" and equally "when
// there isn't enough room, like in mobile mode" — the mimic icon, the beta
// symbol, the Linux symbol, a Menu drop-down carrying the categories, then
// sign in. Both triggers set the SAME state, so there is one compact layout to
// maintain rather than one for scrolling and one for phones.
//
// ⚠ Nothing is dropped, only folded. Every link that leaves the bar is in the
// Menu, and the Menu is built from Nav's exported GROUPS so the two can never
// disagree.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import Nav, { GROUPS } from './Nav';
import TimezonePicker from './TimezonePicker';
import { CHANNELS, ChannelLink } from './HeaderIcons';

// Applied before paint, so a page that loads already scrolled — a refresh, a
// back-navigation, an in-page anchor — does not paint the full bar and snap.
const useIsoLayout = typeof window === 'undefined' ? useEffect : useLayoutEffect;

// Below this the full row cannot hold brand + channels + categories + account,
// so the compact bar takes over. Measured, not guessed: see header-chrome test.
const ROOMY = '(min-width: 1180px)';

const chip = 'inline-flex items-center gap-1 rounded border border-border bg-panel px-2 py-1' +
             ' text-xs text-text no-underline whitespace-nowrap transition-colors hover:bg-[#21262d]';

export default function SiteHeader({
  showMe, showAdmin, authBadge, tour, search,
}: {
  showMe: boolean;
  showAdmin: boolean;
  authBadge: ReactNode;
  tour: ReactNode;
  search: ReactNode;
}) {
  const path = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [roomy, setRoomy] = useState(true);
  const [menu, setMenu] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useIsoLayout(() => {
    const mq = window.matchMedia(ROOMY);
    const syncRoom = () => setRoomy(mq.matches);
    const syncScroll = () => setScrolled(window.scrollY > 24);
    syncRoom(); syncScroll();
    mq.addEventListener('change', syncRoom);
    window.addEventListener('scroll', syncScroll, { passive: true });
    return () => { mq.removeEventListener('change', syncRoom); window.removeEventListener('scroll', syncScroll); };
  }, []);

  const compact = scrolled || !roomy;

  // The menu belongs to the compact bar; going back to the full one must not
  // leave an orphaned panel open.
  useEffect(() => { if (!compact) setMenu(false); }, [compact]);
  useEffect(() => { setMenu(false); }, [path]);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [menu]);

  const isOn = useCallback((href: string) => path === href || path?.startsWith(href + '/'), [path]);

  const utility = (
    <>
      {tour}
      <Link href="/feedback" aria-label="Feedback" className={chip}>
        <span aria-hidden>💬</span><span className="hidden xl:inline">Feedback</span>
      </Link>
      <a href="https://wolfpack.opendkp.com" target="_blank" rel="noreferrer"
         aria-label="OpenDKP" title="Wolf Pack OpenDKP — roster, DKP, raid attendance, auctions"
         className={chip}>
        <span aria-hidden>💰</span><span className="hidden xl:inline">OpenDKP</span>
      </a>
      {showAdmin && (
        <Link href="/admin" aria-label="Admin" className={chip}>
          <span aria-hidden>🛡️</span><span className="hidden xl:inline">Admin</span>
        </Link>
      )}
    </>
  );

  return (
    <div ref={wrap} className="border-b border-border/60 bg-bg/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2 sm:px-4">

        {/* Brand. The wordmark is the first thing to go when space is short. */}
        <Link href="/" aria-label="WolfPack.quest — home" className="flex shrink-0 items-center gap-2 no-underline">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/mimic-logo.png" alt="" width={30} height={30} className="h-7 w-7 rounded-md sm:h-[30px] sm:w-[30px]" />
          {!compact && (
            <span className="whitespace-nowrap text-base font-bold text-blue lg:text-xl">
              WolfPack<span className="text-dim">.quest</span>
            </span>
          )}
        </Link>

        {/* The three channels. Labels only when the bar is full. */}
        <div className="flex shrink-0 items-center gap-1.5">
          {CHANNELS.map(c => <ChannelLink key={c.key} c={c} showLabel={!compact} />)}
        </div>

        {compact ? (
          <>
            <MenuButton open={menu} onToggle={() => setMenu(m => !m)} />
            <div className="ml-auto flex shrink-0 items-center gap-2">{authBadge}</div>
          </>
        ) : (
          <>
            {/* Categories in the middle. */}
            <div className="mx-auto min-w-0"><Nav showMe={showMe} /></div>
            <div className="flex shrink-0 items-center gap-2">
              {search}
              <TimezonePicker />
              {utility}
              {authBadge}
            </div>
          </>
        )}
      </div>

      {/* The folded half of the bar. Rendered in flow, never over the page. */}
      {compact && menu && (
        <div id="site-menu" className="border-t border-border/60 bg-panel/95 backdrop-blur">
          <div className="mx-auto max-w-7xl px-3 py-3 sm:px-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <MenuLink href="/" label="Home" on={path === '/'} />
              <MenuLink href="/me" label="/me" on={!!isOn('/me')} />
              {showAdmin && <MenuLink href="/admin" label="🛡️ Admin" on={!!isOn('/admin')} />}
              <MenuLink href="/feedback" label="💬 Feedback" on={!!isOn('/feedback')} />
              <a href="https://wolfpack.opendkp.com" target="_blank" rel="noreferrer" className={chip}>
                💰 OpenDKP <span aria-hidden className="text-[10px] text-dim">↗</span>
              </a>
            </div>
            {GROUPS.map(g => (
              <div key={g.id} className="mt-3">
                <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-dim">{g.label}</div>
                <div className="flex flex-wrap gap-1.5">
                  {g.items.map(i => <MenuLink key={i.href} href={i.href} label={i.label} on={!!isOn(i.href)} />)}
                </div>
              </div>
            ))}
            <div className="mt-3 flex items-center gap-3 border-t border-border/60 pt-3">
              <TimezonePicker />
              {search}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="site-menu"
      className={`ml-1 inline-flex shrink-0 items-center gap-1.5 rounded border px-2.5 py-1 text-xs
                  transition-colors ${open ? 'border-accent bg-accent text-white'
                                           : 'border-border bg-panel text-text hover:bg-[#21262d]'}`}
    >
      Menu
      <svg viewBox="0 0 10 6" width="9" height="6" aria-hidden="true"
           className={`transition-transform ${open ? 'rotate-180' : ''}`}>
        <path d="M1 1.2 5 4.8 9 1.2" fill="none" stroke="currentColor" strokeWidth="1.4"
              strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function MenuLink({ href, label, on }: { href: string; label: string; on: boolean }) {
  return (
    <Link href={href}
          className={`rounded border px-2.5 py-1 text-xs no-underline transition-colors ${
            on ? 'border-accent bg-accent text-white' : 'border-border bg-bg text-text hover:bg-[#21262d]'}`}>
      {label}
    </Link>
  );
}
