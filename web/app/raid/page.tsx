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
  categorizeBuff, classToRole, analyzeHpSlots, ROLE_TARGETS,
  type BuffCategory, type Role, type HpSlotState,
} from '@/lib/buffs';
import RaidView, { type RaidRow } from './RaidView';

export const dynamic = 'force-dynamic';

type LiveStateRow = {
  character: string;
  zone_name: string | null;
  buffs: { name: string; ticks: number | null }[] | null;
  buff_count: number | null;
  updated_at: string | null;
};

type RosterRow = {
  name: string;
  class: string | null;
  group_num: number | null;
  level: number | null;
  rank: string | null;
};

// Color tier — at-a-glance triage signal. Driven by missing role-expected
// categories, missing HP slots, and how close any buff is to falling off.
// Tunable; this is a first pass per the roadmap doc.
function colorTier(
  role: Role,
  byCategory: Record<string, string[]>,
  hpSlots: HpSlotState,
  buffs: { name: string; ticks: number | null }[] | null,
  noAgent: boolean,
): 'green' | 'yellow' | 'orange' | 'red' | 'unknown' {
  if (noAgent) return 'unknown';
  const target = ROLE_TARGETS[role] || [];
  const missingCats = target.filter(c => !(byCategory[c]?.length)).length;
  const missingHpSlots = (['A','B','C'] as const).filter(s => !hpSlots[s]).length;
  // "Critical missing" = no HP slot at all, or a priest/caster with no mana regen.
  const criticalMissing =
    missingHpSlots >= 3 ||
    ((role === 'priest' || role === 'caster') && !byCategory.manaRegen?.length);
  if (criticalMissing) return 'red';
  // Anything close to falling off? (Ticks remaining ≤ 2 = ~12s left.)
  const expiringSoon = (buffs ?? []).some(b => b && b.ticks != null && b.ticks <= 2 && b.ticks > 0);
  if (expiringSoon) return 'orange';
  if (missingCats > 0 || missingHpSlots > 0) return 'yellow';
  return 'green';
}

export default async function RaidHubPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/raid');

  const ROSTER_FRESH_MS = 15 * 60 * 1000;
  const rosterSince = new Date(Date.now() - ROSTER_FRESH_MS).toISOString();

  const admin = supabaseAdmin();
  const [{ data: liveRows }, { data: charRows }, { data: rosterRows }] = await Promise.all([
    admin.from('character_live_state')
      .select('character, zone_name, buffs, buff_count, updated_at')
      .eq('guild_id', 'wolfpack')
      .order('updated_at', { ascending: false }),
    admin.from('characters')
      .select('name, class, main_name, discord_id')
      .eq('guild_id', 'wolfpack'),
    admin.from('raid_roster')
      .select('name, class, group_num, level, rank, captured_at')
      .eq('guild_id', 'wolfpack')
      .gte('captured_at', rosterSince),
  ]);

  const rosterByName = new Map<string, RosterRow>(
    ((rosterRows ?? []) as RosterRow[]).map(r => [r.name.toLowerCase(), r]),
  );
  const classByName = new Map<string, string | null>(
    ((charRows ?? []) as { name: string; class: string | null }[])
      .map(c => [c.name.toLowerCase(), c.class]),
  );
  const classFor = (name: string): string | null =>
    classByName.get(name.toLowerCase()) ?? rosterByName.get(name.toLowerCase())?.class ?? null;

  function bucketBuffs(buffs: { name: string; ticks: number | null }[] | null) {
    const byCategory: Record<string, string[]> = {};
    const other: string[] = [];
    for (const b of (buffs ?? [])) {
      if (!b || !b.name) continue;
      const cat = categorizeBuff(b.name);
      if (cat) (byCategory[cat] ||= []).push(b.name);
      else other.push(b.name);
    }
    return { byCategory, other };
  }

  // Build rows: every roster member (or live-state character) gets one. Roster
  // wins for grouping; live state fills in buffs/zone.
  const liveByName = new Map<string, LiveStateRow>();
  for (const r of (liveRows ?? []) as LiveStateRow[]) {
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
    const { byCategory, other } = bucketBuffs(live?.buffs ?? null);
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
      buffCount: live?.buff_count ?? (live?.buffs?.length ?? 0),
      byCategory,
      other,
      hpSlots,
      tier: colorTier(role, byCategory, hpSlots, live?.buffs ?? null, noAgent),
      buffs: live?.buffs ?? [],
    });
  }
  // 2. Anyone with live state but NOT in the roster (parked alt running Mimic,
  //    or roster not yet flowing) — bucket as "Not in raid".
  for (const r of (liveRows ?? []) as LiveStateRow[]) {
    const lower = r.character.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    const className = classFor(r.character);
    const role = classToRole(className);
    const { byCategory, other } = bucketBuffs(r.buffs);
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
      buffCount: r.buff_count ?? (r.buffs?.length ?? 0),
      byCategory,
      other,
      hpSlots,
      tier: colorTier(role, byCategory, hpSlots, r.buffs, false),
      buffs: r.buffs ?? [],
    });
  }

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
    />
  );
}
