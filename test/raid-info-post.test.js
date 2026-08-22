// test/raid-info-post.test.js — the midday raid-info post.
// Real-imports the pure helpers (utils/raidInfoPost.js).
//
// The fixture is the ACTUAL signup embed Hitya sent (Vex Thal, Aug 23 2026):
// "this is the information that we go off of from signups."

import { describe, it, expect } from 'vitest';
import { parseRaidHeader, wantedClasses } from '../utils/raidInfoPost.js';

const REAL = `Raid Set 1 - Vex Thal
Muster Point - Umbral Plains

Raid Lead - Bardtholemu
Raid Window - Elyas
Loot - Alukit
Ticks - Moash

Luclin Raids are main only atm. If for some reason you need an exception to this rule please let an officer know.`;

describe('parseRaidHeader', () => {
  const out = parseRaidHeader(REAL);

  it('pulls every Label - Value row from the real signup post', () => {
    expect(out.fields).toEqual([
      { label: 'Raid Set 1', value: 'Vex Thal' },
      { label: 'Muster Point', value: 'Umbral Plains' },
      { label: 'Raid Lead', value: 'Bardtholemu' },
      { label: 'Raid Window', value: 'Elyas' },
      { label: 'Loot', value: 'Alukit' },
      { label: 'Ticks', value: 'Moash' },
    ]);
  });

  it('keeps the prose rule as a note, not a field', () => {
    expect(out.notes).toHaveLength(1);
    expect(out.notes[0]).toMatch(/main only/i);
  });

  it('a value containing a dash keeps the whole value', () => {
    const r = parseRaidHeader('Muster Point - Umbral Plains - by the tree');
    expect(r.fields[0].value).toBe('Umbral Plains - by the tree');
  });

  it('tolerates bullet and emoji prefixes officers add', () => {
    const r = parseRaidHeader('• Raid Lead - Bardtholemu');
    expect(r.fields[0]).toEqual({ label: 'Raid Lead', value: 'Bardtholemu' });
  });

  it('ignores short chatter and empty input', () => {
    expect(parseRaidHeader('ok').fields).toEqual([]);
    expect(parseRaidHeader('ok').notes).toEqual([]);
    expect(parseRaidHeader('')).toEqual({ fields: [], notes: [] });
    expect(parseRaidHeader(null)).toEqual({ fields: [], notes: [] });
  });
});

describe('wantedClasses', () => {
  it('phrases gaps as an ask, biggest first, capped', () => {
    const short = [
      { cls: 'Cleric', have: 2, avg: 5, gap: 3 },
      { cls: 'Warrior', have: 1, avg: 4, gap: 3 },
    ];
    expect(wantedClasses(short)).toEqual(['Cleric (2/5)', 'Warrior (1/4)']);
    expect(wantedClasses(short, 1)).toEqual(['Cleric (2/5)']);
  });

  it('no shortages means no ask', () => {
    expect(wantedClasses([])).toEqual([]);
    expect(wantedClasses(undefined)).toEqual([]);
  });
});
