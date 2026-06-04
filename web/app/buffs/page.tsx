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
  categorizeBuff, classToRole, CATEGORY_ORDER, type BuffCategory, type Role,
} from '@/lib/buffs';
import BuffsGrid, { type BuffRow } from './BuffsGrid';

export const dynamic = 'force-dynamic';

type LiveStateRow = {
  character: string;
  zone_name: string | null;
  buffs: { name: string; ticks: number | null }[] | null;
  buff_count: number | null;
  updated_at: string | null;
};

export default async function BuffsPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/buffs');

  const admin = supabaseAdmin();
  const [{ data: liveRows }, { data: charRows }] = await Promise.all([
    admin
      .from('character_live_state')
      .select('character, zone_name, buffs, buff_count, updated_at')
      .eq('guild_id', 'wolfpack')
      .order('updated_at', { ascending: false }),
    admin
      .from('characters')
      .select('name, class')
      .eq('guild_id', 'wolfpack'),
  ]);

  // name(lower) → class
  const classByName = new Map<string, string | null>(
    ((charRows ?? []) as { name: string; class: string | null }[])
      .map(c => [c.name.toLowerCase(), c.class]),
  );

  const rows: BuffRow[] = ((liveRows ?? []) as LiveStateRow[]).map(r => {
    const className = classByName.get(r.character.toLowerCase()) ?? null;
    const role: Role = classToRole(className);
    const byCategory: Record<string, string[]> = {};
    const other: string[] = [];
    for (const b of (r.buffs ?? [])) {
      if (!b || !b.name) continue;
      const cat = categorizeBuff(b.name);
      if (cat) (byCategory[cat] ||= []).push(b.name);
      else other.push(b.name);
    }
    return {
      name: r.character,
      className,
      role,
      zone: r.zone_name ?? null,
      updatedAt: r.updated_at ?? null,
      buffCount: r.buff_count ?? (r.buffs?.length ?? 0),
      byCategory,
      other,
    };
  });

  const categories = CATEGORY_ORDER as BuffCategory[];

  return <BuffsGrid rows={rows} categories={categories} />;
}
