// One assist, many witnesses (the guild lead, 2026-09-27: "credit assists to guildmates our agents
// see"). Every raider running Mimic now reports the assists it SAW, so the same guildmate's
// assist arrives once per witness — each stamped off its own machine's clock, a second or two
// apart. dedup_key is per second and the /pvp leaderboard counts rows, so the bot collapses the
// same assister on the same victim within ±30 s. A kill replayed from an old log gets the same
// check (23 duplicate kill pairs were measured in pvp_kills, every one from a log catch-up).
//
// Run: npx vitest run test/pvp-assist-witness-dedupe.test.js

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const bot = readSource(BOT_INDEX);
const { _pvpUnseen, _pvpNeighbours } = evalBlock(
  sliceBlock(bot, 'const PVP_SAME_MS = 30_000;', '\n  return found;\n}'),
  ['_pvpUnseen', '_pvpNeighbours']);

// Invented names (none of them is anybody).
const row = (assister, victim, iso) => ({ assister, victim, killed_at: iso, dedup_key: `wolfpack|${assister}|${victim}|${iso}` });

describe('_pvpUnseen', () => {
  it('another witness\'s row two seconds off is the same assist', () => {
    const existing = [{ assister: 'Brackwyn', victim: 'Velisblacksword', killed_at: '2026-09-26T05:20:47Z' }];
    expect(_pvpUnseen([row('Brackwyn', 'Velisblacksword', '2026-09-26T05:20:49.000Z')], existing)).toEqual([]);
  });
  it('names compare without case', () => {
    const existing = [{ assister: 'brackwyn', victim: 'VELISBLACKSWORD', killed_at: '2026-09-26T05:20:47Z' }];
    expect(_pvpUnseen([row('Brackwyn', 'Velisblacksword', '2026-09-26T05:20:47.000Z')], existing)).toEqual([]);
  });
  it('31 s apart is another death; another assister or victim is another assist', () => {
    const existing = [{ assister: 'Brackwyn', victim: 'Velisblacksword', killed_at: '2026-09-26T05:20:00Z' }];
    const fresh = [
      row('Brackwyn', 'Velisblacksword', '2026-09-26T05:20:31.000Z'),
      row('Rethlan', 'Velisblacksword', '2026-09-26T05:20:00.000Z'),
      row('Brackwyn', 'Jahpotheosis', '2026-09-26T05:20:00.000Z'),
    ];
    expect(_pvpUnseen(fresh, existing)).toEqual(fresh);
  });
  it('two witnesses inside one upload collapse too', () => {
    const a = row('Brackwyn', 'Velisblacksword', '2026-09-26T05:20:47.000Z');
    const b = row('Brackwyn', 'Velisblacksword', '2026-09-26T05:20:48.000Z');
    expect(_pvpUnseen([a, b], [])).toEqual([a]);
  });
  it('kills compare on the killer', () => {
    const kill = { killer: 'Brackwyn', victim: 'Velisblacksword', killed_at: '2026-09-26T05:20:49.000Z' };
    const existing = [{ killer: 'Brackwyn', victim: 'Velisblacksword', killed_at: '2026-09-26T05:20:47Z' }];
    expect(_pvpUnseen([kill], existing, 'killer')).toEqual([]);
    expect(_pvpUnseen([kill], [{ ...existing[0], killer: 'Rethlan' }], 'killer')).toEqual([kill]);
  });
});

describe('_pvpNeighbours: read per fight, not one span', () => {
  // A replayed log can put months into one upload; one query over that span
  // would hit PostgREST's 1,000-row cap and miss rows.
  it('fights hours apart are read separately, each for its own victims ±30 s', async () => {
    const qs = [];
    const got = await _pvpNeighbours([
      row('Brackwyn', 'Velisblacksword', '2026-09-26T05:20:00.000Z'),
      row('Rethlan', 'Jahpotheosis', '2026-09-26T09:00:00.000Z'),
      row('Brackwyn', 'Klep', '2026-09-26T05:25:00.000Z'),
    ], 'wolfpack', async (q) => { qs.push(decodeURIComponent(q)); return [{ q: qs.length }]; });
    expect(got).toEqual([{ q: 1 }, { q: 2 }]);
    expect(qs[0]).toMatch(/^select=assister,victim,killed_at&/);
    expect(qs[0]).toContain('victim=in.("Velisblacksword","Klep")');
    expect(qs[0]).toContain('killed_at=gte.2026-09-26T05:19:30.000Z&killed_at=lte.2026-09-26T05:25:30.000Z');
    expect(qs[1]).toContain('victim=in.("Jahpotheosis")');
    expect(qs[1]).toContain('killed_at=gte.2026-09-26T08:59:30.000Z&killed_at=lte.2026-09-26T09:00:30.000Z');
    for (const q of qs) expect(q).toMatch(/&limit=1000$/);
  });
  it('asks for the killer column when checking kills', async () => {
    const qs = [];
    await _pvpNeighbours([{ killer: 'Brackwyn', victim: 'Klep', killed_at: '2026-09-26T05:20:00.000Z' }], 'wolfpack',
      async (q) => { qs.push(q); return []; }, 'killer');
    expect(qs[0]).toMatch(/^select=killer,victim,killed_at&/);
  });
  it('a failed read is null, so the caller stores everything rather than guessing', async () => {
    expect(await _pvpNeighbours([row('Brackwyn', 'Klep', '2026-09-26T05:20:00.000Z')], 'wolfpack', async () => null)).toBe(null);
  });
});

describe('storing kills (the real block, run)', () => {
  // Runs the handler's persist block with a stub database, so a name that is
  // not in scope there (guildId lives inside the relay loop) throws here
  // instead of silently skipping every kill behind the catch.
  const block = sliceBlock(bot, "  if (pvpKillRows.length > 0) {\n    try {\n      const supabase = require('./utils/supabase');",
    "      console.warn('[pvp-relay] pvp_kills persist wrap failed:', err?.message);\n    }\n  }");
  async function persist(pvpKillRows, stored) {
    const upserts = [], warns = [];
    const supabase = {
      isEnabled: () => true,
      select: async () => stored,
      upsert: async (t, rows) => { upserts.push(rows); return rows; },
    };
    const fn = new Function('require', 'pvpKillRows', 'process', '_pvpNeighbours', '_pvpUnseen', 'console',
      `let _pvpWriteQ = Promise.resolve();\nreturn (async () => {\n${block}\n})();`);
    await fn(() => supabase, pvpKillRows, { env: {} }, _pvpNeighbours, _pvpUnseen, { warn: (...a) => warns.push(a.join(' ')) });
    return { upserts, warns };
  }
  const kill = (killer, victim, iso, source) => ({ killer, victim, killed_at: iso, source });
  it('drops a replayed kill already stored a few seconds off, keeps new ones and every live one', async () => {
    const live = kill('Rethlan', 'Klep', '2026-09-26T05:20:47.000Z', 'pvp_channel');
    const dupe = kill('Brackwyn', 'Velisblacksword', '2026-09-26T05:20:49.000Z', 'log_backfill');
    const fresh = kill('Brackwyn', 'Jahpotheosis', '2026-09-26T05:25:00.000Z', 'log_backfill');
    const { upserts, warns } = await persist([live, dupe, fresh],
      [{ killer: 'Brackwyn', victim: 'Velisblacksword', killed_at: '2026-09-26T05:20:47Z' }]);
    expect(warns).toEqual([]);
    expect(upserts).toEqual([[live, fresh]]);
  });
  it('a failed read stores everything', async () => {
    const dupe = kill('Brackwyn', 'Velisblacksword', '2026-09-26T05:20:49.000Z', 'log_backfill');
    const { upserts, warns } = await persist([dupe], null);
    expect(warns).toEqual([]);
    expect(upserts).toEqual([[dupe]]);
  });
});

describe('the handlers store only unseen rows, one request at a time', () => {
  it('assists: read the neighbours, filter, upsert what is left', () => {
    const h = stripJs(sliceBlock(bot, 'async function _handleAgentPvpAssists(req, res) {', '\n}\n'));
    expect(h).toMatch(/_pvpWriteQ\.then\(async \(\) => \{[\s\S]*_pvpNeighbours\(rows, guildId, \(q\) => supabase\.select\('pvp_assists', q\)\)[\s\S]*_pvpUnseen\(rows, existing\)[\s\S]*supabase\.upsert\('pvp_assists', fresh, 'dedup_key'\)/);
    expect(h).toMatch(/_pvpWriteQ = job\.catch\(/);
    expect(h).not.toMatch(/supabase\.upsert\('pvp_assists', rows,/);
  });
  it('kills: a replayed kill another raider already stored is dropped; live kills are untouched', () => {
    const h = stripJs(sliceBlock(bot, 'async function _handleAgentPvp(req, res) {', '\n}\n'));
    expect(h).toMatch(/const replayed = pvpKillRows\.filter\(r => r\.source === 'log_backfill'\)/);
    expect(h).toMatch(/_pvpNeighbours\(replayed, guildId, \(q\) => supabase\.select\('pvp_kills', q\), 'killer'\)/);
    expect(h).toMatch(/_pvpUnseen\(replayed, near, 'killer'\)/);
    expect(h).toMatch(/rows = pvpKillRows\.filter\(r => r\.source !== 'log_backfill' \|\| keep\.has\(r\)\)/);
    expect(h).toMatch(/supabase\.upsert\('pvp_kills', rows, 'dedup_key'\)/);
    expect(h).not.toMatch(/supabase\.upsert\('pvp_kills', pvpKillRows,/);
  });
});
