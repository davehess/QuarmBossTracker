// Pre-raid lockout briefing — who on the roster cannot ENGAGE what we plan to
// pull tonight, grouped by zone.
//
// Hitya 2026-08-21: "put it into a post in officer chat about characters
// currently locked out for the upcoming night's raid by zone from the raid
// planner's event."
//
// WHY THIS IS PRE-PULL, NOT LOOT (CLAUDE.md domain policies): a lockout is an
// ENGAGE lock. A locked character cannot fight the mob at all and is teleported
// out of the zone the moment they engage — so a locked raider who pulls anyway
// is a body that vanishes mid-fight. Officers need this BEFORE the raid, which
// is the whole point of posting it against the planner's target list.
//
// Lockouts are per character, so for a current-era boss it is normally an ALT
// that carries one. A MAIN on this list is the surprising case and is called
// out — that's the "someone raided with another guild" signal.
//
// THE VERDICT IS MAINS, NOT THE HEADCOUNT (Hitya 2026-08-22: "as long as mains
// are good to go"). A blocked alt is a swap; a blocked main is a hole in the
// raid. So `mainsBlocked` drives the ✅/⚠ and the checklist flag, and the alt
// count rides along as detail.
//
// ⚠ WHY THE TARGET'S UP/DOWN STATE MATTERS MORE THAN THE HEADCOUNT (2026-08-22).
// A lockout runs the same length as the boss's respawn, so after one of OUR
// kills the entire raid is locked AND the boss is down — 32 names that mean
// nothing, because nobody was going to pull it anyway. The case worth an
// officer's attention is the divergence: a target that is UP with our people
// still locked to it, which essentially only happens when somebody killed it
// elsewhere. So the briefing splits on that instead of on the raw count.
// (Down-target lockouts are still counted, never silently dropped — the
// lockout-length == respawn-length assumption is a model, not a measurement.)
//
// Pure: no Discord, no Supabase. Tested in test/lockout-briefing.test.js.

/**
 * @param {object}   a
 * @param {string[]} a.targetBossIds  boss ids the planner named for tonight
 * @param {Array}    a.bosses         data/bosses.json
 * @param {Array}    a.lockouts       character_lockouts rows (already filtered to active)
 * @param {Function} [a.kindOf]       name -> 'main' | 'alt' | 'unknown'
 * @param {Function} [a.isTargetUp]    boss id -> boolean. Unknown => treat as up,
 *                                     so a missing timer never hides a real block.
 * @returns {{ zones: Array, total: number, mains: number, outsiders: number,
 *             actionable: number, mainsBlocked: number, altsBlocked: number,
 *             onDownTargets: number, targetsWithNone: string[] }}
 */
function buildLockoutBriefing({ targetBossIds = [], bosses = [], lockouts = [], kindOf, isTargetUp } = {}) {
  const wanted = new Set(targetBossIds.map(id => String(id).toLowerCase()));
  const bossById = new Map(bosses.map(b => [String(b.id).toLowerCase(), b]));
  const kind = typeof kindOf === 'function' ? kindOf : () => 'unknown';
  const isUp = typeof isTargetUp === 'function'
    ? (id) => isTargetUp(id) !== false      // unknown (undefined/null) counts as up
    : () => true;

  // boss id -> rows, but only for bosses actually on tonight's list. A lockout
  // on something we aren't pulling is noise in this briefing (it still shows on
  // /admin/lockouts).
  const byBoss = new Map();
  let outsiders = 0;
  for (const l of lockouts) {
    const key = String(l.boss_key || '').toLowerCase();
    if (!wanted.has(key)) continue;
    // Not one of ours — count it, don't print it. Since 2026-08-22 lockouts are
    // derived from kill parses too, and a parse of a raid we joined carries the
    // OTHER guild's whole roster. Sixty strangers would bury the handful of
    // names an officer actually has to act on. They stay in the table and on
    // /admin/lockouts; this briefing is about who WE are fielding tonight.
    if (kind(l.character) === 'unknown') { outsiders++; continue; }
    if (!byBoss.has(key)) byBoss.set(key, []);
    byBoss.get(key).push(l);
  }

  const zoneMap = new Map();
  let total = 0, mains = 0, actionable = 0, onDownTargets = 0;
  let mainsBlocked = 0, altsBlocked = 0;
  for (const [key, rows] of byBoss) {
    const boss = bossById.get(key);
    const zone = (boss && boss.zone) || 'Unknown zone';
    const up   = isUp(key);
    const chars = rows
      .map(r => ({ name: r.character, kind: kind(r.character), expiresAt: r.expires_at, ours: r.ours }))
      // Mains first — they're the ones worth asking about — then by name.
      .sort((a, b) => (a.kind === 'main' ? 0 : 1) - (b.kind === 'main' ? 0 : 1)
                   || String(a.name).localeCompare(String(b.name)));
    total += chars.length;
    mains += chars.filter(c => c.kind === 'main').length;
    if (up) {
      actionable   += chars.length;
      // Only an UP target can block anyone, so only these count toward the
      // verdict. `mains` above still counts every main for context.
      mainsBlocked += chars.filter(c => c.kind === 'main').length;
      altsBlocked  += chars.filter(c => c.kind !== 'main').length;
    } else {
      onDownTargets += chars.length;
    }
    if (!zoneMap.has(zone)) zoneMap.set(zone, []);
    zoneMap.get(zone).push({
      bossId: key,
      bossName: (boss && boss.name) || key,
      emoji: (boss && boss.emoji) || '',
      up,
      chars,
    });
  }

  // Only UP targets get named. A down target's lockouts are in onDownTargets.
  const zones = [...zoneMap.entries()]
    .map(([zone, bossList]) => {
      const live = bossList.filter(b => b.up);
      return {
        zone,
        bosses: live.sort((a, b) => b.chars.length - a.chars.length
                                 || String(a.bossName).localeCompare(String(b.bossName))),
        count: live.reduce((n, b) => n + b.chars.length, 0),
      };
    })
    .filter(z => z.bosses.length > 0)
    .sort((a, b) => b.count - a.count || a.zone.localeCompare(b.zone));

  // Targets nobody is locked to — stated explicitly so the post reads as a
  // CHECK that ran, not a list that happened to be short.
  const blocking = new Set(
    [...byBoss.keys()].filter(k => isUp(k)));
  const clear = targetBossIds
    .filter(id => !blocking.has(String(id).toLowerCase()))
    .map(id => {
      const b = bossById.get(String(id).toLowerCase());
      return (b && b.name) || String(id);
    });

  return { zones, total, mains, outsiders, actionable, mainsBlocked, altsBlocked, onDownTargets, targetsWithNone: clear };
}

module.exports = { buildLockoutBriefing };
