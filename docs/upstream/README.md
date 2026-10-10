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
`59bbfca`): https://github.com/davehess/Zeal/releases/tag/test-all-build. Branch heads below are as of 2026-10-10.

## Index

| Change | Folder | Fork branch (head) | Status | In test-all build? | Needs |
|---|---|---|---|---|---|
| Tag icons, numbered badges, lettered paws | [`zeal-tag-shapes`](zeal-tag-shapes/) | `tag-shapes` (`f777d81`) | Pushed branch, not filed | Yes | In-game: banners, `/tag help`, old-client view |
| Tag persistence (crash, relog, switch, other zones) | [`zeal-tag-persistence`](zeal-tag-persistence/) | `tag-persistence` (`6ab82a9`) | Pushed branch, not filed | Yes (as `cbd4f38`; `6ab82a9` adds one `std::min` fix) | In-game: whole checklist |
| Tag corpses | [`zeal-tag-corpses`](zeal-tag-corpses/) | `tag-corpses` (`7f7c824`) | Pushed branch, not filed; NPC and player corpse tagging tested in game 2026-10-09 | Yes | In-game: the rest of the cases |
| Tag pictures from a folder | [`zeal-tag-icon-files`](zeal-tag-icon-files/) | `tag-icon-files` (`b20331f`, stacked on `tag-shapes`) | Pushed branch, not filed | Yes | In-game: drawing, orientation, PNG support |
| Cursor while the UI is hidden (F10) | [`zeal-hide-ui-cursor`](zeal-hide-ui-cursor/) | `hide-ui-cursor` (`2433493`) | Pushed branch, not filed; compiled by GitHub, not run in game | Yes | In-game: all cases |
| Guild banners, icons, automatic guild marks | [`zeal-guild-emblems`](zeal-guild-emblems/) | in `tag-shapes` (`c2a5333` banners and icons, `f777d81` auto marks) | Pushed branch, not filed; icons seen in game 2026-09-26 | Yes | In-game: banners and the 12 auto-mark checks |
| Spawn ids on the pipe | [`zeal-spawn-id`](zeal-spawn-id/) | `pipe-spawn-id` (obsolete) | **Merged**, upstream PR 229, Zeal 1.4.6 | Yes (1.4.8 base) | Regression checks only |
| Main assist marker, `%tid`, `/target` by tag | [`zeal-main-assist`](zeal-main-assist/) | `ma-draft` (`206b884`) | Local draft, not pushed, not compiled | No | Build, then all cases |
| Mez and slow keys (`^MEZ^`, `^SLOW^`) | [`zeal-mez-slow-keys`](zeal-mez-slow-keys/) | `ma-draft` (`116d3ed`) | Local draft, not pushed, not compiled | No | Build, then all cases; breaks `^M^` |
| Auto raid lead, persisted `/ari` | [`zeal-auto-raid-lead`](zeal-auto-raid-lead/) | `raidlead-draft` (`b15b8a2`, on `ma-draft`) | Local draft, not pushed, not compiled | No | Build, then a two-person raid test |
| Guild icon and banner refresh | [`zeal-guild-icon-refresh`](zeal-guild-icon-refresh/) | `guildicon-draft` (`b9f0cff` plus uncommitted work) | Placeholder, work in progress | No | Branch to be finished |

`ma-draft`, `raidlead-draft` and `guildicon-draft` are stacked: each sits on the one before it, and none is in the test-all build.
Pushing any of them needs a build and the guild lead's go-ahead first.

Other material in this folder: `zeal-guild-emblems/PROPOSAL.md` (the two guild-mark directions and the pick) and
`zeal-spawn-id/` (the filing record for PR 229).

## The showcase branch

The fork's `showcase` branch holds only documents: a README index with thumbnails, one folder per change with its text and
images, and `posters/` with a poster (1200x675) and a PR header banner (1280x320) for each change, all made from one template.
Its README explains how to make a new poster, and what to do when a pull request is filed (set its status and link, re-run
the script, commit).
