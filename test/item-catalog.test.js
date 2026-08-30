// GET /api/agent/item-catalog — the wishlist picker's local universe.
//
// Hitya asked what syncing the item list down would cost before agreeing to it,
// so the numbers are part of the contract, not trivia:
//   11,099 rows · ~380 kB JSON · ~130 kB gzipped · ~16 players · source moves
//   weekly ⇒ ~2 MB/week egress, 304 on every other startup.
// The two things that keep it that cheap are the TTL and the ETag. Both are
// asserted here because both are one-character changes away from costing 20×.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { BOT_INDEX, readSource, sliceBlock } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const handler = sliceBlock(src, 'async function _handleAgentItemCatalog(req, res)', '\n}');
const ROOT = path.dirname(BOT_INDEX);

describe('item catalog endpoint', () => {
  it('caches for 12h, not the spell catalog\'s 1h', () => {
    // The source table only changes on the weekly sync. At a 1h TTL a full miss
    // cycle re-reads 380 kB 24×/day; at 12h it is twice.
    const ttl = src.match(/const _ITEM_CATALOG_TTL_MS = ([^;]+);/);
    expect(ttl).toBeTruthy();
    const ms = Function(`return ${ttl[1]}`)();
    expect(ms).toBeGreaterThanOrEqual(12 * 60 * 60 * 1000);
  });

  it('serves a 304 when the client already has this version', () => {
    // Without this every startup pays the full body instead of ~200 bytes.
    expect(handler).toMatch(/if-none-match/);
    expect(handler).toMatch(/res\.writeHead\(304/);
    expect(handler).toMatch(/ETag/);
  });

  it('sends rows as arrays, not objects', () => {
    // At 11k rows the repeated key names would be most of the payload.
    expect(handler).toMatch(/entries\.push\(\[r\.item_id, r\.item_name, r\.era\]\)/);
  });

  it('reads the view, so the era join stays in Postgres', () => {
    expect(handler).toMatch(/item_catalog_droppable/);
    expect(handler).toMatch(/offset=/);         // paged — the view is 11k rows
  });

  it('survives a Supabase failure instead of 500ing the fleet', () => {
    // An empty catalog degrades the picker to asking the server, which is how
    // it worked before this existed.
    expect(handler).toMatch(/catch \(err\)/);
    expect(handler).toMatch(/\[item-catalog\] fetch failed/);
  });

  it('is registered as a GET route', () => {
    expect(src).toMatch(/req\.url\.startsWith\('\/api\/agent\/item-catalog'\)/);
    expect(src).toMatch(/_handleAgentItemCatalog\(req, res\)/);
  });

  it('requires agent auth like every other agent endpoint', () => {
    expect(handler).toMatch(/requireAgentAuth/);
  });
});

describe('the migration that backs it', () => {
  const file = path.join(ROOT, 'supabase', 'migrations', '20260830142205_item_catalog_droppable_view.sql');
  // ⚠ Strip `--` comments before matching. This migration's header explains why
  // it does NOT key on bosses_local, and that explanation satisfied the
  // assertion checking bosses_local is absent. Fifth time in this session that
  // a comment has stood in for the code it describes — see CLAUDE.md.
  const sql = fs.readFileSync(file, 'utf8').replace(/^\s*--.*$/gm, '');

  it('is idempotent', () => {
    expect(sql).toMatch(/create or replace view/i);
  });

  it('includes Planes of Power by DROP TABLE, not by tracked boss', () => {
    // Hitya, 2026-08-30: PoP items must be wishlistable before the unlock. Only
    // 12 PoP bosses are registered (vs 407 Luclin) because that board is built
    // out after unlock — a boss-driven universe reached 113 of 1,212 PoP items.
    expect(sql).toMatch(/eqemu_npc_drops/);
    expect(sql).not.toMatch(/bosses_local/);
  });

  it('derives era from the dropping NPC\'s zone, the documented recipe', () => {
    // Items have no expansion column; id = zoneid*1000 + n is how era is known.
    expect(sql).toMatch(/z\.zone_id = \(d\.npc_id \/ 1000\)/);
    expect(sql).toMatch(/expansion/);
  });

  it('keeps an item that resolves to no zone rather than dropping it', () => {
    // 22 rows have no zone match; losing them would silently shrink the picker.
    expect(sql).toMatch(/left join eqemu_zone/i);
    expect(sql).toMatch(/nulls last/i);
  });

  it('is readable by the same audience as the mirrors it is built from', () => {
    expect(sql).toMatch(/grant select on item_catalog_droppable to anon, authenticated/);
  });
});
