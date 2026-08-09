// test/zeal-tag-upload-cap.test.js — which /tag rows survive the upload cap.
//
// The bug (Hitya, 2026-08-07): tagging through The Deep produced ~50 tags and
// the payload capped at EXACTLY 24 on two independent agents. The old code was
// `st.zeal_tags.slice(0, 24)` over an array the agent builds in Map INSERTION
// order — so it kept the OLDEST 24 and silently dropped everything later,
// including `Thought Horror Overfiend`, tagged last and the one mob in the zone
// anyone needed identified.
//
// Rules now: named mobs (proper nouns) are never dropped; generic
// article-prefixed mobs fill the remainder newest-first.
//
// Run: npx vitest run test/zeal-tag-upload-cap.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, BOT_INDEX } from './_source-slice.js';

const block = sliceBlock(
  readSource(BOT_INDEX),
  'function _isNamedMob(mob) {',
  '\n  return named.concat(generic).slice(0, cap);\n}',
);

// eslint-disable-next-line no-new-func
const { _pickZealTags, _isNamedMob } = new Function(
  'const ZEAL_TAG_UPLOAD_CAP = 64;\n' + block + '\nreturn { _pickZealTags, _isNamedMob };',
)();

const tag = (mob, minute) => ({
  mob, spawn_id: 100 + minute, since: `2026-08-07T14:${String(minute).padStart(2, '0')}:00.000Z`,
});

describe('_isNamedMob', () => {
  it('treats proper nouns as named and article-prefixed mobs as generic', () => {
    expect(_isNamedMob('Thought Horror Overfiend')).toBe(true);
    expect(_isNamedMob('Agent of Solusek')).toBe(true);
    expect(_isNamedMob('Merdan Fleetfoot')).toBe(true);
    expect(_isNamedMob('an elder thought horror')).toBe(false);
    expect(_isNamedMob('a horror guard')).toBe(false);
    expect(_isNamedMob('')).toBe(false);
    expect(_isNamedMob(null)).toBe(false);
  });
});

describe('_pickZealTags', () => {
  it('passes everything through when under the cap', () => {
    const tags = [tag('a horror guard', 1), tag('a thought horror', 2)];
    expect(_pickZealTags(tags, 64)).toEqual(tags);
  });

  it('passes through at exactly the cap', () => {
    const tags = Array.from({ length: 8 }, (_, i) => tag('an elder thought horror', i));
    expect(_pickZealTags(tags, 8)).toHaveLength(8);
  });

  it('keeps the boss even when it was tagged LAST — the regression', () => {
    // 30 generics tagged first, boss tagged last. Old slice(0,24) dropped it.
    const generics = Array.from({ length: 30 }, (_, i) => tag('an elder thought horror', i));
    const boss = tag('Thought Horror Overfiend', 40);
    const picked = _pickZealTags([...generics, boss], 24);

    expect(picked).toHaveLength(24);
    expect(picked.map(t => t.mob)).toContain('Thought Horror Overfiend');
  });

  it('keeps ALL named mobs before any generic', () => {
    const generics = Array.from({ length: 30 }, (_, i) => tag('a horror guard', i));
    const named = [tag('Thought Horror Overfiend', 40), tag('Agent of Solusek', 41)];
    const picked = _pickZealTags([...generics, ...named], 5);

    expect(picked.slice(0, 2).map(t => t.mob).sort())
      .toEqual(['Agent of Solusek', 'Thought Horror Overfiend']);
    expect(picked).toHaveLength(5);
  });

  it('fills the remainder with the NEWEST generics, not the oldest', () => {
    // minutes 0..29; with cap 3 we expect the three newest (29, 28, 27).
    const generics = Array.from({ length: 30 }, (_, i) => tag('an elder thought horror', i));
    const picked = _pickZealTags(generics, 3);

    expect(picked.map(t => t.spawn_id)).toEqual([129, 128, 127]);
  });

  it('does not lose named mobs when they alone exceed the cap', () => {
    const named = Array.from({ length: 10 }, (_, i) => tag(`Boss${i}`, i));
    const picked = _pickZealTags(named, 4);
    expect(picked).toHaveLength(4);
    // Newest-first among named.
    expect(picked.map(t => t.spawn_id)).toEqual([109, 108, 107, 106]);
  });

  it('tolerates a missing/!unparseable since without throwing', () => {
    const tags = [
      { mob: 'a horror guard', spawn_id: 1 },
      { mob: 'an elder thought horror', spawn_id: 2, since: 'not-a-date' },
      tag('Thought Horror Overfiend', 5),
    ];
    const picked = _pickZealTags(tags, 2);
    expect(picked.map(t => t.mob)).toContain('Thought Horror Overfiend');
    expect(picked).toHaveLength(2);
  });
});
