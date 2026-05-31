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
  killer_guild: string | null;
  victim: string;
  via_pet: boolean;
  killed_at: string;
};

const WP_GUILD = 'Wolf Pack';

async function loadLeaderboard() {
  const sb = supabaseAdmin();
  // Pull every kill credited to a Wolf Pack killer. PvP kills are rare, so
  // aggregating in JS is fine (matches the chat-browser approach).
  const { data, error } = await sb
    .from('pvp_kills')
    .select('killer, killer_guild, victim, via_pet, killed_at')
    .eq('guild_id', 'wolfpack')
    .eq('killer_guild', WP_GUILD)
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

export default async function PvpPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/pvp');

  const tz = await userTz();
  const { rows, error } = await loadLeaderboard();
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
    </div>
  );
}
