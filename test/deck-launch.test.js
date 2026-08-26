// Steam Deck (#156): the one-shortcut launcher that starts Mimic + EverQuest.
//
// The script this module emits runs unattended on someone's Deck at raid time,
// with their EQ password on the box. The tests below are almost entirely about
// the ways that can go wrong rather than the happy path, because the happy path
// announces itself and the failures do not:
//
//   - a password that reaches an ARGV is readable by every user on the machine
//     via /proc/<pid>/cmdline and `ps aux`;
//   - keystrokes typed while EQ does not own focus land in whatever does — a
//     Discord box, a browser — so the password leaks by being *typed*;
//   - waiting on the Lutris launch pid rather than polling for eqgame.exe makes
//     Steam think the game closed two seconds after Play;
//   - an empty working directory hangs eqgame.exe after the splash with no
//     error at all (RUNBOOK-deck-install §6, trap 2).
//
// Run: npx vitest run test/deck-launch.test.js

import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { ROOT } from './_source-slice.js';

const require_ = createRequire(import.meta.url);
const D = require_(path.join(ROOT, 'apps', 'mimic', 'deckLaunch.js'));

const BASE = {
  mimicAppImage: '/home/deck/Applications/Wolf-Pack-Mimic-2.6.1-linux-x86_64.AppImage',
  credFile: '/home/deck/.config/wolfpack/eq.cred',
  logFile: '/home/deck/.local/state/wolfpack/launch.log',
};
const lutris = (over = {}) => D.buildLaunchScript({
  ...BASE,
  launch: D.resolveEqLaunch({ deckLaunch: { lutrisSlug: 'everquest' } }),
  autofill: D.autofillPlan({ deckLaunch: { autofill: { enabled: true, username: 'hitya' } } }),
  ...over,
});

describe('shell quoting', () => {
  it("survives a path containing a single quote", () => {
    // /home/deck/Bob's EQ would otherwise close our quoting and run as code.
    expect(D._shq("/home/deck/Bob's EQ")).toBe(`'/home/deck/Bob'\\''s EQ'`);
  });

  it('quotes every interpolated path in the emitted script', () => {
    const s = D.buildLaunchScript({
      ...BASE,
      mimicAppImage: "/home/deck/Bob's Mimic.AppImage",
      launch: D.resolveEqLaunch({
        deckLaunch: { eqDir: "/home/deck/Bob's EQ", winePrefix: '/home/deck/Games/eq' },
      }),
      autofill: { enabled: false, steps: [] },
    });
    expect(s).toContain(`'/home/deck/Bob'\\''s Mimic.AppImage'`);
    expect(s).toContain(`'/home/deck/Bob'\\''s EQ'`);
  });
});

describe('the password never becomes an argv', () => {
  // The whole reason the secret lives in a file: argv is world-readable.
  it('types the password from stdin via --file -, never as an argument', () => {
    const s = lutris();
    expect(s).toContain('xdotool type --clearmodifiers --delay 40 --file - < "$CREDFILE"');
  });

  it('never interpolates a password value into the script at all', () => {
    const s = D.buildLaunchScript({
      ...BASE,
      launch: D.resolveEqLaunch({ deckLaunch: { lutrisSlug: 'everquest' } }),
      autofill: D.autofillPlan({
        deckLaunch: { autofill: { enabled: true, username: 'hitya', password: 'hunter2' } },
      }),
    });
    // Even when a caller wrongly hands us a plaintext password, it must not
    // reach the generated file — the script only ever reads $CREDFILE.
    expect(s).not.toContain('hunter2');
  });

  it('does not echo the credential file through a shell variable', () => {
    const s = lutris();
    // `PASSWORD=$(cat ...)` would put it in the environment of every child.
    expect(s).not.toMatch(/PASS\w*=\$\(/);
  });
});

describe('autofill focus safety', () => {
  it('re-checks focus before the username, password, and Return', () => {
    const s = lutris();
    // One guard per typed step; losing autofill is free, leaking is not.
    const guards = s.match(/if ! focused;/g) || [];
    expect(guards.length).toBeGreaterThanOrEqual(4);
  });

  it('targets a discovered window id rather than typing blind', () => {
    const s = lutris();
    expect(s).toContain('xdotool search --name "EverQuest"');
    expect(s).toContain('xdotool getwindowfocus');
  });

  it('skips autofill entirely when there is no DISPLAY (gamescope)', () => {
    const s = lutris();
    expect(s).toContain('[ -n "${DISPLAY:-}" ]');
    expect(s).toContain('Gaming Mode/gamescope');
  });

  it('emits no autofill block at all when it is disabled', () => {
    const s = lutris({ autofill: { enabled: false, steps: [] } });
    expect(s).not.toContain('xdotool');
    expect(s).not.toContain('CREDFILE');
  });

  it('emits no autofill block when enabled but no credential file exists', () => {
    const s = lutris({ credFile: '' });
    expect(s).not.toContain('xdotool');
  });
});

describe('waiting for the game', () => {
  it('polls for eqgame.exe instead of waiting on the launch pid', () => {
    // `lutris lutris:rungame/...` exits immediately; waiting on it would make
    // Steam show the session ending seconds after it began.
    const s = lutris();
    expect(s).toContain('pgrep -f "eqgame\\.exe"');
    expect(s).not.toMatch(/\bwait \$!/);
  });

  it('holds the script open while eqgame.exe lives', () => {
    const s = lutris();
    expect(s).toContain('while pgrep -f "eqgame\\.exe" >/dev/null 2>&1; do sleep 5; done');
  });
});

describe('EQ launch strategy', () => {
  it('prefers Lutris, which carries the DXVK + DLL-override config', () => {
    const r = D.resolveEqLaunch({ deckLaunch: { lutrisSlug: 'everquest', eqDir: '/x', winePrefix: '/y' } });
    expect(r.mode).toBe('lutris');
  });

  it('falls back to direct Wine only with BOTH an EQ folder and a prefix', () => {
    expect(D.resolveEqLaunch({ deckLaunch: { eqDir: '/x', winePrefix: '/y' } }).mode).toBe('wine');
    // A prefix we guessed wrong silently creates a second, empty install.
    expect(D.resolveEqLaunch({ deckLaunch: { eqDir: '/x' } }).mode).toBe('none');
    expect(D.resolveEqLaunch({ deckLaunch: { winePrefix: '/y' } }).mode).toBe('none');
  });

  it('cds into the EQ folder before running the exe (the splash-hang trap)', () => {
    const s = D.buildLaunchScript({
      ...BASE,
      launch: D.resolveEqLaunch({ deckLaunch: { eqDir: '/home/deck/Games/eq', winePrefix: '/p' } }),
      autofill: { enabled: false, steps: [] },
    });
    expect(s).toContain('cd "$EQDIR" ||');
    const runAt = s.indexOf('eqgame.exe" patchme');
    expect(runAt).toBeGreaterThan(-1);          // guard: the launch line exists
    expect(s.indexOf('cd "$EQDIR"')).toBeLessThan(runAt);
  });

  it('handles both native and flatpak Lutris', () => {
    const s = lutris();
    expect(s).toContain('command -v lutris');
    expect(s).toContain('flatpak run net.lutris.Lutris');
  });

  it('exits non-zero when nothing is configured', () => {
    const s = D.buildLaunchScript({ ...BASE, launch: D.resolveEqLaunch({}), autofill: { enabled: false, steps: [] } });
    expect(s).toContain('ERROR: no EQ launch configured');
    expect(s).toContain('exit 1');
  });
});

describe('Mimic lifecycle', () => {
  it('does not start a second Mimic when one is already running', () => {
    expect(lutris()).toContain('if pgrep -f "Wolf-Pack-Mimic.*AppImage"');
  });

  it('only stops Mimic when the script was the one that started it', () => {
    // Killing a Mimic the user already had open could interrupt a backfill.
    const s = lutris();
    expect(s).toContain('if [ "$MIMIC_STARTED" = "1" ]; then');
    expect(s.indexOf('MIMIC_STARTED" = "1"')).toBeLessThan(s.indexOf('pkill -f "Wolf-Pack-Mimic'));
  });

  it('leaves Mimic running when asked to', () => {
    const s = lutris({ stopMimicOnExit: false });
    expect(s).not.toContain('pkill');
    expect(s).toContain('leaving Mimic running');
  });

  it('detaches Mimic so a Steam stop-signal cannot kill it mid-write', () => {
    expect(lutris()).toContain('setsid "$MIMIC"');
  });

  it('continues without Mimic rather than aborting the raid launch', () => {
    const s = lutris();
    expect(s).toContain('continuing without it');
  });
});

describe('preflight is advisory', () => {
  it('never blocks the launch on a preflight failure', () => {
    const s = lutris({ preflightScript: '/home/deck/wolfpack/deck-preflight.sh' });
    expect(s).toContain('|| say "preflight reported problems (continuing)"');
  });

  it('is omitted when no preflight script is configured', () => {
    expect(lutris()).not.toContain('preflight');
  });
});

describe('autofillPlan', () => {
  it('orders the fields the way EQ\'s login screen expects', () => {
    // username → Tab → password → Return. Reversed, the password is typed
    // into the visible username box.
    const p = D.autofillPlan({ deckLaunch: { autofill: { enabled: true, username: 'x' } } });
    expect(p.steps).toEqual(['username', 'tab', 'password', 'return']);
  });

  it('refuses to arm without a username', () => {
    const p = D.autofillPlan({ deckLaunch: { autofill: { enabled: true } } });
    expect(p.enabled).toBe(false);
    expect(p.error).toMatch(/username/);
  });

  it('is off unless explicitly enabled', () => {
    expect(D.autofillPlan({}).enabled).toBe(false);
    expect(D.autofillPlan({ deckLaunch: { autofill: { username: 'x' } } }).enabled).toBe(false);
  });

  it('clamps the window-wait to a sane range', () => {
    const mk = (waitSecs) =>
      D.autofillPlan({ deckLaunch: { autofill: { enabled: true, username: 'x', waitSecs } } }).waitSecs;
    expect(mk(1)).toBe(5);
    expect(mk(99999)).toBe(600);
    expect(mk(45)).toBe(45);
  });
});

describe('the Steam shortcut', () => {
  it('keeps the exact AppName the community controller layouts key off', () => {
    // RUNBOOK §9 step 3 — renaming this loses the layout suggestions.
    expect(D.steamShortcutFor({ scriptPath: '/x/go.sh' }).AppName).toBe('Everquest Quarm');
  });

  it('pre-sets the documented gamescope workaround', () => {
    expect(D.steamShortcutFor({ scriptPath: '/x/go.sh' }).LaunchOptions)
      .toContain('ENABLE_GAMESCOPE_WSI=0');
  });

  it('quotes Exe and defaults StartDir to the script directory', () => {
    const s = D.steamShortcutFor({ scriptPath: '/home/deck/wolfpack/go.sh' });
    expect(s.Exe).toBe('"/home/deck/wolfpack/go.sh"');
    expect(s.StartDir).toBe('"/home/deck/wolfpack"');
  });
});

describe('script hygiene', () => {
  it('is a bash script with a shebang', () => {
    expect(lutris().startsWith('#!/usr/bin/env bash\n')).toBe(true);
  });

  it('says it is generated so nobody hand-edits it', () => {
    expect(lutris()).toContain('GENERATED by Mimic');
  });

  it('rotates its log rather than growing one forever on an SD card', () => {
    expect(lutris()).toContain('mv -f "$LOGFILE" "$LOGFILE.1"');
  });
});

// ── Lutris discovery ────────────────────────────────────────────────────────
// Asking a member to type a "Lutris game name" assumed they could find one. A
// real Deck (2026-08-26) had THREE entries — projectquarm-1785095494,
// everquest-1783136886 and everquest-1787744830 — two sharing the `everquest`
// slug, which makes `lutris:rungame/everquest` a coin flip between installs.
// These tests are built from that box's actual filenames.
describe('discoverLutrisGames', () => {
  const FLAT = '/home/deck/.var/app/net.lutris.Lutris/data/lutris/games';
  const NATIVE = '/home/deck/.local/share/lutris/games';
  const mkFs = (tree) => ({
    existsSync: (p) => Object.prototype.hasOwnProperty.call(tree, p),
    readdirSync: (p) => Object.keys(tree[p] || {}),
    readFileSync: (p) => {
      const dir = p.slice(0, p.lastIndexOf('/'));
      const f = p.slice(p.lastIndexOf('/') + 1);
      return tree[dir][f];
    },
  });
  const yml = (dir) => `game:\n  exe: ${dir}/eqgame.exe\n  prefix: ${dir}\n  working_dir: ${dir}\n`;

  it('looks in the FLATPAK data dir, not config/ or share/', () => {
    // The earlier attempt used config/lutris/games and silently found nothing,
    // because Flatpak maps XDG_DATA_HOME to .var/app/<id>/data/.
    const dirs = D.lutrisGameDirs('/home/deck');
    expect(dirs[0]).toBe(FLAT);
    // The FLATPAK root specifically must be data/, not config/ or share/.
    // (The NATIVE root below is legitimately ~/.local/share/lutris/games —
    // asserting "no /share/ anywhere" was my own sloppy first draft.)
    expect(dirs[0]).toContain('/data/lutris/games');
    expect(dirs[0]).not.toContain('/config/');
    expect(dirs[0]).not.toContain('/share/');
    expect(dirs[1]).toBe(NATIVE);
  });

  it('finds all three of the real Deck entries and takes the slug from the filename', () => {
    const F = mkFs({ [FLAT]: {
      'projectquarm-1785095494.yml': yml('/home/deck/Games/ProjectQuarm'),
      'everquest-1783136886.yml':    yml('/home/deck/Games/eq-old'),
      'everquest-1787744830.yml':    yml('/home/deck/Games/lutrisquarm'),
    } });
    const games = D.discoverLutrisGames('/home/deck', F);
    expect(games).toHaveLength(3);
    expect(games.map(g => g.slug).sort()).toEqual(['everquest', 'everquest', 'projectquarm']);
    expect(games.find(g => g.id === '1787744830').prefix).toBe('/home/deck/Games/lutrisquarm');
  });

  it('flags a slug shared by two entries as ambiguous', () => {
    // This is the whole reason discovery exists: lutris:rungame/everquest
    // cannot say WHICH everquest, so the UI has to.
    const F = mkFs({ [FLAT]: {
      'everquest-1783136886.yml': yml('/a'),
      'everquest-1787744830.yml': yml('/b'),
      'projectquarm-1785095494.yml': yml('/c'),
    } });
    const games = D.discoverLutrisGames('/home/deck', F);
    expect(games.filter(g => g.slug === 'everquest').every(g => g.slugAmbiguous)).toBe(true);
    expect(games.find(g => g.slug === 'projectquarm').slugAmbiguous).toBe(false);
  });

  it('flags an entry with no working_dir — the eqmain.dll trap', () => {
    // eqgame.exe resolves eqmain.dll by RELATIVE path, so a missing working_dir
    // fails identically to the file being absent ("Couldn't load eqmain.dll").
    const F = mkFs({ [FLAT]: {
      'projectquarm-1.yml': 'game:\n  exe: /x/eqgame.exe\n  prefix: /x\n',
      'everquest-2.yml':    yml('/y'),
    } });
    const games = D.discoverLutrisGames('/home/deck', F);
    expect(games.find(g => g.slug === 'projectquarm').missingWorkingDir).toBe(true);
    expect(games.find(g => g.slug === 'everquest').missingWorkingDir).toBe(false);
  });

  it('de-dupes an entry visible under both roots', () => {
    const F = mkFs({
      [FLAT]:   { 'everquest-1787744830.yml': yml('/a') },
      [NATIVE]: { 'everquest-1787744830.yml': yml('/a') },
    });
    expect(D.discoverLutrisGames('/home/deck', F)).toHaveLength(1);
  });

  it('returns [] rather than throwing when Lutris is absent', () => {
    expect(D.discoverLutrisGames('/home/deck', mkFs({}))).toEqual([]);
  });

  it('survives an unreadable or malformed yml', () => {
    const F = mkFs({ [FLAT]: { 'everquest-1.yml': 'not: [valid', 'notes.txt': 'x' } });
    const games = D.discoverLutrisGames('/home/deck', F);
    expect(games).toHaveLength(1);            // .txt ignored, bad yml kept
    expect(games[0].exe).toBeNull();
  });
});
