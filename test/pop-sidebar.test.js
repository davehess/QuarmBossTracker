// test/pop-sidebar.test.js — the two /pop sidebar previews (the guild lead, 2026-10-21: "Need a sidebar for the pop
// flags page, the essences of power should be minimized and under the elementals section.").
//
//   ?v=b  navigation sidebar on the left: the view buttons + a jump link to every tier and plane ("N in")
//   ?v=c  your-progress sidebar on the right: next step per character, what to raid next, essences condensed
//   no ?v=  the page exactly as production has it: no sidebar, the full Essences card above the chart
//
// web/lib/popSidebar.ts is pure, so the variant switch, the essences placement, the jump list, the condensed
// essences and the progress rows run for real. The components and the page are read as comment-stripped source
// (there is no React renderer in this suite; the folds are native <details>, which a text check can hold). The
// rendered HTML of each variant was also read off a real `next dev` against a fake database for the pictures.
//
// Fixture names are invented (Aldenmar, Brackwyn ...), none is a member.
//
// Run: npx vitest run test/pop-sidebar.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import {
  sideVariant, essencesPlace, ELEMENTAL_TIER, navGroups, dropGroups, mineProgress, demoMine,
  tierAnchor, zoneAnchor, ESSENCES_ANCHOR,
} from '../web/lib/popSidebar.ts';
import { POP_ZONES, TIER_LABELS } from '../web/lib/popFlags.ts';
import { demoEssenceQueue, buildEssenceQueue } from '../web/lib/essencesQueue.ts';
import { metaForPath } from '../web/lib/pageMeta.ts';

const src = (p) => stripJs(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const page = src('web/app/pop/page.tsx');
const POP = (f) => src(`web/app/pop/${f}`);

describe('which variant the URL names', () => {
  it('b and c are sidebars; everything else is the page as production has it', () => {
    expect(sideVariant('b')).toBe('b');
    expect(sideVariant('c')).toBe('c');
    for (const v of [undefined, '', 'a', 'B', 'bc', ['b', 'c'], 1, null]) expect(sideVariant(v)).toBeNull();
  });
});

describe('where the Essences of Power card goes', () => {
  it('no variant: the full card on top, whatever view is open (production)', () => {
    expect(essencesPlace(null, true)).toBe('top');
    expect(essencesPlace(null, false)).toBe('top');
  });
  it('a variant on the chart: folded, in the Elemental tier', () => {
    expect(essencesPlace('b', true)).toBe('tier');
    expect(essencesPlace('c', true)).toBe('tier');
  });
  it('a variant on a view with no tier sections: folded, in the old place (never dropped)', () => {
    expect(essencesPlace('b', false)).toBe('top-fold');
    expect(essencesPlace('c', false)).toBe('top-fold');
  });
  it('the Elemental tier is the one holding Earth, Air, Water and Fire', () => {
    const keys = POP_ZONES.filter(z => z.tier === ELEMENTAL_TIER && !z.subZoneOf).map(z => z.key).sort();
    expect(keys).toEqual(['air', 'earth', 'fire', 'water']);
    expect(TIER_LABELS[ELEMENTAL_TIER].name).toMatch(/Elemental/);
  });
});

describe('the jump list (variant B)', () => {
  const elig = new Map([['justice', 9], ['air', 2]]);
  const groups = navGroups(POP_ZONES, elig);
  it('one group per tier, in order, each plane in its chart column', () => {
    expect(groups.map(g => g.tier)).toEqual([1, 2, 3, 4, 5]);
    expect(groups[0].zones.map(z => z.key)).toEqual(['justice', 'innovation', 'disease', 'nightmare']);
    expect(groups[0].id).toBe(tierAnchor(1));
    expect(groups[0].zones[0].id).toBe(zoneAnchor('justice'));
  });
  it('carries each plane\'s "N in" and defaults a plane with no count to 0', () => {
    const by = Object.fromEntries(groups.flatMap(g => g.zones).map(z => [z.key, z.elig]));
    expect(by.justice).toBe(9);
    expect(by.air).toBe(2);
    expect(by.earth).toBe(0);
  });
  it('leaves out the sub-zones that ride inside their parent card', () => {
    const all = groups.flatMap(g => g.zones).map(z => z.key);
    for (const sub of POP_ZONES.filter(z => z.subZoneOf)) expect(all).not.toContain(sub.key);
    expect(all.length).toBe(POP_ZONES.filter(z => !z.subZoneOf).length);
  });
});

describe('the essences, condensed', () => {
  it('nobody queued: every essence is "bid it", one group', () => {
    const { next } = buildEssenceQueue([], [], null);
    expect(dropGroups(next)).toEqual([{ icons: '🔥💨💧🪨', who: null }]);
  });
  it('groups a person\'s essences together and the unclaimed ones as bid', () => {
    const { next } = demoEssenceQueue();
    const g = dropGroups(next);
    expect(g.length).toBeGreaterThan(1);
    // every essence appears exactly once across the groups
    expect([...g.map(x => x.icons).join('')].length).toBe(4);
    // the named groups are exactly the people the card names as next, the unnamed one is the bids
    expect(g.filter(x => x.who).map(x => x.who).sort()).toEqual([...new Set(next.filter(n => !n.bid).map(n => n.name))].sort());
    expect(g.some(x => x.who === null)).toBe(next.some(n => n.bid));
  });
});

describe('your progress (variant C)', () => {
  it('reads each character\'s next step from their flags, most-progressed first as given', () => {
    const { shown, hidden } = mineProgress(demoMine());
    expect(hidden).toBe(0);
    expect(shown.map(r => r.name)).toEqual(['Aldenmar', 'Brackwyn', 'Corvale']);
    // someone with no flags starts at the first step of tier one
    const fresh = shown.find(r => r.name === 'Corvale');
    expect(fresh.next).not.toBeNull();
    expect(fresh.next.title).toMatch(/Disease|Justice|Innovation|Nightmare/);
    // the step moves on once the flags behind it are held: Aldenmar is past the first tier-one steps
    const far = shown.find(r => r.name === 'Aldenmar');
    expect(far.next.title).not.toBe(fresh.next.title);
    expect(far.main).toBe(true);
  });
  it('caps the list and says how many more there are', () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({ name: `Char${i}`, cls: null, main: false, flags: [] }));
    const r = mineProgress(rows, 6);
    expect(r.shown.length).toBe(6);
    expect(r.hidden).toBe(3);
  });
  it('an empty roster is an empty list, not an error', () => {
    expect(mineProgress([])).toEqual({ shown: [], hidden: 0 });
  });
  it('the sample characters are invented ones', () => {
    for (const r of demoMine()) expect(['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin', 'Theodric', 'Velmira']).toContain(r.name);
  });
});

describe('/pop with no ?v= is the page production has', () => {
  it('still renders the full Essences card at the top, and nothing sidebar-shaped, when side is null', () => {
    expect(page).toContain("{essPlace === 'top' && <EssencesQueue demo={essDemo} {...essences} />}");
    // PopShell is a fragment without a variant
    expect(POP('PopShell.tsx')).toMatch(/if \(!side\) return <>\{children\}<\/>;/);
    // anchors and the extra scroll margin exist only for a variant
    expect(page).toContain('id={side ? tierAnchor(tier) : undefined}');
    expect(page).toContain('id={side ? zoneAnchor(z.key) : undefined}');
    expect(page).toContain("${side ? ' scroll-mt-32' : ''}");
    // the variant never leaks into links without one
    expect(page).toContain("if (side) { params.set('v', side); if (essDemo) params.set('demo', '1'); }");
    // the header's view buttons are hidden only for B
    expect(page).toContain("{side !== 'b' && (");
  });
  it('keeps the page metadata exactly as it was', () => {
    expect(page).toContain("title: 'PoP Flags — Wolf Pack'");
    expect(page).toContain("description: 'Every Planes of Power flag gate by tier, how many raiders hold each flag and who can enter each zone today.'");
    expect(metaForPath('/pop').title).toBe('PoP Flags');
  });
  it('adds no query: the new files read nothing from the database, and the page\'s reads are the ones it had', () => {
    for (const f of ['PopShell.tsx', 'PopNavPanel.tsx', 'PopMinePanel.tsx', 'EssencesFold.tsx', 'OpenOnHash.tsx']) {
      expect(POP(f), f).not.toMatch(/supabase|\.from\(|\.rpc\(/);
    }
    expect(src('web/lib/popSidebar.ts')).not.toMatch(/supabase|\.from\(|\.rpc\(/);
    // page.tsx made 12 .from( / .rpc( calls before this change; the previews add none
    expect((page.match(/\.(from|rpc)\(/g) ?? []).length).toBe(READS_ON_BETA);
  });
});

// How many .from( / .rpc( calls page.tsx made on beta before the sidebar work (counted off origin/beta).
const READS_ON_BETA = 12;

describe('?v=b and ?v=c render their sidebars, essences folded in the Elemental tier', () => {
  it('the page mounts the right panel in the shell and the fold in the Elemental tier', () => {
    expect(page).toMatch(/<PopShell side=\{side\}/);
    expect(page).toContain("panel={side === 'c' ? minePanel : navPanel}");
    expect(page).toContain("{essPlace === 'tier' && tier === ELEMENTAL_TIER && essencesFold}");
    expect(page).toContain("{essPlace === 'top-fold' && essencesFold}");
    expect(page).toContain('<EssencesFold demo={essDemo} {...essences} />');
    // the fold sits inside the tier container, after its grid (before the ▼ between tiers)
    const tierBlock = page.slice(page.indexOf('tierAnchor(tier)'), page.indexOf('<p className="text-[10px] text-dim text-center">'));
    expect(tierBlock.indexOf('ZoneCard')).toBeGreaterThan(-1);
    expect(tierBlock.indexOf('essencesFold')).toBeGreaterThan(tierBlock.indexOf('ZoneCard'));
    expect(tierBlock.indexOf('essencesFold')).toBeLessThan(tierBlock.indexOf('select-none'));
  });
  it('B: left column, nav with every plane; C: right column, progress; both stack to a collapsible bar below lg', () => {
    const shell = POP('PopShell.tsx');
    expect(shell).toContain("lg:grid-cols-[13.5rem_minmax(0,1fr)]");
    expect(shell).toContain("lg:grid-cols-[minmax(0,1fr)_17rem]");
    expect(shell).toContain('lg:col-start-2 lg:row-start-1');
    expect(shell).toMatch(/<details className="lg:hidden sticky/);
    expect(shell).toMatch(/<aside[\s\S]*hidden lg:block lg:sticky/);
    expect(shell).toContain('min-w-0');
    const nav = POP('PopNavPanel.tsx');
    expect(nav).toContain('{z.elig} in');
    expect(nav).toContain('href={`${base}#${z.id}`}');
    expect(POP('PopMinePanel.tsx')).toContain('Raid next');
    expect(POP('PopMinePanel.tsx')).toContain('Full queue');
  });
  it('the essences fold is collapsed by default and holds the unchanged four-column card', () => {
    const fold = POP('EssencesFold.tsx');
    expect(fold).toMatch(/<details id=\{ESSENCES_ANCHOR\}/);
    expect(fold).not.toMatch(/<details[^>]*\sopen[\s>=]/);
    expect(fold).toContain('<EssencesQueue demo={demo} {...q} bare />');
    expect(fold).toContain('queued · next drop:');
    expect(ESSENCES_ANCHOR).toBe('essences');
    // the card itself is untouched apart from dropping its own border inside the fold
    const card = POP('EssencesQueue.tsx');
    expect(card).toContain("bare ? 'px-4 pb-4' : 'bg-panel border border-border rounded-lg p-4'");
    expect(card).toContain('grid-cols-1 sm:grid-cols-2 lg:grid-cols-4');
  });
  it('"Full queue" lands on an open card: the hash opens the <details>', () => {
    const open = POP('OpenOnHash.tsx');
    expect(open).toContain("'use client'");
    expect(open).toContain('el.open = true');
    expect(open).toContain("addEventListener('hashchange'");
  });
  it('?demo=1 carries to the progress sidebar: sample characters, labelled', () => {
    expect(page).toContain('mineProgress(essDemo ? demoMine()');
    expect(POP('PopMinePanel.tsx')).toContain('SAMPLE');
  });
});
