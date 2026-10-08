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

import { describe, it, expect, afterEach } from 'vitest';
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
// The per-mob procs/stuns tally keys by these two (the HUD's target block carries the counts).
const mobKey = sliceBlock(agent, 'function _normMobName(v) {', '\n}') + '\n' + sliceBlock(agent, 'function _provableTargetId(observer, targetName) {', '\n}');

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
    ${mobKey}
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
    function _dsKindOf() { return null; }
    const RAMPAGE_FRESH_MS = 8000;
    function _currentRampageForDisplay() { return null; }
    function _resolveHpForName() { return null; }
    const _lastRaidPipe = null;
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

  it('this fight: live DAMAGE (not threat) over elapsed time', () => {
    // swing/spell carry threat (a taunt and resists inflate them); dmg is what was actually dealt.
    const et = { startedAt: new Date(Date.now() - 20_000).toISOString(), targetName: 'a Kromrif warrior',
      perPlayer: { Aldenmar: { dmg: 4000, swing: 5200, spell: 1360 }, Brackwyn: { dmg: 9000, swing: 9000 } } };
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
const R = new Function('var window = { innerWidth: 1114, innerHeight: 713 };\n' + renderBlock + '\nreturn { renderA, renderHud, hudParts, HUD_DEFAULTS, HUD_PARTS, hudData, hudLanes, HIT_LANES, HIT_SIZE, HIT_STEP, laneSpan, LANE_EDGE_R, LANE_MID_R, readParts, clickyList, clickyKey, clickyPicked, clickyShown, clickyShort, clickyFit, clickyPickerHtml, clickyMaxPick, CLICKY_MAX_PICK, CLICKY_MAX_PICK_ONE, CLICKY_DEFAULT_N, CLICKY_R, CLICKY_PITCH, MINE_Y, HUD_SIZED, esc };')();
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

// The guild lead, 2026-09-24: "We can remove version C, default the HUD to
// version, rename A into Box" · "Endurance can be small" · "Remove the
// background from the Box version. Give the numbers on health some drop shadow."
describe('the Box (was A)', () => {
  const zeal = zealFor('Aldenmar', { cls: 'Cleric', mana: [1686, 3015], gems: ['Complete Healing'], group: [['Brackwyn', 34]] });
  const s = load({ zeal })._serializeMeState();

  it('prints cur/max inside the bars, Nillipuss-style', () => {
    const h = R.renderA(s);
    expect(h).toContain('1,469 / 3,214');
    expect(h).toContain('1,686 / 3,015');
    expect(h).toContain('CH left <b>4</b>');
    expect(h).toContain('Brackwyn');
  });

  it('endurance is small — a thin bar with its % beside it, no word in it', () => {
    const h = R.renderA(Object.assign({}, s, { end: { pct: 91 } }));
    expect(h).toMatch(/<div class="brow small"><div class="bar thin"><i style="width:91\.0%;background:var\(--orange\)"><\/i><span><\/span><\/div><div class="pct"[^>]*>91%<\/div><\/div>/);
    expect(h).not.toContain('>endurance<');
  });

  it('no mana row for a monk (it showed an empty 0% bar)', () => {
    const monk = Object.assign({}, s, { class: 'Monk', no_mana: true, mana: { cur: 0, max: 0, pct: 0 } });
    expect(R.renderA(monk)).not.toContain('var(--blue)">0%');
    expect(R.renderA(s)).toContain('1,686 / 3,015');                      // a cleric keeps it
  });

  it('no card behind it, and a dark halo on the numbers inside the bars', () => {
    const css = stripCss(meHtml);
    expect(css).toMatch(/body:not\(\.hud\) \.card\{background:transparent;border-color:transparent\}/);
    expect(css).toMatch(/\.bar > span\{text-shadow:[^}]*#000/);
  });

  // The guild lead, 2026-10-07 (screenshots): the ring showed "DS 24" with the procs and stuns counts
  // beside it, and the Box showed the damage block then the group, with none of them. The Box now
  // carries the SAME fields (target.my_procs / my_stuns, combat.ds) on one line under the target — where
  // the counts belong, since they are about that mob — in the ring's colours: procs purple, stuns gold,
  // the shield in its kind's.
  describe('procs, stuns/aggro and the shield — one line under the target', () => {
    const DS = { hits: 3, total: 72, last: 24, per_hit: 24, from_buffs: true, measured: true, kind: null };
    const snap = (target, ds = DS) => Object.assign({}, s, {
      target: target && Object.assign({ name: 'a gnoll warlord', hp_pct: 63 }, target),
      dps: { fight: { dps: 173, secs: 45 }, night: { avg_dps: 81, dmg: 181200, fights: 23 } },
      combat: ds ? { live: true, secs: 30, out: { dps: 0, by: {} }, in: { dps: 0, by: {} }, feed: [], ds } : { live: true, secs: 30, out: { dps: 0, by: {} }, in: { dps: 0, by: {} }, feed: [] },
    });
    // The row's chips, in order: [colour, label, value].
    const chips = (h) => {
      const row = (h.match(/<div class="kv">(<span title="[^"]*" style="color:[^"]*">[\s\S]*?)<\/div>/g) || []).find(r => /title="(Weapon procs|Your damage shield|A shield-cancelling)/.test(r)) || '';
      return [...row.matchAll(/<span title="[^"]*" style="color:([^"]*)">([^<]*) <b style="color:inherit">([^<]*)<\/b><\/span>/g)].map(m => [m[1], m[2], m[3]]);
    };

    it('reads "procs 3 · stuns 2 · DS 24", purple, gold, then the shield\'s own colour', () => {
      const h = R.renderA(snap({ my_procs: 3, my_stuns: 2 }));
      expect(chips(h)).toEqual([['var(--purple)', 'procs', '3'], ['var(--gold)', 'stuns', '2'], ['var(--orange)', 'DS', '24']]);
    });

    it('sits straight under the target\'s bar, above the damage block and the group', () => {
      const h = R.renderA(snap({ my_procs: 3, my_stuns: 2 }));
      const at = (x) => h.indexOf(x);
      expect(at('a gnoll warlord')).toBeGreaterThan(-1);
      expect(at('title="Weapon procs on the target"')).toBeGreaterThan(at('a gnoll warlord'));
      expect(at('title="Weapon procs on the target"')).toBeLessThan(at('>damage<'));
      expect(at('>damage<')).toBeLessThan(at('>group<'));
      // …and the damage block is untouched
      expect(h).toContain('fight <b>173</b> <span class="dim">(45s)</span>');
    });

    it('a 0 stays, dim, the way the ring does; the shield takes its kind\'s colour', () => {
      expect(chips(R.renderA(snap({ my_procs: 0, my_stuns: 3 }))).slice(0, 2)).toEqual([['var(--dim)', 'procs', '0'], ['var(--gold)', 'stuns', '3']]);
      expect(chips(R.renderA(snap({ my_procs: 1, my_stuns: 0 }, Object.assign({}, DS, { kind: 'thorns' }))))[2][0]).toBe('var(--green)');
      expect(chips(R.renderA(snap({ my_procs: 1, my_stuns: 0 }, Object.assign({}, DS, { kind: 'fire' }))))[2][0]).toBe('#ffb347');
    });

    it('the shield carries the ring\'s "~" while it is an estimate, and none once a hit has landed', () => {
      expect(chips(R.renderA(snap({ my_procs: 1, my_stuns: 1 }, Object.assign({}, DS, { measured: false }))))[2].slice(1)).toEqual(['DS~', '24']);
      expect(chips(R.renderA(snap({ my_procs: 1, my_stuns: 1 })))[2].slice(1)).toEqual(['DS', '24']);
      expect(chips(R.renderA(snap({ my_procs: 1, my_stuns: 1 }, { hits: 0, total: 0, last: null, per_hit: 24, from_buffs: true })))[2].slice(1)).toEqual(['DS~', '24']);   // an older agent
    });

    it('with no live target, on a corpse, or from an agent that sends neither count: the shield alone, or nothing', () => {
      expect(chips(R.renderA(snap(null))).map(c => c[1])).toEqual(['DS']);
      expect(chips(R.renderA(snap({ my_procs: 7, my_stuns: 3, corpse: true }))).map(c => c[1])).toEqual(['DS']);
      expect(chips(R.renderA(snap({}))).map(c => c[1])).toEqual(['DS']);
      const bare = R.renderA(snap({ my_procs: 7, my_stuns: 3 }, null));
      expect(chips(bare).map(c => c[1])).toEqual(['procs', 'stuns']);
      expect(R.renderA(snap({}, null))).not.toContain('Weapon procs');
      expect(R.renderA(snap({}, null))).not.toContain('Your damage shield');
    });

    it('a shield-cancelling debuff reads red "DS OFF" with the time left, as it does on the ring', () => {
      const off = { name: 'Mark of the Plague Lords', heals: 50, seconds: 125 };
      expect(chips(R.renderA(snap({ my_procs: 1, my_stuns: 1 }, Object.assign({}, DS, { per_hit: 0, off }))))[2]).toEqual(['#f85149', 'DS OFF', '2:05']);
    });
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
    // outline for the last 8% of the healthbar" — 10% since 2026-10-02 ("8% is
    // going off too late and I'm getting hit").
    it(name + ' outlines the last 12% of the target\'s health bar in red for a mob that can enrage', () => {
      const RED = /<path d="M([\d.]+) ([\d.]+) A172 172 0 0 1 ([\d.]+) ([\d.]+)" stroke="(?:var\(--red\)|rgba\(248,81,73,0\.6\))"/;
      const can = fn(base), not = fn(cleric);
      const m = can.match(RED);
      expect(m).not.toBeNull();
      expect(not).not.toMatch(RED);
      // Clockwise degrees from 12 o'clock: the bar runs -44..44, the outline covers its low end only.
      const deg = (x, y) => Math.atan2(x - 200, 200 - y) * 180 / Math.PI;
      expect(deg(+m[1], +m[2])).toBeCloseTo(-44, 0);
      expect(deg(+m[3], +m[4]) - deg(+m[1], +m[2])).toBeCloseTo(88 * 0.12, 0);
      expect(can).not.toMatch(/>enrages</);                        // the outline says it; no word
      const on = fn(Object.assign({}, base, { target: Object.assign({}, base.target, { enraged: true }) }));
      expect(on).toContain('ENRAGED');
      expect(on).toMatch(/A172 172 0 0 1 [\d.]+ [\d.]+" stroke="var\(--red\)"/);   // solid while it is
      // "when it ends, it should no longer be red underneath the name"
      const over = fn(Object.assign({}, base, { target: Object.assign({}, base.target, { enrage_ended: true }) }));
      expect(over).not.toMatch(RED);
      expect(over).not.toContain('ENRAGED');
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
    // the current". Round eight: "Put the name of the mob on the top of their
    // healthbar. Put their resists below their name. and the slowed/not
    // slowed/unslowable next to that" · "L40-43 Necromancer should also be
    // curved to fit the top bar".
    it(name + ' puts the name on top of its bar, who it is hitting above that, and level, resists and slow curved inside', () => {
      const t = (x) => fn(Object.assign({}, base, { target: Object.assign({}, base.target, x) }));
      const h = t({ level: 40, level_max: 43, class: 'Necromancer', resists: { mr: 50, fr: 30, cr: 30, pr: 50, dr: 75 } });
      const radius = (id) => { const m = h.match(new RegExp('<path id="' + id + '" d="M[\\d.]+ [\\d.]+ A([\\d.]+) ')); return m ? +m[1] : null; };
      const text = (id) => ((h.match(new RegExp('<textPath href="#' + id + '"[^>]*>([\\s\\S]*?)</textPath>')) || [])[1] || '').replace(/<[^>]+>/g, '');
      expect(radius('htn')).toBeGreaterThan(172);                           // on top of (outside) the target's bar
      expect(radius('htt')).toBeGreaterThan(radius('htn') + 3);             // who it is hitting, above the name
      expect(h).toMatch(/<textPath href="#htt"[^>]*>[\s\S]*?Corvale[\s\S]*?38%/);
      expect(text('htl')).toBe('L40–43 Necromancer');                      // curved, not a straight line
      expect(radius('htl')).toBeLessThan(172 - 3);                          // inside the bar
      expect(text('htr')).toBe('MR50 FR30 CR30 PR50 DR75 · not slowed');    // resists, the slow state beside them
      expect(radius('htr')).toBeLessThan(radius('htl'));                    // below the level
      expect(h).not.toMatch(/<text x="[\d.]+" y="[\d.]+"[^>]*>L40/);        // no straight copy left behind
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
  // The guild lead, 2026-10-02: the rampage target "listed next to the main tank on the side as an
  // arc" and raiders "approaching 20% or less HP on the left side of the top of the HUD".
  it('HUD draws the rampage target top right and low raiders top left, each as its own arc', () => {
    const fn = HUDS.HUD;
    const snap = Object.assign({}, base, { rampage: { name: 'Brackwyn', hp_pct: 18, fresh: true },
      low_hp: [{ name: 'Nyssara', hp_pct: 9 }, { name: 'Zarrin', hp_pct: 24 }] });
    const h = fn(snap);
    expect(h).toContain('R Brackwyn');
    expect(h).toContain('Nyssara');
    expect(h).toContain('Zarrin');
    expect(h).toMatch(/id="hrp"/);
    expect(h).toMatch(/id="hlh0"/);
    expect(h).toMatch(/id="hlh1"/);
    expect(fn(base)).not.toMatch(/id="hrp"|id="hlh0"/);   // nothing to show, nothing drawn
  });

  it('HUD carries a clicky counter line — charges left, red at none; unlimited and uncounted items never show', () => {
    const h = HUDS.HUD(Object.assign({}, base, { clickies: [
      { name: 'Ring of Shadows', left: 0, unlimited: false }, { name: 'Rod of Insidious Glamour', left: null, unlimited: true },
      { name: 'Bracer', left: null, unlimited: false }] }));
    expect(h).toMatch(/id="hcl"/);
    // The distinctive part of the name, bright (FB-65: "the names need to be easier to see") — not the
    // old grey "Ring…" / "Rod…", which made every "<thing> of …" look alike.
    expect(h).toMatch(/<tspan fill="#e6edf3">Shadows<\/tspan><tspan fill="var\(--red\)" font-weight="700"> 0</);
    // The guild lead, 2026-10-08: "the rod and all unlimited should not show up." An older agent still
    // sends them (∞, or no count at all); the HUD drops them whatever the agent sends.
    expect(h).not.toMatch(/Insid|∞|Bracer/);
    expect(HUDS.HUD(base)).not.toMatch(/id="hcl"/);
    // Nothing but unlimited / uncounted items: no line at all.
    expect(HUDS.HUD(Object.assign({}, base, { clickies: [
      { name: 'Rod of Insidious Glamour', left: null, unlimited: true }] }))).not.toMatch(/id="hcl"/);
  });

  // FB-65 (a member, 2026-10-07): "Should be able to pick which clicky charges you track, and the names
  // need to be easier to see. Root/Dispel/Stun are prioritized".
  describe('clicky counters — the picker, and names you can read (FB-65)', () => {
    const resetParts = () => Object.assign(R.hudParts, R.HUD_DEFAULTS, { sizes: {}, clickyPick: [] });
    afterEach(resetParts);
    const C = (name, left, extra = {}) => Object.assign({ name, left, unlimited: false, used: 0, worn: false, kind: null, max: null }, extra);
    // The agent's order: root, dispel, stun, then the rest.
    const eight = [C('Rooting Rod', 3, { kind: 'root', max: 3 }), C('Wand of Cancel Magic', 4, { kind: 'dispel', max: 4 }),
      C('Stunning Gem', 1, { kind: 'stun', max: 2 }), C('Ring of Shadows', 5, { max: 5 }), C('Cloak of Flames', 2, { max: 2 }),
      C('Orb of Sight', 1, { max: 1 }), C('Bridle of Plenty', 3, { max: 3 }), C('Staff of the Serpent', 4, { max: 5 })];
    const snap = (list) => Object.assign({}, base, { clickies: list.slice(0, 8), clickies_all: list.length > 8 ? list : undefined });
    // The line's text as drawn, and its font size.
    const line = (h) => {
      const m = h.match(/<text font-size="([\d.]+)"><textPath href="#hcl"[^>]*>([\s\S]*?)<\/textPath>/);
      return m ? { size: +m[1], text: m[2].replace(/<[^>]+>/g, ''), html: m[2] } : null;
    };
    const ARC = 80 * Math.PI / 180 * 122 * 0.96;   // the bottom arc the line is written along

    it('names come from the part of the item that tells it apart, as much as fits', () => {
      expect(R.clickyShort('Ring of Shadows', 10)).toBe('Shadows');
      expect(R.clickyShort('Rod of Insidious Glamour', 10)).toBe('Insidious');
      expect(R.clickyShort('Staff of the Serpent', 10)).toBe('Serpent');
      expect(R.clickyShort('White Ornate Chain Bridle', 10)).toBe('Bridle');
      expect(R.clickyShort('White Ornate Chain Bridle', 12)).toBe('White Bridle');
      expect(R.clickyShort('Rooting Rod', 8)).toBe('Rooting');                         // the longer of its two words
      expect(R.clickyShort('The Gnarled Staff', 20)).toBe('Gnarled Staff');
      // What raiders call them (the guild lead, 2026-10-08), every dose size alike, whatever the room.
      expect(R.clickyShort('10 Dose Cloudy Potion', 10)).toBe('Invis Pot');
      expect(R.clickyShort('5 Dose Cloudy Potion', 30)).toBe('Invis Pot');
      expect(R.clickyShort('10 Doses of Undeads Recourse', 10)).toBe('U.Recourse');
      expect(R.clickyShort('Potion of Undeads Recourse', 30)).toBe('U.Recourse');
      expect(R.clickyShort("Larrikan's Mask", 30)).toBe('Invis Mask');
      expect(R.clickyShort('Forlorn Totem of Rolfron Zek', 30)).toBe('Totem');
      // The dose count is not the name.
      expect(R.clickyShort('10 Dose Potion of Negation', 10)).toBe('Negation');
      expect(R.clickyShort('10 Dose Potion of Negation', 30)).toBe('Potion of Negation');
      expect(R.clickyShort('Ring of Shadows', 30)).toBe('Ring of Shadows');           // room for all of it: all of it
      expect(R.clickyShort('Ring of Supercalifragilistic', 8)).toBe('Superca…');           // 8 characters in all
    });

    it('the size slider is its own: it grows the line, and the resists slider no longer does', () => {
      resetParts();
      const one = [C('Bracer', 3)];
      const at1 = line(HUDS.HUD(snap(one))).size;
      R.hudParts.sizes = { clickies: 1.4 };
      expect(line(HUDS.HUD(snap(one))).size).toBeCloseTo(at1 * 1.4, 5);
      R.hudParts.sizes = { resists: 1.5 };
      expect(line(HUDS.HUD(snap(one))).size).toBe(at1);
      expect(at1).toBeGreaterThan(7.5);                                                // bigger than the old 7.5
    });

    // These four are the ONE-row line as it shipped (FB-65), so they run with the second row switched off —
    // which is also the proof that the switch gives back exactly that line.
    it('with nothing picked it lists the first that fit — root, dispel, stun first — and counts the rest', () => {
      resetParts();
      R.hudParts.clickyRows = 0;
      const l = line(HUDS.HUD(snap(eight)));
      expect(l.size).toBe(8.5);                                                       // full size: it drops items, not legibility
      const shown = l.text.replace(/ \+\d+$/, '').split(' · ');
      expect(shown.length).toBeGreaterThan(1);
      expect(shown.length).toBeLessThan(8);
      expect(shown[0]).toMatch(/^Root/);
      expect(shown[1]).toMatch(/^Cancel/);
      expect(l.text).toMatch(new RegExp(' \\+' + (8 - shown.length) + '$'));
    });

    it('the text never runs past its arc, whatever is listed (a textPath draws nothing beyond its end)', () => {
      const lists = [eight, eight.slice(0, 3), eight.slice(0, 1), [C('Supercalifragilisticexpialidocious Staff of Everlasting Torment', 12)],
        Array.from({ length: 40 }, (_, i) => C('Gem of Number ' + i, i % 10, { max: 9 }))];
      for (const clickyRows of [0, 1]) {
        for (const picks of [[], eight.slice(0, 4).map(R.clickyKey), eight.slice(3, 7).map(R.clickyKey)]) {
          for (const scale of [0.7, 1, 1.6]) {
            for (const list of lists) {
              Object.assign(R.hudParts, R.HUD_DEFAULTS, { sizes: { clickies: scale }, clickyPick: picks, clickyRows });
              const l = line(HUDS.HUD(snap(list)));
              expect(l.text.length * 0.6 * l.size).toBeLessThanOrEqual(ARC + 1e-6);
            }
          }
        }
      }
    });

    it('the " +N" that counts the rest has room of its own', () => {
      const list = Array.from({ length: 5 }, (_, i) => C('Aaaaaa' + i, 1));         // 9 characters each with its count
      const f = R.clickyFit(list, 10, 204, false);                                  // 204 / (0.6 × 10) = 34 characters
      const chars = f.items.reduce((a, e) => a + e.len, 0) + 3 * (f.items.length - 1) + (f.more ? 2 + String(f.more).length : 0);
      expect(f.more).toBeGreaterThan(0);
      expect(chars).toBeLessThanOrEqual(34);
    });

    it('the ones you picked are all that show — in the agent\'s order, none dropped, no "+N"', () => {
      Object.assign(R.hudParts, R.HUD_DEFAULTS, { clickyRows: 0, clickyPick: ['ring of shadows', 'rooting rod', 'stunning gem'] });
      const three = line(HUDS.HUD(snap(eight)));
      expect(three.text).toBe('Rooting 3 · Stunning 1 · Shadows 5');                // whole words, with counts, root and stun first
      expect(three.size).toBeGreaterThanOrEqual(7);                                  // shrunk a little to fit, no more
      // four is the most one row lets you tick; they all still show, a name shortening before the text is too small to read
      Object.assign(R.hudParts, R.HUD_DEFAULTS, { clickyRows: 0, clickyPick: ['staff of the serpent', 'ring of shadows', 'rooting rod', 'stunning gem'] });
      const four = line(HUDS.HUD(snap(eight)));
      expect(four.text.split(' · ').map(s => s.split(' ')[0].slice(0, 4))).toEqual(['Root', 'Stun', 'Shad', 'Serp']);
      expect(four.text).not.toContain('+');
      expect(four.size).toBeGreaterThanOrEqual(8.5 * 0.7);
      // fewer picked → bigger: one clicky at the slider's top is far larger than the old line ever was
      Object.assign(R.hudParts, R.HUD_DEFAULTS, { clickyRows: 0, clickyPick: ['ring of shadows'], sizes: { clickies: 1.6 } });
      expect(line(HUDS.HUD(snap(eight))).size).toBeCloseTo(8.5 * 1.6, 5);
    });

    it('picks that are not on you any more fall back to the default list, not a blank line', () => {
      Object.assign(R.hudParts, R.HUD_DEFAULTS, { clickyPick: ['cloak of nothing'] });
      expect(line(HUDS.HUD(snap(eight))).text).toMatch(/^Rooting/);
      expect(R.clickyShown(eight, ['cloak of nothing'])).toEqual(eight.slice(0, R.CLICKY_DEFAULT_N));
    });

    it('an older agent\'s list (no clickies_all) is picked from just the same', () => {
      Object.assign(R.hudParts, R.HUD_DEFAULTS, { clickyPick: ['ring of shadows'] });
      const l = line(HUDS.HUD({ ...base, clickies: eight }));
      expect(l.text).toBe('Shadows 5');
    });

    it('the list the HUD and the picker read drops unlimited and uncounted items, from either agent field (2026-10-08)', () => {
      const rod = C('Abashi\'s Rod of Disempowerment', null, { unlimited: true }), hat = C('Plain Hat', null);
      expect(R.clickyList({ clickies_all: eight.concat([rod, hat]) }).map(c => c.name)).toEqual(eight.map(c => c.name));
      expect(R.clickyList({ clickies: [rod, eight[3], hat] }).map(c => c.name)).toEqual(['Ring of Shadows']);
      expect(R.clickyList({})).toEqual([]);
    });

    it('the picker lists every clicky, ticks the picked, shows kind and charges, and offers Recharged on a charged one', () => {
      const list = eight.concat([C('Rod of Glamour', null, { unlimited: true }), C('Plain Hat', null)]);
      const h = R.clickyPickerHtml(list, ['ring of shadows']);
      expect((h.match(/<input type="checkbox"/g) || []).length).toBe(10);
      expect(h).toContain('data-clk="ring of shadows" checked>');
      expect(h).not.toMatch(/data-clk="rooting rod" checked/);
      expect(h).toContain('<i class="ck ck-root">Root</i>');
      expect(h).toContain('<i class="ck ck-dispel">Dispel</i>');
      expect(h).toContain('<i class="ck ck-stun">Stun</i>');
      expect(h).toContain('<span class="cn">3/3</span>');                              // charges left / full
      expect(h).toMatch(/<span class="cn">∞<\/span>/);
      // Recharged only where there is a full count to put back
      expect((h.match(/data-recharged="/g) || []).length).toBe(8);
      expect(h).toContain('data-recharged="ring of shadows"');
      expect(h).not.toContain('data-recharged="rod of glamour"');
      expect(h).not.toContain('data-recharged="plain hat"');
      expect(h).toContain('Counting 1 of 10');
      expect(h).toContain('data-clk-clear');
    });

    it('with nothing picked it says what the default is and has no Clear; at the most picks the rest cannot be ticked', () => {
      const none = R.clickyPickerHtml(eight, []);
      expect(none).not.toContain('data-clk-clear');
      expect(none).not.toContain(' checked');
      expect(none).not.toContain(' disabled');
      expect(none).toMatch(/root · dispel · stun first/);
      expect(none).toContain('Tick up to ' + R.CLICKY_MAX_PICK + ' to count.');
      // one row (max 4): four ticked, the other four locked
      const four = R.clickyPickerHtml(eight, eight.slice(0, 4).map(R.clickyKey), R.CLICKY_MAX_PICK_ONE);
      expect((four.match(/ checked>/g) || []).length).toBe(4);
      expect((four.match(/ disabled>/g) || []).length).toBe(4);
      expect(four).not.toMatch(/data-clk="rooting rod" checked disabled/);
      expect(four).toContain('Counting 4 of 8 (up to 4).');
      // two rows (the default max): seven ticked, the eighth locked
      const seven = R.clickyPickerHtml(eight, eight.slice(0, 7).map(R.clickyKey));
      expect((seven.match(/ checked>/g) || []).length).toBe(7);
      expect((seven.match(/ disabled>/g) || []).length).toBe(1);
      expect(seven).toContain('Counting 7 of 8 (up to 7).');
    });

    it('item names are escaped, and an empty list says where clickies come from', () => {
      const h = R.clickyPickerHtml([C('Staff <b>"x"</b>', 1, { max: 2 })], []);
      expect(h).toContain('Staff &lt;b&gt;&quot;x&quot;&lt;/b&gt;');
      expect(h).not.toContain('<b>"x"');
      expect(R.clickyPickerHtml([], [])).toMatch(/\/output inventory/);
    });

    it('picks are saved per character as part of the HUD\'s settings, and bad data reads as none', () => {
      const store = {};
      globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
      try {
        store['wpHudParts:aldenmar'] = JSON.stringify({ clickies: 1, clickyPick: ['ring of shadows', 7, 'rooting rod'] });
        expect(R.readParts('Aldenmar').clickyPick).toEqual(['ring of shadows', 'rooting rod']);
        store['wpHudParts:brackwyn'] = JSON.stringify({ clickyPick: 'ring of shadows' });
        expect(R.readParts('Brackwyn').clickyPick).toEqual([]);
        expect(R.readParts('Corvale').clickyPick).toEqual([]);                          // nothing saved
        const a = R.readParts('Corvale'), b = R.readParts('Corvale');
        expect(a.clickyPick).not.toBe(b.clickyPick);                                    // never the default's own array
        expect(a.clickyPick).not.toBe(R.HUD_DEFAULTS.clickyPick);
      } finally { delete globalThis.localStorage; }
    });

    it('the builder gives the part its size slider, puts the picker under it, and its ↺ clears the picks too', () => {
      const body = stripJs(meHtml);
      expect(body).toMatch(/var HUD_SIZED = \[[^\]]*'clickies'/);
      expect(body).toContain("if (g[0] === 'Items') h += '<div id=\"clkpick\"></div>';");
      expect(body).toMatch(/if \(k === 'clickies'\) hudParts\.clickyPick = \[\];/);
      expect(R.HUD_PARTS.find(g => g[0] === 'Items')[1].map(it => it[0])).toEqual(['clickies', 'clickyRows']);
    });

    // The builder's handlers (they sit after the render block, so the test cuts them out and drives them).
    describe('the builder\'s handlers', () => {
      const wiring = sliceBlock(meHtml, '  // Ticking a clicky counts it', "  // Size sliders — each part's");
      // `parts` is the page's own hudParts, so the REAL clickyMaxPick reads the switch the test sets.
      const drive = (picks, last = { character: 'Aldenmar', clickies: eight }, clickyRows = 1) => {
        const handlers = {};
        const parts = Object.assign(R.hudParts, R.HUD_DEFAULTS, { sizes: {}, clickyPick: picks, clickyRows });
        const calls = { saves: 0, refreshes: 0, fetches: [], ticks: 0 };
        const builderList = { addEventListener: (t, fn) => { (handlers[t] = handlers[t] || []).push(fn); } };
        const fetchStub = (url, opts) => { calls.fetches.push([url, opts]); return { then: (ok) => ok() }; };
        // eslint-disable-next-line no-new-func
        new Function('builderList', 'hudParts', '_last', 'clickyPicked', 'clickyList', 'clickyKey', 'clickyMaxPick', 'saveParts', 'refreshClickyPicker',
          'fetch', 'PORT', 'tick', wiring)(builderList, parts, last, R.clickyPicked, R.clickyList, R.clickyKey, R.clickyMaxPick,
          () => { calls.saves++; }, () => { calls.refreshes++; }, fetchStub, 7779, () => { calls.ticks++; });
        const tick = (key, checked) => handlers.change.forEach(fn => fn({ target: { getAttribute: (a) => (a === 'data-clk' ? key : null), checked } }));
        const click = (attrs) => {
          const el = { disabled: false, getAttribute: (a) => attrs[a] };
          handlers.click.forEach(fn => fn({ target: { closest: (sel) => (attrs[sel.slice(1, -1)] !== undefined ? el : null) } }));
          return el;
        };
        return { parts, calls, tick, click };
      };

      it('ticking adds to the picks (no more than the rows hold: four on one, seven on two), unticking removes, Clear empties — each saved', () => {
        const wide = drive([]);
        eight.forEach((c) => wide.tick(R.clickyKey(c), true));
        expect(wide.parts.clickyPick).toHaveLength(R.CLICKY_MAX_PICK);
        expect(wide.parts.clickyPick).toEqual(eight.slice(0, R.CLICKY_MAX_PICK).map(R.clickyKey));   // the first seven ticked, the eighth refused
        const d = drive([], undefined, 0);                                                           // one row
        d.tick('ring of shadows', true); d.tick('rooting rod', true);
        expect(d.parts.clickyPick).toEqual(['ring of shadows', 'rooting rod']);
        d.tick('stunning gem', true); d.tick('orb of sight', true); d.tick('bridle of plenty', true);
        expect(d.parts.clickyPick).toHaveLength(4);
        expect(d.parts.clickyPick).not.toContain('bridle of plenty');
        d.tick('ring of shadows', false);
        expect(d.parts.clickyPick).not.toContain('ring of shadows');
        d.click({ 'data-clk-clear': '1' });
        expect(d.parts.clickyPick).toEqual([]);
        expect(d.calls.saves).toBe(7);
        expect(d.calls.refreshes).toBe(7);
      });

      it('Recharged tells the agent which item on which character, locks the button, and repolls', () => {
        const d = drive([]);
        const el = d.click({ 'data-recharged': 'ring of shadows' });
        expect(el.disabled).toBe(true);
        expect(d.calls.fetches).toHaveLength(1);
        const [url, opts] = d.calls.fetches[0];
        expect(url).toBe('http://127.0.0.1:7779/api/me/clicky-recharged');
        expect(opts.method).toBe('POST');
        expect(JSON.parse(opts.body)).toEqual({ character: 'Aldenmar', item: 'ring of shadows' });
        expect(d.calls.ticks).toBe(1);
        // no character yet, nothing to tell the agent
        const idle = drive([], null);
        idle.click({ 'data-recharged': 'ring of shadows' });
        expect(idle.calls.fetches).toHaveLength(0);
      });
    });

    // The guild lead, 2026-10-07: "add a second clicky row to the HUD". The same 140°–220° arc on a
    // smaller circle one line inside the first, filled after it; ⚙ → Items → "Two clicky rows" (on by
    // default) keeps just the first.
    describe('a second row of clickies', () => {
      // Both rows as drawn: the arc's radius and ends, the font size, the text.
      const rowsOf = (h) => ['hcl', 'hcl2'].map((id) => {
        const m = h.match(new RegExp('<path id="' + id + '" d="M([\\d.]+) ([\\d.]+) A([\\d.]+) [^"]*? ([\\d.]+) ([\\d.]+)"[^>]*/><text font-size="([\\d.]+)"><textPath href="#' + id + '"[^>]*>([\\s\\S]*?)</textPath>'));
        if (!m) return null;
        const ang = (x, y) => (Math.atan2(+x - 200, 200 - +y) * 180 / Math.PI + 360) % 360;
        return { id, r: +m[3], size: +m[6], text: m[7].replace(/<[^>]+>/g, ''), from: ang(m[1], m[2]), to: ang(m[4], m[5]) };
      });
      const shownNames = (rows) => rows.filter(Boolean).flatMap((r) => r.text.replace(/ \+\d+$/, '').split(' · ').filter(Boolean).map((s) => s.replace(/ [\d∞]+$/, '')));
      const ARC1 = 80 * Math.PI / 180 * 122 * 0.96;

      it('8 default clickies fill two rows, in the agent\'s order, with no "+N" at the default size', () => {
        resetParts();
        const [a, b] = rowsOf(HUDS.HUD(snap(eight)));
        expect(a.text.split(' · ')).toEqual(['Rooting 3', 'Cancel 4', 'Stunning 1', 'Shadows 5']);       // root, dispel, stun first, then the rest
        expect(b.text.split(' · ')).toEqual(['Flames 2', 'Sight 1', 'Plenty 3', 'Serpent 4']);
        expect(a.text + b.text).not.toContain('+');
        expect(b.size).toBe(a.size);                                                                      // one size for the pair
        expect(a.size).toBeGreaterThanOrEqual(8.5 * 0.7 - 1e-9);                                           // no smaller than a pick is ever drawn
        // the one-row line only ever held two of them and counted six
        R.hudParts.clickyRows = 0;
        expect(line(HUDS.HUD(snap(eight))).text).toMatch(/ \+6$/);
      });

      it('10 clickies show 8 and count the other 2 — the default list is the first eight, the rest are the "+N"', () => {
        resetParts();
        const stones = ['Alpha', 'Bravo', 'Cobra', 'Delta', 'Echo', 'Fable', 'Gale', 'Haze', 'Iron', 'Jade'];
        const ten = stones.map((s, i) => C('Gem of ' + s, i % 9 + 1));
        const [a, b] = rowsOf(HUDS.HUD(snap(ten)));
        expect(shownNames([a, b])).toEqual(stones.slice(0, 8));
        expect(b.text).toMatch(/ \+2$/);
        expect(a.text).not.toContain('+');
        // the one-row line counts only what fell off its eight (it never did count the ninth and tenth)
        R.hudParts.clickyRows = 0;
        expect(line(HUDS.HUD(snap(ten))).text).not.toMatch(/ \+2$/);
        // more than eight, all short: still eight and the rest counted
        resetParts();
        const twelve = Array.from({ length: 12 }, (_, i) => C('Rod ' + 'ABCDEFGHIJKL'[i], i % 9 + 1));
        const rows12 = rowsOf(HUDS.HUD(snap(twelve)));
        expect(shownNames(rows12)).toHaveLength(8);
        expect(rows12[1].text).toMatch(/ \+4$/);
      });

      it('picks fill the first row before the second: three fit two to a row at full size, two stay on one', () => {
        Object.assign(R.hudParts, R.HUD_DEFAULTS, { clickyPick: ['ring of shadows', 'rooting rod', 'stunning gem'] });
        const [a, b] = rowsOf(HUDS.HUD(snap(eight)));
        expect([a.text, b.text]).toEqual(['Rooting 3 · Stunning 1', 'Shadows 5']);
        expect(a.size).toBe(8.5);                                                  // bigger than the one row's squeezed 7.2
        Object.assign(R.hudParts, R.HUD_DEFAULTS, { clickyPick: ['ring of shadows', 'rooting rod'] });
        const two = rowsOf(HUDS.HUD(snap(eight)));
        expect(two[0].text).toBe('Rooting 3 · Shadows 5');
        expect(two[1]).toBeNull();                                                  // nothing for a second row to hold
        expect(rowsOf(HUDS.HUD(snap([C('Bracer', 3)])))[1]).toBeNull();
      });

      it('what still does not fit after two rows is counted, with room of its own — and nothing runs past its arc', () => {
        resetParts();
        const long = Array.from({ length: 8 }, (_, i) => C('Supercalifragilistic Staff of Everlasting Torment ' + 'abcdefgh'[i], 10 + i));
        const [a, b] = rowsOf(HUDS.HUD(snap(long)));
        const shown = shownNames([a, b]).length;
        expect(shown).toBeLessThan(8);
        expect(b.text).toMatch(new RegExp(' \\+' + (8 - shown) + '$'));
        expect(a.size).toBeCloseTo(8.5 * 0.7, 5);                                  // the least a pick shrinks to, then it counts
        for (const clickyRows of [0, 1]) for (const scale of [0.7, 1, 1.6]) for (const list of [eight, long, eight.slice(0, 5)]) for (const picks of [[], eight.slice(0, 7).map(R.clickyKey)]) {
          Object.assign(R.hudParts, R.HUD_DEFAULTS, { sizes: { clickies: scale }, clickyPick: picks, clickyRows });
          const [r1, r2] = rowsOf(HUDS.HUD(snap(list)));
          expect(r1.text.length * 0.6 * r1.size).toBeLessThanOrEqual(ARC1 + 1e-6);
          if (r2) expect(r2.text.length * 0.6 * r2.size).toBeLessThanOrEqual(ARC1 * r2.r / 122 + 1e-6);   // a shorter arc, a shorter line
        }
        // a " +N" with nowhere else to go stands alone on the second row rather than push a name off the first
        const f = R.clickyFit([C('Aaaaaaaaaaaaaaa', 12), C('Bbbbbbbbbbbbbbb', 13)], 8.5, ARC1, false, 2, 3);
        expect(f.rows.map(r => r.length)).toEqual([2, 0]);
        expect([f.more, f.tail, f.size]).toEqual([3, 1, 8.5]);
      });

      it('the second row is the same arc one line inside the first: same ends, a smaller circle', () => {
        resetParts();
        const [a, b] = rowsOf(HUDS.HUD(snap(eight)));
        expect(a.r).toBe(R.CLICKY_R);
        expect(R.CLICKY_R).toBe(122);                                              // where the one-row line always sat
        expect(a.r - b.r).toBeCloseTo(R.CLICKY_PITCH * a.size, 1);
        for (const r of [a, b]) {
          expect(r.from).toBeCloseTo(220, 0);                                      // written left to right along the bottom
          expect(r.to).toBeCloseTo(140, 0);
        }
      });

      // Every arc and label the HUD draws, with the band of radii it occupies and the angles it spans.
      const bands = (h) => {
        const out = [], ang = (x, y) => (Math.atan2(+x - 200, 200 - +y) * 180 / Math.PI + 360) % 360;
        const push = (id, r, sweep, p0, p1, lo, hi) => {
          let s = sweep ? ang(...p0) : ang(...p1), e = sweep ? ang(...p1) : ang(...p0);
          if (e < s) e += 360;
          out.push({ id, r, s, e, lo, hi });
        };
        for (const m of h.matchAll(/<path id="(\w+)" d="M([\d.-]+) ([\d.-]+) A([\d.]+) [\d.]+ 0 [01] ([01]) ([\d.-]+) ([\d.-]+)"[^>]*\/><text font-size="([\d.]+)"/g)) {
          const r = +m[4], fs = +m[8], below = m[5] === '0';
          push(m[1], r, +m[5], [m[2], m[3]], [m[6], m[7]], below ? r - 0.72 * fs : r - 0.25 * fs, below ? r + 0.25 * fs : r + 0.72 * fs);
        }
        for (const m of h.matchAll(/<path d="M([\d.-]+) ([\d.-]+) A([\d.]+) [\d.]+ 0 [01] ([01]) ([\d.-]+) ([\d.-]+)" stroke="[^"]*" stroke-width="([\d.]+)"/g)) {
          push('stroke@' + m[3], +m[3], +m[4], [m[1], m[2]], [m[5], m[6]], +m[3] - +m[7] / 2, +m[3] + +m[7] / 2);
        }
        return out;
      };
      const overlapsSpan = (b, lo, hi) => [-360, 0, 360].some((k) => b.s + k < hi && b.e + k > lo);
      // Everything on at once, so every neighbour of the rows is drawn.
      const fullSnap = (list) => Object.assign({}, base, {
        target: Object.assign({}, base.target, { my_procs: 5, my_stuns: 2, level: 52, class: 'Warrior', resists: { mr: 50, fr: 30, cr: 30, pr: 50, dr: 75 } }),
        combat: Object.assign({}, base.combat, { ds: { hits: 3, total: 114, last: 38, per_hit: 38, from_buffs: true, kind: 'thorns' } }),
        track: { name: 'a gnoll', angle: 90, age_ms: 1000 }, rampage: { name: 'Brackwyn', hp_pct: 40 }, low_hp: [{ name: 'Corvale', hp_pct: 12 }],
        clickies: list.slice(0, 8), clickies_all: list.length > 8 ? list : undefined,
      });

      // The free band, found by reading every part's radius and angles off the real drawing: along the
      // bottom the stack outward from the middle is the clear middle (r < 110) · the damage-shield button's
      // corner · the clicky line (122) · resists (136) · cooldown bar (150) and labels (159–165) · the
      // endurance arc (162, but 240°–300°) · tick and swing (172, labels at 187). Only inside is free.
      it('sits in the free band just inside the first row: clear of resists, cooldowns, tick and swing, the shield button and the hit columns', () => {
        for (const scale of [0.7, 1, 1.6]) {
          Object.assign(R.hudParts, R.HUD_DEFAULTS, { sizes: { clickies: scale } });
          const h = HUDS.HUD(fullSnap(eight));
          const [a, b] = rowsOf(h);
          const s = a.size;
          const lo = b.r - 0.72 * s, hi = a.r + 0.25 * s;                  // capitals' tops of the second row … descenders of the first
          expect(b.r + 0.25 * s, 'the rows touch').toBeLessThan(a.r - 0.72 * s);   // one clear gap between them
          const all = bands(h), near = all.filter((x) => !/^hcl2?$/.test(x.id) && overlapsSpan(x, 140, 220));
          // the neighbours really are in the picture (a vacuous scan would pass anything) …
          const ids = near.map((x) => x.id);
          for (const id of ['hrs', 'hcd0', 'hcd1', 'hcd2', 'hsw', 'htk']) expect(ids, id).toContain(id);
          expect(near.some((x) => x.id === 'stroke@150'), 'the cooldown bar').toBe(true);
          // … and not one of them reaches into the two rows' band
          for (const x of near) expect(x.hi < lo || x.lo > hi, x.id + ' ' + x.lo.toFixed(1) + '–' + x.hi.toFixed(1) + ' vs ' + lo.toFixed(1) + '–' + hi.toFixed(1)).toBe(true);
          // nearest outside neighbour (resists) keeps a gap off the first row
          const above = Math.min(...near.filter((x) => x.lo > hi).map((x) => x.lo));
          expect(above - hi).toBeGreaterThan(scale === 1.6 ? 0 : 3);
          // the damage-shield button (centre 286,272; thorns or lava reach 21) and its column are never touched
          const ds = [286, 272];
          // (the text fills at most 96% of its arc, so it stops 2% of the span short of each end)
          for (const row of [a, b]) for (const deg of [row.to + 0.02 * (row.from - row.to), row.from - 0.02 * (row.from - row.to)]) for (let k = 0; k <= 10; k++) {
            const rr = row.r - 0.72 * s + 0.97 * s * k / 10, t = deg * Math.PI / 180;
            const x = 200 + rr * Math.sin(t), y = 200 - rr * Math.cos(t);
            expect(Math.hypot(x - ds[0], y - ds[1]), 'shield button').toBeGreaterThan(22);
            expect(y, 'procs row and hit columns above').toBeGreaterThan(Math.max(R.MINE_Y, R.HIT_LANES.hout.y + (R.HIT_LANES.hout.rows - 1) * R.HIT_STEP) + 20);
            expect(x, 'shield column').toBeLessThan(R.HIT_LANES.hds.innerX - 20);
          }
        }
        // at the default size (three picks keep the full 8.5) the second row dips under 4 units into the
        // clear middle (r < 110) — the cost the switch exists for; the first never did
        Object.assign(R.hudParts, R.HUD_DEFAULTS, { sizes: {}, clickyPick: ['ring of shadows', 'rooting rod', 'stunning gem'] });
        const [a, b] = rowsOf(HUDS.HUD(fullSnap(eight)));
        expect(b.size).toBe(8.5);
        expect(b.r - 0.72 * b.size).toBeGreaterThan(106);
        expect(b.r - 0.72 * b.size).toBeLessThan(110);
        expect(a.r - 0.72 * a.size).toBeGreaterThan(110);
        // squeezed to the least a pick shrinks to (what 8 default clickies get), it stays out of the middle altogether
        Object.assign(R.hudParts, R.HUD_DEFAULTS, { sizes: {} });
        const [, d] = rowsOf(HUDS.HUD(fullSnap(eight)));
        expect(d.r - 0.72 * d.size).toBeGreaterThan(110);
      });

      it('with the switch off the ring draws exactly the one-row line it always drew — same fit, same label', () => {
        // The one-row fit as it shipped (FB-65), kept here word for word as the yardstick.
        const oldFit = (list, size, room, all) => {
          const tries = all ? [[1, 10], [1, 8], [0.85, 10], [0.85, 8], [0.7, 10], [0.7, 8], [0.7, 7], [0.7, 6]] : [[1, 10], [1, 8], [0.9, 10], [0.9, 8]];
          const entries = (cap) => list.map((c) => { const nm = R.clickyShort(c.name, cap), n = c.unlimited ? '∞' : (c.left == null ? '' : String(c.left)); return { c, nm, n, len: nm.length + (n ? 1 + n.length : 0) }; });
          let s, B, es;
          for (let ti = 0; ti < tries.length; ti++) {
            s = size * tries[ti][0]; B = Math.floor(room / (0.6 * s)); es = entries(tries[ti][1]);
            if (es.reduce((a, e) => a + e.len, 0) + 3 * (es.length - 1) <= B) return { items: es, more: 0, size: s };
          }
          s = size * (all ? 0.7 : 1); B = Math.floor(room / (0.6 * s)); es = entries(8);
          const keep = []; let used = 0;
          for (let i = 0; i < es.length; i++) {
            const add = es[i].len + (keep.length ? 3 : 0);
            if (keep.length && used + add + 4 > B) break;
            used += add; keep.push(es[i]);
          }
          return { items: keep, more: es.length - keep.length, size: s };
        };
        const shape = (f) => JSON.stringify({ items: f.items.map((e) => [e.nm, e.n, e.len]), more: f.more, size: f.size });
        let seed = 20261007;
        const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
        const words = ['Ring of Shadows', 'Rooting Rod', 'Bracer', 'White Ornate Chain Bridle', 'Staff of the Serpent', 'Orb of Sight', 'Gem', 'Supercalifragilistic Staff', 'The Gnarled Staff', 'Cloak of Flames'];
        const counts = [null, 0, 1, 2, 5, 9, 12, 99];
        let n = 0;
        for (let k = 0; k < 600; k++) {
          const list = Array.from({ length: 1 + Math.floor(rnd() * 12) }, (_, i) => C(words[Math.floor(rnd() * words.length)] + ' ' + i, counts[Math.floor(rnd() * counts.length)], { unlimited: rnd() < 0.1 }));
          const size = 8.5 * [0.7, 1, 1.3, 1.6][Math.floor(rnd() * 4)], all = rnd() < 0.5;
          const was = shape(oldFit(list, size, ARC1, all));
          expect(shape(R.clickyFit(list, size, ARC1, all)), 'default rows').toBe(was);
          expect(shape(R.clickyFit(list, size, ARC1, all, 1, 0)), 'one row').toBe(was);
          n++;
        }
        expect(n).toBe(600);
        // and the label itself: same radius, same ends, same text as that fit gives, no second row
        for (const scale of [0.7, 1, 1.6]) for (const picks of [[], ['ring of shadows', 'rooting rod', 'stunning gem', 'cloak of flames']]) for (const list of [eight, eight.slice(0, 3), eight.slice(0, 1)]) {
          Object.assign(R.hudParts, R.HUD_DEFAULTS, { sizes: { clickies: scale }, clickyPick: picks, clickyRows: 0 });
          const [a, b] = rowsOf(HUDS.HUD(snap(list)));
          const f = oldFit(R.clickyShown(list, picks), 8.5 * scale, ARC1, R.clickyPicked(list, picks).length > 0);
          expect(a.text).toBe(f.items.map((e) => e.nm + (e.n ? ' ' + e.n : '')).join(' · ') + (f.more ? ' +' + f.more : ''));
          expect(a.size).toBe(f.size);
          expect(a.r).toBe(122);
          expect([Math.round(a.from), Math.round(a.to)]).toEqual([220, 140]);
          expect(b).toBeNull();
        }
      });

      it('most picks is what the rows hold at the least size, worked out with the fit math (7 on two rows, 4 on one)', () => {
        // The worst pick the fit ever draws: a name shortened to the smallest cap it tries (6), a space and a two-digit count.
        const worst = (n) => Array.from({ length: n }, (_, i) => C('Unpronounceable' + String.fromCharCode(97 + i), 10 + i));
        const two = R.clickyFit(worst(R.CLICKY_MAX_PICK), 8.5, ARC1, true, 2);
        expect([two.more, two.rows.map((r) => r.length)]).toEqual([0, [4, 3]]);
        expect(two.size).toBeCloseTo(8.5 * 0.7, 5);
        expect(R.clickyFit(worst(R.CLICKY_MAX_PICK + 1), 8.5, ARC1, true, 2).more).toBeGreaterThan(0);   // an eighth would be counted, not shown
        const one = R.clickyFit(worst(R.CLICKY_MAX_PICK_ONE), 8.5, ARC1, true, 1);
        expect([one.more, one.rows.map((r) => r.length)]).toEqual([0, [4]]);
        expect(R.clickyFit(worst(R.CLICKY_MAX_PICK_ONE + 1), 8.5, ARC1, true, 1).more).toBeGreaterThan(0);
        expect([R.CLICKY_MAX_PICK, R.CLICKY_MAX_PICK_ONE]).toEqual([7, 4]);
        // the page asks for the number that matches the switch
        R.hudParts.clickyRows = 1; expect(R.clickyMaxPick()).toBe(7);
        R.hudParts.clickyRows = 0; expect(R.clickyMaxPick()).toBe(4);
      });

      describe('the switch in the builder', () => {
        const noop = () => {};
        const wire = (src, deps) => {
          const handlers = [], el = { addEventListener: (t, fn) => handlers.push([t, fn]) };
          // eslint-disable-next-line no-new-func
          new Function('builderList', 'builderEl', 'hudParts', 'HUD_DEFAULTS', 'reshapeForHits', 'renderBuilder', 'saveParts', src)(
            el, el, R.hudParts, R.HUD_DEFAULTS, noop, deps.renderBuilder || noop, deps.saveParts || noop);
          return handlers;
        };

        it('is a checkbox in the Items group, on by default, with its own ↺ and no size slider', () => {
          expect(R.HUD_DEFAULTS.clickyRows).toBe(1);
          const src = sliceBlock(meHtml, '  function renderBuilder(){', "    if (all) all.value = String((hudParts.sizes && +hudParts.sizes.all) || 1);\n  }");
          const paint = (rows) => {
            const builderList = { innerHTML: '' };
            Object.assign(R.hudParts, R.HUD_DEFAULTS, { clickyRows: rows });
            // eslint-disable-next-line no-new-func
            new Function('HUD_PARTS', 'hudParts', 'HUD_SIZED', 'esc', 'builderList', 'refreshClickyPicker', '_hudPartsFor', 'document', src + '\nrenderBuilder();')(
              R.HUD_PARTS, R.hudParts, R.HUD_SIZED, R.esc, builderList, noop, null, { getElementById: () => null });
            return builderList.innerHTML;
          };
          const on = paint(1), off = paint(0);
          expect(on).toMatch(/<input type="checkbox" data-part="clickyRows" checked> <span class="bl">Two clicky rows/);
          expect(off).toMatch(/<input type="checkbox" data-part="clickyRows"> <span class="bl">Two clicky rows/);
          expect(on).toContain('data-reset="clickyRows"');
          expect(on).not.toContain('data-size="clickyRows"');
          expect(on.indexOf('data-part="clickyRows"')).toBeGreaterThan(on.indexOf('data-part="clickies"'));
          expect(on.indexOf('data-part="clickyRows"')).toBeLessThan(on.indexOf('id="clkpick"'));            // above the picker, in the same group
        });

        it('the picker\'s limit follows the switch: seven to tick on two rows, four on one', () => {
          const src = sliceBlock(meHtml, '  function refreshClickyPicker(force){', "    if (force || el._html !== html) { el.innerHTML = html; el._html = html; }\n  }");
          const paint = (rows) => {
            const el = {};
            Object.assign(R.hudParts, R.HUD_DEFAULTS, { clickyRows: rows });
            // eslint-disable-next-line no-new-func
            new Function('document', 'clickyPickerHtml', 'clickyList', '_last', 'hudParts', 'clickyMaxPick', src + '\nrefreshClickyPicker(true);')(
              { getElementById: () => el }, R.clickyPickerHtml, R.clickyList, { clickies: eight }, R.hudParts, R.clickyMaxPick);
            return el.innerHTML;
          };
          expect(paint(1)).toContain('Tick up to 7 to count.');
          expect(paint(0)).toContain('Tick up to 4 to count.');
        });

        it('unticking it keeps one row and saves; ticking it puts the second back', () => {
          const src = sliceBlock(meHtml, "  builderList.addEventListener('change', function(e){\n    var k = e.target && e.target.getAttribute('data-part');", '    saveParts();\n  });');
          let saves = 0;
          const [[, change]] = wire(src, { saveParts: () => { saves++; } });
          const box = (checked) => ({ target: { type: 'checkbox', checked, value: 'on', getAttribute: (a) => (a === 'data-part' ? 'clickyRows' : null) } });
          Object.assign(R.hudParts, R.HUD_DEFAULTS);
          change(box(false));
          expect(R.hudParts.clickyRows).toBe(0);
          expect(rowsOf(HUDS.HUD(snap(eight)))[1]).toBeNull();
          change(box(true));
          expect(R.hudParts.clickyRows).toBe(1);
          expect(rowsOf(HUDS.HUD(snap(eight)))[1]).not.toBeNull();
          expect(saves).toBe(2);
        });

        it('its ↺ puts the default (two rows) back — and leaves the picks and sizes alone', () => {
          const src = sliceBlock(meHtml, "  builderEl.addEventListener('click', function(e){\n    var b = e.target && e.target.closest ? e.target.closest('[data-reset]') : null;", '    renderBuilder(); saveParts();\n  });');
          let paints = 0, saves = 0;
          const [[, click]] = wire(src, { renderBuilder: () => { paints++; }, saveParts: () => { saves++; } });
          Object.assign(R.hudParts, R.HUD_DEFAULTS, { clickyRows: 0, clickyPick: ['ring of shadows'], sizes: { clickies: 1.3 } });
          click({ preventDefault: noop, target: { closest: () => ({ getAttribute: () => 'clickyRows' }) } });
          expect(R.hudParts.clickyRows).toBe(1);
          expect(R.hudParts.clickyPick).toEqual(['ring of shadows']);
          expect(R.hudParts.sizes).toEqual({ clickies: 1.3 });
          expect([paints, saves]).toEqual([1, 1]);
          // the whole builder's reset goes back to it too (it assigns every default)
          Object.assign(R.hudParts, R.HUD_DEFAULTS, { clickyRows: 0 });
          Object.keys(R.hudParts).forEach((k) => { delete R.hudParts[k]; });
          Object.assign(R.hudParts, R.HUD_DEFAULTS, { sizes: {} });
          expect(R.hudParts.clickyRows).toBe(1);
        });

        it('is saved per character; a character saved before it existed gets two rows', () => {
          const store = {};
          globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
          try {
            store['wpHudParts:aldenmar'] = JSON.stringify({ clickies: 1, clickyRows: 0 });
            store['wpHudParts:brackwyn'] = JSON.stringify({ clickies: 1, clickyPick: ['ring of shadows'] });
            expect(R.readParts('Aldenmar').clickyRows).toBe(0);
            expect(R.readParts('Brackwyn').clickyRows).toBe(1);                 // older save: the default
            expect(R.readParts('Corvale').clickyRows).toBe(1);                  // nothing saved
          } finally { delete globalThis.localStorage; }
        });
      });
    });
  });

  // The guild lead, 2026-10-02: the DS amount "wrapped in a thorny green area if it's druid DS or
  // glowing lava if mage ds".
  it('HUD wraps the damage-shield button in thorns for a druid shield and lava for a mage one', () => {
    const fn = HUDS.HUD || Object.values(HUDS)[0];
    const ds = (kind) => fn(Object.assign({}, base, { combat: Object.assign({}, base.combat, { ds: { hits: 3, total: 114, last: 38, per_hit: 38, from_buffs: true, kind } }) }));
    const thorns = ds('thorns'), fire = ds('fire'), plain = ds(null);
    expect(thorns).toMatch(/<path d="M[^"]+ Z" fill="#1d5c2e" stroke="var\(--green\)"/);
    expect(thorns).not.toContain('dslava');
    expect(fire).toContain('fill="url(#dslava)"');
    expect(fire).not.toContain('#1d5c2e');
    expect(plain).not.toContain('#1d5c2e');
    expect(plain).not.toContain('dslava');
    expect(plain).toMatch(/r="13" fill="rgba\(13,17,23,0\.72\)" stroke="var\(--orange\)"/);
  });

  // The guild lead, 2026-10-02 (Mark of the Plague Lords): "should be reflected in the hud".
  it('HUD shows the damage-shield button red "DS OFF" with the time left while a cancelling debuff is up', () => {
    const fn = HUDS.HUD || Object.values(HUDS)[0];
    const off = { name: 'Mark of the Plague Lords', heals: 50, seconds: 125 };
    const h = fn(Object.assign({}, base, { combat: Object.assign({}, base.combat, { ds: { hits: 3, total: 114, last: 38, per_hit: 0, from_buffs: true, kind: null, off } }) }));
    expect(h).toMatch(/r="13" fill="rgba\(60,8,8,0\.82\)" stroke="#f85149"[^>]*stroke-dasharray="3 2"/);
    expect(h).toMatch(/>DS OFF</);
    expect(h).toMatch(/>2:05</);
    expect(h).not.toContain('#1d5c2e');
    expect(h).not.toContain('dslava');
  });

  for (const [name, fn] of Object.entries(HUDS)) {
    it(name + ' keeps the middle open — no straight text within 95 units of the centre', () => {
      // Round eight curved the level and slow lines, so the straight text left is
      // ENRAGED and the damage-shield button — both measured here.
      const deep = { level: 40, level_max: 43, class: 'Necromancer', resists: { mr: 50, fr: 30, cr: 30, pr: 50, dr: 75 } };
      const h = fn(Object.assign({}, cleric, { casting: { spell: 'Complete Healing', pct: 40, remaining_ms: 6000 } }))
        + fn(Object.assign({}, base, { target: Object.assign({}, base.target, deep, { enraged: true }) }))
        + fn(Object.assign({}, base, { combat: Object.assign({}, base.combat, { ds: { hits: 3, total: 114, last: 38, per_hit: 138, from_buffs: false } }) }));
      expect(h).toContain('>DS~<');                                  // the button's own text is measured too
      const boxes = [...h.matchAll(/<text x="([\d.]+)" y="([\d.]+)" font-size="([\d.]+)"[^>]*?text-anchor="(\w+)"[^>]*>([\s\S]*?)<\/text>/g)];
      expect(boxes.map(m => m[5].replace(/<[^>]+>/g, ''))).toEqual(expect.arrayContaining(['ENRAGED', 'DS~', '138']));
      for (const m of boxes) {
        const x = +m[1], y = +m[2], size = +m[3], anchor = m[4];
        const w = m[5].replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '_').length * size * 0.6;
        const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
        const nx = Math.max(x0, Math.min(200, x0 + w)), ny = Math.max(y - size, Math.min(200, y));
        expect(Math.hypot(nx - 200, ny - 200), m[5]).toBeGreaterThan(95);
      }
    });
  }

  // The hit columns are upright (round five: "Text should be vertically
  // aligned"), so every piece is a box. Round eight hugs them to the ring
  // ("Summations of hits should not overlap with the outside rings"), so the
  // check runs over what is actually DRAWN at the worst a column carries in
  // practice: six four-digit hits a round plus the off-hand tag, eight rounds
  // listed and all of them hit by hit, two mobs' long totals — every box off
  // the middle and inside the ring's stroke (r 169), at the largest text too.
  it('the hit columns stay between the open middle and the ring — every piece drawn, at the worst case', () => {
    const at = 1_790_000_000_000;
    const big = [0, 3, 6, 9, 12, 15, 18, 21].flatMap(sec => [1240, 1180, 1320, 1111, 1402, 1255].map((n, i) => ({
      dir: 'out', amount: n, kind: 'melee', name: 'slash', hand: i % 2 ? 'OH' : 'MH', other: 'a gnoll', at: at - sec * 1000, age_ms: sec * 1000 })));
    const feed = big.concat(big.map(f => Object.assign({}, f, { dir: 'in' })), big.map(f => Object.assign({}, f, { kind: 'ds', hand: null })))
      .sort((a, b) => b.at - a.at);
    const tallies = [
      { key: 'a gnoll|alive', name: 'a gnoll', out: 1234567, in: 1234567, ds: 123456, first: at - 60_000, last: at, dead_at: null },
      { key: 'an elder thought horror|alive', name: 'an elder thought horror', out: 987654, in: 987654, ds: 98765, first: at - 60_000, last: at, dead_at: null },
    ];
    const snap = Object.assign({}, base, { combat: { live: true, secs: 30, out: { dps: 0, by: {} }, in: { dps: 0, by: {} }, feed, tallies,
      ds: { hits: 8, total: 112, per_hit: 14, from_buffs: true } } });
    for (const scale of [1, 1.6]) {
      Object.assign(R.hudParts, R.HUD_DEFAULTS, { rounds: 8, split: 8, sizes: { hitsIn: scale, hitsOut: scale, ds: scale } });
      const its = R.hudLanes(R.hudData(snap), R.hudParts).items;
      for (const id of Object.keys(R.HIT_LANES)) expect(its.some(it => it.lane === id), id).toBe(true);
      for (const it of its) {
        const w = it.text.length * 0.6 * it.size + (it.hand === 'OH' ? 3 * 6 * 0.6 : 0);
        const x0 = it.x, x1 = x0 + w, top = it.y - it.size;
        const nx = Math.max(x0, Math.min(200, x1)), ny = Math.max(top, Math.min(200, it.y));
        expect(Math.hypot(nx - 200, ny - 200), it.lane + ' ' + it.text + ' off the middle').toBeGreaterThan(95);
        for (const [cx, cy] of [[x0, top], [x1, top], [x0, it.y], [x1, it.y]]) {
          expect(Math.hypot(cx - 200, cy - 200), it.lane + ' ' + it.text + ' inside the ring').toBeLessThan(169);
        }
      }
    }
    Object.assign(R.hudParts, R.HUD_DEFAULTS);
  });

  // "Right justify outbound hits and left justify inbound hits. These should
  // travel up the outside arc, but still be oriented correctly." Each line's
  // outer end sits on the same arc just inside the ring — so the column's edge
  // curves with the ring while every number stays upright.
  it('your hits end flush against the ring on the right; hits on you start flush against it on the left', () => {
    const at = 1_790_000_000_000;
    const feed = [0, 3, 6, 9, 12].flatMap(sec => [45, 51, 88].map(n => ({ dir: 'out', amount: n, kind: 'melee', name: 'punch', other: 'a gnoll', at: at - sec * 1000, age_ms: sec * 1000 })))
      .concat([0, 3, 6].map(sec => ({ dir: 'in', amount: 169, kind: 'melee', name: 'hits', other: 'a gnoll', at: at - sec * 1000, age_ms: sec * 1000 })));
    Object.assign(R.hudParts, R.HUD_DEFAULTS);
    const its = R.hudLanes(R.hudData(Object.assign({}, base, { combat: { live: true, secs: 30, out: { dps: 0, by: {} }, in: { dps: 0, by: {} }, feed } })), R.hudParts).items;
    const lines = (id) => {
      const by = {};
      for (const it of its.filter(x => x.lane === id)) (by[it.y] = by[it.y] || []).push(it);
      return Object.values(by).map(row => ({ y: row[0].y, size: row[0].size, x0: Math.min(...row.map(i => i.x)), x1: Math.max(...row.map(i => i.x + i.text.length * 0.6 * i.size)) }));
    };
    const outs = lines('hout'), ins = lines('hin');
    expect(outs.length).toBeGreaterThan(2);
    expect(ins.length).toBeGreaterThan(1);
    for (const l of outs) expect(l.x1).toBeCloseTo(R.laneSpan(R.HIT_LANES.hout, l.y, l.size).outer, 3);
    for (const l of ins) expect(l.x0).toBeCloseTo(R.laneSpan(R.HIT_LANES.hin, l.y, l.size).outer, 3);
    // …which is an arc: the lines further from the middle of the ring start further in.
    const byY = outs.slice().sort((a, b) => a.y - b.y);
    expect(byY[0].x1).toBeLessThan(byY[byY.length - 1].x1);
    for (const it of its) expect(it.anchor).toBe('start');           // upright text, placed by its measured width
  });

  // The guild lead, 2026-09-25: "add an option for the HUD to have damage numbers
  // outside the circle." Builder: Hits → Numbers inside/outside. Mirrored: your
  // hits START flush against the outside of the ring on the right, hits on you
  // END flush against it on the left — never over the ring or its labels, never
  // past the widened window (LANE_EXT a side).
  it('numbers outside the ring: mirrored, clear of the ring, inside the widened window', () => {
    const part = R.HUD_PARTS.flatMap(g => g[1]).find(it => it[0] === 'hitsSide');
    expect(part && part[2]).toEqual(['inside', 'outside']);
    expect(R.HUD_DEFAULTS.hitsSide).toBe('inside');
    const at = 1_790_000_000_000;
    const feed = [0, 3, 6, 9, 12].flatMap(sec => [45, 51, 88, 120, 77, 64].map(n => ({ dir: 'out', amount: n, kind: 'melee', name: 'punch', other: 'a gnoll', at: at - sec * 1000, age_ms: sec * 1000 })))
      .concat([0, 3, 6].map(sec => ({ dir: 'in', amount: 169, kind: 'melee', name: 'hits', other: 'a gnoll', at: at - sec * 1000, age_ms: sec * 1000 })));
    Object.assign(R.hudParts, R.HUD_DEFAULTS, { hitsSide: 'outside' });
    try {
      const its = R.hudLanes(R.hudData(Object.assign({}, base, { combat: { live: true, secs: 30, out: { dps: 0, by: {} }, in: { dps: 0, by: {} }, feed } })), R.hudParts).items;
      const lines = (id) => {
        const by = {};
        for (const it of its.filter(x => x.lane === id)) (by[it.y] = by[it.y] || []).push(it);
        return Object.values(by).map(row => ({ y: row[0].y, size: row[0].size, x0: Math.min(...row.map(i => i.x)), x1: Math.max(...row.map(i => i.x + i.text.length * 0.6 * i.size)) }));
      };
      const outs = lines('hout'), ins = lines('hin');
      expect(outs.length).toBeGreaterThan(2);
      expect(ins.length).toBeGreaterThan(1);
      for (const l of outs) expect(l.x0).toBeCloseTo(R.laneSpan(R.HIT_LANES.hout, l.y, l.size).outer, 3);   // flush left, on the ring's side
      for (const l of ins) expect(l.x1).toBeCloseTo(R.laneSpan(R.HIT_LANES.hin, l.y, l.size).outer, 3);    // flush right, on the ring's side
      for (const l of outs.concat(ins)) {
        const near = l.x0 > 200 ? l.x0 : l.x1;                      // the end nearest the ring
        const dy = Math.min(Math.abs(l.y - 200), Math.abs(l.y - l.size - 200));
        expect(Math.hypot(near - 200, dy)).toBeGreaterThanOrEqual(196.9);   // r 197: past the ring and its health/mana labels
        expect(l.x0).toBeGreaterThanOrEqual(-120 - 0.01);
        expect(l.x1).toBeLessThanOrEqual(520 + 0.01);
      }
    } finally {
      Object.assign(R.hudParts, R.HUD_DEFAULTS);
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

  // Round eight, the guild lead: "In the last screenshot the 62 69 110 line should
  // have been combined into [one number] for that round of combat on the third
  // line up." So a column reads: the mob's total, older rounds ONE number each
  // (that round's sum), and only the newest rounds hit by hit.
  const rounds = (list) => list.flatMap(([sec, a]) => a.slice().reverse().map(n => hit('out', n, sec)));   // newest first, as the agent sends
  it('the mob\'s total on top, older rounds as their sum, the newest hit by hit — newest at the bottom', () => {
    reset();
    const feed = rounds([[0, [10, 20]], [3, [30]], [6, [40, 50]]]);
    expect(lane(withTallies(feed, [gnoll({ out: 1234 })]), 'hout')).toEqual(['Σ 1,234', '90', '30', '10 20']);
    R.hudParts.split = 3;                                              // the builder: three rounds hit by hit
    expect(lane(withTallies(feed, [gnoll({ out: 1234 })]), 'hout')).toEqual(['Σ 1,234', '40 50', '30', '10 20']);
    reset();
  });

  it('the in-game case: four rounds of three — the older two read as one number each', () => {
    reset();
    const feed = rounds([[0, [89, 45, 43]], [3, [45, 51, 88]], [6, [69, 62, 110]], [9, [17, 30, 37]]]);
    expect(lane(withTallies(feed, [gnoll({ out: 3052 })]), 'hout')).toEqual(['Σ 3,052', '84', '241', '45 51 88', '89 45 43']);
  });

  // "It should be animated and smooth, not just jump. Have them slide and
  // smoosh together into the new number" (round five) — each hit that leaves
  // is sent to where its round's sum now stands, keyed as it was on screen.
  it('when the next round lands, the oldest split round\'s hits slide onto its sum', () => {
    reset();
    const before = withTallies(rounds([[3, [45, 51, 88]], [6, [69, 62, 110]]]), [gnoll({ out: 425 })]);
    const after = withTallies(rounds([[0, [89, 45, 43]], [3, [45, 51, 88]], [6, [69, 62, 110]]]), [gnoll({ out: 602 })]);
    expect(lane(before, 'hout')).toEqual(['Σ 425', '69 62 110', '45 51 88']);
    expect(lane(after, 'hout')).toEqual(['Σ 602', '241', '45 51 88', '89 45 43']);
    const was = R.hudLanes(R.hudData(before), R.hudParts).items.filter(it => ['69', '62', '110'].includes(it.text));
    const L = R.hudLanes(R.hudData(after), R.hudParts);
    const sum = L.items.find(it => it.text === '241');
    const g = L.ghosts.filter(x => x.lane === 'hout');
    expect(g.map(x => x.key).sort()).toEqual(was.map(it => it.key).sort());   // the three elements that were on screen
    for (const x of g) expect(x.y).toBe(sum.y);                                // …all onto the sum's line
    reset();
  });

  it('a round past the "rounds" setting slides up into the total — its hits and its sum, whichever was showing', () => {
    reset();
    R.hudParts.rounds = 2; R.hudParts.split = 1;
    const before = withTallies(rounds([[3, [30, 40]], [6, [50]]]), [gnoll({ out: 120 })]);
    const after = withTallies(rounds([[0, [10]], [3, [30, 40]], [6, [50]]]), [gnoll({ out: 130 })]);
    expect(lane(before, 'hout')).toEqual(['Σ 120', '50', '30 40']);
    expect(lane(after, 'hout')).toEqual(['Σ 130', '70', '10']);
    const L = R.hudLanes(R.hudData(after), R.hudParts);
    const total = L.items.find(it => it.total);
    const g = L.ghosts.filter(x => x.lane === 'hout');
    const sumWas = R.hudLanes(R.hudData(before), R.hudParts).items.find(it => it.text === '50');
    const toTotal = g.filter(x => x.y === total.y);
    expect(toTotal.map(x => x.key)).toContain(sumWas.key);                    // the element that was on screen
    // …landing right-aligned on the total (your hits sit flush right)
    const it50 = toTotal.find(x => x.key === sumWas.key);
    expect(it50.x + 2 * 0.6 * sumWas.size).toBeCloseTo(total.x + total.text.length * 0.6 * total.size, 5);
    // No ghost for a round still listed: nothing on screen leaves by mistake.
    const listed = L.items.map(it => it.key);
    for (const x of g) expect(listed).not.toContain(x.key);
    reset();
  });

  it('when the mob dies, all its hits roll into its total, which stays until the agent drops it', () => {
    reset();
    const feed = [hit('out', 45, 0), hit('out', 88, 1)];   // newest first, as the agent sends
    const dead = withTallies(feed, [gnoll({ out: 900, dead_at: at })]);
    expect(lane(dead, 'hout')).toEqual(['Σ 900']);
    const L = R.hudLanes(R.hudData(dead), R.hudParts);
    const total = L.items.find(it => it.total);
    const g = L.ghosts.filter(x => x.lane === 'hout');
    // both hits, and both rounds' sums, head for the total
    expect(g.map(x => x.key).filter(k => !k.includes('|R|'))).toHaveLength(2);
    for (const x of g) expect(x.y).toBe(total.y);
    expect(total.op).toBe('0.55');                                      // dimmed: finished
    expect(lane(withTallies(feed, []), 'hout')).toEqual(['88', '45']); // dropped: no total left
  });

  // "Summations of hits should not overlap with the outside rings" — a long
  // total gets smaller, then loses its mob name, but never crosses the ring.
  it('a total too long for its row shrinks, then drops the mob\'s name — never past the ring', () => {
    reset();
    const two = [gnoll({ out: 1234567 }), gnoll({ key: 'an elder thought horror|alive', name: 'an elder thought horror', out: 987654 })];
    const L = R.hudLanes(R.hudData(withTallies([], two)), R.hudParts).items.filter(it => it.total && it.lane === 'hout');
    expect(L).toHaveLength(2);
    for (const it of L) {
      const x1 = it.x + it.text.length * 0.6 * it.size, top = it.y - it.size;
      expect(Math.hypot(x1 - 200, top - 200), it.text).toBeLessThan(R.LANE_EDGE_R + 0.01);
      expect(it.size).toBeGreaterThanOrEqual(R.HIT_SIZE * 0.7 - 1e-9);
    }
  });

  // "Remember that several classes can have up to 6 melee hits at once, on TOP
  // of procs. Procs should be purple."
  it('a proc is purple, among up to six hits and the procs on top of them', () => {
    reset();
    const feed = [85, 33, 49, 45, 33, 49].map(n => hit('out', n, 0)).concat([hit('out', 70, 0, { kind: 'spell', proc: true }), hit('out', 71, 0, { kind: 'spell', proc: true })]).reverse();
    const its = R.hudLanes(R.hudData(s(feed)), R.hudParts).items.filter(it => it.lane === 'hout');
    expect(its).toHaveLength(8);                                        // every hit and both procs
    expect(its.filter(it => it.color === 'var(--purple)').map(it => it.text).sort()).toEqual(['70', '71']);
    const nuke = R.hudLanes(R.hudData(s([hit('out', 203, 0, { kind: 'spell', proc: false })])), R.hudParts).items.find(it => it.lane === 'hout');
    expect(nuke.color).not.toBe('var(--purple)');
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
    R.hudParts.split = 5;                                               // every listed round hit by hit: the tallest a column gets
    const L = R.hudLanes(R.hudData(withTallies(feed, [gnoll({ out: 9999 })])), R.hudParts).items.filter(it => it.lane === 'hout');
    const yMax = R.HIT_LANES.hout.y + (R.HIT_LANES.hout.rows - 1) * 10.5;
    expect(Math.max(...L.map(it => it.y))).toBeLessThanOrEqual(yMax + 0.01);
    const hits = L.filter(it => !it.total);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length % 6).toBe(0);                                    // whole rounds only
    expect(hits.length).toBeLessThan(30);                               // …and not all five: they did not fit
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
      ds: { hits: 2, total: 76, last: 38, per_hit: 38, from_buffs: true, measured: true } } });
    const h = R.renderHud(snap);
    expect(lane(snap, 'hout')).toEqual(['45']);
    expect(lane(snap, 'hds')).toEqual(['38', '38']);
    expect(h).toMatch(/<circle[^>]*stroke="var\(--orange\)"/);
    expect(h).toMatch(/font-weight="700">38<\/text>/);
    expect(h).toContain('>DS<');
  });

  // A member, 2026-10-07 (FB-58): the shield number missed instrument skill and AAs because it was an
  // estimate from buffs and gear. The agent now reads the hits that landed and says `measured`; the
  // button's "~" is the estimate's mark, so a measured number carries none.
  it('the shield button marks an estimate with "~" and a number read off the hits that landed with nothing', () => {
    reset();
    const ds = (x) => R.renderHud(s([], { combat: { live: true, secs: 30, out: { dps: 0, by: {} }, in: { dps: 0, by: {} }, feed: [],
      ds: Object.assign({ hits: 0, total: 0, last: null, per_hit: 18, from_buffs: true }, x) } }));
    const est = ds({ measured: false }), got = ds({ hits: 3, total: 66, last: 22, per_hit: 22, measured: true });
    expect(est).toContain('>DS~<');
    expect(est).not.toContain('>DS<');
    expect(got).toContain('>DS<');
    expect(got).not.toContain('>DS~<');
    expect(got).toMatch(/font-weight="700">22<\/text>/);
    expect(ds({})).toContain('>DS~<');          // an older agent never says `measured`: its number was an estimate
  });

  // The guild lead, 2026-10-05: "Hud should have the number of procs that you have had on a mob, as
  // well as how many stuns/aggro spells you've put into the mob. on the right side of the circle hud
  // above the damage shield, Procs can go to the right of damage and stuns/aggro spells can go to the
  // right of that". One short row over the shield button: procs (purple), then stuns/aggro (gold).
  describe('procs and stuns/aggro on the target', () => {
    const dsInfo = { hits: 2, total: 76, last: 38, per_hit: 38, from_buffs: true, measured: true };
    const snap = (mine, extra = {}) => s([], Object.assign({
      target: Object.assign({ name: 'a gnoll warlord', hp_pct: 63 }, mine),
      combat: { live: true, secs: 30, out: { dps: 0, by: {} }, in: { dps: 0, by: {} }, feed: [], ds: dsInfo },
    }, extra));
    // The row's numbers, left to right: [x, y, size, fill, text].
    const row = (h) => {
      const g = (h.match(/<g class="mine">([\s\S]*?)<\/g>/) || [])[1] || '';
      return [...g.matchAll(/<text x="([\d.]+)" y="([\d.]+)" font-size="([\d.]+)" fill="([^"]+)" text-anchor="start" font-weight="700">(\d+)<\/text>/g)]
        .map(m => [+m[1], +m[2], +m[3], m[4], m[5]]);
    };

    it('draws procs, then stuns/aggro to their right — purple, then gold — over the shield button', () => {
      reset();
      const h = R.renderHud(snap({ my_procs: 7, my_stuns: 3 }));
      const [procs, stuns] = row(h);
      expect(procs.slice(3)).toEqual(['var(--purple)', '7']);
      expect(stuns.slice(3)).toEqual(['var(--gold)', '3']);
      expect(stuns[0]).toBeGreaterThan(procs[0]);
      expect(stuns[1]).toBe(procs[1]);                                  // one row
      // The shield button: its circle (cx 286, cy 272, r 13) — the row sits above its top and clear of its middle.
      const btn = h.match(/<circle cx="([\d.]+)" cy="([\d.]+)" r="13" fill="rgba\(13,17,23,0\.72\)"/);
      expect(btn).not.toBeNull();
      expect(procs[1]).toBeLessThan(+btn[2] - 13);
      expect(h.indexOf('class="mine"')).toBeGreaterThan(h.indexOf('>DS<'));   // drawn after the button, over it in the markup
      expect(h.match(/<path d="M2\.2 -5\.5[^>]*fill="var\(--purple\)"/)).not.toBeNull();   // a bolt for procs
      expect(h.match(/<path d="M0 -5\.5[^>]*fill="var\(--gold\)"/)).not.toBeNull();         // a spark for stuns
    });

    it('a 0 stays, dim — the way the shield button does — and a number lights its own colour', () => {
      reset();
      const [procs, stuns] = row(R.renderHud(snap({ my_procs: 0, my_stuns: 3 })));
      expect(procs.slice(3)).toEqual(['var(--dim)', '0']);
      expect(stuns.slice(3)).toEqual(['var(--gold)', '3']);
      expect(R.renderHud(snap({ my_procs: 0, my_stuns: 0 }))).toMatch(/fill="var\(--dim\)"[^>]*opacity="0\.6"/);
    });

    it('nothing without a live target, on a corpse, or from an agent that sends neither', () => {
      reset();
      expect(R.renderHud(snap({ my_procs: 7, my_stuns: 3 }, { target: null }))).not.toContain('class="mine"');
      expect(R.renderHud(snap({ my_procs: 7, my_stuns: 3, corpse: true }))).not.toContain('class="mine"');
      expect(R.renderHud(snap({}))).not.toContain('class="mine"');
    });

    it('is a builder part, on by default, with a size slider — off, the row goes and the shield button stays', () => {
      reset();
      expect(R.HUD_DEFAULTS.procs).toBe(1);
      const hits = R.HUD_PARTS.find(g => g[0] === 'Hits')[1];
      expect(hits.map(it => it[0])).toContain('procs');
      expect(stripJs(meHtml)).toMatch(/var HUD_SIZED = \[[^\]]*'procs'/);
      R.hudParts.procs = 0;
      const h = R.renderHud(snap({ my_procs: 7, my_stuns: 3 }));
      expect(h).not.toContain('class="mine"');
      expect(h).toContain('>DS<');
      reset();
    });

    it('its size slider scales it — up to 1.15×, which is as big as its band allows', () => {
      reset();
      const px = () => row(R.renderHud(snap({ my_procs: 7, my_stuns: 3 })))[0][2];
      const plain = px();
      const near = (got, want) => expect(Math.abs(got - want)).toBeLessThan(0.11);   // the size is written to a tenth
      R.hudParts.sizes = { procs: 1.1 };
      near(px(), plain * 1.1);
      R.hudParts.sizes = { procs: 1.6 };
      near(px(), plain * 1.15);                                          // capped
      R.hudParts.sizes = { all: 1.6 };
      near(px(), plain * 1.15);
      reset();
    });

    // The band is fixed: below the last row of your hits (a column's last baseline, y 239.5), above the
    // shield column's top line (capitals at y 251.6 at the largest text), and in the ring — flush
    // right against it, out of the open middle — whatever the numbers or the text size.
    it('stays in its band, inside the ring and out of the middle — big numbers, largest text', () => {
      const hout = R.HIT_LANES.hout, lastHit = hout.y + (hout.rows - 1) * R.HIT_STEP;
      const dsTop = R.HIT_LANES.hds.y - 0.72 * R.HIT_SIZE * 1.6;
      for (const sizes of [{}, { procs: 1.6 }, { all: 1.6 }, { all: 0.7 }]) {
        for (const [p, st] of [[7, 3], [128, 14], [9999, 999]]) {
          reset();
          R.hudParts.sizes = sizes;
          const [a, b] = row(R.renderHud(snap({ my_procs: p, my_stuns: st })));
          for (const [x, y, size, , txt] of [a, b]) {
            expect(y - 0.72 * size, txt).toBeGreaterThanOrEqual(lastHit);         // its capitals clear the last hit row's baseline
            expect(y, txt).toBeLessThanOrEqual(dsTop);                            // its baseline over the shield column's capitals
            const w = txt.length * 0.6 * size;
            const edge = 200 + Math.sqrt(R.LANE_EDGE_R ** 2 - (y - 200) ** 2);
            expect(x + w, txt).toBeLessThanOrEqual(edge + 0.1);                   // inside the ring (x is written to a tenth)
          }
          // The whole row (a chip starts one em before its number) clear of the open middle, em box and all.
          const left = a[0] - a[2], top = a[1] - a[2];
          expect(Math.hypot(Math.max(left, 200) - 200, top - 200), JSON.stringify([p, st, sizes])).toBeGreaterThan(95);
        }
      }
      reset();
    });
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
    // `sizes` is the sliders' store, not a part of its own; `clickyPick` is the clicky picker's.
    expect(listed).toEqual(Object.keys(R.HUD_DEFAULTS).filter(k => k !== 'sizes' && k !== 'clickyPick').sort());
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
  // a checkmark instead of ready" — and round eight: "FD still shows ready
  // instead of a checkmark" (it fit its arc, so it had kept the word while its
  // neighbours showed ✓). Ready is a ✓ on every cooldown, at every size.
  it('a ready cooldown is its name and ✓ — every one, at every size, and nothing is cut off', () => {
    reset();
    const four = ['Kick', 'Mend', 'Feign Death', 'Hundred Fists'].map((label, i) => ({ key: ['ability', 'mend', 'fd', 'disc'][i], label, ms_left: 0, total_ms: 5000, seen: true }));
    const snap = s([], { cooldowns: four });
    const plain = R.renderHud(snap);
    for (const l of ['MEND', 'FD']) expect(plain).toContain('>' + l + ' ✓<');
    expect(plain).not.toContain('ready');
    R.hudParts.sizes = { cooldowns: 1.6 };
    const big = R.renderHud(snap);
    for (const l of ['MEND', 'FD']) expect(big).toContain('>' + l + ' ✓<');
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

  // Tracking (a member's idea, 2026-09-25: "Ahead, Ahead and to right/left,
  // behind left/right behind you"; the guild lead: "YES").
  const arrows = (h) => [...h.matchAll(/<path class="trk( lit)?" transform="translate\(([\d.]+) ([\d.]+)\) rotate\((\d+)\) scale\(([\d.]+)\)"[^>]*\/>/g)]
    .map(m => ({ lit: !!m[1], x: +m[2], y: +m[3], a: +m[4], k: +m[5], dim: /opacity="0\.45"/.test(m[0]) }));
  const tracking = (angle, age = 0) => s([], { track: { name: 'a scouting kobold', angle, age_ms: age } });

  it('tracking: eight arrows round the ring, the latest direction lit', () => {
    reset();
    const a = arrows(R.renderHud(tracking(45)));
    expect(a.map(x => x.a)).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
    expect(a.filter(x => x.lit).map(x => x.a)).toEqual([45]);
    const lit = a.find(x => x.lit);                     // "ahead and to the right": up and right of the middle
    expect(lit.x).toBeGreaterThan(300);
    expect(lit.y).toBeLessThan(100);
    const behind = arrows(R.renderHud(tracking(180))).find(x => x.lit);
    expect(behind.x).toBeCloseTo(200, 5);
    expect(behind.y).toBeGreaterThan(300);              // straight below the middle
  });

  it('tracking: only the lit arrow when the builder says so; nothing when off, or when not tracking', () => {
    reset();
    R.hudParts.trackShow = 'lit';
    expect(arrows(R.renderHud(tracking(270))).map(x => [x.a, x.lit])).toEqual([[270, true]]);
    expect(arrows(R.renderHud(tracking(null)))).toEqual([]);          // begun, no direction yet
    R.hudParts.track = 0;
    expect(arrows(R.renderHud(tracking(270)))).toEqual([]);
    reset();
    expect(arrows(R.renderHud(s([])))).toEqual([]);
    const begun = arrows(R.renderHud(tracking(null)));                // all eight, none lit
    expect([begun.length, begun.filter(x => x.lit).length]).toEqual([8, 0]);
  });

  it('tracking: a direction older than 15 s dims — you may have turned since', () => {
    reset();
    const lit = (age) => arrows(R.renderHud(tracking(180, age))).find(x => x.lit);
    expect(lit(14_000).dim).toBe(false);
    expect(lit(16_000).dim).toBe(true);
  });

  // The edge is taken at 12, 3, 6 and 9 o'clock (the target's target, the HP and
  // mana labels, the ✥ Box HUD ✕ row), so those four sit inside the ring; none
  // may reach into the clear middle (r 110), and none may leave the square.
  it('tracking: every arrow stays in the square and out of the middle, at every size', () => {
    for (const k of [0.7, 1, 1.6]) {
      reset();
      R.hudParts.sizes = { track: k };
      const a = arrows(R.renderHud(tracking(0)));
      expect(a).toHaveLength(8);
      for (const x of a) {
        expect(x.k).toBeCloseTo(k, 5);
        const r = Math.hypot(x.x - 200, x.y - 200);
        expect(r - 7 * x.k).toBeGreaterThanOrEqual(110 - 1e-6);   // the shaft's end, 7 units in
        const rad = x.a * Math.PI / 180, reach = r + 8 * x.k;       // the tip, 8 units out
        for (const v of [200 + reach * Math.sin(rad), 200 - reach * Math.cos(rad)]) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(400);
        }
        if (x.a % 90 === 0) expect(reach).toBeLessThan(140);       // the four inside the ring stay under its labels
      }
    }
    reset();
  });
});

describe('the in-game picker', () => {
  const body = stripJs(meHtml);
  it('offers Box and the HUD — no C — and remembers the pick', () => {
    expect(meHtml).toMatch(/<button data-v="a"[^>]*>Box<\/button><button data-v="hud"[^>]*>HUD<\/button>/);
    for (const v of ['b', 'c', 'h1', 'h2', 'h3']) expect(meHtml).not.toContain('data-v="' + v + '"');
    expect(body).toContain("localStorage.setItem(STYLE_KEY, style)");
  });
  // The pick, run: what a saved value (or none) opens on.
  const pickBlock = sliceBlock(meHtml, "  var STYLE_KEY = 'wpMeStyle';", '\n  } catch (e) {}\n');
  const opensOn = (saved) => new Function('localStorage', pickBlock + '\nreturn [style, _firstRun];')({ getItem: () => saved });
  it('someone new starts on the HUD; a Box pick survives the rename; B, C, H1–H3 land on the HUD', () => {
    expect(opensOn(null)).toEqual(['hud', true]);
    expect(opensOn('a')).toEqual(['a', false]);
    for (const v of ['b', 'c', 'h1', 'h2', 'h3']) expect(opensOn(v)).toEqual(['hud', false]);
  });
  it('…and someone new gets the HUD\'s centred square, as the HUD button would give', () => {
    expect(body).toMatch(/if \(_firstRun && isHud\(style\)\) \{[\s\S]*?setBounds\(\{ width: side0, height: side0, center: true \}\)/);
  });
  // "Put the Move icon and X at the bottom underneath the tick timer and the
  // swing timer", then: "the character name doesn't need to be at the top
  // left. The selection for Box/Hud should be in the middle horizontally,
  // vertically below the bottom tick/swing timers, directly next to the
  // movement and X buttons." The row's CSS, evaluated for a real ring.
  it('in the HUD, ✥ [Box|HUD|⚙] ✕ is one row, centred under the ring and below its labels; no name', () => {
    const css = stripCss(meHtml);
    const decl = (sel, prop) => {
      const i = css.indexOf(sel + '{') >= 0 ? css.indexOf(sel + '{') : css.indexOf(sel + ',');
      const body = css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
      return (body.match(new RegExp('(?:^|;)\\s*' + prop + ':([^;]+)')) || [])[1];
    };
    const px = (expr, v) => new Function('return ' + expr.replace(/var\(--([\w-]+)\)/g, (_, n) => v[n])
      .replace(/calc\(/g, '(').replace(/px/g, ''))();
    const pkW = +decl('body.hud', '--pk-w').replace('px', '');
    // alone; builder open on the left; and the numbers OUTSIDE the ring, where
    // the window is 1.6× as wide as it is tall (2026-09-25) — the row still
    // centres on the ring and sits on the window's height, not its width.
    for (const v of [{ 'ring-w': 420, 'ring-h': 420, 'ring-x': 0, 'pk-w': pkW }, { 'ring-w': 420, 'ring-h': 420, 'ring-x': 300, 'pk-w': pkW },
      { 'ring-w': 672, 'ring-h': 420, 'ring-x': 0, 'pk-w': pkW }]) {
      const T = 'body.hud .title,body.hud.building .title', MV = 'body.hud #move-btn,body.hud.setup #move-btn', HD = 'body.hud #hide-btn,body.hud.setup #hide-btn';
      const mv = px(decl(MV, 'left'), v), pk = px(decl(T, 'left'), v), hd = px(decl(HD, 'left'), v);
      const top = px(decl(MV, 'top'), v), ptop = px(decl(T, 'top'), v);
      const cx = v['ring-x'] + v['ring-w'] / 2, H = v['ring-h'];
      expect(pk + pkW / 2).toBeCloseTo(cx, 5);                                     // centred on the ring
      expect(pk - (mv + 18)).toBeGreaterThanOrEqual(0); expect(pk - (mv + 18)).toBeLessThanOrEqual(6);   // ✥ right beside it
      expect(hd - (pk + pkW)).toBeGreaterThanOrEqual(0); expect(hd - (pk + pkW)).toBeLessThanOrEqual(6); // ✕ right beside it
      expect(top + 18).toBeLessThanOrEqual(H); expect(ptop + 16).toBeLessThanOrEqual(H);                 // inside the window
      // below the tick / swing labels: their baseline (r 187, glyphs inward) at the row's outer edge
      const s = H / 400, dx = (cx - mv) / s;
      expect(top / s).toBeGreaterThan(200 + Math.sqrt(187 * 187 - dx * dx));
    }
    expect(css).toMatch(/body\.hud \.title \.conn,body\.hud \.title \.nm,body\.hud \.title \.cl,body\.hud \.title \.sp\{display:none\}/);
  });
  // "The HUD mode shouldn't include the background as a square, rather as a
  // shadow behind the content."
  it('in the HUD, the backgrounds toggle draws a shadow behind the ring, never a square', () => {
    const css = stripCss(meHtml);
    expect(css).toMatch(/body\.hud\.wp-backdrop #wrap\{background:transparent !important\}/);
    expect(css).toMatch(/body\.hud\.wp-backdrop #hudsvg,body\.hud\.wp-backdrop #hudlanes\{\s*filter:drop-shadow\([^}]*var\(--bg-alpha/);
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
    // Closing puts the ring back where the window is NOW, not where it was when the panel opened
    // (FB-16: a resize made with the panel open was undone) — test/mimic-hud-builder-resize.test.js.
    expect(body).toMatch(/function closeBuilder\(restore, atLoad\)\{[\s\S]*?if \(restore !== false\) \{[\s\S]*?if \(back && back\.width\) setBounds\(back\);/);
    // quitting with it open must not leave the ring off-centre next launch: a launch has only the stored bounds
    expect(body).toMatch(/if \(pre\) closeBuilder\(isHud\(style\), true\);/);
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
  it('a HUD makes the window a centred square — the ring is the bounds (wider only for numbers outside it)', () => {
    expect(body).toMatch(/var side = Math\.round\(Math\.min\(screen\.availWidth, screen\.availHeight\) \* 0\.5\);\s*setBounds\(\{ width: Math\.round\(side \* hudWidthFactor\(\)\), height: side, center: true \}\)/);
    expect(body).toMatch(/return p && p\.hitsSide === 'outside' \? \(400 \+ 2 \* LANE_EXT\) \/ 400 : 1;/);
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
    // (The Timers canvas's flag follows it on the same line, 2026-09-29.)
    expect(main).toMatch(/'showPopRaid',\s*\n\s*'showMe',[^\]\n]*\n\];/);
    expect(main).toContain('} else if (win === meWindow) {');
  });
});
