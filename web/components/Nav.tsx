'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/',              label: 'Home' },
  { href: '/boards',        label: 'Boards' },
  { href: '/parses',        label: 'Parses' },
  { href: '/pvp',           label: 'PvP' },
  { href: '/leaderboards',  label: 'Ranks' },
  { href: '/loadouts',      label: 'Loadouts' },
  { href: '/planner',       label: 'Planner' },
  { href: '/fun',           label: '🎉 Fun' },
];

// showAdmin / showMe are computed server-side in the root layout (signed-in
// users see "Me"; officers see "Admin") so non-targets never see the link.
export default function Nav({ showAdmin = false, showMe = false }: { showAdmin?: boolean; showMe?: boolean }) {
  const path = usePathname();
  const allLinks = [...links];
  if (showMe)    allLinks.push({ href: '/me',    label: '👤 Me'    });
  if (showAdmin) allLinks.push({ href: '/admin', label: '🛡️ Admin' });
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
