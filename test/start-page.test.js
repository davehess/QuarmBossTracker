// /start — the install walkthrough, and the landing page's one call to action.
//
// The page is DOWNSTREAM of two other surfaces: the Discord walkthrough in
// commands/parsehelp.js (which is the guide of record) and the actual button in
// apps/mimic/settings.html. It quotes their button names verbatim so a reader
// can match what they see on screen. Rename one of those buttons and this page
// starts confidently telling people to click something that no longer exists —
// which no type checker, build, or browser can notice.
//
// So the assertions below are cross-file: every label /start puts in front of a
// user must still exist in the surface it was copied from.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
// ⚠ Strip whole-line comments before asserting. This page's own header comment
// explains which warnings it carries and why — and it satisfied the assertion
// for one of them while the warning itself had been edited away. That is the
// third time a comment has stood in for the code it describes in this repo.
// Whole-line only, so `https://` inside a string survives.
import { stripJs as strip } from './_source-slice.js';

const start = strip(read('web/app/start/page.tsx'));
const landing = strip(read('web/app/page.tsx'));
const parsehelp = read('commands/parsehelp.js');
const settings = read('apps/mimic/settings.html');

describe('/start install walkthrough', () => {
  it('is what "Run with us." points at', () => {
    const cta = landing.match(/href="\/start"[\s\S]{0,600}?<\/Link>/);
    expect(cta, '"Run with us." must link to /start').toBeTruthy();
    expect(cta[0]).toContain('Run with us.');
  });

  it('stays public — the person reading it does not have an account yet', () => {
    // The whole point of the page is to be readable before you have signed in.
    expect(start).not.toMatch(/redirect\(['"]\/auth\/signin/);
    expect(start).not.toMatch(/getSessionUser|supabaseServer/);
  });

  it.each([
    'Step 1 · Sign in with Discord',
    'Step 2 · Your EverQuest folder',
    '📁 Browse for your EverQuest folder…',
    'Save folder',
    'Open dashboard',
  ])('quotes "%s" exactly as the Discord walkthrough does', label => {
    expect(start, `/start should tell people to click ${label}`).toContain(label);
    expect(parsehelp, `${label} no longer exists in commands/parsehelp.js`).toContain(label);
  });

  it.each(['🔧 Set up EQ for me', 'Log=TRUE', 'ExportOnCamp', 'PipeDelay', 'PipeVerbose'])(
    'quotes "%s" exactly as Mimic\'s Settings screen does',
    label => {
      expect(start).toContain(label);
      expect(settings, `${label} no longer exists in apps/mimic/settings.html`).toContain(label);
    },
  );

  it('warns to close EverQuest first, because the game undoes the change', () => {
    // eqclient.ini is rewritten on exit, so setup done while EQ is open is lost.
    expect(start).toMatch(/Close EverQuest first/i);
    expect(settings).toMatch(/Close EverQuest first/i);
  });

  it.each([
    ['/mimic?direct=1', 'web/app/mimic/route.ts'],
    ['/mimic/beta?direct=1', 'web/app/mimic/beta/route.ts'],
    ['/mimic/linux?direct=1', 'web/app/mimic/linux/route.ts'],
  ])('deep-links %s, and that route exists', (href, route) => {
    expect(start).toContain(href);
    expect(fs.existsSync(path.join(ROOT, route)), `${route} is missing`).toBe(true);
    // ?direct=1 is what makes the button a one-click install rather than a
    // detour through a GitHub releases page.
    expect(read(route)).toContain("'direct'");
  });

  it('leads with the compatibility-mode fix, which is the first thing to ask', () => {
    // Three different causes all present as "Zeal isn't working"; this one has a
    // popular checklist actively recommending the setting that breaks it.
    const trouble = start.slice(start.indexOf('If something is off'));
    expect(trouble).toMatch(/EPERM/);
    expect(trouble).toMatch(/compatibility mode/i);
    expect(trouble.indexOf('EPERM')).toBeLessThan(trouble.indexOf('outside'));
  });
});
