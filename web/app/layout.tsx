import './globals.css';
import type { Metadata } from 'next';
import Nav from '@/components/Nav';
import AuthBadge from '@/components/AuthBadge';
import DemoToggle from '@/components/DemoToggle';
import TimezonePicker from '@/components/TimezonePicker';
import LocalDashboardLink from '@/components/LocalDashboardLink';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer } from '@/lib/officer';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://wolfpack.quest';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default:  'Wolf Pack EQ — Tracker',
    template: '%s · Wolf Pack EQ',
  },
  description: 'Guild-wide build planner, parse history, and loadout library for Project Quarm.',
  openGraph: {
    title:       'Wolf Pack EQ — Tracker',
    description: 'Guild-wide build planner, parse history, and loadout library for Project Quarm.',
    url:         SITE_URL,
    siteName:    'Wolf Pack EQ',
    type:        'website',
  },
  twitter: { card: 'summary' },
  icons: { icon: '/favicon.ico' },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Officer check runs server-side per request so the Admin nav link only
  // appears for officers. Non-officers never see the link in the source.
  // Signed-in users see "Me" — anonymous visitors don't.
  const { data: { user } } = await supabaseServer().auth.getUser();
  const showAdmin = user ? await isOfficer(user.id) : false;
  const showMe    = !!user;

  return (
    <html lang="en">
      <body className="font-mono">
        <div className="max-w-7xl mx-auto p-3 sm:p-4">
          <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-xl sm:text-2xl text-blue font-bold flex items-center gap-2">
                <span aria-hidden>🐺</span>
                <span className="hidden sm:inline">Wolf Pack EQ — Tracker</span>
                <span className="sm:hidden">Wolf Pack EQ</span>
              </h1>
              {/* AuthBadge sits next to title on mobile so the nav row gets the full width */}
              <div className="sm:hidden"><AuthBadge /></div>
            </div>
            {/* Download buttons — always visible at the top so newcomers can
                grab the right one without hunting. Parser = classic CLI agent
                (proven). Mimic = Electron desktop app, 1-click installer.
                BOTH download the installer directly: Parser hits the static
                /latest/download asset; Mimic uses /mimic?direct=1, which resolves
                the newest Mimic release and 302s straight to its .exe (falling back
                to the release page only if the build asset isn't attached yet). */}
            <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
              <a
                href="https://github.com/davehess/QuarmBossTracker/releases/latest/download/WolfPackParser.zip"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded border border-green bg-[#1a7f3733] text-green text-xs sm:text-sm hover:bg-[#1a7f3766] transition-colors whitespace-nowrap no-underline"
                title="Download the wolfpack-logsync parser — the local agent that streams encounter data to the bot"
              >
                <span aria-hidden>📦</span>
                <span>Download Parser</span>
                <span aria-hidden className="text-dim text-[10px]">↗</span>
              </a>
              <a
                href="/mimic?direct=1"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded border border-blue bg-[#1f6feb33] text-blue text-xs sm:text-sm hover:bg-[#1f6feb66] transition-colors whitespace-nowrap no-underline"
                title="Wolf Pack Mimic — Electron desktop app. Downloads the latest installer directly (always resolves the newest build). One installer, bundles its own Node, transparent DPS overlay + trigger TTS. Coexists with the Parser. SmartScreen will warn (not code-signed yet) — More info → Run anyway."
              >
                <span aria-hidden>🐺</span>
                <span>Mimic</span>
                <span aria-hidden className="text-dim text-[10px]">↗</span>
              </a>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Nav showAdmin={showAdmin} showMe={showMe} />
              <DemoToggle />
              <TimezonePicker />
              <div className="hidden sm:block"><AuthBadge /></div>
            </div>
          </header>
          <main>{children}</main>
          <footer className="mt-12 text-xs text-dim space-y-1">
            <div>
              Data shared with the Discord bot via Supabase · the local agent dashboard
              lives at{' '}
              <LocalDashboardLink />{' '}
              for live in-raid stats (Parser.bat uses 7777, Mimic 7779 — this auto-detects whichever is running).
            </div>
            <div>
              <a href="/privacy" className="text-blue hover:underline">Privacy</a>{' '}
              <span aria-hidden>·</span>{' '}
              Your logs stay on your device. Toggle exclusions any time on{' '}
              <a href="/me" className="text-blue hover:underline">/me</a>.
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
