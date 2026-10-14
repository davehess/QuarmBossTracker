// test/pop-scope.test.js — /pop opens on the viewer's own characters (the guild lead, 2026-10-14: "The pop flags
// page should start on your characters by default, with mains being the second toggle and all characters being the
// third (grouped by mains like I mentioned)", and "Pop flags breakdown should be a little wider and less dense").
//
// web/lib/popScope.ts is pure, so the default, the explicit params and the old links run for real. The page is read
// as comment-stripped source for the wiring that has no function to call: the toggle order, that All characters
// groups, and the chart's width.
//
// Run: npx vitest run test/pop-scope.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { POP_SCOPES, defaultScope, resolvePopView } from '../web/lib/popScope.ts';

const SIGNED_IN = { signedIn: true, hasCharacters: true };
const SIGNED_OUT = { signedIn: false };
const r = (p, ctx = SIGNED_IN) => resolvePopView(p, ctx);

describe('the default view', () => {
  it('a signed-in member with characters lands on My Characters, its table', () => {
    expect(r({})).toMatchObject({ scope: 'mine', view: 'matrix', groupAlts: false, explicitScope: false });
  });
  it('a signed-out visitor falls back to Mains, its chart', () => {
    expect(r({}, SIGNED_OUT)).toMatchObject({ scope: 'mains', view: 'chart', groupAlts: false });
    expect(defaultScope(SIGNED_OUT)).toBe('mains');
  });
  it('a signed-in member with no linked character has nothing to start on, so Mains', () => {
    expect(r({}, { signedIn: true, hasCharacters: false }).scope).toBe('mains');
  });
  it('cosmetic params (the spell filter, ?all, ?flags) are not a choice of scope', () => {
    // The page passes only scope, view, alts and zone to the resolver; the rest cannot move the default.
    expect(r({ scope: undefined, view: undefined, alts: undefined, zone: undefined }).scope).toBe('mine');
  });
});

describe('explicit params are respected', () => {
  it('every scope can be named, with Chart or Matrix', () => {
    for (const scope of ['mine', 'mains', 'all']) {
      expect(r({ scope, view: 'chart' })).toMatchObject({ scope, view: 'chart', explicitScope: true, explicitView: true });
    }
    expect(r({ scope: 'mains', view: 'matrix' })).toMatchObject({ scope: 'mains', view: 'matrix', groupAlts: false });
    expect(r({ scope: 'mine', view: 'chart' }).view).toBe('chart');
  });
  it('signed out still honours a named scope', () => {
    expect(r({ scope: 'all' }, SIGNED_OUT).scope).toBe('all');
  });
  it('an unknown scope is not a scope: it takes the default, never the raw text', () => {
    expect(r({ scope: 'everyone' })).toMatchObject({ scope: 'mine', explicitScope: false });
    expect(r({ scope: 'ALL' }).scope).toBe('mine');
  });
  it('Mains and All open on the chart, as the page always has', () => {
    expect(r({ scope: 'mains' }).view).toBe('chart');
    expect(r({ scope: 'all' }).view).toBe('chart');
  });
});

describe('All characters is grouped under mains', () => {
  it('its Matrix groups by default', () => {
    expect(r({ scope: 'all', view: 'matrix' })).toMatchObject({ view: 'matrix', groupAlts: true });
  });
  it('?alts=flat is the way back to the flat list', () => {
    expect(r({ scope: 'all', view: 'matrix', alts: 'flat' }).groupAlts).toBe(false);
  });
  it('Mains stays flat unless ?alts=group asks, and the chart never groups', () => {
    expect(r({ scope: 'mains', view: 'matrix' }).groupAlts).toBe(false);
    expect(r({ scope: 'mains', view: 'matrix', alts: 'group' }).groupAlts).toBe(true);
    expect(r({ scope: 'all', view: 'chart' }).groupAlts).toBe(false);
  });
  it('My Characters has its own table, so nothing groups there', () => {
    expect(r({ scope: 'mine', view: 'matrix', alts: 'group' })).toMatchObject({ scope: 'mine', view: 'matrix', groupAlts: false });
  });
});

describe('links that existed before keep their meaning', () => {
  it('?view=mine is My Characters', () => {
    expect(r({ view: 'mine' })).toMatchObject({ scope: 'mine', view: 'matrix', explicitScope: true });
  });
  it('?view=matrix with no scope is the Mains matrix, not the viewer\'s own', () => {
    expect(r({ view: 'matrix' })).toMatchObject({ scope: 'mains', view: 'matrix', groupAlts: false });
  });
  it('?zone=<key> with no scope is Mains', () => {
    expect(r({ zone: 'justice' }).scope).toBe('mains');
  });
  it('?alts=group with no view or scope is the grouped Matrix, as it was on beta', () => {
    expect(r({ alts: 'group' })).toMatchObject({ scope: 'mains', view: 'matrix', groupAlts: true });
  });
  it('?scope=all keeps its chart, and its matrix is now grouped', () => {
    expect(r({ scope: 'all' }).view).toBe('chart');
    expect(r({ scope: 'all', view: 'matrix' }).groupAlts).toBe(true);
  });
});

describe('a view the URL named is carried by the scope links; one it did not name resets', () => {
  it('explicitView says which', () => {
    expect(r({}).explicitView).toBe(false);
    expect(r({ scope: 'mains' }).explicitView).toBe(false);
    expect(r({ scope: 'mains', view: 'matrix' }).explicitView).toBe(true);
    expect(r({ view: 'mine' }).explicitView).toBe(true);
    expect(r({ view: 'sideways' }).explicitView).toBe(false);
  });
});

describe('the toggles on the page', () => {
  const page = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/pop/page.tsx'), 'utf8'));
  it('the scope toggle reads My Characters, Mains, All characters, in that order', () => {
    expect(POP_SCOPES.map(s => s.key)).toEqual(['mine', 'mains', 'all']);
    expect(POP_SCOPES.map(s => s.label)).toEqual(['🧍 My Characters', 'Mains', 'All characters']);
    // The page draws them from that list, in order, rather than hand-writing three links.
    expect(page).toMatch(/\{POP_SCOPES\.map\(s => \(/);
  });
  it('Chart and Matrix are the second toggle; My Characters is no longer a view link', () => {
    expect(page).toMatch(/hrefFor\(\{ view: 'chart', zone: null/);
    expect(page).toMatch(/hrefFor\(\{ view: 'matrix', zone: null \}\)/);
    expect(page).not.toMatch(/view: 'mine'/);
  });
  it('the All link clears an explicit alts so its grouping comes back', () => {
    expect(page).toMatch(/s\.key === 'all' \? \{ scope: 'all', alts: null \} : \{ scope: s\.key \}/);
  });
  it('every link writes the scope out, so none of them falls back to the bare-/pop default', () => {
    expect(page).toMatch(/zone: zoneKey \?\? null, scope,/);
    expect(page).toMatch(/if \(next\.scope\) params\.set\('scope', next\.scope\)/);
    // Zone cards and the planner keep the scope (they used to be bare /pop?zone= links, which now mean Mains).
    expect(page).toMatch(/hrefFor\(\{ zone: z\.key \}\)/);
    expect(page).toMatch(/hrefFor\(\{ zone: p\.zone\.key \}\)/);
    expect(page).not.toMatch(/`\/pop\?zone=/);
  });
  it('the flat list link is ?alts=flat', () => {
    expect(page).toMatch(/hrefFor\(\{ view: 'matrix', alts: 'flat', sort: null, open: null \}\)/);
  });
  it('the page resolves the choice once, after the viewer\'s characters are known', () => {
    expect(page.indexOf('ownedCharacters(user.id)')).toBeLessThan(page.indexOf('resolvePopView('));
    expect(page).toMatch(/hasCharacters: myCharsAll\.length > 0/);
    expect(page).not.toMatch(/scopeParam === 'all'/);
  });
});

describe('the chart is wider and less dense', () => {
  // Sliced on the comment anchors, THEN stripped: the anchors are comments.
  const raw = fs.readFileSync(path.join(ROOT, 'web/app/pop/page.tsx'), 'utf8');
  const chartAt = raw.indexOf('The chart — tier bands');
  const chart = stripJs(raw.slice(chartAt, raw.indexOf('Raid-night planner ──', chartAt)));
  const cardSrc = stripJs(raw.slice(raw.indexOf('function ZoneCard'), raw.indexOf('// The My Characters table')));
  it('uses the site container\'s full width, not the narrow max-w-5xl', () => {
    expect(chart).not.toMatch(/max-w-5xl/);
    expect(chart).toMatch(/<section className="space-y-4">/);
  });
  it('three cards a row on a wide screen, two from sm, one on a phone', () => {
    expect(chart).toMatch(/'sm:grid-cols-2 xl:grid-cols-3'/);
    expect(chart).not.toMatch(/lg:grid-cols-4/);
  });
  it('roomier bands and cards', () => {
    expect(chart).toMatch(/rounded-lg border border-border\/60 p-4 pt-3/);
    expect(chart).toMatch(/grid gap-4/);
    expect(cardSrc).toMatch(/rounded-lg p-4 flex flex-col gap-3/);
    expect(cardSrc).toMatch(/<ul className="space-y-2">/);
  });
  it('a step row keeps its counts on one line and lets the label take the rest', () => {
    expect(cardSrc.match(/leading-5 flex items-baseline justify-between gap-3/g)?.length).toBe(2);
    expect(cardSrc.match(/whitespace-nowrap shrink-0|text-xs shrink-0/g)?.length).toBe(2);
    expect(cardSrc).toMatch(/text-dim min-w-0/);
  });
});
