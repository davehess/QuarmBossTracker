// agentSignature.js — pure helpers for verifying a hot-swapped agent (readiness audit #6).
//
// The agent update used to be checked against a sha256 the BOT computes from the same GitHub file, so
// whoever could push to the repo, or a compromised bot, could run code on every raider's PC. The fix is an
// OFFLINE Ed25519 signature over the exact bytes of packages/wolfpack-logsync/index.js (detached, published
// next to it as index.js.sig, base64). The private key never touches the repo, the bot or CI; only the
// public key(s) below ship, inside Mimic. Zero deps (Node crypto), no Electron imports, so tests load it.
'use strict';
const crypto = require('crypto');

// Trusted public keys, base64 of the DER SPKI (what `node scripts/sign-agent.js --keygen` prints).
// A LIST so a rotation ships a build that trusts old + new before the old key is retired.
// EMPTY until the guild lead generates the real key offline. With no keys, `warn` just logs "no-keys" and
// `enforce` refuses every update (fail closed), so do not flip SIG_MODE to 'enforce' before a key is here.
const TRUSTED_PUBLIC_KEYS = [];

// Rollout switch: off | warn | enforce. A BUILD constant on purpose. A flag served by the bot could be turned
// off by the very party this check defends against; a constant inside the signed installer cannot. Raising it
// to 'enforce' is a Mimic release; a build that enforces can only be loosened by another Mimic release.
//   off     - no signature work (hash check only, as before)
//   warn    - verify when a signature exists, log the result, still accept on the hash check
//   enforce - refuse an update unless the signature verifies against a trusted key
const SIG_MODE = 'warn';

// The agent file may come only from here. Whatever URL the bot's manifest claims, Mimic checks it.
const ALLOWED_HOSTS = ['raw.githubusercontent.com'];
const ALLOWED_PATH_PREFIX = '/davehess/raidmimic/';

const MODES = ['off', 'warn', 'enforce'];
// Unknown value -> enforce: a typo must never silently downgrade the check.
function normalizeMode(m) { return MODES.includes(m) ? m : 'enforce'; }

// { ok, reason } for a URL we are willing to fetch the agent (or its .sig) from.
function checkUrl(url) {
  let u;
  try { u = new URL(String(url)); } catch { return { ok: false, reason: 'unparseable url' }; }
  if (u.protocol !== 'https:') return { ok: false, reason: 'not https' };
  if (u.username || u.password) return { ok: false, reason: 'credentials in url' };
  if (u.port && u.port !== '443') return { ok: false, reason: 'non-standard port' };
  if (!ALLOWED_HOSTS.includes(u.hostname.toLowerCase())) return { ok: false, reason: 'host not allowed: ' + u.hostname };
  if (!u.pathname.startsWith(ALLOWED_PATH_PREFIX)) return { ok: false, reason: 'path not allowed' };
  return { ok: true, reason: null };
}

// A redirect is followed only to an allowed URL on the SAME host.
function checkRedirect(from, to) {
  let f, t;
  try { f = new URL(String(from)); t = new URL(String(to), f); } catch { return { ok: false, reason: 'unparseable redirect' }; }
  if (t.hostname.toLowerCase() !== f.hostname.toLowerCase()) return { ok: false, reason: 'redirect to another host' };
  return checkUrl(t.href);
}

// Verify `data` (Buffer) against a detached base64 signature and a list of trusted base64-DER public keys.
// { ok, keyIndex, reason }. Never throws.
function verifyAgentSignature(data, sigB64, keys) {
  const list = keys || TRUSTED_PUBLIC_KEYS;
  if (!list.length) return { ok: false, keyIndex: -1, reason: 'no-keys' };
  if (!Buffer.isBuffer(data) || !data.length) return { ok: false, keyIndex: -1, reason: 'no-data' };
  const sig = Buffer.from(String(sigB64 || '').trim(), 'base64');
  if (sig.length !== 64) return { ok: false, keyIndex: -1, reason: 'bad-signature-format' };
  for (let i = 0; i < list.length; i++) {
    try {
      const pub = crypto.createPublicKey({ key: Buffer.from(list[i], 'base64'), format: 'der', type: 'spki' });
      if (crypto.verify(null, data, pub, sig)) return { ok: true, keyIndex: i, reason: null };
    } catch { /* a malformed key slot never accepts */ }
  }
  return { ok: false, keyIndex: -1, reason: 'signature-mismatch' };
}

// The accept/refuse decision. hashOk: the sha256 gate (true when the manifest gave none). sig: the result of
// verifyAgentSignature, or null when no .sig file could be fetched. Returns { accept, log }.
function decideUpdate({ mode, hashOk, sig }) {
  const m = normalizeMode(mode);
  if (!hashOk) return { accept: false, log: 'sha256 mismatch' };
  if (m === 'off') return { accept: true, log: null };
  if (sig && sig.ok) return { accept: true, log: 'signature ok (key #' + sig.keyIndex + ')' };
  const why = sig ? sig.reason : 'unsigned (no .sig published)';
  if (m === 'enforce') return { accept: false, log: 'REFUSED, signature required: ' + why };
  return { accept: true, log: 'WARN, accepted on hash only: ' + why };
}

module.exports = { TRUSTED_PUBLIC_KEYS, SIG_MODE, ALLOWED_HOSTS, ALLOWED_PATH_PREFIX, normalizeMode, checkUrl, checkRedirect, verifyAgentSignature, decideUpdate };
