import './globals.css';
import type { Metadata } from 'next';
import LocalNav from './LocalNav';

// The local site (web/local, bundled into Mimic): the website's pages, run from this PC's own files.
// No session, no headers(), no server: the layout is static, and every page fetches its rows from the
// agent on the same origin. See next.config.js.
export const metadata: Metadata = {
  title: 'On this PC · Wolf Pack Mimic',
  description: 'Your own inventory, parses and replays, built from your own logs. Nothing here leaves this PC.',
  robots: { index: false, follow: false },
};

export default function LocalLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-mono">
        <header className="border-b border-border bg-panel">
          <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-lg font-bold text-blue">
              WolfPack<span className="text-dim">.quest</span>
            </span>
            <LocalNav />
            <span className="ml-auto text-[11px] text-green border border-green/40 rounded-full px-2.5 py-0.5">
              ● Mimic · local · this PC
            </span>
          </div>
        </header>
        <div className="border-b border-border bg-[#0f1a2b]">
          <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2 text-xs text-text">
            <span aria-hidden>🔒 </span>
            <b>On this PC · nothing leaves it.</b>{' '}
            <span className="text-dim">Built from your own logs and inventory files.</span>
          </div>
        </div>
        <main className="max-w-7xl mx-auto p-3 sm:p-4">{children}</main>
      </body>
    </html>
  );
}
