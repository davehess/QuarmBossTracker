// 2026-11-10: the agent now reports loot it SEES others take ("--<Name> has looted ...--", the guild lead: "it should also
// capture X has looted lines"). Several group members, and the looter's own Mimic, can report one loot; their clocks
// differ by seconds. The bot keeps the first report and drops another uploader's within 20 s. Real source, sliced and run.
import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';
import path from 'node:path';

const bot = readSource(path.join(ROOT, 'index.js'));
const block = sliceBlock(bot, 'const _LOOT_SAME_MS = 20000;', '\nasync function _handleAgentLooted(req, res) {')
  .replace(/async function _handleAgentLooted\(req, res\) \{$/, '');   // sliceBlock keeps its end marker
const { _dropAlreadyReportedLoot } = evalBlock(block, ['_dropAlreadyReportedLoot']);

const T = Date.parse('2026-11-09T04:34:01Z');
const iso = (ms) => new Date(T + ms).toISOString();
const row = (over = {}) => ({ looter_lower: 'brackwyn', item_name: 'Essence of Fire', looted_at: iso(0), uploaded_by_discord_id: 'u1', ...over });

describe('dropping a loot another uploader already reported', () => {
  it('a second witness 6 s off is dropped; a far one and a different item are kept', () => {
    const existing = [row({ uploaded_by_discord_id: 'u2', looted_at: iso(6000) })];
    expect(_dropAlreadyReportedLoot([row()], existing)).toEqual([]);
    expect(_dropAlreadyReportedLoot([row({ looted_at: iso(40000) })], existing)).toHaveLength(1);   // 34 s from it
    expect(_dropAlreadyReportedLoot([row({ item_name: 'Essence of Water' })], existing)).toHaveLength(1);
  });
  it('the same uploader is never collapsed by the window (real repeat loots of a stackable)', () => {
    const existing = [row({ looted_at: iso(3000) })];
    expect(_dropAlreadyReportedLoot([row()], existing)).toHaveLength(1);
  });
  it('the handler marks witnessed rows and reads nearby rows before storing', () => {
    const h = stripJs(sliceBlock(bot, 'async function _handleAgentLooted(req, res) {', "res.end(JSON.stringify({ ok: true, stored: rows.length }));"));
    expect(h).toContain("source:                 e?.witnessed === true ? 'local_agent_witnessed' : 'local_agent_v1',");
    expect(h).toContain('const kept = _dropAlreadyReportedLoot(rows, existing);');
    expect(h.indexOf('_dropAlreadyReportedLoot(rows, existing)')).toBeLessThan(h.indexOf("supabase.upsert('looted_items'"));
  });
});
