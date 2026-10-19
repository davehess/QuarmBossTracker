// utils/gallerySpec.js — what the Masterpiece Gallery will accept from a stranger's pen.
//
// A published layout is member-authored data that anonymous visitors then download and adopt into their own Mimic, so
// it is validated as untrusted input. The stored spec IS the portable layout document Mimic exports
// (`format: "mimic-layout"`, see utils/portableLayout.js for the copy of Mimic's own validator): validate() rebuilds the
// document from a whitelist, so unknown keys are never copied, every number is range-checked and every id/part/key
// is pattern-checked. This file adds only what the gallery needs on top, and where the two disagree the STRICTER bound
// wins:
//
//   field                    Mimic's format        gallery            wins
//   document size            256 KB (file read)    64 KB (DB check)   gallery
//   pieces in all (panels)   150                   60                 gallery
//   groups                   60                    60                 same
//   title                    60                    60, no markup/link same, stricter text
//   description              280                   280, no markup/link same, stricter text
//   author / byline          32                    24, cleaned        gallery
//
// The free-text fields (title, description, author) are the only strings in the format that are not pattern-checked
// ids, so they get the markup/link rejection here. Pure (no I/O); test/gallery.test.js, test/gallery-portable.test.js.

const portable = require('./portableLayout');

const MAX_SPEC_BYTES = 64 * 1024;          // the migration's check agrees (octet_length(spec::text) <= 65536)
const MAX_PIECES = 60;
const MAX_BYLINE = 24;
const MAX_STRING = 280;

const CLASSES = portable.CLASSES;
const MODES = portable.MODES;
const REPORT_REASONS = ['offensive', 'spam', 'broken', 'other'];

// Zero-width and bidi-control characters: invisible, and useful only for spoofing.
const INVISIBLE_RE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/;
const ENTITY_RE = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]{1,31});/i;
const SCHEME_RE = /\b(?:https?|ftp|file|data|javascript|vbscript|blob|mailto):/i;
const WWW_RE = /\bwww\./i;
const TLD_RE = /\b[a-z0-9-]{2,}\.(?:com|net|org|io|gg|tv|me|co|xyz|app|dev|ly|to|us|uk|ru|cn|info|biz|link|site|online|shop|ws|cc|tk|ml|ga|cf|gq)\b/i;

function _isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

// A single-line plain string: no markup, no links, no control characters. REJECTS rather than repairs, so the author
// sees why. Returns { ok, text } or { ok: false, error }.
function cleanText(value, max = MAX_STRING, { allowEmpty = false, label = 'text' } = {}) {
  if (typeof value !== 'string') return { ok: false, error: `${label} must be text` };
  let s = value.normalize('NFKC').replace(INVISIBLE_RE, '');
  if (CONTROL_RE.test(s.replace(/[\t\r\n]+/g, ' '))) return { ok: false, error: `${label} has control characters` };
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return allowEmpty ? { ok: true, text: '' } : { ok: false, error: `${label} is empty` };
  if (/[<>]/.test(s) || ENTITY_RE.test(s)) return { ok: false, error: `${label} cannot contain markup` };
  if (SCHEME_RE.test(s) || WWW_RE.test(s) || TLD_RE.test(s) || /\/\/\S/.test(s)) {
    return { ok: false, error: `${label} cannot contain a link` };
  }
  if (s.length > max) return { ok: false, error: `${label} is over ${max} characters` };
  return { ok: true, text: s };
}

// Byline: author-typed, <= 24 characters, letters/digits/space and ' ` _ - . only. Cleaned (stripped), not trusted:
// links are rejected, and a byline that reads as a guild or officer badge is rejected for any non-member submitter
// (a member's badge comes from the server, never from this text). Empty -> no byline. Never auto-filled.
function cleanByline(value, { kind = 'member' } = {}) {
  if (value == null || value === '') return { ok: true, text: null };
  if (typeof value !== 'string') return { ok: false, error: 'byline must be text' };
  const raw = value.normalize('NFKC').replace(INVISIBLE_RE, '');
  // A link is refused on what was TYPED, before the strip below could turn "http://x" into harmless-looking letters.
  if (SCHEME_RE.test(raw) || WWW_RE.test(raw) || TLD_RE.test(raw) || /\/\/\S/.test(raw)) return { ok: false, error: 'a byline cannot contain a link' };
  const s = raw.replace(/[^\p{L}\p{N} '`_.-]/gu, '').replace(/\s+/g, ' ').trim();
  if (!s) return { ok: true, text: null };
  if (kind !== 'member' && /wolf\s*pack|officer|official|staff/i.test(s)) {
    return { ok: false, error: 'that byline reads as a badge' };
  }
  if (s.length > MAX_BYLINE) return { ok: false, error: `a byline is at most ${MAX_BYLINE} characters` };
  return { ok: true, text: s };
}

function cleanMinLevel(v) {
  if (v === undefined) return { ok: true, value: 1 };
  if (!Number.isInteger(v) || v < 1 || v > 70) return { ok: false, error: 'min_level must be 1 to 70' };
  return { ok: true, value: v };
}

// The compact shape a list card draws its thumbnail from: numbers and enum tokens only (no strings), so it can ride a
// list response without a spec fetch. { a: aspect, g: [[anchor, ox, oy, [[kind, dx, dy, w, h], ...]], ...] }.
function thumbFromSpec(doc) {
  const r = (n) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0);
  return {
    a: doc.ref ? doc.ref.aspect : null,
    g: doc.groups.map(g => [g.anchor, r(g.ox), r(g.oy), g.panels.map(p => [p.kind, r(p.dx), r(p.dy), r(p.w), r(p.h)])]),
  };
}

// Validate a portable layout document for publication. { ok, spec, listing, needs, thumb } or { ok: false, error }.
//   spec     the document REBUILT by Mimic's validator (with the free-text fields cleaned), what is stored
//   listing  { title, blurb, classes, modes, byline } read from the document's meta: a new version carries its own
//   needs    the parts/overlays/sections the layout needs, computed from the pieces (never read from the file)
function validateSpec(input) {
  if (!_isObj(input)) return { ok: false, error: 'spec must be an object' };
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(input), 'utf8'); } catch { return { ok: false, error: 'spec is not JSON' }; }
  if (bytes > MAX_SPEC_BYTES) return { ok: false, error: `spec is over ${MAX_SPEC_BYTES / 1024} KB` };

  const v = portable.validate(input);
  if (!v.ok) return { ok: false, error: v.error };
  const doc = v.doc;

  const pieces = doc.groups.reduce((n, g) => n + g.panels.length, 0);
  if (pieces > MAX_PIECES) return { ok: false, error: `a shared layout is at most ${MAX_PIECES} pieces` };

  // validate() fills a blank title with "Untitled layout"; a published layout must be named by its author.
  const rawTitle = input.meta && input.meta.title;
  if (typeof rawTitle !== 'string' || !rawTitle.trim()) return { ok: false, error: 'the layout needs a title' };
  const title = cleanText(doc.meta.title, 60, { label: 'title' });
  if (!title.ok) return { ok: false, error: title.error };
  const blurb = cleanText(doc.meta.description, 280, { label: 'description', allowEmpty: true });
  if (!blurb.ok) return { ok: false, error: blurb.error };
  const byline = cleanByline(doc.meta.author, { kind: 'member' });
  if (!byline.ok) return { ok: false, error: byline.error };

  doc.meta.title = title.text;
  doc.meta.description = blurb.text;
  doc.meta.author = byline.text || '';
  if (Buffer.byteLength(JSON.stringify(doc), 'utf8') > MAX_SPEC_BYTES) return { ok: false, error: `spec is over ${MAX_SPEC_BYTES / 1024} KB` };

  return {
    ok: true,
    spec: doc,
    listing: { title: title.text, blurb: blurb.text, classes: doc.meta.classes.slice(), modes: doc.meta.modes.slice(), byline: byline.text },
    needs: doc.needs,
    thumb: thumbFromSpec(doc),
  };
}

module.exports = {
  validateSpec, cleanMinLevel, cleanByline, cleanText, thumbFromSpec,
  CLASSES, MODES, REPORT_REASONS, MAX_SPEC_BYTES, MAX_PIECES, MAX_BYLINE,
};
