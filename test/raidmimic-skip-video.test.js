// test/raidmimic-skip-video.test.js — the raidmimic landing's two skip-video previews (the guild lead, 2026-11-09: "a big skip
// video button at the top ... users log into it and have their information come up on the homepage or redirect instead of hitting
// the video ... a link 'rewatch the video' up top"). ?v=b "Doorway" and ?v=c "Home panel" are read on b.wolfpack.quest only.
// Pins: the default (no v) path is the current stage with no auth call; b redirects a signed-in visitor; c renders the panel
// with honest "coming" placeholders; the big skip exists in both; the rewatch survives a raidmimic host's query drop (a hash).
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
const panel = code('web/app/raidmimic/_landing/HomePanel.tsx');
const gate = code('web/app/raidmimic/_landing/HomePanelGate.tsx');
const chars = code('web/app/characters/page.tsx');

describe('the default path (no ?v=) is today\'s page', () => {
  it('renders the plain stage, and the preview branch is the only code that reads auth', () => {
    expect(page).toMatch(/let top = <StoryStage downloadUrl=\{DOWNLOAD_URL\} onHost=\{onHost\} \/>;/);
    const afterDefault = page.slice(page.indexOf('let top ='));
    const guard = afterDefault.indexOf('if (v) {');
    expect(guard).toBeGreaterThan(0);
    expect(afterDefault.indexOf('auth.getUser()')).toBeGreaterThan(guard);
  });
  it('accepts only b and c as v', () => {
    expect(page).toMatch(/searchParams\?\.v === 'b' \|\| searchParams\?\.v === 'c'/);
  });
  it('the stage without bigSkip draws no big skip and stores nothing', () => {
    expect(stage).toMatch(/bigSkip = false/);
    expect(stage).toMatch(/\{bigSkip && !show\.end && \(/);
    expect(stage).toMatch(/if \(!bigSkip\) return;/);
  });
});

describe('b "Doorway"', () => {
  it('redirects a signed-in visitor to /characters unless the rewatch link asked for the video', () => {
    expect(page).toMatch(/v === 'b' && searchParams\?\.video !== '1'\) redirect\('\/characters\?v=b'\)/);
  });
  it('a signed-out visitor gets the stage with the big skip', () => {
    const preview = page.slice(page.indexOf('if (v) {'));
    expect(preview).toMatch(/top = <StoryStage[^>]*bigSkip \/>;/);
    expect(preview.indexOf('bigSkip')).toBeLessThan(preview.indexOf('redirect('));
  });
  it('/characters carries a Rewatch link only under ?v=b', () => {
    expect(chars).toMatch(/searchParams\?\.v === 'b'/);
    expect(chars).toMatch(/\{doorway && \(/);
    expect(chars).toMatch(/rewatchHref\(onHost\)/);
  });
});

describe('c "Home panel"', () => {
  it('shows the panel (with the shared read) in place of the video for a signed-in visitor', () => {
    expect(page).toMatch(/v === 'c'\) top = <HomePanelGate[^]*<HomePanel mine=\{await loadMine\(discordId\)\}/);
    expect(chars).toMatch(/from '@\/lib\/hubMine'/);
    expect(chars).not.toMatch(/from\('hub_characters'\)/);
  });
  it('lists characters, a /characters link and four coming placeholders that are not links', () => {
    expect(panel).toMatch(/c\.flagCount/);
    expect(panel).toMatch(/c\.next\.top\[0\]/);
    expect(panel).toMatch(/RAIDMIMIC_CHARACTERS_PATH/);
    expect(H.HOME_WORDS.coming).toHaveLength(4);
    expect(H.HOME_WORDS.coming.join(' ')).toMatch(/Looking for flags or loot/);
    expect(panel).toMatch(/data-coming/);
    expect(panel).toMatch(/>coming</);
    const coming = panel.slice(panel.indexOf('H.coming.map'));
    expect(coming).not.toMatch(/<a |<button|onClick/);
    expect(panel).not.toMatch(/dangerouslySetInnerHTML/);
  });
  it('Rewatch reveals the stage in place', () => {
    expect(gate).toMatch(/setStage\(true\)/);
    expect(gate).toMatch(/<StoryStage[^>]*bigSkip/);
  });
});

describe('the big skip, in both', () => {
  it('sits at the top over the video, is a real button, collapses the stage and remembers it', () => {
    expect(stage).toMatch(/<button type="button" data-big-skip onClick=\{bigSkipNow\}/);
    expect(stage).toMatch(/top-2 z-50/);
    expect(stage).toMatch(/min-h-12/);
    expect(stage).toMatch(/setItem\(SKIP_KEY, '1'\)/);
    expect(stage).toMatch(/setHidden\(true\)/);
    expect(H.HOME_WORDS.skipBig).toBe('Skip video');
  });
  it('every storage access is guarded, and #video beats a remembered skip', () => {
    expect(stage).toMatch(/try \{\s*if \(window\.location\.hash === REWATCH_HASH\) return;/);
    expect(stage).toMatch(/try \{ window\.localStorage\.setItem/);
  });
  it('a viewer who skipped before sees the Rewatch link at the top', () => {
    expect(stage).toMatch(/data-rewatch onClick=\{again\}/);
    expect(H.HOME_WORDS.rewatch).toBe('Rewatch the video');
  });
});

describe('rewatch survives a raidmimic host', () => {
  it('uses a hash on the host (queries are dropped there) and a path plus video=1 plus the hash on Wolf Pack hosts', () => {
    expect(H.rewatchHref(true)).toBe('/#video');
    expect(H.rewatchHref(false)).toBe('/raidmimic?video=1#video');
  });
});
