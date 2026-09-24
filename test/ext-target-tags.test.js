// test/ext-target-tags.test.js — where Extended Target puts a Zeal /tag.
//
// The guild lead, 2026-09-23, on a Kromrif Warrior row with six "▲ KILL" chips
// under it: "why are there so many tags here". A trash clear tags every mob
// KILL, nothing clears a tag when its mob dies, and each dead mob's tag stayed
// in the pool for ten minutes. Picked: show each distinct tag once — and match
// a tag to its row by spawn id, which the pool never did.
//
// The fixture is that clear: seven KILL tags in six minutes, one per spawn id
// (the real ids), newest last. Runs the real _extPlaceTags.
//
// Run: npx vitest run test/ext-target-tags.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, evalBlock, BOT_INDEX } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const { _extPlaceTags } = evalBlock(
  sliceBlock(src, 'function _extPlaceTags(rows, nameTags, spawnOfRaider) {', '\n}'), ['_extPlaceTags']);

const T0 = Date.parse('2026-09-24T02:20:05Z');
const KILL_IDS = [[2139, 0], [2269, 83], [2421, 308], [2422, 320], [2419, 337], [2418, 372], [2615, 401]];
const tag = (spawn_id, sec, text = 'KILL', shape = 'O') => ({ spawn_id, text, shape, tagger: 'Corvale', sinceMs: T0 + sec * 1000 });
const tagMap = (list) => new Map(list.map(t => [t.spawn_id, t]));
const killTags = () => tagMap(KILL_IDS.map(([id, s]) => tag(id, s)));
const row = (raiders, extra = {}) => ({ raiders, ...extra });

describe('the trash clear: seven KILL tags on one name', () => {
  it('without spawn ids, the pool shows KILL once — the newest', () => {
    const rows = [row(['Aldenmar', 'Brackwyn'])];
    const pool = _extPlaceTags(rows, killTags(), new Map());
    expect(pool).toEqual([{ spawn_id: 2615, text: 'KILL', shape: 'O' }]);
    expect(rows[0]._tag).toBeUndefined();
  });

  it('when the raiders\' Zeal names the mob, its tag goes on the row and the pool is empty', () => {
    const rows = [row(['Aldenmar', 'Brackwyn'])];
    const ids = new Map([['aldenmar', 2615], ['brackwyn', 2615]]);
    const pool = _extPlaceTags(rows, killTags(), ids);
    expect(rows[0]._tag.spawn_id).toBe(2615);
    expect(pool).toEqual([]);
  });
});

describe('matching by spawn id', () => {
  it('two proven rows each get their own tag, whatever the text says', () => {
    const rows = [row(['Aldenmar'], { spawn_id: 11 }), row(['Brackwyn'], { spawn_id: 10 })];
    const pool = _extPlaceTags(rows, tagMap([tag(10, 0, 'MEZ'), tag(11, 5, 'KILL')]), new Map());
    expect(rows[0]._tag.text).toBe('KILL');
    expect(rows[1]._tag.text).toBe('MEZ');
    expect(pool).toEqual([]);
  });

  it('a row whose raiders report two different ids is not matched by id', () => {
    const rows = [row(['Aldenmar', 'Brackwyn']), row(['Nyssara'])];
    const ids = new Map([['aldenmar', 10], ['brackwyn', 11]]);
    const pool = _extPlaceTags(rows, tagMap([tag(10, 0)]), ids);
    expect(rows[0]._tag).toBeUndefined();
    expect(pool).toHaveLength(1);
  });
});

describe('what already worked still works', () => {
  it('a tag naming the tank goes on that tank\'s row', () => {
    const rows = [row(['Aldenmar'], { tanks: ['Aldenmar'] }), row(['Brackwyn'], { tanks: ['Brackwyn'] })];
    _extPlaceTags(rows, tagMap([tag(7, 0, 'Brackwyn-Tanking')]), new Map());
    expect(rows[1]._tag.spawn_id).toBe(7);
    expect(rows[0]._tag).toBeUndefined();
  });

  it('one tag on one row goes on it', () => {
    const rows = [row(['Aldenmar'])];
    expect(_extPlaceTags(rows, tagMap([tag(5, 0)]), new Map())).toEqual([]);
    expect(rows[0]._tag.spawn_id).toBe(5);
  });

  it('different tags stay separate chips, newest first', () => {
    const rows = [row(['Aldenmar']), row(['Brackwyn'])];
    const pool = _extPlaceTags(rows, tagMap([tag(1, 0, 'KILL'), tag(2, 9, 'MEZ'), tag(3, 20, 'KILL')]), new Map());
    expect(pool.map(p => p.text)).toEqual(['KILL', 'MEZ']);
    expect(pool[0].spawn_id).toBe(3);
  });

  it('a tag with no text and no shape is only its id, so those stay separate', () => {
    const rows = [row(['Aldenmar']), row(['Brackwyn'])];
    const pool = _extPlaceTags(rows, tagMap([tag(1, 0, '', null), tag(2, 5, '', null)]), new Map());
    expect(pool).toHaveLength(2);
  });

  it('no tags: nothing changes', () => {
    const rows = [row(['Aldenmar'])];
    expect(_extPlaceTags(rows, undefined, new Map())).toEqual([]);
    expect(rows[0]).toEqual({ raiders: ['Aldenmar'] });
  });
});
