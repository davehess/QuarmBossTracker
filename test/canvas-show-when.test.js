// test/canvas-show-when.test.js — show-when rules on the Timers canvas (Mimic 3.0 alpha).
//
// The guild lead picked design rule A for the Canvas: "Show-when rules: the screen empties itself between
// pulls. Each piece gets a condition: in combat, have a target, NPC target, in raid, my class. Over a moving
// 3D scene, fewer things on screen beats everything else."
//
// A panel's `when` (combat / nocombat / target / npc / raid) and `cls` (a list of classes) hide it, out in
// play, while the rule is false: the way `off` hides it, but a computed state that never writes `off`.
// Arranging shows everything. A signal the agent cannot answer leaves the panel visible. Everything here runs
// the REAL functions sliced from canvas.html against fakes (no Electron, no DOM).
//
// Run: npx vitest run test/canvas-show-when.test.js
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, stripCss, AGENT_INDEX, ROOT } from './_source-slice.js';

const canvasRaw = readSource(path.join(ROOT, 'apps', 'mimic', 'canvas.html'));
const canvas = stripJs(canvasRaw);
const agent = stripJs(readSource(AGENT_INDEX));

const ENGINE = sliceBlock(canvasRaw, '  // ── Show when ──', '  // ── end Show when ──');
const ENGINE_API = ['WHEN', 'WHEN_CLASSES', 'COMBAT_HOLD_MS', 'RAID_FRESH_MS', 'cleanWhen', 'whenSources', 'targetIsNpc',
  'whenSignals', 'holdCombat', 'whenHolds', 'whenBadge', 'setWhen', 'setWhenClasses', 'toggleWhenClass'];
// A fresh copy each time: the combat hold keeps its state in the block.
const engine = () => evalBlock(ENGINE, ENGINE_API);

// What /api/me and /api/state answer (the agent's real shapes: _serializeMeState, raidPipe).
const NOW = 1_000_000;
const me = (o = {}) => Object.assign({ ok: true, character: 'Aldenmar', class: 'Cleric', combat: { live: false }, target: null }, o);
const npcTarget = { name: 'a decaying skeleton', hp_pct: 80, level_src: 'catalog' };
const raid = (age = 1000, n = 12) => ({ raidPipe: { at: NOW - age, members: Array.from({ length: n }, (_, i) => ({ name: 'R' + i })) } });

describe('the rules, against fake signals', () => {
  const E = engine();
  const holds = (p, m, s) => E.whenHolds(p, E.whenSignals(m, s, NOW));

  it('no rule always shows', () => {
    expect(holds({}, me(), raid())).toBe(true);
    expect(holds({}, null, null)).toBe(true);
  });

  it('in combat / out of combat follow the fight flag', () => {
    const e = engine();
    const sig = (live) => e.whenSignals(me({ combat: { live } }), null, NOW);
    expect(e.whenHolds({ when: 'combat' }, sig(true))).toBe(true);
    expect(e.whenHolds({ when: 'combat' }, sig(false))).toBe(false);
    expect(e.whenHolds({ when: 'nocombat' }, sig(false))).toBe(true);
    expect(e.whenHolds({ when: 'nocombat' }, sig(true))).toBe(false);
  });

  it('have a target: a target of any kind, a corpse too; none hides it', () => {
    expect(holds({ when: 'target' }, me({ target: npcTarget }), null)).toBe(true);
    expect(holds({ when: 'target' }, me({ target: { name: 'a rat`s corpse', corpse: true } }), null)).toBe(true);
    expect(holds({ when: 'target' }, me({ target: null }), null)).toBe(false);
  });

  it('NPC target: a catalog mob, or a name with a space; a player, a corpse or no target hides it', () => {
    const t = (target) => holds({ when: 'npc' }, me({ target }), null);
    expect(t(npcTarget)).toBe(true);
    expect(t({ name: 'Trakanon', level_src: 'catalog' })).toBe(true);
    expect(t({ name: 'a cave bear' })).toBe(true);
    expect(t({ name: '#Lord_Nagafen' })).toBe(true);
    expect(t({ name: 'Nyssara', level_src: 'who' })).toBe(false);
    expect(t({ name: 'Nyssara', level_src: 'history' })).toBe(false);
    expect(t({ name: 'a cave bear`s corpse', corpse: true })).toBe(false);
    expect(t(null)).toBe(false);
  });

  it('what makes a name an NPC\'s, asked of the function itself (a fail-open answer would hide a gap here)', () => {
    expect(E.targetIsNpc({ name: 'a cave bear' })).toBe(true);
    expect(E.targetIsNpc({ name: '#Lord_Nagafen' })).toBe(true);
    expect(E.targetIsNpc({ name: 'Nyssara', level_src: 'zeal' })).toBe(false);
    expect(E.targetIsNpc({ name: 'Nyssara', level_src: 'con' })).toBe(false);
  });

  it('a lone name with nothing said about it yet is unknown, so it shows rather than hides', () => {
    expect(E.targetIsNpc({ name: 'Trakanon' })).toBe(null);
    expect(holds({ when: 'npc' }, me({ target: { name: 'Trakanon' } }), null)).toBe(true);
  });

  it('in a raid: a Zeal raid window seen within RAID_FRESH_MS', () => {
    expect(holds({ when: 'raid' }, null, raid(1000))).toBe(true);
    expect(holds({ when: 'raid' }, null, raid(E.RAID_FRESH_MS - 1))).toBe(true);
    expect(holds({ when: 'raid' }, null, raid(E.RAID_FRESH_MS + 1))).toBe(false);
    expect(holds({ when: 'raid' }, null, raid(1000, 0))).toBe(false);
    expect(holds({ when: 'raid' }, null, { raidPipe: null })).toBe(false);
  });

  it('class: only the listed classes of the active character, however the name is cased', () => {
    expect(holds({ cls: ['Cleric', 'Druid'] }, me({ class: 'Cleric' }), null)).toBe(true);
    expect(holds({ cls: ['Cleric', 'Druid'] }, me({ class: 'druid' }), null)).toBe(true);
    expect(holds({ cls: ['Cleric', 'Druid'] }, me({ class: 'Shadow Knight' }), null)).toBe(false);
    expect(holds({ cls: [] }, me({ class: 'Shadow Knight' }), null)).toBe(true);
  });

  it('a condition and a class list are an AND', () => {
    const p = { when: 'combat', cls: ['Cleric'] };
    expect(holds(p, me({ combat: { live: true } }), null)).toBe(true);
    expect(holds(p, me({ combat: { live: false } }), null)).toBe(false);
    expect(holds(p, me({ combat: { live: true }, class: 'Wizard' }), null)).toBe(false);
  });
});

describe('fail open: a signal the agent cannot answer leaves the piece visible', () => {
  const E = engine();
  const sig = (m, s) => E.whenSignals(m, s, NOW);
  const every = [{ when: 'combat' }, { when: 'nocombat' }, { when: 'target' }, { when: 'npc' }, { when: 'raid' }, { cls: ['Cleric'] },
    { when: 'combat', cls: ['Cleric'] }];

  it('no data at all (agent down, stale, not asked yet)', () => {
    for (const p of every) expect(E.whenHolds(p, sig(null, null)), JSON.stringify(p)).toBe(true);
  });
  it('no active character (Zeal is not feeding)', () => {
    for (const p of every.filter(q => q.when !== 'raid')) expect(E.whenHolds(p, sig({ ok: true, character: null }, null)), JSON.stringify(p)).toBe(true);
  });
  it('an older agent that answers without the field: shows, and says which one is missing', () => {
    const old = { ok: true, character: 'Aldenmar' };
    const s = sig(old, {});
    expect(s.miss).toEqual({ combat: true, target: true, npc: true, cls: true, raid: true });
    for (const p of every) expect(E.whenHolds(p, s), JSON.stringify(p)).toBe(true);
  });
  it('a newer agent misses nothing', () => {
    expect(sig(me(), raid()).miss).toEqual({});
  });
  it('a class not yet known (null) is not "missing", and shows', () => {
    const s = sig(me({ class: null }), null);
    expect(s.miss.cls).toBeUndefined();
    expect(E.whenHolds({ cls: ['Cleric'] }, s)).toBe(true);
  });
});

describe('the combat hold: pieces for combat stay up COMBAT_HOLD_MS after a fight', () => {
  it('names the number, and it is 8 seconds', () => {
    expect(engine().COMBAT_HOLD_MS).toBe(8000);
    expect(canvas).toMatch(/var COMBAT_HOLD_MS = 8000;/);
  });
  it('up at once, held through the gap, gone after it; out-of-combat pieces wait the same', () => {
    const E = engine(), H = E.COMBAT_HOLD_MS;
    const at = (t, live) => { const s = E.whenSignals(me({ combat: { live } }), null, t); s.combat = E.holdCombat(s.combat, t); return s; };
    const T = 50_000;
    const c = { when: 'combat' }, n = { when: 'nocombat' };
    let s = at(T, false);
    expect(E.whenHolds(c, s)).toBe(false);              // never in a fight: hidden
    expect(E.whenHolds(n, s)).toBe(true);
    s = at(T + 100, true);
    expect(E.whenHolds(c, s)).toBe(true);               // the fight starts: up at once
    expect(E.whenHolds(n, s)).toBe(false);
    s = at(T + 5000, false);                            // the fight is over...
    expect(E.whenHolds(c, s)).toBe(true);               // ...but combat pieces stay up
    expect(E.whenHolds(n, s)).toBe(false);
    s = at(T + 100 + H - 1, false);                     // the hold runs from the last moment of combat
    expect(E.whenHolds(c, s)).toBe(true);
    s = at(T + 100 + H, false);
    expect(E.whenHolds(c, s)).toBe(false);
    expect(E.whenHolds(n, s)).toBe(true);
  });
  it('a new fight inside the hold restarts it', () => {
    const E = engine(), H = E.COMBAT_HOLD_MS;
    expect(E.holdCombat(true, 1000)).toBe(true);
    expect(E.holdCombat(false, 1000 + H - 10)).toBe(true);
    expect(E.holdCombat(true, 1000 + H - 5)).toBe(true);
    expect(E.holdCombat(false, 1000 + H + 100)).toBe(true);
    expect(E.holdCombat(false, 1000 + H - 5 + H)).toBe(false);
  });
  it('an unknown answer stays unknown (shown), and does not clear the hold', () => {
    const E = engine();
    expect(E.holdCombat(true, 1000)).toBe(true);
    expect(E.holdCombat(null, 2000)).toBe(null);
    expect(E.holdCombat(false, 3000)).toBe(true);
  });
});

describe('the layout keeps valid rules and drops junk (sanitize)', () => {
  const { sanitize } = evalBlock('var window = {};\n' + sliceBlock(canvasRaw, '  var GROUPS = [', '  // ── Panels ──'), ['sanitize']);
  const part = (o) => Object.assign({ id: 'a', kind: 'part', part: 'me.hp', mode: 'bar', x: 0.1, y: 0.1, w: 200, h: 30 }, o);

  it('keeps a good rule on every kind of panel', () => {
    const s = sanitize({ panels: [
      part({ when: 'combat', cls: ['Cleric', 'Druid'] }),
      { id: 'o', kind: 'overlay', key: 'me', x: 0.2, y: 0.2, w: 300, h: 200, when: 'raid' },
      { id: 's', kind: 'sect', key: 'mobinfo', sect: 'hp', x: 0.2, y: 0.2, w: 300, h: 40, when: 'npc' },
      { id: 'callouts', kind: 'callouts', x: 0.3, y: 0.1, w: 600, h: 100, when: 'nocombat' },
      { id: 'timers', kind: 'timers', all: true, x: 0.6, y: 0.5, w: 300, h: 200, cls: ['Bard'] },
    ] });
    const by = Object.fromEntries(s.panels.map(p => [p.id, p]));
    expect(by.a).toMatchObject({ when: 'combat', cls: ['Cleric', 'Druid'] });
    expect(by.o.when).toBe('raid');
    expect(by.s.when).toBe('npc');
    expect(by.callouts.when).toBe('nocombat');
    expect(by.timers.cls).toEqual(['Bard']);
  });
  it('drops an unknown condition, junk classes, duplicates; orders the classes', () => {
    const s = sanitize({ panels: [part({ when: 'whenever', cls: ['Cleric', 'Cleric', 'Gnome', 7, null, 'Bard'] }), part({ id: 'b', when: 42, cls: 'Cleric' })] });
    const a = s.panels.find(p => p.id === 'a'), b = s.panels.find(p => p.id === 'b');
    expect(a.when).toBeUndefined();
    expect(a.cls).toEqual(['Cleric', 'Bard']);
    expect(b.when).toBeUndefined();
    expect(b.cls).toBeUndefined();
  });
  it('a panel with no rule stays as it was: no keys added', () => {
    const s = sanitize({ panels: [part({}), part({ id: 'c', when: '', cls: [] })] });
    for (const p of s.panels.filter(q => q.kind === 'part')) { expect('when' in p).toBe(false); expect('cls' in p).toBe(false); }
  });
  it('never touches off', () => {
    const s = sanitize({ panels: [part({ off: true, when: 'combat' }), part({ id: 'b', off: false, when: 'combat' })] });
    expect(s.panels.find(p => p.id === 'a').off).toBe(true);
    expect(s.panels.find(p => p.id === 'b').off).toBe(false);
  });
});

describe('setting a rule', () => {
  const E = engine();
  it('sets, clears, and ignores a value that is not a rule', () => {
    const ps = [{ id: 'a' }, { id: 'b', when: 'raid' }];
    E.setWhen(ps, 'target');
    expect(ps.map(p => p.when)).toEqual(['target', 'target']);
    E.setWhen(ps, 'bogus');
    expect(ps.map(p => p.when)).toEqual(['target', 'target']);
    E.setWhen(ps, '');
    expect(ps.map(p => 'when' in p)).toEqual([false, false]);
  });
  it('classes toggle in order, and "Any class" clears them', () => {
    const p = {};
    E.toggleWhenClass(p, 'Druid'); E.toggleWhenClass(p, 'Cleric');
    expect(p.cls).toEqual(['Cleric', 'Druid']);
    E.toggleWhenClass(p, 'Druid');
    expect(p.cls).toEqual(['Cleric']);
    E.toggleWhenClass(p, 'Cleric');
    expect('cls' in p).toBe(false);
    E.toggleWhenClass(p, 'Bard'); E.toggleWhenClass(p, '');
    expect('cls' in p).toBe(false);
  });
  it('the selection bar applies one rule to every selected panel', () => {
    const handlers = {};
    const selbar = { addEventListener: (ev, fn) => { handlers[ev] = fn; } };
    const block = sliceBlock(canvasRaw, "  selbar.addEventListener('change', function (ev) {", '    save(); render();\n  });\n');
    const panels = { a: { id: 'a', when: 'raid' }, b: { id: 'b' }, c: { id: 'c' } };
    const calls = [];
    new Function('selbar', 'selIds', 'panelById', 'setWhen', 'setWhenClasses', 'save', 'render', block)(
      selbar, () => ['a', 'b'], (id) => panels[id], E.setWhen, E.setWhenClasses, () => calls.push('save'), () => calls.push('render'));
    const pick = (id, value) => { const t = { id, value }; handlers.change({ target: t }); return t; };
    expect(pick('selWhen', 'combat').value).toBe('');           // back to its heading
    expect([panels.a.when, panels.b.when, panels.c.when]).toEqual(['combat', 'combat', undefined]);
    pick('selCls', 'Cleric');
    expect([panels.a.cls, panels.b.cls, panels.c.cls]).toEqual([['Cleric'], ['Cleric'], undefined]);
    pick('selWhen', '*'); pick('selCls', '*');
    expect(['when' in panels.a, 'cls' in panels.b]).toEqual([false, false]);
    const n = calls.length;
    pick('selWhen', '');                                        // the heading itself is no action
    expect(calls.length).toBe(n);
    expect(calls.slice(0, 2)).toEqual(['save', 'render']);
  });
});

describe('on the screen (applyWhen)', () => {
  const DOM = sliceBlock(canvasRaw, '  function currentWhen() {', "e.whb.classList.toggle('on', !!badge);\n    });\n  }\n");
  function screen(panels, data = {}) {
    const mk = () => { const set = new Set(); return { set, classList: { toggle: (c, on) => { if (on) set.add(c); else set.delete(c); }, contains: (c) => set.has(c) } }; };
    const els = {};
    for (const p of panels) els[p.id] = { root: mk(), whb: Object.assign(mk(), { textContent: '' }) };
    for (const p of panels) if (p.off) els[p.id].root.set.add('off');       // render() puts it there
    const w = { me: data.me || null, state: data.state || null, edit: false, now: NOW };
    const f = new Function('liveData', 'esc', '_layout', '_els', 'Date_now',
      'var Date = { now: Date_now };\nvar _edit = false;\n' + ENGINE + '\n' + DOM
      + '\nreturn { applyWhen, whenMenuHtml, setEdit: function (v) { _edit = v; } };');
    const api = f((k) => w[k], (s) => String(s), { panels }, els, () => w.now);
    return { els, w, api, hidden: (id) => els[id].root.set.has('wh'), badge: (id) => els[id].whb.textContent };
  }

  it('hides a panel whose rule is false, shows it when true, and leaves off alone', () => {
    const panels = [{ id: 'a', when: 'combat' }, { id: 'b', when: 'target' }, { id: 'c' }];
    const s = screen(panels, { me: me({ combat: { live: false }, target: npcTarget }) });
    s.api.applyWhen();
    expect([s.hidden('a'), s.hidden('b'), s.hidden('c')]).toEqual([true, false, false]);
    expect(panels.map(p => p.off)).toEqual([undefined, undefined, undefined]);   // a computed state, never saved
    s.w.me = me({ combat: { live: true }, target: null });
    s.api.applyWhen();
    expect([s.hidden('a'), s.hidden('b')]).toEqual([false, true]);
  });

  it('off wins: an off panel stays off whatever its rule, and a rule never turns it on', () => {
    const panels = [{ id: 'a', when: 'combat', off: true }, { id: 'b', when: 'nocombat', off: true }];
    const s = screen(panels, { me: me({ combat: { live: true } }) });
    s.api.applyWhen();
    expect(s.els.a.root.set.has('off')).toBe(true);           // still off, the rule being true
    expect(s.els.b.root.set.has('off')).toBe(true);           // still off, the rule being false
    expect(panels.map(p => p.off)).toEqual([true, true]);
    expect(s.hidden('a')).toBe(false);
  });

  it('arranging shows every piece, with a badge of its rule', () => {
    const panels = [{ id: 'a', when: 'combat' }, { id: 'b', when: 'raid', cls: ['Cleric', 'Druid'] }, { id: 'c', cls: ['Bard'] }, { id: 'd' }];
    const s = screen(panels, { me: me({ combat: { live: false } }) });
    s.api.applyWhen();
    expect(s.hidden('a')).toBe(true);
    s.api.setEdit(true);
    s.api.applyWhen();
    expect(['a', 'b', 'c', 'd'].map(s.hidden)).toEqual([false, false, false, false]);
    expect(s.badge('a')).toBe('In combat');
    expect(s.badge('b')).toBe('In a raid · CLR DRU');
    expect(s.badge('c')).toBe('BRD');
    expect(s.badge('d')).toBe('');
    expect(s.els.a.whb.set.has('on')).toBe(true);
    expect(s.els.d.whb.set.has('on')).toBe(false);
    s.api.setEdit(false);                                    // out in play the badge goes and the rule hides again
    s.api.applyWhen();
    expect(s.hidden('a')).toBe(true);
    expect(s.els.a.whb.set.has('on')).toBe(false);
  });

  it('with no data a rule hides nothing', () => {
    const s = screen([{ id: 'a', when: 'combat' }, { id: 'b', when: 'raid' }, { id: 'c', cls: ['Bard'] }]);
    s.api.applyWhen();
    expect(['a', 'b', 'c'].map(s.hidden)).toEqual([false, false, false]);
  });

  it('reads the hold off the clock: gone only after COMBAT_HOLD_MS', () => {
    const s = screen([{ id: 'a', when: 'combat' }], { me: me({ combat: { live: true } }) });
    s.api.applyWhen();
    expect(s.hidden('a')).toBe(false);
    s.w.me = me({ combat: { live: false } });
    s.w.now = NOW + 7999; s.api.applyWhen();
    expect(s.hidden('a')).toBe(false);
    s.w.now = NOW + 8000; s.api.applyWhen();
    expect(s.hidden('a')).toBe(true);
  });

  it('the menu rows: Always + each condition, a class picker, and "needs a newer agent" when the agent lacks the signal', () => {
    const p = { id: 'a', when: 'combat', cls: ['Cleric'] };
    const ok = screen([p], { me: me() });
    const html = ok.api.whenMenuHtml(p);
    expect(html).toMatch(/Show when/);
    for (const v of ['', 'combat', 'nocombat', 'target', 'npc', 'raid']) expect(html).toContain('data-when="' + v + '"');
    for (const l of ['Always', 'In combat', 'Out of combat', 'Have a target', 'NPC target', 'In a raid']) expect(html).toContain('>' + l + '<');
    expect(html).toContain('data-wcls=""');
    expect(html).toContain('data-wcls="Shadow Knight"');
    expect(html).toMatch(/class="btn on" data-when="combat"/);
    expect(html).toMatch(/class="btn on" data-wcls="Cleric"/);
    expect(html).not.toMatch(/needs a newer agent/);
    const old = screen([p], { me: { ok: true, character: 'Aldenmar' } });
    expect(old.api.whenMenuHtml(p)).toMatch(/needs a newer agent/);
    const oldRaid = screen([{ id: 'r', when: 'raid' }], { me: me(), state: {} });
    expect(oldRaid.api.whenMenuHtml({ id: 'r', when: 'raid' })).toMatch(/needs a newer agent/);
    expect(old.api.whenMenuHtml({ id: 'z' })).not.toMatch(/needs a newer agent/);   // no rule, nothing to lack
    // Out of combat reads the same fight flag as in combat.
    expect(old.api.whenMenuHtml({ id: 'n', when: 'nocombat' })).toMatch(/needs a newer agent/);
    expect(ok.api.whenMenuHtml({ id: 'n', when: 'nocombat' })).not.toMatch(/needs a newer agent/);
  });
});

describe('the canvas polls only what a rule needs, at the cadence it already has', () => {
  const fn = sliceBlock(canvasRaw, '  function neededSources() {', '\n  }\n');
  const lib = { SOURCES: {} };
  const need = (panels) => new Function('window', 'WpParts', '_layout', '_edit', 'partDef', 'chooserState', 'chooserShown', 'whenSources',
    fn + '\nreturn neededSources();')({ WpParts: lib }, lib, { panels }, false, () => null, () => ({ open: false, tab: 'groups' }), () => false, engine().whenSources);

  it('combat, target, npc and class rules read /api/me; raid reads /api/state', () => {
    for (const when of ['combat', 'nocombat', 'target', 'npc']) expect(need([{ kind: 'callouts', when }]), when).toEqual({ me: true });
    expect(need([{ kind: 'timers', cls: ['Cleric'] }])).toEqual({ me: true });
    expect(need([{ kind: 'overlay', when: 'raid' }])).toEqual({ state: true });
    expect(need([{ kind: 'overlay', when: 'raid', cls: ['Cleric'] }])).toEqual({ state: true, me: true });
  });
  it('no rule, no poll; an off panel needs nothing', () => {
    expect(need([{ kind: 'callouts' }, { kind: 'timers', all: true }])).toEqual({});
    expect(need([{ kind: 'callouts', when: 'combat', off: true }])).toEqual({});
  });
  it('the sources are the canvas\'s existing ones: no new endpoint, no new interval', () => {
    const parts = readSource(path.join(ROOT, 'apps', 'mimic', 'parts.js'));
    expect(parts).toMatch(/me:\s+\{ path: '\/api\/me',\s+every: 500 \}/);
    expect(parts).toMatch(/state:\s+\{ path: '\/api\/state',\s+every: 1000 \}/);
    const win = sliceBlock(canvas, '  function currentWhen() {', '\n  }\n');
    expect(win).not.toMatch(/fetch\(|setInterval|setTimeout/);
    expect(canvas).toMatch(/paintChooserValues\(\); applyWhen\(\); setTimeout\(tick,/);
  });
});

describe('hidden the way off hides, without touching off', () => {
  const css = stripCss(canvasRaw);
  it('the same hide, as a class of its own, and nothing hides it while arranging', () => {
    expect(css).toMatch(/\.panel\.off\{visibility:hidden\}/);
    expect(css).toMatch(/\.panel\.wh\{visibility:hidden\}/);
    expect(css).not.toMatch(/body\.edit \.panel\.wh/);
    expect(css).toMatch(/body\.edit \.whb\.on\{display:block/);
  });
  it('applyWhen never writes off', () => {
    const dom = sliceBlock(canvas, '  function applyWhen() {', "e.whb.classList.toggle('on', !!badge);");
    expect(dom).not.toMatch(/\.off\b/);
  });
  it('render() applies it, and the menu and the selection bar carry it', () => {
    expect(canvas).toMatch(/applyWhen\(\);\s*markGroupMovers\(\);/);
    expect(canvas).toMatch(/h \+= whenMenuHtml\(p\);/);
    expect(canvas).toMatch(/else if \(t\.hasAttribute\('data-when'\)\) \{ setWhen\(\[p\], t\.getAttribute\('data-when'\)\); \}/);
    expect(canvas).toMatch(/else if \(t\.hasAttribute\('data-wcls'\)\) \{ toggleWhenClass\(p, t\.getAttribute\('data-wcls'\)\); \}/);
    expect(canvas).toMatch(/id="selWhen"/);
    expect(canvas).toMatch(/id="selCls"/);
  });
});

describe('the signals are the agent\'s real fields (nothing new asked of the agent)', () => {
  const meFn = sliceBlock(agent, 'function _serializeMeState() {', '\n}\n');
  it('/api/me carries the fight flag, the target, the target\'s level source and the active class', () => {
    expect(meFn).toMatch(/combat\.live = !!fight;/);
    expect(meFn).toMatch(/level, class: cls,/);
    expect(meFn).toMatch(/target: st\.target_name \? \{ name: st\.target_name,[^\n]*\.\.\.\(tx \|\| \{\}\)/);
    const extras = sliceBlock(agent, 'function _meTargetExtras(st, active, now) {', '\n}\n');
    expect(extras).toMatch(/return \{ corpse: true \}/);
    expect(extras).toMatch(/level, level_max, level_src, class: klass,/);
    expect(extras).toMatch(/level_src = 'catalog'/);
  });
  it('/api/state carries the raid window, and the agent\'s own "in a raid" window matches RAID_FRESH_MS', () => {
    expect(agent).toMatch(/raidPipe: _lastRaidPipe,/);
    expect(agent).toMatch(/_lastRaidPipe = \{ at: Date\.now\(\), members: compact \};/);
    expect(agent).toMatch(/const EXT_RAID_FRESH_MS = 60_000;/);
    expect(engine().RAID_FRESH_MS).toBe(60000);
  });
  it('every class the picker offers is one the agent can name', () => {
    const names = engine().WHEN_CLASSES.map(c => c[0]);
    expect(names).toHaveLength(15);
    for (const n of names) expect(agent, n).toContain("'" + n + "'");
  });
});
