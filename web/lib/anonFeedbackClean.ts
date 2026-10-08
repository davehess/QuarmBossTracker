// Cleaner for anonymous feedback (AFB), the form on eqmimic.quest (the guild lead, 2026-10-08: "it
// needs to clean data before it even gets logged, looking for any sql, data exfiltration").
//
// PURE: no I/O, no logging, no clock. The server action runs this FIRST and stores or shows nothing
// that has not come out of it.
//
// WHY THIS EXISTS, honestly stated: every write is already a parameterized supabase-js insert, so a
// pasted `'; DROP TABLE` can never run as SQL. The cleaner is not the SQL-injection defence. It exists
// so that nothing hostile or private is ever STORED or SHOWN to an officer: an anonymous box accepts
// arbitrary text, and what lands in the table later gets read on /admin, copied into docs and, one day,
// relayed into Discord. So it removes the things that are dangerous or private in that life:
//   - SQL-looking text   (a stored probe is noise at best, a lead for the next attempt at worst)
//   - links and domains  (phishing and exfiltration: "paste your token at evil.example")
//   - emails, IPs, secrets, user-name paths (a log excerpt pasted in good faith leaks all four)
//   - HTML and template syntax (nothing renders it today; the next reader might)
//   - invisible and bidi characters (they hide all of the above from a human reader)
// Redactions become "[removed]" and are named in `flags`, so an officer can see that something was cut
// and what kind, never what.
//
// It is deliberately conservative about FALSE positives: plain EverQuest prose ("select your target",
// "union of the raid groups", "Plane of Fear", "50% hp") must come through untouched, so the SQL rules
// need SQL SHAPE (a column list and a table, a `values (`, a tautology with equal sides), not a keyword.

export const MAX_MESSAGE_CHARS = 4000;
// Pre-scan cap, so a multi-megabyte paste cannot make the pattern passes slow.
const MAX_RAW_CHARS = 16000;
const MIN_REAL_CHARS = 10;
const MAX_REDACTED_RATIO = 0.5;
const MARK = '[removed]';

export type AnonMessageResult = { text: string; flags: string[]; reject?: string };
export type AnonContactResult = { contact: string | null; flags: string[] };

type Ctx = { flags: Set<string>; removed: number };

// Replace every match with the marker and note it. `keep` lets a rule look at the match and decline.
function redact(
  s: string, rx: RegExp, flag: string, ctx: Ctx,
  keep?: (g: string[]) => boolean,
): string {
  return s.replace(rx, (...args: any[]) => {
    const m = args[0] as string;
    // args = [match, ...captures, offset, whole]; none of the rules use named groups.
    if (keep && !keep(args.slice(0, -2) as string[])) return m;
    ctx.flags.add(flag);
    ctx.removed += m.length;
    return MARK;
  });
}

// ── Invisible characters ────────────────────────────────────────────────────────
// C0/C1 controls except \t \n \r, zero-width, bidi embeddings/overrides/isolates, BOM, soft hyphen.
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF9-\uFFFB]/g;

// ── HTML ────────────────────────────────────────────────────────────────────────
const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const HTML_BLOCK = /<\s*(script|style|iframe|object|embed|svg|math|noscript|template)\b[\s\S]*?(?:<\s*\/\s*\1\s*>|$)/gi;
// A tag starts with `<` then a letter (or `/`, `!`, `?`): "hp < boss" and "<3" are not tags.
const HTML_TAG = /<\/?[a-z!?][^<>\n]{0,300}(?:>|(?=\n)|$)/gi;

// ── Secrets ─────────────────────────────────────────────────────────────────────
const SECRET_RULES: RegExp[] = [
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]*)?/g,                       // JWT
  /(?<![\w-])[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,}/g,               // Discord bot token
  /\b(?:sk|pk|rk)[-_](?:live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}/g,                     // sk-… / sk_live_…
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,                                                         // GitHub
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,                                                        // AWS
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,                                                       // Slack
  /\bAIza[0-9A-Za-z_-]{35}/g,                                                              // Google
  // Connection strings: scheme://user:pass@host/db and friends. Before the URL rule so they flag as secret.
  /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?|mssql|sqlserver|jdbc:[a-z]+)(?::\/\/)\S*/gi,
  // Bearer tokens, and name=value / name:value pairs for the names that mean a credential.
  /\bbearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /\b(?:password|passwd|pwd)\s*[=:]\s*\S+/gi,
  /\b(?:secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|auth(?:orization)?|session[_-]?id|cookie)\s*=\s*\S+/gi,
  /\b(?:secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret)\s*:(?=\S)\S+/gi,
];
const HEX_LONG = /\b[0-9a-fA-F]{32,}\b/g;
const BASE64_LONG = /[A-Za-z0-9+/_-]{40,}={0,2}/g;

// ── Email ───────────────────────────────────────────────────────────────────────
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,5}/g;
const EMAIL_OBFUSCATED = /[A-Za-z0-9._%+-]{1,64}\s?[[(]\s?at\s?[\])]\s?[A-Za-z0-9-]{1,63}(?:\s?(?:[[(]\s?dot\s?[\])]|\.)\s?[A-Za-z0-9-]{1,63}){1,4}/gi;

// ── URLs and bare domains ───────────────────────────────────────────────────────
// TLDs that are not also English words, plus the well-known phishing ones. Matched lowercase or
// ALL-UPPER only: "it crashed.No idea why" (a missing space after a full stop) must survive. Left out on
// purpose because they are file extensions people paste: sh, pl, ml, cc.
const TLDS = [
  'com', 'net', 'org', 'io', 'gg', 'co', 'xyz', 'info', 'biz', 'app', 'dev', 'ly', 'tv', 'ws', 'pw', 'tk',
  'ga', 'cf', 'gq', 'link', 'click', 'quest', 'club', 'online', 'site', 'store', 'cloud', 'tech', 'top',
  'edu', 'gov', 'me', 'us', 'to', 'uk', 'de', 'fr', 'ru', 'cn', 'jp', 'br', 'nl', 'au', 'ca',
];
const TLD_ALT = [...TLDS, ...TLDS.map((t) => t.toUpperCase())].join('|');
const URL_SCHEME = /\b(?:https?|ftps?|wss?|sftp|ssh|file|gopher|ldaps?|smb|ipfs):\/\/\S*/gi;
const URL_PSEUDO = /\b(?:javascript|vbscript|data|blob):(?=\S)\S+/gi;
const URL_WWW = /\bwww\.\S+/gi;
const DOMAIN = new RegExp(
  String.raw`(?<![\w@.-])(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.){1,5}(?:${TLD_ALT})(?![a-zA-Z0-9-])(?::\d{1,5})?(?:[/?#]\S*)?`,
  'g',
);
const DOMAIN_OBFUSCATED = /\b[a-z0-9-]{1,63}(?:\s?[[(]\s?dot\s?[\])]\s?[a-z0-9-]{1,63}){1,4}\b/gi;

// ── IP addresses ────────────────────────────────────────────────────────────────
const OCT = String.raw`(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`;
const IPV4 = new RegExp(String.raw`(?<![\d.])(?:${OCT}\.){3}${OCT}(?!\d|\.\d)(?::\d{1,5})?`, 'g');
const IPV6 = new RegExp(
  [
    String.raw`(?<![0-9a-fA-F:])(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}(?![0-9a-zA-Z:])`,
    String.raw`(?<![0-9a-zA-Z:])(?:[0-9a-fA-F]{1,4}:){1,6}:(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,5})?(?![0-9a-zA-Z:])`,
    String.raw`(?<![0-9a-zA-Z:])::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}(?![0-9a-zA-Z:])`,
  ].join('|'),
  'g',
);

// ── Paths that carry a user name ────────────────────────────────────────────────
// C:\Users\<name>\…, C:/Users/<name>/…, /home/<name>/…, /Users/<name>/…, \\server\share\…
// A game path with no user in it (C:\EverQuest\Logs) is useful to us and is left alone.
// Windows account names may hold a space ("John Smith"), so the name runs to the next separator.
const WIN_NAME = String.raw`(?:[^\\/\n]{1,64}(?=[\\/])|[^\\/\s]{1,64})`;
const PATH_WIN = new RegExp(String.raw`(?<![\w])[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+${WIN_NAME}(?:[\\/]\S*)?`, 'gi');
const PATH_UNIX = /(?<![\w.:/~-])\/(?:(?:home|Users)\/[^\\/\s]{1,64}(?:\/\S*)?|root\/\S*)/g;
const PATH_UNC = /\\\\[^\\\s]{1,64}\\\S*/g;

// ── SQL ─────────────────────────────────────────────────────────────────────────
// S = whitespace OR an inline comment, so `UNION/**/SELECT` is still a UNION SELECT.
const S = String.raw`(?:\s|/\*[\s\S]{0,60}?\*/)+`;
const IDENT = String.raw`[\w."\x60\[\]]+`;
const CLAUSE_TAIL = String.raw`(?=(${S}(?:where|limit|order|group|join|having|union)\b|\s*(?:;|--)|\s*$)?)`;

// Tables worth naming: a bare `select x from <one of these>` is SQL, `select a mob from the list` is not.
// Only names that are not also something a raider clicks on ("characters", "members", "sessions" stay out).
const TABLE_WORDS = new Set([
  'users', 'passwords', 'credentials', 'secrets', 'tokens', 'admins', 'wolfpack_members', 'wolfpack_roles',
  'anon_feedback', 'encounter_players', 'chat_messages', 'audit_log', 'bot_kv', 'dual', 'pg_user', 'pg_shadow',
  'pg_tables', 'pg_roles',
]);
const tableish = (t: string | undefined) => {
  const w = (t || '').replace(/["\x60[\]]/g, '').toLowerCase();
  return w.includes('.') || TABLE_WORDS.has(w);
};

// The column list may not run across ANOTHER `select`, or one prose "select" would swallow a real query after it.
// A leading UNION [ALL] is taken with it, or `UNION SELECT a FROM users` would leave a bare "UNION" behind.
const SELECT_FROM = new RegExp(String.raw`(?:\bunion${S}(?:(?:all|distinct)${S})?)?\bselect${S}(\*|(?:(?!\bselect\b)[^;\n]){1,160}?)${S}from${S}(${IDENT})${CLAUSE_TAIL}`, 'gi');
// DROP/ALTER/TRUNCATE/CREATE <object>. "drop table" is also a loot-table phrase in EverQuest, so a bare
// `drop table <word>` only counts with SQL shape: a known table, IF EXISTS, or a statement end.
const DDL = new RegExp(
  String.raw`\b(drop|alter|truncate|create)${S}(?:temp(?:orary)?${S})?(table|database|schema|trigger|extension|policy|index)\b((?:${S}(?:if${S}(?:not${S})?exists${S})?${IDENT})?)(?=(\s*(?:;|--))?)`,
  'gi',
);
const DELETE_FROM = new RegExp(String.raw`\bdelete${S}from${S}(${IDENT})${CLAUSE_TAIL}`, 'gi');
const PURE_COLUMN_LIST = /^[\w.\x60"[\]@*]+(?:\s*,\s*[\w.\x60"[\]@*]+)*$/;

const SQL_RULES: RegExp[] = [
  new RegExp(String.raw`\bunion${S}(?:(?:all|distinct)${S})?select\b`, 'gi'),
  new RegExp(String.raw`\binsert${S}(?:ignore${S})?into${S}${IDENT}(?:${S})?(?:\(|values\b|select\b|set\b|default\b)`, 'gi'),
  new RegExp(String.raw`\bupdate${S}${IDENT}${S}set${S}${IDENT}\s*=`, 'gi'),
  new RegExp(String.raw`\btruncate${S}${IDENT}\s*;`, 'gi'),
  new RegExp(String.raw`\b(?:(?:exec|execute)${S})?(?:xp_\w+|sp_(?:executesql|configure|oacreate|oamethod|makewebtask|addlinkedserver)\b)`, 'gi'),
  /\bexec\(/gi,
  // Time-based and file/IO functions: only with the paren touching the name, which prose never does.
  /\b(?:pg_sleep|benchmark|sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|lo_import|lo_export|load_file|dblink(?:_connect|_exec)?|extractvalue|updatexml)\([^)\n]{0,80}\)?/gi,
  new RegExp(String.raw`\bwaitfor${S}delay\b`, 'gi'),
  new RegExp(String.raw`\binto${S}(?:outfile|dumpfile)\b`, 'gi'),
  new RegExp(String.raw`\bcopy${S}[\w."]+${S}(?:to|from)${S}program\b`, 'gi'),
  /\b(?:information_schema|pg_catalog|pg_shadow|pg_authid|sqlite_master|sysobjects|syscolumns|mysql\.user|auth\.users)\b/gi,
  /@@(?:version|datadir|hostname)\b/gi,
  // Statement-ending tricks: ';-- ', "'; --", and a quote glued to a comment.
  /['"\x60]\s*;\s*(?:--|\/\*)|['"]--|\)\s*;\s*--/g,
  // Inline comment injection (after the rules above, which tolerate comments between their words).
  /\/\*[\s\S]{0,200}?\*\//g,
];

// `or 1=1`, `and 'a'='a'`, `or ""=""`: a comparison whose two sides are the same (or both numbers).
// The closing quote on the right is optional: the classic `' or '1'='1` leaves it for the app to supply.
const TAUTOLOGY = new RegExp(String.raw`\b(?:or|and)${S}(['"]?)([\w.]*)\1\s*(=|<>|!=|like)\s*(['"]?)([\w.]*)\4?(?![\w.])`, 'gi');

// ── Template / shell syntax and mass pings ──────────────────────────────────────
const SCRIPT_RULES: RegExp[] = [
  /\$\{[^}\n]{0,200}\}/g,
  /\{\{[^}\n]{0,200}\}\}/g,
  /\$\([^)\n]{0,200}\)/g,
];
const MENTION = /@(?:everyone|here)\b/gi;

/**
 * Clean a free-text feedback message. Never throws; never logs.
 * `text` is '' when `reject` is set, so a caller cannot store a rejected message by accident.
 */
export function cleanAnonMessage(raw: unknown): AnonMessageResult {
  const ctx: Ctx = { flags: new Set(), removed: 0 };
  const input = typeof raw === 'string' ? raw : '';
  if (input.length > MAX_RAW_CHARS) ctx.flags.add('truncated');

  // NFKC folds look-alikes first (fullwidth ＳＥＬＥＣＴ, ligatures), so the rules below see plain letters.
  let s = input.slice(0, MAX_RAW_CHARS).normalize('NFKC').replace(/\r\n?/g, '\n');
  const before = s.length;
  s = s.replace(INVISIBLE, '');
  if (s.length !== before) ctx.flags.add('control');
  // Invisible characters gone BEFORE any rule runs, so "UN\u200BION SELECT" cannot dodge them.
  s = s.replace(/[ \t\u00A0\u2000-\u200A\u202F\u205F\u3000]+/g, ' ');
  if (s.length > MAX_MESSAGE_CHARS) { s = s.slice(0, MAX_MESSAGE_CHARS); ctx.flags.add('truncated'); }
  const base = s.length;

  // HTML first, to a fixed point: "<scr<script></script>ipt>" must not survive one pass.
  // Blocks go before bare tags, and repeat on their own: removing an inner <script></script> can
  // assemble a new outer one, and a bare-tag pass in between would strip its tags but keep the payload.
  const strip = (rx: RegExp) => {
    s = s.replace(rx, (m) => { ctx.flags.add('html'); ctx.removed += m.length; return ''; });
  };
  for (let i = 0; i < 4; i++) {
    const prev = s;
    for (let j = 0; j < 4; j++) {
      const inner = s;
      strip(HTML_COMMENT);
      strip(HTML_BLOCK);
      if (s === inner) break;
    }
    strip(HTML_TAG);
    if (s === prev) break;
  }

  for (const rx of SECRET_RULES) s = redact(s, rx, 'secret', ctx);
  s = redact(s, EMAIL, 'email', ctx);
  s = redact(s, EMAIL_OBFUSCATED, 'email', ctx);
  s = redact(s, URL_SCHEME, 'url', ctx);
  s = redact(s, URL_PSEUDO, 'url', ctx);
  s = redact(s, URL_WWW, 'url', ctx);
  s = redact(s, DOMAIN, 'url', ctx);
  s = redact(s, DOMAIN_OBFUSCATED, 'url', ctx);
  s = redact(s, IPV4, 'ip', ctx);
  s = redact(s, IPV6, 'ip', ctx);
  s = redact(s, PATH_WIN, 'path', ctx);
  s = redact(s, PATH_UNIX, 'path', ctx);
  s = redact(s, PATH_UNC, 'path', ctx);
  s = redact(s, HEX_LONG, 'secret', ctx);
  s = redact(s, BASE64_LONG, 'secret', ctx);

  // SQL: the contextual rules first (they need to look at what follows), then the plain ones.
  s = redact(s, SELECT_FROM, 'sql', ctx, (g) => {
    const list = (g[1] || '').trim();
    if (list === '*' || /\w\(/.test(list) || list.includes('@@')) return true;
    if (!PURE_COLUMN_LIST.test(list)) return false;
    return tableish(g[2]) || !!g[3];
  });
  s = redact(s, DELETE_FROM, 'sql', ctx, (g) => tableish(g[1]) || !!g[2]);
  s = redact(s, DDL, 'sql', ctx, (g) => {
    if (g[1].toLowerCase() !== 'drop' || g[2].toLowerCase() !== 'table') return true;
    const idents = (g[3] || '').trim().split(/\s+/);
    return /\bif\s+exists\b/i.test(g[3] || '') || tableish(idents[idents.length - 1]) || !!g[4];
  });
  s = redact(s, TAUTOLOGY, 'sql', ctx, (g) => {
    const [, q1, l, , q2, r] = g;
    if (!l && !r) return false;
    if (/^\d+$/.test(l) && /^\d+$/.test(r)) return true;
    return (!!q1 || !!q2 || l !== '') && l.toLowerCase() === r.toLowerCase();
  });
  for (const rx of SQL_RULES) s = redact(s, rx, 'sql', ctx);

  for (const rx of SCRIPT_RULES) s = redact(s, rx, 'script', ctx);
  s = redact(s, MENTION, 'mention', ctx);

  // Neighbouring markers read as one, and tidy the whitespace the cuts left behind.
  s = s
    .replace(/\[removed\](?:\s*\[removed\])+/g, MARK)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ {2,}/g, ' ')
    .trim();

  const flags = Array.from(ctx.flags);
  const real = s.split(MARK).join('').replace(/[^\p{L}\p{N}]/gu, '').length;
  if (real < MIN_REAL_CHARS) {
    return {
      text: '',
      flags,
      reject: ctx.removed > 0
        ? 'Once links, code-like text and private details are removed there is too little left. Please describe it in plain words.'
        : 'Please write a little more, at least a sentence in plain words.',
    };
  }
  if (base > 0 && ctx.removed / base > MAX_REDACTED_RATIO) {
    return {
      text: '',
      flags,
      reject: 'Most of that looked like code, links or private details, which are removed before anything is saved. Please describe the problem in plain words.',
    };
  }
  return { text: s, flags };
}

// ── Discord contact ─────────────────────────────────────────────────────────────
const CONTACT_USERNAME = /^[a-z0-9_.]{2,32}$/;
const CONTACT_LEGACY = /^[\p{L}\p{N}_. -]{2,32}#\d{4}$/u;
const CONTACT_SNOWFLAKE = /^\d{17,20}$/;

/**
 * Validate the optional Discord contact: a new-style username (lowercased), a legacy name#1234, or a
 * user id. Anything else is dropped (null + 'contact_invalid') rather than stored. Empty is not invalid.
 */
export function cleanDiscordContact(raw: unknown): AnonContactResult {
  if (typeof raw !== 'string') return { contact: null, flags: [] };
  let s = raw.slice(0, 200).normalize('NFKC').replace(INVISIBLE, '').trim();
  if (s.startsWith('@')) s = s.slice(1).trim();
  if (!s) return { contact: null, flags: [] };

  if (CONTACT_SNOWFLAKE.test(s)) return { contact: s, flags: [] };
  if (CONTACT_LEGACY.test(s)) return { contact: s, flags: [] };
  const lower = s.toLowerCase();
  if (CONTACT_USERNAME.test(lower) && !lower.includes('..')) return { contact: lower, flags: [] };
  return { contact: null, flags: ['contact_invalid'] };
}
