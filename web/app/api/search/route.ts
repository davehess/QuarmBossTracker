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
};

export async function GET(req: Request) {
  // Members-only — same gate as the rest of the site.
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const q = (new URL(req.url).searchParams.get('q') || '').trim();
  if (q.length < 2) {
    return NextResponse.json({ characters: [], items: [], spells: [] } as SearchResults);
  }

  const admin = supabaseAdmin();
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const PER = 6;

  const [chars, who, items, spells] = await Promise.all([
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

  const itemsOut: SearchHit[] = ((items.data ?? []) as { id: number; name: string }[])
    .map(i => ({
      label: i.name,
      sub: `item #${i.id}`,
      href: `https://www.pqdi.cc/item/${i.id}`,
      external: true,
    }));

  const spellsOut: SearchHit[] = ((spells.data ?? []) as { id: number; name: string }[])
    .map(s => ({
      label: s.name,
      sub: `spell #${s.id}`,
      href: `https://www.pqdi.cc/spell/${s.id}`,
      external: true,
    }));

  return NextResponse.json({ characters, items: itemsOut, spells: spellsOut } as SearchResults);
}
