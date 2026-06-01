// /leaderboards — guild-wide top tables.
//   - Top damage (single encounter) over a configurable window
//   - Top damage taken (proxy for tank "purple club") — biggest fights tanks
//     survived without dying
//   - Most loot DKP spent
//   - Most raids attended
//
// Each section is a server-side aggregation. Numbers are best across a window
// rather than season totals so the page reads as "who's been crushing it lately."

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { fmtDmg, fmtDuration, fmtDkp, cleanBossName } from '@/lib/format';

export const dynamic = 'force-dynamic';

const WINDOW_DAYS = 30;

type TopDamageRow = {
  encounter_id: string;
  character_name: string;
  total_damage: number;
  dps: number;
  duration_sec: number | null;
  encounters: { id: string; started_at: string; eqemu_npc_types: { name: string } | null } | null;
};

type AttendanceRow = {
  character_name: string;
  raids_attended: number;
  last_30d: number;
  last_90d: number;
};

type LootSpend = { character_name: string; total_dkp: number; items: number };

async function load() {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - WINDOW_DAYS * 86400 * 1000).toISOString();

  // 1. Top damage parses in the window — pull encounter_players joined with
  // encounters. Sorted desc, cut to top 30 to keep payload reasonable.
  const { data: dmgRaw } = await sb
    .from('encounter_players')
    .select(`
      encounter_id, character_name, total_damage, dps, duration_sec,
      encounters!inner ( id, started_at, eqemu_npc_types ( name ) )
    `)
    .gte('encounters.started_at', since)
    .gt('total_damage', 0)
    .order('total_damage', { ascending: false })
    .limit(30);
  const topDamage = (dmgRaw as unknown as TopDamageRow[]) ?? [];

  // 2. Attendance: top 20 by last_30d ticks.
  const { data: attendanceRaw } = await sb
    .from('opendkp_attendance_recent')
    .select('character_name, raids_attended, last_30d, last_90d')
    .order('last_30d', { ascending: false })
    .limit(20);
  const attendance = (attendanceRaw as AttendanceRow[]) ?? [];

  // 3. Loot spend: aggregate from opendkp_loot_recent by character. Postgres
  // does the heavy lifting via a single fetch + JS sum since the view doesn't
  // expose a per-character rollup natively.
  const { data: lootRaw } = await sb
    .from('opendkp_loot_recent')
    .select('character_name, dkp')
    .gte('raid_date', since.slice(0, 10));
  const lootByChar = new Map<string, { total_dkp: number; items: number }>();
  for (const r of (lootRaw ?? []) as { character_name: string; dkp: number }[]) {
    const k = r.character_name;
    const existing = lootByChar.get(k) || { total_dkp: 0, items: 0 };
    existing.total_dkp += r.dkp || 0;
    existing.items     += 1;
    lootByChar.set(k, existing);
  }
  const lootSpend: LootSpend[] = [...lootByChar.entries()]
    .map(([character_name, v]) => ({ character_name, total_dkp: v.total_dkp, items: v.items }))
    .sort((a, b) => b.total_dkp - a.total_dkp)
    .slice(0, 20);

  return { topDamage, attendance, lootSpend };
}

export default async function LeaderboardsPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/leaderboards');

  const { topDamage, attendance, lootSpend } = await load();

  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">🏆 Leaderboards</h2>
        <p className="text-sm text-dim">
          Last {WINDOW_DAYS} days. Updates as new parses land and OpenDKP sync
          completes (every 6h, or manually via <code>/syncopendkp</code>).
        </p>
      </section>

      {/* Top damage parses */}
      <section className="bg-panel border border-border rounded-lg p-4">
        <h3 className="text-sm text-blue mb-3 flex items-center gap-2">
          <span aria-hidden>⚔️</span>
          <span>Top damage — single encounter</span>
          <span className="text-dim text-xs">· top 30 in the window</span>
        </h3>
        <table className="w-full text-xs">
          <thead className="text-dim text-left">
            <tr className="border-b border-border">
              <th className="py-1 pr-2 w-8">#</th>
              <th className="py-1 pr-2">Character</th>
              <th className="py-1 pr-2">Boss</th>
              <th className="py-1 pr-2 text-right">Damage</th>
              <th className="py-1 pr-2 text-right">DPS</th>
              <th className="py-1 pr-2 text-right">Duration</th>
            </tr>
          </thead>
          <tbody>
            {topDamage.map((p, i) => (
              <tr key={p.encounter_id + p.character_name} className="border-b border-border/30 hover:bg-[#1a212c]">
                <td className="py-1 pr-2 text-dim">{i + 1}</td>
                <td className="py-1 pr-2 text-text">
                  <Link href={`/character/${encodeURIComponent(p.character_name)}`} className="hover:text-blue hover:underline">
                    {p.character_name}
                  </Link>
                </td>
                <td className="py-1 pr-2 text-dim">
                  {p.encounters?.id ? (
                    <Link href={`/parses/${p.encounters.id}`} className="hover:text-blue hover:underline">
                      {cleanBossName(p.encounters.eqemu_npc_types?.name)}
                    </Link>
                  ) : '?'}
                </td>
                <td className="py-1 pr-2 text-right text-gold">{fmtDmg(p.total_damage)}</td>
                <td className="py-1 pr-2 text-right text-dim">{p.dps ? `${fmtDmg(p.dps)}/s` : '—'}</td>
                <td className="py-1 pr-2 text-right text-dim">{fmtDuration(p.duration_sec)}</td>
              </tr>
            ))}
            {topDamage.length === 0 && (
              <tr><td colSpan={6} className="py-2 text-dim italic">No parses in the last {WINDOW_DAYS} days.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Attendance */}
        <section className="bg-panel border border-border rounded-lg p-4">
          <h3 className="text-sm text-orange mb-3 flex items-center gap-2">
            <span aria-hidden>📅</span>
            <span>Most raids attended</span>
            <span className="text-dim text-xs">· last 30 days</span>
          </h3>
          <ol className="text-xs space-y-0.5">
            {attendance.map((a, i) => (
              <li key={a.character_name} className="flex justify-between gap-2 border-b border-border/30 py-0.5">
                <span className="flex items-center gap-2">
                  <span className="text-dim w-5 text-right">{i + 1}.</span>
                  <Link href={`/character/${encodeURIComponent(a.character_name)}`} className="text-text hover:text-blue hover:underline">
                    {a.character_name}
                  </Link>
                </span>
                <span className="text-orange whitespace-nowrap">
                  {a.last_30d} <span className="text-dim text-[10px]">/ {a.raids_attended} lifetime</span>
                </span>
              </li>
            ))}
            {attendance.length === 0 && (
              <li className="text-dim italic">No OpenDKP attendance data yet.</li>
            )}
          </ol>
        </section>

        {/* Loot spend */}
        <section className="bg-panel border border-border rounded-lg p-4">
          <h3 className="text-sm text-gold mb-3 flex items-center gap-2">
            <span aria-hidden>💰</span>
            <span>Biggest spenders</span>
            <span className="text-dim text-xs">· DKP spent, last 30 days</span>
          </h3>
          <ol className="text-xs space-y-0.5">
            {lootSpend.map((l, i) => (
              <li key={l.character_name} className="flex justify-between gap-2 border-b border-border/30 py-0.5">
                <span className="flex items-center gap-2">
                  <span className="text-dim w-5 text-right">{i + 1}.</span>
                  <Link href={`/character/${encodeURIComponent(l.character_name)}`} className="text-text hover:text-blue hover:underline">
                    {l.character_name}
                  </Link>
                </span>
                <span className="text-gold whitespace-nowrap">
                  {fmtDkp(l.total_dkp)} <span className="text-dim text-[10px]">· {l.items} items</span>
                </span>
              </li>
            ))}
            {lootSpend.length === 0 && (
              <li className="text-dim italic">No loot data yet — run /syncopendkp on the bot.</li>
            )}
          </ol>
        </section>
      </div>
    </div>
  );
}
