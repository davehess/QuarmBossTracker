// Who signed up for the Raid-Helper event a flag event links to, matched to characters (the SIGNED column of
// /pop/flag-events). Pure. Kept apart from flagEventNeeds.ts because that file is also read by the raidmimic.com demo,
// and the sign-up matching drags in raidPlan.ts (the raid-night content), which a static sales page should not ship.

import { NOT_GOING, pickSignupCharacter } from './raidPlan';
import { RAIDER_RANKS } from './popRoster';

export type SignupLite = { discord_id: string | null; user_name: string | null; status: string | null; class_name: string | null };
export type SignedChar = {
  name: string; class: string | null; main_name: string | null; active: boolean | null; rank: string | null; discordId: string | null;
};
export type Signed<T> = { label: string; char: T | null };

/**
 * The Raid-Helper sign-ups that are coming, one per player, each matched to the character they bring (the one of the
 * class they signed up as, then their main: raidPlan.ts pickSignupCharacter, the /pop/raid rule). A sign-up whose
 * player has no listed character keeps their Raid-Helper name and no character. Raid-Helper files "absent",
 * "declined", "bench" and "tentative" as the status or as the class, so both are read (raidPlan.ts NOT_GOING).
 */
export function resolveSigned<T extends SignedChar>(signups: readonly SignupLite[], chars: readonly T[]): Signed<T>[] {
  const byDiscord = new Map<string, T[]>();
  for (const c of chars) {
    if (!c.discordId) continue;
    byDiscord.set(c.discordId, [...(byDiscord.get(c.discordId) ?? []), c]);
  }
  const seen = new Set<string>();
  const out: Signed<T>[] = [];
  for (const s of signups) {
    if (NOT_GOING.test(String(s.status ?? '')) || NOT_GOING.test(String(s.class_name ?? ''))) continue;
    const who = s.discord_id ?? `name:${String(s.user_name ?? '').toLowerCase()}`;
    if (seen.has(who)) continue;
    seen.add(who);
    const char = s.discord_id ? pickSignupCharacter(byDiscord.get(s.discord_id) ?? [], s.class_name, RAIDER_RANKS) : null;
    out.push({ label: char?.name ?? s.user_name ?? 'unknown', char });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}
