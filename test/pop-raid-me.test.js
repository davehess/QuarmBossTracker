// test/pop-raid-me.test.js — /pop/raid/me, "Your flags for tonight" (the guild lead, 2026-10-26: "people sign up for
// raids as their class, which can be an alt and not their main ... a custom link that shows all of their characters
// and which steps they specifically need to do for theirs if flagging").
//
// The rules are pure (web/lib/raidMe.ts and the two helpers added to web/lib/raidPlan.ts) and run for real here.
// The page and its client box import the framework, so their wiring is read as comment-stripped source (comments
// quote the code and would answer for it).
//
// Run: npx vitest run test/pop-raid-me.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { PLAN, PREFLAGS, eventWhen, loc, pickNextRaidEvent, pickRaidEvent } from '../web/lib/raidPlan.ts';
import {
  DEFAULT_STEP_SOURCE, bringingFrom, chooseCharacters, nextLineSteps, nightSteps, stepSourceFrom, stepsFor, stepsLeft,
} from '../web/lib/raidMe.ts';
import { stepsHeld } from '../web/lib/popSteps.ts';
import { metaForPath } from '../web/lib/pageMeta.ts';

const read = (p) => stripJs(fs.readFileSync(path.join(ROOT, p), 'utf8'));

describe('the next raid night', () => {
  const at = (iso) => ({ id: iso, start_time: iso });
  // Monday 2026-10-26, 11:00 ET.
  const now = new Date('2026-10-26T15:00:00Z');
  const tonight = at('2026-10-27T00:30:00+00:00');      // Mon 20:30 ET
  const wed = at('2026-10-29T00:30:00+00:00');          // Wed 20:30 ET
  const thu = at('2026-10-30T00:30:00+00:00');          // Thu 20:30 ET
  const lastWeek = at('2026-10-22T00:30:00+00:00');

  it('takes today\'s event when there is one', () => {
    expect(pickNextRaidEvent([lastWeek, wed, tonight, thu], now).id).toBe(tonight.id);
  });
  it('takes the earliest later night when today has none, and ignores the past', () => {
    expect(pickNextRaidEvent([thu, lastWeek, wed], now).id).toBe(wed.id);
  });
  it('is null when nothing is scheduled from today on', () => {
    expect(pickNextRaidEvent([lastWeek], now)).toBeNull();
    expect(pickNextRaidEvent([], now)).toBeNull();
  });
  it('counts a day in Eastern time: after midnight ET the raid that began the evening before is over', () => {
    // 2026-10-27T04:30Z is 00:30 ET Tuesday; the Monday-evening event is yesterday by ET (and still "today" by UTC).
    const afterMidnight = new Date('2026-10-27T04:30:00Z');
    expect(pickNextRaidEvent([tonight, wed], afterMidnight).id).toBe(wed.id);
    // ...and an hour into the evening it is still tonight's.
    expect(pickNextRaidEvent([tonight, wed], new Date('2026-10-27T01:30:00Z')).id).toBe(tonight.id);
  });
  it('prefers the evening event over an earlier one on the same day', () => {
    const morning = at('2026-10-26T16:00:00+00:00');    // 12:00 ET
    expect(pickNextRaidEvent([morning, tonight], now).id).toBe(tonight.id);
  });
  it('leaves pickRaidEvent, which /pop/raid reads, as it was', () => {
    expect(pickRaidEvent([at('2026-10-16T00:30:00+00:00'), at('2026-10-15T00:30:00+00:00')]).id).toBe('2026-10-15T00:30:00+00:00');
    expect(pickRaidEvent([at('2026-10-16T00:30:00+00:00')])).toBeNull();
  });
  it('writes the start in Eastern time', () => {
    expect(eventWhen('2026-10-29T00:30:00+00:00')).toBe('Wed Oct 28 · 8:30 pm ET');
  });
});

describe('the step list', () => {
  const held = (...keys) => stepsHeld(keys);

  it('lists the night\'s preflags in order, done when held (a later step of a series counts for the earlier ones)', () => {
    const steps = nightSteps(held('fuirstel_2', 'thelin_2'));
    expect(steps.map(s => s.key)).toEqual(PREFLAGS.map(p => p.key));
    const done = Object.fromEntries(steps.map(s => [s.key, s.done]));
    expect(done).toEqual({ fuirstel_1: true, poi_door_1: false, zeks_1: false, thelin_1: true, thelin_2: true, mavuin_3: false });
    expect(stepsLeft(steps)).toBe(3);
  });
  it('a character holding nothing has every step to do; one holding all has none', () => {
    expect(stepsLeft(nightSteps(new Set()))).toBe(PREFLAGS.length);
    expect(stepsLeft(nightSteps(new Set(PREFLAGS.map(p => p.key))))).toBe(0);
  });
  it('gives /loc as Y then X, the same place the plan\'s own text names', () => {
    const steps = Object.fromEntries(nightSteps(new Set()).map(s => [s.key, s]));
    expect(steps.fuirstel_1.loc).toBe(loc(-1467, 1786));
    expect(steps.fuirstel_1.loc).toBe('/loc 1786, -1467');
    // Anything the page prints as a place is a place the plan itself prints (the preflag's `why`, or a section's
    // `before` lines), so a coordinate cannot be mistyped here without this failing.
    const plan = JSON.stringify([PREFLAGS, PLAN]);
    for (const s of Object.values(steps)) {
      if (s.loc) expect(plan, s.key).toContain(s.loc);
    }
    expect(steps.zeks_1.loc).toBe('/loc -52, 49');
    expect(steps.thelin_2.loc).toBe('/loc 1104, -1519');
    // A step the plan gives no place for has none: nothing is invented.
    expect(steps.poi_door_1.loc).toBeNull();
    expect(steps.mavuin_3.loc).toBeNull();
  });
  it('gives the words to say, in the order the plan says them', () => {
    const steps = Object.fromEntries(nightSteps(new Set()).map(s => [s.key, s]));
    expect(steps.fuirstel_1.say).toEqual(['ward']);
    expect(steps.zeks_1.say).toEqual(['great warrior', 'task', 'test the machine']);
    expect(steps.thelin_1.say).toEqual(['tortured by nightmares']);
    expect(steps.poi_door_1.say).toEqual([]);
  });

  it('the other source reads each line: finished, something to do, or waiting on a gate', () => {
    const rows = nextLineSteps([
      { line: 'a', label: 'Line A', short: 'A', state: 'done', steps: [], blockedOn: [], skipped: [], done: 2, total: 2 },
      { line: 'b', label: 'Line B', short: 'B', state: 'next', blockedOn: [], skipped: [], done: 0, total: 2,
        steps: [{ key: 'step_one', title: 'Hail Aldenmar', who: 'solo', must: true, flag: null, flagLabel: null, zone: 'Tranquility', verify: false }] },
      { line: 'c', label: 'Line C', short: 'C', state: 'blocked', steps: [], skipped: [], done: 0, total: 1,
        blockedOn: [{ flag: 'x', label: 'the Justice flag', line: null, lineLabel: null, lineShort: null }] },
    ]);
    expect(rows.map(r => [r.key, r.done])).toEqual([['line:a', true], ['step_one', false], ['line:c', false]]);
    expect(rows[1]).toMatchObject({ label: 'Hail Aldenmar', target: 'Line B', note: 'Tranquility' });
    expect(rows[2].note).toBe('Waiting on the Justice flag');
  });
  it('stepsFor picks the source, and the night is the default', () => {
    expect(DEFAULT_STEP_SOURCE).toBe('night');
    const planNight = '2026-10-15T00:30:00Z';   // Wed 2026-10-14 8:30 pm ET, the night PLAN was written for
    expect(stepSourceFrom(undefined, planNight)).toBe('night');
    expect(stepSourceFrom('next', planNight)).toBe('next');
    expect(stepSourceFrom(['next', 'next'], planNight)).toBe('night');
    // Any other night, or no event: the old plan must not read as tonight's.
    expect(stepSourceFrom(undefined, '2026-10-29T00:30:00Z')).toBe('next');
    expect(stepSourceFrom(undefined, null)).toBe('next');
    const none = new Set();
    expect(stepsFor('night', none).map(s => s.key)).toEqual(PREFLAGS.map(p => p.key));
    // The engine's steps, not the preflags: a character with no flags has something to do on at least one line.
    const next = stepsFor('next', none);
    expect(next.length).toBeGreaterThan(0);
    expect(next.some(s => PREFLAGS.some(p => p.key === s.key))).toBe(false);
    expect(stepsLeft(next)).toBeGreaterThan(0);
  });
});

describe('which character a sign-up brings', () => {
  const owned = [
    { name: 'Zarrin', class: 'Druid', main_name: 'Zarrin', active: false, rank: 'Raid Pack', hidden_from_lists: null },
    { name: 'Nyssara', class: 'Wizard', main_name: 'Zarrin', active: true, rank: 'Raid Alt', hidden_from_lists: null },
    { name: 'Brackwyn', class: 'Shadow Knight', main_name: 'Zarrin', active: true, rank: 'Raid Alt', hidden_from_lists: null },
  ];
  const yes = (class_name) => ({ status: 'primary', class_name });

  it('brings the alt of the class they signed up as, not the main', () => {
    expect(bringingFrom(owned, yes('Wizard')).name).toBe('Nyssara');
  });
  it('reads Raid-Helper\'s "Shadowknight" as the Shadow Knight', () => {
    expect(bringingFrom(owned, yes('Shadowknight')).name).toBe('Brackwyn');
  });
  it('falls back to the main when the class matches nobody', () => {
    expect(bringingFrom(owned, yes('Bard')).name).toBe('Zarrin');
  });
  it('brings no one without a sign-up, or on one that is not a yes', () => {
    expect(bringingFrom(owned, null)).toBeNull();
    expect(bringingFrom(owned, { status: 'absent', class_name: 'Wizard' })).toBeNull();
    expect(bringingFrom(owned, { status: 'primary', class_name: 'Tentative' })).toBeNull();
    expect(bringingFrom(owned, { status: 'bench', class_name: null })).toBeNull();
  });
  it('brings no one when they have no characters', () => {
    expect(bringingFrom([], yes('Wizard'))).toBeNull();
  });
});

describe('which characters are listed', () => {
  const base = { active: true, hidden_from_lists: null };
  const owned = [
    { name: 'Corvale', class: 'Cleric', main_name: 'Aldenmar', rank: 'Raid Alt', ...base },
    { name: 'Aldenmar', class: 'Shaman', main_name: 'Aldenmar', rank: 'Raid Pack', ...base },
    { name: 'Rethlan', class: 'Rogue', main_name: 'Aldenmar', rank: 'Trader', ...base },
    { name: 'Nyssara', class: 'Wizard', main_name: 'Aldenmar', rank: 'Raid Alt', ...base },
    { name: 'Zarrin', class: 'Bard', main_name: 'Aldenmar', rank: 'Raid Alt', ...base, hidden_from_lists: true },
    { name: 'Brackwyn', class: 'Monk', main_name: 'Aldenmar', rank: 'Raid Alt', ...base },
  ];
  const levels = new Map([['aldenmar', 65], ['corvale', 60], ['nyssara', 30], ['rethlan', 65], ['zarrin', 65]]);
  const names = (list) => list.map(c => c.name);

  it('hides traders, hidden characters and characters under the floor; keeps ones with no known level; main first', () => {
    // Brackwyn has no level at all: not proof of a low one, so it stays.
    expect(names(chooseCharacters(owned, levels, null))).toEqual(['Aldenmar', 'Brackwyn', 'Corvale']);
  });
  it('keeps the character the sign-up brings even when the floor would hide it', () => {
    const shown = chooseCharacters(owned, levels, 'Nyssara');
    expect(names(shown)).toContain('Nyssara');
    expect(shown.filter(c => c.bringing).map(c => c.name)).toEqual(['Nyssara']);
    expect(names(shown)).not.toContain('Rethlan');
  });
  it('matches the bringing name without regard to case', () => {
    expect(chooseCharacters(owned, levels, 'nyssara').find(c => c.name === 'Nyssara').bringing).toBe(true);
  });
  it('shows everyone when every one would be hidden, rather than an empty page', () => {
    const lows = owned.map(c => ({ ...c, rank: 'Trader' }));
    expect(chooseCharacters(lows, levels, null)).toHaveLength(owned.length);
  });
  it('carries class, level and main/alt for the cards', () => {
    const shown = chooseCharacters(owned, levels, null);
    expect(shown[0]).toEqual({ name: 'Aldenmar', cls: 'Shaman', level: 65, isMain: true, bringing: false });
    expect(shown.find(c => c.name === 'Corvale')).toMatchObject({ level: 60, isMain: false });
    expect(shown.find(c => c.name === 'Brackwyn').level).toBeNull();
  });
});

describe('the page and its wiring (stripped source)', () => {
  const page = read('web/app/pop/raid/me/page.tsx');
  const tools = read('web/app/pop/raid/me/MeTools.tsx');
  const raidPage = read('web/app/pop/raid/page.tsx');
  const load = read('web/lib/raidMeLoad.ts');

  it('is members only, dynamic, and carries the beta tag', () => {
    expect(page).toMatch(/redirect\('\/auth\/signin\?next=\/pop\/raid\/me'\)/);
    expect(page).toMatch(/dynamic = 'force-dynamic'/);
    expect(page).toMatch(/<NewPageTag/);
  });
  it('unfurls under its own name', () => {
    expect(metaForPath('/pop/raid/me').title).toBe('[beta] Your flags for tonight');
    expect(page).toMatch(/title: '\[beta\] Your flags for tonight'/);
  });
  it('reads the member\'s own characters and what each holds with the readers /pop and /pop/raid use', () => {
    expect(page).toMatch(/ownedCharacters\(user\.id\)/);
    expect(page).toMatch(/loadLevels\(/);
    expect(page).toMatch(/loadHeld\(shown\.map\(c => c\.name\)\)/);
    expect(page).toMatch(/bringingFrom\(owned, night\.signup\)/);
    expect(page).toMatch(/chooseCharacters\(owned, levels, bringing\?\.name \?\? null\)/);
  });
  it('finds the sign-up for the next event by the member\'s Discord id, paged, and counts only a yes', () => {
    expect(load).toMatch(/pickNextRaidEvent\(/);
    expect(load).toMatch(/from\('rh_signups'\)/);
    expect(load).toMatch(/\.in\('discord_id', ids\)/);
    expect(load).toMatch(/selectAll</);
    expect(load).toMatch(/NOT_GOING\.test\(String\(r\.status \|\| ''\)\)/);
  });
  it('reuses the Seer paste and adds no parser of its own', () => {
    expect(tools).toMatch(/import SeerPaste from '@\/app\/pop\/guide\/SeerPaste'/);
    expect(tools).not.toMatch(/parseRecital|popRecital/);
  });
  it('leaves the #popflags tab and the log sync as disabled, clearly marked slots', () => {
    expect(tools).toMatch(/data-slot="popflags-output"/);
    expect(tools).toMatch(/#popflags output/);
    const popflags = tools.slice(tools.indexOf('data-slot="popflags-output"'));
    expect(popflags).toMatch(/<textarea disabled/);
    expect(popflags).toMatch(/<button type="button" disabled/);
    expect(tools).toMatch(/<button type="button" disabled title="Coming next: read your flags straight from your logs"/);
    expect(tools).toMatch(/Sync from my logs/);
  });
  it('is linked from the raid night plan and the checklist', () => {
    expect(raidPage).toMatch(/href="\/pop\/raid\/me"/);
    expect(read('web/app/pop/guide/page.tsx')).toMatch(/href="\/pop\/raid\/me"/);
  });
  it('leaves the checklist\'s Seer box closed and unchanged unless asked', () => {
    const box = read('web/app/pop/guide/SeerPaste.tsx');
    expect(box).toMatch(/defaultOpen \? \{ open: true \} : \{\}/);
    expect(read('web/app/pop/guide/GuideChecklist.tsx')).toMatch(/<SeerPaste character=\{char\?\.name \?\? null\} onResult=\{setSeer\} \/>/);
  });
});
