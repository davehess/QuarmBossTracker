// utils/feedbackRefs.js — short handles for bug and idea reports, and moving them on from commits.
//
// The guild lead, 2026-09-29: "We need to start having referenceable IDs for each bug or enhancement
// request so the bot can update these when they get implemented". Every feedback row has a sequential
// `ref` (migration 20260929020000); people and commits call it FB-<ref>. A commit on `beta` that names
// FB-12 moves report 12 to "on beta"; one on `main` moves it to implemented. A report only ever moves
// forward, because main is merged into beta constantly (sync-beta.yml) and would otherwise knock an
// implemented report back to "on beta". Pure; test/feedback-refs.test.js.

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

// The DM to whoever sent it.
function dmText(ref, category, status) {
  const what = category === 'bug' ? 'bug report' : 'idea';
  if (status === 'on_beta') return `🧪 Your ${what} ${tag(ref)} is fixed on the beta. It reaches everyone with the next stable release.`;
  if (status === 'addressed') return `✅ Your ${what} ${tag(ref)} is done and live. Thank you!`;
  return null;
}

module.exports = { tag, refsIn, advance, statusLine, dmText, STAGE };
