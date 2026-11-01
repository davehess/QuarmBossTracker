// uiRestoreGuard.js — which file names a UI Studio restore may write.
//
// UI Studio backs up EverQuest's own settings files and nothing else: _readUiBundle in main.js reads
// eqclient.ini, zeal.ini and the character's <Char>_*.ini / UI_<Char>_*.ini / Sock_ / Socials_ /
// *spellsets*.ini files — every one a plain ".ini" in the EQ folder. A snapshot comes back from the
// server, so restoring one writes only names of that same shape: a bare file name, ".ini" extension,
// nothing else. Anything that fails is skipped (never written) and counted for the person.
//
// Pure (no fs, no Electron) so a test can run it directly.

const MAX_NAME_LENGTH = 128;
// First character a letter/digit/underscore (no leading dot); then the characters EQ file names use.
const NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*\.ini$/i;
// Windows device names resolve to the device, not a file, whatever the extension.
const DEVICE_RE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

function restorableName(name) {
  if (typeof name !== 'string' || !name || name.length > MAX_NAME_LENGTH) return false;
  if (name.includes('..')) return false;
  if (!NAME_RE.test(name)) return false;
  if (DEVICE_RE.test(name.split('.')[0])) return false;
  return true;
}

// Split a snapshot's { name: text } map into what may be written and the names that may not.
// A non-string body is skipped too. Returns { files, skipped } (skipped is a list of names).
function filterRestorable(files) {
  const out = {}, skipped = [];
  for (const [name, text] of Object.entries(files && typeof files === 'object' ? files : {})) {
    if (restorableName(name) && typeof text === 'string') out[name] = text;
    else skipped.push(name);
  }
  return { files: out, skipped };
}

module.exports = { restorableName, filterRestorable, MAX_NAME_LENGTH };
