// The trigger window's speech queue: which callouts jump the line.
// The guild lead, 2026-10-05: '"Enrage Soon" goes off WAY too late' — so it joins
// CH GO at priority 2 (preempts speech in progress, last to be dropped).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { ROOT, readSource, sliceBlock, evalBlock } from './_source-slice.js';

const src = readSource(path.join(ROOT, 'apps', 'mimic', 'triggers.html'));
const { _speakPriority } = evalBlock(
  sliceBlock(src, 'function _speakPriority(meta){', '    return 1;\n  }'),
  ['_speakPriority'],
);

describe('trigger window speech priority', () => {
  it('puts "Enrage soon" and CH GO ahead of everything else', () => {
    expect(_speakPriority({ trigger: 'Enrage soon' })).toBe(2);
    expect(_speakPriority({ trigger: 'CH GO' })).toBe(2);
    expect(_speakPriority({ trigger: 'Enrage (Begin)' })).toBe(1);
    expect(_speakPriority({ trigger: 'Slow landed' })).toBe(1);
    expect(_speakPriority(null)).toBe(1);
  });
});
