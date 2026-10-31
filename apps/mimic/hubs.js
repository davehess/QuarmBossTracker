// The guild a Mimic install points at (DECISIONS §475: "Mimic picks which guild (hub); each guild's sign-in is its own").
//
// A hub is { slug, display_name, url, site }:
//   url   the guild's bot, an origin ("https://bot.example"). The agent is given url + HUB_BOT_PATH as --bot-url.
//   site  the guild's website, an origin, or '' when the bot is the only authority on it. The link flow sends the
//         raider to site; '' means "go where the bot says" (a pasted self-host, whose bot answers its own address).
//
// Pure and electron-free so a test can require() it; main.js owns the file, the network and the config.
//
// Everything from the directory is UNTRUSTED text from the network, and a pasted address is whatever was typed: both go
// through normalizeHub, which keeps a short slug, a short name and https origins, and drops the rest. The one built-in
// entry, Wolf Pack, is fixed here and can never be replaced by a directory row.

const HUB_DIRECTORY_URL = 'https://raidmimic.com/api/hubs';
const HUB_BOT_PATH = '/api/agent/encounter';
const HUB_DIRECTORY_TTL_MS = 24 * 60 * 60 * 1000;
const HUB_DIRECTORY_MAX = 200;

const WOLFPACK_HUB = Object.freeze({
  slug: 'wolfpack',
  display_name: 'Wolf Pack',
  url: 'https://wolfpackparse.up.railway.app',
  site: 'https://wolfpack.quest',
});

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;

// An https origin (http only for a machine's own loopback, so a guild's server can be tried before it has a certificate).
function originOf(u) {
  try {
    const x = new URL(String(u));
    const loop = x.hostname === 'localhost' || x.hostname === '127.0.0.1';
    if (x.protocol !== 'https:' && !(x.protocol === 'http:' && loop)) return '';
    if (x.username || x.password) return '';
    return x.origin;
  } catch { return ''; }
}

// null when the value is not a usable hub.
function normalizeHub(h) {
  if (!h || typeof h !== 'object') return null;
  const slug = typeof h.slug === 'string' ? h.slug.trim().toLowerCase() : '';
  if (!SLUG_RE.test(slug)) return null;
  const url = originOf(h.url);
  if (!url) return null;
  const site = h.site ? originOf(h.site) : '';
  const name = typeof h.display_name === 'string' ? h.display_name.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60) : '';
  return { slug, display_name: name || slug, url, site };
}

// What someone pasted for an unlisted self-hosted guild: "guild.example.com", "https://guild.example.com/", or the full
// upload address. Null when it is not an address Mimic will talk to.
function parseGuildAddress(text) {
  let t = String(text == null ? '' : text).trim();
  if (!t || /\s/.test(t)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) t = 'https://' + t;
  const url = originOf(t);
  if (!url) return null;
  return { slug: 'custom', display_name: new URL(url).hostname, url, site: '' };
}

function botUrlOf(hub) { return hub.url + HUB_BOT_PATH; }

// The hub a config points at. cfg.botUrl is what the agent really uses, so it wins: a saved cfg.hub that no longer matches
// it (someone typed another address into Settings' Bot URL) is stale and ignored. No saved hub on the Wolf Pack bot is Wolf
// Pack, which is every install that existed before the picker.
function hubOf(cfg) {
  const base = originOf(cfg && cfg.botUrl) || WOLFPACK_HUB.url;
  const saved = normalizeHub(cfg && cfg.hub);
  if (saved && saved.url === base) return saved;
  if (base === WOLFPACK_HUB.url) return { ...WOLFPACK_HUB };
  return { slug: 'custom', display_name: new URL(base).hostname, url: base, site: '' };
}

function sameHub(a, b) { return !!a && !!b && a.url === b.url; }

// Point a config at a hub. A session belongs to one hub's bot, so it goes with the switch (the caller revokes it on the old
// bot first). Mutates and returns cfg.
function applyHub(cfg, hub) {
  cfg.hub = { slug: hub.slug, display_name: hub.display_name, url: hub.url, site: hub.site || '' };
  cfg.botUrl = botUrlOf(hub);
  delete cfg.session;
  delete cfg.token;
  return cfg;
}

// The directory as the picker shows it: Wolf Pack first and fixed, then what the network sent, cleaned.
function sanitizeDirectory(raw) {
  const rows = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.hubs) ? raw.hubs : []);
  const out = [{ ...WOLFPACK_HUB }];
  const seen = new Set([WOLFPACK_HUB.slug]);
  for (const r of rows.slice(0, HUB_DIRECTORY_MAX)) {
    const h = normalizeHub(r);
    if (!h || seen.has(h.slug)) continue;
    seen.add(h.slug);
    out.push(h);
  }
  return out;
}

function directoryFresh(cache, now) {
  return !!cache && Number.isFinite(cache.fetched_at) && now - cache.fetched_at < HUB_DIRECTORY_TTL_MS && now >= cache.fetched_at;
}

// The address the raider is sent to for the link code. `resp` is the bot's /api/mimic-link/start reply. A bot may only send
// an https address (Mimic opens it in the browser, and a pasted guild's bot is not trusted with any other scheme). For a
// listed guild whose site is known, the bot's path and code are kept and the host is the guild's site: the commons bot
// answers for many guilds and does not know which site the raider chose. Wolf Pack's own bot stays the authority for Wolf
// Pack's site, so an override on that bot (a beta host) keeps working.
function linkUrls(hub, resp) {
  const r = resp || {};
  const first = originOf(r.verification_url) ? String(r.verification_url) : '';
  const complete = originOf(r.verification_url_complete) ? String(r.verification_url_complete) : '';
  if (!first && !complete) return null;
  const rehome = hub && hub.site && hub.slug !== WOLFPACK_HUB.slug;
  const move = (u) => { if (!u || !rehome) return u; const x = new URL(u); return hub.site + x.pathname + x.search; };
  const verification_url = move(first || complete.split('?')[0]);
  return { verification_url, verification_url_complete: complete ? move(complete) : null };
}

module.exports = {
  HUB_DIRECTORY_URL, HUB_BOT_PATH, HUB_DIRECTORY_TTL_MS, WOLFPACK_HUB,
  originOf, normalizeHub, parseGuildAddress, botUrlOf, hubOf, sameHub, applyHub,
  sanitizeDirectory, directoryFresh, linkUrls,
};
