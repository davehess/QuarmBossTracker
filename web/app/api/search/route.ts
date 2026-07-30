// Global search API — fans out a single query across characters, /who
// sightings, items, and spells, returning categorized results with deep
// links. Powers the site-wide search box in the header (components/
// GlobalSearch). Members-only: gated on a signed-in Supabase session.
//
// v1 scope (Uilnayar 2026-06-22 epic): characters (roster + everyone seen),
// items, spells. Bosses/parses/loot are fast-follows — the categorized shape
// here is built to extend (add a block, add a section in GlobalSearch).

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
  characters: SearchHit[];
  items:      SearchHit[];
  spells:     SearchHit[];
  npcs:       SearchHit[];
};

export async function GET(req: Request) {
  // Members-only — same gate as the rest of the site.
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const q = (new URL(req.url).searchParams.get('q') || '').trim();
  if (q.length < 2) {
    return NextResponse.json({ characters: [], items: [], spells: [], npcs: [] } as SearchResults);
  }

  const admin = supabaseAdmin();
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const PER = 6;

  const [chars, who, items, spells, npcs] = await Promise.all([
    // Guild roster characters — the most authoritative "who is this".
    admin.from('characters')
      .select('name, class, main_name, opendkp_id')
      .eq('guild_id', 'wolfpack')
      .ilike('name', like)
      .limit(PER),
    // Everyone ever /who'd (covers non-members + un-rostered alts).
    admin.from('who_directory')
      .select('character, observed_class, level, guild_name')
      .ilike('character', like)
      .order('obs_count', { ascending: false })
      .limit(PER * 2),
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

  // Characters — roster first, then /who names not already in the roster.
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
  for (const w of (who.data ?? []) as { character: string; observed_class: string | null; level: number | null; guild_name: string | null }[]) {
    const k = (w.character || '').toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    characters.push({
      label: w.character,
      sub: [w.level ? `L${w.level}` : null, w.observed_class, w.guild_name].filter(Boolean).join(' · ') || 'seen in /who',
      href: `/character/${encodeURIComponent(w.character)}`,
    });
    if (characters.length >= PER * 2) break;
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

  return NextResponse.json({ characters, items: itemsOut, spells: spellsOut, npcs: npcsOut } as SearchResults);
}
