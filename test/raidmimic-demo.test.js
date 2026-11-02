// test/raidmimic-demo.test.js — the click-through demo on raidmimic.com/demo (the guild lead, 2026-11-02: "lets set up a demo
// clickthrough site for raidmimic.com as well so they can see what it looks like for the guild, but without killing the
// resources"; DECISIONS 2026-11-02). An INVENTED guild, "Silverpine Vanguard", served from one fixture with no database.
//
// What this pins:
//   - the resource rule: no demo file reads a database, a session, cookies, a query or the network, and none is a client
//     component; the one request read is the host (DemoShell.tsx, for the links and the Raid Mimic frame). The pages are
//     NOT force-static: a static page cannot see the host, so the root layout would bake the Wolf Pack header into it.
//   - the fixture holds only invented names, every flag key in it is one the real libraries know, and a target's pieces
//     are really pieces of its gate,
//   - the routing: raidmimic.com/demo and /demo/<page> reach the demo (the long /raidmimic/demo form too), the rest of the
//     host still reaches the landing page, and the demo never takes the sign-in path,
//   - the numbers, RUN through the real gate rules (gateReport): three raiders' verdicts, and the report rule: a report
//     adds a flag but never turns anything into a "missing",
//   - every page names itself (metadata + the pageMeta.ts card) with no raider name in it.
//
// Source-text assertions run over comment-stripped source (CLAUDE.md "comments satisfy text assertions").
// Run: npx vitest run test/raidmimic-demo.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import * as D from '../web/lib/demoGuild.ts';
import { GATES, ALL_PIECES, gatePieces } from '../web/lib/popGatePieces.ts';
import { gateReport } from '../web/lib/popGateStatus.ts';
import { POP_FLAGS, POP_ZONE_BY_KEY } from '../web/lib/popFlags.ts';
import { POP_STEPS, STEP_IMPLIES } from '../web/lib/popSteps.ts';
import { RECITAL_STAGES, PENDING_MEMORIES, STAGE_IMPLIES } from '../web/lib/popRecital.ts';
import { raidmimicLandingTarget, isRaidmimicOpenPath, RAIDMIMIC_DEMO_PATH } from '../web/lib/raidmimicHost.ts';
import { metaForPath } from '../web/lib/pageMeta.ts';

const DEMO_DIR = path.join(ROOT, 'web', 'app', 'raidmimic', 'demo');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(full);
  }
  return out;
}
const FILES = walk(DEMO_DIR).map(f => ({ rel: path.relative(ROOT, f).split(path.sep).join('/'), src: stripJs(fs.readFileSync(f, 'utf8')) }));
const PAGES = FILES.filter(f => f.rel.endsWith('/page.tsx')).map(f => ({
  ...f, route: '/' + path.relative(path.join(ROOT, 'web', 'app'), path.dirname(path.join(ROOT, f.rel))).split(path.sep).join('/'),
}));
const FIXTURE = stripJs(read('web', 'lib', 'demoGuild.ts'));

const INVENTED = ['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin', 'Orlindra', 'Sorvane', 'Tavrin', 'Ulwen', 'Veyra', 'Wendrel', 'Yselka', 'Dunmarrow'];
const byName = (n) => D.CHARS.find(c => c.name === n);

describe('the walk itself', () => {
  it('finds the seven pages (a path bug would make every other test vacuous)', () => {
    expect(PAGES.map(p => p.route).sort()).toEqual([
      '/raidmimic/demo', '/raidmimic/demo/capture', '/raidmimic/demo/events', '/raidmimic/demo/events/needs',
      '/raidmimic/demo/flags', '/raidmimic/demo/flags/[gate]', '/raidmimic/demo/raid',
    ]);
    expect(FILES.length).toBeGreaterThanOrEqual(10);
  });
});

describe('the resource rule: no database, no session; the host is the only request read', () => {
  it.each(PAGES.map(p => [p.route, p]))('%s is not force-static and sets no revalidate or runtime', (_r, p) => {
    expect(p.src).not.toMatch(/export\s+const\s+dynamic\b/);
    expect(p.src).not.toMatch(/export\s+const\s+(?:revalidate|runtime)\b/);
  });

  it('no file under the demo (nor the fixture) reaches a database, a session, a request or the network', () => {
    for (const f of [...FILES, { rel: 'web/lib/demoGuild.ts', src: FIXTURE }]) {
      const shell = f.rel.endsWith('_parts/DemoShell.tsx');
      expect(f.src, f.rel).not.toMatch(/from\s+['"][^'"]*supabase[^'"]*['"]/);
      if (!shell) expect(f.src, f.rel).not.toMatch(/from\s+['"]next\/headers['"]/);
      expect(f.src, f.rel).not.toMatch(/\bcookies\s*\(/);
      // the shell reads the Host header and nothing else from the request
      expect(f.src.replace(/headers\(\)\.get\('host'\)/g, ''), f.rel).not.toMatch(/\bheaders\s*\(/);
      expect(f.src, f.rel).not.toMatch(/\bsearchParams\b/);
      expect(f.src, f.rel).not.toMatch(/\bfetch\s*\(/);
      expect(f.src, f.rel).not.toMatch(/\b(?:getSessionUser|isOfficer|createClient|useSearchParams)\b/);
      expect(f.src, f.rel).not.toMatch(/['"]use client['"]/);
      expect(f.src, f.rel).not.toMatch(/\bserver-only\b|['"]use server['"]/);
    }
  });

  it('the demo takes no ?v= variant and no query: the two event boards are two routes', () => {
    const a = PAGES.find(p => p.route === '/raidmimic/demo/events');
    const b = PAGES.find(p => p.route === '/raidmimic/demo/events/needs');
    expect(a && b).toBeTruthy();
    expect(a.src).toMatch(/Option A/);
    expect(b.src).toMatch(/Option B/);
  });

  it('every gate has a static page: the dynamic route lists them all (but the default, which is /flags)', () => {
    const gate = PAGES.find(p => p.route === '/raidmimic/demo/flags/[gate]');
    expect(gate.src).toMatch(/export\s+function\s+generateStaticParams/);
    expect(gate.src).toMatch(/export\s+const\s+dynamicParams\s*=\s*false/);
    expect(gate.src).toMatch(/GATE_CHOICES\.filter\(g => g\.key !== DEMO_DEFAULT_GATE\)/);
    expect(D.GATE_CHOICES.map(g => g.key)).toEqual(GATES.map(g => g.key));
    expect(GATES.some(g => g.key === D.DEMO_DEFAULT_GATE)).toBe(true);
  });

  it('the flags page reuses the real GateTable and does not copy it', () => {
    const view = FILES.find(f => f.rel.endsWith('_parts/FlagsView.tsx')).src;
    expect(view).toMatch(/import GateTable from ['"]@\/app\/pop\/guide\/GateTable['"]/);
    expect(view).toMatch(/<GateTable\b/);
    expect(view).toMatch(/hrefFor=\{flagsHref\}/);
  });

  it('no CSS hides the root layout: on raidmimic.com the bare shell has no Wolf Pack chrome, and the demo wears the Raid Mimic frame', () => {
    expect(FILES.some(f => f.rel.endsWith('demo/layout.tsx'))).toBe(false);
    const shell = FILES.find(f => f.rel.endsWith('_parts/DemoShell.tsx')).src;
    expect(shell).toMatch(/import HostFrame from '@\/components\/RaidmimicFrame';/);
    expect(shell).toMatch(/<HostFrame onHost=\{onRaidmimic\(\)\} width="max-w-5xl">/);
    expect(shell).toMatch(/return onRaidmimic\(\) \? '\/demo' : RAIDMIMIC_DEMO_PATH;/);
  });

  it('the buttons do nothing: no handler, no form, no action anywhere in the demo', () => {
    for (const f of FILES) {
      expect(f.src, f.rel).not.toMatch(/\bon(?!Host=)[A-Z][A-Za-z]+=\{/);   // onHost is the frame's prop, not a handler
      expect(f.src, f.rel).not.toMatch(/<form\b|\baction=\{/);
    }
  });
});

describe('the fixture is invented', () => {
  it('holds exactly the invented raiders, fourteen of them, once each', () => {
    expect(D.DEMO_NAMES.slice().sort()).toEqual(INVENTED.slice().sort());
    expect(new Set(D.DEMO_NAMES).size).toBe(14);
    expect(D.GUILD.name).toBe('Silverpine Vanguard');
  });

  it('every name an event, report or the capture flow mentions is one of them', () => {
    const mentioned = new Set([
      ...D.EVENTS.flatMap(e => [e.by, ...e.signed]), ...D.AVAILABLE_THIS_WEEK,
      ...D.CHARS.flatMap(c => (c.reported ? [c.reported.by] : [])), D.CAPTURE.leader, D.CAPTURE.subject,
    ]);
    for (const n of mentioned) expect(INVENTED, n).toContain(n);
  });

  it('no raider name is hidden in a page, a part or the Discord-facing strings but via the fixture', () => {
    // The pages reach names through the fixture; the only name a page may write itself is none.
    for (const f of FILES) for (const n of INVENTED) expect(f.src, `${f.rel} writes ${n}`).not.toContain(n);
  });

  it('every flag key is one the real libraries know', () => {
    const known = new Set([
      ...Object.keys(POP_FLAGS), ...Object.values(POP_STEPS).flat().map(s => s.key),
      ...RECITAL_STAGES.map(([, k]) => k), ...PENDING_MEMORIES.map(m => m.key),
      ...Object.keys(STEP_IMPLIES), ...Object.keys(STAGE_IMPLIES),   // zeks_5 is a series value the Seer never prints alone
    ]);
    for (const c of D.CHARS) for (const k of [...c.confirmed, ...(c.reported?.flags ?? [])]) expect(known.has(k), `${c.name}: ${k}`).toBe(true);
  });

  it('every target\'s pieces are real pieces of its gate', () => {
    expect(D.TARGETS.length).toBeGreaterThanOrEqual(5);
    for (const t of D.TARGETS) {
      const inGate = gatePieces(POP_ZONE_BY_KEY[t.gate]).map(p => p.key);
      for (const k of t.pieces) {
        expect(ALL_PIECES.some(p => p.key === k), k).toBe(true);
        expect(inGate, `${t.key}: ${k} is not in ${t.gate}`).toContain(k);
      }
    }
    for (const e of D.EVENTS) expect(D.targetByKey(e.target), e.id).toBeTruthy();
  });

  it('a report names a different raider than its subject, and each report has at least one flag', () => {
    for (const c of D.CHARS.filter(x => x.reported)) {
      expect(c.reported.by).not.toBe(c.name);
      expect(c.reported.flags.length).toBeGreaterThan(0);
    }
  });
});

describe('routing: raidmimic.com/demo reaches the demo', () => {
  it('the short and the long form both rewrite to /raidmimic/demo/..., path kept, query dropped', () => {
    expect(RAIDMIMIC_DEMO_PATH).toBe('/raidmimic/demo');
    const cases = {
      '/demo': '/raidmimic/demo', '/demo/': '/raidmimic/demo', '/Demo': '/raidmimic/demo',
      '/demo/flags': '/raidmimic/demo/flags', '/demo/flags/torment': '/raidmimic/demo/flags/torment',
      '/demo/capture': '/raidmimic/demo/capture', '/demo/events': '/raidmimic/demo/events',
      '/demo/events/needs': '/raidmimic/demo/events/needs', '/DEMO/Events/Needs/': '/raidmimic/demo/events/needs',
      '/demo/raid': '/raidmimic/demo/raid',
      '/raidmimic/demo': '/raidmimic/demo', '/raidmimic/demo/events/needs': '/raidmimic/demo/events/needs',
    };
    for (const [from, to] of Object.entries(cases)) expect(raidmimicLandingTarget(from), from).toEqual({ pathname: to, search: '' });
  });

  it('every page of the demo is reachable by its short address', () => {
    for (const p of PAGES.filter(x => !x.route.includes('['))) {
      const short = p.route.replace('/raidmimic', '');
      expect(raidmimicLandingTarget(short).pathname, short).toBe(p.route);
    }
    for (const g of GATES) expect(raidmimicLandingTarget(`/demo/flags/${g.key}`).pathname).toBe(`/raidmimic/demo/flags/${g.key}`);
  });

  it('odd paths still land on the landing page; the other pages are untouched', () => {
    for (const p of ['/demo/a/b/c/d', '/demo/..', '/demo/x_y', '/demo//flags', '/demos', '/demo.html', '/demo/flags?x=1', '/x/demo']) {
      expect(raidmimicLandingTarget(p).pathname, p).toBe('/raidmimic');
    }
    expect(raidmimicLandingTarget('/register').pathname).toBe('/raidmimic/register');
    expect(raidmimicLandingTarget('/setup').pathname).toBe('/raidmimic/setup');
    expect(raidmimicLandingTarget('/privacy').pathname).toBe('/raidmimic/privacy');
    expect(raidmimicLandingTarget('/').pathname).toBe('/raidmimic');
    expect(raidmimicLandingTarget('/raidmimic/register').pathname).toBe('/raidmimic');
  });

  it('the demo is not a sign-in path: the middleware rewrites it before any session work', () => {
    for (const p of ['/demo', '/demo/flags', '/raidmimic/demo', '/raidmimic/demo/events/needs']) expect(isRaidmimicOpenPath(p), p).toBe(false);
    const mw = stripJs(read('web', 'middleware.ts'));
    expect(mw).toMatch(/isRaidmimicHost\(request\.headers\.get\('host'\)\) && !isRaidmimicOpenPath\(request\.nextUrl\.pathname\)/);
    expect(mw).toMatch(/raidmimicLandingTarget\(request\.nextUrl\.pathname\)/);
  });

  it('the demo\'s own links start from demoBase(): /demo on raidmimic.com, /raidmimic/demo elsewhere; none is hard-coded', () => {
    for (const f of FILES) {
      const links = [...f.src.matchAll(/href=["'`{]+\s*([^"'`}]+)/g)].map(m => m[1]).filter(h => h.startsWith('/'));
      expect(links, f.rel).toEqual([]);
    }
    for (const f of FILES.filter(x => /\$\{BASE\}/.test(x.src))) expect(f.src, f.rel).toMatch(/const BASE = demoBase\(\);/);
  });
});

describe('the numbers, run through the real gate rules', () => {
  const solro = POP_ZONE_BY_KEY.solro;
  const verdict = (name, mode = 'confirmed') => D.reportFor(byName(name), 'solro', mode).verdict;

  it('a raider with every piece of the Sol Ro gate has nothing left', () => {
    expect(verdict('Aldenmar')).toEqual({ tone: 'done', text: 'Nothing left here' });
  });

  it('a raider with the cipher halves and one set of notes needs a kill, then Maelin', () => {
    expect(verdict('Corvale')).toEqual({ tone: 'blocked', text: 'No, needs a Tallon kill, then Maelin' });
  });

  it('a raider with both kills and only Maelin to visit says so', () => {
    expect(verdict('Veyra')).toEqual({ tone: 'handins', text: 'Yes, only Maelin left' });
  });

  it('a held Seer memory is a hand-in owed, not a kill owed', () => {
    expect(verdict('Rethlan').text).toBe('No, needs a Vallon kill and a Tallon kill, then the Seer and Maelin');
    const sar = D.reportFor(byName('Rethlan'), 'solro', 'confirmed').pieces.find(p => p.key === 'c_saryrn');
    expect(sar.state).toBe('pending');
  });

  it('GateTable gets one row per raider with the same pieces in every row', () => {
    const rows = D.gateRows('solro', 'confirmed');
    expect(rows.length).toBe(14);
    const heads = rows[0].pieces.map(p => p.key);
    expect(heads).toEqual(gatePieces(solro).map(p => p.key));
    for (const r of rows) expect(r.pieces.map(p => p.key)).toEqual(heads);
  });

  it('every gate builds for every raider', () => {
    for (const g of GATES) for (const c of D.CHARS) {
      const r = D.reportFor(c, g.key, 'planning');
      expect(r.pieces.length, `${c.name} ${g.key}`).toBe(gatePieces(g).length);
      expect(gateReport(g, { flags: c.confirmed, fullRead: c.fullRead }).verdict.text.length).toBeGreaterThan(0);
    }
  });

  it('THE REPORT RULE: a report only adds. It never makes a ❌, and never un-does a ✅', () => {
    for (const g of GATES) for (const c of D.CHARS) {
      const before = D.reportFor(c, g.key, 'confirmed').pieces;
      const after = D.reportFor(c, g.key, 'planning').pieces;
      before.forEach((b, i) => {
        if (b.state === 'done') expect(after[i].state, `${c.name} ${g.key} ${b.key}`).toBe('done');
        if (after[i].state === 'missing') expect(b.state, `${c.name} ${g.key} ${b.key}`).toBe('missing');
      });
    }
  });

  it('a raider with only reports and no read of their own is never ❌ on anything', () => {
    const own = D.CHARS.filter(c => !c.fullRead);
    expect(own.map(c => c.name).sort()).toEqual(['Brackwyn', 'Tavrin', 'Yselka']);
    for (const g of GATES) for (const c of own) {
      for (const mode of ['confirmed', 'planning']) {
        expect(D.reportFor(c, g.key, mode).pieces.every(p => p.state !== 'missing'), `${c.name} ${g.key} ${mode}`).toBe(true);
      }
    }
    expect(verdict('Brackwyn').text).toMatch(/^Nothing recorded yet/);
  });

  it('the reported table marks exactly the pieces a report completed', () => {
    const rows = D.reportedRows('solro');
    expect(rows.map(r => r.name)).toEqual(['Brackwyn', 'Tavrin']);
    const flagged = (r) => r.cells.filter(c => c.reported).map(c => c.piece.key);
    expect(flagged(rows[0])).toEqual(['c_saryrn', 'c_marr', 'c_maelin']);
    expect(flagged(rows[1])).toEqual(['z_vallon', 'z_tallon']);
    for (const r of rows) for (const c of r.cells) if (c.reported) expect(c.piece.state).toBe('done');
  });

  it('who needs a target: a real "no" is separate from "not recorded"', () => {
    const marr = D.needsFor(D.targetByKey('marr-trials'));
    expect(marr.need.map(c => c.name)).toEqual(['Zarrin', 'Orlindra', 'Sorvane']);
    expect(marr.unsure.map(c => c.name)).toEqual(['Tavrin', 'Yselka']);
    expect(marr.need.length + marr.unsure.length + marr.done.length).toBe(14);
    // Brackwyn's report counts here: the Saryrn half is done, so she does not need Saryrn.
    const saryrn = D.needsFor(D.targetByKey('saryrn'));
    expect(saryrn.need.map(c => c.name)).toEqual(['Orlindra', 'Sorvane']);
    expect(saryrn.done.map(c => c.name)).toContain('Brackwyn');
  });

  it('the needs board ranks something, schedules some targets and leaves others open', () => {
    const counts = D.TARGETS.map(t => D.needsFor(t).need.length);
    expect(new Set(counts).size).toBeGreaterThan(2);
    const scheduled = D.TARGETS.filter(t => D.eventByTarget(t.key));
    expect(scheduled.length).toBeGreaterThan(0);
    expect(scheduled.length).toBeLessThan(D.TARGETS.length);
  });

  it('tonight\'s plan: signed raiders against the flags the pull needs', () => {
    const rows = D.tonightRows();
    expect(rows.map(r => r.name)).toEqual(D.EVENTS.find(e => e.id === D.TONIGHT.eventId).signed);
    const row = (n) => rows.find(r => r.name === n);
    expect(row('Aldenmar').ready).toBe(true);
    expect(row('Orlindra').fix).toEqual(['Villagers', 'Nomads']);
    expect(row('Veyra').fix).toEqual(['Aerin`Dar + projection']);
    expect(row('Tavrin')).toMatchObject({ ready: false, fix: [], unsure: true });
    for (const r of rows) expect(r.pieces.length).toBe(4);
  });
});

describe('every page names itself, with no raider in the name', () => {
  const NAMES = new RegExp(`\\b(?:${INVENTED.join('|')})\\b`);
  it.each(PAGES.map(p => [p.route, p]))('%s', (route, p) => {
    expect(p.src).toMatch(/\btitle\s*:/);
    expect(p.src).toMatch(/\bdescription\s*:/);
    expect(p.src).toMatch(/robots:\s*\{\s*index:\s*false/);   // a demo copy is never indexed
    const m = metaForPath(route.replace(/\[gate\]/, 'torment'));
    expect(m.title).toMatch(/^\[beta\] Demo guild/);
    expect(m.title).not.toBe('WolfPack.quest');
    expect(m.description.length).toBeGreaterThan(40);
    expect(`${m.title} ${m.description}`).not.toMatch(NAMES);
    expect(`${m.title} ${m.description}`).toMatch(/Invented guild|invented guild|nothing is real/i);
  });

  it('the bar every page carries says what it is', () => {
    expect(D.DEMO_BAR).toBe('[beta] Demo — invented guild, nothing here is real');
    const shell = FILES.find(f => f.rel.endsWith('_parts/DemoShell.tsx')).src;
    expect(shell).toMatch(/DEMO_BAR/);
    expect(shell).toMatch(/https:\/\/raidmimic\.com\/register/);
    expect(shell).toMatch(/Get this for your guild/);
    for (const p of PAGES) expect(p.src, p.route).toMatch(/<DemoShell\b|<FlagsView\b/);
  });
});
