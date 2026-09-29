// Data for the PoP checklist's beta layouts (?v=b, ?v=c): each character's hand ticks plus the steps
// Mimic or our records already prove (web/lib/popGuideAuto.ts), and the zone outlines for the maps.
// Only the viewer's own characters; inventory is skipped for a character that hides it.

import { unstable_cache } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { GUIDE_ITEMS } from '@/lib/popGuide';
import { STEP_MORE, stepPlaces } from '@/lib/popGuideMore';
import { AUTO_ITEM_IDS, guideEvidence } from '@/lib/popGuideAuto';
import type { RouteChar } from './GuideRoute';
import type { ZoneOutline } from './ZoneMap';

type Owned = { name: string; class: string | null; main_name: string | null };

// A zone's outline never changes between syncs: one read per zone per day.
const zoneOutline = unstable_cache(
  async (zone: string) => {
    const { data } = await supabaseAdmin().rpc('zone_outline', { p_zone: zone });
    return (data && typeof data === 'object' ? data : null) as ZoneOutline | null;
  },
  ['pop-guide-zone-outline-v1'],
  { revalidate: 86400 },
);

export async function loadRoute(mine: Owned[]): Promise<{ chars: RouteChar[]; outlines: Record<string, ZoneOutline> }> {
  const names = mine.map(ch => ch.name);
  const lower = names.map(n => n.toLowerCase());
  const admin = supabaseAdmin();
  const none = Promise.resolve({ data: [] as unknown[] });
  const zones = [...new Set(GUIDE_ITEMS.flatMap(i => stepPlaces(i, STEP_MORE[i.key]).map(p => p.zone)))];

  const [ticks, flags, loots, inv, chars, who, live, ...outlineList] = await Promise.all([
    names.length ? admin.from('pop_guide_ticks').select('character_name, item_key').eq('guild_id', 'wolfpack').in('character_name', names) : none,
    names.length ? admin.from('pop_flags').select('character, flag_key, earned_at').neq('flag_key', 'unmapped')
      .or(names.map(n => `character.ilike.${n}`).join(',')).order('earned_at', { ascending: true }).limit(1000) : none,
    names.length ? admin.from('looted_items').select('looter_lower, item_name, looted_at').in('looter_lower', lower)
      .ilike('item_name', 'Mark of %').limit(200) : none,
    names.length ? admin.from('character_inventory').select('character_name, item_id, observed_at').in('character_name', names)
      .in('item_id', AUTO_ITEM_IDS).limit(1000) : none,
    names.length ? admin.from('characters').select('name, exclude_inventory, spellbook_checksum').in('name', names) : none,
    names.length ? admin.from('who_directory').select('character_key, level, last_seen').in('character_key', lower) : none,
    names.length ? admin.from('character_live_state').select('character, updated_at').in('character', names) : none,
    ...zones.map(z => zoneOutline(z)),
  ]);

  const rows = <T,>(r: { data: unknown }) => ((r.data ?? []) as T[]);
  const outlines: Record<string, ZoneOutline> = {};
  zones.forEach((z, n) => { const o = outlineList[n] as ZoneOutline | null; if (o) outlines[z] = o; });

  const out: RouteChar[] = mine.map(ch => {
    const lc = ch.name.toLowerCase();
    const meta = rows<{ name: string; exclude_inventory: boolean | null; spellbook_checksum: string | null }>(chars)
      .find(r => r.name.toLowerCase() === lc);
    const w = rows<{ character_key: string; level: number | null; last_seen: string | null }>(who).find(r => r.character_key === lc);
    const auto = guideEvidence({
      flags: rows<{ character: string; flag_key: string; earned_at: string | null }>(flags).filter(r => r.character.toLowerCase() === lc),
      loots: rows<{ looter_lower: string; item_name: string; looted_at: string | null }>(loots).filter(r => r.looter_lower === lc),
      inventory: meta?.exclude_inventory ? null
        : rows<{ character_name: string; item_id: number; observed_at: string | null }>(inv).filter(r => r.character_name.toLowerCase() === lc),
      level: w?.level ?? null,
      levelAt: w?.last_seen ?? null,
      spellbook: !!meta?.spellbook_checksum,
      liveAt: rows<{ character: string; updated_at: string }>(live).find(r => r.character.toLowerCase() === lc)?.updated_at ?? null,
    });
    return {
      name: ch.name,
      cls: ch.class,
      isMain: !ch.main_name || ch.main_name.toLowerCase() === lc,
      manual: rows<{ character_name: string; item_key: string }>(ticks).filter(r => r.character_name.toLowerCase() === lc).map(r => r.item_key),
      auto,
    };
  });
  return { chars: out, outlines };
}
