// Guild-trigger pattern normalization — the save-time guard for #190.
//
// THE BUG THIS EXISTS TO PREVENT (measured 2026-08-04): the agent matches
// trigger patterns against the RAW log line, which carries the EQ timestamp:
//
//   [Sun Aug 02 21:10:01 2026] Uilnayar looks somewhat dimwitted.
//
// Patterns compile with flags 'i' and NO 'm' (`_applyGuildTriggersResponse` in
// the agent), so `^` anchors to the start of that whole string — not to the
// start of the message. Anyone writing `^{s} looks somewhat dimwitted\.$` means
// "the message starts with the name", and gets a trigger that can never fire.
//
// 37 of 109 enabled triggers were written that way, including eight callouts
// added the day this was found. Every one read as coverage on /admin/triggers,
// which is exactly what made it survive: an enabled trigger nobody has reason to
// doubt. See docs/RUNBOOK-dead-triggers.md.
//
// So: rewrite `^` to `^\[.+?\]\s+` at save time. This is deliberately a REWRITE
// rather than a rejection — a bare leading `^` has no valid meaning here, so
// there is nothing to preserve and no reason to make an officer debug regex
// anchoring mid-raid. The normalized pattern is what the list renders, so the
// change is visible rather than hidden.
//
// WHY NOT just strip the `^`: the `{s}` placeholder expands to a class that
// INCLUDES SPACE (`[\w'`\ -]+?`). Unanchored, the engine's leftmost match starts
// at the space after `]` and captures " Uilnayar" — with a leading space. That
// silently corrupts every name-keyed consumer downstream (TTS, the charm-pet
// suppression check, require_raid_member). Anchoring past the timestamp and
// consuming the separator with `\s+` hands back a clean name.

/** The prefix that anchors to the start of the MESSAGE rather than the line. */
export const TIMESTAMP_PREFIX = '^\\[.+?\\]\\s+';

/**
 * True when `body` contains a `|` at paren depth 0 — i.e. a top-level
 * alternation, where prefixing without wrapping would anchor only the FIRST
 * branch and silently change what the other branches mean.
 *
 * Skips escaped characters and character classes, since a `|` inside either is
 * a literal and not an alternation.
 */
function hasTopLevelAlternation(body: string): boolean {
  let depth = 0;
  let inClass = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\') { i++; continue; }          // escaped char — skip the pair
    if (inClass) { if (c === ']') inClass = false; continue; }
    if (c === '[') { inClass = true; continue; }
    if (c === '(') { depth++; continue; }
    if (c === ')') { if (depth > 0) depth--; continue; }
    if (c === '|' && depth === 0) return true;
  }
  return false;
}

/**
 * Normalize a guild-trigger pattern for save.
 *
 * Only touches a leading bare `^`. Everything else — unanchored patterns,
 * patterns already anchored past the timestamp, and `^.`-style patterns whose
 * next token can consume the timestamp itself — is returned untouched, because
 * those already work and rewriting a working pattern is its own hazard.
 */
export function normalizeTriggerPattern(pattern: string): string {
  const p = String(pattern ?? '');
  if (!p.startsWith('^')) return p;                     // unanchored: already fine
  if (p.startsWith(TIMESTAMP_PREFIX)) return p;         // already normalized
  if (p.startsWith('^\\[')) return p;                   // hand-written timestamp anchor

  const rest = p.slice(1);
  // `^.`/`^.*`/`^.+` already match through the timestamp. Leave them alone.
  if (rest.startsWith('.')) return p;

  return TIMESTAMP_PREFIX + (hasTopLevelAlternation(rest) ? `(?:${rest})` : rest);
}

/**
 * True when a pattern, as written, can never match a real log line.
 * Used to flag EXISTING rows on /admin/triggers — normalization only protects
 * new saves, and there are 37 of these already in the table.
 */
export function isDeadAnchored(pattern: string): boolean {
  const p = String(pattern ?? '');
  return p.startsWith('^')
    && !p.startsWith(TIMESTAMP_PREFIX)
    && !p.startsWith('^\\[')
    && !p.slice(1).startsWith('.');
}
