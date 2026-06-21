// /admin/queue — officer review queue. One section per category from
// lib/admin-queue; each row shows the offending name + recent activity
// + a "fix it" link to the page where the officer action lives.

import Link from 'next/link';

import { loadAdminQueue, type QueueCategory } from '@/lib/admin-queue';

export const dynamic = 'force-dynamic';

function fmtAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - Date.parse(iso);
  const m = Math.round(diff / 60000);
  if (m < 60)   return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

function Section({ cat }: { cat: QueueCategory }) {
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
      <p className="text-sm text-dim mt-1">{cat.summary}</p>

      {cat.count === 0 ? (
        <div className="mt-3 text-sm text-dim italic">Nothing to review in this category.</div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-dim text-left">
              <tr className="border-b border-border">
                <th className="py-1 pr-2 w-8">#</th>
                <th className="py-1 pr-2">Name</th>
                <th className="py-1 pr-2">Detail</th>
                <th className="py-1 pr-2 text-right">Last seen</th>
                <th className="py-1 pr-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {cat.items.map((it, i) => (
                <tr key={it.key} className="border-b border-border/30 hover:bg-[#1a212c]">
                  <td className="py-1 pr-2 text-dim">{i + 1}</td>
                  <td className="py-1 pr-2 text-text">{it.label}</td>
                  <td className="py-1 pr-2 text-dim text-xs">{it.detail ?? '—'}</td>
                  <td className="py-1 pr-2 text-right text-dim text-xs">{fmtAgo(it.last ?? null)}</td>
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
      )}
    </section>
  );
}

export default async function AdminQueuePage() {
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
        <p className="text-sm text-dim mt-2">
          Cross-checks the roster, /who, and chat history for gaps that affect downstream
          features (attendance, in-game chat display, leaderboards). Categories live in{' '}
          <code className="bg-bg px-1 rounded">web/lib/admin-queue.ts</code> — add a loader function
          to surface a new class of officer-action items here.
        </p>
      </section>

      {categories.map(cat => <Section key={cat.id} cat={cat} />)}
    </div>
  );
}
