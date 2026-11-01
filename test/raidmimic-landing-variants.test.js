// test/raidmimic-landing-variants.test.js — the raidmimic landing's `?v=c` "Story stage" and `?v=d` "Chapters" previews
// (the guild lead's feedback, 2026-11-01). What this pins:
//   - the cue list: revealAt maps a time to what is on screen (icon, menu, end), skip/reduced motion shows all, chapterAt
//     follows the same list, and the cue values are ordered the way the story runs,
//   - the money: the individual price is null and says "price at launch"; the guild price is $25, monthly,
//   - the honesty: unbuilt things are chipped "coming", no invented figure beyond the one decided price,
//   - the wiring: page.tsx adds c and d and leaves the default and `?v=b` renders alone; both stages use the ONE cue list;
//     sign-up is the existing SignInButton (no new auth path); the captions are drawn by the component, not the browser,
//   - the feature pictures are plain strings in the shared folder and the default page's MotionStage is untouched,
//   - public-safe: no real-looking names.
// Source-text assertions run over comment-stripped source (CLAUDE.md "comments satisfy text assertions").
// Run: npx vitest run test/raidmimic-landing-variants.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import * as S from '../web/lib/raidmimicStory.ts';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel) => stripJs(read(rel));
const L = 'web/app/raidmimic/_landing/';

describe('the cue list', () => {
  it('runs in story order and every cue is a finite number', () => {
    const c = S.STORY_CUES;
    const order = [c.mimicIcon, c.overlays, c.calls, c.loot, c.hail, c.end];
    expect(order.every(Number.isFinite)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it('shows nothing before the chest becomes the mimic', () => {
    expect(S.revealAt(0)).toEqual({ icon: false, menu: false, end: false });
    expect(S.revealAt(S.STORY_CUES.mimicIcon - 0.01)).toEqual({ icon: false, menu: false, end: false });
  });
  it('brings the icon first, then the menu with the overlays, then the end card', () => {
    const c = S.STORY_CUES;
    expect(S.revealAt(c.mimicIcon)).toEqual({ icon: true, menu: false, end: false });
    expect(S.revealAt(c.overlays - 0.01)).toEqual({ icon: true, menu: false, end: false });
    expect(S.revealAt(c.overlays)).toEqual({ icon: true, menu: true, end: false });
    expect(S.revealAt(c.end - 0.01).end).toBe(false);
    expect(S.revealAt(c.end)).toEqual({ icon: true, menu: true, end: true });
  });
  it('shows everything at once for skip / reduced motion, and survives a bad time', () => {
    expect(S.revealAt(0, true)).toEqual({ icon: true, menu: true, end: true });
    expect(S.revealAt(NaN)).toEqual({ icon: false, menu: false, end: false });
  });
  it('reads the cues it is given, not a copy of them', () => {
    const cues = { ...S.STORY_CUES, mimicIcon: 1, overlays: 2, end: 3 };
    expect(S.revealAt(1.5, false, cues)).toEqual({ icon: true, menu: false, end: false });
    expect(S.revealAt(3, false, cues).end).toBe(true);
  });
  it('sameReveal compares all three flags', () => {
    expect(S.sameReveal(S.revealAt(0), S.revealAt(1))).toBe(true);
    expect(S.sameReveal(S.revealAt(0), S.revealAt(S.STORY_CUES.mimicIcon))).toBe(false);
  });
  it('the cue values are the measured ones, in story order', () => {
    const c = S.STORY_CUES;
    expect([c.mimicIcon, c.overlays, c.calls, c.loot, c.hail, c.end]).toEqual([10.8, 23.0, 29.3, 49.4, 61.0, 81.5]);
  });
});

describe('chapters', () => {
  it('start at the cue list’s own times and each swaps in a different, existing feature', () => {
    expect(S.CHAPTERS.map(c => c.at)).toEqual([0, S.STORY_CUES.overlays, S.STORY_CUES.calls, S.STORY_CUES.loot, S.STORY_CUES.hail]);
    const f = S.CHAPTERS.map(c => c.feature);
    expect(new Set(f).size).toBe(f.length);
    for (const id of f) expect(S.featureById(id).id).toBe(id);
  });
  it('chapterAt names the chapter the video is in (the first one before any has started)', () => {
    const c = S.STORY_CUES;
    expect(S.chapterAt(0).id).toBe('setup');
    expect(S.chapterAt(c.overlays - 0.01).id).toBe('setup');
    expect(S.chapterAt(c.overlays).id).toBe('overlays');
    expect(S.chapterAt(c.calls - 0.01).id).toBe('overlays');
    expect(S.chapterAt(c.calls).id).toBe('calls');
    expect(S.chapterAt(c.loot + 1).id).toBe('loot');
    expect(S.chapterAt(c.hail + 100).id).toBe('hail');
    expect(S.chapterAt(NaN).id).toBe('setup');
  });
});

describe('the money', () => {
  it('the individual price is not decided: null, and it says so', () => {
    expect(S.INDIVIDUAL_PRICE).toBeNull();
    expect(S.priceLabel(null)).toBe('price at launch');
    expect(S.priceLabel(S.INDIVIDUAL_PRICE)).toBe('price at launch');
  });
  it('a number formats as dollars a month; the guild price is $25', () => {
    expect(S.priceLabel(7)).toBe('$7 / month');
    expect(S.GUILD_PRICE).toBe(25);
    const t = S.TIERS();
    expect(t.map(x => x.id)).toEqual(['free', 'guild', 'individual']);
    expect(t.find(x => x.id === 'guild').price).toBe('$25 / month');
    expect(t.find(x => x.id === 'guild').note).toMatch(/Monthly only\. First month free\./);
    expect(t.find(x => x.id === 'individual').price).toBe('price at launch');
    expect(t.find(x => x.id === 'free').price).toBe('$0');
  });
  it('the individual tile follows the constant (a decided price would show up without another edit)', () => {
    expect(S.TIERS(9).find(x => x.id === 'individual').price).toBe('$9 / month');
  });
  it('invents no other figure: the only dollar amounts in the words are $0 and the guild $25', () => {
    const t = JSON.stringify(S.STORY_TEXT);
    expect([...t.matchAll(/\$\d+(?:\.\d+)?/g)].map(m => m[0]).sort()).toEqual(['$0', '$25']);
    expect(t).not.toMatch(/testimonial|customers|\d+ guilds|trusted by/i);
  });
  it('anything unbuilt is chipped “coming”: the individual tier, other guilds, cloud backup', () => {
    const t = S.TIERS();
    expect(t.find(x => x.id === 'individual').coming).toMatch(/coming/i);
    expect(t.find(x => x.id === 'guild').coming).toMatch(/other guilds is coming/i);
    expect(S.featureById('sync').chip).toMatch(/coming/i);
  });
});

describe('the words stay short', () => {
  it('each feature is one picture and one sentence, with a picture path in the shared folder', () => {
    expect(S.FEATURES.map(f => f.id)).toEqual(['canvas', 'studio', 'sync', 'replay', 'zeal']);
    for (const f of S.FEATURES) {
      expect(f.line.split(/[.!?]\s/).length).toBe(1);
      expect(f.line.length).toBeLessThan(70);
      expect(f.img).toMatch(/^\/raidmimic\/shots\/[a-z-]+\.webp$/);
    }
    expect(new Set(S.FEATURES.map(f => f.img)).size).toBe(S.FEATURES.length);   // no repeated picture
  });
  it('names the sign-up exactly as the guild lead asked, and no real-looking people', () => {
    expect(S.STORY_WORDS.signUp).toBe('Sign up with Discord');
    expect(S.STORY_WORDS.startFree).toBe('Start free · Pro for your guild or for you');
    expect(JSON.stringify(S.STORY_TEXT)).not.toMatch(/bard|Hitya/i);   // the bard has no mana: the cleric example replaces it
  });
});

describe('the wiring', () => {
  const page = code('web/app/raidmimic/page.tsx');
  it('page.tsx adds c and d and keeps the default and ?v=b renders', () => {
    expect(page).toMatch(/\(await searchParams\)\.v === 'b'\) return <PathsLayout ctx=\{ctx\} motion signIn \/>;/);
    expect(page).toMatch(/return <PathsLayout ctx=\{ctx\} motion \/>;/);
    expect(page).toMatch(/pick === 'c'/);
    expect(page).toMatch(/pick === 'd'/);
    expect(page).toMatch(/<StoryStage /);
    expect(page).toMatch(/<ChaptersStage /);
  });
  it('the default page’s player is not touched: MotionStage still draws the browser’s own captions', () => {
    const m = code(L + 'MotionStage.tsx');
    expect(m).toMatch(/<track kind="captions"/);
    expect(m).not.toMatch(/StoryVideo|raidmimicStory/);
  });
  it('the metadata is the page’s own and unchanged', () => {
    expect(page).toMatch(/const TITLE = 'Raid Mimic · free EverQuest raid overlays';/);
  });
  it('both stages share one video component and one cue list', () => {
    for (const f of ['StoryStage.tsx', 'ChaptersStage.tsx']) {
      const c = code(L + f);
      expect(c).toMatch(/from '\.\/StoryVideo'/);
      expect(c).toMatch(/@\/lib\/raidmimicStory/);
      expect(c).not.toMatch(/STORY_CUES\s*=|mimicIcon:/);   // no second copy of the cues
    }
    expect(code(L + 'StoryStage.tsx')).toMatch(/revealAt\(/);
    expect(code(L + 'ChaptersStage.tsx')).toMatch(/chapterAt\(/);
  });
  it('listens to the video’s time once, in one place', () => {
    expect(code(L + 'StoryVideo.tsx').match(/addEventListener\('timeupdate'/g)).toHaveLength(1);
    expect(code(L + 'StoryStage.tsx')).not.toMatch(/timeupdate/);
    expect(code(L + 'ChaptersStage.tsx')).not.toMatch(/timeupdate/);
  });
  it('sign-up is the existing Discord sign-in button: no new auth path', () => {
    for (const f of ['StoryStage.tsx', 'ChaptersStage.tsx', 'StoryParts.tsx']) {
      const c = code(L + f);
      expect(c).toMatch(/import SignInButton from '@\/components\/SignInButton'/);
      expect(c).not.toMatch(/signInWithOAuth|supabaseBrowser|supabase-browser/);
    }
    expect(code(L + 'StoryStage.tsx')).toMatch(/label=\{W\.signUp\}/);
  });
  it('the end card, the pinned header button and the phone bottom bar exist', () => {
    expect(code(L + 'StoryStage.tsx')).toMatch(/data-reveal="end"/);
    const d = code(L + 'ChaptersStage.tsx');
    expect(d).toMatch(/sticky/);
    expect(d).toMatch(/fixed inset-x-0 bottom-0/);
    expect(d).toMatch(/sm:hidden/);
  });
  it('the story stage is a full viewport tall and skippable, and reduced motion shows everything', () => {
    const s = code(L + 'StoryStage.tsx');
    expect(s).toMatch(/h-\[calc\(100svh-/);
    expect(s).toMatch(/setSkipped\(true\)/);
    expect(s).toMatch(/skipped \|\| ended \|\| reduced/);
    expect(s).toMatch(/<noscript>/);
  });
  it('feature pictures are plain <img src> strings, not static imports', () => {
    const bits = code(L + 'StoryBits.tsx');
    expect(bits).toMatch(/<img src=\{f\.img\}/);
    for (const f of ['StoryBits.tsx', 'StoryParts.tsx', 'StoryStage.tsx', 'ChaptersStage.tsx']) expect(code(L + f)).not.toMatch(/import .* from '.*\.(webp|png|jpg)'/);
  });
});

describe('the captions', () => {
  const v = code(L + 'StoryVideo.tsx');
  it('the browser draws none of them: the track is hidden and the component draws the active cue', () => {
    expect(v).toMatch(/track\.mode = 'hidden'/);
    expect(v).toMatch(/addEventListener\('cuechange'/);
    expect(v).toMatch(/activeCues/);
  });
  it('the caption box is anchored by its bottom edge, wraps, and has a backing', () => {
    expect(v).toMatch(/absolute inset-x-0 z-10 flex justify-center/);
    expect(v).toMatch(/captionBottom/);
    expect(v).toMatch(/bg-black\/80/);
    expect(v).toMatch(/whitespace-pre-line/);
    expect(v).toMatch(/\[text-wrap:balance\]/);
    expect(v).not.toMatch(/whitespace-nowrap|truncate|overflow-hidden/);
  });
  it('story.vtt is unchanged, so the default page’s captions are too', () => {
    const vtt = read('web/public/raidmimic/motion/story.vtt');
    expect(vtt.match(/line:78% align:center size:86%/g)).toHaveLength(22);
  });
});
