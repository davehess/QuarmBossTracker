// Pre-raid checklist — the officer-chat post that answers "is tonight going to
// work?" while there is still time to fix it.
//
// Hitya 2026-08-21: "let's build an admin-facing officer-chat pre-raid
// checklist, active mimics, class shortages below our average, lockouts, other
// pertinent details."
//
// DESIGN RULE: every section must be ACTIONABLE IN THE NEXT HOUR. A number an
// officer can't do anything about before the pull belongs on a web page, not
// in this post. That is why there's no DKP, no attendance history, no parse
// stats here — they're all true and all useless at 7pm.
//
// Sections, and the action each one implies:
//   1. Signups        — do we have a raid at all? (chase people / call it)
//   2. Class coverage — what are we short of vs our own norm? (ask for alts)
//   3. Mimic coverage — whose fight will we not see? (nudge them to launch)
//   4. Lockouts       — who literally cannot engage tonight's targets?
//   5. Target status  — is what we planned actually UP? (re-plan the night)
//
// Pure: no Discord, no Supabase, no clock of its own. Tested in
// test/pre-raid-checklist.test.js.

const { buildLockoutBriefing } = require('./lockoutBriefing');

// A class is "short" when tonight is below our own recent norm by enough to
// matter. Both a ratio AND an absolute gap must be crossed: 2 of 3 clerics is a
// crisis, 9 of 12 wizards is a Tuesday.
const SHORT_RATIO = 0.75;
const SHORT_ABS   = 1;

/**
 * @param {object} a
 * @param {{going:number,tentative:number,absent:number,bench:number}} a.signups
 * @param {Map<string,number>} a.tonightByClass   class -> heads signed up
 * @param {Map<string,number>} a.avgByClass       class -> our recent average
 * @param {number} a.typicalHeadcount             recent average total
 * @param {Array}  a.signedUpPlayers  [{ discordId, name, mimicActive }]
 * @param {Array}  a.targets          [{ bossId, name, zone, upNow, spawnsAtMs }]
 * @param {object} a.lockoutInput     args for buildLockoutBriefing
 * @param {number} a.nowMs
 */
function buildPreRaidChecklist({
  signups = { going: 0, tentative: 0, absent: 0, bench: 0 },
  tonightByClass = new Map(),
  avgByClass = new Map(),
  typicalHeadcount = 0,
  signedUpPlayers = [],
  targets = [],
  lockoutInput = {},
  nowMs = Date.now(),
} = {}) {
  // 2. Class coverage — shortages only, worst gap first. Surplus is not news.
  const shortages = [];
  for (const [cls, avg] of avgByClass) {
    const have = tonightByClass.get(cls) || 0;
    const gap = avg - have;
    if (avg <= 0) continue;
    if (have / avg <= SHORT_RATIO && gap >= SHORT_ABS) {
      shortages.push({ cls, have, avg: Math.round(avg * 10) / 10, gap: Math.round(gap * 10) / 10 });
    }
  }
  shortages.sort((a, b) => b.gap - a.gap || a.cls.localeCompare(b.cls));

  // 3. Mimic coverage — counted in PLAYERS, never characters (CLAUDE.md:
  // "character counts mean almost nothing", one player runs 3-12 of them).
  const missingMimic = signedUpPlayers.filter(p => !p.mimicActive).map(p => p.name);
  const mimic = {
    players: signedUpPlayers.length,
    active: signedUpPlayers.length - missingMimic.length,
    missing: missingMimic.sort((a, b) => String(a).localeCompare(String(b))),
  };

  // 5. Target status — a target still on cooldown is a re-plan, and the single
  // most expensive thing to discover at pull time.
  const down = targets.filter(t => !t.upNow);
  const targetStatus = {
    up: targets.filter(t => t.upNow).map(t => t.name),
    down: down.map(t => ({
      name: t.name,
      minsAway: Number.isFinite(t.spawnsAtMs) ? Math.max(0, Math.round((t.spawnsAtMs - nowMs) / 60000)) : null,
    })).sort((a, b) => (a.minsAway ?? 1e9) - (b.minsAway ?? 1e9)),
  };

  const lockouts = buildLockoutBriefing(lockoutInput);

  // One-line verdict, so the post is skimmable at a glance. Ordered by how
  // badly each thing breaks the night.
  const flags = [];
  if (signups.going === 0) flags.push('no signups yet');
  else if (typicalHeadcount > 0 && signups.going < typicalHeadcount * SHORT_RATIO) {
    flags.push(`thin roster (${signups.going} vs ~${Math.round(typicalHeadcount)})`);
  }
  if (shortages.length) flags.push(`${shortages.length} class shortage${shortages.length === 1 ? '' : 's'}`);
  if (targetStatus.down.length) flags.push(`${targetStatus.down.length} target${targetStatus.down.length === 1 ? '' : 's'} not up`);
  // `actionable`, not `total` — a lockout on a target that is still on cooldown
  // is the expected aftermath of our own kill and is not a problem with tonight.
  if (lockouts.actionable) flags.push(`${lockouts.actionable} locked out`);
  if (mimic.missing.length) flags.push(`${mimic.missing.length} without Mimic`);

  return {
    ok: flags.length === 0,
    flags,
    signups,
    shortages,
    mimic,
    targetStatus,
    lockouts,
  };
}

module.exports = { buildPreRaidChecklist, SHORT_RATIO, SHORT_ABS };
