// /pvp/server — server-wide PvP top-10 killers, with the Wolf Pack mini-rivalry
// on every row. Complements the existing /pvp page (which is Wolf Pack-only).
//
// What you see per killer:
//   * total kills attributed to this character (across all guilds)
//   * how many of those landed on Wolf Pack victims  (their kills vs WP)
//   * how many times Wolf Pack has killed them back  (WP kills vs them)
//   * unique victims, last-kill recency
//
// Data source: the same `pvp_kills` table the rest of the app reads, fed by
// the agent's PvP-channel relay. PvP is exempt from the data floor (CLAUDE.md
// "Per-Character Data Floor") — these are public server events, counted from
// the very first kill we observed.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { userTz, fmtDateOnly } from '@/lib/timezone';
import VengeanceList from './VengeanceList';

export const dynamic = 'force-dynamic';

type VengeanceRow = {
  killer:         string;
  killer_guild:   string | null;
  killsAgainstWP: number;
  killsByWP:      number;
  vengeanceOwed:  number;
  lastWpVictimAt: string;
};

type KillRow = {
  killer:        string;
  killer_guild:  string | null;
  victim:        string;
  victim_guild:  string | null;
  via_pet:       boolean;
  killed_at:     string;
};

const WP_GUILD = 'Wolf Pack';
const TOP_N    = 10;

type ServerRow = {
  killer:         string;
  killer_guild:   string | null;
  total:          number;
  unique:         number;
  petKills:       number;
  last:           string;
  killsAgainstWP: number;   // they killed a Wolf Pack victim
  killsByWP:      number;   // a Wolf Pack member killed them
};

async function loadServerLeaderboard() {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('pvp_kills')
    .select('killer, killer_guild, victim, victim_guild, via_pet, killed_at')
    .eq('guild_id', 'wolfpack')
    .order('killed_at', { ascending: false })
    .limit(20000);
  if (error) return { rows: [], vengeance: [] as VengeanceRow[], totals: { kills: 0, wpKills: 0, wpDeaths: 0 }, error: error.message };

  // Two passes: aggregate every killer's row, and separately tally how many
  // times Wolf Pack killed each character (looking at THEM as victim).
  const byKiller = new Map<string, {
    killer: string; killer_guild: string | null;
    total: number; victims: Set<string>; petKills: number;
    last: string; killsAgainstWP: number;
    // Most-recent killed_at where THIS killer's victim was a Wolf Pack
    // member — drives the "Latest WP kill" column on the vengeance list.
    // Distinct from `last` (their most recent kill of anyone) because we
    // want to know when they last bloodied US, not just when they were
    // last active.
    lastWpVictimAt: string | null;
  }>();
  const killsByWPOnName = new Map<string, number>();   // lowercased name → count

  for (const k of (data ?? []) as KillRow[]) {
    const lk = k.killer.toLowerCase();
    let e = byKiller.get(lk);
    if (!e) {
      e = { killer: k.killer, killer_guild: k.killer_guild, total: 0, victims: new Set(),
            petKills: 0, last: k.killed_at, killsAgainstWP: 0, lastWpVictimAt: null };
      byKiller.set(lk, e);
    }
    e.total += 1;
    e.victims.add(k.victim.toLowerCase());
    if (k.via_pet) e.petKills += 1;
    if (k.killed_at > e.last) e.last = k.killed_at;
    // Most recent guild label wins — characters change guild over time and the
    // newest row reflects current affiliation.
    if (k.killed_at === e.last) e.killer_guild = k.killer_guild;
    if (k.victim_guild === WP_GUILD) {
      e.killsAgainstWP += 1;
      if (!e.lastWpVictimAt || k.killed_at > e.lastWpVictimAt) e.lastWpVictimAt = k.killed_at;
    }
    if (k.killer_guild === WP_GUILD) {
      const lv = k.victim.toLowerCase();
      killsByWPOnName.set(lv, (killsByWPOnName.get(lv) || 0) + 1);
    }
  }

  const all = [...byKiller.values()]
    .map<ServerRow>(e => ({
      killer:         e.killer,
      killer_guild:   e.killer_guild,
      total:          e.total,
      unique:         e.victims.size,
      petKills:       e.petKills,
      last:           e.last,
      killsAgainstWP: e.killsAgainstWP,
      killsByWP:      killsByWPOnName.get(e.killer.toLowerCase()) || 0,
    }))
    .sort((a, b) => b.total - a.total || b.unique - a.unique);

  const top = all.slice(0, TOP_N);

  // Vengeance list — every non-WP killer who's bloodied us, sorted by
  // outstanding debt (their kills vs WP minus WP kills back) descending,
  // then by recency of their last WP kill so fresher wounds rise. Targets
  // we've already evened or overshot fall to the bottom (debt = 0 is
  // still listed, since the user might want the "0 remaining" final
  // declaration when finishing the rivalry). Wolf Pack members are
  // excluded by definition.
  const vengeance: VengeanceRow[] = [...byKiller.values()]
    .filter(e => e.killer_guild !== WP_GUILD && e.killsAgainstWP > 0 && e.lastWpVictimAt)
    .map(e => {
      const killsByWP     = killsByWPOnName.get(e.killer.toLowerCase()) || 0;
      const vengeanceOwed = Math.max(0, e.killsAgainstWP - killsByWP);
      return {
        killer:         e.killer,
        killer_guild:   e.killer_guild,
        killsAgainstWP: e.killsAgainstWP,
        killsByWP,
        vengeanceOwed,
        lastWpVictimAt: e.lastWpVictimAt as string,
      };
    })
    .sort((a, b) =>
      b.vengeanceOwed - a.vengeanceOwed ||
      (b.lastWpVictimAt > a.lastWpVictimAt ? 1 : -1)
    );

  const totals = {
    kills:    (data ?? []).length,
    wpKills:  (data ?? []).filter((k: KillRow) => k.killer_guild === WP_GUILD).length,
    wpDeaths: (data ?? []).filter((k: KillRow) => k.victim_guild === WP_GUILD).length,
  };

  return { rows: top, vengeance, totals, error: null as string | null };
}

export default async function ServerPvpPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/pvp/server');

  const tz = await userTz();
  const { rows, vengeance, totals, error } = await loadServerLeaderboard();
  if (error) {
    return (
      <div className="bg-panel border border-red rounded-lg p-4 text-red text-sm font-mono">
        Failed to load server-wide PvP data: {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-2xl text-gold flex items-center gap-3">
          <span aria-hidden>🌍</span>
          <span>Server-wide PvP — Top {TOP_N}</span>
        </h2>
        <p className="text-sm text-dim mt-2">
          Everyone the agent has seen on the PvP channel, ranked by total kills.
          The two right-most columns are the Wolf Pack mini-rivalry: <span className="text-red-400">their kills vs us</span> and{' '}
          <span className="text-green">our kills vs them</span>.{' '}
          <Link href="/pvp" className="text-blue hover:underline">See the internal Wolf Pack board →</Link>
        </p>
        <div className="grid grid-cols-3 gap-3 mt-4 text-xs">
          <Stat label="Total kills observed"   value={totals.kills}   />
          <Stat label="Wolf Pack kills"        value={totals.wpKills} color="text-green" />
          <Stat label="Wolf Pack killed"       value={totals.wpDeaths} color="text-red-400" />
        </div>
      </section>

      <section className="bg-panel border border-border rounded-lg p-4">
        {rows.length === 0 ? (
          <div className="text-sm text-dim italic">
            No PvP kills recorded yet. Kills land here from the PvP-channel relay
            as the agent observes them.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-dim text-left">
              <tr className="border-b border-border">
                <th className="py-1 pr-2 w-8">#</th>
                <th className="py-1 pr-2">Killer</th>
                <th className="py-1 pr-2">Guild</th>
                <th className="py-1 pr-2 text-right">Kills <span className="text-dim/70">(unique)</span></th>
                <th className="py-1 pr-2 text-right" title="Their kills against Wolf Pack victims">
                  <span className="text-red-400">vs WP</span>
                </th>
                <th className="py-1 pr-2 text-right" title="Wolf Pack kills against this character">
                  <span className="text-green">WP vs them</span>
                </th>
                <th className="py-1 pr-2 text-right">Last kill</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isWolfPack = r.killer_guild === WP_GUILD;
                return (
                  <tr key={r.killer} className="border-b border-border/30 hover:bg-[#1a212c]">
                    <td className="py-1 pr-2 text-dim">{i + 1}</td>
                    <td className="py-1 pr-2">
                      <Link href={`/pvp/${encodeURIComponent(r.killer)}`} className={`hover:text-blue hover:underline ${isWolfPack ? 'text-blue' : 'text-text'}`}>
                        {r.killer}
                      </Link>
                      {r.petKills > 0 && (
                        <span className="text-orange ml-1" title={`${r.petKills} kill${r.petKills === 1 ? '' : 's'} by pet`}>*</span>
                      )}
                    </td>
                    <td className="py-1 pr-2 text-dim text-xs">
                      {r.killer_guild || <span className="italic">unguilded</span>}
                    </td>
                    <td className="py-1 pr-2 text-right text-text">
                      {r.total} <span className="text-dim">({r.unique})</span>
                    </td>
                    <td className="py-1 pr-2 text-right">
                      {r.killsAgainstWP > 0
                        ? <span className="text-red-400">{r.killsAgainstWP}</span>
                        : <span className="text-dim">—</span>}
                    </td>
                    <td className="py-1 pr-2 text-right">
                      {r.killsByWP > 0
                        ? <span className="text-green">{r.killsByWP}</span>
                        : <span className="text-dim">—</span>}
                    </td>
                    <td className="py-1 pr-2 text-right text-dim">
                      {fmtDateOnly(r.last, tz)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="bg-panel border border-border rounded-lg p-4">
        <h2 className="text-xl text-gold flex items-center gap-3">
          <span aria-hidden>⚖️</span>
          <span>Vengeance list</span>
        </h2>
        <p className="text-sm text-dim mt-2">
          Targets who&apos;ve killed Wolf Pack members, sorted by outstanding debt.
          Hit the <span className="font-mono">📋 copy</span> button right before you land the
          kill — it puts a line on your clipboard you can paste straight into EQ:
        </p>
        <p className="text-xs text-dim mt-1 font-mono italic">
          &quot;I have avenged a Wolf Pack member&apos;s death by your hand. N vengeance kills remaining&quot;
        </p>
        <p className="text-xs text-dim mt-1">
          N reflects the debt AFTER the kill you&apos;re about to land — so when it reads &quot;0
          remaining&quot;, you&apos;ve squared the score on that target.
        </p>
        <div className="mt-4">
          <VengeanceList rows={vengeance} />
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, color = 'text-text' }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-bg border border-border rounded p-3">
      <div className={`text-2xl ${color}`}>{value.toLocaleString()}</div>
      <div className="text-dim text-xs">{label}</div>
    </div>
  );
}
