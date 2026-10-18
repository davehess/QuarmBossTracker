// utils/clientIp.js — the one place the bot decides "which IP is this request from".
//
// Railway's edge sets X-Real-IP to the client's remote IP (documented), and appends the client to X-Forwarded-For.
// A caller can PREPEND anything it likes to X-Forwarded-For, so the FIRST hop (what the code used before) is
// attacker-chosen: one rotating header value gave every request a fresh rate-limit bucket. The LAST hop is the one
// our own edge wrote. Order: x-real-ip → last x-forwarded-for hop → the socket.
//
// Capped at 64 chars: the value is used as a Map key by the rate limiters, and a 16 KB header repeated across
// 50k keys would be its own memory attack.
const MAX_LEN = 64;

function _one(v) {
  return String(Array.isArray(v) ? v[0] : (v || '')).trim().slice(0, MAX_LEN);
}

function clientIp(req) {
  const h = (req && req.headers) || {};
  const real = _one(h['x-real-ip']);
  if (real) return real;
  const hops = String(Array.isArray(h['x-forwarded-for']) ? h['x-forwarded-for'].join(',') : (h['x-forwarded-for'] || ''))
    .split(',').map(s => s.trim()).filter(Boolean);
  if (hops.length) return hops[hops.length - 1].slice(0, MAX_LEN);
  return String((req && req.socket && req.socket.remoteAddress) || 'unknown').slice(0, MAX_LEN);
}

module.exports = { clientIp };
