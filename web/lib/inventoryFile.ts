// web/lib/inventoryFile.ts — reading an EQ inventory export, and working out
// WHO it belongs to.
//
// Why this file exists (Hitya, 2026-08-14): "can you make it so that anyone can
// upload additional inventory files from the /me page and have it bring in
// their other characters/mules?"
//
// The existing /me upload is per-character and gated on the character ALREADY
// being in `characters` with your discord_id — which is exactly what a mule is
// not. Pyxil's bank toons (Archanistsells, Lavenderna, Pyxtrade, …) exist only
// as files on her disk: no logs, no /who sighting, no OpenDKP row. The file
// itself is the only evidence they exist, and its NAME is the only thing that
// says whose it is.
//
// Everything here is pure so the rules can be tested without a database or a
// browser. The server action in web/app/me/inventory-actions.ts does the I/O.

export type ParsedInvRow = {
  slot_label: string;
  item_id: number | null;
  item_name: string;
  quantity: number;
};

/**
 * Parse an EQ `/outputfile inventory` export.
 *
 * Tab-separated: Location / Name / ID / Count / Slots. Falls back to 2+ spaces
 * because some clients pad the columns instead.
 */
export function parseInventory(text: string): ParsedInvRow[] {
  const out: ParsedInvRow[] = [];
  const seen = new Set<string>();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    let cols = line.split('\t');
    if (cols.length < 4) cols = line.split(/\s{2,}/);
    if (cols.length < 4) continue;
    const [location, name, idStr, countStr] = cols.map(c => c.trim());
    if (!location || location.toLowerCase() === 'location') continue;   // header
    const lname = (name || '').trim();
    if (!lname || /^empty$/i.test(lname) || lname === '(empty)') continue;
    // Currency rows (Bank-Coin, General-Coin…) are platinum totals, not items,
    // and they would skew quantity aggregates. The wallet is a separate signal.
    if (/-Coin$/i.test(location) || /^Currency$/i.test(lname)) continue;
    const id = parseInt(idStr, 10);
    const count = Math.max(1, parseInt(countStr, 10) || 1);
    // One item per slot. The file should not repeat a slot, but a duplicate
    // would collide on the unique index mid-batch.
    if (seen.has(location)) continue;
    seen.add(location);
    out.push({
      slot_label: location.slice(0, 64),
      item_id: Number.isFinite(id) && id > 0 ? id : null,
      item_name: lname.slice(0, 128),
      quantity: count,
    });
  }
  return out;
}

/**
 * Whose inventory is this? Derived from the FILE NAME, because for a mule
 * that is the only place the name appears — the rows inside are items, not
 * identity.
 *
 * EQ writes `<Name>-Inventory.txt`; Zeal's ExportOnCamp regenerates the same
 * file, and people rename copies with dates or "(1)" suffixes when they keep
 * several. Handles all of those and refuses anything that does not reduce to a
 * plausible EverQuest character name.
 *
 * ⚠ EQ names are letters only — no digits, no spaces (Hitya, 2026-08-13, the
 * "Atlasius2 is a backup log not a person" finding). A name that fails that is
 * a renamed copy we cannot attribute, and guessing would create a junk
 * character row that somebody then has to clean up.
 */
export function characterFromInventoryFilename(filename: string): string | null {
  let base = String(filename || '').trim();
  if (!base) return null;
  // Strip any directory part — browsers hand over a bare name, but a pasted
  // path or a drag from Explorer can carry one.
  base = base.split(/[\\/]/).pop() || '';
  base = base.replace(/\.(txt|log|csv)$/i, '');
  // Drop trailing copy markers: " (1)", "-2026-08-14", "_2026_08_14", " copy".
  base = base.replace(/\s*\(\d+\)$/, '');
  base = base.replace(/[\s_-]*copy$/i, '');
  base = base.replace(/[-_]\d{2,4}([-_]\d{1,2}){0,2}$/, '');
  // Then the inventory marker itself, in the spellings people actually have.
  base = base.replace(/[-_ ]*inventory$/i, '');
  base = base.trim();
  if (!/^[A-Za-z]{2,20}$/.test(base)) return null;
  // EQ capitalises the first letter and lowercases the rest.
  return base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
}

export type ClaimVerdict =
  | { action: 'upload'; claim: false }            // already yours
  | { action: 'upload'; claim: true }             // new or unclaimed-and-unknown → take it
  | { action: 'upload-unclaimed'; claim: false }  // real character, not yours to claim
  | { action: 'refuse'; reason: string };

export type ExistingCharacter = {
  name: string;
  discord_id: string | null;
  opendkp_id: number | null;
} | null;

/**
 * May this uploader attach this inventory, and does it become theirs?
 *
 * The three cases that matter, and why each lands where it does:
 *
 *  • **Already in your household** → upload, nothing to claim.
 *  • **Not in `characters` at all** → create it, claimed by you. The file was
 *    on your disk and nothing else in the guild has ever heard of this name;
 *    that is as strong as evidence gets for a bank mule.
 *  • **Exists but unclaimed** → split on whether it looks like a REAL raider.
 *    A row conjured from a /who sighting has no `opendkp_id`; a genuine member
 *    who simply has not linked Discord does. So an OpenDKP row is never
 *    claimed by an upload — we take the data and say plainly that it was not
 *    linked, rather than quietly transferring someone's character.
 *  • **Belongs to someone else** → refuse. Never overwrite another person's
 *    inventory snapshot, even for an officer: this is a self-service path, and
 *    officers have the per-character upload for the deliberate case.
 */
export function claimVerdict(
  existing: ExistingCharacter,
  householdDiscordIds: ReadonlySet<string>,
): ClaimVerdict {
  if (!existing) return { action: 'upload', claim: true };
  if (existing.discord_id && householdDiscordIds.has(existing.discord_id)) {
    return { action: 'upload', claim: false };
  }
  if (existing.discord_id) {
    return { action: 'refuse', reason: 'that character belongs to another member' };
  }
  // Unclaimed.
  if (existing.opendkp_id != null) return { action: 'upload-unclaimed', claim: false };
  return { action: 'upload', claim: true };
}
