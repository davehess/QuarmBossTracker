// test/pop-guide-sections.test.js — /pop/guide as collapsible sections (the guild lead, 2026-10-14: "Collapse all
// of the pop/guide stuff down into subsections, Tiers and plane of knowledge, move the POK stuff except for the
// seer at the top. Give a sidebar nav for the different sections to drop down. It should be a simple set of
// clicks.").
//
// The grouping (web/lib/popGuideSections.ts) runs for real, from the guide's own data. The page's wiring is read
// as stripped source (comments removed, so a comment cannot answer for the code). "Show in checklist" is run
// against a fake DOM through the real openParents.
//
// Run: npx vitest run test/pop-guide-sections.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { GUIDE_ITEMS, GUIDE_SECTIONS } from '../web/lib/popGuide.ts';
import { POP_ZONE_BY_KEY, TIER_LABELS } from '../web/lib/popFlags.ts';
import { STEP_GUIDE } from '../web/lib/popGuideSeer.ts';
import {
  GUIDE_TREE, GUIDE_NAV, STEP_HOME, SECTION_IDS, GROUP_IDS, idsForStep, openParents,
} from '../web/lib/popGuideSections.ts';

const read = (p) => stripJs(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const section = (id) => GUIDE_TREE.find(s => s.id === id);
const allGroups = GUIDE_TREE.flatMap(s => s.groups);

describe('the sections, from the guide’s own data', () => {
  it('are the /pop chart’s five tiers in order, then the Plane of Knowledge', () => {
    expect(SECTION_IDS).toEqual(['tier-1', 'tier-2', 'tier-3', 'tier-4', 'tier-5', 'pok']);
    expect(GUIDE_TREE.slice(0, 5).map(s => s.title)).toEqual([1, 2, 3, 4, 5].map(n => TIER_LABELS[n].name));
    expect(GUIDE_TREE[5].title).toBe('Plane of Knowledge');
  });
  it('split a tier by plane, in the chart’s order, folding a lower crypt or a temple into its parent', () => {
    expect(section('tier-1').groups.map(g => g.id)).toEqual(
      ['tier-1-justice', 'tier-1-innovation', 'tier-1-disease', 'tier-1-nightmare', 'tier-1-general']);
    expect(section('tier-2').groups.map(g => g.id)).toEqual(
      ['tier-2-storms', 'tier-2-valor', 'tier-2-cod', 'tier-2-ponb', 'tier-2-torment']);
    expect(section('tier-3').groups.map(g => g.id)).toEqual(
      ['tier-3-bot', 'tier-3-hoh', 'tier-3-tactics', 'tier-3-solro', 'tier-3-maelin', 'tier-3-general']);
    expect(section('tier-4').groups.map(g => g.id)).toEqual(
      ['tier-4-earth', 'tier-4-air', 'tier-4-water', 'tier-4-fire', 'tier-4-general']);
    // No sub-section for the lower crypt, the Temple of Marr or Ragrax: they are the parent’s.
    for (const sub of ['codb', 'hohb', 'poeb']) expect(allGroups.some(g => g.id.endsWith('-' + sub)), sub).toBe(false);
  });
  it('draw sub-sections only where a section has more than one (the Plane of Time lists its steps)', () => {
    expect(GUIDE_TREE.map(s => s.split)).toEqual([true, true, true, true, false, true]);
    expect(section('tier-5').groups).toHaveLength(1);
    expect(GROUP_IDS.some(id => id.startsWith('tier-5'))).toBe(false);
  });
  it('give each tier the blurb the guide already wrote for it', () => {
    ['t1', 't2', 't3', 't4', 'time'].forEach((k, n) => {
      expect(GUIDE_TREE[n].blurb).toBe(GUIDE_SECTIONS.find(s => s.key === k).blurb);
      expect(GUIDE_TREE[n].blurb.length).toBeGreaterThan(10);
    });
  });
});

describe('every step lands in exactly one section, and none is lost', () => {
  const placed = GUIDE_TREE.flatMap(s => s.groups.flatMap(g => g.keys));
  it('counts the same before and after', () => {
    expect(GUIDE_ITEMS.length).toBeGreaterThanOrEqual(79);
    expect(placed.length).toBe(GUIDE_ITEMS.length);
    expect(new Set(placed).size).toBe(placed.length);                       // none twice
    expect([...placed].sort()).toEqual(GUIDE_ITEMS.map(i => i.key).sort()); // none lost, none invented
    expect(GUIDE_TREE.reduce((n, s) => n + s.keys.length, 0)).toBe(GUIDE_ITEMS.length);
  });
  it('keeps the guide’s own order inside a sub-section', () => {
    const at = new Map(GUIDE_ITEMS.map((i, n) => [i.key, n]));
    for (const g of allGroups) {
      const order = g.keys.map(k => at.get(k));
      expect(order, g.id).toEqual([...order].sort((a, b) => a - b));
    }
  });
  it('puts a tier’s steps in that tier and never in another', () => {
    const tierOf = { t1: 1, t2: 2, t3: 3, t4: 4, time: 5 };
    for (const i of GUIDE_ITEMS) {
      const ids = idsForStep(i.key);
      expect(ids.length, i.key).toBeGreaterThan(0);
      expect(ids[0], i.key).toBe(i.section in tierOf ? `tier-${tierOf[i.section]}` : 'pok');
    }
  });
  it('gives every step an explicit home, a real one for its section, in the plane’s own tier', () => {
    const keys = new Set(GUIDE_ITEMS.map(i => i.key));
    for (const k of Object.keys(STEP_HOME)) expect(keys.has(k), `${k} is not a guide step`).toBe(true);
    for (const i of GUIDE_ITEMS) {
      const home = STEP_HOME[i.key];
      expect(home, `${i.key} has no home in STEP_HOME`).toBeTruthy();
      const [secId, grpId] = idsForStep(i.key);
      // The group the step was put in is the one it asked for, not a catch-all it fell into.
      expect(allGroups.find(g => g.keys.includes(i.key)).id, i.key).toBe(`${secId}-${home}`);
      const zone = POP_ZONE_BY_KEY[home];
      if (zone) expect(`tier-${zone.tier}`, `${i.key} asks for ${home}`).toBe(secId);
      void grpId;
    }
  });
});

describe('the Plane of Knowledge', () => {
  const pok = section('pok');
  it('gathers the flag fixers, the Traveler’s Manual, every Knowledge quest and the spell turn-in', () => {
    expect(pok.groups.map(g => g.id)).toEqual(['pok-flags', 'pok-quests', 'pok-spells']);
    expect(pok.groups[0].keys).toEqual(['start_flag_fixers', 'start_traveler_manual']);
    expect(pok.groups[1].keys).toEqual(GUIDE_ITEMS.filter(i => i.key.startsWith('pok_')).map(i => i.key));
    expect(pok.groups[2].keys).toEqual(GUIDE_ITEMS.filter(i => i.section === 'spells').map(i => i.key));
    expect(pok.keys).toEqual(GUIDE_ITEMS.filter(i => i.section === 'pok' || i.section === 'spells').map(i => i.key));
  });
  it('holds nothing from a tier, and no tier holds anything from it', () => {
    for (const k of pok.keys) expect(['pok', 'spells']).toContain(GUIDE_ITEMS.find(i => i.key === k).section);
    for (const s of GUIDE_TREE.slice(0, 5)) {
      for (const k of s.keys) expect(['pok', 'spells'], k).not.toContain(GUIDE_ITEMS.find(i => i.key === k).section);
    }
  });
  it('comes after the tiers, and the Seer paste stays above all of it', () => {
    expect(SECTION_IDS.indexOf('pok')).toBe(SECTION_IDS.length - 1);
    const checklist = read('web/app/pop/guide/GuideChecklist.tsx');
    expect(checklist.indexOf('<SeerPaste')).toBeGreaterThan(0);
    expect(checklist.indexOf('<SeerPaste')).toBeLessThan(checklist.indexOf('<GuideNav'));
    expect(checklist.indexOf('<SeerPaste')).toBeLessThan(checklist.indexOf('GUIDE_TREE.map('));
    // It is the only thing drawn before the sidebar and the sections.
    expect(checklist.slice(checklist.indexOf('return (\n    <div className="flex flex-col gap-4">'), checklist.indexOf('<GuideNav')))
      .not.toMatch(/<details|<section/);
  });
});

describe('the sidebar', () => {
  it('lists the sections, in the page’s order, and a sub-list for each section that has sub-sections', () => {
    expect(GUIDE_NAV.map(e => e.id)).toEqual(SECTION_IDS);
    for (const e of GUIDE_NAV) {
      const s = section(e.id);
      expect(e.title).toBe(s.title);
      expect(e.subs.map(x => x.id)).toEqual(s.split ? s.groups.map(g => g.id) : []);
      expect(e.subs.map(x => x.title)).toEqual(s.split ? s.groups.map(g => g.title) : []);
    }
  });
  it('is drawn from the same ids the page puts on its <details>', () => {
    const checklist = read('web/app/pop/guide/GuideChecklist.tsx');
    const nav = read('web/app/pop/guide/GuideNav.tsx');
    expect(checklist).toMatch(/<details key=\{s\.id\} id=\{s\.id\} data-gd/);
    expect(checklist).toMatch(/<details key=\{g\.id\} id=\{g\.id\} data-gd/);
    expect(checklist).toMatch(/\{s\.split \? \(/);
    expect(nav).toMatch(/GUIDE_NAV\.map\(s =>/);
    expect(nav).toMatch(/href=\{`#\$\{s\.id\}`\}/);
    expect(nav).toMatch(/href=\{`#\$\{g\.id\}`\}/);
  });
  it('is one list in two frames: a drop-down on a phone, a column on a wide screen', () => {
    const nav = read('web/app/pop/guide/GuideNav.tsx');
    expect(nav).toMatch(/<details ref=\{sheet\} className="lg:hidden/);
    expect(nav).toMatch(/<aside className="hidden lg:block/);
    expect(nav.match(/<NavList /g)).toHaveLength(2);
    expect(nav).toMatch(/Jump to a section/);
  });
  it('has Expand all and Collapse all, which touch only the page’s own sections', () => {
    const nav = read('web/app/pop/guide/GuideNav.tsx');
    expect(nav).toContain('Expand all');
    expect(nav).toContain('Collapse all');
    expect(nav).toContain("querySelectorAll<HTMLDetailsElement>('details[data-gd]')");
    expect(nav).toMatch(/setAll\(true\)/);
    expect(nav).toMatch(/setAll\(false\)/);
    // The Seer box and a quest chain’s folds carry no data-gd.
    expect(read('web/app/pop/guide/SeerPaste.tsx')).not.toMatch(/data-gd/);
    expect(read('web/app/pop/guide/GuideChecklist.tsx').match(/data-gd/g)).toHaveLength(2);
  });
  it('drops a section’s sub-list while that section is open on the page, read from the page', () => {
    const nav = read('web/app/pop/guide/GuideNav.tsx');
    expect(nav).toContain("document.addEventListener('toggle', read, true)");
    expect(nav).toMatch(/isOpen && s\.subs\.length > 0/);
  });
});

describe('the hash ids are stable', () => {
  it('are these, because they are links people send', () => {
    expect(SECTION_IDS).toEqual(['tier-1', 'tier-2', 'tier-3', 'tier-4', 'tier-5', 'pok']);
    expect([...GROUP_IDS].sort()).toEqual([
      'pok-flags', 'pok-quests', 'pok-spells',
      'tier-1-disease', 'tier-1-general', 'tier-1-innovation', 'tier-1-justice', 'tier-1-nightmare',
      'tier-2-cod', 'tier-2-ponb', 'tier-2-storms', 'tier-2-torment', 'tier-2-valor',
      'tier-3-bot', 'tier-3-general', 'tier-3-hoh', 'tier-3-maelin', 'tier-3-solro', 'tier-3-tactics',
      'tier-4-air', 'tier-4-earth', 'tier-4-fire', 'tier-4-general', 'tier-4-water',
    ]);
  });
  it('are unique, URL-safe and not the id of any step row', () => {
    const all = [...SECTION_IDS, ...GROUP_IDS];
    expect(new Set(all).size).toBe(all.length);
    for (const id of all) {
      expect(id, id).toMatch(/^[a-z0-9-]+$/);
      expect(GUIDE_ITEMS.some(i => `guide-${i.key}` === id), id).toBe(false);
    }
  });
  it('open on arrival and when the hash changes, and the address follows a jump', () => {
    const nav = read('web/app/pop/guide/GuideNav.tsx');
    expect(nav).toContain("window.addEventListener('hashchange', go)");
    expect(nav).toContain('window.location.hash.slice(1)');
    expect(nav).toContain('window.history.pushState(null');
    expect(nav).toMatch(/openParents\(el\)/);
  });
});

describe('every section starts closed', () => {
  it('no <details> the page draws carries an open attribute', () => {
    const checklist = read('web/app/pop/guide/GuideChecklist.tsx');
    const tags = checklist.match(/<details [^>]*>/g) ?? [];
    expect(tags.length).toBeGreaterThanOrEqual(4);   // the two sections, plus a quest chain’s two folds
    for (const t of tags) expect(t, t).not.toMatch(/\bopen\b/);
  });
});

describe('"show in checklist" opens the parents, then scrolls', () => {
  // A row inside a sub-section inside a section, as the page draws it.
  const el = (tagName, parent, open = false) => ({ tagName, open, parentElement: parent });
  const rowIn = () => {
    const root = el('DIV', null);
    const sec = el('DETAILS', root);
    const body = el('DIV', sec);
    const sub = el('DETAILS', body);
    const li = el('LI', el('UL', el('DIV', sub)));
    return { sec, sub, li, row: el('INPUT', el('DIV', li)) };
  };
  it('opens the sub-section and the section around the row, and nothing else', () => {
    const { sec, sub, row } = rowIn();
    expect(openParents(row)).toBe(2);
    expect(sec.open).toBe(true);
    expect(sub.open).toBe(true);
  });
  it('leaves an already-open parent alone and opens the one that is closed', () => {
    const { sec, sub, row } = rowIn();
    sec.open = true;
    expect(openParents(row)).toBe(1);
    expect(sub.open).toBe(true);
  });
  it('opens the details it is given when the id names a section itself', () => {
    const { sec } = rowIn();
    expect(openParents(sec)).toBe(1);
    expect(sec.open).toBe(true);
    expect(openParents(null)).toBe(0);
  });
  it('is wired: the Seer’s button event runs openRowParents on the step’s own row id, before the scroll', () => {
    const checklist = read('web/app/pop/guide/GuideChecklist.tsx');
    expect(checklist).toMatch(/useFocusStep\('guide-', openRowParents\)/);
    expect(checklist).toMatch(/function openRowParents\(key: string\) \{\s*openParents\(document\.getElementById\(`guide-\$\{key\}`\)\);\s*\}/);
    expect(checklist).toContain('const id = `guide-${item.key}`');
    const seer = read('web/app/pop/guide/SeerPaste.tsx');
    expect(seer.indexOf('before?.(key)')).toBeGreaterThan(0);
    expect(seer.indexOf('before?.(key)')).toBeLessThan(seer.indexOf('scrollIntoView'));
  });
  it('has a section and a sub-section to open for every step the Seer can point at', () => {
    const guideSteps = new Set(Object.values(STEP_GUIDE));
    expect(guideSteps.size).toBeGreaterThan(10);
    for (const k of guideSteps) {
      const ids = idsForStep(k);
      expect(ids.length, k).toBeGreaterThan(0);
      expect(SECTION_IDS, k).toContain(ids[0]);
      if (section(ids[0]).split) expect(GROUP_IDS, k).toContain(ids[1]);
    }
    // One example, spelled out: the lower crypt’s Bertoxxulous kill sits in Crypt of Decay, in Tier Two.
    expect(idsForStep('flag_bert')).toEqual(['tier-2', 'tier-2-cod']);
    expect(idsForStep('flag_quarm')).toEqual(['tier-5']);
    expect(idsForStep('start_flag_fixers')).toEqual(['pok', 'pok-flags']);
  });
});

describe('the features that were on the page are still on it', () => {
  const checklist = read('web/app/pop/guide/GuideChecklist.tsx');
  it('keeps the per-character ticks, the filters and the auto-fill', () => {
    expect(checklist).toContain('setGuideTick(name, item.key, next)');
    expect(checklist).toContain('<CharOptions chars={chars} noLevel={noLevel} />');
    expect(checklist).toMatch(/guideStepsProven\(heldClosure\(char\?\.flags \?\? \[\]\)\)/);
    expect(checklist).toContain('for (const k of seer?.proven ?? []) d.add(k);');
    expect(checklist).toMatch(/<Row key=\{i\.key\} item=\{i\} checked=\{done\.has\(i\.key\)\} recorded=\{recorded\.has\(i\.key\)\}/);
  });
  it('still draws the /say and /map chips and the item hovers on a row', () => {
    expect(checklist).toContain('<CopyChip text={sayCommand(s)} />');
    expect(checklist).toContain('<CopyChip text={mapCommand(l)} />');
    expect(checklist).toMatch(/<ItemHover card=\{cards\[p\.item\.id\]\}/);
  });
  it('shows the section’s count over all its steps, not the filtered ones', () => {
    expect(checklist).toMatch(/counts\[s\.id\] = countOf\(s\.keys\)/);
    expect(checklist).toContain('{c.done} / {c.total} done');
    expect(checklist).toContain('▶ next');
  });
});
