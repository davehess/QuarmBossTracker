// /admin/lockouts — loot lockouts our raiders are carrying, split by whether
// the kill was OURS.
//
// Hitya 2026-08-21: "several raiders have spent time with Breakfast Club doing
// raids on alts. we need to remain vigilant about these not being included, but
// also capture loot lockouts for raid mobs when they don't occur with our
// guild — put those into another admin section."
//
// Two different jobs, deliberately kept apart:
//   • Foreign RAIDS stay out of our numbers — /admin/anomalies owns that, and
//     /parses already auto-hides them.
//   • Foreign LOCKOUTS are the opposite: they must be CAPTURED, because they
//     bind us. Someone who killed a boss with another guild on Tuesday cannot
//     loot it on our Sunday. We were reading /sll only to nudge boss timers and
//     throwing the rest away.
//
// `ours` is three-state on purpose (bot: _handleAgentLockout). true = lines up
// with a kill on our board; false = we have a kill and it does NOT line up, so
// it happened elsewhere; null = we have no kill of that boss at all, so we
// genuinely cannot say. Null is shown as "unknown", never as an accusation —
// it is usually just a boss we don't track.
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { userTz, fmtAbs } from '@/lib/timezone';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Loot lockouts — Wolf Pack admin' };

type Row = {
  character: string; boss_key: string; boss_name: string;
  expires_at: string; implied_kill_at: string | null;
  ours: boolean | null; observed_at: string; observed_by: string | null;
};

function Section({
  title, blurb, rows, tz, tone,
}: { title: string; blurb: string; rows: Row[]; tz: string; tone: string }) {
  return (
    <section className="bg-panel border border-border rounded-lg p-4">
      <h2 className={`text-sm mb-1 ${tone}`}>{title} ({rows.length})</h2>
      <p className="text-xs text-dim mb-3 max-w-3xl leading-5">{blurb}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-dim">None.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-dim text-xs text-left">
              <th className="py-1 pr-3">Character</th>
              <th className="py-1 pr-3">Boss</th>
              <th className="py-1 pr-3">Locked until</th>
              <th className="py-1 pr-3">Implied kill</th>
              <th className="py-1 pr-3">Seen by</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {rows.map(r => (
              <tr key={`${r.character}|${r.boss_key}|${r.expires_at}`} className="hover:bg-[#1a212c]">
                <td className="py-1.5 pr-3">
                  <Link href={`/character/${encodeURIComponent(r.character)}`} className="text-blue hover:underline">{r.character}</Link>
                </td>
                <td className="py-1.5 pr-3 text-text">{r.boss_name}</td>
                <td className="py-1.5 pr-3 text-dim">{fmtAbs(r.expires_at, tz)}</td>
                <td className="py-1.5 pr-3 text-dim">{r.implied_kill_at ? fmtAbs(r.implied_kill_at, tz) : '—'}</td>
                <td className="py-1.5 pr-3 text-dim text-xs">{r.observed_by ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default async function LockoutsPage() {
  const sb = supabaseAdmin();
  const tz = await userTz();
  // Only lockouts that are still BINDING — an expired one is history, and the
  // question this page answers ("can they loot it with us?") is about now.
  const { data } = await sb
    .from('character_lockouts')
    .select('character, boss_key, boss_name, expires_at, implied_kill_at, ours, observed_at, observed_by')
    .eq('guild_id', 'wolfpack')
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: true })
    .limit(500);
  const rows = (data ?? []) as Row[];
  const foreign = rows.filter(r => r.ours === false);
  const unknown = rows.filter(r => r.ours === null);
  const ours    = rows.filter(r => r.ours === true);

  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-5">
        <h1 className="text-xl text-gold">🔒 Loot lockouts</h1>
        <p className="text-sm text-dim mt-1 max-w-3xl leading-6">
          Who is currently locked out of which raid boss, from the <code>/sll</code> relay. The point of the
          split is the first section: a raider who killed a boss with <b className="text-text">another guild</b>{' '}
          still can&apos;t loot it on ours, and until now we read those relays only to nudge boss timers and threw
          the rest away. Foreign <i>raids</i> are a different problem and stay on{' '}
          <Link href="/admin/anomalies" className="text-blue hover:underline">Anomalies</Link> — they are kept out
          of our parses; these are kept <i>in</i>, on purpose.
        </p>
      </section>

      <Section
        title="⚠ Locked from a kill that wasn't ours"
        tone="text-orange"
        blurb="We have a kill of this boss on the board and their lockout does NOT line up with it — so they got it somewhere else. They cannot loot this boss on our raid until it expires."
        rows={foreign} tz={tz}
      />
      <Section
        title="❔ Unknown"
        tone="text-dim"
        blurb="We have no kill of this boss on our board at all, so we can't say whose it was. Usually just a boss we don't track — not evidence of anything."
        rows={unknown} tz={tz}
      />
      <Section
        title="✓ From our own raids"
        tone="text-green"
        blurb="Lines up with a Wolf Pack kill. Here for completeness — this is the expected case."
        rows={ours} tz={tz}
      />
    </div>
  );
}
