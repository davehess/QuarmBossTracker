#!/usr/bin/env bash
# deck-preflight.sh — read-only preflight for Project Quarm + Mimic on a Steam Deck.
#
# Run this BEFORE you play, and any time something breaks. It writes nothing,
# changes nothing, and is safe to run mid-raid.
#
#   bash scripts/deck-preflight.sh
#   bash scripts/deck-preflight.sh --verbose      # show every path it looked at
#
# It answers the questions that cost three hours on 2026-08-23:
#   - where are my EQ installs, in BOTH package managers' paths?
#   - is the required dgVoodoo pair (D3D8.dll + dgVoodoo.conf) intact in each?
#   - is DXVK actually present for the 32-bit client, or is Wine's stub d3d11
#     about to hand me "EverQuest requires DirectX 6.0 or higher"?
#   - is the 32-bit GL flatpak runtime installed?
#   - has the client stomped [VideoMode] back to 4:3 again?
#
# NOTE on the renderer files: the KNOWN-GOOD set (a copy of the working Windows
# desktop install, ~/Downloads/EQ) carries D3D8.dll + dgVoodoo.conf and NOTHING
# else — no D3D9.dll, no D3D8backup.dll/D3D9backup.dll. Both Deck installs have
# those extras; they came from the lutris.net installer, not from a working
# configuration. So this script FAILs only on the pair, and reports the rest as
# drift. Do not "fix" a missing D3D9.dll.
#
# Every FAIL prints its fix and a section reference into
# docs/RUNBOOK-deck-install.md. Exit 0 when nothing FAILed, 1 otherwise.

set -uo pipefail          # deliberately NOT -e: a failing check must not stop the run

# ── output ──────────────────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'; C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'
  C_PASS=$'\033[32m'; C_WARN=$'\033[33m'; C_FAIL=$'\033[31m'; C_INFO=$'\033[36m'
else
  C_RESET=''; C_DIM=''; C_BOLD=''; C_PASS=''; C_WARN=''; C_FAIL=''; C_INFO=''
fi

N_PASS=0; N_WARN=0; N_FAIL=0
VERBOSE=0
case "${1:-}" in --verbose|-v) VERBOSE=1 ;; esac

pass() { N_PASS=$((N_PASS + 1)); printf '%s  PASS%s  %s\n' "$C_PASS" "$C_RESET" "$1"; }
info() {                          printf '%s  INFO%s  %s\n' "$C_INFO" "$C_RESET" "$1"; }
warn() {
  N_WARN=$((N_WARN + 1))
  printf '%s  WARN%s  %s\n' "$C_WARN" "$C_RESET" "$1"
  [ $# -gt 1 ] && printf '        %sfix: %s%s\n' "$C_DIM" "$2" "$C_RESET"
  return 0
}
fail() {
  N_FAIL=$((N_FAIL + 1))
  printf '%s  FAIL%s  %s\n' "$C_FAIL" "$C_RESET" "$1"
  [ $# -gt 1 ] && printf '        %sfix: %s%s\n' "$C_DIM" "$2" "$C_RESET"
  return 0
}
head1() { printf '\n%s== %s ==%s\n' "$C_BOLD" "$1" "$C_RESET"; }
head2() { printf '\n%s-- %s%s\n' "$C_BOLD" "$1" "$C_RESET"; }
vecho() { [ "$VERBOSE" -eq 1 ] && printf '        %s%s%s\n' "$C_DIM" "$1" "$C_RESET"; return 0; }

RUNBOOK='docs/RUNBOOK-deck-install.md'
# Every path below hangs off HOME_DIR. Override it to inspect another account's
# install, or to point the checker at a test tree: DECK_PREFLIGHT_HOME=/path ...
HOME_DIR="${DECK_PREFLIGHT_HOME:-${HOME:-/home/deck}}"

# Case-insensitive lookup of a filename in a directory. Echoes the real path.
# Uses bash's ${var,,} rather than piping to tr: an EQ client folder holds
# thousands of files and this is called several times per install.
find_ci() {
  local dir="$1" target="${2,,}" f base
  [ -d "$dir" ] || return 1
  for f in "$dir"/*; do
    [ -e "$f" ] || continue
    base="${f##*/}"
    if [ "${base,,}" = "$target" ]; then printf '%s' "$f"; return 0; fi
  done
  return 1
}
has_ci() { find_ci "$1" "$2" >/dev/null 2>&1; }

# Is this DLL a DXVK build, or Wine's builtin? DXVK binaries carry the string.
is_dxvk_dll() {
  local f="$1"
  [ -f "$f" ] || return 1
  grep -aqi 'dxvk' -- "$f" 2>/dev/null
}

printf '%sProject Quarm / Mimic — Steam Deck preflight%s\n' "$C_BOLD" "$C_RESET"
printf '%sread-only · %s · see %s%s\n' "$C_DIM" "$(date '+%Y-%m-%d %H:%M')" "$RUNBOOK" "$C_RESET"

# ── 1. the box ──────────────────────────────────────────────────────────────
head1 "The box"

if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  OS_NAME="$(. /etc/os-release 2>/dev/null && printf '%s' "${PRETTY_NAME:-${NAME:-unknown}}")"
  info "OS: ${OS_NAME:-unknown}"
else
  info "OS: unknown (no /etc/os-release)"
fi

if pgrep -x gamescope >/dev/null 2>&1 && ! pgrep -x plasmashell >/dev/null 2>&1; then
  info "Session: Gaming Mode (gamescope) — Mimic will run in Background Mode; installs need Desktop Mode."
elif pgrep -x plasmashell >/dev/null 2>&1; then
  info "Session: Desktop Mode"
else
  info "Session: not a Deck session (or headless) — path checks still apply."
fi

if command -v vulkaninfo >/dev/null 2>&1; then
  VK_DEV="$(vulkaninfo --summary 2>/dev/null | grep -m1 -i 'deviceName' | sed 's/.*= *//')"
  if [ -n "$VK_DEV" ]; then
    pass "Vulkan device: $VK_DEV  (renderer chain link 4)"
  else
    warn "vulkaninfo present but reported no device" "on stock SteamOS this should never happen — check Mesa. $RUNBOOK §5 link 3"
  fi
else
  info "vulkaninfo not installed — cannot check link 4 (rarely the problem on SteamOS)."
fi

# ── 2. runners ──────────────────────────────────────────────────────────────
head1 "Runners (runbook §1–§2)"

LUTRIS_KIND=''
if command -v lutris >/dev/null 2>&1; then LUTRIS_KIND='native'; fi
if flatpak info net.lutris.Lutris >/dev/null 2>&1; then
  LUTRIS_KIND="${LUTRIS_KIND:+$LUTRIS_KIND + }flatpak"
fi
if [ -n "$LUTRIS_KIND" ]; then
  pass "Lutris installed ($LUTRIS_KIND)"
else
  fail "Lutris not found" "install it from Discover, then start it once to initialize. $RUNBOOK §1"
fi

if flatpak info net.davidotek.pupgui2 >/dev/null 2>&1 || command -v protonup-qt >/dev/null 2>&1; then
  pass "ProtonUp-Qt installed"
else
  warn "ProtonUp-Qt not found" "needed to install GE-Proton FOR Lutris; Lutris cannot fetch it itself. $RUNBOOK §1"
fi

# GE-Proton runners — both the flatpak-Lutris and native-Lutris locations.
GE_DIRS=(
  "$HOME_DIR/.var/app/net.lutris.Lutris/data/lutris/runners/wine"
  "$HOME_DIR/.local/share/lutris/runners/wine"
)
GE_FOUND=''
for d in "${GE_DIRS[@]}"; do
  [ -d "$d" ] || continue
  vecho "scanning runners: $d"
  for r in "$d"/*; do
    [ -d "$r" ] || continue
    GE_FOUND="${GE_FOUND}${r##*/}"$'\n'
  done
done
GE_FOUND="$(printf '%s' "$GE_FOUND" | sed '/^$/d')"

if [ -z "$GE_FOUND" ]; then
  warn "No Lutris wine runners found on disk" "ProtonUp-Qt → Install for: Lutris → Wine-GE → GE-Proton8-7, then GE-Proton8-26. $RUNBOOK §2"
else
  info "Lutris wine runners present:"
  printf '%s\n' "$GE_FOUND" | sed 's/^/          /'
  # The same build ships under two directory names depending on how it was
  # installed: ProtonUp-Qt writes "GE-Proton8-26", Lutris's own runner manager
  # writes "wine-ge-8-26-x86_64". A live Deck (2026-08-24) had the pin
  # installed as the latter and this check cried MISSING — match the version
  # digits, not one tool's spelling.
  for pin in 8-7 8-26; do
    if printf '%s\n' "$GE_FOUND" | grep -qiE -- "(ge-proton${pin}$|wine-ge-${pin}(-|$))"; then
      pass "pinned runner present (GE ${pin})"
    else
      warn "pinned runner MISSING: GE-Proton${pin} / wine-ge-${pin}" "the lutris.net Quarm script is written against the pins; 'Latest' is not a substitute. $RUNBOOK §2"
    fi
  done
fi

# ── 3. 32-bit GL runtime ────────────────────────────────────────────────────
head1 "32-bit GL runtime (runbook §1)"

if command -v flatpak >/dev/null 2>&1; then
  if flatpak list --runtime 2>/dev/null | grep -qi 'org\.freedesktop\.Platform\.GL32'; then
    pass "org.freedesktop.Platform.GL32 installed (EQ is a 32-bit client)"
  else
    fail "org.freedesktop.Platform.GL32 NOT installed" "flatpak install flathub org.freedesktop.Platform.GL32 — flatpak Lutris warns about a missing /usr/lib/i386-linux-gnu/GL amdgpu.ids without it. $RUNBOOK §1"
  fi
else
  info "flatpak not on PATH — skipping the GL32 runtime check."
fi

# ── 4. the known-good source copy ───────────────────────────────────────────
# ~/Downloads/EQ is a copy of the guild lead's WORKING WINDOWS DESKTOP install
# (verified 2026-08-23) — not a pristine Quarm download. It is the reference for
# "what does a working game folder contain", and the seed for a fresh install.
head1 "Known-good client source (runbook §3a)"

SRC_DIR="$HOME_DIR/Downloads/EQ"
SRC_HAS_PAIR=0
if [ -d "$SRC_DIR" ]; then
  pass "install / recovery source present: $SRC_DIR"
  if has_ci "$SRC_DIR" 'eqgame.exe'; then
    pass "  source holds eqgame.exe — seed a fresh install from it, no download needed"
  else
    # Maybe the client sits one level down, or it is a folder of zips.
    SUB="$(find "$SRC_DIR" -maxdepth 2 -iname 'eqgame.exe' -print -quit 2>/dev/null)"
    if [ -n "$SUB" ]; then
      pass "  source holds eqgame.exe at ${SUB%/*}"
      SRC_DIR="${SUB%/*}"
    else
      ZIPS="$(find "$SRC_DIR" -maxdepth 2 -iname '*.zip' 2>/dev/null | wc -l | tr -d ' ')"
      if [ "${ZIPS:-0}" -gt 0 ]; then
        info "  no extracted eqgame.exe, but $ZIPS zip(s) here — point the installer's file pickers at them."
      else
        warn "  source folder exists but holds neither eqgame.exe nor any zip" "confirm this is the known-good copy and not an empty leftover. $RUNBOOK §3a"
      fi
    fi
  fi

  # The renderer requirement, as proven by the machine that actually raids:
  # D3D8.dll + dgVoodoo.conf, and nothing else.
  S_D8=0; S_CF=0; S_D9=0; S_BK=0
  has_ci "$SRC_DIR" 'd3d8.dll'         && S_D8=1
  has_ci "$SRC_DIR" 'dgvoodoo.conf'    && S_CF=1
  has_ci "$SRC_DIR" 'eqmain.dll'       && SRC_HAS_EQMAIN=1
  has_ci "$SRC_DIR" 'd3d9.dll'         && S_D9=1
  has_ci "$SRC_DIR" 'd3d8backup.dll'   && S_BK=1
  has_ci "$SRC_DIR" 'd3d9backup.dll'   && S_BK=1

  if [ "$S_D8" -eq 1 ] && [ "$S_CF" -eq 1 ]; then
    SRC_HAS_PAIR=1
    pass "  renderer pair in source: D3D8.dll + dgVoodoo.conf — repair an install by copying these two"
  else
    warn "  source is missing part of the renderer pair (D3D8=$S_D8 conf=$S_CF)" "expected both, per the 2026-08-23 verification. Something changed. $RUNBOOK §3a"
  fi
  if [ "$S_D9" -eq 1 ] || [ "$S_BK" -eq 1 ]; then
    info "  source also has D3D9/backup DLLs (D3D9=$S_D9 backups=$S_BK) — NOT expected; the verified set had neither."
  else
    info "  source has no D3D9.dll and no *backup.dll — matches the verified known-good set."
  fi

  if has_ci "$SRC_DIR" 'zeal.asi'; then
    info "  Zeal.asi ships in the source — seeding from here carries Zeal across; §8b becomes a refresh, not an install."
  fi

  # It is a reference copy; it should not be accumulating session state.
  if find "$SRC_DIR" -maxdepth 1 -iname 'eqlog_*.txt' -print -quit 2>/dev/null | grep -q .; then
    warn "  source contains EQ LOG files — something has been played out of it" "keep the reference copy stable; do not launch or install into it. $RUNBOOK §3a"
  fi
else
  info "No source copy at $SRC_DIR — you will need the TAKP client + Quarm patch zips. $RUNBOOK §3b"
fi

# ── 5. find the EQ installs ─────────────────────────────────────────────────
head1 "EQ installs (runbook §4)"

# Candidate ROOTS to scan. Mirrors Mimic's _linuxDriveCRoots(), PLUS the
# prefix-root layout Mimic's detector misses (eqgame.exe beside drive_c).
SCAN_ROOTS=()
add_root() { [ -d "$1" ] && SCAN_ROOTS+=("$1"); return 0; }

# Bottles (flatpak) — one dir per bottle, EQ under drive_c
BOTTLES_BASE="$HOME_DIR/.var/app/com.usebottles.bottles/data/bottles/bottles"
if [ -d "$BOTTLES_BASE" ]; then
  for b in "$BOTTLES_BASE"/*; do add_root "$b/drive_c"; done
fi
# Lutris — ~/Games/<game>: BOTH the prefix root and its drive_c
if [ -d "$HOME_DIR/Games" ]; then
  for g in "$HOME_DIR/Games"/*; do
    add_root "$g"
    add_root "$g/drive_c"
  done
  add_root "$HOME_DIR/Games/drive_c"
fi
# Proton — steamapps/compatdata/<appid>/pfx/drive_c, both Steam layouts
for cd_base in "$HOME_DIR/.steam/steam/steamapps/compatdata" \
               "$HOME_DIR/.local/share/Steam/steamapps/compatdata"; do
  [ -d "$cd_base" ] || continue
  for a in "$cd_base"/*; do add_root "$a/pfx/drive_c"; done
done
# Plain wine prefixes
add_root "$HOME_DIR/.wine/drive_c"
# SD card / external mounts
for media in /run/media/deck /run/media/"${USER:-deck}"; do
  [ -d "$media" ] || continue
  for label in "$media"/*; do
    [ -d "$label" ] || continue
    add_root "$label/drive_c"
    if [ -d "$label/steamapps/compatdata" ]; then
      for a in "$label/steamapps/compatdata"/*; do add_root "$a/pfx/drive_c"; done
    fi
    if [ -d "$label/Games" ]; then
      for g in "$label/Games"/*; do add_root "$g"; add_root "$g/drive_c"; done
    fi
  done
done

if [ "${#SCAN_ROOTS[@]}" -eq 0 ]; then
  fail "No Wine/Proton prefix roots found at all" "install via the lutris.net Quarm script. $RUNBOOK §4"
fi

EQ_DIRS=()
for root in "${SCAN_ROOTS[@]}"; do
  vecho "scanning: $root"
  while IFS= read -r exe; do
    [ -n "$exe" ] || continue
    d="${exe%/*}"
    # de-dup, and never treat the pristine source as an install
    case " ${EQ_DIRS[*]-} " in *" $d "*) continue ;; esac
    [ "$d" = "$SRC_DIR" ] && continue
    EQ_DIRS+=("$d")
  done < <(find "$root" -maxdepth 4 -iname 'eqgame.exe' -type f 2>/dev/null)
done

if [ "${#EQ_DIRS[@]}" -eq 0 ]; then
  fail "No EQ install found (no eqgame.exe under any prefix)" "run the lutris.net Quarm installer. $RUNBOOK §4"
else
  pass "Found ${#EQ_DIRS[@]} EQ install(s)"
fi

# Which prefix does an EQ folder belong to? Walk up to the dir holding drive_c
# (or that IS drive_c's parent) so we can find that prefix's system DLLs.
prefix_of() {
  local d="$1"
  while [ "$d" != "/" ] && [ -n "$d" ]; do
    if [ -d "$d/drive_c" ]; then printf '%s' "$d"; return 0; fi
    d="${d%/*}"
  done
  return 1
}

# ── 6. per-install checks ───────────────────────────────────────────────────
# "${arr[@]-}" (not "${arr[@]}") so an empty array is safe under `set -u` on
# every bash, not just >= 4.4; the -n guard drops the resulting empty word.
for eqdir in "${EQ_DIRS[@]-}"; do
  [ -n "$eqdir" ] || continue
  head2 "$eqdir"

  case "$eqdir" in
    *"/com.usebottles.bottles/"*) info "manager: Bottles — NOT the destination; the Zeal bridge cannot reach a sandboxed wineserver. $RUNBOOK §6" ;;
    *"$HOME_DIR/Games/"*)         info "manager: Lutris" ;;
    *"compatdata"*)               info "manager: Steam Proton" ;;
    *)                            info "manager: unknown/manual" ;;
  esac

  PREFIX="$(prefix_of "$eqdir" || true)"
  if [ -n "$PREFIX" ]; then
    vecho "prefix: $PREFIX"
    # eqgame.exe at the prefix ROOT (beside drive_c) is the layout Mimic's
    # auto-detect misses — it starts scanning at drive_c.
    if [ "$eqdir" = "$PREFIX" ]; then
      # Auto-detect handles this layout since Mimic 2.6.1-linux.20 (prefix-root
      # scan + newest-log ranking). Informational now; the manual pick remains
      # the fallback for an older build.
      info "eqgame.exe sits at the PREFIX ROOT, beside drive_c — auto-detected by Mimic ≥2.6.1-linux.20; on older builds set the folder by hand in Mimic Settings ($RUNBOOK §4)"
    fi
  else
    info "could not resolve a Wine prefix above this folder (manual layout?)"
  fi

  # --- 6a. the renderer pair (chain links 1-2) ---
  # REQUIRED: D3D8.dll + dgVoodoo.conf. Everything else dgVoodoo-shaped in this
  # folder is installer drift — see the header note.
  T_D8=0; T_CF=0; T_D9=0; T_B8=0; T_B9=0
  has_ci "$eqdir" 'd3d8.dll'       && T_D8=1
  has_ci "$eqdir" 'dgvoodoo.conf'  && T_CF=1
  has_ci "$eqdir" 'd3d9.dll'       && T_D9=1
  has_ci "$eqdir" 'd3d8backup.dll' && T_B8=1
  has_ci "$eqdir" 'd3d9backup.dll' && T_B9=1

  if [ "$T_D8" -eq 1 ] && [ "$T_CF" -eq 1 ]; then
    pass "renderer pair intact: D3D8.dll + dgVoodoo.conf"
  else
    if [ "${SRC_HAS_PAIR:-0}" -eq 1 ]; then
      FIXSRC="Copy the missing file(s) from $SRC_DIR (the known-good set)."
    else
      FIXSRC="Re-run the lutris.net installer (dg_voodoo2_79_3.zip step)."
    fi
    if [ "$T_D8" -eq 0 ]; then
      fail "D3D8.dll MISSING — the dgVoodoo wrapper is not there" "this is the 'Failed to load the graphics DLL!' failure; EQGfx_Dx8.dll needs the wrapper. $FIXSRC $RUNBOOK §5 link 1"
    fi
    if [ "$T_CF" -eq 0 ]; then
      fail "dgVoodoo.conf MISSING" "the wrapper falls back to built-in defaults (watermark / wrong output API). $FIXSRC $RUNBOOK §5 link 2"
    fi
  fi

  # Drift, not requirement. Reported so nobody "repairs" it in either direction.
  DRIFT=''
  [ "$T_D9" -eq 1 ] && DRIFT="$DRIFT D3D9.dll"
  [ "$T_B8" -eq 1 ] && DRIFT="$DRIFT D3D8backup.dll"
  [ "$T_B9" -eq 1 ] && DRIFT="$DRIFT D3D9backup.dll"
  if [ -n "$DRIFT" ]; then
    info "installer drift present (not required, harmless, leave it):$DRIFT — tells you the lutris.net installer wrote here"
  else
    info "no D3D9/backup DLLs — matches the known-good desktop set exactly"
  fi

  # --- 6a2. the login DLL (chain link 5 — DOWNSTREAM of the renderer) ---
  # Signature: "ERROR: Couldn't load eqmain.dll" in a Fatal Error box, AFTER the
  # window opens and paints splash art. That ordering is the whole diagnosis: if
  # you got this far the renderer chain WORKED, so nothing in 6a/6b is at fault
  # and re-reading RUNBOOK §5 is wasted time (Deck, 2026-08-26).
  #
  # eqmain.dll is the login-screen module eqgame.exe loads once graphics are up.
  # The most likely cause on a fresh Lutris install is a zip that extracted into
  # a SUBFOLDER instead of merging into the game dir: eqgame.exe comes from the
  # client zip (flat, so the game launches) while the file it wants arrives from
  # another zip that nested. So look for a stray copy before declaring it gone —
  # "missing" and "one level down" need opposite fixes.
  if has_ci "$eqdir" 'eqmain.dll'; then
    pass "eqmain.dll present (login screen can load)"
  else
    NESTED=$(find "$eqdir" -maxdepth 3 -iname 'eqmain.dll' 2>/dev/null | head -n 3)
    if [ -n "$NESTED" ]; then
      fail "eqmain.dll is NOT in the game folder, but a copy exists deeper in the tree" \
        "a zip extracted into its own folder instead of merging. Move the contents of that folder up into $eqdir (overwriting), then relaunch. Found: $(echo $NESTED | tr '\n' ' '). $RUNBOOK §5 link 5"
    elif [ "${SRC_HAS_EQMAIN:-0}" -eq 1 ]; then
      fail "eqmain.dll MISSING — 'Couldn't load eqmain.dll' at launch" \
        "copy it from $SRC_DIR (the known-good set). This is NOT a renderer fault: the window opened, so D3D8/DXVK are fine. $RUNBOOK §5 link 5"
    else
      fail "eqmain.dll MISSING — 'Couldn't load eqmain.dll' at launch" \
        "re-extract the client and Quarm patch zips INTO the game folder (merge, do not create a subfolder). This is NOT a renderer fault: the window opened, so D3D8/DXVK are fine. $RUNBOOK §5 link 5"
    fi
  fi

  # A nested extract usually leaves the WHOLE payload one level down, not just
  # one file, so name the folder — moving its contents up is the single fix.
  STRAY=$(find "$eqdir" -maxdepth 2 -mindepth 2 -iname 'eqgame.exe' 2>/dev/null | head -n 1)
  if [ -n "$STRAY" ]; then
    warn "a SECOND eqgame.exe sits in a subfolder: $(dirname "$STRAY")" \
      "a zip extracted into its own folder instead of merging. Move that folder's contents up into $eqdir (overwriting), then delete the empty folder. $RUNBOOK §5 link 5"
  fi

  # --- 6b. DXVK (renderer chain link 4) — 32-bit is the one that matters ---
  if [ -n "$PREFIX" ]; then
    SYS32="$PREFIX/drive_c/windows/system32/d3d11.dll"
    WOW64="$PREFIX/drive_c/windows/syswow64/d3d11.dll"
    DXVK32=''; DXVK64=''

    # A 32-bit-only prefix has no syswow64: system32 IS the 32-bit tree.
    if [ -d "$PREFIX/drive_c/windows/syswow64" ]; then
      is_dxvk_dll "$WOW64" && DXVK32=1
      is_dxvk_dll "$SYS32" && DXVK64=1
      D32_PATH="$WOW64"
    else
      is_dxvk_dll "$SYS32" && DXVK32=1
      D32_PATH="$SYS32"
    fi

    if [ -n "$DXVK32" ]; then
      pass "DXVK present for the 32-bit client ($D32_PATH)"
    elif [ -f "$D32_PATH" ]; then
      fail "32-bit d3d11.dll is NOT DXVK (Wine builtin stub)" "this is the 'EverQuest requires DirectX 6.0 or higher' failure. Enable DXVK for THIS GAME/SHORTCUT, not just the runner default — a per-program override silently wins. $RUNBOOK §5 link 3 + §6 trap 1"
    else
      fail "no 32-bit d3d11.dll in the prefix at all" "DXVK was never installed into this prefix. Lutris → Configure → Runner options → enable DXVK. $RUNBOOK §5 link 3"
    fi

    if [ -d "$PREFIX/drive_c/windows/syswow64" ]; then
      if [ -n "$DXVK64" ]; then
        info "64-bit DXVK also present (not used by EQ, but a sign the prefix is fully set up)"
      else
        info "64-bit d3d11.dll is builtin — harmless, EQ is 32-bit"
      fi
    fi

    for dxgi in "$PREFIX/drive_c/windows/syswow64/dxgi.dll" "$PREFIX/drive_c/windows/system32/dxgi.dll"; do
      [ -f "$dxgi" ] || continue
      if is_dxvk_dll "$dxgi"; then
        vecho "DXVK dxgi: $dxgi"
      else
        warn "dxgi.dll is builtin at $dxgi" "DXVK ships d3d11 AND dxgi together; a mismatched pair produces the same DirectX-6 error. $RUNBOOK §5 link 3"
      fi
    done
  else
    warn "cannot check DXVK — no prefix resolved for this install" "if this is a hand-made layout, verify DXVK by hand. $RUNBOOK §5 link 3"
  fi

  # --- 6c. eqclient.ini: logging + [VideoMode] ---
  INI="$(find_ci "$eqdir" 'eqclient.ini' || true)"
  if [ -z "$INI" ]; then
    warn "no eqclient.ini yet" "normal for a never-launched install; it appears on first run. $RUNBOOK §7b"
  else
    W="$(grep -i -m1 '^[[:space:]]*Width[[:space:]]*=' "$INI" 2>/dev/null | tr -d '\r' | sed 's/.*=[[:space:]]*//')"
    H="$(grep -i -m1 '^[[:space:]]*Height[[:space:]]*=' "$INI" 2>/dev/null | tr -d '\r' | sed 's/.*=[[:space:]]*//')"
    if [ -z "$W" ] || [ -z "$H" ]; then
      warn "[VideoMode] Width/Height not set in eqclient.ini" "set Width=1280 Height=800 (native) or Width=1440 Height=900 (Quarm.Guide default). $RUNBOOK §7b"
    else
      case "${W}x${H}" in
        1280x800) pass "[VideoMode] ${W}x${H} — Deck native" ;;
        1440x900) pass "[VideoMode] ${W}x${H} — Quarm.Guide Deck default (supersampled)" ;;
        *)
          RATIO_NOTE=''
          if [ "${W:-0}" -gt 0 ] 2>/dev/null && [ "${H:-0}" -gt 0 ] 2>/dev/null; then
            # 4:3 within rounding => the client stomped it on exit.
            if [ $(( W * 3 )) -eq $(( H * 4 )) ]; then RATIO_NOTE=' (4:3 — this is the on-exit stomp)'; fi
          fi
          fail "[VideoMode] ${W}x${H} is not a Deck target${RATIO_NOTE}" "set Width=1280 Height=800 or Width=1440 Height=900. The client rewrites this to 4:3 on exit — re-check after every session until the enforcement work lands. $RUNBOOK §7b"
          ;;
      esac
    fi

    if grep -qi '^[[:space:]]*Log[A-Za-z]*[[:space:]]*=[[:space:]]*\(TRUE\|1\|on\)' "$INI" 2>/dev/null; then
      pass "in-game logging appears enabled in eqclient.ini"
    else
      warn "could not confirm logging is on in eqclient.ini" "type /log on in game — without logs Mimic has no parses, no chat relay, no callouts. $RUNBOOK §7b"
    fi

    if grep -qi '^[[:space:]]*UISkin[[:space:]]*=' "$INI" 2>/dev/null; then
      SKIN="$(grep -i -m1 '^[[:space:]]*UISkin[[:space:]]*=' "$INI" | tr -d '\r' | sed 's/.*=[[:space:]]*//')"
      if [ "${SKIN,,}" = "default" ]; then
        info "UISkin=$SKIN (stock)"
      else
        info "UISkin=$SKIN — a non-Zeal-compatible skin crashes at character select or on /loadskin; set UISkin=Default to recover"
      fi
    fi
  fi

  # --- 6d. logs, Zeal, bridge (informational) ---
  LOGN="$(find "$eqdir" -maxdepth 1 -iname 'eqlog_*.txt' 2>/dev/null | wc -l | tr -d ' ')"
  if [ "${LOGN:-0}" -gt 0 ]; then
    pass "$LOGN EQ log file(s) present — Mimic has something to tail"
  else
    warn "no eqlog_*.txt in this folder" "log in once with /log on. Until then Mimic will say it found EQ but no logs. $RUNBOOK §7b"
  fi

  if has_ci "$eqdir" 'zeal.asi'; then
    info "Zeal.asi installed"
  else
    info "Zeal not installed — install it LAST, via Mimic Settings → Zeal, and only after a clean login. $RUNBOOK §8b"
  fi

  if has_ci "$eqdir" 'outflow.exe'; then
    info "outflow.exe present (Zeal pipe bridge, Phase 2 — still experimental)"
  fi
done

# ── 7. the two traps, best-effort from config files ─────────────────────────
head1 "Trap check: per-program DXVK override + working directory (runbook §6)"
info "Config-file schemas are not verified from a cloud session — these are WARN-only hints."
info "The DLL inspection above is the ground truth; a settings screen can disagree with reality."

LUTRIS_GAME_CFGS=(
  "$HOME_DIR/.var/app/net.lutris.Lutris/config/lutris/games"
  "$HOME_DIR/.config/lutris/games"
)
FOUND_CFG=0
for cfgdir in "${LUTRIS_GAME_CFGS[@]}"; do
  [ -d "$cfgdir" ] || continue
  for y in "$cfgdir"/*.yml "$cfgdir"/*.yaml; do
    [ -f "$y" ] || continue
    grep -qi 'everquest\|quarm\|eqgame' "$y" 2>/dev/null || continue
    FOUND_CFG=1
    head2 "lutris config: ${y##*/}"
    if grep -qiE '^[[:space:]]*dxvk:[[:space:]]*(false|no|off|0)' "$y"; then
      fail "Lutris game config has DXVK explicitly DISABLED" "Configure → Runner options → enable DXVK for THIS game. $RUNBOOK §6 trap 1"
    elif grep -qiE '^[[:space:]]*dxvk:[[:space:]]*(true|yes|on|1)' "$y"; then
      pass "Lutris game config: dxvk enabled"
    else
      info "no explicit dxvk: key — inherits the runner default (which the per-game setting can override elsewhere)"
    fi
    if grep -qiE '^[[:space:]]*(working_dir|prefix_command_dir):' "$y"; then
      WD="$(grep -iE -m1 '^[[:space:]]*working_dir:' "$y" | sed 's/.*:[[:space:]]*//' | tr -d '"'"'")"
      if [ -n "$WD" ]; then pass "working directory set: $WD"; fi
    else
      warn "no working_dir in this Lutris config" "an empty working directory makes eqgame paint the splash and hang — assets load by relative path. Set it to the folder holding eqgame.exe. $RUNBOOK §6 trap 2"
    fi
  done
done

if [ -d "$BOTTLES_BASE" ]; then
  for b in "$BOTTLES_BASE"/*; do
    [ -f "$b/bottle.yml" ] || continue
    FOUND_CFG=1
    head2 "bottles config: ${b##*/}/bottle.yml"
    warn "Bottles install detected" "Bottles is not the destination — its sandboxed wineserver blocks the Zeal pipe bridge. Migrate to Lutris + GE-Proton. $RUNBOOK §6"
    if grep -qiE 'dxvk:[[:space:]]*(false|no|off)' "$b/bottle.yml"; then
      warn "bottle.yml mentions DXVK disabled somewhere" "check the PROGRAM's Preferences → Overrides, not just the bottle's — the per-program setting wins. $RUNBOOK §6 trap 1"
    fi
    if grep -qiE '^[[:space:]]*folder:[[:space:]]*(""|''|)$' "$b/bottle.yml"; then
      warn "a program entry appears to have an EMPTY working directory" "splash-then-hang. Set it to the folder holding eqgame.exe. $RUNBOOK §6 trap 2"
    fi
  done
fi

[ "$FOUND_CFG" -eq 0 ] && info "No Lutris/Bottles game config files matched — nothing to inspect here."

# ── 8. Mimic ────────────────────────────────────────────────────────────────
head1 "Mimic (runbook §8)"

MIMIC_APPIMG="$(find "$HOME_DIR/Applications" "$HOME_DIR/Downloads" "$HOME_DIR/Desktop" \
  -maxdepth 1 -iname 'Wolf-Pack-Mimic-*.AppImage' 2>/dev/null | head -n1)"
if [ -n "$MIMIC_APPIMG" ]; then
  pass "Mimic AppImage: $MIMIC_APPIMG"
  [ -x "$MIMIC_APPIMG" ] || warn "AppImage is not executable" "chmod +x '$MIMIC_APPIMG'"
else
  info "No Mimic AppImage found in ~/Applications, ~/Downloads or ~/Desktop. $RUNBOOK §8a"
fi

if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 2 http://localhost:7779/ >/dev/null 2>&1; then
  pass "Mimic dashboard responding on http://localhost:7779"
else
  info "Mimic dashboard not responding on :7779 (not running, or not started yet)."
fi

# ── summary ─────────────────────────────────────────────────────────────────
printf '\n%s== Summary ==%s\n' "$C_BOLD" "$C_RESET"
printf '  %s%d PASS%s   %s%d WARN%s   %s%d FAIL%s\n' \
  "$C_PASS" "$N_PASS" "$C_RESET" "$C_WARN" "$N_WARN" "$C_RESET" "$C_FAIL" "$N_FAIL" "$C_RESET"

if [ "$N_FAIL" -gt 0 ]; then
  printf '\n  Fix the FAILs above in order. The renderer chain (%s §5) is the one\n' "$RUNBOOK"
  printf '  that produces misleading error messages — debug it from the signature,\n'
  printf '  never from a guess.\n'
  exit 1
fi

printf '\n  Nothing failed. If the game still misbehaves, match the exact error string\n'
printf '  against the failure-signature index in %s §11.\n' "$RUNBOOK"
exit 0
