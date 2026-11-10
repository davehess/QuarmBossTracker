// utils/roles.js
// Role checks for slash commands and button handlers.
//
// ALLOWED_ROLE_NAMES  — general access (kill, unkill, pvpkill, updatetimer, etc.)
// OFFICER_ROLE_NAMES  — elevated access (announce, cancel, tick, board, cleanup, etc.)
//                       Defaults to ALLOWED_ROLE_NAMES if not set.

function getAllowedRoles() {
  const raw = process.env.ALLOWED_ROLE_NAMES || process.env.ALLOWED_ROLE_NAME || 'Pack Member';
  return raw.split(',').map((r) => r.trim()).filter(Boolean);
}

function getOfficerRoles() {
  const raw = process.env.OFFICER_ROLE_NAMES || process.env.ALLOWED_ROLE_NAMES || 'Officer,Guild Leader';
  return raw.split(',').map((r) => r.trim()).filter(Boolean);
}

function hasAllowedRole(member) {
  const allowed = getAllowedRoles();
  return member.roles.cache.some((r) => allowed.includes(r.name));
}

// Officer rights belong to the home Discord server (DISCORD_GUILD_ID) only. Role NAMES are not unique across servers, so a
// member of any other server that has this app and a role called "Officer" must not pass. Every officer check funnels
// through here, and a GuildMember carries the server it belongs to. Unset env (local dev) enforces nothing.
function _inHomeGuild(member) {
  const home = process.env.DISCORD_GUILD_ID;
  const gid = member && member.guild && member.guild.id;
  return !home || !gid || String(gid) === String(home);
}

function hasOfficerRole(member) {
  if (!_inHomeGuild(member)) return false;
  const roles = getOfficerRoles();
  return member.roles.cache.some((r) => roles.includes(r.name));
}

// The /who lookups (/who, /whois, /whoall and their Show Family button) are the guild's own: history
// that unmasks anonymous players, Zek flags, and which character is whose alt. Anyone in the Discord
// server could run them before (the guild lead, 2026-09-26: "we shouldnt just give away our secret
// weapon … end users should ultimately decide on if their characters are linked outside of the
// guild"). No member in the interaction (a DM, say) is not a member.
function isGuildMember(interaction) {
  return !!(interaction && interaction.member && interaction.member.roles && hasAllowedRole(interaction.member));
}
const MEMBERS_ONLY = '❌ That lookup is for Wolf Pack members.';

function allowedRolesList() {
  return getAllowedRoles().map((r) => `**${r}**`).join(', ');
}

function officerRolesList() {
  return getOfficerRoles().map((r) => `**${r}**`).join(', ');
}

module.exports = { getAllowedRoles, getOfficerRoles, hasAllowedRole, hasOfficerRole, allowedRolesList, officerRolesList, isGuildMember, MEMBERS_ONLY };
