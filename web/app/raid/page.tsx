// /raid — the next-gen operational raid view (mockup).
//
// This is the framework laid out per docs/raid-hub-roadmap.md. It uses the
// SAME live data as /buffs (raid_roster + character_live_state + characters)
// so what shows up here on raid night is real. Interactive bits that aren't
// wired yet are clearly labeled ("preview") or stubbed so we can iterate.
//
// Stage 1 of the roadmap:
//   ✓ Grouped by live raid group, with crowns for raid + group leaders
//   ✓ Per-character color tier (green/yellow/orange/red) from buff coverage
//   ✓ Click a character → side panel (RaidView client component)
//   ✓ "I'm buffing as…" selector (filters the queue view, preview)
//
// Wiring up later (deps tagged in raid-hub-roadmap.md):
//   • Raid-leader Discord auto-link from /ari + characters.discord_id
//   • Buffer-mode queue using real timers (needs cast attribution)
//   • RaidHelper sign-up diff
//   • Mass-buff cooldown tracking + Feral Avatar queue
//   • DKP auction winner highlight

import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import {
  categorizeBuff, classToRole, analyzeHpSlots, ROLE_TARGETS, isCorpse,
  resistTypesFor, isSongBuff,
  type BuffCategory, type Role, type HpSlotState, type ResistType,
} from '@/lib/buffs';
import RaidView, { type RaidRow } from './RaidView';

export const dynamic = 'force-dynamic';

type PetBuff = { name: string; remaining_secs: number | null; total_secs: number | null; good: number | null };
type LiveStateRow = {
  character: string;
  zone_name: string | null;
  self_hp_pct: number | null;
  buffs: { name: string; ticks: number | null; song?: boolean }[] | null;
  buff_count: number | null;
  pet_name: string | null;
  pet_hp_pct: number | null;
  pet_buffs: PetBuff[] | null;
  updated_at: string | null;
};

type RosterRow = {
  name: string;
  class: string | null;
  group_num: number | null;
  level: number | null;
  rank: string | null;
  hp_pct: number | null;
};

// Color tier — at-a-glance triage signal, per the user's spec:
//   RED    — no buffs at all (or essentially none — buff_count 0)
//   ORANGE — missing critical buff family for the role: any HP slot empty, OR
//            a priest/caster missing mana / mana-regen
//   YELLOW — missing one or two of the OTHER role-target categories
//   GREEN  — all role-expected buffs present (and all 3 HP slots filled)
function colorTier(
  role: Role,
  byCategory: Record<string, string[]>,
  hpSlots: HpSlotState,
  buffs: { name: string; ticks: number | null }[] | null,
  noAgent: boolean,
): 'green' | 'yellow' | 'orange' | 'red' | 'unknown' {
  if (noAgent) return 'unknown';
  const totalBuffs = (buffs ?? []).filter(b => b && b.name).length;
  if (totalBuffs === 0) return 'red';

  const missingHpSlots = (['A','B','C'] as const).filter(s => !hpSlots[s]);
  const isCaster = role === 'caster' || role === 'priest';
  const missingMana       = isCaster && !byCategory.mana?.length;
  const missingManaRegen  = isCaster && !byCategory.manaRegen?.length;

  // ORANGE: any HP slot empty, OR a caster missing mana/mana-regen.
  if (missingHpSlots.length > 0 || missingMana || missingManaRegen) return 'orange';

  // YELLOW: missing one or two of the OTHER (non-HP, non-mana) role-target
  // categories. mana/manaRegen are excluded because they're already handled
  // by the orange tier above.
  const target = (ROLE_TARGETS[role] || []).filter(c => c !== 'mana' && c !== 'manaRegen');
  const missingOther = target.filter(c => !(byCategory[c]?.length)).length;
  if (missingOther > 0) return 'yellow';

  return 'green';
}

export default async function RaidHubPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/raid');

  const ROSTER_FRESH_MS = 15 * 60 * 1000;
  const rosterSince = new Date(Date.now() - ROSTER_FRESH_MS).toISOString();

  const admin = supabaseAdmin();
  const [{ data: liveRows }, { data: charRows }, { data: rosterRows }, { data: memberRow }] = await Promise.all([
    admin.from('character_live_state')
      .select('character, zone_name, self_hp_pct, buffs, buff_count, pet_name, pet_hp_pct, pet_buffs, updated_at')
      .eq('guild_id', 'wolfpack')
      .order('updated_at', { ascending: false }),
    admin.from('characters')
      .select('name, class, main_name, discord_id')
      .eq('guild_id', 'wolfpack'),
    admin.from('raid_roster')
      .select('name, class, group_num, level, rank, hp_pct, captured_at')
      .eq('guild_id', 'wolfpack')
      .gte('captured_at', rosterSince),
    // Signed-in user → discord_id so we can find THEIR character in the raid.
    // Lets us auto-pick a default Buffer-mode class (their own class) and
    // optionally highlight their row. Override is still always available.
    admin.from('wolfpack_members')
      .select('discord_id')
      .eq('user_id', user.id)
      .maybeSingle(),
  ]);
  const meDiscordId = memberRow?.discord_id ?? null;

  // EQ corpses ("<Owner>'s corpse1234") register as live characters — drop them.
  const liveClean   = ((liveRows ?? []) as LiveStateRow[]).filter(r => !isCorpse(r.character));
  const rosterClean = ((rosterRows ?? []) as RosterRow[]).filter(r => !isCorpse(r.name));

  const rosterByName = new Map<string, RosterRow>(
    rosterClean.map(r => [r.name.toLowerCase(), r]),
  );
  const classByName = new Map<string, string | null>(
    ((charRows ?? []) as { name: string; class: string | null }[])
      .map(c => [c.name.toLowerCase(), c.class]),
  );
  const classFor = (name: string): string | null =>
    classByName.get(name.toLowerCase()) ?? rosterByName.get(name.toLowerCase())?.class ?? null;
  // name(lower) → discord_id (for the "me" highlight) and discord_id → set of
  // owned characters. Family roots inherit their own discord_id; alts inherit
  // the family root's via main_name.
  const charByName = new Map<string, { name: string; main_name: string | null; discord_id: string | null }>(
    ((charRows ?? []) as { name: string; class: string | null; main_name: string | null; discord_id: string | null }[])
      .map(c => [c.name.toLowerCase(), { name: c.name, main_name: c.main_name, discord_id: c.discord_id }]),
  );
  const discordIdFor = (name: string): string | null => {
    const e = charByName.get(name.toLowerCase());
    if (!e) return null;
    if (e.discord_id) return e.discord_id;
    if (e.main_name) return charByName.get(e.main_name.toLowerCase())?.discord_id ?? null;
    return null;
  };

  // Build the pet snapshot a RaidRow carries, from a live-state row. Null when
  // the owner has no pet (non-pet class, or pet not up).
  function petFor(live: LiveStateRow | undefined) {
    if (!live || !live.pet_name) return null;
    return {
      name: live.pet_name,
      hpPct: live.pet_hp_pct ?? null,
      buffs: (live.pet_buffs ?? []).filter(b => b && b.name),
    };
  }

  function bucketBuffs(buffs: { name: string; ticks: number | null; song?: boolean }[] | null) {
    const byCategory: Record<string, string[]> = {};
    const other: string[] = [];
    // Per-school resist coverage (MR/FR/CR/PR/DR → granting buff names) and
    // the bard songs currently landed (song flag from agent v3.1.12+, name
    // heuristic for older data).
    const resists: Record<ResistType, string[]> = { MR: [], FR: [], CR: [], PR: [], DR: [] };
    const songs: { name: string; ticks: number | null }[] = [];
    for (const b of (buffs ?? [])) {
      if (!b || !b.name) continue;
      if (isSongBuff(b.name, b.song)) songs.push({ name: b.name, ticks: b.ticks ?? null });
      for (const t of resistTypesFor(b.name)) resists[t].push(b.name);
      const cat = categorizeBuff(b.name);
      if (cat) (byCategory[cat] ||= []).push(b.name);
      else other.push(b.name);
    }
    return { byCategory, other, resists, songs };
  }

  // Build rows: every roster member (or live-state character) gets one. Roster
  // wins for grouping; live state fills in buffs/zone.
  const liveByName = new Map<string, LiveStateRow>();
  for (const r of liveClean) {
    liveByName.set(r.character.toLowerCase(), r);
  }

  const seen = new Set<string>();
  const rows: RaidRow[] = [];

  // 1. Roster members first (with or without live state).
  for (const [lower, rr] of rosterByName) {
    if (seen.has(lower)) continue;
    seen.add(lower);
    const live = liveByName.get(lower);
    const className = classFor(rr.name);
    const role = classToRole(className);
    const { byCategory, other, resists, songs } = bucketBuffs(live?.buffs ?? null);
    const hpSlots = analyzeHpSlots((live?.buffs ?? []).map(b => b?.name).filter(Boolean) as string[]);
    const noAgent = !live;
    rows.push({
      name: rr.name,
      className,
      role,
      raidGroup: rr.group_num ?? null,
      level: rr.level ?? null,
      rank: rr.rank ?? null,        // '2' raid leader, '1' group leader, else member
      inRaid: true,
      noAgent,
      zone: live?.zone_name ?? null,
      updatedAt: live?.updated_at ?? null,
      // HP%: roster broadcast (any Mimic raider in this person's group) wins;
      // own-self HP from character_live_state fills in when this raider runs
      // Mimic themselves and their group has no other broadcaster yet.
      hpPct: rr.hp_pct ?? live?.self_hp_pct ?? null,
      buffCount: live?.buff_count ?? (live?.buffs?.length ?? 0),
      byCategory,
      other,
      resists,
      songs,
      hpSlots,
      tier: colorTier(role, byCategory, hpSlots, live?.buffs ?? null, noAgent),
      buffs: live?.buffs ?? [],
      pet: petFor(live),
      isMe: !!(meDiscordId && discordIdFor(rr.name) === meDiscordId),
    });
  }
  // 2. Anyone with live state but NOT in the roster (parked alt running Mimic,
  //    or roster not yet flowing) — bucket as "Not in raid".
  for (const r of liveClean) {
    const lower = r.character.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    const className = classFor(r.character);
    const role = classToRole(className);
    const { byCategory, other, resists, songs } = bucketBuffs(r.buffs);
    const hpSlots = analyzeHpSlots((r.buffs ?? []).map(b => b?.name).filter(Boolean) as string[]);
    rows.push({
      name: r.character,
      className,
      role,
      raidGroup: null,
      level: null,
      rank: null,
      inRaid: false,
      noAgent: false,
      zone: r.zone_name,
      updatedAt: r.updated_at,
      hpPct: r.self_hp_pct ?? null,
      buffCount: r.buff_count ?? (r.buffs?.length ?? 0),
      byCategory,
      other,
      resists,
      songs,
      hpSlots,
      tier: colorTier(role, byCategory, hpSlots, r.buffs, false),
      buffs: r.buffs ?? [],
      pet: petFor(r),
      isMe: !!(meDiscordId && discordIdFor(r.character) === meDiscordId),
    });
  }

  // The signed-in user's class as they appear in the current raid (if any) —
  // used as the default Buffer-mode class. They can override.
  const myInRaid = rows.find(r => r.inRaid && r.isMe) || rows.find(r => r.isMe);
  const myClass  = myInRaid?.className || null;

  // Headline counters (raid leader name, coverage, etc.) computed here so the
  // client component just renders.
  const inRaid       = rows.filter(r => r.inRaid);
  const mimicCovered = inRaid.filter(r => !r.noAgent).length;
  const leader       = inRaid.find(r => r.rank === '2') ?? null;
  const groupLeaders = new Map<number, string>();
  for (const r of inRaid) {
    if (r.rank === '1' && r.raidGroup != null && !groupLeaders.has(r.raidGroup)) {
      groupLeaders.set(r.raidGroup, r.name);
    }
  }

  return (
    <RaidView
      rows={rows}
      raidSize={inRaid.length}
      mimicCovered={mimicCovered}
      leaderName={leader?.name ?? null}
      leaderClass={leader?.className ?? null}
      groupLeaders={Object.fromEntries(groupLeaders)}
      myClass={myClass}
    />
  );
}
