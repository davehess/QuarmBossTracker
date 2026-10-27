// test/pop-status-bot.test.js — the bot's half of the Flags mode of Mimic's PoP overlay (the guild lead, 2026-10-27:
// "A then B" for the per-character PoP flags checklist; A = a Flags mode in the PoP overlay for the character being
// played, with deep links into the Quests steps).
//
// utils/popStatus.js runs for real against a small in-memory PostgREST that applies the filters the module sends, so a
// stream that forgets the discord_id filter, or that lets the agent's `characters=` list WIDEN the scope, fails here.
// The wiring in index.js (the `pop` stream of /api/agent/poll, the cache drop on a pop_flags upsert) is read as
// stripped source and the stream block is run against a stub.
//
// The shape the Mimic overlay draws is pinned by test/fixtures/pop-status-brackwyn.json, which the overlay's own tests
// (beta) load too: both sides cannot drift apart without one of them going red.
//
// Run: npx vitest run test/pop-status-bot.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, ROOT, BOT_INDEX } from './_source-slice.js';
import { POP_STEPS } from '../web/lib/popSteps.ts';
import { GUIDE_ITEMS } from '../web/lib/popGuide.ts';

const require = createRequire(import.meta.url);
const S = require(path.join(ROOT, 'utils', 'popStatus.js'));
const bot = readSource(BOT_INDEX);
const botCode = stripJs(bot);

// The flags the bot has stored for the partway character in the approved mock (invented name): the Justice, Nightmare,
// Storms, Valor, Thunder and Honor lines done, Innovation and Tactics part way, Disease not started but Grummus killed
// (a pending memory), Rallos killed before Maelin's reading (a second one).
const BRACKWYN = ['mavuin_1', 'mavuin_2', 'mavuin_3', 'trial_justice', 'zeks_1', 'zeks_2', 'behemoth_dead', 'thelin_1', 'thelin_2',
  'thelin_3', 'thelin_4', 'hedge_event', 'tthule_dead', 'karana_1', 'karana_2', 'karana_3', 'karana_4', 'askr_quest', 'agnarr_dead',
  'aerindar_1', 'aerindar_2', 'aerindar_dead', 'hohtrials_111', 'hoh_trials', 'mmarr_1', 'marr_dead', 'mmarr_book_1', 'zeks_3',
  'zeks_4', 'vallon_dead', 'tallon_dead', 'cl_grummus', 'cl_rallos'];

describe('buildStatus: a partway character', () => {
  const s = S.buildStatus('Brackwyn', BRACKWYN);
  const line = (k) => s.next.find(l => l.line === k);
  const zone = (k) => s.zones.find(z => z.key === k);

  it('names the next step on the line she is at, from the engine', () => {
    expect(line('decay')).toMatchObject({ state: 'next', done: 0 });
    expect(line('decay').steps[0].key).toBe('disease_ward');
    expect(s.top[0]).toEqual({ line: 'decay', step: 'disease_ward' });
    // Lines she finished say so, with no steps.
    for (const k of ['justice', 'innovation', 'nightmare', 'storms', 'valor']) expect(line(k), k).toMatchObject({ state: 'done', steps: [] });
  });

  it('Grummus: pending memory, blocked on the Adler Fuirstel hail before the kill', () => {
    const p = s.pending.find(x => x.key === 'cl_grummus');
    expect(p).toMatchObject({ state: 'blocked', gives: 'fuirstel_2', step: 'fuirstel_1' });
    expect(p.label).toMatch(/Grummus/);
    expect(p.text).toMatch(/Adler Fuirstel/);
  });

  it('Rallos: pending memory, blocked on Maelin\'s Zeks 6 reading, which waits on the cipher and its missing Saryrn half', () => {
    const p = s.pending.find(x => x.key === 'cl_rallos');
    expect(p).toMatchObject({ state: 'blocked', gives: 'zeks_7', step: 'zeks_6' });
    expect(p.text).toMatch(/Maelin/);
    // Grand_Librarian_Maelin.lua:65-77: she moves zeks 5 -> 6 only with the cipher; the cipher (:15-20) needs both halves.
    expect(p.waits_on).toEqual([{ flag: 'cipher_1', label: expect.stringMatching(/Cipher/), line: 'maelin',
      via: [{ flag: 'saryrn_dead', label: 'Kill Saryrn', line: 'torment' }] }]);
    // The Grummus memory waits on nothing but a hail that can be done now.
    expect(s.pending.find(x => x.key === 'cl_grummus').waits_on).toEqual([]);
  });

  it('Next is the earliest step she can actually do, never the Zek-notes reading she cannot get without the cipher', () => {
    expect(s.top).toEqual([{ line: 'decay', step: 'disease_ward' }]);
    const tactics = line('tactics');
    expect(tactics.state).toBe('blocked');
    expect(tactics.blocked_on.map(b => b.flag)).toEqual(['cipher_1']);
    // With the cipher the reading is doable, and then it IS offered.
    const withCipher = S.buildStatus('Brackwyn', [...BRACKWYN, 'cipher_1', 'saryrn_1', 'saryrn_dead', 'tylis_2', 'tylis_1']);
    expect(withCipher.next.find(l => l.line === 'tactics')).toMatchObject({ state: 'next' });
    expect(withCipher.next.find(l => l.line === 'tactics').steps[0].key).toBe('zeks_maelin');
    // …and Rallos's memory no longer waits on anything: the reading is the thing to do first.
    expect(withCipher.pending.find(x => x.key === 'cl_rallos')).toMatchObject({ state: 'blocked', step: 'zeks_6', waits_on: [] });
  });

  it('a pending memory whose step is held is READY, and one already unlocked is not listed', () => {
    const ready = S.buildStatus('Brackwyn', [...BRACKWYN, 'fuirstel_1']);
    expect(ready.pending.find(x => x.key === 'cl_grummus')).toMatchObject({ state: 'ready', step: 'fuirstel_2' });
    const moot = S.buildStatus('Brackwyn', [...BRACKWYN, 'fuirstel_1', 'fuirstel_2']);
    expect(moot.pending.find(x => x.key === 'cl_grummus')).toBeUndefined();
    // …and a pending memory is never a completed step.
    expect(s.held).not.toContain('fuirstel_2');
  });

  it('draws each plane done / part / not started, and says which are still shut', () => {
    expect(zone('justice')).toMatchObject({ state: 'done', done: 3, total: 3, open: true });
    expect(zone('innovation')).toMatchObject({ state: 'part', done: 2, total: 3 });
    expect(zone('disease')).toMatchObject({ state: 'none', done: 0, total: 3 });
    expect(zone('torment')).toMatchObject({ state: 'none', done: 0, open: false });
    expect(zone('torment').missing.length).toBeGreaterThan(0);
    expect(zone('tactics')).toMatchObject({ state: 'part', done: 2, total: 4 });
    expect(s.steps.done).toBe(s.held.length);
    expect(s.steps.total).toBe(Object.values(POP_STEPS).flat().length);
  });

  it('the Factory door (kill Xanamech, Nitram opens it) is locked, with the other keys and doors', () => {
    const d = s.doors.find(x => x.step === 'poi_door_1');
    expect(d).toMatchObject({ held: false, zone: 'innovation' });
    expect(d.label).toMatch(/Xanamech/);
    expect(s.doors.map(x => x.step)).toEqual(S.DOOR_STEPS);
    const opened = S.buildStatus('Brackwyn', [...BRACKWYN, 'poi_door_1']);
    expect(opened.doors.find(x => x.step === 'poi_door_1').held).toBe(true);
  });

  it('every key it names exists in the engine\'s own tables (the overlay resolves them to links)', () => {
    const guide = new Set(GUIDE_ITEMS.map(i => i.key));
    const stages = new Set(Object.values(POP_STEPS).flat().map(x => x.key));
    for (const l of s.next) for (const st of l.steps) expect(guide.has(st.key), st.key).toBe(true);
    for (const t of s.top) expect(guide.has(t.step), t.step).toBe(true);
    for (const p of s.pending) { expect(stages.has(p.gives), p.gives).toBe(true); expect(stages.has(p.step), p.step).toBe(true); }
    for (const d of S.DOOR_STEPS) expect(stages.has(d), d).toBe(true);
  });

  it('is pure: the same keys give the same status and the same version', () => {
    expect(S.buildStatus('Brackwyn', [...BRACKWYN].reverse())).toEqual(s);
    expect(S.versionOf(s)).toBe(S.versionOf(S.buildStatus('Brackwyn', BRACKWYN)));
    expect(S.versionOf(s)).not.toBe(S.versionOf(S.buildStatus('Brackwyn', [...BRACKWYN, 'fuirstel_1'])));
  });

  it('is the shape the Mimic overlay draws: test/fixtures/pop-status-brackwyn.json (regenerate by hand if this changes on purpose)', () => {
    const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'pop-status-brackwyn.json'), 'utf8'));
    expect(fx.characters.brackwyn).toEqual(s);
    expect(fx.version).toBe(S.versionOf({ characters: { brackwyn: s }, unlinked: [] }));
  });
});

// ── The stream, against a fake database ──────────────────────────────────────

const GUILD = 'wolfpack';
function fakeDb(tables) {
  const parse = (qs) => qs.split('&').filter(p => p && !/^(select|order|limit|offset)=/.test(p)).map(p => {
    const i = p.indexOf('=');
    return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))];
  });
  const match = (row, filters) => filters.every(([k, v]) => {
    const cell = String(row[k]);
    if (v.startsWith('eq.')) return cell === v.slice(3);
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(cell);
    if (v.startsWith('not.in.(')) return !v.slice(8, -1).split(',').includes(cell);
    throw new Error('fake: unsupported filter ' + k + '=' + v);
  });
  const db = {
    enabled: true, down: new Set(), reads: [],
    isEnabled: () => db.enabled,
    async select(table, qs) {
      db.reads.push(table + '?' + qs);
      if (db.down.has(table)) return null;
      return (tables[table] || []).filter(r => match(r, parse(qs))).map(r => ({ ...r }));
    },
    async selectAllPaged(table, qs) { return db.select(table, qs); },
    async rpc(fn, params) {
      db.reads.push('rpc/' + fn + ' ' + JSON.stringify(params));
      if (db.down.has(fn)) return null;
      return (tables[fn] || []).filter(r => params.p_names.includes(r.character_key));
    },
  };
  return db;
}
const rowsFor = (character, keys) => keys.map((flag_key, n) => ({ id: n + 1, guild_id: GUILD, character, flag_key }));

function world() {
  return {
    characters: [
      { guild_id: GUILD, name: 'Brackwyn', discord_id: '111', exclude_from_stats: false },
      { guild_id: GUILD, name: 'Aldenmar', discord_id: '111', exclude_from_stats: false },
      { guild_id: GUILD, name: 'Hidden', discord_id: '111', exclude_from_stats: true },
      { guild_id: GUILD, name: 'Corvale', discord_id: '222', exclude_from_stats: false },
      { guild_id: 'other', name: 'Nyssara', discord_id: '111', exclude_from_stats: false },
    ],
    pop_flags: [...rowsFor('Brackwyn', BRACKWYN), ...rowsFor('Corvale', ['mavuin_3', 'cl_grummus']), ...rowsFor('Aldenmar', ['mavuin_1'])],
    pop_guide_ticks: [{ guild_id: GUILD, character_name: 'Aldenmar', item_key: 'flag_grummus' }],
    pop_who_sightings: [],
  };
}
const make = (db, t0 = 1_000_000) => {
  let t = t0;
  const svc = S.create({ supabase: db, guildId: GUILD, now: () => t });
  return { svc, tick: (ms) => { t += ms; } };
};

describe('the stream is scoped to the caller\'s own characters', () => {
  it('serves each of the caller\'s characters, keyed by lower-cased name, and nobody else\'s', async () => {
    const { svc } = make(fakeDb(world()));
    const out = await svc.streamFor({ discordId: '111', wanted: [] });
    expect(Object.keys(out.characters).sort()).toEqual(['aldenmar', 'brackwyn']);
    expect(out.characters.brackwyn).toEqual(S.buildStatus('Brackwyn', BRACKWYN));
    expect(out.unlinked).toEqual([]);
    expect(JSON.stringify(out)).not.toMatch(/Corvale|corvale/);
  });

  it('the agent\'s watched list can only NARROW the set: another member\'s character returns nothing and is reported as not linked', async () => {
    const { svc } = make(fakeDb(world()));
    const out = await svc.streamFor({ discordId: '111', wanted: ['Corvale', 'brackwyn'] });
    expect(Object.keys(out.characters)).toEqual(['brackwyn']);
    expect(out.unlinked).toEqual(['corvale']);
    expect(JSON.stringify(out.characters)).not.toMatch(/Corvale/i);
    const other = await svc.streamFor({ discordId: '222', wanted: ['Brackwyn'] });
    expect(other.characters).toEqual({});
  });

  it('never asks the database for a character that is not the caller\'s', async () => {
    const db = fakeDb(world());
    const { svc } = make(db);
    await svc.streamFor({ discordId: '111', wanted: ['Corvale', 'Brackwyn'] });
    const flagRead = db.reads.find(r => r.startsWith('pop_flags?'));
    expect(flagRead).toMatch(/Brackwyn/);
    expect(flagRead).not.toMatch(/Corvale/);
    expect(db.reads.find(r => r.startsWith('characters?'))).toMatch(/discord_id=eq\.111/);
  });

  it('leaves out a character that opted out of stats, and another guild\'s row of the same member', async () => {
    const { svc } = make(fakeDb(world()));
    const out = await svc.streamFor({ discordId: '111', wanted: [] });
    expect(out.characters.hidden).toBeUndefined();
    expect(out.characters.nyssara).toBeUndefined();
  });

  it('an unknown or empty caller gets an empty answer and no database read at all', async () => {
    const db = fakeDb(world());
    const { svc } = make(db);
    expect((await svc.streamFor({ discordId: '', wanted: ['Brackwyn'] })).characters).toEqual({});
    expect((await svc.streamFor({ discordId: '999', wanted: [] })).characters).toEqual({});
    db.enabled = false;
    expect((await svc.streamFor({ discordId: '111', wanted: [] })).characters).toEqual({});
  });

  it('merges the three sources the website merges: stored flags, the owner\'s ticks and /who proof', async () => {
    const t = world();
    t.pop_who_sightings = [{ character_key: 'aldenmar', zone: 'plane of valor', first_seen: '2026-10-20T20:00:00Z', last_seen: '2026-10-20T21:00:00Z' }];
    const { svc } = make(fakeDb(t));
    const out = await svc.streamFor({ discordId: '111', wanted: ['Aldenmar'] });
    const a = out.characters.aldenmar;
    // mavuin_1 from the stored flag, the Grummus kill from the owner's tick (which proves the Crypt key step), the Justice
    // flag from being seen in Valor (its way in needs it).
    expect(a.held).toContain('mavuin_1');
    expect(a.held).toContain('grummus_1');
    expect(a.held).toContain('mavuin_3');
  });
});

describe('the cache and the version', () => {
  it('reads each character once per window, and again after the window or an invalidate', async () => {
    const db = fakeDb(world());
    const { svc, tick } = make(db);
    await svc.streamFor({ discordId: '111', wanted: ['Brackwyn'] });
    const reads = () => db.reads.filter(r => r.startsWith('pop_flags?')).length;
    expect(reads()).toBe(1);
    await svc.streamFor({ discordId: '111', wanted: ['Brackwyn'] });
    expect(reads()).toBe(1);
    // A pop_flags upsert (index.js drops the characters it wrote).
    svc.invalidate(['brackwyn']);
    await svc.streamFor({ discordId: '111', wanted: ['Brackwyn'] });
    expect(reads()).toBe(2);
    tick(S.CACHE_MS + 1);
    await svc.streamFor({ discordId: '111', wanted: ['Brackwyn'] });
    expect(reads()).toBe(3);
  });

  it('the version moves only when what is served moves', async () => {
    const t = world();
    const { svc } = make(fakeDb(t));
    const a = await svc.streamFor({ discordId: '111', wanted: ['Brackwyn'] });
    const b = await svc.streamFor({ discordId: '111', wanted: ['Brackwyn'] });
    expect(b.version).toBe(a.version);
    t.pop_flags.push(...rowsFor('Brackwyn', ['fuirstel_1']).map(r => ({ ...r, id: 900 })));
    svc.invalidate(['Brackwyn']);
    const c = await svc.streamFor({ discordId: '111', wanted: ['Brackwyn'] });
    expect(c.version).not.toBe(a.version);
    expect(c.characters.brackwyn.pending.find(p => p.key === 'cl_grummus').state).toBe('ready');
  });

  it('a database that will not answer serves the last good status, and never an empty one', async () => {
    const db = fakeDb(world());
    const { svc, tick } = make(db);
    const first = await svc.streamFor({ discordId: '111', wanted: ['Brackwyn'] });
    tick(S.CACHE_MS + 1);
    db.down.add('pop_flags');
    const second = await svc.streamFor({ discordId: '111', wanted: ['Brackwyn'] });
    expect(second.characters.brackwyn).toEqual(first.characters.brackwyn);
    // No history and no database: left out, not drawn as a character who holds nothing.
    const fresh = make(db).svc;
    expect((await fresh.streamFor({ discordId: '111', wanted: ['Brackwyn'] })).characters).toEqual({});
    db.down.clear(); db.down.add('characters');
    expect((await make(db).svc.streamFor({ discordId: '111', wanted: [] })).error).toBeTruthy();
  });
});

// ── index.js wiring ──────────────────────────────────────────────────────────

describe('index.js: the `pop` stream of the poll', () => {
  const block = sliceBlock(botCode,
    "if (_pollStreamDecision('pop', want, tune, null, null) === 'send') {",
    "out.streams.pop = dec === 'unchanged' ? { version: bundle.version, unchanged: true } : bundle;\n  }");
  const run = async ({ want, tune = {}, identity = { discord_id: '111' }, chars = [], popVer = null, bundle }) => {
    const calls = [];
    const _popStatus = () => ({ streamFor: async (a) => { calls.push(a); return bundle; } });
    const _pollStreamDecision = new Function(
      sliceBlock(botCode, 'function _pollStreamDecision(key, want, tune, clientVer, freshVer) {', "  return 'send';\n}") + '\nreturn _pollStreamDecision;')();
    const url = new URL('http://x/?' + (popVer ? 'pop_ver=' + popVer : ''));
    const out = { streams: {} };
    // eslint-disable-next-line no-new-func
    await new Function('want', 'tune', 'identity', 'chars', 'url', 'out', '_popStatus', '_pollStreamDecision',
      'return (async () => {' + block + '})();')(new Set(want), tune, identity, chars, url, out, _popStatus, _pollStreamDecision);
    return { out, calls };
  };
  const B = { version: 'v1', characters: { brackwyn: { character: 'Brackwyn' } }, unlinked: [] };

  it('is only built when the agent asks for it, and for the Mimic session\'s own discord id with its watched list', async () => {
    expect((await run({ want: ['tuning'], bundle: B })).calls).toEqual([]);
    const r = await run({ want: ['pop'], chars: ['Brackwyn'], bundle: B });
    expect(r.calls).toEqual([{ discordId: '111', wanted: ['Brackwyn'] }]);
    expect(r.out.streams.pop).toEqual(B);
  });

  it('answers `unchanged` when the agent already holds the version, and is OMITTED while shed', async () => {
    expect((await run({ want: ['pop'], popVer: 'v1', bundle: B })).out.streams.pop).toEqual({ version: 'v1', unchanged: true });
    expect((await run({ want: ['pop'], popVer: 'v0', bundle: B })).out.streams.pop).toEqual(B);
    const shed = await run({ want: ['pop'], tune: { flag_shed_pop: 1 }, bundle: B });
    expect(shed.out.streams.pop).toBeUndefined();
    expect(shed.calls).toEqual([]);
  });

  it('drops the cached status of every character a pop_flags upsert wrote', () => {
    const handler = sliceBlock(botCode, 'async function _handleAgentPopFlags(req, res) {', '\n}\n');
    expect(handler).toMatch(/supabase\.upsert\('pop_flags'[\s\S]*_popStatusInst\.invalidate\(rows\.map\(/);
  });

  it('never reaches past the caller: the stream takes the identity\'s discord id, not one from the query', () => {
    expect(block).toMatch(/discordId: String\(identity\.discord_id/);
    expect(block).not.toMatch(/searchParams\.get\('(discord|user)/);
  });
});
