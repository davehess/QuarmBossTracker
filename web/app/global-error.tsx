'use client';

// The last resort: a throw in the ROOT LAYOUT itself, which app/error.tsx cannot
// catch because it renders inside that layout. This one replaces the whole
// document, so it must ship its own <html> and <body> and cannot use the site's
// styles, fonts or components — none of them have mounted. Plain inline CSS on
// purpose; anything imported here could be the thing that just failed.
export default function GlobalError({
  error, reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{
        margin: 0, minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#0d1117', color: '#c9d1d9',
        fontFamily: 'ui-monospace, Consolas, monospace', padding: '24px',
      }}>
        <div style={{ maxWidth: 460, textAlign: 'center' }}>
          <h1 style={{ color: '#d29922', fontSize: 20, marginBottom: 12 }}>
            WolfPack.quest is having a moment
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#8b949e', marginBottom: 20 }}>
            The site failed to start up. This one is on us — try again in a moment,
            and flag it in Discord if it sticks.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: '#d29922', color: '#1a1206', border: 0, borderRadius: 6,
              padding: '9px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ fontSize: 11, color: '#6e7681', marginTop: 18 }}>
              Reference {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
