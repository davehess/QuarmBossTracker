// utils/wolfpackMembers.js — periodic sync of Discord guild membership into
// the Supabase `wolfpack_members` table. Lets the web app (wolfpack.quest)
// know the full pack roster before each member has signed in to the site.
//
// Triggered from the bot's ready handler:
//   1. Once on startup (after the rest of the startup sequence)
//   2. Every 6 hours via setInterval
//
// The web OAuth callback also upserts a row each time a user signs in, so
// the `user_id` (Supabase auth UUID) gets backfilled the first time each
// member visits the site. This sync only writes the Discord-side columns
// — it leaves `user_id` alone for rows where it's already set.
//
// Departures: a row whose person is no longer in the guild is flipped to
// is_member=false with roles/role_names emptied. Two paths: the full sync
// below (after a sane full fetch) and markMemberLeft() from the bot's
// guildMemberRemove listener (immediate). Roles are CLEARED, not just the flag,
// because the officer gate (web/lib/officer.ts) and Mimic session identity
// (utils/mimicLink.js) read role_names without looking at is_member; a kept
// "Raid Pack" would keep working for someone who left. user_id, nickname and
// avatar stay, so history and the audit trail still resolve a name. A person
// who rejoins is restored by the next sync (is_member:true + fresh roles) or
// at their next web sign-in.
const supabase = require('./supabase');

const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Partial-fetch guard: only reconcile departures when the guild fetch returned
// at least this share of the rows we currently hold as is_member=true. A fetch
// that came back short must never read as "everyone else left".
const MIN_FETCH_RATIO = 0.5;
const LEFT_BATCH = 50; // ids per `in.(…)` filter — keeps the URL short

// What a departed member's row is rewritten to. Reads as "not in the guild, no roles".
function _leftPatch() {
  return { is_member: false, roles: [], role_names: [], refreshed_at: new Date().toISOString() };
}

// Map a Discord.js GuildMember to a wolfpack_members row. Strips @everyone
// from the roles array (its ID equals the guild ID by Discord convention).
// Resolves role names from guild.roles.cache so rows are useful before the
// user has ever signed in to the web app.
function memberToRow(guild, m) {
  const everyoneId = guild.id;
  const memberRoles = [...m.roles.cache.values()].filter(r => r.id !== everyoneId);
  const roles      = memberRoles.map(r => r.id);
  const role_names = memberRoles.map(r => r.name);
  const nickname = m.nickname || m.user.globalName || m.user.username;
  return {
    discord_id:   m.id,
    nickname,
    global_name:  m.user.globalName || null,
    avatar_url:   m.displayAvatarURL({ size: 64 }),
    roles,
    role_names,
    is_member:    true,
    joined_at:    m.joinedAt ? m.joinedAt.toISOString() : null,
    refreshed_at: new Date().toISOString(),
  };
}

// Roles catalog — small enough to upsert in one call.
async function syncWolfpackRoles(guild) {
  const everyoneId = guild.id;
  const roleRows = [...guild.roles.cache.values()]
    .filter(r => r.id !== everyoneId)  // skip @everyone
    .map(r => ({
      role_id:      r.id,
      name:         r.name,
      color:        r.color,
      position:     r.position,
      managed:      r.managed,
      refreshed_at: new Date().toISOString(),
    }));

  if (roleRows.length === 0) return 0;
  const result = await supabase.upsert('wolfpack_roles', roleRows, 'role_id');
  return result ? roleRows.length : 0;
}

// Flip rows for people no longer in the guild. `presentIds` = discord ids from
// a completed full fetch (bots excluded). Returns { flipped, skipped? }.
async function reconcileDepartedMembers(presentIds) {
  const present = new Set(presentIds.map(String));
  const current = await supabase.selectAllPaged(
    'wolfpack_members', 'is_member=eq.true&select=discord_id', 'discord_id');
  if (!Array.isArray(current)) {
    console.warn('[members-sync] could not read current members — departures not reconciled');
    return { flipped: 0, skipped: 'read-failed' };
  }
  if (present.size === 0 || present.size < current.length * MIN_FETCH_RATIO) {
    console.warn(`[members-sync] fetch returned ${present.size} members vs ${current.length} on file — looks partial, departures not reconciled`);
    return { flipped: 0, skipped: 'partial-fetch' };
  }
  const gone = current.map(r => String(r.discord_id)).filter(id => /^\d+$/.test(id) && !present.has(id));
  let flipped = 0;
  for (let i = 0; i < gone.length; i += LEFT_BATCH) {
    const ids = gone.slice(i, i + LEFT_BATCH);
    const res = await supabase.update('wolfpack_members', `discord_id=in.(${ids.join(',')})&is_member=eq.true`, _leftPatch());
    if (Array.isArray(res)) flipped += res.length;
  }
  if (gone.length) console.log(`[members-sync] ${flipped}/${gone.length} departed members marked is_member=false`);
  return { flipped };
}

// Immediate single-member version for the guildMemberRemove listener.
// Best-effort: never throws, returns whether the update was accepted.
async function markMemberLeft(discordId) {
  try {
    if (!supabase.isEnabled() || !/^\d+$/.test(String(discordId))) return false;
    const res = await supabase.update('wolfpack_members', `discord_id=eq.${String(discordId)}`, _leftPatch());
    return Array.isArray(res);
  } catch (err) {
    console.warn('[members-sync] markMemberLeft failed:', err?.message);
    return false;
  }
}

// One-shot sync — fetches all members and upserts in batches of 100 so we
// don't overrun PostgREST's payload limit on big guilds. Also writes the
// guild's full role catalog so the web app can resolve role IDs to names.
async function syncWolfpackMembers(client) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[members-sync] Supabase env not set — skipping');
    return { synced: 0, skipped: true };
  }

  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) {
    console.warn('[members-sync] DISCORD_GUILD_ID not set — skipping');
    return { synced: 0, skipped: true };
  }

  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
  if (!guild) {
    console.warn('[members-sync] guild not found in cache');
    return { synced: 0, skipped: true };
  }

  // Roles first — the web callback joins to this to resolve role names
  // before checking ALLOWED_ROLE_NAMES, so it needs to land before any
  // members try to sign in.
  const rolesSynced = await syncWolfpackRoles(guild);

  const members = await guild.members.fetch();
  const rows = members
    .filter(m => !m.user.bot)                  // exclude bots
    .map(m => memberToRow(guild, m));

  // Upsert in chunks. PostgREST handles arrays fine but we keep batches
  // small to avoid long-running statements blocking the table.
  const BATCH = 100;
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const result = await supabase.upsert('wolfpack_members', chunk, 'discord_id');
    if (result) written += chunk.length;
  }

  console.log(`[members-sync] upserted ${written}/${rows.length} members + ${rolesSynced} roles from ${guild.name}`);

  // The fetch above completed (it throws on failure), so anyone on file but
  // absent from it has left. Failure here must not fail the sync.
  let departed = 0;
  try {
    departed = (await reconcileDepartedMembers(rows.map(r => r.discord_id))).flipped;
  } catch (err) {
    console.warn('[members-sync] departure reconcile failed:', err?.message);
  }
  return { synced: written, total: rows.length, roles: rolesSynced, departed };
}

// Kick off the recurring sync. Returns a function that cancels the interval.
function startWolfpackMembersSync(client) {
  // First run after a short delay so it doesn't compete with the rest of
  // the startup sequence (board posting, cleanup, etc.).
  setTimeout(() => {
    syncWolfpackMembers(client).catch(err =>
      console.warn('[members-sync] initial sync failed:', err?.message),
    );
  }, 30_000);

  const handle = setInterval(() => {
    syncWolfpackMembers(client).catch(err =>
      console.warn('[members-sync] scheduled sync failed:', err?.message),
    );
  }, SYNC_INTERVAL_MS);

  return () => clearInterval(handle);
}

module.exports = { syncWolfpackMembers, startWolfpackMembersSync, reconcileDepartedMembers, markMemberLeft };
