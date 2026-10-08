// The Quarm patch notes mirror (the guild lead, 2026-10-04: "1175117242682331146 is the Quarm patch notes
// channel id in our discord. pull everything from there"): every Quarm post in that channel (the followed
// channels' webhook posts, not members' messages) is stored in quarm_patch_notes, new and edited posts as
// they arrive, and a sweep every 6 hours fills the history.
//
// Runs the bot's REAL mapper, sweep and live writer (sliced out of index.js) against a fake channel and
// an in-memory Supabase. The wiring (the two listeners, the schedule) and the migration are checked as
// text, with comments stripped.
// Run: npx vitest run test/quarm-patch-notes.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, stripJs, stripSql } from './_source-slice.js';

const bot = readSource(path.join(ROOT, 'index.js'));
const block = sliceBlock(bot, 'const _QUARM_NOTES_CHANNEL_ID',
  "console.warn('[quarm-notes] live upsert failed:', err?.message); }\n}");

const BASE = 1_000_000_000_000_000_000n;
const idOf = (i) => String(BASE + BigInt(i));
const T0 = Date.UTC(2026, 0, 1);

// A Discord message as discord.js hands it over: a Date for each timestamp, Maps for attachments.
// Quarm's posts reach the channel through a follow webhook, so the default message carries a webhookId;
// a member's message is `mk(i, { webhookId: null })`.
const mk = (i, over = {}) => ({
  id: idOf(i), channelId: 'CH', createdAt: new Date(T0 + i * 60_000), editedAt: null,
  content: `note ${i}`, embeds: [], attachments: new Map(), partial: false, webhookId: 'wh',
  author: { username: 'Quarm Hook', globalName: null }, member: null, ...over,
});

// PostgREST answers timestamptz as `...+00:00` with microseconds, not as `Z`: the sweep's edit check has to
// compare instants, not strings.
const pgTs = (iso) => (iso ? new Date(iso).toISOString().replace(/\.(\d{3})Z$/, '.$1000+00:00') : null);

function harness({ total = 250, env = {} } = {}) {
  const penv = { MESSAGE_CONTENT_INTENT: '1', ...env };
  const logs = { warn: [], log: [] };
  const fakeConsole = { warn: (...a) => logs.warn.push(a.join(' ')), log: (...a) => logs.log.push(a.join(' ')) };

  const db = { notes: new Map(), kv: new Map(), upserts: [], dels: [], conflict: new Set(), enabled: true,
    failKvRead: false, failNotesSelect: false, failNotesUpsert: false, throwOnNotesUpsert: false };
  const supabase = {
    isEnabled: () => db.enabled,
    select: async (table, qs) => {
      if (table === 'bot_kv') {
        if (db.failKvRead) return null;
        const key = /key=eq\.([^&]+)/.exec(qs)[1];
        return db.kv.has(key) ? [{ value: db.kv.get(key) }] : [];
      }
      if (db.failNotesSelect) return null;
      const ids = /message_id=in\.\(([^)]*)\)/.exec(qs)[1].split(',');
      return ids.filter(id => db.notes.has(id)).map(id => {
        const r = db.notes.get(id);
        return { message_id: id, edited_at: pgTs(r.edited_at), content_missing: r.content_missing };
      });
    },
    upsert: async (table, rows, onConflict) => {
      if (table === 'bot_kv') { for (const r of rows) db.kv.set(r.key, r.value); return rows; }
      if (db.throwOnNotesUpsert) throw new Error('socket hang up');
      if (db.failNotesUpsert) return null;
      db.conflict.add(onConflict);
      db.upserts.push(rows.map(r => r.message_id));
      for (const r of rows) db.notes.set(r.message_id, r);
      return rows;
    },
    del: async (table, qs) => {
      const ids = /message_id=in\.\(([^)]*)\)/.exec(qs)[1].split(',');
      db.dels.push(ids);
      for (const id of ids) db.notes.delete(id);
      return null;   // return=minimal: an empty body, the same as a failure
    },
  };

  // The channel: messages ascending by id, served newest-first like the API.
  const ch = { all: [], index: new Map(), fetches: [], blank: false, failOnCall: 0 };
  const push = (m) => { ch.index.set(m.id, ch.all.length); ch.all.push(m); };
  for (let i = 1; i <= total; i++) push(mk(i));
  const strip = (m) => ({ ...m, content: '', embeds: [], attachments: new Map() });
  const channel = {
    messages: {
      fetch: async (opts) => {
        ch.fetches.push(opts);
        if (ch.failOnCall && ch.fetches.length === ch.failOnCall) throw new Error('503 Service Unavailable');
        const end = opts.before ? ch.index.get(opts.before) : ch.all.length;
        const page = ch.all.slice(Math.max(0, end - opts.limit), end).reverse();
        return new Map(page.map(m => [m.id, ch.blank ? strip(m) : m]));
      },
    },
  };
  const chan = { error: null, none: false, asked: [] };
  const client = {
    channels: { fetch: async (id) => {
      chan.asked.push(id);
      if (chan.error) throw new Error(chan.error);
      return chan.none ? null : channel;
    } },
  };

  // eslint-disable-next-line no-new-func
  const fns = new Function('require', 'client', 'process', 'console',
    block + '\nreturn { _quarmNoteRow, _syncQuarmPatchNotes, _quarmNoteLive };')(
    (m) => ({ './utils/supabase': supabase })[m], client, { env: penv }, fakeConsole);
  const status = () => db.kv.get('quarm_patch_notes_sync');
  return { ...fns, db, ch, chan, logs, penv, status, push };
}

describe('the row mapper', () => {
  const { _quarmNoteRow: row } = harness({ total: 0 });

  it('takes content, ids and times from the message; a webhook post is authored by its webhook name', () => {
    const r = row(mk(7, { content: 'Patch 1', editedAt: new Date(T0 + 5), webhookId: 'w1' }));
    expect(r).toEqual({
      message_id: idOf(7), channel_id: 'CH', posted_at: new Date(T0 + 7 * 60_000).toISOString(),
      edited_at: new Date(T0 + 5).toISOString(), author: 'Quarm Hook', content: 'Patch 1',
      embeds: [], attachments: [], content_missing: false,
    });
    expect(row(mk(8)).edited_at).toBeNull();
  });

  it('prefers a member display name, then the global name, then the username', () => {
    expect(row(mk(1, { member: { displayName: 'Nick' }, author: { username: 'u', globalName: 'G' } })).author).toBe('Nick');
    expect(row(mk(1, { author: { username: 'u', globalName: 'G' } })).author).toBe('G');
    expect(row(mk(1, { author: { username: 'u' } })).author).toBe('u');
    expect(row(mk(1, { author: null })).author).toBeNull();
  });

  it('flattens an embed to title, description, url, name/value fields, footer text and author name', () => {
    const r = row(mk(2, { content: '', embeds: [
      { title: 'Patch Notes', description: 'Body', url: 'https://x/p', color: 5, timestamp: 'z',
        fields: [{ name: 'F1', value: 'V1', inline: true }, { name: 'F2', value: 'V2', inline: false }],
        footer: { text: 'foot', iconURL: 'https://i' }, author: { name: 'Quarm', url: 'https://a', iconURL: 'https://b' } },
      { description: 'only a description' },
    ] }));
    expect(r.embeds).toEqual([
      { title: 'Patch Notes', description: 'Body', url: 'https://x/p',
        fields: [{ name: 'F1', value: 'V1' }, { name: 'F2', value: 'V2' }], footer: 'foot', author: 'Quarm' },
      { title: null, description: 'only a description', url: null, fields: [], footer: null, author: null },
    ]);
    expect(r.content_missing).toBe(false);
  });

  it('flattens attachments to name, url and contentType', () => {
    const r = row(mk(3, { content: '', attachments: new Map([
      ['a', { name: 'notes.png', url: 'https://cdn/notes.png', contentType: 'image/png', size: 9 }],
      ['b', { name: 'x.txt', url: 'https://cdn/x.txt' }],
    ]) }));
    expect(r.attachments).toEqual([
      { name: 'notes.png', url: 'https://cdn/notes.png', contentType: 'image/png' },
      { name: 'x.txt', url: 'https://cdn/x.txt', contentType: null },
    ]);
  });

  it('flags content_missing only when content, embeds AND attachments are all empty', () => {
    const blank = { content: '', embeds: [], attachments: new Map() };
    expect(row(mk(4, blank)).content_missing).toBe(true);
    expect(row(mk(4, { ...blank, content: 'text' })).content_missing).toBe(false);
    expect(row(mk(4, { ...blank, embeds: [{ title: 't' }] })).content_missing).toBe(false);
    expect(row(mk(4, { ...blank, attachments: new Map([['a', { name: 'n', url: 'u' }]]) })).content_missing).toBe(false);
    expect(row({ ...mk(4), content: undefined, embeds: undefined, attachments: undefined }).content_missing).toBe(true);
  });
});

describe('the sweep', () => {
  it('reads the channel it was told, by default the guild lead\'s id', async () => {
    const h = harness({ total: 3 });
    await h._syncQuarmPatchNotes();
    expect(h.chan.asked).toEqual(['1175117242682331146']);
    const h2 = harness({ total: 3, env: { QUARM_PATCH_NOTES_CHANNEL_ID: '42' } });
    await h2._syncQuarmPatchNotes();
    expect(h2.chan.asked).toEqual(['42']);
  });

  it('first run takes everything: 250 messages in 3 pages of 100, 100, 50', async () => {
    const h = harness({ total: 250 });
    await h._syncQuarmPatchNotes();
    expect(h.ch.fetches).toEqual([
      { limit: 100, cache: false },
      { limit: 100, before: idOf(151), cache: false },
      { limit: 100, before: idOf(51), cache: false },
    ]);
    expect(h.db.notes.size).toBe(250);
    expect(h.db.upserts.map(b => b.length)).toEqual([100, 100, 50]);
    expect([...h.db.conflict]).toEqual(['message_id']);
    expect(h.db.notes.get(idOf(250)).content).toBe('note 250');
    expect(h.status()).toMatchObject({ fetched: 250, new: 250, stored: 250, content_missing: 0, complete: true, resume_before: null });
    expect(h.status().error).toBeUndefined();
    expect(h.status().last_run).toMatch(/^\d{4}-\d\d-\d\dT/);
    for (const r of h.db.notes.values()) expect(r.fetched_at).toMatch(/^\d{4}-/);
  });

  it('keeps only Quarm\'s webhook posts: members\' messages in the channel are never stored', async () => {
    const h = harness({ total: 0 });
    // 150 messages, every third one a member talking (no webhookId).
    for (let i = 1; i <= 150; i++) h.push(mk(i, i % 3 === 0 ? { webhookId: null, content: 'member chat' } : {}));
    await h._syncQuarmPatchNotes();
    expect(h.db.notes.size).toBe(100);
    for (const r of h.db.notes.values()) expect(r.content).not.toBe('member chat');
    expect(h.status()).toMatchObject({ fetched: 150, new: 100, complete: true });
    // A later run with nothing new stops on the first page even though its oldest message is a member's.
    h.ch.fetches.length = 0;
    await h._syncQuarmPatchNotes();
    expect(h.ch.fetches).toHaveLength(1);
    // A page of nothing but members' messages is read past, not mistaken for stored territory or written.
    const h2 = harness({ total: 0 });
    for (let i = 1; i <= 100; i++) h2.push(mk(i));
    for (let i = 101; i <= 200; i++) h2.push(mk(i, { webhookId: null }));
    await h2._syncQuarmPatchNotes();
    expect(h2.db.notes.size).toBe(100);
    expect(h2.ch.fetches).toHaveLength(3);
  });

  it('removes the members\' messages an earlier sweep stored: one full walk after the upgrade, then incremental', async () => {
    const h = harness({ total: 0 });
    for (let i = 1; i <= 150; i++) h.push(mk(i, i % 3 === 0 ? { webhookId: null, content: 'member chat' } : {}));
    // What bot 3.1.199 left: every message stored, the history marked complete, no feed_only flag.
    for (const m of h.ch.all) h.db.notes.set(m.id, h._quarmNoteRow(m));
    h.db.kv.set('quarm_patch_notes_sync', { complete: true, message_content_intent: true });
    await h._syncQuarmPatchNotes();
    expect(h.ch.fetches).toHaveLength(2);                 // past the stored first page, to the start
    expect(h.db.notes.size).toBe(100);
    for (const r of h.db.notes.values()) expect(r.content).not.toBe('member chat');
    expect(h.db.dels.flat()).toContain(idOf(3));          // a stray on the second page went too
    expect(h.status()).toMatchObject({ complete: true, feed_only: true, new: 0, stored: 0 });
    h.ch.fetches.length = 0;
    await h._syncQuarmPatchNotes();
    expect(h.ch.fetches).toHaveLength(1);
  });

  it('a later run with 3 new messages fetches ONE page and stops', async () => {
    const h = harness({ total: 250 });
    await h._syncQuarmPatchNotes();
    h.db.upserts.length = 0; h.ch.fetches.length = 0;
    for (const i of [251, 252, 253]) h.push(mk(i));
    await h._syncQuarmPatchNotes();
    expect(h.ch.fetches).toHaveLength(1);
    expect(h.db.upserts).toEqual([[idOf(253), idOf(252), idOf(251)]]);
    expect(h.db.notes.size).toBe(253);
    expect(h.status()).toMatchObject({ fetched: 100, new: 3, stored: 3, complete: true });
  });

  it('a run with nothing new reads one page and writes no notes, edited posts included', async () => {
    const h = harness({ total: 250 });
    h.ch.all[240] = mk(241, { editedAt: new Date(T0 + 99_999_000), content: 'fixed typo' });
    await h._syncQuarmPatchNotes();
    expect(h.db.notes.get(idOf(241)).edited_at).toBe(new Date(T0 + 99_999_000).toISOString());
    h.db.upserts.length = 0; h.ch.fetches.length = 0;
    await h._syncQuarmPatchNotes();
    expect(h.ch.fetches).toHaveLength(1);
    expect(h.db.upserts).toEqual([]);
    expect(h.status()).toMatchObject({ fetched: 100, new: 0, stored: 0 });
  });

  it('re-upserts an edit that falls inside a fetched page; an edit to an old post waits for messageUpdate', async () => {
    const h = harness({ total: 250 });
    await h._syncQuarmPatchNotes();
    h.db.upserts.length = 0; h.ch.fetches.length = 0;
    h.ch.all[240] = mk(241, { content: 'edited recent', editedAt: new Date(T0 + 7_000_000) });   // newest page
    h.ch.all[9] = mk(10, { content: 'edited old', editedAt: new Date(T0 + 7_000_000) });          // third page
    await h._syncQuarmPatchNotes();
    expect(h.ch.fetches).toHaveLength(1);
    expect(h.db.notes.get(idOf(241)).content).toBe('edited recent');
    expect(h.db.notes.get(idOf(10)).content).toBe('note 10');           // the sweep never got that far
    expect(h.status()).toMatchObject({ new: 0, stored: 1 });
    // the live listener is what catches it
    await h._quarmNoteLive(h.ch.all[9]);
    expect(h.db.notes.get(idOf(10)).content).toBe('edited old');
  });

  it('keeps walking past stored pages while the history is incomplete (an error resumes where it stopped)', async () => {
    const h = harness({ total: 250 });
    h.ch.failOnCall = 2;
    await h._syncQuarmPatchNotes();
    expect(h.db.notes.size).toBe(100);
    expect(h.status()).toMatchObject({ complete: false, resume_before: idOf(151), stored: 100 });
    expect(h.status().error).toMatch(/503/);
    h.ch.fetches.length = 0; h.ch.failOnCall = 0;
    await h._syncQuarmPatchNotes();
    expect(h.ch.fetches.map(f => f.before)).toEqual([idOf(151), idOf(51)]);
    expect(h.db.notes.size).toBe(250);
    expect(h.status()).toMatchObject({ complete: true, resume_before: null, new: 150 });
    expect(h.status().error).toBeUndefined();
  });

  it('stops at 20,000 messages per run, logs it, and the next run resumes', async () => {
    const h = harness({ total: 25_000 });
    await h._syncQuarmPatchNotes();
    expect(h.ch.fetches).toHaveLength(200);
    expect(h.db.notes.size).toBe(20_000);
    expect(h.status()).toMatchObject({ fetched: 20_000, capped: true, complete: false, resume_before: idOf(5_001) });
    expect(h.logs.warn.join('\n')).toMatch(/20000-message cap/);
    h.ch.fetches.length = 0;
    await h._syncQuarmPatchNotes();
    expect(h.ch.fetches).toHaveLength(51);              // 50 full pages, then the empty one that says the start is reached
    expect(h.db.notes.size).toBe(25_000);
    expect(h.status()).toMatchObject({ complete: true, resume_before: null, fetched: 5_000 });
    expect(h.status().capped).toBeUndefined();
  }, 30_000);

  it('counts messages that came back empty, stores them flagged, and says so when the intent is off', async () => {
    const h = harness({ total: 250, env: { MESSAGE_CONTENT_INTENT: undefined } });
    h.ch.blank = true;
    await h._syncQuarmPatchNotes();
    expect(h.db.notes.size).toBe(250);
    expect([...h.db.notes.values()].every(r => r.content_missing && r.content === '')).toBe(true);
    expect(h.status()).toMatchObject({ content_missing: 250, fetched: 250, message_content_intent: false });
    expect(h.logs.warn.join('\n')).toMatch(/all 250 message\(s\) read had no content.*intent is off/);
  });

  it('once the intent is on, one full walk rewrites the blank rows, then it is incremental again', async () => {
    const h = harness({ total: 250, env: { MESSAGE_CONTENT_INTENT: undefined } });
    h.ch.blank = true;
    await h._syncQuarmPatchNotes();
    h.ch.blank = false; h.penv.MESSAGE_CONTENT_INTENT = '1';
    h.ch.fetches.length = 0; h.db.upserts.length = 0;
    await h._syncQuarmPatchNotes();
    expect(h.ch.fetches).toHaveLength(3);
    expect(h.db.upserts.map(b => b.length)).toEqual([100, 100, 50]);
    expect([...h.db.notes.values()].some(r => r.content_missing)).toBe(false);
    expect(h.db.notes.get(idOf(5)).content).toBe('note 5');
    expect(h.status()).toMatchObject({ new: 0, stored: 250, content_missing: 0, message_content_intent: true });
    h.ch.fetches.length = 0; h.db.upserts.length = 0;
    await h._syncQuarmPatchNotes();
    expect(h.ch.fetches).toHaveLength(1);
    expect(h.db.upserts).toEqual([]);
  });

  it('records a channel it cannot reach in bot_kv and never throws', async () => {
    const h = harness({ total: 10 });
    h.chan.error = 'Missing Access';
    await expect(h._syncQuarmPatchNotes()).resolves.toBeUndefined();
    expect(h.status().error).toMatch(/channel unreachable: Missing Access/);
    expect(h.status()).toMatchObject({ complete: false, fetched: 0, stored: 0 });
    expect(h.db.notes.size).toBe(0);
    expect(h.logs.warn.join('\n')).toMatch(/\[quarm-notes\] sync failed: channel unreachable/);
    h.chan.error = null; h.chan.none = true;
    await expect(h._syncQuarmPatchNotes()).resolves.toBeUndefined();
    expect(h.status().error).toMatch(/channel unreachable/);
    h.chan.none = false;
    await h._syncQuarmPatchNotes();                    // and it recovers on its own
    expect(h.db.notes.size).toBe(10);
    expect(h.status().error).toBeUndefined();
  });

  it('treats a failed Supabase lookup or write as an error, not as "nothing stored"', async () => {
    const a = harness({ total: 150 });
    a.db.failNotesSelect = true;
    await a._syncQuarmPatchNotes();
    expect(a.status().error).toMatch(/lookup failed/);
    expect(a.db.upserts).toEqual([]);

    const b = harness({ total: 150 });
    b.db.failNotesUpsert = true;
    await b._syncQuarmPatchNotes();
    expect(b.status().error).toMatch(/upsert failed/);
    expect(b.status()).toMatchObject({ complete: false, stored: 0 });

    const c = harness({ total: 150 });
    c.db.throwOnNotesUpsert = true;
    await expect(c._syncQuarmPatchNotes()).resolves.toBeUndefined();
    expect(c.status().error).toMatch(/socket hang up/);
  });

  it('skips the pass when its own state cannot be read, or Supabase is off', async () => {
    const a = harness({ total: 10 });
    a.db.failKvRead = true;
    await a._syncQuarmPatchNotes();
    expect(a.chan.asked).toEqual([]);
    expect(a.db.kv.size).toBe(0);
    expect(a.logs.warn.join('\n')).toMatch(/state unreadable/);
    const b = harness({ total: 10 });
    b.db.enabled = false;
    await b._syncQuarmPatchNotes();
    expect(b.chan.asked).toEqual([]);
  });

  it('never runs two sweeps at once', async () => {
    const h = harness({ total: 250 });
    await Promise.all([h._syncQuarmPatchNotes(), h._syncQuarmPatchNotes()]);
    expect(h.ch.fetches).toHaveLength(3);
  });
});

describe('the live writer (messageCreate / messageUpdate)', () => {
  it('upserts one row for the message', async () => {
    const h = harness({ total: 0 });
    await h._quarmNoteLive(mk(9, { content: 'new post' }));
    expect([...h.db.notes.keys()]).toEqual([idOf(9)]);
    expect(h.db.notes.get(idOf(9))).toMatchObject({ content: 'new post', content_missing: false });
    expect(h.db.notes.get(idOf(9)).fetched_at).toMatch(/^\d{4}-/);
  });

  it('skips a member\'s message, including one that arrives as a partial edit', async () => {
    const h = harness({ total: 0 });
    await h._quarmNoteLive(mk(9, { webhookId: null, content: 'member chat' }));
    await h._quarmNoteLive({ id: idOf(10), partial: true, channelId: 'CH', fetch: async () => mk(10, { webhookId: null }) });
    expect(h.db.notes.size).toBe(0);
  });

  it('fetches a partial message whole before writing it', async () => {
    const h = harness({ total: 0 });
    const whole = mk(11, { content: 'whole text' });
    await h._quarmNoteLive({ id: idOf(11), partial: true, channelId: 'CH', fetch: async () => whole });
    expect(h.db.notes.get(idOf(11)).content).toBe('whole text');
  });

  it('never throws', async () => {
    const h = harness({ total: 0 });
    h.db.throwOnNotesUpsert = true;
    await expect(h._quarmNoteLive(mk(1))).resolves.toBeUndefined();
    await expect(h._quarmNoteLive({ id: '1', partial: true, fetch: async () => { throw new Error('Unknown Message'); } })).resolves.toBeUndefined();
    h.db.throwOnNotesUpsert = false; h.db.failNotesUpsert = true;
    await expect(h._quarmNoteLive(mk(2))).resolves.toBeUndefined();
    expect(h.logs.warn.join('\n')).toMatch(/live upsert failed/);
  });
});

describe('the wiring', () => {
  const code = stripJs(bot);

  it('hooks the EXISTING messageCreate handler, ahead of its bot/guild early-out, and adds no second one', () => {
    expect(code.match(/client\.on\(Events\.MessageCreate/g)).toHaveLength(1);
    const handler = sliceBlock(code, 'client.on(Events.MessageCreate', '\n});');
    const hook = handler.indexOf('if (msg.channelId === _QUARM_NOTES_CHANNEL_ID) _quarmNoteLive(msg);');
    expect(hook).toBeGreaterThan(-1);
    expect(hook).toBeLessThan(handler.indexOf('msg.author?.bot'));
  });

  it('adds the one messageUpdate listener, for that channel only', () => {
    expect(code.match(/client\.on\(Events\.MessageUpdate/g)).toHaveLength(1);
    expect(code).toMatch(/client\.on\(Events\.MessageUpdate, \(_before, msg\) => \{ if \(msg\.channelId === _QUARM_NOTES_CHANNEL_ID\) _quarmNoteLive\(msg\); \}\);/);
  });

  it('schedules the sweep 60 s after ready and every 6 hours, inside ClientReady', () => {
    const ready = sliceBlock(code, 'client.once(Events.ClientReady', '\n});');
    expect(ready).toMatch(/setTimeout\(\(\) => _syncQuarmPatchNotes\(\), 60_000\);/);
    expect(ready).toMatch(/setInterval\(\(\) => _syncQuarmPatchNotes\(\), 6 \* 60 \* 60_000\);/);
  });

  it('takes the channel from QUARM_PATCH_NOTES_CHANNEL_ID, defaulting to the id the guild lead gave', () => {
    expect(code).toMatch(/const _QUARM_NOTES_CHANNEL_ID = process\.env\.QUARM_PATCH_NOTES_CHANNEL_ID \|\| '1175117242682331146';/);
  });

  it('documents the variable and the Message Content intent in .env.example', () => {
    const env = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8').replace(/^[ \t]*#.*$/gm, '');
    expect(env).toMatch(/^QUARM_PATCH_NOTES_CHANNEL_ID=1175117242682331146$/m);
    const raw = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    const section = raw.slice(raw.indexOf('Quarm patch notes mirror'));
    expect(section).toMatch(/Message Content/);
    expect(section).toMatch(/MESSAGE_CONTENT_INTENT=1/);
  });
});

describe('the migration', () => {
  const sql = stripSql(fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261004160000_quarm_patch_notes.sql'), 'utf8'));

  it('creates the table with the agreed columns, idempotently', () => {
    expect(sql).toMatch(/create table if not exists public\.quarm_patch_notes/i);
    expect(sql).toMatch(/message_id\s+text\s+primary key/i);
    expect(sql).toMatch(/channel_id\s+text\s+not null/i);
    expect(sql).toMatch(/posted_at\s+timestamptz\s+not null/i);
    expect(sql).toMatch(/edited_at\s+timestamptz,/i);
    expect(sql).toMatch(/embeds\s+jsonb\s+not null default '\[\]'/i);
    expect(sql).toMatch(/attachments\s+jsonb\s+not null default '\[\]'/i);
    expect(sql).toMatch(/content_missing\s+boolean\s+not null default false/i);
    expect(sql).toMatch(/fetched_at\s+timestamptz\s+not null default now\(\)/i);
    expect(sql).toMatch(/create index if not exists \w+\s+on public\.quarm_patch_notes \(posted_at desc\)/i);
  });

  it('turns RLS on and lets signed-in members READ, nobody else, and nobody write', () => {
    expect(sql).toMatch(/alter table public\.quarm_patch_notes enable row level security/i);
    const policies = [...sql.matchAll(/create policy[\s\S]*?;/gi)].map(m => m[0]);
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatch(/for select to authenticated using \(true\)/i);
    expect(sql).toMatch(/drop policy if exists quarm_patch_notes_read on public\.quarm_patch_notes/i);
    expect(sql).not.toMatch(/\banon\b/i);
    expect(sql).not.toMatch(/\bfor\s+(insert|update|delete|all)\b/i);
    expect(sql).not.toMatch(/\bto\s+public\b/i);
  });
});
