'use client';

// The local site's top nav: /me, Inventory, My parses and My replay are pages. An entry marked `coming` would render as a
// dim, titled span until its page exists (none is, today). "/me" comes first and is spelled like the website's own
// nav chip (FB-98): it lists these pages and says where the per-character inventory switches are.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const PAGES: { href: string; label: string; icon: string; coming?: boolean }[] = [
  { href: '/me/',        label: '/me', icon: '👤' },
  { href: '/inventory/', label: 'Inventory', icon: '🎒' },
  { href: '/parses/',    label: 'My parses', icon: '📈' },
  { href: '/replay/',    label: 'My replay', icon: '🎬' },
];

// Back / forward / reload (the guild lead, 2026-10-21: "the browser has no navigation buttons at all"). Mimic opens
// this site in a frameless-menu window with no browser chrome. The Navigation API says when there is nowhere to go;
// where it is missing the buttons stay enabled and a click with no history is a harmless no-op.
type Nav = { canGoBack: boolean; canGoForward: boolean; addEventListener: (t: string, f: () => void) => void; removeEventListener: (t: string, f: () => void) => void };
const getNav = (): Nav | null => (typeof window !== 'undefined' ? ((window as unknown as { navigation?: Nav }).navigation ?? null) : null);

function useHistoryState() {
  const [s, setS] = useState({ back: true, fwd: true });
  useEffect(() => {
    const nav = getNav();
    if (!nav) return;
    const sync = () => setS({ back: nav.canGoBack, fwd: nav.canGoForward });
    sync();
    nav.addEventListener('currententrychange', sync);
    return () => nav.removeEventListener('currententrychange', sync);
  }, []);
  return s;
}

export default function LocalNav() {
  const hist = useHistoryState();
  const path = (usePathname() || '/').replace(/^\/local/, '') || '/';
  // /local/ is the inventory (app/page.tsx), so the bare root lights Inventory too.
  const isOn = (href: string) => (href === '/inventory/' ? /^\/(inventory\/?)?$/.test(path) : path.replace(/\/?$/, '/') === href);
  return (
    <nav className="flex flex-wrap items-center gap-2" aria-label="On this PC">
      {[
        { key: 'back', label: '←', title: 'Back', ok: hist.back, run: () => window.history.back() },
        { key: 'fwd', label: '→', title: 'Forward', ok: hist.fwd, run: () => window.history.forward() },
        { key: 'reload', label: '⟳', title: 'Reload', ok: true, run: () => window.location.reload() },
      ].map(b => (
        <button key={b.key} type="button" onClick={b.run} disabled={!b.ok} title={b.title} aria-label={b.title}
          className="px-2 py-1 rounded border border-border text-xs text-text hover:border-blue disabled:opacity-40 disabled:hover:border-border disabled:cursor-default">
          {b.label}
        </button>
      ))}
      {PAGES.map(p => {
        const base = 'px-3 py-1 rounded border text-xs';
        if (p.coming) {
          return (
            <span key={p.href} className={`${base} border-border/60 text-dim/60 cursor-default`} title="Coming soon">
              <span aria-hidden>{p.icon} </span>{p.label} <span className="text-[9px] uppercase tracking-wide">soon</span>
            </span>
          );
        }
        const on = isOn(p.href);
        return (
          <Link key={p.href} href={p.href}
            className={`${base} no-underline ${on ? 'border-gold text-gold' : 'border-border text-text hover:border-blue'}`}>
            <span aria-hidden>{p.icon} </span>{p.label}
          </Link>
        );
      })}
    </nav>
  );
}
