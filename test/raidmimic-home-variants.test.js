// test/raidmimic-home-variants.test.js — the signed-in top of raidmimic.com, in two preview shapes (the guild lead, 2026-11-09:
// "site looks barebones here"): `?v=b` Dashboard and `?v=c` Get started, read on the Wolf Pack hosts only.
//
// Pins: no `?v=` (or an unknown one) is today's HomePanel path; `?v=b` / `?v=c` select the variants; a raidmimic host ignores
// the query; the "coming" things are never links or buttons; and no raidmimic-host words spell the Wolf Pack web address.
// Pure helpers are RUN; the page wiring and the components are checked over comment-stripped source (CLAUDE.md, "comments
// satisfy text assertions").
//
// Run: npx vitest run test/raidmimic-home-variants.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import {
  homeVariant, checklistSteps, comingLine, toHomeGuilds, HOME_WORDS, DASH_WORDS, STEPS_WORDS,
} from '../web/lib/raidmimicHome.ts';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel) => stripJs(read(rel));
const LAND = 'web/app/raidmimic/_landing';

describe('homeVariant: which preview a ?v= selects', () => {
  it('no v, an unknown v, and non-strings are today\'s page', () => {
    for (const v of [undefined, null, '', 'a', 'B', 'd', 'bc', ['b'], 1, {}]) expect(homeVariant(v, false), String(v)).toBeNull();
  });
  it('b and c select their variants on a Wolf Pack host', () => {
    expect(homeVariant('b', false)).toBe('b');
    expect(homeVariant('c', false)).toBe('c');
  });
  it('a raidmimic host ignores the variants', () => {
    expect(homeVariant('b', true)).toBeNull();
    expect(homeVariant('c', true)).toBeNull();
  });
});

describe('the page wiring', () => {
  const page = code('web/app/raidmimic/page.tsx');
  it('reads v only through homeVariant, with the host check', () => {
    expect(page).toMatch(/homeVariant\(searchParams\?\.v, onHost\)/);
    expect(page).not.toMatch(/searchParams\??\.v\s*===/);
  });
  it('no variant keeps the HomePanelGate path; the variants replace it and never both', () => {
    expect(page).toMatch(/if \(variant\) \{[\s\S]*?HomeDashboard[\s\S]*?HomeChecklist[\s\S]*?\} else \{\s*top = <HomePanelGate[\s\S]*?<HomePanel mine=/);
  });
  it('a variant needs a signed-in Discord id: signed out is the stage whatever v says', () => {
    expect(page).toMatch(/let top = <StoryStage[^\n]*\/>;\s*if \(user && discordId\) \{\s*if \(variant\)/);
  });
  it('the variants carry the bar at the top; the page\'s own bar stays host-only, below', () => {
    expect(code(`${LAND}/HomeDashboard.tsx`)).toMatch(/<section[^>]*>\s*<HostBar \/>/);
    expect(code(`${LAND}/HomeChecklist.tsx`)).toMatch(/<section[^>]*>\s*<HostBar \/>/);
    expect(page).toMatch(/\{onHost && <HostBar \/>\}/);
  });
  it('the signed-out path is untouched: the stage is the default `top`', () => {
    expect(page).toMatch(/let top = <StoryStage downloadUrl=\{DOWNLOAD_URL\} onHost=\{onHost\} \/>;/);
  });
});

describe('Get started checklist: statuses', () => {
  it('five steps in order; signed in done, Mimic to do, coordination coming', () => {
    const s = checklistSteps(0, 0);
    expect(s.map(x => x.key)).toEqual(['signedIn', 'mimic', 'characters', 'guild', 'coordination']);
    expect(s.map(x => x.n)).toEqual([1, 2, 3, 4, 5]);
    expect(s.map(x => x.status)).toEqual(['done', 'todo', 'todo', 'todo', 'coming']);
  });
  it('characters is done once any are loaded; guild once the player has any', () => {
    expect(checklistSteps(3, 0).map(x => x.status)).toEqual(['done', 'todo', 'done', 'todo', 'coming']);
    expect(checklistSteps(0, 1).map(x => x.status)).toEqual(['done', 'todo', 'todo', 'done', 'coming']);
    expect(checklistSteps(3, 1).map(x => x.status)).toEqual(['done', 'todo', 'done', 'done', 'coming']);
  });
  it('Mimic stays to do whatever else is true (a download cannot be seen from here)', () => {
    expect(checklistSteps(9, 9)[1].status).toBe('todo');
  });
});

describe('coming things are labelled coming and are never links or buttons', () => {
  it('the dashboard\'s coming line is one plain paragraph built from the same ideas', () => {
    const line = comingLine();
    expect(line.startsWith('Coming: looking for flags or loot · ')).toBe(true);
    expect(line.split(' · ')).toHaveLength(HOME_WORDS.coming.length);
    const src = code(`${LAND}/HomeDashboard.tsx`);
    expect(src).toMatch(/<p data-coming [^>]*>\{comingLine\(\)\}<\/p>/);
  });
  it('the coordination step has no anchor or button, whatever its status text', () => {
    const src = code(`${LAND}/HomeChecklist.tsx`);
    // The only per-step actions are keyed on the other four steps.
    const actions = [...src.matchAll(/s\.key === '(\w+)'/g)].map(m => m[1]);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions).not.toContain('coordination');
    expect(src).not.toMatch(/<button/);
  });
  it('neither coming text sits inside an anchor', () => {
    for (const f of ['HomeDashboard.tsx', 'HomeChecklist.tsx']) {
      const src = code(`${LAND}/${f}`);
      for (const a of src.matchAll(/<a [\s\S]*?<\/a>/g)) {
        expect(a[0], f).not.toMatch(/comingLine|W\.coming|W\.coordination|coordination\./);
      }
    }
  });
});

describe('guilds list', () => {
  it('toHomeGuilds puts the built-in guild first with its configured site, then hosted guilds', () => {
    const g = toHomeGuilds({ key: 'wp', name: 'Wolf Pack' }, [{ guild_id: 'zz', name: 'Zed', site: null }, { guild_id: 'aa', name: 'Aye', site: 'https://aye.example' }], 'https://wp.example/');
    expect(g).toEqual([
      { key: 'wp', name: 'Wolf Pack', site: 'https://wp.example' },
      { key: 'zz', name: 'Zed', site: null },
      { key: 'aa', name: 'Aye', site: 'https://aye.example' },
    ]);
  });
  it('no built-in guild membership and no site is an empty list / null site', () => {
    expect(toHomeGuilds(null, [], 'https://wp.example')).toEqual([]);
    expect(toHomeGuilds({ key: 'wp', name: 'Wolf Pack' }, [], null)[0].site).toBeNull();
  });
  it('the /guilds page and the previews share one loader module (no second copy of the reads)', () => {
    const guilds = code('web/app/guilds/page.tsx');
    expect(guilds).toMatch(/from '@\/lib\/hubGuildsLoad'/);
    expect(guilds).not.toMatch(/async function (loadWolfPack|loadHubGuilds)/);
    expect(code('web/lib/hubGuildsLoad.ts')).toMatch(/export async function loadHubGuilds/);
  });
  it('each guild links to the stay-on-page route, and the site link names the guild, not the address', () => {
    const src = code(`${LAND}/HomeDashboard.tsx`);
    expect(src).toMatch(/href=\{GUILDS_STAY_PATH\}/);
    expect(src).toMatch(/Open \{g\.name\}&rsquo;s site/);
    expect(src).not.toMatch(/siteLabel/);
  });
});

describe('no raidmimic-host words spell the Wolf Pack address', () => {
  const ADDRESS = /wolfpack\.quest/i;
  const CONSTANTS = /\b(?:PROD_SITE_URL|BETA_SITE_URL|WOLFPACK_ORIGIN|PRIVACY_URL)\b/;
  const strings = (o) => Object.values(o).flatMap(v => (typeof v === 'string' ? [v] : typeof v === 'object' && v ? strings(v) : []));
  it('every word the variants show is free of it', () => {
    for (const t of [...strings(DASH_WORDS), ...strings(STEPS_WORDS), comingLine()]) expect(t).not.toMatch(ADDRESS);
  });
  it('the new components and loader never name it or the constants that hold it', () => {
    for (const f of [`${LAND}/HomeDashboard.tsx`, `${LAND}/HomeChecklist.tsx`, `${LAND}/HomeParts.tsx`, 'web/lib/hubGuildsLoad.ts', 'web/lib/raidmimicHome.ts']) {
      expect(code(f), f).not.toMatch(ADDRESS);
      expect(code(f), f).not.toMatch(CONSTANTS);
    }
  });
  it('a guild\'s site address is only ever an href, never printed text', () => {
    const src = code(`${LAND}/HomeDashboard.tsx`);
    expect(src).not.toMatch(/\{g\.site\}</);
  });
});

describe('player text and tokens', () => {
  it('names render as plain text: no raw HTML injection in the previews', () => {
    for (const f of ['HomeDashboard.tsx', 'HomeChecklist.tsx', 'HomeParts.tsx']) expect(code(`${LAND}/${f}`), f).not.toMatch(/dangerouslySetInnerHTML/);
  });
  it('no raw hex in the new components', () => {
    for (const f of ['HomeDashboard.tsx', 'HomeChecklist.tsx', 'HomeParts.tsx']) expect(code(`${LAND}/${f}`), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
