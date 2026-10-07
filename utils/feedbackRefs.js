// utils/feedbackRefs.js — short handles for bug and idea reports, and moving them on from commits.
//
// The guild lead, 2026-09-29: "We need to start having referenceable IDs for each bug or enhancement
// request so the bot can update these when they get implemented". Every feedback row has a sequential
// `ref` (migration 20260929020000); people and commits call it FB-<ref>. A commit on `beta` that names
// FB-12 moves report 12 to "on beta"; one on `main` moves it to implemented. A report only ever moves
// forward, because main is merged into beta constantly (sync-beta.yml) and would otherwise knock an
// implemented report back to "on beta". The DM it sends says what changed and how to get it
// (buildStatusDm, below). Pure; test/feedback-refs.test.js.

const tag = (ref) => (Number.isInteger(ref) && ref > 0 ? `FB-${ref}` : '');

// Every FB-n a commit message CLOSES, once each, in order: only on a line that also says fixes /
// implements / closes / resolves ("Fixes FB-29, FB-30", "Implements: FB-31"). A mention alone ("see
// FB-12", a docs commit quoting the report) moves nothing, or every note about a report would mark it
// done.
const CLOSE_RX = /\b(?:fix(?:e[sd])?|implement(?:s|ed)?|close[sd]?|resolve[sd]?)\b/i;
function refsIn(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    if (!CLOSE_RX.test(line)) continue;
    for (const m of line.matchAll(/\bFB-(\d{1,6})\b/gi)) {
      const n = Number(m[1]);
      if (n > 0 && !out.includes(n)) out.push(n);
    }
  }
  return out;
}

// Where a report stands: new → acked → on_beta → addressed. `scoped` counts as acked. Not
// implementing is `addressed` too (the button closes it), and so are /admin/feedback's won't-fix and
// duplicate: a commit never reopens a closed report.
const STAGE = { new: 0, acked: 1, scoped: 1, on_beta: 2, addressed: 3, wont_fix: 3, duplicate: 3 };
const stageOf = (status) => (status in STAGE ? STAGE[status] : 0);

// What a commit on `branch` does to a report now at `status`: the new status, or null for nothing.
function advance(status, branch) {
  const want = branch === 'main' ? 'addressed' : branch === 'beta' ? 'on_beta' : null;
  if (!want) return null;
  return stageOf(want) > stageOf(status) ? want : null;
}

// The line the Discord card shows for it, and the note the row keeps.
function statusLine(status, sha) {
  const at = sha ? ` (${String(sha).slice(0, 7)})` : '';
  if (status === 'on_beta') return `🧪 On beta${at}`;
  if (status === 'addressed') return `✅ Implemented${at}`;
  return null;
}

// ── The DM to whoever sent it ────────────────────────────────────────────────────────────────────────
// The guild lead, 2026-10-07, of "Your idea FB-4 is fixed on the beta. It reaches everyone with the next
// stable release.": "This message to the submitter needs more details than this." So the DM now says, in
// order: their own words back, what changed (from the commit), how to get it (from the commit's
// component and the branch it was found on), a link to their card, and how to reopen it.
//
// Pure: buildStatusDm takes the report row's fields and the commit (subject, body, branch, sha) and
// returns the text, so the scanner only passes things through. Commit text is read the way this repo
// writes it: a `<component> vX.Y.Z — ` subject prefix, an optional player-notes block (the same markers
// release-mimic.yml reads), and bodies that name a report on a line of its own or in a hard-wrapped
// paragraph of "FB-4 what changed. FB-5 what changed." sentences (a batch close).

const DM_MAX = 1900;        // Discord's limit is 2000; stay clear of it.
const QUOTE_MAX = 160;      // Their own words, trimmed.
const CHANGED_MAX = 700;    // What changed, before the whole-DM budget squeezes it further.
const NOTE_MAX = 200;       // The same text in the row's one-line note.

const CLOSE_WORDS = '(?:fix(?:e[sd])?|implement(?:s|ed)?|close[sd]?|resolve[sd]?)';
const FB_RUN = 'FB-\\d{1,6}(?:[\\s,&+/]*(?:and\\s+)?FB-\\d{1,6})*';        // "FB-4", "FB-4, FB-5 and FB-6"
const CLOSE_RUN_RX = new RegExp(`\\b${CLOSE_WORDS}\\s*:?\\s*${FB_RUN}\\s*[:—–-]?\\s*`, 'gi');   // "Fixes FB-4, FB-5 —"
const FB_PAREN_RX = /\s*\([^()]*\bFB-\d{1,6}\b[^()]*\)/gi;                 // "(FB-54)", "(suggested by a member, FB-54)"
const VERSION_STAMP_RX = /\s*\((?:bot|agent|web|mimic)\s+v?\d[\w.-]*(?:,\s*([^()]*))?\)/gi;   // "(bot 3.0.219, Loot tab)"
const GLUE_RX = /^[\s,&+/]*(?:and[\s,&+/]*)?$/i;                          // between two FB numbers of one list
const BULLET_RX = /^(?:[-*•]|\d+[.)])\s+/;
const PLAYER_NOTES_RX = /<!--\s*player-notes\s*-->([\s\S]*?)<!--\s*\/player-notes\s*-->/i;
const SUBJECT_PREFIX_RX = /^\s*(?:mimic|agent|web|bot|docs|db)\b[^—–]{0,50}?\s[—–]\s+/i;   // "mimic v2.7.9 — ", "docs — "

const refRx = (ref) => new RegExp(`\\bFB-${ref}\\b`, 'i');
const hasLetters = (s) => /[A-Za-z]{2}/.test(s);

// "bug" → "bug report", "idea" → "idea", anything else ("general", empty) → "report".
const kindOf = (category) => (category === 'bug' ? 'bug report' : category === 'idea' ? 'idea' : 'report');

// Their own words, one line, ~160 chars, ending on a whole word with an ellipsis when cut. Markdown
// characters are escaped so a stray "*" or "_" in a report cannot italicise the rest of the DM.
function quoteOf(message) {
  let t = String(message || '').replace(/\s+/g, ' ').replace(/"/g, "'").trim();
  if (t.length > QUOTE_MAX) {
    let cut = t.slice(0, QUOTE_MAX);
    const sp = cut.lastIndexOf(' ');
    if (sp >= QUOTE_MAX * 0.6) cut = cut.slice(0, sp);
    t = cut.replace(/[\s,.;:!?(\-—–]+$/, '') + '…';
  }
  return t.replace(/([\\*_~`|])/g, '\\$1');
}

// Keep the sentence, lose the bookkeeping: "Fixes FB-12 —", "(FB-54)" and "(bot 3.0.219)" are for us.
function tidy(text) {
  return String(text || '')
    .replace(FB_PAREN_RX, '')
    .replace(CLOSE_RUN_RX, '')
    .replace(VERSION_STAMP_RX, (m, rest) => (rest && rest.trim() ? ` (${rest.trim()})` : ''))
    .replace(/\s+/g, ' ').trim();
}

// Cut to `max` chars: whole lines when there are several, else a word boundary; always an ellipsis.
function capText(text, max) {
  if (text.length <= max) return text;
  const lines = text.split('\n');
  if (lines.length > 1) {
    const keep = [];
    let used = 2;   // The closing "\n…".
    for (const ln of lines) {
      if (used + ln.length + 1 > max) break;
      keep.push(ln);
      used += ln.length + 1;
    }
    if (keep.length) return keep.join('\n') + '\n…';
  }
  let cut = lines[0].slice(0, Math.max(0, max - 1));
  const sp = cut.lastIndexOf(' ');
  if (sp > max * 0.6) cut = cut.slice(0, sp);
  return cut.replace(/[\s,;:(\-—–]+$/, '') + '…';
}

// A commit message is "<subject>\n<body>".
function splitCommit(message) {
  const s = String(message || '').replace(/\r\n/g, '\n');
  const i = s.indexOf('\n');
  return i < 0 ? { subject: s.trim(), body: '' } : { subject: s.slice(0, i).trim(), body: s.slice(i + 1) };
}

// A body as readable units: a blank line ends one, a bullet starts one, and the lines of a hard-wrapped
// paragraph rejoin into one string (the batch close wraps "FB-4 … FB-5 …" mid-sentence).
function bodyUnits(body) {
  const units = [];
  let open = false;
  for (const raw of String(body || '').split('\n')) {
    const line = raw.trim();
    if (!line) { open = false; continue; }
    const bullet = BULLET_RX.test(line);
    if (open && !bullet) { units[units.length - 1] += ' ' + line; continue; }
    units.push(line.replace(BULLET_RX, ''));
    open = true;
  }
  return units;
}

// What the unit says about ONE report. Several reports can share a unit — "FB-4 Lord of Ire kills post
// to #pvp. FB-5 loot records for non-DKP kills." — so the text is what follows that number up to the
// next one; "FB-11 and FB-18 charm break spoken…" is one list sharing the text after it. A number inside
// parentheses ("(suggested by a member, FB-54)") only labels the line it sits on. A number with nothing
// after it ("the HUD no longer reverts (FB-12)") takes the text before it. { text, raw } or null.
function segmentFor(unit, ref) {
  const rx = refRx(ref);
  const bare = unit.replace(new RegExp(`\\s*\\([^()]*\\bFB-${ref}\\b[^()]*\\)`, 'gi'), '');
  if (!rx.test(bare)) {
    const text = tidy(bare);
    return rx.test(unit) && hasLetters(text) ? { text, raw: bare } : null;
  }
  const toks = [...bare.matchAll(/\bFB-(\d{1,6})\b/gi)].map(m => ({ n: Number(m[1]), at: m.index, end: m.index + m[0].length }));
  const i = toks.findIndex(t => t.n === ref);
  const glued = (a, b) => GLUE_RX.test(bare.slice(toks[a].end, toks[b].at));
  let lo = i, hi = i;
  while (lo > 0 && glued(lo - 1, lo)) lo--;
  while (hi < toks.length - 1 && glued(hi, hi + 1)) hi++;
  const after = bare.slice(toks[hi].end, toks[hi + 1] ? toks[hi + 1].at : undefined);
  const before = bare.slice(toks[lo - 1] ? toks[lo - 1].end : 0, toks[lo].at);
  const afterText = tidy(after.replace(/^[\s:;,.\-—–)\]]+/, ''));
  if (hasLetters(afterText)) return { text: afterText, raw: after };
  const beforeText = tidy(before.replace(/[\s(\[:;,—–-]+$/, '').replace(new RegExp(`\\b${CLOSE_WORDS}$`, 'i'), '')
    .replace(/[\s(\[:;,—–-]+$/, '').replace(BULLET_RX, ''));
  return hasLetters(beforeText) ? { text: beforeText, raw: before } : null;
}

// The commit's own words for this report, best first: (a) the player-notes block (this report's lines
// when it names the report, else the whole block when it is short — a stable cut's block lists the whole
// release and says nothing about one report), (b) the body line that names the report, (c) the subject
// without its "<component> vX.Y.Z — " prefix. { text, raw } — raw is where a "(bot 3.0.117)" stamp lives.
function describe(commit, ref) {
  const { subject = '', body = '' } = commit || {};
  const block = PLAYER_NOTES_RX.exec(String(body));
  if (block) {
    const lines = block[1].split('\n').map(l => l.trim())
      .filter(l => l && !/^(?:\*\*[^*]+\*\*|#{1,6}\s.*)$/.test(l));
    const rx = refRx(ref);
    const named = lines.filter(l => rx.test(l));
    const use = named.length ? named : (lines.length && lines.length <= 3 ? lines : []);
    const got = use.map(l => segmentFor(l.replace(BULLET_RX, ''), ref) || { text: tidy(l.replace(BULLET_RX, '')), raw: l })
      .filter(g => hasLetters(g.text));
    if (got.length) {
      return { text: got.length === 1 ? got[0].text : got.map(g => `• ${g.text}`).join('\n'), raw: got.map(g => g.raw).join(' ') };
    }
  }
  const rest = String(body).replace(PLAYER_NOTES_RX, '');
  for (const unit of bodyUnits(rest)) {
    if (!refRx(ref).test(unit)) continue;
    const seg = segmentFor(unit, ref);
    if (seg) return seg;
  }
  // A merge commit's subject is git's, not anyone's account of the change.
  if (/^merge\b/i.test(String(subject).trim())) return { text: '', raw: '' };
  return { text: tidy(String(subject).replace(SUBJECT_PREFIX_RX, '')), raw: '' };
}

// What changed for one report, in plain words ('' when the commit says nothing usable).
const whatChanged = (commit, ref) => describe(commit, ref).text;

// Which component shipped it. The line's own stamp ("(bot 3.0.117)") wins — a batch close is a web or
// docs commit that closes other components' work — then the subject's prefix ("mimic v2.7.9 — …").
// A web commit that says "docs" is bookkeeping, not the fix; it has no page to point at.
function componentOf(subject, raw) {
  const stamp = /\((bot|agent|web|mimic)\s+v?(\d[\w.-]*)/i.exec(raw || '');
  const pre = /^\s*(mimic|agent|web|bot|docs)\b(?:\s+v?(\d[\w.-]*))?/i.exec(subject || '');
  const hit = stamp || pre;
  if (!hit) return { kind: 'none', version: '' };
  let kind = hit[1].toLowerCase();
  if (!stamp && kind === 'web' && /\bdocs?\b/i.test(String(subject).slice(pre[0].length))) kind = 'docs';
  const v = String(hit[2] || '').replace(/[.-]+$/, '');
  return { kind, version: /^\d+\.\d+/.test(v) ? v : '' };
}

// The first page route a web commit names ("/me/parses"), else the root. API routes are not pages.
function routeOf(...texts) {
  for (const t of texts) {
    const m = /(?:^|[\s(`'"])(\/(?!api\b)[a-z][\w-]*(?:\/[\w-]+)*)/i.exec(String(t || ''));
    if (m) return m[1].slice(0, 60);
  }
  return '/';
}

// "How to get it" — from the component and the branch the commit was found on.
function howToGet(comp, beta, subject, raw) {
  const { kind, version } = comp;
  if (kind === 'mimic' || kind === 'agent') {
    if (beta) {
      const v = kind === 'mimic' && version ? ` (${version})` : '';
      return `It is in the Mimic beta now${v}: on the Mimic dashboard click ⤴ beta (or tray → Check for beta) to switch channels. It reaches everyone on stable with the next stable release.`;
    }
    // A "-beta.N" version is not a stable one, so it is never printed here.
    const v = kind === 'mimic' && version && !version.includes('-') ? `stable Mimic ${version}` : 'the stable Mimic release';
    return `It is in ${v}; Mimic updates itself on its next launch.`;
  }
  if (kind === 'web') {
    const path = routeOf(raw, subject);
    return beta
      ? `See it at https://b.wolfpack.quest${path} — it reaches wolfpack.quest when it graduates.`
      : `It is live on https://wolfpack.quest${path}.`;
  }
  if (kind === 'bot') return beta ? 'The bot has no beta, so this is already live in Discord.' : 'It is live in Discord now.';
  return beta ? 'It reaches everyone with the next stable release.' : 'It is live now.';
}

// The 7-char sha the report's last "🧪 On beta (sha…)" note carries, '' when none.
function betaShaFromNotes(notes) {
  const all = [...String(notes || '').matchAll(/🧪 On beta \(([0-9a-f]{7,40})/gu)];
  return all.length ? all[all.length - 1][1] : '';
}

// The note the row keeps and the card's log shows: the status line plus the same what-changed text, short.
function statusNote(status, sha, changed) {
  const line = statusLine(status, sha);
  if (!line) return null;
  const one = capText(String(changed || '').replace(/^•\s*/, '').replace(/\s*\n\s*(?:•\s*)?/g, '; ').trim(), NOTE_MAX);
  return one ? `${line} — ${one}` : line;
}

// The whole DM, or null when the status is not one we announce.
//   { ref, category, message, link }  — the report row (link = its Discord card)
//   status                            — 'on_beta' | 'addressed' (what it just became)
//   prevStatus, betaSha               — optional: a report that was on_beta already got the 🧪 DM, so the ✅
//                                       one does not repeat "What changed" for the same commit
//   commit { subject, body, branch, sha }
function buildStatusDm({ ref, category, message, link, status, prevStatus, betaSha, commit } = {}) {
  if (status !== 'on_beta' && status !== 'addressed') return null;
  const c = commit || {};
  const beta = (c.branch || (status === 'on_beta' ? 'beta' : 'main')) === 'beta';
  const info = describe(c, ref);
  const comp = componentOf(c.subject, info.raw);
  const mimic = comp.kind === 'mimic' || comp.kind === 'agent';

  const q = quoteOf(message);
  const afterBeta = status === 'addressed' && prevStatus === 'on_beta';
  const done = status === 'on_beta' ? 'is fixed on the beta.'
    : `is ${afterBeta ? 'now' : 'fixed and'} ${mimic ? 'in the stable release' : 'live'}.`;
  const head = `${status === 'on_beta' ? '🧪' : '✅'} Your ${kindOf(category)} ${tag(ref)}${q ? ` — "${q}" —` : ''} ${done}`;

  const sha = String(c.sha || '');
  const bsha = String(betaSha || '');
  const sameCommit = afterBeta && !!bsha && !!sha && (sha.startsWith(bsha) || bsha.startsWith(sha));
  const how = howToGet(comp, beta, c.subject, info.raw);
  const card = link ? `Your card: ${link}` : '';
  const close = `If it is not fixed for you, reply on the card or file it again from Mimic → Feedback and mention ${tag(ref)}.`;

  // What changed gets whatever room the rest leaves; the rest never gets cut.
  const rest = [head, how, card, close].filter(Boolean).join('\n\n');
  const label = 'What changed:';
  const room = Math.min(CHANGED_MAX, DM_MAX - rest.length - 2 - label.length - 1);
  let changed = '';
  if (!sameCommit && info.text && room >= 30) {
    const t = capText(info.text, room);
    changed = `${label}${t.includes('\n') ? '\n' : ' '}${t}`;
  }
  const out = [head, changed, how, card, close].filter(Boolean).join('\n\n');
  return out.length > DM_MAX ? out.slice(0, DM_MAX - 1) + '…' : out;
}

module.exports = { tag, refsIn, advance, statusLine, statusNote, buildStatusDm, whatChanged, splitCommit, betaShaFromNotes, STAGE };
