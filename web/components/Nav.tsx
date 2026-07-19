'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Feedback moved up to the header's account row (root layout) per user
// request — keep the primary nav to destinations.
const links = [
  { href: '/',              label: 'Home' },
  { href: '/boards',        label: 'Boards' },
  { href: '/roster',        label: 'Roster' },
  { href: '/parses',        label: 'Parses' },
  { href: '/buffs',         label: 'Buffs' },
  { href: '/raid',          label: 'Raid' },
  { href: '/who',           label: '/who' },
  { href: '/pvp',           label: 'PvP' },
  { href: '/pop',           label: '🌀 PoP Flags (Preview)' },
  { href: '/leaderboards',  label: 'Ranks' },
  { href: '/rolls',         label: '🎲 Rolls' },
  { href: '/fun',           label: '🎉 Fun' },
  { href: '/roadmap',       label: '🗺️ Roadmap' },
];

// showAdmin / showMe are computed server-side in the root layout (signed-in
// users see "Me"; officers see "Admin") so non-targets never see the link.
export default function Nav({ showAdmin = false, showMe = false }: { showAdmin?: boolean; showMe?: boolean }) {
  const path = usePathname();
  const allLinks = [...links];
  if (showMe)    allLinks.push({ href: '/test-server', label: '🧪 Test server' });
  if (showMe)    allLinks.push({ href: '/me',    label: '👤 Me'    });
  if (showAdmin) allLinks.push({ href: '/admin', label: '🛡️ Admin' });
  return (
    <nav className="flex flex-wrap gap-1.5 sm:gap-2 -mx-1 px-1 overflow-x-auto">
      {allLinks.map(({ href, label }) => {
        const active = path === href || (href !== '/' && path?.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            className={[
              'px-2.5 sm:px-3 py-1 sm:py-1.5 rounded border text-xs sm:text-sm transition-colors whitespace-nowrap',
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
