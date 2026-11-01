// test/pop-raids-terris.test.js: the Terris Thule slide in the PoP Raid Slideshow (apps/mimic/pop-raids.js) says what
// the server's script does (FB-109, 2026-10-28). nightmareb/Terris_Thule.lua (SecretsOTheP/quests d4625cdd): dream
// defilers at 79% and 69%, one per CLIENT with damage > 0 (pets do not count), dispel at 50%, gargoyles at 40%. The
// guide the slide was transcribed from said 75% / ~35%.
//
// Run: npx vitest run test/pop-raids-terris.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { ROOT, readSource } from './_source-slice.js';

const POP = (() => { const w = {}; new Function('window', readSource(path.join(ROOT, 'apps', 'mimic', 'pop-raids.js')))(w); return w.POP_RAIDS; })();
const enc = POP.sections.flatMap(s => s.encounters).find(e => e.id === 'terris-a');

describe('Terris Thule (Plane of Nightmare B) slide matches the script', () => {
  it('exists', () => { expect(enc).toBeTruthy(); });

  it('names the 79% and 69% defiler waves, one per player who damaged her, pets excluded', () => {
    const text = enc.callouts.join('\n');
    expect(text).toMatch(/79% and 69%/);
    expect(text).toMatch(/EVERY player who has damaged her/);
    expect(text).toMatch(/pets do not count/);
    expect(text).not.toMatch(/75%/);
  });

  it('puts the gargoyles at 40%, not ~35%', () => {
    const text = enc.callouts.join('\n');
    expect(text).toMatch(/40%: 4 Gargoyles/);
    expect(text).not.toMatch(/35%/);
  });

  it('tracker checkpoints follow the same thresholds', () => {
    expect(enc.tracker.map(t => t.id)).toEqual(['p79', 'p69', 'p50', 'p40', 'boss', 'gargs', 'proj']);
    expect(enc.tracker.map(t => t.label).join('|')).not.toMatch(/75%|35%/);
  });
});
