// test/pop-next-steps.test.js — the "next steps for flags" panel at the top of /pop/guide (the guild lead,
// 2026-10-10: "are we taking piecemeal flags? if so we should put at the top of the guide next steps for
// flags in a consolidated place"). web/lib/popNextSteps.ts is pure: it reads the same done-state the
// checklist has, and every prerequisite it applies comes from popFlags.ts (the plane gates) and popWho.ts
// (GATE_IMPLIES), which these tests also hold it to.
//
// Run: npx vitest run test/pop-next-steps.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { GUIDE_ITEMS } from '../web/lib/popGuide.ts';
import { POP_FLAGS, POP_ZONE_BY_KEY } from '../web/lib/popFlags.ts';
import { GATE_IMPLIES } from '../web/lib/popWho.ts';
import { NEXT_LINES, nextSteps, charNextSteps, topNext, nextCard, nxMode } from '../web/lib/popNextSteps.ts';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const byLine = (res) => Object.fromEntries(res.map(l => [l.line, l]));
const keys = (l) => l.steps.map(s => s.key);

describe('the line table', () => {
  it('names only real guide steps, each on one line only', () => {
    const real = new Set(GUIDE_ITEMS.map(i => i.key));
    const seen = new Map();
    for (const line of NEXT_LINES) {
      for (const st of line.stages) {
        expect(st.steps.length, line.key).toBeGreaterThan(0);
        for (const k of st.steps) {
          expect(real.has(k), `${line.key}: ${k}`).toBe(true);
          expect(seen.has(k), `${k} is on ${seen.get(k)} and ${line.key}`).toBe(false);
          seen.set(k, line.key);
        }
      }
    }
  });

  it('reads its gates from the PoP catalog: every zone, flag and need it names exists', () => {
    for (const line of NEXT_LINES) {
      for (const st of line.stages) {
        if (st.zone) expect(POP_ZONE_BY_KEY[st.zone], `${line.key} zone ${st.zone}`).toBeTruthy();
        for (const f of [...(st.flags ?? []), ...(st.needs ?? [])]) expect(POP_FLAGS[f], `${line.key} flag ${f}`).toBeTruthy();
      }
    }
  });

  it('keeps the guide\'s own order: a line never runs a step ahead of one the checklist lists first', () => {
    const at = new Map(GUIDE_ITEMS.map((i, n) => [i.key, n]));
    for (const line of NEXT_LINES) {
      const order = line.stages.flatMap(s => s.steps).map(k => at.get(k));
      expect(order, line.key).toEqual([...order].sort((a, b) => a - b));
    }
  });

  it('holds every must-have step from tier one on to a line, so none is silently dropped', () => {
    const onLine = new Set(NEXT_LINES.flatMap(l => l.stages.flatMap(s => s.steps)));
    const missing = GUIDE_ITEMS.filter(i => i.must && ['t1', 't2', 't3', 't4', 'time'].includes(i.section) && !onLine.has(i.key)).map(i => i.key);
    expect(missing).toEqual([]);
  });

  it('leaves the optional steps off (keys, hammers, the Binden, the essences)', () => {
    const onLine = new Set(NEXT_LINES.flatMap(l => l.stages.flatMap(s => s.steps)));
    for (const i of GUIDE_ITEMS) if (/^Optional/.test(i.title)) expect(onLine.has(i.key), i.key).toBe(false);
  });
});

describe('a character with nothing done', () => {
  const res = byLine(nextSteps({ done: [] }));

  it('starts each open line at its first step', () => {
    expect(keys(res.decay)).toEqual(['disease_ward']);
    expect(keys(res.justice)).toEqual(['justice_mavuin_info']);
    expect(keys(res.innovation)).toEqual(['innovation_test']);
    expect(keys(res.nightmare)).toEqual(['nightmare_adroha']);
    for (const k of ['decay', 'justice', 'innovation', 'nightmare']) expect(res[k].state, k).toBe('next');
  });

  it('blocks every line behind a gate, and names the flag and the line it comes from', () => {
    for (const k of ['storms', 'valor', 'torment', 'tactics', 'maelin', 'solro', 'air', 'water', 'earth', 'time']) {
      expect(res[k].state, k).toBe('blocked');
      expect(res[k].blockedOn.length, k).toBeGreaterThan(0);
    }
    expect(res.storms.blockedOn.map(b => [b.flag, b.line])).toEqual([['trial_justice', 'justice']]);
    expect(res.tactics.blockedOn.map(b => [b.flag, b.line])).toEqual([['behemoth_dead', 'innovation']]);
    const torment = Object.fromEntries(res.torment.blockedOn.map(b => [b.flag, b.line]));
    expect(torment).toEqual({ fuirstel_5: 'decay', thelin_4: 'nightmare' });
  });

  it('never leaves a blocker with nowhere to come from', () => {
    for (const l of Object.values(res)) for (const b of l.blockedOn) expect(b.line, `${l.line} <- ${b.flag}`).toBeTruthy();
  });

  it('still says what the blocked step would be, once unblocked', () => {
    expect(keys(res.storms)).toEqual(['flag_askr']);
    expect(keys(res.torment)).toEqual(['torment_fahlia']);
  });

  it('answers who you need and where, from the guide\'s own data', () => {
    const s = res.decay.steps[0];
    expect(s.who).toBe('solo');
    expect(s.zone).toBe('Plane of Tranquility');          // Adler Fuirstel stands there (the step's first placed NPC)
    expect(s.must).toBe(true);
    const kill = nextSteps({ done: ['disease_ward'] }).find(l => l.line === 'decay').steps[0];
    expect(kill.key).toBe('flag_grummus');
    expect(kill.who).toBe('group');
    expect(kill.flag).toBe('grummus_dead');
    expect(kill.flagLabel).toBe(POP_FLAGS.grummus_dead.label);
    expect(kill.zone).toBe('Plane of Disease');            // no placed NPC: the plane its stage opens
  });

  it('turns item tokens in a title back into plain names', () => {
    for (const l of Object.values(res)) for (const s of l.steps) expect(s.title).not.toMatch(/\[\[|#\d+\]\]/);
  });
});

describe('prerequisites', () => {
  it('moves a line on only when the step before it is done', () => {
    expect(keys(byLine(nextSteps({ done: ['disease_ward'] })).decay)).toEqual(['flag_grummus']);
    const res = byLine(nextSteps({ done: ['disease_ward', 'flag_grummus'] }));
    expect(keys(res.decay)).toEqual(['cod_fuirstel_before']);
  });

  it('holds the Crypt line at Grummus until the Disease flag is held', () => {
    // The ward talk ticked, the kill not: the next step is the kill, never the Crypt hail.
    const res = byLine(nextSteps({ done: ['disease_ward'] }));
    expect(res.decay.state).toBe('next');
    expect(keys(res.decay)).not.toContain('cod_fuirstel_before');
  });

  it('opens Storms and Valor on the Justice flag, from a Mimic flag alone', () => {
    const res = byLine(nextSteps({ done: [], flags: ['trial_justice'] }));
    expect(keys(res.storms)).toEqual(['flag_askr']);
    expect(res.storms.state).toBe('next');
    expect(keys(res.valor)).toEqual(['flag_aerindar']);
    expect(res.justice.state).toBe('done');
  });

  it('opens Torment only with BOTH Tranquility thank-yous, and tells which one is missing', () => {
    let res = byLine(nextSteps({ done: [], flags: ['fuirstel_5'] }));
    expect(res.torment.state).toBe('blocked');
    expect(res.torment.blockedOn.map(b => b.flag)).toEqual(['thelin_4']);
    res = byLine(nextSteps({ done: [], flags: ['fuirstel_5', 'thelin_4'] }));
    expect(res.torment.state).toBe('next');
    expect(keys(res.torment)).toEqual(['torment_fahlia']);
  });

  it('counts a flag no step names when it was ticked by hand as a flag: tick key', () => {
    const res = byLine(nextSteps({ done: ['flag:fuirstel_5', 'flag:thelin_4'] }));
    expect(res.torment.state).toBe('next');
    // …and the Decay line is finished, since that flag is its last stage.
    expect(res.decay.state).toBe('done');
  });

  it('applies GATE_IMPLIES: the cipher waits for Saryrn and Mithaniel Marr, from the shared table', () => {
    const res = byLine(nextSteps({ done: [] }));
    expect(res.maelin.blockedOn.map(b => b.flag).sort()).toEqual([...GATE_IMPLIES.cipher_1].sort());
    const open = byLine(nextSteps({ done: [], flags: ['saryrn_dead', 'marr_dead'] }));
    expect(keys(open.maelin)).toEqual(['maelin_cipher']);
  });

  it('keeps Maelin\'s second reading behind the Zek notes (the guide says the order matters)', () => {
    const res = byLine(nextSteps({ done: ['maelin_cipher', 'maelin_lore'], flags: ['askr_quest', 'agnarr_dead', 'marr_dead'] }));
    expect(res.maelin.state).toBe('blocked');
    expect(res.maelin.blockedOn.map(b => b.flag)).toEqual(['zeks_6']);
    expect(res.maelin.blockedOn[0].line).toBe('tactics');
  });

  it('keeps the Plane of Time behind the four elemental gods, from the shared table', () => {
    const res = byLine(nextSteps({ done: [] }));
    expect(res.time.state).toBe('blocked');
    expect(res.time.blockedOn.map(b => b.flag).sort()).toEqual([...GATE_IMPLIES.time_1].sort());
    const open = byLine(nextSteps({ done: [], flags: GATE_IMPLIES.time_1 }));
    expect(keys(open.time)).toEqual(['time_quintessence']);
    expect(keys(byLine(nextSteps({ done: ['time_quintessence'], flags: GATE_IMPLIES.time_1 })).time)).toEqual(['time_muon']);
  });

  it('does not let a flag in one plane skip the planes before it', () => {
    // Kill-credit for Bertoxxulous proves the Crypt gate (carprin) and the Disease flag behind it.
    const res = byLine(nextSteps({ done: [], flags: ['bert_dead'] }));
    expect(keys(res.decay)).toEqual(['cod_fuirstel_after']);
    expect(res.innovation.state).toBe('next');             // an unrelated line is untouched
  });
});

describe('done lines', () => {
  it('reports a finished line as done with nothing to do', () => {
    const res = byLine(nextSteps({ done: [], flags: ['coirnav_dead'] }));
    expect(res.water.state).toBe('done');
    expect(res.water.steps).toEqual([]);
    expect(res.water.done).toBe(res.water.total);
  });

  it('reports every line done for a character with every step ticked', () => {
    const all = NEXT_LINES.flatMap(l => l.stages.flatMap(s => s.steps));
    const res = nextSteps({ done: all });
    expect(res.map(l => l.state)).toEqual(res.map(() => 'done'));
    expect(nextCard(res).finished).toBe(NEXT_LINES.length);
  });
});

describe('a stage of several steps', () => {
  const base = ['flag_aerindar', 'valor_zone_hoh'];
  it('offers them all, in the guide\'s order, and drops each as it is done', () => {
    let res = byLine(nextSteps({ done: base, flags: ['trial_justice'] }));
    expect(keys(res.valor)).toEqual(['hoh_trial_dragon', 'hoh_trial_villagers', 'hoh_trial_villager']);
    res = byLine(nextSteps({ done: [...base, 'hoh_trial_villagers'], flags: ['trial_justice'] }));
    expect(keys(res.valor)).toEqual(['hoh_trial_dragon', 'hoh_trial_villager']);
  });

  it('opens the Marr kill when the trials flag is held, even though no trial step was ticked', () => {
    const res = byLine(nextSteps({ done: base, flags: ['trial_justice', 'hoh_trials'] }));
    expect(keys(res.valor)).toEqual(['flag_marr']);
  });

  it('opens the Marr kill when all three trials are ticked', () => {
    const res = byLine(nextSteps({ done: [...base, 'hoh_trial_dragon', 'hoh_trial_villagers', 'hoh_trial_villager'], flags: ['trial_justice'] }));
    expect(keys(res.valor)).toEqual(['flag_marr']);
  });
});

describe('a later step ticked without the one before it', () => {
  // Decision: the later tick is trusted. Everything before the furthest progress is passed, so the next
  // step is the first thing left at or after it, and the steps that were skipped are reported, not hidden.
  it('trusts it: the line moves on, and the skipped step is reported', () => {
    const res = byLine(nextSteps({ done: ['flag_grummus'] }));
    expect(keys(res.decay)).toEqual(['cod_fuirstel_before']);
    expect(res.decay.skipped).toEqual(['disease_ward']);
  });

  it('reports nothing skipped for a line followed in order', () => {
    const res = byLine(nextSteps({ done: ['disease_ward', 'flag_grummus'] }));
    expect(res.decay.skipped).toEqual([]);
  });

  it('counts the passed step as behind the character, not as work left', () => {
    const res = byLine(nextSteps({ done: ['flag_grummus'] }));
    expect(res.decay.done).toBe(2);
    expect(res.decay.total).toBe(6);
  });

  it('works from a recorded kill as well as a tick (Terris Thule dead, hedge maze never ticked)', () => {
    const res = byLine(nextSteps({ done: [], flags: ['tthule_dead'] }));
    expect(keys(res.nightmare)).toEqual(['nightmare_poxbourne']);
    expect(res.nightmare.skipped).toEqual(['nightmare_adroha']);
  });
});

describe('inputs', () => {
  it('ignores keys it does not know, and takes any iterable', () => {
    const res = nextSteps({ done: new Set(['nope', 'flag:nope', 'flag:constructor']), flags: new Set(['also_nope']) });
    expect(res).toHaveLength(NEXT_LINES.length);
    expect(byLine(res).decay.steps[0].key).toBe('disease_ward');
  });

  it('builds the input from a route character: ticks, evidence by step, and flags', () => {
    const res = byLine(charNextSteps({ manual: ['disease_ward'], auto: { flag_grummus: { source: 'mimic' } }, flags: ['grummus_dead'] }));
    expect(keys(res.decay)).toEqual(['cod_fuirstel_before']);
    expect(res.decay.skipped).toEqual([]);
  });
});

describe('what the page shows first', () => {
  it('puts must-haves ahead of the rest, one step per line, in the guide\'s order, capped', () => {
    const lines = nextSteps({ done: [] });
    const top = topNext(lines, 3);
    expect(top).toHaveLength(3);
    expect(new Set(top.map(t => t.line.line)).size).toBe(3);
    expect(top.every(t => t.step.must)).toBe(true);
    const at = new Map(GUIDE_ITEMS.map((i, n) => [i.key, n]));
    const idx = top.map(t => at.get(t.step.key));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });

  it('sizes the card: what was left off, what is waiting, what is finished', () => {
    const card = nextCard(nextSteps({ done: [] }), 3);
    expect(card.top).toHaveLength(3);
    expect(card.more).toBe(1);                              // four open lines, three shown
    expect(card.blocked.length + card.finished + 4).toBe(card.lines);
    expect(card.blocked.every(b => b.blockedOn.length > 0)).toBe(true);
  });

  it('counts "more" over lines with something to do now, never over finished or waiting ones', () => {
    // Holding the Water flag proves the planes on the way in: Justice, Storms, Valor and Maelin finish too.
    const lines = nextSteps({ done: [], flags: ['coirnav_dead'] });
    const card = nextCard(lines, 1);
    expect(byLine(lines).water.state).toBe('done');
    expect(card.finished).toBe(lines.filter(l => l.state === 'done').length);
    expect(card.finished).toBeGreaterThan(1);
    expect(card.top.length + card.more).toBe(lines.filter(l => l.state === 'next').length);
    expect(card.blocked.map(b => b.line)).toEqual(lines.filter(l => l.state === 'blocked').map(l => l.line));
  });
});

describe('the ?nx switch', () => {
  it('shows a panel only for a or b; anything else, or nothing, is the page as production has it', () => {
    expect(nxMode('a')).toBe('a');
    expect(nxMode('b')).toBe('b');
    for (const raw of [undefined, null, '', 'c', 'A', '1', 'a ', ['a', 'b']]) expect(nxMode(raw), String(raw)).toBe(null);
  });

  const page = stripJs(read('web/app/pop/guide/page.tsx'));

  it('builds the panels behind that switch and nowhere else', () => {
    expect(page).toMatch(/const nxPanel = mode\s*\?/);
    const gated = page.slice(page.indexOf('const nxPanel'), page.indexOf(': null;', page.indexOf('const nxPanel')));
    expect(gated).toContain('<NextUp');
    expect(gated).toContain('<NextTable');
    expect(page.match(/<NextUp/g)).toHaveLength(1);
    expect(page.match(/<NextTable/g)).toHaveLength(1);
  });

  it('renders the panel in all three layouts, above the checklist', () => {
    expect(page.match(/\{nxPanel\}/g)).toHaveLength(2);     // the ?v=b/c branch and the default branch
    const [routeBranch, defaultBranch] = page.split("if (v === 'b' || v === 'c') {")[1].split('const names = mine.map');
    expect(routeBranch.indexOf('{nxPanel}')).toBeGreaterThan(-1);
    expect(routeBranch.indexOf('{nxPanel}')).toBeLessThan(routeBranch.indexOf('<GuideRoute'));
    expect(defaultBranch.indexOf('{nxPanel}')).toBeLessThan(defaultBranch.indexOf('<GuideChecklist'));
  });

  it('loads the route data only when a layout or a panel needs it', () => {
    expect(page).toMatch(/const routeLoad = \(v === 'b' \|\| v === 'c' \|\| mode\) \? loadRoute\(mine\) : null;/);
  });

  it('links to the same anchors the rows carry, in each layout', () => {
    const checklist = stripJs(read('web/app/pop/guide/GuideChecklist.tsx'));
    const route = stripJs(read('web/app/pop/guide/GuideRoute.tsx'));
    expect(checklist).toContain('const id = `guide-${item.key}`');
    expect(route).toContain('const id = `route-${item.key}`');
    expect(page).toMatch(/anchorPrefix = \(v === 'b' \|\| v === 'c'\) \? 'route-' : 'guide-'/);
  });

  it('keeps the browser light: variant A takes plain data and imports only types from the lib', () => {
    const up = stripJs(read('web/app/pop/guide/NextUp.tsx'));
    expect(up).toMatch(/import type \{ NextCard, NextStep \} from '@\/lib\/popNextSteps'/);
    expect(up).not.toMatch(/import \{[^}]*\} from '@\/lib\/popNextSteps'/);
    expect(up).toContain("useSearchParams()?.get('c')");       // follows the checklist's own character picker
    expect(up).toContain('`#${anchorPrefix}${t.step.key}`');
  });

  it('lets variant B\'s table scroll inside its own box, never the page', () => {
    const table = stripJs(read('web/app/pop/guide/NextTable.tsx'));
    expect(table).toMatch(/overflow-x-auto[^"]*"[^>]*>\s*<table/);
    expect(table).not.toContain("'use client'");
  });

  it('opens a closed level when the link points at a step inside it, also after arrival', () => {
    const route = stripJs(read('web/app/pop/guide/GuideRoute.tsx'));
    expect(route).toMatch(/id === `route-\$\{i\.key\}`/);
    expect(route).toContain("addEventListener('hashchange'");
    expect(route).toContain("removeEventListener('hashchange'");
  });
});
