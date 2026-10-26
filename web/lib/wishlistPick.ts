// Which characters an "Add to wishlist" control offers, and which one it starts on. Pure: no database, no React.
//
// The control (components/WishlistControls.tsx) sits wherever an item shows: the item page, the raid plan's loot
// lists, /me/upgrades and /me/wishlist. It offers only the signed-in member's OWN characters (ownedCharacters is
// the source; the server action re-checks ownership, and the bot checks it again from the member's id), and a
// name the action would refuse is never offered at all.
//
// Default character (the guild lead, 2026-10-26): on the raid plan it is the character the member's sign-up for
// the next raid brings (lib/raidMe.ts bringingFrom, which uses pickSignupCharacter); everywhere else it is the
// member's main. "Main first" is the order wishlistCharacters returns, so the default falls out of the list.

/** What the server actions accept as a character name (web/app/me/upgrades/actions.ts and the bot say the same). */
export const WISHLIST_NAME_RE = /^[A-Za-z]{2,}$/;

type OwnedLike = { name: string; main_name: string | null; active: boolean; hidden_from_lists: boolean | null };

const isMainOf = (c: { name: string; main_name: string | null }) => !c.main_name || c.main_name.toLowerCase() === c.name.toLowerCase();

/**
 * The names to offer: usable names only, characters their owner tucked away left out (unless `keep` names one, as
 * the sign-up character does), main first, then active, then by name.
 */
export function wishlistCharacters(owned: OwnedLike[], keep?: string | null): string[] {
  const k = keep?.toLowerCase() ?? null;
  return owned
    .filter(c => WISHLIST_NAME_RE.test(c.name) && (!c.hidden_from_lists || c.name.toLowerCase() === k))
    .sort((a, b) => Number(isMainOf(b)) - Number(isMainOf(a)) || Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
    .map(c => c.name);
}

/** The name the control starts on: `preferred` if it is one of `names` (spelled as `names` spells it), else the first, which is the main. */
export function pickDefaultCharacter(names: string[], preferred?: string | null): string | null {
  const want = preferred?.toLowerCase();
  return (want ? names.find(n => n.toLowerCase() === want) : undefined) ?? names[0] ?? null;
}

// ── What the control shows for one character ────────────────────────────────────────────────────────────────────

/** One character's entry for one item. Absent from a states map means "not on that character's wishlist". */
export type WishState = { priority: number | null; bid: number | null; bidKnown: boolean };

/** A picker option: the name, marked when the item is already on that character's list (the order stays main first). */
export function pickerLabel(name: string, states: Record<string, WishState>): string {
  return states[name] ? `${name} · on list` : name;
}
