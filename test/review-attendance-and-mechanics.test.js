// test/review-attendance-and-mechanics.test.js — the raid review for nights
// before the agent existed, and mechanics grouped by the fight they hit
// (Hitya, 2026-09-04: "the early raids have very limited data … at least have
// the bosses killed" · "its just a line of asphyxiate and not who it landed
// on. We should group these by boss").
//
// What Supabase holds for a 2024 night is OpenDKP's ticks, loot, and the
// raid's NAME — nothing else. So attendance is the record, and the raid name
// stands in for the bosses. Mechanics: `encounter_events` fire rows carry no
// target, so the victim is a death within a few seconds of the fire, named
// beside it under the boss it landed on.
//
// Stripped-source assertions.
//
// Run: npx vitest run test/review-attendance-and-mechanics.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';

const read = (...p) => stripJs(fs.readFileSync(path.join(ROOT, 'web', ...p), 'utf8'));
const night = read('app', 'raid', 'review', '[date]', 'page.tsx');
const index = read('app', 'raid', 'review', 'page.tsx');

describe('attendance on a night page', () => {
  it('comes from OpenDKP: official raids whose NIGHT is the date, read ±3 days around the stamp', () => {
    expect(night).toMatch(/\.gte\('ts', `\$\{addDays\(date, -3\)\}T00:00:00Z`\)/);
    expect(night).toMatch(/\.filter\(r => isOfficialRaid\(r\.name\) && raidNightKey\(r, RAID_TZ\) === date\)/);
    expect(night).toMatch(/selectAll<NightTick>/);
    expect(night).toMatch(/const valid = ticks\.filter\(t => Array\.isArray\(t\.attendees\) && t\.attendees\.length > 0\);/);
  });

  it('renders the raid name, raiders by class, the zone, and a collapsible roster', () => {
    expect(night).toMatch(/Raid &amp; attendance/);
    expect(night).toMatch(/\{attendance\.raids\.join\(' · '\)\}/);
    expect(night).toMatch(/classByName\.get\(name\.toLowerCase\(\)\) \|\| 'Unknown class'/);
    expect(night).toMatch(/Who was there/);
    expect(night).toMatch(/\.from\('raid_nights'\)/);
  });

  it('a night with attendance but no parses says so instead of "nothing recorded"', () => {
    expect(night).toMatch(/No parses were uploaded for this night/);
  });
});

describe('mechanics grouped by fight', () => {
  it('assigns each fire to the fight whose span holds it, folds by label, names deaths within the window', () => {
    expect(night).toMatch(/const fightFor = \(t: number\): EncRow \| null =>/);
    expect(night).toMatch(/const MECH_VICTIM_BEFORE_MS = 2000;/);
    expect(night).toMatch(/const MECH_VICTIM_AFTER_MS = 8000;/);
    expect(night).toMatch(/if \(dt >= -MECH_VICTIM_BEFORE_MS && dt <= MECH_VICTIM_AFTER_MS && !row\.victims\.includes\(d\.name\)\) row\.victims\.push\(d\.name\);/);
    expect(night).toMatch(/const pool = enc \? \(deathsByEnc\.get\(enc\.id\) \?\? \[\]\) : playerDeaths;/);
  });

  it('renders per fight, Death Touch first, and no longer as one flat list', () => {
    expect(night).toMatch(/\{mechGroups\.map\(g => \(/);
    expect(night).toMatch(/g\.rows\.sort\(\(a, b\) => Number\(b\.isDt\) - Number\(a\.isDt\)/);
    expect(night).not.toMatch(/\{fireMarks\.map\(\(f, i\) =>/);
    expect(night).toMatch(/a name is a death within 8s of the fire/);
  });
});

describe('the review index', () => {
  it('lists OpenDKP nights with no parses, with the raid name and raider count', () => {
    expect(index).toMatch(/dkpByDate\.set\(n\.date, \{ raidNames: nightNames\(n\), raiders: n\.attendees\.length \}\);/);
    expect(index).toMatch(/if \(!byNight\.has\(n\.date\)\) byNight\.set\(n\.date, \{ kills: 0,/);
    expect(index).toMatch(/'no parses'/);
    expect(index).toMatch(/\{n\.raiders\} raiders/);
    expect(index).toMatch(/selectAll<NightRaid>/);
  });
});
