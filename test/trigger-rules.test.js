// test/trigger-rules.test.js — "What you hear": speak / overlay only / off for every callout.
//
// The guild lead, 2026-10-12: "We need to overall fix the categorization for triggers within the guild
// section so that we can pick ones that we specifically do not want to hear or can just be shown on the
// trigger overlay. The charm aging. And many other callouts do not have a way to turn them off, such as
// enrage soon." ... "also a mute button on the TTS callouts so people can turn it off".
//
// Before this there was no per-person control over an individual callout: only Mute Mimic, the "Trigger
// alerts" master switch and the raid allow-list. Now every fire passes ONE checkpoint, _pushOverlay,
// which applies the rule (off = not pushed, overlay = pushed with mute:true). Three surfaces need more
// than that checkpoint and are pinned here too: a countdown's pre-end warning (the trigger overlay
// fires it itself), the blind alerts, and charm.html, which speaks its own lines.
//
// The REAL agent is driven (require) for the rules, the grouping and the fires; the overlay pages are
// run by slicing the shipped functions out of triggers.html / charm.html with the DOM stubbed.
//
// Run: npx vitest run test/trigger-rules.test.js

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

let agent;
beforeAll(() => { agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js'); });

const ME = 'Fenrisk';
const ALT = 'Brackwyn';
const LINE = '[Sun Oct 11 20:00:00 2026] The ground shakes.';

// Live shapes of guild_triggers rows (name / category / tags), invented names where a name is needed.
const guildRow = (over) => ({
  id: 'g-1', name: 'Ground shake', category: 'mechanic', default_scope: 'broadcast',
  tags: ['pop', 'pofire'], pattern: 'The ground shakes', use_regex: true, cooldown_seconds: 0,
  actions: [{ type: 'text_overlay', text: 'SHAKE', tts: 'shake', color: 'red', duration_ms: 3000 }],
  ...over,
});
const STAT_CARD = guildRow({ id: 'g-card', name: 'Aldenmar the Cruel — stat card', category: 'callout', tags: ['pop', 'potime'] });
const ZONE_ROW  = guildRow({ id: 'g-zone', name: 'Rampage warning', tags: ['pop', 'pofire'] });
const EARTH_B   = guildRow({ id: 'g-eb', name: 'Earth B thing', tags: ['poearthb'] });
const CLASS_ROW = guildRow({ id: 'g-class', name: 'Cleric heal call', category: 'class', default_scope: 'class_specific', tags: [] });
const OTHER_ROW = guildRow({ id: 'g-other', name: 'Generic thing', category: 'callout', tags: ['Raid'] });

function loadGuild(rows) {
  agent._applyGuildTriggersResponse({ version: 'v' + Math.random(), triggers: rows });
}
function clearRules() { for (const k of Object.keys(agent._triggerRules)) delete agent._triggerRules[k]; }
function setRules(obj) { clearRules(); Object.assign(agent._triggerRules, obj); }
const fires = () => agent._waitForFires(0, 0);

let allowlistWas;
beforeEach(() => {
  allowlistWas = agent._optinState.calloutAllowlist;
  agent._optinState.calloutAllowlist = false;           // the raid allow-list is a different gate; keep it out of the way
  agent._setWatchedLogsForTest([{ character: ME, logPath: 'eqlog_Fenrisk_pq.proj.txt' }, { character: ALT, logPath: 'eqlog_Brackwyn_pq.proj.txt' }]);
  agent._setZealStateForTest(ME, null); agent._setZealStateForTest(ALT, null);
  agent._setPersonalTriggersForTest([]);
  agent._setGuildTriggersForTest([]);
  agent._activeOverlays.length = 0;
  agent._triggerLastFire.clear();
  clearRules();
});
afterEach(() => { agent._optinState.calloutAllowlist = allowlistWas; clearRules(); });

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('rule resolution order', () => {
  const R = (key, group, ch) => agent._resolveRule(key, group, ch);

  it('no rules at all: speak, from the default', () => {
    expect(R('guild:x', 'zone:pofire', 'fenrisk')).toEqual({ mode: 'speak', from: 'default' });
  });
  it('1. the trigger for the character beats everything', () => {
    setRules({ 'guild:x': { fenrisk: 'off', '*': 'overlay' }, 'group:zone:pofire': { fenrisk: 'overlay', '*': 'overlay' } });
    expect(R('guild:x', 'zone:pofire', 'fenrisk')).toEqual({ mode: 'off', from: 'trigger' });
  });
  it('2. the trigger for everyone beats the group', () => {
    setRules({ 'guild:x': { '*': 'overlay' }, 'group:zone:pofire': { fenrisk: 'off', '*': 'off' } });
    expect(R('guild:x', 'zone:pofire', 'fenrisk')).toEqual({ mode: 'overlay', from: 'trigger_all' });
  });
  it('3. the group for the character beats the group for everyone', () => {
    setRules({ 'group:zone:pofire': { fenrisk: 'off', '*': 'overlay' } });
    expect(R('guild:x', 'zone:pofire', 'fenrisk')).toEqual({ mode: 'off', from: 'group' });
  });
  it('4. the group for everyone applies when nothing narrower is set', () => {
    setRules({ 'group:zone:pofire': { '*': 'overlay' } });
    expect(R('guild:x', 'zone:pofire', 'fenrisk')).toEqual({ mode: 'overlay', from: 'group_all' });
  });
  it('a rule for ANOTHER character does not touch this one', () => {
    setRules({ 'guild:x': { brackwyn: 'off' }, 'group:zone:pofire': { brackwyn: 'off' } });
    expect(R('guild:x', 'zone:pofire', 'fenrisk').mode).toBe('speak');
  });
  it('the everyone view (no character) skips the per-character steps', () => {
    setRules({ 'guild:x': { fenrisk: 'off' }, 'group:zone:pofire': { '*': 'overlay' } });
    expect(R('guild:x', 'zone:pofire', '')).toEqual({ mode: 'overlay', from: 'group' });
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('grouping', () => {
  const groupOf = (row) => agent._ruleGroupOfGuild(row);

  it('a "— stat card" row is a stat card even when it carries a zone tag', () => {
    expect(groupOf(STAT_CARD)).toBe('statcards');
  });
  it('a zone-tagged row goes to its zone, by the first tag that is a zone short name', () => {
    expect(groupOf(ZONE_ROW)).toBe('zone:pofire');
    expect(groupOf(guildRow({ tags: ['elemental', 'pop', 'bothunder', 'pofire'] }))).toBe('zone:bothunder');
  });
  it('the second Plane of Earth tag shares the first one\'s group', () => {
    expect(groupOf(EARTH_B)).toBe('zone:poeartha');
  });
  it('a class-category row with no zone is "class"; anything else is "guild_other"', () => {
    expect(groupOf(CLASS_ROW)).toBe('class');
    expect(groupOf(OTHER_ROW)).toBe('guild_other');
  });
  it('tags that are not zones (pop, tier1, Raid) never make a group', () => {
    expect(groupOf(guildRow({ tags: ['pop', 'tier1', 'time'] }))).toBe('guild_other');
  });

  it('the computed list: built-ins first, then stat cards, zones (by label), class, other, personal', () => {
    loadGuild([OTHER_ROW, CLASS_ROW, ZONE_ROW, STAT_CARD, EARTH_B]);
    agent._setPersonalTriggersForTest([{ id: 'p-1', name: 'My heal alert' }]);
    const groups = agent._computeRuleGroups();
    expect(groups.map(g => g.id)).toEqual(['builtin', 'statcards', 'zone:poeartha', 'zone:pofire', 'class', 'guild_other', 'personal']);
    const by = Object.fromEntries(groups.map(g => [g.id, g]));
    expect(by['zone:pofire'].label).toBe('Plane of Fire');
    expect(by['zone:poeartha'].label).toBe('Plane of Earth');
    expect(by.statcards.members).toEqual([{ key: 'guild:g-card', name: 'Aldenmar the Cruel — stat card' }]);
    expect(by.personal.members).toEqual([{ key: 'personal:p-1', name: 'My heal alert' }]);
    // Every built-in has a row, keyed builtin:<name>.
    const keys = by.builtin.members.map(m => m.key);
    for (const k of ['enrage_soon', 'charm_break', 'charm_aging', 'charm_breaking', 'recharm', 'ch_go', 'di_down',
      'reverse_slow', 'slow_landed', 'slow_dropped', 'slow_fading', 'new_rampage', 'taking_damage', 'timer_callout', 'blind']) {
      expect(keys).toContain('builtin:' + k);
    }
  });

  it('the payload names, per row, the explicit mode, the effective mode and where it came from', () => {
    loadGuild([ZONE_ROW, STAT_CARD]);
    setRules({ 'group:zone:pofire': { '*': 'overlay' }, 'guild:g-zone': { fenrisk: 'off' } });
    const everyone = agent._triggerRulesPayload('');
    const fire = everyone.groups.find(g => g.id === 'zone:pofire');
    expect(fire).toMatchObject({ key: 'group:zone:pofire', mode: 'overlay', effective: 'overlay' });
    expect(fire.members[0]).toMatchObject({ key: 'guild:g-zone', mode: null, effective: 'overlay', from: 'group' });
    const mine = agent._triggerRulesPayload('fenrisk').groups.find(g => g.id === 'zone:pofire');
    expect(mine.members[0]).toMatchObject({ mode: 'off', effective: 'off', from: 'trigger' });
    expect(mine).toMatchObject({ mode: null, effective: 'overlay' });   // the group has no rule of its own for this character
    expect(everyone.chars).toEqual([ME, ALT]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('_pushOverlay applies the rule — a fire from this machine\'s own log', () => {
  beforeEach(() => loadGuild([ZONE_ROW]));
  const fireLocal = (char = ME) => agent.evaluateTriggersAgainstLine(LINE, Date.now(), char);

  it('speak (no rule): the fire is pushed, unmuted, and carries its rule key', async () => {
    fireLocal();
    const f = await fires();
    expect(f).toHaveLength(1);
    expect(f[0].mute).toBe(false);
    expect(f[0].rule_key).toBe('guild:g-zone');
  });
  it('off: the fire is not pushed at all', async () => {
    setRules({ 'guild:g-zone': { '*': 'off' } });
    fireLocal();
    expect(await fires()).toHaveLength(0);
  });
  it('overlay: pushed, but muted', async () => {
    setRules({ 'guild:g-zone': { '*': 'overlay' } });
    fireLocal();
    const f = await fires();
    expect(f).toHaveLength(1);
    expect(f[0].mute).toBe(true);
  });
  it('a group rule reaches the trigger; the trigger\'s own rule wins over it', async () => {
    setRules({ 'group:zone:pofire': { '*': 'off' } });
    fireLocal();
    expect(await fires()).toHaveLength(0);
    agent._triggerLastFire.clear();
    setRules({ 'group:zone:pofire': { '*': 'off' }, 'guild:g-zone': { '*': 'speak' } });
    fireLocal();
    expect(await fires()).toHaveLength(1);
  });
  it('the rule is read for the character whose LOG line it was', async () => {
    setRules({ 'guild:g-zone': { fenrisk: 'off' } });
    fireLocal(ALT);
    expect(await fires()).toHaveLength(1);          // Brackwyn's log: not off for her
    agent._activeOverlays.length = 0; agent._triggerLastFire.clear();
    fireLocal(ME);
    expect(await fires()).toHaveLength(0);          // Fenrisk's log: off
  });
  it('a personal trigger is keyed personal:<id> and obeys the same rules', async () => {
    agent._setGuildTriggersForTest([]);
    agent._setPersonalTriggersForTest([agent._compilePersonalTrigger({
      id: 'p-1', name: 'My alert', pattern: 'The ground shakes', use_regex: true,
      actions: [{ type: 'text_overlay', text: 'MINE', tts: 'mine', color: 'red', duration_ms: 3000 }],
    })]);
    setRules({ 'group:personal': { '*': 'overlay' } });
    fireLocal();
    const f = await fires();
    expect(f[0].rule_key).toBe('personal:p-1');
    expect(f[0].mute).toBe(true);
  });
  it('a test / rehearsal fire bypasses the rules, so a preview still plays', async () => {
    setRules({ 'guild:g-zone': { '*': 'off' } });
    agent._pushOverlay({ text: 'x', rule_key: 'guild:g-zone', test: true, firedAt: Date.now() });
    agent._pushOverlay({ text: 'y', rule_key: 'guild:g-zone', rehearsal: true, firedAt: Date.now() + 1 });
    expect(await fires()).toHaveLength(2);
  });
});

describe('_pushOverlay applies the rule — a fire RELAYED from another raider', () => {
  const relayed = (over = {}) => ({
    name: 'Ground shake', trigger_id: 'g-zone', captures: {}, cooldown_seconds: 0, fired_at_ms: Date.now(),
    actions: [{ type: 'text_overlay', text: 'SHAKE', tts: 'shake', color: 'red', duration_ms: 3000 }],
    ...over,
  });
  beforeEach(() => loadGuild([ZONE_ROW]));

  it('speak (no rule): spoken', async () => {
    agent._runRelayedFire(relayed(), Date.now());
    const f = await fires();
    expect(f).toHaveLength(1);
    expect(f[0].mute).toBe(false);
    expect(f[0].scope).toBe('guild_relay');
  });
  it('off: dropped by the receiver, whatever the sender heard', async () => {
    setRules({ 'guild:g-zone': { '*': 'off' } });
    agent._runRelayedFire(relayed(), Date.now());
    expect(await fires()).toHaveLength(0);
  });
  it('overlay: shown, muted', async () => {
    setRules({ 'guild:g-zone': { '*': 'overlay' } });
    agent._runRelayedFire(relayed(), Date.now());
    const f = await fires();
    expect(f).toHaveLength(1);
    expect(f[0].mute).toBe(true);
  });
  it('a group rule applies to a relayed fire of a trigger this machine knows', async () => {
    setRules({ 'group:zone:pofire': { '*': 'off' } });
    agent._runRelayedFire(relayed(), Date.now());
    expect(await fires()).toHaveLength(0);
  });
  it('a relayed fire has no log line here, so the ACTIVE character\'s rule applies', async () => {
    agent._setZealStateForTest(ALT, { updatedAt: Date.now() });   // Brackwyn is the EQ window in front
    setRules({ 'guild:g-zone': { fenrisk: 'off' } });
    agent._runRelayedFire(relayed(), Date.now());
    expect(await fires()).toHaveLength(1);          // a rule for Fenrisk does not silence Brackwyn
    agent._activeOverlays.length = 0; agent._triggerLastFire.clear();
    setRules({ 'guild:g-zone': { brackwyn: 'off' } });
    agent._runRelayedFire(relayed(), Date.now());
    expect(await fires()).toHaveLength(0);
  });
  it('a relayed "New Rampage" (no trigger id) is the built-in new_rampage', async () => {
    setRules({ 'builtin:new_rampage': { '*': 'off' } });
    agent._runRelayedFire({ name: 'New Rampage', captures: {}, fired_at_ms: Date.now(),
      actions: [{ type: 'text_overlay', text: '🔥 NEW RAMPAGE: Aldenmar', tts: 'New rampage: Aldenmar' }] }, Date.now());
    expect(await fires()).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('built-in callouts carry their key', () => {
  it('"Taking damage" obeys builtin:taking_damage (and stays audio-only when spoken)', async () => {
    agent._setDamageAlert(true, false);
    const ev = { type: 'damage', amount: 40, defender: 'You', attacker: 'a gnoll' };
    setRules({ 'builtin:taking_damage': { '*': 'off' } });
    agent._maybeAnnounceDamageTaken(ev, ME, Date.now());
    expect(await fires()).toHaveLength(0);
    clearRules();
    agent._maybeAnnounceDamageTaken(ev, ME, Date.now() + 60_000);
    const f = await fires();
    expect(f).toHaveLength(1);
    expect(f[0].rule_key).toBe('builtin:taking_damage');
    agent._setDamageAlert(false, false);
  });

  it('the instant charm break reads the rule for the character whose charm it was', async () => {
    setRules({ 'builtin:charm_break': { fenrisk: 'off' } });
    const now = Date.now();
    agent._pushCharmBreakInstant('pet-a', 'a golem', true, now, now, 'fenrisk');
    expect(await fires()).toHaveLength(0);
    agent._pushCharmBreakInstant('pet-b', 'a golem', true, now, now, 'brackwyn');
    const f = await fires();
    expect(f).toHaveLength(1);
    expect(f[0].charm).toBe(true);
  });

  it('overlay-only on charm_break marks the instant fire muted (charm.html then stays quiet)', async () => {
    setRules({ 'builtin:charm_break': { '*': 'overlay' } });
    const now = Date.now();
    agent._pushCharmBreakInstant('pet-c', 'a golem', true, now, now, 'fenrisk');
    expect((await fires())[0].mute).toBe(true);
  });

  it('blind alerts: off sends no event, overlay-only sends a muted one', () => {
    const before = agent._blindEvents.length;
    setRules({ 'builtin:blind': { '*': 'off' } });
    agent._pushBlindEvent('blind_start', 'Blinded', 'blinded', Date.now());
    expect(agent._blindEvents.length).toBe(before);
    setRules({ 'builtin:blind': { '*': 'overlay' } });
    agent._pushBlindEvent('blind_start', 'Blinded', 'blinded', Date.now());
    expect(agent._blindEvents.at(-1).mute).toBe(true);
    clearRules();
    agent._pushBlindEvent('blind_end', 'Cured', 'cured', Date.now());
    expect(agent._blindEvents.at(-1).mute).toBe(false);
  });

  it('every built-in fire site passes its key (enrage soon, CH GO, slows, rampage, boss timers, loot)', () => {
    const src = stripJs(fs.readFileSync(path.join(ROOT, 'packages/wolfpack-logsync/index.js'), 'utf8'));
    for (const k of ['enrage_soon', 'charm_break', 'ch_go', 'di_down', 'reverse_slow', 'slow_landed', 'slow_dropped',
      'slow_fading', 'new_rampage', 'taking_damage', 'timer_callout', 'loot_post']) {
      expect(src, 'no _pushOverlay passes builtin:' + k).toMatch(new RegExp("rule_key:\\s*'builtin:" + k + "'"));
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('the countdown path (the overlay speaks pre-end warnings itself)', () => {
  const armed = (over = {}) => {
    agent._activeTimers.clear();
    agent._startTimer({ id: 'g-timer', name: 'Boom', _scope: 'guild', _ruleKey: 'guild:g-timer', timer_duration_sec: 40,
      warning_seconds: 10, warning_text: 'Boom soon', ...over }, Date.now(), !!over._test, {});
    return agent._activeTimersSnapshot().find(t => t.id.startsWith('g-timer'));
  };

  it('the snapshot row carries the trigger\'s key and its effective mode', () => {
    expect(armed()).toMatchObject({ rule_key: 'guild:g-timer', rule_mode: 'speak' });
    setRules({ 'guild:g-timer': { '*': 'overlay' } });
    expect(armed().rule_mode).toBe('overlay');
    setRules({ 'guild:g-timer': { '*': 'off' } });
    expect(armed().rule_mode).toBe('off');
  });
  it('a boss-timer countdown is the built-in timer_callout', () => {
    setRules({ 'builtin:timer_callout': { '*': 'off' } });
    agent._activeTimers.clear();
    agent._startTimer({ id: 'boss-chain|Aldenmar|spawn', name: 'spawn', timer_duration_sec: 40, _scope: 'guild',
      _ruleKey: 'builtin:timer_callout', actions: [{ color: 'gold' }] }, Date.now(), false, { target: 'Aldenmar' });
    expect(agent._activeTimersSnapshot().find(t => t.id.startsWith('boss-chain')).rule_mode).toBe('off');
  });
  it('a test countdown ignores the rules', () => {
    setRules({ 'guild:g-timer': { '*': 'off' } });
    expect(armed({ _test: true }).rule_mode).toBe('speak');
  });
});

describe('triggers.html: a muted countdown does not speak its warning', () => {
  const html = readSource(path.join(ROOT, 'apps/mimic/triggers.html'));
  const fireSrc  = sliceBlock(html, '  function fire(t){', '\n  }\n\n  // Blind-mode callouts');
  const speakable = sliceBlock(html, '  function _speakable(txt){', '\n  }\n');
  const paintSrc = sliceBlock(html, '  function paintTimers(){', '\n  }\n\n  // ── Auto-grow (#107)');

  function harness() {
    const calls = { speak: [], flash: [] };
    const prelude = `
      let alertsEnabled = true, _visualElsewhere = false; const PART = null;
      function flash(t){ calls.flash.push(t); } function speak(t){ calls.speak.push(t); }
      function playSound(){} function showFeedback(){} function offerMute(){} function pinSticky(){} function requestAutoHeight(){}
      function fmtRemain(){ return ''; }
      const timerNodes = new Map();
    `;
    // Each slice may end on a comment opener (the end marker is the next section's header): newline-join.
    const api = new Function('calls', [prelude, speakable, fireSrc, paintSrc, 'return { fire, paintTimers, timerNodes };'].join('\n'))(calls);
    return { calls, ...api };
  }
  const node = (over) => ({
    ends_at_local: Date.now() + 3000, cycle_ms: 0, duration_sec: 40, remain: {}, bar: { style: {} },
    row: { remove() {}, classList: { add() {}, remove() {} } },
    warnings: [{ at_ms: 5000, text: 'Boom soon', tts: true }], rule_key: 'guild:g-timer', rule_mode: 'speak', ...over,
  });

  it('speak: the warning is flashed and spoken', () => {
    const h = harness(); h.timerNodes.set('t', node());
    h.paintTimers();
    expect(h.calls.flash).toEqual(['Boom soon']);
    expect(h.calls.speak).toEqual(['Boom soon']);
  });
  it('overlay only: flashed, not spoken', () => {
    const h = harness(); h.timerNodes.set('t', node({ rule_mode: 'overlay' }));
    h.paintTimers();
    expect(h.calls.flash).toEqual(['Boom soon']);
    expect(h.calls.speak).toEqual([]);
  });
  it('off: neither flashed nor spoken', () => {
    const h = harness(); h.timerNodes.set('t', node({ rule_mode: 'off' }));
    h.paintTimers();
    expect(h.calls.flash).toEqual([]);
    expect(h.calls.speak).toEqual([]);
  });
  it('the row builder copies the agent\'s rule onto the node the paint loop reads', () => {
    const s = stripJs(html);
    expect(s).toMatch(/n\.rule_key\s*=\s*t\.rule_key \|\| null;/);
    expect(s).toMatch(/n\.rule_mode\s*=\s*t\.rule_mode \|\| 'speak';/);
  });
  it('a blind alert marked mute flashes but is not spoken', () => {
    const src = stripJs(html);
    expect(src).toMatch(/if \(!e\.mute\) speak\(e\.tts \|\| e\.text \|\| 'Blind'/);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('triggers.html: the 🔇 mute button', () => {
  const html = readSource(path.join(ROOT, 'apps/mimic/triggers.html'));
  const block = sliceBlock(html, '  let _muteFire = null;', "muteBtn.addEventListener('click', muteClick);\n  }");

  function harness({ votesOn = true } = {}) {
    const mk = (set) => ({ add: c => set.add(c), remove: c => set.delete(c), toggle: (c, on) => { if (on) set.add(c); else set.delete(c); }, contains: c => set.has(c) });
    const cls = new Set(), btnCls = new Set(), listeners = {}, hover = [];
    const btn = { textContent: '🔇 Mute', classList: mk(btnCls), addEventListener: (ev, fn) => { listeners[ev] = fn; } };
    const posts = [];
    const ctx = { cls, btn, posts, fbCls: mk(cls), hover };
    const prelude = `
      const btn = ctx.btn; const posts = ctx.posts;
      const document = { getElementById: () => btn };
      const window = { mimic: { overlayHoverInteractive: (on) => ctx.hover.push(on) } };
      const fbWrap = { classList: ctx.fbCls };
      function showFeedback() {}
      let _votesOn = ${votesOn}; const PORT = 7779;
      function fetch(url, opts){ posts.push({ url, body: JSON.parse(opts.body) }); return Promise.resolve({ ok: true }); }
    `;
    const api = new Function('ctx', [prelude, block, 'return { offerMute, muteClick };'].join('\n'))(ctx);
    return { ...api, cls, btn, btnCls, posts, listeners, hover };
  }
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const spoken = { text: 'Enrage soon', tts: 'Enrage soon', trigger: 'Enrage soon', rule_key: 'builtin:enrage_soon', mute: false };

  it('a spoken callout with a rule key offers 🔇', () => {
    const h = harness(); h.offerMute(spoken);
    expect(h.cls.has('canmute')).toBe(true);
    expect(h.cls.has('show')).toBe(true);
  });
  it('a callout that was NOT spoken (muted, test, replay) or has no key offers nothing to mute', () => {
    for (const f of [{ ...spoken, mute: true }, { ...spoken, test: true }, { ...spoken, replay: true }, { ...spoken, rule_key: null }]) {
      const h = harness(); h.offerMute(f);
      expect(h.cls.has('canmute')).toBe(false);
      expect(h.cls.has('show')).toBe(false);
    }
  });
  it('click: posts an overlay-only rule for every character, then reads "Muted — undo"', async () => {
    const h = harness(); h.offerMute(spoken);
    h.listeners.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts).toEqual([{ url: 'http://127.0.0.1:7779/api/trigger-rules', body: { key: 'builtin:enrage_soon', char: '*', mode: 'overlay' } }]);
    expect(h.btn.textContent).toBe('Muted — undo');
  });
  it('undo: a second click clears the rule', async () => {
    const h = harness(); h.offerMute(spoken);
    h.listeners.click(); await vi.advanceTimersByTimeAsync(0);
    h.listeners.click(); await vi.advanceTimersByTimeAsync(0);
    expect(h.posts[1].body).toEqual({ key: 'builtin:enrage_soon', char: '*', mode: null });
    expect(h.cls.has('canmute')).toBe(false);
  });
  it('the undo stays on screen past the 8 s the offer lasts', async () => {
    const h = harness(); h.offerMute(spoken);
    await vi.advanceTimersByTimeAsync(7000);
    h.listeners.click(); await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(7000);
    expect(h.cls.has('show')).toBe(true);
  });
  it('an unanswered offer goes away on its own', async () => {
    const h = harness(); h.offerMute(spoken);
    await vi.advanceTimersByTimeAsync(8100);
    expect(h.cls.has('show')).toBe(false);
  });
  it('with timing votes switched off the row shows the mute button alone', () => {
    const a = harness({ votesOn: false }); a.offerMute(spoken);
    expect(a.cls.has('show')).toBe(true);
    expect(a.cls.has('mute-only')).toBe(true);
    const b = harness({ votesOn: true }); b.offerMute(spoken);
    expect(b.cls.has('mute-only')).toBe(false);
  });
  it('the button asks for the hover handshake (a locked overlay is click-through)', () => {
    const h = harness();
    h.listeners.mouseenter(); h.listeners.mouseleave();
    expect(h.hover).toEqual([true, false]);
  });
  it('the fire carries the key the button posts (_fireForWeb → rule_key)', async () => {
    loadGuild([ZONE_ROW]);
    agent.evaluateTriggersAgainstLine(LINE, Date.now(), ME);
    expect((await fires())[0].rule_key).toBe('guild:g-zone');
  });
  it('it is a real <button> in the vote row, but NOT a .fb-btn (that loop would send a timing vote for it)', () => {
    const s = stripJs(html);
    expect(s).toMatch(/<button id="muteBtn" class="mute-btn"/);
    expect(s).not.toMatch(/class="fb-btn[^"]*mute/);
  });
  it('fire() offers it after the vote row, only for a fire drawn on this page', () => {
    expect(stripJs(html)).toMatch(/if \(visual\) showFeedback\(t\);\s*\n\s*if \(visual\) offerMute\(t\);/);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('charm.html speaks its own lines — through the same rules', () => {
  const html = readSource(path.join(ROOT, 'apps/mimic/charm.html'));
  const block = sliceBlock(html, '  var _ruleModes = {};', 'window.speechSynthesis.speak(u); } catch (e) {}\n  }');
  // The shipped speak(), with the engine and the Mute Mimic switch stubbed. Returns what would be said.
  const run = (modes, text, { muted = false } = {}) => {
    const said = [];
    const win = { speechSynthesis: { speak: (u) => said.push(u.text) } };
    class Utt { constructor(t) { this.text = t; } }
    const f = new Function('window', 'SpeechSynthesisUtterance', '_wpMutedNow',
      block + '\nreturn { speak, set: (m) => { _ruleModes = m; } };')(win, Utt, () => muted);
    f.set(modes); f.speak(text);
    return said;
  };

  it('the default (no entry, or an older agent) speaks', () => {
    expect(run({}, 'charm aging')).toEqual(['charm aging']);
    expect(run({ recharm: 'off' }, 'charm aging')).toEqual(['charm aging']);
  });
  it('overlay-only and off both stay quiet', () => {
    expect(run({ charm_aging: 'overlay' }, 'charm aging')).toEqual([]);
    expect(run({ charm_aging: 'off' }, 'charm aging')).toEqual([]);
  });
  it('each phrase maps to its own key (breaking has two spellings, one key)', () => {
    const quiet = (key, text) => run({ [key]: 'off' }, text).length === 0;
    expect(quiet('charm_break', 'charm break')).toBe(true);
    expect(quiet('recharm', 'recharm pet')).toBe(true);
    expect(quiet('charm_breaking', 'charm breaking')).toBe(true);
    expect(quiet('charm_breaking', 'charm breaking in 30 seconds')).toBe(true);
    expect(quiet('charm_aging', 'charm break')).toBe(false);    // a switch only reaches its own line
  });
  it('every line the page says is covered by the phrase map (a new line must get a key)', () => {
    const s = stripJs(html);
    const said = new Set([...s.matchAll(/\bspeak\('([^']+)'\)/g)].map(m => m[1]));
    for (const m of s.matchAll(/\bspeak\(isBard \? '([^']+)' : '([^']+)'\)/g)) { said.add(m[1]); said.add(m[2]); }
    expect([...said].sort()).toEqual(['charm aging', 'charm break', 'charm breaking', 'charm breaking in 30 seconds', 'recharm pet']);
    for (const text of said) expect(run({ charm_break: 'off', charm_aging: 'off', recharm: 'off', charm_breaking: 'off' }, text), text).toEqual([]);
    expect(s).toMatch(/_ruleModes = \(s && s\.builtinRuleModes\) \|\| \{\};/);
  });
  it('the agent publishes the map charm.html reads (non-speak only, for the active character)', () => {
    setRules({ 'builtin:charm_aging': { '*': 'off' }, 'builtin:recharm': { '*': 'overlay' }, 'builtin:ch_go': { '*': 'speak' } });
    expect(agent._builtinRuleModes()).toEqual({ charm_aging: 'off', recharm: 'overlay' });
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('the rules file and its API', () => {
  let write, rename;
  beforeEach(() => {
    write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('a write goes to trigger_rules.json via a .tmp + rename, in the shape { version, rules }', () => {
    expect(agent._setTriggerRule({ key: 'builtin:enrage_soon', mode: 'off' })).toMatchObject({ ok: true, char: '*', mode: 'off' });
    expect(path.basename(write.mock.calls[0][0])).toBe('trigger_rules.json.tmp');
    expect(path.basename(rename.mock.calls[0][1])).toBe('trigger_rules.json');
    expect(JSON.parse(write.mock.calls[0][1])).toEqual({ version: 1, rules: { 'builtin:enrage_soon': { '*': 'off' } } });
  });
  it('a character rule is stored lowercase; mode null clears it, and an empty key disappears', () => {
    agent._setTriggerRule({ key: 'guild:abc', char: 'Fenrisk', mode: 'overlay' });
    expect(agent._triggerRules['guild:abc']).toEqual({ fenrisk: 'overlay' });
    expect(agent._setTriggerRule({ key: 'guild:abc', char: 'Fenrisk', mode: null }).ok).toBe(true);
    expect(agent._triggerRules['guild:abc']).toBeUndefined();
  });
  it('refuses a bad key, a bad mode, an unknown built-in or a bad character; nothing is saved', () => {
    expect(agent._setTriggerRule({ key: 'nonsense', mode: 'off' }).ok).toBe(false);
    expect(agent._setTriggerRule({ key: 'guild:abc', mode: 'loud' }).ok).toBe(false);
    expect(agent._setTriggerRule({ key: 'builtin:nope', mode: 'off' }).ok).toBe(false);
    expect(agent._setTriggerRule({ key: 'guild:abc', char: 'a\nb', mode: 'off' }).ok).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
  it('a file with junk in it loads only the valid modes', () => {
    expect(agent._cleanRules({ rules: { 'guild:a': { '*': 'off', Fenrisk: 'loud' }, 'guild:b': 'x', 'guild:c': { '*': 'speak' } } }))
      .toEqual({ 'guild:a': { '*': 'off' }, 'guild:c': { '*': 'speak' } });
  });
  it('the Guild triggers table badge map lists only rows that are not speaking', () => {
    loadGuild([ZONE_ROW, STAT_CARD]);
    setRules({ 'group:statcards': { '*': 'off' }, 'guild:g-zone': { '*': 'overlay' } });
    expect(agent._guildRuleModes()).toEqual({ 'g-card': 'off', 'g-zone': 'overlay' });
    setRules({ 'group:statcards': { '*': 'off' }, 'guild:g-card': { '*': 'speak' } });
    expect(agent._guildRuleModes()).toEqual({});
  });
  it('the route refuses a write from a browser page that is not one of ours', () => {
    const src = stripJs(fs.readFileSync(path.join(ROOT, 'packages/wolfpack-logsync/index.js'), 'utf8'));
    const fn = src.slice(src.indexOf('async function _handleTriggerRules('));
    expect(fn.slice(0, fn.indexOf('\n}\n'))).toMatch(/if \(!_localOriginOk\(req\)\) return send\(403/);
  });
});
