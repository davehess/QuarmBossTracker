# Decisions — 2026-08-26

⚠ This file exists on `main` too, with that day's web/PoP decisions. This copy
is the **Deck line** (`claude/deck-156-refresh`), which branched before those
landed — so the two versions differ ON PURPOSE and will reconcile whenever the
Deck work graduates. Do not "fix" the divergence by overwriting either side.

## Steam Deck: one Steam entry starts Mimic + EQ (#156, Deck line)

> "can we get more integrated on that side to get it all under one launcher for
> mimic and EQ. I'd like to auto fill my password and have it all under one
> from steam"

The Deck install ended with two things to start by hand, and Gaming Mode has no
tray or file manager to start the second with — so the practical outcome was
raiding without Mimic and losing that night's parse + chat upload.

**Shipped** (branch `claude/deck-156-refresh`, auto-builds a `-linux.N`
AppImage on push): `apps/mimic/deckLaunch.js` generates a launcher script,
`apps/mimic/steamShortcuts.js` registers exactly one Steam library entry, and a
Settings card drives both. RUNBOOK §9 rewritten around it, manual route kept as
§9d fallback.

**Decisions worth keeping:**

1. **Launch through Lutris, not `eqgame.exe` directly.** Lutris carries the
   DXVK + DLL-override configuration the renderer chain depends on; going
   direct bypasses it and reproduces the DirectX-6 failure on an install that
   is otherwise fine. Direct-Wine is supported but requires BOTH an EQ folder
   and a prefix — Mimic will not guess a prefix, because guessing wrong
   silently creates a second, empty install instead of erroring.
2. **Poll for `eqgame.exe`; never wait on the launch pid.**
   `lutris lutris:rungame/<slug>` hands off to the running Lutris daemon and
   exits immediately. Waiting on it would make Steam show the session ending
   two seconds after Play.
3. **Only stop Mimic if the launcher started it** — a Mimic already open
   (mid-backfill, dashboard on a monitor) must survive the game closing.
4. **Autofill is OFF by default and is honestly labelled.** Zeal has no
   auto-login (checked against CoastalRedwood/Zeal's own docs, 2026-08-26 — it
   is keybinds/UI/maps, nothing authentication), so the only mechanism is
   typing the password. Three rules are load-bearing and are pinned by tests:
   - the password goes to `xdotool type --file -` on **stdin, never as an
     argv** — argv is world-readable through `/proc/<pid>/cmdline`;
   - **focus is re-checked before every typed step** and the sequence aborts if
     EQ lost it, because otherwise the password is typed into whatever stole
     focus;
   - it **self-skips with no `DISPLAY`** (Gaming Mode/gamescope) rather than
     hanging.
   At-rest protection is `safeStorage` **when a keyring exists — on SteamOS it
   often does not**, and the Settings card states which case the box is in
   instead of implying a keychain. This was a deliberate choice to describe the
   weaker guarantee rather than the nicer-sounding one.
5. **`shortcuts.vdf` handling refuses to guess.** `parseShortcuts` throws on a
   structurally corrupt file rather than parsing short, and main.js does NOT
   fall back to an empty list — writing that back would delete every other
   non-Steam game the user owns. Writes are also refused while Steam is
   running, because Steam rewrites the file from memory at exit and would
   discard them silently. Upsert matches on name/path so re-running never
   doubles the library entry.

**Still unverified on hardware** (cloud session, no Deck): whether `xdotool`
reaches the Wine window under Desktop Mode's XWayland at all, and whether EQ
accepts synthetic input. The mechanism is built, tested, and defaults off —
but nobody has watched it type. That is the first thing to check on a Deck.

Tests: `test/deck-launch.test.js` (34), `test/steam-shortcuts.test.js` (27),
each mutation-checked. Full suite green (2,458).
