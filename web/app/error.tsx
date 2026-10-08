'use client';

// Route-level error boundary. There was none anywhere in the app, so any throw in
// a server component dropped the raider onto Next's raw error screen — a white
// page with a digest hash, mid-raid, on a phone.
//
// ⚠ Deliberately does NOT print error.message. These pages read Supabase with the
// service role, and a thrown Postgres error can carry table and column names into
// its message. The digest is the safe handle: it is what appears in the Vercel
// logs, so an officer can quote it and we can find the real error.
import { useEffect } from 'react';
import Link from 'next/link';

export default function Error({
  error, reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);

  return (
    <div className="bg-panel border border-border rounded-lg p-6 space-y-4">
      <h1 className="text-xl text-gold">That page didn&apos;t load</h1>
      <p className="text-sm text-dim leading-6 max-w-prose">
        Something broke on our side, not yours. Nothing you did caused it and nothing
        was lost — try again, and if it keeps happening, say so in Discord.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-[#d29922] px-4 py-2 text-sm font-semibold text-[#1a1206] transition-colors hover:bg-[#e0a92c]"
        >
          Try again
        </button>
        <Link
          href="/"
          className="no-underline rounded-md border border-border px-4 py-2 text-sm text-text transition-colors hover:border-[#d29922]"
        >
          Back to the front page
        </Link>
      </div>
      {error.digest && (
        <p className="text-xs text-dim font-mono">
          Reference <span className="text-text">{error.digest}</span> — quote this and we can find it in the logs.
        </p>
      )}
    </div>
  );
}
