// /character/[name] — per-character summary. Reads from encounter_players for
// parses, opendkp_loot for what they've won, opendkp_attendance_recent for
// raids attended, who_observations for class/level.
//
// URL casing is preserved as displayed. Lookups are case-insensitive against
// the canonical character name.

import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { fmtDmg, fmtDuration, fmtTime, fmtDkp, dayKey, dayLabel, cleanBossName } from '@/lib/format';
import { eraForTimestamp } from '@/lib/eras';
import { classDisplay } from '@/lib/class-titles';
import LootBrowser, { type LootCategory, type LootEntry } from '@/components/LootBrowser';
import {
  loadFamily,
  loadEraTimeline,
  loadFamilyAggregates,
  isMain,
  type FamilyMember,
  type EraSummary,
} from '@/lib/character-family';

export const dynamic = 'force-dynamic';

type WhoObs   = { character: string; class: string | null; race: string | null; level: number | null; guild_name: string | null; observed_at: string };
type ParseRow = {
  encounter_id: string;
  character_name: string;
  total_damage: number;
  dps: number;
  duration_sec: number | null;
  rank: number | null;
  has_pets: boolean | null;
  encounters: { id: string; started_at: string; duration_sec: number | null; zone_short: string | null; eqemu_npc_types: { name: string } | null } | null;
};
type LootRow      = {
  item_name: string; dkp: number; raid_name: string; raid_date: string;
  game_item_id: number | null;
  eqemu_items: { itemtype: number | null; damage: number | null; delay: number | null; slots: number | null; ac: number | null } | null;
};

// Classify a loot row into a UI bucket so the player can filter weapons vs
// armor. EQEmu itemtype is the most reliable signal — 0/1/2/3/4/5/7/35/45 are
// weapon types, 10/12 are containers/armor (we then disambiguate armor by ac+
// slots > 0 since itemtype 10 includes augments/jewelry/etc.), 11 is misc and
// our fallback for "quest / misc". When we can't join (catalog miss, e.g. the
// 211xxx Rune of Judgement) we land in 'other'.
const WEAPON_TYPES = new Set<number>([0, 1, 2, 3, 4, 5, 7, 35, 45]);
function classifyLoot(row: LootRow): LootCategory {
  const it = row.eqemu_items;
  if (!it || it.itemtype == null) return 'other';
  if (WEAPON_TYPES.has(it.itemtype) || (it.damage != null && it.damage > 0 && it.delay != null && it.delay > 0)) return 'weapon';
  if ((it.ac ?? 0) > 0 && (it.slots ?? 0) > 0) return 'armor';
  if (it.itemtype === 11) return 'quest';
  return 'other';
}
type AttendanceRow = { character_name: string; raids_attended: number; last_30d: number; last_90d: number; first_attended: string; last_attended: string };

async function load(name: string) {
  try {
    const sb = supabaseAdmin();
    const decoded = decodeURIComponent(name);

    // 1. Class/race/rank from the OpenDKP roster mirror (characters table).
    // We fall back to who_observations only for level + guild_name, which
    // the roster doesn't carry.
    const { data: charRows } = await sb
      .from('characters')
      .select('name, class, race, rank, main_name, active')
      .ilike('name', decoded)
      .limit(1);
    const char = (charRows && charRows[0]) || null;

    // Level + guild come from who_observations (the agent's /who captures);
    // ignore class/race here since the roster is authoritative.
    const { data: whoRows } = await sb
      .from('who_observations')
      .select('character, level, guild_name, observed_at')
      .ilike('character', decoded)
      .order('observed_at', { ascending: false })
      .limit(20);
    const observedLevel = ((whoRows ?? []) as { level: number | null }[]).find(r => r.level != null)?.level ?? null;
    const observedGuild = ((whoRows ?? []) as { guild_name: string | null }[]).find(r => r.guild_name)?.guild_name ?? null;

    const who: WhoObs | null = (char || observedLevel || observedGuild) ? {
      character:  char?.name || decoded,
      class:      char?.class || null,
      race:       char?.race  || null,
      level:      observedLevel,
      guild_name: observedGuild,
      observed_at: new Date().toISOString(),
    } : null;

    const displayName = char?.name || decoded;

    // 2. Parses — every encounter_players row, joined to its encounter for boss/zone/time.
    const { data: parseRowsRaw } = await sb
      .from('encounter_players')
      .select(`
        encounter_id, character_name, total_damage, dps, duration_sec, rank, has_pets,
        encounters!inner ( id, started_at, duration_sec, zone_short, eqemu_npc_types ( name ) )
      `)
      .eq('character_name', displayName)
      .order('total_damage', { ascending: false })
      .limit(10000);
    const parses = (parseRowsRaw as unknown as ParseRow[]) ?? [];

    // 3. Loot — every opendkp_loot row this character has won. We need
    // eqemu_items to classify weapon vs armor server-side, but
    // opendkp_loot_recent is a VIEW and opendkp_auctions.item_id has no
    // declared FK to eqemu_items.id (the FK is on loot_drops / wishlists /
    // eqemu_lootdrop_entries, not auctions) — so a PostgREST embed errors
    // and silently drops the entire result set, making every character
    // page show "LOOT WON 0". Split into two queries and stitch in JS.
    const { data: lootRowsRaw } = await sb
      .from('opendkp_loot_recent')
      .select(`item_name, dkp, raid_name, raid_date, game_item_id`)
      .ilike('character_name', displayName)
      .order('raid_date', { ascending: false });
    const lootRows = (lootRowsRaw ?? []) as {
      item_name: string; dkp: number; raid_name: string; raid_date: string; game_item_id: number | null;
    }[];
    const itemIds = Array.from(new Set(lootRows.map(l => l.game_item_id).filter((x): x is number => x != null)));
    const { data: itemRowsRaw } = itemIds.length > 0
      ? await sb.from('eqemu_items').select('id, itemtype, damage, delay, slots, ac').in('id', itemIds)
      : { data: [] };
    const itemById = new Map<number, LootRow['eqemu_items']>(
      ((itemRowsRaw ?? []) as { id: number; itemtype: number | null; damage: number | null; delay: number | null; slots: number | null; ac: number | null }[])
        .map(it => [it.id, { itemtype: it.itemtype, damage: it.damage, delay: it.delay, slots: it.slots, ac: it.ac }]),
    );
    const loot: LootRow[] = lootRows.map(l => ({
      item_name:    l.item_name,
      dkp:          l.dkp,
      raid_name:    l.raid_name,
      raid_date:    l.raid_date,
      game_item_id: l.game_item_id,
      eqemu_items:  l.game_item_id != null ? (itemById.get(l.game_item_id) ?? null) : null,
    }));
    const lootEnriched: LootEntry[] = loot.map(l => ({
      item_name:    l.item_name,
      game_item_id: l.game_item_id,
      dkp:          l.dkp,
      raid_name:    l.raid_name,
      raid_date:    l.raid_date,
      category:     classifyLoot(l),
      era:          eraForTimestamp(l.raid_date),
    }));

    // 4. Attendance.
    const { data: attRaw } = await sb
      .from('opendkp_attendance_recent')
      .select('character_name, raids_attended, last_30d, last_90d, first_attended, last_attended')
      .ilike('character_name', displayName)
      .single();
    const attendance = attRaw as AttendanceRow | null;

    // 5. Family + per-era timeline + family aggregates.
    const { root, members } = await loadFamily(sb, displayName);
    const [timeline, familyAgg] = await Promise.all([
      loadEraTimeline(sb, members),
      loadFamilyAggregates(sb, members),
    ]);

    return {
      displayName,
      who,
      parses,
      loot,
      lootEnriched,
      attendance,
      family: members,
      familyRoot: root,
      timeline,
      familyAgg,
      error: null as string | null,
    };
  } catch (err: unknown) {
    return {
      displayName: '',
      who: null as WhoObs | null,
      parses: [] as ParseRow[],
      loot: [] as LootRow[],
      lootEnriched: [] as LootEntry[],
      attendance: null as AttendanceRow | null,
      family: [] as FamilyMember[],
      familyRoot: null as FamilyMember | null,
      timeline: [] as EraSummary[],
      familyAgg: { totalDkpSpent: 0, totalItems: 0, firstAttended: null as string | null, lastAttended: null as string | null, totalRaids: 0 },
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export default async function CharacterPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  // Reject sentinel / non-character names like "(unknown)". Real EQ player
  // names are letters only, so anything with parens/digits/spaces — or the
  // "unknown"/"unattributed" fallbacks — isn't a character and shouldn't
  // render a phantom 0s page.
  const _decoded = decodeURIComponent(name).trim();
  if (!/^[A-Za-z]{2,}$/.test(_decoded) || ['unknown', 'unattributed'].includes(_decoded.toLowerCase())) notFound();

  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect(`/auth/signin?next=/character/${encodeURIComponent(name)}`);

  const data = await load(name);
  if (data.error || !data.displayName) {
    return (
      <div className="bg-panel border border-red rounded-lg p-4 text-red text-sm font-mono">
        {data.error || `Character "${name}" not found.`}
      </div>
    );
  }

  // 404 for names with ZERO footprint anywhere — no roster row, no /who
  // sighting, no parses, no loot, no attendance, no family link. Without this,
  // ANY letter-only string (a resisted-spell fragment like "Invoke"/"Chilling",
  // a typo, an NPC word) passed the regex guard above and rendered a full empty
  // "0 parses" profile, making non-characters look like real-but-empty members.
  // A genuine roster character with no combat data still has `who` (from the
  // characters table) or a family link, so it still renders correctly.
  const hasFootprint =
    !!data.who ||
    data.parses.length > 0 ||
    data.loot.length > 0 ||
    !!data.attendance ||
    data.family.length > 0;
  if (!hasFootprint) notFound();

  const { displayName, who, parses, loot, lootEnriched, attendance, family, familyRoot, timeline, familyAgg } = data;

  // Aggregates
  const totalParses = parses.length;
  const totalDamage = parses.reduce((s, p) => s + (p.total_damage || 0), 0);
  const bestParse = parses.length > 0
    ? parses.reduce((b, p) => (p.total_damage > b.total_damage ? p : b))
    : null;
  const totalLootSpent = loot.reduce((s, l) => s + (l.dkp || 0), 0);

  // Group parses by night → boss for the activity list (top 30 most recent)
  const recentParses = [...parses].sort(
    (a, b) => new Date(b.encounters?.started_at || 0).getTime() - new Date(a.encounters?.started_at || 0).getTime(),
  ).slice(0, 30);

  const showsMainBadge = isMain(family, displayName);
  const altFamily = family.filter(m => m.name.toLowerCase() !== displayName.toLowerCase());

  // THIS character's own first appearance (not the family's). Prefer its first
  // raid tick; fall back to its earliest recorded parse so alts that never tick
  // still show something.
  const charParseStarts = parses.map(p => p.encounters?.started_at).filter(Boolean) as string[];
  const charFirstSeen: string | null =
    attendance?.first_attended ||
    (charParseStarts.length ? charParseStarts.reduce((a, b) => (a < b ? a : b)) : null);
  // Filter timeline to only eras the family was actually active. "No activity"
  // pre-Classic etc. just clutters the timeline.
  const visibleTimeline = timeline.filter(e => e.raidsAttended > 0 || e.dkpSpent > 0 || e.itemsWon > 0);

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/parses" className="text-blue hover:underline">← back to parses</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
          <h2 className="text-2xl text-gold flex items-center gap-3">
            <span>{displayName}</span>
            {showsMainBadge && (
              <span className="text-[10px] tracking-widest font-bold px-2 py-0.5 rounded bg-gold/20 border border-gold/60 text-gold uppercase">
                Main
              </span>
            )}
            {!showsMainBadge && familyRoot && (
              <span className="text-xs text-dim font-normal">
                alt of{' '}
                <Link href={`/character/${encodeURIComponent(familyRoot.name)}`} className="text-blue hover:underline">
                  {familyRoot.name}
                </Link>
              </span>
            )}
          </h2>
          {who && (
            <div className="text-sm text-dim">
              {who.level && <span>{who.level} </span>}
              {who.race && <span>{who.race} </span>}
              {who.class && <span className="text-text">{classDisplay(who.class, who.level)}</span>}
              {who.guild_name && (
                <span className="ml-2">{'<'}<span className="text-orange">{who.guild_name}</span>{'>'}</span>
              )}
            </div>
          )}
        </div>

        <div className="text-xs mt-1 flex items-center gap-3">
          <span>
            <Link href={`/character/${encodeURIComponent(displayName)}/factions`} className="text-blue hover:underline">
              🤝 Factions
            </Link>
            <span className="ml-1 text-[9px] tracking-widest font-bold px-1.5 py-0.5 rounded bg-orange/20 border border-orange/60 text-orange uppercase">Beta</span>
          </span>
          <span>
            <Link href={`/character/${encodeURIComponent(displayName)}/gear`} className="text-blue hover:underline">
              🛡️ Gear
            </Link>
            <span className="ml-1 text-[9px] tracking-widest font-bold px-1.5 py-0.5 rounded bg-orange/20 border border-orange/60 text-orange uppercase">Beta</span>
          </span>
          <span>
            <Link href={`/character/${encodeURIComponent(displayName)}/quests`} className="text-blue hover:underline">
              📋 Quests
            </Link>
            <span className="ml-1 text-[9px] tracking-widest font-bold px-1.5 py-0.5 rounded bg-orange/20 border border-orange/60 text-orange uppercase">Beta</span>
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <Stat label="Parses" value={String(totalParses)} accent="text-blue" />
          <Stat label="Total damage" value={fmtDmg(totalDamage)} accent="text-text" />
          <Stat
            label="Best parse"
            value={bestParse ? fmtDmg(bestParse.total_damage) : '—'}
            sub={cleanBossName(bestParse?.encounters?.eqemu_npc_types?.name) === 'Unknown boss' ? null : cleanBossName(bestParse?.encounters?.eqemu_npc_types?.name)}
            accent="text-gold"
          />
          <Stat
            label="Raids attended"
            value={attendance ? String(attendance.raids_attended) : '—'}
            sub={attendance ? `${attendance.last_30d} in last 30d` : null}
            accent="text-orange"
          />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <Stat label="Loot won" value={String(loot.length)} />
          <Stat label="DKP spent" value={fmtDkp(totalLootSpent)} />
          <Stat label="First raid" value={attendance?.first_attended ? new Date(attendance.first_attended).toLocaleDateString() : '—'} />
          <Stat label="Last raid"  value={attendance?.last_attended  ? new Date(attendance.last_attended).toLocaleDateString()  : '—'} />
        </div>
      </section>

      {/* All-character aggregate strip — only shown when there's more than one
          character. The first three stats are totals across every character;
          "Char first seen" is THIS character's own first appearance. */}
      {family.length > 1 && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h3 className="text-sm text-blue mb-3 flex items-center gap-2">
            <span aria-hidden>👥</span>
            <span>All character aggregate</span>
            <span className="text-dim text-xs">· totals across {family.length} characters</span>
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="DKP spent · all chars"  value={fmtDkp(familyAgg.totalDkpSpent)} accent="text-gold" />
            <Stat label="Items won · all chars"  value={String(familyAgg.totalItems)} />
            <Stat label="Raids · all chars"      value={String(familyAgg.totalRaids)} accent="text-orange" />
            <Stat label="Char first seen"        value={charFirstSeen ? new Date(charFirstSeen).toLocaleDateString() : '—'} />
          </div>
        </section>
      )}

      {/* Per-era timeline — main switches, DKP earned vs spent per era */}
      {visibleTimeline.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h3 className="text-sm text-purple mb-3 flex items-center gap-2">
            <span aria-hidden>📜</span>
            <span>Era timeline</span>
            <span className="text-dim text-xs">· main detected from bids &gt; 100 or tick attendance</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {visibleTimeline.map(era => (
              <EraCard key={era.era} era={era} family={family} self={displayName} />
            ))}
          </div>
        </section>
      )}

      {/* Recent parses */}
      <section className="bg-panel border border-border rounded-lg p-4">
        <h3 className="text-sm text-orange mb-3 flex items-center gap-2">
          <span aria-hidden>⚔️</span>
          <span>Recent parses</span>
          <span className="text-dim text-xs">· top 30 by date</span>
        </h3>
        <table className="w-full text-xs">
          <thead className="text-dim text-left">
            <tr className="border-b border-border">
              <th className="py-1 pr-2">When</th>
              <th className="py-1 pr-2">Boss</th>
              <th className="py-1 pr-2 text-right">Damage</th>
              <th className="py-1 pr-2 text-right">DPS</th>
              <th className="py-1 pr-2 text-right">Rank</th>
              <th className="py-1 pr-2 text-right">Duration</th>
            </tr>
          </thead>
          <tbody>
            {recentParses.map((p) => {
              const boss = cleanBossName(p.encounters?.eqemu_npc_types?.name);
              const ts   = p.encounters?.started_at;
              return (
                <tr key={p.encounter_id} className="border-b border-border/30 hover:bg-[#1a212c]">
                  <td className="py-1 pr-2 text-dim">
                    {ts ? (
                      <Link href={`/parses/${p.encounter_id}`} className="hover:text-blue">
                        {dayLabel(dayKey(ts))} · {fmtTime(ts)}
                      </Link>
                    ) : '—'}
                  </td>
                  <td className="py-1 pr-2 text-text">{boss}</td>
                  <td className="py-1 pr-2 text-right text-text">{fmtDmg(p.total_damage)}</td>
                  <td className="py-1 pr-2 text-right text-dim">{p.dps ? `${fmtDmg(p.dps)}/s` : '—'}</td>
                  <td className="py-1 pr-2 text-right text-dim">{p.rank ?? '—'}</td>
                  <td className="py-1 pr-2 text-right text-dim">{fmtDuration(p.duration_sec)}</td>
                </tr>
              );
            })}
            {recentParses.length === 0 && (
              <tr><td colSpan={6} className="py-2 text-dim italic">No parses recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Loot — interactive browser: era + type filters, sort, pagination. */}
      {lootEnriched.length > 0 && <LootBrowser loot={lootEnriched} />}

      {/* Alt family — list every other character that shares this family root */}
      {altFamily.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h3 className="text-sm text-blue mb-3 flex items-center gap-2">
            <span aria-hidden>🌳</span>
            <span>Alt family</span>
            <span className="text-dim text-xs">· {altFamily.length} other character{altFamily.length === 1 ? '' : 's'}</span>
          </h3>
          <ul className="text-xs grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
            {altFamily.map(m => (
              <li key={m.name} className="flex items-center justify-between border-b border-border/40 py-1">
                <Link href={`/character/${encodeURIComponent(m.name)}`} className="text-blue hover:underline truncate">
                  {m.name}
                </Link>
                <span className="text-dim whitespace-nowrap ml-2">
                  {m.class || '—'}
                  {m.rank && <span className="text-text ml-2">· {m.rank}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string | null; accent?: string }) {
  return (
    <div className="bg-bg border border-border/60 rounded p-2">
      <div className="text-[10px] text-dim uppercase tracking-wide">{label}</div>
      <div className={`text-sm font-medium truncate ${accent || 'text-text'}`} title={value}>{value}</div>
      {sub && <div className="text-xs text-dim truncate">{sub}</div>}
    </div>
  );
}

function EraCard({ era, family, self }: { era: EraSummary; family: FamilyMember[]; self: string }) {
  const startLabel = new Date(era.start).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const main = era.main;
  const mainIsSelf = !!main && main.toLowerCase() === self.toLowerCase();
  const mainMember = main ? family.find(m => m.name === main) : null;
  const sourceLabel =
    era.mainSource === 'big_bid' ? 'big bid' :
    era.mainSource === 'ticks'    ? 'most ticks' :
    era.mainSource === 'carry_forward' ? 'carried forward' :
    era.mainSource === 'rank_fallback' ? 'rank fallback' :
    'no activity';
  const sourceColor =
    era.mainSource === 'big_bid' ? 'text-gold' :
    era.mainSource === 'ticks'    ? 'text-blue' :
    era.mainSource === 'carry_forward' ? 'text-dim' :
    'text-dim';

  return (
    <div className="bg-bg border border-border/60 rounded p-3 space-y-2">
      <div className="flex items-baseline justify-between">
        <div className="text-sm text-purple font-medium">{era.era}</div>
        <div className="text-[10px] text-dim">since {startLabel}</div>
      </div>

      <div className="text-xs">
        <span className="text-dim">Main:&nbsp;</span>
        {main ? (
          <Link
            href={`/character/${encodeURIComponent(main)}`}
            className={`hover:underline ${mainIsSelf ? 'text-gold font-semibold' : 'text-text'}`}
          >
            {main}
          </Link>
        ) : (
          <span className="text-dim italic">—</span>
        )}
        {mainMember?.class && <span className="text-dim ml-2">· {mainMember.class}</span>}
        <span className={`ml-2 text-[10px] ${sourceColor}`}>({sourceLabel})</span>
      </div>

      {era.swappedFrom && main && (
        <div className="text-[11px] text-gold bg-gold/10 border border-gold/30 rounded px-1.5 py-1 flex items-center gap-1 flex-wrap">
          <span aria-hidden>🔄</span>
          <span>
            Main swap: <span className="text-dim">{era.swappedFrom}</span>
            {' → '}<span className="font-medium">{main}</span>
          </span>
          {era.mainSince && (
            <span className="text-dim">
              · around {new Date(era.mainSince).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-1.5 text-[11px]">
        <div className="bg-panel border border-border/40 rounded px-1.5 py-1">
          <div className="text-[9px] text-dim uppercase">Earned</div>
          <div className="text-text">{fmtDkp(era.dkpEarned)}</div>
        </div>
        <div className="bg-panel border border-border/40 rounded px-1.5 py-1">
          <div className="text-[9px] text-dim uppercase">Spent</div>
          <div className="text-gold">{fmtDkp(era.dkpSpent)}</div>
        </div>
        <div className="bg-panel border border-border/40 rounded px-1.5 py-1">
          <div className="text-[9px] text-dim uppercase">Raids</div>
          <div className="text-orange">{era.raidsAttended}</div>
        </div>
      </div>

      {era.itemsWon > 0 && (
        <div className="text-[10px] text-dim">{era.itemsWon} item{era.itemsWon === 1 ? '' : 's'} won by the family</div>
      )}
    </div>
  );
}
