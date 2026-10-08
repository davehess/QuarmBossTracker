// test/night-loot-panel.test.js — the Mimic Loot tab's "who looted what" feed.
//
// The guild lead, 2026-10-03: "the loot tab on mimic should have the 'who looted
// what' section on there for items, as well as the rolls for loot." An agent only
// sees its OWN `--You have looted--` lines, so the guild-wide list is a bot
// server-panel key: GET /api/agent/server-panel/night-loot.
//
// Three layers, all running the SHIPPED code:
//   • utils/rollLoot.js buildNightLootPanel — the shaping (window, order, cap,
//     which roll sessions survive, "looted by" only when it differs);
//   • index.js _nightLootPanelBody — what it asks Supabase for, and that a failed
//     read is an error, never an empty night;
//   • the handler branch + the real 60s cache — one fetch serves a room of Mimics.
//
// Names are invented fixtures; item/zone strings are the ones the roll tests use.
//
// Run: npx vitest run test/night-loot-panel.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, evalBlock, stripJs, BOT_INDEX } from './_source-slice.js';

const require_ = createRequire(BOT_INDEX);
const { buildNightLootPanel, buildRollSessions, renderRollLootLines } = require_('./utils/rollLoot');

const NOW = Date.parse('2026-10-03T03:00:00Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const MIN = 60_000, HOUR = 3_600_000;

// One roll set for a Cloak, seen by one uploader: Corvale beat Rethlan.
const cloakSet = (startAgo) => ({
  roll_from: 0, roll_to: 100, item: 'Cloak of Flames', qty: 1, zone: 'The Overthere',
  started_at: iso(startAgo), last_at: iso(startAgo - 30_000),
  rolls: [
    { name: 'Corvale', value: 88, at: iso(startAgo - 5_000) },
    { name: 'Rethlan', value: 41, at: iso(startAgo - 10_000) },
  ],
});
const loot = (looter, item, ago, zone = 'The Overthere') =>
  ({ looter_character: looter, item_name: item, zone, looted_at: iso(ago) });

describe('buildNightLootPanel — the looted list', () => {
  it('lists newest first with the fields the Loot tab draws', () => {
    const out = buildNightLootPanel([], [
      loot('Aldenmar', 'Velium Battlehammer', 3 * HOUR),
      loot('Brackwyn', 'Cloak of Flames', 10 * MIN, null),
      loot('Corvale', 'Fungus Covered Scale Tunic', 1 * HOUR),
    ], { nowMs: NOW });
    expect(out.loot.map(l => l.looter)).toEqual(['Brackwyn', 'Corvale', 'Aldenmar']);
    expect(out.loot[0]).toEqual({ looter: 'Brackwyn', item: 'Cloak of Flames', zone: null, at: iso(10 * MIN) });
    expect(out.loot_total).toBe(3);
  });

  it('keeps only the last 12 hours', () => {
    const out = buildNightLootPanel([], [
      loot('Aldenmar', 'Cloak of Flames', 11 * HOUR + 59 * MIN),
      loot('Brackwyn', 'Cloak of Flames', 12 * HOUR + 1 * MIN),   // just outside
      loot('Corvale', 'Cloak of Flames', 2 * 24 * HOUR),
    ], { nowMs: NOW });
    expect(out.loot.map(l => l.looter)).toEqual(['Aldenmar']);
    expect(out.loot_total).toBe(1);
  });

  it('caps the list but reports the true total, so the panel can say "showing N of M"', () => {
    const rows = [];
    for (let i = 0; i < 250; i++) rows.push(loot('Aldenmar', 'Cloak of Flames', (i + 1) * MIN));
    const out = buildNightLootPanel([], rows, { nowMs: NOW });
    expect(out.loot).toHaveLength(200);
    expect(out.loot_total).toBe(250);
    expect(out.loot[0].at).toBe(iso(1 * MIN));   // the cap drops the OLDEST
  });

  it('skips rows that cannot be drawn (no time, no looter, no item)', () => {
    const out = buildNightLootPanel([], [
      { looter_character: 'Aldenmar', item_name: 'Cloak of Flames', looted_at: 'not a date' },
      { looter_character: '', item_name: 'Cloak of Flames', looted_at: iso(MIN) },
      { looter_character: 'Brackwyn', item_name: '', looted_at: iso(MIN) },
      null,
    ], { nowMs: NOW });
    expect(out.loot).toEqual([]);
    expect(out.loot_total).toBe(0);
  });

  it('does not filter anyone out by name — exclude_from_stats is enforced at upload, like /rolls', () => {
    // No exclusion input exists: every row that reaches the table is shown.
    const out = buildNightLootPanel([], [loot('Rethlan', 'Cloak of Flames', MIN)], { nowMs: NOW });
    expect(out.loot.map(l => l.looter)).toEqual(['Rethlan']);
  });
});

describe('buildNightLootPanel — the roll sessions', () => {
  it('is buildRollSessions, not a second merge: same winners, rollers and looters', () => {
    const rolls = [cloakSet(30 * MIN), { ...cloakSet(30 * MIN), started_at: iso(30 * MIN - 1500) }];   // two uploaders
    const looted = [loot('Corvale', 'Cloak of Flames', 25 * MIN)];
    const ref = buildRollSessions(rolls, looted)[0];
    const out = buildNightLootPanel(rolls, looted, { nowMs: NOW });
    expect(out.sessions).toHaveLength(1);
    const s = out.sessions[0];
    expect(s).toMatchObject({ item: 'Cloak of Flames', qty: 1, zone: 'The Overthere', from: 0, to: 100, rollers: ref.rollers });
    expect(s.winners).toEqual(ref.winners);
    expect(s.winners).toEqual([{ name: 'Corvale', value: 88 }]);
    expect(s.rollers).toBe(2);
    expect(Date.parse(s.started_at)).toBe(ref.startMs);
  });

  it('looted_by names a looter only when they differ from the winner', () => {
    const same = buildNightLootPanel([cloakSet(30 * MIN)], [loot('Corvale', 'Cloak of Flames', 25 * MIN)], { nowMs: NOW });
    expect(same.sessions[0].looters).toEqual(['Corvale']);
    expect(same.sessions[0].looted_by).toEqual([]);

    // A re-roll or a pass: the winner is Corvale but Aldenmar picked it up.
    const differs = buildNightLootPanel([cloakSet(30 * MIN)], [loot('Aldenmar', 'a Cloak of Flames', 25 * MIN)], { nowMs: NOW });
    expect(differs.sessions[0].winners.map(w => w.name)).toEqual(['Corvale']);
    expect(differs.sessions[0].looted_by).toEqual(['Aldenmar']);
  });

  it('agrees with the Discord card on who "looted by" is (shared predicate)', () => {
    const rolls = [cloakSet(30 * MIN)];
    const looted = [loot('Corvale', 'Cloak of Flames', 25 * MIN), loot('Aldenmar', 'Cloak of Flames', 24 * MIN)];
    const out = buildNightLootPanel(rolls, looted, { nowMs: NOW });
    expect(out.sessions[0].looted_by).toEqual(['Aldenmar']);
    expect(renderRollLootLines(buildRollSessions(rolls, looted)).join('\n')).toContain('looted by Aldenmar');
  });

  it('drops unnamed sets (deathrolls, stray /random) — they can never link to a looter', () => {
    const stray = { roll_from: 0, roll_to: 333, item: null, qty: null, zone: null,
      started_at: iso(20 * MIN), last_at: iso(19 * MIN), rolls: [{ name: 'Brackwyn', value: 7, at: iso(20 * MIN) }] };
    const out = buildNightLootPanel([stray, cloakSet(30 * MIN)], [], { nowMs: NOW });
    expect(out.sessions.map(s => s.item)).toEqual(['Cloak of Flames']);
  });

  it('keeps only sets that started in the window, newest first', () => {
    const tunic = { ...cloakSet(2 * HOUR), roll_to: 200, item: 'Fungus Covered Scale Tunic' };
    const ancient = { ...cloakSet(13 * HOUR), roll_to: 300, item: 'Velium Battlehammer' };
    const out = buildNightLootPanel([ancient, tunic, cloakSet(30 * MIN)], [], { nowMs: NOW });
    expect(out.sessions.map(s => s.item)).toEqual(['Cloak of Flames', 'Fungus Covered Scale Tunic']);
  });

  it('a loot just before the window still links to a roll inside it (the fetch slack), but is not listed', () => {
    const edge = cloakSet(12 * HOUR - 1 * MIN);
    // The set resolves ~11h58m30s ago; a loot 12h10s ago is inside the 2-minute
    // pre-resolve slack but outside the window.
    const looted = [loot('Aldenmar', 'Cloak of Flames', 12 * HOUR + 10_000)];
    const out = buildNightLootPanel([edge], looted, { nowMs: NOW });
    expect(out.sessions[0].looted_by).toEqual(['Aldenmar']);
    expect(out.loot).toEqual([]);
  });

  it('survives empty or missing input', () => {
    expect(buildNightLootPanel(null, undefined, { nowMs: NOW })).toEqual({ loot_total: 0, loot: [], sessions: [] });
  });
});

// ── _nightLootPanelBody: what it reads, and a failed read is an error ──────────
const src = readSource(BOT_INDEX);
const bodyBlock = sliceBlock(src, 'async function _nightLootPanelBody', '// ── end night-loot panel fetch ──');
globalThis.__nightLootRequire = require_;
const { _nightLootPanelBody } = evalBlock(
  'const require = globalThis.__nightLootRequire;\n' + bodyBlock,
  ['_nightLootPanelBody'],
);

// The panel reads both tables page by page (a night's rows pass PostgREST's silent 1,000-row cap), so the
// fake answers through the REAL paginator: selectAllPaged(table, query, orderCol, select). Its page walk
// is exercised on fixtures past the cap in test/pgrst-cap-bot-reads.test.js.
const { selectAllPaged: realSelectAllPaged } = require_('./utils/supabase');
function fakeSupabase({ rolls = [], looted = [] } = {}) {
  const calls = [];
  const select = async (table, q) => {
    calls.push({ table, q });
    if (table === 'roll_sets') return rolls;
    if (table === 'looted_items') return looted;
    if (table === 'eqemu_items') return [];   // prices: see test/night-loot-value.test.js
    throw new Error('unexpected table ' + table);
  };
  return { calls, select, selectAllPaged: (table, q, orderCol) => realSelectAllPaged(table, q, orderCol, select) };
}

describe('_nightLootPanelBody', () => {
  it('reads roll_sets and looted_items for this guild, newest first, over the 12h window', async () => {
    const sb = fakeSupabase();
    await _nightLootPanelBody(sb, 'wolfpack', NOW);
    const roll = sb.calls.find(c => c.table === 'roll_sets').q;
    const lt = sb.calls.find(c => c.table === 'looted_items').q;
    expect(roll).toContain('guild_id=eq.wolfpack');
    expect(roll).toContain('started_at=gte.' + encodeURIComponent(new Date(NOW - 12 * HOUR).toISOString()));
    expect(roll).toContain('order=started_at.desc');
    expect(lt).toContain('guild_id=eq.wolfpack');
    expect(lt).toContain('order=looted_at.desc');
    // 5 minutes of slack ahead of the window so attribution can still link.
    expect(lt).toContain('looted_at=gte.' + encodeURIComponent(new Date(NOW - 12 * HOUR - 5 * MIN).toISOString()));
  });

  it('returns the merged shape', async () => {
    const sb = fakeSupabase({
      rolls: [cloakSet(30 * MIN)],
      looted: [loot('Aldenmar', 'Cloak of Flames', 25 * MIN)],
    });
    const out = await _nightLootPanelBody(sb, 'wolfpack', NOW);
    expect(out.loot.map(l => l.looter)).toEqual(['Aldenmar']);
    expect(out.sessions[0].looted_by).toEqual(['Aldenmar']);
  });

  it('treats a failed read (supabase answers null) as an error, not as an empty night', async () => {
    for (const bad of ['roll_sets', 'looted_items']) {
      const select = async (table) => (table === bad ? null : []);
      const sb = { select, selectAllPaged: (table, q, orderCol) => realSelectAllPaged(table, q, orderCol, select) };
      await expect(_nightLootPanelBody(sb, 'wolfpack', NOW)).rejects.toThrow(/night-loot/);
    }
  });
});

// ── the handler branch, with the REAL 60s cache ────────────────────────────────
const cacheBlock = sliceBlock(src, 'const _lootPanelCache = new Map();', '_lootPanelCache.delete(first); } }');
const branchBlock = sliceBlock(src, "if (key === 'night-loot') {", 'return res.end(out);\n    }');

function runBranch({ body, query = '' }) {
  const { handle } = evalBlock(
    cacheBlock + '\n'
    + 'async function handle(key, res, guildId, supabase, _nightLootPanelBody, url, require) {\n' + branchBlock + '\n}\n',
    ['handle'],
  );
  const mkRes = () => { const r = { status: null, body: null, writeHead(s) { r.status = s; }, end(b) { r.body = b; } }; return r; };
  const calls = [];
  const fetchBody = async (...args) => { calls.push(args); return body(); };
  const url = new URL('http://localhost/api/agent/server-panel/night-loot' + query);
  return { handle: async () => { const res = mkRes(); await handle('night-loot', res, 'wolfpack', {}, fetchBody, url, require_); return res; }, calls };
}

describe('night-loot handler branch', () => {
  it('serves a room of Mimics from one fetch (60s cache), same bytes each time', async () => {
    const h = runBranch({ body: () => ({ loot_total: 1, loot: [{ looter: 'Aldenmar', item: 'Cloak of Flames', zone: null, at: iso(MIN) }], sessions: [] }) });
    const a = await h.handle(); const b = await h.handle(); const c = await h.handle();
    expect(h.calls).toHaveLength(1);
    expect(a.status).toBe(200);
    expect(b.body).toBe(a.body); expect(c.body).toBe(a.body);
    const parsed = JSON.parse(a.body);
    expect(parsed).toMatchObject({ key: 'night-loot', scope: 'last 12h', loot_total: 1 });
    expect(parsed.loot[0].looter).toBe('Aldenmar');
    expect(typeof parsed.updated_at).toBe('string');
  });

  it('never caches a failed fetch — the next poll tries again', async () => {
    let fail = true;
    const h = runBranch({ body: () => { if (fail) throw new Error('boom'); return { loot_total: 0, loot: [], sessions: [] }; } });
    await expect(h.handle()).rejects.toThrow('boom');   // the outer try/catch turns this into the 500
    fail = false;
    const ok = await h.handle();
    expect(ok.status).toBe(200);
    expect(h.calls).toHaveLength(2);
  });

  it('is one shared cache entry per guild and window, not per caller', () => {
    expect(stripJs(branchBlock)).toMatch(/const ck = 'night-loot:' \+ guildId \+ ':' \+ hours;/);
  });
});
