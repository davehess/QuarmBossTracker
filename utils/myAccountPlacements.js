// utils/myAccountPlacements.js — GET /api/agent/account-placements: the signed-in person's OWN game-account
// placements, for Mimic's local "My account inventory" page.
//
// WHY IT EXISTS
// The local page (web/local, built into Mimic) used to GUESS which characters share a game account from their
// shared-bank snapshots, and counted 23 "accounts" for someone who owns 6. The hosted page /me/inventory already
// uses the owner's real placements (character_accounts open rows + game_accounts, filled in on /me/accounts).
// This route hands the same answer to the agent so the local page runs the SAME aggregation on the SAME input.
//
// WHO IS ASKED ABOUT
// The caller's own Discord id, taken from the Mimic session by the route. Nothing in the query names a person.
// A placement is returned only for a character in the caller's FAMILY (owned_character_names(), the same rule
// utils/characterPrefs.js uses), so a request can never read anyone else's account layout. Rows are the OPEN
// ones only (valid_to is null): a closed row is #charactertransfer history, not where the character is now.
//
// The mapping is private to the people in it: never copy rows from these tables into docs, tests or comments.

const characterPrefs = require('./characterPrefs');

const NO_ACCOUNT = { status: 403, body: { error: 'no linked account' } };
const UNAVAILABLE = { status: 502, body: { error: 'unavailable' } };

// PostgREST in.(...) list of uuids. Anything that is not a plain uuid is dropped rather than passed on.
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resolves to { status, body } for the route to send.
//   200 { ok: true, placements: [{ character, accountId, slot, label }] }   (empty when nothing is placed)
//   403 no linked Discord account · 502 a read failed (never an empty answer: the agent keeps what it had)
async function minePlacements(supabase, cache, discordId) {
  if (!discordId) return NO_ACCOUNT;

  const names = await characterPrefs.ownedNames(supabase, cache, discordId);
  if (!names) return UNAVAILABLE;
  if (names.length === 0) return { status: 200, body: { ok: true, placements: [] } };

  const guild = encodeURIComponent(characterPrefs.GUILD);
  const open = await supabase.select(
    'character_accounts',
    `guild_id=eq.${guild}&valid_to=is.null&character_name=in.${encodeURIComponent(characterPrefs.inList(names))}`
    + '&select=character_name,account_id',
  );
  if (!Array.isArray(open)) return UNAVAILABLE;

  // Belt and braces: the query already filtered by the family, but the answer is the privacy boundary.
  const mine = new Set(names.map(n => n.toLowerCase()));
  const rows = open.filter(r => r && typeof r.character_name === 'string' && mine.has(r.character_name.toLowerCase())
    && typeof r.account_id === 'string' && UUID_RX.test(r.account_id));
  if (rows.length === 0) return { status: 200, body: { ok: true, placements: [] } };

  const ids = [...new Set(rows.map(r => r.account_id))];
  const accts = await supabase.select(
    'game_accounts',
    `guild_id=eq.${guild}&id=in.(${ids.join(',')})&select=id,slot,label`,
  );
  // A failed account lookup still leaves the placements usable; the label falls back to "Account".
  const meta = new Map((Array.isArray(accts) ? accts : []).filter(a => a && a.id).map(a => [a.id, a]));

  const placements = rows
    .map(r => {
      const a = meta.get(r.account_id);
      return {
        character: r.character_name,
        accountId: r.account_id,
        slot: Number.isInteger(a?.slot) ? a.slot : null,
        label: typeof a?.label === 'string' && a.label.trim() ? a.label.trim() : null,
      };
    })
    .sort((x, y) => { const a = x.character.toLowerCase(), b = y.character.toLowerCase(); return a < b ? -1 : a > b ? 1 : 0; });
  return { status: 200, body: { ok: true, placements } };
}

module.exports = { minePlacements, UUID_RX };
