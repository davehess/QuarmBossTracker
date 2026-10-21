// test/see-invis-con.test.js — "Can see invis" is a claim; a /consider made while invisible is the evidence.
//
// The guild lead, 2026-10-21: "WHEN SOMETHING can see invis but doesn't we should mark CAN see invis, and then cancel
// it out when it doesn't by con and invis".
//
// The server rule this leans on (EQMacEmu zone/client.cpp Client::GetFactionLevel): a mob that cannot see an invisible
// player is forced to FACTION_INDIFFERENTLY before faction is read. So invisible + indifferent = it could not see you
// (or it is simply indifferent to you — hence "firm" only with a non-indifferent visible baseline), invisible + any
// other tier = it saw you, and threateningly is no evidence (a hate-listed mob cons threatening unseen too).
//
// Behaviour, not text: this runs the real noteSightCon / classifyInvisCon / seeInvisObsFor out of the agent and the
// real sightChips out of mobinfo.html.
//
// Run: npx vitest run test/see-invis-con.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, AGENT_INDEX, readSource, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const agent = readSource(AGENT_INDEX);

// The real con table + regex, the real timestamp parse and case key, and the block under test; the world around it
// (Zeal, the catalog, the spawn id) is a stub the test drives.
const prefix = [
  sliceBlock(agent, 'const CON_STANDINGS = [', '\n];'),
  sliceBlock(agent, 'const _CON_RX = new RegExp(', "'i');"),
  sliceBlock(agent, 'const TS_RX = ', '\n'),
  sliceBlock(agent, 'function parseEqTimestamp(line) {', '\n}\n'),
  sliceBlock(agent, 'function _mobCaseKey(n) {', 'toLowerCase() + s.slice(1);\n}\n'),
  'const _zealState = {}; let _knownNpc = true; let _spawnId = null;',
  'function _knownNpcNotPlayer() { return _knownNpc; }',
  'function _provableTargetId() { return _spawnId; }',
].join('\n');
const block = sliceBlock(agent, 'const SELF_INVIS_SPELLS = new Set([', '  return { saw: rec.saw, firm: rec.firm, at_ms: rec.at, exact: !!exactRec };\n}\n');
const api = evalBlock(
  prefix + '\n' + block + '\nconst __set = (z, k, s) => { for (const x of Object.keys(_zealState)) delete _zealState[x]; Object.assign(_zealState, z); _knownNpc = k; _spawnId = s; };',
  ['noteSightCon', 'classifyInvisCon', 'seeInvisObsFor', '__set', '_sightObs', '_sightBaseline'],
);

const NOW = new Date('Wed Oct 21 14:00:06 2026').getTime();
const ME = 'Aldenmar';
const con = (mob, phrase, ts = 'Wed Oct 21 14:00:05 2026') => `[${ts}] ${mob} ${phrase} -- what would you like your tombstone to say?`;
const INDIFF = 'regards you indifferently';
const SCOWL = 'scowls at you, ready to attack';
const THREAT = 'glares at you threateningly';
const AMIABLE = 'judges you amiably';
const zeal = (buffs, updatedAt = NOW) => ({ [ME]: { updatedAt, buffs } });
const INVIS = [{ name: 'Invisibility', ticks: 30 }];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  api.__set(zeal(INVIS), true, null);
  api._sightObs.clear();
  api._sightBaseline.clear();
});
afterEach(() => vi.useRealTimers());

describe('what a con says about sight, by the server rule', () => {
  it('indifferent with no baseline is soft; with a non-indifferent baseline it is firm', () => {
    expect(api.classifyInvisCon(4, null)).toEqual({ saw: false, firm: false });
    expect(api.classifyInvisCon(4, 0)).toEqual({ saw: false, firm: true });
    expect(api.classifyInvisCon(4, 5)).toEqual({ saw: false, firm: true });
  });
  it('a baseline that was itself indifferent or threatening proves nothing', () => {
    expect(api.classifyInvisCon(4, 4).firm).toBe(false);
    expect(api.classifyInvisCon(4, 1).firm).toBe(false);
  });
  it('threateningly is no evidence (a hate list makes it threatening unseen)', () => {
    expect(api.classifyInvisCon(1, null)).toBeNull();
    expect(api.classifyInvisCon(1, 0)).toBeNull();
  });
  it('every other tier means it saw you', () => {
    for (const rank of [0, 2, 3, 5, 6, 7, 8]) expect(api.classifyInvisCon(rank, null)).toEqual({ saw: true, firm: true });
  });
});

describe('noteSightCon', () => {
  it('cancels the claim: visible scowl, then indifferent while invisible', () => {
    api.__set(zeal([]), true, null);
    expect(api.noteSightCon(con('a gnoll', SCOWL), ME)).toBeNull();           // visible: only a baseline
    expect(api.seeInvisObsFor('a gnoll', null)).toBeNull();
    api.__set(zeal(INVIS), true, null);
    const rec = api.noteSightCon(con('a gnoll', INDIFF), ME);
    expect(rec).toMatchObject({ saw: false, firm: true });
    expect(api.seeInvisObsFor('a gnoll', null)).toMatchObject({ saw: false, firm: true, exact: false });
  });

  it('indifferent while invisible with no visible baseline is the soft reading', () => {
    expect(api.noteSightCon(con('a gnoll', INDIFF), ME)).toMatchObject({ saw: false, firm: false });
  });

  it('a visible indifferent con does not become a baseline', () => {
    api.__set(zeal([]), true, null);
    api.noteSightCon(con('a gnoll', INDIFF), ME);
    api.__set(zeal(INVIS), true, null);
    expect(api.noteSightCon(con('a gnoll', INDIFF), ME).firm).toBe(false);
  });

  it('confirms: any non-indifferent con while invisible', () => {
    expect(api.noteSightCon(con('a gnoll', AMIABLE), ME)).toMatchObject({ saw: true });
    expect(api.seeInvisObsFor('a gnoll', null)).toMatchObject({ saw: true });
  });

  it('records nothing for threateningly', () => {
    expect(api.noteSightCon(con('a gnoll', THREAT), ME)).toBeNull();
    expect(api.seeInvisObsFor('a gnoll', null)).toBeNull();
  });

  it('only plain invisibility counts: See Invisible and Invisibility versus Undead do not make you invisible', () => {
    for (const name of ['See Invisible', 'Invisibility versus Undead', 'Spirit of Wolf']) {
      api.__set(zeal([{ name, ticks: 30 }]), true, null);
      expect(api.noteSightCon(con('a gnoll', INDIFF), ME)).toBeNull();
    }
    expect(api.seeInvisObsFor('a gnoll', null)).toBeNull();
  });

  it('knows the log spells the possessive with a straight quote or a backtick', () => {
    api.__set(zeal([{ name: "Shauri's Sonorous Clouding", ticks: 3 }]), true, null);
    expect(api.noteSightCon(con('a gnoll', AMIABLE), ME)).toMatchObject({ saw: true });
  });

  it('treats the last tick of an invisibility as visible', () => {
    api.__set(zeal([{ name: 'Invisibility', ticks: 1 }]), true, null);
    expect(api.noteSightCon(con('a gnoll', INDIFF), ME)).toBeNull();
  });

  it('says nothing when Zeal is not live (cannot tell if you were invisible)', () => {
    api.__set(zeal(INVIS, NOW - 60_000), true, null);
    expect(api.noteSightCon(con('a gnoll', AMIABLE), ME)).toBeNull();
    api.__set({}, true, null);
    expect(api.noteSightCon(con('a gnoll', AMIABLE), ME)).toBeNull();
  });

  it('ignores a replayed (old) line and a player target', () => {
    expect(api.noteSightCon(con('a gnoll', AMIABLE, 'Wed Oct 21 12:00:00 2026'), ME)).toBeNull();
    api.__set(zeal(INVIS), false, null);                       // catalog does not know it, no article: a player
    expect(api.noteSightCon(con('Brackwyn', AMIABLE), ME)).toBeNull();
    expect(api.noteSightCon(con('a gnoll', AMIABLE), ME)).toMatchObject({ saw: true });   // an article name still counts
  });

  it('prefers the proven spawn id and falls back to the latest of that name', () => {
    api.__set(zeal(INVIS), true, 4012);
    api.noteSightCon(con('a gnoll', INDIFF), ME);
    expect(api.seeInvisObsFor('a gnoll', 4012)).toMatchObject({ saw: false, exact: true });
    expect(api.seeInvisObsFor('a gnoll', 4999)).toMatchObject({ saw: false, exact: false });
    api.__set(zeal(INVIS), true, 4999);
    api.noteSightCon(con('a gnoll', AMIABLE), ME);
    expect(api.seeInvisObsFor('a gnoll', 4012)).toMatchObject({ saw: false, exact: true });   // its own test still wins
    expect(api.seeInvisObsFor('a gnoll', 4999)).toMatchObject({ saw: true, exact: true });
  });

  it('forgets after an hour', () => {
    api.noteSightCon(con('a gnoll', AMIABLE), ME);
    vi.setSystemTime(NOW + 61 * 60_000);
    expect(api.seeInvisObsFor('a gnoll', null)).toBeNull();
  });
});

// ── the chip ────────────────────────────────────────────────────────────────
const html = readSource(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html'));
const { sightChips } = evalBlock(
  `function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }\n`
  + sliceBlock(html, '  function sightChips(mob, obs){', '\n  // The lull line on this mob'),
  ['sightChips'],
);
const claims = { undead: false, see_invis: true, see_invis_undead: true };
const none = { undead: false, see_invis: false, see_invis_undead: true };
const at = (saw, firm, extra = {}) => ({ saw, firm, at_ms: new Date('Wed Oct 21 14:00:05 2026').getTime(), exact: true, ...extra });

describe('the chip', () => {
  it('is the plain claim until a con has been made', () => {
    expect(sightChips(claims)).toContain('Can see invis');
    expect(sightChips(claims, null)).toContain('Can see invis');
    expect(sightChips(claims)).not.toContain('cancelled');
    expect(sightChips(claims)).not.toMatch(/Sees Invis/);
  });
  it('is cancelled, with the con time, when the con disproved it', () => {
    const out = sightChips(claims, at(false, true));
    expect(out).toContain("Can't see your invis · con 14:00");
    expect(out).toContain('chip sight cancelled');
  });
  it('is the softer wording when the con could be plain indifference', () => {
    const out = sightChips(claims, at(false, false));
    expect(out).toContain("Didn't react to your invis · con 14:00");
    expect(out).toContain('cancelled');
    expect(out).not.toContain("Can't see your invis");
  });
  it('is confirmed when it saw you, even if the catalog said it could not', () => {
    for (const m of [claims, none]) {
      const out = sightChips(m, at(true, true));
      expect(out).toContain('Sees invis ✓ · con 14:00');
      expect(out).not.toContain('cancelled');
      expect(out).not.toContain('Can see invis');
    }
  });
  it('draws nothing for a "could not see" test on a mob the catalog never flagged', () => {
    expect(sightChips(none, at(false, true))).toBe('');
  });
  it('leaves undead alone: plain invis is not the question there', () => {
    expect(sightChips({ undead: true, see_invis: true, see_invis_undead: false }, at(true, true))).toBe('');
    expect(sightChips({ undead: true, see_invis: true, see_invis_undead: true }, at(false, true))).toContain('Can see invis vs undead');
  });
});

// ── wired, not just right ──────────────────────────────────────────────────
describe('and it is actually wired in', () => {
  const agentClean = stripJs(agent);
  const htmlClean = stripJs(html);
  it('the live log path feeds the con in, after the Map one', () => {
    expect(agentClean).toMatch(/try \{ noteSightCon\(line, b\.character\); \} catch/);
  });
  it('Target Info and its history both carry the observation', () => {
    expect(agentClean).toMatch(/target_invis:\s+seeInvisObsFor\(st\.target_name, _curIdForRelay\)/);
    expect(agentClean).toMatch(/target_invis: seeInvisObsFor\(e\.name, null\)/);
  });
  it('the overlay hands the observation to the chip builder', () => {
    expect(htmlClean).toMatch(/var chips = sightChips\(mob, mi\.target_invis\)/);
  });
  it('the canvas piece reads it too', () => {
    expect(stripJs(fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'parts.js'), 'utf8'))).toMatch(/d\.mobInfo\.target_invis/);
  });
});
