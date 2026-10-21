// /db/faction/[id]?v=b — the faction page, variant B (the guild lead, 2026-10-13, looking at Inhabitants of Valor):
//   1. the starting modifiers by NAME, split into Races / Classes / Deities (every player option listed, 0 dim),
//      plus the non-player illusion races that have a row;
//   2. "your characters in a line": default standing + KOS or not, and the current faction;
//   3. what RAISES and what LOWERS the faction (PQDI's two lists);
//   4. the title coloured by whether the faction can be KOS by default.
// A server component rendered from page.tsx after its sign-in check. The default view never imports this file's work.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { deUnderscore } from '@/lib/npcDecode';
import { selectAll } from '@/lib/selectAll';
import { GUILD_TAG } from '@/lib/guild';
import { ownedCharacters } from '@/lib/ownedCharacters';
import { ilikeAnyFilter } from '@/lib/capSafeReads';
import {
  CON_WORDS, conRank, isKos, PLAYER_RACES, ILLUSION_RACES, CLASSES, DEITIES, valueRange, kosClass, clampCap,
  raceIdFromName, classIdFromName, type FactionFacts,
} from '@/lib/factionCon';

type Faction = {
  id: number; name: string; base: number | null; min_cap: number | null; max_cap: number | null;
  see_illusion: number | null;
};
type ModRow = { mod: number | null; mod_name: string | null };
type NpcFacRow = { id: number };
type NpcRow = { id: number; name: string | null; level: number | null; raid_target: boolean | null; npc_faction_id: number | null };
type EntryRow = { npc_faction_id: number; faction_id: number; value: number };
type ConRow = { character: string; mob: string; standing: string; rank: number | null; event_ts: string };
type StandingRow = { character: string; better_count: number | null; worse_count: number | null; better_total: number | null; worse_total: number | null };
type CharRow = { name: string; race: string | null; class: string | null; deity_id: number | null };
type TurninRow = {
  id: number; npc_name: string | null; npc_id: number | null; zone_short: string | null;
  faction_changes: { faction_id: number; delta: number }[] | null;
};
type Source = { npcId: number; name: string; level: number | null; zone: string | null; value: number };

const TOP = 25;
const CHUNK = 100;

// Same idea as STANDING_COLORS on /character/[name]/factions: green good, dim neutral, orange wary, red hostile.
const rankColor = (rank: number): string =>
  rank >= 5 ? 'text-green' : rank === 4 ? 'text-dim' : rank >= 2 ? 'text-orange' : 'text-red';

const CLASS_LABEL = {
  never:  { title: 'text-green',  label: 'Never KOS by default' },
  some:   { title: 'text-orange', label: 'KOS for some races, classes or deities' },
  always: { title: 'text-red',    label: 'KOS to everyone by default' },
} as const;

// Log mob names are spaced ("Lord Nagafen"); catalog names are underscored, and some start with '#'.
const normMob = (s: string | null | undefined): string => String(s ?? '').replace(/_/g, ' ').replace(/^#/, '').trim().toLowerCase();
const cleanName = (s: string | null | undefined): string => deUnderscore(String(s ?? '').replace(/^#/, '')).trim();
const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));
const day = (iso: string): string => (iso || '').slice(0, 10);
const chunks = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};
// An ilike pattern with no wildcard is a case-insensitive equality; escape the ones a faction name could carry.
const ilikeLiteral = (s: string): string => s.replace(/[\\%_]/g, m => `\\${m}`);

export default async function FactionB({ factionId, userId }: { factionId: number; userId: string }) {
  const sb = supabaseAdmin();

  const { data: facData } = await sb.from('eqemu_faction_list_full')
    .select('id, name, base, min_cap, max_cap, see_illusion').eq('id', factionId).maybeSingle();
  const faction = facData as Faction | null;
  if (!faction) notFound();

  const owned = await ownedCharacters(userId);
  const ownedNames = owned.map(c => c.name);
  const charFilter = ilikeAnyFilter('character', ownedNames);

  const [modRows, groupRows, entries, charRows, standingRes, turninRes] = await Promise.all([
    selectAll<ModRow>((from, to) => sb.from('eqemu_faction_list_mod')
      .select('mod, mod_name').eq('faction_id', factionId).order('id', { ascending: true }).range(from, to)),
    selectAll<NpcFacRow>((from, to) => sb.from('eqemu_npc_faction')
      .select('id').eq('primaryfaction', factionId).order('id', { ascending: true }).range(from, to)),
    selectAll<EntryRow>((from, to) => sb.from('eqemu_npc_faction_entries')
      .select('npc_faction_id, faction_id, value').eq('faction_id', factionId).neq('value', 0)
      .order('npc_faction_id', { ascending: true }).order('faction_id', { ascending: true }).range(from, to)),
    ownedNames.length
      ? sb.from('characters').select('name, race, class, deity_id').in('name', ownedNames)
      : Promise.resolve({ data: [] as CharRow[] }),
    // One row per (character, faction): at most one per owned character, so a peek is enough.
    charFilter
      ? sb.from('faction_standing')
          .select('character, better_count, worse_count, better_total, worse_total')
          .eq('guild_id', GUILD_TAG).ilike('faction', ilikeLiteral(faction.name)).or(charFilter).limit(100)
      : Promise.resolve({ data: [] as StandingRow[] }),
    sb.from('scripted_npc_turnins')
      .select('id, npc_name, npc_id, zone_short, faction_changes')
      .filter('faction_changes', 'cs', JSON.stringify([{ faction_id: factionId }]))
      .limit(60),
  ]);

  // ── Starting modifiers, keyed by mod_name so the maths and the lists read the same rows ──
  const mods: Record<string, number> = {};
  for (const m of modRows) if (m.mod_name && m.mod != null) mods[m.mod_name] = m.mod;
  const facts: FactionFacts = { base: faction.base, min_cap: faction.min_cap, max_cap: faction.max_cap, mods };
  const kc = kosClass(facts);
  const [defLo, defHi] = valueRange(facts, null);
  const modOfCode = (code: string): number => mods[code] ?? 0;
  // Race rows that are not a player race: the illusions (named when we know the race, numbered when we do not).
  const illusionRows = Object.keys(mods)
    .filter(k => /^r\d+$/.test(k) && !(Number(k.slice(1)) in PLAYER_RACES) && mods[k] !== 0)
    .map(k => ({ id: Number(k.slice(1)), name: ILLUSION_RACES[Number(k.slice(1))] ?? `Race #${k.slice(1)}`, mod: mods[k] }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // ── Mobs whose PRIMARY faction is this one (what a /consider on them reports) ──
  const groupIds = groupRows.map(g => g.id);
  const primaryMobs: NpcRow[] = [];
  for (const slice of chunks(groupIds, CHUNK)) {
    primaryMobs.push(...await selectAll<NpcRow>((from, to) => sb.from('eqemu_npc_types')
      .select('id, name, level, raid_target, npc_faction_id').in('npc_faction_id', slice)
      .order('id', { ascending: true }).range(from, to)));
  }
  const primaryNames = new Set(primaryMobs.map(n => normMob(n.name)).filter(Boolean));

  // ── Raise / lower: kills whose npc_faction entry moves this faction ──
  const valueByGroup = new Map<number, number>();
  for (const e of entries) valueByGroup.set(e.npc_faction_id, e.value);
  const entryNpcs: NpcRow[] = [];
  for (const slice of chunks([...valueByGroup.keys()], CHUNK)) {
    entryNpcs.push(...await selectAll<NpcRow>((from, to) => sb.from('eqemu_npc_types')
      .select('id, name, level, raid_target, npc_faction_id').in('npc_faction_id', slice)
      .order('id', { ascending: true }).range(from, to)));
  }
  const zoneIds = [...new Set(entryNpcs.map(n => Math.floor(n.id / 1000)))];
  const zoneName = new Map<number, string>();
  for (const slice of chunks(zoneIds, 200)) {
    const { data } = await sb.from('eqemu_zone').select('zone_id, long_name').in('zone_id', slice);
    for (const z of ((data ?? []) as { zone_id: number; long_name: string | null }[])) if (z.long_name) zoneName.set(z.zone_id, z.long_name);
  }
  // One line per (name, value): the same mob reaches a faction through several instanced rows. Lowest id wins.
  const dedup = new Map<string, Source>();
  for (const n of entryNpcs) {
    const value = n.npc_faction_id != null ? valueByGroup.get(n.npc_faction_id) : undefined;
    const name = cleanName(n.name);
    if (!value || !name) continue;
    const k = `${name.toLowerCase()}|${value}`;
    const cur = dedup.get(k);
    if (!cur || n.id < cur.npcId) dedup.set(k, { npcId: n.id, name, level: n.level, zone: zoneName.get(Math.floor(n.id / 1000)) ?? null, value });
  }
  const bySize = (a: Source, b: Source) => Math.abs(b.value) - Math.abs(a.value) || a.name.localeCompare(b.name);
  const raises = [...dedup.values()].filter(s => s.value > 0).sort(bySize);
  const lowers = [...dedup.values()].filter(s => s.value < 0).sort(bySize);

  // ── Your characters ──
  const charByName = new Map<string, CharRow>();
  for (const c of ((charRows.data ?? []) as CharRow[])) charByName.set(c.name.toLowerCase(), c);
  const standingByName = new Map<string, StandingRow>();
  for (const s of ((standingRes.data ?? []) as StandingRow[])) standingByName.set(s.character.toLowerCase(), s);

  // The newest /consider of any mob on this faction, per character. faction_cons holds the LATEST non-hostile
  // standing per (character, mob); paged, newest first, unique tiebreak on id.
  const latestCon = new Map<string, ConRow>();
  if (charFilter && primaryNames.size) {
    const cons = await selectAll<ConRow>((from, to) => sb.from('faction_cons')
      .select('character, mob, standing, rank, event_ts')
      .eq('guild_id', GUILD_TAG).or(charFilter)
      .order('event_ts', { ascending: false }).order('id', { ascending: true }).range(from, to));
    for (const c of cons) {
      if (!primaryNames.has(normMob(c.mob))) continue;
      const k = c.character.toLowerCase();
      const cur = latestCon.get(k);
      if (!cur || c.event_ts > cur.event_ts) latestCon.set(k, c);
    }
  }

  const mine = owned.map(o => {
    const c = charByName.get(o.name.toLowerCase());
    const race = raceIdFromName(c?.race), cls = classIdFromName(c?.class ?? o.class);
    const deity = c?.deity_id && c.deity_id in DEITIES ? c.deity_id : null;
    const [lo, hi] = valueRange(facts, { race, cls, deity });
    const st = standingByName.get(o.name.toLowerCase());
    const hits = (st?.better_count ?? 0) + (st?.worse_count ?? 0);
    const moved = (st?.better_total ?? 0) - (st?.worse_total ?? 0);
    const points = (st?.better_total ?? 0) + (st?.worse_total ?? 0);
    return {
      name: o.name, hidden: o.hidden_from_lists === true,
      race: race != null ? PLAYER_RACES[race] : c?.race || null,
      cls: cls != null ? CLASSES[cls] : c?.class || o.class || null,
      deity: deity != null ? DEITIES[deity] : null,
      lo, hi, exact: lo === hi,
      con: latestCon.get(o.name.toLowerCase()) ?? null,
      // An estimate needs an exact default and at least one hit that carried a point value.
      estimate: lo === hi && points > 0 ? clampCap(facts, lo + moved) : null,
      hits,
    };
  }).sort((a, b) => Number(a.hidden) - Number(b.hidden));

  const turnins = ((turninRes.data ?? []) as TurninRow[])
    .map(t => ({ ...t, delta: (t.faction_changes ?? []).find(f => f.faction_id === factionId)?.delta ?? 0 }))
    .filter(t => t.delta !== 0)
    .sort((a, b) => b.delta - a.delta);
  const mobsOnFaction = [...primaryMobs].sort((a, b) => (b.level ?? 0) - (a.level ?? 0)).slice(0, 80);

  const cl = CLASS_LABEL[kc];

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="text-sm text-dim">
        <Link href="/db" className="text-blue hover:underline">← database</Link>
        <span className="mx-2">·</span>
        <span className="text-dim/70">wpqdi · faction #{factionId}</span>
        <span className="mx-2">·</span>
        <Link href={`/db/faction/${factionId}`} className="text-blue hover:underline">default view</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-4">
        <h1 className={`text-xl ${cl.title}`}>{faction.name}</h1>
        <div className={`mt-1 text-xs ${cl.title}`}>{cl.label}</div>
        <div className="mt-1 text-[11px] text-dim">
          {faction.see_illusion
            ? 'Sees through illusions'
            : 'Illusions fool it: a non-player illusion counts as that race (no race modifier)'}
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-sm">
          {faction.base != null && <Stat k="Base">{faction.base}</Stat>}
          {faction.min_cap != null && <Stat k="Min">{faction.min_cap}</Stat>}
          {faction.max_cap != null && <Stat k="Max">{faction.max_cap}</Stat>}
          <Stat k="Default, any player">{defLo === defHi ? defLo : `${defLo} to ${defHi}`}</Stat>
        </div>
        <div className="mt-3 text-[11px]">
          <a href={`https://www.pqdi.cc/faction/${factionId}`} target="_blank" rel="noreferrer"
             className="text-blue hover:underline">View on PQDI ↗</a>
        </div>
      </section>

      {/* Your characters, one line each. */}
      {mine.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h2 className="text-sm text-orange mb-2">Your characters ({mine.length})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-dim text-[10px] uppercase tracking-wide text-left">
                <th className="py-1 pr-3 font-normal">Character</th>
                <th className="py-1 pr-3 font-normal">Default</th>
                <th className="py-1 pr-3 font-normal">KOS</th>
                <th className="py-1 font-normal">Current</th>
              </tr></thead>
              <tbody>
                {mine.map(c => (
                  <tr key={c.name} className={`border-t border-border/40 ${c.hidden ? 'opacity-60' : ''}`}>
                    <td className="py-1 pr-3 align-top">
                      <Link href={`/character/${encodeURIComponent(c.name)}/factions`} className="text-text hover:text-blue hover:underline">{c.name}</Link>
                      <div className="text-dim text-[10px]">
                        {[c.race, c.cls, c.deity].filter(Boolean).join(' · ') || 'race, class and deity unknown'}
                      </div>
                    </td>
                    <td className="py-1 pr-3 align-top whitespace-nowrap">
                      {c.exact
                        ? <><span className="text-text">{c.lo}</span> <span className={rankColor(conRank(c.lo))}>{CON_WORDS[conRank(c.lo)]}</span></>
                        : <span className="text-dim" title="Race, class or deity is not known for this character, so this is the range across the options">
                            {c.lo} to {c.hi}
                          </span>}
                    </td>
                    <td className="py-1 pr-3 align-top whitespace-nowrap">
                      {isKos(c.hi)
                        ? <span className="text-red">KOS</span>
                        : isKos(c.lo)
                          ? <span className="text-orange">maybe KOS</span>
                          : <span className="text-green">not KOS</span>}
                    </td>
                    <td className="py-1 align-top">
                      {c.con
                        ? <>
                            <span className={rankColor(c.con.rank ?? conRank(0))}>{c.con.standing}</span>
                            <div className="text-dim text-[10px]">{normMob(c.con.mob)} · {day(c.con.event_ts)}</div>
                          </>
                        : c.estimate != null
                          ? <>
                              <span className={rankColor(conRank(c.estimate))}>≈ {CON_WORDS[conRank(c.estimate)]}</span>
                              <div className="text-dim text-[10px]">≈ from {c.hits} hits</div>
                            </>
                          : <span className="text-dim">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-dim/60 text-[10px] mt-2">
            Default is the base plus the race, class and deity modifiers, held to the caps. Current is the newest /consider
            from a mob on this faction; failing that, an estimate from the faction hits your log recorded.
          </p>
        </section>
      )}

      {/* Starting modifiers, by name. */}
      <section className="bg-panel border border-border rounded-lg p-4">
        <h2 className="text-sm text-orange mb-2">Starting modifiers</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-4">
          <ModGroup title="Races" rows={Object.entries(PLAYER_RACES).map(([id, name]) => ({ name, mod: modOfCode(`r${id}`) }))} />
          <ModGroup title="Classes" rows={Object.entries(CLASSES).map(([id, name]) => ({ name, mod: modOfCode(`c${id}`) }))} />
          <ModGroup title="Deities" rows={Object.entries(DEITIES).map(([id, name]) => ({ name, mod: modOfCode(`d${id}`) }))} />
        </div>
        {illusionRows.length > 0 && (
          <div className="mt-4">
            <ModGroup title="Illusion races" rows={illusionRows} />
          </div>
        )}
        <p className="text-dim/60 text-[10px] mt-2">Added to the base by race, class and deity when you start. A dim 0 means no change.</p>
      </section>

      {/* Raise and lower. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SourceList title="Raise faction" tone="text-green" rows={raises} />
        <SourceList title="Lower faction" tone="text-red" rows={lowers} />
      </div>

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
                    <td className={`py-1 text-right ${t.delta > 0 ? 'text-green' : 'text-red-400'}`}>{signed(t.delta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="bg-panel border border-border rounded-lg p-4">
        <h2 className="text-sm text-orange mb-2">
          Mobs on this faction {primaryMobs.length ? `(${primaryMobs.length})` : ''}
        </h2>
        {mobsOnFaction.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 text-sm">
            {mobsOnFaction.map(n => (
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
        {primaryMobs.length > mobsOnFaction.length && (
          <p className="text-dim text-[10px] mt-2">Showing the {mobsOnFaction.length} highest level of {primaryMobs.length}.</p>
        )}
      </section>
    </div>
  );
}

function ModGroup({ title, rows }: { title: string; rows: { name: string; mod: number }[] }) {
  return (
    <div>
      <div className="text-dim text-[10px] uppercase tracking-wide mb-1">{title}</div>
      <ul className="text-xs space-y-0.5">
        {rows.map(r => (
          <li key={r.name} className="flex items-baseline justify-between gap-2">
            <span className={r.mod === 0 ? 'text-dim' : 'text-text'}>{r.name}</span>
            <span className={r.mod > 0 ? 'text-green' : r.mod < 0 ? 'text-red' : 'text-dim'}>{r.mod === 0 ? '0' : signed(r.mod)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SourceList({ title, tone, rows }: { title: string; tone: string; rows: Source[] }) {
  const shown = rows.slice(0, TOP);
  return (
    <section className="bg-panel border border-border rounded-lg p-4">
      <h2 className={`text-sm mb-2 ${tone}`}>{title} {rows.length ? `(${rows.length})` : ''}</h2>
      {shown.length ? (
        <ul className="text-sm space-y-0.5">
          {shown.map(s => (
            <li key={`${s.npcId}|${s.value}`} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0">
                <Link href={`/db/npc/${s.npcId}`} className="text-text hover:text-blue hover:underline">{s.name}</Link>
                {s.zone && <span className="text-dim text-[10px] ml-1.5">{s.zone}</span>}
              </span>
              <span className={`shrink-0 text-xs ${tone}`}>{signed(s.value)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-dim text-xs">Nothing in the mirror {title === 'Raise faction' ? 'raises' : 'lowers'} this faction.</p>}
      {rows.length > TOP && <p className="text-dim text-[10px] mt-2">+{rows.length - TOP} more</p>}
    </section>
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
