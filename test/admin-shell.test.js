// test/admin-shell.test.js — the admin sidebar preview (`/admin?v=b`) and the typed confirms (the guild lead,
// 2026-10-31, DECISIONS §493).
//
//   · the sidebar: the groups and their order, the Danger zone last and red, every link lands on a page file, the landing
//     is built from the same list, and the default admin render is the page production has (no sidebar without the cookie);
//   · the numbers in the strip: each is one small read that fails soft (run here against a fake PostgREST);
//   · the typed confirms: the fleet pause, the version floor, every shed, delete/merge encounters, delete trigger. These
//     are RUN: the real server actions against stubbed stores, wrong phrase refused with nothing written, right phrase
//     proceeds. They hold for the default render too: the actions do not know which render sent them.
//
// No react here (CI installs only the root dependencies): the components are checked as comment-stripped text and the
// logic they sit on is run for real. Fixture names are invented.
//
// Run: npx vitest run test/admin-shell.test.js

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ROOT, readSource, sliceBlock, stripJs } from './_source-slice.js';
import { NAV_GROUPS, groupLinks, linkLabel, hrefPath, isCurrent } from '../web/lib/adminNav.ts';
import { ADMIN_TITLES } from '../web/lib/pageMeta.ts';
import { adminShellChoice, isAdminPath } from '../web/lib/adminShell.ts';
import {
  DANGER_FLAG_KEYS, SHED_KINDS, dangerPhrase, typedConfirmOk, encounterPhrase, phrasePattern,
  VERSION_FLOOR_KEY, MERGE_PHRASE, PAUSE_FLEET_PHRASE,
} from '../web/lib/adminTyped.ts';
import { readTonight, readLockedOut, readAgents, readNewFeedback } from '../web/lib/adminShellReads.ts';

const WEB = path.join(ROOT, 'web');
const ADMIN = path.join(WEB, 'app', 'admin');
const src = (...p) => stripJs(readSource(path.join(WEB, ...p)));
const raw = (...p) => readSource(path.join(WEB, ...p));

// ── The sidebar's contents ─────────────────────────────────────────────────────────────────────────────────────────
describe('the groups, in order', () => {
  const byId = Object.fromEntries(NAV_GROUPS.map(g => [g.id, g]));
  const hrefs = id => byId[id].lines.map(l => l.links.map(k => k.href));

  it('Raid night, Between raids, Data & site, then the Danger zone: last', () => {
    expect(NAV_GROUPS.map(g => g.id)).toEqual(['raid', 'between', 'data', 'danger']);
    expect(NAV_GROUPS.map(g => g.title)).toEqual(['Raid night', 'Between raids', 'Data & site', 'Danger zone']);
  });

  it('Raid night: console, lockouts, voice, triggers, agents, Mimic Mail, Overlay tuning', () => {
    expect(hrefs('raid')).toEqual([
      ['/admin/console'], ['/admin/lockouts'], ['/admin/voice'], ['/admin/triggers'], ['/admin/agents'],
      ['/admin/notices'], ['/admin/overlays'],
    ]);
    expect(linkLabel(byId.raid.lines[5].links[0])).toBe('Mimic Mail');
    expect(linkLabel(byId.raid.lines[6].links[0])).toBe('Overlay tuning');
  });

  it('Between raids: the people, the data, the housekeeping, rarely-used pages sharing a line', () => {
    expect(hrefs('between')).toEqual([
      ['/admin/members', '/admin/links'],
      ['/admin/feedback'],
      ['/admin/encounters'],
      ['/admin/signups', '/admin/comp', '/admin/readiness'],
      ['/admin/loot', '/admin/spells', '/admin/extra-spells', '/admin/quests'],
      ['/admin/attendance'], ['/admin/soft-reserve'], ['/admin/queue'], ['/admin/guests'], ['/admin/quarmy'],
      ['/admin/pronunciations', '/admin/voice-reports'],
    ]);
    // the anonymous inbox hangs under Feedback
    expect(byId.between.lines[1].sub.map(s => s.href)).toEqual(['/admin/feedback/anonymous']);
  });

  it('Data & site, with the member-facing pages the old grid had listed small at its foot', () => {
    expect(hrefs('data').slice(0, 5)).toEqual([
      ['/admin/audit', '/admin/chat', '/admin/analytics'], ['/admin/anomalies', '/admin/adoption'],
      ['/admin/rules'], ['/admin/theme'], ['/admin/access'],
    ]);
    expect(byId.data.elsewhere.map(e => e.href)).toEqual(['/who', '/quartermaster', '/loadouts', '/planner']);
  });

  it('the Danger zone is three shortcuts to anchors', () => {
    expect(byId.danger.lines.map(l => [l.links[0].href, linkLabel(l.links[0])])).toEqual([
      ['/admin/overlays#danger', 'Fleet pause & shed'],
      ['/admin/access', 'Lock a member out'],
      ['/admin/encounters#danger', 'Delete / merge data'],
    ]);
  });

  it('three lines carry a live count: lockouts, agents, feedback', () => {
    const counted = NAV_GROUPS.flatMap(g => g.lines).filter(l => l.count).map(l => [l.count, l.links[0].href]);
    expect(counted).toEqual([['lockouts', '/admin/lockouts'], ['agents', '/admin/agents'], ['feedback', '/admin/feedback']]);
  });
});

describe('every link lands somewhere', () => {
  const links = NAV_GROUPS.flatMap(groupLinks);
  const pageFile = href => {
    const p = hrefPath(href);                          // /admin/x or /who
    return path.join(WEB, 'app', p.replace(/^\//, ''), 'page.tsx');
  };

  it('is not a vacuous check', () => expect(links.length).toBeGreaterThanOrEqual(40));

  it('resolves to a page.tsx (the one `soon` link is allowed not to)', () => {
    for (const l of links) {
      if (l.soon) continue;
      expect(fs.existsSync(pageFile(l.href)), `${l.href} has no page file`).toBe(true);
    }
  });

  it('`soon` is on exactly the links whose page file is absent (a stale flag fails either way)', () => {
    for (const l of links) expect(!!l.soon, l.href).toBe(!fs.existsSync(pageFile(l.href)));
    expect(links.filter(l => l.soon).map(l => l.href)).toEqual(['/admin/theme']);
  });

  it('a link with no label of its own has a title in ADMIN_TITLES', () => {
    for (const l of links) {
      if (l.label) continue;
      expect(ADMIN_TITLES[hrefPath(l.href)], `${l.href} has no title`).toBeTruthy();
    }
  });

  it('every admin page is reachable from the sidebar (the /admin root and the /who redirect aside)', () => {
    const listed = new Set(links.map(l => hrefPath(l.href)));
    const walk = (dir, rel = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? walk(path.join(dir, e.name), path.join(rel, e.name))
        : e.name === 'page.tsx' ? ['/admin' + (rel ? '/' + rel.split(path.sep).join('/') : '')] : []);
    const pages = walk(ADMIN).filter(p => p !== '/admin' && p !== '/admin/who');
    expect(pages.length).toBeGreaterThanOrEqual(30);
    for (const p of pages) expect(listed.has(p), `${p} is not in the sidebar`).toBe(true);
  });

  it('every link has a card blurb on the landing', () => {
    const blurbs = raw('app', 'admin', 'adminBlurbs.ts');
    for (const l of links) expect(blurbs.includes(`'${l.href}':`), `${l.href} has no blurb`).toBe(true);
  });
});

describe('the current page', () => {
  const feedback = { href: '/admin/feedback', exact: true };
  it('the page and its sub-pages highlight; a prefix of another name does not', () => {
    expect(isCurrent('/admin/triggers', { href: '/admin/triggers' })).toBe(true);
    expect(isCurrent('/admin/triggers/x', { href: '/admin/triggers' })).toBe(true);
    expect(isCurrent('/admin/triggers-old', { href: '/admin/triggers' })).toBe(false);
  });
  it('Feedback is current at its own path only, so the anonymous inbox is current alone', () => {
    expect(isCurrent('/admin/feedback', feedback)).toBe(true);
    expect(isCurrent('/admin/feedback/anonymous', feedback)).toBe(false);
    expect(isCurrent('/admin/feedback/anonymous', { href: '/admin/feedback/anonymous' })).toBe(true);
  });
  it('a danger shortcut is never "the current page"; a `soon` link is never current', () => {
    expect(isCurrent('/admin/overlays', { href: '/admin/overlays#danger' })).toBe(false);
    expect(isCurrent('/admin/theme', { href: '/admin/theme', soon: true })).toBe(false);
  });
  it('the admin root is current at the root only', () => {
    expect(isCurrent('/admin', { href: '/admin' })).toBe(true);
    expect(isCurrent('/admin/agents', { href: '/admin' })).toBe(false);
  });
});

// ── The components, as text (no react in CI) ───────────────────────────────────────────────────────────────────────
describe('the shell', () => {
  const shell = src('app', 'admin', 'AdminShell.tsx');

  it('draws every group from the one list, and pins the Danger zone after the scrolling nav, in red', () => {
    expect(shell).toMatch(/NAV_GROUPS\.filter\(g => g\.id !== 'danger'\)\.map/);
    expect(shell.indexOf('<DangerZone')).toBeGreaterThan(shell.indexOf('<nav '));
    const zone = shell.slice(shell.indexOf('function DangerZone'), shell.indexOf('function Panel'));
    expect(zone).toMatch(/border-2 border-red/);
    expect(zone).toMatch(/text-red/);
  });

  it('is a sticky column from lg and a collapsible bar below it (no script decides which)', () => {
    expect(shell).toMatch(/lg:grid-cols-\[15rem_minmax\(0,1fr\)\]/);
    expect(shell).toMatch(/<details className="lg:hidden sticky top-20/);
    expect(shell).toMatch(/<aside[^>]*hidden lg:block lg:sticky lg:top-20/);
  });

  it('puts the context strip at the top of every pane', () => {
    expect(shell.indexOf('<AdminStrip')).toBeLessThan(shell.indexOf('{children}'));
  });

  it('only the highlight is client code', () => {
    const useClient = f => /^['"]use client['"]/m.test(raw('app', 'admin', f));
    expect(useClient('ActiveLink.tsx')).toBe(true);
    for (const f of ['AdminShell.tsx', 'AdminStrip.tsx', 'AdminCards.tsx', 'TypedConfirm.tsx']) expect(useClient(f), f).toBe(false);
  });

  it('the strip links the four things it names', () => {
    const strip = src('app', 'admin', 'AdminStrip.tsx');
    for (const href of ['/admin/lockouts', '/admin/agents', '/admin/feedback']) expect(strip).toContain(`href="${href}"`);
    expect(strip).toMatch(/href: '\/raid'/);
  });

  it('the landing is the same groups as cards, the danger group last behind the barrier', () => {
    const cards = src('app', 'admin', 'AdminCards.tsx');
    expect(cards).toMatch(/NAV_GROUPS\.map\(g => <GroupCards/);
    expect(cards).toMatch(/border-2 border-red/);
  });
});

describe('the default render is the page production has', () => {
  it('adminShellChoice: ?v=b sets, ?v=a clears, nothing keeps what the cookie says', () => {
    expect(adminShellChoice('b', undefined)).toEqual({ on: true, action: 'set' });
    expect(adminShellChoice('a', 'b')).toEqual({ on: false, action: 'clear' });
    expect(adminShellChoice(null, 'b')).toEqual({ on: true, action: 'keep' });
    expect(adminShellChoice(null, undefined)).toEqual({ on: false, action: 'keep' });
    expect(adminShellChoice('c', undefined)).toEqual({ on: false, action: 'keep' });
    expect(adminShellChoice(null, 'x')).toEqual({ on: false, action: 'keep' });
  });

  it('only admin paths take the cookie', () => {
    expect(isAdminPath('/admin')).toBe(true);
    expect(isAdminPath('/admin/agents')).toBe(true);
    expect(isAdminPath('/administrator')).toBe(false);
    expect(isAdminPath('/me')).toBe(false);
  });

  it('middleware sets the cookie for admin GETs only, on the final response', () => {
    const mw = src('middleware.ts');
    expect(mw).toMatch(/request\.method === 'GET' && isAdminPath\(request\.nextUrl\.pathname\)/);
    expect(mw).toMatch(/path: '\/admin'/);
    expect(mw.lastIndexOf('response.cookies.set({ name: ADMIN_SHELL_COOKIE')).toBeGreaterThan(mw.indexOf('lockedOutResponse(request, supabase)'));
  });

  it('the layout checks sign-in and the officer role BEFORE it asks about the sidebar, and without the cookie renders banner + page', () => {
    const layout = src('app', 'admin', 'layout.tsx');
    expect(layout).toContain("redirect('/auth/signin?next=/admin')");
    expect(layout).toContain("redirect('/?error=admin_required')");
    expect(layout.indexOf('isOfficer(user.id)')).toBeLessThan(layout.indexOf('shellOn()'));
    const afterGuard = layout.slice(layout.indexOf('if (shellOn())'));
    const withShell = afterGuard.slice(0, afterGuard.indexOf('\n  }\n') + 4);
    const fallthrough = afterGuard.slice(withShell.length);
    expect(withShell).toContain('<AdminShell');
    expect(fallthrough).not.toContain('AdminShell');
    expect(fallthrough).toMatch(/<AdminQueueBanner \/>\s*\{children\}/);
  });

  it('the landing shows the old grid unless the cookie says so', () => {
    const page = src('app', 'admin', 'page.tsx');
    expect(page.indexOf('if (shellOn()) return <AdminCards />;')).toBeGreaterThan(0);
    expect(page.indexOf('if (shellOn())')).toBeLessThan(page.indexOf('Officer console'));
    expect(page).toContain('title="🎛 Officer console"');   // the grid is still there
  });

  it('the smart row links on the existing pages show in the sidebar preview only', () => {
    for (const f of ['agents', 'lockouts', 'members', 'feedback']) {
      const s = src('app', 'admin', f, 'page.tsx');
      expect(s, f).toContain('shellOn()');
      expect(s, f).toMatch(/\{smart && /);
    }
  });
});

// ── Smart-link params ──────────────────────────────────────────────────────────────────────────────────────────────
describe('?member= and ?character=', () => {
  it('members, agents, lockouts and feedback read them', () => {
    expect(src('app', 'admin', 'members', 'page.tsx')).toMatch(/member\?: string; character\?: string/);
    expect(src('app', 'admin', 'agents', 'page.tsx')).toMatch(/character\?: string; member\?: string/);
    expect(src('app', 'admin', 'lockouts', 'page.tsx')).toMatch(/character\?: string/);
    expect(src('app', 'admin', 'feedback', 'page.tsx')).toContain("q.eq('submitter_discord_id', p.member)");
  });
});

// ── The numbers in the strip ───────────────────────────────────────────────────────────────────────────────────────
class Q {
  constructor(rows, boom) { this.rows = rows; this.filters = []; this.ord = []; this.rng = null; this.lim = null; this.head = false; this.boom = boom; }
  select(_c, opts) { this.head = !!opts?.head; this.count = !!opts?.count; return this; }
  eq(c, v) { this.filters.push(r => r[c] === v); return this; }
  gt(c, v) { this.filters.push(r => r[c] > v); return this; }
  gte(c, v) { this.filters.push(r => r[c] >= v); return this; }
  in(c, vs) { this.filters.push(r => vs.includes(r[c])); return this; }
  order(c, o) { this.ord.push([c, o?.ascending === false ? -1 : 1]); return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  limit(n) { this.lim = n; return this; }
  then(res, rej) {
    if (this.boom) return Promise.reject(new Error('db down')).then(res, rej);
    let rows = this.rows.filter(r => this.filters.every(f => f(r)));
    for (const [c, d] of [...this.ord].reverse()) rows = [...rows].sort((x, y) => (x[c] > y[c] ? d : x[c] < y[c] ? -d : 0));
    const total = rows.length;
    if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
    if (this.lim != null) rows = rows.slice(0, this.lim);
    return Promise.resolve({ data: this.head ? null : rows, count: this.count ? total : null, error: null }).then(res, rej);
  }
}
const fake = (tables, boom = false) => ({ from: t => new Q(tables[t] ?? [], boom) });
const NOW = new Date('2026-10-28T00:30:00Z');   // Tue Oct 27, 20:30 ET
const iso = ms => new Date(ms).toISOString();

describe('readLockedOut', () => {
  const lock = (character, ours, expiresMs = NOW.getTime() + 3600_000) =>
    ({ guild_id: 'g', character, boss_key: 'b1', ours, expires_at: iso(expiresMs) });
  const roster = ['Aldenmar', 'Brackwyn'].map(name => ({ guild_id: 'g', name }));

  it('counts distinct raiders of ours locked from a kill that was not ours, not another guild’s whole raid', async () => {
    const sb = fake({
      character_lockouts: [
        lock('Aldenmar', false), { ...lock('Aldenmar', false), boss_key: 'b2' },   // two bosses, one raider
        lock('Brackwyn', false), lock('Corvale', false),                           // Corvale is not on our roster
        lock('Nyssara', true),                                                     // ours: not a surprise
        lock('Brackwyn', false, NOW.getTime() - 1000),                             // expired
      ],
      characters: [...roster, { guild_id: 'g', name: 'Nyssara' }],
    });
    expect(await readLockedOut(sb, 'g', NOW)).toBe(2);
  });

  it('is 0 with no lockouts and null when the read fails (the number is left off, the page still loads)', async () => {
    expect(await readLockedOut(fake({}), 'g', NOW)).toBe(0);
    expect(await readLockedOut(fake({ character_lockouts: [lock('Aldenmar', false)] }, true), 'g', NOW)).toBeNull();
  });
});

describe('readAgents', () => {
  const up = (character, did, agoMs) => ({ character, endpoint: 'chat', guild_id: 'g', uploaded_by_discord_id: did, last_uploaded_at: iso(NOW.getTime() - agoMs) });

  it('counts players (one install, many characters), uploading in 15 minutes against uploading in a raid week', async () => {
    const sb = fake({
      agent_upload_stats: [
        up('Aldenmar', 'd1', 60_000), up('Brackwyn', 'd1', 120_000),      // one player, two characters, both live
        up('Corvale', 'd2', 3 * 3600_000),                                // a player quiet for hours
        up('Nyssara', null, 60_000),                                      // no uploader id: counted by character
        up('Zarrin', 'd3', 9 * 86_400_000),                               // gone for over a week: not counted
      ],
    });
    expect(await readAgents(sb, NOW)).toEqual({ up: 2, total: 3 });
  });

  it('null on a failed read', async () => expect(await readAgents(fake({}, true), NOW)).toBeNull());
});

describe('readNewFeedback', () => {
  it('counts the reports nobody has looked at', async () => {
    const sb = fake({ feedback: [{ status: 'new' }, { status: 'new' }, { status: 'acked' }, { status: 'addressed' }] });
    expect(await readNewFeedback(sb)).toBe(2);
    expect(await readNewFeedback(fake({}, true))).toBeNull();
  });
});

describe('readTonight', () => {
  const minute = (agoMs, zones = ['potimea'], raiders = 24) => ({ guild_id: 'g', minute_at: iso(NOW.getTime() - agoMs), raiders, zones });

  it('a recent raid-track minute is the raid that is running: its zone and how many are in', async () => {
    const t = await readTonight(fake({ raid_track_minutes: [minute(60 * 3600_000, ['old']), minute(120_000, ['plane_of_storms'], 24)] }), 'g', NOW);
    expect(t).toEqual({ kind: 'live', zone: 'plane of storms', raiders: 24 });
  });

  it('else today’s Raid-Helper event (Eastern day), else nothing', async () => {
    const today = { title: 'Wed raid', start_time: '2026-10-28T00:30:00Z' };      // Tue 20:30 ET: today in New York
    const tomorrow = { title: 'Next', start_time: '2026-10-29T23:00:00Z' };
    const t = await readTonight(fake({ raid_track_minutes: [minute(30 * 3600_000)], rh_events: [today, tomorrow] }), 'g', NOW);
    expect(t.kind).toBe('event');
    expect(t.title).toBe('Wed raid');
    expect(await readTonight(fake({ rh_events: [tomorrow] }), 'g', NOW)).toEqual({ kind: 'none' });
    expect(await readTonight(fake({}), 'g', NOW)).toEqual({ kind: 'none' });
    expect(await readTonight(fake({}, true), 'g', NOW)).toBeNull();
  });
});

describe('the numbers are cached, one read each', () => {
  const facts = src('lib', 'adminShellFacts.ts');
  it('each reader sits in its own unstable_cache, revalidated every 60 seconds', () => {
    expect(facts).toMatch(/FACTS_REVALIDATE_S = 60/);
    expect((facts.match(/unstable_cache\(/g) || []).length).toBe(4);
    expect((facts.match(/revalidate: FACTS_REVALIDATE_S/g) || []).length).toBe(4);
  });
  it('the layout loads them only for the sidebar render', () => {
    const layout = src('app', 'admin', 'layout.tsx');
    expect(layout.indexOf('loadAdminFacts()')).toBeGreaterThan(layout.indexOf('if (shellOn())'));
  });
});

// ── The typed phrases ──────────────────────────────────────────────────────────────────────────────────────────────
describe('typed phrases', () => {
  it('PAUSE FLEET for the pause (the console’s own), FLOOR for the floor, SHED <kind> for each shed', () => {
    expect(dangerPhrase('flag_agent_kill')).toBe('PAUSE FLEET');
    expect(dangerPhrase(VERSION_FLOOR_KEY)).toBe('FLOOR');
    expect(dangerPhrase('flag_shed_live_state')).toBe('SHED live_state');
    expect(dangerPhrase('flag_shed_buff_casts')).toBe('SHED buff_casts');
    expect(dangerPhrase('flag_raid_hold')).toBeNull();
    expect(dangerPhrase('flag_shed_')).toBeNull();
    expect(dangerPhrase('flag_shed_not_a_stream')).toBeNull();
  });

  it('the console’s phrase and ours are the same word', () => {
    expect(src('app', 'admin', 'console', 'actions.ts')).toContain(`flag_agent_kill: '${PAUSE_FLEET_PHRASE}'`);
  });

  it('the Danger pane lists the fleet pause and eleven sheds', () => {
    expect(DANGER_FLAG_KEYS.length).toBe(12);
    expect(SHED_KINDS.length).toBe(11);
  });

  it('typedConfirmOk: trimmed, exact otherwise; an empty phrase never matches', () => {
    expect(typedConfirmOk('  PAUSE FLEET ', 'PAUSE FLEET')).toBe(true);
    expect(typedConfirmOk('pause fleet', 'PAUSE FLEET')).toBe(false);
    expect(typedConfirmOk('', '')).toBe(false);
    expect(typedConfirmOk(undefined, 'FLOOR')).toBe(false);
    expect(typedConfirmOk(null, null)).toBe(false);
    expect(typedConfirmOk('x', undefined)).toBe(false);
  });

  it('encounterPhrase: the name as the page shows it, else npc <id>', () => {
    expect(encounterPhrase('a_decaying_skeleton', 5)).toBe('a decaying skeleton');
    expect(encounterPhrase('#Aldenmar_the_Bold', 5)).toBe('Aldenmar the Bold');
    expect(encounterPhrase(null, 158443)).toBe('npc 158443');
    expect(encounterPhrase('', 7)).toBe('npc 7');
  });

  it('phrasePattern: a browser pattern that accepts the phrase and nothing else', () => {
    for (const p of ['PAUSE FLEET', 'SHED live_state', 'Lord Nagafen (Heroic)', 'a.b+c?', 'x/y|z', 'half-elf [x]']) {
      const re = new RegExp(`^(?:${phrasePattern(p)})$`, 'u');
      expect(re.test(p), p).toBe(true);
      expect(re.test(p + 'x'), p).toBe(false);
    }
  });
});

// ── The server actions, run for real against stubbed stores ────────────────────────────────────────────────────────
const h = vi.hoisted(() => ({ user: null, officer: true, log: [], tuning: {}, enc: null, npc: null, trig: null, upsertError: null, revalidated: [] }));

vi.mock('@/lib/supabase-server', () => ({ supabaseServer: () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }) }));
vi.mock('@/lib/officer', () => ({ isOfficer: async () => h.officer }));
vi.mock('@/lib/guild', () => ({ GUILD_TAG: 'g' }));
vi.mock('@/lib/actorName', () => ({ actorName: () => 'an officer' }));
vi.mock('@/lib/consoleHealth', async () => await import('../web/lib/consoleHealth.ts'));
vi.mock('@/lib/adminTyped', async () => await import('../web/lib/adminTyped.ts'));
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: () => ({
    rpc: async (name, args) => { h.log.push({ kind: 'rpc', name, args }); return {}; },
    from: (table) => {
      const op = { table, kind: 'select' };
      const b = {
        select: () => b,
        eq: (c, v) => { op.eq = [c, v]; return b; },
        in: (c, vs) => { op.in = [c, vs]; return b; },
        delete: () => { op.kind = 'delete'; return b; },
        update: (patch) => { op.kind = 'update'; op.patch = patch; return b; },
        upsert: async (row) => { h.log.push({ ...op, kind: 'upsert', row }); return { error: h.upsertError }; },
        maybeSingle: async () => {
          if (table === 'overlay_tuning') return { data: { tuning: structuredClone(h.tuning) } };
          if (table === 'encounters') return { data: h.enc };
          if (table === 'eqemu_npc_types') return { data: h.npc };
          if (table === 'guild_triggers') return { data: h.trig };
          return { data: null };
        },
        then: (res, rej) => { h.log.push(op); return Promise.resolve({ data: null, error: null }).then(res, rej); },
      };
      return b;
    },
  }),
}));

const nav = { revalidatePath: p => h.revalidated.push(p) };
const redirects = {
  redirect: (url) => { throw Object.assign(new Error('NEXT_REDIRECT'), { url }); },
};
vi.doMock('next/cache', () => nav);
vi.doMock('next/navigation', () => redirects);
try {
  const req = createRequire(new URL('../web/package.json', import.meta.url));
  vi.doMock(req.resolve('next/cache'), () => nav);
  vi.doMock(req.resolve('next/navigation'), () => redirects);
} catch { /* web/ not installed here */ }

const { applyDangerControl } = await import('../web/app/admin/overlays/dangerActions.ts');
const { deleteEncounter, mergeEncounters } = await import('../web/app/admin/encounters/dangerActions.ts');
const { deleteTrigger } = await import('../web/app/admin/triggers/dangerActions.ts');

const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const writes = () => h.log.filter(o => o.kind !== 'select');
const redirectedTo = async (p) => { try { await p; } catch (e) { return e.url ?? null; } return null; };

beforeEach(() => {
  h.user = { id: 'u1', app_metadata: {}, user_metadata: {} };
  h.officer = true;
  h.log = [];
  h.revalidated = [];
  h.tuning = { ext_hurt_pct: 80, dedup_buffs: 1, some_future_key: 'x' };
  h.enc = { npc_id: 4242 };
  h.npc = { name: 'a_decaying_skeleton' };
  h.trig = { name: 'Naggy full heal' };
  h.upsertError = null;
});

describe('Danger zone on /admin/overlays: applyDangerControl', () => {
  it('a wrong or missing phrase refuses, writes nothing, and says so at #danger', async () => {
    for (const confirm of ['', 'pause fleet', 'PAUSE', 'SHED live_state']) {
      h.log = [];
      const to = await redirectedTo(applyDangerControl(form({ key: 'flag_agent_kill', mode: 'set', confirm })));
      expect(to, confirm).toBe('/admin/overlays?danger=wrong-phrase&k=flag_agent_kill#danger');
      expect(writes(), confirm).toEqual([]);
    }
    expect(await redirectedTo(applyDangerControl(form({ key: 'flag_agent_kill', mode: 'set' })))).toContain('wrong-phrase');
    expect(writes()).toEqual([]);
  });

  it('the right phrase sets only that key (and its age stamp) and keeps the rest of the tuning map', async () => {
    const to = await redirectedTo(applyDangerControl(form({ key: 'flag_agent_kill', mode: 'set', confirm: 'PAUSE FLEET' })));
    expect(to).toBe('/admin/overlays?danger=set&k=flag_agent_kill#danger');
    const [w] = writes();
    expect(w.kind).toBe('upsert');
    expect(w.row.tuning).toMatchObject({ ext_hurt_pct: 80, dedup_buffs: 1, some_future_key: 'x', flag_agent_kill: 1 });
    expect(typeof w.row.tuning.flag_set_at_flag_agent_kill).toBe('string');
    expect(h.revalidated).toContain('/admin/overlays');
  });

  it('every shed takes its own phrase, and another shed’s phrase does not do', async () => {
    for (const kind of SHED_KINDS) {
      h.log = [];
      const key = `flag_shed_${kind}`;
      expect(await redirectedTo(applyDangerControl(form({ key, mode: 'set', confirm: 'SHED nothing' }))), key).toContain('wrong-phrase');
      expect(writes(), key).toEqual([]);
      await redirectedTo(applyDangerControl(form({ key, mode: 'set', confirm: `SHED ${kind}` })));
      expect(writes()[0].row.tuning[key], key).toBe(1);
    }
  });

  it('the version floor needs FLOOR and a whole number above zero', async () => {
    const set = (o) => redirectedTo(applyDangerControl(form({ key: 'min_agent_ver_num', mode: 'set', ...o })));
    expect(await set({ value: '30385', confirm: 'nope' })).toContain('wrong-phrase');
    for (const value of ['', '0', '-5', '3.5', 'abc']) expect(await set({ value, confirm: 'FLOOR' }), value).toContain('bad-value');
    expect(writes()).toEqual([]);
    expect(await set({ value: '30385', confirm: 'FLOOR' })).toContain('danger=set');
    expect(writes()[0].row.tuning.min_agent_ver_num).toBe(30385);
  });

  it('clearing never asks for a phrase, and takes the key and its stamp off the map', async () => {
    h.tuning = { flag_agent_kill: 1, flag_set_at_flag_agent_kill: 'then', ext_hurt_pct: 80 };
    const to = await redirectedTo(applyDangerControl(form({ key: 'flag_agent_kill', mode: 'clear' })));
    expect(to).toBe('/admin/overlays?danger=cleared&k=flag_agent_kill#danger');
    expect(writes()[0].row.tuning).toEqual({ ext_hurt_pct: 80 });
    h.log = []; h.tuning = { min_agent_ver_num: 30000 };
    await redirectedTo(applyDangerControl(form({ key: 'min_agent_ver_num', mode: 'clear' })));
    expect(writes()[0].row.tuning).toEqual({});
  });

  it('refuses a key that is not one of the Danger zone’s, however the form was built', async () => {
    for (const key of ['flag_raid_hold', 'dedup_chat', 'flag_shed_evil', 'ext_hurt_pct', '', 'flag_shed_']) {
      expect(await redirectedTo(applyDangerControl(form({ key, mode: 'set', confirm: 'SHED evil' }))), key).toContain('danger=unknown');
      expect(await redirectedTo(applyDangerControl(form({ key, mode: 'clear' }))), key).toContain('danger=unknown');
    }
    expect(await redirectedTo(applyDangerControl(form({ key: 'flag_agent_kill', mode: 'toggle' })))).toContain('danger=unknown');
    expect(writes()).toEqual([]);
  });

  it('a non-officer is bounced and nothing is written', async () => {
    h.officer = false;
    expect(await redirectedTo(applyDangerControl(form({ key: 'flag_agent_kill', mode: 'set', confirm: 'PAUSE FLEET' })))).toBe('/?error=admin_required');
    h.officer = true; h.user = null;
    expect(await redirectedTo(applyDangerControl(form({ key: 'flag_agent_kill', mode: 'clear' })))).toBe('/?error=admin_required');
    expect(writes()).toEqual([]);
  });

  it('a failed write is reported, not swallowed', async () => {
    h.upsertError = { message: 'boom' };
    expect(await redirectedTo(applyDangerControl(form({ key: 'flag_agent_kill', mode: 'set', confirm: 'PAUSE FLEET' })))).toContain('write-failed');
    expect(h.revalidated).toEqual([]);
  });
});

describe('the tuning form no longer carries the danger flags', () => {
  const page = raw('app', 'admin', 'overlays', 'page.tsx');
  const flags = new Function('return ' + sliceBlock(page, 'const FLAGS: Flag[] = [', '\n];').replace('const FLAGS: Flag[] = ', ''))();
  const save = stripJs(sliceBlock(page, 'async function saveOverlayTuning', 'async function saveClassSets'));

  it('the page’s danger-marked flags are exactly the Danger zone’s keys', () => {
    expect(flags.filter(f => f.danger).map(f => f.key).sort()).toEqual([...DANGER_FLAG_KEYS].sort());
    // and the four that cannot take a fleet down stay in the form
    expect(flags.filter(f => !f.danger).map(f => f.key).sort()).toEqual(
      ['dedup_buffs', 'dedup_roster', 'flag_disable_reporter_election', 'flag_skip_uncurated_mobs']);
  });

  it('the tuning save writes only the form’s flags and lets the danger keys and the floor ride through', () => {
    expect(save).toMatch(/for \(const f of TUNING_FLAGS\)/);
    expect(save).not.toMatch(/for \(const f of FLAGS\)/);
    expect(save).not.toContain('VERSION_FLOOR_KEY');
    expect(save).toMatch(/!FLAG_KEYS\.has\(k\)/);
    expect(stripJs(page)).toMatch(/const FLAG_KEYS = new Set\(TUNING_FLAGS\.map/);
  });

  it('the page renders no danger flag as a checkbox, and has its own #danger section with the red barrier', () => {
    const s = stripJs(page);
    expect(s).toMatch(/\{TUNING_FLAGS\.map\(f => \{/);
    expect(s).toContain('<section id="danger"');
    expect(s).toMatch(/id="danger"[^>]*border-2 border-red/);
    expect(s).toMatch(/DANGER_FLAGS\.map\(f => <DangerFlag/);
    expect(s).toContain('<DangerFloor');
  });

  it('each control is its own form with the typed field, and clearing is a separate button without it', () => {
    const c = src('app', 'admin', 'overlays', 'DangerControls.tsx');
    expect((c.match(/<form action=\{applyDangerControl\}/g) || []).length).toBe(2);
    expect(c).toMatch(/<TypedConfirm phrase=\{phrase\}/);
    expect(c).toMatch(/name="mode" value="clear"/);
    expect(c).toMatch(/formNoValidate/);
  });
});

describe('Delete encounter and Merge all on /admin/encounters', () => {
  it('delete: the boss name, typed, read from the row and the catalog on the server', async () => {
    for (const confirm of ['', 'a_decaying_skeleton', 'A decaying skeleton', 'DELETE']) {
      h.log = [];
      expect(await redirectedTo(deleteEncounter(form({ id: 'e1', confirm }))), confirm).toBe('/admin/encounters?danger=wrong-phrase#danger');
      expect(writes(), confirm).toEqual([]);
    }
    await deleteEncounter(form({ id: 'e1', confirm: 'a decaying skeleton' }));
    expect(writes().map(w => `${w.kind} ${w.table}`)).toEqual([
      'delete encounter_players', 'delete contributions', 'delete encounter_combat_rollup', 'delete combat_events', 'delete encounters',
    ]);
    expect(writes().every(w => w.eq[1] === 'e1')).toBe(true);
    expect(h.revalidated).toEqual(['/admin/encounters']);
  });

  it('the form cannot supply its own answer', async () => {
    expect(await redirectedTo(deleteEncounter(form({ id: 'e1', confirm: 'whatever', expect: 'whatever', phrase: 'whatever' })))).toContain('wrong-phrase');
    expect(writes()).toEqual([]);
  });

  it('an encounter whose npc never resolved is deleted by typing npc <id>', async () => {
    h.npc = null;
    expect(await redirectedTo(deleteEncounter(form({ id: 'e1', confirm: 'npc 158443' })))).toContain('wrong-phrase');
    expect(await redirectedTo(deleteEncounter(form({ id: 'e1', confirm: 'npc 4242' })))).toBeNull();
    expect(writes().length).toBe(5);
  });

  it('an encounter that is already gone is a quiet no-op (the delete is idempotent)', async () => {
    h.enc = null;
    expect(await redirectedTo(deleteEncounter(form({ id: 'e1', confirm: 'x' })))).toBeNull();
    expect(writes()).toEqual([]);
  });

  it('merge: MERGE, typed; wrong refuses with nothing moved or deleted', async () => {
    const f = (confirm) => form({ target: 't1', sources: 's1,s2', ...(confirm === undefined ? {} : { confirm }) });
    for (const confirm of [undefined, '', 'merge', 'MERGE ALL']) {
      h.log = [];
      expect(await redirectedTo(mergeEncounters(f(confirm))), String(confirm)).toBe('/admin/encounters?danger=wrong-phrase#danger');
      expect(writes(), String(confirm)).toEqual([]);
    }
    await mergeEncounters(f(MERGE_PHRASE));
    expect(writes().map(w => w.kind === 'rpc' ? `rpc ${w.name}` : `${w.kind} ${w.table}`)).toEqual([
      'update contributions', 'delete encounters', 'rpc merge_encounter_players',
    ]);
    expect(writes()[0].patch).toEqual({ encounter_id: 't1' });
    expect(writes()[1].in).toEqual(['id', ['s1', 's2']]);
  });

  it('both are officer-only', async () => {
    h.officer = false;
    expect(await redirectedTo(deleteEncounter(form({ id: 'e1', confirm: 'a decaying skeleton' })))).toBe('/?error=admin_required');
    expect(await redirectedTo(mergeEncounters(form({ target: 't', sources: 's', confirm: 'MERGE' })))).toBe('/?error=admin_required');
    expect(writes()).toEqual([]);
  });

  it('the page shows each phrase beside its button, and the Danger-zone anchor exists', () => {
    const p = src('app', 'admin', 'encounters', 'page.tsx');
    expect(p).toContain('<section id="danger"');
    expect(p).toMatch(/<TypedConfirm phrase=\{MERGE_PHRASE\}/);
    expect(p).toMatch(/<TypedConfirm phrase=\{encounterPhrase\(r\.npc_name, r\.npc_id\)\}/);
    expect(p).not.toMatch(/async function (deleteEncounter|mergeEncounters)/);   // one definition, the checked one
  });
});

describe('Delete trigger on /admin/triggers', () => {
  it('the trigger’s name, typed, read from the row; wrong refuses with nothing deleted', async () => {
    for (const confirm of ['', 'naggy full heal', 'Naggy', 'delete']) {
      h.log = [];
      expect(await redirectedTo(deleteTrigger(form({ id: 't1', confirm }))), confirm).toBe('/admin/triggers?danger=wrong-phrase');
      expect(writes(), confirm).toEqual([]);
    }
    await deleteTrigger(form({ id: 't1', confirm: 'Naggy full heal' }));
    expect(writes().map(w => `${w.kind} ${w.table}`)).toEqual(['delete guild_triggers']);
    expect(writes()[0].eq).toEqual(['id', 't1']);
    expect(h.revalidated).toEqual(['/admin/triggers']);
  });

  it('a trigger already gone is a quiet no-op; a non-officer is bounced', async () => {
    h.trig = null;
    expect(await redirectedTo(deleteTrigger(form({ id: 't1', confirm: 'x' })))).toBeNull();
    h.trig = { name: 'Naggy full heal' }; h.officer = false;
    expect(await redirectedTo(deleteTrigger(form({ id: 't1', confirm: 'Naggy full heal' })))).toBe('/?error=admin_required');
    expect(writes()).toEqual([]);
  });

  it('the row’s delete folds under delete… with the typed field; switching off stays one click', () => {
    const p = src('app', 'admin', 'triggers', 'page.tsx');
    expect(p).toMatch(/<TypedConfirm phrase=\{t\.name\}/);
    expect(p).toMatch(/<form action=\{toggleEnabled\}>/);
    expect(p).not.toMatch(/async function deleteTrigger/);
  });
});

// ── Every other write is as it was ─────────────────────────────────────────────────────────────────────────────────
describe('the console’s own writes are untouched', () => {
  it('setOverride and clearOverride still carry their phrase and gate', () => {
    const a = src('app', 'admin', 'console', 'actions.ts');
    expect(a).toMatch(/flag_agent_kill: 'PAUSE FLEET'/);
    expect(a).toMatch(/if \(phrase && confirm !== phrase\)/);
  });
});
