'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/',              label: 'Home' },
  { href: '/parses',        label: 'Parses' },
  { href: '/leaderboards',  label: 'Boards' },
  { href: '/loadouts',      label: 'Loadouts' },
  { href: '/planner',       label: 'Planner' },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="flex gap-2">
      {links.map(({ href, label }) => {
        const active = path === href || (href !== '/' && path?.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            className={[
              'px-3 py-1.5 rounded border text-sm transition-colors',
              active
                ? 'bg-accent border-accent text-white'
                : 'bg-panel border-border text-text hover:bg-[#21262d]',
            ].join(' ')}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
