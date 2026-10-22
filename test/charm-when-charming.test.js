// test/charm-when-charming.test.js — "Show: When charming" on the Charm overlay and on a Canvas piece.
//
// The guild lead, 2026-10-22: "Charm overlay should be able to show 'When Charming' so show up when the user
// charms, and remain between having a charm pet. Dismiss gets rid of it until they charm again."
//
// One state machine in the agent (_charmSessionStep, served on /api/state as `charmSession`), read by two
// consumers: charm.html (the window: hides its card between sessions, its ✕ dismisses) and canvas.html (a
// piece's Show-when rule, with a dismiss button of its own). The agent functions and both pages' decision
// functions run for real, sliced from the shipped source; the wiring is checked as comment-stripped text.
//
// Run: npx vitest run test/charm-when-charming.test.js
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, evalBlock, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const agentRaw = readSource(AGENT_INDEX);
const agent = stripJs(agentRaw);
const canvasRaw = readSource(path.join(ROOT, 'apps', 'mimic', 'canvas.html'));
const canvas = stripJs(canvasRaw);
const charmRaw = readSource(path.join(ROOT, 'apps', 'mimic', 'charm.html'));
const charm = stripJs(charmRaw);

const SESSION = sliceBlock(agentRaw, '// ── "When charming"', "  return _charmSessionStep(act || '*', pets, now);\n}");

// A fresh agent state each time: the sessions live in module-level maps.
function load(watched = ['Aldenmar']) {
  return evalBlock(`
    const stats = { watchedLogs: ${JSON.stringify(watched.map(character => ({ character })))} };
    const _charmTickTracker = new Map();
    ${SESSION}`, ['CHARM_SESSION_HOLD_MS', '_charmTickTracker', '_charmSessionStep', '_charmSessionDismiss', '_charmSessionNow']);
}
const T0 = 1_000_000_000;
const MIN = 60_000;
const pet = (o = {}) => Object.assign({ owner: 'Aldenmar', pet: 'a goblin mystic', is_active: true, started_at: T0, last_tick_at: T0, broke_at: null }, o);
const put = (h, key, p) => h._charmTickTracker.set(key, p);

describe('the agent\'s charming session', () => {
  it('is false until a charm lands', () => {
    const h = load();
    expect(h._charmSessionNow('Aldenmar', T0)).toMatchObject({ charming: false, active: false, since: null });
  });

  it('is true the moment a charm lands, and while it is up', () => {
    const h = load();
    put(h, 'k1', pet());
    expect(h._charmSessionNow('Aldenmar', T0 + 1000)).toMatchObject({ charming: true, active: true, since: T0, ends_at: null });
    expect(h._charmSessionNow('Aldenmar', T0 + 45 * MIN).charming).toBe(true);   // however long a charm holds
  });

  it('stays true between charms: after the break, through the gap, for 10 minutes since the last one', () => {
    const h = load();
    expect(h.CHARM_SESSION_HOLD_MS).toBe(10 * MIN);
    put(h, 'k1', pet());
    h._charmSessionNow('Aldenmar', T0 + 100_000);                          // seen up
    put(h, 'k1', pet({ is_active: false, broke_at: T0 + 120_000 }));       // it breaks
    const broke = h._charmSessionNow('Aldenmar', T0 + 121_000);
    expect(broke).toMatchObject({ charming: true, active: false, ends_at: T0 + 120_000 + 10 * MIN });
    h._charmTickTracker.delete('k1');                                      // the pet is killed: gone from the tracker
    expect(h._charmSessionNow('Aldenmar', T0 + 120_000 + 10 * MIN - 1).charming).toBe(true);
    expect(h._charmSessionNow('Aldenmar', T0 + 120_000 + 10 * MIN)).toMatchObject({ charming: false, ends_at: null });
  });

  it('a new charm inside the gap carries the session on, and the 10 minutes count from the new break', () => {
    const h = load();
    put(h, 'k1', pet({ is_active: false, broke_at: T0 + 60_000 }));
    h._charmSessionNow('Aldenmar', T0 + 61_000);
    put(h, 'k2', pet({ pet: 'a gnoll', started_at: T0 + 5 * MIN, last_tick_at: T0 + 5 * MIN }));
    expect(h._charmSessionNow('Aldenmar', T0 + 5 * MIN + 1000)).toMatchObject({ charming: true, active: true, since: T0 + 5 * MIN });
    put(h, 'k2', pet({ pet: 'a gnoll', started_at: T0 + 5 * MIN, is_active: false, broke_at: T0 + 8 * MIN }));
    expect(h._charmSessionNow('Aldenmar', T0 + 17 * MIN).charming).toBe(true);    // 9 min after the second break
    expect(h._charmSessionNow('Aldenmar', T0 + 18 * MIN + 1).charming).toBe(false);
  });

  it('Dismiss hides it at once and keeps it hidden — through the rest of that charm, and its gap', () => {
    const h = load();
    put(h, 'k1', pet());
    expect(h._charmSessionNow('Aldenmar', T0 + 1000).charming).toBe(true);
    h._charmSessionDismiss('Aldenmar');
    expect(h._charmSessionNow('Aldenmar', T0 + 2000).charming).toBe(false);
    expect(h._charmSessionNow('Aldenmar', T0 + 5 * MIN).charming).toBe(false);          // the same charm, still up
    put(h, 'k1', pet({ is_active: false, broke_at: T0 + 6 * MIN }));
    expect(h._charmSessionNow('Aldenmar', T0 + 6 * MIN + 1000).charming).toBe(false);   // broke: inside the 10 minutes, still dismissed
  });

  it('...until they charm again, whenever that is', () => {
    const h = load();
    put(h, 'k1', pet());
    h._charmSessionNow('Aldenmar', T0 + 1000);
    h._charmSessionDismiss('Aldenmar');
    put(h, 'k1', pet({ is_active: false, broke_at: T0 + 6 * MIN }));
    h._charmSessionNow('Aldenmar', T0 + 7 * MIN);
    put(h, 'k2', pet({ pet: 'a gnoll', started_at: T0 + 30 * MIN, last_tick_at: T0 + 30 * MIN }));   // a new charm, long after
    expect(h._charmSessionNow('Aldenmar', T0 + 30 * MIN + 500)).toMatchObject({ charming: true, active: true, since: T0 + 30 * MIN });
    // ...and a second dismissal works the same way
    h._charmSessionDismiss('Aldenmar');
    expect(h._charmSessionNow('Aldenmar', T0 + 30 * MIN + 600).charming).toBe(false);
  });

  it('a recharm of the same pet (a new started_at) counts as charming again', () => {
    const h = load();
    put(h, 'k1', pet());
    h._charmSessionNow('Aldenmar', T0 + 1000);
    h._charmSessionDismiss('Aldenmar');
    put(h, 'k1', pet({ started_at: T0 + 40_000, last_tick_at: T0 + 40_000 }));
    expect(h._charmSessionNow('Aldenmar', T0 + 41_000).charming).toBe(true);
  });

  it('Dismiss with nothing charmed yet hides nothing, and the first charm still shows', () => {
    const h = load();
    h._charmSessionDismiss('Aldenmar');
    expect(h._charmSessionNow('Aldenmar', T0).charming).toBe(false);
    put(h, 'k1', pet());
    expect(h._charmSessionNow('Aldenmar', T0 + 1000).charming).toBe(true);
  });

  it('is per character, and a bystander\'s charm is nobody\'s session of yours', () => {
    const h = load(['Aldenmar', 'Rethlan']);
    put(h, 'k1', pet({ owner: 'Rethlan' }));
    put(h, 'k2', pet({ owner: 'Stranger', pet: 'a bear' }));
    expect(h._charmSessionNow('Aldenmar', T0 + 1000).charming).toBe(false);
    expect(h._charmSessionNow('Rethlan', T0 + 1000).charming).toBe(true);
    h._charmSessionDismiss('Rethlan');
    expect(h._charmSessionNow('Rethlan', T0 + 2000).charming).toBe(false);
    expect(h._charmSessionNow('Aldenmar', T0 + 2000).charming).toBe(false);
  });

  it('with no active character it reads your watched characters\' charms only', () => {
    const h = load(['Aldenmar']);
    put(h, 'k2', pet({ owner: 'Stranger', pet: 'a bear' }));
    expect(h._charmSessionNow(null, T0 + 1000).charming).toBe(false);
    put(h, 'k1', pet());
    expect(h._charmSessionNow(null, T0 + 1000).charming).toBe(true);
    h._charmSessionDismiss(null);
    expect(h._charmSessionNow(null, T0 + 2000).charming).toBe(false);
  });

  it('is served on /api/state, and Dismiss has its route', () => {
    expect(agent).toMatch(/charmSession:\s*_charmSessionNow\(_activeCharacter, Date\.now\(\)\)/);
    expect(agent).toMatch(/req\.url === '\/api\/charm-session\/dismiss' && req\.method === 'POST'[\s\S]{0,400}_charmSessionDismiss\(payload && payload\.character\)/);
  });
});

describe('the Charm overlay window (charm.html)', () => {
  const idle = evalBlock(sliceBlock(charmRaw, '// @charmIdle', '// @end charmIdle'), ['charmIdle']).charmIdle;
  const S = (charming) => ({ charmSession: { charming } });

  it('hides between sessions, shows during one', () => {
    expect(idle('charming', false, S(false))).toBe(true);
    expect(idle('charming', false, S(true))).toBe(false);
  });

  it('Always (the default) never hides', () => {
    expect(idle('always', false, S(false))).toBe(false);
  });

  it('setup and unlock show it so it can be arranged', () => {
    expect(idle('charming', true, S(false))).toBe(false);
  });

  it('an agent that does not send charmSession leaves it shown', () => {
    expect(idle('charming', false, {})).toBe(false);
    expect(idle('charming', false, null)).toBe(false);
    expect(idle('charming', false, { charmSession: {} })).toBe(false);
  });

  it('the ✕ dismisses when the setting is When charming, and hides the overlay otherwise; the state is read from the poll', () => {
    expect(charm).toMatch(/hideBtn\.addEventListener\('click', function\(\)\{\s*if \(showWhen === 'charming'\) \{ dismissCharming\(\); return; \}\s*try \{ window\.mimic\.hideThisOverlay\(\); \}/);
    expect(charm).toMatch(/\/api\/charm-session\/dismiss/);
    expect(charm).toMatch(/lastActiveChar = \(s && s\.activeCharacter\) \|\| null;\s*applyIdle\(s\);/);
    expect(charm).toContain('body.wp-idle #wrap, body.wp-idle #move-btn, body.wp-idle #hide-btn{display:none !important}');
  });

  it('the choice is in the setup bar, and remembered', () => {
    expect(charm).toMatch(/<select id="showWhen"><option value="always">Always<\/option><option value="charming">When charming<\/option><\/select>/);
    expect(charm).toMatch(/localStorage\.setItem\('wpCharmShowWhen', showWhen\)/);
  });
});

describe('a Canvas piece with Show when: When charming', () => {
  const ENGINE = sliceBlock(canvasRaw, '  // ── Show when ──', '  // ── end Show when ──');
  const E = evalBlock(ENGINE, ['WHEN', 'cleanWhen', 'whenSources', 'whenSignals', 'whenHolds', 'whenBadge']);
  const NOW = 5_000_000;
  const state = (o) => Object.assign({ raidPipe: null }, o);
  const holds = (p, st) => E.whenHolds(p, E.whenSignals(null, st, NOW));

  it('is one of the rules, is kept by the layout, and reads the agent\'s state', () => {
    expect(E.WHEN.map(w => w[0])).toContain('charming');
    expect(E.WHEN.find(w => w[0] === 'charming')[1]).toBe('When charming');
    expect(E.cleanWhen({ when: 'charming' }, {})).toEqual({ when: 'charming' });
    expect(E.whenSources({ when: 'charming' })).toEqual(['state']);
    expect(E.whenBadge({ when: 'charming' })).toBe('When charming');
  });

  it('shows while the agent says charming, hides when it says not', () => {
    expect(holds({ when: 'charming' }, state({ charmSession: { charming: true } }))).toBe(true);
    expect(holds({ when: 'charming' }, state({ charmSession: { charming: false } }))).toBe(false);
  });

  it('an older agent (no charmSession), or no answer yet, leaves the piece visible — and the menu can say so', () => {
    expect(holds({ when: 'charming' }, state({}))).toBe(true);
    expect(holds({ when: 'charming' }, null)).toBe(true);
    expect(E.whenSignals(null, state({}), NOW).miss.charming).toBe(true);
    expect(E.whenSignals(null, state({ charmSession: { charming: true } }), NOW).miss.charming).toBeUndefined();
  });

  it('is ANDed with the class list like every rule', () => {
    const sig = E.whenSignals({ ok: true, character: 'Aldenmar', class: 'Enchanter', combat: { live: false }, target: null }, state({ charmSession: { charming: true } }), NOW);
    expect(E.whenHolds({ when: 'charming', cls: ['Enchanter'] }, sig)).toBe(true);
    expect(E.whenHolds({ when: 'charming', cls: ['Warrior'] }, sig)).toBe(false);
  });

  it('has a dismiss button that asks the agent, only on pieces with the rule, and never while arranging', () => {
    expect(canvas).toMatch(/\/api\/charm-session\/dismiss/);
    expect(canvas).toMatch(/if \(ev\.target === dsm\) \{ ev\.stopPropagation\(\); dismissCharming\(\); return; \}/);
    expect(canvas).toMatch(/e\.root\.classList\.toggle\('chm', p\.when === 'charming'\)/);
    const css = canvasRaw.slice(canvasRaw.indexOf('.dsmbtn{display:none'), canvasRaw.indexOf('.dsmbtn{display:none') + 700);
    expect(css).toMatch(/\.panel\.chm \.dsmbtn\{display:block\}/);
    expect(css).toMatch(/:is\(body\.edit, \.panel\.one\) \.dsmbtn\{display:none\}/);
    expect(canvas).toMatch(/dsm\.setAttribute\('data-wp-interact', ''\)/);
  });

  it('a layout with the rule exports and imports (the portable format knows the word)', () => {
    const pl = require(path.join(ROOT, 'apps', 'mimic', 'portableLayout.js'));
    const fixture = require(path.join(ROOT, 'test', 'fixtures', 'portable-layout.json'));
    const doc = JSON.parse(JSON.stringify(fixture.docs.screen1080));
    doc.groups[0].panels[0].when = 'charming';
    const r = pl.validate(doc);
    expect(r.ok, r.error).toBe(true);
    expect(r.doc.groups[0].panels[0].when).toBe('charming');
  });
});
