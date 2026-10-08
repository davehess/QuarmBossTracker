// test/ext-target-scope-toggle.test.js — the Extended Target overlay's Raid | Group switch.
//
// The guild lead, 2026-10-08: "Seeing the whole raid is often worthwhile, but when
// grouping it can be annoying to see this mode. Make it a toggle at the top."
// The overlay sends ?scope=raid|group; the agent (see ext-target-group-scope.test.js)
// does the narrowing. This file guards the overlay half.
//
// Run: npx vitest run test/ext-target-scope-toggle.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';

const raw = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'extarget.html'), 'utf8');
const clean = stripJs(raw);

describe('the switch is in the title bar', () => {
  it('is a segmented pill of two real buttons, Raid and Group, inside the header', () => {
    const head = clean.slice(clean.indexOf('<div class="head'), clean.indexOf('<div id="rows"'));
    expect(head).toMatch(/<span class="scope-sw" id="scopeSw"[^>]*title="[^"]*Raid[^"]*Group[^"]*">/);
    expect(head).toMatch(/<button type="button" id="scopeRaid" data-scope="raid">Raid<\/button>/);
    expect(head).toMatch(/<button type="button" id="scopeGroup" data-scope="group">Group<\/button>/);
  });
  it('highlights the active segment', () => {
    expect(clean).toMatch(/\.scope-sw button\.on\{/);
    expect(clean).toContain("r.className = _scope === 'raid' ? 'on' : '';");
    expect(clean).toContain("g.className = _scope === 'group' ? 'on' : '';");
  });
});

describe('the choice persists, and storage can fail', () => {
  it('defaults to raid and reads storage inside try/catch', () => {
    expect(clean).toMatch(/var _scope = 'raid';\s*\n\s*try \{ if \(localStorage\.getItem\('wp_ext_scope'\) === 'group'\) _scope = 'group'; \} catch \(e\) \{\}/);
  });
  it('writes storage inside try/catch', () => {
    expect(clean).toMatch(/try \{ localStorage\.setItem\('wp_ext_scope', _scope\); \} catch \(e\) \{\}/);
  });
});

describe('every poll carries the scope', () => {
  it('fetches /api/extended-target?scope=', () => {
    expect(clean).toContain("'/api/extended-target?scope='+asked");
  });
  it('drops a reply to a scope the user has since flipped away from', () => {
    expect(clean).toMatch(/if \(asked !== _scope\) return;/);
  });
  it('re-polls at once on a click', () => {
    const click = clean.slice(clean.indexOf("scopeSw.addEventListener('click'"));
    expect(click.slice(0, click.indexOf('});'))).toContain('tick();');
  });
});

describe('a raid_group payload does not break the render', () => {
  it('counts as group scope for the "in group" label and empty text', () => {
    expect(clean).toMatch(/payload\.scope === 'group' \|\| payload\.scope === 'raid_group'/);
  });
});

describe('layout', () => {
  it('keeps the right gutter under the fixed hide ✕', () => {
    expect(clean).toMatch(/\.head\{[^}]*padding-right:22px/);
  });
});
