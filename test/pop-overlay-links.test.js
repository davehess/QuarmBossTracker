// test/pop-overlay-links.test.js — every key the flag engine can name lands on a step of the PoP overlay's Quests mode,
// and that step renders where the link takes you.
//
// The guild lead, 2026-10-27: the Flags checklist in Mimic comes "with deep linking to steps in the rest of that overlay".
// The bot's `pop` stream names things by KEY (a server step 'fuirstel_1', a Seer pending memory 'cl_grummus', a plane
// 'codb', a catalog flag 'cipher_1', a guide step 'flag_grummus'); the overlay turns each into a jump through the
// `anchors` table in the generated apps/mimic/pop-quests.js (scripts/sync-pop-quests.js writes it from the same web files
// the engine is built from). This is the gate that says no engine key leads nowhere:
//   · every step of every NEXT_LINES stage, every POP_STEPS stage, every pending memory, every chart zone, every gate the
//     chart or the engine can name as a blocker resolves, EXCEPT the few that no guide step does, which are listed here
//     by name so a new one is a red test and a fixed one is too;
//   · every key that resolves opens a step that exists, draws it with the `data-step` the ring lands on, and its plane's
//     list carries a block for it.
//
// Run: npx vitest run test/pop-overlay-links.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { sliceBlock, evalBlock, ROOT } from './_source-slice.js';
import { popHtml, REAL, bootPop } from './_pop-overlay-harness.js';
import { NEXT_LINES } from '../web/lib/popNextSteps.ts';
import { POP_STEPS } from '../web/lib/popSteps.ts';
import { PENDING_MEMORIES } from '../web/lib/popRecital.ts';
import { POP_ZONES, POP_FLAGS } from '../web/lib/popFlags.ts';
import { GATE_IMPLIES } from '../web/lib/popWho.ts';
import { GUIDE_ITEMS } from '../web/lib/popGuide.ts';

const ESC_SRC = sliceBlock(popHtml, 'function esc(s){', '[c]); }); }');
const QUEST_BLOCK = sliceBlock(popHtml, '// ── PoP quests — renderers', '// ── /PoP quests — renderers');
const FLAGS_BLOCK = sliceBlock(popHtml, '// ── PoP flags — renderers', '// ── /PoP flags — renderers');
const R = evalBlock(ESC_SRC + '\n' + QUEST_BLOCK + '\n' + FLAGS_BLOCK, ['fQuestKey', 'fPlaneKey']);

const quests = REAL.levels.flatMap(lv => lv.sections.flatMap(s => s.quests));
const Q = Object.fromEntries(quests.map(q => [q.key, q]));
const A = REAL.anchors;
const link = (k) => R.fQuestKey(A, Q, k);
const planeKeys = new Set(REAL.eras.flatMap(e => e.planes.map(p => p.key)));

// No guide step does these, so there is nothing to link to (and the overlay draws them as plain text).
//  · the four loot steps ("Loot the Mound of Living Stone"…): the guide has the kill, not the loot;
//  · `hoh_trials` as a GATE flag: three guide steps (the three trials) earn it together, none is "the" step.
const NO_STEP = { stages: ['cloud_loot', 'globe_loot', 'sphere_loot', 'stone_loot'], gates: ['hoh_trials'] };

describe('the anchors table', () => {
  it('is in the generated file: every value a guide step, every zone a listed plane', () => {
    expect(A).toBeTruthy();
    for (const table of ['stage', 'checklist', 'flag']) {
      expect(Object.keys(A[table]).length, table).toBeGreaterThan(5);
      for (const [k, v] of Object.entries(A[table])) expect(Q[v], table + ' ' + k + ' -> ' + v).toBeTruthy();
    }
    for (const [z, p] of Object.entries(A.zone)) expect(planeKeys.has(p), z + ' -> ' + p).toBe(true);
    expect(Q[A.seer]).toBeTruthy();
    expect((Q[A.seer].says || []).some(s => /unlock my memories/i.test(s.text))).toBe(true);
  });
  it('is read from the web files, not typed: it agrees with the guide itself', () => {
    for (const i of GUIDE_ITEMS) if (i.flag && !A.flag[i.flag]) throw new Error('flag ' + i.flag + ' has no anchor');
    for (const [flag, key] of Object.entries(A.flag)) expect(GUIDE_ITEMS.find(i => i.key === key).flag, key).toBe(flag);
  });
});

describe('every key the engine names resolves to a step of the Quests mode', () => {
  const stageKeys = Object.values(POP_STEPS).flat().map(s => s.key);

  it('every step of every progression line (NEXT_LINES) is a quest', () => {
    for (const line of NEXT_LINES) for (const st of line.stages) for (const k of st.steps) expect(Q[k], line.key + ' ' + k).toBeTruthy();
  });
  it('every server step (POP_STEPS) resolves, except the loot steps no guide step does', () => {
    const missing = stageKeys.filter(k => !link(k));
    expect(missing.sort()).toEqual(NO_STEP.stages);
  });
  it('every Seer pending memory resolves, and so does the step it unlocks', () => {
    for (const m of PENDING_MEMORIES) {
      expect(link(m.key), m.key).toBeTruthy();
      expect(link(m.gives), m.gives).toBeTruthy();
      expect(link(m.needs), m.needs + ' (what ' + m.key + ' waits on)').toBeTruthy();
    }
  });
  it('every checklist flag a step leaves (POP_STEPS checklist) is a pending memory with a link', () => {
    const pend = new Set(PENDING_MEMORIES.map(m => m.key));
    for (const s of Object.values(POP_STEPS).flat()) if (s.checklist) { expect(pend.has(s.checklist), s.checklist).toBe(true); expect(link(s.checklist), s.checklist).toBeTruthy(); }
  });
  it('every chart zone is a plane of the blocks', () => {
    for (const z of POP_ZONES) expect(planeKeys.has(R.fPlaneKey(A, z.key)), z.key).toBe(true);
  });
  it('every gate the engine can name as what a line waits on resolves, bar the one no step earns alone', () => {
    const gates = new Set([...POP_ZONES.flatMap(z => z.requires), ...NEXT_LINES.flatMap(l => l.stages.flatMap(s => s.needs || [])),
      ...Object.values(GATE_IMPLIES).flat(), ...Object.keys(GATE_IMPLIES)]);
    for (const g of gates) expect(POP_FLAGS[g] || stageKeys.includes(g), g + ' is a flag or a step').toBeTruthy();
    expect([...gates].filter(g => !link(g)).sort()).toEqual(NO_STEP.gates);
  });
  it('the doors the bot lists resolve (its payload is the fixture the overlay tests share)', () => {
    const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'pop-status-brackwyn.json'), 'utf8')).characters.brackwyn;
    expect(fx.doors.length).toBeGreaterThan(0);
    for (const d of fx.doors) expect(link(d.step), d.step).toBeTruthy();
    for (const p of fx.pending) { expect(link(p.key), p.key).toBeTruthy(); expect(link(p.step), p.step).toBeTruthy(); }
    for (const z of fx.zones) expect(R.fPlaneKey(A, z.key), z.key).toBeTruthy();
    for (const l of fx.next) for (const s of l.steps) expect(link(s.key), s.key).toBeTruthy();
  });
});

describe('every link lands: the step opens, carries its data-step, and sits in its plane\'s list', () => {
  const landing = new Set();
  for (const k of [...Object.values(A.stage), ...Object.values(A.checklist), ...Object.values(A.flag), A.seer]) landing.add(k);
  for (const line of NEXT_LINES) for (const st of line.stages) for (const k of st.steps) landing.add(k);

  it('opens each step through popGoto and rings it', async () => {
    const h = bootPop({ status: null });
    await h.flush();
    expect(landing.size).toBeGreaterThan(40);
    for (const k of landing) {
      h.rec.rings.length = 0;
      h.api.popGoto('step:' + k, 'test');
      expect(h.body.classList.contains('quests'), k).toBe(true);
      expect(h.content(), k).toContain('class="enc-hdr" data-step="' + k + '"');
      expect(h.rec.rings, k).toEqual([{ label: 'step:' + k, add: 'ringed' }]);
      expect(h.content(), k).toContain('data-go="flags"');
    }
  });
  it('every plane opens its list, one block per step, each a data-step', async () => {
    const h = bootPop({ status: null });
    await h.flush();
    for (const plane of new Set(Object.values(A.zone))) {
      h.api.popGoto('plane:' + plane, 'test');
      const keys = quests.filter(q => q.plane === plane).map(q => q.key);
      expect(keys.length, plane).toBeGreaterThan(0);
      for (const k of keys) expect(h.content(), plane + ' ' + k).toContain('data-step="' + k + '"');
    }
  });
  it('a quest is in the plane list its zone chip opens', () => {
    const planeOfStep = (k) => Q[k].plane;
    for (const [stage, guide] of Object.entries(A.stage)) {
      const zone = Object.entries(POP_STEPS).find(([, steps]) => steps.some(s => s.key === stage));
      if (!zone) continue;
      // A step done in Tranquility or Knowledge for another plane lives under that plane's block, not the zone's:
      // the link goes to the STEP either way, which is what matters. This only checks the plane exists.
      expect(planeKeys.has(planeOfStep(guide)), stage).toBe(true);
    }
  });
});
