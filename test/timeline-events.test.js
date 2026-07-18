// MIRROR: EncounterBuilder per-fight timeline capture (#98)
//   Intended source: packages/wolfpack-logsync/index.js (EncounterBuilder —
//     noteRaidLine / noteTimelineEvent / _buildTimelineEvents) feeding
//     supabase.recordEncounterEvents → encounter_events (utils/supabase.js
//     recordParse `timelineEvents` param, present in shipped code).
//   Tier: MIRROR (last resort) — see drift note below.
//
// ⚠ DRIFT: as of this port (main @ 243888e) the AGENT side of #98 is NOT
//   shipped — the EncounterBuilder in packages/wolfpack-logsync/index.js has no
//   noteTimelineEvent/_buildTimelineEvents/_tlSeen members (grep confirms), even
//   though the bot/DB sink (recordEncounterEvents, the encounter_events table)
//   exists. So there is no real function to require or source-slice yet. This
//   mirrors the intended capture logic the scratchpad test characterized:
//     • enrage lines → a raid_event timeline entry stamped with the mob name;
//     • dedup within a 2s bucket (kind|subtype|actor|round(ts/2000));
//     • non-enrage lines ignored;
//     • trigger fires merged in only within [start-2s, end+2s] of the fight;
//     • no events → undefined (field omitted from the upload payload).
//   WHEN the agent-side methods land, replace this mirror with real
//   EncounterBuilder instances via the agent's test exports.
//
// Ported from the session's scratchpad tl_test.js (6 scenarios, split for granularity).

import { describe, it, expect } from 'vitest';

// Module-level fire log the mirror's _buildTimelineEvents reads from.
const _fireLog = [];

class TimelineBuilder {
  constructor() {
    this.timelineEvents = [];
    this._tlSeen = new Set();
    this.startedAt = null;
    this.lastEvent = null;
  }
  noteTimelineEvent(ev) {
    if (!ev || !ev.at || !ev.kind || this.timelineEvents.length >= 400) return;
    const k = ev.kind + '|' + (ev.subtype || '') + '|' + (ev.actor || '') +
      '|' + Math.round((Date.parse(ev.at) || 0) / 2000);
    if (this._tlSeen.has(k)) return;
    this._tlSeen.add(k);
    this.timelineEvents.push({
      at: ev.at, kind: ev.kind, subtype: ev.subtype || null,
      actor: ev.actor || null, label: ev.label || null,
    });
  }
  noteRaidLine(line, tsMs) {
    const m = /\]\s+(.+?)\s+has become ENRAGED/i.exec(line);
    if (m) {
      const mob = (m[1] || '').trim().slice(0, 64);
      this.noteTimelineEvent({
        at: new Date(tsMs || Date.now()).toISOString(),
        kind: 'raid_event', subtype: 'enrage', actor: mob || null,
        label: (mob || 'The mob') + ' ENRAGED',
      });
    }
  }
  _buildTimelineEvents() {
    const out = [...this.timelineEvents];
    const startMs = Date.parse(this.startedAt) || 0;
    if (startMs) {
      const endMs = Date.parse(this.lastEvent || this.startedAt) || (startMs + 1);
      for (const f of _fireLog) {
        if (f.at >= startMs - 2000 && f.at <= endMs + 2000) {
          out.push({
            at: new Date(f.at).toISOString(), kind: 'fire',
            subtype: f.name ? String(f.name).slice(0, 48) : null,
            actor: null, label: f.name || 'callout',
          });
        }
      }
    }
    return out.length ? out.slice(0, 500) : undefined;
  }
}

const S = Date.parse('2026-07-17T20:00:00Z');

describe('EncounterBuilder timeline capture (#98 mirror)', () => {
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
