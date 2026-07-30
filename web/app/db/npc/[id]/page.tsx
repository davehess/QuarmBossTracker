// /db/npc/[id] — wpqdi bestiary page (guild-gated). Re-expresses the bot's
// mob-info resolver (index.js:10890+) against Supabase, and adds the thing PQDI
// has that we now do too: SPAWN LOCATIONS (zone + coords + respawn + placeholder
// chance) from the eqemu_spawnentry → eqemu_spawn2 join. Plus stats, loot,
// special abilities, castable spells, faction, and a link to OUR kill history.

import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { MOB_CLASS_NAMES, decodeMobSpecials, deUnderscore } from '@/lib/npcDecode';
import { ERA_LABEL } from '@/lib/itemDecode';

export const dynamic = 'force-dynamic';

type Npc = {
  id: number; name: string | null; lastname: string | null; level: number | null;
  race: number | null; class: number | null; hp: number | null; mana: number | null; ac: number | null;
  mindmg: number | null; maxdmg: number | null;
  mr: number | null; cr: number | null; dr: number | null; fr: number | null; pr: number | null;
  see_invis: number | null; see_invis_undead: number | null; runspeed: number | null;
  npc_spells_id: number | null; loottable_id: number | null; npc_faction_id: number | null;
  raid_target: boolean | null; rare_spawn: number | null; respawn_seconds: number | null;
  special_abilities: string | null; npcspecialattks: string | null;
};
type SpawnPoint = { zone_short: string | null; x: number; y: number; z: number; respawntime: number | null; chance: number };
type ZoneRow = { short_name: string; long_name: string | null; expansion: number | null };

const NPC_COLS =
  'id, name, lastname, level, race, class, hp, mana, ac, mindmg, maxdmg, mr, cr, dr, fr, pr,' +
  ' see_invis, see_invis_undead, runspeed, npc_spells_id, loottable_id, npc_faction_id,' +
  ' raid_target, rare_spawn, respawn_seconds, special_abilities, npcspecialattks';

function fmtRespawn(s: number | null): string {
  if (!s || s <= 0) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

export default async function DbNpcPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const npcId = Number(id);
  if (!Number.isInteger(npcId) || npcId <= 0) notFound();

  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect(`/auth/signin?next=/db/npc/${npcId}`);

  const sb = supabaseAdmin();
  const { data: npcData } = await sb.from('eqemu_npc_types').select(NPC_COLS).eq('id', npcId).maybeSingle();
  const npc = npcData as Npc | null;
  if (!npc) notFound();

  // Independent lookups in parallel.
  const [spawnEntryRes, dropRes, npcFacRes, turninRes] = await Promise.all([
    sb.from('eqemu_spawnentry').select('spawngroup_id, chance').eq('npc_id', npcId).limit(200),
    sb.from('eqemu_npc_drops').select('item_id, item_name, effective_chance, lore_flag').eq('npc_id', npcId).limit(300),
    npc.npc_faction_id
      ? sb.from('eqemu_npc_faction').select('primaryfaction').eq('id', npc.npc_faction_id).maybeSingle()
      : Promise.resolve({ data: null }),
    // Quest turn-ins this NPC accepts (from the server's quest scripts).
    sb.from('scripted_npc_turnins')
      .select('id, inputs, outputs, cash, exp_award')
      .eq('npc_id', npcId).eq('is_duplicate', false).limit(40),
  ]);

  // ── Spawn locations: spawnentry (chance per group) → spawn2 (coords) ─────────
  const chanceByGroup = new Map<number, number>();
  for (const e of ((spawnEntryRes.data ?? []) as { spawngroup_id: number; chance: number }[])) {
    chanceByGroup.set(e.spawngroup_id, Math.max(chanceByGroup.get(e.spawngroup_id) ?? 0, e.chance ?? 0));
  }
  let spawns: SpawnPoint[] = [];
  if (chanceByGroup.size) {
    const { data: pts } = await sb.from('eqemu_spawn2')
      .select('spawngroup_id, zone_short, x, y, z, respawntime')
      .in('spawngroup_id', [...chanceByGroup.keys()]).limit(300);
    const seen = new Set<string>();
    for (const p of ((pts ?? []) as (SpawnPoint & { spawngroup_id: number })[])) {
      const key = `${p.zone_short}|${Math.round(p.x)}|${Math.round(p.y)}|${Math.round(p.z)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      spawns.push({ ...p, chance: chanceByGroup.get(p.spawngroup_id) ?? 0 });
    }
    spawns.sort((a, b) => (b.chance - a.chance) || String(a.zone_short).localeCompare(String(b.zone_short)));
  }

  // Zone long-names + era for both spawns and the id-encoded fallback zone.
  const zoneShorts = new Set<string>(spawns.map(s => s.zone_short).filter((z): z is string => !!z));
  const zoneByShort = new Map<string, ZoneRow>();
  if (zoneShorts.size) {
    const { data: zs } = await sb.from('eqemu_zone').select('short_name, long_name, expansion').in('short_name', [...zoneShorts]);
    for (const z of ((zs ?? []) as ZoneRow[])) zoneByShort.set(z.short_name, z);
  }
  const zoneLabel = (short: string | null) => {
    if (!short) return '—';
    const z = zoneByShort.get(short);
    return z ? (z.long_name || z.short_name) : short;
  };

  // ── Loot ────────────────────────────────────────────────────────────────────
  const dropByItem = new Map<number, { item_id: number; item_name: string | null; effective_chance: number | null; lore_flag: boolean | null }>();
  for (const d of ((dropRes.data ?? []) as { item_id: number; item_name: string | null; effective_chance: number | null; lore_flag: boolean | null }[])) {
    const prev = dropByItem.get(d.item_id);
    if (!prev || (d.effective_chance ?? 0) > (prev.effective_chance ?? 0)) dropByItem.set(d.item_id, d);
  }
  const drops = [...dropByItem.values()].sort((a, b) => (b.effective_chance ?? 0) - (a.effective_chance ?? 0));

  // ── Faction name ──────────────────────────────────────────────────────────────
  let factionName: string | null = null;
  const primaryFaction = (npcFacRes.data as { primaryfaction: number } | null)?.primaryfaction;
  if (primaryFaction) {
    const { data: fl } = await sb.from('eqemu_faction_list_full').select('name').eq('id', primaryFaction).maybeSingle();
    factionName = (fl as { name: string } | null)?.name ?? null;
  }

  // ── Turn-ins this NPC accepts ─────────────────────────────────────────────
  type TurninIO = { item_id: number; qty?: number } | null;
  type Turnin = { id: number; inputs: TurninIO[] | null; outputs: TurninIO[] | null; cash: number | null; exp_award: number | null };
  const turnins = (turninRes.data ?? []) as Turnin[];
  const tiItemIds = new Set<number>();
  for (const t of turnins) for (const io of [...(t.inputs ?? []), ...(t.outputs ?? [])]) if (io?.item_id) tiItemIds.add(io.item_id);
  const tiNameById = new Map<number, string>();
  if (tiItemIds.size) {
    const { data: refs } = await sb.from('eqemu_items').select('id, name').in('id', [...tiItemIds]);
    for (const r of ((refs ?? []) as { id: number; name: string }[])) tiNameById.set(r.id, r.name);
  }
  const tiLabel = (io: TurninIO) => {
    if (!io?.item_id) return null;
    const nm = tiNameById.get(io.item_id) || `#${io.item_id}`;
    return io.qty && io.qty > 1 ? `${nm} ×${io.qty}` : nm;
  };

  // ── Castable spells (parent_list inheritance walk, mirrors the bot) ───────────
  let spells: { id: number; name: string }[] = [];
  if (npc.npc_spells_id && npc.npc_spells_id > 0) {
    const rootList: number = npc.npc_spells_id;
    const listIds: number[] = [rootList];
    let cursor = rootList;
    for (let hop = 0; hop < 4; hop++) {
      // Explicit result type breaks supabase-js's circular inference (cursor is
      // reassigned from a query that also uses cursor).
      const parentRes: { data: { parent_list: number | null } | null } =
        await sb.from('eqemu_npc_spells').select('parent_list').eq('id', cursor).maybeSingle();
      const p = parentRes.data?.parent_list ?? 0;
      if (!p || listIds.includes(p)) break;
      listIds.push(p);
      cursor = p;
    }
    const { data: entries } = await sb.from('eqemu_npc_spells_entries')
      .select('spellid, minlevel, maxlevel, priority, npc_spells_id')
      .in('npc_spells_id', listIds).order('priority', { ascending: false }).limit(150);
    const rank = new Map(listIds.map((v, i) => [v, i]));
    const sorted = [...((entries ?? []) as { spellid: number; minlevel: number; maxlevel: number; priority: number; npc_spells_id: number }[])]
      .sort((a, b) => (rank.get(a.npc_spells_id) ?? 9) - (rank.get(b.npc_spells_id) ?? 9) || (b.priority ?? 0) - (a.priority ?? 0));
    const seen = new Set<number>();
    const mobLvl = Number(npc.level) || 0;
    const inWindow = sorted.filter(e => {
      if (seen.has(e.spellid)) return false;
      seen.add(e.spellid);
      const lo = Number(e.minlevel) || 0, hi = Number(e.maxlevel) || 0;
      if (mobLvl <= 0) return true;
      if (lo > 0 && mobLvl < lo) return false;
      if (hi > 0 && mobLvl > hi) return false;
      return true;
    });
    const ids = inWindow.map(e => e.spellid).filter(Boolean);
    if (ids.length) {
      const { data: cat } = await sb.from('eqemu_spells').select('id, name').in('id', ids).limit(150);
      const nameById = new Map(((cat ?? []) as { id: number; name: string }[]).map(s => [s.id, s.name]));
      spells = inWindow.filter(e => nameById.has(e.spellid)).map(e => ({ id: e.spellid, name: nameById.get(e.spellid)! }));
    }
  }

  const name = deUnderscore(npc.name) || `NPC #${npcId}`;
  const className = npc.class != null ? MOB_CLASS_NAMES[npc.class] : null;
  const specials = decodeMobSpecials(npc.special_abilities, npc.npcspecialattks);
  const resists = [npc.mr && `MR ${npc.mr}`, npc.cr && `CR ${npc.cr}`, npc.dr && `DR ${npc.dr}`, npc.fr && `FR ${npc.fr}`, npc.pr && `PR ${npc.pr}`].filter(Boolean).join(' · ');

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="text-sm text-dim">
        <Link href="/search" className="text-blue hover:underline">← search</Link>
        <span className="mx-2">·</span>
        <span className="text-dim/70">wpqdi · npc #{npcId}</span>
      </div>

      {/* Header + stats */}
      <section className="bg-panel border border-border rounded-lg p-4">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h1 className="text-xl text-gold">{name}</h1>
          {npc.lastname && <span className="text-dim text-sm">{deUnderscore(npc.lastname)}</span>}
          {npc.raid_target && <span className="text-[10px] text-red-400 uppercase tracking-wider">raid</span>}
          {!!npc.rare_spawn && <span className="text-[10px] text-purple uppercase tracking-wider">rare</span>}
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-sm">
          {npc.level != null && <Stat k="Level">{npc.level}</Stat>}
          {className && <Stat k="Class">{className}</Stat>}
          {npc.hp != null && <Stat k="HP">{npc.hp.toLocaleString()}</Stat>}
          {npc.ac != null && <Stat k="AC">{npc.ac}</Stat>}
          {(npc.mindmg != null || npc.maxdmg != null) && <Stat k="Damage">{`${npc.mindmg ?? '?'}–${npc.maxdmg ?? '?'}`}</Stat>}
          {resists && <Stat k="Resists">{resists}</Stat>}
          {npc.respawn_seconds != null && npc.respawn_seconds > 0 && <Stat k="Respawn">{fmtRespawn(npc.respawn_seconds)}</Stat>}
          {!!npc.see_invis && <Stat k="See Invis">yes</Stat>}
          {factionName && (
            <Stat k="Faction">
              {primaryFaction
                ? <Link href={`/db/faction/${primaryFaction}`} className="text-blue hover:underline">{factionName}</Link>
                : factionName}
            </Stat>
          )}
        </div>
        {specials.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {specials.map(s => (
              <span key={s} className="px-2 py-0.5 rounded bg-bg border border-border/60 text-[11px] text-orange">{s}</span>
            ))}
          </div>
        )}
        <div className="mt-3 text-[11px] flex flex-wrap gap-3">
          <a href={`https://www.pqdi.cc/npc/${npcId}`} target="_blank" rel="noreferrer" className="text-blue hover:underline">View on PQDI ↗</a>
          <Link href={`/boss/${npcId}`} className="text-blue hover:underline">Our kill history →</Link>
        </div>
      </section>

      {/* Spawn locations */}
      <section className="bg-panel border border-border rounded-lg p-4">
        <h2 className="text-sm text-orange mb-2">Spawns {spawns.length ? `(${spawns.length})` : ''}</h2>
        {spawns.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-dim text-[10px] uppercase tracking-wide text-left">
                <th className="py-1 pr-3 font-normal">Zone</th>
                <th className="py-1 pr-3 font-normal">Loc (x, y, z)</th>
                <th className="py-1 pr-3 font-normal text-right">Respawn</th>
                <th className="py-1 font-normal text-right">Chance</th>
              </tr></thead>
              <tbody>
                {spawns.slice(0, 40).map((s, i) => (
                  <tr key={i} className="border-t border-border/40">
                    <td className="py-1 pr-3 text-text">
                      {zoneLabel(s.zone_short)}
                      {(() => { const z = s.zone_short ? zoneByShort.get(s.zone_short) : null; return z?.expansion != null && ERA_LABEL[z.expansion] ? <span className="text-dim/60 text-[10px] ml-1">{ERA_LABEL[z.expansion]}</span> : null; })()}
                    </td>
                    <td className="py-1 pr-3 text-dim tabular-nums">{Math.round(s.x)}, {Math.round(s.y)}, {Math.round(s.z)}</td>
                    <td className="py-1 pr-3 text-right text-dim">{fmtRespawn(s.respawntime)}</td>
                    <td className="py-1 text-right text-green">{s.chance ? `${s.chance}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {spawns.length > 40 && <p className="text-dim text-[10px] mt-2">Showing top 40 of {spawns.length}.</p>}
          </div>
        ) : <p className="text-dim text-xs">No spawn points in the mirror (instanced or script-spawned mob).</p>}
      </section>

      {/* Loot */}
      <section className="bg-panel border border-border rounded-lg p-4">
        <h2 className="text-sm text-orange mb-2">Loot {drops.length ? `(${drops.length})` : ''}</h2>
        {drops.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-dim text-[10px] uppercase tracking-wide text-left">
                <th className="py-1 pr-3 font-normal">Item</th>
                <th className="py-1 font-normal text-right">Chance</th>
              </tr></thead>
              <tbody>
                {drops.slice(0, 80).map(d => (
                  <tr key={d.item_id} className="border-t border-border/40">
                    <td className="py-1 pr-3">
                      <Link href={`/db/item/${d.item_id}`} className="text-text hover:text-blue hover:underline">{d.item_name || `Item #${d.item_id}`}</Link>
                      {d.lore_flag && <span className="text-purple/80 text-[9px] uppercase ml-1.5">lore</span>}
                    </td>
                    <td className="py-1 text-right text-green">{d.effective_chance != null ? `${d.effective_chance.toFixed(1)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {drops.length > 80 && <p className="text-dim text-[10px] mt-2">Showing top 80 of {drops.length}.</p>}
          </div>
        ) : <p className="text-dim text-xs">No loot table in the mirror.</p>}
      </section>

      {/* Quest turn-ins this NPC accepts */}
      {turnins.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h2 className="text-sm text-orange mb-2">Turn-ins ({turnins.length})</h2>
          <ul className="text-sm space-y-1">
            {turnins.map(t => {
              const give = (t.inputs ?? []).map(tiLabel).filter(Boolean).join(', ');
              const get  = (t.outputs ?? []).map(tiLabel).filter(Boolean).join(', ');
              return (
                <li key={t.id} className="border-b border-border/30 pb-1">
                  {give && <>give <span className="text-text">{give}</span></>}
                  {give && get ? <span className="text-dim"> → </span> : null}
                  {get && <>get <span className="text-green/90">{get}</span></>}
                  {!!t.exp_award && <span className="text-purple/80 text-[11px]"> · {t.exp_award.toLocaleString()} exp</span>}
                </li>
              );
            })}
          </ul>
          <p className="text-dim/60 text-[10px] mt-2">Read from the server&apos;s quest scripts — rewards can be conditional (faction, class, or a spoken keyword) in ways a script scrape can&apos;t always see.</p>
        </section>
      )}

      {/* Castable spells */}
      {spells.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h2 className="text-sm text-orange mb-2">Casts ({spells.length})</h2>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {spells.slice(0, 60).map(s => (
              <Link key={s.id} href={`/db/spell/${s.id}`} className="text-text hover:text-blue hover:underline">{s.name}</Link>
            ))}
          </div>
        </section>
      )}
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
