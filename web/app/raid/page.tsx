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
  resistTypesFor, isSongBuff, secondaryCategoriesFor, UPGRADE_CHAINS, chainPosition,
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
  swapped_to: string | null;
  swapped_at: string | null;
  updated_at: string | null;
};

type RosterRow = {
  name: string;
  class: string | null;
  group_num: number | null;
  level: number | null;
  rank: string | null;
  hp_pct: number | null;
  uploaded_by_discord_id: string | null;
  captured_at: string | null;
};

// Color tier — at-a-glance triage signal, per the user's spec:
//   RED    — no buffs at all (or essentially none — buff_count 0)
//   ORANGE — missing critical buff family for the role: any HP slot empty, OR
//            a priest/caster missing mana / mana-regen
//   YELLOW — missing one or two of the OTHER role-target categories
//            ("almost everything buffed, missing something non-critical")
//   LIGHT GREEN ('upgradable') — nothing missing, but at least one buff has
//            a stronger cast available (Aego vs Ancient: Gift of Aegolism,
//            Focus of Spirit vs Khura's, JBoots vs Bihli)
//   GREEN  — all role-expected buffs present at best-available strength
function colorTier(
  role: Role,
  byCategory: Record<string, string[]>,
  hpSlots: HpSlotState,
  buffs: { name: string; ticks: number | null }[] | null,
  noAgent: boolean,
): 'green' | 'upgradable' | 'yellow' | 'orange' | 'red' | 'unknown' {
  if (noAgent) return 'unknown';
  const totalBuffs = (buffs ?? []).filter(b => b && b.name).length;
  if (totalBuffs === 0) return 'red';

  const missingHpSlots = (['A','B','C'] as const).filter(s => !hpSlots[s]);
  const isCaster = role === 'caster' || role === 'priest';
  // Mana (max-mana) is no longer a queue gap — KEI covers it (see ROLE_TARGETS).
  const missingMana       = false;
  const missingManaRegen  = isCaster && !byCategory.manaRegen?.length;

  // ORANGE: any HP slot empty, OR a caster missing mana/mana-regen.
  if (missingHpSlots.length > 0 || missingMana || missingManaRegen) return 'orange';

  // YELLOW: missing one or two of the OTHER (non-HP, non-mana) role-target
  // categories. mana/manaRegen are excluded because they're already handled
  // by the orange tier above.
  const target = (ROLE_TARGETS[role] || []).filter(c => c !== 'mana' && c !== 'manaRegen');
  const missingOther = target.filter(c => !(byCategory[c]?.length)).length;
  if (missingOther > 0) return 'yellow';

  // LIGHT GREEN: fully covered, but a known upgrade chain has a lower link —
  // class-blind here (whether ANY buffer can improve it; the queue scopes it
  // to the buffer's class).
  const names = (buffs ?? []).map(b => b?.name).filter(Boolean) as string[];
  for (const ch of UPGRADE_CHAINS) {
    if (ch.roles && !ch.roles.includes(role)) continue;
    const pos = chainPosition(ch.chain, names);
    if (pos >= 0 && pos < ch.chain.length - 1) return 'upgradable';
  }

  return 'green';
}

export default async function RaidHubPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/raid');

  const ROSTER_FRESH_MS = 15 * 60 * 1000;
  const rosterSince = new Date(Date.now() - ROSTER_FRESH_MS).toISOString();

  const admin = supabaseAdmin();
  // MGB AA: Quarmy AA index 35 (eqemu_altadv_vars.eqmacid). character_aas only
  // has entries for raiders whose owners run the Quarmy export — absence ≠
  // untrained, just unknown. We pass the SET of trained characters to the view
  // for a small badge on the raid card.
  const MGB_AA_INDEX = 35;
  // buff_casts window for inference. A group V2 cast (Talisman of Epuration,
  // Aegolism, …) lands a buff_casts row PER TARGET, so if any Mimic raider
  // in the group caught the cast we have rows for every groupmate — that
  // gives us a real timer for a non-Mimic raider in the group. 3h covers
  // every extended-duration group buff in era without dragging in stale
  // observations.
  const buffCastsSince = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const [{ data: liveRows }, { data: charRows }, { data: rosterRows }, { data: memberRow }, { data: mgbRows }, { data: buffCastRows }] = await Promise.all([
    admin.from('character_live_state')
      .select('character, zone_name, self_hp_pct, buffs, buff_count, pet_name, pet_hp_pct, pet_buffs, swapped_to, swapped_at, updated_at')
      .eq('guild_id', 'wolfpack')
      .order('updated_at', { ascending: false }),
    admin.from('characters')
      .select('name, class, main_name, discord_id')
      .eq('guild_id', 'wolfpack'),
    admin.from('raid_roster')
      .select('name, class, group_num, level, rank, hp_pct, captured_at, uploaded_by_discord_id')
      .eq('guild_id', 'wolfpack')
      .gte('captured_at', rosterSince),
    // Signed-in user → discord_id so we can find THEIR character in the raid.
    // Lets us auto-pick a default Buffer-mode class (their own class) and
    // optionally highlight their row. Override is still always available.
    admin.from('wolfpack_members')
      .select('discord_id')
      .eq('user_id', user.id)
      .maybeSingle(),
    admin.from('character_aas')
      .select('character')
      .eq('guild_id', 'wolfpack')
      .eq('aa_index', MGB_AA_INDEX)
      .gte('rank', 1),
    admin.from('buff_casts')
      .select('target, spell_name, dur_ticks, cast_at')
      .eq('guild_id', 'wolfpack')
      .gte('cast_at', buffCastsSince)
      .order('cast_at', { ascending: false })
      .limit(3000),
  ]);
  // Per-target, per-spell: most recent cast still within its catalog duration
  // becomes an inferred buff entry. Two Mimic raiders in the same group can
  // both witness the same group cast — last-write-wins on castMs dedups them.
  type InferredBuff = { name: string; ticks: number | null; castMs: number };
  const inferredBuffsByName = new Map<string, InferredBuff[]>();
  {
    const now = Date.now();
    const byKey = new Map<string, { name: string; ticks: number | null; castMs: number; target: string }>();
    for (const c of ((buffCastRows ?? []) as { target: string; spell_name: string; dur_ticks: number | null; cast_at: string }[])) {
      if (!c || !c.target || !c.spell_name) continue;
      const castMs = Date.parse(c.cast_at) || 0;
      if (!castMs) continue;
      const durSecs = (Number(c.dur_ticks) || 0) * 6;
      if (durSecs > 0 && (now - castMs) > durSecs * 1000) continue;
      const k = String(c.target).toLowerCase() + '|' + String(c.spell_name).toLowerCase();
      const prev = byKey.get(k);
      if (!prev || castMs > prev.castMs) byKey.set(k, { name: c.spell_name, ticks: c.dur_ticks, castMs, target: c.target });
    }
    for (const v of byKey.values()) {
      const remSecs = (Number(v.ticks) || 0) * 6 - (now - v.castMs) / 1000;
      const remTicks = remSecs > 0 ? Math.ceil(remSecs / 6) : 0;
      if (remTicks <= 0) continue;
      const k = String(v.target).toLowerCase();
      if (!inferredBuffsByName.has(k)) inferredBuffsByName.set(k, []);
      inferredBuffsByName.get(k)!.push({ name: v.name, ticks: remTicks, castMs: v.castMs });
    }
  }
  const mgbSet = new Set(((mgbRows ?? []) as { character: string }[])
    .map(r => String(r.character || '').toLowerCase())
    .filter(Boolean));
  const meDiscordId = memberRow?.discord_id ?? null;

  // EQ corpses ("<Owner>'s corpse1234") register as live characters — drop them.
  const liveClean   = ((liveRows ?? []) as LiveStateRow[]).filter(r => !isCorpse(r.character));
  const rosterClean = ((rosterRows ?? []) as RosterRow[]).filter(r => !isCorpse(r.name));

  // ── Concurrent-raid clustering ─────────────────────────────────────────────
  // raid_roster now holds one SNAPSHOT per uploader (pk guild,uploader,name).
  // Snapshots sharing any member are the same raid; disjoint snapshots are
  // separate raids running at once (the Dafeet/Utoh "Raid 2" report). Union-
  // find over uploaders via shared members → cluster ordinals, biggest first.
  const snapsByUploader = new Map<string, RosterRow[]>();
  for (const r of rosterClean) {
    const up = String(r.uploaded_by_discord_id || '');
    if (!snapsByUploader.has(up)) snapsByUploader.set(up, []);
    snapsByUploader.get(up)!.push(r);
  }
  const uploaders = [...snapsByUploader.keys()];
  const clusterOf = new Map<string, number>(uploaders.map((u, i) => [u, i]));
  const memberFirstUp = new Map<string, string>();
  for (const [up, rws] of snapsByUploader) {
    for (const r of rws) {
      const m = r.name.toLowerCase();
      const other = memberFirstUp.get(m);
      if (other == null) { memberFirstUp.set(m, up); continue; }
      const a = clusterOf.get(up)!, b = clusterOf.get(other)!;
      if (a !== b) for (const [u2, c] of clusterOf) if (c === a) clusterOf.set(u2, b);
    }
  }
  // Cluster id → ordinal (0-based), ordered by member count desc so "Raid 1"
  // is the big one. memberRaidIdx: member(lower) → ordinal.
  const clusterMembers = new Map<number, Set<string>>();
  for (const [up, rws] of snapsByUploader) {
    const c = clusterOf.get(up)!;
    if (!clusterMembers.has(c)) clusterMembers.set(c, new Set());
    for (const r of rws) clusterMembers.get(c)!.add(r.name.toLowerCase());
  }
  const ordered = [...clusterMembers.entries()].sort((a, b) => b[1].size - a[1].size);
  const ordinalOf = new Map<number, number>(ordered.map(([c], i) => [c, i]));
  const memberRaidIdx = new Map<string, number>();
  for (const [c, members] of clusterMembers) {
    for (const m of members) memberRaidIdx.set(m, ordinalOf.get(c)!);
  }

  // Per-member freshest row across snapshots. The freshest row wins membership
  // (group, rank, level), but HP backfills from the freshest row that actually
  // HAS hp_pct — older agents (and out-of-group uploaders) send null hp, and
  // letting a null-hp snapshot win outright makes HP flicker between refreshes.
  const rosterByName = new Map<string, RosterRow>();
  const hpByName = new Map<string, RosterRow>();
  for (const r of rosterClean) {
    const k = r.name.toLowerCase();
    const prev = rosterByName.get(k);
    if (!prev || String(r.captured_at || '') > String(prev.captured_at || '')) rosterByName.set(k, r);
    if (r.hp_pct != null) {
      const ph = hpByName.get(k);
      if (!ph || String(r.captured_at || '') > String(ph.captured_at || '')) hpByName.set(k, r);
    }
  }
  for (const [k, r] of rosterByName) {
    if (r.hp_pct == null && hpByName.has(k)) r.hp_pct = hpByName.get(k)!.hp_pct;
  }
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

  // ── Spell-catalog decode for every buff name in play ───────────────────────
  // One batched eqemu_spells lookup; raw effect slots give AUTHORITATIVE
  // per-school resist values (SPA 46 FR / 47 CR / 48 PR / 49 DR / 50 MR) —
  // the keyword guesses had Circle of Seasons covering all five schools when
  // it's fire+cold only. Also decodes CHA (SPA 10 with base>0 — base 0 is the
  // ubiquitous placeholder slot) for the Divine-Intervention-needs-Charisma
  // tank check (DI's death save rolls against CHA).
  const RESIST_SPA: Record<number, ResistType> = { 46: 'FR', 47: 'CR', 48: 'PR', 49: 'DR', 50: 'MR' };
  // Slot-1 collision rules can't be derived from the dump reliably (Shadoo
  // and White Petals share the same placeholder-then-resist shape but only
  // the flowers stack) — curated per the in-game stacking behavior.
  const STACKING_RESIST = ['aura of white petals', 'aura of green petals'];
  type SpellMeta = { resists: Partial<Record<ResistType, number>>; cha: boolean };
  const spellMeta = new Map<string, SpellMeta>();
  {
    const allNames = [...new Set(
      liveClean.flatMap(r => (r.buffs ?? []).map(b => b?.name).filter(Boolean) as string[]),
    )];
    if (allNames.length) {
      const { data: spellRows } = await admin
        .from('eqemu_spells')
        .select('name, raw')
        .in('name', allNames);
      for (const sp of (spellRows ?? []) as { name: string; raw: { eff: (number | null)[]; base: (number | null)[] } | null }[]) {
        if (!sp.raw || !Array.isArray(sp.raw.eff)) continue;
        const meta: SpellMeta = spellMeta.get(sp.name.toLowerCase()) ?? { resists: {}, cha: false };
        for (let i = 0; i < sp.raw.eff.length; i++) {
          const effId: number | null = sp.raw.eff[i];
          const base = sp.raw.base?.[i] ?? 0;
          const school = effId != null ? RESIST_SPA[effId] : undefined;
          if (school && base > 0 && base > (meta.resists[school] ?? 0)) meta.resists[school] = base;
          if (effId === 10 && base > 0) meta.cha = true;
        }
        spellMeta.set(sp.name.toLowerCase(), meta);
      }
    }
  }

  type ResistEntry = { name: string; value: number | null; stacking: boolean };
  function bucketBuffs(buffs: { name: string; ticks: number | null; song?: boolean }[] | null) {
    const byCategory: Record<string, string[]> = {};
    const other: string[] = [];
    const resists: Record<ResistType, ResistEntry[]> = { MR: [], FR: [], CR: [], PR: [], DR: [] };
    const songs: { name: string; ticks: number | null }[] = [];
    let hasDI = false, chaCovered = false;
    for (const b of (buffs ?? [])) {
      if (!b || !b.name) continue;
      const lower = b.name.toLowerCase();
      if (isSongBuff(b.name, b.song)) songs.push({ name: b.name, ticks: b.ticks ?? null });
      if (lower.includes('divine intervention')) hasDI = true;
      const meta = spellMeta.get(lower);
      if (meta) {
        if (meta.cha) chaCovered = true;
        const stacking = STACKING_RESIST.some(k => lower.includes(k));
        for (const [school, value] of Object.entries(meta.resists) as [ResistType, number][]) {
          resists[school].push({ name: b.name, value, stacking });
        }
      } else {
        // Name missing from the catalog (rank suffixes, typo'd dumps) — fall
        // back to the keyword map with no value.
        for (const t of resistTypesFor(b.name)) resists[t].push({ name: b.name, value: null, stacking: false });
      }
      const cat = categorizeBuff(b.name);
      if (cat) (byCategory[cat] ||= []).push(b.name);
      else other.push(b.name);
      // Secondary credits — VoG/Bihli carry an ATK component beyond their
      // primary category, so "Attack — missing" doesn't lie about them.
      for (const sec of secondaryCategoriesFor(b.name)) {
        if (sec !== cat && !(byCategory[sec] ||= []).includes(b.name)) byCategory[sec].push(b.name);
      }
    }
    // Strongest first per school so the card leads with the real coverage.
    for (const school of Object.keys(resists) as ResistType[]) {
      resists[school].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    }
    return { byCategory, other, resists, songs, hasDI, chaCovered };
  }

  // Build rows: every roster member (or live-state character) gets one. Roster
  // wins for grouping; live state fills in buffs/zone.
  const liveByName = new Map<string, LiveStateRow>();
  for (const r of liveClean) {
    liveByName.set(r.character.toLowerCase(), r);
  }

  const seen = new Set<string>();
  const rows: RaidRow[] = [];

  // A character whose client logged someone else in (Mimic same-pid swap,
  // stamped within the last 6h) is shown parked with "(swapped to X)" even if
  // the Zeal raid window still lists their body in a group.
  const SWAP_FRESH_MS = 6 * 60 * 60 * 1000;
  const swapFor = (live: LiveStateRow | undefined): string | null => {
    if (!live?.swapped_to || !live.swapped_at) return null;
    return (Date.now() - new Date(live.swapped_at).getTime()) < SWAP_FRESH_MS ? live.swapped_to : null;
  };

  // 1. Roster members first (with or without live state).
  for (const [lower, rr] of rosterByName) {
    if (seen.has(lower)) continue;
    seen.add(lower);
    const live = liveByName.get(lower);
    const className = classFor(rr.name);
    const role = classToRole(className);
    // Non-Mimic raiders use observed buff_casts as the buff list — a group
    // V2 cast (Talisman of Epuration, Aegolism, …) creates one row per
    // target, so if a groupmate's Mimic caught the cast we know what
    // Arakhan got and when. Marked `inferred:true` so the UI can say
    // "from observed casts" rather than pretending it's Zeal-authoritative.
    const inferred = inferredBuffsByName.get(lower) ?? null;
    const buffsForRow: { name: string; ticks: number | null }[] = live?.buffs ?? (
      inferred ? inferred.map(i => ({ name: i.name, ticks: i.ticks })) : []
    );
    const { byCategory, other, resists, songs, hasDI, chaCovered } = bucketBuffs(buffsForRow);
    const hpSlots = analyzeHpSlots(buffsForRow.map(b => b?.name).filter(Boolean) as string[]);
    const isInferred = !live && !!(inferred && inferred.length);
    const noAgent = !live && !isInferred;
    const swappedTo = swapFor(live);
    rows.push({
      name: rr.name,
      className,
      role,
      raidGroup: swappedTo ? null : (rr.group_num ?? null),
      raidIdx: swappedTo ? null : (memberRaidIdx.get(lower) ?? null),
      level: rr.level ?? null,
      rank: rr.rank ?? null,        // '2' raid leader, '1' group leader, else member
      inRaid: !swappedTo,
      swappedTo,
      noAgent,
      zone: live?.zone_name ?? null,
      updatedAt: live?.updated_at ?? null,
      // HP%: roster broadcast (any Mimic raider in this person's group) wins;
      // own-self HP from character_live_state fills in when this raider runs
      // Mimic themselves and their group has no other broadcaster yet.
      hpPct: rr.hp_pct ?? live?.self_hp_pct ?? null,
      buffCount: live?.buff_count ?? buffsForRow.length,
      byCategory,
      other,
      resists,
      songs,
      hasDI,
      chaCovered,
      hpSlots,
      tier: colorTier(role, byCategory, hpSlots, buffsForRow, noAgent),
      buffs: buffsForRow,
      pet: petFor(live),
      isMe: !!(meDiscordId && discordIdFor(rr.name) === meDiscordId),
      isInferred,
      hasMgb: mgbSet.has(lower) || undefined,
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
    const { byCategory, other, resists, songs, hasDI, chaCovered } = bucketBuffs(r.buffs);
    const hpSlots = analyzeHpSlots((r.buffs ?? []).map(b => b?.name).filter(Boolean) as string[]);
    rows.push({
      name: r.character,
      className,
      role,
      raidGroup: null,
      raidIdx: null,
      level: null,
      rank: null,
      inRaid: false,
      swappedTo: swapFor(r),
      noAgent: false,
      zone: r.zone_name,
      updatedAt: r.updated_at,
      hpPct: r.self_hp_pct ?? null,
      buffCount: r.buff_count ?? (r.buffs?.length ?? 0),
      byCategory,
      other,
      resists,
      songs,
      hasDI,
      chaCovered,
      hpSlots,
      tier: colorTier(role, byCategory, hpSlots, r.buffs, false),
      buffs: r.buffs ?? [],
      pet: petFor(r),
      isMe: !!(meDiscordId && discordIdFor(r.character) === meDiscordId),
      hasMgb: mgbSet.has(lower) || undefined,
    });
  }

  // Damage-shield magnitudes — decode SPA 59 from eqemu_spells.raw for every
  // DS buff seen across the raid, so the card can show "+14" per slot instead
  // of just the name. Buff-window names match spell names; when several ranks
  // share a name we take the largest (annotated as the catalog max).
  const dsNames = [...new Set(rows.flatMap(r => r.byCategory.ds ?? []))];
  const dsValues: Record<string, number> = {};
  if (dsNames.length) {
    const { data: dsSpells } = await admin
      .from('eqemu_spells')
      .select('name, raw')
      .in('name', dsNames);
    for (const sp of (dsSpells ?? []) as { name: string; raw: { eff: (number | null)[]; base: (number | null)[] } | null }[]) {
      if (!sp.raw || !Array.isArray(sp.raw.eff)) continue;
      for (let i = 0; i < sp.raw.eff.length; i++) {
        if (sp.raw.eff[i] !== 59) continue;     // SPA 59 = damage shield
        const v = Math.abs(sp.raw.base?.[i] ?? 0);
        if (v > (dsValues[sp.name] ?? 0)) dsValues[sp.name] = v;
      }
    }
  }

  // Tab labels per raid cluster — "Raid 1 — <leader> (N)" when the Zeal rank
  // marks a leader, else just the ordinal + size.
  const raidLabels: string[] = ordered.map(([c], i) => {
    const members = clusterMembers.get(c)!;
    let leaderName: string | null = null;
    for (const m of members) {
      const rr = rosterByName.get(m);
      if (rr && rr.rank === '2') { leaderName = rr.name; break; }
    }
    return 'Raid ' + (i + 1) + (leaderName ? ' — ' + leaderName : '') + ' (' + members.size + ')';
  });

  // The signed-in user's class as they appear in the current raid (if any) —
  // used as the default Buffer-mode class. They can override.
  const myInRaid = rows.find(r => r.inRaid && r.isMe) || rows.find(r => r.isMe);
  const myClass  = myInRaid?.className || null;

  // Headline counters (leader, coverage, group leads) are computed in
  // RaidView per ACTIVE raid tab now that concurrent raids stay separate.
  return (
    <RaidView
      rows={rows}
      raidLabels={raidLabels}
      myClass={myClass}
      dsValues={dsValues}
    />
  );
}
