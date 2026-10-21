'use client';

// The local site's top nav. Inventory is the one page so far; My parses and My replay are listed so the
// shape of the site is visible, and are not links until they exist (they render as dim, titled spans).
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const PAGES: { href: string; label: string; icon: string; coming?: boolean }[] = [
  { href: '/inventory/', label: 'Inventory', icon: '🎒' },
  { href: '/parses/',    label: 'My parses', icon: '📈', coming: true },
  { href: '/replay/',    label: 'My replay', icon: '🎬', coming: true },
];

export default function LocalNav() {
  const here = usePathname() || '/';
  const onInventory = /^\/(inventory\/?)?$/.test(here.replace(/^\/local/, '') || '/');
  return (
    <nav className="flex flex-wrap items-center gap-2" aria-label="On this PC">
      {PAGES.map(p => {
        const base = 'px-3 py-1 rounded border text-xs';
        if (p.coming) {
          return (
            <span key={p.href} className={`${base} border-border/60 text-dim/60 cursor-default`} title="Coming soon">
              <span aria-hidden>{p.icon} </span>{p.label} <span className="text-[9px] uppercase tracking-wide">soon</span>
            </span>
          );
        }
        const on = p.href === '/inventory/' && onInventory;
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
