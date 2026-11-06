# Zeal changes: suggestion posts, test cases, and where each one stands

Every change we make to Zeal (the in-game helper EverQuest players run) has a folder here. Each folder has:
- **`SUGGESTION.md`**: a post of at most 350 words for a Zeal suggestions thread, in the shape What, Why, How, How tested,
  with a banner image at the top, one preview image and a one-line "Try it".
- **`TEST-CASES.md`**: numbered cases (setup, steps, expected result, pass/fail box) covering the happy path, edge cases,
  safety (old Zeal on the other side, not raid leader, zoning, relog, crash, two clients) and performance.
- Where they exist, the original `PULL-REQUEST.md`, `TRY-IN-GAME.md`, patch files and previews.

The banner images live on the fork's `showcase` branch (see below). Until that branch is pushed, the banner line at the top of
each post will not show.

Fork: https://github.com/davehess/Zeal. Combined test build (every pushed branch merged):
https://github.com/davehess/Zeal/releases/tag/test-all-build.

**2026-11-06: everything moved onto Zeal v1.5.0-alpha0** (`004fa3c`, which ships our PRs 246, 253 and 254). Every live
branch had upstream merged in (a merge commit, no history rewritten); `test-all` (`b05143f`) is now the 1.5 bundle of
`guildicon-draft`, `raidlead-draft`, `guild-tagicons`, `spell-id-tooltip` and `target-loc-range`, the same patch set as
before minus the three upstreamed features. The tag PRs were rebased as `pr/tag-persist-corpses-1.5` and
`pr/tag-name-check-1.5`; filing text in [`zeal-tag-persistence/PULL-REQUEST-1.5.md`](zeal-tag-persistence/PULL-REQUEST-1.5.md).
Conflicts resolved on the way: upstream's cast bars beside our tag code in `nameplate.cpp/.h`; upstream's own
`RaidGeneral_Struct` replaced the copy in `raidlead-draft`; upstream's mouseover tooltips now also show the `/spellid`
line. Older branch heads below are as of 2026-10-11.

**The build we suggest to raiders is Wolf Pack Zeal** (official release + the commits in the fork's
`wolfpack/approved.txt`, release `wolfpack-beta`): see [`WOLFPACK-ZEAL.md`](WOLFPACK-ZEAL.md). A change goes into it only
once tested; it leaves when upstream releases it.

## Index

| Change | Folder | Fork branch (head) | Status | In test-all build? | Needs |
|---|---|---|---|---|---|
| Tag icons, numbered badges, lettered paws | [`zeal-tag-shapes`](zeal-tag-shapes/) | `tag-shapes` (`f777d81`) | Pushed branch, not filed | Yes | In-game: banners, `/tag help`, old-client view |
| Tag persistence (crash, relog, switch, other zones) + tag corpses | [`zeal-tag-persistence`](zeal-tag-persistence/) ([1.5 filing text](zeal-tag-persistence/PULL-REQUEST-1.5.md)), [`zeal-tag-corpses`](zeal-tag-corpses/) | `pr/tag-persist-corpses-1.5` (`606e428`, one commit on v1.5.0-alpha0); 1.4.8 version `fix/tag-persist-corpses` (`8bb72be`) | **Filed, upstream PR 272** (2026-11-06, against v1.5.0-alpha0; GitHub build passed on the `test-1.5` branch). Default OFF, file written only on change, no shapes, no CHANGELOG (DECISIONS §454). Older `tag-persistence` / `tag-corpses` / `pr/tags-core` branches are superseded | Older build only | Review; one in-game run |
| Received tag must match the mob's name | none (two lines) | `pr/tag-name-check-1.5` (`d75d153`, on v1.5.0-alpha0); 1.4.8 version `fix/tag-name-check` (`342694b`) | **Filed, upstream PR 273** (2026-11-06, against v1.5.0-alpha0): a tag from another zone could land on an unrelated mob with the same spawn id | Yes (1.5 bundle) | Review |
| Tag pictures from a folder | [`zeal-tag-icon-files`](zeal-tag-icon-files/) | `tag-icon-files` (`b20331f`, stacked on `tag-shapes`) | Pushed branch, not filed | Yes | In-game: drawing, orientation, PNG support |
| Cursor while the UI is hidden (F10) | [`zeal-hide-ui-cursor`](zeal-hide-ui-cursor/) | `hide-ui-cursor` (retired) | **Merged**, upstream PR 246, Zeal v1.5.0-alpha0 (`/uicursor`) | In the base | Regression checks only |
| Guild banners, icons, automatic guild marks | [`zeal-guild-emblems`](zeal-guild-emblems/) | in `tag-shapes` (`c2a5333` banners and icons, `f777d81` auto marks) | Pushed branch, not filed; icons seen in game 2026-09-26 | Yes | In-game: banners and the 12 auto-mark checks |
| Spawn ids on the pipe | [`zeal-spawn-id`](zeal-spawn-id/) | `pipe-spawn-id` (obsolete) | **Merged**, upstream PR 229, Zeal 1.4.6 | Yes (1.4.8 base) | Regression checks only |
| Main assist marker, `%tid`, `/target` by tag | [`zeal-main-assist`](zeal-main-assist/) | `ma-draft` (`206b884`) | Pushed branch, not filed; compiled by GitHub 2026-10-10, not run in game | Yes (`3c4766c`) | In-game: all cases |
| Mez and slow keys (`^MEZ^`, `^SLOW^`) | [`zeal-mez-slow-keys`](zeal-mez-slow-keys/) | `ma-draft` (`116d3ed`) | Pushed branch, not filed; compiled by GitHub 2026-10-10, not run in game | Yes (`3c4766c`) | In-game: all cases; breaks `^M^` (the website's symbol list still shows `^M^`) |
| Auto raid lead, persisted `/ari` | [`zeal-auto-raid-lead`](zeal-auto-raid-lead/) | `raidlead-draft` (`b15b8a2`, on `ma-draft`) | Pushed branch, not filed; compiled by GitHub 2026-10-10, not run in game | Yes (`3c4766c`) | In-game: a two-person raid test |
| Guild icon and banner refresh | [`zeal-guild-icon-refresh`](zeal-guild-icon-refresh/) | `guildicon-draft` (`dca0b85`, on `ma-draft`) | Pushed branch, not filed; compiled by GitHub 2026-10-10, not run in game; banners show each guild's icon in its own colours plus its full name (DECISIONS §226) | Yes (`3c4766c`) | In-game: all cases |
| PoP flags saved on `/camp` | [`zeal-popflags-export`](zeal-popflags-export/) | `pr/popflags-export` (retired) | **Merged**, upstream PR 253, Zeal v1.5.0-alpha0. Was: **Filed** (2026-10-27). Updated the same day: the reply shows in chat by default, `/outputfile hidepopflags` hides only the reply's lines, and the capture takes only reply-shaped lines (the earlier version cleared every server-colour line for ~3 s). Mimic reads the file from agent 4.0.31 | In the base | None |
| Spell id in spell info (`/spellid`) | [`zeal-spell-id-tooltip`](zeal-spell-id-tooltip/) | `pr/spell-id-1.5` (`7c64e36`, one commit on v1.5.0-alpha0); fork branch `spell-id-tooltip` | **Filed, upstream PR 274** (2026-11-06). On 1.5 the line also shows in the new mouseover spell tooltips (same function). Compiled by GitHub on `test-1.5`, not run in game (DECISIONS §229, §542) | Yes (1.5 bundle) | Review; in-game: all cases |
| Target position past 250 units | [`zeal-target-loc-range`](zeal-target-loc-range/) | `target-loc-range` (`f987701`, TEST ONLY: removes the cap; the ask is a raise to ~450) | Request drafted, not filed (DECISIONS §243) | Yes (`5bcd34a`) | In-game: target at 260–420 units, `target_loc` keeps arriving; rebuild the branch as the 450 change before filing |
| `/pipedelay` printed 0 | none (one line) | `pr/pipedelay-print` (retired) | **Merged**, upstream PR 254, Zeal v1.5.0-alpha0 | In the base | None |

`raidlead-draft` and `guildicon-draft` each sit on `ma-draft` (side by side, not on each other). All three were pushed on
2026-10-10 and merged into `test-all` (`3c4766c`), whose GitHub build passed.

Other material in this folder: `zeal-guild-emblems/PROPOSAL.md` (the two guild-mark directions and the pick) and
`zeal-spawn-id/` (the filing record for PR 229).

## The showcase branch

The fork's `showcase` branch holds only documents: a README index with thumbnails, one folder per change with its text and
images, and `posters/` with a poster (1200x675) and a PR header banner (1280x320) for each change, all made from one template.
Its README explains how to make a new poster, and what to do when a pull request is filed (set its status and link, re-run
the script, commit).
