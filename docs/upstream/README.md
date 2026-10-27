# Zeal changes: suggestion posts, test cases, and where each one stands

Every change we make to Zeal (the in-game helper EverQuest players run) has a folder here. Each folder has:
- **`SUGGESTION.md`**: a post of at most 350 words for a Zeal suggestions thread, in the shape What, Why, How, How tested,
  with a banner image at the top, one preview image and a one-line "Try it".
- **`TEST-CASES.md`**: numbered cases (setup, steps, expected result, pass/fail box) covering the happy path, edge cases,
  safety (old Zeal on the other side, not raid leader, zoning, relog, crash, two clients) and performance.
- Where they exist, the original `PULL-REQUEST.md`, `TRY-IN-GAME.md`, patch files and previews.

The banner images live on the fork's `showcase` branch (see below). Until that branch is pushed, the banner line at the top of
each post will not show.

Fork: https://github.com/davehess/Zeal. Combined test build (every pushed branch merged, GitHub Actions build passed at
`e1fde3d`; `75e85e4` adds the popflags echo fix): https://github.com/davehess/Zeal/releases/tag/test-all-build.
Branch heads below are as of 2026-10-11.

**The build we suggest to raiders is Wolf Pack Zeal** (official release + the commits in the fork's
`wolfpack/approved.txt`, release `wolfpack-beta`): see [`WOLFPACK-ZEAL.md`](WOLFPACK-ZEAL.md). A change goes into it only
once tested; it leaves when upstream releases it.

## Index

| Change | Folder | Fork branch (head) | Status | In test-all build? | Needs |
|---|---|---|---|---|---|
| Tag icons, numbered badges, lettered paws | [`zeal-tag-shapes`](zeal-tag-shapes/) | `tag-shapes` (`f777d81`) | Pushed branch, not filed | Yes | In-game: banners, `/tag help`, old-client view |
| Tag persistence (crash, relog, switch, other zones) + tag corpses | [`zeal-tag-persistence`](zeal-tag-persistence/), [`zeal-tag-corpses`](zeal-tag-corpses/) | `fix/tag-persist-corpses` (`8bb72be`, one commit on upstream `d88b691`) | **Ready to file** (2026-10-27, DECISIONS §454): persistence now default OFF, file written only on change, no shapes, no CHANGELOG. Older `tag-persistence` / `tag-corpses` / `pr/tags-core` branches are superseded. Zoning, corpses and other-guild tags were tested in game on the older build | Older build only | File the PR; one in-game run of `8bb72be` |
| Received tag must match the mob's name | none (two lines) | `fix/tag-name-check` (`342694b`, one commit on `d88b691`) | **Ready to file**: a tag from another zone could land on an unrelated mob with the same spawn id | No | File the PR |
| Tag pictures from a folder | [`zeal-tag-icon-files`](zeal-tag-icon-files/) | `tag-icon-files` (`b20331f`, stacked on `tag-shapes`) | Pushed branch, not filed | Yes | In-game: drawing, orientation, PNG support |
| Cursor while the UI is hidden (F10) | [`zeal-hide-ui-cursor`](zeal-hide-ui-cursor/) | `hide-ui-cursor` (`2433493`) | Pushed branch, not filed; compiled by GitHub, not run in game | Yes | In-game: all cases |
| Guild banners, icons, automatic guild marks | [`zeal-guild-emblems`](zeal-guild-emblems/) | in `tag-shapes` (`c2a5333` banners and icons, `f777d81` auto marks) | Pushed branch, not filed; icons seen in game 2026-09-26 | Yes | In-game: banners and the 12 auto-mark checks |
| Spawn ids on the pipe | [`zeal-spawn-id`](zeal-spawn-id/) | `pipe-spawn-id` (obsolete) | **Merged**, upstream PR 229, Zeal 1.4.6 | Yes (1.4.8 base) | Regression checks only |
| Main assist marker, `%tid`, `/target` by tag | [`zeal-main-assist`](zeal-main-assist/) | `ma-draft` (`206b884`) | Pushed branch, not filed; compiled by GitHub 2026-10-10, not run in game | Yes (`3c4766c`) | In-game: all cases |
| Mez and slow keys (`^MEZ^`, `^SLOW^`) | [`zeal-mez-slow-keys`](zeal-mez-slow-keys/) | `ma-draft` (`116d3ed`) | Pushed branch, not filed; compiled by GitHub 2026-10-10, not run in game | Yes (`3c4766c`) | In-game: all cases; breaks `^M^` (the website's symbol list still shows `^M^`) |
| Auto raid lead, persisted `/ari` | [`zeal-auto-raid-lead`](zeal-auto-raid-lead/) | `raidlead-draft` (`b15b8a2`, on `ma-draft`) | Pushed branch, not filed; compiled by GitHub 2026-10-10, not run in game | Yes (`3c4766c`) | In-game: a two-person raid test |
| Guild icon and banner refresh | [`zeal-guild-icon-refresh`](zeal-guild-icon-refresh/) | `guildicon-draft` (`dca0b85`, on `ma-draft`) | Pushed branch, not filed; compiled by GitHub 2026-10-10, not run in game; banners show each guild's icon in its own colours plus its full name (DECISIONS §226) | Yes (`3c4766c`) | In-game: all cases |
| PoP flags saved on `/camp` | [`zeal-popflags-export`](zeal-popflags-export/) | `pr/popflags-export` (`d36a336`, one commit on upstream `d88b691`) | **Filed, upstream PR 253** (2026-10-27). Updated the same day: the reply shows in chat by default, `/outputfile hidepopflags` hides only the reply's lines, and the capture takes only reply-shaped lines (the earlier version cleared every server-colour line for ~3 s). Mimic reads the file from agent 4.0.31 | Yes (`75e85e4`, older capture) | Review; one in-game run of `d36a336` |
| Spell id in spell info (`/spellid`) | [`zeal-spell-id-tooltip`](zeal-spell-id-tooltip/) | `spell-id-tooltip` (`67cb705`) | Pushed branch, not filed; compiled by GitHub 2026-10-10, not run in game (DECISIONS §229) | Yes (`035d8a3`) | In-game: all cases |
| Target position past 250 units | [`zeal-target-loc-range`](zeal-target-loc-range/) | `target-loc-range` (`f987701`, TEST ONLY: removes the cap; the ask is a raise to ~450) | Request drafted, not filed (DECISIONS §243) | Yes (`5bcd34a`) | In-game: target at 260–420 units, `target_loc` keeps arriving; rebuild the branch as the 450 change before filing |
| `/pipedelay` printed 0 | none (one line) | `pr/pipedelay-print` (`488ec48`) | **Filed, upstream PR 254** (2026-10-27); printed the setting object instead of its value | Yes (`5bcd34a`) | Review |

`raidlead-draft` and `guildicon-draft` each sit on `ma-draft` (side by side, not on each other). All three were pushed on
2026-10-10 and merged into `test-all` (`3c4766c`), whose GitHub build passed.

Other material in this folder: `zeal-guild-emblems/PROPOSAL.md` (the two guild-mark directions and the pick) and
`zeal-spawn-id/` (the filing record for PR 229).

## The showcase branch

The fork's `showcase` branch holds only documents: a README index with thumbnails, one folder per change with its text and
images, and `posters/` with a poster (1200x675) and a PR header banner (1280x320) for each change, all made from one template.
Its README explains how to make a new poster, and what to do when a pull request is filed (set its status and link, re-run
the script, commit).
