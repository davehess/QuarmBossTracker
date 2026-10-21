'use client';

// The local site's top nav. Inventory and My replay are pages; My parses is listed so the shape of the site is
// visible, and is not a link until it exists (it renders as a dim, titled span).
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const PAGES: { href: string; label: string; icon: string; coming?: boolean }[] = [
  { href: '/inventory/', label: 'Inventory', icon: '🎒' },
  { href: '/parses/',    label: 'My parses', icon: '📈', coming: true },
  { href: '/replay/',    label: 'My replay', icon: '🎬' },
];

export default function LocalNav() {
  const path = (usePathname() || '/').replace(/^\/local/, '') || '/';
  // /local/ is the inventory (app/page.tsx), so the bare root lights Inventory too.
  const isOn = (href: string) => (href === '/inventory/' ? /^\/(inventory\/?)?$/.test(path) : path.replace(/\/?$/, '/') === href);
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
