// Personal hub for the signed-in member. Surfaces everything we track
// about characters they own, organized as one section per character with
// shared stats up top.
//
// Identity resolution:
//   1) auth.users.id (signed-in user)
//   2) → wolfpack_members.user_id → discord_id
//   3) → characters.discord_id = that → list of owned chars
//
// Characters without a discord_id link won't appear here even if the
// member owns them. The /admin/links page is the fix for that. The page
// surfaces a clear "no characters linked" CTA when the link is missing.
//
// Sections per character:
//   - Identity (class, race, rank, main/alt, quarmy URL)
//   - Parse stats (encounter count, total damage, top fight)
//   - Recent encounters (last 10, link to /parses/[id])
//   - Upload contributions (when this character was the agent uploader)
//   - Chat counts (30d / all-time)
//   - PvP record (kills + deaths)
//   - Loot won (item count + DKP spent)
//   - Wishlist (item count; full view via /mywishlist Discord command —
//     decryption requires WISHLIST_BID_KEY which only the bot has)

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { userTz, fmtAbs, relTime, fmtDateOnly } from '@/lib/timezone';
import ExclusionToggles from './ExclusionToggles';
import ScrapShare from './ScrapShare';
import InventoryUpload from './InventoryUpload';
import KeysUpload from './KeysUpload';
import SpellbookUpload from './SpellbookUpload';
import MeCharacterCards, { type MeCard } from './MeCharacterCards';

export const dynamic = 'force-dynamic';

type CharRow = {
  name: string;
  main_name: string | null;
  class: string | null;
  race: string | null;
  rank: string | null;
  active: boolean;
  quarmy_url: string | null;
  opendkp_id: number | null;
  exclude_from_stats: boolean | null;
  exclude_inventory:  boolean | null;
  tell_relay:         boolean | null;
  tell_dm:            boolean | null;
  show_inventory_publicly: boolean | null;
};

type SkillBucket = { hits: number; dmg: number };

type CharStats = {
  encounterCount: number;
  totalDamage: number;
  topDmg: number;
  topEncounterId: string | null;
  recentEncounters: { id: string; npc_name: string | null; started_at: string | null; damage: number; dps: number }[];

  uploadCount: number;
  lastUpload: string | null;
  // Most recent agent_version stamped on a contribution this char authored.
  // null when the char hasn't uploaded since the watermark cutover (bot v2.5.39+).
  latestAgentVersion: string | null;

  chat30: number;
  chatAll: number;

  pvpKills: number;
  pvpDeaths: number;

  lootCount: number;
  dkpSpent: number;

  wishlistCount: number;

  // Per-ability rollup (PRIVATE — only the owner sees this). Aggregated across
  // encounter_combat_rollup rows for this character. Empty for raids that
  // landed before the agent v2.4.26+ cutover.
  rollupHits: number;
  rollupDamage: number;
  selfAttackCount: number;
  topSkills: { skill: string; hits: number; dmg: number }[];   // top 5 by damage
  encountersWithDetail: number;
  encountersResubmittable: number;

  // Per-character data-floor signal: how far back this character's stats reach.
  memberSince: string | null;
  floorSource: 'guild_chat' | 'tick' | 'raid_chat' | null;
};

// Live character state (current buffs + last-seen zone), synced from the
// Mimic/agent Zeal stream into character_live_state. This is a SNAPSHOT — the
// agent pushes on change — so the /me view shows "what each character is
// carrying + where they were last seen", with a pointer to the local dashboard
// (localhost:7777) for true second-by-second data. GUILD scope.
type LiveBuff = { name: string; ticks: number | null };
type LiveState = {
  zoneName: string | null;
  buffCount: number;
  buffs: LiveBuff[];
  selfHpPct: number | null;
  updatedAt: string | null;
};
async function loadLiveState(charNames: string[]): Promise<Map<string, LiveState>> {
  const out = new Map<string, LiveState>();
  if (charNames.length === 0) return out;
  const admin = supabaseAdmin();
  // The table holds one row per active character (small) — fetch the guild's
  // rows and match case-insensitively, since the PK stores the name as the
  // agent reported it.
  const { data } = await admin
    .from('character_live_state')
    .select('character, zone_name, buff_count, buffs, self_hp_pct, updated_at')
    .eq('guild_id', 'wolfpack');
  const wanted = new Set(charNames.map(n => n.toLowerCase()));
  for (const r of (data ?? []) as any[]) {
    const key = String(r.character || '').toLowerCase();
    if (!wanted.has(key)) continue;
    out.set(key, {
      zoneName:  r.zone_name ?? null,
      buffCount: r.buff_count ?? (Array.isArray(r.buffs) ? r.buffs.length : 0),
      buffs:     Array.isArray(r.buffs) ? r.buffs : [],
      selfHpPct: r.self_hp_pct ?? null,
      updatedAt: r.updated_at ?? null,
    });
  }
  return out;
}

async function loadOwnedCharacters(userId: string): Promise<{ discordId: string | null; nickname: string | null; chars: CharRow[] }> {
  const admin = supabaseAdmin();
  const { data: pack } = await admin
    .from('wolfpack_members')
    .select('discord_id, nickname, global_name, merged_into_discord_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (!pack?.discord_id) return { discordId: null, nickname: pack?.nickname ?? null, chars: [] };

  // Household: the signed-in account plus every Discord account that has
  // declared itself merged-into this one (officer-approved aliases in
  // wolfpack_members.merged_into_discord_id). Allows a person with multiple
  // Discord identities to see all their characters under one /me without
  // touching characters.discord_id. If the signed-in account is itself an
  // alias, treat the primary as the household root.
  const householdRoot = pack.merged_into_discord_id || pack.discord_id;
  const { data: aliases } = await admin
    .from('wolfpack_members')
    .select('discord_id')
    .or(`discord_id.eq.${householdRoot},merged_into_discord_id.eq.${householdRoot}`);
  const householdIds = new Set(
    ((aliases ?? []) as { discord_id: string }[]).map(r => r.discord_id).filter(Boolean)
  );
  householdIds.add(pack.discord_id);
  householdIds.add(householdRoot);

  // Pull every roster character once — small set (~242 today) — and walk the
  // OpenDKP family from any character ANCHORED to ANY discord_id in the
  // household.
  const { data: allChars } = await admin
    .from('characters')
    .select('name, main_name, class, race, rank, active, quarmy_url, opendkp_id, discord_id, exclude_from_stats, exclude_inventory, tell_relay, tell_dm, show_inventory_publicly')
    .eq('guild_id', 'wolfpack');
  const all = (allChars ?? []) as (CharRow & { discord_id: string | null })[];

  // 1) Anchored characters — directly linked to ANY discord_id in the household.
  const anchored = all.filter(c => c.discord_id && householdIds.has(c.discord_id));
  // 2) Family roots — lowercased main_name, falling back to the char's own name.
  const familyRoots = new Set(anchored.map(c => (c.main_name || c.name).toLowerCase()));
  if (familyRoots.size === 0) return { discordId: pack.discord_id, nickname: pack.nickname ?? null, chars: [] };
  // 3) Whole family — every char whose own root matches one of ours.
  const family = all
    .filter(c => familyRoots.has((c.main_name || c.name).toLowerCase()))
    .sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1) || a.name.localeCompare(b.name)) as CharRow[];
  return { discordId: pack.discord_id, nickname: pack.nickname ?? null, chars: family };
}

type FloorRow    = { member_since: string | null; floor_source: string | null };
type CoverageRow = { encounters_total: number | null; encounters_with_detail: number | null; encounters_resubmittable: number | null };

// character_data_floor + character_rollup_coverage are VIEWS that re-aggregate
// the WHOLE guild's chat + tick history on every call — the per-character WHERE
// is applied only at the very end, so filtering doesn't make them cheaper
// (measured ~3.5s for the floor view regardless of the name asked for). They
// were previously queried once PER CHARACTER inside loadCharStats, so a member
// with N alts paid N × 3.5s and /me crawled. Fetch each view ONCE for everyone
// here and pass the resulting maps down; per-character lookup is then free.
async function loadFloorAndCoverage(): Promise<{
  floors: Map<string, FloorRow>;
  coverage: Map<string, CoverageRow>;
}> {
  const admin = supabaseAdmin();
  const floors = new Map<string, FloorRow>();
  const coverage = new Map<string, CoverageRow>();
  const [{ data: floorRows }, { data: covRows }] = await Promise.all([
    admin.from('character_data_floor').select('character_name, member_since, floor_source').limit(5000),
    admin.from('character_rollup_coverage').select('character_name, encounters_total, encounters_with_detail, encounters_resubmittable').limit(5000),
  ]);
  for (const r of (floorRows ?? []) as (FloorRow & { character_name: string | null })[]) {
    if (r.character_name) floors.set(r.character_name.toLowerCase(), { member_since: r.member_since, floor_source: r.floor_source });
  }
  for (const r of (covRows ?? []) as (CoverageRow & { character_name: string | null })[]) {
    if (r.character_name) coverage.set(r.character_name.toLowerCase(), {
      encounters_total: r.encounters_total, encounters_with_detail: r.encounters_with_detail, encounters_resubmittable: r.encounters_resubmittable,
    });
  }
  return { floors, coverage };
}

async function loadCharStats(name: string, floorRow: FloorRow | null, coverageRow: CoverageRow | null): Promise<CharStats> {
  const admin = supabaseAdmin();
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const nameLower = name.toLowerCase();

  const [
    { data: parseRows },
    { data: contribRows },
    chat30Res,
    chatAllRes,
    pvpKillsRes,
    pvpDeathsRes,
    lootRes,
    wishlistRes,
    { data: rollupRows },
  ] = await Promise.all([
    admin
      .from('encounter_players')
      .select('encounter_id, total_damage, dps')
      .eq('character_name', name)
      .limit(5000),
    admin
      .from('contributions')
      .select('encounter_id, created_at, source, agent_version, has_ability_detail')
      .eq('contributor_character', name)
      .order('created_at', { ascending: false })
      .limit(500),
    admin
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('speaker', name)
      .gte('ts', since30),
    admin
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('speaker', name),
    admin
      .from('pvp_kills')
      .select('id', { count: 'exact', head: true })
      .ilike('killer', name),
    admin
      .from('pvp_kills')
      .select('id', { count: 'exact', head: true })
      .ilike('victim', name),
    // Loot from the OpenDKP mirror (the bot's loot_drops table is unused —
    // auction-award wiring is stubbed). opendkp_loot_recent resolves the
    // winner to a character name and carries the DKP spent + item + date.
    admin
      .from('opendkp_loot_recent')
      .select('item_name, dkp, raid_date, raid_name')
      .eq('character_name', name),
    admin
      .from('wishlists')
      .select('id', { count: 'exact', head: true })
      .eq('character_name', name),
    // Per-encounter verb rollups. Sum locally — typical char has at most ~hundreds
    // of rows, fine to aggregate in JS. by_skill is the jsonb bag per the
    // migration; total_hits / total_damage / self_attack_count are scalar.
    admin
      .from('encounter_combat_rollup')
      .select('total_hits, total_damage, self_attack_count, by_skill')
      .eq('character_name', name)
      .limit(5000),
    // NOTE: character_data_floor + character_rollup_coverage are no longer
    // queried here — they're whole-guild-aggregating views (see
    // loadFloorAndCoverage) prefetched once for the family and passed in.
  ]);

  const parses = (parseRows ?? []) as { encounter_id: string; total_damage: number | null; dps: number | null }[];
  const totalDamage = parses.reduce((s, r) => s + (r.total_damage || 0), 0);
  let topDmg = 0, topId: string | null = null;
  for (const p of parses) {
    if ((p.total_damage || 0) > topDmg) { topDmg = p.total_damage || 0; topId = p.encounter_id; }
  }

  // Recent encounters — join encounter_players to encounters for npc_id +
  // started_at. PostgREST doesn't traverse without a declared FK, so a
  // second targeted lookup.
  let recentEncounters: CharStats['recentEncounters'] = [];
  if (parses.length > 0) {
    // Limit to most recent 30 contributions to keep the join cheap.
    const lastIds = Array.from(new Set(parses.map(p => p.encounter_id))).slice(0, 60);
    const { data: encRows } = await admin
      .from('encounters')
      .select('id, started_at, npc_id')
      .in('id', lastIds)
      .order('started_at', { ascending: false })
      .limit(10);
    const npcIds = (encRows ?? []).map((e: any) => e.npc_id).filter((x: any) => x != null);
    const { data: npcRows } = npcIds.length
      ? await admin.from('eqemu_npc_types').select('id, name').in('id', npcIds)
      : { data: [] };
    const npcName = new Map<number, string>(((npcRows ?? []) as { id: number; name: string }[]).map(n => [n.id, n.name.replace(/_/g,' ').replace(/^#/,'')]));
    const dmgByEnc = new Map<string, { dmg: number; dps: number }>();
    for (const p of parses) {
      const existing = dmgByEnc.get(p.encounter_id);
      if (!existing || (p.total_damage || 0) > existing.dmg) {
        dmgByEnc.set(p.encounter_id, { dmg: p.total_damage || 0, dps: p.dps || 0 });
      }
    }
    recentEncounters = ((encRows ?? []) as { id: string; started_at: string; npc_id: number | null }[]).map(e => ({
      id: e.id,
      npc_name: e.npc_id != null ? (npcName.get(e.npc_id) ?? null) : null,
      started_at: e.started_at,
      damage: dmgByEnc.get(e.id)?.dmg ?? 0,
      dps:    dmgByEnc.get(e.id)?.dps ?? 0,
    }));
  }

  const contribs = (contribRows ?? []) as { encounter_id: string; created_at: string; source: string | null; agent_version: string | null; has_ability_detail: boolean | null }[];
  const lootRows = (lootRes.data ?? []) as { item_name: string | null; dkp: number | null; raid_date: string | null; raid_name: string | null }[];
  const dkpSpent = lootRows.reduce((s, r) => s + (r.dkp || 0), 0);

  // ── Aggregate the per-ability rollups ──────────────────────────────────────
  // Each row: { total_hits, total_damage, self_attack_count, by_skill: jsonb }.
  // by_skill is { <skill>: {hits, dmg} } already in the agent's bucket shape.
  // We sum across the character's encounters; topSkills is the top 5 by dmg.
  const rollups = (rollupRows ?? []) as {
    total_hits: number | null;
    total_damage: number | null;
    self_attack_count: number | null;
    by_skill: Record<string, SkillBucket> | null;
  }[];
  let rollupHits = 0, rollupDamage = 0, selfAttackCount = 0;
  const skillTotals = new Map<string, SkillBucket>();
  for (const r of rollups) {
    rollupHits      += r.total_hits        || 0;
    rollupDamage    += r.total_damage      || 0;
    selfAttackCount += r.self_attack_count || 0;
    if (r.by_skill && typeof r.by_skill === 'object') {
      for (const [skill, b] of Object.entries(r.by_skill)) {
        const existing = skillTotals.get(skill) ?? { hits: 0, dmg: 0 };
        existing.hits += Number(b?.hits) || 0;
        existing.dmg  += Number(b?.dmg)  || 0;
        skillTotals.set(skill, existing);
      }
    }
  }
  const topSkills = Array.from(skillTotals.entries())
    .map(([skill, b]) => ({ skill, hits: b.hits, dmg: b.dmg }))
    .sort((a, b) => b.dmg - a.dmg)
    .slice(0, 5);

  // Most recent agent version this character uploaded under. Pre-2.5.39
  // contributions have null agent_version, so we look for the latest non-null.
  const latestAgentVersion = contribs.find(c => c.agent_version)?.agent_version ?? null;

  const floor = (floorRow ?? null) as { member_since: string | null; floor_source: string | null } | null;
  const coverage = (coverageRow ?? null) as {
    encounters_total: number | null;
    encounters_with_detail: number | null;
    encounters_resubmittable: number | null;
  } | null;

  return {
    encounterCount: new Set(parses.map(p => p.encounter_id)).size,
    totalDamage,
    topDmg,
    topEncounterId: topId,
    recentEncounters,
    uploadCount: contribs.length,
    lastUpload: contribs[0]?.created_at ?? null,
    latestAgentVersion,
    chat30:  chat30Res.count ?? 0,
    chatAll: chatAllRes.count ?? 0,
    pvpKills: pvpKillsRes.count ?? 0,
    pvpDeaths: pvpDeathsRes.count ?? 0,
    lootCount: lootRows.length,
    dkpSpent,
    wishlistCount: wishlistRes.count ?? 0,
    rollupHits,
    rollupDamage,
    selfAttackCount,
    topSkills,
    encountersWithDetail:    coverage?.encounters_with_detail   ?? 0,
    encountersResubmittable: coverage?.encounters_resubmittable ?? 0,
    memberSince: floor?.member_since ?? null,
    floorSource: (floor?.floor_source as CharStats['floorSource']) ?? null,
  };
}

// fmtTs/relTime now sourced from @/lib/timezone so every page renders in the
// user's chosen zone (default Eastern). MePage threads `tz` through to every
// site that prints an absolute time.

// Per-character sync heartbeat from agent_upload_stats (the per-character upload
// counter that replaced the row-per-upload agent_uploads log). The encounter
// endpoint is the freshest signal — it fires per-encounter (live raids) and
// per-backfill. One counter row per (character, endpoint), so a single lookup
// gives the last-seen + version. Returns nothing for a character that's never
// uploaded, so the banner can still say "no recent uploads".
// Best-known level per character. Two signals:
//   (a) who_observations.level — /who history (highest level we've ever seen).
//   (b) character_spellbook.spell_level — a scribed L60 spell IS proof of L60,
//       independent of /who staleness (Uilnayar 2026-06-23: Canopy's /who
//       cache held an L57 row but her spellbook proves L60).
// Compute the max client-side. who_observations has tons of NULL-level rows
// (anonymous /who hides level) and a chained PostgREST .not('level','is',null)
// .order('level',desc).limit(1) was returning a non-max row in production —
// likely a NULLS FIRST quirk. Pulling the few non-NULL rows and Math.max-ing
// in JS is bulletproof.
async function loadCharLevels(charNames: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (charNames.length === 0) return out;
  const admin = supabaseAdmin();
  await Promise.all(charNames.map(async (name) => {
    const [whoRes, bookRes] = await Promise.all([
      admin.from('who_observations')
        .select('level')
        .ilike('character', name)
        .gte('level', 1)         // implies NOT NULL and dodges the NULLS-FIRST sort trap
        .limit(500),
      admin.from('character_spellbook')
        .select('spell_level')
        .ilike('character_name', name)
        .gte('spell_level', 1)
        .limit(1000),
    ]);
    let best = 0;
    for (const r of (whoRes.data ?? []) as { level: number | null }[]) {
      if (typeof r.level === 'number' && r.level > best) best = r.level;
    }
    for (const r of (bookRes.data ?? []) as { spell_level: number | null }[]) {
      if (typeof r.spell_level === 'number' && r.spell_level > best) best = r.spell_level;
    }
    if (best > 0) out.set(name.toLowerCase(), best);
  }));
  return out;
}

async function loadSyncHeartbeats(charNames: string[]): Promise<Map<string, { lastUpload: string; agentVersion: string | null }>> {
  if (charNames.length === 0) return new Map();
  const admin = supabaseAdmin();
  const out = new Map<string, { lastUpload: string; agentVersion: string | null }>();
  await Promise.all(charNames.map(async (name) => {
    const { data } = await admin
      .from('agent_upload_stats')
      .select('last_uploaded_at, agent_version')
      .ilike('character', name)
      .eq('endpoint', 'encounter')
      .maybeSingle();
    if (data?.last_uploaded_at) out.set(name, { lastUpload: data.last_uploaded_at, agentVersion: data.agent_version });
  }));
  return out;
}

// ── "The Scrap" — friendly damage competition (last 30 days) ────────────────
// Server-side leaderboard via the scrap_damage_leaderboard RPC (cap-immune).
// We surface the viewer's best-ranked character, the rival directly above
// them, and the current Top Dog — a personal nudge rather than another table.
type ScrapRow = { character_name: string; total_damage: number; best_dps: number; encounters: number };
type ScrapView = {
  contenders: number;
  top:   ScrapRow & { rank: number };
  me:    (ScrapRow & { rank: number }) | null;
  rival: (ScrapRow & { rank: number }) | null;
};
async function loadScrap(myNames: string[]): Promise<ScrapView | null> {
  try {
    const sb = supabaseAdmin();
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await sb.rpc('scrap_damage_leaderboard', { p_since: since });
    const rows = (data ?? []) as ScrapRow[];
    if (rows.length === 0) return null;
    const ranked = rows.map((r, i) => ({ ...r, rank: i + 1 }));
    const mine = new Set(myNames.map(n => n.toLowerCase()));
    const me = ranked.find(r => mine.has(r.character_name.toLowerCase())) || null;
    const rival = me && me.rank > 1 ? ranked[me.rank - 2] : null;
    return { contenders: ranked.length, top: ranked[0], me, rival };
  } catch { return null; }
}

function fmtDmg(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + 'k';
  return String(n);
}

// Buff remaining → nHmM (each Zeal tick = 6s). Point-in-time at the last sync,
// so it's labeled as a snapshot, not a live countdown.
function fmtBuffTime(ticks: number | null): string | null {
  if (ticks == null || !Number.isFinite(ticks) || ticks <= 0) return null;
  const secs = ticks * 6;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${secs}s`;
}

export default async function MePage() {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/signin?next=/me');

  const tz = await userTz();

  const { discordId, nickname, chars: allChars } = await loadOwnedCharacters(user.id);

  // Honor the per-character data opt-out (characters.exclude_from_stats). We
  // still surface excluded chars in a small footer so the owner can see + flip
  // the flag, but they don't appear in the main per-char grid.
  const chars         = allChars.filter(c => !c.exclude_from_stats);
  const excludedChars = allChars.filter(c =>  c.exclude_from_stats);

  // The floor + coverage views aggregate the WHOLE guild on every call, so we
  // fetch them ONCE here (not per-character) and overlap with the scrap
  // leaderboard. This is the fix for /me crawling for members with many alts.
  const [scrap, { floors, coverage }] = await Promise.all([
    chars.length > 0 ? loadScrap(chars.map(c => c.name)) : Promise.resolve(null),
    loadFloorAndCoverage(),
  ]);

  // Build per-character stats in parallel
  const stats = await Promise.all(chars.map(c =>
    loadCharStats(c.name, floors.get(c.name.toLowerCase()) ?? null, coverage.get(c.name.toLowerCase()) ?? null)
      .then(s => [c.name, s] as const)));
  const byName = new Map(stats);

  // Live state + best-known level per owned character.
  const [liveState, levelByName] = await Promise.all([
    loadLiveState(chars.map(c => c.name)),
    loadCharLevels(chars.map(c => c.name)),
  ]);

  // Default card order: highest level first (the member's mains/raiders float
  // up). Tiebreak keeps the family root above its alts, then DKP, then name.
  // The /me layout controls (MeCharacterCards) let the member override this
  // and remember their own order.
  chars.sort((a, b) => {
    const aLvl = levelByName.get(a.name.toLowerCase()) ?? -1;
    const bLvl = levelByName.get(b.name.toLowerCase()) ?? -1;
    if (aLvl !== bLvl) return bLvl - aLvl;
    const aMain = (a.main_name || a.name).toLowerCase() === a.name.toLowerCase();
    const bMain = (b.main_name || b.name).toLowerCase() === b.name.toLowerCase();
    if (aMain !== bMain) return aMain ? -1 : 1;
    const aDkp = byName.get(a.name)?.dkpSpent || 0;
    const bDkp = byName.get(b.name)?.dkpSpent || 0;
    if (aDkp !== bDkp) return bDkp - aDkp;
    return a.name.localeCompare(b.name);
  });

  // Sync heartbeat: most recent agent upload per owned character. Drives the
  // top-of-page "syncing now / stale / no upload" banner.
  const heartbeats = await loadSyncHeartbeats(allChars.map(c => c.name));
  const now = Date.now();
  const liveThresholdMs    = 10 * 60 * 1000;     // ≤10 min ago = syncing
  const recentThresholdMs  =  6 * 60 * 60 * 1000; // ≤6h = "recent"
  type SyncRow = { name: string; status: 'live' | 'recent' | 'stale' | 'never'; lastUpload: string | null; agentVersion: string | null };
  const syncRows: SyncRow[] = allChars.map(c => {
    const hb = heartbeats.get(c.name);
    if (!hb) return { name: c.name, status: 'never', lastUpload: null, agentVersion: null };
    const age = now - new Date(hb.lastUpload).getTime();
    const status: SyncRow['status'] =
      age <= liveThresholdMs   ? 'live'
      : age <= recentThresholdMs ? 'recent'
      : 'stale';
    return { name: c.name, status, lastUpload: hb.lastUpload, agentVersion: hb.agentVersion };
  });
  const liveCount   = syncRows.filter(r => r.status === 'live').length;
  const recentCount = syncRows.filter(r => r.status === 'recent').length;
  const everSynced  = syncRows.filter(r => r.lastUpload).length;

  // Page-level aggregates
  const agg = {
    chars: chars.length,
    encounters: stats.reduce((s, [, x]) => s + x.encounterCount, 0),
    totalDamage: stats.reduce((s, [, x]) => s + x.totalDamage, 0),
    uploads: stats.reduce((s, [, x]) => s + x.uploadCount, 0),
    pvpKills: stats.reduce((s, [, x]) => s + x.pvpKills, 0),
    pvpDeaths: stats.reduce((s, [, x]) => s + x.pvpDeaths, 0),
    lootCount: stats.reduce((s, [, x]) => s + x.lootCount, 0),
    dkpSpent: stats.reduce((s, [, x]) => s + x.dkpSpent, 0),
  };

  // Top-of-page sync banner color + headline. Lives ABOVE "My Characters" so
  // members see immediately whether their parser is transmitting before they
  // wonder why their stats are empty.
  let bannerColor: 'green'|'orange'|'red'|'dim' = 'dim';
  let bannerHeadline = 'Your parser isn\'t syncing.';
  let bannerSub = 'Run the local parser to start streaming.';
  if (allChars.length === 0) {
    bannerColor = 'dim';
    bannerHeadline = 'No characters linked yet.';
    bannerSub      = 'Link one below to start syncing.';
  } else if (liveCount > 0) {
    bannerColor = 'green';
    bannerHeadline = liveCount === 1
      ? `Parser is syncing for ${syncRows.find(r => r.status === 'live')!.name}.`
      : `Parser is syncing for ${liveCount} characters.`;
    bannerSub = 'Live in the last 10 minutes.';
  } else if (recentCount > 0) {
    bannerColor = 'orange';
    bannerHeadline = 'Parser was syncing earlier today but isn\'t right now.';
    bannerSub      = 'Re-launch Parser.bat if you want to keep streaming.';
  } else if (everSynced > 0) {
    bannerColor = 'orange';
    bannerHeadline = 'Parser is offline.';
    bannerSub      = 'Last upload was hours+ ago. Re-launch Parser.bat to resume.';
  } else {
    bannerColor = 'red';
    bannerHeadline = 'No parser uploads recorded for your characters.';
    bannerSub      = 'Make sure the local agent is running — see /parsehelp in Discord.';
  }
  const bannerBorderClass =
    bannerColor === 'green'  ? 'border-green/60'   :
    bannerColor === 'orange' ? 'border-orange/60'  :
    bannerColor === 'red'    ? 'border-red/60'     : 'border-border';
  const bannerTextClass =
    bannerColor === 'green'  ? 'text-green'   :
    bannerColor === 'orange' ? 'text-orange'  :
    bannerColor === 'red'    ? 'text-red-400' : 'text-dim';

  // Build the per-character card slots and hand them to the client-side layout
  // controller (MeCharacterCards), which owns show/hide, order (drag-drop),
  // and collapse. Each card has: header (always shown), summary (buffs/zone,
  // shown when collapsed), and details (the full panel grid).
  const cardItems: MeCard[] = chars.map(c => {
    const s = byName.get(c.name)!;
    const live = liveState.get(c.name.toLowerCase()) || null;
    const level = levelByName.get(c.name.toLowerCase()) ?? null;

    const buffsZonePanel = (
      <Panel
        title="Buffs & Zone"
        badge="GUILD"
        tooltip="What this character is currently carrying (buffs/songs) and the zone they were last seen in, synced from your local parser's Zeal feed. A snapshot updated when things change — open localhost:7779 for live, second-by-second buff timers."
      >
        {!live ? (
          <div className="text-dim text-xs italic">
            No live state yet. Run the local parser with the Zeal pipe enabled to sync
            current buffs + zone.
          </div>
        ) : (
          <>
            <Row label="Last-seen zone">
              {live.zoneName ? <span className="text-text">{live.zoneName}</span> : <span className="text-dim">—</span>}
            </Row>
            <Row label="Buffs">
              {live.buffCount > 0
                ? <span className="text-text">{live.buffCount}</span>
                : <span className="text-dim">none</span>}
            </Row>
            {live.buffs.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {live.buffs.map((b, i) => {
                  const t = fmtBuffTime(b.ticks);
                  return (
                    <span key={`${b.name}-${i}`} className="bg-bg border border-border/60 rounded px-1.5 py-0.5 text-[10px] text-text">
                      {b.name}{t && <span className="text-dim/70"> · {t}</span>}
                    </span>
                  );
                })}
              </div>
            )}
            <div className="mt-2 pt-2 border-t border-border/40 text-[10px] text-dim flex items-center justify-between gap-2 flex-wrap">
              <span>{live.updatedAt ? <>synced {relTime(live.updatedAt)}</> : 'snapshot'}</span>
              <a href="http://localhost:7779" target="_blank" rel="noreferrer" className="text-blue hover:underline whitespace-nowrap">
                live on localhost:7779 ↗
              </a>
            </div>
          </>
        )}
      </Panel>
    );

    const header = (
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-lg text-text">{c.name}</h3>
            {level != null && <span className="text-gold text-xs">L{level}</span>}
            {!c.active && <span className="text-dim text-xs">(inactive)</span>}
            {c.main_name && c.main_name !== c.name && (
              <span className="text-dim text-xs">alt of {c.main_name}</span>
            )}
          </div>
          <div className="text-xs text-dim">
            {[c.race, c.class, c.rank].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs flex-wrap">
          <ExclusionToggles
            character={c.name}
            excludeFromStats={!!c.exclude_from_stats}
            excludeInventory={!!c.exclude_inventory}
            tellRelay={!!c.tell_relay}
            tellDm={c.tell_dm !== false}
            showInventoryPublicly={!!c.show_inventory_publicly}
          />
          <Link href={`/character/${encodeURIComponent(c.name)}`} className="text-blue hover:underline">public page →</Link>
          <Link href={`/character/${encodeURIComponent(c.name)}/quests`} className="text-blue hover:underline">quests →</Link>
          <Link href={`/character/${encodeURIComponent(c.name)}/spells`} className="text-blue hover:underline">spells →</Link>
          <Link href={`/character/${encodeURIComponent(c.name)}/inventory`} className="text-blue hover:underline">inventory →</Link>
          {c.quarmy_url && (
            <a href={c.quarmy_url} target="_blank" rel="noreferrer" className="text-blue hover:underline">quarmy →</a>
          )}
          {c.opendkp_id && (
            <span className="text-dim">opendkp id {c.opendkp_id}</span>
          )}
          <InventoryUpload character={c.name} />
          <KeysUpload character={c.name} />
          <SpellbookUpload character={c.name} />
        </div>
      </div>
    );

    const details = (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
        <Panel title="Parses">
          <Row label="Encounters">{s.encounterCount.toLocaleString()}</Row>
          <Row label="Total damage">{s.totalDamage.toLocaleString()}</Row>
          <Row label="Top fight">
            {s.topDmg > 0 ? (
              <Link href={`/parses/${s.topEncounterId}`} className="text-blue hover:underline">
                {s.topDmg.toLocaleString()} dmg →
              </Link>
            ) : '—'}
          </Row>
        </Panel>

        <Panel title="Agent uploads">
          <Row label="Total contributions">{s.uploadCount.toLocaleString()}</Row>
          <Row label="Last upload">
            {s.lastUpload ? <>{relTime(s.lastUpload)} <span className="text-dim text-[10px]">· {fmtAbs(s.lastUpload, tz)}</span></> : '—'}
          </Row>
          <Row label="Latest agent version">
            {s.latestAgentVersion
              ? <span className="text-text">v{s.latestAgentVersion}</span>
              : <span className="text-dim text-[10px] italic">none recorded yet (pre-v2.4.26 uploads aren&apos;t stamped)</span>}
          </Row>
        </Panel>

        <Panel title="Chat">
          <Row label="Last 30 days">{s.chat30.toLocaleString()}</Row>
          <Row label="All-time">{s.chatAll.toLocaleString()}</Row>
        </Panel>

        <Panel title="PvP">
          <Row label="Kills"  green>{s.pvpKills.toLocaleString()}</Row>
          <Row label="Deaths" red>{s.pvpDeaths.toLocaleString()}</Row>
        </Panel>

        <Panel title="Loot">
          <Row label="Items won">{s.lootCount.toLocaleString()}</Row>
          <Row label="DKP spent">{s.dkpSpent.toLocaleString()}</Row>
          <Row label="Wishlist entries">
            {s.wishlistCount.toLocaleString()}
            {s.wishlistCount > 0 && <span className="text-dim text-[10px] ml-2">use /mywishlist in Discord for decrypted bids</span>}
          </Row>
        </Panel>

        {/* Skill breakdown + self-attack counter (PRIVATE scope per
            CLAUDE.md disclosure spec: only the owner sees this; nothing
            here ever appears named on a public page). Populated by
            encounter_combat_rollup which started collecting at agent
            v2.4.26 — older raids have no source data and only populate
            if the member opts in to resubmit those logs. */}
        <Panel
          title="Skill breakdown"
          badge="PRIVATE"
          tooltip="Only you see this — never named elsewhere. Hits by EQ skill (Crushing, 1H Slash, Backstab, Channeling) and per-spell totals across every raid where you ran the agent. Times you attacked yourself = swings/casts where your character resolved as both attacker and defender (charm break, fat-finger /assist, riposted swing, etc)."
        >
          {s.rollupHits === 0 && s.encountersWithDetail === 0 ? (
            <div className="text-dim text-xs italic">
              No skill breakdown collected for this character yet.{' '}
              {s.encountersResubmittable > 0 && (
                <>Re-run the agent (v2.4.26+) over your old logs to unlock totals for past raids.</>
              )}
            </div>
          ) : (
            <>
              <Row label="Total hits logged">{s.rollupHits.toLocaleString()}</Row>
              <Row label="Total damage logged">{s.rollupDamage.toLocaleString()}</Row>
              <Row label="Times you attacked yourself">
                <span className={s.selfAttackCount > 0 ? 'text-orange' : 'text-text'}>
                  {s.selfAttackCount.toLocaleString()}
                </span>
              </Row>
              {s.topSkills.length > 0 && (
                <div className="pt-2 mt-1 border-t border-border/40">
                  <div className="text-[10px] text-dim mb-1">Top skills by damage</div>
                  <ul className="space-y-0.5 text-xs">
                    {s.topSkills.map(t => (
                      <li key={t.skill} className="flex items-center gap-2">
                        <span className="flex-1 min-w-0 text-text truncate">{t.skill}</span>
                        <span className="w-24 shrink-0 text-dim text-[10px] text-right tabular-nums whitespace-nowrap">{t.hits.toLocaleString()} hits</span>
                        <span className="w-24 shrink-0 text-text text-[10px] text-right tabular-nums whitespace-nowrap">{t.dmg.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          {s.encountersResubmittable > 0 && (
            <div className="mt-2 pt-2 border-t border-border/40 text-[10px] text-dim">
              <span className="text-orange">
                {s.encountersResubmittable.toLocaleString()} past raid{s.encountersResubmittable === 1 ? '' : 's'}
              </span>{' '}
              could unlock a full skill breakdown if you resubmit those logs with agent v2.4.26+.
            </div>
          )}
          {s.memberSince && (
            <div className="mt-1 text-[10px] text-dim">
              Counted from <span className="text-text">{fmtDateOnly(s.memberSince, tz)}</span>
              {s.floorSource && (
                <span className="text-dim/70"> · floor: {s.floorSource.replace('_', ' ')}</span>
              )}
            </div>
          )}
        </Panel>

        <Panel title="Recent encounters">
          {s.recentEncounters.length === 0 ? (
            <div className="text-dim text-xs italic">No parses recorded.</div>
          ) : (
            <ul className="space-y-1 text-xs">
              {s.recentEncounters.map(e => (
                <li key={e.id} className="flex items-center gap-2">
                  <Link href={`/parses/${e.id}`} className="flex-1 min-w-0 text-blue hover:underline truncate">
                    {e.npc_name || 'unknown'}
                  </Link>
                  <span className="w-36 shrink-0 text-dim text-[10px] text-right tabular-nums whitespace-nowrap">{fmtAbs(e.started_at, tz)}</span>
                  <span className="w-20 shrink-0 text-text text-[10px] text-right tabular-nums whitespace-nowrap">{e.damage.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {buffsZonePanel}
      </div>
    );

    return { name: c.name, level, header, summary: buffsZonePanel, details } as MeCard;
  });

  return (
    <div className="space-y-6">
      {discordId && (
        <section className={`bg-panel border ${bannerBorderClass} rounded-lg p-4`}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className={`text-sm font-semibold ${bannerTextClass}`}>{bannerHeadline}</div>
              <div className="text-xs text-dim mt-0.5">{bannerSub}</div>
            </div>
            <a
              href="http://localhost:7779"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue hover:underline whitespace-nowrap"
              title="The local parser dashboard — only opens if your wolfpack-logsync agent is running on this machine."
            >
              localhost:7779 ↗
            </a>
          </div>
          {syncRows.length > 0 && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 text-xs">
              {syncRows.map(r => (
                <div key={r.name} className="flex items-center justify-between gap-2 bg-bg border border-border/60 rounded px-2 py-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span aria-hidden className={
                      r.status === 'live'   ? 'text-green'    :
                      r.status === 'recent' ? 'text-orange'   :
                      r.status === 'stale'  ? 'text-orange/70' : 'text-dim/60'
                    }>●</span>
                    <span className="text-text truncate">{r.name}</span>
                  </div>
                  <div className="text-[10px] text-dim whitespace-nowrap">
                    {r.status === 'never'
                      ? 'no uploads'
                      : <>{relTime(r.lastUpload)}{r.agentVersion && <span className="text-dim/70"> · v{r.agentVersion}</span>}</>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      <section className="bg-panel border border-border rounded-lg p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-xl text-gold mb-1">👤 My Characters</h2>
            <p className="text-sm text-dim">
              Everything we track about characters linked to your Discord account.
              {discordId && (
                <> Signed in as <span className="text-text">{nickname || discordId}</span>.</>
              )}
            </p>
          </div>
          <Link href="/me/tells" className="text-blue hover:underline text-sm whitespace-nowrap">
            📬 Inbound /tell →
          </Link>
        </div>

        {allChars.length === 0 ? (
          <div className="bg-bg border border-orange/40 rounded p-4 mt-4 text-sm">
            <div className="text-orange mb-1">No characters linked to your Discord account.</div>
            <div className="text-dim text-xs">
              An officer needs to link your characters via the admin tool, or you can
              ask in <code>#feedback</code>. Until then, this page will be empty.
            </div>
          </div>
        ) : chars.length === 0 ? (
          <div className="bg-bg border border-dim/40 rounded p-4 mt-4 text-sm text-dim">
            All your linked characters are set to <span className="text-orange">exclude_from_stats</span>.
            Nothing to show.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
            <Stat label="Characters" value={agg.chars} />
            <Stat label="Encounters" value={agg.encounters} />
            <Stat label="Total damage" value={agg.totalDamage} compact />
            <Stat label="Uploads"      value={agg.uploads}      color="text-blue" />
            <Stat label="PvP kills"    value={agg.pvpKills}     color="text-green" />
            <Stat label="PvP deaths"   value={agg.pvpDeaths}    color="text-red-400" />
            <Stat label="Loot won"     value={agg.lootCount}    color="text-purple" />
            <Stat label="DKP spent"    value={agg.dkpSpent}     compact />
          </div>
        )}
      </section>

      {scrap && scrap.me && (() => {
        const { me, rival, top, contenders } = scrap;
        const isTopDog = me!.rank === 1;
        const gap = rival ? rival.total_damage - me!.total_damage : 0;
        const shareText =
          `🐺 The Scrap (30d) — ${me!.character_name} is #${me!.rank} of ${contenders} in damage ` +
          `(${fmtDmg(me!.total_damage)}, best parse ${me!.best_dps.toLocaleString()}/s). ` +
          `Top Dog: ${top.character_name} (${fmtDmg(top.total_damage)}). wolfpack.quest`;
        return (
          <section className="bg-panel border border-gold/40 rounded-lg p-6">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-xl text-gold mb-1">🐺 The Scrap</h2>
                <p className="text-sm text-dim">Friendly damage competition · last 30 days · {contenders} contenders</p>
              </div>
              <ScrapShare text={shareText} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
              {/* Your standing */}
              <div className="bg-bg border border-border rounded p-4 sm:col-span-1">
                <div className="text-dim text-xs">Your best</div>
                <div className="text-2xl text-text mt-0.5">#{me!.rank} <span className="text-dim text-sm">of {contenders}</span></div>
                <div className="text-sm text-blue mt-1">{me!.character_name}</div>
                <div className="text-dim text-xs mt-1">{fmtDmg(me!.total_damage)} dmg · best {me!.best_dps.toLocaleString()}/s · {me!.encounters} fights</div>
              </div>

              {/* Rival / Top Dog status */}
              <div className="bg-bg border border-border rounded p-4 sm:col-span-2 flex flex-col justify-center">
                {isTopDog ? (
                  <div className="text-lg text-gold">🏆 You&apos;re the Top Dog — nobody&apos;s out-scrapped you this month.</div>
                ) : rival ? (
                  <>
                    <div className="text-sm text-text">
                      <span className="text-orange">{rival.character_name}</span> is one spot ahead at #{rival.rank}.
                    </div>
                    <div className="text-dim text-xs mt-1">
                      Close <span className="text-text">{fmtDmg(gap)}</span> damage to take the spot.
                    </div>
                    <div className="text-dim text-xs mt-2">
                      🥇 Top Dog: <span className="text-gold">{top.character_name}</span> ({fmtDmg(top.total_damage)})
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-dim">
                    🥇 Top Dog: <span className="text-gold">{top.character_name}</span> ({fmtDmg(top.total_damage)})
                  </div>
                )}
              </div>
            </div>
            <p className="text-dim text-[11px] mt-3">
              Ranked by total damage parsed in the last 30 days. Tanking &amp; healing categories coming once we persist those stats.
            </p>
          </section>
        );
      })()}

      {excludedChars.length > 0 && (
        <section className="bg-panel border border-border/60 rounded-lg p-4 text-xs">
          <div className="text-orange mb-2">Excluded from stats per your settings</div>
          <ul className="space-y-2">
            {excludedChars.map(c => (
              <li key={c.name} className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-text">{c.name}</span>
                <ExclusionToggles
                  character={c.name}
                  excludeFromStats={!!c.exclude_from_stats}
                  excludeInventory={!!c.exclude_inventory}
                  tellRelay={!!c.tell_relay}
                  tellDm={c.tell_dm !== false}
                  showInventoryPublicly={!!c.show_inventory_publicly}
                />
              </li>
            ))}
          </ul>
          <div className="text-[10px] text-dim/70 mt-3">
            Flip Stats off to bring a character back to the main grid. The agent picks up the
            change within ~10 minutes and resumes uploading for that character.
          </div>
        </section>
      )}

      <MeCharacterCards items={cardItems} storageKey={discordId ?? ''} />
    </div>
  );
}

function Stat({ label, value, color = 'text-text', compact = false }: { label: string; value: number; color?: string; compact?: boolean }) {
  const formatted = compact && value >= 1000
    ? value >= 1_000_000
      ? `${(value / 1_000_000).toFixed(1)}M`
      : `${(value / 1000).toFixed(1)}K`
    : value.toLocaleString();
  return (
    <div className="bg-bg border border-border rounded p-3">
      <div className={`text-2xl ${color}`}>{formatted}</div>
      <div className="text-dim text-xs">{label}</div>
    </div>
  );
}

function Panel({ title, children, badge, tooltip }: {
  title: string;
  children: React.ReactNode;
  badge?: 'PRIVATE' | 'ANON' | 'GUILD';
  tooltip?: string;
}) {
  // Scope badge follows the PRIVATE/ANON/GUILD contract in CLAUDE.md's "Stat
  // Visibility & Disclosure" section so members can always tell what's exposed.
  // The HTML `title` attribute is the minimum viable tooltip — works on hover
  // and assistive tech with no extra JS. Richer popovers are a Mimic concern.
  const badgeClass =
    badge === 'PRIVATE' ? 'bg-purple/20 text-purple border-purple/40' :
    badge === 'ANON'    ? 'bg-blue/20   text-blue   border-blue/40'   :
    badge === 'GUILD'   ? 'bg-green/20  text-green  border-green/40'  : '';
  return (
    <div className="p-4 border-b border-r border-border/40 last:border-r-0">
      <h4 className="text-xs text-orange mb-2 flex items-center gap-2">
        <span>{title}</span>
        {badge && (
          <span
            className={`text-[9px] px-1.5 py-0.5 rounded border ${badgeClass} font-mono cursor-help`}
            title={tooltip}
          >
            {badge}
          </span>
        )}
      </h4>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ label, children, green, red }: { label: string; children: React.ReactNode; green?: boolean; red?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-dim">{label}</span>
      <span className={green ? 'text-green' : red ? 'text-red-400' : 'text-text'}>{children}</span>
    </div>
  );
}
