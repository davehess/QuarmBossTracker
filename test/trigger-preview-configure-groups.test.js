// test/trigger-preview-configure-groups.test.js — the agent dashboard's Triggers tab, 2026-10-18:
//   1. the editor's ▶ Preview speaks the callout (it only flashed the overlay before);
//   2. Suggested and Guild rows each get ▶ Preview and ✎ Configure;
//   3. Guild triggers are folded into labelled groups.
// The shipped code is cut out of dashboard.html and run (no browser in the suite).
//
// Run: npx vitest run test/trigger-preview-configure-groups.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT, AGENT_INDEX } from './_source-slice.js';

const dash = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
const agentSrc = readSource(AGENT_INDEX);

const ESC = sliceBlock(dash, 'function esc(s) {', '\n');

// ── what is said, and what is played ────────────────────────────────────────────────────────────
describe('wpTrigPreviewText / wpTrigPreviewAudio', () => {
  function build() {
    return evalBlock([
      'var plays = [], says = [];',
      'var WPSounds = { play: function (n, v, f) { plays.push({ n: n, v: v, f: f || null }); } };',
      'var window = { _wpVoiceNames: { say: function (t, p) { says.push({ t: t, p: p }); } } };',
      sliceBlock(dash, 'function wpTrigSpeakable(txt) {', '\n}\n'),
      sliceBlock(dash, 'function wpTrigPreviewText(a) {', '\n}\n'),
      sliceBlock(dash, 'function wpTrigPreviewAudio(a) {', '\n}\n'),
    ].join('\n'), ['wpTrigSpeakable', 'wpTrigPreviewText', 'wpTrigPreviewAudio', 'plays', 'says']);
  }

  it('cleans emoji and " - " separators from the overlay text, as the overlay window does', () => {
    const h = build();
    expect(h.wpTrigSpeakable('⚡ D.I. FIRED - Tank saved')).toBe('D.I. FIRED Tank saved');
    expect(h.wpTrigSpeakable('🔥 RAMPAGE — move')).toBe('RAMPAGE move');
    expect(h.wpTrigSpeakable('Aldenmar-Brackwyn')).toBe('Aldenmar-Brackwyn');   // a hyphen inside a word stays
  });

  it('the Spoken text wins; blank falls back to the overlay text; {placeholders} lose their braces', () => {
    const h = build();
    expect(h.wpTrigPreviewText({ text: 'CANCEL ON {target}!', tts: 'cancel now' })).toBe('cancel now');
    expect(h.wpTrigPreviewText({ text: 'CANCEL ON {target}!', tts: '  ' })).toBe('CANCEL ON target!');
    expect(h.wpTrigPreviewText({ text: 'ADD {add_name}', tts: '' })).toBe('ADD add name');
  });

  it('is capped at 300 characters, like Mimic\'s voice engine', () => {
    const h = build();
    expect(h.wpTrigPreviewText({ text: 'x'.repeat(500) })).toHaveLength(300);
  });

  it('speaks through the voice card with the callout\'s own voice pack', () => {
    const h = build();
    const r = h.wpTrigPreviewAudio({ text: 'RAMPAGE', voice_pack: 'drill' });
    expect(h.says).toEqual([{ t: 'RAMPAGE', p: 'drill' }]);
    expect(h.plays).toHaveLength(0);
    expect(r.said).toBe('RAMPAGE');
  });

  it('a sound plays WITH the speech by default', () => {
    const h = build();
    h.wpTrigPreviewAudio({ text: 'RAMPAGE', sound: 'slap', sound_volume: 0.5, sound_mode: 'add' });
    expect(h.says).toHaveLength(1);
    expect(h.plays).toHaveLength(1);
    expect(h.plays[0]).toMatchObject({ n: 'slap', v: 0.5 });
    expect(h.plays[0].f).toBeNull();
  });

  it('"instead of speaking" plays only the sound, and speaks after all if the sound cannot play', () => {
    const h = build();
    h.wpTrigPreviewAudio({ text: 'RAMPAGE', sound: 'slap', sound_mode: 'replace' });
    expect(h.says).toHaveLength(0);
    expect(typeof h.plays[0].f).toBe('function');
    h.plays[0].f();   // the file would not play
    expect(h.says).toEqual([{ t: 'RAMPAGE', p: '' }]);
  });
});

// ── the editor's ▶ Preview ──────────────────────────────────────────────────────────────────────
describe('the editor\'s ▶ Preview', () => {
  function rig(form) {
    const heard = [], posts = [];
    const els = {};
    const el = (id) => (els[id] = els[id] || { id, value: '', checked: false, textContent: '', style: {} });
    Object.entries(form).forEach(([k, v]) => { if (typeof v === 'boolean') el(k).checked = v; else el(k).value = String(v); });
    const document = { getElementById: el };
    const wpTrigPreviewAudio = (a) => { heard.push(a); return { said: a.tts || a.text, sound: a.sound || '', replaced: a.sound_mode === 'replace' }; };
    const soundVolume = () => 0.9;
    const fetch = async (url, opts) => { posts.push({ url, body: JSON.parse(opts.body) }); return { ok: true }; };
    const fn = new Function('document', 'wpTrigPreviewAudio', 'soundVolume', 'fetch',
      sliceBlock(dash, 'async function onPreview() {', '\n  }\n') + '\nreturn onPreview;')(document, wpTrigPreviewAudio, soundVolume, fetch);
    return { run: fn, heard, posts, msg: () => el('trigAddMsg') };
  }

  it('speaks the Spoken text with the chosen voice and sound, and flashes the overlay silently', async () => {
    const r = rig({ trigNewName: 'Mob AE', trigNewOverlay: 'AE!', trigNewTts: 'area effect', trigNewSound: 'slap',
      trigNewSoundReplace: false, trigNewVoicePack: 'drill' });
    await r.run();
    expect(r.heard).toHaveLength(1);
    expect(r.heard[0]).toMatchObject({ text: 'AE!', tts: 'area effect', voice_pack: 'drill', sound: 'slap', sound_mode: 'add' });
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0].body.silent).toBe(true);
    const act = r.posts[0].body.trigger.actions[0];
    expect(act).toMatchObject({ type: 'text_overlay', text: 'AE!', tts: 'area effect' });
    expect(act.sound).toBeUndefined();        // played here, not twice
    expect(act.voice_pack).toBeUndefined();
    expect(r.msg().textContent).toContain('area effect');
  });

  it('"instead of speaking" is passed on, and a blank Overlay text previews the Spoken text', async () => {
    const r = rig({ trigNewName: 'x', trigNewOverlay: '', trigNewTts: 'say me', trigNewSound: 'slap', trigNewSoundReplace: true });
    await r.run();
    expect(r.heard[0].sound_mode).toBe('replace');
    expect(r.posts[0].body.trigger.actions[0].text).toBe('say me');
  });

  it('with nothing to say it does nothing', async () => {
    const r = rig({ trigNewName: 'x' });
    await r.run();
    expect(r.heard).toHaveLength(0);
    expect(r.posts).toHaveLength(0);
  });

  it('the agent mutes the overlay for a silent preview, and a normal Rehearse still speaks', () => {
    const code = stripJs(agentSrc);
    const fire = sliceBlock(code, "if (req.url === '/api/triggers/fire' && req.method === 'POST') {", "if (req.url === '/api/triggers/clear'");
    expect(fire).toMatch(/payload\.silent === true/);
    expect(fire).toMatch(/_activeOverlays\[i\]\.mute = true/);
    expect(fire.indexOf('_rehearseTrigger(')).toBeLessThan(fire.indexOf('payload.silent'));
  });
});

// ── Suggested rows ──────────────────────────────────────────────────────────────────────────────
describe('Suggested rows: ▶ Preview and ✎ Configure', () => {
  const actionsHtml = evalBlock([ESC, sliceBlock(dash, 'function actionsHtml(t){', '\n  }\n')].join('\n'), ['actionsHtml']).actionsHtml;
  const attr = (html, name) => JSON.parse(
    html.match(new RegExp(name + '="([^"]*)"'))[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
  const T = { id: 'x', label: 'Resisted', pattern: '^Your target resisted', overlay_text: 'RESISTED: {spell}', overlay_preview: 'RESISTED: Tashanian',
    overlay_color: 'yellow', overlay_ms: 4000, cooldown_seconds: 3, zeal_condition: null, sound: 'slap', sound_mode: 'add', sound_volume: 0.7 };

  it('Preview carries the filled-in words and the sound; Configure carries every form field', () => {
    const h = actionsHtml(T);
    expect(attr(h, 'data-trig-prev')).toMatchObject({ text: 'RESISTED: Tashanian', sound: 'slap', sound_volume: 0.7, sound_mode: 'add' });
    expect(attr(h, 'data-trig-copy')).toMatchObject({ name: 'Resisted (copy)', pattern: '^Your target resisted', overlay: 'RESISTED: {spell}',
      color: 'yellow', duration_ms: 4000, cooldown_seconds: 3, sound: 'slap', from: 'suggested' });
  });

  it('a timer bar has neither; a catalog-matched alert has Preview but no Configure (no pattern to put in the form)', () => {
    expect(actionsHtml({ ...T, no_tts: true })).not.toContain('data-trig');
    const c = actionsHtml({ ...T, pattern: '', catalog: true });
    expect(c).toContain('data-trig-prev');
    expect(c).not.toContain('data-trig-copy');
  });

  it('the markup has no volatile content: the same row renders the same bytes', () => {
    expect(actionsHtml(T)).toBe(actionsHtml({ ...T }));
  });
});

// ── Guild groups ────────────────────────────────────────────────────────────────────────────────
describe('Guild triggers grouped', () => {
  function build() {
    return evalBlock([
      'var out = null;',
      'var window = { __wpLastState: null };',
      'var document = { getElementById: function () { return { id: "wpGuildTriggers" }; }, querySelectorAll: function () { return []; } };',
      'function morphInto(el, html) { out = html; return true; }',
      ESC,
      sliceBlock(dash, 'var WP_TRIG_ZEAL =', ';\n'),
      'var _wpTrigOpen = {};',
      sliceBlock(dash, 'function wpTrigWarnings(t) {', '\n}\n'),
      sliceBlock(dash, 'function wpTrigSettingsHtml(t, scope) {', '\n}\n'),
      sliceBlock(dash, 'var WPSounds = (function () {', '\n})();\n'),
      sliceBlock(dash, 'function wpSoundOverrideHtml(t, ov) {', '\n}\n'),
      'var _wpOpenDetails = {};',
      sliceBlock(dash, 'function wpKeep(key, defaultOpen) {', '\n}\n'),
      sliceBlock(dash, 'function wpGuildGroupOf(t) {', '\n}\n'),
      sliceBlock(dash, 'function wpGuildCatBadge(cat) {', '\n}\n'),
      // the rows are fetched from /api/guild-triggers and held here, not read off the state (2026-10-20)
      sliceBlock(dash, 'var _wpGt = {', ';\n'),
      sliceBlock(dash, 'function wpGuildTriggersSync(s, el) {', '\n}\n'),
      sliceBlock(dash, 'function renderGuildTriggersCard(s) {', '\n}\n'),
      'function html() { return out; }',
    ].join('\n'), ['renderGuildTriggersCard', 'wpGuildGroupOf', 'html', '_wpOpenDetails', '_wpGt']);
  }

  it('files a trigger by stat card, zone, class, timer tag, buff/debuff tag, then its coarse category', () => {
    const g = build().wpGuildGroupOf;
    expect(g({ name: 'Zarrin — stat card', category: 'callout', rule_group: 'statcards' }).label).toBe('Stat cards');
    expect(g({ category: 'mechanic', rule_group: 'zone:potime', rule_group_label: 'Plane of Time' })).toMatchObject({ label: 'Plane of Time', cat: 'zone' });
    expect(g({ category: 'class', rule_group: 'class' }).label).toBe('Class abilities');
    expect(g({ category: 'mechanic', tags: ['Cooldown Timers'] }).label).toBe('Fight timers');
    expect(g({ category: 'callout', tags: ['Debuffs'] }).label).toBe('Buffs and debuffs');
    expect(g({ category: 'mechanic', tags: [] }).label).toBe('Boss mechanics');
    expect(g({ category: 'callout' }).label).toBe('General callouts');
    expect(g({}).label).toBe('General callouts');
    expect(g({ category: 'rampage' }).label).toBe('Rampage');
  });

  const ROWS = [
    { id: 'g-1', name: 'Rampage on me', category: 'mechanic', pattern: 'rampages', actions: [{ type: 'text_overlay', text: 'RAMPAGE', tts: 'rampage', voice_pack: 'drill', sound: 'slap', sound_mode: 'replace' }] },
    { id: 'g-2', name: 'Chain Lightning', category: 'mechanic', pattern: 'x', rule_group: 'zone:potime', rule_group_label: 'Plane of Time', actions: [] },
    { id: 'g-3', name: 'Zarrin — stat card', category: 'callout', pattern: 'y', rule_group: 'statcards', actions: [] },
    { id: 'g-4', name: 'Other', pattern: 'z', actions: [] },
  ];
  // /api/state carries the count and a revision; the card holds the rows (fetched from /api/guild-triggers)
  const STATE = { guildTriggerCount: 4, guildTriggersRev: '4.abc' };
  const loaded = (rows = ROWS) => { const h = build(); h._wpGt.rows = rows; return h; };

  it('draws one <details> per group, in order, each kept open/closed by wpKeep, with its count', () => {
    const h = loaded();
    h.renderGuildTriggersCard(STATE);
    const out = h.html();
    const sums = [...out.matchAll(/<summary[^>]*>.*?<b>(.*?)<\/b> <span class="dim">\((\d+)\)/g)].map(m => [m[1], m[2]]);
    expect(sums).toEqual([['Plane of Time', '1'], ['Stat cards', '1'], ['Boss mechanics', '1'], ['General callouts', '1']]);
    expect((out.match(/<details /g) || [])).toHaveLength(4);
    expect((out.match(/<details data-keep="gtrig\|/g) || [])).toHaveLength(4);   // every one through wpKeep
    expect(out).toContain('<table');
  });

  it('a long list starts folded, a short one open, and a choice the user made is kept', () => {
    const h = loaded();
    h.renderGuildTriggersCard(STATE);
    expect(h.html()).toMatch(/<details data-keep="gtrig\|cat:mechanic" open/);   // 4 triggers: open
    h._wpGt.rows = Array.from({ length: 20 }, (_, i) => ({ id: 'm' + i, name: 'M' + i, category: 'mechanic', pattern: 'p', actions: [] }));
    h.renderGuildTriggersCard(STATE);
    expect(h.html()).not.toMatch(/<details[^>]* open/);
    h._wpOpenDetails['gtrig|cat:mechanic'] = true;
    h.renderGuildTriggersCard(STATE);
    expect(h.html()).toMatch(/<details data-keep="gtrig\|cat:mechanic" open/);
  });

  it('every row has ▶ Preview (what it says and plays) and ✎ Configure (the whole form, voice and spoken text included)', () => {
    const h = loaded();
    h.renderGuildTriggersCard(STATE);
    const out = h.html();
    expect((out.match(/data-trig-prev=/g) || [])).toHaveLength(4);
    expect((out.match(/data-trig-copy=/g) || [])).toHaveLength(4);
    const dec = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const prev = JSON.parse(dec(out.match(/data-trig-prev="([^"]*)"/g).map(x => x.slice(16, -1)).find(x => dec(x).includes('RAMPAGE'))));
    expect(prev).toMatchObject({ text: 'RAMPAGE', tts: 'rampage', voice_pack: 'drill', sound: 'slap', sound_mode: 'replace' });
    const copy = JSON.parse(dec(out.match(/data-trig-copy="([^"]*)"/g).map(x => x.slice(16, -1)).find(x => dec(x).includes('Rampage on me'))));
    expect(copy).toMatchObject({ name: 'Rampage on me (copy)', overlay: 'RAMPAGE', tts: 'rampage', voice_pack: 'drill', sound: 'slap', sound_mode: 'replace' });
  });

  it('this PC\'s own sound for a row is what Preview plays', () => {
    const h = loaded();
    h.renderGuildTriggersCard({ ...STATE, soundOverrides: { 'g-1': { sound: 'bell', sound_mode: 'add' } } });
    expect(h.html()).toContain('&quot;sound&quot;:&quot;bell&quot;');
  });
});

// ── The form takes a copy whole ─────────────────────────────────────────────────────────────────
describe('prefill', () => {
  it('fills the spoken text and the voice, and gives a colour the dropdown lacks an option', () => {
    const code = stripJs(dash);
    const pre = sliceBlock(code, 'function prefill(cfg) {', '\n  }');
    expect(pre).toMatch(/set\('trigNewTts',\s+cfg\.tts \|\| ''\)/);
    expect(pre).toMatch(/setSoundFields\(cfg\.sound, cfg\.sound_volume, cfg\.sound_mode === 'replace', cfg\.voice_pack \|\| ''\)/);
    expect(pre).toMatch(/setVal\('trigNewColor'/);
  });
});
