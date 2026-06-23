// /character/[name]/factions — BETA. Per-character faction picture, COMPACT
// design (one rollup row per faction, latest-state cons):
//
//   faction_standing — additive counters per (character, faction) from the
//     "Your faction standing with X got better/worse." lines. Classic logs
//     print no point values, so counts are HITS, not points; PQDI's faction
//     pages carry per-mob / per-quest magnitudes to marry up against. The
//     at-cap timestamps ("could not possibly get any better/worse") pin the
//     character's absolute position — no amount of hit-counting can.
//
//   faction_cons — the LATEST non-hostile /consider standing per mob.
//     Scowls/threateningly are deliberately absent: an engaged mob cons
//     hostile regardless of faction, so those are combat noise. A mob that
//     cons dubiously-or-better is real faction signal — and the only
//     log-visible proof a Feign Death actually stuck.
//
// Data flows while the owner runs Mimic/Parser with logging on; the agent's
// complete-log backfill fills history (counters add; caps + cons are exact).

import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { groupFactions } from '@/lib/factionGroups';
import ConsTable from './ConsTable';

export const dynamic = 'force-dynamic';

type StandingRow = {
  faction: string;
  better_count: number;
  worse_count: number;
  // Sum of magnitudes from agent-reported deltas (Quarm "got better by N" /
  // "(+N)" forms). 0 means we haven't captured any magnitudes yet — either
  // older agent or no magnitude in the log line. Web prefers totals when > 0.
  better_total?: number | null;
  worse_total?:  number | null;
  capped_max_at: string | null;
  capped_min_at: string | null;
  first_hit_at: string;
  last_hit_at: string;
  last_direction: number | null;
};
type ConRow = { mob: string; standing: string; rank: number | null; event_ts: string };
// Con row enriched with the mob's faction + PQDI link targets (resolved from
// the eqemu faction mirror).
export type ConEnriched = {
  mob: string;
  standing: string;
  rank: number | null;
  eventTs: string;
  npcId: number | null;
  factionId: number | null;
  factionName: string | null;
  isMax: boolean;
};

const STANDING_COLORS: Record<string, string> = {
  ally:           'text-green',
  warmly:         'text-green',
  kindly:         'text-green',
  amiably:        'text-green',
  indifferently:  'text-dim',
  apprehensively: 'text-orange',
  dubiously:      'text-orange',
  threateningly:  'text-red',
  scowls:         'text-red',
};

async function load(decoded: string) {
  const sb = supabaseAdmin();
  const [standingRes, consRes, charRes] = await Promise.all([
    sb.from('faction_standing')
      .select('faction, better_count, worse_count, better_total, worse_total, capped_max_at, capped_min_at, first_hit_at, last_hit_at, last_direction')
      .ilike('character', decoded)
      .order('last_hit_at', { ascending: false })
      .limit(500),
    sb.from('faction_cons')
      .select('mob, standing, rank, event_ts')
      .ilike('character', decoded)
      .order('event_ts', { ascending: false })
      .limit(500),
    // race/class/deity_id power the per-character faction baseline (see
    // computeBaseline below). characters.deity_id joins eqemu_faction_list_mod
    // via mod_name='d<deity_id>'; race + class likewise via r<N> / c<N>.
    sb.from('characters')
      .select('race, class, deity_id')
      .ilike('name', decoded)
      .limit(1),
  ]);
  const char = (charRes.data && charRes.data[0]) || null;
  const cons = (consRes.data ?? []) as ConRow[];

  // Resolve each con'd mob → its faction (name + PQDI faction id) via the
  // eqemu mirror chain: npc_types(name → id, npc_faction_id) → npc_faction
  // (primaryfaction) → faction_list (name). Also resolve the mob's own npc_id
  // for a PQDI mob link. Gracefully returns nothing until the faction mirror
  // sync has populated; the page just omits the faction column in that case.
  const conNames = [...new Set(cons.map(c => (c.mob || '').trim()).filter(Boolean))];
  const mobInfo = new Map<string, { npcId: number | null; factionId: number | null; factionName: string | null }>();
  if (conNames.length > 0) {
    // eqemu_npc_types.name stores spaces as underscores ("Lord_Nagafen"),
    // while con/log mob names use spaces ("Lord Nagafen"). Query by the
    // underscore form and key the result by that form so the join actually
    // matches (without this only ~2% of cons resolved; with it ~46%).
    // Preserve case for the IN query (PostgREST .in() is case-sensitive); the
    // lookup map is keyed lowercase so our side is case-insensitive.
    const toUnder = (s: string) => s.trim().replace(/ /g, '_');
    const queryForms = [...new Set(conNames.map(toUnder))];
    // underscore-name(lower) → { id, npcFactionId }; keep the lowest id per name.
    const npcByName = new Map<string, { id: number; npcFactionId: number | null }>();
    const CHUNK = 80;
    for (let i = 0; i < queryForms.length; i += CHUNK) {
      const slice = queryForms.slice(i, i + CHUNK);
      const { data } = await sb
        .from('eqemu_npc_types')
        .select('id, name, npc_faction_id')
        .in('name', slice);
      for (const n of ((data ?? []) as { id: number; name: string; npc_faction_id: number | null }[])) {
        const k = (n.name || '').toLowerCase();
        const cur = npcByName.get(k);
        if (!cur || n.id < cur.id) npcByName.set(k, { id: n.id, npcFactionId: n.npc_faction_id ?? null });
      }
    }
    // npc_faction → primaryfaction, then faction_list → name.
    const npcFactionIds = [...new Set([...npcByName.values()].map(v => v.npcFactionId).filter((x): x is number => x != null && x > 0))];
    const primaryByNpcFaction = new Map<number, number>();
    if (npcFactionIds.length > 0) {
      const { data } = await sb.from('eqemu_npc_faction').select('id, primaryfaction').in('id', npcFactionIds);
      for (const r of ((data ?? []) as { id: number; primaryfaction: number | null }[])) {
        if (r.primaryfaction != null) primaryByNpcFaction.set(r.id, r.primaryfaction);
      }
    }
    const factionIds = [...new Set([...primaryByNpcFaction.values()])];
    const factionNameById = new Map<number, string>();
    if (factionIds.length > 0) {
      const { data } = await sb.from('eqemu_faction_list').select('id, name').in('id', factionIds);
      for (const r of ((data ?? []) as { id: number; name: string }[])) factionNameById.set(r.id, r.name);
    }
    for (const name of conNames) {
      const npc = npcByName.get(toUnder(name).toLowerCase());
      const factionId = npc?.npcFactionId != null ? (primaryByNpcFaction.get(npc.npcFactionId) ?? null) : null;
      mobInfo.set(name.toLowerCase(), {
        npcId:       npc?.id ?? null,
        factionId,
        factionName: factionId != null ? (factionNameById.get(factionId) ?? null) : null,
      });
    }
  }

  const consEnriched: ConEnriched[] = cons.map(c => {
    const info = mobInfo.get((c.mob || '').toLowerCase());
    return {
      mob:         c.mob,
      standing:    c.standing,
      rank:        c.rank,
      eventTs:     c.event_ts,
      npcId:       info?.npcId ?? null,
      factionId:   info?.factionId ?? null,
      factionName: info?.factionName ?? null,
      // rank 8 = 'ally' = the maximum non-special standing tier.
      isMax:       c.rank === 8 || (c.standing || '').toLowerCase() === 'ally',
    };
  });

  // Per-character faction baseline. A faction's true starting standing is
  // faction_list_full.base + sum of faction_list_mod entries where mod_name
  // matches the character's race / class / deity codes (r<N> / c<N> / d<N>).
  // Lets us tell a user "Coldain start at +50 for you, not 0" — and surfaces
  // why a Dark Elf paladin can't shop in Felwithe without showing red.
  // Returns a map faction_id → { base, baseTotal, modBreakdown }. Empty when
  // the eqemu_faction_list_full mirror hasn't been populated yet.
  const baseline = new Map<number, { name: string | null; base: number; total: number; mods: { code: string; mod: number }[] }>();
  const race = (char?.race as string | null) ?? null;
  const cls  = (char?.class as string | null) ?? null;
  const deityId = (char?.deity_id as number | null) ?? null;
  // race / class name → numeric id used by the mod_name encoding.
  const RACE_ID: Record<string, number> = {
    human:1, barbarian:2, erudite:3, 'wood elf':4, 'high elf':5, 'dark elf':6,
    'half elf':7, dwarf:8, troll:9, ogre:10, halfling:11, gnome:12,
    iksar:128, 'vah shir':130, 'vahshir':130, drakkin:522,
  };
  const CLASS_ID: Record<string, number> = {
    warrior:1, cleric:2, paladin:3, ranger:4, 'shadow knight':5, 'shadowknight':5, sk:5,
    druid:6, monk:7, bard:8, rogue:9, shaman:10, necromancer:11, necro:11,
    wizard:12, magician:13, mage:13, enchanter:14, beastlord:15, berserker:16,
  };
  const raceId  = race ? (RACE_ID[race.toLowerCase()] ?? null) : null;
  const classId = cls  ? (CLASS_ID[cls.toLowerCase()] ?? null) : null;

  const modCodes: string[] = [];
  if (raceId  != null) modCodes.push(`r${raceId}`);
  if (classId != null) modCodes.push(`c${classId}`);
  if (deityId != null) modCodes.push(`d${deityId}`);

  if (modCodes.length > 0) {
    // Pull mod rows applying to this character and the matching faction_list
    // entries in parallel. Bounded — typical faction count is a few hundred.
    const [{ data: modRows }, { data: factionRows }] = await Promise.all([
      sb.from('eqemu_faction_list_mod')
        .select('faction_id, mod, mod_name')
        .in('mod_name', modCodes)
        .limit(20000),
      sb.from('eqemu_faction_list_full')
        .select('id, name, base')
        .limit(5000),
    ]);
    for (const f of ((factionRows ?? []) as { id: number; name: string | null; base: number | null }[])) {
      const b = f.base ?? 0;
      baseline.set(f.id, { name: f.name, base: b, total: b, mods: [] });
    }
    for (const m of ((modRows ?? []) as { faction_id: number; mod: number | null; mod_name: string }[])) {
      const cur = baseline.get(m.faction_id);
      const delta = m.mod ?? 0;
      if (cur) {
        cur.total += delta;
        cur.mods.push({ code: m.mod_name, mod: delta });
      } else {
        // Mod row for a faction whose definition row wasn't returned (rare —
        // capped query). Seed an entry so the data isn't lost.
        baseline.set(m.faction_id, { name: null, base: 0, total: delta, mods: [{ code: m.mod_name, mod: delta }] });
      }
    }
  }

  return {
    standings: (standingRes.data ?? []) as StandingRow[],
    cons:      consEnriched,
    race, cls, deityId,
    baseline,
  };
}

export default async function CharacterFactionsPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  if (!/^[A-Za-z]{2,}$/.test(decoded)) notFound();

  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect(`/auth/signin?next=/character/${encodeURIComponent(name)}/factions`);

  const { standings, cons, race, cls, deityId, baseline } = await load(decoded);
  // Name-keyed lookup so the standings table (keyed by faction NAME, not id)
  // can find the baseline for a row.
  const baselineByFactionName = new Map<string, { name: string | null; base: number; total: number; mods: { code: string; mod: number }[] }>();
  for (const [, b] of baseline) {
    if (b.name) baselineByFactionName.set(b.name.toLowerCase(), b);
  }

  // Bloc grouping — factions render next to the ones whose hits arrive
  // together (Velious war, Seru vs Katta, Chardok vs the goblin mines, …),
  // most-active bloc first. Catalog members with no recorded hits show as
  // "?" rows with an estimated base standing from race/class.
  const grouped = groupFactions(standings, f => f.better_count + f.worse_count, { race, cls });
  const conRows = cons;

  const fmtDate = (ts: string) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href={`/character/${encodeURIComponent(decoded)}`} className="text-blue hover:underline">← back to {decoded}</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-2xl text-gold flex items-center gap-3 mb-1">
          <span>🤝 {decoded} — Factions</span>
          <span className="text-[10px] tracking-widest font-bold px-2 py-0.5 rounded bg-orange/20 border border-orange/60 text-orange uppercase">Beta</span>
        </h2>
        <p className="text-sm text-dim leading-6">
          Faction hits and <code>/consider</code> standings mined from this character&apos;s logs.
          Classic logs don&apos;t print point values — counts below are <b>hits</b>, not points; cross-reference
          per-mob and per-quest magnitudes on{' '}
          <a href="https://www.pqdi.cc/factions" target="_blank" rel="noreferrer" className="text-blue hover:underline">PQDI&apos;s faction pages</a>.
          An <span className="text-gold">at-cap</span> flag means the server said standing could not possibly get any
          better/worse — that pins the absolute position. Re-running the agent over old logs backfills history.
        </p>
      </section>

      <section className="bg-panel border border-border rounded-lg p-4">
        <h3 className="text-sm text-orange mb-1">Faction standing ({standings.length} recorded)</h3>
        <p className="text-xs text-dim mb-3">
          Grouped by the wars you grind them in — raising one side of a bloc usually lowers the other.
          <b className="text-text"> Base</b> is your starting standing (faction base + per-race/class/deity
          adjustments from the eqemu mirror, computed for{' '}
          {[race, cls, deityId ? `deity #${deityId}` : null].filter(Boolean).join(' / ') || 'this character'});
          hover the cell for the breakdown.{' '}
          <span className="text-text"> ? rows</span> are bloc factions with no recorded hits yet — their cons-tier
          estimate is shown alongside. <code>/con</code> something on that faction in-game to pin the real tier.
        </p>
        {grouped.length === 0 ? (
          <div className="text-sm text-dim p-2">
            No faction hits recorded yet. They flow automatically while this character plays with the agent
            running — or crawl old logs via the agent&apos;s backfill to fill in history.
          </div>
        ) : (
          <div className="space-y-4">
            {grouped.map(({ group, rows, missing }) => (
              <div key={group.key}>
                <div className="flex items-baseline gap-2 mb-1">
                  <h4 className="text-xs text-gold uppercase tracking-wider">{group.label}</h4>
                  <span className="text-[10px] text-dim italic">{group.hint}</span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-dim text-xs text-left">
                      <th className="py-1 pr-3 w-[35%]">Faction</th>
                      <th className="py-1 pr-3 text-right" title="Your starting standing — eqemu_faction_list.base + adjustments for your race / class / deity. Hover a value for the breakdown.">Base</th>
                      <th className="py-1 pr-3 text-right">Raised</th>
                      <th className="py-1 pr-3 text-right">Lowered</th>
                      <th className="py-1 pr-3">Position</th>
                      <th className="py-1">Last hit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {rows.map(f => {
                      // Prefer summed magnitudes when the agent has captured
                      // any (Quarm prints per-line deltas); fall back to hit
                      // counts when not. Tooltip surfaces whichever number
                      // ISN'T the headline so officers can sanity-check
                      // "+96 points (8 hits)" vs "+8 hits (no per-hit deltas
                      // captured)" (Uilnayar 2026-06-23).
                      const bTot = f.better_total ?? 0;
                      const wTot = f.worse_total  ?? 0;
                      const betterHead = bTot > 0
                        ? { val: `+${bTot.toLocaleString()}`, tip: `+${bTot.toLocaleString()} points across ${f.better_count.toLocaleString()} hit${f.better_count === 1 ? '' : 's'}` }
                        : f.better_count > 0
                          ? { val: `+${f.better_count}`, tip: `${f.better_count.toLocaleString()} hit${f.better_count === 1 ? '' : 's'} — no per-line magnitude captured (older agent, or the server didn’t print one)` }
                          : { val: '—', tip: '' };
                      const worseHead = wTot > 0
                        ? { val: `−${wTot.toLocaleString()}`, tip: `−${wTot.toLocaleString()} points across ${f.worse_count.toLocaleString()} hit${f.worse_count === 1 ? '' : 's'}` }
                        : f.worse_count > 0
                          ? { val: `−${f.worse_count}`, tip: `${f.worse_count.toLocaleString()} hit${f.worse_count === 1 ? '' : 's'} — no per-line magnitude captured` }
                          : { val: '—', tip: '' };
                      // Per-character baseline (faction_list.base + mods for
                      // your race/class/deity). Empty until the eqemu_faction_*
                      // mirror is populated.
                      const bl = baselineByFactionName.get(f.faction.toLowerCase());
                      const baseCell = bl ? (() => {
                        const total = bl.total;
                        const tone = total >= 750 ? 'text-green' : total >= 0 ? 'text-text' : total >= -750 ? 'text-orange' : 'text-red';
                        const sign = total > 0 ? '+' : '';
                        const modsLine = bl.mods.length > 0
                          ? bl.mods.map(m => `${m.code} ${m.mod > 0 ? '+' : ''}${m.mod}`).join(' · ')
                          : 'no race/class/deity mods';
                        return <span className={tone} title={`base ${bl.base >= 0 ? '+' : ''}${bl.base} · ${modsLine} = ${sign}${total}`}>{sign}{total}</span>;
                      })() : <span className="text-dim/40">—</span>;
                      return (
                      <tr key={f.faction}>
                        <td className="py-1.5 pr-3 text-text">{f.faction}</td>
                        <td className="py-1.5 pr-3 text-right">{baseCell}</td>
                        <td className="py-1.5 pr-3 text-right text-green" title={betterHead.tip}>{betterHead.val}</td>
                        <td className="py-1.5 pr-3 text-right text-red"   title={worseHead.tip}>{worseHead.val}</td>
                        <td className="py-1.5 pr-3">
                          {f.capped_max_at && <span className="text-gold text-xs" title={`hit the max cap ${fmtDate(f.capped_max_at)}`}>▲ at max cap</span>}
                          {f.capped_max_at && f.capped_min_at && <span className="text-dim text-xs"> · </span>}
                          {f.capped_min_at && <span className="text-red text-xs" title={`hit the min cap ${fmtDate(f.capped_min_at)}`}>▼ at min cap</span>}
                          {!f.capped_max_at && !f.capped_min_at && <span className="text-dim text-xs">—</span>}
                        </td>
                        <td className="py-1.5 text-dim text-xs">
                          {fmtDate(f.last_hit_at)}
                          {f.last_direction != null && (
                            <span className={f.last_direction > 0 ? 'text-green ml-1' : 'text-red ml-1'}>
                              {f.last_direction > 0 ? '↑' : '↓'}
                            </span>
                          )}
                        </td>
                      </tr>
                      );
                    })}
                    {missing.map(m => {
                      const bl = baselineByFactionName.get(m.name.toLowerCase());
                      const baseCell = bl ? (() => {
                        const total = bl.total;
                        const tone = total >= 750 ? 'text-green' : total >= 0 ? 'text-text' : total >= -750 ? 'text-orange' : 'text-red';
                        const sign = total > 0 ? '+' : '';
                        const modsLine = bl.mods.length > 0
                          ? bl.mods.map(mm => `${mm.code} ${mm.mod > 0 ? '+' : ''}${mm.mod}`).join(' · ')
                          : 'no race/class/deity mods';
                        return <span className={tone} title={`base ${bl.base >= 0 ? '+' : ''}${bl.base} · ${modsLine} = ${sign}${total}`}>{sign}{total}</span>;
                      })() : <span className="text-dim/40">—</span>;
                      return (
                      <tr key={m.name} className="opacity-70">
                        <td className="py-1.5 pr-3 text-dim">{m.name}</td>
                        <td className="py-1.5 pr-3 text-right">{baseCell}</td>
                        <td className="py-1.5 pr-3 text-right text-dim">?</td>
                        <td className="py-1.5 pr-3 text-right text-dim">?</td>
                        <td className="py-1.5 pr-3">
                          <span
                            className={`text-xs ${STANDING_COLORS[m.base] ?? 'text-dim'}`}
                            title="Estimated base standing from race/class — deity not tracked yet; /con in-game to pin it"
                          >
                            est. base: {m.base}
                          </span>
                        </td>
                        <td className="py-1.5 text-dim text-xs">—</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-panel border border-border rounded-lg p-4">
        <h3 className="text-sm text-orange mb-1">Consider standings ({conRows.length} mob{conRows.length === 1 ? '' : 's'})</h3>
        <p className="text-xs text-dim mb-3">
          Latest <b>non-hostile</b> <code>/con</code> per mob. Scowling/threatening cons are
          deliberately excluded — an engaged mob always cons hostile, so they carry no faction signal. A row
          here means this mob&apos;s faction visibly accepts {decoded} (and is the proof a Feign Death stuck).
          Sort by standing or observed; mob + faction link out to PQDI; an <span className="text-green">ally</span> con
          is the maximum standing for that faction.
        </p>
        <ConsTable rows={conRows} character={decoded} />
      </section>

      <section className="bg-panel border border-border rounded-lg p-4 text-xs text-dim leading-5">
        <b className="text-text">Coming next:</b> base standing by class/race/deity (the starting offset before any
        hits), Ornate Velium Pendant (+100) attempt tracking, and per-class faction-raising spells/songs.
      </section>
    </div>
  );
}
