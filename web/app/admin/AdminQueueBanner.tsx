// Compact "needs review" banner injected at the top of every admin page via
// the admin layout. Shows total count + per-category badges, links to
// /admin/queue for the full detail view. Server component — runs the same
// loader as the queue page; the heaviest query is bounded (last 14d chat).
// Goal: officers see "5 chat speakers missing OpenDKP · 2 anon-only" at a
// glance without leaving whichever admin page they're on.

import Link from 'next/link';
import { loadAdminQueue } from '@/lib/admin-queue';

export default async function AdminQueueBanner() {
  const { total, categories } = await loadAdminQueue();

  if (total === 0) {
    return (
      <div className="bg-panel/60 border border-border rounded-lg px-3 py-2 mb-4 flex items-center gap-3 text-xs">
        <span className="text-green">✓</span>
        <span className="text-dim">Review queue clear — nothing flagged for officer attention.</span>
      </div>
    );
  }

  return (
    <div className="bg-panel border border-amber-700/50 rounded-lg px-3 py-2 mb-4 flex items-center gap-3 text-xs flex-wrap">
      <span className="text-amber-400 font-semibold whitespace-nowrap">🛠 Review queue · {total} item{total === 1 ? '' : 's'}</span>
      <span className="flex gap-2 flex-wrap items-center">
        {categories.filter(c => c.count > 0).map(c => (
          <span key={c.id} className="bg-zinc-800/60 border border-border rounded px-2 py-0.5 text-text">
            <span className="mr-1">{c.icon}</span>
            <span>{c.count}</span>
            <span className="text-dim ml-1">{c.title.toLowerCase()}</span>
          </span>
        ))}
      </span>
      <Link href="/admin/queue" className="ml-auto text-blue hover:underline whitespace-nowrap">open queue →</Link>
    </div>
  );
}
