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
// Pure: no Discord, no Supabase. Tested in test/lockout-briefing.test.js.

/**
 * @param {object}   a
 * @param {string[]} a.targetBossIds  boss ids the planner named for tonight
 * @param {Array}    a.bosses         data/bosses.json
 * @param {Array}    a.lockouts       character_lockouts rows (already filtered to active)
 * @param {Function} [a.kindOf]       name -> 'main' | 'alt' | 'unknown'
 * @returns {{ zones: Array, total: number, mains: number, targetsWithNone: string[] }}
 */
function buildLockoutBriefing({ targetBossIds = [], bosses = [], lockouts = [], kindOf } = {}) {
  const wanted = new Set(targetBossIds.map(id => String(id).toLowerCase()));
  const bossById = new Map(bosses.map(b => [String(b.id).toLowerCase(), b]));
  const kind = typeof kindOf === 'function' ? kindOf : () => 'unknown';

  // boss id -> rows, but only for bosses actually on tonight's list. A lockout
  // on something we aren't pulling is noise in this briefing (it still shows on
  // /admin/lockouts).
  const byBoss = new Map();
  for (const l of lockouts) {
    const key = String(l.boss_key || '').toLowerCase();
    if (!wanted.has(key)) continue;
    if (!byBoss.has(key)) byBoss.set(key, []);
    byBoss.get(key).push(l);
  }

  const zoneMap = new Map();
  let total = 0, mains = 0;
  for (const [key, rows] of byBoss) {
    const boss = bossById.get(key);
    const zone = (boss && boss.zone) || 'Unknown zone';
    const chars = rows
      .map(r => ({ name: r.character, kind: kind(r.character), expiresAt: r.expires_at, ours: r.ours }))
      // Mains first — they're the ones worth asking about — then by name.
      .sort((a, b) => (a.kind === 'main' ? 0 : 1) - (b.kind === 'main' ? 0 : 1)
                   || String(a.name).localeCompare(String(b.name)));
    total += chars.length;
    mains += chars.filter(c => c.kind === 'main').length;
    if (!zoneMap.has(zone)) zoneMap.set(zone, []);
    zoneMap.get(zone).push({
      bossId: key,
      bossName: (boss && boss.name) || key,
      emoji: (boss && boss.emoji) || '',
      chars,
    });
  }

  const zones = [...zoneMap.entries()]
    .map(([zone, bossList]) => ({
      zone,
      bosses: bossList.sort((a, b) => b.chars.length - a.chars.length
                                   || String(a.bossName).localeCompare(String(b.bossName))),
      count: bossList.reduce((n, b) => n + b.chars.length, 0),
    }))
    .sort((a, b) => b.count - a.count || a.zone.localeCompare(b.zone));

  // Targets nobody is locked to — stated explicitly so the post reads as a
  // CHECK that ran, not a list that happened to be short.
  const clear = targetBossIds
    .filter(id => !byBoss.has(String(id).toLowerCase()))
    .map(id => {
      const b = bossById.get(String(id).toLowerCase());
      return (b && b.name) || String(id);
    });

  return { zones, total, mains, targetsWithNone: clear };
}

module.exports = { buildLockoutBriefing };
