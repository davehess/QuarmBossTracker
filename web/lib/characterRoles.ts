// What a linked character IS — raid alt vs trader — and the level bar each
// role has to clear. Pure + tested (test/character-roles.test.js); shared by
// the officer surface (/admin/links) and the member surface (/me).
//
// Hitya 2026-08-20: "Raid Alts must be 46 or higher at minimum for classic
// raids, 50+ for Kunark, 55+ for velius, 60 for luclin. Anything else, they
// don't need to be put into openDKP. They can be non-raiding alts or traders."
//
// The point of the ladder is that "is this a raid alt?" is not one number —
// a level 50 alt is a real raid alt for classic and Kunark and simply cannot
// raid Velious or Luclin. So we never answer yes/no; we answer WHICH ERAS,
// and only "below 46, no era at all" is a hard stop for OpenDKP registration.

export type Era = 'classic' | 'kunark' | 'velious' | 'luclin';

export const ERA_LABELS: Record<Era, string> = {
  classic: 'Classic',
  kunark:  'Kunark',
  velious: 'Velious',
  luclin:  'Luclin',
};

// Minimum level to be a useful raid alt in each era, in ascending order.
export const RAID_ALT_MIN_LEVEL: Record<Era, number> = {
  classic: 46,
  kunark:  50,
  velious: 55,
  luclin:  60,
};

const ERA_ORDER: Era[] = ['classic', 'kunark', 'velious', 'luclin'];

/**
 * Eras a character of this level can raid, lowest first. Empty below 46.
 * NOTE null/undefined are NOT coerced — Number(null) is 0, which is finite,
 * and would render an unknown level as the nonsense "L0".
 */
export function eligibleEras(level: number | null | undefined): Era[] {
  if (level == null) return [];
  const lv = Number(level);
  if (!Number.isFinite(lv)) return [];
  return ERA_ORDER.filter(e => lv >= RAID_ALT_MIN_LEVEL[e]);
}

export type RaidAltVerdict = {
  ok: boolean;          // clears the floor for at least one era
  eras: Era[];
  /** Member-facing sentence. Never scolds — below the floor is a fine thing to be. */
  message: string;
};

export function raidAltVerdict(level: number | null | undefined): RaidAltVerdict {
  const eras = eligibleEras(level);
  const known = level != null && Number.isFinite(Number(level));
  const lv = Number(level);
  if (eras.length === 0) {
    return {
      ok: false, eras,
      message: known
        ? `L${lv} is below the raid-alt floor (46). No OpenDKP entry needed — a non-raiding alt or trader is the right call.`
        : 'No level known yet — raid alts need 46+ (Classic), 50+ (Kunark), 55+ (Velious), 60 (Luclin).',
    };
  }
  if (eras.length === ERA_ORDER.length) {
    return { ok: true, eras, message: `L${lv} raids every era through Luclin.` };
  }
  const next = ERA_ORDER[eras.length];                    // first era NOT cleared
  return {
    ok: true, eras,
    message: `L${lv} raids ${eras.map(e => ERA_LABELS[e]).join(' + ')} — ${RAID_ALT_MIN_LEVEL[next]} for ${ERA_LABELS[next]}.`,
  };
}

// Traders (bank mules, bazaar toons) are level-1 nobodies by design, and the
// class of a mule is both unknown and irrelevant — /who never saw them, they
// never raid. Demanding a class before they could be filed as Traders is what
// left ~110 uploading characters unlinked (Hitya 2026-08-20: "I can't easily
// make them traders because of the class requirement"). So a Trader carries
// fixed, honest placeholders and never reaches OpenDKP.
export const TRADER_DEFAULTS = {
  level: 1,
  race:  'Human',
  cls:   'Unknown',
} as const;

/** Ranks we deliberately keep OFF OpenDKP (mirrors the bot's SKIP_OPENDKP_RANKS). */
export const LOCAL_ONLY_RANKS = ['Trader', 'Non-raid Alt'] as const;
export type LocalOnlyRank = typeof LOCAL_ONLY_RANKS[number];

export function isLocalOnlyRank(rank: string | null | undefined): boolean {
  const r = String(rank || '').toLowerCase().trim();
  return r === 'trader' || r === 'non-raid alt' || r === 'non raid alt' || r === 'nonraid alt';
}
