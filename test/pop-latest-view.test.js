// test/pop-latest-view.test.js — /pop/latest, the "Latest flags" page (the guild lead, 2026-10-14, after reading both
// beta layouts of the /pop strip: a stream with names A-Z for flags that go together, a collapsible by-stage section
// in step order, "who still needs it" from the live raid, and a list that opens).
//
// web/lib/popLatestView.ts is pure apart from three small reads, so the grouping, the repeat collapse, the step
// places, the chain order, the raid check and the filters run for real. The reads are driven through a fake client;
// the components and the page are read as comment-stripped source (the folds are native <details>, which a text check
// can hold: there is no React renderer in this suite).
//
// The fixture names are invented (Aldenmar, Brackwyn ...), none is a member.
//
// Run: npx vitest run test/pop-latest-view.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import {
  LINES, GROUP_SECS, HISTORY_DAYS, NAMES_SHOWN, RAID_FRESH_MS, WINDOWS, DEFAULT_WINDOW,
  canonicalKey, charMoments, clusterMoments, stageBoard, stepPlace, stillNeeds, orderKeys, unlocksOf,
  listingOf, keepName, parseView, buildView, loadRaidNames, lineOf,
} from '../web/lib/popLatestView.ts';
import { loadLatestFlagRows } from '../web/lib/popLatestFlags.ts';
import { POP_STEPS, STEP_IMPLIES, stepsHeld } from '../web/lib/popSteps.ts';
import { POP_ZONE_BY_KEY } from '../web/lib/popFlags.ts';
import { metaForPath } from '../web/lib/pageMeta.ts';

const read = (p) => stripJs(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const T0 = Date.parse('2026-10-14T20:00:00Z');
const at = (secsAgo) => new Date(T0 - secsAgo * 1000).toISOString();
const row = (character, flag_key, secsAgo, source = 'event', zone = '205') => ({ character, flag_key, zone, source, earned_at: at(secsAgo) });
const names = (c) => c.characters.map(w => w.name);
const keysOf = (c) => c.steps.map(s => s.key).sort();

describe('flags that go together are one row, names A-Z', () => {
  // A raid kill: the server writes the stage and the catalog flag it implies for each character, seconds apart.
  const kill = [
    row('Zarrin', 'zeks_3', 600), row('Zarrin', 'vallon_dead', 600),
    row('Aldenmar', 'zeks_3', 590), row('Aldenmar', 'vallon_dead', 590),
    row('corvale', 'zeks_3', 560), row('Nyssara', 'zeks_3', 480), row('Brackwyn', 'zeks_3', 400),
  ];
  const clusters = (rows, order) => clusterMoments(charMoments(rows).moments, order);

  it('puts several characters with the same steps at about the same time on ONE row', () => {
    const c = clusters(kill, 'az');
    expect(c).toHaveLength(1);
    expect(keysOf(c[0])).toEqual(['zeks_3']);          // the stage and its catalog flag are one step
    expect(c[0].source).toBe('event');
  });
  it('lists the characters alphabetically, ignoring case', () => {
    expect(names(clusters(kill, 'az')[0])).toEqual(['Aldenmar', 'Brackwyn', 'corvale', 'Nyssara', 'Zarrin']);
  });
  it('can list them latest first instead', () => {
    expect(names(clusters(kill, 'time')[0])).toEqual(['Brackwyn', 'Nyssara', 'corvale', 'Aldenmar', 'Zarrin']);
  });
  it('a single character stays its own row, and so does the same step much later', () => {
    const c = clusters([...kill, row('Rethlan', 'zeks_3', 600 + GROUP_SECS + 120)], 'az');
    expect(c).toHaveLength(2);
    expect(names(c[1])).toEqual(['Rethlan']);
  });
  it('a different set of steps is a different row, even at the same moment', () => {
    const c = clusters([...kill, row('Rethlan', 'zeks_4', 580)], 'az');
    expect(c).toHaveLength(2);
    expect(c.map(keysOf)).toContainEqual(['zeks_4']);
  });
  it('a server row and a recital row of the same steps are not mixed under one badge', () => {
    const c = clusters([row('Aldenmar', 'thelin_2', 100, 'event'), row('Brackwyn', 'thelin_2', 100, 'recital')], 'az');
    expect(c.map(x => x.source).sort()).toEqual(['event', 'recital']);
  });
  it('newest row first', () => {
    const c = clusters([row('Aldenmar', 'thelin_2', 7200), row('Brackwyn', 'zeks_3', 100)], 'az');
    expect(c.map(x => keysOf(x)[0])).toEqual(['zeks_3', 'thelin_2']);
  });
  it('a character in the cluster twice is listed once', () => {
    const c = clusters([row('Aldenmar', 'zeks_3', 200), row('Aldenmar', 'zeks_3', 200 + 150), row('Brackwyn', 'zeks_3', 190)], 'az');
    expect(names(c[0])).toEqual(['Aldenmar', 'Brackwyn']);
  });
});

describe('a recital row shows only what is new to that character (the duplicate rows)', () => {
  const SET = ['fuirstel_2', 'thelin_2'];
  const recital = (who, keys, secsAgo) => keys.map(k => row(who, k, secsAgo, 'recital', '202'));

  it('the same recital twice, minutes apart, is ONE row (the screenshot)', () => {
    const m = charMoments([...recital('Aldenmar', SET, 10_800), ...recital('Aldenmar', SET, 10_800 - 240)]);
    expect(m.moments).toHaveLength(1);
    expect(m.repeats).toBe(1);
    expect(clusterMoments(m.moments).filter(c => names(c).includes('Aldenmar'))).toHaveLength(1);
  });
  it('a later recital shows only the steps it added', () => {
    const m = charMoments([...recital('Aldenmar', SET, 10_800), ...recital('Aldenmar', [...SET, 'thelin_3'], 3_600)]);
    expect(m.moments).toHaveLength(2);
    expect(m.moments[0].steps.map(s => s.key)).toEqual(['thelin_3']);   // newest first; thelin_2 and fuirstel_2 were held
  });
  it('a step a later one proves is not new either (the server step implies the one before it)', () => {
    const m = charMoments([row('Brackwyn', 'fuirstel_4', 18_000, 'event'), ...recital('Brackwyn', ['fuirstel_2'], 3_600)]);
    expect(m.moments).toHaveLength(1);
    expect(m.moments[0].source).toBe('event');
    expect(m.repeats).toBe(1);
  });
  it('an event is always news: it is the server speaking now', () => {
    const m = charMoments([row('Corvale', 'zeks_3', 7_200, 'event'), row('Corvale', 'zeks_3', 3_600, 'event')]);
    expect(m.moments).toHaveLength(2);
  });
  it('the first recital on file is marked, since it can only say when the Seer was heard', () => {
    const m = charMoments(recital('Aldenmar', SET, 600));
    expect(m.moments[0].catchUp).toBe(true);
    expect(clusterMoments(m.moments)[0].catchUp).toBe(true);
    const later = charMoments([...recital('Aldenmar', SET, 3_600), ...recital('Aldenmar', ['thelin_3'], 600)]);
    expect(later.moments[0].catchUp).toBe(false);
  });
  it('a character is judged on its own history, not another one\'s', () => {
    const m = charMoments([...recital('Aldenmar', SET, 10_800), ...recital('Brackwyn', SET, 600)]);
    expect(m.moments).toHaveLength(2);
    expect(m.repeats).toBe(0);
  });
  it('what each character holds is kept for the raid check, closed over what the steps imply', () => {
    const { held } = charMoments(recital('Aldenmar', ['fuirstel_4'], 600));
    expect(held.get('aldenmar').has('fuirstel_2')).toBe(true);
    expect(held.get('aldenmar').has('fuirstel_5')).toBe(false);
  });
});

describe('a step is labelled with ITS OWN place, never the zone the row was heard in (the Plane of Knowledge bug)', () => {
  it('names the plane from the step catalog', () => {
    expect(stepPlace('fuirstel_2')?.name).toBe('Plane of Disease');
    expect(stepPlace('thelin_2')?.name).toBe('Plane of Nightmare');
    expect(stepPlace('thelin_3')?.name).toBe('Lair of Terris Thule');
  });
  it('a hail elsewhere uses the step\'s own `where`', () => {
    expect(stepPlace('thelin_1')).toEqual({ name: 'Plane of Tranquility', short: 'Tranquility' });
    expect(stepPlace('zeks_6')?.short).toBe('Knowledge');
  });
  it('every step in the catalog gets the plane of its card, or its where', () => {
    for (const [card, steps] of Object.entries(POP_STEPS)) {
      for (const s of steps) {
        const p = stepPlace(s.key);
        expect(p, s.key).not.toBeNull();
        expect(p.name, s.key).toBe(s.where ? `Plane of ${s.where}` : POP_ZONE_BY_KEY[card].name);
      }
    }
  });
  it('a catalog flag with no step falls back to its flag zone', () => {
    expect(stepPlace('hoh_trials')?.name).toBe('Halls of Honor');
  });
  it('a Seer recital heard in Knowledge puts each step on its own plane, on the board', () => {
    const rows = ['fuirstel_2', 'thelin_2', 'zeks_3', 'tylis_1'].map(k => row('Aldenmar', k, 600, 'recital', '202'));
    const { moments } = charMoments(rows);
    const steps = stageBoard(moments).tiers.flatMap(t => t.cards).flatMap(c => c.steps).filter(s => s.characters.length);
    const where = Object.fromEntries(steps.map(s => [s.key, s.place.name]));
    expect(where).toEqual({
      fuirstel_2: 'Plane of Disease', thelin_2: 'Plane of Nightmare', zeks_3: 'Plane of Tactics', tylis_1: 'Plane of Tranquility',
    });
    expect(Object.values(where)).not.toContain('Plane of Knowledge');
  });
  it('the zone stored on the row changes nothing', () => {
    const mk = (zone) => ['fuirstel_2', 'thelin_2', 'zeks_3'].map(k => row('Aldenmar', k, 600, 'recital', zone));
    const run = (zone) => {
      const { moments } = charMoments(mk(zone));
      return JSON.stringify([clusterMoments(moments), stageBoard(moments)]);
    };
    expect(run('202')).toBe(run(null));
    expect(run('205')).toBe(run('999'));
  });
  it('the lib never reads a row\'s zone', () => {
    expect(read('web/lib/popLatestView.ts')).not.toMatch(/\br\.zone\b|\.zone\b.*earned_at|zoneLabel/);
  });
});

describe('the same event stored under two keys is one step', () => {
  it('a catalog flag is shown as its stage', () => {
    expect(canonicalKey('hedge_event')).toBe('thelin_2');
    expect(canonicalKey('tthule_dead')).toBe('thelin_3');
    expect(canonicalKey('grummus_dead')).toBe('fuirstel_2');
    expect(canonicalKey('thelin_2')).toBe('thelin_2');
  });
  it('never onto a silent step: "Kill Grummus" is not the Crypt of Decay key', () => {
    expect(canonicalKey('grummus_dead')).not.toBe('grummus_1');
  });
  it('a flag that is no one step stays itself', () => {
    expect(canonicalKey('solro_minis')).toBe('solro_minis');
    expect(canonicalKey('hoh_trials')).toBe('hoh_trials');
    expect(canonicalKey('no_such_key')).toBe('no_such_key');
  });
  it('a character that earned both keys has one step on the board', () => {
    const { moments } = charMoments([row('Aldenmar', 'hedge_event', 60), row('Aldenmar', 'thelin_2', 60)]);
    expect(moments[0].steps).toHaveLength(1);
    const board = stageBoard(moments);
    const earned = board.tiers.flatMap(t => t.cards).flatMap(c => c.steps).filter(s => s.characters.length);
    expect(earned.map(s => s.key)).toEqual(['thelin_2']);
  });
});

describe('the chain order comes from the catalog\'s own prerequisites', () => {
  const line = (k) => LINES.find(l => l.key === k).keys;

  it('the Nightmare chain: hail before the maze, the hedge event, kill Terris Thule, the last hail', () => {
    expect(line('nightmare')).toEqual(['thelin_1', 'thelin_2', 'thelin_3', 'thelin_4']);
  });
  it('and the Decay chain, whose Carprin step sits between the ward and the Bertoxxulous kill', () => {
    const k = line('decay');
    expect(k.indexOf('fuirstel_1')).toBeLessThan(k.indexOf('fuirstel_2'));
    expect(k.indexOf('fuirstel_2')).toBeLessThan(k.indexOf('fuirstel_3'));
    expect(k.indexOf('fuirstel_3')).toBeLessThan(k.indexOf('fuirstel_4'));
    expect(k.indexOf('bertox_key_1')).toBeLessThan(k.indexOf('fuirstel_4'));
    expect(k.indexOf('fuirstel_4')).toBeLessThan(k.indexOf('fuirstel_5'));
  });
  it('in EVERY line, no step comes before a step it needs', () => {
    for (const l of LINES) {
      for (const b of l.keys) {
        for (const a of stepsHeld([b])) {
          if (a === b || !l.keys.includes(a) || stepsHeld([a]).has(b)) continue;
          expect(l.keys.indexOf(a), `${a} before ${b} in ${l.key}`).toBeLessThan(l.keys.indexOf(b));
        }
      }
    }
  });
  it('a step the checklist has no box for joins the line that needs it', () => {
    expect(lineOf('tylis_2')).toBe('torment');
    expect(line('torment').indexOf('tylis_2')).toBeLessThan(line('torment').indexOf('saryrn_1'));
  });
  it('a dependency beats the priority it was given', () => {
    const prio = { thelin_3: 0, thelin_4: 1, thelin_1: 2, thelin_2: 3 };
    expect(orderKeys(['thelin_3', 'thelin_4', 'thelin_1', 'thelin_2'], k => prio[k])).toEqual(['thelin_1', 'thelin_2', 'thelin_3', 'thelin_4']);
  });
  it('with no dependency between them, priority decides', () => {
    expect(orderKeys(['zeks_4', 'zeks_3'], k => ({ zeks_4: 0, zeks_3: 1 })[k])).toEqual(['zeks_4', 'zeks_3']);
  });
  it('the board lists the chain in step order whatever was earned most recently', () => {
    const { moments } = charMoments([
      row('Aldenmar', 'thelin_3', 60), row('Brackwyn', 'thelin_1', 7_200), row('Corvale', 'thelin_2', 3_600),
    ]);
    const card = stageBoard(moments).tiers.flatMap(t => t.cards).find(c => c.key === 'nightmare');
    expect(card.steps.map(s => s.key)).toEqual(['thelin_1', 'thelin_2', 'thelin_3', 'thelin_4']);
    expect(card.label).toBe('Nightmare to Terris Thule');
    expect(card.raiders).toBe(3);
  });
  it('a line nobody advanced is not on the board; a stray flag goes to its own card', () => {
    const { moments } = charMoments([row('Aldenmar', 'thelin_1', 60), row('Aldenmar', 'cloud_loot', 60)]);
    const board = stageBoard(moments);
    expect(board.tiers.flatMap(t => t.cards).map(c => c.key)).toEqual(['nightmare']);
    expect(board.other.steps.map(s => s.key)).toEqual(['cloud_loot']);
  });
  it('lines sit in the tier of their first plane', () => {
    const { moments } = charMoments([row('Aldenmar', 'thelin_1', 60), row('Aldenmar', 'karana_1', 60)]);
    expect(stageBoard(moments).tiers.map(t => [t.tier, t.cards.map(c => c.key)])).toEqual([[1, ['nightmare']], [2, ['storms']]]);
  });
});

describe('what relies on a step', () => {
  it('the hedge event unlocks the Terris Thule kill and the Lair', () => {
    const u = unlocksOf('thelin_2');
    expect(u.steps).toEqual(['thelin_3']);
    expect(u.zones.map(z => z.key)).toEqual(['ponb']);
  });
  it('the first hail unlocks only the next step, and the last one only the Torment gate', () => {
    expect(unlocksOf('thelin_1')).toEqual({ steps: ['thelin_2'], zones: [] });
    expect(unlocksOf('thelin_4').steps).toEqual([]);
    expect(unlocksOf('thelin_4').zones.map(z => z.key)).toEqual(['torment']);
  });
  it('it is the reverse of STEP_IMPLIES: every listed dependent really implies the step', () => {
    for (const l of LINES) {
      for (const k of l.keys) {
        for (const d of unlocksOf(k).steps) expect(stepsHeld([d]).has(k), `${d} needs ${k}`).toBe(true);
      }
    }
  });
  it('only the nearest dependents are named', () => {
    // fuirstel_5 needs fuirstel_4 needs fuirstel_3: the ward step unlocks the Bertoxxulous kill, not the last hail.
    expect(unlocksOf('fuirstel_3').steps).toEqual(['fuirstel_4']);
    expect(STEP_IMPLIES.fuirstel_5).toEqual(['fuirstel_4']);
  });
  it('is on every board step', () => {
    const { moments } = charMoments([row('Aldenmar', 'thelin_2', 60)]);
    const card = stageBoard(moments).tiers[0].cards[0];
    const step = card.steps.find(s => s.key === 'thelin_2');
    expect(step.unlocks.steps.map(s => s.key)).toEqual(['thelin_3']);
    expect(step.unlocks.zones[0].name).toBe('Lair of Terris Thule');
  });
});

describe('every "and N more" opens (the dead "and 29 more")', () => {
  it('the board keeps EVERY name: nothing is cut in the model', () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(`Raider${String(i).padStart(2, '0')}`, 'zeks_3', 60 + i));
    const step = stageBoard(charMoments(rows).moments).tiers.flatMap(t => t.cards).flatMap(c => c.steps).find(s => s.key === 'zeks_3');
    expect(step.characters).toHaveLength(30);
    expect(30 - NAMES_SHOWN).toBeGreaterThan(0);
  });
  it('the stream row keeps every name too', () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(`Raider${String(i).padStart(2, '0')}`, 'zeks_3', 60 + i));
    expect(clusterMoments(charMoments(rows).moments)[0].characters).toHaveLength(30);
  });

  const files = ['ExpandList', 'Stream', 'StageBoard', 'page'].map(n => [n, read(`web/app/pop/latest/${n}.tsx`)]);
  const src = Object.fromEntries(files);
  it('the only place that says "more" is a <summary> inside a <details>', () => {
    expect(src.ExpandList).toMatch(/<details[^>]*>\s*<summary[^>]*>and \{rest\.length\} more/);
    for (const n of ['Stream', 'StageBoard', 'page']) expect(src[n], n).not.toMatch(/\bmore\b/);
  });
  it('every file in the folder opens as many <details> as it has <summary>', () => {
    for (const [n, s] of files) expect((s.match(/<summary/g) ?? []).length, n).toBe((s.match(/<details/g) ?? []).length);
  });
  it('the stream and the board put their names and steps through ExpandList', () => {
    expect(src.Stream).toMatch(/import ExpandList from '\.\/ExpandList'/);
    expect(src.Stream).toMatch(/<ExpandList items=\{c\.characters\.map/);
    expect(src.Stream).toMatch(/<ExpandList items=\{steps\} limit=\{STEPS_SHOWN\}/);
    expect(src.StageBoard).toMatch(/<ExpandList items=\{s\.characters\.map/);
    expect(src.StageBoard).toMatch(/limit=\{NAMES_SHOWN\}/);
  });
  it('only the part past the limit is folded', () => {
    expect(src.ExpandList).toMatch(/items\.slice\(0, limit\)/);
    expect(src.ExpandList).toMatch(/items\.slice\(limit\)/);
    expect(src.ExpandList).toMatch(/rest\.length > 0 &&/);
  });
  it('the long list of earlier moments is a <details> too', () => {
    expect(src.Stream).toMatch(/later\.length > 0 &&[\s\S]*<details>[\s\S]*earlier moments/);
  });
});

describe('who in the raid still needs it', () => {
  const cluster = { steps: [{ key: 'thelin_2' }, { key: 'thelin_3' }], characters: [{ name: 'Aldenmar' }, { name: 'Brackwyn' }] };
  const held = new Map([
    ['corvale', new Set(['thelin_2', 'thelin_3'])],
    ['nyssara', new Set(['thelin_2'])],
  ]);
  const raid = ['Zarrin', 'Aldenmar', 'Corvale', 'nyssara', 'Rethlan'];

  it('lists raid members who do not hold the steps, A-Z, never someone in the cluster or who holds them', () => {
    expect(stillNeeds(cluster, raid, held).map(n => n.name)).toEqual(['nyssara', 'Rethlan', 'Zarrin']);
  });
  it('says which steps a partial holder is missing', () => {
    const n = stillNeeds(cluster, raid, held);
    expect(n[0]).toEqual({ name: 'nyssara', missing: ['thelin_3'] });
    expect(n[1].missing).toEqual(['thelin_2', 'thelin_3']);
  });
  it('a member nobody has a row for holds nothing', () => {
    expect(stillNeeds(cluster, ['Quillan'], new Map())).toEqual([{ name: 'Quillan', missing: ['thelin_2', 'thelin_3'] }]);
  });
  it('a raid of people who all hold it needs nobody', () => {
    expect(stillNeeds(cluster, ['Corvale'], held)).toEqual([]);
  });

  const listing = listingOf([
    { name: 'Aldenmar', rank: 'Raid Pack', active: true, hidden_from_lists: false },
    { name: 'Brackwyn', rank: 'Raid Pack', active: true, hidden_from_lists: false },
    { name: 'Corvale', rank: 'Trader', active: true, hidden_from_lists: false },
    { name: 'Nyssara', rank: 'Raid Alt', active: true, hidden_from_lists: false },
  ]);
  const rows = [row('Aldenmar', 'thelin_2', 600), row('Brackwyn', 'thelin_2', 590)];

  it('buildView attaches the check to each row when a raid is live, and leaves it off when none is', () => {
    const on = buildView(rows, ['Brackwyn', 'Aldenmar', 'Nyssara'], listing, new Map(), { window: '7d', scope: 'all', order: 'az' }, T0);
    expect(on.raidSize).toBe(3);
    expect(on.needs.get(on.clusters[0].id).map(n => n.name)).toEqual(['Nyssara']);
    const off = buildView(rows, null, listing, new Map(), { window: '7d', scope: 'all', order: 'az' }, T0);
    expect(off.raidSize).toBeNull();
    expect(off.needs.size).toBe(0);
  });
  it('raid members the page filters out (a trader, a hidden one, a low level) are not listed as needing it', () => {
    const l = listingOf([
      { name: 'Aldenmar', rank: 'Raid Pack', active: true, hidden_from_lists: false },
      { name: 'Corvale', rank: 'Trader', active: true, hidden_from_lists: false },
      { name: 'Rethlan', rank: 'Raid Pack', active: true, hidden_from_lists: true },
      { name: 'Quillan', rank: 'Raid Pack', active: true, hidden_from_lists: false },
      { name: 'Dunmere', rank: 'Raid Pack', active: true, hidden_from_lists: false },
      { name: 'Eslin', rank: 'Raid Pack', active: true, hidden_from_lists: false },
    ]);
    const v = buildView([row('Aldenmar', 'thelin_2', 60)], ['Corvale', 'Rethlan', 'Quillan', 'Dunmere', 'Eslin'], l,
      new Map([['quillan', 65], ['dunmere', 30]]), { window: '7d', scope: 'all', order: 'az' }, T0);
    expect(v.needs.get(v.clusters[0].id).map(n => n.name)).toEqual(['Eslin', 'Quillan']);   // Eslin: level unknown, stays
    expect(v.raidSize).toBe(2);
  });
  it('the Mains scope narrows the raid too', () => {
    const v = buildView(rows, ['Aldenmar', 'Brackwyn', 'Nyssara'], listing, new Map(), { window: '7d', scope: 'mains', order: 'az' }, T0);
    expect(v.raidSize).toBe(2);
    expect(v.needs.get(v.clusters[0].id)).toEqual([]);
  });
});

describe('the filters', () => {
  const listing = listingOf([
    { name: 'Aldenmar', rank: 'Raid Pack', active: true, hidden_from_lists: false },
    { name: 'Brackwyn', rank: 'Raid Alt', active: true, hidden_from_lists: false },
    { name: 'Corvale', rank: 'Trader', active: true, hidden_from_lists: false },
    { name: 'Dunmere', rank: 'Officer', active: false, hidden_from_lists: false },
    { name: 'Eslin', rank: 'Recruit', active: true, hidden_from_lists: true },
  ]);
  const view = (rows, over = {}, levels = new Map()) =>
    buildView(rows, null, listing, levels, { window: DEFAULT_WINDOW, scope: 'all', order: 'az', ...over }, T0);

  it('reads the view from the URL and falls back to the defaults for anything else', () => {
    expect(parseView({})).toEqual({ window: '7d', scope: 'mains', order: 'az' });
    expect(parseView({ w: '24h', scope: 'all', order: 'time' })).toEqual({ window: '24h', scope: 'all', order: 'time' });
    expect(parseView({ w: '3d' }).window).toBe('3d');
    expect(parseView({ w: '30d', scope: 'x', order: ['time'] })).toEqual({ window: '7d', scope: 'mains', order: 'az' });
    expect(parseView({ w: ['24h'] }).window).toBe('7d');
  });
  it('the windows are 24 hours, 3 days and 7 days, and the default is 7', () => {
    expect(WINDOWS).toEqual({ '24h': 1, '3d': 3, '7d': 7 });
    expect(DEFAULT_WINDOW).toBe('7d');
  });
  const old = [row('Aldenmar', 'zeks_3', 3_600), row('Brackwyn', 'thelin_2', 2 * 86_400), row('Aldenmar', 'tylis_1', 5 * 86_400)];
  it('24 h keeps only the last day, 3 d the last three, 7 d the week', () => {
    expect(view(old, { window: '24h' }).moments).toBe(1);
    expect(view(old, { window: '3d' }).moments).toBe(2);
    expect(view(old, { window: '7d' }).moments).toBe(3);
  });
  it('a row older than the window is not on the board either', () => {
    const steps = view(old, { window: '24h' }).board.tiers.flatMap(t => t.cards).flatMap(c => c.steps).filter(s => s.characters.length);
    expect(steps.map(s => s.key)).toEqual(['zeks_3']);
  });
  it('an old row still counts as held for the repeat check', () => {
    const rows = [row('Aldenmar', 'fuirstel_2', 4 * 86_400, 'recital'), row('Aldenmar', 'fuirstel_2', 3_600, 'recital')];
    const v = view(rows, { window: '24h' });
    expect(v.moments).toBe(0);
    expect(v.repeats).toBe(1);
  });
  it('Mains keeps raider ranks that are active, and All keeps the raid alts too', () => {
    const rows = ['Aldenmar', 'Brackwyn', 'Dunmere'].map(n => row(n, 'zeks_3', 60));
    expect(names(view(rows, { scope: 'mains' }).clusters[0])).toEqual(['Aldenmar']);
    expect(names(view(rows, { scope: 'all' }).clusters[0])).toEqual(['Aldenmar', 'Brackwyn', 'Dunmere']);
  });
  it('traders, hidden characters and known levels under 46 are left out of both scopes; an unknown level stays', () => {
    const rows = ['Aldenmar', 'Brackwyn', 'Corvale', 'Eslin', 'Dunmere'].map(n => row(n, 'zeks_3', 60));
    const levels = new Map([['brackwyn', 30], ['aldenmar', 65]]);
    for (const scope of ['mains', 'all']) {
      const got = names(view(rows, { scope }, levels).clusters[0]);
      expect(got, scope).not.toContain('Corvale');
      expect(got, scope).not.toContain('Eslin');
      expect(got, scope).not.toContain('Brackwyn');
      expect(got, scope).toContain('Aldenmar');
    }
    expect(names(view(rows, { scope: 'all' }, levels).clusters[0])).toContain('Dunmere');
  });
  it('keepName is one rule for rows and raid names', () => {
    expect(keepName('aldenmar', listing, new Map(), 'mains')).toBe(true);
    expect(keepName('Brackwyn', listing, new Map(), 'mains')).toBe(false);
    expect(keepName('Brackwyn', listing, new Map(), 'all')).toBe(true);
    expect(keepName('Corvale', listing, new Map(), 'all')).toBe(false);
  });
  it('the name order changes the order of names, not which rows there are', () => {
    const rows = [row('Aldenmar', 'zeks_3', 100), row('Zarrin', 'zeks_3', 50)];   // Zarrin is the newer
    const az = view(rows, { order: 'az' });
    const tm = view(rows, { order: 'time' });
    expect(az.clusters).toHaveLength(tm.clusters.length);
    expect(names(az.clusters[0])).toEqual(['Aldenmar', 'Zarrin']);
    expect(names(tm.clusters[0])).toEqual(['Zarrin', 'Aldenmar']);
    const step = (v) => v.board.tiers.flatMap(t => t.cards).flatMap(c => c.steps).find(s => s.key === 'zeks_3');
    expect(step(az).characters.map(w => w.name)).toEqual(['Aldenmar', 'Zarrin']);
    expect(step(tm).characters.map(w => w.name)).toEqual(['Zarrin', 'Aldenmar']);
  });
});

describe('the reads: paged, one call each, no per character queries', () => {
  function fakeDb(pages = [[]]) {
    const calls = [];
    let page = 0;
    const chain = new Proxy({}, {
      get: (_t, name) => {
        if (name === 'then') return (res) => res({ data: pages[Math.min(page++, pages.length - 1)], error: null });
        return (...args) => { calls.push([name, ...args]); return chain; };
      },
    });
    return { calls, db: { from: (t) => { calls.push(['from', t]); return chain; } } };
  }
  it('the live raid is a raid_roster row captured in the last 15 minutes, paged on its primary key', async () => {
    const { calls, db } = fakeDb([[]]);
    await loadRaidNames(db, T0);
    const of = (n) => calls.filter(c => c[0] === n);
    expect(of('from')[0][1]).toBe('raid_roster');
    expect(of('gte')[0]).toEqual(['gte', 'captured_at', new Date(T0 - RAID_FRESH_MS).toISOString()]);
    expect(RAID_FRESH_MS).toBe(15 * 60_000);
    expect(of('order').map(c => c[1])).toEqual(['uploaded_by_discord_id', 'name']);
    expect(of('range')).toHaveLength(1);
  });
  it('names repeat once per uploader and are listed once; a corpse is not a raider; nothing fresh is null', async () => {
    const rows = [{ name: 'Aldenmar' }, { name: 'aldenmar' }, { name: 'Brackwyn' }, { name: "Corvale's corpse1234" }];
    expect(await loadRaidNames(fakeDb([rows]).db, T0)).toEqual(['Aldenmar', 'Brackwyn']);
    expect(await loadRaidNames(fakeDb([[]]).db, T0)).toBeNull();
  });
  it('a history of 90 days is read so a repeat can be told from news; the strip keeps its 7', async () => {
    const { calls, db } = fakeDb([[]]);
    await loadLatestFlagRows(db, T0, HISTORY_DAYS);
    expect(calls.find(c => c[0] === 'gte')).toEqual(['gte', 'earned_at', new Date(T0 - 90 * 86_400_000).toISOString()]);
    const strip = fakeDb([[]]);
    await loadLatestFlagRows(strip.db, T0);
    expect(strip.calls.find(c => c[0] === 'gte')[2]).toBe(new Date(T0 - 7 * 86_400_000).toISOString());
  });
  it('the page makes one call per read: the roster, the rows, the raid and one level lookup', () => {
    const page = read('web/app/pop/latest/page.tsx');
    expect(page).toMatch(/loadRoster\(\)/);
    expect(page).toMatch(/loadLatestFlagRows\(sb, now, HISTORY_DAYS\)/);
    expect(page).toMatch(/loadRaidNames\(sb, now\)/);
    expect((page.match(/loadLevels\(/g) ?? [])).toHaveLength(1);
    expect(page).not.toMatch(/\.from\(/);
    expect(page).not.toMatch(/for \([^)]*\) \{[^}]*await/);
  });
  it('the raid read pages with selectAll and takes the tag from GUILD_TAG', () => {
    const lib = read('web/lib/popLatestView.ts');
    expect(lib).toMatch(/selectAll<\{ name: string \}>/);
    expect(lib).toMatch(/\.eq\('guild_id', GUILD_TAG\)/);
    expect(lib).not.toMatch(/'wolfpack'/);
  });
});

describe('the page', () => {
  const page = read('web/app/pop/latest/page.tsx');
  it('is marked [beta] at the top, in the tab, and on the link card', () => {
    expect(page).toMatch(/<NewPageTag/);
    expect(page).toMatch(/title: '\[beta\] Latest flags'/);
    expect(metaForPath('/pop/latest').title).toBe('[beta] Latest flags');
  });
  it('is members only', () => {
    expect(page).toMatch(/redirect\(`\/auth\/signin\?next=/);
  });
  it('By stage is a native <details> that starts open', () => {
    expect(page).toMatch(/<details open /);
    expect(page).toMatch(/By stage/);
    expect(page.indexOf('<Stream')).toBeLessThan(page.indexOf('<StageBoard'));
  });
  it('carries the window, scope and name order in the links', () => {
    expect(page).toMatch(/hrefFor\(\{ w \}\)/);
    expect(page).toMatch(/hrefFor\(\{ scope: 'mains' \}\)/);
    expect(page).toMatch(/hrefFor\(\{ scope: 'all' \}\)/);
    expect(page).toMatch(/hrefFor\(\{ order: 'az' \}\)/);
  });
});
