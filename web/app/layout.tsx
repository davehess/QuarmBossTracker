import './globals.css';
import type { Metadata } from 'next';
import Nav from '@/components/Nav';
import AuthBadge from '@/components/AuthBadge';
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
            <div className="flex items-center gap-3 flex-wrap">
              <Nav showAdmin={showAdmin} showMe={showMe} />
              <div className="hidden sm:block"><AuthBadge /></div>
            </div>
          </header>
          <main>{children}</main>
          <footer className="mt-12 text-xs text-dim">
            Data shared with the Discord bot via Supabase · the local agent dashboard
            lives at{' '}
            <a
              href="http://localhost:7777"
              target="_blank"
              rel="noreferrer"
              className="text-blue hover:underline"
            >
              http://localhost:7777
            </a>{' '}
            for live in-raid stats (only opens if your wolfpack-logsync agent is running).
          </footer>
        </div>
      </body>
    </html>
  );
}
