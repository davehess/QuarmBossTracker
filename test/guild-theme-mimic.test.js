// test/guild-theme-mimic.test.js — the guild theme served to the overlays, and the designer strips
// (docs/DESIGN-theming.md sections 4 and 5; step 6 of section 7).
//
// Layers:
//   1. utils/theme.js guildThemeFor() runs for real against a stubbed Supabase: the served shape, only themable slots,
//      the 60 s copy, a failed read keeping the last copy, no row = null.
//   2. The bot's poll `theme` stream, the sign-in reply and the agent's side are held as comment-stripped source text
//      plus the real pure functions (the version gate, the agent's cleaner) evaluated from the shipped files.
//   3. preload.js's injection runs for real (sliced): only the themable slots, only six-digit hex, a null theme is
//      empty CSS; and the four copies of the slot list (web, bot, agent, Mimic main, preload) are equal.
//   4. The wiring that cannot be booted here (main.js cache + IPC, the canvas / dashboard / UI Studio strips) is text.
//
// Run: npx vitest run test/guild-theme-mimic.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, stripJs, readSource, sliceBlock, evalBlock, BOT_INDEX, AGENT_INDEX } from './_source-slice.js';
import { THEME_SLOTS as WEB_SLOTS, FONT_KEYS as WEB_FONTS, FIXED_SLOTS } from '../web/lib/guildThemeCore.ts';

const nodeRequire = createRequire(import.meta.url);
const MIMIC = path.join(ROOT, 'apps', 'mimic');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const MEANING = FIXED_SLOTS.map((f) => f.name);   // green red gold orange

const theme = nodeRequire('../utils/theme');
const supabase = nodeRequire('../utils/supabase');
const mimicGuildTheme = nodeRequire('../apps/mimic/guildTheme.js');

const ROW = {
  slots: { bg: '#101820', accent: '#FF8800', text: '#EEEEEE', green: '#00ff00', red: '#ff0000', gold: '#ffff00', purple: 'nope', blue: '#abc' },
  font: 'serif', logo_url: 'https://cdn.example.org/logo.png', embed_color: '#112233', updated_at: '2026-10-31T12:00:00Z',
};

describe('the four copies of the slot list agree', () => {
  const preloadSrc = readSource(path.join(MIMIC, 'preload.js'));
  const preloadSlots = evalBlock(sliceBlock(preloadSrc, 'const _WP_GT_SLOTS', "'purple'];"), ['_WP_GT_SLOTS'])._WP_GT_SLOTS;
  const agentSrc = readSource(AGENT_INDEX);
  const agentSlots = evalBlock(sliceBlock(agentSrc, 'const _GUILD_THEME_SLOTS', "'purple'];"), ['_GUILD_THEME_SLOTS'])._GUILD_THEME_SLOTS;
  it('web, bot, agent, Mimic and preload list the same themable slots, and none is a meaning colour', () => {
    const want = [...WEB_SLOTS].sort();
    for (const list of [theme.THEME_SLOTS, agentSlots, preloadSlots, mimicGuildTheme.SLOTS]) expect([...list].sort()).toEqual(want);
    for (const m of MEANING) expect(want).not.toContain(m);
    expect(MEANING.sort()).toEqual(['gold', 'green', 'orange', 'red']);
  });
  it('the font lists agree', () => {
    expect([...theme.FONT_KEYS].sort()).toEqual([...WEB_FONTS].sort());
    expect([...mimicGuildTheme.FONTS].sort()).toEqual([...WEB_FONTS].sort());
  });
});

describe('guildThemeFor (utils/theme.js)', () => {
  const saved = {};
  beforeEach(() => {
    for (const k of ['isEnabled', 'select']) saved[k] = supabase[k];
    supabase.isEnabled = () => true;
    theme._resetThemesForTest();
  });
  afterEach(() => { for (const k of Object.keys(saved)) supabase[k] = saved[k]; });

  it('serves the shape Mimic expects, only themable slots as lowercase six-digit hex', async () => {
    let q;
    supabase.select = async (t, qs) => { q = [t, qs]; return [ROW]; };
    const t = await theme.guildThemeFor('wolfpack');
    expect(q[0]).toBe('guild_theme');
    expect(q[1]).toContain('guild_id=eq.wolfpack');
    expect(t).toEqual({
      slots: { bg: '#101820', accent: '#ff8800', text: '#eeeeee' },   // purple 'nope' and blue '#abc' dropped
      font: 'serif', logo_url: 'https://cdn.example.org/logo.png', embed_color: '#112233', updated_at: '2026-10-31T12:00:00Z',
    });
    for (const m of MEANING) expect(t.slots).not.toHaveProperty(m);
  });
  it('a guild with no row is null', async () => {
    supabase.select = async () => [];
    expect(await theme.guildThemeFor('nobody')).toBeNull();
  });
  it('is read per guild and copied for a minute', async () => {
    const asked = [];
    supabase.select = async (t, qs) => { asked.push(qs); return [{ slots: { bg: '#000000' } }]; };
    const t0 = Date.now();
    await theme.guildThemeFor('a', t0); await theme.guildThemeFor('a', t0 + 30_000); await theme.guildThemeFor('b', t0);
    expect(asked.length).toBe(2);
    await theme.guildThemeFor('a', t0 + theme.TTL_MS + 5);
    expect(asked.length).toBe(3);
  });
  it('a failed read keeps the last copy, and never rejects', async () => {
    supabase.select = async () => [ROW];
    const first = await theme.guildThemeFor('wolfpack');
    supabase.select = async () => null;
    expect(await theme.guildThemeFor('wolfpack', Date.now() + theme.TTL_MS + 1)).toEqual(first);
    supabase.select = async () => { throw new Error('boom'); };
    expect(await theme.guildThemeFor('wolfpack', Date.now() + 2 * theme.TTL_MS + 2)).toEqual(first);
    theme._resetThemesForTest();
    expect(await theme.guildThemeFor('wolfpack')).toBeNull();
  });
  it('refuses a logo that is not https and a font outside the list', () => {
    const t = theme.shapeTheme({ slots: {}, logo_url: 'http://x.example/a.png', font: 'comic' });
    expect(t.logo_url).toBeNull();
    expect(t.font).toBe('default');
  });
});

describe('the bot: sign-in reply and poll stream (source, comments stripped)', () => {
  const bot = stripJs(readSource(BOT_INDEX));
  const link = stripJs(read('utils', 'mimicLink.js'));
  it('the linked reply carries the theme for a member and for a hub guild, and not for a guest', () => {
    expect(link).toMatch(/hub_role:\s+hubMember\.role,\s*\n\s*theme:\s+await _themeOf\(hub\)/);
    expect(link).toMatch(/role_names:\s+roleNames,\s*\n\s*theme:\s+await _themeOf\(supabase\.guildId\(\)\)/);
    const guest = link.slice(link.indexOf('if (isGuest) {'), link.indexOf('if (hub) {'));
    expect(guest).not.toMatch(/theme/);
    expect(link).toMatch(/guildThemeFor\(guildId\)\s*;?\s*\}\s*catch\s*\{\s*return null/);
  });
  it('the poll serves a `theme` stream from the session\'s guild, version-gated on theme_ver', () => {
    const poll = bot.slice(bot.indexOf('async function _handleAgentPoll'), bot.indexOf('async function _handleAgentRescanDone'));
    expect(poll).toMatch(/_pollStreamDecision\('theme', want, tune, null, null\) === 'send'/);
    expect(poll).toMatch(/guildThemeFor\(identity\.guild_id \|\| /);
    expect(poll).toMatch(/searchParams\.get\('theme_ver'\)/);
    expect(poll).toMatch(/\{ version, unchanged: true \} : \{ version, theme \}/);
  });
  it('a guest never gets the stream, a hub session still does', () => {
    const poll = bot.slice(bot.indexOf('async function _handleAgentPoll'), bot.indexOf('async function _handleAgentRescanDone'));
    expect(poll).toMatch(/const themeWanted = want\.has\('theme'\) && identity\.scope !== 'guest';/);
    const order = ['themeWanted =', "scope === 'guest') want.clear()", 'identity.hub_guild) want.clear()', "if (themeWanted) want.add('theme')"].map((s) => poll.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it('the version gate answers unchanged for a theme the agent already holds', () => {
    const src = readSource(BOT_INDEX);
    const block = sliceBlock(src, 'function _pollStreamDecision(key, want, tune, clientVer, freshVer) {', "  return 'send';\n}");
    const { _pollStreamDecision } = evalBlock(block, ['_pollStreamDecision']);
    const W = new Set(['theme']);
    expect(_pollStreamDecision('theme', W, {}, null, 'v1')).toBe('send');
    expect(_pollStreamDecision('theme', W, {}, 'v1', 'v1')).toBe('unchanged');
    expect(_pollStreamDecision('theme', W, { flag_shed_theme: 1 }, null, 'v1')).toBe('omit');
    expect(_pollStreamDecision('theme', new Set(['tuning']), {}, null, 'v1')).toBe('skip');
  });
});

describe('the agent stores and serves it', () => {
  const src = readSource(AGENT_INDEX);
  const code = stripJs(src);
  const block = sliceBlock(src, 'const _GUILD_THEME_SLOTS', '_guildTheme.theme = _cleanGuildTheme(r.theme);\n}');
  const A = evalBlock(block, ['_guildTheme', '_cleanGuildTheme', '_applyGuildThemeResponse']);

  it('asks every ten minutes, whatever characters it watches, and sends its version cursor', () => {
    expect(code).toMatch(/POLL_THEME_MS\s+=\s+10 \* 60_000/);
    expect(code).toMatch(/now - _pollLast\.theme >= POLL_THEME_MS\) want\.push\('theme'\)/);
    expect(code.indexOf("want.push('theme')")).toBeLessThan(code.indexOf('if (chars.length) {'));
    expect(code).toMatch(/qs\.set\('theme_ver', _guildTheme\.ver \|\| ''\)/);
    expect(code).toMatch(/if \(s\.theme\) _applyGuildThemeResponse\(s\.theme\)/);
  });
  it('serves it on /api/state as `theme`, with themeKnown', () => {
    expect(code).toMatch(/theme:\s+_guildTheme\.theme,/);
    expect(code).toMatch(/themeKnown:\s+!!_guildTheme\.ver,/);
  });
  it('keeps only valid themable slots from an untrusted reply, and clears on a null theme', () => {
    A._applyGuildThemeResponse({ version: 'v1', theme: { slots: { bg: '#0A0B0C', green: '#00ff00', accent: 'red', blue: '#58A6FF' }, font: 'x', logo_url: 'javascript:1' } });
    expect(A._guildTheme.ver).toBe('v1');
    expect(A._guildTheme.theme.slots).toEqual({ bg: '#0a0b0c', blue: '#58a6ff' });
    expect(A._guildTheme.theme.font).toBe('default');
    expect(A._guildTheme.theme.logo_url).toBeNull();
    A._applyGuildThemeResponse({ version: 'v1', unchanged: true });
    expect(A._guildTheme.theme).not.toBeNull();
    A._applyGuildThemeResponse({ version: 'v2', theme: null });
    expect(A._guildTheme.theme).toBeNull();
    expect(A._guildTheme.ver).toBe('v2');
  });
});

describe('Mimic main.js: the cache and the push', () => {
  const main = stripJs(readSource(path.join(MIMIC, 'main.js')));
  it('keeps the last good copy under userData/brand/theme.json and sends it to every window', () => {
    expect(main).toMatch(/path\.join\(app\.getPath\('userData'\), 'brand', 'theme\.json'\)/);
    expect(main).toMatch(/BrowserWindow\.getAllWindows\(\)[\s\S]{0,120}webContents\.send\('wp-guild-theme', next\)/);
    expect(main).toMatch(/ipcMain\.handle\('wp-guild-theme-get'/);
    expect(main).toMatch(/guildTheme\.clean\(/);
  });
  it('takes it from the sign-in reply and the agent state, and drops it at sign-out and a guild switch', () => {
    expect(main).toMatch(/_guildThemeSet\(p\.body\.theme\)/);
    expect(main).toMatch(/if \(s && s\.themeKnown\) _guildThemeSet\(s\.theme\)/);
    const out = main.slice(main.indexOf('async function signOutMimic'), main.indexOf('async function signOutMimic') + 900);
    expect(out).toMatch(/_guildThemeSet\(null\)/);
    const hub = main.slice(main.indexOf('async function setHub'));
    expect(hub.slice(0, 2500)).toMatch(/_guildThemeSet\(null\)/);
  });
  it('the cleaner accepts only themable slots as six-digit hex', () => {
    const c = mimicGuildTheme.clean({ slots: { bg: '#ABCDEF', gold: '#ffffff', red: '#000000', dim: '#12345' }, font: 'sans' });
    expect(c.slots).toEqual({ bg: '#abcdef' });
    expect(mimicGuildTheme.clean(null)).toBeNull();
    expect(mimicGuildTheme.clean('x')).toBeNull();
  });
});

describe('preload.js injection', () => {
  const src = readSource(path.join(MIMIC, 'preload.js'));
  const css = evalBlock(
    sliceBlock(src, 'const _WP_GT_SLOTS', "return out ? ':root{' + out + '}' : '';\n}"),
    ['_wpGuildThemeCss'],
  )._wpGuildThemeCss;
  const code = stripJs(src);

  it('emits :root variables for the themable slots only, with the rgb triplets for bg and panel', () => {
    const out = css({ slots: { bg: '#0D1117', panel: '#161b22', accent: '#FF8800', green: '#00ff00', red: '#ff0000', gold: '#ffff00', orange: '#ffa657', evil: '#123456' } });
    expect(out).toBe(':root{--wp-bg:#0d1117;--wp-bg-rgb:13, 17, 23;--wp-panel:#161b22;--wp-panel-rgb:22, 27, 34;--wp-accent:#ff8800;}');
    for (const m of MEANING) expect(out).not.toContain('--wp-' + m);
    expect(out).not.toContain('evil');
  });
  it('refuses anything that is not a six-digit hex, so nothing can be smuggled into the stylesheet', () => {
    expect(css({ slots: { bg: '#fff', panel: 'red', border: '#12345g', text: 'url(x)', dim: '#0d1117; } body{display:none', accent: 5, blue: null } })).toBe('');
    expect(css({ slots: { bg: '#0d1117;}x{' } })).toBe('');
  });
  it('a null or malformed theme is empty CSS (the style is removed)', () => {
    for (const t of [null, undefined, 'x', 3, {}, { slots: null }, { slots: 'x' }]) expect(css(t)).toBe('');
    expect(code).toMatch(/if \(!css\) \{\s*if \(st\) st\.remove\(\);/);
  });
  it('sits below the raider\'s own look: the filter themes leave the guild class alone and still run on <body>', () => {
    expect(code).toMatch(/c\.indexOf\('wp-theme-'\) === 0 && c !== 'wp-theme-guild'/);
    expect(code).toMatch(/cl\.add\('wp-theme-guild'\)|classList\.add\('wp-theme-guild'\)/);
    expect(code).toMatch(/body\.wp-theme-light\{filter:/);
  });
  it('only pages that load theme.css take it, and it is pulled at load as well as pushed', () => {
    expect(code).toMatch(/link\[rel="stylesheet"\]\[href\$="theme\.css"\]/);
    expect(code).toMatch(/ipcRenderer\.on\('wp-guild-theme'/);
    expect(code).toMatch(/ipcRenderer\.invoke\('wp-guild-theme-get'\)/);
    expect(code).toMatch(/st\.id = 'wp-guild-theme'/);
  });
});

describe('the designer strips', () => {
  const canvas = stripJs(read('apps', 'mimic', 'canvas.html'));
  const dash = stripJs(read('packages', 'wolfpack-logsync', 'dashboard.html'));
  const studio = read('apps', 'mimic', 'ui-studio.html');

  it('canvas: a Guild palette row from the live variables sits above the colour row, and writes the hex', () => {
    expect(canvas).toMatch(/getComputedStyle\(document\.documentElement\)/);
    expect(canvas).toMatch(/getPropertyValue\('--wp-' \+ s\[0\]\)/);
    expect(canvas).toMatch(/<div class="sec">Guild palette<\/div>/);
    expect(canvas.indexOf("guildPaletteHtml(p) + '<div class=\"sec\">Colour</div>")).toBeGreaterThan(0);
    // a pick uses the same data-color path as PALETTE, so it stores the hex, never var(--wp-…)
    expect(canvas).toMatch(/data-color="' \+ c \+ '"[^\n]*title="' \+ s\[1\]/);
    expect(canvas).not.toMatch(/data-color="var\(/);
    // the meaning colours are not offered in the guild row
    const row = canvas.slice(canvas.indexOf('var GUILD_SWATCHES'), canvas.indexOf('function guildPaletteHtml'));
    for (const m of MEANING) expect(row).not.toContain("'" + m + "'");
  });
  it('dashboard: the Overlays look section shows the guild palette, its name and "Your own look sits on top"', () => {
    expect(dash).toMatch(/wp-strip wp-guildpal/);
    expect(dash).toMatch(/id="wpGuildPalName"/);
    expect(dash).toMatch(/Your own look sits on top/);
    expect(dash).toMatch(/s && s\.theme && s\.theme\.slots/);
    expect(dash).toMatch(/st\.hub && st\.hub\.display_name/);
    // it sits after the Look strip and before the next card
    expect(dash.indexOf('wp-strip wp-look')).toBeLessThan(dash.indexOf('wp-strip wp-guildpal'));
    expect(dash.indexOf('wp-strip wp-guildpal')).toBeLessThan(dash.indexOf('#113 Extended Target options') > 0 ? dash.indexOf('#113 Extended Target options') : dash.indexOf('Extended Target options'));
  });
  it('dashboard: the embedded copy matches (npm run check:dashboard)', () => {
    const agent = readSource(AGENT_INDEX);
    expect(agent).toContain('wpGuildPalName');
    expect(agent).toContain('Your own look sits on top');
  });
  it('ui-studio: loads theme.css first, so its chrome reads the same variables', () => {
    expect(studio.indexOf('<link rel="stylesheet" href="theme.css">')).toBeGreaterThan(0);
    expect(studio.indexOf('theme.css')).toBeLessThan(studio.indexOf('<style'));
    expect(studio).toMatch(/var\(--wp-bg\)/);
    expect(studio).toMatch(/var\(--wp-panel\)/);
  });
  it('the overlay checklist hooks are untouched on canvas', () => {
    expect(canvas).toMatch(/id="hide-btn"|data-wp-overlay/);
  });
});
