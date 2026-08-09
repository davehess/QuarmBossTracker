import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import Nav from '@/components/Nav';
import AuthBadge from '@/components/AuthBadge';
import TimezonePicker from '@/components/TimezonePicker';
import LocalDashboardLink from '@/components/LocalDashboardLink';
import GlobalSearch from '@/components/GlobalSearch';
import GuidedTour, { TourLauncher } from '@/components/GuidedTour';
import BetaBanner from '@/components/BetaBanner';
import { getSessionUser } from '@/lib/session';
import { isOfficer } from '@/lib/officer';

// b.wolfpack.quest. Set at BUILD time from the branch (see next.config.js), so
// this is a constant in the bundle rather than a per-request check.
const IS_BETA = process.env.NEXT_PUBLIC_IS_BETA === '1';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL
  || (IS_BETA ? 'https://b.wolfpack.quest' : 'https://wolfpack.quest');

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // The beta mirror serves the same pages on a different host, which is
  // textbook duplicate content — left indexable it would compete with
  // wolfpack.quest in search results and could outrank it. Never index it.
  ...(IS_BETA ? { robots: { index: false, follow: false } } : {}),
  title: {
    // Distinguishable in a browser tab when prod and beta are both open.
    default:  IS_BETA ? 'WolfPack.quest (beta)' : 'WolfPack.quest',
    template: IS_BETA ? '%s · WolfPack.quest (beta)' : '%s · WolfPack.quest',
  },
  description: 'Guild-wide build planner, parse history, and loadout library for Project Quarm.',
  openGraph: {
    title:       'WolfPack.quest',
    description: 'Guild-wide build planner, parse history, and loadout library for Project Quarm.',
    url:         SITE_URL,
    siteName:    'WolfPack.quest',
    type:        'website',
  },
  twitter: { card: 'summary' },
  icons: { icon: '/favicon.ico' },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Officer check runs server-side per request so the Admin nav link only
  // appears for officers. Non-officers never see the link in the source.
  // Signed-in users see "Me" — anonymous visitors don't. Both lookups are
  // React cache()'d, so pages sharing this request dedupe instead of
  // re-hitting Supabase (lib/session.ts + lib/officer.ts).
  const user = await getSessionUser();
  const showAdmin = user ? await isOfficer(user.id) : false;
  const showMe    = !!user;

  return (
    <html lang="en">
      <body className="font-mono">
        {IS_BETA && <BetaBanner />}
        <div className="max-w-7xl mx-auto p-3 sm:p-4">
          <header className="mb-6">
            {/* Row 1 — wordmark (left) + account block (right), on ONE line.
                The account block used to share this row with the whole brand
                COLUMN (wordmark + three download CTAs + search); together they
                overflow max-w-7xl, so flex-wrap dropped the account block onto
                a line of its own and the header read as four ragged rows
                (Uilnayar 2026-08-05). Only the wordmark shares the row now, so
                the account block stays beside it at every width. */}
            <div className="flex items-center justify-between gap-3">
              <a href="/" className="flex items-center gap-2.5 no-underline min-w-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/mimic-logo.png" alt="Wolf Pack miMIC" width={38} height={38} className="rounded-md shrink-0" />
                <span className="text-lg sm:text-2xl text-blue font-bold whitespace-nowrap">
                  WolfPack<span className="text-dim">.quest</span>
                </span>
              </a>
              {/* Account block — Tour / Feedback / OpenDKP / Admin / avatar.
                  Wraps internally on narrow screens rather than pushing the
                  wordmark off its line. */}
              <div className="flex items-center justify-end gap-2 flex-wrap">
                {/* ✨ new-member walkthrough — re-runnable any time; the
                    engine itself is mounted at the end of <body>. */}
                {showMe && <TourLauncher />}
                <Link
                  href="/feedback"
                  className="px-2.5 py-1 rounded border border-border bg-panel text-xs sm:text-sm text-text hover:bg-[#21262d] transition-colors whitespace-nowrap no-underline"
                >
                  💬 Feedback
                </Link>
                {/* Direct link to the Wolf Pack OpenDKP roster + auction
                    site. External — opens in a new tab so it doesn't
                    nuke the user's current wolfpack.quest context. */}
                <a
                  href="https://wolfpack.opendkp.com"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-border bg-panel text-xs sm:text-sm text-text hover:bg-[#21262d] transition-colors whitespace-nowrap no-underline"
                  title="Wolf Pack OpenDKP — roster, DKP, raid attendance, auctions"
                >
                  💰 OpenDKP
                  <span aria-hidden className="text-dim text-[10px]">↗</span>
                </a>
                {showAdmin && (
                  <Link
                    href="/admin"
                    className="px-2.5 py-1 rounded border border-border bg-panel text-xs sm:text-sm text-text hover:bg-[#21262d] transition-colors whitespace-nowrap no-underline"
                  >
                    🛡️ Admin
                  </Link>
                )}
                <AuthBadge />
              </div>
            </div>

            {/* Row 2 — download CTAs + search on the left, timezone on the
                right. These are the wide elements; giving them their own strip
                is what keeps the account block beside the wordmark above. */}
            <div className="flex items-start justify-between gap-3 flex-wrap mt-2">
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href="/mimic?direct=1"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-blue bg-[#1f6feb33] text-blue text-xs hover:bg-[#1f6feb66] transition-colors whitespace-nowrap no-underline"
                    title="Wolf Pack miMIC — the all-in-one desktop client (bundles the wolfpack-logsync agent + DPS overlay, trigger TTS, charm tracker, /tells). Downloads the latest STABLE installer directly. SmartScreen will warn (not code-signed yet) — More info → Run anyway."
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/mimic-logo.png" alt="" width={14} height={14} className="rounded-sm" />
                    <span>Download mi<span className="tracking-wide">MIC</span></span>
                    <span aria-hidden className="text-dim text-[10px]">↗</span>
                  </a>
                  {/* Beta channel — same installer pipeline, prerelease tag.
                      Quiet styling so the stable button stays the primary CTA. */}
                  <a
                    href="/mimic/beta?direct=1"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-border bg-bg/40 text-dim text-xs hover:bg-bg/70 hover:text-fg transition-colors whitespace-nowrap no-underline"
                    title="Wolf Pack miMIC — BETA channel. Latest prerelease build with in-progress features. Less stable than the main download; only grab this if you're testing or have been asked to."
                  >
                    <span>Beta</span>
                    <span aria-hidden className="text-dim text-[10px]">↗</span>
                  </a>
                  {/* Linux / SteamOS (Steam Deck) beta — the native AppImage
                      (#156). Own update channel, experimental. Quiet styling. */}
                  <a
                    href="/mimic/linux?direct=1"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-border bg-bg/40 text-dim text-xs hover:bg-bg/70 hover:text-fg transition-colors whitespace-nowrap no-underline"
                    title="Wolf Pack Mimic — Linux / SteamOS (Steam Deck) BETA. Native AppImage: UI Studio, dashboard, log-based callouts. Auto-updates on its own channel. Experimental — grab this only if you're testing on Linux/Deck."
                  >
                    <span>Linux / SteamOS</span>
                    <span aria-hidden className="text-dim text-[10px]">↗</span>
                  </a>
                  {/* Site-wide search sits beside the download CTAs (Uilnayar
                      2026-06-23). Signed-in only — the search API is
                      members-only. Enter opens the full /search results page. */}
                  {showMe && <GlobalSearch />}
                </div>
              <TimezonePicker />
            </div>

            {/* Row 3 — primary nav on its own clean strip. Search sits beside
                the download CTAs; Feedback + Admin live in the account
                block. */}
            <div className="flex items-start justify-between gap-3 flex-wrap border-t border-border/60 mt-3 pt-3">
              <Nav showMe={showMe} />
            </div>
          </header>
          <main>{children}</main>
          <footer className="mt-12 text-xs text-dim space-y-1">
            <div>
              Data shared with the Discord bot via Supabase · the Mimic Parser dashboard
              lives at{' '}
              <LocalDashboardLink />{' '}
              for live in-raid stats.
            </div>
            <div>
              <a href="/privacy" className="text-blue hover:underline">Privacy</a>{' '}
              <span aria-hidden>·</span>{' '}
              <a href="/roadmap" className="text-blue hover:underline">Roadmap</a>{' '}
              <span aria-hidden>·</span>{' '}
              Your logs stay on your device. Toggle exclusions any time on{' '}
              <a href="/me" className="text-blue hover:underline">/me</a>.
            </div>
          </footer>
        </div>
        <GuidedTour signedIn={showMe} />
      </body>
    </html>
  );
}
