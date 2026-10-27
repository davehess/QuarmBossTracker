# Wolf Pack Zeal: the guild's suggested Zeal build

**What it is.** The latest **official** Zeal release (CoastalRedwood/Zeal) plus a short list of changes the guild has
tested, rebuilt by GitHub and installed from Raid Mimic in one click. It is the one Zeal we suggest to raiders, and it
stays as close to official as possible: when upstream releases one of our changes, it leaves our list.

- Fork: https://github.com/davehess/Zeal (default branch `main`).
- Release (beta): https://github.com/davehess/Zeal/releases/tag/wolfpack-beta, one rolling prerelease, never marked
  "latest", so nothing that reads the fork's latest release picks it up by accident.
- In game, `/zeal version` shows `1.4.8 (wolfpack-<run>-<hash>)`: the official version number with our build label.
  The official label is a bare hash and the test build is `testall-<hash>`, so a crash report or a screenshot says
  which build it was.
- Licence: Zeal is MIT. The zip carries `LICENSE` (the one condition) and a `WOLFPACK_README.md` that says it is
  unofficial, lists what is added, says to report problems to Wolf Pack and not to the Zeal maintainers, and says how to
  go back to official Zeal.

## How a build is made (`.github/workflows/build-wolfpack.yml` on the fork's `main`)

1. **Base.** The newest upstream release (`/repos/CoastalRedwood/Zeal/releases/latest`; prereleases are excluded by
   GitHub). Not upstream `main`: a release is what the maintainer has signed off.
2. **Approved changes.** `wolfpack/approved.txt` on the fork's `main`: one full commit sha + label per line, picked onto
   the base in order. Approval is pinned to the **commit**, so a later push to a branch ships nothing until its new sha
   is written here.
3. **Skip when nothing changed.** The release body carries a fingerprint (base tag + approved shas). A run with the same
   fingerprint builds nothing.
4. **Build.** Upstream's own msbuild line on a Windows runner, `zeal_build_version=wolfpack-<run>-<hash>`.
5. **Publish.** The assembled commit goes to the fork branch `wolfpack-beta-build`, the `wolfpack-beta` tag moves to it,
   and the release's single zip (`zeal_v<version>-wolfpack.<run>.zip`) is replaced. The release name carries the label
   in parentheses, which is how Mimic tells one build from the next.
6. **Fail loud, never half-ship.** A change that no longer applies to a new upstream release, or that upstream already
   shipped, stops the run with a message naming the commit and what to do. The previous release stays as it was, and
   GitHub emails the fork owner.

**When it runs:** daily at 09:41 UTC (so a new upstream release is picked up within a day), on every push to the fork's
`main` that touches `wolfpack/` or the workflow, and on demand (Actions → Build Wolf Pack Zeal → Run workflow; tick
"force" to rebuild with nothing changed).

## Bringing upstream changes forward

Nothing to do in the normal case: a new upstream release becomes the base on the next daily run. Two cases need a hand:
- **Upstream shipped one of ours** (the PR merged and released): the run fails with "empty … remove this line". Delete
  that line from `approved.txt` and push; the next build is the official release plus the rest.
- **One of ours conflicts with the new release**: rebase that branch onto the new upstream tag, re-test, put the new sha
  in `approved.txt`. Until then the previous Wolf Pack build stays up (it is on the older release).

## Adding or changing a change

1. Build the change on its own branch on the fork, one commit, based on upstream (`pr/*` or `fix/*`, the same branch the
   upstream PR comes from).
2. Test it in game: either in the test build (`test-all`) or with a local build.
3. The guild lead approves it; write `<full sha> <label>` into `approved.txt` (a `# branch …` comment above it), push.
4. The build runs within minutes; Mimic's 12-hour check offers it to everyone on the Wolf Pack source.

## Raiders: how they get it

Raid Mimic → Settings → Zeal → **Wolf Pack — official Zeal plus the guild's tested fixes (beta)** → Check → Install
(EverQuest closed). Mimic backs up the old `Zeal.asi` and `uifiles` first, checks every 12 hours and says when a new
Wolf Pack build is out. Going back: pick Official and install. The choice reaches Mimic beta first (agent 4.0.32,
2026-10-27) and the stable fleet at the next stable cut.

## Three Zeal builds, and which is which

| Build | What | Who |
|---|---|---|
| Official | CoastalRedwood's latest release | everyone by default |
| **Wolf Pack** (`wolfpack-beta`) | official release + `approved.txt` | the build we suggest to raiders |
| Test (`test-all-build`) | every branch we are working on, merged, may be unstable | testers only |

## Open

- **A stable channel.** Today there is one rolling beta. A `wolfpack` stable release (promote the current beta by hand
  once it has raided) is the next step if the guild wants beta testers ahead of everyone else.
- **Quarm.** Zeal's README asks that it be used only where the server permits. Our additions send only commands any
  player can type (`#popflags`), but whether Project Quarm staff are fine with a guild build has not been asked.
- **Courtesy to upstream.** Worth telling the Zeal maintainer the build exists and that its crash reports come to us.
