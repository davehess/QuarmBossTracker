// utils/charmSession.js — what the charm_sessions upsert accepts from an agent's `charm_sessions[]`.
//
// The guild lead, 2026-10-08 (enchanters report charms breaking early): a recorded session carried no
// spell and no way to tell a charm that ran its course from one that broke. The agent now adds `spell`
// (the cast name, lower-cased) and `ran_full` (lived >= 90% of that spell's max duration). Older agents
// send neither, and a newer one may send null: anything that is not a short string / a real boolean
// becomes null, so a malformed upload cannot fail the whole row's upsert.

const SPELL_MAX_LEN = 80;

function charmSpellName(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s && s.length <= SPELL_MAX_LEN ? s : null;
}

function charmRanFull(v) {
  return typeof v === 'boolean' ? v : null;
}

module.exports = { charmSpellName, charmRanFull, SPELL_MAX_LEN };
