'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/',              label: 'Home' },
  { href: '/boards',        label: 'Boards' },
  { href: '/parses',        label: 'Parses' },
  { href: '/leaderboards',  label: 'Ranks' },
  { href: '/loadouts',      label: 'Loadouts' },
  { href: '/planner',       label: 'Planner' },
];

// showAdmin is computed server-side in the root layout (based on officer
// role) and passed in so non-officers never see the link.
export default function Nav({ showAdmin = false }: { showAdmin?: boolean }) {
  const path = usePathname();
  const allLinks = showAdmin
    ? [...links, { href: '/admin', label: '🛡️ Admin' }]
    : links;
  return (
    <nav className="flex gap-2">
      {allLinks.map(({ href, label }) => {
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
