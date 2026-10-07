// The officer half of looping timers and timer warnings for guild triggers (FB-31).
//
// A guild trigger can carry a countdown (timer_duration_sec), a pre-end warning (warning_seconds +
// warning_text) and a repeat (timer_loop + timer_loop_max). Until now they were SQL-only, so
// /admin/triggers had no way to set them and its Save never touched them. The agent honours each
// only in combination -- a warning needs a countdown it is shorter than, a repeat needs a countdown
// -- and ignores a half-set pair without a word, which is how a "warning" typed into SQL read as
// coverage and never spoke. So the form refuses what the agent would ignore, and the rules live in
// ONE pure function (web/lib/triggerTimer.ts) that the page's server action and the form's live
// check both run.
//
// Four things are pinned here:
//   1. the rules themselves (real import of the lib);
//   2. that what the rules produce REACHES the row, under the column names the table has -- a typo'd
//      column makes PostgREST refuse the whole save, and the form/action name contract (a renamed
//      input is silently dropped) -- text over the page, comments stripped;
//   3. the migration;
//   4. that a change to ONLY these fields still moves the version the agents poll on.
//
// Run: npx vitest run test/guild-trigger-timer-fields.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readSource, sliceBlock, evalBlock, stripJs, stripSql, BOT_INDEX } from './_source-slice.js';
import { parseTimerFields, timerInputFrom, describeTimer, MAX_COUNTDOWN_SEC, MAX_REPEATS, MAX_WARNING_TEXT } from '../web/lib/triggerTimer.ts';

const blank = { countdown: '', warnAt: '', warnText: '', loop: false, loopMax: '' };
const run = (over) => parseTimerFields({ ...blank, ...over });
const cols = (over) => {
  const r = run(over);
  if (!r.ok) throw new Error(`expected ok, got ${r.field}: ${r.error}`);
  return r.columns;
};

// ── 1. The rules ────────────────────────────────────────────────────────────

describe('parseTimerFields -- what saves', () => {
  it('nothing set saves as nothing: NULLs and a false repeat, never 0 or ""', () => {
    expect(cols({})).toEqual({
      timer_duration_sec: null, warning_seconds: null, warning_text: null, timer_loop: false, timer_loop_max: null,
    });
  });

  it('a countdown on its own', () => {
    expect(cols({ countdown: '60' }).timer_duration_sec).toBe(60);
    expect(cols({ countdown: ' 60 ' }).timer_duration_sec).toBe(60);
  });

  it('countdown 0 means no countdown (NULL)', () => {
    expect(cols({ countdown: '0' }).timer_duration_sec).toBeNull();
  });

  it('a warning is the pair, trimmed, under a countdown it is shorter than', () => {
    const c = cols({ countdown: '60', warnAt: '10', warnText: '  Rage in 10  ' });
    expect(c.warning_seconds).toBe(10);
    expect(c.warning_text).toBe('Rage in 10');
    expect(c.timer_duration_sec).toBe(60);
  });

  it('one second shorter than the countdown is the longest warning allowed', () => {
    expect(cols({ countdown: '60', warnAt: '59', warnText: 'now' }).warning_seconds).toBe(59);
  });

  it('warning text is cut to the 200 characters the agent keeps', () => {
    const c = cols({ countdown: '60', warnAt: '10', warnText: 'x'.repeat(MAX_WARNING_TEXT + 50) });
    expect(c.warning_text).toHaveLength(MAX_WARNING_TEXT);
  });

  it('repeat with a countdown; max blank or 0 = until cancelled (NULL)', () => {
    expect(cols({ countdown: '30', loop: true })).toMatchObject({ timer_loop: true, timer_loop_max: null });
    expect(cols({ countdown: '30', loop: true, loopMax: '0' })).toMatchObject({ timer_loop: true, timer_loop_max: null });
  });

  it('repeat with a limit', () => {
    expect(cols({ countdown: '30', loop: true, loopMax: '5' })).toMatchObject({ timer_loop: true, timer_loop_max: 5 });
  });

  it('Repeat off drops a limit left in the box, and does not judge it', () => {
    expect(cols({ countdown: '30', loop: false, loopMax: '5' })).toMatchObject({ timer_loop: false, timer_loop_max: null });
    expect(cols({ countdown: '30', loop: false, loopMax: 'not a number' }).timer_loop_max).toBeNull();
  });

  it('the whole set together', () => {
    expect(cols({ countdown: '45', warnAt: '8', warnText: 'Ring in 8', loop: true, loopMax: '12' })).toEqual({
      timer_duration_sec: 45, warning_seconds: 8, warning_text: 'Ring in 8', timer_loop: true, timer_loop_max: 12,
    });
  });
});

describe('parseTimerFields -- what is refused, and which box it blames', () => {
  const refused = [
    // [name, input, blamed field, message fragment]
    ['a warning with no countdown',          { warnAt: '10', warnText: 'soon' },                               'warnAt',   /needs a countdown/i],
    ['a warning as long as the countdown',   { countdown: '60', warnAt: '60', warnText: 'soon' },             'warnAt',   /shorter than the countdown/i],
    ['a warning longer than the countdown',  { countdown: '60', warnAt: '90', warnText: 'soon' },             'warnAt',   /shorter than the countdown/i],
    ['a warning time with no words',         { countdown: '60', warnAt: '10' },                              'warnText', /needs its text/i],
    ['warning words with no time',           { countdown: '60', warnText: 'soon' },                           'warnAt',   /needs a time/i],
    ['warning words with a time of 0',       { countdown: '60', warnAt: '0', warnText: 'soon' },               'warnAt',   /needs a time/i],
    ['repeat with no countdown',             { loop: true },                                                 'loop',     /needs a countdown/i],
    ['repeat with a countdown of 0',         { countdown: '0', loop: true },                                 'loop',     /needs a countdown/i],
    ['a negative countdown',                 { countdown: '-5' },                                            'countdown', /whole number/i],
    ['a fractional countdown',               { countdown: '2.5' },                                           'countdown', /whole number/i],
    ['an exponent countdown',                { countdown: '1e3' },                                           'countdown', /whole number/i],
    ['a countdown with text in it',          { countdown: '60s' },                                           'countdown', /whole number/i],
    ['a negative warning time',              { countdown: '60', warnAt: '-1', warnText: 'soon' },            'warnAt',   /whole number/i],
    ['a fractional warning time',            { countdown: '60', warnAt: '1.5', warnText: 'soon' },          'warnAt',   /whole number/i],
    ['a negative repeat limit',              { countdown: '60', loop: true, loopMax: '-2' },                 'loopMax',  /whole number/i],
    ['a fractional repeat limit',            { countdown: '60', loop: true, loopMax: '2.5' },                'loopMax',  /whole number/i],
    ['a countdown past what the agent runs', { countdown: String(MAX_COUNTDOWN_SEC + 1) },                  'countdown', /at most/i],
    ['a repeat limit past what the agent keeps', { countdown: '60', loop: true, loopMax: String(MAX_REPEATS + 1) }, 'loopMax', /at most/i],
  ];
  for (const [name, input, field, msg] of refused) {
    it(name, () => {
      const r = run(input);
      expect(r.ok).toBe(false);
      expect(r.field).toBe(field);
      expect(r.error).toMatch(msg);
    });
  }

  it('the limits themselves are allowed', () => {
    expect(cols({ countdown: String(MAX_COUNTDOWN_SEC) }).timer_duration_sec).toBe(MAX_COUNTDOWN_SEC);
    expect(cols({ countdown: '60', loop: true, loopMax: String(MAX_REPEATS) }).timer_loop_max).toBe(MAX_REPEATS);
  });
});

describe('timerInputFrom -- the form fields as the server action reads them', () => {
  const fd = (o) => (k) => o[k];
  it('reads each input by its name; a ticked box arrives as "on"', () => {
    expect(timerInputFrom(fd({
      timer_duration_sec: '60', warning_seconds: '10', warning_text: 'soon', timer_loop: 'on', timer_loop_max: '3',
    }))).toEqual({ countdown: '60', warnAt: '10', warnText: 'soon', loop: true, loopMax: '3' });
  });
  it('an unticked box is absent from FormData, and that is false', () => {
    expect(timerInputFrom(fd({ timer_duration_sec: '60' })).loop).toBe(false);
    expect(timerInputFrom(fd({})).countdown).toBe('');
  });
});

describe('describeTimer -- the chip on the trigger list', () => {
  it('says nothing for a trigger without a countdown, whatever else is set', () => {
    expect(describeTimer({})).toBe('');
    expect(describeTimer({ timer_duration_sec: 0, timer_loop: true })).toBe('');
    expect(describeTimer({ timer_duration_sec: null, warning_seconds: 5, warning_text: 'x' })).toBe('');
  });
  it('names the countdown, the warning and the repeat', () => {
    expect(describeTimer({ timer_duration_sec: 60 })).toBe('60s countdown');
    expect(describeTimer({ timer_duration_sec: 60, warning_seconds: 10, warning_text: 'soon' })).toBe('60s countdown · warns at 10s');
    expect(describeTimer({ timer_duration_sec: 60, timer_loop: true })).toBe('60s countdown · repeats until cancelled');
    expect(describeTimer({ timer_duration_sec: 60, timer_loop: true, timer_loop_max: 5 })).toBe('60s countdown · repeats up to 5×');
  });
  it('a warning the agent would not arm (no text) is not advertised', () => {
    expect(describeTimer({ timer_duration_sec: 60, warning_seconds: 10, warning_text: null })).toBe('60s countdown');
  });
});

// ── 2. It reaches the row ───────────────────────────────────────────────────

const page = readSource(path.join(ROOT, 'web/app/admin/triggers/page.tsx'));
const form = readSource(path.join(ROOT, 'web/app/admin/triggers/TimerFields.tsx'));
const action = stripJs(sliceBlock(page, 'async function createOrUpdate(formData: FormData) {', '\n}\n'));

describe('createOrUpdate writes the fields', () => {
  it('checks them before it writes anything, and a refusal does not fall through', () => {
    const parse = action.indexOf('parseTimerFields(timerInputFrom(');
    const refuse = action.search(/if \(!timer\.ok\) \{[\s\S]*?redirect\(/);
    const write = action.indexOf('supabaseAdmin()');
    expect(parse).toBeGreaterThan(-1);
    expect(refuse).toBeGreaterThan(parse);
    expect(write).toBeGreaterThan(refuse);
  });

  it('spreads the validated columns into the ONE row that both the update and the insert use', () => {
    const rowLiteral = sliceBlock(action, 'const row = {', '\n  };');
    expect(rowLiteral).toContain('...timer.columns');
    expect(action).toMatch(/\.update\(row\)/);
    expect(action).toMatch(/\.insert\(\[\{ \.\.\.row,/);
  });

  it('every column it writes exists in a migration (an unknown column makes PostgREST refuse the whole save)', () => {
    const dir = path.join(ROOT, 'supabase/migrations');
    const sql = stripSql(fs.readdirSync(dir).filter(f => f.endsWith('.sql')).map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n'));
    for (const key of Object.keys(cols({}))) {
      expect(sql, key).toMatch(new RegExp(`add column if not exists ${key}\\b`, 'i'));
    }
  });
});

describe('the form and the server action agree on the input names', () => {
  it('every field the action reads is an input the form renders, and the reverse', () => {
    const read = [];
    timerInputFrom((k) => { read.push(k); return ''; });
    const rendered = [...stripJs(form).matchAll(/\bname="([a-z_]+)"/g)].map(m => m[1]);
    expect(new Set(rendered)).toEqual(new Set(read));
    expect(read).toHaveLength(5);
  });

  it('the form runs the SAME check as the action, not a copy of it', () => {
    expect(stripJs(form)).toContain("from '@/lib/triggerTimer'");
    expect(stripJs(form)).toMatch(/parseTimerFields\(\{/);
    expect(stripJs(form)).toMatch(/setCustomValidity\(/);
  });

  it('the page renders the form fields, keyed so editing another trigger resets them', () => {
    const body = stripJs(page);
    expect(body).toMatch(/<TimerFields\s+key=\{editTarget\?\.id \?\? 'new'\}/);
    for (const key of Object.keys(cols({}))) expect(body, key).toMatch(new RegExp(`${key}:\\s+editTarget\\?\\.${key}`));
  });

  it('a refused save comes back as a banner, not as a save that silently did not happen', () => {
    const body = stripJs(page);
    expect(body).toContain('timer_error');
    expect(body).toMatch(/Not saved/);
  });
});

describe('the page reads the fields back', () => {
  const body = stripJs(page);
  const columns = (body.match(/loadGuildTriggers<TriggerRow>\(admin,\s*'([^']+)'/) || [])[1];
  const type = (body.match(/type TriggerRow = \{([\s\S]*?)\n\};/) || [])[1];

  it('selects all five (an edit form that cannot see them would blank them on the next Save)', () => {
    expect(columns).toBeTruthy();
    const list = columns.split(',').map(s => s.trim());
    for (const key of Object.keys(cols({}))) expect(list, key).toContain(key);
  });

  it('types all five', () => {
    expect(type).toBeTruthy();
    for (const key of Object.keys(cols({}))) expect(type, key).toMatch(new RegExp(`\\b${key}:`));
  });
});

// ── 3. The migration ────────────────────────────────────────────────────────

describe('20261008000000_guild_triggers_loop.sql', () => {
  const file = path.join(ROOT, 'supabase/migrations/20261008000000_guild_triggers_loop.sql');
  const raw = fs.readFileSync(file, 'utf8');
  const sql = stripSql(raw).replace(/\s+/g, ' ');

  it('adds both columns, idempotently, off by default', () => {
    expect(sql).toMatch(/alter table public\.guild_triggers add column if not exists timer_loop boolean not null default false,/i);
    expect(sql).toMatch(/add column if not exists timer_loop_max integer;/i);
  });

  it('leaves existing rows alone: no UPDATE, no DROP, no NOT NULL without a default', () => {
    expect(sql).not.toMatch(/\bupdate\b|\bdrop\b|\bdelete\b/i);
    expect(sql).not.toMatch(/timer_loop_max integer not null/i);
  });

  it('says why, which report, and which agent reads it', () => {
    expect(raw).toMatch(/FB-31/);
    expect(raw).toMatch(/3\.7\.99/);
  });
});

// ── 4. Agents see a change to only these fields ─────────────────────────────

describe('a change to only the loop/warning fields reaches running agents', () => {
  const bot = readSource(BOT_INDEX);
  const { _guildTriggersVersion } = evalBlock(
    sliceBlock(bot, 'function _pollTuningVersion(payload) {', '\n  return h.toString(36);\n}') + '\n' +
    sliceBlock(bot, 'function _guildTriggersVersion(rows) {', '\n}'),
    ['_guildTriggersVersion'],
  );
  const row = { id: 't1', timer_duration_sec: 60, timer_loop: false, timer_loop_max: null, updated_at: '2026-10-08T00:00:00Z' };

  it('the version is the one agents compare: a row whose updated_at moved gives a new version', () => {
    // guild_triggers_touch stamps updated_at on every UPDATE, so editing only timer_loop does this.
    const edited = { ...row, timer_loop: true, updated_at: '2026-10-08T00:05:00Z' };
    expect(_guildTriggersVersion([edited])).not.toBe(_guildTriggersVersion([row]));
  });

  it('...and the stamp is on every UPDATE, not just an update of named columns', () => {
    const dir = path.join(ROOT, 'supabase/migrations');
    const all = stripSql(fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n'));
    const defs = [...all.matchAll(/create trigger guild_triggers_touch[\s\S]*?;/gi)].map(m => m[0].replace(/\s+/g, ' '));
    expect(defs.length).toBeGreaterThan(0);
    for (const d of defs) {
      expect(d).toMatch(/before update on guild_triggers for each row/i);
      expect(d).not.toMatch(/update of/i);
    }
    expect(all).toMatch(/new\.updated_at = now\(\)/i);
  });

  it('the bot serves whole rows: the read names no column list, so a new column flows through', () => {
    const fn = stripJs(sliceBlock(bot, 'async function _guildTriggersFor(', '\n}\n'));
    expect(fn).toContain("selectAllPaged('guild_triggers'");
    expect(fn).not.toMatch(/select=/);
    expect(fn).toMatch(/return \{ version: _guildTriggersVersion\(filtered\), triggers: filtered \}/);
  });
});
