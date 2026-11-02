// utils/characterOwner.js — does this Discord user own this character?
//
// Rule: a character's private figures (sealed bids) belong to its owner's household. The owner is
// characters.discord_id, else its main's (main_name). The household is the Discord id plus every id merged into the
// same root (wolfpack_members.merged_into_discord_id) — the same walk index.js _householdDiscordIds does.
//
// → 'owner' | 'other' | 'unlinked' (no owner on file for it or its main) | 'unknown' (a read failed or the name is
// not a character name). Callers treat 'other' and 'unknown' as "not yours".
const supabase = require('./supabase');

const NAME_RE = /^[A-Za-z]{2,24}$/;
const enc = encodeURIComponent;

async function householdIds(discordId) {
  const id = String(discordId || '');
  const ids = new Set(id ? [id] : []);
  if (!id) return ids;
  const me = await supabase.select('wolfpack_members', `discord_id=eq.${enc(id)}&select=discord_id,merged_into_discord_id&limit=1`);
  if (!Array.isArray(me)) return null;
  const root = (me[0] && me[0].merged_into_discord_id) || id;
  ids.add(String(root));
  const fam = await supabase.select('wolfpack_members',
    `or=(discord_id.eq.${enc(root)},merged_into_discord_id.eq.${enc(root)})&select=discord_id`);
  if (!Array.isArray(fam)) return null;
  for (const r of fam) if (r && r.discord_id) ids.add(String(r.discord_id));
  return ids;
}

async function ownerOfCharacter(name) {
  const guild = enc(supabase.guildId());
  const rows = await supabase.select('characters', `guild_id=eq.${guild}&name=ilike.${enc(name)}&select=name,main_name,discord_id&limit=1`);
  if (!Array.isArray(rows)) return undefined;
  let owner = (rows[0] && rows[0].discord_id) || null;
  if (!owner && rows[0] && rows[0].main_name && NAME_RE.test(String(rows[0].main_name))) {
    const root = await supabase.select('characters', `guild_id=eq.${guild}&name=ilike.${enc(rows[0].main_name)}&select=discord_id&limit=1`);
    if (!Array.isArray(root)) return undefined;
    owner = (root[0] && root[0].discord_id) || null;
  }
  return owner ? String(owner) : null;
}

async function discordOwnership(discordId, characterName) {
  try {
    const name = String(characterName || '').trim();
    if (!discordId || !NAME_RE.test(name) || !supabase.isEnabled()) return 'unknown';
    const owner = await ownerOfCharacter(name);
    if (owner === undefined) return 'unknown';
    if (!owner) return 'unlinked';
    const household = await householdIds(discordId);
    if (!household) return 'unknown';
    return household.has(owner) ? 'owner' : 'other';
  } catch {
    return 'unknown';
  }
}

module.exports = { discordOwnership };
