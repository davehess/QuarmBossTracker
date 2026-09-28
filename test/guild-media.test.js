// test/guild-media.test.js — guild media (the guild lead, 2026-09-28: a gallery on each character page,
// kept long-term, first filled with the Aten Ha Ra film). web/lib/guildMedia.ts is pure; the API route
// must check sign-in before it reads anything, and never hands out the whole store in one call.
//
// Run: npx vitest run test/guild-media.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs, stripSql } from './_source-slice.js';
import { isCharacterName, isSection, clock, bySection, parseFilmMaking, downloadUrl, SECTIONS } from '../web/lib/guildMedia.ts';

const item = (id, section, extra = {}) => ({ id, section, character: null, kind: 'image', title: null, used: false, thumbUrl: null, url: null, name: 'f', ...extra });

describe('input guards', () => {
  it('takes a character name only as letters, so a case-insensitive match can never become a wildcard', () => {
    for (const s of ['Fittir', 'ab', 'SuperBloodWolf']) expect(isCharacterName(s)).toBe(true);
    for (const s of ['', 'a', 'Fit tir', 'Fit%', 'Fit_', "Fit'r", '../etc', 'Fittir1', null, 42]) expect(isCharacterName(s)).toBe(false);
  });
  it('knows its sections and nothing else', () => {
    expect(isSection('take')).toBe(true);
    expect(isSection('first-still')).toBe(true);
    for (const s of ['takes', '', 'TAKE', null, 1]) expect(isSection(s)).toBe(false);
  });
});

describe('clock', () => {
  it('reads seconds as m:ss', () => {
    expect(clock(45.05)).toBe('0:45');
    expect(clock(125.9)).toBe('2:05');
    expect(clock(-3)).toBe('0:00');
  });
});

describe('bySection', () => {
  it('groups in gallery order and drops empty sections', () => {
    const g = bySection([item(1, 'take'), item(2, 'clip'), item(3, 'take'), item(4, 'first-still')]);
    expect(g.map((x) => x.key)).toEqual(['clip', 'first-still', 'take']);
    expect(g[2].items.map((i) => i.id)).toEqual([1, 3]);
    expect(SECTIONS[0].key).toBe('clip');
  });
});

describe('parseFilmMaking', () => {
  it('keeps good raiders and drops malformed ones instead of throwing', () => {
    const fm = parseFilmMaking({
      raiders: [
        { n: 1, name: 'Aldenmar', cls: 'Warrior', race: 'Ogre', in_film: true, say: 'AL-den-mar', regular: { t: 45.05, heard: 'Allen more' }, remix: { t: 41 } },
        { n: 2, name: 'Brack wyn', cls: 'Monk' },
        { name: 'Corvale' },
        { n: 4, name: 'Rethlan', cls: 'Bard', in_film: false, regular: { t: Infinity } },
      ],
      song: { bpm: 103.4, style: 'epic', lyrics: 'la', takes: [{ key: 'regular', title: 'T', secs: 166.4 }, { key: 7 }] },
      stats: { cards: 98, in_film: 78, pictures: 300, renders: 200 },
    });
    expect(fm.raiders.map((r) => r.name)).toEqual(['Aldenmar', 'Rethlan']);
    expect(fm.raiders[0]).toMatchObject({ inFilm: true, say: 'AL-den-mar', regular: { t: 45.05, heard: 'Allen more' }, remix: { t: 41, heard: '' } });
    expect(fm.raiders[1]).toMatchObject({ inFilm: false, say: null, regular: null, remix: null });
    expect(fm.song.takes).toEqual([{ key: 'regular', title: 'T', secs: 166.4 }]);
    expect(fm.stats).toEqual({ cards: 98, inFilm: 78, pictures: 300, renders: 200 });
  });
  it('is null for no value or a broken one', () => {
    for (const v of [null, undefined, 42, 'x', {}, { raiders: 'no' }]) expect(parseFilmMaking(v)).toBeNull();
  });
});

describe('downloadUrl', () => {
  it('adds the download parameter to a signed link', () => {
    expect(downloadUrl('https://x/s?token=a', '06 - A b.mp4')).toBe('https://x/s?token=a&download=06%20-%20A%20b.mp4');
    expect(downloadUrl('https://x/s', 'a.jpg')).toBe('https://x/s?download=a.jpg');
  });
});

describe('/api/media', () => {
  const src = stripJs(fs.readFileSync(path.join(ROOT, 'web', 'app', 'api', 'media', 'route.ts'), 'utf8'));
  it('checks sign-in before it reads or signs anything', () => {
    const auth = src.indexOf('auth.getUser()');
    expect(auth).toBeGreaterThan(-1);
    expect(src.indexOf('401')).toBeGreaterThan(auth);
    for (const call of ['mediaInfo(id)', 'loadMedia(']) expect(src.indexOf(call)).toBeGreaterThan(auth);
  });
  it('refuses a request with neither a section nor a character', () => {
    expect(src).toMatch(/if \(!section && !character\) return bad\(/);
  });
});

describe('the store is private', () => {
  const sql = stripSql(fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20260928045235_guild_media.sql'), 'utf8'));
  it('creates a private bucket and a table with RLS on and no policies', () => {
    expect(sql).toMatch(/values \('guild-media', 'guild-media', false,/);
    expect(sql).toMatch(/alter table public\.guild_media enable row level security;/);
    expect(sql).not.toMatch(/create policy/i);
  });
});
