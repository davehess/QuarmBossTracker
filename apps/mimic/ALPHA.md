# The Mimic 3.0 alpha branch

This branch (`alpha`) is the Mimic 3.0 alpha: `beta` plus the 3.0 overlay-builder work
(the guild lead, 2026-09-29: "can we make an alpha channel for 3.0 testing as well?").
DECISIONS-2026-09-21.md §81 on `main` has the whole design; this file only says how to
work here.

- **Builder work lands here.** Every push that touches `apps/mimic/**` builds
  `3.0.0-alpha.<run number>` and replaces the files of the rolling `mimic-alpha` release.
- **Agent changes go to `beta` first**, never here. `sync-alpha.yml` merges beta and main
  into this branch on every push to either, so the alpha's agent is always beta's.
- **`apps/mimic/package.json` stays at 3.0.0** on this branch; the sync keeps it.
- **Nothing here is merged back as a branch.** When the builder is ready for the beta, its
  files are promoted to `beta` one by one, the same way beta graduates to `main`.
- This file is excluded from the installed app (`!**/*.md` in the build config).
- **A sync never builds the alpha.** `sync-alpha.yml` pushes with `GITHUB_TOKEN`, which starts no
  workflow, so beta and main changes reach alpha testers only with the next alpha push. The agent
  arrives anyway (the alpha takes the beta agent line); Mimic's own files do not. To hand testers a
  stable cut or a beta fix without builder work, push a change under `apps/mimic/` here: an edit to
  this file is enough, and costs nothing in the app. Last done 2026-09-30, after stable 2.7.5
  (Extended Target per-mob debuffs, the walkthrough gate).
- **No re-park after a stable cut.** `3.0.0-alpha.N` sorts above every 2.x stable and beta, so the
  3.0.0 park only moves when a stable reaches 3.0.

## What the alpha has that beta does not

| Piece | Files | Since |
|---|---|---|
| **Overlay sets** (step 1, §83a): save the layout — which overlays are on, where, how see-through, the Timers canvas panels — under a name, and switch with `/pipe mimic load <set>`, `save [set]`, `next`, `prev`, `lock`/`unlock`, the tray's 🗂 Overlay sets, or Settings → Overlay sets. Kept in `overlay-sets.json` beside the config; no network. Loading never happens on its own (a character switch does not load one). | `overlaySets.js` (store + `/pipe` parser), `main.js` (`_captureOverlaySet`, `_applyOverlaySet`, `_overlaySetCommand`, tray, IPC), `preload.js`, `settings.html`; `test/overlay-sets.test.js` | 2026-09-29 |
