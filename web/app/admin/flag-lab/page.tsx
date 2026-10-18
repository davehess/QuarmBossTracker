// /admin/flag-lab — an officer sandbox to pre-test the PoP flag matrix and the hail board with no raid.
//
// Everything is invented and held in the browser: fake members with ticked flags, and a fake kill with a
// fake roster. The page and its component read no table and call no server action, so there is nothing
// to write to (test/flag-lab-no-writes.test.js asserts the source holds no write call). Gate state is drawn by
// the same functions and mark /pop uses; the hail view is web/lib/hailBoardView.ts, a port of
// utils/hailBoard.js that test/flag-lab-hail-parity.test.js runs against the bot's own buildViews.
//
// OFF BY DEFAULT: the lab renders only when FLAG_LAB=1 (set it in Vercel's Preview environment, not
// Production). Officer only: the /admin layout checks, and so does the page itself
// (test/admin-pages-officer-gate.test.js).
//
// A new route, so it carries the [beta] tag (DECISIONS §135).

import Link from 'next/link';
import NewPageTag from '@/components/NewPageTag';
import { requireOfficer } from '@/lib/officer';
import FlagLab from './FlagLab';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: '[beta] Flag lab',
  description: 'An officer sandbox to pre-test PoP flags and the hail board with invented raiders. Nothing is saved.',
};

export default async function AdminFlagLabPage() {
  await requireOfficer();
  const enabled = process.env.FLAG_LAB === '1';

  return (
    <div className="space-y-6">
      <NewPageTag note="Officer sandbox, off unless FLAG_LAB=1." />
      <div className="text-sm"><Link href="/admin" className="text-blue hover:underline">← back to admin</Link></div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">🧪 [beta] Flag lab</h2>
        {enabled ? (
          <p className="text-sm text-dim leading-6">
            Build fake raiders and watch the same gate marks <Link href="/pop" className="text-blue hover:underline">/pop</Link>{' '}
            draws, then stage a fake boss kill and see the hail board the way the Command Center shows it.
            Nothing here reads or writes the database.
          </p>
        ) : (
          <p className="text-sm text-dim leading-6">
            The Flag lab is switched off here. It runs only where the <code>FLAG_LAB</code> environment variable is
            set to <code>1</code> (Vercel Preview, not Production).
          </p>
        )}
      </section>

      {enabled && <FlagLab />}
    </div>
  );
}
