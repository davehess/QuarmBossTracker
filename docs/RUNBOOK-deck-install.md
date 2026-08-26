# RUNBOOK — Project Quarm + Mimic on a Steam Deck, start to raid

**Target: 20 minutes.** The first one took ~3 hours (Hitya, live on a Deck,
2026-08-23) and almost all of that was spent guessing at a graphics failure that
has exactly two possible causes, each with its own error string. This runbook
exists so the next install reads the error, looks it up in §4, and fixes it —
instead of rediscovering the renderer chain.

Read in order. Every stage ends with a **verify** step; do not carry a broken
stage forward, because a failure at stage *n* shows up as a confusing symptom at
stage *n+2*.

- Canonical upstream recipe: **quarm.guide → Linux and Steam Deck install guide**
  (source of truth: `github.com/LordDemonos/Quarm.Guide`,
  `_posts/2024-09-13-linux-and-steam-deck-install-guide.md`). Everything in
  stages 0–3 below is that guide, quoted with the version pins intact. Where this
  runbook and the guide disagree, the guide wins for *EQ*; this runbook wins for
  *Mimic and Zeal*, which the guide predates.
- Companion docs: `docs/mimic-steamdeck.md` (what Mimic does on Linux),
  `docs/mimic-steamdeck-zeal-bridge.md` (live overlays — still Phase 2).
- Before you play, and any time something breaks: **`bash scripts/deck-preflight.sh`**
  (§10). Read-only, safe to run at any moment, prints PASS/FAIL + the fix.

---

## 0. Before you start

**Time budget:** prereqs 5 min · client files 0–20 min · install 5 min · verify +
Mimic 5 min. The client download dominates — **and on this Deck it is already
done**: a pristine copy sits at `/home/deck/Downloads/EQ/` (§3a). Check there
first; that is the difference between a 20-minute install and an hour.

**You supply the client yourself.** The copyrighted TAKP/EQMac client is never
guild-hosted. Everything else (patch files, dgVoodoo, Zeal, UI) is freely shared.

**What you do NOT need to download any more** — Mimic installs both, one click,
and keeps them current (`docs/mimic-steamdeck-zeal-bridge.md`, built 2026-07-26):
- Zeal (`Zeal.asi` + `uifiles/`) → Mimic Settings → **Zeal** → Install
- Zeal-compatible custom UI packs → Mimic Settings → **Custom UI packs**

Skipping those two downloads also skips the worst part of the manual guide:
dragging folders around a hidden Wine path with a trackpad.

**Deck-specific:** all of stages 0–7 happen in **Desktop Mode**
(Steam button → Power → Switch to Desktop).

---

## 1. Stage 1 — Prerequisites

From the **Discover** store:

| Package | Why |
|---|---|
| **Lutris** | the runner. **Start it once** after installing so it initializes its config dirs. |
| **ProtonUp-Qt** | installs GE-Proton *for Lutris* (Lutris cannot fetch GE-Proton itself). |

Flatpak itself is already present on SteamOS.

> ⚠ **Flatpak Lutris needs the 32-bit GL runtime.** EQ is a 32-bit client. On the
> 2026-08-23 Deck, flatpak Lutris warned that `/usr/lib/i386-linux-gnu/GL` had no
> `amdgpu.ids`. Verify `org.freedesktop.Platform.GL32` is installed for the same
> runtime version Lutris uses — `scripts/deck-preflight.sh` checks this. If it is
> missing: `flatpak install flathub org.freedesktop.Platform.GL32`.

**Verify:** Lutris opens and shows an empty library. ProtonUp-Qt opens.

---

## 2. Stage 2 — GE-Proton, PINNED (not "Latest")

The lutris.net installer script for Quarm is written against **specific**
GE-Proton builds. Installing only the newest one is the single most common way
to have the installer fail halfway with an unhelpful message.

In ProtonUp-Qt:

1. `Install for:` → **Lutris**
2. **Add Version**
3. `Compatibility Tool:` → **Wine-GE**
4. `Version:` → **`GE-Proton8-7`** → Install
5. Repeat for **`GE-Proton8-26`**

Both. The guide's own note on the second one is *"I have no idea why this is
required, but Quarm won't install without it"* — treat that as load-bearing
folklore, not an optional extra.

> **Do not select "Latest".** Pinning is the whole point of this stage. A newer
> GE-Proton may well work at *runtime*; the pins are about the *installer script*
> completing. If you deliberately move off the pins later, write down which
> version you moved to — that is the first thing anyone debugging your box will
> ask.

**Verify:** ProtonUp-Qt lists both `GE-Proton8-7` and `GE-Proton8-26` under
Lutris. `scripts/deck-preflight.sh` reports them too.

---

## 3. Stage 3 — Where the client files come from

### 3a. On *this* Deck: the known-good file set is already here

**`/home/deck/Downloads/EQ/`** is a copy of **Hitya's working Windows desktop
install** (verified 2026-08-23). Not a pristine Quarm download — something
better: **a file set that is known to work, because it is the one being raided
on.** Seed a fresh install from it and you skip the download entirely.

```bash
ls /home/deck/Downloads/EQ/
```

`scripts/deck-preflight.sh` reports it as the **install / recovery source** —
present or absent, whether it holds `eqgame.exe`, and what its renderer files are.

Two things this copy is good for:

1. **Seeding a fresh install** — point the stage-4 installer's file pickers at it
   (or at the zips beside it) instead of re-downloading several GB.
2. **Answering "is this file supposed to be here?"** Both Deck installs — the
   Bottles one and the Lutris one — were derived from this copy, so it is the
   baseline you diff a broken install against.

#### What it actually contains (verified 2026-08-23)

The renderer + mod files, and only these:

| Present | Absent |
|---|---|
| `D3D8.dll` (dgVoodoo wrapper) | **no `D3D9.dll`** |
| `dgVoodoo.conf` | **no `D3D8backup.dll` / `D3D9backup.dll`** |
| `Zeal.asi`, `Zeal.pdb`, `Zeal_README.md` | |

**That is the whole renderer requirement: `D3D8.dll` + `dgVoodoo.conf`.** This
client is D3D8; the D3D9 wrapper is not part of a working configuration.

⚠ **Both Deck installs additionally carry `D3D9.dll`, `D3D8backup.dll` and
`D3D9backup.dll`** — files that are *not* in the known-good set. They were added
on the Deck after copying, by the lutris.net installer's `dg_voodoo2_79_3.zip`
step or by hand. Treat them as **drift, not requirement**: harmless, and
informative (their presence tells you the installer touched this folder), but do
not go hunting for them when a folder lacks them, and never conclude an install
is broken because `D3D9.dll` is missing. See §5.

> **[verify] — how does `Zeal.asi` get loaded?** The desktop copy ships
> `Zeal.asi` with **no visible ASI loader DLL** beside it. We are not asserting a
> mechanism (a loader elsewhere in the folder, something the client itself does,
> or a file the grep did not cover). Do not repeat a guess about this. What it
> does mean practically: on this Deck, "install Zeal" may amount to **keeping or
> refreshing this one file**, which is exactly what Mimic's Zeal updater does
> (§8b).

> ⚠ **Do not play out of `/home/deck/Downloads/EQ/`, and do not let an installer
> write into it.** Its value is being a stable known-good reference. If it starts
> collecting logs and a modified `eqclient.ini`, you lose the baseline.

### 3b. Otherwise: download them

| File | Where | Notes |
|---|---|---|
| **TAKP Windows client** | TAKP's own Google Drive link, from the guide | You supply this. Several GB — start it first. **Check `/home/deck/Downloads/EQ/` before downloading.** |
| **`pq_files_[date].zip`** | Project Quarm Discord → `#server-files` | The Quarm patch on top of the TAKP client. |
| **`dgVoodoo.conf`** (custom) | the Dropbox link in the guide | Close the login modal; it downloads without an account. Backups: `archive.org/details/dgvoodoo2_78_2_202205`. |
| *(optional)* **`QuarmPatcher.zip`** | Discord → `#server-files` | Only if you want the patcher as your launch exe (stage 4.5). |
| ~~Zeal~~ | — | **Skip.** Mimic installs it (stage 8). |
| ~~Zeal-compatible UI~~ | — | **Skip.** Mimic installs it (stage 8). |

Keep them in `~/Downloads` — that is where the installer's file pickers open, and
where a future `wolfpack-deck-setup.sh` will look first. (The pristine copy in
§3a lives at `~/Downloads/EQ/` for exactly that reason.)

**Verify:** all files finished downloading, and the two zips are zips (a
truncated Google Drive download is a classic silent failure — check the file
size against the source).

---

## 4. Stage 4 — Install via the lutris.net script

The installer script is the recipe. It encodes the working prefix — the DLL
placement, the overrides, and the dgVoodoo layout that stage 5 depends on. Do not
hand-build a prefix instead.

1. Open **`https://lutris.net/games/everquest/`**
2. Click **Install** on the **"Quarm Version"** entry (not the base EverQuest one)
3. Confirm **Install** in the Lutris dialog
4. Shortcut choices — **tick `Create steam shortcut`** on a Deck
5. **Continue**
6. `...` → pick your **TAKP client zip** and your **Quarm zip**
   - the popup's example filenames will not match yours; that is expected
7. **Leave `dg_voodoo2_79_3.zip` selected** as the installer downloaded it
8. **Install** → accept any additional-requirement popups → **Close** at
   *Installation completed!*

### What you end up with

The guide's default layout:

```
/home/deck/Games/everquest/
├── client/            ← eqgame.exe, eqclient.ini, eqlog_*.txt, uifiles/
└── dgvoodoo/          ← dgVoodooCpl.exe, dgVoodoo.conf
```

⚠ **Observed variant (Deck, 2026-08-23):** the install can land as
`/home/deck/Games/ProjectQuarm/` with **`eqgame.exe` at the prefix ROOT, beside
`drive_c/`** rather than in a `client/` subfolder. Both are fine — just know
which one you have, because every path below is written as
`<EQ folder>` = *the directory containing `eqgame.exe`*.

✅ **Fixed as of Mimic 2.6.1-linux.20** — auto-detect now scans prefix roots
too, so the variant above is found, and with several installs present it
follows the one with the newest log files. On an older build, or if detection
still misses, **Settings → pick EQ folder** once and Mimic remembers it
(stage 7).

**Runner note (observed 2026-08-23):** flatpak Lutris ran this via **umu +
Proton** rather than a bare `wine` binary. That matters only for the Zeal bridge
(`docs/mimic-steamdeck-zeal-bridge.md` §"the wineserver, not a flag") — for
playing, nothing changes.

### 4.5 (optional) — the Quarm Patcher

Extract `QuarmPatcher.zip` into `<EQ folder>`, then Lutris → right-click
**Everquest Quarm** → Configure → Game Options → executable →
`<EQ folder>/eqemupatcher.exe`.

### Replace the dgVoodoo config

Lutris → right-click **Everquest** → **Browse files**, then overwrite
`.../dgvoodoo/dgVoodoo.conf` with the custom one you downloaded in stage 3.
(Depending on layout you may also see a `dgVoodoo.conf` beside `eqgame.exe` —
that is the one the client actually reads at runtime.)

**Verify:** run **`bash scripts/deck-preflight.sh`** now. It should find your EQ
folder and report its dgVoodoo files. Do not launch yet.

---

## 5. Stage 5 — The renderer chain: DO NOT BREAK THESE

This is the part that cost three hours. **The Quarm client is the TAKP/EQMac-era
D3D8 client.** It does not talk to your GPU directly, and it does not talk to
DXVK directly. On a Deck the chain is four links long and **every link is
load-bearing**:

```
eqgame.exe  →  dgVoodoo D3D8.dll  →  D3D11  →  DXVK  →  Vulkan / RADV (Mesa)
 (D3D8 client)   (wrapper + dgVoodoo.conf)                (Proton)      (SteamOS)
```

Break any one of them and you get an error message that sounds like a *different*
problem — the client's diagnostics are from 1999 and blame DirectX for
everything. **Debug from the signature, not from a guess.**

| # | Link | Supplied by | Verify | Failure signature if it is missing/off |
|---|---|---|---|---|
| 1 | **dgVoodoo D3D8 wrapper** | `D3D8.dll` beside `eqgame.exe` | file present | **`Failed to load the graphics DLL!`** — `EQGfx_Dx8.dll` needs the wrapper this install was built around. Verified by removing it, 2026-08-23. |
| 2 | **`dgVoodoo.conf`** | beside `eqgame.exe` (and/or the sibling `dgvoodoo/` folder) | file present | wrapper falls back to its built-in defaults: watermark, wrong output API, or no D3D11 output at all. |
| 3 | **DXVK (`d3d11` + `dxgi`)** | the Proton/GE-Proton runner, enabled for this game **and** for this shortcut | see below | **`EverQuest requires DirectX 6.0 or higher`** — the 1999 error string for "there is no working D3D here". In the Wine log: `dxgi_factory_IsCurrent` **stub**, `shader_set_limits` reporting **`"4.0"`**, and `CheckFormatSupport` as a **partial stub**. Those three together mean dgVoodoo probed **Wine's stub d3d11**, not DXVK. Verified 2026-08-23. |
| 4 | **Vulkan / RADV** | Mesa on SteamOS | `vulkaninfo --summary` names an AMD RADV device | DXVK refuses to initialize; you land back on the #3 signature. Essentially never broken on stock SteamOS. |

**That is the entire requirement: two files in the game folder, plus DXVK
enabled in the runner.** Nothing else in the renderer path is load-bearing.

### What is NOT a requirement (know this before you "fix" something)

`D3D9.dll`, `D3D8backup.dll` and `D3D9backup.dll` are present in both Deck
installs but **absent from the known-good Windows set** (§3a) — the machine that
actually raids on this configuration does not have them. They arrived on the Deck
via the installer's `dg_voodoo2_79_3.zip` step.

- **Do not treat a missing `D3D9.dll` as a fault.** It is not in the chain.
- **Do not delete the extras either** — they are inert, and the `*backup.dll`
  copies are the only route back to an unwrapped install.
- Their presence is a useful *tell*: it means the lutris.net installer wrote into
  this folder, which distinguishes an installer-built install from a folder
  copied off a desktop.

`scripts/deck-preflight.sh` follows this: it FAILs only on a missing `D3D8.dll`
or `dgVoodoo.conf`, and reports the D3D9/backup files as drift.

### Reading the two error strings

- **"Failed to load the graphics DLL!"** → look **left** in the chain. The
  wrapper is missing, renamed, or shadowed. Restore `D3D8.dll` (and check
  `dgVoodoo.conf` is beside it) — from the known-good copy in §3a if it has them.
- **"EverQuest requires DirectX 6.0 or higher"** → look **right** in the chain.
  dgVoodoo loaded fine and then found nothing behind it. **DXVK is off.** Go to
  §6 traps.

Anything else — splash screen then a hang, no error at all — is **not** a
renderer problem. That is the working-directory trap (§6, trap 2).

### Two details worth knowing before you debug

- **EQ is 32-bit**, so the DXVK DLLs that matter live in the prefix's
  **`syswow64`** (`drive_c/windows/syswow64/d3d11.dll`, `dxgi.dll`), not
  `system32`. A prefix with 64-bit DXVK and builtin 32-bit d3d11 fails exactly
  like "DXVK off". The preflight script checks both and says which.
- **The wrapper only loads because a DLL override points `d3d8` at the app
  directory's native DLL.** The lutris.net installer sets this up; you never
  touch it. It is listed here because if you ever rebuild a prefix by hand, this
  is the link that silently reverts to Wine's builtin d3d8 and produces the
  DirectX-6 signature (link 3) with `D3D8.dll` still sitting right there.
  *[verify on install — the exact override string the installer writes was not
  captured on 2026-08-23.]*

---

## 6. Stage 6 — The Bottles traps (and the migration checklist)

**Bottles is not the destination.** `docs/mimic-steamdeck-zeal-bridge.md` pins
**Lutris + GE-Proton** because Bottles runs its wineserver inside a Flatpak
sandbox, and the Zeal pipe bridge cannot reach a sandboxed wineserver. That is a
deployment property, not something an env var fixes. If you are on Bottles today,
you will migrate; do it before you invest in a layout.

Both of tonight's traps are Bottles behaviors that **also have Lutris analogues**,
so check them either way.

### Trap 1 — a per-PROGRAM override silently forces DXVK off

Bottles has DXVK settings at the **bottle** level *and* per-**program**
("Preferences → Overrides" on the shortcut). **The per-program setting wins.** A
bottle showing "DXVK: on" can still launch that one shortcut with DXVK off —
and you get failure signature #4 with everything apparently configured correctly.
This is the trap that ate the evening.

- **Bottles:** open the *program's* preferences, not the bottle's, and clear any
  DXVK override.
- **Lutris analogue:** per-game **Runner options** override the runner defaults
  the same way. Right-click the game → Configure → **Runner options** → confirm
  **DXVK is enabled** there, not just globally.
- **Fastest check either way:** `scripts/deck-preflight.sh` inspects the actual
  DLLs in the prefix, which is the ground truth no settings screen can lie about.

### Trap 2 — an empty Working Directory hangs the client after the splash

`eqgame.exe` loads most of its assets by **relative path**. A shortcut with an
empty **Working Directory** paints the splash and then hangs forever with no
error. Set the working directory to `<EQ folder>` — the same directory the exe
lives in.

- **Bottles:** the program entry's *Working Directory* field.
- **Lutris analogue:** Game Options → **Working directory**.
- **Symptom recap:** splash, then nothing, no dialog. Not a graphics failure —
  do not go re-reading §5.

### Migration checklist — Bottles → Lutris

Old Bottles layout, for reference (2026-08-23):
`~/.var/app/com.usebottles.bottles/data/bottles/bottles/ProjectQuarm/drive_c/ProjectQuarm`

- [ ] **Copy out your character files** from the old client folder:
      `<char>_pq.proj.ini` and `UI_<char>_pq.proj.ini` (and `eqclient.ini` /
      `zeal.ini` if you tuned them). Better: let **Mimic's UI Studio** back them
      up first — that is exactly what its backup/import replaces (the guide's
      Bonus Step 8 goes away entirely).
- [ ] **Do a clean Lutris install** (stages 1–4). Do not copy a Bottles prefix
      across; the prefix is the part that was wrong.
- [ ] **Import** the character files into the new `<EQ folder>` via Mimic UI
      Studio (or by hand).
- [ ] **Verify the new install boots to character select** before deleting the
      old bottle.
- [ ] **Point Mimic at the new folder** (stage 7) — it will otherwise keep
      tailing logs in the dead bottle and look like it is "not seeing" you.
- [ ] Delete the old bottle once you have raided once on the new one.

---

## 7. Stage 7 — First launch + eqclient.ini

### 7a. Launch and verify a clean login

Click **Play** in Lutris. You want, in order: splash → login → server select →
**character select** → in-game.

Stop at the first thing that does not happen and match it against §5. Do **not**
proceed to Zeal until you have reached character select cleanly — installing a
game mod on top of an install that does not boot makes the next failure
un-diagnosable.

### 7b. eqclient.ini — logging and resolution

Open `<EQ folder>/eqclient.ini`.

**Logging must be on**, or Mimic has nothing to read (no parses, no chat relay,
no log-driven callouts). In game: `/log on`. In the ini, the client's logging
key should be enabled. Mimic tells you if it finds EQ but no logs.

**`[VideoMode]` — Deck targets:**

| Target | Width | Height | When |
|---|---|---|---|
| **1280×800** | `Width=1280` | `Height=800` | native Deck / OLED panel — sharpest text, smallest UI |
| **1440×900** | `Width=1440` | `Height=900` | the Quarm.Guide default — supersampled, more usable screen real estate |

Pick one and use it consistently — **Mimic's UI Studio has presets for both**,
and your `UI_<char>_pq.proj.ini` stores per-resolution key names
(`XPos1440x900` / `YPos1440x900`), so switching resolutions moves every UI
window.

> ⚠ **The client stomps `[VideoMode]` back to 4:3 on exit.** Observed on the
> Deck, 2026-08-23: you set 1440×900, play, quit — and the ini is 4:3 again next
> launch. Re-check it whenever the UI suddenly looks wrong. **An enforcement
> mechanism is in progress** (companion work, #156 line) so this stops being a
> manual chore; until it lands, `scripts/deck-preflight.sh` will tell you the
> moment it has drifted.

While you are in there, the guide's other `[Defaults]` suggestions are worth a
look: `ClipPlane=20`, `InspectOthers=FALSE` (TRUE causes accidental inspects),
plus `ShowDyanmicLights` *(sic — that is the real key name)*,
`AllLuclinPcModelsOff`, `EnableClassicMusic`, `CombatMusic`.

**Verify:** relaunch, confirm the resolution took, and confirm an
`eqlog_<You>_pq.proj.txt` now exists in `<EQ folder>`.

---

## 8. Stage 8 — Mimic, then Zeal (in that order)

### 8a. Install Mimic

1. Download the Linux AppImage — `Wolf-Pack-Mimic-<ver>-linux-x86_64.AppImage`
   (the `linux` channel; current Deck line is **2.6.1-linux.19**).
2. ```bash
   chmod +x ~/Applications/Wolf-Pack-Mimic-*-linux-x86_64.AppImage
   ~/Applications/Wolf-Pack-Mimic-*-linux-x86_64.AppImage
   ```
   It already passes `--no-sandbox` (SteamOS has no user-namespace sandbox
   helper). If it still refuses to start, add `--appimage-extract-and-run`.
3. Sign in with Discord.
4. **Point it at `<EQ folder>`** — Settings → pick EQ folder. Do this explicitly
   rather than trusting auto-detect (see the detector note in stage 4).

**Verify:** Mimic's dashboard at **`http://localhost:7779`** shows your EQ folder
and your character, and the log tail is moving while you are in game.

### 8b. Zeal — LAST, and only after a clean login

Zeal hooks the client's graphics path. Installing it before you have a booting
client means any future failure has two candidate causes instead of one. You have
a clean login from stage 7a; now add Zeal.

**Mimic Settings → Zeal → Install.** One click. It fetches the latest
CoastalRedwood release, installs `Zeal.asi` + `uifiles/` into `<EQ folder>`,
backs up everything it replaces as `<file>.zealbak-<ts>`, and **refuses to run
while EQ is running** (the game holds `Zeal.asi`). Close EQ first.

> If you seeded from `/home/deck/Downloads/EQ/` (§3a), `Zeal.asi` — plus
> `Zeal.pdb` and `Zeal_README.md` — **came across with it**. In that case this
> step is not an install but a *refresh*: run Mimic's Zeal check to pull the
> current CoastalRedwood release over the copied one. **[verify]** — that copy
> has no visible ASI loader DLL beside it, and we are not asserting how the file
> gets loaded; confirm Zeal actually initializes in game rather than assuming the
> file's presence is enough.

A Zeal-compatible UI is mandatory — Zeal's own `uifiles/` ship in that same
install, so the default case is handled. For a custom UI, use **Settings →
Custom UI packs** (Nillipuss 1080p/1440p are registered) rather than dragging
folders; it also handles the packs' `Options/` layout variants.

> ⚠ **A non-Zeal-compatible UI crashes the client at character select or on
> `/loadskin`.** If that happens, set `UISkin=Default` in `eqclient.ini` to get
> back in.

**Verify:** launch EQ, reach character select, get in-game, and confirm Zeal's
own UI elements are present.

### 8c. What Zeal does *not* give you yet on Linux

**Live overlays (DPS/Tank HUD, Mob Info, Buff queue, charm/pet) are still Phase 2
and do not work on the Deck yet.** Zeal streams game state out a **Windows named
pipe** inside the Wine prefix; a native Linux Mimic cannot see it without a
bridge. That bridge is under active implementation (companion work on the #156
line) — design and the `outflow` approach are in
`docs/mimic-steamdeck-zeal-bridge.md`.

What **does** work on the Deck today: UI Studio, the dashboard, parse/chat
upload, and log-driven trigger callouts. That is most of raid night.

---

## 9. Stage 9 — Steam shortcut, controller, Gaming Mode

### 9a. One shortcut that starts BOTH (preferred)

The manual route below gives Steam a shortcut for *EQ only*, so Mimic is a
second thing to remember — and in Gaming Mode there is no tray and no file
manager to start it with. In practice that means raiding without Mimic and
losing the night's parse + chat upload. **Mimic Settings → Steam Deck — one
launcher** replaces the whole dance:

1. Fill in the **Lutris game name** (usually `everquest` — the identifier in
   the Lutris URL, not the display name). Launching through Lutris is
   deliberate: it carries the DXVK + DLL-override config that §5's renderer
   chain depends on. Running `eqgame.exe` directly bypasses all of it and
   reproduces the DirectX-6 failure on an otherwise-correct install.
2. **Close Steam completely.** Steam holds `shortcuts.vdf` in memory and
   rewrites it from that copy on exit, so a write underneath a running Steam is
   silently discarded at logout. Mimic checks, and refuses rather than
   reporting a success that will evaporate.
3. Press **Install launcher & add to Steam**.

It writes `~/.local/share/wolfpack/deck-launch.sh` and adds one library entry
named **`Everquest Quarm`** (step 3 below explains why that exact name). The
script starts Mimic if it is not already up, starts EQ, and then **waits for
`eqgame.exe` to exit** before returning — so Steam's playtime and its
"stop game" button both track the real session. It only closes Mimic on the way
out if it was the thing that started it, so a Mimic you already had open
(mid-backfill, dashboard on a monitor) survives.

Re-running it is safe: the entry is matched on name/path and updated in place,
so you never end up with five copies of the game in your library. The generated
script is plain bash — read it, or run it in a terminal to see every step.

> **Autofill** (optional, off by default) is covered in §9b, including what it
> costs you. Read that before turning it on.

### 9b. Login autofill — read this before enabling

**Zeal does not do auto-login** (checked against CoastalRedwood/Zeal's own docs,
2026-08-26 — it covers keybinds, UI and maps, nothing authentication). Neither
does the client. So the only mechanism available is *typing the password for
you*, and that carries real costs:

- **Your password is stored on the Deck**, in `~/.config/wolfpack/eq.cred`, mode
  `0600`. Mimic encrypts it in its own config with the system keyring when one
  is available — **on SteamOS there usually is not**, and the Settings card says
  which case you are in rather than implying a keychain that isn't there. Treat
  it as "readable by anyone who can log in as `deck`".
- **Desktop Mode only.** Gaming Mode runs gamescope, which does not expose an X
  display the typing tool can reach. The launcher detects that and skips
  autofill instead of hanging.
- **It stops if focus moves.** The script re-checks that EQ still owns the
  focused window before the username, before the password, and before Enter. If
  anything steals focus mid-sequence it abandons the attempt — losing an
  autofill is free, typing your password into Discord is not.
- It needs `xdotool` (`sudo pacman -S xdotool`, or it silently skips).

The password is never passed as a command-line argument — argv is world-readable
through `/proc/<pid>/cmdline`. It is piped to the typing tool on stdin, which is
the entire reason it lives in a file rather than a variable.

### 9c. Controller layout (either route)

3. The entry must be named **exactly `Everquest Quarm`** — the community
   controller layouts key off that name. Mimic's launcher already names it that;
   if you made the shortcut by hand, rename it (Settings cog → Properties).
4. Controller icon → up-arrow to **Browse Community Layouts…** → R1
   **Community Layouts** → X **Show All Layouts** → **"Pastrami's Layout with
   workable keyboard (based off Yuuhi's P99)"** → A → X to apply
5. If the game will not start from Steam, add **`ENABLE_GAMESCOPE_WSI=0`** to
   Properties → Launch Options. *(Mimic's launcher pre-sets this, so this step
   is only for a hand-made shortcut.)*

### 9d. The manual route (fallback)

If Mimic cannot find a Steam profile, or you would rather do it by hand:

1. Lutris → right-click **Everquest** → **Create Steam Shortcut**
   *(may take a couple of tries, or a Steam restart)*
2. Return to Gaming Mode → find it under **Non-Steam** games — then do §9c.

This gives you EQ only; start Mimic yourself before raid.

**Mimic in Gaming Mode:** gamescope cannot host floating overlay windows, so
Mimic auto-detects the session and switches to **Background Mode** — audio
callouts, parse/chat upload and the dashboard keep running, visual overlays are
hidden. The dashboard is still reachable: add `http://localhost:7779` as a
non-Steam browser shortcut, or open it in the Steam overlay's browser. See
`docs/mimic-steamdeck.md` → Background Mode.

**Optional — remove the dgVoodoo watermark:** Lutris → the second arrow beside
Play → **Run EXE inside Wine prefix** → `.../dgvoodoo/dgVoodooCpl.exe` → DirectX
tab → untick the watermark → Apply/OK.

---

## 10. The preflight script

```bash
bash scripts/deck-preflight.sh
```

Read-only. Writes nothing, changes nothing, safe to run mid-raid. It:

- finds every EQ candidate under **both** package managers' paths (Bottles
  bottles, Lutris `~/Games` — prefix root *and* `drive_c` — Proton `compatdata`,
  and SD-card mounts);
- reports the **pristine source copy** at `~/Downloads/EQ/` (§3a): present or
  absent, whether it holds `eqgame.exe`, and what renderer files it carries;
- checks the **required dgVoodoo pair** (`D3D8.dll` + `dgVoodoo.conf`) **per
  install**, and separately reports `D3D9.dll` / `*backup.dll` as drift rather
  than treating them as requirements;
- checks **DXVK** in that install's prefix, 32-bit and 64-bit separately, by
  inspecting the DLLs rather than trusting a settings screen;
- checks the **`org.freedesktop.Platform.GL32`** flatpak runtime;
- checks **`[VideoMode]`** against the two Deck targets and flags the 4:3 stomp;
- best-effort reads Lutris/Bottles config for the two **traps** (DXVK override,
  empty working directory);
- prints **PASS / WARN / FAIL** per item, each FAIL with its fix and the §
  reference here.

Exit code is `0` when nothing FAILed, `1` otherwise — so it is usable from a
launcher script.

---

## 11. Failure-signature index

Start here. Match the string you actually saw.

| What you see | Meaning | Go to |
|---|---|---|
| `Failed to load the graphics DLL!` | `D3D8.dll` (or `dgVoodoo.conf`) is gone/renamed | §5 links 1–2 |
| `EverQuest requires DirectX 6.0 or higher` | dgVoodoo loaded, DXVK behind it did not | §5 link 3, then §6 trap 1 |
| Wine log: `dxgi_factory_IsCurrent` stub · `shader_set_limits "4.0"` · `CheckFormatSupport` partial stub | positive proof you are on **Wine's stub d3d11**, not DXVK | §6 trap 1 |
| Splash paints, then hangs forever, no error | empty Working Directory; assets not found by relative path | §6 trap 2 |
| Crash at character select, or on `/loadskin` | non-Zeal-compatible UI | §8b — `UISkin=Default` |
| Mimic "can't find my EQ folder" | Mimic older than 2.6.1-linux.20 (prefix-root scan), or an unusual layout | update Mimic, else §4 / §8a — pick it manually |
| Mimic sees EQ but no logs | in-game logging off | §7b — `/log on` |
| UI windows all moved | `[VideoMode]` stomped back to 4:3 on exit | §7b |
| Lutris warns about `/usr/lib/i386-linux-gnu/GL` / `amdgpu.ids` | 32-bit GL runtime missing | §1 — install `org.freedesktop.Platform.GL32` |
| No live overlays / no target HP | expected — the Zeal pipe bridge is not done | §8c |
| "Is this file supposed to be here?" | diff the install against the pristine copy | §3a |

---

## 12. Not verified from a cloud session

Everything marked **[verify on install]** could not be confirmed remotely and
should be checked (and this doc corrected) on the next real install:

- **How `Zeal.asi` is actually loaded** (§3a). The known-good desktop copy ships
  it with no visible ASI loader DLL. No mechanism is asserted here; do not invent
  one.
- **The exact DLL-override string** the lutris.net installer writes for
  `d3d8`/`d3d9`. We know the override *works* — removing the wrapper changes the
  error — but the literal value was not captured.
- **Bottles' `bottle.yml` schema** for per-program DXVK overrides and working
  directory. The preflight script reads it best-effort and reports WARN, never
  FAIL, on that check.
- **The current lutris.net script's GE-Proton pins.** The pins above
  (`GE-Proton8-7` + `GE-Proton8-26`) are quoted from the Quarm.Guide source in
  `LordDemonos/Quarm.Guide`; the live lutris.net installer page itself is blocked
  from cloud sessions (`quarm.guide` is egress-blocked; the raw GitHub source is
  not).
- **The in-game logging key's exact name/value** in `eqclient.ini` for this
  client build — the preflight script matches on `Log`-prefixed keys
  case-insensitively rather than asserting one spelling.

## 13. Provenance

Stages 1–4 and 9 are the Quarm.Guide recipe
(`LordDemonos/Quarm.Guide`, `_posts/2024-09-13-linux-and-steam-deck-install-guide.md`),
retrieved 2026-08-24.

Stages 5, 6, and the `[VideoMode]` stomp in 7b are **field evidence from a live
Deck install on 2026-08-23 (Hitya)** — the renderer chain, both error signatures,
the Wine-stub log tell, both Bottles traps, the observed prefix-root layout, the
flatpak GL32 warning, and the known-good desktop client copy at
`/home/deck/Downloads/EQ/` that both installs were derived from. Stage 8's
ordering (Mimic first, Zeal last, only after a clean login) is the operational
rule that falls out of it.

**Corrected the same night:** §3a and §5 originally described a required dgVoodoo
"trio" (`D3D8.dll` + `D3D9.dll` + `dgVoodoo.conf`) inferred from the two Deck
installs. The known-good Windows set has only **`D3D8.dll` + `dgVoodoo.conf`** —
no `D3D9.dll`, no `*backup.dll`. The extras are installer drift on the Deck. The
lesson generalises: **the two Deck installs are not the reference; the machine
that actually raids is.**
