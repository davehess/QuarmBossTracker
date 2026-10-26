// test/pop-rescan-web.test.js — the website's half of "Sync from my logs" (the guild lead, 2026-10-26).
//
// The rules (web/lib/popRescan.ts) run for real with every outside thing faked: the member, their characters, their
// open rows. The button and its polling are read as stripped source (stripJs: a comment must not answer for the
// code), and so is the migration (stripSql).
//
// Run: npx vitest run test/pop-rescan-web.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs, stripSql } from './_source-slice.js';
import {
  requestRescan, rescanView, shouldPoll, relevantRow, stillOpen,
  DEFAULT_DAYS, MAX_DAYS, POLL_MS, POLL_GIVE_UP_MS, PENDING_TTL_MS, STALE_TAKEN_MS,
} from '../web/lib/popRescan.ts';

const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const NOW = new Date('2026-10-26T20:00:00Z');
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();

function deps(over = {}) {
  const inserted = [];
  const d = {
    guildId: 'wolfpack',
    userId: async () => 'user-1',
    discordId: async () => 'D1',
    owned: async () => ['Aldenmar', 'Brackwyn'],
    open: async () => [],
    insert: async (row) => { inserted.push(row); return { id: 41 }; },
    now: () => NOW,
    ...over,
  };
  return { d, inserted };
}

describe('filing a request: yours, valid, one at a time', () => {
  it('files one row for the signed-in member, for a character they own, under its real casing, 14 days by default', async () => {
    const { d, inserted } = deps();
    const res = await requestRescan(d, 'aldenmar');
    expect(res).toEqual({ ok: true, id: 41, already: false });
    expect(inserted).toEqual([{ guild_id: 'wolfpack', discord_id: 'D1', character: 'Aldenmar', days: DEFAULT_DAYS }]);
    expect(DEFAULT_DAYS).toBe(14);
  });
  it('null means every character my Mimic has a log for', async () => {
    const { d, inserted } = deps();
    expect((await requestRescan(d, null, 30)).ok).toBe(true);
    expect(inserted[0]).toMatchObject({ character: null, days: 30 });
  });
  it('someone else\'s character files nothing, and nothing is read first', async () => {
    let read = false;
    const { d, inserted } = deps({ open: async () => { read = true; return []; } });
    expect(await requestRescan(d, 'Zarrin')).toEqual({ ok: false, error: 'not your character' });
    expect(inserted).toEqual([]);
    expect(read).toBe(false);
  });
  it('signed out, or signed in with no linked Discord id, files nothing', async () => {
    const a = deps({ userId: async () => null });
    expect(await requestRescan(a.d, 'Aldenmar')).toEqual({ ok: false, error: 'not signed in' });
    const b = deps({ discordId: async () => null });
    expect(await requestRescan(b.d, 'Aldenmar')).toEqual({ ok: false, error: 'not signed in' });
    expect(a.inserted.length + b.inserted.length).toBe(0);
  });
  it('bad requests: days must be a whole number from 1 to 60; the character a short string or null', async () => {
    const { d, inserted } = deps();
    for (const [c, days] of [['Aldenmar', 0], ['Aldenmar', MAX_DAYS + 1], ['Aldenmar', 1.5], ['Aldenmar', '14'], ['Aldenmar', NaN],
      ['', 14], [undefined, 14], [7, 14], ['x'.repeat(65), 14]]) {
      expect(await requestRescan(d, c, days), `${String(c)} ${String(days)}`).toEqual({ ok: false, error: 'bad request' });
    }
    expect((await requestRescan(d, 'Aldenmar', 1)).ok).toBe(true);
    expect((await requestRescan(d, 'Aldenmar', MAX_DAYS)).ok).toBe(true);
    expect(inserted).toHaveLength(2);
    expect(MAX_DAYS).toBe(60);
  });
  it('rate limit: a member with a request already open gets that request back and nothing new is filed', async () => {
    for (const open of [
      [{ id: 5, status: 'pending', requested_at: ago(2 * 60_000), taken_at: null }],
      [{ id: 5, status: 'taken', requested_at: ago(10 * 60_000), taken_at: ago(5 * 60_000) }],
    ]) {
      const { d, inserted } = deps({ open: async () => open });
      expect(await requestRescan(d, 'Aldenmar')).toEqual({ ok: true, id: 5, already: true });
      expect(inserted).toEqual([]);
    }
  });
  it('a request nobody\'s Mimic ever took (24 h) or an agent that died mid-read (30 min) does not lock the member out', async () => {
    const stalePending = [{ id: 5, status: 'pending', requested_at: ago(PENDING_TTL_MS + 60_000), taken_at: null }];
    const staleTaken = [{ id: 6, status: 'taken', requested_at: ago(2 * 3600_000), taken_at: ago(STALE_TAKEN_MS + 60_000) }];
    for (const open of [stalePending, staleTaken]) {
      const { d, inserted } = deps({ open: async () => open });
      expect(await requestRescan(d, 'Aldenmar')).toEqual({ ok: true, id: 41, already: false });
      expect(inserted).toHaveLength(1);
    }
  });
  it('a table that cannot be read, or an insert that fails, is an error, not a silent success', async () => {
    expect((await requestRescan(deps({ open: async () => null }).d, 'Aldenmar')).ok).toBe(false);
    expect((await requestRescan(deps({ insert: async () => ({ error: 'boom' }) }).d, 'Aldenmar')).ok).toBe(false);
  });
  it('stillOpen is the shared definition of "waiting"', () => {
    const n = NOW.getTime();
    expect(stillOpen({ status: 'pending', requested_at: ago(1000), taken_at: null }, n)).toBe(true);
    expect(stillOpen({ status: 'taken', requested_at: ago(1000), taken_at: null }, n)).toBe(false);
    expect(stillOpen({ status: 'done', requested_at: ago(1000), taken_at: null }, n)).toBe(false);
  });
});

describe('what the button says', () => {
  const base = { id: 1, character: null, days: 14, requested_at: ago(60_000), taken_at: null, done_at: null, found: null };
  it('requested → waiting for Mimic, then reading, then "done · N flag lines read"', () => {
    expect(rescanView(null)).toEqual({ kind: 'idle' });
    expect(rescanView({ ...base, status: 'pending' }).text).toBe('requested · waiting for Mimic (it checks every few minutes)');
    expect(rescanView({ ...base, status: 'taken' }).kind).toBe('reading');
    expect(rescanView({ ...base, status: 'done', found: 12 }).text).toBe('done · 12 flag lines read');
    expect(rescanView({ ...base, status: 'done', found: 1 }).text).toBe('done · 1 flag line read');
    expect(rescanView({ ...base, status: 'done', found: null }).text).toBe('done · 0 flag lines read');
    expect(rescanView({ ...base, status: 'failed' }).kind).toBe('failed');
  });
  it('after the browser gives up, a waiting request says Mimic may be closed instead of waiting for ever', () => {
    expect(rescanView({ ...base, status: 'pending' }, true).kind).toBe('stale');
    expect(rescanView({ ...base, status: 'done', found: 3 }, true).kind).toBe('done');
  });
  it('polls only while a request is open and inside 15 minutes', () => {
    const t0 = 1_000_000;
    expect(shouldPoll({ status: 'pending' }, t0, t0 + POLL_GIVE_UP_MS - 1)).toBe(true);
    expect(shouldPoll({ status: 'taken' }, t0, t0 + 1000)).toBe(true);
    expect(shouldPoll({ status: 'pending' }, t0, t0 + POLL_GIVE_UP_MS)).toBe(false);
    expect(shouldPoll({ status: 'done' }, t0, t0)).toBe(false);
    expect(shouldPoll({ status: 'failed' }, t0, t0)).toBe(false);
    expect(shouldPoll(null, t0, t0)).toBe(false);
    expect(POLL_MS).toBe(20_000);
    expect(POLL_GIVE_UP_MS).toBe(15 * 60_000);
  });
  it('the newest row shows while open or for an hour after it finished; an older one is a closed matter', () => {
    const n = NOW.getTime();
    expect(relevantRow([], n)).toBeNull();
    expect(relevantRow([{ ...base, status: 'pending' }], n)?.status).toBe('pending');
    expect(relevantRow([{ ...base, status: 'done', done_at: ago(30 * 60_000) }], n)?.status).toBe('done');
    expect(relevantRow([{ ...base, status: 'done', done_at: ago(61 * 60_000) }], n)).toBeNull();
  });
});

describe('the button (stripped source)', () => {
  const btn = stripJs(src('web/app/pop/raid/me/SyncFromLogs.tsx'));
  const act = stripJs(src('web/app/pop/raid/me/rescanActions.ts'));
  it('polls with the member\'s own browser session, not a server action: no function invocation per poll', () => {
    expect(btn).toMatch(/supabaseBrowser\(\)/);
    expect(btn).toMatch(/from\('pop_rescan_requests'\)\.select\(COLUMNS\)/);
    expect(btn).toMatch(/limit\(1\)/);
    // the only server action it imports is the one that files the request
    expect(btn).toMatch(/import \{ requestLogRescan \} from '\.\/rescanActions';/);
    expect(btn.match(/await requestLogRescan\(/g)).toHaveLength(1);
  });
  it('asks every 20 s only while open, skips while the tab is hidden, and stops after 15 minutes', () => {
    expect(btn).toMatch(/setInterval\(\(\) => \{/);
    expect(btn).toMatch(/\}, POLL_MS\);/);
    expect(btn).toMatch(/Date\.now\(\) - startedAt\.current >= POLL_GIVE_UP_MS\) \{ setGaveUp\(true\); clearInterval\(id\); return; \}/);
    expect(btn).toMatch(/document\.hidden\) return;/);
    expect(btn).toMatch(/if \(!open\) return;/);
    expect(btn).toMatch(/return \(\) => clearInterval\(id\);/);
  });
  it('tells the page once when an open request turns done', () => {
    expect(btn).toMatch(/wasOpen\.current && row\?\.status === 'done'\) onDone\?\.\(row\.found \?\? 0\)/);
  });
  it('the action is a server action: ownership and the one-open rule come from the shared rules, rows written by the service role', () => {
    expect(src('web/app/pop/raid/me/rescanActions.ts').startsWith("'use server';")).toBe(true);
    expect(act).toMatch(/requestRescan\(\{/);
    expect(act).toMatch(/ownedCharacters\(userId\)/);
    expect(act).toMatch(/from\('wolfpack_members'\)\.select\('discord_id'\)\.eq\('user_id', userId\)/);
    expect(act).toMatch(/\.in\('status', \['pending', 'taken'\]\)/);
    expect(act).toMatch(/days: number = DEFAULT_DAYS/);
  });
});

describe('the migration (stripped SQL)', () => {
  const file = 'supabase/migrations/20261026170000_pop_rescan_requests.sql';
  const sql = stripSql(src(file));
  it('is idempotent', () => {
    expect(sql).toMatch(/create table if not exists public\.pop_rescan_requests/i);
    expect(sql).toMatch(/create index if not exists pop_rescan_requests_member_status_idx\s+on public\.pop_rescan_requests \(guild_id, discord_id, status\)/i);
    expect(sql).toMatch(/drop policy if exists pop_rescan_requests_read_own on public\.pop_rescan_requests/i);
    expect(sql).not.toMatch(/\bdrop table\b|\bdelete from\b|\balter table[^;]*\bdrop\b/i);
  });
  it('has the columns and the status check the bot and the page rely on', () => {
    for (const col of ['id', 'guild_id', 'discord_id', 'character', 'days', 'status', 'requested_at', 'taken_at', 'done_at', 'found']) {
      expect(sql, col).toMatch(new RegExp(`\\n\\s+${col}\\s`));
    }
    expect(sql).toMatch(/status\s+text\s+not null default 'pending' check \(status in \('pending', 'taken', 'done', 'failed'\)\)/i);
    expect(sql).toMatch(/days\s+int\s+not null default 14 check \(days between 1 and 60\)/i);
    expect(sql).toMatch(/character\s+text,/i);
  });
  it('lets a signed-in member read only their own rows, and nobody but the service role write', () => {
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).toMatch(/for select to authenticated/i);
    expect(sql).toMatch(/wm\.discord_id = pop_rescan_requests\.discord_id\s+and wm\.user_id\s+= auth\.uid\(\)/i);
    expect(sql).not.toMatch(/for (insert|update|delete|all)/i);
  });
});
