// test/guild-settings.test.js — per-guild settings (the guild lead, 2026-11-12): the rules in web/lib/guildSettings.ts, the
// migration's Wolf Pack seed, the schedule helpers across DST, midnight and three zones, and the wiring of the settings page.
//
// ⚠ Source-text assertions strip whole-line comments first (CLAUDE.md, "comments satisfy text assertions"): these files' headers
// name the things asserted on.
//
// Run: npx vitest run test/guild-settings.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, stripJs, stripSql } from './_source-slice.js';
import {
  DEFAULT_SETTINGS, WOLFPACK_SEED, mergeSettings, validateSettings, hasJob, entriesMatch, nextRaid, inRaidWindow,
  nextRaidLine, relativeTime, formatInZone, ROLE_TIERS, JOBS,
} from '../web/lib/guildSettings.ts';
import { metaForPath } from '../web/lib/pageMeta.ts';

const require = createRequire(import.meta.url);
const tzu = require('../utils/timezone.js');

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const H = 3_600_000;
const sched = (over = {}) => ({ ...DEFAULT_SETTINGS.schedule, days: [5], start: '20:00', end: '23:00', planEnd: '23:00', ...over });

describe('mergeSettings: stored data made safe', () => {
  it('anything that is not an object reads as the defaults, and never throws', () => {
    for (const bad of [undefined, null, 5, 'x', [], true, () => 1]) expect(mergeSettings(bad)).toEqual(DEFAULT_SETTINGS);
    const hostile = { get schedule() { throw new Error('boom'); } };
    expect(() => mergeSettings(hostile)).not.toThrow();
    expect(mergeSettings(hostile)).toEqual(DEFAULT_SETTINGS);
  });
  it('keeps what is valid and defaults what is not, field by field', () => {
    const m = mergeSettings({ schedule: { tz: 'Not/AZone', days: [1, 9], start: '21:15', end: 'late' }, guests: { allow: true, passHours: 'many' }, dkp: { provider: 'opendkp', pool: 'x' } });
    expect(m.schedule.tz).toBe('UTC');
    expect(m.schedule.days).toEqual([]);
    expect(m.schedule.start).toBe('21:15');
    expect(m.schedule.end).toBe('23:00');
    expect(m.guests).toEqual({ allow: true, passHours: 6 });
    expect(m.dkp.provider).toBe('opendkp');
    expect(m.dkp.pool).toBeNull();
  });
  it('returns a copy: changing the result cannot change the defaults', () => {
    const m = mergeSettings(undefined);
    m.schedule.days.push(3);
    m.roles.leader.push('X');
    expect(DEFAULT_SETTINGS.schedule.days).toEqual([]);
    expect(DEFAULT_SETTINGS.roles.leader).toEqual([]);
  });
  it('the Wolf Pack seed survives a merge unchanged', () => {
    expect(mergeSettings(WOLFPACK_SEED)).toEqual(WOLFPACK_SEED);
  });
});

describe('validateSettings: what an officer typed', () => {
  const ok = (input) => { const r = validateSettings(input); expect(r.ok, JSON.stringify(r)).toBe(true); return r.values; };
  const bad = (input) => { const r = validateSettings(input); expect(r.ok).toBe(false); return r.errors; };

  it('accepts the seed and an empty object', () => {
    expect(ok(WOLFPACK_SEED)).toEqual(WOLFPACK_SEED);
    expect(ok({})).toEqual(DEFAULT_SETTINGS);
    expect(validateSettings(undefined).ok).toBe(true);
  });
  it('names every wrong field by path', () => {
    const e = bad({ schedule: { tz: 'Mars/Base', days: [7], start: '25:00', end: '9pm', planEnd: '' }, dkp: { provider: 'gold' }, guests: { passHours: 0 }, links: { website: 'http://x.example', discordInvite: 'https://example.com/a' } });
    for (const k of ['schedule.tz', 'schedule.days', 'schedule.start', 'schedule.end', 'schedule.planEnd', 'dkp.provider', 'guests.passHours', 'links.website', 'links.discordInvite']) expect(e[k], k).toBeTruthy();
  });
  it('a raid cannot start and end at the same minute', () => {
    expect(bad({ schedule: { start: '20:00', end: '20:00' } })['schedule.end']).toBeTruthy();
  });
  it('days are de-duplicated and sorted', () => {
    expect(ok({ schedule: { days: [4, 0, 4, 3] } }).schedule.days).toEqual([0, 3, 4]);
  });
  it('role lists take a comma string or an array, collapse duplicates in any case, and trim', () => {
    const v = ok({ roles: { officer: ' Officer , officer,  Raid  Lead ' }, jobs: { loot: ['Looter', 'LOOTER'] } });
    expect(v.roles.officer).toEqual(['Officer', 'Raid Lead']);
    expect(v.jobs.loot).toEqual(['Looter']);
  });
  it('a number is a Discord role id (17 to 20 digits); a short one is refused, a long name is refused', () => {
    expect(ok({ roles: { leader: ['123456789012345678'] } }).roles.leader).toEqual(['123456789012345678']);
    expect(bad({ roles: { leader: ['12345'] } })['roles.leader']).toBeTruthy();
    expect(bad({ roles: { leader: ['x'.repeat(65)] } })['roles.leader']).toBeTruthy();
    expect(bad({ roles: { leader: Array.from({ length: 21 }, (_, i) => `Role ${i}`) } })['roles.leader']).toBeTruthy();
    expect(bad({ roles: { leader: [5] } })['roles.leader']).toBeTruthy();
  });
  it('DKP: the OpenDKP fields are checked only when OpenDKP is chosen, and none resets them', () => {
    expect(ok({ dkp: { provider: 'none', pool: 'junk', client: '!!' } }).dkp).toEqual(DEFAULT_SETTINGS.dkp);
    const e = bad({ dkp: { provider: 'opendkp', client: '!', pool: 0, ticksPerNight: 99, bidMin: 10, bidMax: 5, auctionMinutes: 0 } });
    for (const k of ['dkp.client', 'dkp.pool', 'dkp.ticksPerNight', 'dkp.bidMax', 'dkp.auctionMinutes']) expect(e[k], k).toBeTruthy();
    expect(ok({ dkp: { provider: 'opendkp', client: 'My-Guild', pool: null } }).dkp.client).toBe('my-guild');
  });
  it('links: https only, a Discord invite must be on Discord', () => {
    expect(ok({ links: { discordInvite: 'https://discord.gg/abc', website: 'https://guild.example/x' } }).links.discordInvite).toBe('https://discord.gg/abc');
    expect(ok({ links: { discordInvite: 'https://discord.com/invite/abc' } }).links.discordInvite).toBe('https://discord.com/invite/abc');
    expect(bad({ links: { website: 'javascript:alert(1)' } })['links.website']).toBeTruthy();
    expect(bad({ links: { website: 'https://u:p@guild.example' } })['links.website']).toBeTruthy();
  });
  it('a non-object, and a hostile one, are errors rather than throws', () => {
    expect(bad('x')._).toBeTruthy();
    expect(() => validateSettings({ get schedule() { throw new Error('boom'); } })).not.toThrow();
  });
});

describe('the Wolf Pack seed equals the migration', () => {
  const sql = stripSql(read('supabase', 'migrations', '20261112130000_guild_settings.sql'));
  it('the jsonb literal in the migration is WOLFPACK_SEED', () => {
    const m = sql.match(/'wolfpack',\s*\n\s*'(\{.*\})'::jsonb/);
    expect(m, 'seed literal not found').not.toBeNull();
    expect(JSON.parse(m[1])).toEqual(WOLFPACK_SEED);
  });
  it('the table is server-only and idempotent, like guild_theme', () => {
    expect(sql).toMatch(/create table if not exists public\.guild_settings/i);
    expect(sql).toMatch(/alter table public\.guild_settings enable row level security/i);
    expect(sql).toMatch(/revoke all on public\.guild_settings from anon, authenticated/i);
    expect(sql).toMatch(/on conflict \(guild_id\) do nothing/i);
    expect(JSON.parse(read('scripts', 'guild-tables.json')).tables).toContain('guild_settings');
  });
  it('the slug check drops only the wolfpack exclusion, and Wolf Pack gets a registry row that cannot be limited', () => {
    expect(sql).toMatch(/drop constraint if exists hub_guilds_slug_shape/i);
    expect(sql).toMatch(/check \(guild_id ~ '\^\[a-z0-9\]\[a-z0-9-\]\{1,22\}\[a-z0-9\]\$'\)/);
    expect(sql).not.toMatch(/<>\s*'wolfpack'/);
    expect(sql).toMatch(/insert into public\.hub_guilds[^;]*'wolfpack', 'Wolf Pack', 'managed', false, '1168893924329402420'/i);
  });
  it('creating a guild named wolfpack is still refused by the app', async () => {
    const { RESERVED_SLUGS } = await import('../web/lib/hubGuilds.ts');
    expect(RESERVED_SLUGS).toContain('wolfpack');
  });
});

describe('schedule: the Wolf Pack seed reproduces utils/timezone.js isInRaidWindow', () => {
  // Quarter-hour samples through the week of the spring-forward (2026-03-08) and the fall-back (2026-11-01), plus a plain week.
  for (const [label, from] of [['spring forward', Date.UTC(2026, 2, 5)], ['fall back', Date.UTC(2026, 9, 29)], ['summer', Date.UTC(2026, 6, 6)]]) {
    it(`agrees at every quarter hour, ${label}`, () => {
      let inside = 0;
      for (let t = from; t < from + 8 * 24 * H; t += H / 4) {
        const mine = inRaidWindow(WOLFPACK_SEED.schedule, t);
        expect(mine, new Date(t).toISOString()).toBe(tzu.isInRaidWindow(t, 'America/New_York'));
        if (mine) inside++;
      }
      expect(inside).toBeGreaterThan(20);   // not a vacuous pass: three raid nights of twelve quarter hours
    });
  }
  it('the edges: 20:30 Eastern is in, 20:29 and 23:30 are out', () => {
    const at = (h, m) => Date.UTC(2026, 10, 4, h + 5, m);   // Wed 2026-11-04 evening, EST
    expect(inRaidWindow(WOLFPACK_SEED.schedule, at(20, 30))).toBe(true);
    expect(inRaidWindow(WOLFPACK_SEED.schedule, at(20, 29))).toBe(false);
    expect(inRaidWindow(WOLFPACK_SEED.schedule, at(23, 29))).toBe(true);
    expect(inRaidWindow(WOLFPACK_SEED.schedule, at(23, 30))).toBe(false);
  });
  it('nextRaid gives start, end and plan-to with the zone offset in force that day', () => {
    // Sunday 2026-03-08 is the day the clocks go forward at 02:00: the evening raid is EDT, UTC-4.
    const w = nextRaid(WOLFPACK_SEED.schedule, Date.UTC(2026, 2, 8, 12));
    expect(w.startMs).toBe(Date.UTC(2026, 2, 9, 0, 30));
    expect(w.endMs - w.startMs).toBe(3 * H);
    expect(w.planEndMs - w.startMs).toBe(4 * H);   // plans run to 00:30
    // Sunday 2026-11-01 the clocks go back: EST, UTC-5.
    expect(nextRaid(WOLFPACK_SEED.schedule, Date.UTC(2026, 10, 1, 12)).startMs).toBe(Date.UTC(2026, 10, 2, 1, 30));
  });
  it('a raid in progress is returned until it ends, then the next one', () => {
    const during = nextRaid(WOLFPACK_SEED.schedule, Date.UTC(2026, 10, 5, 2, 0));   // Wed 21:00 EST
    expect(during.startMs).toBe(Date.UTC(2026, 10, 5, 1, 30));
    const after = nextRaid(WOLFPACK_SEED.schedule, during.endMs);
    expect(after.startMs).toBe(Date.UTC(2026, 10, 6, 1, 30));   // Thursday
  });
});

describe('schedule: an end past midnight, DST in the middle, and three zones', () => {
  it('a raid ending after midnight is in window on the next calendar day, and not a minute past its end', () => {
    const s = sched({ tz: 'UTC', days: [5], start: '22:00', end: '01:00', planEnd: '01:30' });
    const fri = Date.UTC(2026, 5, 5);   // a Friday
    expect(inRaidWindow(s, fri + 21 * H + 59 * 60_000)).toBe(false);
    expect(inRaidWindow(s, fri + 22 * H)).toBe(true);
    expect(inRaidWindow(s, fri + 24 * H + 30 * 60_000)).toBe(true);   // Saturday 00:30
    expect(inRaidWindow(s, fri + 25 * H)).toBe(false);                // Saturday 01:00
    const w = nextRaid(s, fri + 24 * H + 30 * 60_000);
    expect([w.startMs, w.endMs, w.planEndMs]).toEqual([fri + 22 * H, fri + 25 * H, fri + 25 * H + 30 * 60_000]);
  });
  it('plan-to is never before the end', () => {
    const w = nextRaid(sched({ tz: 'UTC', planEnd: '21:00' }), Date.UTC(2026, 5, 5, 12));
    expect(w.planEndMs).toBe(w.endMs);
  });
  it('a raid that spans the spring-forward hour lasts the real elapsed time, not the clock difference', () => {
    // Saturday 22:00 to Sunday 03:00 New York on 2026-03-07/08: the clock skips 02:00, so it is four hours, not five.
    const s = sched({ tz: 'America/New_York', days: [6], start: '22:00', end: '03:00', planEnd: '03:00' });
    const w = nextRaid(s, Date.UTC(2026, 2, 7, 12));
    expect(w.startMs).toBe(Date.UTC(2026, 2, 8, 3, 0));   // 22:00 EST
    expect(w.endMs).toBe(Date.UTC(2026, 2, 8, 7, 0));     // 03:00 EDT
    expect(inRaidWindow(s, Date.UTC(2026, 2, 8, 6, 59))).toBe(true);
    expect(inRaidWindow(s, Date.UTC(2026, 2, 8, 7, 0))).toBe(false);
  });
  it('Europe/Berlin: Friday 20:00 is CET in March, CEST in June, and the EU and US changes fall in different weeks', () => {
    const s = sched({ tz: 'Europe/Berlin', days: [5], start: '20:00', end: '23:00' });
    expect(nextRaid(s, Date.UTC(2026, 2, 9)).startMs).toBe(Date.UTC(2026, 2, 13, 19, 0));   // US already on EDT, Berlin still CET
    expect(nextRaid(s, Date.UTC(2026, 5, 1)).startMs).toBe(Date.UTC(2026, 5, 5, 18, 0));
    expect(inRaidWindow(s, Date.UTC(2026, 5, 5, 18, 0))).toBe(true);
    expect(inRaidWindow(s, Date.UTC(2026, 5, 5, 17, 59))).toBe(false);
  });
  it('Australia/Sydney: the local day differs from the UTC day, and summer time is +11', () => {
    const s = sched({ tz: 'Australia/Sydney', days: [6], start: '19:00', end: '22:00' });
    // Friday 20:00 UTC is already Saturday 07:00 in Sydney, so the raid is the same local day at 19:00 (+11) = 08:00 UTC.
    expect(nextRaid(s, Date.UTC(2026, 0, 9, 20)).startMs).toBe(Date.UTC(2026, 0, 10, 8, 0));
    expect(nextRaid(s, Date.UTC(2026, 6, 10, 20)).startMs).toBe(Date.UTC(2026, 6, 11, 9, 0));   // winter +10
    expect(inRaidWindow(s, Date.UTC(2026, 0, 10, 8, 30))).toBe(true);
    expect(inRaidWindow(s, Date.UTC(2026, 0, 10, 7, 30))).toBe(false);
  });
  it('no days, or a zone nobody knows, is null / false and never throws', () => {
    expect(nextRaid(sched({ days: [] }), Date.now())).toBeNull();
    expect(nextRaid(sched({ tz: 'Mars/Base' }), Date.now())).toBeNull();
    expect(inRaidWindow(sched({ tz: 'Mars/Base' }), Date.now())).toBe(false);
    expect(inRaidWindow(sched(), NaN)).toBe(false);
  });
  it('accepts a Date as well as a number', () => {
    const s = sched({ tz: 'UTC' });
    expect(nextRaid(s, new Date(Date.UTC(2026, 5, 1))).startMs).toBe(nextRaid(s, Date.UTC(2026, 5, 1)).startMs);
  });
});

describe('the words for the schedule', () => {
  it('relativeTime', () => {
    expect(relativeTime(1000, 1000)).toBe('now');
    expect(relativeTime(15 * 60_000, 0)).toBe('in 15 minutes');
    expect(relativeTime(60_000, 0)).toBe('in 1 minute');
    expect(relativeTime(5 * H, 0)).toBe('in 5 hours');
    expect(relativeTime(72 * H, 0)).toBe('in 3 days');
    expect(relativeTime(-5 * H, 0)).toBe('now');
  });
  it('nextRaidLine names the weekday and time in the guild zone, or nothing', () => {
    const line = nextRaidLine(WOLFPACK_SEED.schedule, Date.UTC(2026, 10, 4, 12));   // Wednesday noon UTC
    expect(line).toMatch(/^Wed, 8:30 PM E[SD]T \(in \d+ hours\)$/);
    expect(nextRaidLine(sched({ days: [] }), 0)).toBeNull();
    expect(nextRaidLine(WOLFPACK_SEED.schedule, Date.UTC(2026, 10, 5, 2, 0))).toMatch(/^Raid on now/);
    expect(formatInZone(Date.UTC(2026, 10, 5, 1, 30), 'America/New_York')).toBe('Wed, 8:30 PM EST');
  });
});

describe('hasJob and entriesMatch', () => {
  const s = { ...WOLFPACK_SEED, roles: { ...WOLFPACK_SEED.roles, leader: ['Pack Leader', '111111111111111111'] }, jobs: { ...WOLFPACK_SEED.jobs, loot: ['Looter', '222222222222222222'], dkp: ['DKP Keeper'] } };
  it('the leader tier holds every job, by name or by id', () => {
    for (const job of JOBS) {
      expect(hasJob(s, [], [], ['pack leader'], job), job).toBe(true);
      expect(hasJob(s, [], ['111111111111111111'], [], job), job).toBe(true);
    }
  });
  it('anyone else holds exactly the jobs their roles are listed for', () => {
    expect(hasJob(s, [], [], ['Looter'], 'loot')).toBe(true);
    expect(hasJob(s, [], ['222222222222222222'], [], 'loot')).toBe(true);
    expect(hasJob(s, [], [], ['looter'], 'dkp')).toBe(false);
    expect(hasJob(s, [], [], ['Officer'], 'loot')).toBe(false);   // officer is a rank, not a job
    expect(hasJob(s, [], [], [], 'loot')).toBe(false);
  });
  it('matches a mixed list, ignores case for names but not digits for ids, and an unknown job is nobody’s', () => {
    expect(hasJob(s, ['LOOTER'], [], [], 'loot')).toBe(true);
    expect(hasJob(s, ['222222222222222222'], [], [], 'loot')).toBe(true);
    expect(hasJob(s, [], ['222222222222222223'], [], 'loot')).toBe(false);
    expect(hasJob(s, [], [], ['Looter'], 'nonsense')).toBe(false);
    expect(entriesMatch([], ['a'], ['b'], ['c'])).toBe(false);
  });
  it('every tier and job is a key of the settings', () => {
    for (const t of ROLE_TIERS) expect(Array.isArray(DEFAULT_SETTINGS.roles[t])).toBe(true);
    for (const j of JOBS) expect(Array.isArray(DEFAULT_SETTINGS.jobs[j])).toBe(true);
  });
});

describe('wiring (source text, comments stripped)', () => {
  const lib = stripJs(read('web', 'lib', 'guildSettings.ts'));
  const actions = stripJs(read('web', 'app', 'guilds', '[slug]', 'settings', 'actions.ts'));
  const page = stripJs(read('web', 'app', 'guilds', '[slug]', 'settings', 'page.tsx'));
  const access = stripJs(read('web', 'lib', 'guildSettingsAccess.ts'));
  const guildPage = stripJs(read('web', 'app', 'guilds', '[slug]', 'page.tsx'));

  it('the rules file is pure: no alias, no framework, no other module', () => {
    expect(lib).not.toMatch(/^\s*import\b/m);
    expect(lib).not.toMatch(/from\s+['"](@\/|next|react)/);
  });
  it('the save repeats the access check, validates, upserts on guild_id, audits and revalidates', () => {
    expect(actions).toMatch(/await settingsActor\(String\(slug\)\)/);
    expect(actions).toMatch(/validateSettings\(input\)/);
    expect(actions).toMatch(/from\('guild_settings'\)\.upsert\(\{[^}]*guild_id: slug[^}]*updated_by: who\.discordId/s);
    expect(actions).toMatch(/action: 'guild_settings_updated'/);
    expect(actions).toMatch(/revalidatePath\(`\/guilds\/\$\{slug\}\/settings`\)/);
    expect(actions).not.toMatch(/payload:[^}]*values/);   // the audit names sections, never values
  });
  it('access is the hub owner/officer, or a site officer for the built-in guild only', () => {
    expect(access).toMatch(/canManageInvites\(access\.role\)/);
    expect(access).toMatch(/slug === GUILD_TAG && \(await isOfficer\(user\.id\)\)/);
  });
  it('the page 404s everyone else and carries the [beta] tag', () => {
    expect(page).toMatch(/const actor = await settingsActor\(slug\);\s*if \(!actor\) notFound\(\)/);
    expect(page).toMatch(/<NewPageTag/);
    expect(page).toMatch(/export async function generateMetadata/);
  });
  it('the guild page gets the checklist for managers and the next raid for everyone, and site officers open the home guild', () => {
    expect(guildPage).toMatch(/aria-label="Set up your guild"/);
    expect(guildPage).toMatch(/slug === GUILD_TAG && !\(access\.kind === 'member'/);
    expect(guildPage).toMatch(/raidLine/);
    expect(guildPage).toMatch(/label: 'Mimic installed'/);
    expect(guildPage).toMatch(/done: false, label: 'Mimic installed'/);   // never "done"
  });
  it('the route unfurls as "Guild settings" without the guild name', () => {
    const m = metaForPath('/guilds/some-guild/settings');
    expect(m.title).toBe('[beta] Guild settings');
    expect(JSON.stringify(m)).not.toMatch(/some-guild/);
  });
});
