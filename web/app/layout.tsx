import './globals.css';
import type { Metadata } from 'next';
import Nav from '@/components/Nav';

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-mono">
        <div className="max-w-7xl mx-auto p-4">
          <header className="flex items-center justify-between mb-6">
            <h1 className="text-2xl text-blue font-bold flex items-center gap-3">
              <span aria-hidden>🐺</span>
              <span>Wolf Pack EQ — Tracker</span>
            </h1>
            <Nav />
          </header>
          <main>{children}</main>
          <footer className="mt-12 text-xs text-dim">
            Data shared with the Discord bot via Supabase · the local agent dashboard
            stays on <code>http://localhost:7777</code> for live in-raid stats.
          </footer>
        </div>
      </body>
    </html>
  );
}
