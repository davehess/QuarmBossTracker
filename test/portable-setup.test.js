// test/portable-setup.test.js — a WHOLE Mimic setup as one shareable document (the guild lead, 2026-10-19, DECISIONS §383:
// "Share a whole setup = A, file + share code"; §91 for the options, §376 for the layout half).
//
// setupBundle.js and portableSetup.js run for real (require). The wiring in main.js, preload.js, Settings, the tray, the
// dashboard and the agent is checked as comment-stripped source (this repo's comments quote the very things under test).
//
// Run: npx vitest run test/portable-setup.test.js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readSource, stripJs, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const MIMIC = path.join(ROOT, 'apps', 'mimic');
const sb = require(path.join(MIMIC, 'setupBundle.js'));
const ps = require(path.join(MIMIC, 'portableSetup.js'));
const pl = require(path.join(MIMIC, 'portableLayout.js'));

// A Canvas layout, as the Canvas keeps it, exported the way main.js does.
const panel = (id, x, y, extra) => Object.assign({ id, kind: 'part', part: 'me.hp', mode: 'bar', name: '', x, y, w: 240, h: 30, scale: 1, back: false, grp: null, off: false }, extra);
const canvas = { panels: [panel('a', 0.02, 0.3, { grp: 'g' }), panel('b', 0.02, 0.34, { part: 'me.mana', grp: 'g' }),
  { id: 't', kind: 'timers', all: true, groups: [], names: [], name: 'Timers', x: 0.8, y: 0.8, w: 300, h: 160, scale: 1, anchor: 'bottom', grp: null, off: false }] };
const portable = (title) => {
  const r = pl.toPortable(canvas, { width: 1920, height: 1080 }, { x: 0, y: 0, width: 1920, height: 1080 }, { title });
  expect(r.ok, r.error).toBe(true);
  return r.doc;
};

// What the agent reports for the sharer's two characters (names are DATA here, never prose).
const MINE = ['Aldenmar', 'Brackwyn'];
const trig = (over) => Object.assign({ id: 'p_1', name: 'Gravel Rain', pattern: 'Gravel Rain', enabled: true, actions: [{ type: 'text_overlay', text: 'rain' }, { type: 'tts', text: 'rain' }],
  characters: ['aldenmar'], valid: true, _regex: {}, _scope: 'personal' }, over || {});
const input = (over) => Object.assign({
  meta: { title: 'Raid night', byline: '', note: 'Meter on the left' },
  layouts: [{ name: 'Raid', active: true, doc: portable('Raid') }, { name: 'Group', active: false, doc: portable('Group') }],
  hud: { aldenmar: { ring: 1, sizes: { all: 1.2 }, clickyPick: ['Spell: Heal'] }, brackwyn: { ring: 0 } },
  options: { overlay: { tab: 'tank', rows: 12 }, who: { zekOnly: true } },
  triggers: [trig(), trig({ id: 'p_2', name: 'Mez broke', pattern: 'Your mez broke', characters: undefined }), trig({ id: 'p_3', name: 'Charm', characters: ['brackwyn'] })],
  rules: { 'personal:p_1': { '*': 'speak', aldenmar: 'off' }, 'guild:7': { '*': 'overlay' }, 'builtin:charm_aging': { brackwyn: 'off' }, 'personal:gone': { '*': 'off' } },
  ownChars: MINE,
}, over || {});

describe('build: everything a setup holds, with the characters as numbers', () => {
  it('writes layouts, HUD, options, triggers and rules, and passes the shared gate', () => {
    const r = sb.build(input());
    expect(r.ok, r.error).toBe(true);
    expect(r.setup).toMatchObject({ format: 'mimic-setup', version: 1 });
    expect(r.setup.layouts.map(l => [l.name, l.active])).toEqual([['Raid', true], ['Group', false]]);
    expect(r.setup.slots).toEqual([{ slot: 'c1', label: 'Character 1' }, { slot: 'c2', label: 'Character 2' }]);
    expect(r.setup.hud.map(h => h.slot)).toEqual(['c1', 'c2']);
    expect(r.setup.triggers.map(t => [t.trigger.name, t.for])).toEqual([['Gravel Rain', ['c1']], ['Mez broke', []], ['Charm', ['c2']]]);
    expect(r.setup.options).toEqual({ overlay: { tab: 'tank', rows: 12 }, who: { zekOnly: true } });
    expect(r.report.summary).toMatchObject({ layouts: 2, hud: 2, triggers: 3, options: 2, characters: 2 });
    expect(ps.validate(r.setup).ok).toBe(true);
  });

  it('the sharer\'s own characters come first, in their order; the rest follow A to Z', () => {
    const r = sb.build(input({ ownChars: ['Brackwyn'], hud: { aldenmar: {}, brackwyn: {}, corvale: {} }, triggers: [] }));
    expect(r.setup.hud.map(h => h.slot)).toEqual(['c1', 'c2', 'c3']);
    expect(r.setup.slots).toHaveLength(3);
    const own = sb.build(input({ ownChars: ['Brackwyn', 'Aldenmar'], triggers: [], rules: {} }));
    expect(own.setup.hud[0].parts).toEqual({ ring: 0 });      // brackwyn is Character 1
  });

  it('NO character name appears anywhere in the document', () => {
    const text = JSON.stringify(sb.build(input()).setup).toLowerCase();
    for (const name of ['aldenmar', 'brackwyn']) expect(text, name).not.toContain(name);
    expect(JSON.stringify(sb.build(input()).setup)).not.toContain('"characters"');
  });

  it('the agent\'s own bookkeeping goes: compiled bits, the valid flag, a custom sound file', () => {
    const t = trig({ actions: [{ type: 'tts', text: 'x', sound: 'custom:mine.wav', sound_volume: 0.5, sound_mode: 'replace' }, { type: 'text_overlay', text: 'y', sound: 'bell' }], sound: 'custom:top.wav' });
    const r = sb.build(input({ triggers: [t], rules: {} }));
    const out = r.setup.triggers[0].trigger;
    expect(out).not.toHaveProperty('_regex');
    expect(out).not.toHaveProperty('_scope');
    expect(out).not.toHaveProperty('valid');
    expect(out).not.toHaveProperty('sound');
    expect(out.actions[0]).not.toHaveProperty('sound');
    expect(out.actions[0]).not.toHaveProperty('sound_mode');
    expect(out.actions[1].sound).toBe('bell');                  // a shipped sound travels by name
  });

  it('a trigger that holds a path, a link or a sign-in stays behind, and the report says so', () => {
    const bad = [trig({ id: 'p_9', name: 'Mine', sound_url: 'C:\\Users\\someone\\x.wav' }), trig({ id: 'p_8', name: 'Hook', actions: [{ type: 'discord', webhook: 'x' }] }),
      trig({ id: 'p_7', name: 'Fine' })];
    const r = sb.build(input({ triggers: bad, rules: { 'personal:p_9': { '*': 'off' }, 'personal:p_7': { '*': 'off' } } }));
    expect(r.ok).toBe(true);
    expect(r.setup.triggers.map(t => t.trigger.name)).toEqual(['Fine']);
    expect(r.report.left.map(x => x.what)).toEqual(['trigger "Mine"', 'trigger "Hook"']);
    expect(Object.keys(r.setup.rules)).toEqual(['personal:p_7']);   // and so does the rule that was about the one left behind
  });

  it('rules: only the shapes the agent keeps, a rule for a trigger not in the bundle dropped, cells by slot', () => {
    const r = sb.build(input({ rules: { 'timer:trigger:x': { '*': 'off' }, 'junk': { '*': 'off' }, 'guild:7': { '*': 'overlay', brackwyn: 'off' }, 'group:zone:potime': { '*': 'banana' } } }));
    expect(r.setup.rules).toEqual({ 'guild:7': { all: 'overlay', c2: 'off' } });
  });

  it('a setup holds at most twelve characters; the rest are said to be left behind', () => {
    const names = Array.from({ length: 14 }, (_, i) => 'zq' + String.fromCharCode(97 + i));
    const hud = Object.fromEntries(names.map(n => [n, { ring: 1 }]));
    const r = sb.build(input({ hud, ownChars: names, triggers: [], rules: {} }));
    expect(r.setup.slots).toHaveLength(12);
    expect(r.report.left.some(x => /2 characters/.test(x.what))).toBe(true);
  });

  it('refuses nothing-to-share, and says why', () => {
    const r = sb.build({ meta: { title: 'x' }, layouts: [], hud: {}, options: {}, triggers: [], rules: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/nothing in it/);
  });

  it('does not change what it is given', () => {
    const inp = input();
    const before = JSON.stringify(inp);
    sb.build(inp);
    expect(JSON.stringify(inp)).toBe(before);
  });
});

describe('describe + plan: what the preview shows and what the ticks do', () => {
  const setup = () => sb.build(input()).setup;
  const ALL = (s) => ({ layouts: s.layouts.map((_, i) => String(i)), options: Object.keys(s.options), hud: s.hud.map(h => h.slot),
    triggers: s.triggers.map((_, i) => String(i)), rules: true });
  const THEM = ['Dunmore', 'Evelyn'];

  it('lists every part, ticked ids that plan() takes back, and the per-character parts by number', () => {
    const m = sb.describe(setup(), THEM);
    expect(m.title).toBe('Raid night');
    expect(m.sections.map(s => s.id)).toEqual(['layouts', 'options', 'hud', 'triggers', 'rules']);
    expect(m.sections[0].items.map(i => i.label)).toEqual(['Raid', 'Group']);
    expect(m.sections[0].items[0].detail).toMatch(/3 pieces.*their screen/);
    expect(m.characters).toEqual([
      { slot: 'c1', label: 'Character 1', hud: true, triggers: 1, rules: 1 },
      { slot: 'c2', label: 'Character 2', hud: true, triggers: 1, rules: 1 },
    ]);
    expect(m.mine).toEqual(THEM);
    expect(m.assign).toEqual({ c1: ['Dunmore'], c2: ['Evelyn'] });      // a starting guess, in order
    expect(JSON.stringify(m).toLowerCase()).not.toMatch(/aldenmar|brackwyn/);
  });

  it('with fewer characters than slots, the extra slots start unassigned', () => {
    expect(sb.describe(setup(), ['Solo']).assign).toEqual({ c1: ['Solo'] });
    expect(sb.describe(setup(), []).assign).toEqual({});
  });

  it('plan with everything ticked: HUD and triggers land on the characters picked, lowercased', () => {
    const s = setup();
    const p = sb.plan(s, ALL(s), { c1: ['Dunmore'], c2: ['Evelyn', 'Fenwick'] }, [...THEM, 'Fenwick']);
    expect(p.layouts.map(l => l.name)).toEqual(['Raid', 'Group']);
    expect(JSON.parse(p.storage['wpHudParts:dunmore'])).toEqual(s.hud[0].parts);
    expect(JSON.parse(p.storage['wpHudParts:evelyn'])).toEqual({ ring: 0 });
    expect(p.storage['wp.damageTabMode']).toBe('tank');
    expect(p.storage['wp.deepsRows']).toBe('12');
    expect(p.storage['wp:who:zekOnly']).toBe('1');
    const byName = Object.fromEntries(p.triggers.map(t => [t.name, t]));
    expect(byName['Gravel Rain'].characters).toEqual(['dunmore']);
    expect(byName['Charm'].characters).toEqual(['evelyn', 'fenwick']);
    expect(byName['Mez broke']).not.toHaveProperty('characters');      // for everyone stays for everyone
    expect(p.rules['personal:p_1']).toEqual({ '*': 'speak', dunmore: 'off' });
    expect(p.rules['guild:7']).toEqual({ '*': 'overlay' });
    expect(p.rules['builtin:charm_aging']).toEqual({ evelyn: 'off', fenwick: 'off' });
  });

  it('a slot with no character picked skips its HUD and its triggers, and says so; everyone-triggers still land', () => {
    const s = setup();
    const p = sb.plan(s, ALL(s), { c1: ['Dunmore'] }, THEM);
    expect(p.triggers.map(t => t.name)).toEqual(['Gravel Rain', 'Mez broke']);
    expect(Object.keys(p.storage).filter(k => k.startsWith('wpHudParts:'))).toEqual(['wpHudParts:dunmore']);
    expect(p.report.skipped.some(x => /Character 2/.test(x))).toBe(true);
    expect(p.report.skipped.some(x => /trigger "Charm"/.test(x))).toBe(true);
    expect(p.rules['builtin:charm_aging']).toBeUndefined();
  });

  it('an assignment to a character that is not the importer\'s is ignored (never trusted from the page)', () => {
    const s = setup();
    const p = sb.plan(s, ALL(s), { c1: ['Mallory', '../x', 'dunmore'] }, THEM);
    expect(Object.keys(p.storage).filter(k => k.startsWith('wpHudParts:'))).toEqual(['wpHudParts:dunmore']);
    expect(p.triggers.find(t => t.name === 'Gravel Rain').characters).toEqual(['dunmore']);
  });

  it('only what is ticked happens', () => {
    const s = setup();
    const none = sb.plan(s, {}, { c1: ['Dunmore'], c2: ['Evelyn'] }, THEM);
    expect(none).toMatchObject({ layouts: [], storage: {}, triggers: [], rules: {} });
    const some = sb.plan(s, { layouts: ['1'], triggers: ['1'], options: ['who'] }, { c1: ['Dunmore'] }, THEM);
    expect(some.layouts.map(l => l.name)).toEqual(['Group']);
    expect(some.triggers.map(t => t.name)).toEqual(['Mez broke']);
    expect(some.storage).toEqual({ 'wp:who:zekOnly': '1' });
    expect(some.rules).toEqual({});
  });

  it('a rule about a personal trigger lands only with that trigger', () => {
    const s = setup();
    const p = sb.plan(s, { rules: true, triggers: ['1'] }, { c1: ['Dunmore'], c2: ['Evelyn'] }, THEM);
    expect(p.rules['personal:p_1']).toBeUndefined();
    expect(p.rules['guild:7']).toEqual({ '*': 'overlay' });
  });

  it('a custom sound that arrived anyway is dropped on the way in', () => {
    const s = setup();
    s.triggers[1].trigger.actions = [{ type: 'tts', text: 'x', sound: 'CUSTOM:theirs.wav' }];
    const p = sb.plan(s, ALL(s), {}, THEM);
    expect(p.triggers.find(t => t.name === 'Mez broke').actions[0]).not.toHaveProperty('sound');
  });

  it('does not change the setup it is given', () => {
    const s = setup();
    const before = JSON.stringify(s);
    sb.plan(s, ALL(s), { c1: ['Dunmore'] }, THEM);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('the localStorage registry: a key is shared, private, or not read at all', () => {
  const dump = { 'wp.damageTabMode': 'tank', 'wp.deepsRows': '20', 'wp:who:filters': JSON.stringify({ classes: ['Cleric'], guilds: [], sortBy: 'name' }),
    'wp_ext_self_keep': '120', 'chchain_lead_sec': '1.5', 'wp:bufferClass': 'Cleric', 'wpMeCardBounds': '{"x":1}', 'wp-map-fit': '1', 'surprise': 'x' };

  it('reads the shared keys, with their values typed, and nothing else', () => {
    expect(sb.optionsFromStorage(dump)).toEqual({ overlay: { tab: 'tank', rows: 20 }, who: { filters: { classes: ['Cleric'], guilds: [], sortBy: 'name' } },
      extarget: { selfKeep: 120 }, chchain: { leadSec: 1.5 } });
  });

  it('a value outside what the overlay accepts is dropped, not passed along', () => {
    const bad = { 'wp.damageTabMode': 'banana', 'wp.deepsRows': '9999', 'wp_ext_self_keep': '45', 'chchain_lead_sec': '99', 'wp:who:height': '5', 'wp:who:filters': '{"classes":"x"}', 'wp:tick:layout': 'pie' };
    expect(sb.optionsFromStorage(bad)).toEqual({});
    expect(sb.storageFromOptions({ overlay: { tab: 'banana', rows: 9999, nope: 1 }, who: { zekOnly: 'yes', height: 5 }, extarget: { selfKeep: 45 } })).toEqual({});
  });

  it('writes back strings exactly as the overlays store them, and only for the overlays asked for', () => {
    const opts = { overlay: { tab: 'history', rows: 9 }, who: { zekOnly: false, height: 'fit' }, zeal: { layout: 'dials', detail: true } };
    // `layout` is no longer a Tick option (bars only), so a bundle that still carries it writes nothing for it.
    expect(sb.storageFromOptions(opts)).toEqual({ 'wp.damageTabMode': 'history', 'wp.deepsRows': '9', 'wp:who:zekOnly': '0', 'wp:who:height': 'fit', 'wp:tick:detail': '1' });
    expect(sb.storageFromOptions(opts, ['zeal'])).toEqual({ 'wp:tick:detail': '1' });
  });

  it('round-trips: what the overlays store → options → what is stored', () => {
    const stored = { 'wp.damageTabMode': 'trend', 'wp.trendRange': 'week', 'wp:melody:dirge': '1', 'wp:who:height': '400', 'wp:who:zoneCol': '0', 'wp_ext_scope': 'self', 'chchain_mute': '1', 'wpTargetMana': 'off', 'wpCharmWarnAt': '30', 'wp:pop:fs': '14', 'wpMeStyle': 'hud' };
    expect(sb.storageFromOptions(sb.optionsFromStorage(stored))).toEqual(stored);
  });

  it('the HUD builder\'s keys are read per character, lowercase letters only, as objects, and bounded', () => {
    const hud = sb.hudFromStorage({ 'wpHudParts:aldenmar': '{"ring":1}', 'wpHudParts': '{"ring":0}', 'wpHudParts:Bad Name': '{}', 'wpHudParts:x1': '{}',
      'wpHudParts:big': JSON.stringify({ a: 'x'.repeat(9000) }), 'wpHudParts:arr': '[1]', 'wpHudParts:broken': '{' });
    expect(hud).toEqual({ aldenmar: { ring: 1 } });
  });

  it('classifyKey and readableKey', () => {
    expect(sb.classifyKey('wp.damageTabMode')).toBe('shared');
    expect(sb.classifyKey('wpHudParts:aldenmar')).toBe('hud');
    expect(sb.classifyKey('wpHudParts')).toBe('hud');
    expect(sb.classifyKey('wp:bufferClass')).toBe('private');
    expect(sb.classifyKey('wp-map-scale')).toBe('private');
    expect(sb.classifyKey('wpChatMore:b1')).toBe('private');
    expect(sb.classifyKey('somethingNew')).toBeNull();
    expect(sb.readableKey('wp:bufferClass')).toBe(false);
    expect(sb.readableKey('wpMeCardBounds')).toBe(false);
    expect(sb.readableKey('chchain_mute')).toBe(true);
    expect(sb.readableKey('somethingNew')).toBe(false);
  });

  // §91: "every new setting must be marked shareable or private. A test fails on unmarked keys".
  describe('every localStorage key the overlay pages use is marked', () => {
    const html = fs.readdirSync(MIMIC).filter(f => f.endsWith('.html'));
    const found = new Map();   // key → files
    const note = (k, f) => { if (!found.has(k)) found.set(k, new Set()); found.get(k).add(f); };
    for (const f of html) {
      const src = fs.readFileSync(path.join(MIMIC, f), 'utf8');
      for (const line of src.split('\n')) {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
        if (!/localStorage|lsGet\(|lsSet\(|_KEY\s*=|function (?:moreKey|histKey|moreSetKey)/.test(line)) continue;
        for (const m of line.matchAll(/'([A-Za-z][A-Za-z0-9._:\-]{2,40}:?)'/g)) {
          const k = m[1];
          if (/^(wp|chchain_|uiInspector)/.test(k)) note(k, f);
        }
      }
    }
    // A key built with a window id is written in the source as its prefix ('wpChatMore:' + winId()): the prefix is the key.
    const unmarked = [...found.keys()].filter(k => sb.classifyKey(k) === null && !sb.classifyKey(k + 'x') && !sb.PRIVATE_PREFIXES.includes(k));

    it('the scan is not vacuous: it sees the keys we know about', () => {
      expect(found.size).toBeGreaterThan(50);
      for (const k of ['wp.damageTabMode', 'wpHudParts', 'wp:who:filters', 'wp_ext_hidden', 'chchain_mute', 'wp-map-fit', 'wpChatMore:', 'wp:settings:draft', 'wpMeCardBounds']) {
        expect(found.has(k), k).toBe(true);
      }
    });

    it('none is unmarked (a new one is private until somebody decides it is shared)', () => {
      expect(unmarked, 'localStorage keys that are neither SHARED nor PRIVATE in apps/mimic/setupBundle.js:\n' + unmarked.join('\n')).toEqual([]);
    });

    it('every SHARED key is really used by the page it names, and no key is in both lists', () => {
      for (const [key, ov] of sb.SHARED) {
        expect(found.has(key), `${key} (${ov}) is not used by any page`).toBe(true);
        expect(sb.PRIVATE_KEYS.has(key), key).toBe(false);
      }
      for (const k of sb.PRIVATE_KEYS) expect(found.has(k), `${k} is marked private but no page uses it`).toBe(true);
    });
  });
});

describe('a file or a code from anywhere is untrusted', () => {
  const good = () => sb.build(input()).setup;

  it('parseText takes what build wrote, and hands back the rebuilt document', () => {
    const s = good();
    const r = sb.parseText(JSON.stringify(s, null, 2));
    expect(r.ok, r.error).toBe(true);
    expect(r.setup).toEqual(s);
  });

  it('refuses a file that is not JSON, not ours, too new, too big, or empty', () => {
    expect(sb.parseText('not json').error).toMatch(/not a Mimic setup/);
    expect(sb.parseText(JSON.stringify({ format: 'mimic-layout', version: 1 })).error).toMatch(/not a Mimic setup/);
    expect(sb.parseText(JSON.stringify({ ...good(), version: 2 })).error).toMatch(/newer Mimic/);
    expect(sb.parseText('x'.repeat(sb.MAX_BYTES + 1)).error).toMatch(/too big/);
    expect(sb.parseText(null).ok).toBe(false);
    expect(sb.parseText(JSON.stringify({ format: 'mimic-setup', version: 1 })).error).toMatch(/nothing in it/);
  });

  it('refuses a file carrying a sign-in, a path or a webhook, however it got there', () => {
    const s = good();
    const poisoned = [
      { ...s, options: { overlay: { token: 'x' } } },
      { ...s, triggers: [{ for: [], trigger: { name: 'x', pattern: 'y', sound: 'C:\\Windows\\x.wav' } }] },
      { ...s, hud: [{ slot: 'c1', parts: { url: 'https://discord.com/api/webhooks/1/2' } }] },
      { ...s, meta: { ...s.meta, note: 'wpms_' + 'a'.repeat(64) } },
    ];
    for (const p of poisoned) expect(sb.parseText(JSON.stringify(p)).ok).toBe(false);
  });

  it('unknown keys are never copied through', () => {
    const s = good();
    const r = sb.parseText(JSON.stringify({ ...s, evil: 1, layouts: s.layouts.map(l => ({ ...l, evil: 1 })) }));
    expect(r.ok).toBe(true);
    expect(r.setup).not.toHaveProperty('evil');
    expect(r.setup.layouts[0]).not.toHaveProperty('evil');
  });
});

describe('the share code, as typed', () => {
  it('ignores case, spaces and dashes; refuses what cannot be a code', () => {
    expect(sb.normalizeCode('ab7-k9z')).toBe('AB7K9Z');
    expect(sb.normalizeCode(' ab7 k9z ')).toBe('AB7K9Z');
    for (const bad of ['', null, 'AB7K9', 'AB7K9ZZ', 'AB7K90', 'ABOK9Z', 'AB1K9Z', 'ABIK9Z', 'ABLK9Z']) expect(sb.normalizeCode(bad), String(bad)).toBeNull();
    expect(sb.showCode('AB7K9Z')).toBe('AB7-K9Z');
    expect(sb.CODE_ALPHABET).not.toMatch(/[01OIL]/);
  });
});

describe('the validator is the bot\'s, byte for byte', () => {
  let botSrc = null;
  try { botSrc = execFileSync('git', ['show', 'origin/main:utils/portableSetup.js'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { botSrc = null; }
  const there = botSrc ? it : it.skip;
  there('apps/mimic/portableSetup.js is utils/portableSetup.js on main', () => {
    expect(fs.readFileSync(path.join(MIMIC, 'portableSetup.js'), 'utf8')).toBe(botSrc);
  });
  it('always: it requires only ./portableLayout, so the same file resolves it in either directory', () => {
    const src = stripJs(fs.readFileSync(path.join(MIMIC, 'portableSetup.js'), 'utf8'));
    expect([...src.matchAll(/require\(([^)]*)\)/g)].map(m => m[1])).toEqual(["'./portableLayout'"]);
    expect(src).not.toMatch(/\brequire\('(?:fs|http|https|electron|path)'\)/);
  });
});

describe('unit: the bot\'s answers, in a sentence; the windows a change reloads', () => {
  it('botMessage never says more than the person needs, and never carries a token', () => {
    expect(sb.botMessage({ signedOut: true }, 'make')).toMatch(/Sign in to Mimic first.*a file works without signing in/);
    expect(sb.botMessage({ status: 0 }, 'get')).toMatch(/Could not reach/);
    expect(sb.botMessage({ status: 401 }, 'get')).toMatch(/sign-in has ended/);
    expect(sb.botMessage({ status: 404 }, 'get')).toBe('That code is not valid, or it has expired.');
    expect(sb.botMessage({ status: 400, body: { error: 'bad_code' } }, 'get')).toMatch(/six letters and numbers/);
    expect(sb.botMessage({ status: 400, body: { error: 'not_shareable', message: 'It holds a path.' } }, 'make')).toBe('It holds a path.');
    expect(sb.botMessage({ status: 413 }, 'make')).toMatch(/512 KB/);
    expect(sb.botMessage({ status: 429, retry: 600 }, 'make')).toMatch(/lot of codes.*10 minutes/);
    expect(sb.botMessage({ status: 429, retry: 60 }, 'get')).toMatch(/Too many tries.*1 minute\b/);
    expect(sb.botMessage({ status: 503 }, 'get')).toMatch(/busy/);
    expect(sb.botMessage({ status: 418 }, 'get')).toMatch(/did not accept/);
    expect(sb.botMessage({ status: 400, body: { message: 'x'.repeat(10), token: 'wpms_abc' } }, 'make')).not.toMatch(/wpms_/);
  });

  it('windowsToReload: the window that reads the key, the HUD for HUD keys, the Canvas with either, never the trigger window', () => {
    expect(sb.windowsToReload(['wp:who:zekOnly'])).toEqual(['who', 'canvas']);
    expect(sb.windowsToReload(['wpHudParts:dunmore'])).toEqual(['me', 'canvas']);
    expect(sb.windowsToReload(['wp.damageTabMode', 'chchain_mute']).sort()).toEqual(['canvas', 'chchain', 'hud']);
    expect(sb.windowsToReload([])).toEqual([]);
    const all = sb.windowsToReload(sb.SHARED.map(r => r[0]).concat(['wpHudParts:x']));
    expect(all).not.toContain('trigger');
  });
});

describe('wiring: the same four actions on the tray, Settings and the dashboard, all driving main.js', () => {
  const mimic = (f) => stripJs(fs.readFileSync(path.join(MIMIC, f), 'utf8'));
  const main = mimic('main.js'), preload = mimic('preload.js'), settings = mimic('settings.html');
  const dash = stripJs(readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html')));
  const agentEmbed = stripJs(readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js')));
  const fnBody = (name) => { const a = main.indexOf('function ' + name + '('); expect(a, name).toBeGreaterThan(0); return main.slice(a, main.indexOf('\n}\n', a)); };

  it('the tray has all four, beside the layout export and import', () => {
    for (const [label, fn] of [['Export my whole setup to a file', '_exportSetupFile({})'], ['Get a share code for my whole setup', '_getSetupCode({})'],
      ['Import a whole setup from a file', '_importSetupFile()'], ['Enter a share code', '_enterSetupCode()']]) {
      expect(main, label).toMatch(new RegExp(label + '…[^\\n]*_layoutFileFromTray\\(\\(\\) => ' + fn.replace(/[()]/g, '\\$&').replace('{}', '\\{\\}')));
    }
  });

  it('one IPC each, and the preload bridge names them', () => {
    for (const [ch, fn, bridge] of [['overlay-setup-export', '_exportSetupFile(opts)', 'overlaySetupExport'], ['overlay-setup-code', '_getSetupCode(opts)', 'overlaySetupCode'],
      ['overlay-setup-import', '_importSetupFile()', 'overlaySetupImport'], ['overlay-setup-enter-code', '_enterSetupCode()', 'overlaySetupEnterCode']]) {
      expect(main, ch).toContain("ipcMain.handle('" + ch + "', (" + (fn.includes('opts') ? '_e, opts' : '') + ') => ' + fn + ')');
      expect(preload, bridge).toContain(bridge + ':');
      expect(preload, bridge).toContain("ipcRenderer.invoke('" + ch + "'");
    }
    for (const b of ['setupShareState', 'setupShareLookup', 'setupShareApply', 'setupShareUndo', 'setupShareClose']) expect(preload).toContain(b + ':');
  });

  it('Settings has the four buttons beside the layout ones, and calls the same four bridges', () => {
    for (const id of ['setupExport', 'setupCode', 'setupImport', 'setupEnter']) expect(settings, id).toContain('id="' + id + '"');
    for (const b of ['overlaySetupExport', 'overlaySetupCode', 'overlaySetupImport', 'overlaySetupEnterCode']) expect(settings, b).toContain(b);
    expect(settings).toMatch(/Never included: your sign-in, tokens, EverQuest and log paths, bids or character names/);
  });

  it('the dashboard\'s Overlays tab has the four, and its shipped copy (the agent\'s WEB_HTML) has them too', () => {
    for (const act of ['setupExport', 'setupCode', 'setupImport', 'setupEnter']) {
      expect(dash, act).toContain('data-act="' + act + '"');
      expect(agentEmbed, act).toContain('data-act="' + act + '"');
    }
    for (const b of ['overlaySetupExport', 'overlaySetupCode', 'overlaySetupImport', 'overlaySetupEnterCode']) { expect(dash, b).toContain(b); expect(agentEmbed, b).toContain(b); }
  });

  it('the file halves are file-only: no token, no bot, no network (so the local edition has them as the guild edition does)', () => {
    for (const fn of ['_exportSetupFile', '_importSetupFile', '_collectSetup', '_applySetup', '_undoSetup', '_addSetupLayouts']) {
      const body = fnBody(fn);
      expect(body, fn).not.toMatch(/resolveUploadToken|_botSetupShare|_botBaseUrl|_httpsJson|https?\.request|\bfetch\(|\.token\b|botUrl/);
    }
  });

  it('the sign-in is used in one place: _setupShareAuth builds it, _botSetupShare sends it, nothing else touches it', () => {
    const a = main.indexOf('function _setupShareAuth('), b = main.indexOf('async function _withStorage(');
    const share = main.slice(a, b);
    expect(share.match(/resolveUploadToken/g)).toHaveLength(1);
    const rest = main.slice(main.indexOf('async function _withStorage('), main.indexOf('function _overlaySetTrayItems('));
    expect(rest).not.toMatch(/auth\.token|resolveUploadToken|Bearer/);
    expect(share.match(/Bearer/g)).toHaveLength(1);
    // and nothing in the section writes it to a log, a dialog or a message
    expect(main.slice(a, main.indexOf('function _overlaySetTrayItems(')).match(/appendAgentLog\([^)]*token/gi)).toBeNull();
  });

  it('get-a-code needs a sign-in BEFORE it reads anything or asks anything; enter-a-code before it opens a window', () => {
    const get = fnBody('_getSetupCode'), enter = fnBody('_enterSetupCode');
    expect(get.indexOf('_setupShareAuth()')).toBeGreaterThan(0);
    expect(get.indexOf('_setupShareAuth()')).toBeLessThan(get.indexOf('_collectSetup('));
    expect(enter.indexOf('_setupShareAuth()')).toBeLessThan(enter.indexOf('_openSetupWindow('));
  });

  it('every write to the shared store goes through the readable-key filter; the page is not trusted with a key', () => {
    expect(fnBody('_lsWrite')).toMatch(/readableKey\(k\)/);
    expect(main.slice(main.indexOf('async function _lsRead('), main.indexOf('async function _lsWrite('))).toMatch(/readableKey\(k\)/);
    // the only executeJavaScript calls are the hidden storage page's
    const exec = main.slice(main.indexOf('async function _withStorage('), main.indexOf('function _overlaySetTrayItems(')).match(/executeJavaScript/g) || [];
    expect(exec).toHaveLength(2);
  });

  it('the import window answers only itself, declares skipTaskbar, and its page sets text with textContent only', () => {
    expect(main).toMatch(/new BrowserWindow\(\{[^}]*skipTaskbar: true[^}]*webPreferences: _wpPrefs\('Setup import'\)/s);
    expect(main).toMatch(/new BrowserWindow\(\{ show: false[^}]*skipTaskbar: true[^}]*_wpPrefs\('Setup storage'\)/);
    for (const ch of ['setup-share-state', 'setup-share-lookup', 'setup-share-apply', 'setup-share-undo', 'setup-share-close']) {
      const at = main.indexOf("ipcMain.handle('" + ch + "'");
      expect(at, ch).toBeGreaterThan(0);
      expect(main.slice(at, at + 260), ch).toContain('_fromSetupWindow(e)');
    }
    const page = stripJs(fs.readFileSync(path.join(MIMIC, 'setup-share.html'), 'utf8'));
    expect(page).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
    expect(page).toContain('textContent');
    const storage = fs.readFileSync(path.join(MIMIC, 'storage.html'), 'utf8');
    expect(storage).not.toMatch(/<script/i);
  });

  it('the agent dashboard stays in step with its source (npm run sync:dashboard)', () => {
    expect(agentEmbed).toContain('wpSetupMsg');
  });
});
