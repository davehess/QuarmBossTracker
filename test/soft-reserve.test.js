// test/soft-reserve.test.js — Soft Reserve per raid (the guild lead, 2026-10-26; DECISIONS §448).
//
// The rules are pure (web/lib/softReserve.ts) and run for real here: the caps, when picks lock, what a pick must
// satisfy, who sees what, and the officer form. The page, the actions and the loader import the framework and the
// database, so their wiring is read as comment-stripped source (comments quote the code and would answer for it).
//
// Run: npx vitest run test/soft-reserve.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs, stripSql } from './_source-slice.js';
import {
  DEFAULT_RULES, checkAdd, checkRemove, chooseTargets, isLocked, normalizeRules, parseRulesForm, shownOn,
} from '../web/lib/softReserve.ts';
import { pickSignupCharacter } from '../web/lib/raidPlan.ts';
import { bringingFrom } from '../web/lib/raidMe.ts';
import { metaForPath } from '../web/lib/pageMeta.ts';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const src = (p) => stripJs(read(p));

const START = Date.parse('2026-10-29T00:30:00Z');
const BEFORE = START - 3600_000;
const AFTER = START + 60_000;
const drops = new Map([
  [200226, new Set([10241, 19079, 9469])],
  [221041, new Set([10127, 15844])],
]);
const ctx = (over = {}, nowMs = BEFORE) => ({
  rules: normalizeRules({ npc_ids: [200226, 221041], ...over }),
  eventStartMs: START, nowMs, drops, targets: [200226, 221041],
});

describe('the rules a row is held to', () => {
  it('an event with no row gets the defaults: on, five picks, counts, lock at the start', () => {
    const r = normalizeRules(null);
    expect(r).toEqual(DEFAULT_RULES);
    expect([r.enabled, r.per_person, r.per_boss, r.visibility, r.lock_mode]).toEqual([true, 5, null, 'counts', 'start']);
  });
  it('clamps a bad row back inside the table checks instead of breaking the page', () => {
    const r = normalizeRules({ per_person: 99, per_boss: 0, visibility: 'everyone', lock_mode: 'later', npc_ids: [5, 5, -1, 'x'] });
    expect([r.per_person, r.per_boss, r.visibility, r.lock_mode, r.npc_ids]).toEqual([20, 1, 'counts', 'start', [5]]);
  });
});

describe('when picks lock', () => {
  it('start: open before the raid, closed from its start', () => {
    const r = normalizeRules({ lock_mode: 'start' });
    expect(isLocked(r, START, BEFORE)).toBe(false);
    expect(isLocked(r, START, START)).toBe(true);
  });
  it('time: closed from lock_at, whatever the start', () => {
    const r = normalizeRules({ lock_mode: 'time', lock_at: new Date(START - 1800_000).toISOString() });
    expect(isLocked(r, START, START - 3600_000)).toBe(false);
    expect(isLocked(r, START, START - 900_000)).toBe(true);
  });
  it('time with no lock_at never locks by itself', () => {
    expect(isLocked(normalizeRules({ lock_mode: 'time' }), START, AFTER)).toBe(false);
  });
  it('first_loot and manual stay open past the start until `locked` is set', () => {
    for (const lock_mode of ['first_loot', 'manual']) {
      expect(isLocked(normalizeRules({ lock_mode }), START, AFTER)).toBe(false);
      expect(isLocked(normalizeRules({ lock_mode, locked: true }), START, BEFORE)).toBe(true);
    }
  });
  it('`locked` closes picks in every mode (the bot sets it at the first /loot)', () => {
    for (const lock_mode of ['start', 'time', 'first_loot', 'manual']) {
      expect(isLocked(normalizeRules({ lock_mode, locked: true }), START, BEFORE)).toBe(true);
    }
  });
});

describe('what a pick must satisfy', () => {
  it('accepts a drop of a target while open', () => {
    expect(checkAdd(ctx(), [], { npc_id: 200226, item_id: 10241 })).toEqual({ ok: true });
  });
  it('refuses when SR is off, locked, not a target, not a drop, or a repeat', () => {
    const add = { npc_id: 200226, item_id: 10241 };
    expect(checkAdd(ctx({ enabled: false }), [], add).reason).toBe('off');
    expect(checkAdd(ctx({}, AFTER), [], add).reason).toBe('locked');
    expect(checkAdd(ctx(), [], { npc_id: 999, item_id: 10241 }).reason).toBe('not-a-target');
    expect(checkAdd(ctx(), [], { npc_id: 200226, item_id: 10127 }).reason).toBe('not-a-drop');
    expect(checkAdd(ctx(), [add], add).reason).toBe('already');
  });
  it('caps picks per person for the one character', () => {
    const c = ctx({ per_person: 2 });
    const mine = [{ npc_id: 200226, item_id: 10241 }, { npc_id: 221041, item_id: 10127 }];
    const res = checkAdd(c, mine, { npc_id: 200226, item_id: 19079 });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('person-cap');
    expect(checkAdd(ctx({ per_person: 3 }), mine, { npc_id: 200226, item_id: 19079 }).ok).toBe(true);
  });
  it('caps picks per boss without touching another boss', () => {
    const c = ctx({ per_person: 5, per_boss: 1 });
    const mine = [{ npc_id: 200226, item_id: 10241 }];
    expect(checkAdd(c, mine, { npc_id: 200226, item_id: 19079 }).reason).toBe('boss-cap');
    expect(checkAdd(c, mine, { npc_id: 221041, item_id: 10127 }).ok).toBe(true);
  });
  it('per_person 0 allows none', () => {
    expect(checkAdd(ctx({ per_person: 0 }), [], { npc_id: 200226, item_id: 10241 }).reason).toBe('person-cap');
  });
  it('dropping a pick follows the lock too', () => {
    expect(checkRemove(ctx()).ok).toBe(true);
    expect(checkRemove(ctx({}, AFTER)).reason).toBe('locked');
  });
});

describe('who sees what (rule 5)', () => {
  it('counts: the page shows counts, the loot card shows names', () => {
    expect(shownOn('counts', 'page')).toBe('counts');
    expect(shownOn('counts', 'card')).toBe('names');
  });
  it('names: names everywhere', () => {
    expect(shownOn('names', 'page')).toBe('names');
    expect(shownOn('names', 'card')).toBe('names');
  });
  it('hidden: nothing on the page, only a count on the card', () => {
    expect(shownOn('hidden', 'page')).toBe('none');
    expect(shownOn('hidden', 'card')).toBe('counts');
  });
  it('officers always see names', () => {
    for (const v of ['names', 'counts', 'hidden']) expect(shownOn(v, 'officer')).toBe('names');
  });
});

describe('targets', () => {
  it('the officers\' picks win; with none, the fallback; with neither, none', () => {
    expect(chooseTargets(normalizeRules({ npc_ids: [1, 2] }), [9])).toEqual([1, 2]);
    expect(chooseTargets(normalizeRules({}), [9])).toEqual([9]);
    expect(chooseTargets(normalizeRules({}), [])).toEqual([]);
  });
});

describe('a pick belongs to the character the member brings (rule 1)', () => {
  const owned = [
    { name: 'Aldenmar', main_name: null, class: 'Warrior', active: true, rank: 'Raid Pack', hidden_from_lists: false },
    { name: 'Brackwyn', main_name: 'Aldenmar', class: 'Cleric', active: true, rank: 'Raid Pack', hidden_from_lists: false },
  ];
  it('an alt sign-up brings the alt, not the main', () => {
    expect(bringingFrom(owned, { status: 'going', class_name: 'Cleric' }).name).toBe('Brackwyn');
    expect(bringingFrom(owned, { status: 'going', class_name: 'Warrior' }).name).toBe('Aldenmar');
  });
  it('a sign-up that is not a yes brings no one, so there is nothing to pick for', () => {
    expect(bringingFrom(owned, { status: 'absence', class_name: 'Cleric' })).toBeNull();
    expect(bringingFrom(owned, null)).toBeNull();
  });
  it('the pick action works the character out on the server and never reads it from the browser', () => {
    const a = src('web/app/raid/sr/actions.ts');
    expect(a).toMatch(/loadBringing\(user\.id/);
    expect(a).not.toMatch(/character_name:\s*(character|name)\b/);
    expect(a).toMatch(/export async function setPick\(npcId: number, itemId: number, on: boolean\)/);
    expect(pickSignupCharacter).toBeTypeOf('function');
  });
});

describe('the officer form', () => {
  const form = (over = {}) => ({
    enabled: true, per_person: '5', per_boss: '', visibility: 'counts', npc_ids: [200226, 200226, 221041],
    lock_mode: 'start', lock_at: '', no_reserve: 'open', ...over,
  });
  it('parses a good form, dropping duplicate bosses', () => {
    const res = parseRulesForm(form());
    expect(res.ok).toBe(true);
    expect(res.rules.npc_ids).toEqual([200226, 221041]);
    expect(res.rules.per_boss).toBeNull();
  });
  it('tells a bad number instead of saving a clamped one', () => {
    expect(parseRulesForm(form({ per_person: '21' })).ok).toBe(false);
    expect(parseRulesForm(form({ per_person: 'five' })).ok).toBe(false);
    expect(parseRulesForm(form({ per_boss: '0' })).ok).toBe(false);
    expect(parseRulesForm(form({ per_boss: '11' })).ok).toBe(false);
    expect(parseRulesForm(form({ visibility: 'all' })).ok).toBe(false);
    expect(parseRulesForm(form({ lock_mode: 'time', lock_at: '' })).ok).toBe(false);
  });
  it('keeps lock_at only in time mode', () => {
    expect(parseRulesForm(form({ lock_mode: 'time', lock_at: '2026-10-28T23:00:00.000Z' })).rules.lock_at).toBe('2026-10-28T23:00:00.000Z');
    expect(parseRulesForm(form({ lock_mode: 'start', lock_at: '2026-10-28T23:00:00.000Z' })).rules.lock_at).toBeNull();
  });
  it('every officer action re-checks the role', () => {
    const a = src('web/app/admin/soft-reserve/actions.ts');
    expect(a.match(/await requireOfficer\(\)/g)?.length).toBe(2);
    expect(src('web/app/admin/soft-reserve/page.tsx')).toMatch(/await requireOfficer\(\)/);
  });
});

describe('the migration', () => {
  const sql = stripSql(read('supabase/migrations/20261026220000_soft_reserve.sql'));
  it('is idempotent, keyed on the event, and service-role only', () => {
    expect(sql).toMatch(/create table if not exists public\.sr_rules/);
    expect(sql).toMatch(/create table if not exists public\.sr_picks/);
    expect(sql).toMatch(/primary key \(event_id, character_name, npc_id, item_id\)/);
    expect(sql).toMatch(/create index if not exists sr_picks_event_item_idx/);
    expect(sql).toMatch(/alter table public\.sr_rules enable row level security/);
    expect(sql).toMatch(/alter table public\.sr_picks enable row level security/);
    expect(sql).not.toMatch(/create policy/i);
  });
  it('the event id is text, matching rh_events', () => {
    expect(sql).toMatch(/event_id\s+text primary key references public\.rh_events\(id\)/);
  });
});

describe('the page', () => {
  it('has its name and summary in the page and in pageMeta', () => {
    expect(metaForPath('/raid/sr').title).toBe('[beta] Soft Reserve');
    expect(metaForPath('/raid/sr').description).toMatch(/first claim/);
    expect(metaForPath('/admin/soft-reserve').title).toBe('[beta] Soft Reserve · Admin');
    expect(src('web/app/raid/sr/page.tsx')).toMatch(/title: '\[beta\] Soft Reserve'/);
  });
  it('is a [beta] page and links in from the raid night plan and Your flags', () => {
    expect(src('web/app/raid/sr/page.tsx')).toMatch(/<NewPageTag/);
    expect(src('web/app/pop/raid/page.tsx')).toMatch(/href="\/raid\/sr"/);
    expect(src('web/app/pop/raid/me/page.tsx')).toMatch(/href="\/raid\/sr"/);
  });
  it('the loader limits names to the viewer\'s surface', () => {
    const l = src('web/lib/softReserveLoad.ts');
    expect(l).toMatch(/shownOn\(base\.rules\.visibility, officer \? 'officer' : 'page'\)/);
    expect(l).toMatch(/names: shown === 'names' \? list : null/);
    expect(l).toMatch(/count: shown === 'none' \? null/);
  });
  it('never parses targets out of the Raid-Helper text', () => {
    expect(src('web/lib/softReserveLoad.ts')).not.toMatch(/description/);
  });
});
