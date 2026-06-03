// /pvp — PvP kill leaderboard. One row per Wolf Pack killer: total kills
// (raw) and, in parens, the number of UNIQUE victims. Pet kills are credited
// to the owner with an asterisk on the row.
//
// Deaths (how often a killer has BEEN killed) are deliberately NOT shown here
// — that's private to the logged-in owner on their own /pvp/[name] page.
//
// Data comes from pvp_kills, fed live by the PvP Druzzil broadcast relay and
// (later) historical log backfill.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { userTz, fmtDateOnly } from '@/lib/timezone';

export const dynamic = 'force-dynamic';

type KillRow = {
  killer: string;
  victim: string;
  via_pet: boolean;
  killed_at: string;
};

async function loadLeaderboard() {
  const sb = supabaseAdmin();
  // Ownership = "is the killer currently a Wolf Pack character", NOT "was the
  // killer's pvp_kills.killer_guild equal to 'Wolf Pack' at the time of the
  // broadcast". Older broadcasts had no guild suffix and members who
  // transferred IN from other guilds carry their prior guild on their old
  // rows — both cases would silently drop from the leaderboard otherwise.
  // (Concrete example: Malthur, 218 kills, 144 stamped 'Wolf Pack', 62 stamped
  // his prior guild Tranquility, 12 NULL — the broken filter showed 144 then
  // 73 once a partial fetch landed.) Filter by roster membership instead.
  const { data: roster } = await sb
    .from('characters')
    .select('name')
    .eq('guild_id', 'wolfpack');
  const rosterNames = (roster ?? []).map(r => (r as { name: string }).name);
  if (rosterNames.length === 0) return { rows: [], error: null as string | null };

  const { data, error } = await sb
    .from('pvp_kills')
    .select('killer, victim, via_pet, killed_at')
    .eq('guild_id', 'wolfpack')
    .in('killer', rosterNames)
    .order('killed_at', { ascending: false })
    .limit(20000);
  if (error) return { rows: [], error: error.message };

  const byKiller = new Map<string, {
    killer: string;
    total: number;
    victims: Set<string>;
    petKills: number;
    last: string;
  }>();
  for (const k of (data ?? []) as KillRow[]) {
    const key = k.killer.toLowerCase();
    let e = byKiller.get(key);
    if (!e) { e = { killer: k.killer, total: 0, victims: new Set(), petKills: 0, last: k.killed_at }; byKiller.set(key, e); }
    e.total += 1;
    e.victims.add(k.victim.toLowerCase());
    if (k.via_pet) e.petKills += 1;
    if (k.killed_at > e.last) e.last = k.killed_at;
  }
  const rows = [...byKiller.values()]
    .map(e => ({ killer: e.killer, total: e.total, unique: e.victims.size, petKills: e.petKills, last: e.last }))
    .sort((a, b) => b.total - a.total || b.unique - a.unique);
  return { rows, error: null as string | null };
}

// Latest kill per boss (dedup by boss_id, keep the most recent killed_at). The
// bot mirrors every Druzzil-broadcast PvP-server boss kill into pvp_boss_kills
// with the +/-20% spawn window baked into spawn_earliest / spawn_latest. We
// pull a generous slice (last 90 days, sorted newest-first) and collapse in JS
// so we always show the latest known timer per boss — no stale display when
// the same boss was killed twice in the window.
type BossKill = {
  boss_id: string;
  boss_name: string;
  zone: string | null;
  timer_hours: number;
  killed_at: string;
  killed_by: string | null;
  killed_by_guild: string | null;
  spawn_earliest: string;
  spawn_latest: string;
};
async function loadBossTimers(): Promise<BossKill[]> {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const { data } = await sb
    .from('pvp_boss_kills')
    .select('boss_id, boss_name, zone, timer_hours, killed_at, killed_by, killed_by_guild, spawn_earliest, spawn_latest')
    .eq('guild_id', 'wolfpack')
    .gte('killed_at', since)
    .order('killed_at', { ascending: false })
    .limit(2000);
  const seen = new Set<string>();
  const out: BossKill[] = [];
  for (const r of (data ?? []) as BossKill[]) {
    if (seen.has(r.boss_id)) continue;
    seen.add(r.boss_id);
    out.push(r);
  }
  // Sort by spawn_earliest ascending → "soonest spawns first" up top, then
  // "already-open" rows (spawn_latest passed) drop to the bottom.
  const now = Date.now();
  out.sort((a, b) => {
    const aOpen = new Date(a.spawn_latest).getTime() < now;
    const bOpen = new Date(b.spawn_latest).getTime() < now;
    if (aOpen !== bOpen) return aOpen ? 1 : -1;
    return new Date(a.spawn_earliest).getTime() - new Date(b.spawn_earliest).getTime();
  });
  return out;
}

function fmtCountdown(toIso: string, fromMs: number = Date.now()): string {
  const diff = new Date(toIso).getTime() - fromMs;
  const abs  = Math.abs(diff);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0 || d > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return (diff < 0 ? '-' : '') + parts.join(' ');
}

export default async function PvpPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/pvp');

  const tz = await userTz();
  const [{ rows, error }, bossTimers] = await Promise.all([
    loadLeaderboard(),
    loadBossTimers(),
  ]);
  if (error) {
    return (
      <div className="bg-panel border border-red rounded-lg p-4 text-red text-sm font-mono">
        Failed to load PvP data: {error}
      </div>
    );
  }

  const totalKills = rows.reduce((s, r) => s + r.total, 0);

  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-2xl text-gold flex items-center gap-3">
          <span aria-hidden>⚔️</span>
          <span>PvP Kills</span>
        </h2>
        <p className="text-sm text-dim mt-2">
          Wolf Pack PvP kill leaderboard. Each row shows total kills and, in
          parentheses, the number of unique players killed. <span className="text-orange">*</span> marks
          rows where a pet landed the kill (credited to the owner). Click a name
          for the full kill history — your own deaths are visible only to you.
        </p>
        <div className="text-xs text-dim mt-2 flex items-center gap-3 flex-wrap">
          <span>{rows.length} killer{rows.length === 1 ? '' : 's'} · {totalKills} total kill{totalKills === 1 ? '' : 's'}</span>
          <Link href="/pvp/server" className="text-blue hover:underline">See the server-wide top 10 →</Link>
        </div>
      </section>

      <section className="bg-panel border border-border rounded-lg p-4">
        {rows.length === 0 ? (
          <div className="text-sm text-dim italic">
            No PvP kills recorded yet. Kills land here from the PvP channel relay
            as they happen (and from historical log backfill once that runs).
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-dim text-left">
              <tr className="border-b border-border">
                <th className="py-1 pr-2 w-8">#</th>
                <th className="py-1 pr-2">Killer</th>
                <th className="py-1 pr-2 text-right">Kills (unique)</th>
                <th className="py-1 pr-2 text-right">Last kill</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.killer} className="border-b border-border/30 hover:bg-[#1a212c]">
                  <td className="py-1 pr-2 text-dim">{i + 1}</td>
                  <td className="py-1 pr-2">
                    <Link href={`/pvp/${encodeURIComponent(r.killer)}`} className="text-text hover:text-blue hover:underline">
                      {r.killer}
                    </Link>
                    {r.petKills > 0 && (
                      <span className="text-orange ml-1" title={`${r.petKills} kill${r.petKills === 1 ? '' : 's'} by pet`}>*</span>
                    )}
                  </td>
                  <td className="py-1 pr-2 text-right text-text">
                    {r.total} <span className="text-dim">({r.unique})</span>
                  </td>
                  <td className="py-1 pr-2 text-right text-dim">
                    {fmtDateOnly(r.last, tz)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Boss timers — PvP-server spawn windows fed by the bot from Druzzil
          broadcasts and manual /pvpkill. Sorted soonest-spawning first; rows
          where the spawn window is already open drop to the bottom. */}
      {bossTimers.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-6">
          <h2 className="text-xl text-gold flex items-center gap-3">
            <span aria-hidden>⏰</span>
            <span>PvP Boss Timers</span>
          </h2>
          <p className="text-sm text-dim mt-2">
            Respawn windows for PvP-server bosses with a ±20% variance applied
            to the base timer. Fed live by Druzzil broadcasts in <code className="text-text">#pvp</code> and by
            manual <code className="text-text">/pvpkill</code>. Sorted by earliest spawn; rows whose window has
            already opened drop to the bottom (mob is in <span className="text-green">camp now</span>).
          </p>
          <div className="text-xs text-dim mt-2">
            {bossTimers.length} boss{bossTimers.length === 1 ? '' : 'es'} tracked · last kill {fmtDateOnly(bossTimers[0].killed_at, tz)}
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-dim text-left">
                <tr className="border-b border-border">
                  <th className="py-1 pr-2">Boss</th>
                  <th className="py-1 pr-2">Zone</th>
                  <th className="py-1 pr-2 text-right">Killed</th>
                  <th className="py-1 pr-2 text-right">Earliest spawn</th>
                  <th className="py-1 pr-2 text-right">Latest spawn</th>
                  <th className="py-1 pr-2">Killed by</th>
                </tr>
              </thead>
              <tbody>
                {bossTimers.map(b => {
                  const now = Date.now();
                  const earliestMs = new Date(b.spawn_earliest).getTime();
                  const latestMs   = new Date(b.spawn_latest).getTime();
                  const isOpen    = latestMs   < now;          // window already passed → mob is up
                  const inWindow  = earliestMs <= now && !isOpen; // spawning now-ish
                  const colorEarliest = inWindow ? 'text-orange' : isOpen ? 'text-green' : 'text-text';
                  return (
                    <tr key={b.boss_id} className="border-b border-border/30 hover:bg-[#1a212c]">
                      <td className="py-1 pr-2 text-text">{b.boss_name}</td>
                      <td className="py-1 pr-2 text-dim">{b.zone ?? '—'}</td>
                      <td className="py-1 pr-2 text-right text-dim">{fmtDateOnly(b.killed_at, tz)}</td>
                      <td className={`py-1 pr-2 text-right ${colorEarliest}`}>
                        {isOpen ? (
                          <span title="Spawn window already opened — mob may be up">camp now</span>
                        ) : inWindow ? (
                          <span title={`window opened ${fmtCountdown(b.spawn_earliest)} ago`}>open · {fmtCountdown(b.spawn_earliest)}</span>
                        ) : (
                          <span title={new Date(b.spawn_earliest).toLocaleString()}>in {fmtCountdown(b.spawn_earliest)}</span>
                        )}
                      </td>
                      <td className="py-1 pr-2 text-right text-dim" title={new Date(b.spawn_latest).toLocaleString()}>
                        {isOpen ? 'opened' : `+${fmtCountdown(b.spawn_latest, earliestMs)}`}
                      </td>
                      <td className="py-1 pr-2 text-dim">
                        {b.killed_by
                          ? <>{b.killed_by}{b.killed_by_guild ? <span className="text-dim/70"> of &lt;{b.killed_by_guild}&gt;</span> : null}</>
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
