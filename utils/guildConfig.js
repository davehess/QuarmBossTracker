// utils/guildConfig.js — the ONE place the bot reads guild/config.json (guild kit, slice 1b).
//
// Resolution order, everywhere: environment variable -> guild/config.json -> built-in fallback.
// Env always wins, so a deployment that sets everything in env and ships no config.json (ours)
// behaves byte-for-byte as it did before this file existed; every built-in fallback below is
// today's exact Wolf Pack value. Design: docs/DESIGN-guild-kit.md §2.
//
// Two ways a value reaches the bot:
//   1. fillEnv(process.env) — called once at the top of index.js, right after the slice-1a
//      discord.json loader. Fills ONLY unset/blank env names from ENV_MAP, so the ~dozens of
//      existing `process.env.X` reads pick the file up with no call-site edits.
//   2. The typed getters below (guildName(), webBase(), repo() ...) — for NEW code and the
//      de-brand sweep, so a value is resolved in one place instead of re-deriving a literal.
//
// SECRETS NEVER COME FROM THE FILE. Any key (at any depth) matching /spec|token|key|secret|password/i
// is stripped when the file is loaded, and get() will not read a file path or env name of that
// shape from the file. A channel password pasted into a committed file must not silently work
// (guild/README.md: names are config, passwords are secrets). Env may hold them; the file may not.
//
// Zero dependencies, CommonJS. The only side effect is a lazy, cached read of guild/config.json.
// Missing file -> {} silently. Invalid JSON -> {} with one console.warn.

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_DIR = path.join(__dirname, '..', 'guild');
const SECRET_RE_UPPER = /SPEC|TOKEN|KEY|SECRET|PASSWORD/;   // env-name shape (matches _loadGuildDiscordJson)
const SECRET_RE_ANY   = /spec|token|key|secret|password/i;  // config-key shape (camelCase keys too)
const PLACEHOLDER_RE  = /<[^<>]+>/;                         // "<discord-guild-id>", "https://<your-guild>.x"

// ── file loading ────────────────────────────────────────────────────────────

const _cache = new Map();   // dir -> { cfg, refused, present }

function _deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) _deepFreeze(o[k]);
  }
  return o;
}

// Walk an object and return the dotted paths of every secret-shaped key.
function _secretPaths(obj, prefix = '', out = []) {
  if (!obj || typeof obj !== 'object') return out;
  for (const k of Object.keys(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (SECRET_RE_ANY.test(k)) { out.push(p); continue; }
    _secretPaths(obj[k], p, out);
  }
  return out;
}

// Deep copy with secret-shaped keys removed.
function _stripSecrets(v) {
  if (Array.isArray(v)) return v.map(_stripSecrets);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) { if (!SECRET_RE_ANY.test(k)) o[k] = _stripSecrets(v[k]); }
    return o;
  }
  return v;
}

function _info(dir) {
  const d = dir || DEFAULT_DIR;
  if (_cache.has(d)) return _cache.get(d);
  const file = path.join(d, 'config.json');
  let info = { cfg: _deepFreeze({}), refused: [], present: false };
  let raw = null;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { /* no file: nothing to do */ }
  if (raw != null) {
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        info = { cfg: _deepFreeze(_stripSecrets(obj)), refused: _secretPaths(obj), present: true };
        if (info.refused.length) {
          console.warn(`[guild] config.json: refused secret-shaped key(s) ${info.refused.join(', ')} — secrets belong in .env, never in a committed file`);
        }
      } else {
        console.warn(`[guild] ${file} is not a JSON object — ignored`);
      }
    } catch (e) {
      console.warn(`[guild] ${file} is not valid JSON — ignored (${e.message})`);
    }
  }
  _cache.set(d, info);
  return info;
}

/** The parsed guild/config.json (frozen, secret-shaped keys removed). {} when absent or invalid. */
function load(dir) { return _info(dir).cfg; }

/** true only when config.json exists AND parsed as a JSON object. */
function hasConfigFile(dir) { return _info(dir).present; }

/** Test hook: forget cached reads (a test that rewrites the same temp dir). */
function _resetCache() { _cache.clear(); }

// ── resolution primitives ───────────────────────────────────────────────────

function _ctx(ctx) {
  return { dir: (ctx && ctx.dir) || DEFAULT_DIR, env: (ctx && ctx.env) || process.env };
}

function _envStr(env, k) {
  if (!k) return null;
  const v = env[k];
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

// Own-property dot-path walk; arrays/objects returned as-is. undefined when absent.
function dig(cfg, cfgPath) {
  if (!cfgPath) return undefined;
  let cur = cfg;
  for (const seg of String(cfgPath).split('.')) {
    if (cur == null || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

// A file value that still reads like the example's angle-bracket text is "not filled in yet".
function _isPlaceholder(v) { return typeof v === 'string' && PLACEHOLDER_RE.test(v); }

function _fileValue(c, cfgPath) {
  if (!cfgPath || SECRET_RE_ANY.test(cfgPath)) return undefined;
  const v = dig(load(c.dir), cfgPath);
  if (v == null || _isPlaceholder(v)) return undefined;
  if (Array.isArray(v)) {
    const keep = v.filter((x) => !_isPlaceholder(x));
    return keep.length ? keep : undefined;
  }
  return v;
}

/**
 * Resolve one value: trimmed non-empty env wins; else the config.json value at `cfgPath`
 * (dot path; arrays and objects returned as-is; angle-bracket placeholders count as absent);
 * else `dflt`. A secret-shaped env name (or config path) is never read from the FILE.
 * `ctx` is an optional {dir, env} for tests; default is guild/ and process.env.
 */
function get(envKey, cfgPath, dflt, ctx) {
  const c = _ctx(ctx);
  const e = _envStr(c.env, envKey);
  if (e != null) return e;
  if (envKey && SECRET_RE_UPPER.test(envKey)) return dflt;
  const f = _fileValue(c, cfgPath);
  return f === undefined ? dflt : f;
}

function _str(envKey, cfgPath, dflt, ctx) {
  const v = get(envKey, cfgPath, undefined, ctx);
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  return dflt;
}

function _list(cfgPath, dflt, ctx) {
  const v = get(null, cfgPath, undefined, ctx);
  if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string' && x.trim() !== '')) return v.map((x) => x.trim());
  return dflt.slice();
}

function _num(cfgPath, dflt, ctx) {
  const v = get(null, cfgPath, undefined, ctx);
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : dflt;
}

function _csv(s) { return String(s || '').split(',').map((r) => r.trim()).filter(Boolean); }

// ── ENV_MAP + fillEnv ───────────────────────────────────────────────────────
// Which config paths fill which env names. `path` may be an array (union, de-duplicated, in order).
// `join` is the separator for arrays; `bool` writes '1'/'0'.
const ENV_MAP = Object.freeze([
  { env: 'SUPABASE_GUILD_ID',                path: 'guild.tag' },
  { env: 'DISCORD_GUILD_ID',                 path: 'discord.guildId' },
  // Discord roles are flat, so the allow-list is the UNION of the member and officer lists.
  { env: 'ALLOWED_ROLE_NAMES',               path: ['discord.roles.member', 'discord.roles.officer'], join: ',' },
  { env: 'OFFICER_ROLE_NAMES',               path: 'discord.roles.officer', join: ',' },
  { env: 'OPENDKP_CLIENT_NAME',              path: 'opendkp.clientName' },
  { env: 'DEFAULT_TIMEZONE',                 path: 'guild.timezone' },
  { env: 'TAG_CHANNEL_NAME',                 path: 'channels.raidTag' },
  { env: 'OFFICER_CHANNEL_NAME',             path: 'channels.officer' },
  { env: 'WEB_BASE_URL',                     path: 'sites.web' },
  { env: 'PVP_GUILD_NAME',                   path: 'guild.inGameGuild' },
  { env: 'GITHUB_REPO',                      path: 'repo' },
  { env: 'GUILD_NAME',                       path: 'guild.name' },
  { env: 'GUILD_SHORT',                      path: 'guild.short' },
  { env: 'GUILD_PROVISION',                  path: 'discord.provision.mode' },
  { env: 'GUILD_PROVISION_OPTIONAL',         path: 'discord.provision.optional', join: ',' },
  { env: 'GUILD_PROVISION_SKIP',             path: 'discord.provision.skip', join: ',' },
  { env: 'GUILD_PROVISION_CREATE_CHANNELS',  path: 'discord.provision.createChannels', bool: true },
  { env: 'GUILD_PROVISION_LOCK',             path: 'discord.provision.lock' },
  { env: 'GUILD_PROVISION_PIN',              path: 'discord.provision.pin', bool: true },
]);

function _scalar(v, bool) {
  if (typeof v === 'string') { const s = v.trim(); return s === '' || _isPlaceholder(s) ? null : s; }
  if (typeof v === 'number') return Number.isSafeInteger(v) ? String(v) : null;   // an unsafe-integer id is already corrupt
  if (typeof v === 'boolean') return bool ? (v ? '1' : '0') : null;
  return null;
}

// The string an ENV_MAP entry would write for `cfg`, or undefined when the file has nothing for it.
function _entryValue(entry, cfg) {
  const parts = [];
  for (const p of [].concat(entry.path)) {
    const v = dig(cfg, p);
    if (v == null) continue;
    if (Array.isArray(v)) { for (const x of v) { const s = _scalar(x, false); if (s != null) parts.push(s); } }
    else { const s = _scalar(v, entry.bool); if (s != null) parts.push(s); }
  }
  const uniq = [...new Set(parts)];
  return uniq.length ? uniq.join(entry.join || ',') : undefined;
}

/**
 * Fill ONLY unset/blank env names from guild/config.json, same semantics as _loadGuildDiscordJson.
 * Returns {filled, skipped, refused}: filled = env names written; skipped = env names the file had
 * a value for but env already set; refused = secret-shaped config paths that were ignored.
 * Placeholders ("<...>") and non-string/number/boolean values are never written, and the string
 * 'undefined' never appears. `cfg` defaults to the loaded guild/config.json.
 */
function fillEnv(env, cfg) {
  const out = { filled: [], skipped: [], refused: [] };
  let src;
  if (cfg == null) { const i = _info(); src = i.cfg; out.refused.push(...i.refused); }
  else { out.refused.push(..._secretPaths(cfg)); src = _stripSecrets(cfg); }
  for (const entry of ENV_MAP) {
    const val = _entryValue(entry, src);
    if (val === undefined) continue;
    if (env[entry.env] != null && String(env[entry.env]).trim() !== '') { out.skipped.push(entry.env); continue; }
    env[entry.env] = val;
    out.filled.push(entry.env);
  }
  return out;
}

// ── typed getters (built-in defaults are today's exact Wolf Pack values) ─────

function guildTag(ctx)   { return _str('SUPABASE_GUILD_ID', 'guild.tag', 'wolfpack', ctx); }
function guildName(ctx)  { return _str('GUILD_NAME', 'guild.name', 'Wolf Pack', ctx); }
function guildShort(ctx) { return _str('GUILD_SHORT', 'guild.short', 'WP', ctx); }
function server(ctx)     { return _str(null, 'guild.server', 'Project Quarm', ctx); }
function inGameGuild(ctx) { return _str('PVP_GUILD_NAME', 'guild.inGameGuild', guildName(ctx), ctx); }
function tz(ctx)         { return _str('DEFAULT_TIMEZONE', 'guild.timezone', 'America/New_York', ctx); }

function _noSlash(s) { return String(s).replace(/\/+$/, ''); }
function webBase(ctx)    { return _noSlash(_str('WEB_BASE_URL', 'sites.web', 'https://wolfpack.quest', ctx)); }
function webBeta(ctx)    { return _noSlash(_str(null, 'sites.webBeta', 'https://b.wolfpack.quest', ctx)); }
function botApiBase(ctx) { const v = _str(null, 'sites.botApiBase', null, ctx); return v == null ? null : _noSlash(v); }

/** {owner, name, slug, url, api, rawBase} from GITHUB_REPO or config `repo` ('owner/name'). */
function repo(ctx) {
  let slug = String(get('GITHUB_REPO', 'repo', '', ctx) || '').trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(slug)) slug = 'davehess/QuarmBossTracker';
  const [owner, name] = slug.split('/');
  return {
    owner, name, slug,
    url:     `https://github.com/${slug}`,
    api:     `https://api.github.com/repos/${slug}`,
    rawBase: `https://raw.githubusercontent.com/${slug}`,
  };
}

function opendkpClient(ctx) { return _str('OPENDKP_CLIENT_NAME', 'opendkp.clientName', 'wolfpack', ctx); }
// sites.opendkp wins when filled in; otherwise it is derived from the client name, as the bot does today.
function opendkpBase(ctx) {
  const explicit = _str(null, 'sites.opendkp', null, ctx);
  return explicit ? _noSlash(explicit) : `https://${opendkpClient(ctx)}.opendkp.com`;
}

/**
 * {member:[], officer:[]} resolved EXACTLY as utils/roles.js does, with the file layer slotted
 * between env and the built-in default. Empty-value semantics are roles.js's, on purpose:
 *   - allowed  = ALLOWED_ROLE_NAMES || ALLOWED_ROLE_NAME || file(member ∪ officer) || 'Pack Member'
 *   - officer  = OFFICER_ROLE_NAMES || ALLOWED_ROLE_NAMES || file(officer) || 'Officer,Guild Leader'
 *   - `||` means an EMPTY string falls through to the next source, but a whitespace-only string
 *     is truthy and yields an EMPTY list (nobody allowed) — kept, because changing it would change
 *     who may run commands. Entries are trimmed and empties dropped, as roles.js does.
 */
function roles(ctx) {
  const c = _ctx(ctx);
  const fileMember  = _fileList(c, 'discord.roles.member');
  const fileOfficer = _fileList(c, 'discord.roles.officer');
  const fileUnion   = [...new Set([...fileMember, ...fileOfficer])].join(',');
  const allowed = c.env.ALLOWED_ROLE_NAMES || c.env.ALLOWED_ROLE_NAME || fileUnion || 'Pack Member';
  const officer = c.env.OFFICER_ROLE_NAMES || c.env.ALLOWED_ROLE_NAMES || fileOfficer.join(',') || 'Officer,Guild Leader';
  return { member: _csv(allowed), officer: _csv(officer) };
}

function _fileList(c, cfgPath) {
  const v = _fileValue(c, cfgPath);
  const arr = Array.isArray(v) ? v : (typeof v === 'string' ? [v] : []);
  return arr.filter((x) => typeof x === 'string' && x.trim() !== '').map((x) => x.trim());
}

/** OpenDKP rank vocabulary. Defaults mirror utils/roster.js and web/lib/popRoster.ts. */
function ranks(ctx) {
  const nm = _str(null, 'opendkp.ranks.newMain', 'Recruit', ctx);
  return {
    priority: _list('opendkp.ranks.priority', ['Officer', 'Pack Leader', 'Raid Pack', 'Recruit', 'Member', 'Inactive'], ctx),
    raider:   _list('opendkp.ranks.raider',   ['Pack Leader', 'Officer', 'Raid Pack', 'Recruit'], ctx),
    raidAlt:  _list('opendkp.ranks.raidAlt',  ['Raid Alt'], ctx),
    nonRaid:  _list('opendkp.ranks.nonRaid',  ['Non-raid Alt', 'Trader'], ctx),
    newMain:  nm,
  };
}

/** Minimum levels that count toward raid eligibility: alts from `raid.altMinLevel`, PoP from `raid.popMinLevel`. */
function raidFloors(ctx) {
  return { raidAlt: _num('raid.altMinLevel', 46, ctx), pop: _num('raid.popMinLevel', 60, ctx) };
}

function tagChannel(ctx)     { return _str('TAG_CHANNEL_NAME', 'channels.raidTag', 'Ztwolfpacktag', ctx); }
function officerChannel(ctx) { return _str('OFFICER_CHANNEL_NAME', 'channels.officer', 'Wolfpackofficer', ctx); }

function _bool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['1', 'true', 'on', 'yes'].includes(s)) return true;
    if (['0', 'false', 'off', 'no'].includes(s)) return false;
  }
  return undefined;
}

/** Feature flag: FEATURE_<NAME> env, then features.<name>, then `dflt`. Unparseable values fall through. */
function flag(name, dflt, ctx) {
  const c = _ctx(ctx);
  const envName = 'FEATURE_' + String(name).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const e = _bool(_envStr(c.env, envName));
  if (e !== undefined) return e;
  const f = _bool(_fileValue(c, 'features.' + name));
  return f === undefined ? dflt : f;
}

const _ERA_KEYS = { planesOfPower: 'PoP' };   // expansions.<key> -> era code
/** {PoP:'2026-10-01'} — unlock dates by era code, from expansions.*. Malformed dates are ignored. */
function eras(ctx) {
  const out = { PoP: '2026-10-01' };
  for (const [k, code] of Object.entries(_ERA_KEYS)) {
    const v = get(null, 'expansions.' + k, undefined, ctx);
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) out[code] = v.trim();
  }
  return out;
}

/** An env anchor (channel/thread/message id): trimmed value or null. */
function anchor(key, ctx) { return _envStr(_ctx(ctx).env, key); }

const _MODES = ['auto', 'report', 'adopt', 'create', 'off'];
/** Provisioner settings from the GUILD_PROVISION* env names (fillEnv puts config.json there). */
function provision(ctx) {
  const env = _ctx(ctx).env;
  const mode = (_envStr(env, 'GUILD_PROVISION') || 'auto').toLowerCase();
  const on = (k) => ['1', 'true', 'on', 'yes'].includes((_envStr(env, k) || '').toLowerCase());
  return {
    mode: _MODES.includes(mode) ? mode : 'auto',
    optional: _csv(_envStr(env, 'GUILD_PROVISION_OPTIONAL')),
    skip: _csv(_envStr(env, 'GUILD_PROVISION_SKIP')),
    createChannels: on('GUILD_PROVISION_CREATE_CHANNELS'),
    lock: _envStr(env, 'GUILD_PROVISION_LOCK') || 'none',
    pin: on('GUILD_PROVISION_PIN'),
  };
}

/** The PUBLIC description of this deployment the agent may be handed. Never passwords, tokens or ids. */
function agentManifest(ctx) {
  return {
    schema: 1,
    guild: { name: guildName(ctx), short: guildShort(ctx), server: server(ctx), inGameGuild: inGameGuild(ctx) },
    sites: { web: webBase(ctx), webBeta: webBeta(ctx), opendkp: opendkpBase(ctx) },
    channels: { raidTag: tagChannel(ctx), officer: officerChannel(ctx) },
    schedule: { tz: tz(ctx) },
    eras: eras(ctx),
    features: { pvp: flag('pvp', true, ctx), opendkp: flag('opendkp', true, ctx) },
  };
}

/** Re-brand a prose blob: our web address and our name become this guild's. Identity at the defaults. */
function brand(text, ctx) {
  if (typeof text !== 'string') return text;
  const base = webBase(ctx);
  let host = 'wolfpack.quest';
  try { host = new URL(base).host; } catch { /* keep default host */ }
  return text
    .split('https://wolfpack.quest').join(base)
    .split('wolfpack.quest').join(host)
    .split('Wolf Pack').join(guildName(ctx));
}

module.exports = {
  load, hasConfigFile, get, dig, ENV_MAP, fillEnv,
  guildTag, guildName, guildShort, server, inGameGuild, tz,
  webBase, webBeta, botApiBase, repo,
  opendkpClient, opendkpBase, roles, ranks, raidFloors,
  tagChannel, officerChannel, flag, eras, anchor, provision, agentManifest, brand,
  _resetCache,
};
