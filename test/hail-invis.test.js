// test/hail-invis.test.js — the "drop invis and hail again" callout (FB-116).
//
// The guild lead, 2026-11-03: "When a person is invis and they hail and don't get text you need to click off invis."
// A flag NPC does not answer someone it cannot see, so YOUR hail of a flag NPC while invisible puts up a local callout.
// Runs the agent's REAL _hailInvisNoteLine and its real own-hail regex; the invis state, the flag-NPC test and the
// overlay are stubbed so each branch can be driven.
//
// Run: npx vitest run test/hail-invis.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { readSource, sliceBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

const agentSrc = readSource(AGENT_INDEX);
const selfRx = sliceBlock(agentSrc, 'const _HAIL_SELF_RX = ', '\n');
const block = sliceBlock(agentSrc, 'const HAIL_INVIS_COOLDOWN_MS', '  return npc;\n}\n');

let zealInvis, pushed, T;
function fresh() {
  zealInvis = null;
  pushed = [];
  const make = new Function('selfInvisState', '_hailNpcWanted', '_pushOverlay', 'scheduleRender',
    selfRx + '\n' + block + '\nreturn _hailInvisNoteLine;');
  return make(() => zealInvis, (npc) => /planar projection/i.test(npc), (o) => { pushed.push(o); return true; }, () => {});
}
beforeEach(() => { T = fresh(); });

const WHO = 'Aldenmar';
const T0 = Date.UTC(2026, 10, 3, 4, 37, 0);
const line = (text) => `[Mon Nov 02 23:37:00 2026] ${text}`;
const HAIL = line("You say, 'Hail, A Planar Projection'");

describe('hailing a flag NPC while invisible', () => {
  it('warns when Zeal says you are invisible', () => {
    zealInvis = true;
    expect(T(HAIL, WHO, T0)).toBe('A Planar Projection');
    expect(pushed).toHaveLength(1);
    expect(pushed[0].text).toMatch(/invisible/);
    expect(pushed[0].tts).toMatch(/Drop invis and hail again/);
    expect(pushed[0].trigger_id).toBe('builtin:hail-invis');
  });

  it('stays quiet when Zeal says you are visible, even after an old vanish line', () => {
    T(line('You vanish.'), WHO, T0 - 60e3);
    zealInvis = false;
    expect(T(HAIL, WHO, T0)).toBeNull();
    expect(pushed).toHaveLength(0);
  });

  it('falls back to your own vanish / appear lines when Zeal is not live', () => {
    T(line('You vanish.'), WHO, T0 - 60e3);
    expect(T(HAIL, WHO, T0)).toBe('A Planar Projection');
    T(line('You appear.'), WHO, T0 + 1e3);
    expect(T(HAIL, WHO, T0 + 30e3)).toBeNull();
    expect(pushed).toHaveLength(1);
  });

  it('a vanish line older than 30 minutes says nothing', () => {
    T(line('You vanish.'), WHO, T0 - 31 * 60e3);
    expect(T(HAIL, WHO, T0)).toBeNull();
  });

  it('ignores hails of NPCs that are not flag NPCs, and other people hailing', () => {
    zealInvis = true;
    expect(T(line("You say, 'Hail, Klaital'"), WHO, T0)).toBeNull();
    expect(T(line("Brackwyn says, 'Hail, A Planar Projection'"), WHO, T0)).toBeNull();
    expect(pushed).toHaveLength(0);
  });

  it('warns once per 20 seconds per character', () => {
    zealInvis = true;
    T(HAIL, WHO, T0);
    expect(T(HAIL, WHO, T0 + 5e3)).toBeNull();
    expect(T(HAIL, 'Corvale', T0 + 5e3)).toBe('A Planar Projection');
    expect(T(HAIL, WHO, T0 + 21e3)).toBe('A Planar Projection');
    expect(pushed).toHaveLength(3);
  });

  it('is wired into the live tail, and pushes an overlay rather than firing a trigger (no relay, no Discord)', () => {
    const code = stripJs(agentSrc);
    expect(code).toMatch(/_hailInvisNoteLine\(line, b\.character, Date\.now\(\)\)/);
    expect(stripJs(block)).not.toMatch(/_fireTriggerActions|enqueueUpload|_broadcastTriggerToDiscord/);
  });
});
