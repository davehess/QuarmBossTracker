// utils/roles.js
// Parses ALLOWED_ROLE_NAMES env var (comma-delimited) and checks member roles.

let _roleNames = null;

function getAllowedRoles() {
  if (_roleNames) return _roleNames;
  const raw = process.env.ALLOWED_ROLE_NAMES || process.env.ALLOWED_ROLE_NAME || 'Pack Member';
  _roleNames = raw.split(',').map((r) => r.trim()).filter(Boolean);
  return _roleNames;
}

/**
 * Returns true if the GuildMember has at least one of the allowed roles.
 */
function hasAllowedRole(member) {
  const allowed = getAllowedRoles();
  return member.roles.cache.some((r) => allowed.includes(r.name));
}

/**
 * Returns a formatted string listing the allowed roles for error messages.
 */
function allowedRolesList() {
  return getAllowedRoles().map((r) => `**${r}**`).join(', ');
}

module.exports = { getAllowedRoles, hasAllowedRole, allowedRolesList };
