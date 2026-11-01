// test/departed-members.test.js — the "left the Discord and still has access" notice (the guild lead, 2026-11-01:
// a banned member could not be locked from /admin/access). The pure rule runs for real; the action and the
// migration are held by comment-stripped source assertions.
// Run: npx vitest run test/departed-members.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs, stripSql } from './_source-slice.js';
import { flagDeparted } from '../web/lib/departedMembers.ts';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86_400_000).toISOString();
const row = (over = {}) => ({
  discord_id: '1001', user_id: 'u-1', nickname: 'Aldenmar', global_name: 'aldenmar_g',
  is_member: false, refreshed_at: daysAgo(1), merged_into_discord_id: null, ...over,
});
const flag = (members, extra = {}) => flagDeparted({ members, locks: [], liveMimicIds: [], now: NOW, ...extra });

describe('flagDeparted', () => {
  it('flags a recent leaver with a website login, named by nickname then global name', () => {
    const r = flag([row(), row({ discord_id: '1002', nickname: null })]);
    expect(r.map(x => x.name)).toEqual(['Aldenmar', 'aldenmar_g']);
    expect(r[0]).toMatchObject({ discordId: '1001', hasLogin: true, liveMimic: false });
  });
  it('ignores current members; the window is effectively "ever" because the sync re-stamps former members', () => {
    expect(flag([row({ is_member: true })])).toEqual([]);
    expect(flag([row({ refreshed_at: daysAgo(400) })])).toHaveLength(1);   // a leaver from a year ago with a login still counts
    expect(flag([row({ refreshed_at: daysAgo(29) })])).toHaveLength(1);
    expect(flag([row({ refreshed_at: null })])).toEqual([]);
  });
  it('excludes someone already under an active lockout, but not an expired one', () => {
    expect(flag([row()], { locks: [{ discord_id: '1001', until: null }] })).toEqual([]);
    expect(flag([row()], { locks: [{ discord_id: '1001', until: new Date(NOW + 86_400_000).toISOString() }] })).toEqual([]);
    expect(flag([row()], { locks: [{ discord_id: '1001', until: daysAgo(1) }] })).toHaveLength(1);
  });
  it('excludes rows merged into another member', () => {
    expect(flag([row({ merged_into_discord_id: '2002' })])).toEqual([]);
  });
  it('excludes a leaver with no login and no live Mimic session; a live session alone is enough', () => {
    expect(flag([row({ user_id: null })])).toEqual([]);
    const r = flag([row({ user_id: null })], { liveMimicIds: ['1001'] });
    expect(r[0]).toMatchObject({ hasLogin: false, liveMimic: true });
  });
  it('lists the newest departure first and caps the list', () => {
    const many = Array.from({ length: 30 }, (_, i) => row({ discord_id: String(5000 + i), refreshed_at: daysAgo(i % 20) }));
    const r = flag(many);
    expect(r).toHaveLength(20);
    expect(Date.parse(r[0].leftAt)).toBeGreaterThanOrEqual(Date.parse(r[19].leftAt));
  });
});

describe('lockMember (source)', () => {
  const src = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/admin/access/actions.ts'), 'utf8'));
  const lock = src.slice(src.indexOf('export async function lockMember'), src.indexOf('export async function unlockMember'));
  it('no longer filters the target on is_member', () => {
    expect(lock).not.toMatch(/is_member/);
  });
  it('still refuses officers, self and a missing reason', () => {
    expect(lock).toMatch(/roleNamesAreOfficer\(target/);
    expect(lock).toMatch(/err=self/);
    expect(lock).toMatch(/err=reason_required/);
  });
  it('ends web sessions through the rpc and records the count in the audit payload', () => {
    expect(lock).toMatch(/rpc\('end_member_web_sessions'/);
    expect(lock).toMatch(/web_sessions_ended/);
  });
});

describe('end_member_web_sessions migration', () => {
  const sql = stripSql(fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261101060000_end_member_web_sessions.sql'), 'utf8'));
  it('is security definer and deletes the auth sessions', () => {
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/delete from auth\.sessions where user_id = p_user_id/i);
  });
  it('is callable by service_role only', () => {
    expect(sql).toMatch(/revoke all on function public\.end_member_web_sessions\(uuid\) from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.end_member_web_sessions\(uuid\) to service_role/i);
    expect(sql).not.toMatch(/grant execute[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/i);
  });
});
