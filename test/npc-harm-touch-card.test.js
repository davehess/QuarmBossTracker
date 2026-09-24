// Target Info draws a Shadow Knight mob's Harm Touch beside its class (the guild
// lead, 2026-09-24: "Next to name (Shadow Knight) it should say HT with a
// checkmark or HT with a red X and a timer"). The agent's _npcHtFor decides
// ready / used (me-hud-timers.test.js); this checks the card says it.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, stripJs } from './_source-slice.js';

const html = readSource(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html'));
const js = stripJs(html);
const agent = stripJs(readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js')));

describe('Target Info: a Shadow Knight mob\'s Harm Touch', () => {
  it('the agent sends it with the target', () => {
    expect(agent).toContain('target_npc_ht:  _npcHtFor(selfChar, st, cached, _curIdForRelay),');
  });
  // The chip itself is run as a function in test/mobinfo-class-variants-overlay.test.js.
  it('the used state is red on the card', () => {
    expect(html).toMatch(/\.mob \.ht\.used\{color:#f85149\}/);
    expect(js).toContain('var nht = mi.target_npc_ht;');
  });
});
