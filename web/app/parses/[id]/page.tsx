// /parses/[id] — full encounter breakdown.
//
// Shows: every player ranked by damage, contributors (who uploaded), tank
// perspective if a tank-class character contributed, deaths from raw_parse,
// and that night's loot from OpenDKP. Loot isn't linked per-kill (OpenDKP
// doesn't capture which encounter a /loot post belongs to), so we show the
// whole night here.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import { fmtDmg, fmtDuration, fmtTime, dayKey, dayLabel, cleanBossName } from '@/lib/format';
import { userTz } from '@/lib/timezone';
import LootBlock, { type LootRow } from '@/components/LootBlock';
import { ClassificationChip } from '@/components/KillCard';
import { classifyEncounter, clearClassification } from '../actions';

export const dynamic = 'force-dynamic';

type NpcRef     = { id: number; name: string; zone_short: string | null };
type ZoneRow    = { short_name: string; long_name: string };
type PlayerRow  = {
  character_name: string;
  total_damage: number;
  dps: number;
  duration_sec: number | null;
  rank: number | null;
  has_pets: boolean | null;
};
type RawPlayer    = { name: string; damage: number; dps: number; duration: number; hasPets?: boolean; rank?: number };
type RawDeath     = { name: string; ts: string; class?: string | null; riposteDeath?: boolean };
// Per-defender tanking stats from the agent's EncounterBuilder — what the
// tank's log saw incoming on themselves (and any other defenders in range).
// Matched to the contributor by name to render the "took 47 hits for 12.4k,
// avoided 18 (6 dodge / 3 parry / 2 riposte / 1 block / 2 miss)" line.
type RawDefender = {
  name: string;
  hits?: number;
  damageTaken?: number;
  misses?: number;
  dodges?: number;
  parries?: number;
  ripostes?: number;
  blocks?: number;
  invulns?: number;
  ripostedFor?: number;
  rampageHits?: number;
  rampageDmg?: number;
  // First / last incoming-swing timestamp from the tank's log (epoch ms).
  // Lets us label MT and PIVOT by handover TIME instead of damage share —
  // someone who briefly pulled aggro and got smacked harder than the MT
  // shouldn't read as the MT, but the share-based heuristic would tag them
  // that way. Undefined on uploads from agents < 3.1.50.
  firstAttackAt?: number;
  lastAttackAt?: number;
};
// Damage-shield procs the tank's gear/spells dealt back to attackers across
// the fight. Keyed by ability name; total is what we sum for the tank line.
type DsReflect   = { count: number; total: number; min?: number; max?: number };
// Per-healer aggregate from the agent — used to build the Heal perspective
// panel, mirror of Tank perspective. firstHealAt / lastHealAt land on agent
// v3.1.51+; older uploads expose only the totals.
type RawHealer    = {
  name: string;
  healed?: number;
  ticks?: number;
  targets?: string[];
  firstHealAt?: number;
  lastHealAt?: number;
  // Per-recipient heal totals — agent v3.1.69+. Lets the heal panel show
  // "Ashieron 320k · Moash 180k" instead of a bare name list.
  byTarget?: Record<string, number>;
  // Heal-spell cast counts from the uploader's own log — agent v3.1.69+.
  // EQ only shows the spell name on the caster's "You begin casting X" line
  // (bystanders get "X begins to cast a spell"), so this is populated ONLY
  // on the healer whose name equals the contribution's uploader.
  // (Uilnayar 2026-06-25: "x CHs and other heal types".)
  spells?: Record<string, number>;
};
// CH-chain gap analysis on the primary tank — agent fills in when it saw at
// least one healing gap > 8s. `maxGapMs` is the longest dead air, surfaced
// inline so the heal panel can say "max 14s gap — missed ~2 CH ticks."
type HealGaps     = { tank: string; count: number; maxGapMs: number };
type RawParse     = {
  bossName?: string;
  duration?: number;
  totalDamage?: number;
  totalDps?: number;
  players?: RawPlayer[];
  deaths?: RawDeath[];
  healers?: RawHealer[] | null;
  defenders?:   RawDefender[];
  ds_reflects?: Record<string, DsReflect>;
  healGaps?:    HealGaps;
  // Largest single hit the boss landed this fight — multiplied by each tank's
  // invulns count to estimate damage absorbed by Divine Aura / Holy Aegis /
  // similar. Undefined for fights uploaded by older agents.
  bossMaxMelee?: number;
};
type Contribution = {
  id: string;
  contributor_character: string | null;
  contributor_discord_id: string | null;
  source: string;
  total_damage: number;
  player_count: number;
  duration_sec: number | null;
  raw_parse: RawParse | null;
  created_at: string;
  agent_version: string | null;
  has_ability_detail: boolean | null;
};

// Compare two semver-ish version strings ("3.1.38" vs "3.1.45"). Returns
// -1 / 0 / +1. Tolerates extra dot segments and non-numeric tails (e.g.
// "1.0.70-beta.3") by truncating to numeric prefix only — sufficient for the
// "current at upload time?" check, which only cares about major.minor.patch.
function cmpVer(a: string | null | undefined, b: string | null | undefined): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  const norm = (s: string) => s.split('.').map(p => parseInt(p, 10)).filter(n => Number.isFinite(n));
  const A = norm(a), B = norm(b);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i] ?? 0, y = B[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
type EncounterDetail = {
  id: string;
  started_at: string;
  duration_sec: number | null;
  total_damage: number;
  total_dps: number;
  zone_short: string | null;
  npc_id: number | null;
  classification: string | null;
  classification_reason: string | null;
  classification_by: string | null;
  eqemu_npc_types: NpcRef | null;
  encounter_players: PlayerRow[];
};
type WhoObs = { character: string; class: string | null; level: number | null };

const TANK_CLASSES = new Set(['Warrior', 'Paladin', 'Shadow Knight']);
// Heal-capable classes for the Heal perspective panel. Paladin double-shows
// (also tags as a tank) — Knights heal as well, and the symmetry is what we
// want. Hybrids stay included so a Beastlord/Ranger CH contributor isn't
// silently dropped from the panel.
const HEAL_CLASSES = new Set(['Cleric', 'Druid', 'Shaman', 'Paladin', 'Ranger', 'Beastlord']);

// EQEmu names scripted/event mobs with a leading '#' and underscores
// ("#Grieg_Veneficus", "Lord_Inquisitor_Seru"). Clean those for display so
// the page shows "Grieg Veneficus" instead of the raw spawn name.
async function load(id: string) {
  try {
    const sb = supabaseAdmin();

    const { data: enc, error: encErr } = await sb
      .from('encounters')
      .select(`
        id, started_at, duration_sec, total_damage, total_dps, zone_short, npc_id,
        classification, classification_reason, classification_by,
        eqemu_npc_types ( id, name, zone_short ),
        encounter_players ( character_name, total_damage, dps, duration_sec, rank, has_pets )
      `)
      .eq('id', id)
      .single();
    if (encErr || !enc) return { error: encErr?.message || 'not found' };

    const { data: contribs } = await sb
      .from('contributions')
      .select('id, contributor_character, contributor_discord_id, source, total_damage, player_count, duration_sec, raw_parse, created_at, agent_version, has_ability_detail')
      .eq('encounter_id', id)
      .order('created_at', { ascending: true });

    // "Current at the time" baseline — the highest agent_version seen across
    // ANY contribution uploaded within ±7 days of this encounter's started_at.
    // Anyone uploading on an older version while peers were on a newer one
    // was demonstrably stale at the time, regardless of today's latest. We do
    // a windowed query (not lifetime-MAX) so an encounter from 2025 isn't
    // judged against 2026 versions.
    let latestAtTime: string | null = null;
    if (enc?.started_at) {
      const t = new Date((enc as { started_at: string }).started_at).getTime();
      const lo = new Date(t - 7 * 86400_000).toISOString();
      const hi = new Date(t + 7 * 86400_000).toISOString();
      const { data: peers } = await sb
        .from('contributions')
        .select('agent_version')
        .gte('created_at', lo)
        .lte('created_at', hi)
        .not('agent_version', 'is', null)
        .range(0, 9999);
      for (const r of (peers ?? []) as { agent_version: string | null }[]) {
        if (r.agent_version && cmpVer(r.agent_version, latestAtTime) > 0) {
          latestAtTime = r.agent_version;
        }
      }
    }

    const { data: zoneRows } = await sb
      .from('eqemu_zone')
      .select('short_name, long_name');
    const zones = new Map<string, ZoneRow>(
      (zoneRows ?? []).map((z: ZoneRow) => [z.short_name, z]),
    );

    // Loot for the same date as the kill (OpenDKP can't link per-encounter).
    const encTyped = enc as unknown as EncounterDetail;
    const date = dayKey(encTyped.started_at);
    const { data: lootRows } = await sb
      .from('opendkp_loot_recent')
      .select('item_name, character_name, dkp, game_item_id, notes')
      .eq('raid_date', date)
      .order('dkp', { ascending: false });

    // Class lookup comes from the OpenDKP roster mirror (characters table) —
    // the authoritative source. who_observations is too noisy and depends on
    // someone actually /who'ing the character in-zone. We include all players
    // in the encounter so the damage table and the by-class roll-up resolve
    // class consistently.
    const charNames = (encTyped.encounter_players ?? []).map(p => p.character_name);
    let charRows: { name: string; class: string | null; race: string | null; rank: string | null }[] = [];
    if (charNames.length > 0) {
      const { data } = await sb
        .from('characters')
        .select('name, class, race, rank')
        .in('name', charNames);
      charRows = (data ?? []) as typeof charRows;
    }
    // Build the class map, OpenDKP roster first. For any player the roster
    // doesn't cover (alts not synced, or a roster gap), fall back to the most
    // recent /who observation that carried a class. who_observations is
    // noisier but it's better than "Unknown" for a known raider.
    const whoMap = new Map<string, { character: string; class: string | null; race: string | null; level: number | null }>();
    for (const c of charRows) {
      whoMap.set(c.name.toLowerCase(), { character: c.name, class: c.class, race: c.race, level: null });
    }
    const missing = charNames.filter(n => !whoMap.get(n.toLowerCase())?.class);
    if (missing.length > 0) {
      const { data: obs } = await sb
        .from('who_observations')
        .select('character, class, race, level, observed_at')
        .in('character', missing)
        .not('class', 'is', null)
        .order('observed_at', { ascending: false });
      for (const o of (obs ?? []) as { character: string; class: string | null; race: string | null; level: number | null }[]) {
        const k = o.character.toLowerCase();
        if (!whoMap.get(k)?.class) {
          whoMap.set(k, { character: o.character, class: o.class, race: o.race, level: o.level });
        }
      }
    }
    // Known summoned-pet names — exact (case-insensitive) match only, so a
    // real player is never mis-flagged. Pet rows get bucketed under "Pets"
    // in the by-class roll-up instead of inflating "Unknown".
    const petSet = new Set<string>();
    {
      const { data: pets } = await sb.from('pet_names').select('name').eq('guild_id', 'wolfpack');
      for (const p of (pets ?? []) as { name: string }[]) petSet.add(p.name.toLowerCase());
    }

    // Zone fallback chain for future-proofing: encounters.zone_short (now
    // backfilled) → eqemu_npc_types.zone_short → bosses_local.zone_short.
    // The last one covers fresh kills recorded before a zone backfill runs,
    // since find_or_create_encounter still inserts NULL zone today.
    let bossLocalZone: string | null = null;
    if (encTyped.npc_id) {
      const { data: bl } = await sb
        .from('bosses_local')
        .select('zone_short')
        .eq('npc_id', encTyped.npc_id)
        .maybeSingle();
      bossLocalZone = (bl as { zone_short: string | null } | null)?.zone_short ?? null;
    }

    return {
      enc: encTyped,
      contribs: (contribs ?? []) as Contribution[],
      zones,
      loot: (lootRows ?? []) as LootRow[],
      whoMap,
      bossLocalZone,
      petSet,
      date,
      latestAtTime,
      error: null as string | null,
    };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function EncounterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect(`/auth/signin?next=/parses/${encodeURIComponent(id)}`);

  const data = await load(id);
  if (data.error || !data.enc) {
    if (data.error === 'not found') notFound();
    return (
      <div className="bg-panel border border-red rounded-lg p-4 text-red text-sm font-mono">
        Error loading encounter: {data.error}
      </div>
    );
  }
  const officer = await isOfficer(user.id);
  const tz = await userTz();
  const { enc, contribs, zones, loot, whoMap, bossLocalZone, petSet, date, latestAtTime } = data;
  // `date` (from load) is the ET raid-day bucket — keep it for the loot query
  // join. For DISPLAY, re-bucket the kill time in the viewer's chosen zone.
  const dispDate = dayKey(enc.started_at, tz);
  // Pet detection: explicit pet_names table first, then a name-pattern
  // fallback for pets we don't track by name yet. Wizard familiars
  // ("X's familiar", generic "familiar") and the "an air/earth/fire/water
  // elemental"-style pets generate a lot of distinct attacker rows that
  // otherwise inflate the "Unknown" class bucket on big fights. Patterns
  // are anchored to phrasings that real player names don't match
  // (lowercase article prefixes + the word "familiar" itself).
  const looksLikePet = (lower: string): boolean => (
    /\bfamiliar\b/.test(lower) ||
    /^an? (air|earth|fire|water|undead) elemental\b/.test(lower) ||
    /^a (sentient|skeletal|spectral|swarming) /.test(lower)
  );
  const isPet = (name: string) => {
    const lower = name.toLowerCase();
    return petSet.has(lower) || looksLikePet(lower);
  };

  const bossName = cleanBossName(enc.eqemu_npc_types?.name);
  const bossId   = enc.npc_id;
  const zoneShort = enc.zone_short || enc.eqemu_npc_types?.zone_short || bossLocalZone;
  const zoneLong = zoneShort ? zones.get(zoneShort)?.long_name || zoneShort : 'Unknown zone';

  const players = [...(enc.encounter_players ?? [])]
    .sort((a, b) => (b.total_damage || 0) - (a.total_damage || 0));
  const maxDamage = players[0]?.total_damage || 0;

  // Merge deaths across all contributions, dedup on name+ts. Then suppress
  // names that any SINGLE contributor reported dying 2+ times — a real player
  // can only die once per encounter (corpses don't respawn mid-fight), so a
  // repeat death from one machine's view means it's an NPC namesake getting
  // mis-attributed (Uilnayar 2026-06-25: 30+ phantom "Syphon" deaths in
  // Ssra because "Syphon" is both an SK player and a Quarm-custom NPC; the
  // agent's confirmedPlayer check matched the player and credited every
  // NPC-Syphon kill to him). One agent's view is enough to discredit the
  // name across the whole fight.
  const phantomNames = new Set<string>();
  for (const c of contribs) {
    const perName = new Map<string, number>();
    for (const d of (c.raw_parse?.deaths ?? [])) {
      const k = (d.name || '').toLowerCase();
      perName.set(k, (perName.get(k) ?? 0) + 1);
    }
    for (const [k, n] of perName) if (n >= 2) phantomNames.add(k);
  }
  const deathsMap = new Map<string, RawDeath>();
  for (const c of contribs) {
    for (const d of (c.raw_parse?.deaths ?? [])) {
      if (phantomNames.has((d.name || '').toLowerCase())) continue;
      const k = `${d.name}|${d.ts}`;
      if (!deathsMap.has(k)) deathsMap.set(k, d);
    }
  }
  const deaths = [...deathsMap.values()].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
  );

  // Tank perspective: find contributions whose contributor is a tank class.
  const tanks = contribs.filter(c => {
    const who = c.contributor_character ? whoMap.get(c.contributor_character.toLowerCase()) : null;
    return who?.class && TANK_CLASSES.has(who.class);
  });
  // Heal perspective: same logic but heal-capable classes. Paladins land in
  // both lists by design — they tank AND CH chain.
  const healers = contribs.filter(c => {
    const who = c.contributor_character ? whoMap.get(c.contributor_character.toLowerCase()) : null;
    return who?.class && HEAL_CLASSES.has(who.class);
  });

  // Inline renderer for "what agent uploaded this and was it current at the time?"
  // Replaces the raw `source: local_agent_v1` we used to print, which carried no
  // information once everyone moved to the unified agent. Shows `agent v3.1.38`
  // with a green ✓ when it matches the highest version seen across peer uploads
  // in the ±7-day window, or an amber chip ("← v3.1.45") when it was stale at
  // the time. Manual / chat-extracted contributions render with their source
  // label since they don't carry an agent_version. Null version on an
  // agent-source row means a pre-watermark upload that lacked the field.
  const renderContribSource = (c: Contribution) => {
    if (!c.agent_version) {
      // Manual / paste / chat-extracted — keep the source label since there's
      // no agent version to compare. local_agent_v1 with null version is the
      // pre-watermark case; flag it so officers can tell it's legacy data.
      const label = c.source === 'local_agent_v1' ? 'legacy upload' : c.source;
      return (
        <span className="text-dim text-[10px]" title={`source: ${c.source}`}>
          {label}
        </span>
      );
    }
    const cmp = cmpVer(c.agent_version, latestAtTime);
    const current = cmp >= 0 || !latestAtTime;
    return (
      <span className="text-dim text-[10px]" title={`source: ${c.source}${c.has_ability_detail ? ' · ability detail' : ''}`}>
        agent v{c.agent_version}
        {current ? (
          <span className="text-green ml-1" title="Up to date with peer uploads in this window">✓ current</span>
        ) : (
          <span className="text-orange ml-1" title={`Behind peers — latest at the time was v${latestAtTime}`}>
            · stale (latest v{latestAtTime})
          </span>
        )}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/parses" className="text-blue hover:underline">← back to parses</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
          <h2 className="text-2xl text-gold flex items-center gap-3 min-w-0">
            <span className="truncate">
              {bossId ? (
                <Link href={`/boss/${bossId}`} className="hover:underline">{bossName}</Link>
              ) : bossName}
            </span>
            <ClassificationChip classification={enc.classification} />
          </h2>
          <div className="text-dim text-sm">
            {dayLabel(dispDate, tz)} · {fmtTime(enc.started_at, tz)}
          </div>
        </div>
        {enc.classification && (
          <div className="text-xs text-dim mb-3 italic">
            Not counted as a guild kill
            {enc.classification_reason ? <> — <span className="text-text">{enc.classification_reason}</span></> : null}
            {enc.classification_by ? <span className="opacity-70"> · marked by {enc.classification_by}</span> : null}
          </div>
        )}
        <div className="text-sm text-dim flex flex-wrap gap-x-4 gap-y-1">
          <span><span className="text-orange">📍</span> {zoneLong}</span>
          <span>{fmtDuration(enc.duration_sec)}</span>
          <span className="text-text">{fmtDmg(enc.total_damage)} damage</span>
          {enc.total_dps > 0 && <span>{fmtDmg(enc.total_dps)}/s overall</span>}
          <span>{players.length} player{players.length === 1 ? '' : 's'}</span>
          <span
            className="underline decoration-dotted decoration-dim/60 cursor-help"
            title={
              contribs.length
                ? 'Contributors: ' + contribs.map(c => (c.contributor_character || '(anonymous)') + ' [' + c.source + ']').join(', ')
                : 'No contributors recorded'
            }
          >
            {contribs.length} contribution{contribs.length === 1 ? '' : 's'}
          </span>
        </div>

        {officer && (
          <div className="mt-4 pt-3 border-t border-border flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-dim uppercase tracking-wide mr-1">officer admin</span>
            {[
              { val: 'wipe', label: 'Mark Wipe', cls: 'border-orange/50 text-orange',
                desc: 'Engaged but did not kill — excluded from kill counts + stats' },
              { val: 'live', label: 'Mark Live', cls: 'border-blue/50 text-blue',
                desc: 'Live server, not guild instance — excluded from kill counts + stats' },
              { val: 'pvp',  label: 'Mark PvP',  cls: 'border-red/50 text-red',
                desc: 'PvP / Zek server — excluded from kill counts + stats' },
              { val: 'test', label: 'Mark Test', cls: 'border-dim/60 text-dim',
                desc: 'Practice / dummy pull — excluded from kill counts + stats' },
            ].map(b => (
              <form key={b.val} action={classifyEncounter} className="contents">
                <input type="hidden" name="id" value={enc.id} />
                <input type="hidden" name="classification" value={b.val} />
                <button
                  type="submit"
                  title={b.desc}
                  disabled={enc.classification === b.val}
                  className={`px-2 py-1 rounded text-xs border ${b.cls} ${enc.classification === b.val ? 'font-semibold' : 'opacity-80 hover:opacity-100'}`}
                >
                  {b.label}
                </button>
              </form>
            ))}
            {enc.classification && (
              <form action={clearClassification} className="ml-auto">
                <input type="hidden" name="id" value={enc.id} />
                <button
                  type="submit"
                  title="Clear classification — back to default (guild kill)"
                  className="px-2 py-1 rounded text-xs border border-border text-text hover:bg-bg"
                >
                  Clear classification
                </button>
              </form>
            )}
          </div>
        )}
      </section>

      {/* Damage by class */}
      {(() => {
        const totalEncDamage = players.reduce((s, p) => s + (p.total_damage || 0), 0);
        const byClass = new Map<string, { total: number; players: number }>();
        for (const p of players) {
          const who = whoMap.get(p.character_name.toLowerCase());
          const klass = isPet(p.character_name)
            ? 'Pets'
            : (who?.class || (p.has_pets ? 'Pets / unknown' : 'Unknown'));
          const e = byClass.get(klass) || { total: 0, players: 0 };
          e.total += p.total_damage || 0;
          e.players += 1;
          byClass.set(klass, e);
        }
        const rows = [...byClass.entries()]
          .map(([klass, v]) => ({ klass, ...v, share: totalEncDamage > 0 ? (v.total / totalEncDamage) * 100 : 0 }))
          .sort((a, b) => b.total - a.total);
        if (rows.length === 0 || totalEncDamage === 0) return null;
        return (
          <section className="bg-panel border border-border rounded-lg p-4">
            <h3 className="text-sm text-blue mb-3 flex items-center gap-2">
              <span aria-hidden>🎯</span>
              <span>Damage by class</span>
              <span className="text-dim text-xs">· class from OpenDKP roster, then /who; known pets bucket under Pets</span>
            </h3>
            <ul className="space-y-1">
              {rows.map((r) => (
                <li key={r.klass} className="text-xs">
                  <div className="flex justify-between gap-2 mb-0.5">
                    <span className="text-text">{r.klass} <span className="text-dim">· {r.players} player{r.players === 1 ? '' : 's'}</span></span>
                    <span className="text-dim">
                      {fmtDmg(r.total)} <span className="text-orange">· {r.share.toFixed(1)}%</span>
                    </span>
                  </div>
                  <div className="w-full bg-bg rounded h-1.5 overflow-hidden">
                    <div className="bg-blue h-full" style={{ width: `${r.share}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })()}

      {/* Damage breakdown */}
      <section className="bg-panel border border-border rounded-lg p-4">
        <h3 className="text-sm text-orange mb-3 flex items-center gap-2">
          <span aria-hidden>⚔️</span>
          <span>Damage breakdown</span>
          <span className="text-dim text-xs">· max-damage-per-player across {contribs.length} parser upload{contribs.length === 1 ? '' : 's'}</span>
        </h3>
        <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-dim text-left">
            <tr className="border-b border-border">
              <th className="py-1 pr-2 w-8">#</th>
              <th className="py-1 pr-2">Character</th>
              <th className="py-1 pr-2">Class</th>
              <th className="py-1 pr-2 text-right whitespace-nowrap">Damage</th>
              <th className="py-1 pr-2 text-right whitespace-nowrap">DPS</th>
              <th className="py-1 pr-2 text-right whitespace-nowrap">Duration</th>
              <th className="py-1 pl-2 min-w-[80px]">Share</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p, i) => {
              const share = maxDamage > 0 ? (p.total_damage / maxDamage) * 100 : 0;
              const who = whoMap.get(p.character_name.toLowerCase());
              const klass = isPet(p.character_name)
                ? 'Pet'
                : (who?.class || (p.has_pets ? '(has pets)' : '—'));
              return (
                <tr key={p.character_name} className="border-b border-border/30 hover:bg-[#1a212c]">
                  <td className="py-1 pr-2 text-dim">{i + 1}</td>
                  <td className="py-1 pr-2 text-text truncate">
                    <Link href={`/character/${encodeURIComponent(p.character_name)}`} className="hover:text-blue hover:underline">
                      {p.character_name}
                    </Link>
                  </td>
                  <td className="py-1 pr-2 text-dim whitespace-nowrap">{klass}</td>
                  <td className="py-1 pr-2 text-right text-text whitespace-nowrap">{fmtDmg(p.total_damage)}</td>
                  <td className="py-1 pr-2 text-right text-dim whitespace-nowrap">{p.dps ? `${fmtDmg(p.dps)}/s` : '—'}</td>
                  <td className="py-1 pr-2 text-right text-dim whitespace-nowrap">{fmtDuration(p.duration_sec)}</td>
                  <td className="py-1 pl-2">
                    <div className="w-full bg-bg rounded h-2 overflow-hidden">
                      <div
                        className="bg-blue h-full"
                        style={{ width: `${share}%` }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
            {players.length === 0 && (
              <tr><td colSpan={7} className="py-2 text-dim italic">No player rows.</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </section>

      {/* Deaths */}
      {deaths.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h3 className="text-sm text-red mb-2 flex items-center gap-2">
            <span aria-hidden>💀</span>
            <span>Deaths</span>
            <span className="text-dim text-xs">· {deaths.length}</span>
          </h3>
          <ul className="text-xs space-y-0.5">
            {deaths.map((d, i) => (
              <li key={i} className="flex gap-3">
                <span className="text-dim">{fmtTime(d.ts, tz)}</span>
                <span className="text-text">{d.name}</span>
                {d.class && <span className="text-dim">({d.class})</span>}
                {d.riposteDeath && <span className="text-red">⚔ riposte kill</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Tank perspective */}
      {tanks.length > 0 && (() => {
        // MT / PIVOT detection. Prefer time-based (per agent v3.1.50+ which
        // ships firstAttackAt / lastAttackAt per defender): the tank with the
        // earliest firstAttackAt is the MT. PIVOT is any other tank whose
        // first hit lands ≥5s AFTER the MT's first hit AND who absorbed a
        // meaningful share — share is the secondary tank's damageTaken /
        // MT's damageTaken. This correctly handles "DPS pulled aggro and got
        // smacked harder for a brief stretch" — the DPS's firstAttackAt is
        // AFTER the MT's, so they never get [MT]; if they only ate a few
        // hits, they also miss the PIVOT threshold. Falls back to pure share
        // when timestamps are absent (older agent uploads).
        const encStartMs = enc.started_at ? Date.parse(enc.started_at) : 0;
        type TankAgg = {
          id: string; name: string;
          damageTaken: number;
          firstAttackAt: number | null;
          lastAttackAt: number | null;
        };
        const tankAggs: TankAgg[] = tanks
          .map(t => {
            const n = t.contributor_character || '';
            const d = (t.raw_parse?.defenders ?? []).find(
              dd => dd.name?.toLowerCase() === n.toLowerCase(),
            );
            return {
              id: t.id,
              name: n,
              damageTaken:   d?.damageTaken   || 0,
              firstAttackAt: d?.firstAttackAt ?? null,
              lastAttackAt:  d?.lastAttackAt  ?? null,
            };
          })
          .filter(a => a.name && a.damageTaken > 0);

        const haveTimestamps = tankAggs.some(a => a.firstAttackAt !== null);
        // Authoritative ordering. By time when we have it; by damage share otherwise.
        const ranked = [...tankAggs].sort((a, b) => {
          if (haveTimestamps) {
            const af = a.firstAttackAt ?? Number.POSITIVE_INFINITY;
            const bf = b.firstAttackAt ?? Number.POSITIVE_INFINITY;
            if (af !== bf) return af - bf;
          }
          return b.damageTaken - a.damageTaken;
        });
        const mtId  = ranked[0]?.id;
        const mtDmg = ranked[0]?.damageTaken || 0;
        const mtFirst = ranked[0]?.firstAttackAt ?? null;
        // PIVOT — secondary tank who picked up AFTER the MT. With timestamps:
        // any other tank whose firstAttackAt is ≥5s after MT's AND took ≥15%
        // of MT's damage (or covers a ≥10s window). Without timestamps: the
        // share-based heuristic from before (second place, ≥20% of MT).
        const pivotId = (() => {
          if (haveTimestamps && mtFirst !== null) {
            for (const t of ranked.slice(1)) {
              if (t.firstAttackAt === null) continue;
              const lateBy = t.firstAttackAt - mtFirst;
              if (lateBy < 5_000) continue;
              const window = (t.lastAttackAt && t.firstAttackAt)
                ? t.lastAttackAt - t.firstAttackAt : 0;
              const share  = mtDmg > 0 ? t.damageTaken / mtDmg : 0;
              if (share >= 0.15 || window >= 10_000) return t.id;
            }
            return null;
          }
          return (ranked[1] && mtDmg > 0 && (ranked[1].damageTaken / mtDmg) >= 0.20)
            ? ranked[1].id : null;
        })();
        // Format mm:ss from the fight start. Used for tanking windows + the
        // inline death timestamp. Negative offsets shouldn't happen in
        // practice; clamp to 0 so a clock-skew event still reads sanely.
        const fmtOffset = (absMs: number | null | undefined) => {
          if (!absMs || !encStartMs) return null;
          const sec = Math.max(0, Math.round((absMs - encStartMs) / 1000));
          const m = Math.floor(sec / 60), s = sec % 60;
          return `${m}:${String(s).padStart(2, '0')}`;
        };
        return (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h3 className="text-sm text-blue mb-2 flex items-center gap-2">
            <span aria-hidden>🛡️</span>
            <span>Tank perspective</span>
            <span className="text-dim text-xs">· uploaded by {tanks.length} tank class character{tanks.length === 1 ? '' : 's'}</span>
          </h3>
          <ul className="text-xs space-y-2">
            {tanks.map((t) => {
              // Per-tank incoming swings + DS payback. The agent ships defenders
              // keyed by name (string match — uploader is normally listed) and
              // ds_reflects keyed by ability. Both undefined for older agent
              // versions, in which case we silently drop the extra lines and
              // keep the original "X players parsed, Y total" summary.
              const selfName = t.contributor_character || '';
              const selfDef  = (t.raw_parse?.defenders ?? []).find(
                d => d.name?.toLowerCase() === selfName.toLowerCase(),
              );
              const dsMap = t.raw_parse?.ds_reflects || {};
              const dsEntries = Object.entries(dsMap)
                .map(([name, v]) => ({ name, total: v?.total || 0, count: v?.count || 0 }))
                .filter(e => e.total > 0)
                .sort((a, b) => b.total - a.total);
              const dsTotal = dsEntries.reduce((s, e) => s + e.total, 0);
              const avoidanceBits: string[] = [];
              if (selfDef) {
                if (selfDef.dodges)   avoidanceBits.push(`${selfDef.dodges} dodge`);
                if (selfDef.parries)  avoidanceBits.push(`${selfDef.parries} parry`);
                if (selfDef.ripostes) avoidanceBits.push(`${selfDef.ripostes} riposte`);
                if (selfDef.blocks)   avoidanceBits.push(`${selfDef.blocks} block`);
                if (selfDef.invulns)  avoidanceBits.push(`${selfDef.invulns} invuln`);
                if (selfDef.misses)   avoidanceBits.push(`${selfDef.misses} miss`);
              }
              const totalAvoid = avoidanceBits.length
                ? (selfDef?.misses || 0) + (selfDef?.dodges || 0) + (selfDef?.parries || 0)
                  + (selfDef?.ripostes || 0) + (selfDef?.blocks || 0) + (selfDef?.invulns || 0)
                : 0;
              // Boss accuracy against this tank — hits / (hits + every form of
              // avoidance). Shown only when there are enough attempts (≥20) to
              // make the percentage meaningful — for a 3-swing tag, "33%" is
              // statistical noise.
              const attempts = (selfDef?.hits || 0) + totalAvoid;
              const accuracy = attempts >= 20 ? Math.round(((selfDef?.hits || 0) / attempts) * 100) : null;
              // Invuln-avoided damage estimate. The agent doesn't ship this
              // per-defender — same formula it uses in the dashboard Tanks
              // tab: invulns × bossMaxMelee. Falls back to the merged-card
              // bossMaxMelee if this contribution didn't carry one.
              const bmm = t.raw_parse?.bossMaxMelee
                       ?? Math.max(...tanks.map(o => o.raw_parse?.bossMaxMelee || 0), 0);
              const invulnAvoided = (selfDef?.invulns || 0) * bmm;
              // Deaths this tank suffered in this fight. `deaths` is already
              // merged + deduped above. We attach the per-death offset so we
              // can label "☠️ at 1:38" inline — useful for the "did they die
              // during a rampage / right after handover" question.
              const tankDeathRows = selfName
                ? deaths.filter(d => d.name?.toLowerCase() === selfName.toLowerCase())
                : [];
              const tankDeaths = tankDeathRows.length;
              const tankDeathOffsets = tankDeathRows
                .map(d => fmtOffset(Date.parse(d.ts)))
                .filter((x): x is string => !!x);
              // Tanking window — first → last incoming swing, MM:SS from
              // fight start. We render this even when the tank isn't MT/PIVOT
              // because it answers the question "when were they actually
              // being attacked." Falls back to undefined for older agents.
              const windowFrom = fmtOffset(selfDef?.firstAttackAt);
              const windowTo   = fmtOffset(selfDef?.lastAttackAt);
              const windowStr  = (windowFrom && windowTo) ? `${windowFrom}–${windowTo}` : null;
              // Role tag — [MT] for top damageTaken, [PIVOT] for a meaningful
              // secondary. [ramp] when this tank ate a tagged rampage hit.
              // Tags only render when we have the underlying data — older
              // agents pass through without any tag noise.
              const isMt    = t.id === mtId    && (selfDef?.damageTaken || 0) > 0;
              const isPivot = t.id === pivotId && (selfDef?.damageTaken || 0) > 0;
              const isRamp  = (selfDef?.rampageHits || 0) > 0;
              return (
                <li key={t.id} className="text-dim">
                  <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5">
                    {t.contributor_character ? (
                      <Link href={`/character/${encodeURIComponent(t.contributor_character)}`} className="text-text hover:text-blue hover:underline">
                        {t.contributor_character}
                      </Link>
                    ) : <span className="text-text">(anonymous)</span>}
                    {isMt && (
                      <span
                        title={`Took the most incoming damage (${fmtDmg(selfDef!.damageTaken!)}) — likely the main tank for this fight.`}
                        className="text-[10px] uppercase tracking-wide font-semibold px-1 py-px rounded border bg-blue/20 text-blue border-blue/40"
                      >MT</span>
                    )}
                    {isPivot && (
                      <span
                        title={`Took ${Math.round((selfDef!.damageTaken! / mtDmg) * 100)}% of the MT's incoming damage — picked up a meaningful chunk of the fight.`}
                        className="text-[10px] uppercase tracking-wide font-semibold px-1 py-px rounded border bg-orange/20 text-orange border-orange/40"
                      >PIVOT</span>
                    )}
                    {isRamp && (
                      <span
                        title={`Ate ${selfDef!.rampageHits} rampage hit${selfDef!.rampageHits === 1 ? '' : 's'} for ${fmtDmg(selfDef!.rampageDmg || 0)}.`}
                        className="text-[10px] uppercase tracking-wide font-semibold px-1 py-px rounded border bg-red/20 text-red border-red/40"
                      >ramp</span>
                    )}
                    {tankDeaths > 0 && (
                      <span
                        title={
                          tankDeathOffsets.length > 0
                            ? `Died at ${tankDeathOffsets.join(', ')}.`
                            : `${tankDeaths} death${tankDeaths === 1 ? '' : 's'} during this fight.`
                        }
                        className="text-red"
                        aria-label={`died ${tankDeaths} time${tankDeaths === 1 ? '' : 's'}`}
                      >
                        {'☠️'.repeat(Math.min(tankDeaths, 10))}
                      </span>
                    )}
                    <span>—</span>
                    <span>{(t.raw_parse?.players ?? []).length} players parsed,</span>
                    <span>{fmtDmg(t.raw_parse?.totalDamage ?? 0)} total</span>
                    <span className="mx-1 opacity-60">·</span>
                    {renderContribSource(t)}
                  </div>
                  {selfDef && (selfDef.hits || totalAvoid) ? (
                    <div className="ml-3 text-[11px] mt-0.5">
                      <span className="opacity-50">↳ </span>
                      {windowStr && (
                        <span
                          className="text-text"
                          title="Time window the boss was actively swinging at this tank, from fight start. Helps see the handover: MT tanked 0:00–1:38, PIVOT picked up 1:39–end."
                        >
                          {windowStr}
                          <span className="opacity-60"> · </span>
                        </span>
                      )}
                      <span>took </span>
                      <span className="text-text">{selfDef.hits || 0} hit{selfDef.hits === 1 ? '' : 's'}</span>
                      <span> for </span>
                      <span className="text-text">{fmtDmg(selfDef.damageTaken || 0)}</span>
                      {accuracy !== null && (
                        <span className="opacity-60" title={`Boss connected on ${selfDef.hits || 0} of ${attempts} swings against this tank`}>
                          {' ('}{accuracy}{'% accuracy)'}
                        </span>
                      )}
                      {totalAvoid > 0 && (
                        <>
                          <span> · avoided </span>
                          <span className="text-text">{totalAvoid}</span>
                          <span className="opacity-70"> ({avoidanceBits.join(' / ')})</span>
                        </>
                      )}
                      {invulnAvoided > 0 && (
                        <span title={`Estimated damage absorbed by ${selfDef.invulns} invulnerability tick${selfDef.invulns === 1 ? '' : 's'} (invulns × boss's biggest single hit, ${fmtDmg(bmm)}).`}>
                          {' · ~'}
                          <span className="text-text">{fmtDmg(invulnAvoided)}</span>
                          <span> absorbed</span>
                        </span>
                      )}
                      {(selfDef.ripostedFor || 0) > 0 && (
                        <span title="Damage the boss took from this tank's ripostes">
                          {' · riposted back '}
                          <span className="text-text">{fmtDmg(selfDef.ripostedFor || 0)}</span>
                        </span>
                      )}
                    </div>
                  ) : null}
                  {dsTotal > 0 ? (
                    <div className="ml-3 text-[11px] mt-0.5" title={dsEntries.map(e => `${e.name}: ${e.count} procs, ${e.total} dmg`).join('\n')}>
                      <span className="opacity-50">↳ </span>
                      <span>DS dealt </span>
                      <span className="text-text">{fmtDmg(dsTotal)}</span>
                      <span> back</span>
                      {dsEntries.length > 0 && (
                        <span className="opacity-70">
                          {' ('}
                          {dsEntries.slice(0, 3).map((e, i) => (
                            <span key={e.name}>
                              {i > 0 ? ' / ' : ''}
                              {e.name} {fmtDmg(e.total)}
                            </span>
                          ))}
                          {dsEntries.length > 3 ? ` / +${dsEntries.length - 3} more` : ''}
                          {')'}
                        </span>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
        );
      })()}

      {/* Heal perspective — mirror of Tank perspective. One row per heal-class
          contributor; their own healers[] entry (matched by name) drives the
          ↳ summary line. [MAIN HEAL] is the healer with the highest `healed`
          total; [OFF HEAL] is a secondary contributor with ≥20% of MAIN's
          output. Older agents that didn't ship firstHealAt/lastHealAt still
          render the totals + targets cleanly; the inline heal window just
          doesn't appear. */}
      {healers.length > 0 && (() => {
        const encStartMs = enc.started_at ? Date.parse(enc.started_at) : 0;
        const fmtOffset = (absMs: number | null | undefined) => {
          if (!absMs || !encStartMs) return null;
          const sec = Math.max(0, Math.round((absMs - encStartMs) / 1000));
          const m = Math.floor(sec / 60), s = sec % 60;
          return `${m}:${String(s).padStart(2, '0')}`;
        };
        type HealAgg = { id: string; name: string; healed: number };
        const healAggs: HealAgg[] = healers
          .map(h => {
            const n = h.contributor_character || '';
            const entry = (h.raw_parse?.healers ?? []).find(
              hh => hh.name?.toLowerCase() === n.toLowerCase(),
            );
            return { id: h.id, name: n, healed: entry?.healed || 0 };
          })
          .filter(a => a.name && a.healed > 0)
          .sort((a, b) => b.healed - a.healed);
        const mainId    = healAggs[0]?.id;
        const mainTotal = healAggs[0]?.healed || 0;
        const offIds    = new Set<string>(
          healAggs.slice(1).filter(a => mainTotal > 0 && a.healed / mainTotal >= 0.20).map(a => a.id),
        );
        // CH-chain gap signal — surface once at the top if any contribution
        // saw a meaningful gap on the tank. We don't try to attribute it to
        // a specific healer (the agent doesn't either); a gap means "the
        // chain dropped" and that's a raid-wide observation.
        const chainGap = healers
          .map(h => h.raw_parse?.healGaps)
          .filter((g): g is HealGaps => !!g && g.maxGapMs >= 8000)
          .sort((a, b) => b.maxGapMs - a.maxGapMs)[0] || null;
        return (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h3 className="text-sm text-blue mb-2 flex items-center gap-2">
            <span aria-hidden>🩹</span>
            <span>Heal perspective</span>
            <span className="text-dim text-xs">· uploaded by {healers.length} heal-class character{healers.length === 1 ? '' : 's'}</span>
          </h3>
          {chainGap && (
            <div
              className="text-[11px] text-orange mb-2"
              title={`Longest heal-free stretch on ${chainGap.tank} = ${(chainGap.maxGapMs / 1000).toFixed(1)}s across ${chainGap.count} gap${chainGap.count === 1 ? '' : 's'} > 8s. CH ticks every ~12s; a 14s+ gap means the chain dropped at least once.`}
            >
              ⚠️ Chain gap on {chainGap.tank} — peak {(chainGap.maxGapMs / 1000).toFixed(1)}s
              {chainGap.count > 1 && ` (${chainGap.count} stretches > 8s)`}
            </div>
          )}
          <ul className="text-xs space-y-2">
            {healers.map((h) => {
              const selfName = h.contributor_character || '';
              const selfHeal = (h.raw_parse?.healers ?? []).find(
                hh => hh.name?.toLowerCase() === selfName.toLowerCase(),
              );
              // Prefer per-recipient totals (agent v3.1.69+); fall back to
              // the bare name list for older uploads.
              const byTargetEntries = selfHeal?.byTarget
                ? Object.entries(selfHeal.byTarget).sort((a, b) => b[1] - a[1])
                : null;
              const targets   = (selfHeal?.targets || []).slice(0, 5);
              const moreCount = Math.max(0, (selfHeal?.targets || []).length - targets.length);
              // Spell-count summary — abbreviate the noisy long EQ names.
              const SPELL_LABELS: [RegExp, string][] = [
                [/^complete healing$/i, 'CH'],
                [/^greater healing$/i, 'GH'],
                [/^superior healing$/i, 'SH'],
                [/^healing(?: light)?$/i, 'Heal'],
                [/^minor healing$/i, 'mH'],
                [/^light healing$/i, 'LH'],
                [/^word of restoration$/i, 'WoR'],
                [/^word of healing$/i, 'WoH'],
                [/^word of vigor$/i, 'WoV'],
                [/^lay on hands$/i, 'LoH'],
                [/^touch of the divine$/i, 'ToD'],
                [/^renewal of light$/i, 'RoL'],
                [/^chloroplast$/i, 'Chlro'],
                [/^regrowth of the grove$/i, 'RotG'],
                [/^regrowth$/i, 'Regrowth'],
                [/^karana's renewal$/i, 'KR'],
                [/^torpor$/i, 'Torpor'],
                [/^ward of restoration$/i, 'WoR'],
              ];
              const labelOf = (name: string) => {
                for (const [rx, lbl] of SPELL_LABELS) if (rx.test(name)) return lbl;
                return name;
              };
              const spellEntries = selfHeal?.spells
                ? Object.entries(selfHeal.spells).filter(([, n]) => (n || 0) > 0).sort((a, b) => b[1] - a[1])
                : [];
              const healerDeathRows = selfName
                ? deaths.filter(d => d.name?.toLowerCase() === selfName.toLowerCase())
                : [];
              const healerDeaths = healerDeathRows.length;
              const healerDeathOffsets = healerDeathRows
                .map(d => fmtOffset(Date.parse(d.ts)))
                .filter((x): x is string => !!x);
              const windowStr = (selfHeal?.firstHealAt && selfHeal?.lastHealAt)
                ? `${fmtOffset(selfHeal.firstHealAt)}–${fmtOffset(selfHeal.lastHealAt)}`
                : null;
              const isMain = h.id === mainId && (selfHeal?.healed || 0) > 0;
              const isOff  = offIds.has(h.id);
              return (
                <li key={h.id} className="text-dim">
                  <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5">
                    {h.contributor_character ? (
                      <Link href={`/character/${encodeURIComponent(h.contributor_character)}`} className="text-text hover:text-blue hover:underline">
                        {h.contributor_character}
                      </Link>
                    ) : <span className="text-text">(anonymous)</span>}
                    {isMain && (
                      <span
                        title={`Top heal output on this fight (${fmtDmg(selfHeal!.healed!)}). Doesn't necessarily mean main CH — see the targets list to read role.`}
                        className="text-[10px] uppercase tracking-wide font-semibold px-1 py-px rounded border bg-green/20 text-green border-green/40"
                      >MAIN HEAL</span>
                    )}
                    {isOff && (
                      <span
                        title={`${Math.round(((selfHeal?.healed || 0) / mainTotal) * 100)}% of the top healer's output — meaningful secondary contributor.`}
                        className="text-[10px] uppercase tracking-wide font-semibold px-1 py-px rounded border bg-blue/20 text-blue border-blue/40"
                      >OFF HEAL</span>
                    )}
                    {healerDeaths > 0 && (
                      <span
                        title={
                          healerDeathOffsets.length > 0
                            ? `Died at ${healerDeathOffsets.join(', ')}.`
                            : `${healerDeaths} death${healerDeaths === 1 ? '' : 's'} during this fight.`
                        }
                        className="text-red"
                        aria-label={`died ${healerDeaths} time${healerDeaths === 1 ? '' : 's'}`}
                      >
                        {'☠️'.repeat(Math.min(healerDeaths, 10))}
                      </span>
                    )}
                    <span>—</span>
                    <span>{(h.raw_parse?.players ?? []).length} players parsed,</span>
                    <span>{fmtDmg(h.raw_parse?.totalDamage ?? 0)} total</span>
                    <span className="mx-1 opacity-60">·</span>
                    {renderContribSource(h)}
                  </div>
                  {selfHeal && ((selfHeal.healed || 0) > 0 || (selfHeal.ticks || 0) > 0) ? (
                    <div className="ml-3 text-[11px] mt-0.5">
                      <span className="opacity-50">↳ </span>
                      {windowStr && (
                        <span
                          className="text-text"
                          title="Time window of observed heals from this caster, MM:SS from fight start. Quiet stretches inside the window mean they paused — not necessarily a chain drop."
                        >
                          {windowStr}
                          <span className="opacity-60"> · </span>
                        </span>
                      )}
                      <span>healed </span>
                      <span className="text-text">{fmtDmg(selfHeal.healed || 0)}</span>
                      {(selfHeal.ticks || 0) > 0 && (
                        <span className="opacity-60"> ({selfHeal.ticks} tick{selfHeal.ticks === 1 ? '' : 's'})</span>
                      )}
                      {byTargetEntries && byTargetEntries.length > 0 ? (
                        <>
                          <span> on </span>
                          {byTargetEntries.slice(0, 4).map(([name, amt], i) => (
                            <span key={name}>
                              {i > 0 && <span className="opacity-60">, </span>}
                              <Link href={`/character/${encodeURIComponent(name)}`} className="text-text hover:text-blue hover:underline">{name}</Link>
                              <span className="opacity-60"> {fmtDmg(amt)}</span>
                            </span>
                          ))}
                          {byTargetEntries.length > 4 && <span className="opacity-60">, +{byTargetEntries.length - 4} more</span>}
                        </>
                      ) : targets.length > 0 ? (
                        <>
                          <span> on </span>
                          <span className="text-text">{targets.join(', ')}</span>
                          {moreCount > 0 && <span className="opacity-60">, +{moreCount} more</span>}
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  {spellEntries.length > 0 && (
                    <div className="ml-3 text-[11px] mt-0.5">
                      <span className="opacity-50">↳ </span>
                      <span title="Heal-spell cast counts from this healer's own log. Only the caster's client logs the spell name — others see 'begins to cast a spell' — so this only counts when this healer was running the agent.">
                        {spellEntries.map(([name, n], i) => (
                          <span key={name}>
                            {i > 0 && <span className="opacity-60"> · </span>}
                            <span className="text-text">{labelOf(name)}</span>
                            <span className="opacity-60"> × {n}</span>
                          </span>
                        ))}
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
        );
      })()}

      {/* Contributors */}
      <section className="bg-panel border border-border rounded-lg p-4">
        <h3 className="text-sm text-dim mb-2 flex items-center gap-2">
          <span aria-hidden>📤</span>
          <span>Contributors</span>
        </h3>
        <ul className="text-xs grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
          {contribs.map((c) => (
            <li key={c.id} className="flex justify-between gap-2">
              <span className="truncate">
                {c.contributor_character ? (
                  <Link href={`/character/${encodeURIComponent(c.contributor_character)}`} className="text-text hover:text-blue hover:underline">
                    {c.contributor_character}
                  </Link>
                ) : <span className="text-text">(anonymous)</span>}
                <span className="ml-1">{renderContribSource(c)}</span>
              </span>
              <span className="text-dim whitespace-nowrap">{fmtDmg(c.total_damage)}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Loot for the night */}
      {loot.length > 0 && (
        <div>
          <div className="text-xs text-dim mb-2">All loot awarded on {date} (OpenDKP):</div>
          <LootBlock loot={loot} />
        </div>
      )}
    </div>
  );
}
