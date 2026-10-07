// iniKeyEdits.js — change named keys in an EQ ini and touch nothing else.
//
// The one key-level writer for UI Studio. Both Save paths (immediate, and the
// "apply after logout" deferred one) and the Hotbar Pages / chat-routing writer
// ('ui-studio-write-pages') go through it. It exists because Studio's Save used
// to rebuild WHOLE files from the copy read when Studio opened, so anything EQ
// saved since — the ~50 bag windows the stage hides, a window moved in game —
// reverted (the guild lead, 2026-10-05: "A for UI Studio"). Given the file's
// CURRENT text and a list of keys, this changes only those keys:
//   - a key that exists is updated in place (its own spelling, spacing around
//     "=" and trailing whitespace stay);
//   - a key that does not exist is added at the end of its section (after the
//     section's last non-blank line, so blank lines between sections stay put);
//   - a section that does not exist is created at the end of the file;
//   - value null deletes the key line;
//   - every other byte stays: comments, order, other sections, other
//     resolution blocks, each line's own CRLF/LF, a missing final newline.
// Section and key names match case-insensitively, like the Windows profile API
// EQ reads these files with, so an edit cannot grow a second "xpos…" beside the
// "XPos…" EQ wrote. When a section name appears twice the FIRST block is the
// one used, which is the one the profile API reads.
// Edits that would change nothing leave `changed` false, so the caller can skip
// the backup and the write.
'use strict';

const SEC_RE = /^\s*\[([^\]]+)\]\s*$/;
const KEY_RE = /^(\s*)([\w.]+)(\s*=\s*)(.*?)(\s*)$/;
const SIG_SEP = '\x01';

// Lines with their own terminator, so an untouched line round-trips exactly.
function splitLines(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const nl = text.indexOf('\n', i);
    if (nl < 0) { out.push({ t: text.slice(i), e: '' }); break; }
    const cr = nl > i && text[nl - 1] === '\r';
    out.push({ t: text.slice(i, cr ? nl - 1 : nl), e: cr ? '\r\n' : '\n' });
    i = nl + 1;
  }
  return out;
}

// edits: [{ section, key, value }]  (value null = delete the key)
function applyIniKeyEdits(orig, edits) {
  const text = String(orig == null ? '' : orig);
  const lines = splitLines(text);
  const fileEol = text.includes('\r\n') ? '\r\n' : (text.includes('\n') ? '\n' : '\r\n');

  // (section, key) → what to write. A later edit for the same pair wins.
  const want = new Map();
  for (const e of Array.isArray(edits) ? edits : []) {
    if (!e || typeof e.section !== 'string' || typeof e.key !== 'string') continue;
    const section = e.section.trim();
    // Names that could not round-trip through the line shapes below would
    // write a line the reader never finds (or inject one) — refuse them.
    if (!section || /[\]\r\n]/.test(section) || !/^[\w.]+$/.test(e.key)) continue;
    const value = e.value == null ? null : String(e.value).replace(/[\r\n]+/g, ' ');
    want.set(section.toLowerCase() + SIG_SEP + e.key.toLowerCase(), { section, key: e.key, value });
  }
  if (!want.size) return { text, changed: false };

  const seen = new Set();         // sections already opened (first block wins)
  const lastContent = new Map();  // section → index of its last non-blank line
  let cur = null;                 // lowercase name of the block being walked, or null for a repeat block
  let changed = false;
  const kept = [];                // lines after in-place updates / deletions
  for (const ln of lines) {
    const ms = SEC_RE.exec(ln.t);
    if (ms) {
      const name = ms[1].trim().toLowerCase();
      if (seen.has(name)) cur = null;
      else { seen.add(name); cur = name; }
      kept.push(ln);
      if (cur) lastContent.set(cur, kept.length - 1);
      continue;
    }
    if (cur) {
      const mk = KEY_RE.exec(ln.t);
      if (mk) {
        const sig = cur + SIG_SEP + mk[2].toLowerCase();
        const w = want.get(sig);
        if (w) {
          want.delete(sig);
          if (w.value === null) { changed = true; continue; }          // drop the key line
          if (mk[4] !== w.value) {
            kept.push({ t: mk[1] + mk[2] + mk[3] + w.value + mk[5], e: ln.e });
            changed = true;
          } else {
            kept.push(ln);                                              // already that value
          }
          lastContent.set(cur, kept.length - 1);
          continue;
        }
      }
      if (ln.t.trim() !== '') lastContent.set(cur, kept.length);   // index this line is about to take
    }
    kept.push(ln);
  }

  // Keys still wanted do not exist yet: group by section, in the order given.
  const adds = new Map();   // lowercase section → { section, lines: ['Key=Value'] }
  for (const w of want.values()) {
    if (w.value === null) continue;                                    // deleting a key that is not there
    const sl = w.section.toLowerCase();
    if (!adds.has(sl)) adds.set(sl, { section: w.section, lines: [] });
    adds.get(sl).lines.push(w.key + '=' + w.value);
  }
  // Into sections that exist — bottom-up, so earlier indices stay valid.
  const into = [...adds.entries()].filter(([sl]) => lastContent.has(sl))
    .sort((a, b) => lastContent.get(b[0]) - lastContent.get(a[0]));
  for (const [sl, add] of into) {
    const at = lastContent.get(sl);
    const anchor = kept[at];
    const eol = anchor.e || fileEol;
    const lastTerminated = anchor.e !== '';
    const fresh = add.lines.map((t, i) => ({
      t, e: (!lastTerminated && i === add.lines.length - 1) ? '' : eol,
    }));
    if (!lastTerminated) anchor.e = fileEol;       // the old last line now has something after it
    kept.splice(at + 1, 0, ...fresh);
    changed = true;
  }
  // Sections that do not exist: appended at the end of the file.
  const fresh = [...adds.entries()].filter(([sl]) => !lastContent.has(sl));
  if (fresh.length) {
    const tail = kept.length ? kept[kept.length - 1] : null;
    const noFinalNewline = !!tail && tail.e === '';
    if (noFinalNewline) tail.e = fileEol;
    const out = [];
    for (const [, add] of fresh) {
      out.push(({ t: '[' + add.section + ']', e: fileEol }));
      for (const t of add.lines) out.push({ t, e: fileEol });
    }
    if (noFinalNewline) out[out.length - 1].e = '';   // keep "no trailing newline" as the file had it
    kept.push(...out);
    changed = true;
  }

  if (!changed) return { text, changed: false };
  return { text: kept.map(l => l.t + l.e).join(''), changed: true };
}

module.exports = { applyIniKeyEdits };
