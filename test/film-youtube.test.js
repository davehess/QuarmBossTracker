// test/film-youtube.test.js — /film reads the takes and their YouTube links from bot_kv
// (the guild lead, 2026-09-27: the film goes on YouTube). web/lib/film.ts turns whatever link was
// pasted into a video id, or null; it never guesses.
//
// Run: npx vitest run test/film-youtube.test.js

import { describe, it, expect } from 'vitest';
import { youtubeId, parseFilm } from '../web/lib/film.ts';

const ID = 'dQw4w9WgXcQ';

describe('youtubeId', () => {
  it('accepts the bare id and every usual link shape', () => {
    for (const s of [ID, ` ${ID} `, `https://www.youtube.com/watch?v=${ID}`, `https://youtube.com/watch?v=${ID}&t=42s`,
      `https://m.youtube.com/watch?v=${ID}`, `https://youtu.be/${ID}`, `https://youtu.be/${ID}?si=abc`,
      `https://www.youtube.com/shorts/${ID}`, `https://www.youtube.com/embed/${ID}`, `https://www.youtube.com/live/${ID}`,
      `https://www.youtube-nocookie.com/embed/${ID}`]) {
      expect(youtubeId(s)).toBe(ID);
    }
  });
  it('refuses anything else instead of guessing', () => {
    for (const s of [null, undefined, 42, '', 'not a link', 'dQw4w9WgXc', `https://vimeo.com/${ID}`,
      `https://evil.example/watch?v=${ID}`, 'https://www.youtube.com/watch?v=short', 'javascript:alert(1)',
      `https://www.youtube.com/channel/${ID}`]) {
      expect(youtubeId(s)).toBeNull();
    }
  });
});

describe('parseFilm', () => {
  it('keeps the stored order, attaches the poster, and normalises the link', () => {
    const takes = parseFilm({ takes: [
      { key: 'regular', title: 'Wolf Pack Rise', length: '2:46', youtube: `https://youtu.be/${ID}` },
      { key: 'remix', title: 'Wolf Pack Rise · Remix', length: '2:30', youtube: null },
    ] });
    expect(takes.map(t => t.key)).toEqual(['regular', 'remix']);
    expect(takes[0]).toMatchObject({ youtube: ID, poster: '/film/wolfpack-rise.jpg' });
    expect(takes[1]).toMatchObject({ youtube: null, poster: '/film/wolfpack-rise-remix.jpg' });
  });
  it('drops malformed entries and survives a missing or broken value', () => {
    expect(parseFilm(null)).toEqual([]);
    expect(parseFilm({})).toEqual([]);
    expect(parseFilm({ takes: 'nope' })).toEqual([]);
    expect(parseFilm({ takes: [null, { key: 1 }, { title: 'x' }, { key: 'regular', title: 'Ok' }] }).map(t => t.title)).toEqual(['Ok']);
  });
});
