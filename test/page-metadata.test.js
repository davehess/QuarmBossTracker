// test/page-metadata.test.js — every page unfurls with its own name and a one-line summary.
//
// The guild lead, 2026-10-10, looking at Discord's card for https://wolfpack.quest/feedback/FB-71, which was
// the site-wide "WolfPack.quest — Guild-wide build planner…" card: "discord embedded links for the feedback
// links are generic. all links from our site should include at least top level information and the page
// name. make it a rule".
//
// Two surfaces, and Discord reads only the second:
//   1. each page.tsx's own `metadata` / `generateMetadata` (browser tab, and any crawler the middleware does
//      not rewrite);
//   2. web/lib/pageMeta.ts `metaForPath`, which /api/embed-meta serves to Discord, Slack, Twitter and the rest.
//      The middleware rewrites those crawlers away from the real page (they cannot sign in), so a page's own
//      metadata NEVER reaches a Discord card. A route missing from pageMeta.ts unfurls as the site card.
// This file walks every page.tsx and holds both. Privacy is held too: the crawler is anonymous, so a card
// carries only what a signed-out visitor could already see.
//
// Run: npx vitest run test/page-metadata.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import {
  metaForPath, lookupFor, feedbackMeta, entityMeta, characterMeta, characterName, pvpMeta, raidReviewMeta,
  cleanEntityName, SITE_NAME, DEFAULT_DESCRIPTION, ADMIN_FALLBACK_TITLE,
} from '../web/lib/pageMeta.ts';
import { metaForPathWithData } from '../web/lib/pageMetaData.ts';

const APP = path.join(ROOT, 'web', 'app');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

function walkPages(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkPages(full, out);
    else if (e.name === 'page.tsx') out.push(full);
  }
  return out;
}
const PAGES = walkPages(APP).map(f => ({
  file: f,
  rel: path.relative(path.join(ROOT, 'web'), f).split(path.sep).join('/'),
  route: '/' + path.relative(APP, path.dirname(f)).split(path.sep).join('/').replace(/^\.$/, ''),
  src: stripJs(fs.readFileSync(f, 'utf8')),
}));

// The text of the `{ ... }` that follows `marker`, brace-matched and blind to braces inside string literals.
function blockAfter(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) return null;
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  return null;
}

// Pages served only on eqmimic.quest (the middleware sends that host to its own pair of pages first, so they
// never meet the link-preview rewrite). They still must carry their own metadata; they just have no
// wolfpack.quest card to resolve.
const EQMIMIC = new Set(['/eqmimic', '/eqmimic/feedback']);

const SAMPLE = { ref: 'FB-71', id: '123', name: 'Aldenmar', date: '2026-10-08', code: 'eur', bossId: 'someboss' };
const sampleOf = (route) => route.replace(/\[(\w+)\]/g, (_, k) => SAMPLE[k] ?? 'x');

describe('the walk itself', () => {
  it('finds the pages (a path bug would otherwise make every other test vacuous)', () => {
    expect(PAGES.length).toBeGreaterThan(90);
    expect(PAGES.map(p => p.route)).toContain('/');
    expect(PAGES.map(p => p.route)).toContain('/feedback/[ref]');
    expect(PAGES.map(p => p.route)).toContain('/admin/feedback');
  });
});

describe('every page.tsx names itself (the browser tab)', () => {
  it.each(PAGES.map(p => [p.route, p]))('%s', (_route, p) => {
    const dynamicRoute = p.route.includes('[');
    const hasGen = /export\s+(?:async\s+)?function\s+generateMetadata\b/.test(p.src);
    if (dynamicRoute) {
      // A dynamic route has one `metadata` for every entity, which is exactly the "generic" bug.
      expect(hasGen, `${p.rel} is a dynamic route and must export generateMetadata`).toBe(true);
      expect(/export\s+const\s+metadata\b/.test(p.src), `${p.rel} must not also pin a static metadata`).toBe(false);
      return;
    }
    if (hasGen) return;
    const block = blockAfter(p.src, 'export const metadata');
    expect(block, `${p.rel} must export metadata or generateMetadata`).not.toBeNull();
    expect(block, `${p.rel} metadata needs a title`).toMatch(/\btitle\s*:/);
    expect(block, `${p.rel} metadata needs a one-sentence description`).toMatch(/\bdescription\s*:/);
  });
});

describe('every page unfurls with its own name on Discord (lib/pageMeta.ts)', () => {
  const rows = PAGES.filter(p => !EQMIMIC.has(p.route) && p.route !== '/').map(p => [p.route, p]);
  it.each(rows)('%s', (_route, p) => {
    const m = metaForPath(sampleOf(p.route));
    expect(m.title, `${p.route} unfurls as the site card`).not.toBe(SITE_NAME);
    expect(m.title).not.toBe(ADMIN_FALLBACK_TITLE);
    expect(m.description).not.toBe(DEFAULT_DESCRIPTION);
    expect(m.title.length).toBeGreaterThan(2);
    expect(m.title.length).toBeLessThanOrEqual(110);
    expect(m.description.length).toBeGreaterThan(20);
    expect(m.description.length).toBeLessThanOrEqual(300);
  });
  it('the home page is the site card, on purpose', () => {
    expect(metaForPath('/').title).toBe(SITE_NAME);
  });
  it('a route nobody listed still falls back to the site card rather than throwing', () => {
    expect(metaForPath('/no/such/page').title).toBe(SITE_NAME);
    expect(metaForPath('').title).toBe(SITE_NAME);
  });
});

describe('FB-n links (the report that started this)', () => {
  it('names the number, the category and the status in plain words', () => {
    expect(feedbackMeta(71, 'bug', 'acked').title).toBe('[beta] FB-71 · Bug report · Seen');
    expect(feedbackMeta(12, 'idea', 'on_beta').title).toBe('[beta] FB-12 · Idea · On the beta');
    expect(feedbackMeta(3, 'bug', 'addressed').title).toBe('[beta] FB-3 · Bug report · Fixed and live');
    expect(feedbackMeta(71, 'bug', 'acked').description).toBe('A Wolf Pack feedback report. Sign in to read it and reply.');
  });
  it('an odd category or status reads as a closed-vocabulary word, never the raw value', () => {
    const m = feedbackMeta(5, 'some free text from a member', 'xyzzy-internal-state');
    expect(m.title).toBe('[beta] FB-5 · Feedback · New');
    expect(JSON.stringify(m)).not.toMatch(/free text|xyzzy/);
  });
  it('an unknown or invalid ref is the generic report card', () => {
    expect(feedbackMeta(null).title).toBe('[beta] Feedback report');
    expect(metaForPath('/feedback/banana').title).toBe('[beta] Feedback report');
    expect(metaForPath('/feedback/FB-0').title).toBe('[beta] Feedback report');
  });
  it('a real number with no row says only the number', () => {
    expect(metaForPath('/feedback/FB-71').title).toBe('[beta] FB-71 · Feedback report');
    expect(feedbackMeta(71).title).toBe('[beta] FB-71 · Feedback report');
  });
  it('FB-71 no longer unfurls as the site card', () => {
    expect(metaForPath('/feedback/FB-71').description).not.toBe(DEFAULT_DESCRIPTION);
    expect(metaForPath('/feedback/FB-71').title).not.toBe(SITE_NAME);
  });
});

// A stub database that records every read and hands back a row full of PRIVATE fields. Whatever the code
// selects is all the code can show; whatever it shows must not be one of the private values.
function stubDb(row) {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        select(columns) {
          return {
            eq(column, value) {
              calls.push({ table, columns, column, value });
              return { maybeSingle: async () => ({ data: row }) };
            },
          };
        },
      };
    },
  };
}
const PRIVATE_ROW = {
  ref: 71, category: 'bug', status: 'acked',
  message: 'PRIVATE-MESSAGE the raid leader keeps wiping us', notes: 'PRIVATE-NOTES officer says',
  submitter_name: 'PRIVATE-SUBMITTER', submitter_discord_id: '999', log_excerpt: 'PRIVATE-LOG', screenshot_paths: ['PRIVATE-SHOT'],
};

describe('what an FB-n card may read, and what it may show', () => {
  it('reads ONE row and selects only ref, category, status', async () => {
    const db = stubDb(PRIVATE_ROW);
    const m = await metaForPathWithData('/feedback/FB-71', db);
    expect(db.calls).toEqual([{ table: 'feedback', columns: 'ref, category, status', column: 'ref', value: 71 }]);
    expect(m.title).toBe('[beta] FB-71 · Bug report · Seen');
  });
  it('shows none of the private fields the row happens to hold', async () => {
    const m = await metaForPathWithData('/feedback/FB-71', stubDb(PRIVATE_ROW));
    expect(JSON.stringify(m)).not.toMatch(/PRIVATE|raid leader|wiping|999/);
  });
  it('a missing row, or a database that throws, is the generic number card (an unfurl never errors)', async () => {
    expect((await metaForPathWithData('/feedback/FB-71', stubDb(null))).title).toBe('[beta] FB-71 · Feedback report');
    const boom = { from() { throw new Error('db down'); } };
    expect((await metaForPathWithData('/feedback/FB-71', boom)).title).toBe('[beta] FB-71 · Feedback report');
  });
  it('an invalid ref reads nothing at all', async () => {
    const db = stubDb(PRIVATE_ROW);
    await metaForPathWithData('/feedback/banana', db);
    expect(db.calls).toEqual([]);
  });
  it('the source of the only module that reads selects nothing but ref/category/status and name', () => {
    const src = stripJs(read('web/lib/pageMetaData.ts'));
    const selects = [...src.matchAll(/\.select\(\s*(['"`])([^'"`]*)\1/g)].map(m => m[2]);
    expect(selects.sort()).toEqual(['name', 'name', 'ref, category, status']);
    for (const bad of ['message', 'notes', 'submitter', 'screenshot', 'body', 'log']) {
      expect(src, `pageMetaData.ts must not mention ${bad}`).not.toMatch(new RegExp(`['"\`][^'"\`]*\\b${bad}`, 'i'));
    }
  });
  it('the feedback page takes its title from the same function, and keeps noindex', () => {
    const src = PAGES.find(p => p.route === '/feedback/[ref]').src;
    expect(src).toMatch(/export async function generateMetadata/);
    expect(src).toMatch(/pageMetadata\(`\/feedback\//);
    expect(src).toMatch(/robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
  });
});

describe('catalog and entity pages: the name and the kind, nothing guild-private', () => {
  it('an item, spell, NPC, faction or recipe is "<name> · <kind>"', () => {
    expect(entityMeta('item', 'Ragebringer').title).toBe('Ragebringer · Item');
    expect(entityMeta('spell', 'Harmony').title).toBe('Harmony · Spell');
    expect(entityMeta('npc', '#Lord_Nagafen').title).toBe('Lord Nagafen · NPC');
    expect(entityMeta('faction', 'Dark Reign').title).toBe('Dark Reign · Faction');
    expect(entityMeta('recipe', 'Fine Steel Sword').title).toBe('[beta] Fine Steel Sword · Recipe');
    expect(entityMeta('boss', 'Lord Nagafen').title).toBe('Lord Nagafen · Boss');
    expect(entityMeta('guide', 'Lord Nagafen').title).toBe('Lord Nagafen · Raid guide');
  });
  it('no name is the generic kind card', () => {
    expect(entityMeta('item').title).toBe('Item');
    expect(entityMeta('item', '   ').title).toBe('Item');
    expect(entityMeta('boss', null).description).toMatch(/raid target/);
  });
  it('names are cleaned: one line, bounded, no control characters', () => {
    expect(cleanEntityName('a\nb\tc')).toBe('a b c');
    expect(cleanEntityName('x'.repeat(500)).length).toBe(80);
    expect(cleanEntityName(undefined)).toBe('');
  });
  it('which routes need a read, and which are answered from the URL alone', () => {
    expect(lookupFor('/db/item/5')).toEqual({ kind: 'item', id: 5 });
    expect(lookupFor('/db/faction/9')).toEqual({ kind: 'faction', id: 9 });
    expect(lookupFor('/boss/12345')).toEqual({ kind: 'boss', id: 12345 });
    expect(lookupFor('/guide/nagafen')).toEqual({ kind: 'guide', id: 'nagafen' });
    expect(lookupFor('/feedback/FB-71')).toEqual({ kind: 'feedback', ref: 71 });
    expect(lookupFor('/character/Aldenmar')).toBeNull();
    expect(lookupFor('/parses/abc')).toBeNull();      // a parse is NEVER looked up: its boss, night and DPS are guild data
    expect(lookupFor('/raid/review/2026-10-08')).toBeNull();
    expect(lookupFor('/db/item/abc')).toBeNull();
  });
  it('reads one name column, by id, from the right catalog table', async () => {
    const db = stubDb({ name: 'Ragebringer', stats: 'PRIVATE-STATS' });
    const m = await metaForPathWithData('/db/item/5', db);
    expect(db.calls).toEqual([{ table: 'eqemu_items', columns: 'name', column: 'id', value: 5 }]);
    expect(m.title).toBe('Ragebringer · Item');
    expect(JSON.stringify(m)).not.toMatch(/PRIVATE/);
    const db2 = stubDb({ name: 'Lord_Nagafen' });
    expect((await metaForPathWithData('/boss/77', db2)).title).toBe('Lord Nagafen · Boss');
    expect(db2.calls[0].table).toBe('eqemu_npc_types');
    const db3 = stubDb({ name: 'Nagafen' });
    expect((await metaForPathWithData('/guide/nagafen', db3)).title).toBe('Nagafen · Raid guide');
    expect(db3.calls[0]).toMatchObject({ table: 'bot_boards', columns: 'name', column: 'boss_id', value: 'nagafen' });
  });
  it('a parse page reads nothing and names no boss', async () => {
    const db = stubDb({ name: 'Lord Nagafen' });
    const m = await metaForPathWithData('/parses/0b5f0a3e-1111-2222-3333-444455556666', db);
    expect(db.calls).toEqual([]);
    expect(m.title).toBe('Parse Breakdown');
  });
});

describe('character, PvP and raid-review pages: from the URL alone', () => {
  it('a character is named from the link, with the section when there is one', () => {
    expect(metaForPath('/character/aldenmar').title).toBe('Aldenmar · Character');
    expect(metaForPath('/character/ALDENMAR/gear').title).toBe('Aldenmar · Gear');
    expect(metaForPath('/character/Aldenmar/spells').title).toBe('Aldenmar · Spells');
    expect(metaForPath('/character/Aldenmar/quests').title).toBe('Aldenmar · Quests');
    expect(metaForPath('/pvp/Aldenmar').title).toBe('Aldenmar · PvP record');
  });
  it('reads no database for them, so a hidden or stats-excluded character leaks nothing', async () => {
    const db = stubDb({ name: 'PRIVATE', hidden_from_lists: true });
    await metaForPathWithData('/character/Aldenmar', db);
    await metaForPathWithData('/character/Aldenmar/gear', db);
    await metaForPathWithData('/pvp/Aldenmar', db);
    expect(db.calls).toEqual([]);
  });
  it('a name that is not letters is the generic page card, and a bad %-escape does not throw', () => {
    expect(characterName('(unknown)')).toBeNull();
    expect(characterName('a')).toBeNull();
    expect(characterName('<script>')).toBeNull();
    expect(characterMeta('(unknown)').title).toBe('Character');
    expect(characterMeta('(unknown)', 'gear').title).toBe('Character gear');
    expect(pvpMeta('x1').title).toBe('PvP record');
    expect(() => metaForPath('/character/%E0%A4%A')).not.toThrow();
    expect(metaForPath('/character/%E0%A4%A').title).toBe('Character');
  });
  it('a raid review is named by its date; an impossible date is the generic card', () => {
    expect(raidReviewMeta('2026-10-08').title).toBe('Raid night review · Oct 8, 2026');
    expect(raidReviewMeta('2026-02-30').title).toBe('Raid night review');
    expect(raidReviewMeta('tomorrow').title).toBe('Raid night review');
  });
});

describe('officer pages', () => {
  it('each unfurls as "<name> · Admin" and says sign-in is required', () => {
    expect(metaForPath('/admin/feedback').title).toBe('Feedback · Admin');
    expect(metaForPath('/admin/triggers').title).toBe('Guild triggers · Admin');
    expect(metaForPath('/admin/feedback').description).toMatch(/Officer sign-in required/);
  });
  it('the admin layout keeps every officer page out of search results', () => {
    const layout = stripJs(read('web/app/admin/layout.tsx'));
    expect(layout).toMatch(/export const metadata\s*=\s*\{\s*robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}\s*\}/);
  });
});

describe('Next fills OG title and description from the page, because the root no longer pins them', () => {
  const layout = stripJs(read('web/app/layout.tsx'));
  const og = blockAfter(layout, 'openGraph:');
  it('the root openGraph block exists and names the site', () => {
    expect(og).not.toBeNull();
    expect(og).toMatch(/siteName\s*:/);
  });
  it('and pins no title, description or url (each would win over every page\'s own)', () => {
    expect(og).not.toMatch(/\btitle\s*:/);
    expect(og).not.toMatch(/\bdescription\s*:/);
    expect(og).not.toMatch(/\burl\s*:/);
  });
  it('the root keeps a default title and description for a page that sets neither', () => {
    expect(layout).toMatch(/default:\s+IS_BETA/);
    expect(layout).toMatch(/\n  description:\s*'Guild-wide build planner/);
  });
});

describe('the Discord crawler path serves what this file checks', () => {
  it('/api/embed-meta resolves the path through metaForPathWithData, not the URL-only function', () => {
    const route = stripJs(read('web/app/api/embed-meta/route.ts'));
    expect(route).toMatch(/await metaForPathWithData\(path\)/);
    expect(route).not.toMatch(/\bmetaForPath\(/);
  });
  it('the middleware still rewrites preview crawlers to it', () => {
    const mw = stripJs(read('web/middleware.ts'));
    expect(mw).toMatch(/PREVIEW_BOT_RX\.test/);
    expect(mw).toMatch(/pathname = '\/api\/embed-meta'/);
  });
});
