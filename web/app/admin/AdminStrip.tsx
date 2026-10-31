// The context strip at the top of every admin pane in the sidebar preview (DECISIONS §493): tonight's raid, who is locked
// out, how many agents are uploading, how much feedback is new, each a link to the page that holds the detail. Static
// HTML over the same cached facts as the sidebar (lib/adminShellFacts.ts); a number that could not be read is left off
// rather than shown as zero.
import Link from 'next/link';
import type { AdminFacts } from '@/lib/adminShellFacts';

const CHIP = 'inline-flex items-center rounded-full border px-3 py-1 text-xs no-underline whitespace-nowrap';
const COOL = `${CHIP} border-blue/50 bg-blue/10 text-blue hover:border-blue`;
const WARM = `${CHIP} border-orange/60 bg-orange/10 text-orange hover:border-orange`;

export function tonightChip(t: AdminFacts['tonight']): { text: string; href: string } | null {
  if (!t) return null;
  if (t.kind === 'live') return { text: `${t.zone ?? 'Raid in progress'} · ${t.raiders} in`, href: '/raid' };
  if (t.kind === 'event') return { text: `${t.title} · ${t.when}`, href: '/admin/signups' };
  return { text: 'no raid tonight', href: '/admin/signups' };
}

export default function AdminStrip({ facts }: { facts: AdminFacts }) {
  const tonight = tonightChip(facts.tonight);
  return (
    <div data-admin-strip className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-dim">Tonight:</span>
      {tonight && <Link href={tonight.href} className={COOL}>{tonight.text}</Link>}
      {facts.lockedOut != null && (
        <Link href="/admin/lockouts" className={facts.lockedOut > 0 ? WARM : COOL}>{facts.lockedOut} locked out →</Link>
      )}
      {facts.agents != null && (
        <Link href="/admin/agents" className={COOL}>agents {facts.agents.up}/{facts.agents.total} →</Link>
      )}
      {facts.newFeedback != null && (
        <Link href="/admin/feedback" className={facts.newFeedback > 0 ? WARM : COOL}>{facts.newFeedback} new feedback →</Link>
      )}
    </div>
  );
}
