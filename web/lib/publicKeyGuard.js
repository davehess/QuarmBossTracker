// Build-time guard (2026-10-29 security finding): NEXT_PUBLIC_SUPABASE_ANON_KEY is inlined into every
// browser bundle, and on Vercel it had held the service_role key since launch. This refuses a build whose
// public key is a secret one: a legacy JWT whose role is not anon, or a new-style sb_secret_ key.
// Returns null when the key is safe to publish (or unset), else the reason.
function publicKeyProblem(key) {
  const k = String(key || '').trim();
  if (!k) return null;
  if (k.startsWith('sb_secret_')) return 'it is a secret key (sb_secret_)';
  if (k.startsWith('sb_publishable_')) return null;
  const parts = k.split('.');
  if (parts.length !== 3) return null;
  let role;
  try {
    role = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).role;
  } catch {
    return null;
  }
  return role && role !== 'anon' ? `its role is "${role}"` : null;
}

module.exports = { publicKeyProblem };
