// Compact "needs review" banner injected at the top of every admin page via
// the admin layout: ONE line, "🛠 Review queue · N to check" and an open link. The per-check breakdown
// sits behind the native <details> (the guild lead, 2026-11-01: "looks terrible with this being
// verbose"). Server component — runs the same loader as the queue page; the heaviest query is
// bounded (last 14d chat).

import Link from 'next/link';
import { loadAdminQueue } from '@/lib/admin-queue';
import { queueBannerLabel } from '@/lib/adminQueueData';

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

  const open = categories.filter(c => c.count > 0);
  return (
    <div className="bg-panel border border-amber-700/50 rounded-lg px-3 py-2 mb-4 flex items-start gap-3 text-xs">
      <details className="flex-1 min-w-0">
        <summary className="cursor-pointer text-amber-400 font-semibold" title={open.map(c => `${c.count} ${c.title.toLowerCase()}`).join('\n')}>
          {queueBannerLabel(total)}
        </summary>
        <ul className="mt-1 space-y-0.5 text-text">
          {open.map(c => (
            <li key={c.id}>
              <span className="mr-1">{c.icon}</span>{c.count} <span className="text-dim">{c.title.toLowerCase()}</span>
            </li>
          ))}
        </ul>
      </details>
      <Link href="/admin/queue" className="text-blue hover:underline whitespace-nowrap">open →</Link>
    </div>
  );
}
