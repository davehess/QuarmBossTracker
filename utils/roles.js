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

function hasOfficerRole(member) {
  const roles = getOfficerRoles();
  return member.roles.cache.some((r) => roles.includes(r.name));
}

function allowedRolesList() {
  return getAllowedRoles().map((r) => `**${r}**`).join(', ');
}

function officerRolesList() {
  return getOfficerRoles().map((r) => `**${r}**`).join(', ');
}

module.exports = { getAllowedRoles, getOfficerRoles, hasAllowedRole, hasOfficerRole, allowedRolesList, officerRolesList };
