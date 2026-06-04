import './globals.css';
import type { Metadata } from 'next';
import Nav from '@/components/Nav';
import AuthBadge from '@/components/AuthBadge';
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
          <header className="mb-6">
            {/* Row 1 — brand (left) + timezone/account (right). Always fits;
                wraps cleanly on narrow screens. Mimic logo replaces the emoji. */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <a href="/" className="flex items-center gap-2.5 no-underline">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/mimic-logo.png" alt="Wolf Pack Mimic" width={38} height={38} className="rounded-md shrink-0" />
                <span className="text-lg sm:text-2xl text-blue font-bold">
                  <span className="hidden sm:inline">Wolf Pack EQ — Tracker</span>
                  <span className="sm:hidden">Wolf Pack EQ</span>
                </span>
              </a>
              <div className="flex items-center gap-3">
                <TimezonePicker />
                <AuthBadge />
              </div>
            </div>

            {/* Row 2 — primary nav (left) + compact download CTAs (right), on
                their own line below the brand so the layout reads the same at
                every width. */}
            <div className="flex items-start justify-between gap-3 flex-wrap border-t border-border/60 mt-3 pt-3">
              <Nav showAdmin={showAdmin} showMe={showMe} />
              <div className="flex flex-wrap gap-2 shrink-0">
                <a
                  href="/mimic?direct=1"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-blue bg-[#1f6feb33] text-blue text-xs hover:bg-[#1f6feb66] transition-colors whitespace-nowrap no-underline"
                  title="Wolf Pack Mimic — the all-in-one desktop client (bundles the wolfpack-logsync agent + DPS overlay, trigger TTS, charm tracker, /tells). Downloads the latest installer directly. SmartScreen will warn (not code-signed yet) — More info → Run anyway."
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/mimic-logo.png" alt="" width={14} height={14} className="rounded-sm" />
                  <span>Download Mimic</span>
                  <span aria-hidden className="text-dim text-[10px]">↗</span>
                </a>
                <a
                  href="https://github.com/davehess/QuarmBossTracker/releases/latest/download/WolfPackParser.zip"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-green bg-[#1a7f3733] text-green text-xs hover:bg-[#1a7f3766] transition-colors whitespace-nowrap no-underline"
                  title="The standalone wolfpack-logsync parser — the classic CLI agent (no desktop UI). Use this if you prefer the minimal install."
                >
                  <span aria-hidden>📦</span>
                  <span>Standalone parser</span>
                  <span aria-hidden className="text-dim text-[10px]">↗</span>
                </a>
              </div>
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
            <div>
              Windows code signing for Wolf Pack Mimic provided free by{' '}
              <a href="https://signpath.io" target="_blank" rel="noreferrer" className="text-blue hover:underline">SignPath.io</a>,
              {' '}certificate by{' '}
              <a href="https://signpath.org" target="_blank" rel="noreferrer" className="text-blue hover:underline">SignPath Foundation</a>.
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
