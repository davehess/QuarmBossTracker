// utils/rulesParser.js — pure Discord-message → guild-rule parser for #94.
//
// Zero dependencies so it unit-tests without booting discord.js (see
// test/rules-ingest.test.js). The bot's /ingestrules command orchestrates the
// Discord fetch + Supabase upsert; the actual message→rule shaping lives here.
//
// DELIBERATELY DUMB. We detect a leading rule NUMBER and a heading TITLE, but
// we never interpret rule SEMANTICS (eligibility logic, categorization) — that
// is #95/#93's job reading the store. `body` is ALWAYS the full trimmed message
// text, so nothing a message says is ever lost: an unrecognized message still
// lands as a raw-body row (rule_number null). Ingest fidelity over cleverness.

// The three rules channels and the env var each is read from. channel_key is
// the stable value stored on guild_rules.channel_key (the DB check constraint
// pins the same three).
const RULE_CHANNELS = [
  { key: 'rules',      env: 'RULES_CHANNEL_ID',      label: '#rules' },
  { key: 'raid_rules', env: 'RAID_RULES_CHANNEL_ID', label: '#raid-rules' },
  { key: 'loot_rules', env: 'LOOT_RULES_CHANNEL_ID', label: '#loot-rules' },
];

const TITLE_MAX = 200;
// A plain-text (non-markdown) first line only becomes a title when the leading
// clause is this short — otherwise it's prose, not a heading, and gets no title.
const HEADING_MAX = 80;

// Detect a leading rule number on the first line. Tolerant of the common
// shapes a human rulebook uses:
//   "12. Raid Kit"   "3) Be nice"   "12 - foo"   "Rule 7:"   "#4 foo"
// Returns the integer or null. Capped at 3 digits so a phone number or a big
// stat in prose doesn't get mistaken for a rule number.
function detectRuleNumber(firstLine) {
  const s = firstLine || '';
  const m =
    // "12." / "12)" / "12:" / "12 -"  (with a separator + following space)
    s.match(/^\s*(\d{1,3})\s*[.)\-–—:]\s+/) ||
    // "Rule 12" / "Rule 12:" / "#12"
    s.match(/^\s*(?:rule\s+|#)\s*(\d{1,3})\b/i);
  return m ? parseInt(m[1], 10) : null;
}

// Strip the leading number marker off the first line so what's left is the
// heading/body text.
function stripNumberMarker(firstLine) {
  return (firstLine || '')
    .replace(/^\s*\d{1,3}\s*[.)\-–—:]\s+/, '')
    .replace(/^\s*(?:rule\s+|#)\s*\d{1,3}\s*[.)\-–—:]?\s*/i, '')
    .trim();
}

// Extract a human-readable title from the first line's remaining text.
// Prefers an explicit markdown heading/bold; otherwise takes the leading
// clause up to a sentence break or dash. Returns null when nothing sensible
// remains (the message is pure prose — body still carries everything).
function detectTitle(headText) {
  const t = (headText || '').trim();
  if (!t) return null;

  // **bold** / __bold__ / markdown "# heading"
  const bold = t.match(/^\*\*(.+?)\*\*/) || t.match(/^__(.+?)__/);
  if (bold && bold[1].trim()) return clip(bold[1].trim());
  const heading = t.match(/^#{1,6}\s+(.+)$/);
  if (heading && heading[1].trim()) return clip(heading[1].replace(/[*_`]/g, '').trim());

  // Otherwise: the leading clause, up to the first sentence terminator or a
  // " - "/" — " separator. Keep it only if it reads like a heading (short-ish);
  // a wall of prose gets no invented title (rule_number/body still capture it).
  const plain = t.replace(/[*_`>#]/g, '').trim();
  if (!plain) return null;
  const clause = plain.split(/\s+[-–—]\s+|[.:!?](?:\s|$)/)[0].trim();
  if (!clause || clause.length > HEADING_MAX) return null;
  return clip(clause);
}

function clip(s) {
  if (s.length <= TITLE_MAX) return s;
  return s.slice(0, TITLE_MAX - 1).trimEnd() + '…';
}

// Parse one Discord message's raw content into { rule_number, title, body }.
// body is the full trimmed content — always present so nothing is dropped.
function parseRuleMessage(raw) {
  const body = (raw || '').trim();
  if (!body) return { rule_number: null, title: null, body: '' };

  const firstLine = body.split(/\r?\n/)[0].trim();
  const rule_number = detectRuleNumber(firstLine);
  const headText = stripNumberMarker(firstLine);
  const title = detectTitle(headText);

  return { rule_number, title, body };
}

// Build the guild_rules upsert row for one message. Pure + deterministic (given
// a fixed ingestedAtIso) so the ingest mapping is unit-testable without
// discord.js. The upsert KEY is (guild_id, channel_key, source_message_id) — an
// edit to the same message keeps the key and just refreshes the content fields,
// which is exactly what makes re-ingest idempotent.
function buildRuleRow({ guildId, channelKey, messageId, editedAtIso = null, ingestedAtIso, text }) {
  const { rule_number, title, body } = parseRuleMessage(text);
  return {
    guild_id:          guildId,
    channel_key:       channelKey,
    rule_number,
    title:             title ? title.slice(0, TITLE_MAX) : null,
    body,
    category:          null,                 // reserved for #95/#93 — not set at ingest
    source_message_id: String(messageId),
    source_edited_at:  editedAtIso,
    ingested_at:       ingestedAtIso,
    active:            true,
  };
}

module.exports = {
  RULE_CHANNELS,
  TITLE_MAX,
  parseRuleMessage,
  buildRuleRow,
  detectRuleNumber,
  detectTitle,
};
