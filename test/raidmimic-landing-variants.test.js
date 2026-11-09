// test/raidmimic-landing-variants.test.js — the raidmimic landing's story stage, now the ONE page (the guild lead picked C on
// 2026-11-01: "C, but start truly as the only thing on the page, fit is the video, fade it into the background color. Slowly add
// the logos as we go into the video. Skip/hide at the bottom."; the `?v=` previews were deleted). What this pins:
//   - the cue list: revealAt maps a time to what is on screen (icon, menu, marks, end), skip/reduced motion shows all,
//   - the marks: which feature marks are visible at time t, in story order, each waiting for its own cue,
//   - the money: the individual price is null and says "price at launch"; the guild price is $25, monthly,
//   - the honesty: unbuilt things are chipped "coming", no invented figure beyond the one decided price,
//   - the wiring: the default render IS the story stage; the first screen is the video alone (full viewport, nothing drawn
//     until a cue), whole picture (object-contain) with edges faded into the page colour, slow mark fades, Skip and Hide at the
//     bottom, reduced motion shows everything; sign-up is the existing SignInButton; the captions are drawn by the component,
//   - the feature pictures are plain strings in the shared folder,
//   - public-safe: no real-looking names.
// Source-text assertions run over comment-stripped source (CLAUDE.md "comments satisfy text assertions").
// Run: npx vitest run test/raidmimic-landing-variants.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs, stripCss } from './_source-slice.js';
import * as S from '../web/lib/raidmimicStory.ts';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel) => stripJs(read(rel));
const L = 'web/app/raidmimic/_landing/';
const NONE = { icon: false, menu: false, end: false, marks: [] };

describe('the cue list', () => {
  it('runs in story order and every cue is a finite number', () => {
    const c = S.STORY_CUES;
    const order = [c.mimicIcon, c.overlays, c.calls, c.loot, c.hail, c.end];
    expect(order.every(Number.isFinite)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it('shows nothing at all before the chest becomes the mimic: the video is the only thing on the page', () => {
    expect(S.revealAt(0)).toEqual(NONE);
    expect(S.revealAt(S.STORY_CUES.mimicIcon - 0.01)).toEqual(NONE);
  });
  it('brings the icon first, then the menu and the first mark with the overlays, then the end card', () => {
    const c = S.STORY_CUES;
    expect(S.revealAt(c.mimicIcon)).toEqual({ ...NONE, icon: true });
    expect(S.revealAt(c.overlays - 0.01)).toEqual({ ...NONE, icon: true });
    expect(S.revealAt(c.overlays)).toEqual({ icon: true, menu: true, end: false, marks: ['overlays'] });
    expect(S.revealAt(c.end - 0.01).end).toBe(false);
    expect(S.revealAt(c.end)).toEqual({ icon: true, menu: true, end: true, marks: ['overlays', 'calls', 'loot', 'hail'] });
  });
  it('shows everything at once for skip / reduced motion, and survives a bad time', () => {
    expect(S.revealAt(0, true)).toEqual({ icon: true, menu: true, end: true, marks: ['overlays', 'calls', 'loot', 'hail'] });
    expect(S.revealAt(NaN)).toEqual(NONE);
    expect(S.revealAt(-5)).toEqual(NONE);
  });
  it('reads the cues it is given, not a copy of them', () => {
    const cues = { ...S.STORY_CUES, mimicIcon: 1, overlays: 2, calls: 2.5, end: 3 };
    expect(S.revealAt(1.5, false, cues)).toEqual({ ...NONE, icon: true });
    expect(S.revealAt(2.6, false, cues).marks).toEqual(['overlays', 'calls']);
    expect(S.revealAt(3, false, cues).end).toBe(true);
  });
  it('sameReveal compares all four parts, the marks included', () => {
    expect(S.sameReveal(S.revealAt(0), S.revealAt(1))).toBe(true);
    expect(S.sameReveal(S.revealAt(0), S.revealAt(S.STORY_CUES.mimicIcon))).toBe(false);
    const c = S.STORY_CUES;
    expect(S.sameReveal(S.revealAt(c.overlays + 1), S.revealAt(c.calls - 1))).toBe(true);   // same marks: no re-render
    expect(S.sameReveal(S.revealAt(c.calls - 1), S.revealAt(c.calls))).toBe(false);         // a mark appears: it differs
  });
  it('the cue values are the measured ones, in story order', () => {
    const c = S.STORY_CUES;
    expect([c.mimicIcon, c.overlays, c.calls, c.loot, c.hail, c.end]).toEqual([10.8, 23.0, 29.3, 49.4, 61.0, 81.5]);
  });
});

describe('the marks (logos that fade in as the story goes on)', () => {
  const c = S.STORY_CUES;
  it('are Overlays, Calls, Loot and Hail, in story order, each waiting for its own cue', () => {
    expect(S.MARKS.map(m => m.id)).toEqual(['overlays', 'calls', 'loot', 'hail']);
    expect(S.MARKS.map(m => c[m.cue])).toEqual([c.overlays, c.calls, c.loot, c.hail]);
    const at = S.MARKS.map(m => c[m.cue]);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
  it('marksAt: none before the first moment, one more at each cue, all by the end', () => {
    expect(S.marksAt(0)).toEqual([]);
    expect(S.marksAt(c.overlays - 0.01)).toEqual([]);
    expect(S.marksAt(c.overlays)).toEqual(['overlays']);
    expect(S.marksAt(c.calls - 0.01)).toEqual(['overlays']);
    expect(S.marksAt(c.calls)).toEqual(['overlays', 'calls']);
    expect(S.marksAt(c.loot)).toEqual(['overlays', 'calls', 'loot']);
    expect(S.marksAt(c.hail - 0.01)).toEqual(['overlays', 'calls', 'loot']);
    expect(S.marksAt(c.hail)).toEqual(['overlays', 'calls', 'loot', 'hail']);
    expect(S.marksAt(1e6)).toEqual(['overlays', 'calls', 'loot', 'hail']);
  });
  it('marksAt: `all` shows every mark whatever the time; a bad time shows none', () => {
    expect(S.marksAt(0, true)).toEqual(['overlays', 'calls', 'loot', 'hail']);
    expect(S.marksAt(NaN)).toEqual([]);
    expect(S.marksAt(Infinity)).toEqual([]);   // not a finite time: treated as the start
  });
  it('marksAt reads the cues and marks it is given', () => {
    const cues = { ...c, overlays: 1, calls: 2 };
    expect(S.marksAt(1.5, false, cues)).toEqual(['overlays']);
    expect(S.marksAt(5, false, cues, [S.MARKS[1]])).toEqual(['calls']);
  });
  it('each mark names a real drawing from the icons file and a short label', () => {
    const icons = read(L + 'FeatureIcons.tsx');
    for (const m of S.MARKS) {
      expect(m.label.length).toBeLessThanOrEqual(10);
      expect(icons, m.id).toMatch(new RegExp(`\\b${m.icon}: \\w+Icon`));
    }
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
    // Free flag and kill syncing (pick A, 2026-11-02) is listed in Free, and chipped coming until it works outside Wolf Pack.
    const free = t.find(x => x.id === 'free');
    expect(free.points).toContain('Your PoP flags and boss kills, synced');
    expect(free.coming).toMatch(/outside Wolf Pack is coming/);
  });
});

describe('raid management (the guild side)', () => {
  it('names the six guild features the guild lead listed, one short line each, and the menu reaches the section', () => {
    expect(S.RAID_MGMT.map(m => m.id)).toEqual(['threads', 'dkp', 'quests', 'announce', 'command', 'routes']);
    for (const m of S.RAID_MGMT) {
      expect(m.line.split(/[.!?]\s/).length).toBe(1);
      expect(m.line.length).toBeLessThan(70);
    }
    expect(S.STORY_WORDS.menu.map(x => x.href)).toContain(`#${S.RAID_MGMT_HEAD.id}`);
  });
  it('says hosting another guild is coming, and the page renders the section once', () => {
    expect(S.RAID_MGMT_HEAD.chip).toMatch(/coming/);
    const page = stripJs(read('web/app/raidmimic/page.tsx'));
    expect(page.match(/<RaidManagement \/>/g)).toHaveLength(1);
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
    expect(S.STORY_WORDS.skip).toBe('Skip');
    expect(S.STORY_WORDS.hide).toBe('Hide');
    expect(JSON.stringify(S.STORY_TEXT)).not.toMatch(/bard|Hitya/i);   // the bard has no mana: the cleric example replaces it
  });
});

describe('the wiring: the default page IS the story stage', () => {
  const page = code('web/app/raidmimic/page.tsx');
  const stage = code(L + 'StoryStage.tsx');
  const video = code(L + 'StoryVideo.tsx');
  const css = stripCss(read('web/app/globals.css'));

  it('page.tsx renders the stage with no query: no variants, no beta tag, no other layout', () => {
    expect(page).toMatch(/<StoryStage downloadUrl=\{DOWNLOAD_URL\} onHost=\{onHost\} \/>/);
    // 2026-11-09: `searchParams` is read for the skip-video previews only (raidmimic-skip-video.test.js pins them and the default).
    expect(page).not.toMatch(/pick ===|PathsLayout|ChaptersStage|BetaTag/);
    expect(page.match(/<StoryStage\b/g)).toHaveLength(2);   // the default, and the big-skip preview (raidmimic-skip-video.test.js)
  });
  it('the metadata is the page’s own and unchanged', () => {
    expect(page).toMatch(/const TITLE = 'Raid Mimic · free EverQuest raid overlays';/);
  });
  it('the first screen is the video alone: a full viewport, and every piece of chrome starts invisible', () => {
    expect(css).toMatch(/\.rm-stage \{ --sh: max\(100svh, 26rem\); height: var\(--sh\); \}/);
    expect(stage).toMatch(/className=\{`rm-stage relative/);
    // the header lockup, the menu, each mark and the end card are all drawn through `on(show.…)`, which is `invisible opacity-0` until a cue
    expect(stage).toMatch(/const on = \(show: boolean\) => \(show \? 'visible opacity-100' : 'invisible opacity-0'\);/);
    for (const part of ['data-reveal="icon"', 'data-reveal="menu"', 'data-reveal="mark"', 'data-reveal="end"']) expect(stage, part).toContain(part);
    expect(stage).toMatch(/\$\{on\(show\.icon\)\}/);
    expect(stage).toMatch(/\$\{on\(show\.menu\)\}/);
    expect(stage).toMatch(/\$\{on\(show\.marks\.includes\(m\.id\)\)\}/);
    expect(stage).toMatch(/\$\{on\(show\.end\)\}/);
    expect(stage).toMatch(/useState<Reveal>\(\(\) => revealAt\(0\)\)/);   // the start state is the cue list at time 0: nothing
    expect(S.revealAt(0)).toEqual(NONE);
  });
  it('on a raidmimic host the stage reaches the viewport’s edges through the layout’s padding; on the Wolf Pack hosts it sits under the site header', () => {
    expect(stage).toMatch(/onHost \? '-mx-3 -mt-3 sm:-mx-4 sm:-mt-4' : 'rm-stage-in-site'/);
    expect(css).toMatch(/\.rm-stage-in-site \{ --sh: max\(calc\(100svh - 1\.5rem\), 26rem\); \}/);
    // …and that padding is what the bare layout gives (p-3 sm:p-4), so the two numbers cannot drift unseen
    expect(code('web/app/layout.tsx')).toMatch(/mx-auto p-3 sm:p-4/);
  });
  it('the whole video is shown, never cropped: object-contain in a box of the video’s own shape', () => {
    expect(stage).toMatch(/fit="object-contain"/);
    expect(stage).not.toMatch(/object-cover|portrait:object/);
    expect(video).not.toMatch(/object-cover/);
    expect(css).toMatch(/\.rm-frame \{[^}]*aspect-ratio: 9 \/ 16;/);
    expect(css).toMatch(/@media \(min-width: 1024px\) and \(orientation: landscape\) \{\s*\.rm-frame \{ width: min\(100%, var\(--sh\)\); aspect-ratio: 1 \/ 1; \}/);
    expect(video).toMatch(/const SQUARE_QUERY = '\(min-width: 1024px\) and \(orientation: landscape\)';/);   // the SAME query picks the square file
  });
  it('the frame’s edges fade into the page colour: a two-axis gradient mask, the stage painted in the page’s own bg token', () => {
    const frame = css.match(/\.rm-frame \{[\s\S]*?\n  \}/)[0];
    expect(frame).toMatch(/mask-image: linear-gradient\(to right, transparent, black 12%, black 88%, transparent\), linear-gradient\(to bottom, transparent, black 12%, black 88%, transparent\)/);
    expect(frame).toMatch(/mask-composite: intersect/);
    expect(frame).toMatch(/-webkit-mask-composite: source-in/);
    expect(stage).toMatch(/overflow-hidden bg-bg/);
    expect(video).toMatch(/<div data-story-frame className="rm-frame">/);
    // the mask wraps the picture and the poster only: the captions and the buttons are siblings of the frame, never inside it
    const inside = video.slice(video.indexOf('data-story-frame'), video.indexOf('</div>', video.indexOf('data-story-frame')));
    expect(inside).toMatch(/<video\b/);
    expect(inside).not.toMatch(/data-story-caption|<button|data-story-controls/);
  });
  it('the marks fade in slowly (1.2 s), sit at the edges, and reduced motion drops the fade', () => {
    expect(stage).toMatch(/const SLOW = 'transition-\[opacity,visibility\] duration-\[1200ms\] ease-out motion-reduce:transition-none';/);
    expect(stage).toMatch(/`flex flex-col items-center gap-1 \$\{SLOW\} \$\{on\(/);
    expect(stage).toMatch(/lg:left-5/);                     // a column in the gutter beside the square picture on a wide screen
    expect(stage).toMatch(/pointer-events-none absolute inset-x-0 top-20/);   // a row under the header on a phone, never over the click targets
    expect(stage).toMatch(/MARKS\.map\(m =>/);
    expect(stage).toMatch(/const Icon = ICONS\[m\.icon\];/);
    expect(stage).toMatch(/\$\{SLOW\} \$\{on\(show\.icon\)\}/);   // the lockup uses the same slow fade
  });
  it('Skip and Hide sit at the bottom with Sound and CC, small and quiet', () => {
    expect(video).toMatch(/<div data-story-controls className="absolute inset-x-0 bottom-0 z-20 flex/);
    const bar = video.slice(video.indexOf('data-story-controls'));
    expect(bar).toMatch(/\{W\.soundOff\}|W\.soundOn/);
    expect(bar).toMatch(/>CC</);
    expect(bar).toMatch(/\{children\}/);
    expect(stage).toMatch(/onClick=\{\(\) => setSkipped\(true\)\} className=\{QUIET_BTN\}>\{W\.skip\}/);
    expect(stage).toMatch(/onClick=\{\(\) => setHidden\(true\)\} className=\{QUIET_BTN\}>\{W\.hide\}/);
    expect(video).toMatch(/export const QUIET_BTN = 'min-h-11 rounded-md bg-transparent px-3 text-xs text-\[#f2ede1\]\/70/);   // quiet, still a 44px target
    // …and not the old loud corner buttons
    expect(stage).not.toMatch(/absolute bottom-2 right-2/);
  });
  it('Hide collapses the stage to a slim bar so the page reads on, and the bar brings the story back', () => {
    expect(stage).toMatch(/if \(hidden\) \{/);
    const hidden = stage.slice(stage.indexOf('if (hidden) {'), stage.indexOf('return (', stage.indexOf('if (hidden) {') + 20));
    expect(hidden).not.toMatch(/<StoryVideo/);                 // the video is gone (it stops downloading and playing)
    expect(hidden).toMatch(/\{W\.show\}/);
    expect(stage).toMatch(/const all = skipped \|\| ended \|\| reduced \|\| hidden;/);   // the bar shows the lockup and the menu
  });
  it('skip, the end and reduced motion show everything at once; no script shows it too', () => {
    expect(stage).toMatch(/const all = skipped \|\| ended \|\| reduced \|\| hidden;/);
    expect(stage).toMatch(/const show: Reveal = all \? revealAt\(0, true\) : timed;/);
    expect(stage).toMatch(/<noscript>/);
    expect(stage).toMatch(/\[data-reveal\]\{opacity:1!important;visibility:visible!important\}/);
  });
  it('the stage uses the ONE video component and the ONE cue list', () => {
    expect(stage).toMatch(/from '\.\/StoryVideo'/);
    expect(stage).toMatch(/@\/lib\/raidmimicStory/);
    expect(stage).not.toMatch(/STORY_CUES\s*=|mimicIcon:/);   // no second copy of the cues
    expect(stage).toMatch(/revealAt\(/);
    expect(video.match(/addEventListener\('timeupdate'/g)).toHaveLength(1);
    expect(stage).not.toMatch(/timeupdate/);
  });
  it('sign-up is the existing Discord sign-in button: no new auth path', () => {
    for (const f of ['StoryStage.tsx', 'StoryParts.tsx']) {
      const c = code(L + f);
      expect(c).toMatch(/import SignInButton from '@\/components\/SignInButton'/);
      expect(c).not.toMatch(/signInWithOAuth|supabaseBrowser|supabase-browser/);
    }
    expect(stage).toMatch(/label=\{W\.signUp\}/);
  });
  it('the end card exists, and the chapters, pinned bar and old players are gone', () => {
    expect(stage).toMatch(/data-reveal="end"/);
    expect(S).not.toHaveProperty('CHAPTERS');
    expect(S).not.toHaveProperty('chapterAt');
    expect(css).not.toMatch(/rm-stage-box|rm-card|rm-fan|\.rm-fade/);
  });
  it('feature pictures are plain <img src> strings, not static imports', () => {
    expect(code(L + 'StoryBits.tsx')).toMatch(/<img src=\{f\.img\}/);
    for (const f of ['StoryBits.tsx', 'StoryParts.tsx', 'StoryStage.tsx']) expect(code(L + f)).not.toMatch(/import .* from '.*\.(webp|png|jpg)'/);
  });
});

describe('the captions', () => {
  const v = code(L + 'StoryVideo.tsx');
  it('the browser draws none of them: the track is hidden and the component draws the active cue', () => {
    expect(v).toMatch(/track\.mode = 'hidden'/);
    expect(v).toMatch(/addEventListener\('cuechange'/);
    expect(v).toMatch(/activeCues/);
  });
  it('the caption box is anchored by its bottom edge, above the bottom row, wraps, and has a backing', () => {
    expect(v).toMatch(/absolute inset-x-0 z-10 flex justify-center/);
    expect(v).toMatch(/captionBottom = 'bottom-14 sm:bottom-16'/);
    expect(v).toMatch(/bg-black\/80/);
    expect(v).toMatch(/whitespace-pre-line/);
    expect(v).toMatch(/\[text-wrap:balance\]/);
    expect(v).not.toMatch(/whitespace-nowrap|truncate|overflow-hidden/);
  });
  it('story.vtt is unchanged', () => {
    const vtt = read('web/public/raidmimic/motion/story.vtt');
    expect(vtt.match(/line:78% align:center size:86%/g)).toHaveLength(22);
  });
});
