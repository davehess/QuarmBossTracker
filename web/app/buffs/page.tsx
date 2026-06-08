// Guild Buffs page — at-a-glance buff coverage so buffers can see who's missing
// what. Data is each character's CURRENT buff list from character_live_state
// (synced by the local agent's Zeal feed; see /api/agent/live-state). We bucket
// buffs into categories (HP, haste, DS, …) and compare against per-role target
// profiles so gaps light up red.
//
// ⚠️ Accuracy depends entirely on members running the local agent with Zeal.
// Anyone not running it simply won't appear, and a blank cell means "we don't
// know," not "definitely missing." The caveat banner says so up top.

import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import {
  categorizeBuff, classToRole, analyzeHpSlots, CATEGORY_ORDER, isCorpse,
  type BuffCategory, type Role,
} from '@/lib/buffs';
import BuffsGrid, { type BuffRow } from './BuffsGrid';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

type PetBuff = { name: string; remaining_secs: number | null; total_secs: number | null; good: number | null };
type LiveStateRow = {
  character: string;
  zone_name: string | null;
  buffs: { name: string; ticks: number | null }[] | null;
  buff_count: number | null;
  pet_name: string | null;
  pet_hp_pct: number | null;
  pet_buffs: PetBuff[] | null;
  updated_at: string | null;
};

export default async function BuffsPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/buffs');

  // Raid members refreshed within this window count as "currently in the raid".
  // The agent re-uploads the roster on change + a 60s heartbeat, so 15 min
  // comfortably tolerates brief gaps while ageing out people who've left.
  const ROSTER_FRESH_MS = 15 * 60 * 1000;
  const rosterSince = new Date(Date.now() - ROSTER_FRESH_MS).toISOString();

  const admin = supabaseAdmin();
  const [{ data: liveRows }, { data: charRows }, { data: rosterRows }] = await Promise.all([
    admin
      .from('character_live_state')
      .select('character, zone_name, buffs, buff_count, pet_name, pet_hp_pct, pet_buffs, updated_at')
      .eq('guild_id', 'wolfpack')
      .order('updated_at', { ascending: false }),
    admin
      .from('characters')
      .select('name, class')
      .eq('guild_id', 'wolfpack'),
    admin
      .from('raid_roster')
      .select('name, class, group_num, level, captured_at')
      .eq('guild_id', 'wolfpack')
      .gte('captured_at', rosterSince),
  ]);

  // EQ corpses ("<Owner>'s corpse1234") register as live characters — drop them.
  const liveClean   = ((liveRows ?? []) as LiveStateRow[]).filter(r => !isCorpse(r.character));

  // name(lower) → roster entry (group + live Zeal class) for current raid members.
  type RosterRow = { name: string; class: string | null; group_num: number | null };
  const rosterByName = new Map<string, RosterRow>(
    ((rosterRows ?? []) as RosterRow[])
      .filter(r => !isCorpse(r.name))
      .map(r => [r.name.toLowerCase(), r]),
  );

  // name(lower) → class. Prefer the OpenDKP roster class (authoritative), fall
  // back to the live Zeal class from the raid roster for anyone not yet in the
  // characters table.
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

  // Build a row per character that has live buff state.
  const liveByName = new Map<string, LiveStateRow>();
  const rows: BuffRow[] = liveClean.map(r => {
    liveByName.set(r.character.toLowerCase(), r);
    const className = classFor(r.character);
    const { byCategory, other } = bucketBuffs(r.buffs);
    const hpSlots = analyzeHpSlots((r.buffs ?? []).map(b => b?.name).filter(Boolean) as string[]);
    // name(lower) → remaining ticks, so the grid can show + tone each buff's
    // time-left without re-threading the whole buffs array through the row.
    const buffTicks: Record<string, number | null> = {};
    for (const b of (r.buffs ?? [])) if (b?.name) buffTicks[b.name.toLowerCase()] = b.ticks ?? null;
    return {
      name: r.character,
      className,
      role: classToRole(className),
      zone: r.zone_name ?? null,
      updatedAt: r.updated_at ?? null,
      buffCount: r.buff_count ?? (r.buffs?.length ?? 0),
      byCategory,
      other,
      hpSlots,
      buffTicks,
      raidGroup: rosterByName.get(r.character.toLowerCase())?.group_num ?? null,
      inRaid: rosterByName.has(r.character.toLowerCase()),
      pet: r.pet_name
        ? { name: r.pet_name, hpPct: r.pet_hp_pct ?? null, buffs: (r.pet_buffs ?? []).filter(b => b && b.name) }
        : null,
    };
  });

  // Add raid members who are in the roster but have NO live buff state (not
  // running the agent). They still belong on the raid grid as "buffs unknown"
  // so a buffer can see the whole group, not just the agent-runners.
  for (const [lower, rr] of rosterByName) {
    if (liveByName.has(lower)) continue;
    const className = classFor(rr.name);
    rows.push({
      name: rr.name,
      className,
      role: classToRole(className),
      zone: null,
      updatedAt: null,
      buffCount: 0,
      byCategory: {},
      other: [],
      hpSlots: { A: null, B: null, C: null },
      raidGroup: rr.group_num ?? null,
      inRaid: true,
      noAgent: true,
    });
  }

  // HP is shown as the three dedicated HP-slot columns, so drop it from the
  // category column set.
  const categories = (CATEGORY_ORDER as BuffCategory[]).filter(c => c !== 'hp');

  return (
    <div className="space-y-3">
      {/* Promote the next-gen /raid view (stage-1 mockup). The classic grid
          below stays so the old workflow is unbroken until /raid catches up. */}
      <Link
        href="/raid"
        className="block bg-panel border border-orange/40 rounded-lg p-3 text-xs hover:border-orange transition-colors no-underline"
      >
        <span className="text-orange">🛠️ New: </span>
        <span className="text-text">
          <code className="text-blue">/raid</code> — operational raid view (grouped, leader-aware, tiered triage, click-into-character).
        </span>
        <span className="text-dim"> Stage-1 mockup; this <code>/buffs</code> page stays as the classic grid.</span>
        <span className="text-blue ml-1">→</span>
      </Link>
      <BuffsGrid rows={rows} categories={categories} />
    </div>
  );
}
