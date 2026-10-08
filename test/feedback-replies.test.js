// test/feedback-replies.test.js — a member's reply on wolfpack.quest/feedback/FB-<n>, and its trip to the
// report's Discord card.
//
// The guild lead, 2026-10-08: the status DM linked to the Discord card, which only officers can open, so a
// submitter could not say "not fixed for you". The page takes the reply (web/lib/feedbackReport.ts holds the
// rules), the bot's 10-minute loop posts it under the card (_feedbackRelayReplies; wording in
// utils/feedbackRefs.js). Behaviour tests: the real functions run against stubs.
//
// Run: npx vitest run test/feedback-replies.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, BOT_INDEX, ROOT, sliceBlock, stripJs, stripSql } from './_source-slice.js';
import {
  parseRefParam, statusWords, historyOf, cleanReply, canOpenReport, replyErrorText, REPLY_MAX,
} from '../web/lib/feedbackReport.ts';

const require = createRequire(import.meta.url);
const fr = require('../utils/feedbackRefs.js');

describe('which report a URL names', () => {
  it.each([['FB-12', 12], ['fb-12', 12], ['12', 12], [' 12 ', 12], ['FB%2D12', 12]])('%s -> %s', (raw, want) => {
    expect(parseRefParam(raw)).toBe(want);
  });
  it.each(['', '0', 'FB-', 'FB-0', '12abc', '1.5', '-3', 'FB-1234567', 'x12', '%E0%A4%A'])('%j is not a report', (raw) => {
    expect(parseRefParam(raw)).toBeNull();
  });
  it('a missing value is not a report either', () => {
    expect(parseRefParam(undefined)).toBeNull();
    expect(parseRefParam(null)).toBeNull();
  });
});

describe('who may open a report', () => {
  it('the submitter and officers; nobody else', () => {
    expect(canOpenReport('u1', 'u1', false)).toBe(true);
    expect(canOpenReport('u2', 'u1', false)).toBe(false);
    expect(canOpenReport('u2', 'u1', true)).toBe(true);
  });
  it('a viewer with no Discord id, or a report with no owner, opens nothing unless an officer', () => {
    expect(canOpenReport(null, 'u1', false)).toBe(false);
    expect(canOpenReport(null, null, false)).toBe(false);
    expect(canOpenReport('', '', false)).toBe(false);
    expect(canOpenReport('u1', null, false)).toBe(false);
    expect(canOpenReport(null, null, true)).toBe(true);
  });
});

describe('the status in plain words', () => {
  it('maps every status the platform writes, and an unknown one reads as new', () => {
    expect(statusWords('new').label).toBe('New');
    expect(statusWords('acked').label).toBe('Seen');
    expect(statusWords('scoped').label).toBe('Seen');
    expect(statusWords('on_beta').label).toBe('On the beta');
    expect(statusWords('addressed').label).toBe('Fixed and live');
    expect(statusWords('wont_fix').label).toBe('Closed');
    expect(statusWords('duplicate').label).toBe('Closed as a duplicate');
    expect(statusWords('something_new').label).toBe('New');
    expect(statusWords(null).label).toBe('New');
  });
});

describe('the status history', () => {
  // Real shape: the bot appends "<date> <status line> — <what changed>" (_feedbackAdvance + statusNote); an
  // officer's free-text note sits in the same column.
  const notes = [
    'asked about this on the call, do not tell them',
    '2026-10-07 🧪 On beta (aaaaaaa) — the HUD keeps its size after a resize',
    '2026-10-08 ✅ Implemented (bbbbbbb) — the HUD keeps its size; Mimic 2.7.10',
    '2026-10-08 ✅ Implemented',
  ].join('\n');

  it('shows the bot\'s lines in plain words and never an officer\'s note', () => {
    const h = historyOf(notes);
    expect(h).toEqual([
      { date: '2026-10-07', label: '🧪 On the beta', changed: 'the HUD keeps its size after a resize' },
      { date: '2026-10-08', label: '✅ Fixed and live', changed: 'the HUD keeps its size; Mimic 2.7.10' },
      { date: '2026-10-08', label: '✅ Fixed and live', changed: '' },
    ]);
    expect(JSON.stringify(h)).not.toMatch(/call|aaaaaaa|bbbbbbb/);
  });
  it('is empty for no notes', () => {
    expect(historyOf(null)).toEqual([]);
    expect(historyOf('')).toEqual([]);
  });
});

describe('a reply as typed', () => {
  it('trims, folds CRLF, and enforces the table\'s 2..2000 rule', () => {
    expect(cleanReply('  still broken for me \r\nafter the update  ')).toEqual({ ok: true, body: 'still broken for me \nafter the update' });
    expect(cleanReply('x')).toEqual({ ok: false, error: 'short' });
    expect(cleanReply('   ')).toEqual({ ok: false, error: 'short' });
    expect(cleanReply(undefined)).toEqual({ ok: false, error: 'short' });
    expect(cleanReply('ab').ok).toBe(true);
    expect(cleanReply('a'.repeat(REPLY_MAX)).ok).toBe(true);
    expect(cleanReply('a'.repeat(REPLY_MAX + 1))).toEqual({ ok: false, error: 'long' });
  });
  it('error text comes from a fixed list, never from the URL', () => {
    expect(replyErrorText('short')).toBe('Write a little more first.');
    expect(replyErrorText('<b>hi</b>')).toBeNull();
    expect(replyErrorText('constructor')).toBeNull();
    expect(replyErrorText(undefined)).toBeNull();
  });
});

describe('the line posted under the card', () => {
  it('names who wrote it: the submitter or an officer', () => {
    expect(fr.formatReplyPost({ ref: 12, fromSubmitter: true, body: 'still broken' })).toBe('💬 Reply from the submitter on FB-12: still broken');
    expect(fr.formatReplyPost({ ref: 12, fromSubmitter: false, body: 'try 2.7.11' })).toBe('💬 Reply from an officer on FB-12: try 2.7.11');
  });
  it('cuts a long body to fit a Discord message', () => {
    const out = fr.formatReplyPost({ ref: 12, fromSubmitter: true, body: 'x'.repeat(5000) });
    expect(out.length).toBeLessThanOrEqual(2000);
    expect(out.endsWith('…')).toBe(true);
  });
  it('links the report page from the DM by number', () => {
    expect(fr.reportUrl(12)).toBe('https://wolfpack.quest/feedback/FB-12');
    expect(fr.reportUrl(null)).toBe('');
  });
});

// The bot's relay, on the real function (index.js is not importable: it boots the client).
describe('_feedbackRelayReplies', () => {
  const src = readSource(BOT_INDEX);
  const block = sliceBlock(src, 'async function _feedbackRelayReplies(', '\n}\n');

  function rig({ replies, cards, sendFails = false, noTable = false, claimFails = false } = {}) {
    const store = { replies: replies.map(r => ({ ...r })) };
    const log = { sent: [], selects: [] };
    const supabase = {
      isEnabled: () => true,
      select: async (table, q) => {
        log.selects.push([table, q]);
        if (table === 'feedback_replies') return noTable ? null : store.replies.filter(r => !r.relayed_at).slice(0, 20);
        const id = /id=eq\.([^&]+)/.exec(q)[1];
        return cards[decodeURIComponent(id)] ? [cards[decodeURIComponent(id)]] : [];
      },
      update: async (table, q, patch) => {
        const id = decodeURIComponent(/id=eq\.([^&]+)/.exec(q)[1]);
        const row = store.replies.find(r => r.id === id);
        if (claimFails) return null;
        if (/relayed_at=is\.null/.test(q) && row.relayed_at) return [];
        Object.assign(row, patch);
        return [row];
      },
    };
    const thread = { send: async (o) => { if (sendFails) throw new Error('Missing Access'); log.sent.push(o); } };
    const client = { channels: { fetch: async () => thread } };
    const run = new Function('require', 'process', 'console', block + '\nreturn _feedbackRelayReplies;')(
      (m) => ({ './utils/supabase': supabase, './utils/feedbackRefs': fr })[m],
      { env: { FEEDBACK_THREAD_ID: 't1' } }, { warn() {} });
    return { run: () => run(client), store, log };
  }
  const cards = { f1: { ref: 12, submitter_discord_id: 'sub', discord_msg_id: 'm1' } };
  const base = [
    { id: 'r1', feedback_id: 'f1', author_discord_id: 'sub', body: 'still broken', relayed_at: null },
    { id: 'r2', feedback_id: 'f1', author_discord_id: 'off', body: 'try 2.7.11', relayed_at: null },
  ];

  it('posts each reply under the card, labelled by who wrote it, with no pings, and stamps it', async () => {
    const { run, store, log } = rig({ replies: base, cards });
    await run();
    expect(log.sent.map(s => s.content)).toEqual([
      '💬 Reply from the submitter on FB-12: still broken',
      '💬 Reply from an officer on FB-12: try 2.7.11',
    ]);
    expect(log.sent.every(s => s.allowedMentions.parse.length === 0)).toBe(true);
    expect(log.sent[0].reply).toEqual({ messageReference: 'm1', failIfNotFound: false });
    expect(store.replies.every(r => r.relayed_at)).toBe(true);
  });

  it('a second pass posts nothing: a relayed reply is not relayed again', async () => {
    const { run, log } = rig({ replies: base, cards });
    await run();
    await run();
    expect(log.sent).toHaveLength(2);
  });

  it('a card with no Discord message yet still gets the line, just not as a reply', async () => {
    const { run, log } = rig({ replies: [base[0]], cards: { f1: { ...cards.f1, discord_msg_id: null } } });
    await run();
    expect(log.sent).toHaveLength(1);
    expect(log.sent[0].reply).toBeUndefined();
  });

  it('a Discord failure never throws out of the pass and leaves the reply for the next one', async () => {
    const { run, store } = rig({ replies: base, cards, sendFails: true });
    await expect(run()).resolves.toBeUndefined();
    expect(store.replies.every(r => r.relayed_at === null)).toBe(true);
  });

  it('a stamp that cannot be written posts nothing (no repost loop)', async () => {
    const { run, log } = rig({ replies: base, cards, claimFails: true });
    await run();
    expect(log.sent).toHaveLength(0);
  });

  it('a missing table, an empty queue or an unknown report end quietly', async () => {
    await expect(rig({ replies: base, cards, noTable: true }).run()).resolves.toBeUndefined();
    const none = rig({ replies: [], cards });
    await none.run();
    expect(none.log.sent).toHaveLength(0);
    const orphan = rig({ replies: base, cards: {} });
    await orphan.run();
    expect(orphan.log.sent).toHaveLength(0);
    expect(orphan.store.replies.every(r => !r.relayed_at)).toBe(true);
  });
});

// Wiring that behaviour cannot show: the loop runs it, and the table is shaped as the page expects.
describe('wiring', () => {
  it('the bot schedules the relay on a timer', () => {
    const code = stripJs(readSource(BOT_INDEX));
    expect(code).toMatch(/setInterval\(\(\) => _feedbackRelayReplies\(readyClient\)/);
  });

  it('the migration creates the table with the columns, the length rule and RLS on, and no policy', () => {
    const sql = stripSql(fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261008020000_feedback_replies.sql'), 'utf8'));
    expect(sql).toMatch(/create table if not exists public\.feedback_replies/);
    expect(sql).toMatch(/feedback_id\s+uuid not null references public\.feedback\(id\) on delete cascade/);
    expect(sql).toMatch(/check \(length\(body\) between 2 and 2000\)/);
    expect(sql).toMatch(/relayed_at\s+timestamptz null/);
    expect(sql).toMatch(/enable row level security/);
    expect(sql).not.toMatch(/create policy/i);
  });

  it('the reply action re-checks access on the server before it writes', () => {
    const act = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/feedback/[ref]/actions.ts'), 'utf8'));
    expect(act.indexOf('openReport(viewer, ref)')).toBeGreaterThan(-1);
    expect(act.indexOf('openReport(viewer, ref)')).toBeLessThan(act.indexOf(".from('feedback_replies')"));
    expect(act).toMatch(/viewer\.discordId/);
  });
});
