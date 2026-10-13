// /auth/paused — where a locked-out member lands (the guild lead, 2026-10-13; web/lib/lockout.ts). Public on
// purpose: the middleware has already signed them out, and nothing here reads or names a member.
import Link from 'next/link';

export const metadata = {
  title: 'Access paused',
  description: 'Your access to the Wolf Pack guild tools is paused. Ask an officer if you think this is a mistake.',
};

export default function PausedPage() {
  return (
    <div className="max-w-md mx-auto mt-12">
      <section className="bg-panel border border-border rounded-lg p-6 text-center">
        <h2 className="text-xl text-gold mb-2">Access paused</h2>
        <p className="text-sm text-dim leading-6">
          Your access to the guild&apos;s tools is paused. Ask an officer if you think this is a mistake.
        </p>
        <p className="text-sm mt-5">
          <Link href="/" className="text-blue hover:underline">← Home</Link>
        </p>
      </section>
    </div>
  );
}
