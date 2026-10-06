// test/raid-screen.test.js — /screen, the raid screen the raid leader drives (the guild lead's option B, 2026-10-06).
//
// What can go wrong without anyone noticing:
//   * a member (not an officer) changes what the whole raid is looking at;
//   * a slide index points past the deck, or the deck changes under it, and the screen shows nothing;
//   * a slide carries something that is not plain text, or a picture address that is not https;
//   * a poll that fails reads as "nothing happened tonight" instead of "this did not load".
// These tests drive the real helpers in web/lib/raidScreen.ts and the real route handlers (against an
// in-memory database that applies the filters, so a wrong filter shows), not their text. The few text checks
// (the officer guard on every write, the page, the nav, the migration) strip comments first, so a comment
// that names the guard cannot satisfy them.
//
// Run: npx vitest run test/raid-screen.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs, stripSql } from './_source-slice.js';
import {
  SCREEN_MODES, MODE_LABEL, TITLE_MAX, BODY_MAX, IMAGE_URL_MAX, SLIDES_MAX, TONIGHT_H, FEED_CACHE_MS,
  isScreenMode, clampSlideIndex, parseStateInput, parseSlideInput, parseImageUrl, moveId, parseSlideBody,
  agoText, untilText, sinceIso, buildScreenState, buildAwards, groupLooted, summarizeRaid, isUuid,
} from '../web/lib/raidScreen.ts';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const NOW = Date.parse('2026-10-06T01:30:00Z');
const ago = (s) => new Date(NOW - s * 1000).toISOString();
const ahead = (s) => new Date(NOW + s * 1000).toISOString();

// ── Modes and the slide index ────────────────────────────────────────────────

describe('modes', () => {
  it('are exactly Map, Slides, Loot and Overview, each with a label', () => {
    expect([...SCREEN_MODES]).toEqual(['map', 'slides', 'loot', 'overview']);
    expect(MODE_LABEL).toEqual({ map: 'Map', slides: 'Slides', loot: 'Loot', overview: 'Overview' });
  });

  it('isScreenMode takes only the four exact lowercase words', () => {
    for (const m of SCREEN_MODES) expect(isScreenMode(m)).toBe(true);
    for (const bad of ['Map', 'maps', '', ' map', null, undefined, 1, {}, ['map']]) expect(isScreenMode(bad)).toBe(false);
  });
});

describe('clampSlideIndex', () => {
  it('keeps an index inside the deck', () => {
    expect(clampSlideIndex(1, 3)).toBe(1);
    expect(clampSlideIndex(2, 3)).toBe(2);
    expect(clampSlideIndex(3, 3)).toBe(2);
    expect(clampSlideIndex(99, 3)).toBe(2);
    expect(clampSlideIndex(-4, 3)).toBe(0);
  });
  it('is 0 for an empty deck and for anything that is not a number', () => {
    expect(clampSlideIndex(5, 0)).toBe(0);
    expect(clampSlideIndex(0, 0)).toBe(0);
    for (const bad of [NaN, Infinity, '2', null, undefined, {}]) expect(clampSlideIndex(bad, 5), String(bad)).toBe(0);
  });
  it('drops a fraction', () => {
    expect(clampSlideIndex(1.9, 5)).toBe(1);
  });
});

describe('parseStateInput: what an officer may send', () => {
  const ok = (body, n = 3) => parseStateInput(body, n);

  it('takes a mode, a slide index, or both', () => {
    expect(ok({ mode: 'loot' })).toEqual({ ok: true, value: { mode: 'loot' } });
    expect(ok({ slideIndex: 2 })).toEqual({ ok: true, value: { slideIndex: 2 } });
    expect(ok({ mode: 'slides', slideIndex: 0 })).toEqual({ ok: true, value: { mode: 'slides', slideIndex: 0 } });
  });
  it('refuses a body with neither, or that is not an object', () => {
    for (const bad of [{}, { other: 1 }, null, undefined, 'map', 5, [], [{ mode: 'map' }]]) expect(ok(bad).ok).toBe(false);
  });
  it('refuses a mode that is not one of the four', () => {
    for (const mode of ['Map', 'maps', '', null, 3]) expect(ok({ mode }).ok).toBe(false);
  });
  it('refuses an index outside the deck instead of clamping it', () => {
    expect(ok({ slideIndex: 3 }, 3).ok).toBe(false);
    expect(ok({ slideIndex: -1 }).ok).toBe(false);
    expect(ok({ slideIndex: 2 }, 3).ok).toBe(true);
  });
  it('refuses an index that is not a whole number', () => {
    for (const slideIndex of [1.5, '1', null, NaN, Infinity, [1]]) expect(ok({ slideIndex }).ok).toBe(false);
  });
  it('only index 0 exists in an empty deck', () => {
    expect(ok({ slideIndex: 0 }, 0).ok).toBe(true);
    expect(ok({ slideIndex: 1 }, 0).ok).toBe(false);
  });
  it('says which part is wrong', () => {
    expect(ok({ mode: 'x' }).error).toMatch(/mode/);
    expect(ok({ slideIndex: 9 }).error).toMatch(/slideIndex/);
  });
});

// ── Slide input ──────────────────────────────────────────────────────────────

describe('parseSlideInput', () => {
  const good = { title: '  Pull order  ', body: 'Tanks first.\r\n\r\n- MT\n- OT\r\n', imageUrl: 'https://example.com/plan.png' };

  it('trims, normalises line endings and returns the three fields', () => {
    const r = parseSlideInput(good);
    expect(r).toEqual({ ok: true, value: { title: 'Pull order', body: 'Tanks first.\n\n- MT\n- OT', imageUrl: 'https://example.com/plan.png' } });
  });
  it('carries the id of a slide being edited, and only a real slide id', () => {
    const id = '0b7a5c1e-5d3a-4f7e-9d3a-6c2b1a9e8f10';
    expect(parseSlideInput({ ...good, id }).value.id).toBe(id);
    expect(parseSlideInput({ ...good, id: 'abc' }).ok).toBe(false);
    expect(parseSlideInput({ ...good, id: 7 }).ok).toBe(false);
    expect('id' in parseSlideInput(good).value).toBe(false);
  });
  it('needs a title, at most TITLE_MAX characters', () => {
    expect(parseSlideInput({ ...good, title: '' }).ok).toBe(false);
    expect(parseSlideInput({ ...good, title: '   ' }).ok).toBe(false);
    expect(parseSlideInput({ ...good, title: undefined }).ok).toBe(false);
    expect(parseSlideInput({ ...good, title: 7 }).ok).toBe(false);
    expect(parseSlideInput({ ...good, title: 'x'.repeat(TITLE_MAX) }).ok).toBe(true);
    expect(parseSlideInput({ ...good, title: 'x'.repeat(TITLE_MAX + 1) }).ok).toBe(false);
    expect(TITLE_MAX).toBe(120);
  });
  it('allows an empty body, at most BODY_MAX characters', () => {
    expect(parseSlideInput({ title: 'T' }).value.body).toBe('');
    expect(parseSlideInput({ title: 'T', body: null }).value.body).toBe('');
    expect(parseSlideInput({ title: 'T', body: 'x'.repeat(BODY_MAX) }).ok).toBe(true);
    expect(parseSlideInput({ title: 'T', body: 'x'.repeat(BODY_MAX + 1) }).ok).toBe(false);
    expect(parseSlideInput({ title: 'T', body: 5 }).ok).toBe(false);
    expect(BODY_MAX).toBe(2000);
  });
  it('is not a JSON object: refused', () => {
    for (const bad of [null, undefined, 'x', 3, []]) expect(parseSlideInput(bad).ok).toBe(false);
  });
});

describe('parseImageUrl: https only', () => {
  it('takes an https address, blank as none', () => {
    expect(parseImageUrl('https://cdn.example.com/a/b.png?x=1')).toEqual({ ok: true, value: 'https://cdn.example.com/a/b.png?x=1' });
    for (const none of [undefined, null, '', '   ']) expect(parseImageUrl(none)).toEqual({ ok: true, value: null });
  });
  it('refuses anything that is not https', () => {
    for (const bad of [
      'http://example.com/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'ftp://example.com/a.png',
      '//example.com/a.png', 'example.com/a.png', '/relative.png', 'file:///etc/passwd',
    ]) expect(parseImageUrl(bad).ok, bad).toBe(false);
  });
  it('refuses a login in the address, a space, a non-string and a long address', () => {
    expect(parseImageUrl('https://user:pw@example.com/a.png').ok).toBe(false);
    expect(parseImageUrl('https://example.com/a b.png').ok).toBe(false);
    expect(parseImageUrl(12).ok).toBe(false);
    expect(parseImageUrl('https://example.com/' + 'a'.repeat(IMAGE_URL_MAX)).ok).toBe(false);
  });
});

describe('moveId', () => {
  const ids = ['a', 'b', 'c'];
  it('swaps a slide with its neighbour and leaves the input alone', () => {
    expect(moveId(ids, 'b', 'up')).toEqual(['b', 'a', 'c']);
    expect(moveId(ids, 'b', 'down')).toEqual(['a', 'c', 'b']);
    expect(ids).toEqual(['a', 'b', 'c']);
  });
  it('is null at either end and for an id that is not there', () => {
    expect(moveId(ids, 'a', 'up')).toBeNull();
    expect(moveId(ids, 'c', 'down')).toBeNull();
    expect(moveId(ids, 'z', 'up')).toBeNull();
  });
});

describe('parseSlideBody: paragraphs and bullets, nothing else', () => {
  it('splits paragraphs on blank lines and keeps a paragraph\'s own line breaks', () => {
    expect(parseSlideBody('One\ntwo\n\nThree')).toEqual([
      { kind: 'p', text: 'One\ntwo' }, { kind: 'p', text: 'Three' },
    ]);
  });
  it('reads "- " and "* " lines as one list, even straight after a paragraph', () => {
    expect(parseSlideBody('Tanks:\n- Aldenmar\n* Brackwyn\n\nHealers\n- Corvale')).toEqual([
      { kind: 'p', text: 'Tanks:' },
      { kind: 'ul', items: ['Aldenmar', 'Brackwyn'] },
      { kind: 'p', text: 'Healers' },
      { kind: 'ul', items: ['Corvale'] },
    ]);
  });
  it('does not turn a dash inside a line, or markup, into anything: it stays text', () => {
    expect(parseSlideBody('a - b\n-c\n<b>bold</b> **x**')).toEqual([{ kind: 'p', text: 'a - b\n-c\n<b>bold</b> **x**' }]);
  });
  it('is empty for an empty body', () => {
    expect(parseSlideBody('')).toEqual([]);
    expect(parseSlideBody('\n\n  \n')).toEqual([]);
  });
});

// ── State shape ──────────────────────────────────────────────────────────────

describe('buildScreenState', () => {
  const slide = { id: 's1', position: 1, title: 'T', body: 'b', imageUrl: null, updatedAt: null };

  it('a screen nobody has driven is the Map, at slide 0, driven by nobody', () => {
    expect(buildScreenState(null, 0, null)).toEqual({ mode: 'map', slideIndex: 0, slide: null, slideCount: 0, updatedBy: null, updatedAt: null });
  });
  it('carries who drove it and when', () => {
    const s = buildScreenState({ mode: 'loot', slide_index: 0, updated_by: 'Rethlan', updated_at: ago(30) }, 3, slide);
    expect(s).toMatchObject({ mode: 'loot', updatedBy: 'Rethlan', updatedAt: ago(30), slideCount: 3 });
  });
  it('shows the slide only in Slides mode', () => {
    expect(buildScreenState({ mode: 'slides', slide_index: 1 }, 3, slide).slide).toBe(slide);
    expect(buildScreenState({ mode: 'loot', slide_index: 1 }, 3, slide).slide).toBeNull();
  });
  it('clamps an index the deck no longer reaches (the last slide was deleted while it was up)', () => {
    expect(buildScreenState({ mode: 'slides', slide_index: 5 }, 3, slide).slideIndex).toBe(2);
    expect(buildScreenState({ mode: 'slides', slide_index: 5 }, 0, null).slideIndex).toBe(0);
  });
  it('a mode this build does not know falls back to the Map', () => {
    expect(buildScreenState({ mode: 'tactics' }, 3, slide).mode).toBe('map');
  });
});

// ── Times ────────────────────────────────────────────────────────────────────

describe('agoText and untilText', () => {
  it('say how long ago', () => {
    expect(agoText(ago(2), NOW)).toBe('just now');
    expect(agoText(ago(12), NOW)).toBe('12 s ago');
    expect(agoText(ago(180), NOW)).toBe('3 min ago');
    expect(agoText(ago(7300), NOW)).toBe('2 h ago');
    expect(agoText(ahead(60), NOW)).toBe('just now');   // a clock a little ahead is not "-1 s ago"
    expect(agoText(null, NOW)).toBe('');
    expect(agoText('not a date', NOW)).toBe('');
  });
  it('say how long to go', () => {
    expect(untilText(ahead(10), NOW)).toBe('now');
    expect(untilText(ago(100), NOW)).toBe('now');
    expect(untilText(ahead(11 * 60), NOW)).toBe('11m');
    expect(untilText(ahead(3 * 3600 + 5 * 60), NOW)).toBe('3h 05m');
    expect(untilText(null, NOW)).toBe('');
  });
  it('"tonight" is the last six hours', () => {
    expect(TONIGHT_H).toBe(6);
    expect(sinceIso(NOW)).toBe(new Date(NOW - 6 * 3600_000).toISOString());
  });
});

// ── Loot ─────────────────────────────────────────────────────────────────────

describe('buildAwards', () => {
  const rows = [
    { auction_id: 1, item_name: 'Valor-Sworn Cloak', winner: 'acct_login_1', bid_amount: 40, end_at: ago(600) },
    { auction_id: 2, item_name: "Aerin`Dar's Greaves", winner: 'acct_login_2', bid_amount: 55, end_at: ago(60) },
    { auction_id: 3, item_name: 'Unwanted Spear', winner: null, bid_amount: null, end_at: ago(300) },
    { auction_id: 4, item_name: 'Bidding Now', winner: 'acct_login_4', bid_amount: 10, end_at: ahead(90) },
    { auction_id: 5, item_name: 'Not Bid On Yet', winner: null, bid_amount: null, end_at: ahead(30) },
    { auction_id: 6, item_name: null, winner: 'acct_login_6', bid_amount: 5, end_at: ago(10) },
  ];
  const names = [{ auction_id: 1, character_name: 'Aldenmar' }, { auction_id: 4, character_name: 'Brackwyn' }];
  const out = buildAwards(rows, names, NOW);

  it('names the character when the view knows it, else the bidder login', () => {
    expect(out.find(a => a.id === 1).who).toBe('Aldenmar');
    expect(out.find(a => a.id === 2).who).toBe('acct_login_2');
    expect(out.find(a => a.id === 4).who).toBe('Brackwyn');
  });
  it('drops a closed auction nobody won, and a row with no item; keeps an open one with no bid', () => {
    expect(out.map(a => a.id).sort()).toEqual([1, 2, 4, 5]);
    expect(out.find(a => a.id === 5)).toMatchObject({ who: null, open: true });
  });
  it('lists open auctions first (closing soonest first), then closed ones newest first', () => {
    expect(out.map(a => a.id)).toEqual([5, 4, 2, 1]);
    expect(out.filter(a => a.open).map(a => a.id)).toEqual([5, 4]);
  });
  it('keeps the DKP', () => {
    expect(out.find(a => a.id === 2).dkp).toBe(55);
  });
});

describe('groupLooted', () => {
  const rows = [
    { looter_character: 'Nyssara', item_name: 'Strand of Ether', looted_at: ago(100) },
    { looter_character: 'Corvale', item_name: 'strand of ether', looted_at: ago(50) },
    { looter_character: 'Nyssara', item_name: 'Strand of Ether', looted_at: ago(20) },
    { looter_character: 'Aldenmar', item_name: 'Valor-Sworn Cloak', looted_at: ago(5) },
    { looter_character: null, item_name: null, looted_at: ago(1) },
  ];
  it('folds by item (any case), counts, names each looter once, newest item first', () => {
    const g = groupLooted(rows);
    expect(g.map(x => x.item)).toEqual(['Valor-Sworn Cloak', 'Strand of Ether']);
    expect(g[1]).toMatchObject({ count: 3, who: ['Nyssara', 'Corvale'] });   // the newest looter first
    expect(g[1].at).toBe(ago(20));
  });
  it('stops at the limit', () => {
    expect(groupLooted(rows, 1)).toHaveLength(1);
  });
});

describe('summarizeRaid', () => {
  const r = (name, cls, group, zone) => ({ name, cls, group, level: 60, hp: 100, x: 0, y: 0, z: 0, heading: 0, zone, age_s: 1 });
  const out = summarizeRaid(
    [r('Aldenmar', 'Warrior', 1, 'poair'), r('Brackwyn', 'Cleric', 1, 'poair'), r('Corvale', 'cleric', 2, 'poair'),
      r('Rethlan', 'Bard', null, 'poair'), r('Zarrin', 'Wizard', 3, 'potime')],
    [{ zone: 'poair', name: 'Plane of Air', count: 4 }, { zone: 'potime', name: 'Plane of Time', count: 1 }],
  );
  it('puts the busiest zone first with its long name', () => {
    expect(out.map(z => [z.name, z.count])).toEqual([['Plane of Air', 4], ['Plane of Time', 1]]);
  });
  it('counts classes (any spelling) and groups, ungrouped last', () => {
    expect(out[0].classes.map(c => [c.abbr, c.count])).toEqual([['CLR', 2], ['BRD', 1], ['WAR', 1]]);
    expect(out[0].groups).toEqual([{ group: 1, count: 2 }, { group: 2, count: 1 }, { group: null, count: 1 }]);
  });
});

it('isUuid takes a UUID and nothing else', () => {
  expect(isUuid('0b7a5c1e-5d3a-4f7e-9d3a-6c2b1a9e8f10')).toBe(true);
  for (const bad of ['', 'abc', 7, null, '0b7a5c1e5d3a4f7e9d3a6c2b1a9e8f10', "0b7a5c1e-5d3a-4f7e-9d3a-6c2b1a9e8f10'; drop"]) expect(isUuid(bad)).toBe(false);
});

// ── The routes ───────────────────────────────────────────────────────────────

// An in-memory PostgREST: it applies eq / gt / gte / lte / in / is / not-is filters, order, limit and
// maybeSingle, and runs update / insert / upsert / delete, so a wrong filter or a missing guard shows.
const st = vi.hoisted(() => ({ user: null, officers: new Set(), tables: {}, calls: [], fail: new Set() }));

function run(q) {
  st.calls.push({ table: q.table, kind: q.kind, ops: q.ops });
  if (st.fail.has(q.table)) return { data: null, error: { message: 'boom' } };
  const rows = (st.tables[q.table] ??= []);
  const hit = () => rows.filter(r => q.preds.every(p => p(r)));
  if (q.kind === 'update') { for (const r of hit()) Object.assign(r, q.payload); return { data: null, error: null }; }
  if (q.kind === 'delete') {
    const gone = new Set(hit());
    st.tables[q.table] = rows.filter(r => !gone.has(r));
    return { data: null, error: null };
  }
  if (q.kind === 'insert') {
    for (const p of [].concat(q.payload)) rows.push({ id: globalThis.crypto.randomUUID(), ...p });
    return { data: null, error: null };
  }
  if (q.kind === 'upsert') {
    const key = q.opts?.onConflict;
    const cur = rows.find(r => r[key] === q.payload[key]);
    if (cur) Object.assign(cur, q.payload); else rows.push({ ...q.payload });
    return { data: null, error: null };
  }
  let out = hit();
  for (const [c, asc] of [...q.ord].reverse()) {
    out = [...out].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1));
  }
  if (q.lim != null) out = out.slice(0, q.lim);
  return { data: q.one ? (out[0] ?? null) : out, error: null };
}

function query(table) {
  const q = { table, kind: 'select', ops: [], preds: [], ord: [], lim: null, one: false, payload: null, opts: null };
  const api = {};
  const op = (name, fn) => { api[name] = (...a) => { q.ops.push([name, ...a]); fn?.(...a); return api; }; };
  op('select');
  op('eq', (c, v) => q.preds.push(r => r[c] === v));
  op('gt', (c, v) => q.preds.push(r => r[c] > v));
  op('gte', (c, v) => q.preds.push(r => r[c] >= v));
  op('lte', (c, v) => q.preds.push(r => r[c] <= v));
  op('in', (c, vs) => q.preds.push(r => vs.includes(r[c])));
  op('is', (c, v) => q.preds.push(r => (r[c] ?? null) === v));
  op('not', (c, o, v) => { if (o !== 'is') throw new Error('fake: not() supports is only'); q.preds.push(r => (r[c] ?? null) !== v); });
  op('order', (c, o = {}) => q.ord.push([c, o.ascending !== false]));
  op('limit', n => { q.lim = n; });
  op('maybeSingle', () => { q.one = true; });
  op('update', p => { q.kind = 'update'; q.payload = p; });
  op('insert', p => { q.kind = 'insert'; q.payload = p; });
  op('upsert', (p, o) => { q.kind = 'upsert'; q.payload = p; q.opts = o; });
  op('delete', () => { q.kind = 'delete'; });
  api.then = (ok, bad) => Promise.resolve(run(q)).then(ok, bad);
  return api;
}

vi.mock('@/lib/supabase-server', () => ({
  supabaseServer: () => ({ auth: { getUser: async () => ({ data: { user: st.user } }) } }),
}));
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: () => ({ from: query }) }));
vi.mock('@/lib/officer', () => ({ isOfficer: async (id) => st.officers.has(id) }));
vi.mock('@/lib/raidScreen', async () => await import('../web/lib/raidScreen.ts'));
vi.mock('@/lib/raidScreenServer', async () => await import('../web/lib/raidScreenServer.ts'));
vi.mock('@/lib/spectator', async () => await import('../web/lib/spectator.ts'));
vi.mock('@/lib/bossFilter', async () => await import('../web/lib/bossFilter.ts'));
vi.mock('@/lib/format', async () => await import('../web/lib/format.ts'));
// CI installs the root packages only, so `next/server` (web/node_modules) does not resolve there; the routes
// only need NextResponse.json, which is a plain Response.
vi.mock('next/server', () => ({
  NextResponse: {
    json: (body, init = {}) => new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json', ...(init.headers || {}) },
    }),
  },
}));

const MEMBER = { id: 'member-1', user_metadata: {} };
const OFFICER = { id: 'officer-1', user_metadata: {} };
const post = (body) => new Request('http://x/api', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
const del = (id) => new Request('http://x/api/screen/slides' + (id === undefined ? '' : `?id=${id}`), { method: 'DELETE' });
const writes = () => st.calls.filter(c => c.kind !== 'select');

const slideRow = (n, over = {}) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`, guild_id: 'wolfpack', position: n - 1,
  title: `Slide ${n}`, body: `Body ${n}`, image_url: null, updated_at: ago(500), ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  st.user = null; st.officers = new Set(['officer-1']); st.calls = []; st.fail = new Set();
  st.tables = {
    wolfpack_members: [{ user_id: 'officer-1', discord_id: '111', nickname: 'Rethlan', global_name: 'rethlan_g' }],
    raid_screen_state: [],
    raid_screen_slides: [],
  };
});
afterEach(() => { vi.useRealTimers(); });

describe('GET /api/screen/state', () => {
  it('is members only: no session, 401, and nothing is read', async () => {
    const { GET } = await import('../web/app/api/screen/state/route.ts');
    const res = await GET();
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(st.calls).toEqual([]);
  });

  it('a screen nobody has driven is the Map', async () => {
    st.user = MEMBER;
    const { GET } = await import('../web/app/api/screen/state/route.ts');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ mode: 'map', slideIndex: 0, slide: null, slideCount: 0, updatedBy: null, updatedAt: null });
  });

  it('in Slides mode it carries the slide at the index, the deck size and who is driving', async () => {
    st.user = MEMBER;
    st.tables.raid_screen_slides = [slideRow(3), slideRow(1), slideRow(2)];     // stored out of order
    st.tables.raid_screen_state = [{ guild_id: 'wolfpack', mode: 'slides', slide_index: 1, updated_by: 'Rethlan', updated_at: ago(30) }];
    const { GET } = await import('../web/app/api/screen/state/route.ts');
    const body = await (await GET()).json();
    expect(body).toMatchObject({ mode: 'slides', slideIndex: 1, slideCount: 3, updatedBy: 'Rethlan', updatedAt: ago(30) });
    expect(body.slide).toMatchObject({ title: 'Slide 2', body: 'Body 2', imageUrl: null });
  });

  it('pulls an index the deck no longer reaches back to the last slide', async () => {
    st.user = MEMBER;
    st.tables.raid_screen_slides = [slideRow(1), slideRow(2)];
    st.tables.raid_screen_state = [{ guild_id: 'wolfpack', mode: 'slides', slide_index: 7 }];
    const { GET } = await import('../web/app/api/screen/state/route.ts');
    const body = await (await GET()).json();
    expect(body.slideIndex).toBe(1);
    expect(body.slide.title).toBe('Slide 2');
  });

  it('outside Slides mode it sends no slide (a Map screen does not ship a slide body to everyone)', async () => {
    st.user = MEMBER;
    st.tables.raid_screen_slides = [slideRow(1)];
    st.tables.raid_screen_state = [{ guild_id: 'wolfpack', mode: 'loot', slide_index: 0 }];
    const { GET } = await import('../web/app/api/screen/state/route.ts');
    const body = await (await GET()).json();
    expect(body).toMatchObject({ mode: 'loot', slide: null, slideCount: 1 });
    expect(st.calls.filter(c => c.table === 'raid_screen_slides' && c.ops.some(o => o[0] === 'maybeSingle'))).toEqual([]);
  });

  it('a read that fails is a 502, not an empty screen', async () => {
    st.user = MEMBER;
    st.fail.add('raid_screen_state');
    const { GET } = await import('../web/app/api/screen/state/route.ts');
    expect((await GET()).status).toBe(502);
  });
});

describe('POST /api/screen/state: officers only', () => {
  beforeEach(() => { st.tables.raid_screen_slides = [slideRow(1), slideRow(2), slideRow(3)]; });

  it('refuses no session (401) and a member who is not an officer (403), and writes nothing', async () => {
    const { POST } = await import('../web/app/api/screen/state/route.ts');
    expect((await POST(post({ mode: 'loot' }))).status).toBe(401);
    st.user = MEMBER;
    expect((await POST(post({ mode: 'loot' }))).status).toBe(403);
    expect(writes()).toEqual([]);
    expect(st.tables.raid_screen_state).toEqual([]);
  });

  it('an officer sets the mode, stamped with the nickname and the user id, and gets the new state back', async () => {
    st.user = OFFICER;
    const { POST } = await import('../web/app/api/screen/state/route.ts');
    const res = await POST(post({ mode: 'loot' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(st.tables.raid_screen_state).toEqual([{
      guild_id: 'wolfpack', mode: 'loot', updated_by: 'Rethlan', updated_by_id: 'officer-1', updated_at: new Date(NOW).toISOString(),
    }]);
    expect(await res.json()).toMatchObject({ mode: 'loot', updatedBy: 'Rethlan' });
  });

  it('sending only a slide index leaves the mode alone', async () => {
    st.user = OFFICER;
    st.tables.raid_screen_state = [{ guild_id: 'wolfpack', mode: 'slides', slide_index: 0 }];
    const { POST } = await import('../web/app/api/screen/state/route.ts');
    const body = await (await POST(post({ slideIndex: 2 }))).json();
    expect(st.tables.raid_screen_state[0]).toMatchObject({ mode: 'slides', slide_index: 2 });
    expect(body).toMatchObject({ mode: 'slides', slideIndex: 2 });
    expect(body.slide.title).toBe('Slide 3');
    const payload = st.calls.find(c => c.kind === 'upsert');
    expect(payload.ops.find(o => o[0] === 'upsert')[1]).not.toHaveProperty('mode');
  });

  it('refuses a bad mode, a slide index past the deck, and a body that is not JSON (400), writing nothing', async () => {
    st.user = OFFICER;
    const { POST } = await import('../web/app/api/screen/state/route.ts');
    for (const bad of [{ mode: 'maps' }, { slideIndex: 3 }, { slideIndex: -1 }, {}, 'not json {']) {
      expect((await POST(post(bad))).status, JSON.stringify(bad)).toBe(400);
    }
    expect(writes()).toEqual([]);
  });

  it('names the driver by global name, then by Discord id, then "An officer"', async () => {
    const { POST } = await import('../web/app/api/screen/state/route.ts');
    st.user = OFFICER;
    st.tables.wolfpack_members = [{ user_id: 'officer-1', discord_id: '111', nickname: null, global_name: 'rethlan_g' }];
    await POST(post({ mode: 'map' }));
    expect(st.tables.raid_screen_state[0].updated_by).toBe('rethlan_g');

    st.user = { id: 'officer-1', user_metadata: { provider_id: '222' } };
    st.tables.wolfpack_members = [{ user_id: null, discord_id: '222', nickname: 'Brackwyn', global_name: null }];
    await POST(post({ mode: 'map' }));
    expect(st.tables.raid_screen_state[0].updated_by).toBe('Brackwyn');

    st.tables.wolfpack_members = [];
    await POST(post({ mode: 'map' }));
    expect(st.tables.raid_screen_state[0].updated_by).toBe('An officer');
  });
});

describe('/api/screen/slides', () => {
  it('GET: members only, the deck in position order', async () => {
    const { GET } = await import('../web/app/api/screen/slides/route.ts');
    expect((await GET()).status).toBe(401);
    st.user = MEMBER;
    st.tables.raid_screen_slides = [slideRow(2), slideRow(3), slideRow(1)];
    const res = await GET();
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await res.json()).slides.map(s => s.title)).toEqual(['Slide 1', 'Slide 2', 'Slide 3']);
  });

  it('every write is refused to a non-officer (403) and writes nothing', async () => {
    const { POST, DELETE } = await import('../web/app/api/screen/slides/route.ts');
    st.tables.raid_screen_slides = [slideRow(1)];
    st.user = MEMBER;
    expect((await POST(post({ title: 'X' }))).status).toBe(403);
    expect((await POST(post({ action: 'move', id: slideRow(1).id, dir: 'down' }))).status).toBe(403);
    expect((await DELETE(del(slideRow(1).id))).status).toBe(403);
    st.user = null;
    expect((await POST(post({ title: 'X' }))).status).toBe(401);
    expect((await DELETE(del(slideRow(1).id))).status).toBe(401);
    expect(writes()).toEqual([]);
    expect(st.tables.raid_screen_slides).toHaveLength(1);
  });

  it('POST adds a slide at the end', async () => {
    st.user = OFFICER;
    st.tables.raid_screen_slides = [slideRow(1), slideRow(2)];
    const { POST } = await import('../web/app/api/screen/slides/route.ts');
    const res = await POST(post({ title: ' Plan ', body: '- one', imageUrl: 'https://example.com/p.png' }));
    expect(res.status).toBe(200);
    const { slides } = await res.json();
    expect(slides.map(s => [s.position, s.title])).toEqual([[0, 'Slide 1'], [1, 'Slide 2'], [2, 'Plan']]);
    expect(slides[2]).toMatchObject({ body: '- one', imageUrl: 'https://example.com/p.png' });
    expect(st.tables.raid_screen_slides[2]).toMatchObject({ guild_id: 'wolfpack', image_url: 'https://example.com/p.png' });
  });

  it('POST edits the slide named by id, keeping its place, and 404s an id that is not in the deck', async () => {
    st.user = OFFICER;
    st.tables.raid_screen_slides = [slideRow(1), slideRow(2)];
    const { POST } = await import('../web/app/api/screen/slides/route.ts');
    const { slides } = await (await POST(post({ id: slideRow(2).id, title: 'Renamed', body: 'New', imageUrl: '' }))).json();
    expect(slides.map(s => s.title)).toEqual(['Slide 1', 'Renamed']);
    expect(slides[1]).toMatchObject({ body: 'New', imageUrl: null, position: 1 });
    expect((await POST(post({ id: '00000000-0000-4000-8000-0000000000ff', title: 'X' }))).status).toBe(404);
  });

  it('POST refuses bad input (400) and writes nothing: no title, a long title, a long body, an http picture', async () => {
    st.user = OFFICER;
    const { POST } = await import('../web/app/api/screen/slides/route.ts');
    for (const bad of [
      { title: '' }, { title: 'x'.repeat(TITLE_MAX + 1) }, { title: 'T', body: 'x'.repeat(BODY_MAX + 1) },
      { title: 'T', imageUrl: 'http://example.com/a.png' }, { title: 'T', imageUrl: 'javascript:alert(1)' }, 'not json {',
    ]) expect((await POST(post(bad))).status, JSON.stringify(bad)).toBe(400);
    expect(writes()).toEqual([]);
  });

  it('POST refuses a slide past the cap', async () => {
    st.user = OFFICER;
    st.tables.raid_screen_slides = Array.from({ length: SLIDES_MAX }, (_, i) => slideRow(i + 1, { id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}` }));
    const { POST } = await import('../web/app/api/screen/slides/route.ts');
    expect((await POST(post({ title: 'One too many' }))).status).toBe(400);
    expect(st.tables.raid_screen_slides).toHaveLength(SLIDES_MAX);
  });

  it('POST move swaps a slide with its neighbour and renumbers; the first cannot go up', async () => {
    st.user = OFFICER;
    st.tables.raid_screen_slides = [slideRow(1), slideRow(2), slideRow(3)];
    const { POST } = await import('../web/app/api/screen/slides/route.ts');
    const { slides } = await (await POST(post({ action: 'move', id: slideRow(3).id, dir: 'up' }))).json();
    expect(slides.map(s => [s.position, s.title])).toEqual([[0, 'Slide 1'], [1, 'Slide 3'], [2, 'Slide 2']]);
    expect((await POST(post({ action: 'move', id: slideRow(1).id, dir: 'up' }))).status).toBe(400);
    expect((await POST(post({ action: 'move', id: slideRow(1).id, dir: 'sideways' }))).status).toBe(400);
    expect((await POST(post({ action: 'move', id: 'nope', dir: 'up' }))).status).toBe(400);
  });

  it('DELETE removes the slide, closes the gap, and pulls the screen back inside the deck', async () => {
    st.user = OFFICER;
    st.tables.raid_screen_slides = [slideRow(1), slideRow(2), slideRow(3)];
    st.tables.raid_screen_state = [{ guild_id: 'wolfpack', mode: 'slides', slide_index: 2, updated_by: 'Rethlan' }];
    const { DELETE } = await import('../web/app/api/screen/slides/route.ts');
    const res = await DELETE(del(slideRow(3).id));
    expect(res.status).toBe(200);
    expect((await res.json()).slides.map(s => s.title)).toEqual(['Slide 1', 'Slide 2']);
    expect(st.tables.raid_screen_state[0]).toMatchObject({ slide_index: 1, updated_by: 'Rethlan' });
  });

  it('DELETE of a middle slide renumbers the rest and leaves the screen index alone', async () => {
    st.user = OFFICER;
    st.tables.raid_screen_slides = [slideRow(1), slideRow(2), slideRow(3)];
    st.tables.raid_screen_state = [{ guild_id: 'wolfpack', mode: 'slides', slide_index: 0 }];
    const { DELETE } = await import('../web/app/api/screen/slides/route.ts');
    const { slides } = await (await DELETE(del(slideRow(2).id))).json();
    expect(slides.map(s => [s.position, s.title])).toEqual([[0, 'Slide 1'], [1, 'Slide 3']]);
    expect(st.tables.raid_screen_state[0].slide_index).toBe(0);
  });

  it('DELETE refuses a missing or malformed id and an unknown slide', async () => {
    st.user = OFFICER;
    st.tables.raid_screen_slides = [slideRow(1)];
    const { DELETE } = await import('../web/app/api/screen/slides/route.ts');
    expect((await DELETE(del(undefined))).status).toBe(400);
    expect((await DELETE(del('1;drop table x'))).status).toBe(400);
    expect((await DELETE(del('00000000-0000-4000-8000-0000000000ff'))).status).toBe(404);
    expect(st.tables.raid_screen_slides).toHaveLength(1);
  });
});

describe('GET /api/screen/feed', () => {
  const fixture = () => {
    st.user = MEMBER;
    st.tables.bosses_local = [
      { npc_id: 100, auto_registered: false }, { npc_id: 101, auto_registered: false }, { npc_id: 999, auto_registered: true },
    ];
    st.tables.encounters = [
      { id: 'e1', npc_id: 100, started_at: ago(3600), ended_at: ago(3500), duration_sec: 100, classification: null, total_damage: 5000, eqemu_npc_types: { name: '#Aerin_Dar' } },
      { id: 'e2', npc_id: 999, started_at: ago(600), ended_at: ago(560), duration_sec: 40, classification: null, total_damage: 100, eqemu_npc_types: { name: 'a_jord_kjal' } },   // trash, not curated
      { id: 'e3', npc_id: 101, started_at: ago(300), ended_at: null, duration_sec: null, classification: null, total_damage: 100, eqemu_npc_types: { name: 'Valbrand' } },        // not ended
      { id: 'e4', npc_id: 101, started_at: ago(200), ended_at: ago(100), duration_sec: 90, classification: 'wipe', total_damage: 900, eqemu_npc_types: { name: 'Valbrand' } },     // classified out
      { id: 'e5', npc_id: 101, started_at: ago(7 * 3600), ended_at: ago(7 * 3600 - 60), duration_sec: 60, classification: null, total_damage: 900, eqemu_npc_types: { name: 'Old_Kill' } },   // not tonight
      { id: 'e6', npc_id: 101, started_at: ago(900), ended_at: ago(840), duration_sec: 60, classification: null, total_damage: 0, eqemu_npc_types: { name: 'Empty' } },   // no damage
      { id: 'e7', npc_id: 101, started_at: ago(1200), ended_at: ago(1100), duration_sec: 100, classification: null, total_damage: 8000, eqemu_npc_types: { name: 'Valbrand' } },
    ];
    st.tables.opendkp_auctions = [
      { auction_id: 1, item_name: 'Valor-Sworn Cloak', winner: 'acct_1', bid_amount: 40, end_at: ago(900) },
      { auction_id: 2, item_name: 'Old Helm', winner: 'acct_2', bid_amount: 10, end_at: ago(8 * 3600) },
      { auction_id: 3, item_name: 'Open Ring', winner: 'acct_3', bid_amount: 5, end_at: ahead(100) },
    ];
    st.tables.opendkp_loot_recent = [{ auction_id: 1, character_name: 'Aldenmar' }];
    st.tables.looted_items = [
      { guild_id: 'wolfpack', looter_character: 'Nyssara', item_name: 'Strand of Ether', looted_at: ago(60) },
      { guild_id: 'wolfpack', looter_character: 'Corvale', item_name: 'Strand of Ether', looted_at: ago(30) },
      { guild_id: 'wolfpack', looter_character: 'Nyssara', item_name: 'Old Thing', looted_at: ago(9 * 3600) },
    ];
    st.tables.bot_boards = [
      { boss_id: 'b1', name: 'Soon_Boss', zone: 'Plane of Air', next_spawn: ahead(3 * 3600) },
      { boss_id: 'b2', name: 'Far_Boss', zone: 'Plane of Time', next_spawn: ahead(30 * 3600) },
      { boss_id: 'b3', name: 'Just_Opened', zone: 'Plane of Earth', next_spawn: ago(120) },
      { boss_id: 'b4', name: 'Long_Open', zone: 'Plane of Fire', next_spawn: ago(5 * 86400) },
    ];
  };
  const route = async () => {
    vi.resetModules();   // the feed is cached per module instance
    return (await import('../web/app/api/screen/feed/route.ts')).GET;
  };

  it('is members only: no session, 401, nothing read', async () => {
    const GET = await route();
    expect((await GET()).status).toBe(401);
    expect(st.calls).toEqual([]);
  });

  it('answers tonight\'s awards, loot, kills and the next spawns, and nothing older or farther', async () => {
    fixture();
    const GET = await route();
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.partial).toBe(false);
    // Awards: the open one first, the closed one with the character's name; the 8-hour-old one is out.
    expect(body.awards.map(a => [a.item, a.who, a.open])).toEqual([['Open Ring', 'acct_3', true], ['Valor-Sworn Cloak', 'Aldenmar', false]]);
    // Loot: folded by item, only the last six hours.
    expect(body.looted).toHaveLength(1);
    expect(body.looted[0]).toMatchObject({ item: 'Strand of Ether', count: 2, who: ['Corvale', 'Nyssara'] });
    // Kills: curated, ended, not classified, damage > 0, tonight, newest first, names cleaned.
    expect(body.kills.map(k => [k.id, k.name])).toEqual([['e7', 'Valbrand'], ['e1', 'Aerin Dar']]);
    // Spawns: the next 24 h plus a window that opened a couple of minutes ago.
    expect(body.spawns.map(s => s.name)).toEqual(['Just Opened', 'Soon Boss']);
  });

  it('every read of a big table carries a limit of 100 or less (the 1,000-row cap)', async () => {
    fixture();
    const GET = await route();
    await GET();
    for (const t of ['opendkp_auctions', 'opendkp_loot_recent', 'looted_items', 'encounters', 'bot_boards']) {
      const call = st.calls.find(c => c.table === t);
      const lim = call.ops.find(o => o[0] === 'limit');
      expect(lim, t).toBeTruthy();
      expect(lim[1], t).toBeLessThanOrEqual(100);
    }
  });

  it('a part that fails is empty and marks the feed partial; the rest still shows; it is not cached', async () => {
    fixture();
    st.fail.add('looted_items');
    const GET = await route();
    const body = await (await GET()).json();
    expect(body.partial).toBe(true);
    expect(body.looted).toEqual([]);
    expect(body.kills).toHaveLength(2);
    st.fail.delete('looted_items');
    st.calls = [];
    const again = await (await GET()).json();
    expect(again.partial).toBe(false);
    expect(st.calls.length).toBeGreaterThan(0);
  });

  it('a good answer is shared for FEED_CACHE_MS: a second viewer costs no reads, and it refreshes after', async () => {
    fixture();
    const GET = await route();
    await GET();
    const first = st.calls.length;
    expect(first).toBeGreaterThan(0);
    await GET();
    expect(st.calls.length).toBe(first);
    vi.setSystemTime(NOW + FEED_CACHE_MS + 1);
    await GET();
    expect(st.calls.length).toBeGreaterThan(first);
  });
});

// ── The text checks: what a behaviour test cannot run ───────────────────────

describe('every write on /api/screen/* is behind the officer check', () => {
  const dir = 'web/app/api/screen';
  const files = fs.readdirSync(path.join(ROOT, dir), { recursive: true }).filter(f => String(f).endsWith('route.ts'));
  const handlerBody = (src, name) => {
    const at = src.indexOf(`export async function ${name}`);
    if (at < 0) return null;
    const next = src.indexOf('\nexport async function', at + 10);
    return src.slice(at, next < 0 ? src.length : next);
  };

  it('finds the routes', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it('a POST / PUT / PATCH / DELETE handler checks isOfficer before it reads the body or touches the database', () => {
    let seen = 0;
    for (const f of files) {
      const src = stripJs(read(`${dir}/${f}`));
      for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const body = handlerBody(src, verb);
        if (!body) continue;
        seen++;
        const guard = body.indexOf('isOfficer(user.id)');
        expect(guard, `${f} ${verb}`).toBeGreaterThan(-1);
        for (const first of ['req.json()', 'supabaseAdmin()', 'new URL(req.url)']) {
          const at = body.indexOf(first);
          if (at >= 0) expect(guard, `${f} ${verb} reads ${first} before the guard`).toBeLessThan(at);
        }
      }
    }
    expect(seen).toBe(3);   // state POST, slides POST, slides DELETE
  });

  it('a GET handler checks the session (members only) before it reads anything', () => {
    for (const f of files) {
      const src = stripJs(read(`${dir}/${f}`));
      const body = handlerBody(src, 'GET');
      expect(body, f).toBeTruthy();
      const gate = body.indexOf('auth.getUser()');
      expect(gate, f).toBeGreaterThan(-1);
      const db = body.indexOf('supabaseAdmin()');   // the ticket route reads no table: only the session
      if (db >= 0) expect(gate, f).toBeLessThan(db);
    }
  });

  it('no response is cacheable: every route sends no-store and nothing sets a public cache header', () => {
    for (const f of files) {
      const src = stripJs(read(`${dir}/${f}`));
      expect(src, f).toMatch(/'Cache-Control': 'no-store'/);
      expect(src, f).not.toMatch(/public|max-age|s-maxage/);
    }
  });
});

describe('the page, the nav, the embed and the migration', () => {
  it('/screen sends a signed-out visitor to sign in, and shows the leader bar only to an officer', () => {
    const src = stripJs(read('web/app/screen/page.tsx'));
    expect(src).toMatch(/redirect\('\/auth\/signin\?next=\/screen'\)/);
    expect(src).toMatch(/const canDrive = await isOfficer\(user\.id\)/);
    expect(src).toMatch(/<ScreenBoard canDrive=\{canDrive\} \/>/);
    expect(src).toMatch(/<NewPageTag/);
    expect(src).toMatch(/title: '\[beta\] Raid screen'/);
  });

  it('the board draws the leader bar only when canDrive, and drives through the officer-only route', () => {
    const src = stripJs(read('web/app/screen/ScreenBoard.tsx'));
    expect(src).toMatch(/\{canDrive && \(\s*<>\s*<span[^>]*>LEADER ONLY<\/span>/);
    expect(src).toMatch(/if \(!canDrive\) return;/);
    expect(src).toMatch(/fetch\('\/api\/screen\/state', \{\s*method: 'POST'/);
    expect(src).toMatch(/<SpectatorBoard embedded shared=\{shared\} \/>/);
  });

  it('a slide is rendered as text nodes, never as HTML', () => {
    const src = stripJs(read('web/app/screen/ScreenPanels.tsx'));
    expect(src).not.toMatch(/dangerouslySetInnerHTML/);
    expect(src).toMatch(/parseSlideBody\(slide\.body\)/);
    // The picture: https only is enforced by the API; the page also sends no referrer.
    expect(src).toMatch(/referrerPolicy="no-referrer"/);
  });

  it('the spectator board is embedded by a prop, and /spectator still mounts it with none', () => {
    const board = stripJs(read('web/app/spectator/SpectatorBoard.tsx'));
    expect(board).toMatch(/export default function SpectatorBoard\(\{ embedded = false, shared \}: \{\s*embedded\?: boolean;\s*shared\?: Pick<ScreenLive, 'feed' \| 'netErr' \| 'signedOut'>;\s*\} = \{\}\)/);
    expect(stripJs(read('web/app/spectator/page.tsx'))).toMatch(/<SpectatorBoard \/>/);
  });

  it('the nav lists Raid screen beside Spectator, and the link-preview table knows the page', () => {
    const nav = stripJs(read('web/components/Nav.tsx'));
    expect(nav).toMatch(/\{ href: '\/spectator',\s+label: 'Spectator' \},\s*\{ href: '\/screen',\s+label: 'Raid screen' \}/);
    expect(stripJs(read('web/lib/pageMeta.ts'))).toMatch(/'\/screen':\s+\{ title: '\[beta\] Raid screen'/);
  });

  it('the migration makes both tables, allows exactly the four modes, and gives no one but the service role a way in', () => {
    const sql = stripSql(read('supabase/migrations/20261006120000_raid_screen.sql'));
    expect(sql).toMatch(/create table if not exists public\.raid_screen_state/i);
    expect(sql).toMatch(/create table if not exists public\.raid_screen_slides/i);
    const modes = /check \(mode in \(([^)]*)\)\)/i.exec(sql);
    expect(modes, 'a CHECK on mode').toBeTruthy();
    expect(modes[1].split(',').map(s => s.trim().replace(/'/g, ''))).toEqual([...SCREEN_MODES]);
    expect(sql).toMatch(/alter table public\.raid_screen_state\s+enable row level security/i);
    expect(sql).toMatch(/alter table public\.raid_screen_slides\s+enable row level security/i);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toMatch(/revoke all on public\.raid_screen_state\s+from anon, authenticated/i);
    expect(sql).toMatch(/revoke all on public\.raid_screen_slides\s+from anon, authenticated/i);
    expect(sql).toMatch(/guild_id\s+text\s+primary key/i);
  });
});
