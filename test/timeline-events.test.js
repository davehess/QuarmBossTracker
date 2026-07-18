// EncounterBuilder per-fight timeline capture (#98) — SOURCE-SLICE fidelity tier.
//   Source: packages/wolfpack-logsync/index.js (EncounterBuilder methods
//     noteTimelineEvent / noteRaidLine / _buildTimelineEvents, ~line 4324).
//     These are class methods on the single-file agent's EncounterBuilder;
//     require()-ing the agent isn't viable (single-file, side-effectful), so we
//     slice the real, contiguous method block out of the shipped source and
//     rehydrate it into a minimal test class (see test/_source-slice.js). The
//     three methods are verbatim shipped code; only the constructor stub and the
//     injected module-level `_fireLog` are test-local.
//
// Under test: enrage lines → a raid_event timeline entry stamped with the mob
// name; dedup within a 2s bucket (kind|subtype|actor|round(ts/2000)); non-enrage
// lines ignored; trigger fires merged in only within [start-2s, end+2s] of the
// fight; no events → undefined (field omitted from the upload payload).
//
// UPGRADED from MIRROR → SOURCE-SLICE (2026-07-18): the agent-side #98 timeline
// capture (agent 3.3.77) landed on main with the 1.9 beta graduation, so the
// real EncounterBuilder methods now exist and can be sliced. Cases unchanged
// from the mirror they replaced.

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, AGENT_INDEX } from './_source-slice.js';

// The real _buildTimelineEvents reads a module-level `_fireLog`; inject a
// test-local one so the suite can push/clear fires.
const _fireLog = [];

// Slice the three contiguous methods (comments between them are valid class-body
// content) and rehydrate into a minimal class with the fields they touch.
const methodsBlock = sliceBlock(
  readSource(AGENT_INDEX),
  '  noteTimelineEvent(ev) {',
  '    return out.length ? out.slice(0, 500) : undefined;\n  }',
);
// eslint-disable-next-line no-new-func
const TimelineBuilder = new Function('_fireLog', `
  return class {
    constructor() {
      this.timelineEvents = [];
      this._tlSeen        = new Set();
      this.startedAt      = null;
      this.lastEvent      = null;
    }
${methodsBlock}
  };
`)(_fireLog);

const S = Date.parse('2026-07-17T20:00:00Z');

describe('EncounterBuilder timeline capture (#98, source-sliced from agent)', () => {
  it('sliced the real methods', () => {
    const b = new TimelineBuilder();
    expect(typeof b.noteTimelineEvent).toBe('function');
    expect(typeof b.noteRaidLine).toBe('function');
    expect(typeof b._buildTimelineEvents).toBe('function');
  });

  it('captures an enrage line as a raid_event stamped with the mob name', () => {
    const b = new TimelineBuilder();
    b.startedAt = new Date(S).toISOString();
    b.lastEvent = new Date(S + 180000).toISOString();
    b.noteRaidLine('[Fri Jul 17 20:01:38 2026] Lord Nagafen has become ENRAGED.', S + 98000);
    expect(b.timelineEvents.length).toBe(1);
    expect(b.timelineEvents[0].subtype).toBe('enrage');
    expect(b.timelineEvents[0].actor).toBe('Lord Nagafen');
  });

  it('collapses a duplicate enrage within the 2s bucket', () => {
    const b = new TimelineBuilder();
    b.startedAt = new Date(S).toISOString();
    b.noteRaidLine('[..] Lord Nagafen has become ENRAGED.', S + 98000);
    b.noteRaidLine('[..] Lord Nagafen has become ENRAGED.', S + 98500);
    expect(b.timelineEvents.length).toBe(1);
  });

  it('ignores a non-enrage raid line', () => {
    const b = new TimelineBuilder();
    b.startedAt = new Date(S).toISOString();
    b.noteRaidLine('[..] You have been slain by Lord Nagafen!', S + 99000);
    expect(b.timelineEvents.length).toBe(0);
  });

  it('merges only in-window trigger fires; excludes fires before start-2s and after end+2s', () => {
    _fireLog.length = 0;
    const b = new TimelineBuilder();
    b.startedAt = new Date(S).toISOString();
    b.lastEvent = new Date(S + 180000).toISOString();
    b.noteRaidLine('[Fri Jul 17 20:01:38 2026] Lord Nagafen has become ENRAGED.', S + 98000);
    _fireLog.push({ at: S + 40000, name: 'Death Touch' });   // inside window
    _fireLog.push({ at: S + 200000, name: 'Late Trigger' });  // after end+2s → excluded
    _fireLog.push({ at: S - 60000, name: 'Before Fight' });   // before start-2s → excluded

    const out = b._buildTimelineEvents();
    const fires = out.filter((e) => e.kind === 'fire');
    expect(fires.length).toBe(1);
    expect(fires[0].label).toBe('Death Touch');
    expect(out.length).toBe(2); // the raid event + the one in-window fire
  });

  it('returns undefined when there are no events (field omitted from payload)', () => {
    _fireLog.length = 0;
    const e = new TimelineBuilder();
    e.startedAt = new Date(S).toISOString();
    expect(e._buildTimelineEvents()).toBeUndefined();
  });
});
