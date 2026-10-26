// test/local-me-door.test.js — FB-98: "NEED /ME to go to the me section that matches with the website. I couldn't
// easily find where to turn on or off characters having their inventories synced or hidden."
//
//   * The local site (web/local, bundled into Mimic) had Inventory / My parses / My replay and no "/me", the door the
//     website's own nav has. It now has a /me page, first in the nav.
//   * That page, and the local inventory page, point at the website's "My Characters" section by anchor
//     (wolfpack.quest/me#my-characters), where each character's switches live; the website says in words which
//     buttons they are, using the labels the buttons really carry.
//
// Text tier over comment-stripped source (a comment that quotes a link must not satisfy these), with the anchor
// cross-checked in BOTH directions: a link to an id nothing carries is a dead jump, and nothing would error.
//
// Run: npx vitest run test/local-me-door.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';

const src = (...p) => stripJs(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));
const nav = src('web', 'local', 'app', 'LocalNav.tsx');
const mePage = src('web', 'local', 'app', 'me', 'page.tsx');
const localInv = src('web', 'local', 'app', 'inventory', 'LocalInventory.tsx');
const siteMe = src('web', 'app', 'me', 'page.tsx');
const toggles = src('web', 'app', 'me', 'ExclusionToggles.tsx');

describe('the local nav has a /me door, first', () => {
  const pages = nav.slice(nav.indexOf('const PAGES'), nav.indexOf('];', nav.indexOf('const PAGES')));
  it('lists /me, spelled like the website chip, before Inventory', () => {
    expect(pages).toMatch(/href: '\/me\/',\s+label: '\/me'/);
    expect(pages.indexOf("'/me/'")).toBeGreaterThan(-1);
    expect(pages.indexOf("'/me/'")).toBeLessThan(pages.indexOf("'/inventory/'"));
  });
  it('is a real, not "coming soon", entry', () => {
    const line = pages.split('\n').find(l => l.includes("'/me/'"));
    expect(line).not.toMatch(/coming/);
  });
});

describe('the local /me page', () => {
  it('exports a title and a description, like every page', () => {
    expect(mePage).toMatch(/export const metadata = \{\s*title: '\/me · On this PC'/);
    expect(mePage).toMatch(/description:/);
  });
  it('links the three local pages', () => {
    for (const href of ["'/inventory/'", "'/parses/'", "'/replay/'"]) expect(mePage).toContain(`href: ${href}`);
  });
  it('links to the website anchor, in a new tab (the Mimic window sends https links to the browser)', () => {
    expect(mePage).toMatch(/SITE_CHARACTERS = 'https:\/\/wolfpack\.quest\/me#my-characters'/);
    expect(mePage).toMatch(/href=\{SITE_CHARACTERS\} target="_blank" rel="noreferrer"/);
  });
  it('carries the id the local inventory page jumps to', () => {
    expect(mePage).toMatch(/<section id="characters"/);
    expect(localInv).toContain('href="/me/#characters"');
  });
});

describe('the website end of the jump', () => {
  const anchor = mePage.match(/wolfpack\.quest\/me#([\w-]+)/)[1];
  it('the section the local link names carries that id', () => {
    expect(siteMe).toMatch(new RegExp(`<section id="${anchor}"`));
  });
  it('names the switches with the labels the buttons really carry', () => {
    // The callout runs from its bold lead-in to the mule upload; take its label spans.
    const start = siteMe.indexOf('Inventory sync and hiding are per character');
    expect(start, 'callout lead-in').toBeGreaterThan(siteMe.indexOf(`<section id="${anchor}"`));
    const callout = siteMe.slice(start, siteMe.indexOf('<MuleUpload', start));
    const named = [...callout.matchAll(/<span className="text-text">([^<]+)<\/span>/g)].map(m => m[1]);
    expect(named.length).toBeGreaterThanOrEqual(2);
    for (const label of named) {
      const first = label.split(' / ')[0].replace(/:.*$/, '').trim();   // "Inventory sync: on / EXCLUDED" -> "Inventory sync"
      expect(toggles, `no button starts "${first}"`).toContain(first);
    }
    expect(toggles).toContain('Inventory sync: EXCLUDED');
    expect(toggles).toContain('Inventory sync: on');
    expect(callout).toContain('Hide from lists');
  });
});
