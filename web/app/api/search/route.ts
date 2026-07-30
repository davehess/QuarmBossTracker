// Global search API — powers the site-wide search box in the header
// (components/GlobalSearch). Members-only: gated on a signed-in Supabase
// session. The categorized shape is built to extend (add a block here, add a
// section in GlobalSearch).
//
// TIERED + LAZY (2026-07-30). /who sightings used to be merged into the same
// `characters` list as the guild roster, and there are ~107k who_observations
// against ~470 roster characters — so any half-common substring buried the
// people and things you actually wanted under a wall of strangers.
//
// Now:
//   Tier 1 (always, in parallel) — guild roster, then the catalog
//                                  (items / mobs / spells).
//   Tier 2 (ONLY when tier 1 came back thin) — /who sightings, in their own
//                                  trailing category.
//
// The laziness is the point: a search that already found a guildmate or an item
// never touches the /who table at all, which keeps both the result list and the
// query cost down. Searching for an actual stranger still works — tier 1 comes
// back empty, so tier 2 fires.

import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export type SearchHit = {
  label:   string;
  sub?:    string;
  href:    string;
  external?: boolean;
};
export type SearchResults = {
  characters: SearchHit[];   // guild roster only
  items:      SearchHit[];
  npcs:       SearchHit[];
  spells:     SearchHit[];
  who:        SearchHit[];   // tier 2 — /who sightings, only when tier 1 is thin
};

const EMPTY_RESULTS: SearchResults = { characters: [], items: [], npcs: [], spells: [], who: [] };

export async function GET(req: Request) {
  // Members-only — same gate as the rest of the site.
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const q = (new URL(req.url).searchParams.get('q') || '').trim();
  if (q.length < 2) {
    return NextResponse.json(EMPTY_RESULTS);
  }

  const admin = supabaseAdmin();
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const PER = 6;
  // Below this many tier-1 hits we go looking in /who. At or above it the
  // dropdown is already full of better answers and the stranger list would only
  // push them off screen.
  const WHO_THRESHOLD = PER;

  const [chars, items, spells, npcs] = await Promise.all([
    // Guild roster characters — the most authoritative "who is this".
    admin.from('characters')
      .select('name, class, main_name, opendkp_id')
      .eq('guild_id', 'wolfpack')
      .ilike('name', like)
      .limit(PER),
    admin.from('eqemu_items')
      .select('id, name')
      .ilike('name', like)
      .limit(PER),
    admin.from('eqemu_spells')
      .select('id, name')
      .ilike('name', like)
      .limit(PER),
    // Mobs. EQEmu stores names underscored ("Lord_Nagafen"), so match the
    // underscored form too — a raider types "Lord Nagafen".
    admin.from('eqemu_npc_types')
      .select('id, name, level')
      .or(`name.ilike.${like},name.ilike.${like.replace(/ /g, '_')}`)
      .order('level', { ascending: false })
      .limit(PER),
  ]);

  // Tier 1a — guild roster. These are OUR people; they always come first.
  const seen = new Set<string>();
  const characters: SearchHit[] = [];
  for (const c of (chars.data ?? []) as { name: string; class: string | null; main_name: string | null }[]) {
    const k = c.name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    characters.push({
      label: c.name,
      sub: [c.class, c.main_name && c.main_name !== c.name ? `alt of ${c.main_name}` : 'Wolf Pack'].filter(Boolean).join(' · '),
      href: `/character/${encodeURIComponent(c.name)}`,
    });
  }

  // Catalog hits now resolve to OUR pages (wpqdi) instead of opening pqdi.cc in
  // a new tab. The dropdown carries a single href per hit so it has to pick one,
  // and ours is the default now — each /db page still links out to PQDI for
  // anyone who wants to compare. Internal hrefs also route client-side, so the
  // jump is instant instead of a cold third-party tab.
  const itemsOut: SearchHit[] = ((items.data ?? []) as { id: number; name: string }[])
    .map(i => ({
      label: i.name,
      sub: `item #${i.id}`,
      href: `/db/item/${i.id}`,
    }));

  const spellsOut: SearchHit[] = ((spells.data ?? []) as { id: number; name: string }[])
    .map(s => ({
      label: s.name,
      sub: `spell #${s.id}`,
      href: `/db/spell/${s.id}`,
    }));

  const npcsOut: SearchHit[] = ((npcs.data ?? []) as { id: number; name: string; level: number | null }[])
    .map(n => ({
      label: String(n.name || '').replace(/_/g, ' ').trim() || `NPC #${n.id}`,
      sub: n.level ? `L${n.level} mob` : 'mob',
      href: `/db/npc/${n.id}`,
    }));

  // ── Tier 2 (LAZY) — /who sightings ────────────────────────────────────────
  // Only reached when tier 1 didn't already answer the question. Skipping this
  // is the whole point: ~107k who_observations vs ~470 roster characters means
  // an unconditional query drowns every real hit in strangers.
  const tier1 = characters.length + itemsOut.length + npcsOut.length + spellsOut.length;
  let whoOut: SearchHit[] = [];
  if (tier1 < WHO_THRESHOLD) {
    const { data: whoData } = await admin.from('who_directory')
      .select('character, observed_class, level, guild_name')
      .ilike('character', like)
      .order('obs_count', { ascending: false })
      .limit(PER);
    for (const w of (whoData ?? []) as { character: string; observed_class: string | null; level: number | null; guild_name: string | null }[]) {
      const k = (w.character || '').toLowerCase();
      if (!k || seen.has(k)) continue;   // never repeat someone already on the roster
      seen.add(k);
      whoOut.push({
        label: w.character,
        sub: [w.level ? `L${w.level}` : null, w.observed_class, w.guild_name].filter(Boolean).join(' · ') || 'seen in /who',
        href: `/character/${encodeURIComponent(w.character)}`,
      });
    }
  }

  return NextResponse.json({
    characters, items: itemsOut, npcs: npcsOut, spells: spellsOut, who: whoOut,
  } as SearchResults);
}
