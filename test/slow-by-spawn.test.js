// test/slow-by-spawn.test.js — FB-83: a slow lands on ONE spawn, not on every mob of that name.
//
// The report (the guild lead, 2026-10-16): "We're clearly not putting the right debuffs on the right mobs -
// this one had Tepid Deeds display but it was not actually slowed." The log hour had several "A War Boar" up at
// once, and the slow tracker was keyed by lowercased NAME alone, so a slow on one boar showed on all of them.
//
// The rule: an entry tied to a spawn id is CERTAIN for that id and excluded for any other; an entry with no id (a
// bystander line names no spawn) is shown only as UNCERTAIN, and only when nothing certain exists; a reader with no
// id (old Zeal) behaves as it always did.
//
// Runs the REAL functions sliced from the agent: noteSelfCast -> resolveSelfCastLanding -> _noteSlowForTarget ->
// _bestSlowForTarget, plus the callout tick. Mob names are the game's own.
//
// Run: npx vitest run test/slow-by-spawn.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

const agent = readSource(AGENT_INDEX);
const slowBlock = sliceBlock(agent, 'const SLOW_SPELLS = new Set([', '// ── end #130 slow status');

const TEPID = { id: 1594, name: 'Tepid Deeds', other: 'slows down.', dur: 65, durf: 7, good: 0 };
const BOAR = 'A War Boar';

function build({ zeal = {}, main = true } = {}) {
  // eslint-disable-next-line no-new-func
  return new Function('ZEAL', 'MAIN', 'TEPID', `
    const _zealState = ZEAL;
    const pushed = [];
    function _pushOverlay(o) { pushed.push(o); }
    function _rampageOnMainTarget() { return MAIN; }
    function _durTicksForLevel(f, d) { return Number(d) || 0; }
    function _assumedCasterLevel() { return 60; }
    function parseEqTimestamp() { return new Date(); }
    function _petOwnerByName() { return null; }
    const _spellByNameLower = new Map([[TEPID.name.toLowerCase(), TEPID]]);
    const _mobInfoByName = new Map();
    const CHARM_SPELLS = new Map();
    ${agent.match(/const _CAST_BEGIN_RX = [^\n]+/)[0]}
    ${agent.match(/const _recentSelfCast = new Map\(\);[^\n]*/)[0]}
    ${agent.match(/const SELF_CAST_WINDOW_MS = [^\n]+/)[0]}
    ${sliceBlock(agent, 'function _normMobName(v) {', '\n}')}
    ${sliceBlock(agent, 'function _provableTargetId(observer, targetName) {', '\n}')}
    ${sliceBlock(agent, 'function _zealTargetForChar(charLower) {', '\n}')}
    ${sliceBlock(agent, 'function noteSelfCast(line, character) {', '\n}')}
    ${sliceBlock(agent, 'function resolveSelfCastLanding(line, observer) {', '\n}')}
    ${sliceBlock(agent, 'function _normMobNameAgent(n) {', '\n}')}
    ${slowBlock}
    return { noteSelfCast, resolveSelfCastLanding, _noteSlowForTarget, _bestSlowForTarget, _refreshSlowFromAmbiguousLand,
             _maybeAnnounceSlowLand, _tickSlowCallouts, _slowsByTarget, _slowCalloutState, _watchedTargetId, pushed };
  `)(zeal, main, TEPID);
}
const zealOn = (target_name, target_id) => ({ Aldenmar: { target_name, target_id, updatedAt: Date.now() } });
const stamp = '[Fri Oct 16 20:00:00 2026]';
const CAST = `${stamp} You begin casting Tepid Deeds.`;
const LAND = `${stamp} ${BOAR} slows down.`;

// Our own cast at our own target, then the landing line — the path that can prove a spawn.
function selfCastLand(h, character = 'Aldenmar') {
  h.noteSelfCast(CAST, character);
  const evt = h.resolveSelfCastLanding(LAND, character);
  expect(evt).toBeTruthy();
  h._noteSlowForTarget(evt, character);
  return evt;
}
// A landing nobody can attribute to a spawn: a bystander line (parseDebuffLanding's shape, no _castTargetId).
function bystanderLand(h) {
  h._noteSlowForTarget({ spell_name: 'Tepid Deeds', target: BOAR, cast_at: new Date().toISOString(), dur_formula: 7, dur_ticks: 65 }, null);
}
const read = (h, id) => h._bestSlowForTarget('a war boar', Date.now(), id);

describe('self-cast: the Zeal target id at cast time ties the slow to that spawn', () => {
  it('certain on that id, nothing on the other boar', () => {
    const h = build({ zeal: zealOn(BOAR, 101) });
    selfCastLand(h);
    expect(read(h, 101)).toMatchObject({ name: 'Tepid Deeds', uncertain: false, caster: 'Aldenmar' });
    expect(read(h, 102)).toBeNull();
  });
  it('the id is the one at CAST time: swapping target before the land does not move it', () => {
    const zeal = zealOn(BOAR, 101);
    const h = build({ zeal });
    h.noteSelfCast(CAST, 'Aldenmar');
    zeal.Aldenmar.target_id = 102;   // the player tabbed to the other boar while the cast was landing
    h._noteSlowForTarget(h.resolveSelfCastLanding(LAND, 'Aldenmar'), 'Aldenmar');
    expect(read(h, 101)).toMatchObject({ uncertain: false });
    expect(read(h, 102)).toBeNull();
  });
  it('two boars each slowed by the same spell are two entries that do not collide', () => {
    const zeal = zealOn(BOAR, 101);
    const h = build({ zeal });
    selfCastLand(h);
    zeal.Aldenmar.target_id = 102;
    selfCastLand(h);
    expect(h._slowsByTarget.get('a war boar').size).toBe(2);
    expect(read(h, 101)).toMatchObject({ uncertain: false });
    expect(read(h, 102)).toMatchObject({ uncertain: false });
    expect(read(h, 103)).toBeNull();
  });
  it('a Zeal that sends no id (0 = no target) ties nothing: the entry is id-less', () => {
    const h = build({ zeal: zealOn(BOAR, 0) });
    selfCastLand(h);
    expect([...h._slowsByTarget.get('a war boar').values()][0].targetId).toBeNull();
  });
});

describe('a bystander landing line carries no id: uncertain for a reader that knows its spawn', () => {
  it('shown as uncertain on any id', () => {
    const h = build();
    bystanderLand(h);
    expect(read(h, 102)).toMatchObject({ name: 'Tepid Deeds', uncertain: true });
  });
  it('a certain entry wins, even over a stronger uncertain one', () => {
    const h = build({ zeal: zealOn(BOAR, 101) });
    h._noteSlowForTarget({ spell_name: "Turgur's Insects", target: BOAR, cast_at: new Date().toISOString(), dur_formula: 7, dur_ticks: 65 }, null);
    selfCastLand(h);   // Tepid Deeds (50%) on 101, weaker than the id-less Turgur's (75%)
    expect(read(h, 101)).toMatchObject({ name: 'Tepid Deeds', uncertain: false });
    expect(read(h, 102)).toMatchObject({ name: "Turgur's Insects", uncertain: true });
  });
  it('an ambiguous (shared-emote) uncertain slow stays "SLOWED" and uncertain', () => {
    const h = build();
    h._noteSlowForTarget({ spell_name: 'Tepid Deeds', target: BOAR, cast_at: new Date().toISOString(), dur_formula: 7, dur_ticks: 65, ambiguous: true }, null);
    expect(read(h, 102)).toMatchObject({ display_name: 'SLOWED', ambiguous: true, uncertain: true });
  });
});

describe('a reader with no id keeps today\'s behaviour (name only)', () => {
  it('sees an id-tied slow and an id-less one alike, never uncertain', () => {
    const h = build({ zeal: zealOn(BOAR, 101) });
    selfCastLand(h);
    expect(read(h, null)).toMatchObject({ name: 'Tepid Deeds', uncertain: false });
    expect(read(h, undefined)).toMatchObject({ name: 'Tepid Deeds', uncertain: false });
    const h2 = build();
    bystanderLand(h2);
    expect(read(h2, null)).toMatchObject({ name: 'Tepid Deeds', uncertain: false });
    expect(read(h2, 0)).toMatchObject({ uncertain: false });
  });
});

describe('_refreshSlowFromAmbiguousLand: refresh-only, and only what it cannot contradict', () => {
  const AMBIG = `${stamp} ${BOAR} slows down.`;
  function aged(h) {   // pull every entry's window back so a refresh is visible
    for (const e of h._slowsByTarget.get('a war boar').values()) { e.landedAtMs -= 60000; e.expiresAtMs -= 60000; }
  }
  it('never creates an entry', () => {
    const h = build();
    expect(h._refreshSlowFromAmbiguousLand(BOAR, AMBIG, Date.now(), 101)).toBe(false);
    expect(h._slowsByTarget.size).toBe(0);
  });
  it('leaves an entry tied to a DIFFERENT spawn alone', () => {
    const h = build({ zeal: zealOn(BOAR, 101) });
    selfCastLand(h);
    aged(h);
    const before = [...h._slowsByTarget.get('a war boar').values()][0].expiresAtMs;
    expect(h._refreshSlowFromAmbiguousLand(BOAR, AMBIG, Date.now(), 102)).toBe(false);
    expect([...h._slowsByTarget.get('a war boar').values()][0].expiresAtMs).toBe(before);
  });
  it('refreshes the entry tied to the observer\'s own target, and id-less ones', () => {
    const h = build({ zeal: zealOn(BOAR, 101) });
    selfCastLand(h);
    aged(h);
    const before = [...h._slowsByTarget.get('a war boar').values()][0].expiresAtMs;
    expect(h._refreshSlowFromAmbiguousLand(BOAR, AMBIG, Date.now(), 101)).toBe(true);
    expect([...h._slowsByTarget.get('a war boar').values()][0].expiresAtMs).toBeGreaterThan(before);
    const h2 = build();
    bystanderLand(h2);
    expect(h2._refreshSlowFromAmbiguousLand(BOAR, AMBIG, Date.now(), 102)).toBe(true);
  });
  it('with no id at all, refreshes as before', () => {
    const h = build({ zeal: zealOn(BOAR, 101) });
    selfCastLand(h);
    expect(h._refreshSlowFromAmbiguousLand(BOAR, AMBIG, Date.now(), null)).toBe(true);
  });
});

describe('callouts: a different spawn of the same name is silent when the watched target\'s id is known', () => {
  it('a slow proven on boar 102 does not announce while we watch boar 101', () => {
    const h = build({ zeal: zealOn(BOAR, 101) });
    const zeal = h._watchedTargetId(BOAR);
    expect(zeal).toBe(101);
    // our cast landed on 102 (cast-time id), while the watched client's target is 101
    h.noteSelfCast(CAST, 'Aldenmar');
    const evt = h.resolveSelfCastLanding(LAND, 'Aldenmar');
    evt._castTargetId = 102;
    h._noteSlowForTarget(evt, 'Aldenmar');
    expect(h.pushed).toHaveLength(0);
  });
  it('a slow proven on the watched spawn announces, naming its id', () => {
    const h = build({ zeal: zealOn(BOAR, 101) });
    selfCastLand(h);
    expect(h.pushed).toHaveLength(1);
    expect(h.pushed[0].text).toContain(`${BOAR} #101`);
  });
  it('an id-less landing still announces (nothing contradicts it)', () => {
    const h = build({ zeal: zealOn(BOAR, 101) });
    bystanderLand(h);
    expect(h.pushed).toHaveLength(1);
  });
  it('no id known anywhere: announces as before', () => {
    const h = build();
    bystanderLand(h);
    expect(h.pushed).toHaveLength(1);
  });
  it('switching to another boar is a target switch, not a "slow dropped"', () => {
    const zeal = zealOn(BOAR, 101);
    const h = build({ zeal });
    selfCastLand(h);
    h.pushed.length = 0;
    zeal.Aldenmar.target_id = 102;   // the watched target moved to the unslowed boar
    h._tickSlowCallouts();
    expect(h.pushed).toHaveLength(0);
    expect(h._slowCalloutState.has('a war boar')).toBe(false);
  });
  it('the same spell then landing on the other boar we now watch is announced again', () => {
    const zeal = zealOn(BOAR, 101);
    const h = build({ zeal });
    selfCastLand(h);
    zeal.Aldenmar.target_id = 102;
    selfCastLand(h);
    expect(h.pushed).toHaveLength(2);
    expect(h.pushed[1].text).toContain(`${BOAR} #102`);
  });
  it('the slow wearing off on the SAME spawn still calls the drop', () => {
    const h = build({ zeal: zealOn(BOAR, 101) });
    selfCastLand(h);
    h.pushed.length = 0;
    for (const e of h._slowsByTarget.get('a war boar').values()) { e.landedAtMs -= 600000; e.expiresAtMs = Date.now() - 10000; }
    h._tickSlowCallouts();
    expect(h.pushed).toHaveLength(1);
    expect(h.pushed[0].trigger).toBe('Slow dropped');
  });
});

describe('the readers hand their spawn id to the tracker', () => {
  const clean = stripJs(agent);
  it('the Me HUD and Target Info both pass the Zeal target id', () => {
    expect(clean).toContain('_bestSlowForTarget(tl, now, st.target_id)');
    expect(clean).toContain('_bestSlowForTarget(tnameLower, Date.now(), _curIdForRelay)');
  });
  it('the ambiguous-refresh call site passes the observer\'s provable target id', () => {
    expect(clean).toContain('_landingTargetId(b.character, { target: _sm[1] })');
  });
});

describe('the overlays render "uncertain" dimmed and with a question mark', () => {
  it('Target Info (badge and mini row) and the Me HUD', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
    const mob = fs.readFileSync(path.join(root, 'apps', 'mimic', 'mobinfo.html'), 'utf8');
    const me = fs.readFileSync(path.join(root, 'apps', 'mimic', 'me.html'), 'utf8');
    expect(mob).toContain("sl.uncertain ? 'SLOW?' : 'SLOW'");
    expect(mob).toContain("(sl.uncertain ? ' unc' : '')");
    expect(mob).toContain('.slowbadge.unc{opacity:.6');
    expect(mob).toContain("may not be this one");
    expect(me).toContain("'slowed?'");
  });
});
