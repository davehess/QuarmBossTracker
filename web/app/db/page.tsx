// /db — wpqdi hub + catalog search (guild-gated).
//
// The three detail routes (/db/item, /db/npc, /db/spell) shipped before this
// page existed, which meant the database had no front door: you could only
// reach it by clicking a link somewhere else, and /db itself was a 404.
//
// Plain server component with a GET form — no client JS. Searches the three
// catalog tables directly rather than going through /api/search, because that
// endpoint also fans out over characters and /who sightings, which aren't
// catalog data and would just be noise here.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { deUnderscore } from '@/lib/npcDecode';

// Per-page metadata so a link pasted into Discord unfurls as what it IS.
// Without this the page inherits the site-wide description and every
// shared link reads identically, which is what 68 of them used to do.
export const metadata = {
  title: 'Item & spell database',
  description:
    'Search every item, spell, NPC and faction on Project Quarm, with drop tables and where things come from.',
};

export const dynamic = 'force-dynamic';

const LIMIT = 40;

type ItemRow  = { id: number; name: string };
type SpellRow = { id: number; name: string };
type NpcRow   = { id: number; name: string | null; level: number | null; raid_target: boolean | null };

export default async function DbHubPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const term = (q || '').trim();

  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect(`/auth/signin?next=/db${term ? `?q=${encodeURIComponent(term)}` : ''}`);

  let items: ItemRow[] = [];
  let spells: SpellRow[] = [];
  let npcs: NpcRow[] = [];

  if (term.length >= 2) {
    const sb = supabaseAdmin();
    const like = `%${term.replace(/[%_]/g, '')}%`;
    // EQEmu underscores mob names ("Lord_Nagafen") — match that form too so a
    // raider can type the name the way it reads in game.
    const likeUnderscored = like.replace(/ /g, '_');
    const [itemRes, npcRes, spellRes] = await Promise.all([
      sb.from('eqemu_items').select('id, name').ilike('name', like).limit(LIMIT),
      sb.from('eqemu_npc_types').select('id, name, level, raid_target')
        .or(`name.ilike.${like},name.ilike.${likeUnderscored}`)
        .order('level', { ascending: false }).limit(LIMIT),
      sb.from('eqemu_spells').select('id, name').ilike('name', like).limit(LIMIT),
    ]);
    items  = (itemRes.data  ?? []) as ItemRow[];
    npcs   = (npcRes.data   ?? []) as NpcRow[];
    spells = (spellRes.data ?? []) as SpellRow[];
  }

  const total = items.length + npcs.length + spells.length;

  return (
    <div className="space-y-4 max-w-4xl">
      <section className="bg-panel border border-border rounded-lg p-4">
        <h1 className="text-xl text-gold">📚 Wolf Pack database</h1>
        <p className="text-sm text-dim mt-1">
          Items, mobs and spells straight from the game data we mirror each week — our own copy,
          so a PQDI outage doesn&apos;t stop a lookup mid-raid.
        </p>
        <form action="/db" method="get" className="mt-3 flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={term}
            placeholder="Item, mob or spell name…"
            autoFocus
            className="flex-1 bg-bg border border-border rounded px-3 py-1.5 text-sm text-text placeholder:text-dim focus:border-blue outline-none"
          />
          <button type="submit" className="px-3 py-1.5 rounded bg-blue/20 border border-blue/60 text-blue text-sm hover:bg-blue/30">
            Search
          </button>
        </form>
        {term.length === 1 && <p className="text-dim text-xs mt-2">Type at least two characters.</p>}
      </section>

      {term.length >= 2 && total === 0 && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <p className="text-dim text-sm">No items, mobs or spells match “{term}”.</p>
        </section>
      )}

      {npcs.length > 0 && (
        <ResultBlock title="🐲 Mobs" count={npcs.length} limit={LIMIT}>
          {npcs.map(n => (
            <Row key={n.id} href={`/db/npc/${n.id}`} label={deUnderscore(n.name) || `NPC #${n.id}`}>
              {n.raid_target ? <span className="text-red-400 text-[10px] uppercase mr-1.5">raid</span> : null}
              {n.level ? `L${n.level}` : '—'}
            </Row>
          ))}
        </ResultBlock>
      )}

      {items.length > 0 && (
        <ResultBlock title="🗡️ Items" count={items.length} limit={LIMIT}>
          {items.map(i => (
            <Row key={i.id} href={`/db/item/${i.id}`} label={i.name}>#{i.id}</Row>
          ))}
        </ResultBlock>
      )}

      {spells.length > 0 && (
        <ResultBlock title="✨ Spells" count={spells.length} limit={LIMIT}>
          {spells.map(s => (
            <Row key={s.id} href={`/db/spell/${s.id}`} label={s.name}>#{s.id}</Row>
          ))}
        </ResultBlock>
      )}
    </div>
  );
}

function ResultBlock({ title, count, limit, children }: {
  title: string; count: number; limit: number; children: React.ReactNode;
}) {
  return (
    <section className="bg-panel border border-border rounded-lg p-4">
      <h2 className="text-sm text-orange mb-2">
        {title} <span className="text-dim">({count}{count === limit ? '+' : ''})</span>
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 text-sm">{children}</div>
    </section>
  );
}

function Row({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="flex items-baseline justify-between gap-2 px-2 py-1 rounded hover:bg-[#1a212c]">
      <span className="text-text truncate">{label}</span>
      <span className="text-dim text-[10px] shrink-0">{children}</span>
    </Link>
  );
}
