// utils/botLease.js — a one-row lease so only ONE bot process logs in to Discord.
//
// Why: during a deploy the old and new bot processes overlap for ~14 s, and both can post to Discord
// (duplicate cards, double announcements). The lease is a single database row (rpc bot_lease_acquire /
// bot_lease_release). Only the holder logs in; the new process waits as a standby and takes over when the
// old one releases on shutdown, or when its lease expires (ttl) because it died.
//
// A null from rpc() means UNKNOWN, never "lost": utils/supabase.js returns null on any failure (network,
// timeout, 4xx including a missing function, 5xx, open circuit breaker). Only an explicit `false` from the
// store means another holder has it. So while renewing, null keeps us holding, and only `false` hands over.
//
// Fail-open on purpose: if the store stays silent for unknownGraceMs while we are WAITING, we proceed
// without the lease. A missing table or a database outage must never keep the bot offline; that is exactly
// today's behaviour. A fail_open holder still renews, so once the store answers it takes the row (and a
// `false` there means a real holder exists, so onLost fires).
//
// All timers use the injected setTimeout (chained, never setInterval) and are unref'd, so the lease never
// keeps the process alive and tests can drive a fake clock. Logs go to stdout only, once per state change.

function createLease({
  rpc,
  isEnabled,
  name,
  holder,
  ttlSec = 30,
  renewMs = 10_000,
  pollMs = 3_000,
  unknownGraceMs = 45_000,
  now = Date.now,
  setTimeout: setT = setTimeout,
  clearTimeout: clearT = clearTimeout,
  log = console.log,
} = {}) {
  let via = null;
  let role = 'starting';
  let since = now();
  let holding = false;
  let released = false;
  let timer = null;
  let renewing = false;
  let lostFired = false;
  let nullLogged = false;

  const setRole = (r) => { if (role !== r) { role = r; since = now(); } };
  const schedule = (fn, ms) => {
    const h = setT(fn, ms);
    if (h && typeof h.unref === 'function') h.unref();
    return h;
  };
  const clear = () => { if (timer != null) { clearT(timer); timer = null; } };
  const acquire = () => rpc('bot_lease_acquire', { p_name: name, p_holder: holder, p_ttl_seconds: ttlSec });

  function waitForLease() {
    if (!isEnabled()) {
      via = 'disabled'; holding = true; setRole('holder');
      return Promise.resolve({ via });
    }
    return new Promise((resolve) => {
      let nullSince = null;
      let loggedStandby = false;
      const done = (v) => { via = v; holding = true; setRole('holder'); resolve({ via: v }); };
      const attempt = async () => {
        timer = null;
        if (released) return;
        let r = null;
        try { r = await acquire(); } catch { r = null; }
        if (released) return;
        if (r === true) {
          if (loggedStandby) log(`[lease] acquired ${name}; this bot is now the holder`);
          return done('acquired');
        }
        if (r === false) {
          nullSince = null;
          setRole('standby');
          if (!loggedStandby) { loggedStandby = true; log(`[lease] another bot holds ${name}; waiting as standby`); }
        } else {
          if (nullSince == null) nullSince = now();
          if (now() - nullSince >= unknownGraceMs) {
            log(`[lease] proceeding without the lease on ${name}: the lease store did not answer for ${Math.round(unknownGraceMs / 1000)}s`);
            return done('fail_open');
          }
        }
        timer = schedule(attempt, pollMs);
      };
      attempt();
    });
  }

  function startRenewing(onLost) {
    if (via === 'disabled' || renewing || released) return;
    renewing = true;
    const tick = async () => {
      timer = null;
      if (!renewing) return;
      let r = null;
      try { r = await acquire(); } catch { r = null; }
      if (!renewing) return;
      if (r === false) {
        renewing = false; holding = false; setRole('standby');
        if (!lostFired) {
          lostFired = true;
          log(`[lease] lost ${name} to another bot`);
          try { onLost && onLost(); } catch { /* caller's handler must not break us */ }
        }
        return;
      }
      if (r === null) {
        if (!nullLogged) { nullLogged = true; log(`[lease] lease store did not answer; still holding ${name}`); }
      } else {
        nullLogged = false;
      }
      timer = schedule(tick, renewMs);
    };
    timer = schedule(tick, renewMs);
  }

  async function release() {
    renewing = false;
    clear();
    if (released) return;
    released = true;
    const had = holding && (via === 'acquired' || via === 'fail_open');
    holding = false;
    setRole('standby');
    if (!had) return;
    let t;
    try {
      await Promise.race([
        Promise.resolve(rpc('bot_lease_release', { p_name: name, p_holder: holder })).catch(() => {}),
        new Promise((res) => { t = schedule(res, 3000); }),
      ]);
    } catch { /* swallow */ }
    if (t != null) clearT(t);
  }

  return {
    waitForLease,
    startRenewing,
    release,
    isHolder: () => holding,
    role: () => role,
    status: () => ({ role, name, holder, via, since }),
  };
}

let _default = null;
function defaultLease() {
  if (_default) return _default;
  const sb = require('./supabase');
  const env = process.env;
  const off = ['off', '0', 'false'].includes(String(env.BOT_LEASE || '').trim().toLowerCase());
  const holder = (env.RAILWAY_DEPLOYMENT_ID || require('os').hostname()) + ':' + require('crypto').randomUUID().slice(0, 8);
  _default = createLease({
    rpc: sb.rpc,
    isEnabled: () => !off && sb.isEnabled(),
    name: env.BOT_LEASE_NAME || 'discord:' + (env.DISCORD_CLIENT_ID || 'bot'),
    holder,
  });
  return _default;
}

module.exports = { createLease, defaultLease };
