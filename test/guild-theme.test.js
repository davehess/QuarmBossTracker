// test/guild-theme.test.js — the guild theme (docs/DESIGN-theming.md sections 2, 4, 5; step 5 of section 7).
//
// Four layers:
//   1. web/lib/guildThemeCore.ts runs for real: validation, hex -> triplet, which slots are emitted, defaults.
//   2. web/lib/guildTheme.ts runs for real with a scripted Supabase client: the scoped read, the 60 s copy,
//      the fall-back to today's values.
//   3. utils/theme.js (the bot's embedColor) runs for real with utils/supabase.js's functions swapped.
//   4. The wiring that cannot be booted here (the migration, the officer gate on the page and its actions, the
//      layout, the page-meta entry) is held as TEXT with comments stripped, because the comments in these files
//      explain the rule and would satisfy a match on their own.
//
// Run: npx vitest run test/guild-theme.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, stripJs, stripSql, BOT_INDEX } from './_source-slice.js';
import {
  THEME_SLOTS, DEFAULT_SLOTS, DEFAULT_THEME, DEFAULT_EMBED_COLOR, FONT_KEYS, MIN_TEXT_CONTRAST,
  hexToTriplet, normalizeHex, contrastRatio, validLogoUrl, validateThemeInput, normalizeStoredTheme,
  themeToCssVars, themeToCssVarMap, themeToRow,
} from '../web/lib/guildThemeCore.ts';
import { metaForPath } from '../web/lib/pageMeta.ts';

// guildTheme.ts reads through the service client; it deliberately uses no React cache() (the root test run, like CI,
// has no web/node_modules), so nothing React-shaped is mocked here.
const db = vi.hoisted(() => ({ row: null, error: null, throws: false, calls: [] }));
vi.mock('../web/lib/supabase.ts', () => ({
  supabaseAdmin: () => ({
    from: (table) => ({
      select: (cols) => ({
        eq: (col, val) => ({
          maybeSingle: async () => {
            db.calls.push({ table, cols, col, val });
            if (db.throws) throw new Error('db down');
            return { data: db.error ? null : db.row, error: db.error };
          },
        }),
      }),
    }),
  }),
}));

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const js = (...p) => stripJs(read(...p));

// DESIGN-theming.md section 2, spelled out. If a default moves, this list and the seed move with it.
const SECTION_2 = {
  bg: '#0d1117', panel: '#161b22', border: '#30363d', text: '#c9d1d9',
  dim: '#6e7681', accent: '#1f6feb', blue: '#58a6ff', purple: '#a371f7',
};

describe('defaults', () => {
  it('equal the section 2 table, slot for slot', () => {
    expect(DEFAULT_SLOTS).toEqual(SECTION_2);
    expect([...THEME_SLOTS].sort()).toEqual(Object.keys(SECTION_2).sort());
    expect(DEFAULT_EMBED_COLOR).toBe('#5865f2');
    expect(DEFAULT_THEME.font).toBe('default');
    expect(DEFAULT_THEME.logoUrl).toBeNull();
  });

  it('are what a missing or corrupt row normalizes to', () => {
    expect(normalizeStoredTheme(null)).toEqual(DEFAULT_THEME);
    expect(normalizeStoredTheme({ slots: 'junk', font: 7, logo_url: 5, embed_color: [] })).toEqual(DEFAULT_THEME);
  });

  it('a default theme passes its own validation unchanged', () => {
    const v = validateThemeInput({ slots: DEFAULT_SLOTS, logoUrl: '', font: 'default', embedColor: DEFAULT_EMBED_COLOR });
    expect(v.ok).toBe(true);
    expect(v.theme).toEqual(DEFAULT_THEME);
  });
});

describe('hex -> triplet', () => {
  it('converts to the space-separated channels rgb(var(--wp-x) / <alpha>) needs', () => {
    expect(hexToTriplet('#0d1117')).toBe('13 17 23');
    expect(hexToTriplet('#1F6FEB')).toBe('31 111 235');
    expect(hexToTriplet('ffffff')).toBe('255 255 255');
    expect(hexToTriplet('#000000')).toBe('0 0 0');
  });
  it('refuses anything that is not six hex digits', () => {
    for (const bad of ['#fff', '#12345g', 'red', 'rgb(1,2,3)', '#1234567', '', null, undefined, 12]) {
      expect(hexToTriplet(bad), String(bad)).toBeNull();
      expect(normalizeHex(bad), String(bad)).toBeNull();
    }
  });
  it('normalizes case and a missing #', () => {
    expect(normalizeHex('1F6FEB')).toBe('#1f6feb');
    expect(normalizeHex('  #ABCDEF ')).toBe('#abcdef');
  });
});

describe('validation (what an officer typed)', () => {
  const good = { slots: { accent: '#ff8800' }, logoUrl: 'https://cdn.example.org/logo.png', font: 'sans', embedColor: '#112233' };

  it('accepts a good theme and fills the rest with today\'s values', () => {
    const v = validateThemeInput(good);
    expect(v.ok).toBe(true);
    expect(v.theme.slots.accent).toBe('#ff8800');
    expect(v.theme.slots.bg).toBe(DEFAULT_SLOTS.bg);
    expect(v.theme.logoUrl).toBe(good.logoUrl);
    expect(v.theme.font).toBe('sans');
    expect(v.theme.embedColor).toBe('#112233');
  });

  it('refuses a bad hex and names the slot', () => {
    for (const bad of ['#fff', 'blue', '#12345g', 'rgb(0,0,0)', '#1234567']) {
      const v = validateThemeInput({ slots: { panel: bad } });
      expect(v.ok, bad).toBe(false);
      expect(v.errors.panel, bad).toBeTruthy();
    }
  });

  it('refuses a bad Discord embed colour', () => {
    const v = validateThemeInput({ embedColor: 'blurple' });
    expect(v.ok).toBe(false);
    expect(v.errors.embedColor).toBeTruthy();
  });

  it('refuses a logo that is not an https address', () => {
    for (const bad of ['http://cdn.example.org/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'ftp://x/a.png',
      '//cdn.example.org/a.png', 'cdn.example.org/a.png', 'https://x.org/a")b', "https://x.org/a'b", 'https://x.org/a b.png',
      'https://x.org/a(b).png', `https://x.org/${'a'.repeat(600)}`]) {
      const v = validateThemeInput({ logoUrl: bad });
      expect(v.ok, bad).toBe(false);
      expect(v.errors.logoUrl, bad).toBeTruthy();
      expect(validLogoUrl(bad), bad).toBeNull();
    }
    expect(validLogoUrl('https://cdn.example.org/a.png')).toBe('https://cdn.example.org/a.png');
  });

  it('refuses a font that is not on the list, and takes every font that is', () => {
    for (const bad of ['Comic Sans MS', 'arial', "x'; } body { display:none", 42]) {
      const v = validateThemeInput({ font: bad });
      expect(v.ok, String(bad)).toBe(false);
      expect(v.errors.font, String(bad)).toBeTruthy();
    }
    for (const k of FONT_KEYS) expect(validateThemeInput({ font: k }).ok, k).toBe(true);
  });

  it('refuses a slot that is not themable: the meaning colours are fixed', () => {
    for (const name of ['green', 'red', 'gold', 'orange', 'nonsense']) {
      const v = validateThemeInput({ slots: { [name]: '#123456' } });
      expect(v.ok, name).toBe(false);
      expect(v.errors.slots, name).toContain(name);
    }
  });

  it('refuses text that cannot be read on the background', () => {
    const v = validateThemeInput({ slots: { bg: '#101010', text: '#151515' } });
    expect(v.ok).toBe(false);
    expect(v.errors.text).toBeTruthy();
    expect(contrastRatio(DEFAULT_SLOTS.text, DEFAULT_SLOTS.bg)).toBeGreaterThan(MIN_TEXT_CONTRAST * 3);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('nope', '#ffffff')).toBe(0);
  });

  it('treats garbage input as "nothing chosen", not a crash', () => {
    for (const junk of [null, undefined, 'x', 7, [], { slots: 'x' }]) {
      expect(validateThemeInput(junk).ok).toBe(true);
    }
  });
});

describe('stored rows (lenient: one bad field never blanks the site)', () => {
  it('keeps the good fields and defaults the bad ones', () => {
    const t = normalizeStoredTheme({
      slots: { bg: '#000000', panel: 'garbage', accent: '#AA00FF' },
      logo_url: 'http://insecure.example.org/a.png', font: 'wingdings', embed_color: '#00ff00',
    });
    expect(t.slots.bg).toBe('#000000');
    expect(t.slots.panel).toBe(DEFAULT_SLOTS.panel);
    expect(t.slots.accent).toBe('#aa00ff');
    expect(t.logoUrl).toBeNull();
    expect(t.font).toBe('default');
    expect(t.embedColor).toBe('#00ff00');
  });

  it('will not serve text that is unreadable on the background, whatever a hand-written row says', () => {
    const t = normalizeStoredTheme({ slots: { bg: '#202020', text: '#222222' } });
    expect(contrastRatio(t.slots.text, t.slots.bg)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it('round-trips through the row shape', () => {
    const v = validateThemeInput({ slots: { accent: '#ff8800' }, font: 'serif', embedColor: '#112233' });
    expect(normalizeStoredTheme(themeToRow(v.theme))).toEqual(v.theme);
  });
});

describe('CSS variables', () => {
  const FIXED = ['green', 'red', 'gold', 'orange'];

  it('emit only the themable slots, as --wp-<slot>: r g b;', () => {
    const map = themeToCssVarMap(DEFAULT_THEME);
    for (const s of THEME_SLOTS) expect(map[`--wp-${s}`], s).toBe(hexToTriplet(DEFAULT_SLOTS[s]));
    for (const f of FIXED) expect(map[`--wp-${f}`], f).toBeUndefined();
    expect(Object.keys(map).filter(k => /^--wp-(bg|panel|border|text|dim|accent|blue|purple)$/.test(k))).toHaveLength(THEME_SLOTS.length);
    expect(themeToCssVars(DEFAULT_THEME)).toContain('--wp-bg: 13 17 23;');
  });

  it('emit nothing for the defaults when asked for changes only, so pages stay byte-identical', () => {
    expect(themeToCssVarMap(DEFAULT_THEME, { changedOnly: true })).toEqual({});
    expect(themeToCssVars(DEFAULT_THEME, { changedOnly: true })).toBe('');
  });

  it('emit just the slot that moved', () => {
    const t = validateThemeInput({ slots: { accent: '#ff8800' } }).theme;
    expect(themeToCssVarMap(t, { changedOnly: true })).toEqual({ '--wp-accent': '255 136 0' });
  });

  it('add the font stacks only for a non-default font, and the logo only when set', () => {
    const t = validateThemeInput({ font: 'serif', logoUrl: 'https://cdn.example.org/a.png' }).theme;
    const m = themeToCssVarMap(t, { changedOnly: true });
    expect(m['--wp-font-mono']).toMatch(/Georgia/);
    expect(m['--wp-font-ui']).toMatch(/Georgia/);
    expect(m['--wp-logo']).toBe('url("https://cdn.example.org/a.png")');
    expect(themeToCssVarMap(DEFAULT_THEME)['--wp-logo']).toBeUndefined();
  });

  it('never carry a value that could break out of a declaration', () => {
    for (const font of FONT_KEYS) {
      const css = themeToCssVars({ ...DEFAULT_THEME, font });
      expect(css, font).not.toMatch(/[<>{}]|;\s*;/);
    }
  });
});

describe('loadGuildTheme (the layout\'s read)', () => {
  beforeEach(() => { db.row = null; db.error = null; db.throws = false; db.calls = []; vi.resetModules(); });
  afterEach(() => { vi.useRealTimers(); });
  const mod = () => import('../web/lib/guildTheme.ts');

  it('reads one scoped row, only the columns it needs', async () => {
    db.row = { slots: { accent: '#ff8800' }, logo_url: null, font: 'sans', embed_color: '#112233' };
    const { loadGuildTheme } = await mod();
    const t = await loadGuildTheme('wolfpack');
    expect(t.slots.accent).toBe('#ff8800');
    expect(t.font).toBe('sans');
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]).toMatchObject({ table: 'guild_theme', col: 'guild_id', val: 'wolfpack' });
    expect(db.calls[0].cols).toBe('slots, logo_url, font, embed_color');
  });

  it('serves the copy for 60 s, then reads again', async () => {
    vi.useFakeTimers();
    db.row = { slots: {}, font: 'default' };
    const { loadGuildTheme } = await mod();
    await loadGuildTheme('wolfpack'); await loadGuildTheme('wolfpack');
    expect(db.calls).toHaveLength(1);
    vi.advanceTimersByTime(61_000);
    await loadGuildTheme('wolfpack');
    expect(db.calls).toHaveLength(2);
  });

  it('no row means today\'s values', async () => {
    const { loadGuildTheme } = await mod();
    expect(await loadGuildTheme('wolfpack')).toEqual(DEFAULT_THEME);
  });

  it('a failed read on a cold start serves today\'s values; on a warm one it keeps the last good theme', async () => {
    vi.useFakeTimers();
    db.throws = true;
    const { loadGuildTheme, forgetGuildTheme } = await mod();
    expect(await loadGuildTheme('wolfpack')).toEqual(DEFAULT_THEME);

    forgetGuildTheme('wolfpack');
    db.throws = false;
    db.row = { slots: { accent: '#ff8800' }, font: 'default' };
    expect((await loadGuildTheme('wolfpack')).slots.accent).toBe('#ff8800');
    vi.advanceTimersByTime(61_000);
    db.error = { message: 'boom' };
    expect((await loadGuildTheme('wolfpack')).slots.accent).toBe('#ff8800');
  });

  it('forgetGuildTheme makes the next read hit the table', async () => {
    db.row = { slots: {}, font: 'default' };
    const { loadGuildTheme, forgetGuildTheme } = await mod();
    await loadGuildTheme('wolfpack');
    forgetGuildTheme('wolfpack');
    await loadGuildTheme('wolfpack');
    expect(db.calls).toHaveLength(2);
  });
});

describe('migration 20261031170000_guild_theme.sql', () => {
  const raw = read('supabase', 'migrations', '20261031170000_guild_theme.sql');
  const sql = stripSql(raw);

  it('creates the table idempotently with the columns the design names', () => {
    expect(sql).toMatch(/create table if not exists public\.guild_theme/i);
    for (const col of [/guild_id\s+text primary key default 'wolfpack'/i, /slots\s+jsonb not null default '\{\}'/i,
      /logo_url\s+text/i, /font\s+text/i, /embed_color\s+text/i, /updated_at\s+timestamptz default now\(\)/i, /updated_by\s+text/i]) {
      expect(sql).toMatch(col);
    }
    expect(sql).not.toMatch(/drop table/i);
  });

  it('is service-role only: RLS on, nothing granted to anon or authenticated, no policy', () => {
    expect(sql).toMatch(/alter table public\.guild_theme enable row level security/i);
    expect(sql).toMatch(/revoke all on public\.guild_theme from anon, authenticated/i);
    expect(sql).toMatch(/grant all on public\.guild_theme to service_role/i);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/grant\s+(select|all)[^;]*to\s+(anon|authenticated)/i);
  });

  it('seeds the wolfpack row with today\'s values, and never overwrites an edited one', () => {
    expect(sql).toMatch(/insert into public\.guild_theme/i);
    expect(sql).toMatch(/on conflict \(guild_id\) do nothing/i);
    const seed = JSON.parse(sql.match(/'(\{"bg":[^']+\})'::jsonb/)[1]);
    expect(seed).toEqual(DEFAULT_SLOTS);
    expect(sql).toMatch(/'#5865f2'/);
  });

  it('is on the guild-scope table list', () => {
    const tables = JSON.parse(read('scripts', 'guild-tables.json')).tables;
    expect(tables).toContain('guild_theme');
    expect(tables).toEqual([...tables].sort());
  });
});

describe('/admin/theme wiring', () => {
  const page = js('web', 'app', 'admin', 'theme', 'page.tsx');
  const actions = js('web', 'app', 'admin', 'theme', 'actions.ts');
  const editor = js('web', 'app', 'admin', 'theme', 'ThemeEditor.tsx');
  const layout = js('web', 'app', 'layout.tsx');

  it('the page is officer-gated before it loads anything', () => {
    const gate = page.indexOf('await requireOfficer()');
    const load = page.indexOf('readGuildTheme(');
    expect(gate).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(gate);
    expect(page).toMatch(/export const dynamic = 'force-dynamic'/);
    expect(page).toMatch(/<NewPageTag/);
    expect(page).toMatch(/title: '\[beta\] Guild theme · Admin'/);
  });

  it('every action starts at requireOfficer, validates, scopes the write and audits it', () => {
    expect(actions.startsWith("'use server'")).toBe(true);
    for (const fn of ['saveGuildTheme', 'resetGuildTheme']) {
      const body = actions.slice(actions.indexOf(`export async function ${fn}`));
      expect(body.slice(0, 200), fn).toMatch(/await requireOfficer\(\)/);
    }
    expect(actions).toMatch(/validateThemeInput\(input\)/);
    expect(actions).toMatch(/from\('guild_theme'\)\s*\.upsert\(\{\s*guild_id:\s*GUILD_TAG/);
    expect(actions).toMatch(/updated_by:\s*actor\.discordId/);
    expect(actions).toMatch(/action:\s*'guild_theme_updated'/);
    expect(actions).toMatch(/\.eq\('guild_id', GUILD_TAG\)/);
  });

  it('the editor imports the pure module, not the server one', () => {
    expect(editor).toMatch(/from '@\/lib\/guildThemeCore'/);
    expect(editor).not.toMatch(/from '@\/lib\/guildTheme'/);
    expect(editor).not.toMatch(/\/lib\/supabase/);
  });

  it('the preview styles itself from the --wp-* variables, not from Tailwind\'s hard-coded colours', () => {
    expect(editor).toMatch(/rgb\(var\(--wp-\$\{slot\}\)\)/);
    expect(editor).toMatch(/themeToCssVarMap\(live\)/);
  });

  it('the root layout emits only what changed, from the cached read, and adds no new dynamic API', () => {
    expect(layout).toMatch(/loadGuildTheme\(GUILD_TAG\)/);
    expect(layout).toMatch(/themeToCssVarMap\(theme, \{ changedOnly: true \}\)/);
    expect(layout).toMatch(/data-theme=\{themed \? 'guild' : undefined\}/);
    // The layout was already per-request (session + host); the theme read must not add a dynamic API of its own,
    // nor pin the layout static, which would freeze the theme at build time.
    expect(layout).not.toMatch(/cookies\(\)/);
    expect(layout).not.toMatch(/export const dynamic\s*=\s*'force-static'/);
  });

  it('has a page-meta entry, so a Discord unfurl names the page', () => {
    const m = metaForPath('/admin/theme');
    expect(m.title).toBe('[beta] Guild theme · Admin');
    expect(m.description).toBeTruthy();
    expect(js('web', 'lib', 'pageMeta.ts')).toMatch(/'\/admin\/theme':\s+'\[beta\] Guild theme'/);
  });

  it('is linked from the officer tools index', () => {
    expect(js('web', 'app', 'admin', 'page.tsx')).toMatch(/href="\/admin\/theme"/);
  });
});

// ── The bot ─────────────────────────────────────────────────────────────────

const nodeRequire = createRequire(BOT_INDEX);
const supabase = nodeRequire('./utils/supabase');
const theme = nodeRequire('./utils/theme');

describe('utils/theme.js embedColor()', () => {
  const saved = {};
  beforeEach(() => {
    for (const k of ['isEnabled', 'select']) saved[k] = supabase[k];
    supabase.isEnabled = () => true;
    theme._setForTest(null);
  });
  afterEach(() => {
    for (const k of Object.keys(saved)) supabase[k] = saved[k];
    theme._setForTest(null);
  });

  it('is blurple until the guild chooses', () => {
    expect(theme.DEFAULT_COLOR).toBe(0x5865F2);
    supabase.select = async () => [];
    expect(theme.embedColor(1_000_000)).toBe(0x5865F2);
  });

  it('parses hex strings and numbers, and nothing else', () => {
    expect(theme.parseColor('#5865f2')).toBe(0x5865F2);
    expect(theme.parseColor('FF8800')).toBe(0xFF8800);
    expect(theme.parseColor(0x112233)).toBe(0x112233);
    for (const bad of ['#fff', 'blurple', '#12345g', -1, 0x1000000, 1.5, null, undefined, {}]) {
      expect(theme.parseColor(bad), String(bad)).toBeNull();
    }
  });

  it('refresh reads this guild\'s embed_color only', async () => {
    let q = null;
    supabase.select = async (t, qs) => { q = [t, qs]; return [{ embed_color: '#ff8800' }]; };
    expect(await theme.refresh()).toBe(true);
    expect(q[0]).toBe('guild_theme');
    expect(q[1]).toMatch(/^select=embed_color&guild_id=eq\.[^&]+&limit=1$/);
    expect(theme.embedColor(Date.now())).toBe(0xFF8800);
  });

  it('answers at once and refreshes in the background once the copy is older than a minute', async () => {
    let calls = 0;
    supabase.select = async () => { calls++; return [{ embed_color: '#00ff00' }]; };
    const t0 = 5_000_000;
    expect(theme.embedColor(t0)).toBe(0x5865F2);        // first call: nothing cached yet, answers the default
    expect(theme.embedColor(t0 + 10)).toBe(0x5865F2);   // a refresh is already in flight: no second one
    expect(calls).toBe(1);
    await new Promise(r => setImmediate(r));
    expect(theme.embedColor(t0 + 30_000)).toBe(0x00FF00);   // fresh enough: served from the copy
    expect(calls).toBe(1);
    theme.embedColor(t0 + theme.TTL_MS + 1);               // stale: serves the old colour, starts a read
    expect(calls).toBe(2);
  });

  it('keeps the last colour when the read fails or throws', async () => {
    theme._setForTest(0xABCDEF);
    supabase.select = async () => null;
    expect(await theme.refresh()).toBe(false);
    expect(theme.embedColor(Date.now())).toBe(0xABCDEF);
    supabase.select = async () => { throw new Error('boom'); };
    expect(await theme.refresh()).toBe(false);
    expect(theme.embedColor(Date.now())).toBe(0xABCDEF);
  });

  it('a row with an unusable colour reverts to blurple rather than keeping a stale one', async () => {
    theme._setForTest(0xABCDEF);
    supabase.select = async () => [{ embed_color: 'not a colour' }];
    await theme.refresh();
    expect(theme.embedColor(Date.now())).toBe(0x5865F2);
  });

  it('does nothing when Supabase is not configured', async () => {
    supabase.isEnabled = () => false;
    expect(await theme.refresh()).toBe(false);
  });
});
