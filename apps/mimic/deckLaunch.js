// deckLaunch.js — one Steam entry that starts Mimic AND EverQuest (#156).
//
// The Deck install currently ends with TWO things to start by hand: the Lutris
// "Everquest" shortcut (which is what gets the Steam entry, per
// docs/RUNBOOK-deck-install.md §9) and the Mimic AppImage. In Gaming Mode that
// second one is genuinely awkward — there is no tray, no file manager, and no
// obvious way to start a second program before the game. So people play
// without Mimic running, which silently costs the raid its parse and chat
// upload for that night.
//
// This module generates a single launcher script and registers it as ONE Steam
// shortcut (apps/mimic/steamShortcuts.js writes shortcuts.vdf). Steam starts
// the script; the script starts Mimic, starts EQ, optionally types the login,
// waits for EQ to exit, and then optionally stops Mimic so Steam sees the game
// close and stops counting playtime.
//
// ── Load-bearing facts ──────────────────────────────────────────────────────
//
// 1. `lutris lutris:rungame/<slug>` RETURNS IMMEDIATELY. It hands the request
//    to the already-running Lutris process and exits ~instantly. So the script
//    can NEVER `wait` on the launch command's pid to know when EQ is done — it
//    has to poll for the eqgame.exe process the same way linuxZealBridge.js
//    does (_pgrepEqGame). Waiting on the launcher pid would make Steam show the
//    game as closed two seconds after you pressed Play.
//
// 2. A password passed as an ARGV is world-readable. Every process's command
//    line is readable via /proc/<pid>/cmdline by any user on the box, and shows
//    up in `ps aux`. So autofill must never be `xdotool type "$PASSWORD"` — it
//    pipes the secret to `xdotool type --file -` on STDIN instead, which keeps
//    it out of the process table entirely. This is the single most important
//    detail in the file.
//
// 3. `xdotool type` with no window targets WHATEVER HAS FOCUS. If the user
//    alt-tabs, or a notification steals focus mid-sequence, the password gets
//    typed into someone else's window — a Discord message box, say. So the
//    autofill block re-checks that EQ still owns the focused window
//    immediately before each type, and aborts the whole sequence otherwise.
//    Losing an autofill is free; leaking a password into guild chat is not.
//
// 4. Zeal does NOT do auto-login (checked against CoastalRedwood/Zeal's own
//    docs, 2026-08-26 — it covers keybinds/UI/maps, nothing authentication).
//    So keystroke injection is the only mechanism available, with all the
//    fragility that implies. That is why autofill is OFF by default and why
//    the script treats every step of it as best-effort.
//
// 5. Autofill needs an X server to talk to. Wine games run under XWayland in
//    Desktop Mode, so xdotool works there. Under Gaming Mode's gamescope it
//    generally does NOT — the script detects the absence of a usable DISPLAY
//    and skips autofill rather than hanging.
//
// Everything here is pure string/plan construction so it can be tested without
// a Deck; main.js owns the actual file writes and the secret box.

const path = require('path');

// ── Shell quoting ───────────────────────────────────────────────────────────
// Every interpolated value below is a path or a name that came from config,
// i.e. from a text field a human typed. Single-quote everything and escape
// embedded single quotes the POSIX way ('\'') so a folder named
// `/home/deck/Bob's EQ` cannot terminate the quoting and run as code.
function _shq(s) {
  return "'" + String(s == null ? '' : s).replace(/'/g, `'\\''`) + "'";
}

// ── EQ launch strategy ──────────────────────────────────────────────────────
// Two supported shapes, in preference order:
//   lutris — the runbook's install path (§4). Preferred: it applies the
//            runner's DXVK + DLL-override configuration, which is exactly the
//            thing §5's renderer chain depends on. Launching eqgame.exe
//            directly bypasses all of it and reproduces the "DirectX 6.0"
//            failure signature on an otherwise-correct install.
//   wine   — explicit prefix + loader, for a hand-built install with no Lutris
//            entry. The caller supplies both; we do not guess a prefix, because
//            guessing wrong starts a SECOND prefix and silently creates a fresh
//            empty install rather than failing.
function resolveEqLaunch(cfg = {}) {
  const d = cfg.deckLaunch || {};
  const slug = (d.lutrisSlug || '').trim();
  if (slug) {
    return {
      mode: 'lutris',
      slug,
      // flatpak Lutris is what the runbook installs (Discover store). Fall back
      // to a native `lutris` on PATH for non-Flatpak setups.
      cmd: 'lutris_run',
      display: `Lutris → ${slug}`,
    };
  }
  const eqDir = (d.eqDir || '').trim();
  const prefix = (d.winePrefix || '').trim();
  const loader = (d.wineLoader || '').trim() || 'wine';
  if (eqDir && prefix) {
    return {
      mode: 'wine', eqDir, prefix, loader,
      cmd: 'wine_run',
      display: `${loader} → ${path.join(eqDir, 'eqgame.exe')}`,
    };
  }
  return {
    mode: 'none',
    display: 'not configured',
    error: slug || eqDir || prefix
      ? 'Direct-Wine launch needs BOTH an EQ folder and a Wine prefix.'
      : 'Set a Lutris game slug (preferred) or an EQ folder + Wine prefix.',
  };
}

// ── Autofill plan ───────────────────────────────────────────────────────────
// Returns the ordered field list the script types. Kept separate from the
// script text so the ordering is testable: EQ's login screen is
// username → Tab → password → Return, and getting that wrong types the
// password into the visible username box.
function autofillPlan(cfg = {}) {
  const a = (cfg.deckLaunch || {}).autofill || {};
  if (!a.enabled) return { enabled: false, steps: [] };
  const user = (a.username || '').trim();
  if (!user) return { enabled: false, steps: [], error: 'autofill needs a username' };
  return {
    enabled: true,
    username: user,
    // Seconds to wait for the login window before giving up. The client has to
    // get through the splash + patcher first; 90s is generous on a cold Deck
    // SD-card install and costs nothing when it lands early.
    waitSecs: Number.isFinite(a.waitSecs) ? Math.max(5, Math.min(600, a.waitSecs)) : 90,
    steps: ['username', 'tab', 'password', 'return'],
  };
}

// ── The launcher script ─────────────────────────────────────────────────────
// `opts` is fully resolved by the caller — this function does no discovery, so
// what it emits is a pure function of what it was handed (and therefore
// diffable in a test).
function buildLaunchScript(opts = {}) {
  const {
    mimicAppImage,          // absolute path to the AppImage
    launch,                 // resolveEqLaunch() result
    autofill,               // autofillPlan() result
    credFile = '',          // 0600 file holding the password, or '' when unused
    stopMimicOnExit = true,
    preflightScript = '',   // optional; advisory only, never blocks
    logFile = '',
  } = opts;

  const L = [];
  const p = (s) => L.push(s);

  p('#!/usr/bin/env bash');
  p('# Wolf Pack — Steam Deck launcher. GENERATED by Mimic (apps/mimic/deckLaunch.js).');
  p('# Edits here are overwritten the next time you press "Install launcher" in');
  p('# Mimic Settings. Change the settings instead.');
  p('#');
  p('# Starts Mimic, starts EverQuest, and holds this process open until EQ');
  p('# exits so Steam tracks the session correctly.');
  p('');
  // -u would abort on any unset var; we deliberately probe optional ones.
  p('set -o pipefail');
  p('');
  if (logFile) {
    p(`LOGFILE=${_shq(logFile)}`);
    p('mkdir -p "$(dirname "$LOGFILE")" 2>/dev/null');
    // Keep the log to the last run plus a single rollover — this runs every
    // raid night and an unbounded log on a Deck's SD card is a slow leak.
    p('[ -f "$LOGFILE" ] && mv -f "$LOGFILE" "$LOGFILE.1" 2>/dev/null');
    p('exec > >(tee -a "$LOGFILE") 2>&1');
    p('');
  }
  p('say() { printf "[wolfpack] %s\\n" "$*"; }');
  p('');

  // ── Preflight (advisory) ──
  if (preflightScript) {
    p('# Preflight is ADVISORY. A WARN must never stop a raid launch, so we');
    p('# report and continue regardless of exit code.');
    p(`if [ -r ${_shq(preflightScript)} ]; then`);
    p(`  say "preflight…"`);
    p(`  bash ${_shq(preflightScript)} || say "preflight reported problems (continuing)"`);
    p('fi');
    p('');
  }

  // ── Mimic ──
  p('# ── Mimic ──────────────────────────────────────────────────────────────');
  if (mimicAppImage) {
    p(`MIMIC=${_shq(mimicAppImage)}`);
    p('MIMIC_STARTED=0');
    p('if pgrep -f "Wolf-Pack-Mimic.*AppImage" >/dev/null 2>&1; then');
    p('  say "Mimic already running"');
    p('elif [ -x "$MIMIC" ]; then');
    p('  say "starting Mimic"');
    // setsid detaches it from this script's process group, so a Steam "stop"
    // that signals the group does not also kill Mimic mid-write.
    p('  setsid "$MIMIC" >/dev/null 2>&1 &');
    p('  MIMIC_STARTED=1');
    p('  sleep 2');
    p('else');
    p('  say "WARNING: Mimic not found or not executable at $MIMIC — continuing without it"');
    p('fi');
  } else {
    p('say "no Mimic AppImage configured — launching EQ only"');
    p('MIMIC_STARTED=0');
  }
  p('');

  // ── EQ ──
  p('# ── EverQuest ──────────────────────────────────────────────────────────');
  if (launch && launch.mode === 'lutris') {
    p(`SLUG=${_shq(launch.slug)}`);
    p('if command -v lutris >/dev/null 2>&1; then');
    p('  say "launching EQ via native Lutris ($SLUG)"');
    p('  lutris "lutris:rungame/$SLUG" >/dev/null 2>&1 &');
    p('elif command -v flatpak >/dev/null 2>&1; then');
    p('  say "launching EQ via flatpak Lutris ($SLUG)"');
    p('  flatpak run net.lutris.Lutris "lutris:rungame/$SLUG" >/dev/null 2>&1 &');
    p('else');
    p('  say "ERROR: neither lutris nor flatpak found — cannot launch EQ"');
    p('  exit 1');
    p('fi');
  } else if (launch && launch.mode === 'wine') {
    p(`export WINEPREFIX=${_shq(launch.prefix)}`);
    p(`EQDIR=${_shq(launch.eqDir)}`);
    p(`WINE=${_shq(launch.loader)}`);
    p('say "launching EQ via $WINE"');
    // `patchme` skips the client's own patcher, matching the Lutris entry the
    // runbook's installer creates. cd first: eqgame.exe loads assets by
    // RELATIVE path, and an empty working directory hangs it after the splash
    // with no error (RUNBOOK §6 trap 2).
    p('cd "$EQDIR" || { say "ERROR: cannot cd to $EQDIR"; exit 1; }');
    p('"$WINE" "$EQDIR/eqgame.exe" patchme >/dev/null 2>&1 &');
  } else {
    p('say "ERROR: no EQ launch configured — set a Lutris slug, or an EQ folder + Wine prefix, in Mimic Settings"');
    p('exit 1');
  }
  p('');

  // ── Wait for EQ to appear ──
  p('# Lutris hands off to its own daemon and exits immediately, so the pid we');
  p('# just backgrounded says nothing about the game. Poll for the real process.');
  p('say "waiting for eqgame.exe…"');
  p('EQ_UP=0');
  p('for _ in $(seq 1 120); do');
  p('  if pgrep -f "eqgame\\.exe" >/dev/null 2>&1; then EQ_UP=1; break; fi');
  p('  sleep 1');
  p('done');
  p('if [ "$EQ_UP" != "1" ]; then');
  p('  say "EQ did not start within 120s — see the Lutris window for the error"');
  p('else');
  p('  say "EQ is up"');
  p('fi');
  p('');

  // ── Autofill ──
  if (autofill && autofill.enabled && credFile) {
    p('# ── Login autofill (best-effort) ───────────────────────────────────────');
    p('# Every step here can fail harmlessly. NOTHING in this block is allowed');
    p('# to abort the launch, and the password is never passed as an argument —');
    p('# argv is world-readable through /proc/<pid>/cmdline.');
    p(`CREDFILE=${_shq(credFile)}`);
    p('if [ "$EQ_UP" = "1" ] && [ -r "$CREDFILE" ] && command -v xdotool >/dev/null 2>&1 && [ -n "${DISPLAY:-}" ]; then');
    p('  (');
    p(`    USERNAME=${_shq(autofill.username)}`);
    p('    # Find EQ\'s window. Wine titles it after the executable or the game.');
    p('    WID=""');
    p(`    for _ in $(seq 1 ${autofill.waitSecs}); do`);
    p('      WID=$(xdotool search --name "EverQuest" 2>/dev/null | head -n1)');
    p('      [ -n "$WID" ] && break');
    p('      sleep 1');
    p('    done');
    p('    if [ -z "$WID" ]; then say "autofill: no EverQuest window found — type it yourself"; exit 0; fi');
    p('');
    p('    # Give the login screen a moment to actually accept input.');
    p('    xdotool windowactivate --sync "$WID" 2>/dev/null');
    p('    sleep 2');
    p('');
    p('    # Refuse to type unless EQ genuinely owns focus RIGHT NOW. Without');
    p('    # this a stray alt-tab types the password into whatever took focus.');
    p('    focused() { [ "$(xdotool getwindowfocus 2>/dev/null)" = "$WID" ]; }');
    p('    if ! focused; then say "autofill: EQ lost focus — skipping (safety)"; exit 0; fi');
    p('');
    p('    xdotool type --clearmodifiers --delay 40 -- "$USERNAME" 2>/dev/null');
    p('    if ! focused; then say "autofill: focus changed before password — aborted"; exit 0; fi');
    p('    xdotool key --clearmodifiers Tab 2>/dev/null');
    p('    if ! focused; then say "autofill: focus changed before password — aborted"; exit 0; fi');
    p('');
    p('    # --file - reads the secret from STDIN. This is the whole reason the');
    p('    # password lives in a file instead of a variable: it never becomes an');
    p('    # argv, so it never appears in ps/proc for other users to read.');
    p('    xdotool type --clearmodifiers --delay 40 --file - < "$CREDFILE" 2>/dev/null');
    p('    if ! focused; then say "autofill: focus changed before submit — not pressing Enter"; exit 0; fi');
    p('    xdotool key --clearmodifiers Return 2>/dev/null');
    p('    say "autofill: submitted"');
    p('  ) &');
    p('elif [ "$EQ_UP" = "1" ]; then');
    p('  if [ -z "${DISPLAY:-}" ]; then');
    p('    say "autofill: no DISPLAY (Gaming Mode/gamescope) — type your login manually"');
    p('  elif ! command -v xdotool >/dev/null 2>&1; then');
    p('    say "autofill: xdotool not installed — skipping"');
    p('  fi');
    p('fi');
    p('');
  }

  // ── Hold until EQ exits ──
  p('# ── Hold the session open ──────────────────────────────────────────────');
  p('# Steam counts the game as running for exactly as long as THIS script');
  p('# lives, so we outlive eqgame.exe deliberately.');
  p('if [ "$EQ_UP" = "1" ]; then');
  p('  while pgrep -f "eqgame\\.exe" >/dev/null 2>&1; do sleep 5; done');
  p('  say "EQ exited"');
  p('fi');
  p('');
  if (stopMimicOnExit && mimicAppImage) {
    p('# Only stop Mimic if WE started it — a Mimic the user already had open');
    p('# (dashboard on another monitor, mid-backfill) must survive the game.');
    p('if [ "$MIMIC_STARTED" = "1" ]; then');
    p('  say "stopping Mimic (we started it)"');
    p('  pkill -f "Wolf-Pack-Mimic.*AppImage" 2>/dev/null');
    p('fi');
  } else if (mimicAppImage) {
    p('say "leaving Mimic running"');
  }
  p('');
  p('say "done"');
  p('exit 0');

  return L.join('\n') + '\n';
}

// ── Steam shortcut description ──────────────────────────────────────────────
// The shape steamShortcuts.upsertShortcut() consumes. AppName is what the
// community controller layouts key off, and RUNBOOK §9 step 3 is explicit that
// it must be exactly "Everquest Quarm" for those layouts to be offered — so
// that stays the default and is not something we cutely rename.
function steamShortcutFor({ scriptPath, appName = 'Everquest Quarm', iconPath = '', startDir = '' } = {}) {
  return {
    AppName: appName,
    Exe: `"${scriptPath}"`,
    StartDir: `"${startDir || path.dirname(scriptPath)}"`,
    icon: iconPath || '',
    ShortcutPath: '',
    // ENABLE_GAMESCOPE_WSI=0 is RUNBOOK §9 step 5 — the documented fix for
    // "the game will not start from Steam". Pre-setting it costs nothing on a
    // box that did not need it and saves the failure on one that does.
    LaunchOptions: 'ENABLE_GAMESCOPE_WSI=0 %command%',
    IsHidden: 0,
    AllowDesktopConfig: 1,
    AllowOverlay: 1,
    OpenVR: 0,
    Devkit: 0,
    DevkitGameID: '',
    DevkitOverrideAppID: 0,
    LastPlayTime: 0,
    FlatpakAppID: '',
    tags: { 0: 'Wolf Pack' },
  };
}

// ── Discovering what Lutris actually has ────────────────────────────────────
// Asking a member to type a "Lutris game name" assumed they could find one.
// A real Deck (2026-08-26) had THREE entries — `projectquarm-…`,
// `everquest-1783136886` and `everquest-1787744830` — two of which share the
// `everquest` slug base, so `lutris:rungame/everquest` is ambiguous there and
// typing it is a coin flip between installs. So discover instead of ask.
//
// ⚠ PATHS ARE VERIFIED, not guessed — an earlier pass at this looked under
// `config/lutris/games` and found nothing, because Flatpak maps XDG_DATA_HOME
// to `.var/app/<id>/data/`, not `share/` or `config/`. Lutris keeps game YAML
// in XDG_DATA_HOME/lutris/games, so under Flatpak that is
// `~/.var/app/net.lutris.Lutris/data/lutris/games/`.
function lutrisGameDirs(home) {
  const p = require('path');
  return [
    p.join(home, '.var', 'app', 'net.lutris.Lutris', 'data', 'lutris', 'games'),
    p.join(home, '.local', 'share', 'lutris', 'games'),
  ];
}

// Lutris names each file `<slug>-<numeric id>.yml`, so the slug comes from the
// FILENAME and needs no YAML parser. The body is read with targeted regexes
// rather than a parser for the same reason the ini transforms are regex-level:
// we only ever read four keys, and a dependency-free Mimic is a hard rule.
function parseLutrisGameFile(filename, text) {
  const base = String(filename).replace(/\.yml$/i, '');
  const m = /^(.*)-(\d+)$/.exec(base);
  const slug = m ? m[1] : base;
  const src = String(text == null ? '' : text);
  const grab = (key) => {
    const r = new RegExp('^\\s*' + key + '\\s*:\\s*(.+?)\\s*$', 'm').exec(src);
    if (!r) return null;
    return r[1].replace(/^['"]|['"]$/g, '') || null;
  };
  return {
    slug,
    id: m ? m[2] : null,
    exe: grab('exe'),
    prefix: grab('prefix'),
    workingDir: grab('working_dir'),
    // The renderer switches, read from Lutris's own per-game config. These are
    // set PER GAME in Lutris, not by the installer script — which is what the
    // runbook spent weeks not knowing (RUNBOOK §5 link 3).
    //   d3d8: 'n,b' = native,builtin = load the game folder's dgVoodoo D3D8.dll.
    //   Absent => Wine uses its BUILTIN d3d8 and the wrapper sitting right
    //   there is never loaded, which breaks the chain at link 3.
    d3d8Override: grab('d3d8'),
    dxvk: grab('dxvk'),
    // eqgame.exe is the 1999 client; LaunchPad.exe is EverQuest LEGENDS, a
    // different modern game that also installs under the `everquest` slug.
    looksLikeQuarm: /eqgame\.exe\s*$/i.test(grab('exe') || ''),
    // The trap this surfaces: eqgame.exe resolves eqmain.dll by RELATIVE path,
    // so a launch with no working_dir fails exactly like the file is missing
    // ("Couldn't load eqmain.dll"). Flagged per game so the UI can say which
    // entry is misconfigured instead of the user guessing.
    missingWorkingDir: !grab('working_dir'),
  };
}

function discoverLutrisGames(home, fsLike) {
  const fsx = fsLike || require('fs');
  const p = require('path');
  const out = [];
  const seen = new Set();
  for (const dir of lutrisGameDirs(home)) {
    let names = [];
    try { if (!fsx.existsSync(dir)) continue; names = fsx.readdirSync(dir); }
    catch { continue; }
    for (const n of names) {
      if (!/\.yml$/i.test(n)) continue;
      let text = '';
      try { text = fsx.readFileSync(p.join(dir, n), 'utf8'); } catch { /* unreadable */ }
      const g = parseLutrisGameFile(n, text);
      const key = g.slug + '|' + (g.id || '');
      if (seen.has(key)) continue;      // same entry visible under both roots
      seen.add(key);
      out.push({ ...g, file: p.join(dir, n) });
    }
  }
  // Ambiguity is the thing worth surfacing: two entries sharing a slug means
  // `lutris:rungame/<slug>` picks one of them and the user cannot tell which.
  const bySlug = new Map();
  for (const g of out) bySlug.set(g.slug, (bySlug.get(g.slug) || 0) + 1);
  for (const g of out) {
    g.slugAmbiguous = (bySlug.get(g.slug) || 0) > 1;
    // Chain link 3: no d3d8 override means Wine's builtin wins and the
    // dgVoodoo wrapper in the game folder is dead weight. Measured on the
    // 2026-08-26 Deck: the Quarm entry had no `wine:` block at all, while the
    // OTHER entry on the same box carried `d3d8: n,b` — so this is the
    // difference between the install that runs and the one that does not.
    g.missingD3d8Override = g.looksLikeQuarm && !/^n/i.test(g.d3d8Override || '');
    // Chain link 4. dgVoodoo outputs D3D11; with DXVK off there is nothing
    // behind it, which is the "requires DirectX 6.0" signature.
    g.dxvkOff = g.looksLikeQuarm && /^false$/i.test(g.dxvk || '');
    // The exe lives outside the prefix Lutris configures for it. Legal in
    // Wine — an absolute exe path runs under any WINEPREFIX — but it means the
    // runner options (DLL overrides, DXVK) apply to a DIFFERENT folder than
    // the one the game sits in. Measured on the 2026-08-26 Deck:
    //   exe    /home/deck/Games/ProjectQuarm/eqgame.exe   (capital P)
    //   prefix /home/deck/Games/projectquarm              (lowercase p)
    // Linux filesystems are case-sensitive, so those are two prefixes. This is
    // the shape of every "I copied the DLLs in and nothing changed" hour: DXVK
    // has to be in the CONFIGURED prefix, not the one beside the exe.
    g.exeOutsidePrefix = !!(g.exe && g.prefix && !g.exe.startsWith(g.prefix.replace(/\/+$/, '') + '/'));
  }
  // A slug shared with a DIFFERENT GAME is worse than a shared slug: launching
  // it can start EverQuest Legends instead of Quarm.
  for (const g of out) {
    g.slugCollidesWithOtherGame = g.slugAmbiguous &&
      out.some(h => h.slug === g.slug && h.looksLikeQuarm !== g.looksLikeQuarm);
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug) || String(a.id).localeCompare(String(b.id)));
}

module.exports = {
  buildLaunchScript,
  lutrisGameDirs,
  parseLutrisGameFile,
  discoverLutrisGames,
  resolveEqLaunch,
  autofillPlan,
  steamShortcutFor,
  _shq,
};
