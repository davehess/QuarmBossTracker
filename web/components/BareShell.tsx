import PublicTopBar from './PublicTopBar';

// The page shell for a public share link (/share/*, 2026-10-15): no site header, no sign-in badge, no search, no
// tour, and no link into a member page — only PublicTopBar's public sections and miMIC downloads. The reader may be from another guild and signed in nowhere.
// app/layout.tsx returns this when the middleware has marked the request (the `x-wp-bare` header). The game-art
// notice is the one footer line that stays: the replay draws EverQuest zone geometry.
export default function BareShell({ fontClass, children }: { fontClass: string; children: React.ReactNode }) {
  return (
    <html lang="en" className={fontClass}>
      <body className="font-mono">
        <div className="max-w-7xl mx-auto p-3 sm:p-4">
          <PublicTopBar />
          <main>{children}</main>
          <footer className="mt-12 text-xs text-dim/70">
            EverQuest is a registered trademark of Daybreak Game Company LLC. All EverQuest game data and art
            assets are the property of Daybreak Game Company LLC. This is an unofficial, non-commercial fan-made
            companion for Project Quarm, and is neither affiliated with nor endorsed by Daybreak Game Company LLC.
          </footer>
        </div>
      </body>
    </html>
  );
}
