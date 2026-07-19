// #113 — Extended Target "same-zone targets only" filter decision. SOURCE-SLICE.
//
// The filter lives inside the bot's _handleAgentExtendedTarget (index.js), which
// can't be require()'d without booting Discord. We slice the two real blocks —
// the same_zone param parse and the scopeZone/inScope decision — and eval them
// so the test exercises the SHIPPED predicate (rename/delete it and the slice
// throws loudly instead of passing on a stale copy).

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, BOT_INDEX } from './_source-slice.js';

const SRC = readSource(BOT_INDEX);

// The param parse: absent / "1" → same-zone (default on); only an explicit "0"
// disables. Returns { selfChar, sameZoneOnly } for a given req.url.
const parseBlock = sliceBlock(SRC, 'let sameZoneOnly = true;', '} catch { /* */ }');
// eslint-disable-next-line no-new-func
const runParse = new Function('req', `let selfChar = '';\n${parseBlock}\nreturn { selfChar, sameZoneOnly };`);

// The decision: given selfChar, live rows, and sameZoneOnly, produce inScope.
const decisionBlock = sliceBlock(
  SRC,
  'let scopeZone = null;',
  'const inScope = scopeZone ? live.filter(r => !r.zone_name || r.zone_name === scopeZone) : live;',
);
// eslint-disable-next-line no-new-func
const runDecision = new Function('selfChar', 'live', 'sameZoneOnly', `${decisionBlock}\nreturn { scopeZone, inScope };`);

const names = (rows) => rows.map(r => r.character).sort();

// Synthetic multi-client target set: "me" in Plane of Fire, a same-zone raider,
// two other-zone raiders (a splinter group), and an unknown-zone raider.
const LIVE = [
  { character: 'Me',      zone_name: 'Plane of Fire', target_name: 'a fire elemental' },
  { character: 'Ally',    zone_name: 'Plane of Fire', target_name: 'a fire elemental' },
  { character: 'Splinter1', zone_name: 'Plane of Water', target_name: 'a water elemental' },
  { character: 'Splinter2', zone_name: 'Plane of Water', target_name: 'a water elemental' },
  { character: 'NoZone',   zone_name: null,            target_name: 'a mystery mob' },
];

describe('#113 same_zone param parse (default on)', () => {
  it('absent param → same-zone (default on)', () => {
    expect(runParse({ url: '/api/agent/extended-target?character=Me' }).sameZoneOnly).toBe(true);
  });
  it('same_zone=1 → same-zone', () => {
    expect(runParse({ url: '/api/agent/extended-target?character=Me&same_zone=1' }).sameZoneOnly).toBe(true);
  });
  it('same_zone=0 → OFF (all zones)', () => {
    expect(runParse({ url: '/api/agent/extended-target?character=Me&same_zone=0' }).sameZoneOnly).toBe(false);
  });
  it('parses the requester character alongside the flag', () => {
    expect(runParse({ url: '/api/agent/extended-target?character=Me&same_zone=0' }).selfChar).toBe('Me');
  });
});

describe('#113 zone filter decision', () => {
  it('ON: excludes ONLY other-zone rows; keeps my zone + unknown-zone', () => {
    const { scopeZone, inScope } = runDecision('Me', LIVE, true);
    expect(scopeZone).toBe('Plane of Fire');
    // Ally (same zone) + Me (own) + NoZone (unknown → fail-open) survive;
    // the two Plane of Water splinters are dropped.
    expect(names(inScope)).toEqual(['Ally', 'Me', 'NoZone']);
  });

  it('OFF: includes ALL rows regardless of zone', () => {
    const { scopeZone, inScope } = runDecision('Me', LIVE, false);
    expect(scopeZone).toBeNull();               // not scoped
    expect(inScope.length).toBe(LIVE.length);
    expect(names(inScope)).toEqual(['Ally', 'Me', 'NoZone', 'Splinter1', 'Splinter2']);
  });

  it('unknown-zone rows are ALWAYS included (fail-open per row)', () => {
    const onlyUnknownOthers = [
      { character: 'Me',   zone_name: 'Plane of Fire', target_name: 'x' },
      { character: 'Ghost', zone_name: null,           target_name: 'y' },
      { character: 'Far',   zone_name: 'Elsewhere',    target_name: 'z' },
    ];
    const { inScope } = runDecision('Me', onlyUnknownOthers, true);
    expect(names(inScope)).toEqual(['Ghost', 'Me']);   // Far dropped, Ghost kept
  });

  it('own target is never filtered (I am always in-scope)', () => {
    const { inScope } = runDecision('Me', LIVE, true);
    expect(inScope.some(r => r.character === 'Me')).toBe(true);
  });

  it('FAIL-OPEN: my zone unknown → every online raider included (never hide data)', () => {
    // My own row has no zone_name → scopeZone can't resolve → no scoping.
    const myZoneUnknown = LIVE.map(r => r.character === 'Me' ? { ...r, zone_name: null } : r);
    const { scopeZone, inScope } = runDecision('Me', myZoneUnknown, true);
    expect(scopeZone).toBeNull();
    expect(inScope.length).toBe(LIVE.length);
  });

  it('FAIL-OPEN: requester not in live set → no scoping (all included)', () => {
    const { scopeZone, inScope } = runDecision('Nobody', LIVE, true);
    expect(scopeZone).toBeNull();
    expect(inScope.length).toBe(LIVE.length);
  });
});
