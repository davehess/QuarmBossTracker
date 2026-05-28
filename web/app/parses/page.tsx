// Raid parse history — server component; uses service-role key so RLS on
// encounters / encounter_players doesn't block the read.
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type NpcInfo      = { name: string };
type PlayerRow    = { character_name: string; total_damage: number; dps: number; rank: number | null };
type EncounterRow = {
  id: string;
  started_at: string;
  duration_sec: number | null;
  total_damage: number;
  total_dps: number;
  eqemu_npc_types: NpcInfo | null;
  encounter_players: PlayerRow[];
};

async function loadRecentParses(): Promise<{ rows: EncounterRow[]; error: string | null }> {
  try {
    const { data, error } = await supabaseAdmin()
      .from('encounters')
      .select(`
        id, started_at, duration_sec, total_damage, total_dps,
        eqemu_npc_types ( name ),
        encounter_players ( character_name, total_damage, dps, rank )
      `)
      .order('started_at', { ascending: false })
      .limit(30);
    if (error) return { rows: [], error: error.message };
    return { rows: (data as EncounterRow[]) ?? [], error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { rows: [], error: msg };
  }
}

function fmtDmg(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export default async function ParsesPage() {
  const { rows, error } = await loadRecentParses();

  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">📊 Recent Boss Kills</h2>
        <p className="text-sm text-dim">Last 30 encounters from the parse pipeline.</p>
      </section>

      <section className="bg-panel border border-border rounded-lg p-6">
        {error && (
          <div className="text-red text-sm font-mono mb-4">Error: {error}</div>
        )}
        {!error && rows.length === 0 && (
          <div className="text-dim text-sm">
            No encounters recorded yet. Run <code>/parse</code> in Discord after a kill,
            or make sure the wolfpack-logsync agent is running.
          </div>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-dim uppercase text-xs">
                <tr>
                  <th className="text-left py-2 pr-4">Boss</th>
                  <th className="text-left py-2 pr-4">Date</th>
                  <th className="text-right py-2 pr-4">Duration</th>
                  <th className="text-right py-2 pr-4">Raid DMG</th>
                  <th className="text-right py-2 pr-4">Raid DPS</th>
                  <th className="text-left py-2">Top Players</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const bossName = r.eqemu_npc_types?.name ?? '—';
                  const topPlayers = [...(r.encounter_players ?? [])]
                    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
                    .slice(0, 3);
                  return (
                    <tr key={r.id} className="border-t border-border hover:bg-[#1f242c]">
                      <td className="py-2 pr-4 font-medium text-gold">{bossName}</td>
                      <td className="py-2 pr-4 text-dim text-xs">{fmtDate(r.started_at)}</td>
                      <td className="py-2 pr-4 text-right text-dim">
                        {r.duration_sec != null ? `${r.duration_sec}s` : '—'}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {r.total_damage ? fmtDmg(r.total_damage) : '—'}
                      </td>
                      <td className="py-2 pr-4 text-right text-dim">
                        {r.total_dps ? `${r.total_dps}/s` : '—'}
                      </td>
                      <td className="py-2 text-xs text-dim">
                        {topPlayers.length > 0
                          ? topPlayers.map((p, i) => (
                              <span key={p.character_name}>
                                {i > 0 && <span className="mx-1 opacity-40">·</span>}
                                <span className="text-white">{p.character_name}</span>
                                {' '}
                                <span className="opacity-60">{fmtDmg(p.total_damage)}</span>
                              </span>
                            ))
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
