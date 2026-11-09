// The Raid Mimic header and footer for every raidmimic.com page that is not the landing page (the guild lead, 2026-11-02,
// on raidmimic.com/guilds: "we're missing the whole header and privacy policy and whatnot at the bottom of the page").
// The root layout gives a raidmimic host a bare shell with no width and no chrome (web/app/layout.tsx), so each page
// brings its own: the landing page draws the story stage and Footer, the legal pages LegalShell, and the rest wrap
// themselves in this. On a Wolf Pack host it renders the children alone, because the Wolf Pack layout already has both.
// Server component; its two path-aware pieces (the five top links and the section row, RaidmimicSubnav.tsx) are client. Lives in components/ because web/app/raidmimic/_landing/ is pinned to the landing page's files.
import { Footer } from '@/app/raidmimic/_landing/Parts';
import RaidmimicSubnav, { RaidmimicTopLinks } from '@/components/RaidmimicSubnav';

export function HostBar() {
  return (
    // Pinned to the top while the page scrolls (the guild lead, 2026-11-02: "top bar on the raidmimic.com site doesn't lock").
    // The solid background keeps the page from showing through it; z-40 keeps it over the page's own cards.
    // The five top links sit centred in the bar and the section's own pages centre under them (the guild lead, 2026-11-09:
    // "A, but centered underneath the other values"); the second row sticks with the bar. On a phone the name hides behind
    // the logo, the five links stay on one line and scroll sideways inside the bar, and the second row wraps.
    <header className="sticky top-0 z-40 mb-6 border-b border-border bg-bg py-1">
      <div className="flex items-center gap-3 sm:grid sm:grid-cols-[1fr_auto_1fr]">
        <a href="/" aria-label="Raid Mimic home" className="flex shrink-0 items-center gap-2 text-[#f2ede1] hover:no-underline">
          <img src="/mimic-logo.png" alt="" width={36} height={36} className="block h-9 w-9 rounded-lg" />
          <span className="hidden text-base font-semibold sm:inline">Raid Mimic</span>
        </a>
        <nav aria-label="Raid Mimic" className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap sm:max-w-full sm:flex-none">
          <RaidmimicTopLinks />
        </nav>
      </div>
      <RaidmimicSubnav />
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
