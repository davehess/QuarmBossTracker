// The top bar on public share pages (/share/*, 2026-10-15): the miMIC mark home, the site's PUBLIC sections and the
// miMIC downloads (the guild lead: "have our top bar available linking to about/aboutshort/platform/other public
// sections and the mimic icon and download link"). Deliberately not SiteHeader: no sign-in, no search, no member
// categories — a reader from another guild only gets links that open without an account.
import Link from 'next/link';
import { CHANNELS, ChannelLink } from './HeaderIcons';

const PUBLIC_LINKS: { href: string; label: string }[] = [
  { href: '/about', label: 'About' },
  { href: '/shortabout', label: 'In short' },
  { href: '/platform', label: 'Platform' },
  { href: '/roadmap', label: 'Roadmap' },
  { href: '/start', label: 'Get started' },
  { href: '/zeal-icons', label: 'Zeal marks' },
  { href: '/privacy', label: 'Privacy' },
];

export default function PublicTopBar() {
  return (
    <header className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border pb-3">
      <Link href="/" aria-label="WolfPack.quest — home" className="flex shrink-0 items-center gap-2 no-underline">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/mimic-logo.png" alt="" width={28} height={28} className="h-7 w-7 rounded-md" />
        <span className="text-sm font-semibold text-gold">WolfPack.quest</span>
      </Link>
      <nav aria-label="Public pages" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {PUBLIC_LINKS.map(l => (
          <Link key={l.href} href={l.href} className="text-dim no-underline hover:text-text">{l.label}</Link>
        ))}
      </nav>
      <div className="flex shrink-0 items-center gap-1.5">
        {CHANNELS.map(c => <ChannelLink key={c.key} c={c} showLabel={c.primary === true} />)}
      </div>
    </header>
  );
}
