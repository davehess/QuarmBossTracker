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
import { fmtDmg, fmtDuration, fmtTime, dayKey, dayLabel } from '@/lib/format';
import LootBlock, { type LootRow } from '@/components/LootBlock';

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
type RawParse     = {
  bossName?: string;
  duration?: number;
  totalDamage?: number;
  totalDps?: number;
  players?: RawPlayer[];
  deaths?: RawDeath[];
  // Healers vary in shape across agent versions; tolerate either an array or null.
  healers?: { name: string; total: number }[] | null;
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
};
type EncounterDetail = {
  id: string;
  started_at: string;
  duration_sec: number | null;
  total_damage: number;
  total_dps: number;
  zone_short: string | null;
  npc_id: number | null;
  eqemu_npc_types: NpcRef | null;
  encounter_players: PlayerRow[];
};
type WhoObs = { character: string; class: string | null; level: number | null };

const TANK_CLASSES = new Set(['Warrior', 'Paladin', 'Shadow Knight']);

async function load(id: string) {
  try {
    const sb = supabaseAdmin();

    const { data: enc, error: encErr } = await sb
      .from('encounters')
      .select(`
        id, started_at, duration_sec, total_damage, total_dps, zone_short, npc_id,
        eqemu_npc_types ( id, name, zone_short ),
        encounter_players ( character_name, total_damage, dps, duration_sec, rank, has_pets )
      `)
      .eq('id', id)
      .single();
    if (encErr || !enc) return { error: encErr?.message || 'not found' };

    const { data: contribs } = await sb
      .from('contributions')
      .select('id, contributor_character, contributor_discord_id, source, total_damage, player_count, duration_sec, raw_parse, created_at')
      .eq('encounter_id', id)
      .order('created_at', { ascending: true });

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

    return {
      enc: encTyped,
      contribs: (contribs ?? []) as Contribution[],
      zones,
      loot: (lootRows ?? []) as LootRow[],
      whoMap: new Map(charRows.map(c => [c.name.toLowerCase(), { character: c.name, class: c.class, race: c.race, level: null }])),
      date,
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
  const { enc, contribs, zones, loot, whoMap, date } = data;

  const bossName = enc.eqemu_npc_types?.name || 'Unknown boss';
  const bossId   = enc.npc_id;
  const zoneShort = enc.zone_short || enc.eqemu_npc_types?.zone_short;
  const zoneLong = zoneShort ? zones.get(zoneShort)?.long_name || zoneShort : 'Unknown zone';

  const players = [...(enc.encounter_players ?? [])]
    .sort((a, b) => (b.total_damage || 0) - (a.total_damage || 0));
  const maxDamage = players[0]?.total_damage || 0;

  // Merge deaths across all contributions, dedup on name+ts.
  const deathsMap = new Map<string, RawDeath>();
  for (const c of contribs) {
    for (const d of (c.raw_parse?.deaths ?? [])) {
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

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/parses" className="text-blue hover:underline">← back to parses</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
          <h2 className="text-2xl text-gold">
            {bossId ? (
              <Link href={`/boss/${bossId}`} className="hover:underline">{bossName}</Link>
            ) : bossName}
          </h2>
          <div className="text-dim text-sm">
            {dayLabel(date)} · {fmtTime(enc.started_at)}
          </div>
        </div>
        <div className="text-sm text-dim flex flex-wrap gap-x-4 gap-y-1">
          <span><span className="text-orange">📍</span> {zoneLong}</span>
          <span>{fmtDuration(enc.duration_sec)}</span>
          <span className="text-text">{fmtDmg(enc.total_damage)} damage</span>
          {enc.total_dps > 0 && <span>{fmtDmg(enc.total_dps)}/s overall</span>}
          <span>{players.length} player{players.length === 1 ? '' : 's'}</span>
          <span>{contribs.length} contribution{contribs.length === 1 ? '' : 's'}</span>
        </div>
      </section>

      {/* Damage by class */}
      {(() => {
        const totalEncDamage = players.reduce((s, p) => s + (p.total_damage || 0), 0);
        const byClass = new Map<string, { total: number; players: number }>();
        for (const p of players) {
          const who = whoMap.get(p.character_name.toLowerCase());
          const klass = who?.class || (p.has_pets ? 'Pets / unknown' : 'Unknown');
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
              <span className="text-dim text-xs">· class data from /who observations; unmatched players bucket together</span>
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
        <table className="w-full text-xs">
          <thead className="text-dim text-left">
            <tr className="border-b border-border">
              <th className="py-1 pr-2 w-8">#</th>
              <th className="py-1 pr-2">Character</th>
              <th className="py-1 pr-2">Class</th>
              <th className="py-1 pr-2 text-right">Damage</th>
              <th className="py-1 pr-2 text-right">DPS</th>
              <th className="py-1 pr-2 text-right">Duration</th>
              <th className="py-1 pl-2">Share</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p, i) => {
              const share = maxDamage > 0 ? (p.total_damage / maxDamage) * 100 : 0;
              const who = whoMap.get(p.character_name.toLowerCase());
              const klass = who?.class || (p.has_pets ? '(has pets)' : '—');
              return (
                <tr key={p.character_name} className="border-b border-border/30 hover:bg-[#1a212c]">
                  <td className="py-1 pr-2 text-dim">{i + 1}</td>
                  <td className="py-1 pr-2 text-text truncate">
                    <Link href={`/character/${encodeURIComponent(p.character_name)}`} className="hover:text-blue hover:underline">
                      {p.character_name}
                    </Link>
                  </td>
                  <td className="py-1 pr-2 text-dim">{klass}</td>
                  <td className="py-1 pr-2 text-right text-text">{fmtDmg(p.total_damage)}</td>
                  <td className="py-1 pr-2 text-right text-dim">{p.dps ? `${fmtDmg(p.dps)}/s` : '—'}</td>
                  <td className="py-1 pr-2 text-right text-dim">{fmtDuration(p.duration_sec)}</td>
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
                <span className="text-dim">{fmtTime(d.ts)}</span>
                <span className="text-text">{d.name}</span>
                {d.class && <span className="text-dim">({d.class})</span>}
                {d.riposteDeath && <span className="text-red">⚔ riposte kill</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Tank perspective */}
      {tanks.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h3 className="text-sm text-blue mb-2 flex items-center gap-2">
            <span aria-hidden>🛡️</span>
            <span>Tank perspective</span>
            <span className="text-dim text-xs">· uploaded by {tanks.length} tank class character{tanks.length === 1 ? '' : 's'}</span>
          </h3>
          <ul className="text-xs space-y-1">
            {tanks.map((t) => (
              <li key={t.id} className="text-dim">
                {t.contributor_character ? (
                  <Link href={`/character/${encodeURIComponent(t.contributor_character)}`} className="text-text hover:text-blue hover:underline">
                    {t.contributor_character}
                  </Link>
                ) : <span className="text-text">(anonymous)</span>}
                <span> — </span>
                <span>{(t.raw_parse?.players ?? []).length} players parsed, </span>
                <span>{fmtDmg(t.raw_parse?.totalDamage ?? 0)} total</span>
                <span className="opacity-60"> · source: {t.source}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

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
                <span className="text-dim ml-1 text-[10px]">{c.source}</span>
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
