// test/recruit-stage.test.js — POST /api/agent/characters/stage: a new member's first sign-in stages their characters.
//
// The guild lead (2026-10-24): "we should check for the discord role and let them in, then prestage as a new recruit
// main" and "We should be asking what characters the player would like to upload (from their logs)." What can go
// wrong without anyone noticing, and what this file pins:
//   * a character someone else owns is taken over, or one that is still on the OpenDKP roster is claimed by whoever
//     types its name first;
//   * a row that already has a rank / class / family is overwritten by the defaults (a returning raider demoted to
//     Recruit), or a re-save keeps writing;
//   * the alts are parented under a main that did not land (they would join a stranger's family);
//   * an alt gets the main's class from the Discord role;
//   * a name that is not a name reaches the database, or the audit pair is missing so no officer can tell where the
//     row came from;
//   * the route skips auth, takes a body of any size, or sheds with a fake "ok".
// utils/recruitStage.js is driven directly against an in-memory stand-in for the characters table; the real route glue
// is read out of index.js. Text assertions strip comments.
//
// Run: npx vitest run test/recruit-stage.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, BOT_INDEX, ROOT } from './_source-slice.js';
import path from 'node:path';

const nodeRequire = createRequire(import.meta.url);
const rs = nodeRequire('../utils/recruitStage.js');

const GUILD = 'wolfpack';
const ME = '1111';
const OTHER = '2222';
const NOW = '2026-10-24T20:00:00.000Z';

// A characters table in memory. It understands exactly the queries the feature makes and refuses anything else.
function stubDb(rows = [], { failSelect = false, failInsert = false, updateReturnsEmpty = false } = {}) {
  const table = rows.map(r => ({ guild_id: GUILD, ...r }));
  const db = {
    calls: [],
    table,
    async select(t, q) {
      db.calls.push({ m: 'select', t, q });
      if (t !== 'characters') throw new Error('unexpected table ' + t);
      if (failSelect) return null;
      const dec = decodeURIComponent(q);
      const names = [...dec.matchAll(/name\.ilike\.([A-Za-z]+)/g)].map(m => m[1].toLowerCase());
      return table.filter(r => names.includes(r.name.toLowerCase())).map(r => ({ ...r }));
    },
    async insert(t, body) {
      db.calls.push({ m: 'insert', t, body });
      if (t !== 'characters') throw new Error('unexpected table ' + t);
      if (failInsert) return null;
      for (const b of body) table.push({ ...b });
      return body.map(b => ({ ...b }));
    },
    async update(t, q, patch) {
      db.calls.push({ m: 'update', t, q, patch });
      if (t !== 'characters') throw new Error('unexpected table ' + t);
      if (updateReturnsEmpty) return [];
      const name = decodeURIComponent(q.match(/name=eq\.([^&]*)/)[1]);
      const needNull = /discord_id=is\.null/.test(q);
      const row = table.find(r => r.name === name);
      if (!row || (needNull && row.discord_id)) return [];
      Object.assign(row, patch);
      return [{ ...row }];
    },
  };
  return new Proxy(db, {
    get(target, k) {
      if (k in target || typeof k === 'symbol') return target[k];
      throw new Error('unexpected supabase.' + String(k) + ' — staging reads and writes the characters table and nothing else');
    },
  });
}
const writes = (db) => db.calls.filter(c => c.m !== 'select');
const stage = (db, body, roles = [], who = ME) => rs.stageCharacters(db, GUILD, who, roles, body, NOW);
const names = (arr) => arr.map(s => s.name);

describe('parseBody', () => {
  it('the first is_main is the main; with none flagged the first name is', () => {
    const a = rs.parseBody({ characters: [{ name: 'Aldenmar' }, { name: 'Brackwyn', is_main: true }, { name: 'Corvale', is_main: true }] });
    expect(a.entries.map(e => [e.name, e.is_main])).toEqual([['Aldenmar', false], ['Brackwyn', true], ['Corvale', false]]);
    expect(a.main).toBe('Brackwyn');
    const b = rs.parseBody({ characters: [{ name: 'Aldenmar' }, { name: 'Brackwyn' }] });
    expect(b.main).toBe('Aldenmar');
  });

  it('names are stored Capitalised and a repeat in any case counts once', () => {
    const r = rs.parseBody({ characters: [{ name: 'aLDENMAR' }, { name: 'ALDENMAR', is_main: true }, { name: 'brackwyn' }] });
    expect(names(r.entries)).toEqual(['Aldenmar', 'Brackwyn']);
  });

  it('refuses anything that is not exactly a list of letters-only names, without coercing', () => {
    const bad = [
      null, [], 'x', {}, { characters: [] }, { characters: 'Aldenmar' },
      { characters: [{ name: 'A' }] },                                  // too short
      { characters: [{ name: 'Aldenmar1' }] },                          // digits are a backup marker, never a name
      { characters: [{ name: 'Alden mar' }] },
      { characters: [{ name: 'Alden-mar' }] },
      { characters: [{ name: "Alden'mar" }] },
      { characters: [{ name: 'A'.repeat(25) }] },
      { characters: [{ name: '' }] },
      { characters: [{ name: 5 }] },
      { characters: [{}] },
      { characters: ['Aldenmar'] },
      { characters: [{ name: 'Aldenmar', is_main: 'yes' }] },
      { characters: [{ name: 'Aldenmar', is_main: 1 }] },
      { characters: Array.from({ length: 13 }, (_, i) => ({ name: 'Name' + 'abcdefghijklm'[i] })) },
    ];
    for (const b of bad) expect(rs.parseBody(b).ok, JSON.stringify(b)).toBe(false);
  });

  it('accepts exactly twelve', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => ({ name: 'Nm' + 'abcdefghijkl'[i] }));
    expect(rs.parseBody({ characters: twelve }).ok).toBe(true);
  });
});

describe('classFromRoles', () => {
  it('exactly one EQ class role gives that class, spelled as the roster spells it', () => {
    expect(rs.classFromRoles(['Pack Member', 'Shadowknight'])).toBe('Shadow Knight');
    expect(rs.classFromRoles(['Cleric', 'Raider'])).toBe('Cleric');
  });
  it('none, or more than one, gives null', () => {
    expect(rs.classFromRoles(['Pack Member'])).toBeNull();
    expect(rs.classFromRoles(['Cleric', 'Wizard'])).toBeNull();
    expect(rs.classFromRoles(['Cleric', 'cleric'])).toBe('Cleric');   // the same class twice is still one class
    expect(rs.classFromRoles(undefined)).toBeNull();
  });
});

describe('stageCharacters — new rows', () => {
  it('stages a recruit main and non-raid alts, parented under the main, with the audit pair', async () => {
    const db = stubDb();
    const out = await stage(db, { characters: [{ name: 'Brackwyn' }, { name: 'Aldenmar', is_main: true }] });
    expect(out.status).toBe(200);
    expect(out.body.ok).toBe(true);
    expect(out.body.conflicts).toEqual([]);
    // reported in the order sent, not main-first
    expect(names(out.body.staged)).toEqual(['Brackwyn', 'Aldenmar']);
    const main = db.table.find(r => r.name === 'Aldenmar');
    const alt = db.table.find(r => r.name === 'Brackwyn');
    expect(main).toMatchObject({ guild_id: GUILD, discord_id: ME, rank: 'Recruit', main_name: 'Aldenmar', registered_via_web_at: NOW, registered_via_web_by_discord_id: ME });
    expect(alt).toMatchObject({ guild_id: GUILD, discord_id: ME, rank: 'Non-raid Alt', main_name: 'Aldenmar', registered_via_web_at: NOW, registered_via_web_by_discord_id: ME });
    expect(out.body.staged.find(s => s.name === 'Aldenmar')).toMatchObject({ is_main: true, rank: 'Recruit', created: true });
  });

  it('touches only the characters table, and only with insert and update', async () => {
    const db = stubDb();
    await stage(db, { characters: [{ name: 'Aldenmar' }, { name: 'Brackwyn' }] });
    expect(db.calls.every(c => c.t === 'characters')).toBe(true);
    expect(writes(db).every(c => c.m === 'insert')).toBe(true);
  });

  it('never creates anything in OpenDKP: no opendkp_id, no register request, no other table', async () => {
    const db = stubDb();
    await stage(db, { characters: [{ name: 'Aldenmar' }] });
    expect(db.table[0].opendkp_id).toBeUndefined();
    expect(new Set(db.calls.map(c => c.t))).toEqual(new Set(['characters']));
  });

  it('the main takes the one class the Discord roles name; an alt never does', async () => {
    const db = stubDb();
    await stage(db, { characters: [{ name: 'Aldenmar' }, { name: 'Brackwyn' }] }, ['Pack Member', 'Enchanter']);
    expect(db.table.find(r => r.name === 'Aldenmar').class).toBe('Enchanter');
    expect(db.table.find(r => r.name === 'Brackwyn').class).toBeUndefined();
  });

  it('two class roles, or none, leave the class unset', async () => {
    for (const roles of [['Enchanter', 'Wizard'], ['Pack Member'], []]) {
      const db = stubDb();
      await stage(db, { characters: [{ name: 'Aldenmar' }] }, roles);
      expect(db.table[0].class, JSON.stringify(roles)).toBeUndefined();
    }
  });

  it('the Discord id comes from the session, never from the body', async () => {
    const db = stubDb();
    await stage(db, { characters: [{ name: 'Aldenmar' }], discord_id: OTHER, rank: 'Officer', main_name: 'Zarrin' });
    expect(db.table[0].discord_id).toBe(ME);
    expect(db.table[0].rank).toBe('Recruit');
    expect(db.table[0].main_name).toBe('Aldenmar');
  });
});

describe('stageCharacters — rows that already exist', () => {
  it('a character owned by someone else is a conflict and is left exactly as it was', async () => {
    const db = stubDb([{ name: 'Aldenmar', discord_id: OTHER, rank: 'Raid Pack', class: 'Cleric', main_name: 'Aldenmar' }]);
    const before = JSON.stringify(db.table);
    const out = await stage(db, { characters: [{ name: 'aldenmar' }] });
    expect(out.status).toBe(200);
    expect(out.body.staged).toEqual([]);
    expect(out.body.conflicts).toEqual([{ name: 'Aldenmar', reason: 'owned_by_another' }]);
    expect(JSON.stringify(db.table)).toBe(before);
    expect(writes(db)).toEqual([]);
  });

  it('a conflicting MAIN leaves the alts unparented rather than under someone else\'s family', async () => {
    const db = stubDb([{ name: 'Aldenmar', discord_id: OTHER, rank: 'Raid Pack' }]);
    const out = await stage(db, { characters: [{ name: 'Aldenmar', is_main: true }, { name: 'Brackwyn' }] });
    expect(names(out.body.staged)).toEqual(['Brackwyn']);
    expect(out.body.conflicts.map(c => c.name)).toEqual(['Aldenmar']);
    const alt = db.table.find(r => r.name === 'Brackwyn');
    expect(alt.discord_id).toBe(ME);
    expect(alt.main_name).toBeUndefined();
  });

  it('an unowned character already on the OpenDKP roster is not claimable by typing its name', async () => {
    const db = stubDb([{ name: 'Aldenmar', discord_id: null, opendkp_id: 4411, rank: 'Raid Pack', class: 'Cleric' }]);
    const out = await stage(db, { characters: [{ name: 'Aldenmar' }] });
    expect(out.body.conflicts).toEqual([{ name: 'Aldenmar', reason: 'in_opendkp_unclaimed' }]);
    expect(writes(db)).toEqual([]);
    expect(db.table[0].discord_id).toBeNull();
  });

  it('claims an unowned, un-rostered row (the uploads-only row) and fills only what is empty', async () => {
    const db = stubDb([
      { name: 'Aldenmar', discord_id: null, rank: null, class: null, main_name: null },
      { name: 'Brackwyn', discord_id: null, rank: 'Raid Alt', class: 'Wizard', main_name: 'Rethlan' },
    ]);
    const out = await stage(db, { characters: [{ name: 'Aldenmar', is_main: true }, { name: 'Brackwyn' }] }, ['Cleric']);
    expect(out.body.conflicts).toEqual([]);
    expect(db.table.find(r => r.name === 'Aldenmar')).toMatchObject({ discord_id: ME, rank: 'Recruit', class: 'Cleric', main_name: 'Aldenmar', registered_via_web_at: NOW, registered_via_web_by_discord_id: ME });
    // rank, class and family it already had survive; the owner is the one thing that is filled
    expect(db.table.find(r => r.name === 'Brackwyn')).toMatchObject({ discord_id: ME, rank: 'Raid Alt', class: 'Wizard', main_name: 'Rethlan' });
    expect(out.body.staged.find(s => s.name === 'Brackwyn').rank).toBe('Raid Alt');
    expect(out.body.staged.every(s => s.created === false)).toBe(true);
  });

  it('the claim is atomic: the write carries discord_id=is.null, and losing the race is a conflict', async () => {
    const db = stubDb([{ name: 'Aldenmar', discord_id: null }]);
    await stage(db, { characters: [{ name: 'Aldenmar' }] });
    const upd = writes(db)[0];
    expect(upd.m).toBe('update');
    expect(upd.q).toMatch(/discord_id=is\.null/);
    expect(upd.q).toMatch(/guild_id=eq\.wolfpack/);

    const raced = stubDb([{ name: 'Aldenmar', discord_id: null }], { updateReturnsEmpty: true });
    const out = await stage(raced, { characters: [{ name: 'Aldenmar' }] });
    expect(out.body.staged).toEqual([]);
    expect(out.body.conflicts).toEqual([{ name: 'Aldenmar', reason: 'owned_by_another' }]);
  });

  it('saving again changes nothing: a row already mine and complete is not written', async () => {
    const db = stubDb();
    await stage(db, { characters: [{ name: 'Aldenmar' }, { name: 'Brackwyn' }] }, ['Bard']);
    const snapshot = JSON.stringify(db.table);
    db.calls.length = 0;
    const again = await stage(db, { characters: [{ name: 'Aldenmar' }, { name: 'Brackwyn' }] }, ['Bard']);
    expect(writes(db)).toEqual([]);
    expect(JSON.stringify(db.table)).toBe(snapshot);
    expect(again.body.staged.every(s => s.changed === false && s.created === false)).toBe(true);
    expect(again.body.conflicts).toEqual([]);
  });

  it('a row of mine that an officer already ranked keeps its rank when the same name is saved', async () => {
    const db = stubDb([{ name: 'Aldenmar', discord_id: ME, rank: 'Raid Pack', class: 'Paladin', main_name: 'Aldenmar', registered_via_web_at: '2026-01-01T00:00:00Z' }]);
    await stage(db, { characters: [{ name: 'Aldenmar' }] }, ['Cleric']);
    expect(writes(db)).toEqual([]);
    expect(db.table[0]).toMatchObject({ rank: 'Raid Pack', class: 'Paladin', registered_via_web_at: '2026-01-01T00:00:00Z' });
  });

  it('the lookup finds a stored name whatever case was sent, and writes by the stored spelling', async () => {
    const db = stubDb([{ name: 'Aldenmar', discord_id: null }]);
    const out = await stage(db, { characters: [{ name: 'ALDENMAR' }] });
    expect(out.body.staged[0].name).toBe('Aldenmar');
    expect(writes(db)[0].q).toMatch(/name=eq\.Aldenmar/);
  });
});

describe('stageCharacters — refusals and failures', () => {
  it('a bad body is a 400 and costs no database call', async () => {
    const db = stubDb();
    for (const body of [null, {}, { characters: [{ name: 'Bad1' }] }, { characters: [{ name: 'Aldenmar', is_main: 'true' }] }]) {
      const out = await stage(db, body);
      expect(out.status).toBe(400);
    }
    expect(db.calls).toEqual([]);
  });

  it('no Discord id on the session is a 403 and costs no database call', async () => {
    const db = stubDb();
    const out = await stage(db, { characters: [{ name: 'Aldenmar' }] }, [], '');
    expect(out.status).toBe(403);
    expect(db.calls).toEqual([]);
  });

  it('a failed read is a 502, never "nothing exists, create them all"', async () => {
    const db = stubDb([], { failSelect: true });
    const out = await stage(db, { characters: [{ name: 'Aldenmar' }] });
    expect(out.status).toBe(502);
    expect(writes(db)).toEqual([]);
  });

  it('a failed insert is reported as write_failed, not as staged', async () => {
    const db = stubDb([], { failInsert: true });
    const out = await stage(db, { characters: [{ name: 'Aldenmar' }] });
    expect(out.status).toBe(200);
    expect(out.body.staged).toEqual([]);
    expect(out.body.conflicts).toEqual([{ name: 'Aldenmar', reason: 'write_failed' }]);
  });
});

describe('the route and its neighbours', () => {
  const src = readSource(BOT_INDEX);
  const handler = stripJs(sliceBlock(src, 'async function _handleAgentCharactersStage(req, res) {', '\n}\n'));
  const dispatch = stripJs(sliceBlock(src, "if (req.method === 'POST' && req.url === '/api/agent/characters/stage'", '\n  }\n'));

  it('authenticates before it reads a byte, with the session\'s own Discord id and roles', () => {
    expect(handler.indexOf('mimicLink.requireAgentAuth')).toBeGreaterThan(-1);
    expect(handler.indexOf('mimicLink.requireAgentAuth')).toBeLessThan(handler.indexOf('for await'));
    expect(handler).toMatch(/identity\.discord_id/);
    expect(handler).toMatch(/identity\.role_names/);
    expect(handler).not.toMatch(/payload\.discord_id|payload\.rank/);
  });

  it('bounds the body and answers 413 past it', () => {
    expect(handler).toMatch(/recruitStage\.MAX_BODY_BYTES/);
    expect(handler).toMatch(/writeHead\(413\)/);
    expect(rs.MAX_BODY_BYTES).toBeLessThanOrEqual(16 * 1024);
  });

  it('is a POST on its exact path, wrapped so a throw is a 500 and not a hung request', () => {
    expect(dispatch).toMatch(/req\.method === 'POST'/);
    expect(dispatch).toMatch(/_handleAgentCharactersStage\(req, res\)/);
    expect(dispatch).toMatch(/writeHead\(500/);
  });

  it('is a write route, not an ingest stream: no shed and no 200-ack budget that would lie about a save', () => {
    expect(handler).not.toMatch(/_isShedded|_overBudget/);
    expect(dispatch).not.toMatch(/_isShedded|_overBudget/);
    expect(stripJs(sliceBlock(src, 'const _SHED_KINDS = new Set([', ']);'))).not.toMatch(/characters_stage|recruit/);
  });

  it('the OpenDKP roster sync cannot strip an owner: its character row has no discord_id column', () => {
    const sync = stripJs(readSource(path.join(ROOT, 'utils', 'openDkpSync.js')));
    const fn = sliceBlock(sync, 'async function syncCharacters() {', '\n}\n');
    const rowLiteral = sliceBlock(fn, 'return {\n        guild_id:   guildId,', '};');
    expect(rowLiteral).not.toMatch(/discord_id/);
    expect(rowLiteral).toMatch(/class:/);   // and it does own class / rank / main_name once OpenDKP lists the character
  });
});
