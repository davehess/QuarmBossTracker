// One assist, many witnesses (the guild lead, 2026-09-27: "credit assists to guildmates our agents
// see"). Every raider running Mimic now reports the assists it SAW, so the same guildmate's
// assist arrives once per witness — each stamped off its own machine's clock, a second or two
// apart. dedup_key is per second and the /pvp leaderboard counts rows, so the bot collapses the
// same assister on the same victim within ±30 s.
//
// Run: npx vitest run test/pvp-assist-witness-dedupe.test.js

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const bot = readSource(BOT_INDEX);
const { _pvpAssistUnseen, _pvpAssistNeighbours } = evalBlock(
  sliceBlock(bot, 'const PVP_ASSIST_SAME_MS = 30_000;', '\n  return found;\n}'),
  ['_pvpAssistUnseen', '_pvpAssistNeighbours']);

// Invented names (none of them is anybody).
const row = (assister, victim, iso) => ({ assister, victim, killed_at: iso, dedup_key: `wolfpack|${assister}|${victim}|${iso}` });

describe('_pvpAssistUnseen', () => {
  it('another witness\'s row two seconds off is the same assist', () => {
    const existing = [{ assister: 'Brackwyn', victim: 'Velisblacksword', killed_at: '2026-09-26T05:20:47Z' }];
    expect(_pvpAssistUnseen([row('Brackwyn', 'Velisblacksword', '2026-09-26T05:20:49.000Z')], existing)).toEqual([]);
  });
  it('names compare without case', () => {
    const existing = [{ assister: 'brackwyn', victim: 'VELISBLACKSWORD', killed_at: '2026-09-26T05:20:47Z' }];
    expect(_pvpAssistUnseen([row('Brackwyn', 'Velisblacksword', '2026-09-26T05:20:47.000Z')], existing)).toEqual([]);
  });
  it('31 s apart is another death; another assister or victim is another assist', () => {
    const existing = [{ assister: 'Brackwyn', victim: 'Velisblacksword', killed_at: '2026-09-26T05:20:00Z' }];
    const fresh = [
      row('Brackwyn', 'Velisblacksword', '2026-09-26T05:20:31.000Z'),
      row('Rethlan', 'Velisblacksword', '2026-09-26T05:20:00.000Z'),
      row('Brackwyn', 'Jahpotheosis', '2026-09-26T05:20:00.000Z'),
    ];
    expect(_pvpAssistUnseen(fresh, existing)).toEqual(fresh);
  });
  it('two witnesses inside one upload collapse too', () => {
    const a = row('Brackwyn', 'Velisblacksword', '2026-09-26T05:20:47.000Z');
    const b = row('Brackwyn', 'Velisblacksword', '2026-09-26T05:20:48.000Z');
    expect(_pvpAssistUnseen([a, b], [])).toEqual([a]);
  });
});

describe('_pvpAssistNeighbours: read per fight, not one span', () => {
  // A replayed log can put months into one upload; one query over that span
  // would hit PostgREST's 1,000-row cap and miss rows.
  it('fights hours apart are read separately, each for its own victims ±30 s', async () => {
    const qs = [];
    const got = await _pvpAssistNeighbours([
      row('Brackwyn', 'Velisblacksword', '2026-09-26T05:20:00.000Z'),
      row('Rethlan', 'Jahpotheosis', '2026-09-26T09:00:00.000Z'),
      row('Brackwyn', 'Klep', '2026-09-26T05:25:00.000Z'),
    ], 'wolfpack', async (q) => { qs.push(decodeURIComponent(q)); return [{ q: qs.length }]; });
    expect(got).toEqual([{ q: 1 }, { q: 2 }]);
    expect(qs[0]).toContain('victim=in.("Velisblacksword","Klep")');
    expect(qs[0]).toContain('killed_at=gte.2026-09-26T05:19:30.000Z&killed_at=lte.2026-09-26T05:25:30.000Z');
    expect(qs[1]).toContain('victim=in.("Jahpotheosis")');
    expect(qs[1]).toContain('killed_at=gte.2026-09-26T08:59:30.000Z&killed_at=lte.2026-09-26T09:00:30.000Z');
    for (const q of qs) expect(q).toMatch(/&limit=1000$/);
  });
  it('a failed read is null, so the caller stores everything rather than guessing', async () => {
    expect(await _pvpAssistNeighbours([row('Brackwyn', 'Klep', '2026-09-26T05:20:00.000Z')], 'wolfpack', async () => null)).toBe(null);
  });
});

describe('the handler stores only unseen rows, one request at a time', () => {
  const h = stripJs(sliceBlock(bot, 'async function _handleAgentPvpAssists(req, res) {', '\n}\n'));
  it('reads the neighbours, filters, and upserts what is left', () => {
    expect(h).toMatch(/_pvpAssistWriteQ\.then\(async \(\) => \{[\s\S]*_pvpAssistNeighbours\(rows, guildId, \(q\) => supabase\.select\('pvp_assists', q\)\)[\s\S]*_pvpAssistUnseen\(rows, existing\)[\s\S]*supabase\.upsert\('pvp_assists', fresh, 'dedup_key'\)/);
    expect(h).toMatch(/_pvpAssistWriteQ = job\.catch\(/);
    expect(h).not.toMatch(/supabase\.upsert\('pvp_assists', rows,/);
  });
});
