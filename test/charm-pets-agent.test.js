// The Charm overlay's "Best pets here" — agent half (the guild lead, 2026-10-14: "integrate a list of the better
// charm pets for the highest level charm a player has for the zone that they're in").
//
// The bot half is GET /api/agent/charm-pets (utils/charmPets.js, on its own branch). This file runs the agent's two
// "Charm pets" blocks of packages/wolfpack-logsync/index.js as shipped (source-sliced): the spell choice
// (spellbook vs assumed from level), the charm-level cap and body-type limit, the ranking, the zone files kept on
// disk, and the two fallbacks the bot half forces on us — a 404 hides the section, and local mode makes no call.
// The overlay half (apps/mimic/charm.html) is run against a stub page at the bottom.
//
// Mutation-checked (2026-10-14): each assertion below was turned red by breaking the line it guards — the cap's `>`,
// each body-type clause, the aoe exclusion, the book-before-level order, the 10% step, the HP tiebreak, the name
// dedupe, the top-8 slice, the 404 handler, the local-mode gate, the stand-down gate, the revalidate age, the 304
// path, the spellbook filename match and the 30 s book cache. Fixture names are invented; none is a member.
//
// Run: npx vitest run test/charm-pets-agent.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { EventEmitter } from 'node:events';
import { readSource, sliceBlock, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';

const AGENT = readSource(AGENT_INDEX);
const BLOCK = sliceBlock(AGENT, '// ── Charm pets: the pure half', '// ── end Charm pets: this machine\'s half ──');
const BOOK_PARSER = sliceBlock(AGENT, 'function parseSpellbookFile(text) {', '\n  return out;\n}');
const BOOK_RX = AGENT.slice(AGENT.indexOf('const SPELLBOOK_FILENAME_RX = '), AGENT.indexOf(';', AGENT.indexOf('const SPELLBOOK_FILENAME_RX = ')) + 1);
const CHARM_HTML = readSource(path.join(ROOT, 'apps', 'mimic', 'charm.html'));

const EXPORTS = ['CHARM_PET_SPELLS', 'charmPetBodyOk', 'pickCharmPetSpell', 'charmPetDps', 'charmPetChips', 'rankCharmPets',
  'charmBestState', '_charmPetZones', '_charmBooks', '_zealState', 'stats', '_setOpts', '_setDown', '_who', '_charmPetsDir'];

function load({ dir, opts, net }) {
  const prelude = `
    let _uploadOpts = __opts;
    const _setOpts = (o) => { _uploadOpts = o; };
    let __down = false;
    const _setDown = (v) => { __down = v; };
    function _localOnly() { return !!(_uploadOpts && !_uploadOpts.token); }
    function _controlStandDown() { return { down: __down }; }
    const AGENT_VERSION = 'test';
    const _zealState = {};
    const stats = { watchedLogs: [] };
    const _who = new Map();   // lower-cased name -> { cls, level }
    function _classOf(c) { const w = _who.get(String(c || '').toLowerCase()); return w ? w.cls : null; }
    function _levelOf(c) { const w = _who.get(String(c || '').toLowerCase()); return w ? w.level : null; }
    function _mapZoneShort(id) { return ({ 27: 'lavastorm', 164: 'thedeep' })[Number(id)] || null; }
    ${BOOK_RX}
    ${BOOK_PARSER}
  `;
  // eslint-disable-next-line no-new-func
  const f = new Function('fs', 'path', 'http', 'https', 'zlib', '__dirname', '__opts',
    prelude + '\n' + BLOCK + `\nreturn { ${EXPORTS.join(', ')} };`);
  return f(fs, path, net.http, net.https, zlib, dir, opts);
}

function fakeNet(responder) {
  const calls = [];
  const mod = {
    request(o, cb) {
      calls.push(o);
      const req = {
        on() { return req; }, destroy() {},
        end() {
          setImmediate(() => {
            const r = responder ? responder(o) : { status: 500 };
            const res = new EventEmitter();
            res.statusCode = r.status; res.headers = r.etag ? { etag: r.etag } : {};
            cb(res);
            if (r.body != null) res.emit('data', Buffer.from(typeof r.body === 'string' ? r.body : JSON.stringify(r.body)));
            res.emit('end');
          });
        },
      };
      return req;
    },
  };
  return { http: mod, https: mod, calls };
}
const tick = () => new Promise(r => setImmediate(() => setImmediate(r)));

const npc = (id, name, extra = {}) => ({
  id, name, level: 30, maxlevel: 0, hp: 900, ac: 40, mr: 25, mindmg: 5, maxdmg: 55, delay: 30, bodytype: 1, class: 1,
  traits: [], proc: 0, pts: [[100, 200, 3]], ...extra,
});

// ── the pure half, on its own ────────────────────────────────────────────────────────────────────────────────
describe('pickCharmPetSpell — which charm the list is for', () => {
  let c;
  beforeEach(() => { c = load({ dir: os.tmpdir(), opts: { botUrl: 'http://127.0.0.1:9/api/agent/encounter', token: 't' }, net: fakeNet() }); });
  const names = (r) => r && r.spell && r.spell.name;

  it('assumes the highest charm the class has at this level when there is no spellbook', () => {
    expect(c.pickCharmPetSpell('Enchanter', 65, null)).toMatchObject({ basis: 'assumed', bookChecked: false });
    expect(names(c.pickCharmPetSpell('Enchanter', 65, null))).toBe('Command of Druzzil');
    expect(names(c.pickCharmPetSpell('Enchanter', 63, null))).toBe('Beckon');
    expect(names(c.pickCharmPetSpell('Enchanter', 61, null))).toBe("Boltran's Agacerie");
    expect(names(c.pickCharmPetSpell('Enchanter', 49, null))).toBe('Allure');
    expect(names(c.pickCharmPetSpell('Enchanter', 12, null))).toBe('Charm');
  });

  it('the class level gates the assumption: a charm one level above you is not yours yet', () => {
    expect(names(c.pickCharmPetSpell('Enchanter', 63, null))).toBe('Beckon');       // Command needs 64
    expect(names(c.pickCharmPetSpell('Enchanter', 64, null))).toBe('Command of Druzzil');
    expect(names(c.pickCharmPetSpell('Enchanter', 61, null))).not.toBe('Beckon');   // Beckon needs 62
  });

  it('never assumes Dictate (an area charm that lives 48 s) while anything else fits', () => {
    expect(names(c.pickCharmPetSpell('Enchanter', 60, null))).toBe("Boltran's Agacerie");
  });

  it('...but Dictate is the answer when it is the only charm the spellbook holds', () => {
    expect(names(c.pickCharmPetSpell('Enchanter', 65, new Set([1707])))).toBe('Dictate');
    expect(names(c.pickCharmPetSpell('Enchanter', 65, new Set([1707, 300])))).toBe('Charm');
  });

  it('the spellbook decides over the level: a 65 who only has Charm scribed gets Charm', () => {
    const r = c.pickCharmPetSpell('Enchanter', 65, new Set([300, 9999]));
    expect(names(r)).toBe('Charm');
    expect(r).toMatchObject({ basis: 'spellbook', bookChecked: true });
  });

  it('takes the highest of what the spellbook holds, and counts either catalog row of a duplicated spell', () => {
    expect(names(c.pickCharmPetSpell('Enchanter', 65, new Set([300, 183, 184])))).toBe('Allure');
    expect(names(c.pickCharmPetSpell('Enchanter', 65, new Set([1705, 184])))).toBe("Boltran's Agacerie");
    expect(names(c.pickCharmPetSpell('Enchanter', 65, new Set([1706, 184])))).toBe("Boltran's Agacerie");
  });

  it('a spellbook with no charm in it falls back to the level, and says it looked', () => {
    const r = c.pickCharmPetSpell('Enchanter', 65, new Set([1, 2, 3]));
    expect(names(r)).toBe('Command of Druzzil');
    expect(r).toMatchObject({ basis: 'assumed', bookChecked: true });
  });

  it('an empty spellbook set is no spellbook', () => {
    expect(c.pickCharmPetSpell('Enchanter', 65, new Set())).toMatchObject({ basis: 'assumed', bookChecked: false });
  });

  it('too low a level, or no level yet, is a reason and no spell', () => {
    expect(c.pickCharmPetSpell('Enchanter', 11, null)).toEqual({ spell: null, reason: 'low', bookChecked: false });
    expect(c.pickCharmPetSpell('Enchanter', null, null)).toEqual({ spell: null, reason: 'level', bookChecked: false });
    expect(c.pickCharmPetSpell('Enchanter', 0, null)).toMatchObject({ reason: 'level' });
  });

  it('a class with no charm line is null', () => {
    expect(c.pickCharmPetSpell('Warrior', 65, null)).toBeNull();
    expect(c.pickCharmPetSpell('Cleric', 65, null)).toBeNull();
    expect(c.pickCharmPetSpell(null, 65, null)).toBeNull();
  });

  it('knows each charming class, with Quarm\'s own class levels', () => {
    expect(names(c.pickCharmPetSpell('Bard', 64, null))).toBe('Call of the Banshee');
    expect(names(c.pickCharmPetSpell('Bard', 60, null))).toBe("Solon's Bewitching Bravura");
    expect(names(c.pickCharmPetSpell('Druid', 60, null))).toBe('Call of Karana');       // Tunare's Request is cap 35
    expect(names(c.pickCharmPetSpell('Druid', 63, null))).toBe('Command of Tunare');
    expect(names(c.pickCharmPetSpell('Necromancer', 60, null))).toBe('Enslave Death');
    expect(names(c.pickCharmPetSpell('Necromancer', 65, null))).toBe('Word of Terris');
    expect(names(c.pickCharmPetSpell('Magician', 65, null))).toBe('Call of the Arch Mage');
    expect(c.pickCharmPetSpell('Magician', 64, null).reason).toBe('low');
    expect(names(c.pickCharmPetSpell('Shaman', 34, null))).toBe('Charm Animals');
    expect(names(c.pickCharmPetSpell('Shaman', 29, null))).toBe('Befriend Animal');
  });

  it('every table row is well-formed: ids, a cap above zero, a known target type and a class level', () => {
    for (const s of c.CHARM_PET_SPELLS) {
      expect(s.ids.length).toBeGreaterThan(0);
      expect(s.cap).toBeGreaterThan(0);
      expect([5, 9, 10, 11, 16]).toContain(s.tt);
      expect(Object.values(s.cls).every(v => v >= 1 && v <= 65)).toBe(true);
    }
    const ids = c.CHARM_PET_SPELLS.flatMap(s => s.ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('charmPetBodyOk — the body-type limit of an animal / undead / summoned / plant charm', () => {
  let c;
  beforeEach(() => { c = load({ dir: os.tmpdir(), opts: {}, net: fakeNet() }); });
  it('the general single-target charm takes any body', () => {
    for (const bt of [1, 3, 21, 24, 25, 99]) expect(c.charmPetBodyOk(5, bt)).toBe(true);
  });
  it('animal charms take Animal (21) only', () => {
    expect(c.charmPetBodyOk(9, 21)).toBe(true);
    for (const bt of [1, 3, 22, 24]) expect(c.charmPetBodyOk(9, bt)).toBe(false);
  });
  it('undead charms take Undead 3, Summoned Undead 8 and Vampire 12', () => {
    for (const bt of [3, 8, 12]) expect(c.charmPetBodyOk(10, bt)).toBe(true);
    for (const bt of [1, 21, 24]) expect(c.charmPetBodyOk(10, bt)).toBe(false);
  });
  it('summoned charms take Summoned 24, 27 and 28', () => {
    for (const bt of [24, 27, 28]) expect(c.charmPetBodyOk(11, bt)).toBe(true);
    for (const bt of [1, 3, 21, 26]) expect(c.charmPetBodyOk(11, bt)).toBe(false);
  });
  it('plant charms take Plant (25) only; an unknown target type takes nothing', () => {
    expect(c.charmPetBodyOk(16, 25)).toBe(true);
    expect(c.charmPetBodyOk(16, 24)).toBe(false);
    expect(c.charmPetBodyOk(7, 1)).toBe(false);
  });
});

describe('rankCharmPets — filter by the spell, then rank', () => {
  let c;
  beforeEach(() => { c = load({ dir: os.tmpdir(), opts: {}, net: fakeNet() }); });
  const any = (cap, tt = 5) => ({ cap, tt, name: 'x', ids: [1], cls: {} });
  const ranked = (npcs, spell) => c.rankCharmPets(npcs, spell).pets.map(p => p.name);

  it('the level cap is inclusive: a mob AT the cap is in, one above is out', () => {
    const r = ranked([npc(1, 'at cap', { level: 53 }), npc(2, 'over cap', { level: 54 })], any(53));
    expect(r).toEqual(['at cap']);
  });

  it('judges a mob by its LOWEST level, and marks one that can roll past the cap', () => {
    const r = c.rankCharmPets([npc(1, 'rolls high', { level: 51, maxlevel: 55 }), npc(2, 'safe', { level: 50, maxlevel: 53 })], any(53)).pets;
    expect(r.find(p => p.name === 'rolls high')).toMatchObject({ over: true, maxlevel: 55 });
    expect(r.find(p => p.name === 'safe')).toMatchObject({ over: false });
  });

  it('an animal charm keeps animals, an undead charm keeps undead, and the general charm keeps both', () => {
    const zone = [npc(1, 'a wolf', { bodytype: 21 }), npc(2, 'a ghoul', { bodytype: 3 }), npc(3, 'a gnoll', { bodytype: 1 })];
    expect(ranked(zone, any(60, 9))).toEqual(['a wolf']);
    expect(ranked(zone, any(60, 10))).toEqual(['a ghoul']);
    expect(ranked(zone, any(60, 5)).sort()).toEqual(['a ghoul', 'a gnoll', 'a wolf']);
  });

  it('estimates damage per second as the average hit over the swing time (delay is tenths of a second)', () => {
    expect(c.charmPetDps({ mindmg: 10, maxdmg: 50, delay: 30 })).toBeCloseTo(10, 5);   // 30 / 3.0 s
    expect(c.charmPetDps({ mindmg: 10, maxdmg: 50, delay: 15 })).toBeCloseTo(20, 5);   // twice as fast, twice the damage
    expect(c.charmPetDps({ mindmg: 10, maxdmg: 50, delay: 0 })).toBeCloseTo(10, 5);    // no delay on record: the 3.0 s default
    expect(c.rankCharmPets([npc(1, 'a', { mindmg: 1, maxdmg: 62, delay: 21 })], any(60)).pets[0].dps).toBe(15);
  });

  it('ranks the harder hitter first', () => {
    const r = ranked([npc(1, 'weak', { maxdmg: 20 }), npc(2, 'strong', { maxdmg: 120 }), npc(3, 'middling', { maxdmg: 60 })], any(60));
    expect(r).toEqual(['strong', 'middling', 'weak']);
  });

  it('a faster swing outranks a harder hit of the same average', () => {
    const r = ranked([npc(1, 'slow', { mindmg: 10, maxdmg: 70, delay: 30 }), npc(2, 'quick', { mindmg: 10, maxdmg: 70, delay: 20 })], any(60));
    expect(r).toEqual(['quick', 'slow']);
  });

  it('inside 10% of each other the tougher one goes first, outside it damage decides', () => {
    // 9.0 vs 9.4 dps: a tie (same 10% step) -> HP decides
    const tie = ranked([npc(1, 'glass', { mindmg: 0, maxdmg: 54, hp: 400 }), npc(2, 'tank', { mindmg: 0, maxdmg: 56, hp: 3000 })], any(60));
    expect(tie).toEqual(['tank', 'glass']);
    const tie2 = ranked([npc(1, 'tank', { mindmg: 0, maxdmg: 54, hp: 3000 }), npc(2, 'glass', { mindmg: 0, maxdmg: 56, hp: 400 })], any(60));
    expect(tie2).toEqual(['tank', 'glass']);
    // 9 vs 15 dps: not a tie
    const apart = ranked([npc(1, 'tank', { mindmg: 0, maxdmg: 54, hp: 9000 }), npc(2, 'hitter', { mindmg: 0, maxdmg: 90, hp: 400 })], any(60));
    expect(apart).toEqual(['hitter', 'tank']);
  });

  it('then the higher level breaks an exact tie', () => {
    expect(ranked([npc(1, 'low', { level: 20 }), npc(2, 'high', { level: 40 })], any(60))).toEqual(['high', 'low']);
  });

  it('shows one row per name (the best of them)', () => {
    const r = c.rankCharmPets([npc(1, 'a shadowed man', { maxdmg: 40 }), npc(2, 'a shadowed man', { maxdmg: 90 }), npc(3, 'A Shadowed Man', { maxdmg: 10 })], any(60));
    expect(r.pets).toHaveLength(1);
    expect(r.pets[0]).toMatchObject({ id: 2 });
    expect(r.total).toBe(1);
  });

  it('keeps the top 8 and says how many there were', () => {
    const many = Array.from({ length: 12 }, (_, i) => npc(i + 1, 'mob ' + i, { maxdmg: 10 + i * 20 }));
    const r = c.rankCharmPets(many, any(60));
    expect(r.pets).toHaveLength(8);
    expect(r.total).toBe(12);
    expect(r.pets[0].name).toBe('mob 11');
    expect(r.pets.map(p => p.name)).not.toContain('mob 0');
  });

  it('copies /target <name>, and /map y x from the first spawn point (the server frame is /loc\'s second number first)', () => {
    const p = c.rankCharmPets([npc(1, 'a firescale crocodile', { pts: [[-120, 345, 9], [5, 5, 5]] })], any(60)).pets[0];
    expect(p.cmd_target).toBe('/target a firescale crocodile');
    expect(p.cmd_map).toBe('/map 345 -120');
    expect(c.rankCharmPets([npc(2, 'no point', { pts: [] })], any(60)).pets[0].cmd_map).toBeNull();
  });

  it('survives a payload with junk in it', () => {
    expect(c.rankCharmPets(null, any(60))).toEqual({ total: 0, pets: [] });
    expect(c.rankCharmPets([null, {}, { level: 0 }, npc(1, 'ok')], any(60)).pets.map(p => p.name)).toEqual(['ok']);
  });
});

describe('charmPetChips — the "why", at most three', () => {
  let c;
  beforeEach(() => { c = load({ dir: os.tmpdir(), opts: {}, net: fakeNet() }); });
  it('names what makes a pet good, in the order that matters', () => {
    expect(c.charmPetChips(npc(1, 'x', { traits: ['summon'] }))).toEqual(['summons']);
    expect(c.charmPetChips(npc(1, 'x', { traits: ['flurry', 'triple'], proc: 1, delay: 20 }))).toEqual(['flurry', 'triple', 'proc']);
    expect(c.charmPetChips(npc(1, 'x', { traits: ['rampage'] }))).toEqual(['rampage']);
    expect(c.charmPetChips(npc(1, 'x', { traits: ['area_rampage'] }))).toEqual(['rampage']);
    expect(c.charmPetChips(npc(1, 'x', { traits: ['dual'] }))).toEqual(['dual wield']);
  });
  it('caps at three, however many apply', () => {
    expect(c.charmPetChips(npc(1, 'x', { traits: ['summon', 'flurry', 'triple', 'dual', 'rampage'], proc: 1, delay: 18 }))).toEqual(['summons', 'flurry', 'triple']);
  });
  it('"fast" is a swing of 2.2 s or quicker, and an ordinary mob has no chip', () => {
    expect(c.charmPetChips(npc(1, 'x', { delay: 22 }))).toEqual(['fast']);
    expect(c.charmPetChips(npc(1, 'x', { delay: 23 }))).toEqual([]);
    expect(c.charmPetChips(npc(1, 'x', { traits: ['magical'] }))).toEqual([]);
    expect(c.charmPetChips(npc(1, 'x', { traits: undefined }))).toEqual([]);
  });
});

// ── this machine's half ──────────────────────────────────────────────────────────────────────────────────────
const BODY = {
  zone: 'lavastorm', long_name: 'Lavastorm Mountains', generated_at: '2026-10-14T00:00:00Z',
  npcs: [
    npc(27050, 'a firescale crocodile', { level: 26, maxlevel: 30, hp: 920, maxdmg: 64, bodytype: 21 }),
    npc(27062, 'Tisiana', { level: 45, hp: 5875, mindmg: 40, maxdmg: 224, delay: 29 }),
    npc(27001, 'a warbone monk', { level: 12, bodytype: 3, maxdmg: 26 }),
    npc(27119, 'Brackwyn Vale', { level: 55, hp: 14000, mindmg: 68, maxdmg: 165, delay: 18, traits: ['summon', 'flurry'] }),
  ],
};
const T0 = Date.UTC(2026, 9, 14, 20, 0, 0);
const BOT = { botUrl: 'http://127.0.0.1:9/api/agent/encounter', token: 'tok' };

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'charmpets-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function seed(body = BODY, { etag = '"v1"', fetchedAt = T0 } = {}) {
  fs.mkdirSync(path.join(dir, 'charm-pets-cache'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'charm-pets-cache', 'lavastorm.json'), JSON.stringify({ etag, fetched_at: fetchedAt, body }));
}
// A core with Aldenmar, an L65 enchanter, standing in Lavastorm (zone 27).
function core(opts, net) {
  const c = load({ dir, opts, net: net || fakeNet() });
  c._who.set('aldenmar', { cls: 'Enchanter', level: 65 });
  c._zealState.Aldenmar = { zone: 27, updatedAt: 1e18 };
  return c;
}

describe('the list for a zone (disk first, the bot second)', () => {
  it('first look asks the bot once, with the token, and shows "loading" until the answer lands', async () => {
    const net = fakeNet(() => ({ status: 200, etag: 'W/"abc"', body: BODY }));
    const c = core(BOT, net);
    const first = c.charmBestState(null, T0);
    expect(first).toMatchObject({ show: true, status: 'loading', char: 'Aldenmar' });
    expect(net.calls).toHaveLength(1);
    expect(net.calls[0].path).toBe('/api/agent/charm-pets?zone=lavastorm');
    expect(net.calls[0].headers.Authorization).toBe('Bearer tok');
    expect(c.charmBestState(null, T0).status).toBe('loading');   // still in flight: no second request
    expect(net.calls).toHaveLength(1);
    await tick();
    const done = c.charmBestState(null, T0 + 1000);
    expect(done.status).toBe('ok');
    expect(done.zone).toEqual({ id: 27, short: 'lavastorm', long: 'Lavastorm Mountains' });
    expect(done.pets.map(p => p.name)).toEqual(['Brackwyn Vale', 'Tisiana', 'a firescale crocodile', 'a warbone monk']);   // Command of Druzzil: cap 64, any mob
    expect(net.calls).toHaveLength(1);
  });

  it('keeps what it was told on disk, with the ETag, so the next run needs no call', async () => {
    const net = fakeNet(() => ({ status: 200, etag: 'W/"abc"', body: BODY }));
    const c = core(BOT, net);
    c.charmBestState(null, T0);
    await tick();
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'charm-pets-cache', 'lavastorm.json'), 'utf8'));
    expect(saved.etag).toBe('W/"abc"');
    expect(saved.body.npcs).toHaveLength(4);
    const net2 = fakeNet();
    const again = core(BOT, net2);
    expect(again.charmBestState(null, T0 + 3600_000).status).toBe('ok');
    expect(net2.calls).toHaveLength(0);
  });

  it('a held zone is revalidated with its ETag after a day, not before; a 304 keeps the list and restarts the day', async () => {
    const now = Date.now();                                                // a 304 stamps the real clock
    seed(BODY, { etag: 'W/"v1"', fetchedAt: now - 23 * 3600_000 });
    const early = fakeNet(() => ({ status: 304 }));
    expect(core(BOT, early).charmBestState(null, now).status).toBe('ok');
    expect(early.calls).toHaveLength(0);                                   // 23 h old: still fresh
    seed(BODY, { etag: 'W/"v1"', fetchedAt: now - 25 * 3600_000 });
    const net = fakeNet(() => ({ status: 304 }));
    const c = core(BOT, net);
    expect(c.charmBestState(null, now).status).toBe('ok');                 // answers from disk while it asks
    expect(net.calls).toHaveLength(1);
    expect(net.calls[0].headers['If-None-Match']).toBe('W/"v1"');
    await tick();
    expect(c.charmBestState(null, now + 3600_000).pets.length).toBeGreaterThan(0);
    expect(net.calls).toHaveLength(1);                                     // the 304 restarted the day
  });

  it('a 404 hides the section, and the bot is asked again in six hours, not before', async () => {
    const net = fakeNet(() => ({ status: 404 }));
    const c = core(BOT, net);
    c.charmBestState(null, T0);
    await tick();
    const t1 = Date.now();                                                 // the rec stamps retryAt from the real clock
    expect(c.charmBestState(null, t1)).toMatchObject({ show: true, status: 'hidden', pets: [] });
    expect(net.calls).toHaveLength(1);
    c.charmBestState(null, t1 + 3600_000);
    expect(net.calls).toHaveLength(1);
    c.charmBestState(null, t1 + 7 * 3600_000);
    expect(net.calls).toHaveLength(2);
  });

  it('a bot that has no such route yet is the same 404 — the overlay is simply not drawn', async () => {
    const c = core(BOT, fakeNet(() => ({ status: 404, body: '<html>Cannot GET</html>' })));
    c.charmBestState(null, T0);
    await tick();
    expect(c.charmBestState(null, Date.now()).status).toBe('hidden');
  });

  it('a failed ask (500, junk body) retries in ten minutes, and shows "loading" meanwhile', async () => {
    let status = 500;
    const net = fakeNet(() => (status === 500 ? { status: 500 } : { status: 200, body: { nope: 1 } }));
    const c = core(BOT, net);
    c.charmBestState(null, T0);
    await tick();
    const t1 = Date.now();
    expect(c.charmBestState(null, t1).status).toBe('loading');
    c.charmBestState(null, t1 + 5 * 60_000);
    expect(net.calls).toHaveLength(1);
    status = 200;
    c.charmBestState(null, t1 + 11 * 60_000);
    expect(net.calls).toHaveLength(2);
    await tick();
    expect(c.charmBestState(null, Date.now() + 12 * 60_000).status).toBe('loading');   // a body with no npcs is no list
    expect(fs.existsSync(path.join(dir, 'charm-pets-cache', 'lavastorm.json'))).toBe(false);
  });
});

describe('local mode and the control plane make no call', () => {
  it('local mode with nothing on disk says it needs the server, and asks nobody', () => {
    const net = fakeNet();
    const c = core({ botUrl: BOT.botUrl, token: '' }, net);
    expect(c.charmBestState(null, T0)).toMatchObject({ show: true, status: 'needs-server', pets: [] });
    c.charmBestState(null, T0 + 7 * 24 * 3600_000);
    expect(net.calls).toHaveLength(0);
  });

  it('local mode with a list already on disk shows it, however old, and still asks nobody', () => {
    seed(BODY, { fetchedAt: T0 - 90 * 24 * 3600_000 });
    const net = fakeNet();
    const c = core({ botUrl: BOT.botUrl, token: '' }, net);
    const s = c.charmBestState(null, T0);
    expect(s.status).toBe('ok');
    expect(s.pets.length).toBeGreaterThan(0);
    expect(net.calls).toHaveLength(0);
  });

  it('no token, no bot address, or no options at all: nothing is requested', () => {
    for (const opts of [{ botUrl: BOT.botUrl }, { token: 'tok' }, null]) {
      const net = fakeNet();
      const c = core(opts, net);
      c.charmBestState(null, T0);
      expect(net.calls).toHaveLength(0);
    }
  });

  it('the control plane\'s stand-down stops the asking too', () => {
    const net = fakeNet();
    const c = core(BOT, net);
    c._setDown(true);
    expect(c.charmBestState(null, T0).status).toBe('needs-server');
    expect(net.calls).toHaveLength(0);
    c._setDown(false);
    c.charmBestState(null, T0);
    expect(net.calls).toHaveLength(1);
  });
});

describe('the spell and the zone behind the list', () => {
  it('uses the spell the spellbook file holds, read from the folder the logs are in', () => {
    seed();
    fs.writeFileSync(path.join(dir, 'Aldenmar-Spellbook.txt'), ['Index\tSpellId\tLevel\tName', '1\t300\t12\tCharm', '2\t1705\t53\tBoltran\'s Agacerie', '3\t999\t10\tSomething'].join('\r\n'));
    fs.writeFileSync(path.join(dir, 'Aarwyn-Spellbook.txt'), '1\t3355\t64\tCommand of Druzzil');   // somebody else's book (listed first) is not read
    const c = core({ botUrl: BOT.botUrl, token: '' });
    c.stats.watchedLogs = [{ logPath: path.join(dir, 'eqlog_Aldenmar_pq.proj.txt') }];
    const s = c.charmBestState(null, T0);
    expect(s.spell).toMatchObject({ name: "Boltran's Agacerie", cap: 53, basis: 'spellbook', target: 'any mob' });
    // At cap 53 the L55 is out and the L45 is in.
    expect(s.pets.map(p => p.name)).toContain('Tisiana');
    expect(s.pets.map(p => p.name)).not.toContain('Brackwyn Vale');
  });

  it('without a spellbook file it assumes from level and labels the spell so', () => {
    seed();
    const c = core({ botUrl: BOT.botUrl, token: '' });
    c.stats.watchedLogs = [{ logPath: path.join(dir, 'eqlog_Aldenmar_pq.proj.txt') }];
    const s = c.charmBestState(null, T0);
    expect(s.spell).toMatchObject({ name: 'Command of Druzzil', cap: 64, basis: 'assumed', bookChecked: false });
    expect(s.pets.map(p => p.name)).toContain('Brackwyn Vale');
  });

  it('the book is re-read at most every 30 s, and at once when the file has changed after that', () => {
    seed();
    const file = path.join(dir, 'Aldenmar-Spellbook.txt');
    fs.writeFileSync(file, '1\t300\t12\tCharm');
    const c = core({ botUrl: BOT.botUrl, token: '' });
    c.stats.watchedLogs = [{ logPath: path.join(dir, 'eqlog_Aldenmar_pq.proj.txt') }];
    expect(c.charmBestState(null, T0).spell.name).toBe('Charm');
    fs.writeFileSync(file, '1\t300\t12\tCharm\r\n2\t184\t49\tAllure');
    fs.utimesSync(file, new Date(T0 + 5000), new Date(T0 + 5000));
    expect(c.charmBestState(null, T0 + 10_000).spell.name).toBe('Charm');      // inside the 30 s: not looked at
    expect(c.charmBestState(null, T0 + 40_000).spell.name).toBe('Allure');
  });

  it('a class with no charm line draws nothing; so does a character whose class is not known yet', () => {
    const c = core(BOT);
    c._who.set('aldenmar', { cls: 'Warrior', level: 65 });
    expect(c.charmBestState(null, T0)).toMatchObject({ show: false });
    c._who.delete('aldenmar');
    expect(c.charmBestState(null, T0)).toMatchObject({ show: false });
  });

  it('too low a level shows the section with its reason, not a list', () => {
    const c = core(BOT);
    c._who.set('aldenmar', { cls: 'Enchanter', level: 8 });
    expect(c.charmBestState(null, T0)).toMatchObject({ show: true, status: 'no-spell', spellReason: 'low', level: 8 });
  });

  it('no zone yet, or a zone the agent has no short name for, is "no-zone" (and asks nobody)', () => {
    const net = fakeNet();
    const c = core(BOT, net);
    c._zealState.Aldenmar = { zone: 0, updatedAt: 1e18 };
    expect(c.charmBestState(null, T0)).toMatchObject({ show: true, status: 'no-zone' });
    c._zealState.Aldenmar = { zone: 9999, updatedAt: 1e18 };
    expect(c.charmBestState(null, T0).status).toBe('no-zone');
    expect(net.calls).toHaveLength(0);
  });

  it('follows the focused window, and ?char= picks another', () => {
    seed();
    const c = core({ botUrl: BOT.botUrl, token: '' });
    c._who.set('brackwyn', { cls: 'Druid', level: 60 });
    c._zealState.Brackwyn = { zone: 27, updatedAt: 1e18 + 1e6 };
    expect(c.charmBestState(null, T0).char).toBe('Brackwyn');
    expect(c.charmBestState('Aldenmar', T0).char).toBe('Aldenmar');
    expect(c.charmBestState(null, T0).spell.target).toBe('animals');
  });

  it('a window that has been quiet for a minute is not the focused one', () => {
    const c = core(BOT);
    c._zealState.Aldenmar = { zone: 27, updatedAt: T0 - 61_000 };
    expect(c.charmBestState(null, T0)).toMatchObject({ char: null, show: false });
  });

  it('an animal charm in the same zone keeps only the animals', () => {
    seed();
    const c = core({ botUrl: BOT.botUrl, token: '' });
    c._who.set('aldenmar', { cls: 'Druid', level: 60 });
    const s = c.charmBestState(null, T0);
    expect(s.spell).toMatchObject({ name: 'Call of Karana', target: 'animals' });
    expect(s.pets.map(p => p.name)).toEqual(['a firescale crocodile']);
  });
});

// ── the overlay page ─────────────────────────────────────────────────────────────────────────────────────────
describe('apps/mimic/charm.html — the section', () => {
  const code = stripJs(CHARM_HTML);

  it('draws collapsed by default, and the toggle is a real button', () => {
    expect(CHARM_HTML).toMatch(/<button id="pets-toggle" type="button"/);
    expect(code).toMatch(/#pets-body\{display:none/);
    expect(code).toMatch(/#pets\.open #pets-body\{display:block\}/);
    expect(code).toMatch(/petsOpen = localStorage\.getItem\('wpCharmPetsOpen'\) === '1'/);   // closed unless it was left open
  });

  it('is hidden in the mini rendition', () => {
    expect(CHARM_HTML).toMatch(/<div id="pets" class="wp-mini-hide">/);
    expect(code).toMatch(/body\.wp-mini #pets\{display:none !important\}/);
  });

  it('asks the local agent only, and goes quiet on a 404 (an agent from before this)', () => {
    expect(code).toMatch(/fetch\('http:\/\/127\.0\.0\.1:' \+ PORT \+ '\/api\/charm-best'/);
    expect(code).toMatch(/if \(r\.status === 404\) \{ petsGone = true;/);
    expect(code).not.toMatch(/pqdi|wolfpack\.quest|up\.railway/);
  });

  it('copies /target on the name and /map on the map chip, both real buttons that carry their command', () => {
    expect(code).toMatch(/class="pm" data-cmd="' \+ esc\(p\.cmd_target\)/);
    expect(code).toMatch(/<button type="button" class="loc" data-cmd="' \+ esc\(p\.cmd_map\)/);
    expect(code).toMatch(/closest\('button\[data-cmd\]'\)/);
  });

  it('runs its script against a stub page: hidden until the agent says it is a charm class, then draws the rows', async () => {
    const scriptSrc = CHARM_HTML.match(/<script>([\s\S]*)<\/script>/)[1];
    const els = {};
    const mk = (id) => (els[id] = {
      id, style: {}, dataset: {}, children: [], _html: '', textContent: '',
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { if (on === undefined ? !this._s.has(c) : on) this._s.add(c); else this._s.delete(c); return this._s.has(c); }, contains(c) { return this._s.has(c); } },
      addEventListener(ev, fn) { (this._ev = this._ev || {})[ev] = fn; },
      get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; },
      querySelector() { return { textContent: '' }; },
      closest() { return null; }, scrollHeight: 100, value: '0', getAttribute() { return null; },
    });
    ['conn', 'list', 'empty', 'pets', 'pets-body', 'pets-toggle', 'pets-ct', 'move-btn', 'hide-btn', 'move-handle', 'lock-btn',
      'opacitySlider', 'opacityVal', 'warnAt', 'exitSetupBtn'].forEach(mk);
    const store = {};
    const sandbox = {
      document: { getElementById: (id) => els[id] || mk(id), body: { classList: els.pets.classList, appendChild() {} }, documentElement: { style: { setProperty() {} } }, createElement: () => mk('x'), addEventListener() {} },
      window: { mimic: undefined, addEventListener() {}, speechSynthesis: undefined },
      localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
      navigator: {}, console, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, Map, Set, Math, Date, JSON, parseInt, parseFloat, String, Number, Array, Promise,
    };
    const responses = [];
    sandbox.fetch = async (url) => {
      if (url.includes('/api/charm-best')) return responses.shift() || { status: 404 };
      return { status: 200, json: async () => ({}) };
    };
    const names = Object.keys(sandbox);
    // eslint-disable-next-line no-new-func
    const run = new Function(...names, scriptSrc + '\nreturn { petsApply, petsHtml };');
    const api = run(...names.map(n => sandbox[n]));
    api.petsApply({ ok: true, show: false, status: 'no-zone' });
    expect(els.pets.classList.contains('on')).toBe(false);                  // a class with no charm line: nothing drawn
    api.petsApply({ ok: true, show: true, status: 'hidden' });
    expect(els.pets.classList.contains('on')).toBe(false);                  // the bot has nothing for this zone: nothing drawn
    api.petsApply({
      ok: true, show: true, status: 'ok', total: 11, zone: { long: 'Lavastorm Mountains' },
      spell: { name: 'Command of Druzzil', cap: 64, target: 'any mob', basis: 'assumed', bookChecked: false },
      pets: [{ id: 1, name: 'Brackwyn Vale', level: 55, maxlevel: 58, over: true, hp: 14000, dps: 54.8, delay: 18, chips: ['summons', 'flurry'], cmd_target: '/target Brackwyn Vale', cmd_map: '/map 345 -120' }],
    });
    expect(els.pets.classList.contains('on')).toBe(true);
    const html = els['pets-body'].innerHTML;
    expect(html).toContain('Command of Druzzil');
    expect(html).toContain('assumed from level');
    expect(html).toContain('L55-58*');
    expect(html).toContain('54.8</b> dps · 14k hp');
    expect(html).toContain('data-cmd="/target Brackwyn Vale"');
    expect(html).toContain('data-cmd="/map 345 -120"');
    expect(html).toContain('top 1 of 11');
    expect(els['pets-ct'].textContent).toBe('11');
  });
});
