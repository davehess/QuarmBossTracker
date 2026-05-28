// Item-link helper for chat rendering. Players link EQ items in chat by
// either pasting the in-game link (which carries 0x12 hex blob metadata
// and is resolved at agent-side parse time) or by typing the item name
// in prose. The agent strips link metadata for old logs, so by the time
// chat hits Supabase the text is the bare name — we have to recover the
// link on the read path.
//
// Approach: load every (name, id) from eqemu_items into an in-process Map,
// then scan chat text for case-sensitive multi-word matches. Multi-word
// requirement avoids false positives on single-word items that overlap
// with common English ("Cap", "Net", "Bow"). One-hour TTL on the cache
// since the catalog changes only on the weekly Quarm sync.
//
// Match algorithm: tokenize on whitespace, at every position try the
// longest-possible item-name match (up to 12 tokens — the catalog's max
// word count). Strip trailing sentence punctuation (",.;:?!)]}") off the
// last candidate token so "Trochilic's Skean," still resolves. The
// apostrophe inside Trochilic's is left intact because legitimate item
// names contain them.

import type { SupabaseClient } from '@supabase/supabase-js';

export type ItemCatalog = Map<string, number>; // exact-cased name → preferred id

const TTL_MS = 60 * 60 * 1000;
const PAGE   = 1000;             // PostgREST default per-request cap
const MAX_PAGES = 40;            // 40K rows ceiling; catalog is ~27K
let _cache: { at: number; map: ItemCatalog } | null = null;

export async function loadItemCatalog(sb: SupabaseClient): Promise<ItemCatalog> {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.map;

  const map: ItemCatalog = new Map();
  // Parallelize the page fetches — independent requests, no harm in firing
  // them at once. Cold-start cost drops from ~25 * RTT to ~RTT.
  const reqs: Promise<{ data: unknown; error: unknown }>[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    reqs.push(
      sb.from('eqemu_items')
        .select('name, id')
        .order('id', { ascending: true })
        .range(i * PAGE, (i + 1) * PAGE - 1) as unknown as Promise<{ data: unknown; error: unknown }>,
    );
  }
  const pages = await Promise.all(reqs);
  for (const p of pages) {
    const data = (p?.data || []) as { name: string | null; id: number | null }[];
    for (const row of data) {
      const name = (row.name || '').trim();
      const id   = row.id;
      if (!name || id == null) continue;
      // Multi-word requirement filters out single-word noise.
      if (!/\s/.test(name)) continue;
      // Skip names with brackets / colons that suggest internal markup.
      if (/[<>{}\[\]|]/.test(name)) continue;
      const prior = map.get(name);
      if (prior == null || id < prior) map.set(name, id);
    }
  }

  _cache = { at: Date.now(), map };
  return map;
}

// Linkify item names found in `text`. Returns an array of nodes where
// each node is either a plain string or `{ type: 'item', name, id }`.
// The caller wraps item nodes in their own JSX/<a>.
export type LinkNode =
  | { type: 'text'; value: string }
  | { type: 'item'; name: string; id: number };

const TRAILING_PUNCT = /[,.;:?!)\]}"]+$/;
const MAX_WORDS = 12;

export function linkifyItems(text: string, catalog: ItemCatalog): LinkNode[] {
  if (!text || catalog.size === 0) return [{ type: 'text', value: text }];

  // Token positions: split keeping whitespace so we can reconstruct text
  // cleanly between matches.
  const tokens: string[] = text.split(/(\s+)/);   // alternates word, space, word, space...
  const nodes: LinkNode[] = [];
  let plainBuf = '';

  const flushPlain = () => {
    if (plainBuf.length > 0) {
      nodes.push({ type: 'text', value: plainBuf });
      plainBuf = '';
    }
  };

  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    // Whitespace tokens always pass through to plainBuf.
    if (/^\s+$/.test(tk) || tk === '') { plainBuf += tk; continue; }

    // Try a match starting at this word token. Walk forward in steps of 2
    // (word, space, word, space, ...) up to MAX_WORDS words. Track the
    // best (longest) match found.
    let best: { endIdx: number; name: string; id: number } | null = null;
    let words = 0;
    let cursor = i;
    let assembled = '';

    while (cursor < tokens.length && words < MAX_WORDS) {
      const piece = tokens[cursor];
      if (cursor === i) {
        assembled = piece;
        words = 1;
      } else if (/^\s+$/.test(piece)) {
        // expect a space token between words
        if (cursor + 1 >= tokens.length) break;
        assembled += piece + tokens[cursor + 1];
        words += 1;
        cursor += 1; // we'll add another at end of loop
      } else {
        break; // unexpected non-space between words — bail
      }

      // Try with and without trailing sentence punctuation. Items can't
      // have a trailing comma/period/etc, so strip and re-check.
      const candidate = assembled.replace(TRAILING_PUNCT, '');
      const id = catalog.get(candidate);
      if (id != null) {
        best = { endIdx: cursor, name: candidate, id };
      }

      cursor += 1;
    }

    if (best) {
      flushPlain();
      nodes.push({ type: 'item', name: best.name, id: best.id });
      // Whatever was stripped (trailing comma, etc.) goes back to plain.
      const consumedRaw = tokens.slice(i, best.endIdx + 1).join('');
      const trailer     = consumedRaw.slice(best.name.length);
      if (trailer) plainBuf += trailer;
      i = best.endIdx; // for-loop's i++ then advances past the match
    } else {
      plainBuf += tk;
    }
  }
  flushPlain();
  return nodes;
}
