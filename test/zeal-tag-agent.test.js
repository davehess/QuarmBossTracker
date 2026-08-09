// test/zeal-tag-agent.test.js — agent-side /tag handling: upload cap, zone
// clear, and rate-limit detection.
//
// All three come from live testing on 2026-08-07 (Canopy + Adiwen + Rockin):
//   · CAP — tagging through The Deep produced ~50 tags and the payload capped
//     at exactly 24, keeping the OLDEST (Map insertion order) and dropping the
//     boss, which had been tagged last.
//   · ZONE — spawn ids are per-zone and reused (14 named NPCs inside ids 11-45
//     in one zone), so tags held across a zone change describe different mobs.
//   · RATE LIMIT — tags are chat messages; a burst is refused by the server
//     while Zeal still draws the nameplate arrow, so the tagger believes the
//     raid sees a mark nobody got.
//
// Run: npx vitest run test/zeal-tag-agent.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, AGENT_INDEX } from './_source-slice.js';

const block = sliceBlock(
  readSource(AGENT_INDEX),
  'function _isNamedMobTag(t) {',
  '\n  return _tagRateLimit;\n}',
);

function build() {
  const harness = `
    const _TAG_UPLOAD_CAP = 64;
    const stats = {};
    const _zealTags = new Map();
    let _zealTagsZone = null;
    let _tagRateLimit = null;
    const console = { log() {} };
  ` + block + `
    return {
      _pickTagsForUpload, _isNamedMobTag, noteZoneForTags,
      noteRateLimitLine, tagRateLimitSnapshot,
      _zealTags, stats,
      zone: () => _zealTagsZone,
    };
  `;
  // eslint-disable-next-line no-new-func
  return new Function(harness)();
}

const tag = (mobDisplay, tsMs) => ({ mobDisplay, spawn_id: tsMs, tsMs });

describe('upload cap', () => {
  it('passes everything through under the cap', () => {
    const h = build();
    const tags = [tag('a horror guard', 1), tag('Thought Horror Overfiend', 2)];
    expect(h._pickTagsForUpload(tags, 64)).toEqual(tags);
  });

  it('keeps the boss even when tagged LAST — the regression', () => {
    const h = build();
    const generics = Array.from({ length: 30 }, (_, i) => tag('an elder thought horror', i));
    const picked = h._pickTagsForUpload([...generics, tag('Thought Horror Overfiend', 99)], 24);
    expect(picked).toHaveLength(24);
    expect(picked.map(t => t.mobDisplay)).toContain('Thought Horror Overfiend');
  });

  it('fills the remainder newest-first, not oldest-first', () => {
    const h = build();
    const generics = Array.from({ length: 20 }, (_, i) => tag('a horror guard', i));
    expect(h._pickTagsForUpload(generics, 3).map(t => t.tsMs)).toEqual([19, 18, 17]);
  });

  it('records how many were dropped so the dashboard can warn', () => {
    const h = build();
    h._pickTagsForUpload(Array.from({ length: 30 }, (_, i) => tag('a horror guard', i)), 24);
    expect(h.stats.zealTagsDropped).toBe(6);
  });

  it('classifies named vs generic by proper-noun casing', () => {
    const h = build();
    expect(h._isNamedMobTag({ mobDisplay: 'Agent of Solusek' })).toBe(true);
    expect(h._isNamedMobTag({ mobDisplay: 'an elder thought horror' })).toBe(false);
    expect(h._isNamedMobTag({})).toBe(false);
  });
});

describe('zone change clears tags', () => {
  it('drops everything held when the zone changes', () => {
    const h = build();
    h._zealTags.set(39, { spawn_id: 39, mobDisplay: 'Merdan Fleetfoot' });
    h.noteZoneForTags('surefallglade');
    expect(h._zealTags.size).toBe(0);        // first sighting also establishes the zone
    h._zealTags.set(51, { spawn_id: 51, mobDisplay: 'a brown bear' });
    expect(h.noteZoneForTags('blackburrow')).toBe(true);
    expect(h._zealTags.size).toBe(0);
  });

  it('is a no-op while the zone is unchanged', () => {
    const h = build();
    h.noteZoneForTags('thedeep');
    h._zealTags.set(403, { spawn_id: 403, mobDisplay: 'Thought Horror Overfiend' });
    expect(h.noteZoneForTags('thedeep')).toBe(false);
    expect(h._zealTags.size).toBe(1);        // tags survive within one zone
  });

  it('ignores a null/empty zone rather than clearing on bad input', () => {
    const h = build();
    h.noteZoneForTags('thedeep');
    h._zealTags.set(403, { spawn_id: 403 });
    expect(h.noteZoneForTags(null)).toBe(false);
    expect(h._zealTags.size).toBe(1);
  });
});

describe('rate-limit detection', () => {
  const LINE = '[Fri Aug 07 10:07:16 2026] You are currently rate limited, you cannot send more messages for 32 seconds.';

  it('parses the lockout and its duration', () => {
    const h = build();
    const at = Date.now();   // must be recent — the snapshot ages out at 5min
    expect(h.noteRateLimitLine(LINE, at)).toBe(true);
    const snap = h.tagRateLimitSnapshot();
    expect(snap.seconds).toBe(32);
    expect(snap.untilMs).toBe(at + 32_000);
  });

  it('ignores unrelated lines cheaply', () => {
    const h = build();
    expect(h.noteRateLimitLine('[Fri Aug 07 10:07:16 2026] You say, hello', 1)).toBe(false);
    expect(h.noteRateLimitLine('', 1)).toBe(false);
    expect(h.tagRateLimitSnapshot()).toBeNull();
  });

  it('stays visible after the lockout expires, then ages out', () => {
    const h = build();
    // The useful message ("tags around then did not broadcast") outlives the
    // lockout itself, so a just-expired limit must still be reportable.
    h.noteRateLimitLine(LINE, Date.now() - 60_000);
    expect(h.tagRateLimitSnapshot()).not.toBeNull();

    h.noteRateLimitLine(LINE, Date.now() - 600_000);
    expect(h.tagRateLimitSnapshot()).toBeNull();
  });
});
