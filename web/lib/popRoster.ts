// Who the /pop page counts (the guild lead, 2026-09-29: "traders or anyone not of level range shouldn't
// be counted in there. we should go off of raiders and raid alts, pack members toons at level and above",
// and "it should be mains only when i'm on mains, vs all characters").
//
// By OpenDKP rank on `characters`, which is how the guild already sorts its roster:
//   mains — Pack Leader, Officer, Raid Pack, Recruit;
//   alts  — Raid Alt.
// Traders, Inactive, Non-raid Alts and unknown ranks are out. Only active characters, level 60 or above on
// their last /who (the guild lead, same day: "for us it's 60. Recruits are raider, include them"). A raider
// rank never seen on /who still counts; an alt needs a seen level, since that is where the low and trader
// toons hide.

export const POP_MIN_LEVEL = 60;
export const RAIDER_RANKS = ['Pack Leader', 'Officer', 'Raid Pack', 'Recruit'];
export const RAID_ALT_RANKS = ['Raid Alt'];

export type RosterRow = { name: string; rank: string | null; active: boolean | null; level: number | null };
export type PopMember = { name: string; main: boolean; level: number | null };

export function popRoster(rows: RosterRow[]): PopMember[] {
  const out: PopMember[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const k = String(r.name || '').toLowerCase();
    if (!k || seen.has(k) || !r.active) continue;
    const main = RAIDER_RANKS.includes(r.rank ?? '');
    if (!main && !RAID_ALT_RANKS.includes(r.rank ?? '')) continue;
    if (r.level != null ? r.level < POP_MIN_LEVEL : !main) continue;
    seen.add(k);
    out.push({ name: r.name, main, level: r.level });
  }
  return out;
}
