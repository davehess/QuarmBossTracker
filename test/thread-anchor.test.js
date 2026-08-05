// A failed edit must never become a second post.
//
// THE BUG (Uilnayar 2026-08-04): "the onboarding thread and the raid review
// thread keep getting populated with posts."
//
// Both call sites had written the same thing:
//
//     if (savedId) {
//       try { const msg = await thread.messages.fetch(savedId);
//             await msg.edit({ embeds }); return; } catch {}
//     }
//     await thread.send({ embeds });          // ← the duplicate
//
// The bare catch turns EVERY edit failure into a fresh post. And the failure
// that actually fires is mundane: Discord refuses edits in an ARCHIVED thread
// (50083). These are exactly the threads that archive — the onboarding thread's
// parent is literally named `raid-mobs-archive` — so each bot restart fetched
// the card fine, failed to edit it, posted a new one, and (because sending
// unarchives) left the thread primed to do it again.
//
// This is the THIRD time a duplicate-post bug has been chased in this codebase:
// the Mimic release announcer (2026-07-13, ephemeral cursor), the raid review
// (2026-08-04, state.json not persisted on Railway), and now the edit-failure
// fall-through. The first two were about LOSING the id; this one happens with
// the id in hand. Hence one shared helper with tests, rather than a third
// bespoke fix.
//
// Run: npx vitest run test/thread-anchor.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const { postOrEditCard, findOwnCard, unarchiveIfNeeded, _isGone } =
  require(path.join(ROOT, 'utils', 'threadAnchor.js'));

const BOT = 'bot-1';
const TITLE = '📖 Wolf Pack Raid Tracker — Quick Start';

// A Discord API error, shaped the way discord.js surfaces them.
const apiErr = (code, message, status) => Object.assign(new Error(message), { code, status });
const ARCHIVED = () => apiErr(50083, 'Thread is archived', 400);
const GONE     = () => apiErr(10008, 'Unknown Message', 404);

// Minimal fake thread. `messages` is newest-first, like messages.fetch().
function fakeThread({ messages = [], archived = false, locked = false, editThrows = null, fetchThrows = null, sendThrows = null } = {}) {
  const t = {
    id: 'thread-1', archived, locked,
    sent: [], edited: [], unarchived: 0,
    async setArchived(v) { if (v === false) { t.archived = false; t.unarchived++; } },
    async send(payload) {
      if (sendThrows) throw sendThrows();
      if (t.archived) t.archived = false;         // sending unarchives, as Discord does
      const m = mkMsg('new-' + (t.sent.length + 1), payload);
      t.sent.push(m); messages.unshift(m); return m;
    },
    messages: {
      async fetch(arg) {
        if (typeof arg === 'object') return new Map(messages.map(m => [m.id, m]));
        if (fetchThrows) throw fetchThrows();
        const m = messages.find(x => x.id === arg);
        if (!m) throw GONE();
        return m;
      },
    },
  };
  function mkMsg(id, payload) {
    return {
      id, author: { id: BOT },
      embeds: payload?.embeds || [{ title: TITLE }],
      async edit(p) {
        if (editThrows) throw editThrows();
        if (t.archived) throw ARCHIVED();          // the real behaviour
        t.edited.push(id); this.embeds = p?.embeds || this.embeds; return this;
      },
      async delete() { const i = messages.indexOf(this); if (i >= 0) messages.splice(i, 1); },
    };
  }
  t._mk = mkMsg;
  return t;
}
const card = (id) => ({ id, author: { id: BOT }, embeds: [{ title: TITLE }],
  async edit() { return this; }, async delete() {} });

const PAYLOAD = { embeds: [{ title: TITLE }] };

describe('the archived-thread path that caused the spam', () => {
  it('unarchives and EDITS instead of posting a second card', async () => {
    const existing = card('m1');
    const thread = fakeThread({ messages: [existing], archived: true });
    // Bind edit to the thread so it can observe the archived flag.
    existing.edit = async function () { if (thread.archived) throw ARCHIVED(); thread.edited.push('m1'); return this; };

    const res = await postOrEditCard(thread, {
      botId: BOT, title: TITLE, payload: PAYLOAD, getId: async () => 'm1',
    });

    expect(res.action).toBe('edited');
    expect(thread.sent, 'NOTHING may be posted').toHaveLength(0);
    expect(thread.unarchived).toBe(1);
  });

  it('a locked thread is reported, not posted into', async () => {
    const thread = fakeThread({ messages: [card('m1')], archived: true, locked: true });
    const res = await postOrEditCard(thread, { botId: BOT, title: TITLE, payload: PAYLOAD, getId: async () => 'm1' });
    expect(res.action).toBe('skipped');
    expect(res.reason).toBe('thread-unwritable');
    expect(thread.sent).toHaveLength(0);
  });
});

describe('a failure to read or write is never a reason to post', () => {
  it('an edit that fails for a NON-gone reason posts nothing', async () => {
    const thread = fakeThread({ messages: [card('m1')], editThrows: () => apiErr(50013, 'Missing Permissions', 403) });
    thread.messages.fetch = async (a) => (typeof a === 'object'
      ? new Map()
      : Object.assign(card('m1'), { edit: async () => { throw apiErr(50013, 'Missing Permissions', 403); } }));

    const res = await postOrEditCard(thread, { botId: BOT, title: TITLE, payload: PAYLOAD, getId: async () => 'm1' });
    expect(res.action).toBe('skipped');
    expect(res.reason).toBe('edit-failed');
    expect(thread.sent, 'this is the exact line that produced duplicates').toHaveLength(0);
  });

  it('a fetch that fails for a NON-gone reason posts nothing', async () => {
    // The raid review used `.catch(() => null)` here, which made a transient
    // network blip indistinguishable from a deleted message.
    const thread = fakeThread({ messages: [card('m1')], fetchThrows: () => apiErr(500, 'Internal Server Error', 500) });
    const res = await postOrEditCard(thread, { botId: BOT, title: TITLE, payload: PAYLOAD, getId: async () => 'm1' });
    expect(res.action).toBe('skipped');
    expect(res.reason).toBe('fetch-failed');
    expect(thread.sent).toHaveLength(0);
  });

  it('but a genuinely deleted message DOES get replaced', async () => {
    // The one case where posting is right. Distinguishing it from the two
    // above is the whole job.
    const thread = fakeThread({ messages: [] });
    const res = await postOrEditCard(thread, { botId: BOT, title: TITLE, payload: PAYLOAD, getId: async () => 'deleted-id' });
    expect(res.action).toBe('posted');
    expect(thread.sent).toHaveLength(1);
  });

  it('classifies the codes that mean gone, and only those', () => {
    expect(_isGone(GONE())).toBe(true);
    expect(_isGone(apiErr(10003, 'Unknown Channel', 404))).toBe(true);
    expect(_isGone(apiErr(0, 'x', 404))).toBe(true);
    expect(_isGone(ARCHIVED()), 'archived is NOT gone').toBe(false);
    expect(_isGone(apiErr(50013, 'Missing Permissions', 403))).toBe(false);
    expect(_isGone(apiErr(500, 'boom', 500))).toBe(false);
    expect(_isGone(null)).toBe(false);
  });
});

describe('the look-before-you-post backstop', () => {
  it('adopts a card already in the thread when the stored id is lost', async () => {
    // This is the state Railway leaves after every deploy: no persisted id.
    const thread = fakeThread({ messages: [card('m-existing')] });
    const res = await postOrEditCard(thread, { botId: BOT, title: TITLE, payload: PAYLOAD, getId: async () => null });
    expect(res.action).toBe('edited');
    expect(res.messageId).toBe('m-existing');
    expect(thread.sent).toHaveLength(0);
  });

  it('writes the adopted id back so the next run skips the scan', async () => {
    let saved = null;
    const thread = fakeThread({ messages: [card('m-existing')] });
    await postOrEditCard(thread, {
      botId: BOT, title: TITLE, payload: PAYLOAD,
      getId: async () => null, setId: async (id) => { saved = id; },
    });
    expect(saved).toBe('m-existing');
  });

  it('ignores messages that are not ours', async () => {
    const other = { ...card('m-other'), author: { id: 'someone-else' } };
    const wrongTitle = { ...card('m-wrong'), embeds: [{ title: 'Something Else' }] };
    const thread = fakeThread({ messages: [other, wrongTitle] });
    const res = await postOrEditCard(thread, { botId: BOT, title: TITLE, payload: PAYLOAD, getId: async () => null });
    expect(res.action, 'neither is our card, so a fresh one is correct').toBe('posted');
  });

  it('reports older copies without deleting them', async () => {
    // Deleting guild history is an officer decision (/cleanup), not a side
    // effect of a startup card refresh.
    const msgs = [card('newest'), card('older'), card('oldest')];
    const thread = fakeThread({ messages: msgs });
    const res = await postOrEditCard(thread, { botId: BOT, title: TITLE, payload: PAYLOAD, getId: async () => null });
    expect(res.messageId, 'newest is adopted').toBe('newest');
    expect(res.duplicates.map(m => m.id)).toEqual(['older', 'oldest']);
    expect(msgs, 'nothing deleted').toHaveLength(3);
  });
});

describe('findOwnCard', () => {
  it('returns newest first and the rest as duplicates', async () => {
    const thread = fakeThread({ messages: [card('a'), card('b'), card('c')] });
    const { msg, duplicates } = await findOwnCard(thread, { botId: BOT, title: TITLE });
    expect(msg.id).toBe('a');
    expect(duplicates.map(m => m.id)).toEqual(['b', 'c']);
  });

  it('a scan that throws is not fatal', async () => {
    const thread = fakeThread({ messages: [] });
    thread.messages.fetch = async () => { throw new Error('rate limited'); };
    const r = await findOwnCard(thread, { botId: BOT, title: TITLE });
    expect(r).toEqual({ msg: null, duplicates: [] });
  });
});

describe('unarchiveIfNeeded', () => {
  it('is a no-op on a live thread', async () => {
    const t = fakeThread({ archived: false });
    expect(await unarchiveIfNeeded(t)).toBe(true);
    expect(t.unarchived).toBe(0);
  });

  it('wakes an archived thread', async () => {
    const t = fakeThread({ archived: true });
    expect(await unarchiveIfNeeded(t)).toBe(true);
    expect(t.archived).toBe(false);
  });

  it('refuses a locked thread rather than throwing', async () => {
    expect(await unarchiveIfNeeded(fakeThread({ archived: true, locked: true }))).toBe(false);
  });

  it('survives setArchived rejecting', async () => {
    const t = fakeThread({ archived: true });
    t.setArchived = async () => { throw new Error('Missing Permissions'); };
    expect(await unarchiveIfNeeded(t)).toBe(false);
  });
});

// ── The call sites actually use it ──────────────────────────────────────────
describe('both spammers are wired through the helper', () => {
  const read = (p) => require('node:fs').readFileSync(path.join(ROOT, p), 'utf8');

  it('onboarding no longer falls through to send()', () => {
    const src = read('utils/onboarding.js');
    expect(src).toMatch(/postOrEditCard\(thread, \{/);
    expect(src, 'the old fall-through must be gone')
      .not.toMatch(/await msg\.edit\(\{ embeds: \[embed\] \}\);\s*\n\s*return;\s*\n\s*\} catch \{\}/);
  });

  it('the raid review no longer swallows its fetch', () => {
    const src = read('utils/raidReview.js');
    expect(src).toMatch(/postOrEditCard\(target\.thread, \{/);
    expect(src, 'the .catch(() => null) fetch is what made a blip look like a deletion')
      .not.toMatch(/messages\.fetch\(existingId\)\.catch\(\(\) => null\)/);
  });

  it('/cleanup can clear the backlog, keeping the card the anchor adopts', () => {
    // If cleanup kept the EARLIEST while the anchor adopts the NEWEST, the two
    // would fight: cleanup deletes the live card, the anchor adopts another.
    const src = read('commands/cleanup.js');
    expect(src).toMatch(/findOwnCard/);
    expect(src).toMatch(/kept the newest/);
  });
});
