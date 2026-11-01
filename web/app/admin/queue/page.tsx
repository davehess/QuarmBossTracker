// /admin/queue — officer review queue. One section per category from
// lib/admin-queue; each row shows the offending name + recent activity
// + a "fix it" link to the page where the officer action lives.

import Link from 'next/link';
import MoreInfo from '@/components/MoreInfo';

import { loadAdminQueue, type QueueCategory, type QueueItem } from '@/lib/admin-queue';
import { splitTop } from '@/lib/adminQueueData';
import { requireOfficer } from '@/lib/officer';

export const metadata = {
  title: 'Review queue · Admin',
  description: 'Open items waiting on an officer: chat speakers, unattributed names and other data to review.',
};

export const dynamic = 'force-dynamic';

function fmtAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - Date.parse(iso);
  const m = Math.round(diff / 60000);
  if (m < 60)   return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

function Rows({ items, from }: { items: QueueItem[]; from: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <tbody>
          {items.map((it, i) => (
            <tr key={it.key} className="border-b border-border/30 hover:bg-[#1a212c] align-top">
              <td className="py-1 pr-2 text-dim w-8">{from + i + 1}</td>
              <td className="py-1 pr-2 text-text">{it.label}</td>
              <td className="py-1 pr-2 text-dim text-xs">
                {it.detail ?? '—'}
                {it.lines && it.lines.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[11px] text-dim/80">
                    {it.lines.map((ln, j) => <li key={j}>· {ln}</li>)}
                  </ul>
                )}
              </td>
              <td className="py-1 pr-2 text-right text-dim text-xs whitespace-nowrap">{fmtAgo(it.last ?? null)}</td>
              <td className="py-1 pr-2 text-right">
                {it.href ? (
                  <Link href={it.href} className="text-blue hover:underline text-xs">fix →</Link>
                ) : (
                  <span className="text-dim text-xs">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ cat }: { cat: QueueCategory }) {
  const { shown, rest } = splitTop(cat.items);
  return (
    <section className="bg-panel border border-border rounded-lg p-4">
      <div className="flex items-baseline gap-3">
        <span aria-hidden className="text-xl">{cat.icon}</span>
        <h2 className="text-lg text-gold">{cat.title}</h2>
        <span className="text-dim text-xs">
          {cat.count} item{cat.count === 1 ? '' : 's'}
        </span>
        {cat.fixHelpHref && (
          <Link href={cat.fixHelpHref} className="ml-auto text-blue text-xs hover:underline">
            jump to fix-it page →
          </Link>
        )}
      </div>
      <p className="mt-1 text-sm text-dim">{cat.blurb}</p>
      <MoreInfo summary="What is this?"><p className="text-sm text-dim mt-1">{cat.summary}</p></MoreInfo>

      {cat.count === 0 ? (
        <div className="mt-3 text-sm text-dim italic">Nothing to review in this category.</div>
      ) : (
        <div className="mt-3">
          <Rows items={shown} from={0} />
          {rest.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-blue hover:underline">Show all {cat.count}</summary>
              <Rows items={rest} from={shown.length} />
            </details>
          )}
        </div>
      )}
    </section>
  );
}

export default async function AdminQueuePage() {
  await requireOfficer();
  const { total, categories } = await loadAdminQueue();

  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl text-gold">🛠 Officer review queue</h1>
          <span className="text-dim text-sm">
            {total === 0 ? 'All clear.' : `${total} item${total === 1 ? '' : 's'} flagged for review`}
          </span>
          <Link href="/admin" className="ml-auto text-blue text-sm hover:underline">← back to admin</Link>
        </div>
        <MoreInfo summary="More info">
          <p className="text-sm text-dim mt-1">
            Cross-checks the roster, /who, and chat history for gaps that affect downstream
            features (attendance, in-game chat display, leaderboards). Guild members only
            (Pack Member+ on Discord, or Raid Pack+ in OpenDKP); each section shows its top 10.
          </p>
          <p className="text-sm text-dim mt-1">
            Categories live in{' '}
            <code className="bg-bg px-1 rounded">web/lib/admin-queue.ts</code> — add a loader function
            to surface a new class of officer-action items here.
          </p>
        </MoreInfo>
      </section>

      {categories.map(cat => <Section key={cat.id} cat={cat} />)}
    </div>
  );
}
