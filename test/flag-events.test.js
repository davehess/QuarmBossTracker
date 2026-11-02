// test/flag-events.test.js — the flag-event board (/pop/flag-events; the guild lead, 2026-11-02, option A: "Post an
// event, see who needs it").
//
// Two kinds of assertion:
//   - BEHAVIOUR, by running the real pure functions (web/lib/flagEventNeeds.ts through the real gate rules, flagEvents.ts,
//     flagEventSigned.ts) with invented characters. A comment cannot satisfy these.
//   - SOURCE TEXT for what cannot run here (the page and the server action need next/react): the migration shape, that
//     the action re-checks the officer role, that every query carries the guild, that the page gates sign-in and
//     membership. Comments are stripped first (stripJs / stripSql): these files' headers name every one of these rules.
//
// The names below are invented (Aldenmar, Brackwyn, Corvale ...). None of them is anybody.
//
// Run: npx vitest run test/flag-events.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { ROOT, readSource, stripJs, stripSql } from './_source-slice.js';
import { FLAG_TARGETS, flagTargetByKey } from '../web/lib/flagTargets.ts';
import { splitNeeds, needsFullReadCheck, verdictForTarget } from '../web/lib/flagEventNeeds.ts';
import { resolveSigned } from '../web/lib/flagEventSigned.ts';
import {
  NOTE_MAX, easternLocalToIso, parseEventForm, splitEventWindow, eventReadWindow, ERROR_TEXT,
} from '../web/lib/flagEvents.ts';
import { gatePieces } from '../web/lib/popGatePieces.ts';
import { POP_ZONE_BY_KEY } from '../web/lib/popFlags.ts';
import * as Demo from '../web/lib/demoGuild.ts';

const web = (...p) => readSource(path.join(ROOT, 'web', ...p));
const MIGRATION = stripSql(readSource(path.join(ROOT, 'supabase', 'migrations', '20261102200000_flag_events.sql'))).replace(/\s+/g, ' ');
const ACTIONS = stripJs(web('app', 'pop', 'flag-events', 'actions.ts'));
const PAGE = stripJs(web('app', 'pop', 'flag-events', 'page.tsx'));
const LOAD = stripJs(web('app', 'pop', 'flag-events', 'load.ts'));

const NOW = new Date('2026-11-02T16:00:00Z');   // Monday 11:00 ET

// ── the migration ─────────────────────────────────────────────────────────────────────────────────

describe('migration 20261102200000_flag_events.sql', () => {
  it('creates the table idempotently with the columns the board reads', () => {
    expect(MIGRATION).toMatch(/create table if not exists public\.flag_events/i);
    for (const col of [
      /id bigint generated always as identity primary key/i, /guild_id text not null/i, /target_key text not null/i,
      /starts_at timestamptz not null/i, /\bnote text\b/i, /rh_event_id text\b/i, /posted_by_discord_id text not null/i,
      /created_at timestamptz not null default now\(\)/i,
    ]) expect(MIGRATION).toMatch(col);
    expect(MIGRATION).toMatch(/create index if not exists \w+ on public\.flag_events \(guild_id, starts_at\)/i);
  });

  it('rh_event_id matches the real type of rh_events.id (text)', () => {
    const rh = stripSql(readSource(path.join(ROOT, 'supabase', 'migrations', '20260529220000_raidhelper_events_signups.sql')));
    expect(rh).toMatch(/create table if not exists rh_events \(\s*id\s+text primary key/i);
    expect(MIGRATION).toMatch(/rh_event_id text references public\.rh_events \(id\)/i);
  });

  it('is service-role only: RLS on, no policy, no grants to anon or authenticated', () => {
    expect(MIGRATION).toMatch(/alter table public\.flag_events enable row level security/i);
    expect(MIGRATION).toMatch(/revoke all on public\.flag_events from anon, authenticated/i);
    expect(MIGRATION).not.toMatch(/create policy/i);
    expect(MIGRATION).not.toMatch(/grant\s+\w+.*\bon public\.flag_events\b/i);
  });

  it('caps the note at the same length the action does', () => {
    expect(NOTE_MAX).toBe(200);
    expect(MIGRATION).toMatch(/char_length\(note\) <= 200/i);
  });

  it('the table is on the guild-scope ratchet\'s list', () => {
    const tables = JSON.parse(readSource(path.join(ROOT, 'scripts', 'guild-tables.json'))).tables;
    expect(tables).toContain('flag_events');
  });
});

// ── the server action ─────────────────────────────────────────────────────────────────────────────

describe('server actions', () => {
  it('are a "use server" module that exports only async functions', () => {
    expect(web('app', 'pop', 'flag-events', 'actions.ts').trimStart().startsWith("'use server'")).toBe(true);
    // Every export line, whatever it is: a non-function export from a 'use server' file breaks the build.
    const exported = [...ACTIONS.matchAll(/^export\s+(.*?)\(/gm)].map(m => m[1]);
    expect(ACTIONS.match(/^export\b/gm)).toHaveLength(2);
    expect(exported.sort()).toEqual(['async function deleteFlagEvent', 'async function postFlagEvent']);
  });

  it('both re-check the session and the officer role themselves', () => {
    // The shared gate is one function; both actions must call it before touching the table.
    expect(ACTIONS).toMatch(/async function officerOrBack\(\)[\s\S]*?auth\.getUser\(\)[\s\S]*?isOfficer\(user\.id\)/);
    for (const fn of ['postFlagEvent', 'deleteFlagEvent']) {
      const body = ACTIONS.slice(ACTIONS.indexOf(`export async function ${fn}`));
      const stop = body.indexOf('\nexport ', 10);
      const own = stop > 0 ? body.slice(0, stop) : body;
      expect(own, fn).toMatch(/await officerOrBack\(\)/);
      expect(own.indexOf('officerOrBack'), `${fn}: gate before any write`).toBeLessThan(own.search(/\.(insert|delete)\(/));
    }
  });

  it('validate through parseEventForm (target in the catalog, time, note) before writing', () => {
    expect(ACTIONS).toMatch(/parseEventForm\(/);
    expect(ACTIONS.indexOf('parseEventForm(')).toBeLessThan(ACTIONS.indexOf('.insert('));
  });

  it('a linked Raid-Helper event must be one of this guild\'s', () => {
    expect(ACTIONS).toMatch(/from\('rh_events'\)\.select\('id'\)\.eq\('guild_id', GUILD_TAG\)\.eq\('id', rh_event_id\)/);
  });

  it('every query on flag_events carries the guild', () => {
    expect(ACTIONS).toMatch(/\.from\('flag_events'\)\.insert\(\{\s*guild_id: GUILD_TAG/);
    expect(ACTIONS).toMatch(/\.from\('flag_events'\)\.delete\(\)\.eq\('guild_id', GUILD_TAG\)/);
  });
});

describe('parseEventForm', () => {
  const ok = { target_key: 'saryrn', starts_at: '2026-11-05T20:00', note: 'Gather at 7:45', rh_event_id: '' };

  it('accepts a good event and stores the time as UTC', () => {
    const r = parseEventForm(ok, NOW);
    expect(r.ok).toBe(true);
    // 8:00 pm Eastern on 5 Nov 2026 is EST (clocks went back on 1 Nov): UTC-5.
    expect(r.value).toEqual({ target_key: 'saryrn', starts_at: '2026-11-06T01:00:00.000Z', note: 'Gather at 7:45', rh_event_id: null });
  });

  it('rejects a target that is not in the catalog', () => {
    for (const bad of ['', 'not-a-target', 'constructor', '__proto__', null, undefined, 7, ['saryrn']]) {
      expect(parseEventForm({ ...ok, target_key: bad }, NOW), String(bad)).toEqual({ ok: false, code: 'target' });
    }
  });

  it('holds the note to 200 characters of plain text', () => {
    expect(parseEventForm({ ...ok, note: 'x'.repeat(200) }, NOW).ok).toBe(true);
    expect(parseEventForm({ ...ok, note: 'x'.repeat(201) }, NOW)).toEqual({ ok: false, code: 'note' });
    expect(parseEventForm({ ...ok, note: 'a\u0000b' }, NOW)).toEqual({ ok: false, code: 'note' });
    expect(parseEventForm({ ...ok, note: { toString: () => 'x' } }, NOW)).toEqual({ ok: false, code: 'note' });
    expect(parseEventForm({ ...ok, note: '   ' }, NOW).value.note).toBeNull();
  });

  it('rejects a date that is not real, far in the past or far ahead', () => {
    for (const bad of ['', 'tomorrow', '2026-02-30T20:00', '2026-11-05T25:00', '2026-11-05 20:00', '2026-11-05', null, 12]) {
      expect(parseEventForm({ ...ok, starts_at: bad }, NOW), String(bad)).toEqual({ ok: false, code: 'when' });
    }
    expect(parseEventForm({ ...ok, starts_at: '2026-10-01T20:00' }, NOW).code).toBe('when');
    expect(parseEventForm({ ...ok, starts_at: '2027-06-01T20:00' }, NOW).code).toBe('when');
  });

  it('checks the shape of a Raid-Helper id (the action then confirms it exists)', () => {
    expect(parseEventForm({ ...ok, rh_event_id: '1234567890123456' }, NOW).value.rh_event_id).toBe('1234567890123456');
    for (const bad of ['a b', "x'; drop table", 'x'.repeat(65), 5]) {
      expect(parseEventForm({ ...ok, rh_event_id: bad }, NOW), String(bad)).toEqual({ ok: false, code: 'rh' });
    }
  });

  it('every failure code has a message the page can show', () => {
    for (const code of ['target', 'when', 'note', 'rh', 'officer', 'member', 'save', 'id']) expect(ERROR_TEXT[code], code).toBeTruthy();
  });
});

describe('easternLocalToIso', () => {
  it('follows the clock change', () => {
    expect(easternLocalToIso('2026-07-05T20:00')).toBe('2026-07-06T00:00:00.000Z');   // EDT, UTC-4
    expect(easternLocalToIso('2026-11-05T20:00')).toBe('2026-11-06T01:00:00.000Z');   // EST, UTC-5
    expect(easternLocalToIso('2026-11-01T12:00')).toBe('2026-11-01T17:00:00.000Z');   // the day it changes, after 2 am
  });
});

describe('splitEventWindow', () => {
  const at = (h) => ({ starts_at: new Date(NOW.getTime() + h * 3600_000).toISOString() });
  it('puts tonight and the next 14 days up front, the last 3 days under recent, and drops the rest', () => {
    const rows = [at(-100), at(-60), at(-5), at(-2), at(1), at(24 * 14 - 1), at(24 * 14 + 1)];
    const { upcoming, recent } = splitEventWindow(rows, NOW);
    expect(upcoming.map(r => r.starts_at)).toEqual([rows[3], rows[4], rows[5]].map(r => r.starts_at));   // -2h is still tonight
    expect(recent.map(r => r.starts_at)).toEqual([rows[2], rows[1]].map(r => r.starts_at));              // newest first
    expect(eventReadWindow(NOW).from < rows[1].starts_at).toBe(true);
  });
});

// ── the target catalog ────────────────────────────────────────────────────────────────────────────

describe('flag targets', () => {
  it('keys are unique and the original seven are kept (posted rows name them)', () => {
    const keys = FLAG_TARGETS.map(t => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of ['marr-trials', 'saryrn', 'marr', 'tallon-vallon', 'terris', 'bertox', 'rallos']) expect(keys).toContain(k);
    expect(FLAG_TARGETS.length).toBeGreaterThan(7);
  });

  it('every piece of every target is a real piece of its gate (popGatePieces.ts REQ_PIECES)', () => {
    for (const t of FLAG_TARGETS) {
      const zone = POP_ZONE_BY_KEY[t.gate];
      expect(zone, `${t.key}: gate ${t.gate}`).toBeTruthy();
      const inGate = gatePieces(zone).map(p => p.key);
      expect(t.pieces.length, t.key).toBeGreaterThan(0);
      for (const p of t.pieces) expect(inGate, `${t.key}: ${p} is not in ${t.gate}`).toContain(p);
    }
  });

  it('the demo and the board share one list', () => {
    expect(Demo.TARGETS).toBe(FLAG_TARGETS);
    expect(Demo.targetByKey('saryrn')).toBe(flagTargetByKey('saryrn'));
  });
});

// ── who needs it, through the real gate rules ─────────────────────────────────────────────────────

describe('splitNeeds / verdictForTarget', () => {
  const saryrn = flagTargetByKey('saryrn');
  const marrTrials = flagTargetByKey('marr-trials');
  const people = [
    { name: 'Aldenmar', flags: ['saryrn_1'], fullRead: true },            // holds the half
    { name: 'Brackwyn', flags: ['mavuin_3'], fullRead: true },            // full read, no half: a real "no"
    { name: 'Corvale', flags: [], fullRead: false },                      // no read at all: nobody knows
    { name: 'Dunmarrow', flags: ['cl_saryrn'], fullRead: true },          // the Seer holds the credited kill: owed nothing
    { name: 'Eltharin', flags: ['saryrn_dead'], fullRead: true },         // the kill, but not the hail after it
    { name: 'Fenwick', flags: ['cipher_1'], fullRead: false },            // the cipher proves both halves
  ];
  const run = (t) => splitNeeds(t, people, p => ({ flags: p.flags, fullRead: p.fullRead }));
  const names = (xs) => xs.map(p => p.name);

  it('splits "still need it" from "not recorded" from done', () => {
    const r = run(saryrn);
    expect(names(r.need)).toEqual(['Brackwyn']);
    expect(names(r.unsure)).toEqual(['Corvale', 'Eltharin']);
    expect(names(r.done)).toEqual(['Aldenmar', 'Dunmarrow', 'Fenwick']);
  });

  it('never calls anyone "need" without a full read', () => {
    for (const t of FLAG_TARGETS) {
      expect(splitNeeds(t, people, p => ({ flags: p.flags, fullRead: false })).need, t.key).toEqual([]);
    }
  });

  it('a multi-piece target needs only one piece missing', () => {
    const half = { flags: ['hoh_trial_1', 'hoh_trial_2'], fullRead: true };
    expect(verdictForTarget(marrTrials, half)).toBe('need');
    expect(verdictForTarget(marrTrials, { flags: ['hoh_trial_1', 'hoh_trial_2', 'hoh_trial_3'], fullRead: true })).toBe('done');
  });

  it('a target whose gate has gone is never read as done', () => {
    expect(verdictForTarget({ key: 'x', label: 'x', gate: 'no-such-gate', pieces: ['c_saryrn'], blurb: '' }, { flags: [], fullRead: true })).toBe('unsure');
  });

  it('asks for a full read only about characters that could still need something', () => {
    const asked = needsFullReadCheck([saryrn], people, p => ({ flags: p.flags }));
    expect([...asked].map(p => p.name).sort()).toEqual(['Brackwyn', 'Corvale', 'Eltharin']);
  });

  it('the demo answers through the same function', () => {
    const marr = Demo.needsFor(Demo.targetByKey('marr-trials'));
    expect(marr.need.map(c => c.name)).toEqual(['Zarrin', 'Orlindra', 'Sorvane']);
  });
});

// ── sign-ups ──────────────────────────────────────────────────────────────────────────────────────

describe('resolveSigned', () => {
  const chars = [
    { name: 'Aldenmar', class: 'Warrior', main_name: null, active: true, rank: 'Raid Pack', discordId: 'd1' },
    { name: 'Rethlanalt', class: 'Monk', main_name: 'Aldenmar', active: true, rank: 'Raid Alt', discordId: 'd1' },
    { name: 'Corvale', class: 'Wizard', main_name: null, active: true, rank: 'Raid Pack', discordId: 'd2' },
  ];
  const signups = [
    { discord_id: 'd1', user_name: 'aldenmar#1', status: 'primary', class_name: 'Monk' },
    { discord_id: 'd1', user_name: 'aldenmar#1', status: 'primary', class_name: 'Warrior' },   // a second sign-up from the same player
    { discord_id: 'd2', user_name: 'corvale#2', status: 'Absence', class_name: 'Wizard' },     // not coming
    { discord_id: 'd3', user_name: 'Zarrin', status: 'primary', class_name: 'Rogue' },         // no listed character
    { discord_id: 'd4', user_name: 'Yselka', status: 'primary', class_name: 'Bench' },         // benched, filed as the class
  ];

  it('keeps who is coming, one per player, as the character they signed up as', () => {
    const r = resolveSigned(signups, chars);
    expect(r.map(s => s.label)).toEqual(['Rethlanalt', 'Zarrin']);
    expect(r[0].char.name).toBe('Rethlanalt');
    expect(r[1].char).toBeNull();
  });
});

// ── the page ──────────────────────────────────────────────────────────────────────────────────────

describe('the page', () => {
  it('lives at /pop/flag-events (web/app/pop/events is the loot page and is untouched)', () => {
    expect(web('app', 'pop', 'events', 'page.tsx')).toMatch(/PoP events/);
    expect(PAGE).toMatch(/redirect\('\/auth\/signin\?next=\/pop\/flag-events'\)/);
  });

  it('gates on sign-in and on membership before reading anything', () => {
    const signin = PAGE.indexOf("redirect('/auth/signin?next=/pop/flag-events')");
    const member = PAGE.search(/from\('wolfpack_members'\)\.select\('is_member'\)\.eq\('user_id', user\.id\)/);
    const read = PAGE.indexOf('loadBoard(now');
    expect(signin).toBeGreaterThan(0);
    expect(member).toBeGreaterThan(signin);
    expect(read).toBeGreaterThan(member);
    expect(PAGE).toMatch(/is_member === false/);
  });

  it('shows the post form only to officers and carries the [beta] marker', () => {
    expect(PAGE).toMatch(/\{officer && <PostForm/);
    expect(PAGE).toMatch(/await isOfficer\(user\.id\)/);
    expect(PAGE).toMatch(/<NewPageTag/);
    expect(PAGE).toMatch(/title: '\[beta\] Flag events'/);
  });

  it('draws the three lists, and the ping button is disabled for now', () => {
    expect(PAGE).toMatch(/Still need it/);
    expect(PAGE).toMatch(/Not recorded/);
    expect(PAGE).toMatch(/Signed/);
    expect(PAGE).toMatch(/<button type="button" disabled[^>]*>\s*Ping \(coming soon\)/);
    expect(PAGE).not.toMatch(/sendDiscord|webhook|fetch\(/i);
  });

  it('has no client script (a form posts, details open on their own)', () => {
    expect(web('app', 'pop', 'flag-events', 'page.tsx').trimStart().startsWith("'use client'")).toBe(false);
    expect(PAGE).not.toMatch(/useState|useEffect/);
  });

  it('is in the PoP page\'s nav and has its own card (page-metadata.test.js holds the rest)', () => {
    expect(stripJs(web('app', 'pop', 'page.tsx'))).toMatch(/href: '\/pop\/flag-events'/);
    expect(stripJs(web('lib', 'pageMeta.ts'))).toMatch(/'\/pop\/flag-events': \{ title: '\[beta\] Flag events'/);
  });
});

describe('the reads', () => {
  it('every read of a guild table carries the guild', () => {
    for (const table of ['flag_events', 'rh_events', 'rh_signups', 'pop_guide_ticks']) {
      const calls = [...LOAD.matchAll(new RegExp(`from\\('${table}'\\)`, 'g'))];
      expect(calls.length, table).toBeGreaterThan(0);
      for (const m of calls) {
        expect(LOAD.slice(m.index, m.index + 420), `${table} read without a guild filter`).toMatch(/guild_id', GUILD_TAG/);
      }
    }
    expect(LOAD).toMatch(/pop_flags_distinct', \{ p_guild_id: GUILD_TAG/);
  });

  it('pages the big reads and never asks for more than the API returns', () => {
    expect(LOAD).toMatch(/selectAll</);
    for (const m of LOAD.matchAll(/\.limit\((\d[\d_]*)\)/g)) expect(Number(m[1].replace(/_/g, ''))).toBeLessThanOrEqual(1000);
  });

  it('uses the shared listable-character rule and honours the stats opt-out', () => {
    expect(LOAD).toMatch(/tierOf\(\{ rank: r\.rank, level: levels\.get\(r\.name\.toLowerCase\(\)\), hidden: r\.hidden_from_lists \}\) === 'listed'/);
    expect(LOAD).toMatch(/exclude_from_stats !== true/);
  });
});
