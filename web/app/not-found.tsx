// Global 404. The default Next.js not-found is a dead end — especially inside
// the Mimic in-window browser, which is chromeless (no address bar, no back
// button), so a stray 404 strands the user with no way out. This gives them a
// clear way home and to the common pages.
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="max-w-md mx-auto mt-16 text-center space-y-6">
      <div>
        <div className="text-5xl text-gold font-bold">404</div>
        <p className="text-sm text-dim mt-2">
          That page doesn&apos;t exist. If you just signed in, the link may have
          pointed somewhere that moved — head back home and try again.
        </p>
      </div>
      <Link
        href="/"
        className="inline-block px-4 py-2 rounded border border-blue bg-[#1f6feb33] text-blue text-sm hover:bg-[#1f6feb66] transition-colors no-underline"
      >
        ← Back to wolfpack.quest home
      </Link>
      <div className="text-xs text-dim">
        or jump to{' '}
        <Link href="/me" className="text-blue hover:underline">/me</Link>{' · '}
        <Link href="/parses" className="text-blue hover:underline">parses</Link>{' · '}
        <Link href="/boards" className="text-blue hover:underline">boards</Link>
      </div>
    </div>
  );
}
