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
