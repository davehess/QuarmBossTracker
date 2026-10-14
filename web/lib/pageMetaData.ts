// The routes whose link card needs ONE small database read to name itself (the guild lead, 2026-10-10:
// "all links from our site should include at least top level information and the page name").
//
// pageMeta.ts answers everything it can from the URL alone and says which routes need more (`lookupFor`).
// This is the only place those reads happen. Two callers share it, so a card and a browser tab can never
// disagree: /api/embed-meta (the anonymous crawler behind Discord's unfurl) and the dynamic pages'
// generateMetadata.
//
// ⚠ PRIVACY: the crawler is anonymous. Every read here selects the fewest columns that can name the page,
// and every value goes through a closed vocabulary or a name cleaner in pageMeta.ts before it reaches a card:
//   feedback  -> ref, category, status. NEVER message, notes, submitter, screenshots or replies: a report is
//                private to its submitter and officers.
//   catalog   -> `name` of an item / spell / NPC / faction / recipe / boss. Game data, not guild data.
//   guide     -> the boss's display name.
//   bard set  -> the set's name, from the public JSON the page itself serves.
// Nothing about a parse, a character or a member is read at all. Every failure falls back to the generic
// card from pageMeta.ts: an unfurl is never worth an error, and this runs for logged-out crawlers.

import { metaForPath, lookupFor, feedbackMeta, entityMeta, type PageMeta } from './pageMeta';

type Row = Record<string, unknown>;
// The slice of the Supabase client used here, so a test can hand in a recording stub.
export type MetaDb = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string | number): { maybeSingle(): PromiseLike<{ data: Row | null }> };
    };
  };
};

const CATALOG_TABLE = {
  item:    'eqemu_items',
  spell:   'eqemu_spells',
  npc:     'eqemu_npc_types',
  faction: 'eqemu_faction_list_full',
  recipe:  'eqemu_tradeskill_recipe',
  boss:    'eqemu_npc_types',
} as const;

async function bardSetName(id: string): Promise<string | null> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const dir = path.join(process.cwd(), 'public', 'bards', 'sets');
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')) as { sets: { file: string }[] };
  for (const entry of manifest.sets) {
    try {
      const set = JSON.parse(await fs.readFile(path.join(dir, entry.file), 'utf8')) as { id?: string; name?: string };
      if (set.id === id) return set.name ?? null;
    } catch { /* one unreadable file does not hide the rest */ }
  }
  return null;
}

// What a dynamic page's generateMetadata returns: the same words the crawler card carries, so the browser tab
// and the Discord card cannot drift. Callers pass `encodeURIComponent(param)`, so a stray "/" in a param cannot become a path.
export async function pageMetadata(path: string): Promise<{ title: string; description: string }> {
  const { title, description } = await metaForPathWithData(path);
  return { title, description };
}

export async function metaForPathWithData(rawPath: string, db?: MetaDb): Promise<PageMeta> {
  const base = metaForPath(rawPath);
  const look = lookupFor(rawPath);
  if (!look) return base;
  try {
    if (look.kind === 'bardset') {
      const name = await bardSetName(look.id);
      return name ? entityMeta('bardset', name) : base;
    }
    const sb = db ?? ((await import('./supabase')).supabaseAdmin() as unknown as MetaDb);
    if (look.kind === 'feedback') {
      const { data } = await sb.from('feedback').select('ref, category, status').eq('ref', look.ref).maybeSingle();
      return data
        ? feedbackMeta(look.ref, (data.category as string | null) ?? null, (data.status as string | null) ?? null)
        : feedbackMeta(look.ref);
    }
    if (look.kind === 'guide') {
      const { data } = await sb.from('bot_boards').select('name').eq('boss_id', look.id).maybeSingle();
      return data?.name ? entityMeta('guide', data.name) : base;
    }
    const { data } = await sb.from(CATALOG_TABLE[look.kind]).select('name').eq('id', look.id).maybeSingle();
    return data?.name ? entityMeta(look.kind, data.name) : base;
  } catch {
    return base;
  }
}
