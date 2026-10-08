// test/fun-ld-quit.test.js — the /fun linkdead card ("Raids since … crashed"):
// an LD marked "It was a /quit" does not count, and only an LD during a real
// raid counts at all.
//
// The guild lead, 2026-10-04: a /quit drops the connection exactly like a crash,
// so no observer's log can tell them apart — the player (or an officer) marks it
// by hand. And "Saturday wasn't a raid, so it doesn't count. it should only
// happen during actual raids": a real raid is one the officers logged in OpenDKP
// (opendkp_raids), attended when his name is in one of its ticks. raid_nights is
// NOT that record — the bot opens a row for any Sun/Wed/Thu evening encounter.
//
// The pure rules are web/lib/funLd.ts; the reads are web/lib/funLdRaids.ts; the
// gate is web/lib/funLdAuth.ts; the write is web/app/fun/actions.ts. All are
// exercised here by running them, not by reading their text.
//
// Run: npx vitest run test/fun-ld-quit.test.js

import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ROOT, readSource, sliceBlock, stripJs } from './_source-slice.js';
import {
  QUIT_WINDOW_MS, parseLds, ldView, countEvents, siblingsOf, isQuit, withQuit, withoutQuit,
  viewerDiscordId, mayMarkQuit, raidNightOf, raidStreaks,
  raidDateOf, raidDatesOf, isDuringRaid, attendedRaidDates, attendeeFilter,
} from '../web/lib/funLd.ts';
import { loadRaidDates, loadRaidDatesAndAttendance } from '../web/lib/funLdRaids.ts';

const T = (iso) => Date.parse(iso);
const row = (id, iso, extra = {}) => ({ id, event_ts: iso, target: null, detail: null, ...extra });
const quitDetail = { quit: true, by: '1', at: '2026-10-04T00:00:00.000Z' };

// Raid dates shaped like opendkp_raids: the UTC date of a noon-UTC ts. The LD
// fixtures below sit on the evenings of the first three.
const RAID_DATES = new Set(['2026-09-13', '2026-09-27', '2026-10-11', '2026-01-16']);
const view = (rs, dates = RAID_DATES) => ldView(parseLds(rs), dates);

describe('which LDs count', () => {
  // The latest LD (Sun Sep 27, 21:02 ET) is the one the member says was a /quit.
  const rows = [
    row(1, '2026-09-14T00:18:43Z'),   // Sun Sep 13, 20:18 ET
    row(2, '2026-09-14T00:18:46Z'),
    row(3, '2026-09-28T01:02:25Z', { detail: quitDetail }),
  ];

  it('leaves a /quit out of the last LD, and says which LD to mark next', () => {
    const v = view(rows);
    expect(v.counted.map(l => l.id)).toEqual([1, 2]);
    expect(new Date(v.counted[v.counted.length - 1].ts).toISOString()).toBe('2026-09-14T00:18:46.000Z');
    expect(v.mark.id).toBe(2);
  });

  it('shrinks the lifetime count by the forgiven rows only', () => {
    expect(view(rows).counted).toHaveLength(2);
    expect(view(rows.map(r => ({ ...r, detail: null }))).counted).toHaveLength(3);
  });

  it('counts a forgiven crash once however many raiders uploaded it', () => {
    const two = [row(1, '2026-09-14T00:18:43Z', { detail: quitDetail }), row(2, '2026-09-14T00:18:46Z', { detail: quitDetail })];
    expect(view(two).forgivenEvents).toBe(1);
    expect(view(rows).forgivenEvents).toBe(1);
    expect(view([...two, row(3, '2026-09-28T01:02:25Z', { detail: quitDetail })]).forgivenEvents).toBe(2);
    expect(countEvents([])).toBe(0);
  });

  it('the lifetime figure counts a counted crash once however many raiders uploaded it', () => {
    expect(view(rows).counted).toHaveLength(2);
    expect(countEvents(view(rows).counted)).toBe(1);
  });

  it('forgives a copy of the same LD that was uploaded after the override', () => {
    const late = [row(1, '2026-09-28T01:02:25Z', { detail: quitDetail }), row(2, '2026-09-28T01:04:25Z')];
    expect(view(late).counted).toHaveLength(0);
    // ...but not a separate LD a few minutes on.
    const later = [row(1, '2026-09-28T01:02:25Z', { detail: quitDetail }), row(2, '2026-09-28T01:04:26Z')];
    expect(view(later).counted.map(l => l.id)).toEqual([2]);
  });

  it('only an exact quit:true forgives', () => {
    for (const detail of [null, {}, { quit: false }, { quit: 'true' }, { quit: 1 }, 'quit', []]) {
      expect(isQuit(detail)).toBe(false);
      expect(view([row(1, '2026-09-28T01:02:25Z', { detail })]).counted).toHaveLength(1);
    }
    expect(isQuit({ quit: true })).toBe(true);
  });

  it('offers Undo only while the latest forgiven LD is newer than every counted one', () => {
    expect(view(rows).undo.id).toBe(3);
    // an LD after the /quit: the /quit is history, nothing to undo from the card
    expect(view([...rows, row(4, '2026-10-12T01:00:00Z')]).undo).toBeNull();
    // nothing forgiven
    expect(view([row(1, '2026-09-14T00:18:43Z')]).undo).toBeNull();
  });

  it('with every LD forgiven there is nothing to mark, and Undo is offered', () => {
    const v = view([row(1, '2026-09-28T01:02:25Z', { detail: quitDetail })]);
    expect(v.counted).toHaveLength(0);
    expect(v.mark).toBeNull();
    expect(v.undo.id).toBe(1);
  });

  it('ignores rows with an unreadable timestamp', () => {
    expect(parseLds([row(1, 'not a date'), row(2, '2026-09-14T00:18:43Z')])).toHaveLength(1);
  });
});

describe('only an LD during a real raid counts', () => {
  it('a Saturday-afternoon LD does not count: Saturday is not a raid date', () => {
    // 15:02 ET Sat Oct 3 — the real LD the guild lead ruled out.
    const v = view([row(1, '2026-10-03T19:02:25Z')]);
    expect(v.counted).toHaveLength(0);
    expect(v.mark).toBeNull();
  });

  it('a Saturday-EVENING LD does not count either: the clock fits, the date does not', () => {
    const ms = T('2026-10-04T00:30:00Z');   // Sat Oct 3, 20:30 ET
    expect(raidNightOf(ms)).toBe('2026-10-03');
    expect(isDuringRaid(ms, RAID_DATES)).toBe(false);
    expect(view([row(1, '2026-10-04T00:30:00Z')]).counted).toHaveLength(0);
  });

  it('a 10:00 ET LD on a raid date does not count: the raid is in the evening', () => {
    // 10:07 ET Sun Sep 13 (14:07Z) — the date is a raid date, the hour is not.
    expect(RAID_DATES.has('2026-09-13')).toBe(true);
    expect(view([row(1, '2026-09-13T14:07:14Z')]).counted).toHaveLength(0);
  });

  it('a 20:11 ET LD on a raid date counts', () => {
    const v = view([row(1, '2026-09-14T00:11:18Z')]);   // Sun Sep 13, 20:11 ET
    expect(v.counted.map(l => l.id)).toEqual([1]);
  });

  it('a 01:30 ET LD after a raid date counts, for that raid', () => {
    const ms = T('2026-09-14T05:30:00Z');   // Mon Sep 14, 01:30 ET
    expect(raidNightOf(ms)).toBe('2026-09-13');
    expect(view([row(1, '2026-09-14T05:30:00Z')]).counted).toHaveLength(1);
  });

  it('the evening window opens at 19:00 Eastern, in summer and in winter', () => {
    const dates = new Set(['2026-09-13', '2026-12-06']);
    // EDT (UTC-4)
    expect(isDuringRaid(T('2026-09-13T22:59:59Z'), dates)).toBe(false);   // 18:59:59 ET
    expect(isDuringRaid(T('2026-09-13T23:00:00Z'), dates)).toBe(true);    // 19:00 ET
    // EST (UTC-5)
    expect(isDuringRaid(T('2026-12-06T23:59:59Z'), dates)).toBe(false);   // 18:59:59 ET
    expect(isDuringRaid(T('2026-12-07T00:00:00Z'), dates)).toBe(true);    // 19:00 ET
  });

  it('the window closes at 05:00 Eastern, when the next date begins', () => {
    const dates = new Set(['2026-09-13', '2026-12-06']);
    expect(isDuringRaid(T('2026-09-14T08:59:59Z'), dates)).toBe(true);    // 04:59:59 EDT
    expect(isDuringRaid(T('2026-09-14T09:00:00Z'), dates)).toBe(false);   // 05:00 EDT: Sep 14's night, not a raid date
    expect(isDuringRaid(T('2026-12-07T09:59:59Z'), dates)).toBe(true);    // 04:59:59 EST
    expect(isDuringRaid(T('2026-12-07T10:00:00Z'), dates)).toBe(false);   // 05:00 EST
  });

  it('the evening after a raid date is not that raid: a Monday-night LD is not Sunday\'s', () => {
    expect(isDuringRaid(T('2026-09-15T00:30:00Z'), RAID_DATES)).toBe(false);   // Mon Sep 14, 20:30 ET
  });

  it('survives a junk instant', () => {
    expect(isDuringRaid(NaN, RAID_DATES)).toBe(false);
  });

  it('a non-raid LD is not the last LD, not forgiven, not offered to the button', () => {
    const rows = [
      row(1, '2026-09-14T00:18:43Z'),                          // raid LD
      row(2, '2026-10-04T00:30:00Z'),                          // Saturday evening, newer
      row(3, '2026-10-04T00:40:00Z', { detail: quitDetail }),  // a non-raid /quit, newer still
    ];
    const v = view(rows);
    expect(v.counted.map(l => l.id)).toEqual([1]);
    expect(v.mark.id).toBe(1);
    expect(v.undo).toBeNull();
    expect(v.forgivenEvents).toBe(0);
  });

  it('with no raid dates at all nothing counts', () => {
    expect(view([row(1, '2026-09-14T00:18:43Z')], new Set()).counted).toHaveLength(0);
  });

  it('the real LD list: the last counted LD is the January raid-night one', () => {
    // fun_events peopleslayer_ld on 2026-10-04, event_ts only.
    const real = [
      '2025-08-18T15:33:05Z', '2025-08-25T15:36:36Z', '2025-09-08T14:52:10Z', '2025-09-11T14:07:14Z',
      '2025-09-11T15:12:06Z', '2025-09-11T18:24:24Z', '2025-09-15T14:41:30Z', '2026-01-17T01:11:18Z',
      '2026-01-17T01:18:59Z', '2026-01-26T19:43:40Z', '2026-01-26T20:00:08Z', '2026-05-17T04:16:30Z',
      '2026-09-14T20:18:43Z', '2026-09-14T20:18:46Z', '2026-10-03T19:02:25Z',
    ].map((iso, i) => row(i + 1, iso));
    // Raid dates around them. 2025-09-11 is a raid DATE the 10:07-14:24 ET LDs fall on, but not during it.
    const dates = new Set(['2025-09-11', '2026-01-16', '2026-05-17', '2026-09-13', '2026-09-17']);
    expect(dates.has('2026-10-03')).toBe(false);
    expect(dates.has('2026-09-14')).toBe(false);
    const v = view(real, dates);
    expect(v.counted.map(l => new Date(l.ts).toISOString())).toEqual(['2026-01-17T01:11:18.000Z', '2026-01-17T01:18:59.000Z']);
    expect(new Date(v.mark.ts).toISOString()).toBe('2026-01-17T01:18:59.000Z');
    expect(countEvents(v.counted)).toBe(2);   // 7 minutes apart: two crashes, not one seen twice
  });
});

describe('real raids from OpenDKP', () => {
  it('a raid\'s date is the UTC date of its noon-UTC ts', () => {
    expect(raidDateOf('2026-09-27T12:00:00+00:00')).toBe('2026-09-27');
    expect(raidDateOf('2026-01-16T12:00:00Z')).toBe('2026-01-16');
    // the UTC date, not the Eastern one: 02:00 UTC is still the evening before in Eastern
    expect(raidDateOf('2026-01-17T02:00:00Z')).toBe('2026-01-17');
    expect(raidDateOf(null)).toBeNull();
    expect(raidDateOf('not a date')).toBeNull();
  });

  it('collects the distinct dates, several raids on one date counting once', () => {
    const dates = raidDatesOf([
      { ts: '2026-07-22T12:00:00Z' }, { ts: '2026-07-22T12:00:00Z' }, { ts: '2026-07-26T12:00:00Z' }, { ts: null },
    ]);
    expect([...dates].sort()).toEqual(['2026-07-22', '2026-07-26']);
  });

  const RAIDS = [
    { raid_id: 1, ts: '2026-09-13T12:00:00Z' },
    { raid_id: 2, ts: '2026-09-17T12:00:00Z' },
    { raid_id: 3, ts: '2026-09-17T12:00:00Z' },   // a second raid the same date
    { raid_id: 4, ts: '2026-09-20T12:00:00Z' },
  ];

  it('he attended a raid date when a tick of one of its raids names him; a raid he missed does not count', () => {
    expect([...attendedRaidDates(RAIDS, [{ raid_id: 1 }, { raid_id: 3 }])].sort()).toEqual(['2026-09-13', '2026-09-17']);
    expect(attendedRaidDates(RAIDS, []).size).toBe(0);
  });

  it('counts a date once however many ticks and raids name him', () => {
    expect([...attendedRaidDates(RAIDS, [{ raid_id: 2 }, { raid_id: 3 }, { raid_id: 3 }])]).toEqual(['2026-09-17']);
  });

  it('matches raid ids across number and string, and ignores a tick whose raid is unknown', () => {
    expect([...attendedRaidDates(RAIDS, [{ raid_id: '4' }, { raid_id: 99 }])]).toEqual(['2026-09-20']);
  });

  it('asks the database for his name in any likely casing', () => {
    const f = attendeeFilter('Peopleslayer');
    for (const n of ['Peopleslayer', 'peopleslayer', 'PEOPLESLAYER']) expect(f).toContain(`attendees.cs.{${n}}`);
    // a name that is already one casing is not listed twice
    expect(attendeeFilter('peopleslayer').split(',')).toEqual(
      ['attendees.cs.{peopleslayer}', 'attendees.cs.{PEOPLESLAYER}', 'attendees.cs.{Peopleslayer}']);
  });
});

describe('the reads (funLdRaids), run against a fake client', () => {
  // A paging fake: honours .range(), records the filter strings.
  const fake = (tables, seen = []) => ({
    from: (table) => {
      const q = { table, orFilter: null, from: 0, to: 999 };
      const b = {
        select: () => b,
        or: (f) => { q.orFilter = f; return b; },
        order: () => b,
        range: (from, to) => { q.from = from; q.to = to; return b; },
        then: (res, rej) => {
          seen.push(q);
          const rows = tables[table];
          return Promise.resolve({ data: rows ? rows.slice(q.from, q.to + 1) : null, error: rows ? null : { message: 'no table' } }).then(res, rej);
        },
      };
      return b;
    },
  });

  it('reads every raid across pages, not just the first 1000', async () => {
    const raids = Array.from({ length: 1500 }, (_, i) => ({ raid_id: i + 1, ts: new Date(Date.UTC(2024, 0, 1 + i, 12)).toISOString() }));
    const dates = await loadRaidDates(fake({ opendkp_raids: raids }));
    expect(dates.size).toBe(1500);
    expect(dates.has('2024-01-01')).toBe(true);
  });

  it('reports a failed read of the raids instead of returning "no raids"', async () => {
    await expect(loadRaidDates(fake({}))).rejects.toThrow();
    await expect(loadRaidDates(fake({ opendkp_raids: [] }))).rejects.toThrow();
  });

  it('returns the raid dates and the ones he was ticked on, asking only for his ticks', async () => {
    const seen = [];
    const out = await loadRaidDatesAndAttendance(fake({
      opendkp_raids: [{ raid_id: 1, ts: '2026-09-13T12:00:00Z' }, { raid_id: 2, ts: '2026-09-17T12:00:00Z' }],
      opendkp_ticks: [{ raid_id: 2 }],
    }, seen), 'Peopleslayer');
    expect([...out.raidDates].sort()).toEqual(['2026-09-13', '2026-09-17']);
    expect([...out.attended]).toEqual(['2026-09-17']);
    expect(seen.find(q => q.table === 'opendkp_ticks').orFilter).toBe(attendeeFilter('Peopleslayer'));
  });
});

describe('marking and undoing', () => {
  const rows = [
    row(10, '2026-09-14T20:18:43Z'),
    row(11, '2026-09-14T20:18:46Z'),
    row(12, '2026-09-14T20:20:46Z'),   // exactly 2:00 after row 11 — still the same crash
    row(13, '2026-09-14T20:20:47Z'),   // 2:01 — not
    row(14, '2026-09-14T20:16:46Z'),   // exactly 2:00 before row 11
    row(15, '2026-09-14T20:16:45Z'),   // 2:01 before — not
  ];

  it('marks every sibling upload within two minutes, and no more', () => {
    const lds = parseLds(rows);
    const at = T('2026-09-14T20:18:46Z');
    expect(siblingsOf(lds, at).map(l => l.id).sort()).toEqual([10, 11, 12, 14]);
    expect(QUIT_WINDOW_MS).toBe(120_000);
  });

  it('puts quit/by/at into detail and keeps what was already there', () => {
    expect(withQuit(null, '42', '2026-10-04T01:00:00.000Z')).toEqual({ quit: true, by: '42', at: '2026-10-04T01:00:00.000Z' });
    expect(withQuit({ zone: 'x' }, null, 'iso')).toEqual({ zone: 'x', quit: true, by: null, at: 'iso' });
  });

  it('undo takes exactly those three keys out, and a bare detail goes back to null', () => {
    expect(withoutQuit(withQuit(null, '42', 'iso'))).toBeNull();
    expect(withoutQuit(withQuit({ zone: 'x' }, '42', 'iso'))).toEqual({ zone: 'x' });
    expect(withoutQuit(null)).toBeNull();
    const original = { zone: 'x' };
    withoutQuit(withQuit(original, '42', 'iso'));
    expect(original).toEqual({ zone: 'x' });
  });

  it('marking, then undoing, brings the crash back', () => {
    const base = [row(1, '2026-09-14T00:18:43Z'), row(2, '2026-09-14T00:18:46Z')];
    const target = parseLds(base)[1];
    const marked = base.map(r => siblingsOf(parseLds(base), target.ts).some(s => s.id === r.id)
      ? { ...r, detail: withQuit(r.detail, '42', 'iso') } : r);
    expect(view(marked).counted).toHaveLength(0);
    const undone = marked.map(r => ({ ...r, detail: withoutQuit(r.detail) }));
    expect(view(undone).counted).toHaveLength(2);
  });
});

describe('who may press the button', () => {
  const owner = '111';
  const check = (discordId, officer = false, owners = [owner]) => mayMarkQuit({ discordId, ownerDiscordIds: owners, officer });

  it('the character\'s own player: yes', () => expect(check('111')).toBe(true));
  it('an officer: yes', () => expect(check('999', true)).toBe(true));
  it('another member: no', () => expect(check('999')).toBe(false));
  it('signed out: no', () => expect(check(null)).toBe(false));
  it('a missing id never matches a missing owner id', () => {
    expect(check(null, false, [null, undefined])).toBe(false);
    expect(check('', false, [''])).toBe(false);
  });
  it('an officer with no Discord id is still an officer', () => expect(check(null, true)).toBe(true));

  it('reads the Discord id the way /pvp does', () => {
    expect(viewerDiscordId({ app_metadata: { provider_id: 'a' }, user_metadata: { provider_id: 'b', sub: 'c' } })).toBe('a');
    expect(viewerDiscordId({ app_metadata: {}, user_metadata: { provider_id: 'b', sub: 'c' } })).toBe('b');
    expect(viewerDiscordId({ user_metadata: { sub: 'c' } })).toBe('c');
    expect(viewerDiscordId({ user_metadata: {} })).toBeNull();
    expect(viewerDiscordId({ user_metadata: { provider_id: '' } })).toBeNull();
    expect(viewerDiscordId(null)).toBeNull();
  });
});

describe('raid nights', () => {
  it('puts a raid on its Eastern date, not its UTC date', () => {
    expect(raidNightOf(T('2026-10-03T19:02:25Z'))).toBe('2026-10-03');   // Sat afternoon ET
    expect(raidNightOf(T('2026-10-05T01:30:00Z'))).toBe('2026-10-04');   // Sun 9:30pm ET, Monday in UTC
    expect(raidNightOf(T('2026-10-04T23:59:00Z'))).toBe('2026-10-04');
  });

  it('keeps a raid that runs past midnight on the night it started, until 05:00 Eastern', () => {
    expect(raidNightOf(T('2026-10-05T04:30:00Z'))).toBe('2026-10-04');   // 00:30 ET Monday
    expect(raidNightOf(T('2026-10-05T08:59:00Z'))).toBe('2026-10-04');   // 04:59 EDT
    expect(raidNightOf(T('2026-10-05T09:00:00Z'))).toBe('2026-10-05');   // 05:00 EDT
    expect(raidNightOf(T('2026-12-07T09:59:00Z'))).toBe('2026-12-06');   // 04:59 EST
    expect(raidNightOf(T('2026-12-07T10:00:00Z'))).toBe('2026-12-07');   // 05:00 EST
  });

  it('a Sunday-night LD at 01:30 UTC Monday is the Sunday raid\'s, a Monday-afternoon one is not', () => {
    const sunday = new Set(['2026-10-04']);
    expect(isDuringRaid(T('2026-10-05T01:30:00Z'), sunday)).toBe(true);
    expect(isDuringRaid(T('2026-10-05T19:00:00Z'), sunday)).toBe(false);
  });

  describe('raids since the last LD, and the record', () => {
    // The raid dates he was ticked on (what loadRaidDatesAndAttendance hands over).
    const ATT = new Set(['2026-09-24', '2026-09-27', '2026-10-01']);

    it('counts attended raid dates after the LD night', () => {
      const counted = [T('2026-09-14T00:18:46Z')];   // Sun Sep 13, 20:18 ET
      expect(raidStreaks(counted, ATT).since).toBe(3);
    });

    it('is zero when the last LD was on the latest raid he attended', () => {
      expect(raidStreaks([T('2026-10-02T00:30:00Z')], ATT).since).toBe(0);   // Thu Oct 1, 20:30 ET
    });

    it('does not count the night the LD happened on, even if he kept fighting after it', () => {
      // LD at 21:00 ET on a raid night (01:00 UTC next day); he fought on after it.
      expect(raidStreaks([T('2026-09-28T01:00:00Z')], new Set(['2026-09-27', '2026-10-01'])).since).toBe(1);
    });

    it('the record is the most attended raid dates between two consecutive LDs', () => {
      // LD nights Sep 10, Sep 26 and Oct 3 (evenings)
      const counted = [T('2026-09-11T00:30:00Z'), T('2026-09-27T00:30:00Z'), T('2026-10-04T00:30:00Z')];
      const att = new Set(['2026-09-13', '2026-09-16', '2026-09-17', '2026-09-20', '2026-09-24', '2026-10-01']);
      // gap 1 (Sep 10 -> Sep 26): 13, 16, 17, 20, 24 = 5; gap 2 (Sep 26 -> Oct 3): 1
      expect(raidStreaks(counted, att).best).toBe(5);
    });

    it('a forgiven LD in the middle joins the two streaks around it', () => {
      const att = new Set(['2026-09-13', '2026-09-16', '2026-09-20', '2026-09-24']);
      const dates = new Set(['2026-09-10', '2026-09-18', '2026-09-30']);
      const rows = [
        row(1, '2026-09-11T00:30:00Z'),   // night Sep 10
        row(2, '2026-09-19T00:30:00Z'),   // night Sep 18, between 16 and 20
        row(3, '2026-10-01T00:30:00Z'),   // night Sep 30
      ];
      const all = (rs) => raidStreaks(view(rs, dates).counted.map(l => l.ts), att).best;
      expect(all(rows)).toBe(2);   // 13, 16 | 20, 24
      expect(all([rows[0], { ...rows[1], detail: quitDetail }, rows[2]])).toBe(4);
    });

    it('an LD outside a raid does not split a streak either', () => {
      const att = new Set(['2026-09-13', '2026-09-16', '2026-09-20', '2026-09-24']);
      const dates = new Set(['2026-09-10', '2026-09-30']);
      const rows = [
        row(1, '2026-09-11T00:30:00Z'),   // night Sep 10, a raid
        row(2, '2026-09-19T19:00:00Z'),   // Saturday afternoon: not a raid, ignored
        row(3, '2026-10-01T00:30:00Z'),   // night Sep 30, a raid
      ];
      expect(raidStreaks(view(rows, dates).counted.map(l => l.ts), att).best).toBe(4);
    });

    it('the record is the biggest gap wherever it sits, and a night an LD happened on is in neither gap', () => {
      const counted = [T('2026-09-10T20:00:00Z'), T('2026-09-14T20:00:00Z'), T('2026-09-28T01:00:00Z')];
      // gap 1 (Sep 10 -> Sep 14): 13 = 1. gap 2 (Sep 14 -> the Sep 27 raid, LD at 21:00 ET): 16, 17, 20 = 3,
      // and the 27th, which he attended but was LD on, is not among them.
      const att = new Set(['2026-09-13', '2026-09-16', '2026-09-17', '2026-09-20', '2026-09-27']);
      expect(raidStreaks(counted, att).best).toBe(3);
    });

    it('a raid he missed does not extend the record', () => {
      const counted = [T('2026-09-12T20:00:00Z'), T('2026-09-26T20:00:00Z')];
      const raids = [{ raid_id: 1, ts: '2026-09-13T12:00:00Z' }, { raid_id: 2, ts: '2026-09-16T12:00:00Z' }];
      // only the Sep 13 raid has a tick naming him
      const att = attendedRaidDates(raids, [{ raid_id: 1 }]);
      expect(raidStreaks(counted, att).best).toBe(1);
    });

    it('no counted LD: nothing since, no record', () => {
      expect(raidStreaks([], ATT)).toEqual({ since: 0, best: 0 });
    });
  });
});

// ── The gate, run for real with its two lookups faked ───────────────────────
const gate = vi.hoisted(() => ({ officer: false, characters: [], throws: false }));
vi.mock('../web/lib/officer.ts', () => ({ isOfficer: async () => gate.officer }));
vi.mock('../web/lib/supabase.ts', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ ilike: async (col, pattern) => {
        if (gate.throws) throw new Error('db down');
        // ilike: case-insensitive, % is a wildcard
        const re = new RegExp('^' + String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i');
        return { data: gate.characters.filter(c => re.test(c[col] ?? '')) };
      } }) }),
    }),
  }),
}));
const { viewerMayMarkQuit } = await import('../web/lib/funLdAuth.ts');

describe('viewerMayMarkQuit (the server-side gate)', () => {
  const user = (id, discord) => ({ id, app_metadata: { provider_id: discord }, user_metadata: {} });
  beforeEach(() => {
    gate.officer = false;
    // The character's own player owns it; another member owns a different character.
    gate.characters = [{ name: 'Peopleslayer', discord_id: '111' }, { name: 'Otherchar', discord_id: '222' }];
    gate.throws = false;
  });

  it('signed out: no', async () => expect(await viewerMayMarkQuit(null)).toBe(false));
  it('the character\'s player: yes', async () => expect(await viewerMayMarkQuit(user('u1', '111'))).toBe(true));
  it('another member, even one who owns some other character: no', async () => {
    expect(await viewerMayMarkQuit(user('u2', '222'))).toBe(false);
    expect(await viewerMayMarkQuit(user('u5', '555'))).toBe(false);
  });
  it('an officer: yes', async () => {
    gate.officer = true;
    expect(await viewerMayMarkQuit(user('u3', '333'))).toBe(true);
  });
  it('a member with no Discord id: no, even if the character has no owner on file', async () => {
    gate.characters = [{ name: 'Peopleslayer', discord_id: null }];
    expect(await viewerMayMarkQuit({ id: 'u4', app_metadata: {}, user_metadata: {} })).toBe(false);
  });
  it('a failed lookup never grants it', async () => {
    gate.throws = true;
    expect(await viewerMayMarkQuit(user('u1', '111'))).toBe(false);
  });
});

// ── The action, run for real against an in-memory fun_events ────────────────
const act = vi.hoisted(() => ({ user: null, allowed: false, rows: [], raids: [], updates: [], revalidated: [], failUpdate: false }));
vi.mock('@/lib/supabase-server', () => ({
  supabaseServer: () => ({ auth: { getUser: async () => ({ data: { user: act.user } }) } }),
}));
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: () => ({
    from: (table) => table === 'opendkp_raids'
      // select().order().range() — the shape selectAll drives
      ? { select: () => ({ order: () => ({ range: async () => ({ data: structuredClone(act.raids), error: null }) }) }) }
      : {
        select: () => ({ eq: () => ({ order: async () => ({ data: structuredClone(act.rows), error: null }) }) }),
        update: (patch) => ({ eq: async (_col, id) => {
          act.updates.push({ id, patch });
          const r = act.rows.find(x => x.id === id);
          if (r) Object.assign(r, patch);
          return { error: act.failUpdate ? { message: 'boom' } : null };
        } }),
      },
  }),
}));
vi.mock('@/lib/funLdAuth', () => ({ viewerMayMarkQuit: async () => act.allowed }));
vi.mock('@/lib/funLd', async () => await import('../web/lib/funLd.ts'));
vi.mock('@/lib/funLdRaids', async () => await import('../web/lib/funLdRaids.ts'));
// `next/cache` resolves differently by machine: CI installs only the root
// dependencies, so the bare id is all there is; a checkout with web/ installed
// resolves it to a file, and a mock registered under the bare id would miss.
// Register both.
const nextCache = { revalidatePath: (p) => act.revalidated.push(p) };
vi.doMock('next/cache', () => nextCache);
try {
  vi.doMock(createRequire(new URL('../web/package.json', import.meta.url)).resolve('next/cache'), () => nextCache);
} catch { /* web/ not installed here */ }
const { setLdQuit } = await import('../web/app/fun/actions.ts');

describe('setLdQuit (the server action)', () => {
  const seed = () => [
    row(1, '2026-09-14T00:18:43Z', { detail: { zone: 'kept' } }),   // Sun Sep 13, 20:18 ET: a raid
    row(2, '2026-09-14T00:18:46Z'),
    row(3, '2026-09-28T01:02:25Z'),                                  // Sun Sep 27, 21:02 ET: a raid
    row(4, '2026-09-28T01:02:27Z'),                                  // a second raider's copy of the same LD
    row(5, '2026-10-04T00:30:00Z'),                                  // Sat Oct 3, 20:30 ET: newer, evening, and not a raid
  ];
  const LATEST = '2026-09-28T01:02:27.000Z';              // the latest LD during a raid
  const SATURDAY = '2026-10-04T00:30:00.000Z';            // the latest LD of all
  beforeEach(() => {
    act.user = { id: 'u1', app_metadata: { provider_id: '111' }, user_metadata: {} };
    act.allowed = true;
    act.rows = seed();
    // opendkp_raids, as the noon-UTC ts rows it holds: two raids, no Oct 3
    act.raids = [{ raid_id: 1, ts: '2026-09-13T12:00:00+00:00' }, { raid_id: 2, ts: '2026-09-27T12:00:00+00:00' }];
    act.updates = [];
    act.revalidated = [];
    act.failUpdate = false;
  });

  it('reports a failed write instead of saying it worked', async () => {
    act.failUpdate = true;
    const r = await setLdQuit(true, LATEST);
    expect(r).toEqual({ ok: false, error: 'boom' });
    expect(act.revalidated).toEqual([]);
  });

  it('refuses without writing when the gate says no', async () => {
    act.allowed = false;
    const r = await setLdQuit(true, LATEST);
    expect(r.ok).toBe(false);
    expect(act.updates).toEqual([]);
  });

  it('refuses a signed-out caller', async () => {
    act.user = null;
    expect((await setLdQuit(true, LATEST)).ok).toBe(false);
    expect(act.updates).toEqual([]);
  });

  it('marks the latest LD during a raid and its sibling upload together, and revalidates /fun', async () => {
    const r = await setLdQuit(true, LATEST);
    expect(r.ok).toBe(true);
    expect(act.updates.map(u => u.id).sort()).toEqual([3, 4]);
    for (const u of act.updates) {
      expect(u.patch.detail.quit).toBe(true);
      expect(u.patch.detail.by).toBe('111');
      expect(Number.isNaN(Date.parse(u.patch.detail.at))).toBe(false);
    }
    expect(act.rows[0].detail).toEqual({ zone: 'kept' });   // the earlier raid LD is untouched
    expect(view(act.rows).counted.map(l => l.id)).toEqual([1, 2]);
    expect(act.revalidated).toEqual(['/fun']);
  });

  it('marks the latest RAID LD, not a newer LD outside a raid', async () => {
    const r = await setLdQuit(true, LATEST);
    expect(r.ok).toBe(true);
    expect(act.rows[4].detail).toBeNull();   // the Saturday LD, newer than both, is not touched
  });

  it('cannot mark an LD outside a raid: it is not on the card, so the page cannot be looking at it', async () => {
    const r = await setLdQuit(true, SATURDAY);
    expect(r.ok).toBe(false);
    expect(act.updates).toEqual([]);
  });

  it('refuses without writing when the raid list cannot be read', async () => {
    act.raids = [];
    const r = await setLdQuit(true, LATEST);
    expect(r.ok).toBe(false);
    expect(act.updates).toEqual([]);
  });

  it('undo puts both rows back', async () => {
    await setLdQuit(true, LATEST);
    act.updates = [];
    const r = await setLdQuit(false, LATEST);
    expect(r.ok).toBe(true);
    expect(act.updates.map(u => u.id).sort()).toEqual([3, 4]);
    expect(act.rows[2].detail).toBeNull();
    expect(act.rows[3].detail).toBeNull();
    expect(view(act.rows).counted).toHaveLength(4);
  });

  it('refuses when the page was looking at a different LD than the one the server would mark', async () => {
    const r = await setLdQuit(true, '2026-09-14T00:18:46.000Z');
    expect(r.ok).toBe(false);
    expect(act.updates).toEqual([]);
  });

  it('refuses an undo when nothing newer was forgiven', async () => {
    const r = await setLdQuit(false, LATEST);
    expect(r.ok).toBe(false);
    expect(act.updates).toEqual([]);
  });

  it('refuses a timestamp that is not one', async () => {
    expect((await setLdQuit(true, 'soon')).ok).toBe(false);
    expect(act.updates).toEqual([]);
  });
});

// ── The page, which is a server component and cannot be run here ────────────
describe('the card is wired to the helpers', () => {
  const src = readSource(path.join(ROOT, 'web', 'app', 'fun', 'page.tsx'));
  const section = stripJs(sliceBlock(
    src,
    'SECTIONS.push(async (sb, counters, ctx) => {\n  // A member LD card',
    'SECTIONS.push(async (sb, counters) => {\n  // Tunare mentions',
  ));

  it('draws the /quit links only for a viewer the gate allowed', () => {
    expect(stripJs(src)).toMatch(/canMarkQuit:\s*viewerMayMarkQuit\(user\)/);
    expect(section).toMatch(/\{canMark && mark && \(/);
    expect(section).toMatch(/const undoLink = canMark && undo && \(/);
  });

  it('takes the LDs through the raid and /quit filter and counts raids from OpenDKP', () => {
    expect(section).toMatch(/ldView\(parseLds\([^\n]*\),\s*raidDates\)/);
    expect(section).toMatch(/loadRaidDatesAndAttendance\(sb, 'Peopleslayer'\)/);
    expect(section).toMatch(/raidStreaks\(lds\.map\(l => l\.ts\), attended\)/);
    // the lifetime figure counts crashes, not the rows several raiders uploaded of each
    expect(section).toMatch(/countEvents\(lds\)/);
    // raid_nights, the encounter-time attendance and the old per-UTC-date counting are gone
    expect(section).not.toMatch(/raid_nights|encounter_players|attendedNights|sinceDays|fmtDay|ldTotal/);
  });

  it('says on the card that only LDs during raids count', () => {
    expect(section).toMatch(/LDs during raids only/);
  });

  it('the Last LD date is raid time (Eastern), not the server\'s UTC: a Friday 8:18 pm LD reads Fri', () => {
    expect(section).toMatch(/lastDt\.toLocaleDateString\('en-US',\s*\{\s*timeZone:\s*'America\/New_York'/);
    const lbl = new Date('2026-01-17T01:18:59Z').toLocaleDateString('en-US',
      { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    expect(lbl).toBe('Fri, Jan 16, 2026');
  });

  it('a 0 here is the joke, so the card stays up top instead of dimming into "Quiet for now"', () => {
    // The counted card carries alwaysLive, and the page's live/dormant split honours it.
    expect(section).toMatch(/value:\s*raidsSince,\s*alwaysLive:\s*true/);
    const body = /const isLive = \([^)]*\) =>\s*([\s\S]*?);/.exec(stripJs(src))[1];
    const isLive = new Function('c', 'return ' + body);
    expect(isLive({ value: 0, alwaysLive: true })).toBe(true);
    expect(isLive({ value: 0 })).toBe(false);
    expect(isLive({ value: '—' })).toBe(false);
    expect(isLive({ value: 3 })).toBe(true);
  });
});
