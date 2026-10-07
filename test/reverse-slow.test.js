// test/reverse-slow.test.js — FB-54: a slow on a reverse-slow mob hastes it.
//
// A member: "Some mobs are reverse slowable. This needs to be picked up on the
// target overlay." Project Quarm's server (SE_AttackSpeed): a normal slow landing
// on an NPC with special ability 50 (ReverseSlow) lands as HASTE of the slow's
// size, and it overrides Unslowable. Five NPCs carry it (Bastion of Thunder's
// three, Magmaton, Fennin Ro). The bot sends the label
// 'Reverse Slow — slowing hastes it' in the mob-info `specials` list.
//
// Behaviour, not text: the agent's REAL slow functions run over a stubbed Zeal
// state; the HUD's REAL hudData runs over a snapshot; Target Info's REAL <script>
// runs against a fake DOM. Names are invented or the game's own mob names.
//
// Run: npx vitest run test/reverse-slow.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, stripCss, ROOT, AGENT_INDEX } from './_source-slice.js';

const LABEL = 'Reverse Slow — slowing hastes it';

// The label is the contract with the bot: this one comes from its own table.
describe('the label', () => {
  it('is the one the bot sends for special ability 50', async () => {
    const { MOB_SPECIAL_CODES } = (await import('node:module')).createRequire(import.meta.url)(path.join(ROOT, 'utils', 'mobSpecials.js'));
    expect(MOB_SPECIAL_CODES[50].label).toBe(LABEL);
  });
});

// The label is the contract with the bot: this one comes from its own table.
describe('the label', () => {
  it('is the one the bot sends for special ability 50', async () => {
    const { MOB_SPECIAL_CODES } = (await import('node:module')).createRequire(import.meta.url)(path.join(ROOT, 'utils', 'mobSpecials.js'));
    expect(MOB_SPECIAL_CODES[50].label).toBe(LABEL);
  });
});

// ── the agent: slows on a reverse-slow mob ──────────────────────────────────
const agent = readSource(AGENT_INDEX);
const slowBlock = sliceBlock(agent, 'const SLOW_SPELLS = new Set([', '\n// Is `nameLower` a live Zeal target');

function build({ mobs = [], main = true } = {}) {
  // eslint-disable-next-line no-new-func
  return new Function('MOBS', 'MAIN', `
    const _zealState = {};
    const pushed = [];
    function _pushOverlay(o) { pushed.push(o); }
    function _rampageOnMainTarget() { return MAIN; }
    function _durTicksForLevel() { return 65; }
    function _assumedCasterLevel() { return 60; }
    ${sliceBlock(agent, 'function _normMobNameAgent(n) {', '\n}')}
    const _mobInfoByName = new Map(MOBS.map(([k, specials]) => [k, { at: Date.now(), mob: specials ? { specials } : null }]));
    ${slowBlock}
    return { _noteSlowForTarget, _reverseSlowKnown, _bestSlowForTarget, _slowsByTarget, _slowCalloutState, pushed };
  `)(mobs, main);
}
const land = (target, spell = "Turgur's Insects") => ({ spell_name: spell, target, cast_at: new Date().toISOString(), dur_formula: 7, dur_ticks: 65 });

describe('_reverseSlowKnown — read from the cached mob-info row', () => {
  const h = build({ mobs: [
    ['magmaton|*|magmaton', [LABEL, 'Immune Pacify']],
    ['a_gnoll_warlord|*|a gnoll warlord', ['Enrage']],
    ['a_mystery|*|a mystery', null],
  ] });
  it('true for the label, in any zone bucket; false for a cached row without it; null when unknown', () => {
    expect(h._reverseSlowKnown('Magmaton')).toBe(true);
    expect(h._reverseSlowKnown('magmaton')).toBe(true);
    expect(h._reverseSlowKnown('A Gnoll Warlord')).toBe(false);
    expect(h._reverseSlowKnown('A Brand New Mob')).toBeNull();
    expect(h._reverseSlowKnown('a mystery')).toBeNull();   // a row with no mob proves nothing
  });
  it('matches by prefix, so a reworded explanation still counts', () => {
    const r = build({ mobs: [['fennin_ro_the_tyrant_of_fire|*|x', ['Reverse Slow (hastes it)']]] });
    expect(r._reverseSlowKnown('Fennin Ro the Tyrant of Fire')).toBe(true);
  });
});

describe('a slow landing on a reverse-slow mob', () => {
  it('warns in red, speaks "stop slowing", and records NO slow timer', () => {
    const h = build({ mobs: [['magmaton|*|magmaton', [LABEL]]] });
    h._noteSlowForTarget(land('Magmaton'), 'Aldenmar');
    expect(h.pushed).toHaveLength(1);
    expect(h.pushed[0]).toMatchObject({ color: 'red', tts: 'Reverse slow, stop slowing', trigger: 'Reverse slow', scope: 'slow' });
    expect(h.pushed[0].text).toBe("⚠ Reverse slow on Magmaton — it's hasted, don't slow it");
    expect(h._bestSlowForTarget('magmaton', Date.now())).toBeNull();
    expect(h._slowsByTarget.size).toBe(0);
    expect(h._slowCalloutState.size).toBe(0);
  });

  it('a raid\'s slowers landing together warn once, not once each', () => {
    const h = build({ mobs: [['magmaton|*|magmaton', [LABEL]]] });
    h._noteSlowForTarget(land('Magmaton'), null);
    h._noteSlowForTarget(land('Magmaton', 'Tepid Deeds'), null);
    h._noteSlowForTarget(land('Magmaton'), 'Brackwyn');
    expect(h.pushed).toHaveLength(1);
  });

  it('only the main target is called out (the same gate every slow callout has)', () => {
    const h = build({ mobs: [['magmaton|*|magmaton', [LABEL]]], main: false });
    h._noteSlowForTarget(land('Magmaton'), null);
    expect(h.pushed).toHaveLength(0);
    expect(h._slowsByTarget.size).toBe(0);   // still not recorded as a slow
  });

  it('a slow tracked before the mob\'s row arrived is dropped, so no "slow dropped" nag follows', () => {
    const h = build({ mobs: [['magmaton|*|magmaton', [LABEL]]] });
    h._slowsByTarget.set('magmaton', new Map([['x', { name: 'x', magnitude: 75, landedAtMs: 1, expiresAtMs: Date.now() + 60000 }]]));
    h._slowCalloutState.set('magmaton', { name: 'x', magnitude: 75, display: 'Magmaton' });
    h._noteSlowForTarget(land('Magmaton'), null);
    expect(h._slowsByTarget.has('magmaton')).toBe(false);
    expect(h._slowCalloutState.has('magmaton')).toBe(false);
  });
});

describe('a slow landing on a normal mob is unchanged', () => {
  it('records the timer and calls the amber "Slowed" land', () => {
    const h = build({ mobs: [['a_gnoll_warlord|*|a gnoll warlord', ['Enrage']]] });
    h._noteSlowForTarget(land('A Gnoll Warlord'), 'Aldenmar');
    expect(h._bestSlowForTarget('a gnoll warlord', Date.now())).toMatchObject({ name: "Turgur's Insects", magnitude: 75 });
    expect(h.pushed).toHaveLength(1);
    expect(h.pushed[0].color).toBe('amber');
    expect(h.pushed[0].text).toMatch(/^🐌 Slowed A Gnoll Warlord — Turgur's Insects 75%/);
    expect(h.pushed[0].trigger).toBe('Slow landed');
  });
  it('an uncached mob is still a slow (null is not "reverse")', () => {
    const h = build({ mobs: [] });
    h._noteSlowForTarget(land('A Brand New Mob'), null);
    expect(h._bestSlowForTarget('a brand new mob', Date.now())).not.toBeNull();
    expect(h.pushed[0].color).toBe('amber');
  });
});

// The timeline's own slow tick (#105) goes quiet on a reverse-slow mob too.
describe('the fight timeline', () => {
  const clean = stripJs(agent);
  it('noteSlowLanding returns before it records a "Slow landed" tick', () => {
    const at = clean.indexOf('noteSlowLanding(evt, caster) {');
    expect(at).toBeGreaterThan(0);
    const body = clean.slice(at, clean.indexOf('noteMobHeal(', at));
    expect(body).toMatch(/if \(_reverseSlowKnown\(evt\.target\) === true\) return;/);
    expect(body.indexOf('_reverseSlowKnown')).toBeLessThan(body.indexOf('this._slowsOnTarget.set('));
  });
});

// ── the HUD ─────────────────────────────────────────────────────────────────
const meHtml = readSource(path.join(ROOT, 'apps', 'mimic', 'me.html'));
const script = meHtml.slice(meHtml.indexOf('<script>') + 8, meHtml.indexOf('</script>'));
const renderBlock = script.slice(script.indexOf('  // ── helpers'), script.indexOf('  var bodyEl'));
// eslint-disable-next-line no-new-func
const R = new Function('var window = { innerWidth: 1114, innerHeight: 713 };\n' + renderBlock + '\nreturn { hudData, renderHud };')();
const snap = (target) => ({
  ok: true, character: 'Aldenmar', level: 60, class: 'Monk', no_mana: true,
  hp: { cur: 5311, max: 6417, pct: 82.8 }, mana: { cur: null, max: null, pct: null }, end: { pct: 41 },
  tick: { ms_left: 3400, period_ms: 6000, source: 'zeal' },
  target: { name: 'Magmaton', hp_pct: 63, tot: null, slow: null, enrage: true, unslowable: false, enraged: false, ...target },
  combat: { live: false, out: { by: {} }, in: { by: {} }, feed: [] },
});

describe('the HUD says "reverse slow", in red, ahead of every slow state', () => {
  it('reverse_slow → red "reverse slow" instead of "not slowed"', () => {
    const t = R.hudData(snap({ reverse_slow: true })).t;
    expect(t.slow).toEqual({ s: 'reverse slow', c: 'var(--red)', size: 9.5 });
  });
  it('beats unslowable and a landed slow', () => {
    expect(R.hudData(snap({ reverse_slow: true, unslowable: true })).t.slow.s).toBe('reverse slow');
    expect(R.hudData(snap({ reverse_slow: true, slow: { label: "Turgur's Insects", pct: 75, remaining_secs: 90 } })).t.slow.s).toBe('reverse slow');
  });
  it('a normal mob is as before', () => {
    expect(R.hudData(snap({ reverse_slow: false })).t.slow).toMatchObject({ s: 'not slowed', c: 'var(--orange)' });
    expect(R.hudData(snap({ unslowable: true })).t.slow).toMatchObject({ s: 'unslowable' });
    expect(R.hudData(snap({ slow: { label: "Turgur's Insects", pct: 75, remaining_secs: 90 } })).t.slow.s).toMatch(/^slowed 75% · 1:30/);
  });
  it('a corpse still says nothing', () => {
    expect(R.hudData(snap({ reverse_slow: true, corpse: true })).t.slow).toBeNull();
  });
  it('the ring draws the words in the slow line', () => {
    const h = R.renderHud(snap({ reverse_slow: true }));
    expect(h).toContain('reverse slow');
    expect(h).toMatch(/fill="var\(--red\)"[^>]*>reverse slow</);
    expect(R.renderHud(snap({}))).not.toContain('reverse slow');
  });
});

// ── Target Info ─────────────────────────────────────────────────────────────
const MOB = readSource(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html'));
const flush = () => new Promise((r) => setTimeout(r, 0));
async function boot(payload, { mini = false } = {}) {
  const script = MOB.slice(MOB.indexOf('<script>') + 8, MOB.lastIndexOf('</script>'));
  const els = new Map();
  const cls = (set) => ({ add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c), toggle() {} });
  const el = (id) => {
    if (!els.has(id)) {
      let inner = '';
      els.set(id, { id, style: {}, textContent: '', className: '', classList: cls(new Set()), addEventListener() {}, getAttribute() { return null; },
        get innerHTML() { return inner; }, set innerHTML(v) { inner = String(v); }, get scrollHeight() { return 20; } });
    }
    return els.get(id);
  };
  const document = { getElementById: el, body: { classList: cls(new Set(mini ? ['wp-mini'] : [])) }, documentElement: { style: { setProperty() {} } }, addEventListener() {} };
  const window = { mimic: { overlayAutoHeight() {}, overlayHoverInteractive() {}, attachOverlayMenu() {}, openExternal() {} }, addEventListener() {}, localStorage: { getItem: () => null, setItem() {} } };
  const intervals = [];
  new Function('window', 'document', 'fetch', 'setInterval', script)(window, document, async () => ({ json: async () => payload }), (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; });
  await flush();
  return { body: () => el('body').innerHTML };
}
const SLOW = { name: "Turgur's Insects", ambiguous: false, magnitude: 75, caster: 'Nyssara', cls: 'SHM', remaining_secs: 161, total_secs: 180 };
const mobState = (specials, slow = null) => ({ mobInfo: {
  target_name: 'Magmaton', target_hp_pct: 64.2, loading: false,
  mob: { id: 4051, name: 'Magmaton', level: 60, class: 'Warrior', hp: 90000, ac: 120, resists: { mr: 30, fr: 30, cr: 30, pr: 30, dr: 30 }, specials, loot: [] },
  target_buffs: [], target_casting: [], target_slow: slow,
  target_mana: null, target_lastcast: null, target_player: null, target_npc_ht: null,
} });

describe('Target Info — the chip', () => {
  it('Reverse Slow is a red warn chip; an immunity stays blue', async () => {
    const h = (await boot(mobState([LABEL, 'Immune Pacify']))).body();
    expect(h).toContain('<span class="chip warn">' + LABEL + '</span>');
    expect(h).toContain('<span class="chip imm">Immune Pacify</span>');
  });
  it('the exact label the bot sends is in WARN_SPECS', () => {
    expect(stripJs(MOB.slice(MOB.indexOf('<script>'))).replace(/\s+/g, ' ')).toContain("'" + LABEL + "':1");
  });
});

describe('Target Info — the slow badge', () => {
  it('a reverse-slow target shows a red "REVERSE SLOW — don\'t slow" badge, not the amber slow state', async () => {
    const h = (await boot(mobState([LABEL]))).body();
    expect(h).toMatch(/<div class="slowbadge rev" title="[^"]*">⛔ <span class="sc">REVERSE SLOW<\/span> <span class="sn">don’t slow<\/span><\/div>/);
    expect(h).not.toContain('SLOW</span> <span class="sn">Turgur');
  });
  it('if a slow did land, it says the mob is hasted (with the size when known)', async () => {
    const h = (await boot(mobState([LABEL], SLOW))).body();
    expect(h).toContain('class="slowbadge rev"');
    expect(h).toContain('<span class="sn">it’s hasted</span> <span class="sm">+75%</span>');
    expect(h).not.toContain('SHM SLOW');
    expect(h).not.toContain('Nyssara');
  });
  it('a normal slowed mob keeps the amber badge; an unslowed one has none', async () => {
    const amber = (await boot(mobState(['Enrage'], SLOW))).body();
    expect(amber).toContain('class="slowbadge"');
    expect(amber).not.toContain('slowbadge rev');
    expect((await boot(mobState(['Enrage']))).body()).not.toContain('slowbadge');
  });
});

describe('Target Info mini', () => {
  it('a red REV row sits where the amber SLOW row would, whether or not a slow landed', async () => {
    const none = (await boot(mobState([LABEL]), { mini: true })).body();
    expect(none).toMatch(/<div class="mini-row rev" title="[^"]*"><span class="mini-lab[^"]*">REV<\/span><span class="mini-bar[^"]*"><i style="width:100%"><\/i><\/span><span class="mini-t[^"]*">DON’T SLOW<\/span>/);
    expect(none).not.toContain('mini-row slow');
    const hit = (await boot(mobState([LABEL], SLOW), { mini: true })).body();
    expect(hit).toContain('>HASTED<');
    expect(hit).not.toContain('mini-row slow');
  });
  it('a normal mob keeps the amber SLOW row', async () => {
    const h = (await boot(mobState(['Enrage'], SLOW), { mini: true })).body();
    expect(h).toContain('mini-row slow');
    expect(h).not.toContain('mini-row rev');
  });
  it('the CSS paints the badge and the row red, never amber', () => {
    const css = stripCss(MOB);
    expect(css).toMatch(/\.slowbadge\.rev\{[^}]*rgba\(248,81,73/);
    expect(css).toMatch(/\.mini-row\.rev \.mini-bar i\{background:#f85149\}/);
  });
});
