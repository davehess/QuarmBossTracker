// #194 — the tag channel: EQ chat as a machine-tag broadcast bus.
//
// "if we captured the zeal tag from our channel in game from ztwolfpacktag …
// or request those tanks output their target's name and HP percentage"
// (Uilnayar 2026-08-05). A tank hits a social — /ztwolfpacktag tag %T — and
// every channel member's log records it. %T is BASE EQ substitution, so this
// works for tanks running neither Zeal nor Mimic; ONE Mimic user in the
// channel harvests every tank's claim. With four tanks tagging four same-name
// mobs, each mob gets a tank-keyed identity no gauge could give us.
//
// THE PRIVACY LINE THIS FILE HOLDS: the raw chat line NEVER leaves the
// machine. The custom-channel drop pattern still matches the tag channel and
// still drops it from every upload/parse path — the capture runs on the raw
// line independently (the /zeal-version-harvest pattern) and ships only the
// structured {tank, mob, hp} extract. Weakening that drop pattern to "allow"
// the tag channel would leak every OTHER custom channel too, which is why the
// first test below is the important one.
//
// Run: npx vitest run test/tag-channel.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, sliceArrayLiteral, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);

// The capture module, with its two external deps stubbed.
function harness() {
  // One slice, WP_TAG_CHANNEL through the end of tagTargetsSnapshot — its
  // closing `return out;` is the first such sequence after the start marker.
  const full = sliceBlock(src, 'const WP_TAG_CHANNEL = ', '\n  return out;\n}');
  const prelude = `
    const process = { env: {} };
    function parseEqTimestamp(line) {
      const m = line.match(/^\\[(.+?)\\]/);
      return m ? new Date('2026-08-05T01:00:00Z') : null;
    }
  `;
  // eslint-disable-next-line no-new-func
  return new Function(prelude + full
    + '\nreturn { noteTagChannelLine, tagTargetsSnapshot, _tagTargets, WP_TAG_CHANNEL };')();
}

const LINE = (who, ch, msg) => `[Wed Aug 05 21:10:01 2026] ${who} tells ${ch}:5, '${msg}'`;

describe('privacy: the tag channel is still DROPPED from uploads', () => {
  it('the custom-channel drop pattern matches tag lines unchanged', () => {
    // This is the load-bearing assertion. The capture must ride the raw line
    // BESIDE the filter, never punch a hole through it.
    const drops = sliceArrayLiteral(src, 'const DEFAULT_DROP_PATTERNS = [');
    const tagLine = LINE('Grabthar', 'ztwolfpacktag', 'tag a thall va xakra 87');
    expect(drops.some(rx => rx instanceof RegExp && rx.test(tagLine)),
      'a tag line must still match the drop list').toBe(true);
  });

  it('the capture hook runs on the raw line, not on kept lines', () => {
    expect(src).toMatch(/try \{ noteTagChannelLine\(line, b\.character\); \} catch/);
  });
});

describe('noteTagChannelLine', () => {
  it('parses an incoming tag: speaker is the tank, name + optional hp', () => {
    const h = harness();
    expect(h.noteTagChannelLine(LINE('Grabthar', 'ztwolfpacktag', 'tag a thall va xakra 87'), 'Me')).toBe(true);
    const [t] = h.tagTargetsSnapshot(new Date('2026-08-05T01:00:05Z').getTime());
    expect(t.tank).toBe('Grabthar');
    expect(t.mob).toBe('a thall va xakra');
    expect(t.mobDisplay).toBe('a thall va xakra');
    expect(t.hp).toBe(87);
  });

  it('hp is optional (the %T-only social) and tolerates a % suffix', () => {
    const h = harness();
    h.noteTagChannelLine(LINE('Grabthar', 'ztwolfpacktag', 'tag Thall Va Xakra'), 'Me');
    h.noteTagChannelLine(LINE('Borim', 'ztwolfpacktag', 'tag Thall Va Xakra 62%'), 'Me');
    const now = new Date('2026-08-05T01:00:05Z').getTime();
    const byTank = Object.fromEntries(h.tagTargetsSnapshot(now).map(t => [t.tank, t]));
    expect(byTank.Grabthar.hp).toBeNull();
    expect(byTank.Borim.hp).toBe(62);
    expect(byTank.Grabthar.mob, 'capitalized names keep a lowercased key').toBe('thall va xakra');
  });

  it('attributes an OUTGOING tag to the watched character', () => {
    const h = harness();
    const line = `[Wed Aug 05 21:10:01 2026] You tell ztwolfpacktag:5, 'tag a thall va xakra 100'`;
    expect(h.noteTagChannelLine(line, 'Uilnayar')).toBe(true);
    expect(h.tagTargetsSnapshot(new Date('2026-08-05T01:00:05Z').getTime())[0].tank).toBe('Uilnayar');
  });

  it('ignores every other channel — General chatter is not a tag source', () => {
    const h = harness();
    expect(h.noteTagChannelLine(LINE('Grabthar', 'General', 'tag a thall va xakra 87'), 'Me')).toBe(false);
    expect(h.noteTagChannelLine(LINE('Grabthar', 'Wolfpackofficer', 'tag secret mob'), 'Me')).toBe(false);
    // The hard case: a line in ANOTHER channel whose text mentions the tag
    // channel. The cheap indexOf gate passes ('ztwolfpacktag:' is in the
    // message body), so only the regex's channel check stands between this
    // and recording General chatter as a tank claim.
    expect(h.noteTagChannelLine(LINE('Grabthar', 'General', 'tag ztwolfpacktag: is our channel'), 'Me')).toBe(false);
    expect(h._tagTargets.size).toBe(0);
  });

  it('ignores non-tag chatter INSIDE the tag channel', () => {
    // People will talk in it. Only the tag grammar is machine input.
    const h = harness();
    expect(h.noteTagChannelLine(LINE('Grabthar', 'ztwolfpacktag', 'lol nice pull'), 'Me')).toBe(false);
    expect(h._tagTargets.size).toBe(0);
  });

  it('rejects NPC-shaped speakers and junk payloads', () => {
    const h = harness();
    // Backtick names fail the regex's \w+ shape outright…
    expect(h.noteTagChannelLine(LINE('Xin`Xakra', 'ztwolfpacktag', 'tag a wolf'), 'Me')).toBe(false);
    // …so the letters-only check must be exercised by a name \w+ ACCEPTS but
    // players can't have — digits. This is the line that stands if the regex
    // shape ever loosens.
    expect(h.noteTagChannelLine(LINE('Bot123', 'ztwolfpacktag', 'tag a wolf'), 'Me')).toBe(false);
    expect(h.noteTagChannelLine(LINE('Grabthar', 'ztwolfpacktag', 'tag ab'), 'Me'), 'too-short mob name').toBe(false);
    expect(h._tagTargets.size).toBe(0);
  });

  it('a re-tag replaces the tank\'s previous claim — one claim per tank', () => {
    const h = harness();
    h.noteTagChannelLine(LINE('Grabthar', 'ztwolfpacktag', 'tag a thall va xakra 90'), 'Me');
    h.noteTagChannelLine(LINE('Grabthar', 'ztwolfpacktag', 'tag Aten Ha Ra 45'), 'Me');
    const out = h.tagTargetsSnapshot(new Date('2026-08-05T01:00:05Z').getTime());
    expect(out).toHaveLength(1);
    expect(out[0].mob).toBe('aten ha ra');
  });

  it('snapshot sweeps claims older than the freshness window', () => {
    const h = harness();
    h.noteTagChannelLine(LINE('Grabthar', 'ztwolfpacktag', 'tag a wolf'), 'Me');
    const later = new Date('2026-08-05T01:00:00Z').getTime() + 31_000;
    expect(h.tagTargetsSnapshot(later)).toEqual([]);
    expect(h._tagTargets.size, 'swept, not just hidden').toBe(0);
  });
});

describe('observed_tanks carries tags first, with hp', () => {
  const block = sliceBlock(src, 'observed_tanks: (() => {', '})(),');
  const build = (tags, recentTankHits, nowMs) => {
    const body = block.slice('observed_tanks: '.length).replace(/,$/, '');
    // eslint-disable-next-line no-new-func
    return new Function('stats', 'now', 'tagTargetsSnapshot', 'return ' + body)(
      { recentTankHits }, nowMs, () => tags);
  };
  const NOW = 1_000_000_000;

  it('a tag claim rides the payload with its hp', () => {
    const out = build(
      [{ tank: 'Grabthar', mob: 'a thall va xakra', mobDisplay: 'a thall va xakra', hp: 87, tsMs: NOW - 2000 }],
      [], NOW);
    expect(out).toEqual([{ mob: 'a thall va xakra', tank: 'Grabthar', since: new Date(NOW - 2000).toISOString(), hp: 87 }]);
  });

  it('a tag beats a melee connect for the same (mob, tank) — hp survives', () => {
    const out = build(
      [{ tank: 'Grabthar', mob: 'a thall va xakra', mobDisplay: 'a thall va xakra', hp: 87, tsMs: NOW - 2000 }],
      [{ mob: 'a thall va xakra', mobDisplay: 'a thall va xakra', tank: 'Grabthar', tsMs: NOW - 1000 }],
      NOW);
    expect(out).toHaveLength(1);
    expect(out[0].hp).toBe(87);
  });

  it('tags and connects merge across different tanks', () => {
    const out = build(
      [{ tank: 'Grabthar', mob: 'a thall va xakra', mobDisplay: 'a thall va xakra', hp: 87, tsMs: NOW - 2000 }],
      [{ mob: 'a thall va xakra', mobDisplay: 'a thall va xakra', tank: 'Borim', tsMs: NOW - 1000 }],
      NOW);
    expect(out.map(o => o.tank).sort()).toEqual(['Borim', 'Grabthar']);
  });
});
