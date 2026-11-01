// test/admin-queue-scope.test.js — the officer review queue lists GUILD MEMBERS only, and shows it tersely.
//
// The guild lead, 2026-11-01: "admin review queue looks terrible with this being verbose" and "many of the
// users here are observed not being in our guild and don't need to be here".
//   · membership predicate (CLAUDE.md "Character identity scopes"): a Pack Member+ Discord role on the
//     linked account OR an OpenDKP rank of Raid Pack+; a departed account never passes; an alt rides on its main.
//   · chat is judged on /gu only (the RPC drops /rs, which carries other guilds).
//   · the banner is one line with the breakdown behind a <details>; each section shows its top 10.
//
// Names are invented (Corvale, Rethlan, ...). Comments are stripped before any text assertion.
//
// Run: npx vitest run test/admin-queue-scope.test.js

import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { ROOT, readSource, stripJs, stripSql } from './_source-slice.js';
import {
  computeGuildMembers, MEMBER_RANKS, splitTop, QUEUE_TOP, queueBannerLabel,
} from '../web/lib/adminQueueData.ts';

const ch = (name, extra = {}) => ({ name, rank: null, discord_id: null, main_name: null, ...extra });
const acct = (discord_id, role_names, is_member = true) => ({ discord_id, is_member, role_names });

describe('computeGuildMembers: the membership predicate', () => {
  it('Raid Pack and better count by rank; lower ranks and no rank do not', () => {
    expect(MEMBER_RANKS).toEqual(['Officer', 'Pack Leader', 'Raid Pack']);
    const { names } = computeGuildMembers([
      ch('Corvale', { rank: 'Raid Pack' }), ch('Rethlan', { rank: 'Officer' }), ch('Nyssara', { rank: 'Pack Leader' }),
      ch('Zarrin', { rank: 'Recruit' }), ch('Aldenmar', { rank: 'Raid Alt' }), ch('Brackwyn'),
    ], []);
    expect([...names].sort()).toEqual(['corvale', 'nyssara', 'rethlan']);
  });

  it('a Pack Member+ Discord role on the linked account counts, with or without a rank', () => {
    const { names, discords } = computeGuildMembers([
      ch('Corvale', { discord_id: '1' }), ch('Rethlan', { discord_id: '2' }), ch('Nyssara', { discord_id: '3' }),
    ], [acct('1', ['Pack Member']), acct('2', ['Visitor']), acct('3', [])]);
    expect([...names]).toEqual(['corvale']);
    expect([...discords]).toEqual(['1']);
  });

  it('a departed account never passes, even with a Raid Pack rank left in OpenDKP', () => {
    const { names, discords } = computeGuildMembers(
      [ch('Corvale', { rank: 'Raid Pack', discord_id: '9' }), ch('Rethlan', { rank: 'Raid Pack' })],
      [acct('9', ['Pack Member'], false)]);
    expect([...names]).toEqual(['rethlan']);
    expect(discords.has('9')).toBe(false);
  });

  it('an alt with no account of its own rides on its main; an alt of a non-member does not', () => {
    const { names } = computeGuildMembers([
      ch('Corvale', { rank: 'Raid Pack' }), ch('Corvalealt', { rank: 'Raid Alt', main_name: 'Corvale' }),
      ch('Zarrin'), ch('Zarrinalt', { main_name: 'Zarrin' }),
    ], []);
    expect([...names].sort()).toEqual(['corvale', 'corvalealt']);
  });

  it('a speaker with no character row at all is not a member', () => {
    expect(computeGuildMembers([ch('Corvale', { rank: 'Raid Pack' })], []).names.has('stranger')).toBe(false);
  });
});

describe('the 10-row cap', () => {
  it('shows the first QUEUE_TOP and keeps the rest behind Show all', () => {
    expect(QUEUE_TOP).toBe(10);
    const rows = Array.from({ length: 25 }, (_, i) => i);
    const { shown, rest } = splitTop(rows);
    expect(shown).toEqual(rows.slice(0, 10));
    expect(rest).toHaveLength(15);
    expect(splitTop([1, 2, 3]).rest).toEqual([]);
  });

  it('the page renders shown rows, then the rest inside a <details> "Show all N"', () => {
    const page = stripJs(readSource(path.join(ROOT, 'web', 'app', 'admin', 'queue', 'page.tsx')));
    expect(page).toMatch(/splitTop\(cat\.items\)/);
    expect(page).toMatch(/<Rows items=\{shown\}/);
    expect(page).toMatch(/<details[^>]*>\s*<summary[^>]*>Show all \{cat\.count\}<\/summary>\s*<Rows items=\{rest\}/);
    expect(page).not.toMatch(/cat\.items\.map/);                          // no uncapped list
    expect(page).toMatch(/<p className="mt-1 text-sm text-dim">\{cat\.blurb\}<\/p>/);   // one-line description
    // the intro paragraph sits inside the MoreInfo fold
    expect(page).toMatch(/<MoreInfo summary="More info">\s*<p[^>]*>\s*Cross-checks the roster/);
  });
});

describe('the banner is one line', () => {
  const banner = stripJs(readSource(path.join(ROOT, 'web', 'app', 'admin', 'AdminQueueBanner.tsx')));
  it('reads "🛠 Review queue · N to check" with an open link', () => {
    expect(queueBannerLabel(535)).toBe('🛠 Review queue · 535 to check');
    expect(banner).toMatch(/queueBannerLabel\(total\)/);
    expect(banner).toMatch(/href="\/admin\/queue"[^>]*>open →<\/Link>/);
  });
  it('keeps the per-check breakdown behind a <details>, not as chips in the line', () => {
    expect(banner).toMatch(/<details[\s\S]*<summary[\s\S]*queueBannerLabel\(total\)[\s\S]*<\/summary>[\s\S]*open\.map\(/);
    expect(banner).not.toMatch(/bg-zinc-800|rounded px-2 py-0\.5/);          // the old chip styling
    expect(banner).not.toMatch(/flex-wrap/);
  });
});

describe('every list is scoped to members', () => {
  const q = stripJs(readSource(path.join(ROOT, 'web', 'lib', 'admin-queue.ts')));
  it('one shared membership read feeds all six loaders', () => {
    expect(q).toMatch(/const membersP = readGuildMembers\(sb\)/);
    for (const fn of ['loadUnrosteredChatSpeakers', 'loadUnenrichableChatSpeakers', 'loadUnregisteredOpenDKP',
      'loadAwaitingOpenDKPClaim', 'loadPotentialMissingTicks', 'loadChatMisattribution']) {
      expect(q, fn).toMatch(new RegExp(`${fn}\\(sb(, speakersP)?, membersP\\)`));
    }
  });
  it('chat speakers, awaiting-claim and missed ticks are filtered by member NAME', () => {
    expect(q).toMatch(/members\.names\.has\(s\.speaker\.toLowerCase\(\)\) && !rostered/);
    expect(q).toMatch(/const speakers = allSpeakers\.filter\(s => s\.speaker && members\.names\.has/);
    expect(q).toMatch(/\.filter\(r => members\.names\.has\(r\.name\.toLowerCase\(\)\)\)/);
    expect(q).toMatch(/some\(ln => members\.names\.has\(ln\)\)\) continue/);
  });
  it('upload streams and misattribution are filtered by the uploader being a current member', () => {
    expect(q).toMatch(/allUploads\.filter\(u => !!u\.uploaded_by_discord_id && members\.discords\.has\(u\.uploaded_by_discord_id\)\)/);
    expect(q).toMatch(/guild\.discords\.has\(r\.uploader_discord_id\)/);
  });
  it('the chat-speaker aggregate reads /gu only', () => {
    const sql = stripSql(readSource(path.join(ROOT, 'supabase', 'migrations', '20261101120000_admin_queue_guild_chat_only.sql')));
    expect(sql).toMatch(/create or replace function public\.admin_queue_chat_speakers\(p_since timestamptz\)/);
    expect(sql).toMatch(/c\.channel = 'guild'/);
    expect(sql).not.toMatch(/'raid'/);
  });
});
