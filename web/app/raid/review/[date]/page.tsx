// /raid/review/[date] — one raid night, reviewed. (#80)
//
// The morning-after page for a single Eastern raid-day. Every section renders
// ONLY when it has data (empty night = a friendly empty state, never a crash):
//   1. Kills timeline  — the night's encounters in kill order (boss, time,
//      duration, damage), with wipe / engaged markers.
//   2. Deaths          — from contributions.raw_parse.deaths, deduped with the
//      SAME #134 logic the parse page uses (dedupEncounterDeaths) so counts
//      match; tagged with the boss they died on.
//   3. Slows landed    — buff_casts rows matching the known slow-spell set,
//      collapsed across observers (target + spell + time).
//   4. Callouts fired  — encounter_events (kind='fire'): Death Touch + trigger
//      fires observed during the night's fights.
//   5. Loot & bids     — that night's OpenDKP awards (item → winner · DKP).
//
// Read-only, member-gated like /parses. Bounded to one night's UTC window.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { fmtDmg, fmtDuration, fmtTime, dayLabel, cleanBossName, RAID_TZ } from '@/lib/format';
import { userTz } from '@/lib/timezone';
import { guildShare, isAutoForeign } from '@/lib/anomalies';
import {
  dedupEncounterDeaths, dedupeSlows, isValidDateKey, zonedDayRangeUtc,
  type RawDeath, type SlowCast,
} from '@/lib/raidReview';
import { ClassificationChip } from '@/components/KillCard';
import NightSummary, { type NightStats } from '@/components/NightSummary';
import LootBlock, { type LootRow } from '@/components/LootBlock';

export const dynamic = 'force-dynamic';

type PlayerRow = { character_name: string; total_damage: number; rank: number | null };
type EncRow = {
  id: string;
  started_at: string;
  ended_at: string | null;
  duration_sec: number | null;
  total_damage: number;
  total_dps: number;
  zone_short: string | null;
  npc_id: number | null;
  classification: string | null;
  eqemu_npc_types: { id: number; name: string; zone_short: string | null } | null;
  encounter_players: PlayerRow[];
};
type ZoneRow = { short_name: string; long_name: string };
type FireRow = { at: string; subtype: string | null; actor: string | null; label: string | null };

async function load(date: string) {
  try {
    const sb = supabaseAdmin();
    const { startIso, endIso } = zonedDayRangeUtc(date, RAID_TZ);

    const [encRes, charRes, zoneRes, slowRes, fireRes, lootRes] = await Promise.all([
      sb.from('encounters')
        .select(`
          id, started_at, ended_at, duration_sec, total_damage, total_dps, zone_short, npc_id, classification,
          eqemu_npc_types ( id, name, zone_short ),
          encounter_players ( character_name, total_damage, rank )
        `)
        .gte('started_at', startIso)
        .lt('started_at', endIso)
        .order('started_at', { ascending: true }),
      sb.from('characters')
        .select('name, class, exclude_from_stats')
        .eq('guild_id', 'wolfpack'),
      sb.from('eqemu_zone').select('short_name, long_name'),
      sb.from('buff_casts')
        .select('target, spell_name, cast_at, observer')
        .eq('guild_id', 'wolfpack')
        .gte('cast_at', startIso)
        .lt('cast_at', endIso)
        .order('cast_at', { ascending: true })
        .limit(5000),
      sb.from('encounter_events')
        .select('at, subtype, actor, label')
        .eq('guild_id', 'wolfpack')
        .eq('kind', 'fire')
        .gte('at', startIso)
        .lt('at', endIso)
        .order('at', { ascending: true })
        .limit(3000),
      sb.from('opendkp_loot_recent')
        .select('item_name, character_name, dkp, game_item_id, notes')
        .eq('raid_date', date)
        .order('dkp', { ascending: false }),
    ]);

    if (encRes.error) return { ok: false as const, error: encRes.error.message };

    const roster = new Set<string>(
      (charRes.data ?? []).map((r: { name: string }) => (r.name || '').toLowerCase()).filter(Boolean),
    );
    const excluded = new Set<string>(
      (charRes.data ?? [])
        .filter((r: { exclude_from_stats: boolean | null }) => r.exclude_from_stats)
        .map((r: { name: string }) => (r.name || '').toLowerCase()).filter(Boolean),
    );
    const classByName = new Map<string, string | null>(
      (charRes.data ?? []).map((r: { name: string; class: string | null }) => [r.name.toLowerCase(), r.class]),
    );
    const zones = new Map<string, ZoneRow>((zoneRes.data ?? []).map((z: ZoneRow) => [z.short_name, z]));

    // Real (non-foreign) encounters only — same auto-hide rule as /parses.
    const allEncs = (encRes.data as unknown as EncRow[]) ?? [];
    const encs = allEncs.filter(e => {
      if (e.classification === 'foreign') return false;
      if (e.classification == null && isAutoForeign(guildShare(e.encounter_players ?? [], roster))) return false;
      return true;
    });

    // Deaths: pull ONLY the deaths sub-array of raw_parse for the night's
    // encounters (light payload), then run the shared per-encounter dedup.
    const encIds = encs.map(e => e.id);
    let deathContribs: { encounter_id: string; deaths: RawDeath[] | null }[] = [];
    if (encIds.length) {
      const { data: dc } = await sb
        .from('contributions')
        .select('encounter_id, deaths:raw_parse->deaths')
        .in('encounter_id', encIds)
        .limit(4000);
      deathContribs = (dc ?? []) as { encounter_id: string; deaths: RawDeath[] | null }[];
    }

    return {
      ok: true as const,
      encs, zones, classByName, excluded,
      slows: (slowRes.data ?? []) as SlowCast[],
      fires: (fireRes.data ?? []) as FireRow[],
      loot: (lootRes.data ?? []) as LootRow[],
      deathContribs,
    };
  } catch (err: unknown) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function RaidNightReview({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!isValidDateKey(date)) notFound();

  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect(`/auth/signin?next=/raid/review/${encodeURIComponent(date)}`);

  const tz = await userTz();
  const data = await load(date);
  if (!data.ok) {
    return (
      <div className="space-y-4">
        <ReviewHeader date={date} />
        <section className="bg-panel border border-red rounded-lg p-4 text-red text-sm font-mono">
          Error loading this night: {data.error}
        </section>
      </div>
    );
  }
  const { encs, zones, classByName, excluded, slows, fires, loot, deathContribs } = data;

  const bossFor = (e: EncRow) => cleanBossName(e.eqemu_npc_types?.name);
  const zoneFor = (e: EncRow) => {
    const short = e.zone_short || e.eqemu_npc_types?.zone_short || null;
    return short ? zones.get(short)?.long_name || short : null;
  };
  const killAtMs = (e: EncRow) => new Date(e.started_at).getTime() + (e.duration_sec ?? 0) * 1000;

  // Kills timeline — sort by KILL time (start + duration), like /parses.
  const timeline = [...encs].sort((a, b) => killAtMs(a) - killAtMs(b));
  const kills = timeline.filter(e => !e.classification && e.ended_at != null);

  // Deaths — per-encounter dedup (shared #134 logic), tagged with the boss,
  // honoring exclude_from_stats, then flattened night-wide by time.
  const contribsByEnc = new Map<string, RawDeath[][]>();
  for (const c of deathContribs) {
    if (!c.encounter_id) continue;
    const arr = contribsByEnc.get(c.encounter_id) || [];
    arr.push(Array.isArray(c.deaths) ? c.deaths : []);
    contribsByEnc.set(c.encounter_id, arr);
  }
  type NightDeath = { name: string; ts: string; class: string | null; riposteDeath: boolean; boss: string };
  const nightDeaths: NightDeath[] = [];
  for (const e of encs) {
    const rows = dedupEncounterDeaths(contribsByEnc.get(e.id) || []);
    for (const d of rows) {
      if (excluded.has(d.name.toLowerCase())) continue;
      const tms = new Date(d.ts).getTime();
      if (!Number.isFinite(tms)) continue;                    // guard malformed ts (no throw on toISOString)
      const klass = d.class || classByName.get(d.name.toLowerCase()) || null;
      // A row can carry count>1 (genuine rez-and-die); expand so each death is
      // its own line on the timeline.
      for (let i = 0; i < Math.max(1, d.count); i++) {
        nightDeaths.push({ name: d.name, ts: new Date(tms).toISOString(), class: klass, riposteDeath: d.riposteDeath, boss: bossFor(e) });
      }
    }
  }
  nightDeaths.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  // Slows — collapse multi-observer landings, then honor exclude on the target
  // (rare — targets are usually the boss).
  const slowRows = dedupeSlows(slows).filter(s => !excluded.has(s.target.toLowerCase()));

  // Boss mechanics fired — encounter_events(kind='fire') is a broad stream:
  // most rows are personal cast/movement/line-of-sight notices ("Too Far",
  // "Spell Interrupted", "Can Not See") that mean nothing to a raid review. We
  // drop that personal-fail noise and keep the raid-relevant mechanics —
  // Death Touch above all, plus rampage, breath resists, dispels — which is
  // what "what hit us and when" wants. Dedup across uploaders (same label+actor
  // within 3s), like the parse-page timeline.
  const FIRE_NOISE = new Set<string>([
    'too far', 'spell interrupted', 'can not see', 'cannot see',
    'can not hit from here', 'cannot hit from here', 'range', 'out of range',
    'camo break', 'invis did break', 'invis',
  ]);
  const DT_RE = /death\s*touch|\bdt\b/i;
  type FireMark = { at: string; label: string; actor: string | null; isDt: boolean };
  const fireSorted = [...fires]
    .map(f => ({ ...f, t: new Date(f.at).getTime() }))
    .filter(f => Number.isFinite(f.t))
    .filter(f => !FIRE_NOISE.has(String(f.subtype || f.label || '').toLowerCase().trim()))
    .sort((a, b) => a.t - b.t);
  const fireMarks: FireMark[] = [];
  const fireLast = new Map<string, number>();
  for (const f of fireSorted) {
    const label = f.label || f.subtype || 'callout';
    const key = `${label.toLowerCase()}|${(f.actor || '').toLowerCase()}`;
    const prev = fireLast.get(key);
    if (prev != null && Math.abs(f.t - prev) <= 3000) continue;
    fireLast.set(key, f.t);
    fireMarks.push({ at: f.at, label, actor: f.actor, isDt: DT_RE.test(label) || DT_RE.test(f.subtype || '') });
  }

  // Night summary headline (reuses the /parses NightSummary card).
  let topPlayer: { name: string; damage: number } | null = null;
  let longest: { boss: string; duration_sec: number } | null = null;
  let totalDamage = 0, totalDuration = 0;
  for (const e of kills) {
    totalDamage += e.total_damage || 0;
    totalDuration += e.duration_sec || 0;
    for (const p of e.encounter_players || []) {
      if (excluded.has(p.character_name.toLowerCase())) continue;
      if (!topPlayer || p.total_damage > topPlayer.damage) topPlayer = { name: p.character_name, damage: p.total_damage };
    }
    const d = e.duration_sec || 0;
    if (!longest || d > longest.duration_sec) longest = { boss: bossFor(e), duration_sec: d };
  }
  const stats: NightStats = {
    date,
    encounters: kills.length,
    total_damage: totalDamage,
    total_duration_sec: totalDuration,
    top_player: topPlayer,
    longest_fight: longest,
    deaths: nightDeaths.length,
  };

  const nothing = timeline.length === 0 && slowRows.length === 0 && fireMarks.length === 0 && loot.length === 0;

  const topPlayerOf = (e: EncRow) => {
    const ranked = [...(e.encounter_players ?? [])].sort((a, b) => (b.total_damage || 0) - (a.total_damage || 0));
    return ranked[0]?.character_name || null;
  };

  return (
    <div className="space-y-6">
      <ReviewHeader date={date} tz={tz} />

      {nothing ? (
        <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
          Nothing was recorded for this night — no kills, slows, callouts, or loot. If the raid ran, the
          wolfpack-logsync agent may not have been uploading. Try an adjacent night from the{' '}
          <Link href="/raid/review" className="text-blue hover:underline">review index</Link>.
        </section>
      ) : (
        <>
          {kills.length > 0 && <NightSummary stats={stats} />}

          {/* 1. Kills timeline */}
          {timeline.length > 0 && (
            <section className="bg-panel border border-border rounded-lg p-4">
              <h3 className="text-sm text-gold mb-3 flex items-center gap-2">
                <span aria-hidden>🗡️</span><span>Kills timeline</span>
                <span className="text-dim text-xs">· {kills.length} kill{kills.length === 1 ? '' : 's'} in the order they happened</span>
              </h3>
              <ol className="space-y-1">
                {timeline.map((e) => {
                  const engaged = e.ended_at == null;
                  const wipe = e.classification === 'wipe';
                  const other = !!e.classification && !wipe;
                  const top = topPlayerOf(e);
                  return (
                    <li
                      key={e.id}
                      className={`flex items-baseline gap-2 flex-wrap text-xs border-b border-border/30 py-1 ${e.classification || engaged ? 'opacity-75' : ''}`}
                    >
                      <span className="text-dim tabular-nums whitespace-nowrap w-14 shrink-0">
                        {fmtTime(new Date(killAtMs(e)).toISOString(), tz)}
                      </span>
                      <span className="text-text truncate min-w-0">
                        <Link href={`/parses/${e.id}`} className="hover:text-blue hover:underline">{bossFor(e)}</Link>
                      </span>
                      <ClassificationChip classification={e.classification} />
                      {engaged && !e.classification && (
                        <span className="text-[9px] uppercase tracking-wide font-semibold px-1 py-px rounded border bg-orange/20 text-orange border-orange/40" title="No slain line observed — engaged, no confirmed kill">
                          ENGAGED
                        </span>
                      )}
                      <span className="text-dim ml-auto whitespace-nowrap">{fmtDuration(e.duration_sec)}</span>
                      {!engaged && !other && <span className="text-dim whitespace-nowrap">{fmtDmg(e.total_damage)}</span>}
                      {top && !e.classification && (
                        <span className="text-dim whitespace-nowrap hidden sm:inline">top {top}</span>
                      )}
                      {zoneFor(e) && <span className="text-orange/70 whitespace-nowrap hidden md:inline">📍 {zoneFor(e)}</span>}
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          {/* 2. Deaths */}
          {nightDeaths.length > 0 && (
            <section className="bg-panel border border-border rounded-lg p-4">
              <h3 className="text-sm text-red mb-2 flex items-center gap-2">
                <span aria-hidden>💀</span><span>Deaths</span>
                <span className="text-dim text-xs">· {nightDeaths.length} across the night</span>
              </h3>
              <ul className="text-xs space-y-0.5">
                {nightDeaths.map((d, i) => (
                  <li key={i} className="flex gap-3 flex-wrap">
                    <span className="text-dim tabular-nums w-14 shrink-0">{fmtTime(d.ts, tz)}</span>
                    <span className="text-text">{d.name}</span>
                    {d.class && <span className="text-dim">({d.class})</span>}
                    {d.riposteDeath && <span className="text-red">⚔ riposte kill</span>}
                    <span className="text-dim ml-auto">on {d.boss}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 3. Slows landed */}
          {slowRows.length > 0 && (
            <section className="bg-panel border border-border rounded-lg p-4">
              <h3 className="text-sm text-blue mb-2 flex items-center gap-2">
                <span aria-hidden>🐌</span><span>Slows landed</span>
                <span className="text-dim text-xs">· {slowRows.length} · matched to known slow spells</span>
              </h3>
              <ul className="text-xs space-y-0.5">
                {slowRows.map((s, i) => (
                  <li key={i} className="flex gap-3 flex-wrap">
                    <span className="text-dim tabular-nums w-14 shrink-0">{fmtTime(s.at, tz)}</span>
                    <span className="text-text">{s.spell}</span>
                    <span className="text-dim">on {s.target}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[10px] text-dim mt-2">
                Slows are read from buff-landing observations (the caster isn&apos;t in a bystander&apos;s log line, so
                only the target + spell + time are shown). Multiple observers of the same landing are collapsed.
              </p>
            </section>
          )}

          {/* 4. Boss mechanics / Death Touch (from encounter_events fires) */}
          {fireMarks.length > 0 && (
            <section className="bg-panel border border-border rounded-lg p-4">
              <h3 className="text-sm text-orange mb-2 flex items-center gap-2">
                <span aria-hidden>📢</span><span>Death Touch &amp; boss mechanics</span>
                <span className="text-dim text-xs">· {fireMarks.length} · from observed trigger fires (personal cast/LoS notices filtered out)</span>
              </h3>
              <ul className="text-xs space-y-0.5">
                {fireMarks.map((f, i) => (
                  <li key={i} className="flex gap-3 flex-wrap">
                    <span className="text-dim tabular-nums w-14 shrink-0">{fmtTime(f.at, tz)}</span>
                    <span className={f.isDt ? 'text-red' : 'text-text'}>{f.isDt ? '☠ ' : ''}{f.label}</span>
                    {f.actor && <span className="text-dim">· {f.actor}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 5. Loot & bids */}
          {loot.length > 0 && (
            <div>
              <div className="text-xs text-dim mb-2">Loot awarded this night (OpenDKP):</div>
              <LootBlock loot={loot} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ReviewHeader({ date, tz }: { date: string; tz?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <div className="text-sm mb-1">
          <Link href="/raid/review" className="text-blue hover:underline">← all raid nights</Link>
        </div>
        <h1 className="text-2xl text-gold">📓 {dayLabel(date, tz)}</h1>
        <p className="text-sm text-dim mt-0.5">Raid night review · {date}</p>
      </div>
      <Link href="/parses" className="text-xs text-blue hover:underline">full parses →</Link>
    </div>
  );
}
