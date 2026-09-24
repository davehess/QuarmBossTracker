// test/me-overlay.test.js — the Me overlay's data (/api/me) and its three layouts.
//
// The guild lead, 2026-09-24: "a 'me' overlay. my target, my casting, my
// health, mana, XP detail. avg DPS per fight, total per day/night during
// raids, then the things that are important to classes with mana. clerics
// focus on how many CHs are left, enchanters, charms or mezzes left, theft of
// thought or harvest timers, party health data" — and "generate me those me
// overlays as versions a/b/c … give me a picker in game."
//
// Runs the agent's REAL _serializeMeState over a fake Zeal state, and the
// overlay's REAL render functions over its output. Names are invented.
//
// Run: npx vitest run test/me-overlay.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, stripJs, stripCss } from './_source-slice.js';

const agent = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));
const meHtml = readSource(path.join(ROOT, 'apps', 'mimic', 'me.html'));
const mainJs = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));

const meBlock = sliceBlock(agent, '// ── Me overlay (the guild lead, 2026-09-24)', '\nfunction _serializeTankState() {')
  .replace(/\nfunction _serializeTankState\(\) \{$/, '');
const parseTs = agent.match(/const TS_RX = [^\n]+/)[0] + '\n'
  + sliceBlock(agent, 'function parseEqTimestamp(line) {', '\n}');
const failRx = agent.match(/const _CAST_FAIL_RX = [^\n]+/)[0];
const noManaRx = agent.match(/const _NO_MANA_CLASSES = [^\n]+/)[0];
const pipeCandidate = sliceBlock(agent, 'function _pipeCandidateOf(st, key) {', '\n}');

// Catalog: the real costs/recasts from eqemu_spells.
const CATALOG = [
  { name: 'Complete Healing', mana: 400, cast_ms: 10000 },
  { name: 'Mesmerize', mana: 20, cast_ms: 2500, mez: 1 },
  { name: 'Glamour of Kintaz', mana: 125, cast_ms: 1500, mez: 1 },
  { name: 'Allure', mana: 245, cast_ms: 6000 },
  { name: 'Theft of Thought', mana: 100, cast_ms: 3000, recast: 120000 },
  { name: 'Harvest', mana: 0, cast_ms: 5000, recast: 600000 },
  // Elements (resist type) for the HUD: 2 fire · 3 cold.
  { name: 'Ice Comet', mana: 203, good: 0, rt: 3, you: 'You are struck by a comet of ice.' },
  { name: 'Lava Breath', good: 0, rt: 2, you: 'You are engulfed in flames.' },
  { name: 'Frost Breath', good: 0, rt: 3, you: 'You feel a chill.' },
  { name: 'Burning Aura', good: 0, rt: 2, you: 'You feel a chill.' },   // shares a text across elements
];

function load({ zeal = {}, et = null, blind = {} } = {}) {
  const pre = `
    const _spellByNameLower = new Map(${JSON.stringify(CATALOG.map(e => [e.name.toLowerCase(), e]))});
    const _zealState = ${JSON.stringify(zeal)};
    const whoData = new Map();
    const _raidClassByName = new Map();
    const CHARM_SPELLS = new Map([['allure', {}], ['charm', {}]]);
    const stats = { currentEncounterThreat: ${JSON.stringify(et)} };
    const _blindState = ${JSON.stringify(blind)};
    function normalizeClass(s) { return s ? String(s).trim() : s; }
    ${failRx}
    ${parseTs}
    // HUD read-outs (2026-09-24): the helpers the serializer now reaches for,
    // real where they are pure, inert where they would touch the network.
    ${noManaRx}
    ${pipeCandidate}
    const _discReadyAt = new Map();
    const _mobInfoByName = new Map();
    const MOB_INFO_TTL_MS = 60000;
    function _mobInfoCacheKey(n, z) { return String(n).toLowerCase() + '|' + (z == null ? '' : z); }
    function fetchMobInfo() {}
    function _victimForMob() { return null; }
    function _bestSlowForTarget() { return null; }
    function _resolveHpValuesForName() { return null; }
    const DS_UNLISTED_SLACK = 30;
    function _knownDsPerHitFor() { return 0; }
  `;
  // eslint-disable-next-line no-new-func
  return new Function(pre + meBlock + '\nreturn { _serializeMeState, _meNoteSelfCast, _meNoteCastFailed, _meNoteFight, _meRate, _meNightKey, _meNoteHit, _meNoteSelfLanding };')();
}

const labels = (o) => Object.entries(o).map(([id, value]) => ({ id: Number(id), value: String(value) }));
function zealFor(name, { cls, level = 60, mana = [1686, 3015], gems = [], group = [], extra = {} } = {}) {
  const gemLabels = {};
  gems.forEach((g, i) => { gemLabels[60 + i] = g; });
  return {
    [name]: {
      updatedAt: Date.now(),
      self_hp_cur: 1469, self_hp_max: 3214, self_hp_pct: 45.7,
      self_mana_cur: mana[0], self_mana_max: mana[1],
      charInfo: labels({ 2: level, 3: cls, 26: 48, 27: 1, 71: 3, 24: 55, 25: 255, ...gemLabels }),
      gauges: [
        { slot: 2, hp_pct: 55.9, text: '' },
        { slot: 3, hp_pct: 91, text: '' },
        ...group.map((g, i) => ({ slot: 11 + i, hp_pct: g[1], text: g[0] })),
      ],
      ...extra,
    },
  };
}

describe('class focus', () => {
  it('a cleric sees how many Complete Heals the mana left buys', () => {
    const m = load({ zeal: zealFor('Aldenmar', { cls: 'Cleric', mana: [1686, 3015] }) });
    const s = m._serializeMeState();
    expect(s.character).toBe('Aldenmar');
    expect(s.focus.find(f => f.key === 'ch')).toMatchObject({ label: 'CH left', value: 4 });   // 1686 / 400
  });

  it('an enchanter sees mezzes and charms left for what is memorized', () => {
    const m = load({ zeal: zealFor('Nyssara', { cls: 'Enchanter', mana: [1000, 3000], gems: ['Mesmerize', 'Glamour of Kintaz', 'Allure'] }) });
    const s = m._serializeMeState();
    // The strongest memorized mez — the one an enchanter actually leans on.
    expect(s.focus.find(f => f.key === 'mez')).toMatchObject({ value: 8, sub: 'Glamour of Kintaz' });   // 1000 / 125
    expect(s.focus.find(f => f.key === 'charm')).toMatchObject({ value: 4, sub: 'Allure' });           // 1000 / 245
    expect(s.gems.map(g => g.casts_left)).toEqual([50, 8, 4]);
  });

  it('no mana classes get no mana numbers', () => {
    const m = load({ zeal: zealFor('Brackwyn', { cls: 'Warrior', mana: [null, null] }) });
    const s = m._serializeMeState();
    expect(s.focus).toEqual([]);
    expect(s.mana.cur).toBeNull();
  });
});

describe('Theft of Thought / Harvest timers', () => {
  it('a cast starts the recast; the timer counts down from it', () => {
    const m = load({ zeal: zealFor('Nyssara', { cls: 'Enchanter' }) });
    m._meNoteSelfCast('nyssara', 'Theft of Thought', Date.now() - 10_000);
    const t = m._serializeMeState().focus.find(f => f.key === 'timer:theft of thought');
    expect(t).toBeTruthy();
    // begin 10s ago + 3s cast + 120s recast → ~113s left.
    expect(Math.round(t.timer_ms / 1000)).toBe(113);
  });

  it('a fizzle inside the cast takes the timer back — the recast never started', () => {
    const m = load({ zeal: zealFor('Nyssara', { cls: 'Enchanter' }) });
    const at = Date.parse('2026-09-24T02:00:00');
    m._meNoteSelfCast('nyssara', 'Theft of Thought', at);
    m._meNoteCastFailed('[Thu Sep 24 02:00:02 2026] Your spell fizzles!', 'Nyssara');
    expect(m._serializeMeState().timers).toEqual([]);
  });

  it('short recasts get no timer', () => {
    const m = load({ zeal: zealFor('Nyssara', { cls: 'Enchanter' }) });
    m._meNoteSelfCast('nyssara', 'Mesmerize', Date.now());
    expect(m._serializeMeState().timers).toEqual([]);
  });
});

describe('XP and AA per hour', () => {
  it('is not a rate until five minutes of samples', () => {
    const m = load();
    const t0 = Date.parse('2026-09-24T01:00:00Z');
    expect(m._meRate('x|xp', 6000, t0)).toBeNull();
    expect(m._meRate('x|xp', 6010, t0 + 4 * 60_000)).toBeNull();
  });
  it('then reads in % of a level per hour', () => {
    const m = load();
    const t0 = Date.parse('2026-09-24T01:00:00Z');
    m._meRate('x|xp', 6000, t0);
    expect(m._meRate('x|xp', 6010, t0 + 30 * 60_000)).toBe(20);   // 10% in half an hour
  });
  it('a drop (spent AA, death) restarts instead of going negative', () => {
    const m = load();
    const t0 = Date.parse('2026-09-24T01:00:00Z');
    m._meRate('x|aa', 350, t0);
    expect(m._meRate('x|aa', 50, t0 + 10 * 60_000)).toBeNull();
  });
});

describe('damage', () => {
  it('tonight adds every finished fight, and a pet counts for its owner', () => {
    const m = load({ zeal: zealFor('Aldenmar', { cls: 'Magician' }) });
    const now = Date.now();
    m._meNoteFight({ endedMs: now, durationSec: 100, local: [
      { character: 'Aldenmar', dmg: 20000 }, { character: 'Gobeker', dmg: 10000, pet_owner: 'Aldenmar' },
      { character: 'Brackwyn', dmg: 50000 },
    ] });
    m._meNoteFight({ endedMs: now, durationSec: 50, local: [{ character: 'Aldenmar', dmg: 15000 }] });
    const n = m._serializeMeState().dps.night;
    expect(n).toEqual({ dmg: 45000, secs: 150, fights: 2, avg_dps: 300 });
  });

  it('this fight: live damage over elapsed time', () => {
    const et = { startedAt: new Date(Date.now() - 20_000).toISOString(), targetName: 'a Kromrif warrior',
      perPlayer: { Aldenmar: { swing: 3000, spell: 1000 }, Brackwyn: { swing: 9000 } } };
    const s = load({ zeal: zealFor('Aldenmar', { cls: 'Ranger' }), et })._serializeMeState();
    expect(s.dps.fight.dmg).toBe(4000);
    expect(s.dps.fight.dps).toBe(200);
  });
});

describe('damage in / out, by element (the HUD)', () => {
  const ts = (s) => new Date(Date.now() - s * 1000).toISOString();
  function withHits(fn) {
    const m = load({ zeal: zealFor('Aldenmar', { cls: 'Wizard' }) });
    fn(m);
    return m._serializeMeState().combat;
  }

  it('your melee and your named nuke count OUT, the nuke in its element', () => {
    const c = withHits(m => {
      m._meNoteHit('Aldenmar', { type: 'damage', ts: ts(3), attacker: null, defender: 'a Kromrif warrior', ability: 'slash', amount: 190 });
      m._meNoteHit('Aldenmar', { type: 'damage', ts: ts(2), attacker: null, defender: 'a Kromrif warrior', ability: 'Ice Comet', amount: 812 });
    });
    expect(c.out.dmg).toBe(1002);
    expect(c.out.by).toEqual({ melee: 190, cold: 812 });
    expect(c.feed[0]).toMatchObject({ dir: 'out', name: 'Ice Comet', el: 'cold' });
  });

  it('a mob hitting YOU counts IN', () => {
    const c = withHits(m => {
      m._meNoteHit('Aldenmar', { type: 'damage', ts: ts(2), attacker: 'a Kromrif warrior', defender: 'YOU', ability: 'slash', amount: 322 });
    });
    expect(c.in).toMatchObject({ dmg: 322, max: 322, by: { melee: 322 } });
  });

  it('an unnamed spell on you takes its element from the landing just before it', () => {
    const c = withHits(m => {
      m._meNoteSelfLanding('[' + new Date(Date.now() - 2000).toString().slice(0, 24) + '] You are engulfed in flames.', 'Aldenmar');
      m._meNoteHit('Aldenmar', { type: 'damage', ts: ts(2), attacker: null, defender: null, ability: 'non-melee', spellName: 'non-melee', amount: 1240 });
    });
    expect(c.in.by).toEqual({ fire: 1240 });
    expect(c.feed[0]).toMatchObject({ dir: 'in', name: 'Lava Breath', el: 'fire' });
  });

  it('…but not when spells of two elements share that landing text — no guess', () => {
    const c = withHits(m => {
      m._meNoteSelfLanding('[' + new Date(Date.now() - 2000).toString().slice(0, 24) + '] You feel a chill.', 'Aldenmar');
      m._meNoteHit('Aldenmar', { type: 'damage', ts: ts(2), attacker: null, defender: null, ability: 'non-melee', spellName: 'non-melee', amount: 400 });
    });
    expect(c.in.by).toEqual({ spell: 400 });
  });

  it('someone else hitting someone else is neither', () => {
    const c = withHits(m => {
      m._meNoteHit('Aldenmar', { type: 'damage', ts: ts(2), attacker: 'Brackwyn', defender: 'a Kromrif warrior', ability: 'slash', amount: 500 });
    });
    expect(c.out.dmg + c.in.dmg).toBe(0);
  });

  it('carries the resists from Zeal\'s char-info labels', () => {
    const z = zealFor('Aldenmar', { cls: 'Wizard' });
    z.Aldenmar.charInfo.push(...labels({ 12: 124, 13: 142, 14: 166, 15: 158, 16: 181 }));
    expect(load({ zeal: z })._serializeMeState().resists).toEqual({ mr: 181, fr: 166, cr: 158, pr: 124, dr: 142 });
  });
});

describe('group, blind, and nothing to show', () => {
  it('lists the group from Zeal\'s group gauges', () => {
    const s = load({ zeal: zealFor('Aldenmar', { cls: 'Cleric', group: [['Brackwyn', 34], ['Corvale', 100]] }) })._serializeMeState();
    expect(s.group.map(g => [g.name, g.hp_pct])).toEqual([['Brackwyn', 34], ['Corvale', 100]]);
  });
  it('says when the character is blind', () => {
    const s = load({ zeal: zealFor('Aldenmar', { cls: 'Cleric' }), blind: { aldenmar: { active: true } } })._serializeMeState();
    expect(s.blind).toBe(true);
  });
  it('no live character → no character, not an error', () => {
    expect(load()._serializeMeState()).toMatchObject({ ok: true, character: null });
  });
});

// ── the overlay ─────────────────────────────────────────────────────────────
const script = meHtml.slice(meHtml.indexOf('<script>') + 8, meHtml.indexOf('</script>'));
const renderBlock = script.slice(script.indexOf('  // ── helpers'), script.indexOf('  var bodyEl'));
// eslint-disable-next-line no-new-func
const R = new Function('var window = { innerWidth: 1114, innerHeight: 713 };\n' + renderBlock + '\nreturn { renderA, renderHud, renderC, hudParts, HUD_DEFAULTS, HUD_PARTS, hudData, hudLanes, HIT_LANES, HIT_SIZE };')();
// The hit columns are their own layer now (round five); a lane's lines, top to bottom.
// Round seven made a round ONE line of hits side by side, so a lane reads as
// its lines, top to bottom, each line's items left to right.
const laneOf = (snap, id) => {
  const its = R.hudLanes(R.hudData(snap), R.hudParts).items.filter(it => it.lane === id).sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of its) {
    const t = it.text + (it.hand === 'OH' ? ' OH' : '');
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) < 0.01) last.t += ' ' + t; else lines.push({ y: it.y, t });
  }
  return lines.map(l => l.t);
};
const HUDS = { HUD: R.renderHud };

describe('the three layouts', () => {
  const zeal = zealFor('Aldenmar', { cls: 'Cleric', mana: [1686, 3015], gems: ['Complete Healing'], group: [['Brackwyn', 34]] });
  const s = load({ zeal })._serializeMeState();

  it('A · Classic prints cur/max inside the bars, Nillipuss-style', () => {
    const h = R.renderA(s);
    expect(h).toContain('1,469 / 3,214');
    expect(h).toContain('1,686 / 3,015');
    expect(h).toContain('CH left <b>4</b>');
    expect(h).toContain('Brackwyn');
  });

  it('C · Role leads with the class number, large', () => {
    const h = R.renderC(s);
    expect(h.indexOf('class="fv">4<')).toBeGreaterThan(-1);
    expect(h.indexOf('class="fv">4<')).toBeLessThan(h.indexOf('class="vit"'));
  });
});

// ── the three HUDs ──────────────────────────────────────────────────────────
// The guild lead, 2026-09-24, after a night with the first HUD (layout B): "The
// Circle should be the bounds for the resizing with some light info on the
// inside of the circle" · "Monks, rogues, and warriors have no mana so don't
// expose that for them" · "Melee cooldowns and discipline cooldowns need to be
// in here" · the target "should have their target's health as well. If it's
// slowed, does it enrage? If it enrages make it a red outline" · "server tick
// counters and melee delay timers" · "Hits can be on the inside of the
// circle" · "Give me 3 versions of the circle hud".
describe('the three HUDs', () => {
  const base = {
    ok: true, character: 'Aldenmar', level: 60, class: 'Monk', no_mana: true,
    hp: { cur: 5311, max: 6417, pct: 82.8 }, mana: { cur: null, max: null, pct: null }, end: { pct: 41 },
    tick: { ms_left: 3400, period_ms: 6000, source: 'zeal' },
    swing: { ms_left: 1300, period_ms: 2600, source: 'log', est: true, hands: { mh: 'slash', oh: 'pierce' } },
    cooldowns: [
      { key: 'ability', label: 'Flying Kick', ms_left: 3200, total_ms: 7000, est: true },
      { key: 'disc', label: 'Hundred Fists', ms_left: 1203000, total_ms: 1638000, est: true },
      { key: 'mend', label: 'Mend', ms_left: 0, total_ms: 289000 },
    ],
    target: { name: 'a gnoll warlord', hp_pct: 63, tot: { name: 'Corvale', hp_pct: 38 }, slow: null, enrage: true, unslowable: false, enraged: false },
    combat: { live: true, secs: 30, out: { dmg: 1462, dps: 49, by: {} }, in: { dmg: 600, dps: 20, by: {} },
      feed: [{ dir: 'out', amount: 110, kind: 'melee', name: 'slash', hand: 'MH', age_ms: 200 },
             { dir: 'in', amount: 300, kind: 'spell', name: 'Lava Breath', el: 'fire', age_ms: 900 }] },
    resists: { mr: 178, fr: 194, cr: 165, pr: 195, dr: 215 },
  };
  const cleric = Object.assign({}, base, { class: 'Cleric', no_mana: false, mana: { cur: 1686, max: 3015, pct: 55.9 },
    target: Object.assign({}, base.target, { enrage: false, slow: { label: "Turgur's Insects", pct: 75, remaining_secs: 131 } }) });

  for (const [name, fn] of Object.entries(HUDS)) {
    it(name + ' is one square SVG that scales with its window — nothing placed in pixels', () => {
      const h = fn(base);
      expect(h.startsWith('<svg id="hudsvg" viewBox="0 0 400 400"')).toBe(true);
      expect(h).not.toMatch(/\d+px/);
    });

    it(name + ' shows endurance, never mana, for a monk — and mana for a cleric', () => {
      const monk = fn(base), cl = fn(cleric);
      expect(monk).not.toContain('var(--blue)');
      expect(monk).toContain('var(--orange)');
      expect(cl).toContain('var(--blue)');
    });

    // Round four, the guild lead: "The ENRAGES section should just make a red
    // outline for the last 8% of the healthbar".
    it(name + ' outlines the last 8% of the target\'s health bar in red for a mob that can enrage', () => {
      const RED = /<path d="M([\d.]+) ([\d.]+) A172 172 0 0 1 ([\d.]+) ([\d.]+)" stroke="(?:var\(--red\)|rgba\(248,81,73,0\.6\))"/;
      const can = fn(base), not = fn(cleric);
      const m = can.match(RED);
      expect(m).not.toBeNull();
      expect(not).not.toMatch(RED);
      // Clockwise degrees from 12 o'clock: the bar runs -44..44, the outline covers its low end only.
      const deg = (x, y) => Math.atan2(x - 200, 200 - y) * 180 / Math.PI;
      expect(deg(+m[1], +m[2])).toBeCloseTo(-44, 0);
      expect(deg(+m[3], +m[4]) - deg(+m[1], +m[2])).toBeCloseTo(88 * 0.08, 0);
      expect(can).not.toMatch(/>enrages</);                        // the outline says it; no word
      const on = fn(Object.assign({}, base, { target: Object.assign({}, base.target, { enraged: true }) }));
      expect(on).toContain('ENRAGED');
      expect(on).toMatch(/A172 172 0 0 1 [\d.]+ [\d.]+" stroke="var\(--red\)"/);   // solid while it is
    });

    it(name + ' carries the target\'s target with their HP, and the slow state', () => {
      expect(fn(base)).toContain('Corvale');
      expect(fn(base)).toContain('38%');
      expect(fn(base)).toContain('not slowed');                  // a mob we have the row for
      expect(fn(cleric)).toContain('slowed 75% · 2:11');
    });

    it(name + ' draws the tick, the swing, and each cooldown by name', () => {
      const h = fn(base);
      expect(h).toMatch(/tick|TICK/);
      expect(h).toMatch(/~swing|~SWING/);                           // measured, so marked "~"
      expect(h).toContain('FK');
      expect(h).toContain('DISC');
      expect(h).toContain('MEND');
    });

    // Round four, the guild lead: "Tick and swing timer should be their own
    // bars underneath abilities". Underneath = further out at the bottom of the
    // ring; each is its own labelled path, not a slot among the cooldowns.
    it(name + ' puts the tick and the swing on their own bars, under the cooldowns', () => {
      const h = fn(base);
      const r = (id) => { const m = h.match(new RegExp('<path id="' + id + '" d="M[\\d.]+ [\\d.]+ A([\\d.]+) ')); return m ? +m[1] : null; };
      const text = (id) => (h.match(new RegExp('<textPath href="#' + id + '"[^>]*>([\\s\\S]*?)</textPath>')) || [])[1] || '';
      expect(text('htk')).toMatch(/TICK/);
      expect(text('hsw')).toMatch(/~SWING/);
      const cds = [0, 1, 2].map(i => text('hcd' + i).replace(/<[^>]+>/g, ''));
      expect(cds.join(' ')).toMatch(/FK/);
      expect(cds.join(' ')).not.toMatch(/TICK|SWING/);
      expect(r('htk')).toBeGreaterThan(r('hcd0'));
      expect(r('hsw')).toBeGreaterThan(r('hcd0'));
    });

    it(name + ' puts hits inside the ring: on you, yours', () => {
      expect(laneOf(base, 'hout')).toEqual(['110']);
      expect(laneOf(base, 'hin')).toEqual(['300']);
    });

    // Round five, the guild lead: "if a mob summons we should get a marker next to the 97%".
    it(name + ' marks 97% on the target\'s bar for a mob that summons, and not otherwise', () => {
      const MARK = /<path d="M([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+)" stroke="var\(--orange\)"/;
      const sum = fn(Object.assign({}, base, { target: Object.assign({}, base.target, { summon: true }) }));
      const m = sum.match(MARK);
      expect(m).not.toBeNull();
      expect(fn(base)).not.toMatch(MARK);
      const deg = (x, y) => Math.atan2(x - 200, 200 - y) * 180 / Math.PI;
      expect(deg(+m[1], +m[2])).toBeCloseTo(-44 + 88 * 0.97, 0);   // the bar runs -44..44
      expect(Math.hypot(+m[1] - 200, +m[2] - 200)).toBeLessThan(172);   // it crosses the bar
      expect(Math.hypot(+m[3] - 200, +m[4] - 200)).toBeGreaterThan(172);
    });

    // Round six, the guild lead: "Please display level or level range and class
    // under the target's bar, above the target of target".
    it(name + ' writes level (or range) and class under the target\'s name', () => {
      const t = (x) => fn(Object.assign({}, base, { target: Object.assign({}, base.target, x) }));
      const h = t({ level: 52, level_max: 55, class: 'Warrior' });
      expect(h).toContain('>L52–55 Warrior<');
      expect(t({ level: 60, class: 'Enchanter', level_src: 'history' })).toContain('>L60 Enchanter (last seen)<');
      expect(fn(base)).not.toMatch(/>L\d/);                                  // nothing known, nothing drawn
    });

    // Round seven, the guild lead: "Target name should curve with the HP bar" ·
    // "Move target of target's healthbar and name to the top of the circle above
    // the current".
    it(name + ' runs the name along the inside of its bar, and puts who it is hitting on top, outside it', () => {
      const h = fn(base);
      const radius = (id) => { const m = h.match(new RegExp('<path id="' + id + '" d="M[\\d.]+ [\\d.]+ A([\\d.]+) ')); return m ? +m[1] : null; };
      expect(radius('htn')).toBeLessThan(172 - 3);                          // inside the target's bar
      expect(radius('htt')).toBeGreaterThan(172 + 3);                       // outside it
      expect(h).toMatch(/<textPath href="#htt"[^>]*>[\s\S]*?Corvale[\s\S]*?38%/);
      // the name keeps to the bar's own span, however long it is: smaller, then cut short — never the health
      const long = fn(Object.assign({}, base, { target: Object.assign({}, base.target, { name: 'an exceedingly long named bodyguard of the Tribunal' }) }));
      const size = +(long.match(/<path id="htn"[^>]*\/><text font-size="([\d.]+)"/) || [])[1];
      const r = +(long.match(/<path id="htn" d="M[\d.]+ [\d.]+ A([\d.]+) /) || [])[1];
      const drawn = (long.match(/<textPath href="#htn"[^>]*>([\s\S]*?)<\/textPath>/) || [])[1].replace(/<[^>]+>/g, '');
      expect(drawn).toMatch(/…\s+63%$/);
      expect(drawn.length * 0.6 * size).toBeLessThanOrEqual(88 * Math.PI / 180 * r + 1);
    });

    it(name + ' says nothing about slow, enrage or summon on a corpse', () => {
      const h = fn(Object.assign({}, base, { target: { name: "A Temple Patroller's corpse", hp_pct: 0, corpse: true } }));
      expect(h).toContain('corpse');
      expect(h).not.toContain('not slowed');
      expect(h).not.toMatch(/stroke="(?:var\(--red\)|rgba\(248,81,73,0\.6\))"/);
      expect(h).not.toMatch(/<path d="M[\d.]+ [\d.]+ L[\d.]+ [\d.]+" stroke="var\(--orange\)"/);   // the summon mark
    });

    it(name + ' says "unslowable" in the slow line\'s place, smaller', () => {
      const size = (h, word) => +(h.match(new RegExp('font-size="([\\d.]+)"[^>]*>' + word + '<')) || [])[1];
      const un = fn(Object.assign({}, base, { target: Object.assign({}, base.target, { unslowable: true }) }));
      expect(size(un, 'unslowable')).toBeLessThan(size(fn(base), 'not slowed'));
    });

    // "When a mob flurries or Rampages denote that with an F in a fist outline or
    // an R in a fist outline next to the boss's name."
    it(name + ' puts F and R in fists left of the name — bright right after it happens', () => {
      const t = (x) => fn(Object.assign({}, base, { target: Object.assign({}, base.target, x) }));
      const letters = (h) => [...h.matchAll(/<text x="([\d.]+)" y="[\d.]+" font-size="[\d.]+" fill="([^"]+)" text-anchor="middle" font-weight="700">([FR])<\/text>/g)]
        .map(m => ({ x: +m[1], c: m[2], l: m[3] }));
      expect(letters(fn(base))).toEqual([]);
      const can = letters(t({ flurry: true, rampage: true }));
      expect(can.map(b => b.l)).toEqual(['F', 'R']);
      for (const b of can) expect(b.x).toBeLessThan(200);                   // left of 12 o'clock, where the name is centred
      expect(can[1].x).toBeLessThan(can[0].x);                              // R further out than F
      expect(can[0].c).not.toBe('var(--red)');
      expect(letters(t({ flurry: true, flurry_lit: true }))[0].c).toBe('#ffd7d4');   // lit: a solid red fist, light letter
      expect(t({ flurry: true, flurry_lit: true })).toContain('fill="rgba(248,81,73,0.28)" stroke="var(--red)"');
    });
  }

  // Round two, the guild lead: "There needs to be more open space in the middle."
  // Every straight line of text is measured as a box (monospace: ~0.6 em per
  // character), not just its anchor — a line anchored at the ring can still
  // reach the middle, which is exactly what the first side-hit columns did.
  // Curved labels sit on the ring by construction.
  for (const [name, fn] of Object.entries(HUDS)) {
    it(name + ' keeps the middle open — no straight text within 95 units of the centre', () => {
      const h = fn(Object.assign({}, cleric, { casting: { spell: 'Complete Healing', pct: 40, remaining_ms: 6000 } }))
        + fn(base)
        + fn(Object.assign({}, base, { combat: Object.assign({}, base.combat, { ds: { hits: 3, total: 114, last: 38, per_hit: 138, from_buffs: false } }) }));
      expect(h).toContain('>DS~<');                                  // the button's own text is measured too
      const boxes = [...h.matchAll(/<text x="([\d.]+)" y="([\d.]+)" font-size="([\d.]+)"[^>]*?text-anchor="(\w+)"[^>]*>([\s\S]*?)<\/text>/g)];
      expect(boxes.length).toBeGreaterThan(3);
      for (const m of boxes) {
        const x = +m[1], y = +m[2], size = +m[3], anchor = m[4];
        const w = m[5].replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '_').length * size * 0.6;
        const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
        const nx = Math.max(x0, Math.min(200, x0 + w)), ny = Math.max(y - size, Math.min(200, y));
        expect(Math.hypot(nx - 200, ny - 200), m[5]).toBeGreaterThan(95);
      }
    });
  }

  // The hit columns are upright now (round five: "Text should be vertically
  // aligned"), so every line is a box, measured at the longest text a lane
  // carries in practice — "1,240" (a big spell on you, a round's total), the
  // off-hand tag (6 units) on your own hits, four characters of damage shield —
  // in every row, kept off the middle and inside the ring's stroke (r 169).
  it('the hit columns stay between the open middle and the ring, in every row', () => {
    const widest = { hin: 5 * R.HIT_SIZE * 0.6, hout: 5 * R.HIT_SIZE * 0.6 + 3 * 6 * 0.6, hds: 4 * R.HIT_SIZE * 0.6 };
    for (const [id, L] of Object.entries(R.HIT_LANES)) {
      const w = widest[id];
      for (let row = 0; row < L.rows; row++) {
        const y = L.y + row * 10.5;
        const x0 = L.anchor === 'end' ? L.x - w : L.x, x1 = x0 + w;
        const nx = Math.max(x0, Math.min(200, x1)), ny = Math.max(y - R.HIT_SIZE, Math.min(200, y));
        expect(Math.hypot(nx - 200, ny - 200), id + ' row ' + row).toBeGreaterThan(95);
        for (const [cx, cy] of [[x0, y - R.HIT_SIZE], [x1, y - R.HIT_SIZE], [x0, y], [x1, y]]) {
          expect(Math.hypot(cx - 200, cy - 200), id + ' row ' + row + ' inside the ring').toBeLessThan(169);
        }
      }
    }
  });

  it('a class cooldown never used this session is unknown ("—"), never "ready"', () => {
    const s2 = Object.assign({}, base, { cooldowns: [{ key: 'fd', label: 'Feign Death', ms_left: null, total_ms: null, est: true, seen: false }] });
    for (const fn of Object.values(HUDS)) {
      const h = fn(s2);
      expect(h).toContain('FD');
      expect(h).toMatch(/FD[^<]*—|—[^<]*FD|>—</);
      expect(h).not.toMatch(/FD ready/);
    }
  });
});

// ── the HUD, round three: one HUD built from parts ───────────────────────────
// The guild lead, 2026-09-24: "I think we need an overlay builder for this one in
// mimic" · "The wrap mode on H1 is the way i want things to be" · "H2's
// separation of hits against me vs hits out" · "they should be smaller and
// more - i sometimes hit 6 times in one round" · "Damage shield hits are also
// mixed in there - those should be separate, and should have a button with
// current DS amount per hit in it".
describe('the HUD — rounds, damage shield, builder', () => {
  const at = 1_790_000_000_000;
  const hit = (dir, amount, sec, extra = {}) => ({ dir, amount, kind: 'melee', name: 'punch', at: at - sec * 1000, age_ms: sec * 1000, ...extra });
  const s = (feed, extra = {}) => Object.assign({
    ok: true, character: 'Aldenmar', class: 'Monk', no_mana: true,
    hp: { pct: 80 }, mana: {}, end: { pct: 50 }, cooldowns: [], target: null,
    combat: { live: true, secs: 30, out: { dmg: 0, dps: 0, by: {} }, in: { dmg: 0, dps: 0, by: {} }, feed },
  }, extra);
  const lane = laneOf;
  const reset = () => Object.assign(R.hudParts, R.HUD_DEFAULTS);

  // Round five, the guild lead: "each round of damage can come out as individual
  // hits but get merged into a single line item after the next round shows up".
  // Round seven, the guild lead: "The concurrent hits in a round should show up
  // side by side before merging into a single line."
  it('a round\'s hits sit side by side on one line, in the order they landed', () => {
    reset();
    const three = [10, 20, 30].reverse().map(a => hit('out', a, 0));   // newest first, as the agent sends
    expect(lane(s(three), 'hout')).toEqual(['10 20 30']);
  });
  it('a round too wide for its column shrinks, then wraps — and never runs past the ring', () => {
    reset();
    const six = [85, 33, 49, 45, 33, 49].reverse().map(a => hit('out', a, 0));
    const lines = lane(s(six), 'hout');
    expect(lines.join(' ')).toBe('85 33 49 45 33 49');                 // every hit, in order
    expect(lines.length).toBeLessThanOrEqual(2);
    const its = R.hudLanes(R.hudData(s(six)), R.hudParts).items.filter(it => it.lane === 'hout');
    for (const it of its) {
      expect(it.size).toBeGreaterThanOrEqual(R.HIT_SIZE * 0.75 - 1e-9);
      const right = it.x + it.text.length * 0.6 * it.size, top = it.y - it.size;
      expect(Math.hypot(right - 200, Math.max(Math.abs(top - 200), Math.abs(it.y - 200))), it.text).toBeLessThan(165);
    }
  });

  // Round six, the guild lead: "The combining of rounds of combat is happening
  // strangely. I liked seeing the separate hits, but it wasn't clear how that
  // was operating." · "Have the damage done and taken per mob roll off into a
  // total as well, then drop out after each mob." So a column is a ledger: the
  // mob's total on top, the last few rounds as separate hits under it (oldest
  // first, newest at the bottom), and older hits slide up into the total.
  const gnoll = (extra = {}) => Object.assign({ key: 'a gnoll|alive', name: 'a gnoll', out: 0, in: 0, ds: 0, first: at - 60_000, last: at, dead_at: null }, extra);
  const withTallies = (feed, tallies, extra = {}) => s(feed.map(f => Object.assign({ other: 'a gnoll' }, f)),
    Object.assign({ combat: { live: true, secs: 30, out: { dps: 0, by: {} }, in: { dps: 0, by: {} }, feed: feed.map(f => Object.assign({ other: 'a gnoll' }, f)), tallies } }, extra));

  it('the mob\'s total on top, then the last rounds as separate hits — oldest first, newest at the bottom', () => {
    reset();
    const feed = [[0, [10, 20]], [3, [30]], [6, [40, 50]]].flatMap(([sec, a]) => a.slice().reverse().map(n => hit('out', n, sec)));
    expect(lane(withTallies(feed, [gnoll({ out: 1234 })]), 'hout')).toEqual(['Σ 1,234', '40 50', '30', '10 20']);
  });

  it('a round past the "rounds" setting slides up into the total — the same keys it had as separate hits', () => {
    reset();
    R.hudParts.rounds = 2;
    const round = (sec, a) => a.slice().reverse().map(n => hit('out', n, sec));
    const before = withTallies(round(3, [30, 40]).concat(round(6, [50])), [gnoll({ out: 120 })]);
    const after = withTallies(round(0, [10]).concat(round(3, [30, 40]), round(6, [50])), [gnoll({ out: 130 })]);
    expect(lane(after, 'hout')).toEqual(['Σ 130', '30 40', '10']);
    const L = R.hudLanes(R.hudData(after), R.hudParts);
    const total = L.items.find(it => it.total);
    const g = L.ghosts.filter(x => x.lane === 'hout');
    expect(g).toHaveLength(1);                                         // the 50, oldest round
    expect([g[0].x, g[0].y]).toEqual([total.x, total.y]);              // slides onto the total
    const was = R.hudLanes(R.hudData(before), R.hudParts).items.find(it => it.text === '50');
    expect(g[0].key).toBe(was.key);                                    // the element that was on screen
    reset();
  });

  it('when the mob dies, all its hits roll into its total, which stays until the agent drops it', () => {
    reset();
    const feed = [hit('out', 45, 0), hit('out', 88, 1)];   // newest first, as the agent sends
    const dead = withTallies(feed, [gnoll({ out: 900, dead_at: at })]);
    expect(lane(dead, 'hout')).toEqual(['Σ 900']);
    const L = R.hudLanes(R.hudData(dead), R.hudParts);
    expect(L.ghosts.filter(x => x.lane === 'hout')).toHaveLength(2);
    expect(L.items.find(it => it.total).op).toBe('0.55');              // dimmed: finished
    expect(lane(withTallies(feed, []), 'hout')).toEqual(['88', '45']); // dropped: no total left
  });

  it('two mobs, two totals — each named; hits on you and your damage shield keep their own', () => {
    reset();
    const bat = { key: 'a bat|alive', name: 'a bat', out: 7, in: 12, ds: 0, first: at - 5000, last: at, dead_at: null };
    const feed = [hit('in', 30, 0), hit('out', 14, 0, { kind: 'ds' })];
    const snap = withTallies(feed, [gnoll({ out: 500, in: 60, ds: 42 }), bat], { });
    snap.combat.ds = { hits: 3, total: 42, per_hit: 14, from_buffs: true };
    expect(lane(snap, 'hout')).toEqual(['Σ 500 gnoll', 'Σ 7 bat']);
    expect(lane(snap, 'hin')).toEqual(['Σ 60 gnoll', 'Σ 12 bat', '30']);
    expect(lane(snap, 'hds')).toEqual(['Σ 42', '14']);
  });

  it('a full column stops at its last row — rounds that do not fit roll into the total', () => {
    reset();
    R.hudParts.rounds = 5;
    const feed = [0, 3, 6, 9, 12].flatMap(sec => [1, 2, 3, 4, 5, 6].map(n => hit('out', 100 + sec * 10 + n, sec)));
    const L = R.hudLanes(R.hudData(withTallies(feed, [gnoll({ out: 9999 })])), R.hudParts).items.filter(it => it.lane === 'hout');
    const yMax = R.HIT_LANES.hout.y + (R.HIT_LANES.hout.rows - 1) * 10.5;
    expect(Math.max(...L.map(it => it.y))).toBeLessThanOrEqual(yMax + 0.01);
    const hits = L.filter(it => !it.total);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length % 6).toBe(0);                                    // whole rounds only
    // The damage shield column has four rows. Single-hit rounds take a row
    // plus the gap between rounds each, so three fit — four would, without
    // the gaps counted.
    const ds = [0, 3, 6, 9, 12].map(sec => hit('out', 14, sec, { kind: 'ds' }));
    const snap = s(ds, { combat: { live: true, secs: 30, out: { dps: 0, by: {} }, in: { dps: 0, by: {} }, feed: ds,
      ds: { hits: 5, total: 70, per_hit: 14, from_buffs: true } } });
    const D = R.hudLanes(R.hudData(snap), R.hudParts).items.filter(it => it.lane === 'hds');
    expect(D).toHaveLength(3);
    reset();
  });

  it('an off-hand hit carries a small OH when the hands swing different verbs', () => {
    reset();
    const feed = [hit('out', 40, 0, { hand: 'OH' }), hit('out', 90, 0, { hand: 'MH' }), hit('out', 88, 0, { hand: 'MH' })];
    expect(lane(s(feed), 'hout')).toEqual(['88 90 40 OH']);
  });

  it('hits on you and your hits are separate lanes', () => {
    reset();
    const one = s([hit('in', 169, 0), hit('out', 45, 0)]);
    expect(lane(one, 'hin')).toEqual(['169']);
    expect(lane(one, 'hout')).toEqual(['45']);
  });

  it('damage-shield hits leave your lane for their own, with a per-hit button', () => {
    reset();
    const feed = [hit('out', 38, 0, { kind: 'ds' }), hit('out', 45, 0), hit('out', 38, 2, { kind: 'ds' })];
    const snap = s(feed, { combat: { live: true, secs: 30, out: { dps: 0, by: {} }, in: { dps: 0, by: {} }, feed,
      ds: { hits: 2, total: 76, last: 38, per_hit: 38, from_buffs: true } } });
    const h = R.renderHud(snap);
    expect(lane(snap, 'hout')).toEqual(['45']);
    expect(lane(snap, 'hds')).toEqual(['38', '38']);
    expect(h).toMatch(/<circle[^>]*stroke="var\(--orange\)"/);
    expect(h).toMatch(/font-weight="700">38<\/text>/);
    expect(h).toContain('>DS<');
  });

  it('the builder switches parts off — and nothing else moves', () => {
    reset();
    const one = s([hit('in', 169, 0), hit('out', 45, 0)], { tick: { ms_left: 3000 }, resists: { mr: 183, fr: 234, cr: 170, pr: 200, dr: 220 } });
    const all = R.renderHud(one);
    const allOut = R.hudLanes(R.hudData(one), R.hudParts).items.filter(it => it.lane === 'hout');
    expect(all).toContain('TICK');
    expect(all).toContain('MR<tspan');
    expect(lane(one, 'hin')).toEqual(['169']);
    R.hudParts.tick = 0; R.hudParts.resists = 0; R.hudParts.hitsIn = 0;
    const trimmed = R.renderHud(one);
    expect(trimmed).not.toContain('TICK');
    expect(trimmed).not.toContain('MR<tspan');
    expect(lane(one, 'hin')).toEqual([]);
    // your hits keep their exact place
    expect(R.hudLanes(R.hudData(one), R.hudParts).items.filter(it => it.lane === 'hout')).toEqual(allOut);
    reset();
  });

  it('every part in the builder has a default, and every default is in the builder', () => {
    const listed = R.HUD_PARTS.flatMap(g => g[1].map(it => it[0])).sort();
    // `sizes` is the sliders' store, not a part of its own.
    expect(listed).toEqual(Object.keys(R.HUD_DEFAULTS).filter(k => k !== 'sizes').sort());
  });

  // Round six, the guild lead: "Lets try adding in small sliders next to each of
  // the hud's elements for font size on the config page."
  it('a part\'s size slider scales its text, and only its text', () => {
    reset();
    const snap = s([], { target: { name: 'a bat', hp_pct: 63, enrage: false }, tick: { ms_left: 3000 } });   // short: fits its bar at 1.5×
    const size = (h, id) => +((h.match(new RegExp('<path id="' + id + '"[^>]*/><text font-size="([\\d.]+)"')) || [])[1]);
    const plain = R.renderHud(snap);
    R.hudParts.sizes = { target: 1.5 };
    const big = R.renderHud(snap);
    expect(size(big, 'htn')).toBeCloseTo(size(plain, 'htn') * 1.5, 5);
    expect(size(big, 'htk')).toBe(size(plain, 'htk'));
    R.hudParts.sizes = { target: 9 };                                  // out of range: ignored
    expect(size(R.renderHud(snap), 'htn')).toBe(size(plain, 'htn'));
    reset();
  });

  // Round seven, the guild lead: "a top level slider for all of the text".
  it('the All-text slider scales every part, on top of each part\'s own', () => {
    reset();
    const snap = s([], { target: { name: 'a bat', hp_pct: 63, enrage: false }, tick: { ms_left: 3000 } });
    const size = (h, id) => +((h.match(new RegExp('<path id="' + id + '"[^>]*/><text font-size="([\\d.]+)"')) || [])[1]);
    const plain = R.renderHud(snap);
    R.hudParts.sizes = { all: 1.2 };
    const all = R.renderHud(snap);
    expect(size(all, 'htn')).toBeCloseTo(size(plain, 'htn') * 1.2, 5);
    expect(size(all, 'htk')).toBeCloseTo(size(plain, 'htk') * 1.2, 5);
    R.hudParts.sizes = { all: 1.2, target: 1.25 };
    expect(size(R.renderHud(snap), 'htn')).toBeCloseTo(size(plain, 'htn') * 1.5, 5);
    reset();
  });

  // Round seven, the guild lead: "IN and Out should be side-swapped. Damage in
  // should be next to health and out should be on the right".
  it('damage in sits with your health; damage out on the right', () => {
    reset();
    const h = R.renderHud(s([], { combat: { live: true, secs: 30, out: { dps: 126, by: {} }, in: { dps: 60, by: {} }, feed: [] } }));
    const label = (id) => (h.match(new RegExp('<textPath href="#' + id + '"[^>]*>([\\s\\S]*?)</textPath>')) || [])[1].replace(/<[^>]+>/g, '');
    expect(label('hhp')).toMatch(/HP .* · in 60/);
    expect(label('hrt')).toMatch(/END .* · out 126/);
  });

  // "I did not get an 'FD Failure' message when this happened - FD cooldown in
  // the Hud should show an X on it"
  it('a failed Feign Death shows ✗, in red', () => {
    reset();
    const h = R.renderHud(s([], { cooldowns: [{ key: 'fd', label: 'Feign Death', ms_left: 2000, total_ms: 5000, seen: true, failed: true }] }));
    expect(h).toMatch(/<tspan fill="var\(--red\)">FD ✗[^<]*<\/tspan>/);   // (the HUD ages the time left, so no fixed number)
    const ok = R.renderHud(s([], { cooldowns: [{ key: 'fd', label: 'Feign Death', ms_left: 0, total_ms: 5000, seen: true }] }));
    expect(ok).not.toContain('✗');
  });

  // "on Large size for abilities we should just show the name of the ability and
  // a checkmark instead of ready"
  it('"ready" becomes ✓ when it would not fit its arc — and nothing is cut off', () => {
    reset();
    const four = ['Kick', 'Mend', 'Feign Death', 'Hundred Fists'].map((label, i) => ({ key: ['ability', 'mend', 'fd', 'disc'][i], label, ms_left: 0, total_ms: 5000, seen: true }));
    const snap = s([], { cooldowns: four });
    expect(R.renderHud(snap)).toContain('>MEND ready<');
    R.hudParts.sizes = { cooldowns: 1.6 };
    const big = R.renderHud(snap);
    expect(big).toContain('>MEND ✓<');
    expect(big).not.toContain('ready');
    // every label's text fits its own arc at the size it is drawn
    for (const m of big.matchAll(/<path id="hcd\d" d="M([\d.]+) ([\d.]+) A165 165 0 0 0 ([\d.]+) ([\d.]+)"[^>]*\/><text font-size="([\d.]+)"><textPath[^>]*><tspan[^>]*>([^<]*)</g)) {
      const a = Math.atan2(+m[1] - 200, 200 - +m[2]), b = Math.atan2(+m[3] - 200, 200 - +m[4]);
      const arc = Math.abs(((a - b + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * 165;
      expect(m[6].length * 0.6 * +m[5], m[6]).toBeLessThanOrEqual(arc + 0.5);
    }
    reset();
  });

  // "Cast time is definitely wrong, especially for clickies" — until the agent
  // has timed the gauge, the catalog's time is marked as a guess.
  it('a cast time the agent could not measure yet is marked ~', () => {
    reset();
    const cast = (est) => R.renderHud(s([], { casting: { spell: 'Illusion: Fire Elemental', pct: 40, remaining_ms: 1400, est } }));
    expect(cast(true)).toMatch(/✦ CAST ~\d/);
    expect(cast(false)).toMatch(/✦ CAST \d/);
  });

  // Round four, the guild lead: "Everything feels very bold, we need to be able
  // to make it thinner." Thin is the default; bold is the round-three look.
  it('line weight: thin by default, and it thins every arc — bold is the old look', () => {
    reset();
    const one = s([hit('out', 45, 0)], { hp: { pct: 80 }, tick: { ms_left: 3000 } });
    const widths = (h) => [...h.matchAll(/stroke-width="([\d.]+)"/g)].map(m => +m[1]);
    expect(R.HUD_DEFAULTS.weight).toBe('thin');
    const thin = R.renderHud(one);
    expect(thin).toContain('class="w-thin"');
    R.hudParts.weight = 'bold';
    const bold = R.renderHud(one);
    expect(bold).toContain('class="w-bold"');
    expect(Math.max(...widths(bold))).toBe(6);                     // round three's health arc
    expect(Math.max(...widths(thin))).toBeLessThan(4);
    expect(widths(thin).length).toBe(widths(bold).length);         // same parts, only thinner
    R.hudParts.weight = 'nonsense';
    expect(R.renderHud(one)).toContain('class="w-thin"');          // a bad saved value falls back
    reset();
  });
});

describe('the in-game picker', () => {
  const body = stripJs(meHtml);
  it('offers A, the HUD and C, and remembers the pick', () => {
    for (const v of ['a', 'hud', 'c']) expect(meHtml).toContain('data-v="' + v + '"');
    for (const v of ['b', 'h1', 'h2', 'h3']) expect(meHtml).not.toContain('data-v="' + v + '"');
    expect(body).toContain("localStorage.setItem(STYLE_KEY, style)");
  });
  it('someone who had picked B, H1, H2 or H3 lands on the HUD', () => {
    expect(body).toContain("if (saved === 'b' || saved === 'h1' || saved === 'h2' || saved === 'h3') saved = 'hud';");
  });
  // Round seven, the guild lead: "Config for hud should be able to scroll easily,
  // and have a top level slider for all of the text as well as reset to
  // defaults for each line."
  it('the builder: a header that stays while the list scrolls, with All text; a ↺ on every line', () => {
    const css = stripCss(meHtml);
    expect(css).toContain('#builder .bsticky{position:sticky;top:0;');
    expect(css).toMatch(/#builder\{[^}]*overflow-y:auto;/);
    expect(meHtml).toMatch(/<div class="bsticky">[\s\S]*?id="builder-all" data-size="all"[\s\S]*?data-reset="all"[\s\S]*?<\/div>\s*<\/div>\s*<div id="builder-list">/);
    // every row renders a reset, checkbox rows and select rows alike
    expect((body.match(/<button type="button" class="brs" data-reset="' \+ it\[0\] \+ '"/g) || []).length).toBe(2);
    // ↺ restores the line's shipped on/off and drops its own size
    expect(body).toMatch(/delete sizes\[k\];\s*hudParts\.sizes = sizes;\s*if \(k in HUD_DEFAULTS && k !== 'sizes'\) hudParts\[k\] = HUD_DEFAULTS\[k\];/);
    // the panel the window grows by is the panel CSS draws
    expect(css).toContain('--panel-w:300px');
    expect(body).toContain('var PANEL_W = 300,');
  });
  it('the builder is clickable on a locked overlay, and saves to this computer', () => {
    expect(body).toContain("builderEl.addEventListener('mouseenter', hoverOn)");
    expect(body).toContain("builderEl.addEventListener('mouseleave', hoverOff)");
    expect(body).toContain('localStorage.setItem(HUD_PARTS_KEY, j);');
  });
  // Round six, the guild lead: "Huds should be configurable per character as well."
  it('settings are saved per character, and a new character starts from the last one saved', () => {
    expect(body).toContain("if (_hudPartsFor) localStorage.setItem(HUD_PARTS_KEY + ':' + String(_hudPartsFor).toLowerCase(), j);");
    expect(body).toMatch(/\(ch && JSON\.parse\(localStorage\.getItem\(HUD_PARTS_KEY \+ ':' \+ String\(ch\)\.toLowerCase\(\)\) \|\| 'null'\)\)\s*\|\| JSON\.parse\(localStorage\.getItem\(HUD_PARTS_KEY\) \|\| 'null'\)/);
    expect(body).toContain('if (s && s.character) useCharacterParts(s.character);');
    // refilled in place, so everything holding hudParts sees the switch
    expect(body).toMatch(/function useCharacterParts\(ch\)\{[\s\S]*?Object\.keys\(hudParts\)\.forEach\(function\(k\)\{ delete hudParts\[k\]; \}\);\s*Object\.assign\(hudParts, p\);/);
  });
  // Round four, the guild lead: "The configuration section needs to pop up on
  // the side and not over the overlay."
  it('the builder opens BESIDE the ring: the window grows by the panel, the ring keeps its width, closing puts it back', () => {
    expect(body).toContain('setBounds({ x: toLeft ? x - PANEL_W : x, y: y, width: w + PANEL_W, height: hgt })');
    expect(body).toContain("document.documentElement.style.setProperty('--ring-w', w + 'px')");
    expect(stripCss(meHtml)).toContain('body.building #wrap{width:var(--ring-w)}');
    expect(body).toMatch(/function closeBuilder\(restore\)\{[\s\S]*?if \(restore !== false && pre && pre\.width\) setBounds\(pre\);/);
    // quitting with it open must not leave the ring off-centre next launch
    expect(body).toMatch(/if \(pre\) closeBuilder\(isHud\(style\)\);/);
  });
  // Round five: "It should be animated and smooth, not just jump." The hit
  // lines are kept between repaints (paintLanes), so CSS can move them — and
  // a player who asked the OS for less motion gets them still.
  it('the hit lines slide (a kept layer + a CSS transition), and hold still for reduced motion', () => {
    const css = stripCss(meHtml);
    expect(css).toContain('#hudlanes text{transition:transform .3s ease-out,opacity .3s ease-out}');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\{[^}]*#hudlanes text\{transition:none\}/);
    expect(body).toContain('paintLanes(isHud(style) && s && s.character ? hudLanes(hudData(s), hudParts) : null, hudParts.weight)');
    expect(meHtml).toContain('<svg id="hudlanes"');
  });
  it('a HUD makes the window a centred square — the ring is the bounds', () => {
    expect(body).toMatch(/var side = Math\.round\(Math\.min\(screen\.availWidth, screen\.availHeight\) \* 0\.5\);\s*setBounds\(\{ width: side, height: side, center: true \}\)/);
  });
  it('is clickable on a locked (click-through) overlay — the hover handshake', () => {
    expect(body).toContain("picker.addEventListener('mouseenter', hoverOn)");
    expect(body).toContain("picker.addEventListener('mouseleave', hoverOff)");
  });
});

describe('Mimic wiring', () => {
  const main = stripJs(mainJs);
  it('comes up while blind — blind removes the game UI this overlay replaces', () => {
    expect(main).toMatch(/const _BLIND_FORCED_KEYS = \[[^\]]*'me'/);
    expect(main).toContain("_blindForceOpen('me')");
  });
  it('is in the hide-all set and has a ✕ branch', () => {
    expect(main).toMatch(/'showPopRaid',\s*\n\s*'showMe',\s*\n\];/);
    expect(main).toContain('} else if (win === meWindow) {');
  });
});
