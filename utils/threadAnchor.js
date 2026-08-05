// utils/threadAnchor.js — post-or-edit a single pinned-in-place card in a
// thread, without ever leaving a duplicate behind.
//
// THE BUG (Uilnayar 2026-08-04, "the onboarding thread and the raid review
// thread keep getting populated with posts"). Both call sites were written the
// same way:
//
//     if (savedId) {
//       try { const msg = await thread.messages.fetch(savedId);
//             await msg.edit({ embeds }); return; } catch {}
//     }
//     await thread.send({ embeds });          // ← duplicate lives here
//
// A bare catch around the edit turns EVERY edit failure into a fresh post. The
// failure that actually fires is the boring one: **Discord refuses edits in an
// ARCHIVED thread** (50083), and these are exactly the threads that archive —
// the onboarding thread's parent is literally called `raid-mobs-archive`, and
// a quiet thread auto-archives after its inactivity window. So each bot restart
// would fetch the card fine, fail to edit it, post a new one, and — because
// sending UNARCHIVES a thread — leave it primed to archive and do it again.
//
// Three rules come out of that, and this module exists so both call sites get
// all three instead of one of them:
//
//   1. UNARCHIVE FIRST. An archived thread is a normal resting state, not an
//      error. Wake it before trying to write.
//   2. A FAILED EDIT IS NOT A MISSING MESSAGE. Only "the message is genuinely
//      gone" (10008 Unknown Message / 10003 Unknown Channel) may fall through
//      to posting. Anything else is reported and the call gives up — a visible
//      failure beats a silent duplicate.
//   3. LOOK BEFORE YOU POST. Before sending a fresh card, re-scan the thread
//      for one we already posted and adopt it. This is the backstop that makes
//      duplication structurally impossible even if the stored id is lost, which
//      is the whole failure mode on a host with no persistent disk.
//
// Deliberately dependency-free (no discord.js import): it takes a thread object
// and plain callbacks, so it is unit-testable without a client.

// Discord API error codes that genuinely mean "there is nothing there to edit".
const GONE_CODES = new Set([10008 /* Unknown Message */, 10003 /* Unknown Channel */]);

function _isGone(err) {
  if (!err) return false;
  if (GONE_CODES.has(err.code)) return true;
  // discord.js surfaces the HTTP status separately on some paths.
  return err.status === 404;
}

// Wake an archived thread so it can be written to. Returns true if the thread
// is writable afterwards. A locked thread cannot be unarchived by us.
async function unarchiveIfNeeded(thread, log) {
  try {
    if (!thread || !thread.archived) return true;
    if (thread.locked) {
      log?.(`thread ${thread.id} is LOCKED — cannot post or edit`);
      return false;
    }
    await thread.setArchived(false, 'wolfpack: updating pinned card');
    log?.(`thread ${thread.id} was archived — unarchived to update in place`);
    return true;
  } catch (err) {
    log?.(`could not unarchive thread ${thread?.id}: ${err?.message}`);
    return false;
  }
}

// Find a card we previously posted, by matching its embed title. Scans the
// most recent `limit` messages. Returns { msg, duplicates } — duplicates being
// the OLDER copies, newest-first, so a caller can report or clean them.
async function findOwnCard(thread, { botId, title, limit = 100 }) {
  const out = { msg: null, duplicates: [] };
  try {
    const msgs = await thread.messages.fetch({ limit });
    // messages.fetch returns newest-first; keep that order so [0] is current.
    const mine = [...msgs.values()].filter(m =>
      m.author?.id === botId && m.embeds?.[0]?.title === title);
    out.msg = mine[0] || null;
    out.duplicates = mine.slice(1);
  } catch { /* a scan we cannot do is not an error — caller falls back */ }
  return out;
}

// The whole point of the module.
//
// `payload` is whatever you would pass to send()/edit(). `title` is the embed
// title used to recognise our own card. `getId`/`setId` persist the message id
// (bot_kv, state, wherever) — both optional.
//
// Returns { action, messageId, duplicates, reason }:
//   action 'edited'  — the existing card was updated in place
//   action 'posted'  — no card existed, a new one was sent
//   action 'skipped' — something went wrong; NOTHING was posted (never a dupe)
async function postOrEditCard(thread, {
  botId, title, payload, getId, setId, log, scanLimit = 100,
}) {
  const say = (m) => (log ? log(m) : undefined);
  if (!thread) return { action: 'skipped', reason: 'no-thread' };

  if (!(await unarchiveIfNeeded(thread, say))) {
    return { action: 'skipped', reason: 'thread-unwritable' };
  }

  // 1. The id we stored.
  let existing = null;
  let savedId = null;
  try { savedId = getId ? await getId() : null; } catch { savedId = null; }
  if (savedId) {
    try {
      existing = await thread.messages.fetch(savedId);
    } catch (err) {
      if (!_isGone(err)) {
        // Could not even look. Posting here is how duplicates were born.
        say(`could not fetch card ${savedId}: ${err?.message} — not posting a replacement`);
        return { action: 'skipped', reason: 'fetch-failed' };
      }
      say(`stored card ${savedId} is gone — will look for another before posting`);
    }
  }

  // 2. Backstop: no stored id (or it was deleted) → look for one in the thread.
  let duplicates = [];
  if (!existing) {
    const found = await findOwnCard(thread, { botId, title, limit: scanLimit });
    duplicates = found.duplicates;
    if (found.msg) {
      existing = found.msg;
      say(`adopted existing card ${existing.id} found in the thread`);
    }
  }

  // 3. Edit what we have.
  if (existing) {
    try {
      await existing.edit(payload);
      if (setId) { try { await setId(existing.id); } catch { /* best effort */ } }
      return { action: 'edited', messageId: existing.id, duplicates };
    } catch (err) {
      if (!_isGone(err)) {
        say(`edit of card ${existing.id} failed: ${err?.message} — NOT posting a duplicate`);
        return { action: 'skipped', reason: 'edit-failed', duplicates };
      }
      say(`card ${existing.id} vanished mid-edit — posting a fresh one`);
    }
  }

  // 4. Genuinely nothing there. Post once.
  try {
    const sent = await thread.send(payload);
    if (setId) { try { await setId(sent.id); } catch { /* best effort */ } }
    return { action: 'posted', messageId: sent.id, duplicates };
  } catch (err) {
    say(`post failed: ${err?.message}`);
    return { action: 'skipped', reason: 'send-failed', duplicates };
  }
}

module.exports = { postOrEditCard, findOwnCard, unarchiveIfNeeded, _isGone, GONE_CODES };
