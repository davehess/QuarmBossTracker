// /db/faction/[id] — wpqdi faction detail (guild-gated).
//
// The per-character faction page (/character/[name]/factions) answers "where do
// I stand?". This is the other direction: "what IS this faction — who belongs to
// it, what raises or lowers it, and who starts out hating me?"
//
// Sources: eqemu_faction_list_full (base + caps), eqemu_faction_list_mod
// (race/class/deity starting modifiers), eqemu_npc_faction → eqemu_npc_types
// (the mobs that con on it), and scripted_npc_turnins.faction_changes (the
// quest turn-ins that move it).

import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { deUnderscore } from '@/lib/npcDecode';

export const dynamic = 'force-dynamic';

type Faction = { id: number; name: string; base: number | null; min_cap: number | null; max_cap: number | null };
type ModRow  = { mod: number | null; mod_name: string | null };
type NpcRow  = { id: number; name: string | null; level: number | null; raid_target: boolean | null };
type TurninRow = {
  id: number; npc_name: string | null; npc_id: number | null; zone_short: string | null;
  faction_changes: { faction_id: number; delta: number }[] | null;
};

export default async function DbFactionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const factionId = Number(id);
  if (!Number.isInteger(factionId) || factionId <= 0) notFound();

  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect(`/auth/signin?next=/db/faction/${factionId}`);

  const sb = supabaseAdmin();
  const { data: facData } = await sb.from('eqemu_faction_list_full')
    .select('id, name, base, min_cap, max_cap').eq('id', factionId).maybeSingle();
  const faction = facData as Faction | null;
  if (!faction) notFound();

  const [modRes, groupRes, turninRes] = await Promise.all([
    sb.from('eqemu_faction_list_mod').select('mod, mod_name').eq('faction_id', factionId).limit(200),
    sb.from('eqemu_npc_faction').select('id, name').eq('primaryfaction', factionId).limit(100),
    // Turn-ins whose faction_changes touch this faction. jsonb containment on
    // an array of objects: @> '[{"faction_id": N}]'.
    sb.from('scripted_npc_turnins')
      .select('id, npc_name, npc_id, zone_short, faction_changes')
      .filter('faction_changes', 'cs', JSON.stringify([{ faction_id: factionId }]))
      .limit(60),
  ]);

  const mods = ((modRes.data ?? []) as ModRow[])
    .filter(m => m.mod != null && m.mod !== 0)
    .sort((a, b) => (b.mod ?? 0) - (a.mod ?? 0));

  // Mobs that con on this faction, via their npc_faction group.
  const groupIds = ((groupRes.data ?? []) as { id: number }[]).map(g => g.id);
  let npcs: NpcRow[] = [];
  if (groupIds.length) {
    const { data: npcData } = await sb.from('eqemu_npc_types')
      .select('id, name, level, raid_target')
      .in('npc_faction_id', groupIds)
      .order('level', { ascending: false })
      .limit(80);
    npcs = (npcData ?? []) as NpcRow[];
  }

  const turnins = ((turninRes.data ?? []) as TurninRow[])
    .map(t => ({ ...t, delta: (t.faction_changes ?? []).find(f => f.faction_id === factionId)?.delta ?? 0 }))
    .filter(t => t.delta !== 0)
    .sort((a, b) => b.delta - a.delta);

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="text-sm text-dim">
        <Link href="/db" className="text-blue hover:underline">← database</Link>
        <span className="mx-2">·</span>
        <span className="text-dim/70">wpqdi · faction #{factionId}</span>
      </div>

      <section className="bg-panel border border-border rounded-lg p-4">
        <h1 className="text-xl text-gold">{faction.name}</h1>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-sm">
          {faction.base != null && <Stat k="Base">{faction.base}</Stat>}
          {faction.min_cap != null && <Stat k="Min">{faction.min_cap}</Stat>}
          {faction.max_cap != null && <Stat k="Max">{faction.max_cap}</Stat>}
        </div>
        <div className="mt-3 text-[11px]">
          <a href={`https://www.pqdi.cc/faction/${factionId}`} target="_blank" rel="noreferrer"
             className="text-blue hover:underline">View on PQDI ↗</a>
        </div>
      </section>

      {/* Starting modifiers — why a Troll SK cons differently than a High Elf. */}
      {mods.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h2 className="text-sm text-orange mb-2">Starting modifiers ({mods.length})</h2>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {mods.map((m, i) => (
              <span key={i} className="px-2 py-0.5 rounded bg-bg border border-border/60">
                <span className="text-text">{m.mod_name || '—'}</span>{' '}
                <span className={(m.mod ?? 0) > 0 ? 'text-green' : 'text-red-400'}>
                  {(m.mod ?? 0) > 0 ? `+${m.mod}` : m.mod}
                </span>
              </span>
            ))}
          </div>
          <p className="text-dim/60 text-[10px] mt-2">Applied to your starting standing by race, class or deity.</p>
        </section>
      )}

      {/* Turn-ins that move this faction */}
      {turnins.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h2 className="text-sm text-orange mb-2">Turn-ins that change it ({turnins.length})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-dim text-[10px] uppercase tracking-wide text-left">
                <th className="py-1 pr-3 font-normal">NPC</th>
                <th className="py-1 pr-3 font-normal">Zone</th>
                <th className="py-1 font-normal text-right">Change</th>
              </tr></thead>
              <tbody>
                {turnins.map(t => (
                  <tr key={t.id} className="border-t border-border/40">
                    <td className="py-1 pr-3">
                      {t.npc_id
                        ? <Link href={`/db/npc/${t.npc_id}`} className="text-text hover:text-blue hover:underline">{deUnderscore(t.npc_name)}</Link>
                        : <span className="text-text">{deUnderscore(t.npc_name)}</span>}
                    </td>
                    <td className="py-1 pr-3 text-dim">{t.zone_short || '—'}</td>
                    <td className={`py-1 text-right ${t.delta > 0 ? 'text-green' : 'text-red-400'}`}>
                      {t.delta > 0 ? `+${t.delta}` : t.delta}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Mobs on this faction */}
      <section className="bg-panel border border-border rounded-lg p-4">
        <h2 className="text-sm text-orange mb-2">Mobs on this faction {npcs.length ? `(${npcs.length}${npcs.length === 80 ? '+' : ''})` : ''}</h2>
        {npcs.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 text-sm">
            {npcs.map(n => (
              <Link key={n.id} href={`/db/npc/${n.id}`} className="flex items-baseline justify-between gap-2 px-2 py-0.5 rounded hover:bg-[#1a212c]">
                <span className="text-text truncate">{deUnderscore(n.name) || `NPC #${n.id}`}</span>
                <span className="text-dim text-[10px] shrink-0">
                  {n.raid_target ? <span className="text-red-400 uppercase mr-1">raid</span> : null}
                  {n.level ? `L${n.level}` : ''}
                </span>
              </Link>
            ))}
          </div>
        ) : <p className="text-dim text-xs">No mobs mapped to this faction in the mirror.</p>}
      </section>
    </div>
  );
}

function Stat({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-dim text-[10px] uppercase tracking-wide">{k}</span>
      <span className="text-right text-text">{children}</span>
    </div>
  );
}
