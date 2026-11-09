// test/raidmimic-skip-video.test.js — the raidmimic landing's big Skip and signed-in Home panel (the guild lead, 2026-11-09: "a big skip
// video button at the top ... users log into it and have their information come up on the homepage ... a link 'rewatch the video'
// up top"; he picked "Home panel" on the Decision Desk, and the Doorway redirect and every `?v=` switch were deleted).
// Pins: signed out = the story stage with the big Skip; signed in = the panel instead of the video; the page and /characters read no
// query; storage is guarded; the rewatch is a hash, which survives a raidmimic host's query drop.
// Source-text assertions run over comment-stripped source (CLAUDE.md "comments satisfy text assertions").
// Run: npx vitest run test/raidmimic-skip-video.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import * as H from '../web/lib/raidmimicHome.ts';

const code = (rel) => stripJs(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const page = code('web/app/raidmimic/page.tsx');
const stage = code('web/app/raidmimic/_landing/StoryStage.tsx');
const panel = code('web/app/raidmimic/_landing/HomeDashboard.tsx');   // the Dashboard replaced the Home panel (option B, 2026-11-09)
const gate = code('web/app/raidmimic/_landing/HomePanelGate.tsx');
const chars = code('web/app/characters/page.tsx');
const mine = code('web/lib/hubMine.ts');

describe('the page: signed out gets the stage, signed in gets the panel', () => {
  it('reads the session, and only a Discord id swaps the video for the panel', () => {
    expect(page).toMatch(/const \{ data: \{ user \} \} = await supabaseServer\(\)\.auth\.getUser\(\);/);
    expect(page).toMatch(/const discordId = discordIdOf\(user\);/);
    expect(page).toMatch(/const signedIn = !!\(user && discordId\);/);
    expect(page).toMatch(/let top = <StoryStage downloadUrl=\{DOWNLOAD_URL\} onHost=\{onHost\} \/>;/);
    expect(page).toMatch(/if \(signedIn\) \{[^]*<HomePanelGate[^]*panel=\{<HomeDashboard [^]*mine=\{mine\} guilds=\{guilds\}/);
  });
  it('signed in, the bar is drawn once, ABOVE the Dashboard; signed out, once under the stage', () => {
    expect(page).toMatch(/\{signedIn && onHost && <div className="mx-auto max-w-5xl"><HostBar \/><\/div>\}\s*\{top\}/);
    expect(page).toMatch(/\{!signedIn && onHost && <HostBar \/>\}/);
    expect(panel).not.toMatch(/HostBar/);
  });
  it('reads no query at all, and no variant or redirect survives', () => {
    expect(page).not.toMatch(/searchParams|\bv === |\?v=|redirect\(|bigSkip/);
    expect(page).toMatch(/export default async function RaidmimicPage\(\)/);
    expect(chars).not.toMatch(/searchParams|doorway|rewatch|\?v=/i);
    expect(chars).toMatch(/from '@\/lib\/hubMine'/);
    expect(chars).not.toMatch(/from\('hub_characters'\)/);
    expect(chars).toMatch(/<h1 className="text-2xl text-gold">/);
    expect(chars).toMatch(/text-text/);
    expect(Object.keys(H).sort()).toEqual(['DASH_WORDS', 'HOME_WORDS', 'REWATCH_HASH', 'SKIP_KEY', 'comingLine', 'toHomeGuilds']);   // no rewatchHref, no preview switch
  });
  it('the shared read pages hub_flags past the 1,000-row cap, ordered on id', () => {
    expect(mine).toMatch(/selectAll</);
    expect(mine).toMatch(/\.order\('id', \{ ascending: true \}\)/);
    expect(mine).toMatch(/hardCap: 20000/);
    expect(mine).toMatch(/\.eq\('discord_id', discordId\)/);
  });
});

describe('the Dashboard (option B, 2026-11-09)', () => {
  it('lists characters, guilds and Mimic, and the coming ideas as one line that is not a link', () => {
    expect(panel).toMatch(/c\.flagCount/);
    expect(panel).toMatch(/charactersHref/);
    expect(panel).toMatch(/guilds\.map/);
    expect(panel).toMatch(/href=\{downloadUrl\}/);
    expect(H.HOME_WORDS.coming).toHaveLength(4);
    expect(H.comingLine()).toBe('Coming: looking for flags or loot · raids that fit your loot system (need before greed, random rolls, DKP) · guilds recruiting your class · help on one character, get flagged on another');
    expect(panel).toMatch(/<p data-coming [^>]*>\{comingLine\(\)\}<\/p>/);
    expect(panel).not.toMatch(/dangerouslySetInnerHTML/);
  });
  it('the built-in guild comes first with its configured site, then hosted guilds', () => {
    expect(H.toHomeGuilds({ key: 'wp', name: 'Wolf Pack' }, [{ guild_id: 'zz', name: 'Zed', site: null }], 'https://wp.example')).toEqual([
      { key: 'wp', name: 'Wolf Pack', site: 'https://wp.example' }, { key: 'zz', name: 'Zed', site: null },
    ]);
    expect(H.toHomeGuilds(null, [], 'https://wp.example')).toEqual([]);
  });
  it('Rewatch reveals the stage in place, and #video in the address does too', () => {
    expect(gate).toMatch(/setStage\(true\)/);
    expect(gate).toMatch(/<StoryStage downloadUrl=\{downloadUrl\} onHost=\{onHost\} \/>/);
    expect(gate).toMatch(/window\.location\.hash === REWATCH_HASH/);
    expect(gate).not.toMatch(/bigSkip/);
  });
});

describe('the big skip on the stage', () => {
  it('sits at the top over the video, is a real button, collapses the stage and remembers it', () => {
    expect(stage).toMatch(/\{!show\.end && \(\s*<button type="button" data-big-skip onClick=\{bigSkipNow\}/);
    expect(stage).toMatch(/top-2 z-50/);
    expect(stage).toMatch(/min-h-12/);
    expect(stage).toMatch(/setItem\(SKIP_KEY, '1'\)/);
    expect(stage).toMatch(/setHidden\(true\)/);
    expect(stage).not.toMatch(/bigSkip\b(?!Now)/);   // no prop: it is always there
    expect(H.HOME_WORDS.skipBig).toBe('Skip video');
  });
  it('every storage access is guarded, and #video beats a remembered skip', () => {
    expect(stage).toMatch(/try \{\s*if \(window\.location\.hash === REWATCH_HASH\) return;/);
    expect(stage).toMatch(/getItem\(SKIP_KEY\) === '1'/);
    expect(stage).toMatch(/try \{ window\.localStorage\.setItem/);
  });
  it('a viewer who skipped before sees the Rewatch link at the top', () => {
    expect(stage).toMatch(/data-rewatch onClick=\{again\}/);
    expect(H.HOME_WORDS.rewatch).toBe('Rewatch the video');
  });
});

describe('rewatch survives a raidmimic host', () => {
  it('is a hash, which never leaves the browser (a raidmimic host drops every query)', () => {
    expect(H.REWATCH_HASH).toBe('#video');
    expect(H.SKIP_KEY).toBe('rm-skipped-video');
  });
});

describe('the stage never draws over the site menu (the guild lead, 2026-11-09: "also not overlap")', () => {
  it('both stage sections isolate their layers, so the z-50 Skip stays inside the stage', () => {
    const src = code('web/app/raidmimic/_landing/StoryStage.tsx');
    const sections = src.match(/<section id="top"[^>]*>/g) ?? [];
    expect(sections.length).toBe(2);
    for (const s of sections) expect(s).toMatch(/\bisolate\b/);
  });
});
