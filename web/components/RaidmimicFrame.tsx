// The Raid Mimic header and footer for every raidmimic.com page that is not the landing page (the guild lead, 2026-11-02,
// on raidmimic.com/guilds: "we're missing the whole header and privacy policy and whatnot at the bottom of the page").
// The root layout gives a raidmimic host a bare shell with no width and no chrome (web/app/layout.tsx), so each page
// brings its own: the landing page draws the story stage and Footer, the legal pages LegalShell, and the rest wrap
// themselves in this. On a Wolf Pack host it renders the children alone, because the Wolf Pack layout already has both.
// Server component, no client JS. Lives in components/ because web/app/raidmimic/_landing/ is pinned to the landing page's files.
import { Footer } from '@/app/raidmimic/_landing/Parts';

const NAV = [
  { label: 'Demo', href: '/demo' },
  { label: 'Your guilds', href: '/guilds' },
  { label: 'Set up', href: '/setup' },
  { label: 'For guild leaders', href: '/register' },
] as const;

const NAV_LINK = 'rounded px-2 py-1 text-sm text-dim hover:bg-panel hover:text-text hover:no-underline';

export function HostBar() {
  return (
    <header className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border pb-3">
      <a href="/" className="flex items-center gap-2 text-[#f2ede1] hover:no-underline">
        <img src="/mimic-logo.png" alt="" width={36} height={36} className="block h-9 w-9 rounded-lg" />
        <span className="text-base font-semibold">Raid Mimic</span>
      </a>
      <nav aria-label="Raid Mimic" className="ml-auto flex flex-wrap items-center gap-1">
        {NAV.map(n => <a key={n.href} href={n.href} className={NAV_LINK}>{n.label}</a>)}
      </nav>
    </header>
  );
}

/** `width` is the page's own column (each page already chose one); the bar and footer share it. */
export default function HostFrame({ onHost, width = 'max-w-3xl', children }: {
  onHost: boolean; width?: string; children: React.ReactNode;
}) {
  if (!onHost) return <>{children}</>;
  return (
    <div className={`mx-auto w-full ${width}`}>
      <HostBar />
      {children}
      <Footer onHost />
    </div>
  );
}
