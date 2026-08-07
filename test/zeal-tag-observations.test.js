// #194 — the Zeal /tag observation log. Source-slice tier: exercises the real
// _noteZealTags out of index.js so a rename or a logic edit shows up here.
//
// What these tests defend is subtle and easy to "simplify" away. The whole
// experiment is "did two DIFFERENT people tag the same mob and get the same
// number", so the two properties that matter are:
//   1. a repeated tag from one observer must collapse to ONE row (the agent
//      re-sends every unchanged tag on every upload for 120s), and
//   2. a second TAGGER on the same spawn id must NOT collapse — that pair is
//      the entire point of the table, and both the agent's Map and the
//      live_state column already destroy it.
// (2) is the mutation-sensitive one: dropping `tagger` from the dedup key
// leaves (1) passing and silently makes the feature useless.

import { describe, it, expect, beforeEach } from 'vitest';
import { readSource, sliceBlock, evalBlock, BOT_INDEX } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const block = sliceBlock(
  src,
  'const _seenZealTags   = new Map();',
  "  await supabase.insert('zeal_tag_observations', out);\n  return out.length;\n}",
);

// The slice calls require('./utils/supabase'); stub it so the block runs
// headless, and capture what it would have written. Rebuilt per test so the
// module-level dedup Map starts clean.
function freshSandbox() {
  return evalBlock(
    `const __writes = [];
     const require = (m) => String(m).endsWith('supabase')
       ? { isEnabled: () => true, insert: async (t, rows) => { __writes.push([t, rows]); } }
       : {};
     ${block}
     const __drain = () => __writes.splice(0);`,
    ['_noteZealTags', '_zealTagKey', '__drain'],
  );
}
const { _zealTagKey } = freshSandbox();

const TAG = (over = {}) => ({
  spawn_id: 114, mob: 'Derakor the Vindicator', text: 'DAFEET THIS',
  shape: 'Y', tagger: 'Dafeet', since: '2026-08-06T01:35:52.000Z', ...over,
});
const ROW = (over = {}) => ({
  guild_id: 'wolfpack', character: 'Biskiteni', zone_id: 110,
  zone_name: 'Kael Drakkel', zeal_tags: [TAG()], ...over,
});

describe('_noteZealTags — what it writes', () => {
  let sb;
  beforeEach(() => { sb = freshSandbox(); });

  it('writes one row per tag, carrying observer, tagger and zone apart', async () => {
    const n = await sb._noteZealTags([ROW()]);
    expect(n).toBe(1);
    const [[table, rows]] = sb.__drain();
    expect(table).toBe('zeal_tag_observations');
    expect(rows[0]).toMatchObject({
      guild_id: 'wolfpack',
      observed_by: 'Biskiteni',        // who RECEIVED the broadcast
      tagger: 'Dafeet',                // who SENT it — must stay distinct
      spawn_id: 114,
      mob: 'Derakor the Vindicator',
      observer_zone_id: 110,
      tagged_at: '2026-08-06T01:35:52.000Z',
    });
  });

  it('collapses an unchanged tag re-sent by the same observer', async () => {
    // The agent re-sends every live tag on every upload for the 120s freshness
    // window; `since` is stable across those, so this is ~60 duplicates.
    for (let i = 0; i < 5; i++) await sb._noteZealTags([ROW()]);
    const writes = sb.__drain();
    expect(writes).toHaveLength(1);
    expect(writes[0][1]).toHaveLength(1);
  });

  it('KEEPS a second tagger on the same spawn id — this is the experiment', async () => {
    await sb._noteZealTags([ROW()]);
    await sb._noteZealTags([ROW({
      character: 'Chadivarius',
      zeal_tags: [TAG({ tagger: 'Canniball', text: 'SLOWED',
                        since: '2026-08-06T01:35:55.000Z' })],
    })]);
    const rows = sb.__drain().flatMap(([, r]) => r);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(r => r.tagger))).toEqual(new Set(['Dafeet', 'Canniball']));
    // Same identity, two taggers — exactly what zeal_tag_identity_candidates
    // is looking for.
    expect(new Set(rows.map(r => r.spawn_id))).toEqual(new Set([114]));
  });

  it('KEEPS two taggers that collide on the same second — tagger is in the key', async () => {
    // The scenario that makes `tagger` load-bearing rather than decorative, and
    // the one the planned experiment ("have a friend tag the same mob as me")
    // walks straight into:
    //
    // `since` comes from parseEqTimestamp(line) — the EQ log stamp, which is
    // ONE-SECOND granular. Two people tagging within the same second produce an
    // identical `since`. The agent's Map is keyed by spawn id, so one observer
    // holds Dafeet's tag, uploads, then has it overwritten by Canniball's and
    // uploads again — SAME observer, SAME spawn id, SAME second, different
    // tagger. Drop `tagger` from the key and those two collapse into one row,
    // silently destroying the only pair that can answer the question.
    const SAME_SECOND = '2026-08-06T01:35:52.000Z';
    await sb._noteZealTags([ROW({ zeal_tags: [TAG({ tagger: 'Dafeet',    since: SAME_SECOND })] })]);
    await sb._noteZealTags([ROW({ zeal_tags: [TAG({ tagger: 'Canniball', since: SAME_SECOND })] })]);
    const rows = sb.__drain().flatMap(([, r]) => r);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(r => r.tagger))).toEqual(new Set(['Dafeet', 'Canniball']));
  });

  it('keeps the same broadcast seen by different observers as separate rows', async () => {
    // Fan-out must stay visible, otherwise it can't be told apart from two
    // people independently tagging.
    await sb._noteZealTags([ROW({ character: 'Biskiteni' }),
                            ROW({ character: 'Chadivarius' })]);
    const rows = sb.__drain().flatMap(([, r]) => r);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(r => r.observed_by)))
      .toEqual(new Set(['Biskiteni', 'Chadivarius']));
    expect(new Set(rows.map(r => r.tagger))).toEqual(new Set(['Dafeet']));
  });

  it('treats a re-tag of the same mob (new since) as a new event', async () => {
    await sb._noteZealTags([ROW()]);
    await sb._noteZealTags([ROW({ zeal_tags: [TAG({ since: '2026-08-06T01:36:56.000Z' })] })]);
    expect(sb.__drain().flatMap(([, r]) => r)).toHaveLength(2);
  });

  it('writes nothing, and never throws, for rows without tags', async () => {
    expect(await sb._noteZealTags([ROW({ zeal_tags: null })])).toBe(0);
    expect(await sb._noteZealTags([ROW({ zeal_tags: [] })])).toBe(0);
    expect(await sb._noteZealTags([])).toBe(0);
    expect(await sb._noteZealTags(null)).toBe(0);
    expect(sb.__drain()).toHaveLength(0);
  });

  it('skips a tag with no timestamp rather than writing a null key', async () => {
    expect(await sb._noteZealTags([ROW({ zeal_tags: [TAG({ since: null })] })])).toBe(0);
    expect(sb.__drain()).toHaveLength(0);
  });

  it('tolerates a missing zone without dropping the observation', async () => {
    // A live-state row can arrive before zone is known. The row is still worth
    // keeping — it just can't participate in the uniqueness test.
    const n = await sb._noteZealTags([ROW({ zone_id: undefined, zone_name: undefined })]);
    expect(n).toBe(1);
    expect(sb.__drain()[0][1][0]).toMatchObject({ observer_zone_id: null, observer_zone_name: null });
  });
});

describe('_zealTagKey — the dedup identity', () => {
  it('separates on tagger, so two taggers can never collapse', () => {
    const a = _zealTagKey('g', 'obs', 114, 'Dafeet', 'T');
    const b = _zealTagKey('g', 'obs', 114, 'Canniball', 'T');
    expect(a).not.toBe(b);
  });

  it('separates on observer, so fan-out survives', () => {
    expect(_zealTagKey('g', 'a', 114, 'D', 'T'))
      .not.toBe(_zealTagKey('g', 'b', 114, 'D', 'T'));
  });

  it('separates on tagged_at, so a re-tag is a new event', () => {
    expect(_zealTagKey('g', 'o', 114, 'D', 'T1'))
      .not.toBe(_zealTagKey('g', 'o', 114, 'D', 'T2'));
  });

  it('is stable for the identical observation', () => {
    expect(_zealTagKey('g', 'o', 114, 'D', 'T'))
      .toBe(_zealTagKey('g', 'o', 114, 'D', 'T'));
  });
});
