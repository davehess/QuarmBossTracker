# Decisions — 2026-09-21

## 1. Understand-Anything assessed — not adopted, one bounded trial offered

The guild lead: *"I know we're doing a lot to help people understand things, but
please look at this."* — `github.com/Egonex-AI/Understand-Anything`, MIT
(© Yuxiang Lin and Infinite Universe, Inc.), a Claude Code plugin that builds a
knowledge graph of a codebase and serves an interactive dashboard over it.
Reported at ~83k stars; ⚠ **unverified from here** — this session's GitHub access
is scoped to our own repository, so that figure comes from the project's own page
and a third-party index, not the API.

### What it is
Tree-sitter for the structural half (files, functions, classes, imports,
inheritance) plus a **seven-agent LLM pipeline** for the semantic half:
plain-English per-file summaries, architectural layer assignment, business-domain
mapping, and dependency-ordered guided tours. Writes `.ua/knowledge-graph.json`
(+ `config.json`, `intermediate/`, `diff-overlay.json`) into the repo. Commands:
`/understand`, `-dashboard`, `-chat`, `-diff`, `-explain`, `-domain`,
`-knowledge`.

### ⚠ We already own the deterministic half of this, on purpose
**`scripts/graphify.sh`**, adopted 2026-09-13 (`DECISIONS-2026-09-10.md`). Same
tree-sitter core, **code-only — no LLM, no API key**: 10,340 nodes · 20,185 edges
· 695 communities, rebuild in ~30s, outputs gitignored. The guild lead's call then
was *"regen script in, outputs out, hook not installed"* — the hook specifically
because *"'query the graph before reading files' is the opposite of the lesson
that week (read the block, not the hits)."*

So the question is not "is a code graph useful", which is settled. It is narrower:
**does the LLM layer answer what the graph alone could not?** That test already
exists — the four real problems of that week:

| Problem | Graph? | Would the LLM layer? |
|---|---|---|
| The relay leak — a payload field one process never sent | no (invisible to a call graph) | **no** — it summarises files, it does not diff a data contract across an HTTP boundary |
| Quiet-mode split — one config key through 16 gates | no (zero nodes for `quietMode`) | **maybe** — semantic search over summaries could surface it. But `grep quietMode` already does, in a second, for nothing |
| The `#if 0` miss | no (tree-sitter does not evaluate the preprocessor) | marginal — an LLM reading the file might notice |
| Target-of-target | no — grep + `HOW-ITS-BUILT.md` did it | no |

**One of four, and that one is already a one-second grep.** That is the whole
case against wiring it in.

### What it would genuinely add, and why the timing is not silly
Per-file plain-English summaries, semantic search, a domain view, and
**dependency-ordered guided tours**. Those are *onboarding* features, not
maintenance ones — and onboarding just became a real concern rather than a
hypothetical: the relicense to AGPL, `DESIGN-guild-kit.md`, and the brochure aimed
at other guilds all assume an outside maintainer eventually lands on an 18k-line
`index.js` and a 35k-line agent. Nothing we have is a *reading order*.
`CLAUDE.md` is a map and `HOW-ITS-BUILT.md` is an index; neither says "start here,
then this."

### ⚠ Why it does not go in as-is — four repo-specific hazards
1. **It generates a second architectural authority.** `CLAUDE.md` says at the top
   that it is the authority, and it is hand-maintained precisely because the
   corrections are load-bearing and invisible to a generator: the Zeal spawn-id
   boundary is **superseded** and says so, Supabase is **Pro, not free tier**,
   historical chat is *collection in scope, display not*, Discord is *no longer*
   a source of truth. An LLM summarising this repo will restate the stale version
   of every one of those, confidently. This is the same trap already recorded for
   `/impeccable init`: *"Three competing doc roots is how the next session reads
   the wrong one."*
2. **`--auto-update` is a post-commit hook** that re-analyses changed files on
   every commit. `main` runs 12–42 commits/day. That is a recurring LLM spend
   attached to `git commit`, and it is the same hook-shaped thing already declined
   for graphify.
3. **Cost, at a moment we are counting it.** Its own README warns the first run
   *"can consume a significant number of tokens on large projects"* and gives no
   figure. Our large project is two monoliths, `web/`, Mimic, 236 migrations and
   246 test files. `COSTS.md` puts development tooling at ~5× infrastructure and
   exists to justify donations; an unbounded number does not belong in it.
4. **Install method.** The README offers `curl -fsSL … | bash` and
   `iwr -useb … | iex`. Use neither. The marketplace route
   (`/plugin marketplace add`) is the supported one — and note a plugin install
   does **not** survive a fresh cloud container, which is exactly why `impeccable`
   and `ponytail` were *vendored into committed `.claude/skills/`* instead.

Licence is the one clean part: **MIT**, so vendoring a piece of it is permitted
and compatible with our AGPL.

### The call
**Not adopted.** Same verdict and the same reasoning as `rtk` and
`ui-ux-pro-max-skill` on 2026-09-13: a good tool that overlaps something we
already decided the shape of.

**The one trial worth running**, if the guild lead wants it: point it at
**`packages/wolfpack-logsync/` alone** — one self-contained surface, no bot, no
web, no Mimic — and compare its guided tour against that surface's
`HOW-ITS-BUILT.md` rows. Bounded spend, and a clear pass/fail: *does it say
anything the index does not?* If yes, the output is a **draft for a human to
edit into `CONTRIBUTING.md` or a new onboarding doc** — never a generated file
committed as an authority, and never the auto-update hook.
⚠ A cloud session cannot run this: `/plugin` is a CLI command, and the container
is ephemeral. It is a desktop-session job.

## 2. Also today

- **Web 1.7.44** — the top nav's category menus were clipped out of existence on
  the full-width bar (`overflow-hidden` on the header row vs Nav's `absolute
  top-full` panel); fixed with `overflow-x-clip`, which was measured in Chromium
  to leave the fold's `scrollWidth` reading identical. Review-page time columns
  went `w-14` → `w-16` (measured: `10:47 PM` is 57.8px against 56px). The agents
  page now always lists the two most recent stables, which a fast beta line had
  pushed off the list entirely.
- **Agent 3.6.48** (`beta`, `v2.6.9-beta.10`, installer verified attached) — the
  crash review's driver-churn verdict now prints the dgVoodoo2 URL, both
  filenames and the destination. A member lost an evening hunting the Zeal repo
  for files that were never in it.
- **`eqgame.exe` @ `0x004E138A` identified** as the client failing to survive a
  graphics-driver reset — see `RUNBOOK-client-crash-triage.md`.

## Open — read this first

| Item | Where it stands | Next |
|---|---|---|
| **Stable Mimic 2.7.3** | **Cut 2026-09-28 (§72; agent 3.7.37):** everything on beta since 2.7.2. F/Q/V, UI pack checkboxes, Rallos Zek kills, your DPS row, per-mob tick fades, instant charm break. Beta re-parked at 2.7.4 | the guild lead: accept the update and try F/Q/V on a quest NPC; the quest-history question (§72) |
| **Rallosian Glory PvP kills** | **Whole fleet with Mimic 2.7.3 (§66, §72); bot 3.1.164.** The new "Rallos Zek watches as X spills Y's blood" line is read, guilds come from `/who` and the roster, and the old and new wordings of one kill post once. Kills from about 19:50–21:30 UTC on 2026-09-28 were missed: the uploading machines still ran 3.7.35 (§66a) | the guild lead: run Opt-in Logs over that afternoon to recover them; anyone: paste the first "worthy conquest" line when one appears |
| **/who overlay: Zone column** | **Beta 2026-09-29 (§73, agent 3.7.38).** `ZONE` in the title bar shows each player's zone from their last /who, off by default | the guild lead: try it after a `/who all`; say if it should be a filter or a sort too |
| **Target Info F/Q/V (Faction · Quest · Vendor)** | **Stable in Mimic 2.7.3 (§70, §71a, §72; bot 3.1.168).** What to say with `/say` chips (every word a branch needs, "sit first" + `/sit` where the NPC checks), the hand-in, who's next with `/map`, a merchant's stock | the guild lead: forward/back through quest NPCs you targeted, as a tab or its own overlay (§72) |
| **PoP checklist: Willamina's full chain** | **Live 2026-09-28 (§71, web 1.8.35).** Starts at Agrakath Theric with the book from Myrist; ten hand-ins and the story in folding sections | anyone: tell us which other chained steps deserve the same treatment |
| **Quest NPC lines DM'd as tells** | **Fixed on main 2026-09-28 (§69, bot 3.1.165).** Script-printed "X tells you" lines are dropped by exact sender + text; 8 stored rows deleted | next session: `/abc 2` users' tells are not captured at all (agent pattern, beta) |
| **UI pack options as checkboxes** | **Stable in Mimic 2.7.3 (§68, §72).** None on by default, any mix, clashes greyed with the shared window named, untick restores the pack's own file, updates keep the ticks | anyone with Nillipuss: tick Bank - Default layout, `/reloadskin`, and check the bank |
| **Missing spells: vendor links + 📍 `/map`** | **Live 2026-09-28 (§67, web 1.8.32).** Vendor and dropper names open their NPC page; each vendor has a 📍 that copies `/map Y X` for that zone | none; the boss guide's spawn lookup has the broken embed §67 found (separate task) |
| **PoP checklist, `/pop/guide`** | **Live 2026-09-28 (§65, §65a, web 1.8.31).** 74 steps in EQProgression's order, Solo / Group / Raid and must-have; copy buttons for every `/say` and `/map Y X`; item cards on hover; ticks per character, recorded flags tick themselves | members: use it from launch; anyone: report a step Quarm does differently (the "verify at launch" rows first) |
| **#petstats in the Pet and Charm windows** | **Parser on beta 2026-09-28 (§63, agent 3.7.35).** The sheet (HP, AC, ATK, damage, delay, DPS, resists, 21 slots) rides the Pet/Charm row as `sheet`; nothing draws it yet | the guild lead: pick a display (A strip, B fold-out sheet, C MR badge on Charm) |
| **PoP board vs the 2026-09-28 patch notes** | **Three fixes on main 2026-09-28 (§63a, bot 3.1.163):** Quarm 168→162 h; Mujaki renamed "the Devourer" so the kill matches; "Avatar of Earth" added to the Rathe Council slot. Five bosses still read 72 h the notes do not name | the guild lead: 66 h for Xanamech, Ture, Mujaki, Askr, Charassis, or keep 72; add Mithaniel Marr and the Manaetic Behemoth to the board before Oct 1? |
| **The Aten Ha Ra film on wolfpack.quest** | **On main 2026-09-28 (web 1.8.30, bot 3.1.162; §61, §62, §62b):** `/film`, `/film/making` with find-your-raider on top, and a Gallery on every character page, backed by the private `guild-media` store (628 files, 98 characters). The bot posts one card to #raid-chat. Film hosted on YouTube from links in bot_kv `film_youtube`; the links are still empty | the guild lead: upload both takes to YouTube and send the links (then one SQL update lights the page and the "sung at" links); run the Drive importer before 2026-09-30 04:00 UTC; say yes or no to a ~$37 native-1080p re-render of all 78 clips |
| **eqmimic.quest: Mimic without the Wolf Pack imagery** | **Open 2026-09-28 (§62a).** Everything is AGPL-3.0-or-later already; the installed fleet updates from this repo being public (GitHub releases + raw agent fetch), so a private repo would silently stop updates | the guild lead: decide licence and service model; then first steps are moving the update feeds off this repo and one brand config with Wolf Pack as the first tenant |
| **DPS HUD: your row always, highlighted, a % bar under every name** | **On beta 2026-09-27 (§60).** Your row shows even at zero and is a gold band; every row has a thin bar against the top row. Root cause of the missing highlight: the HUD read keys `/api/state` never sends; it now reads `activeCharacter` | the guild lead: update beta Mimic and check the gold row is yours; the Threat meter has the same bug, unfixed |
| **A member's Sunday-morning batch (feedback acks, charm break, timers, target the pet)** | **2026-09-27 (§59–§59e).** Mimic feedback can be acknowledged from Discord and no longer double-posts (bot 3.1.160–.161, main). Charm break called the instant the line is read, and trigger timers can start at the top (agent 3.7.34, beta). Targeting the pet from the Charm window needs a Zeal change; designed, not built | the guild lead: acknowledge the "via web" copy of the timers report and delete the plain Mimic copy (§59b); pick option 1 (`/targetpet` command) or 2 (click in the Charm window, a policy call) in §59e; the member tests 3.7.34 on beta. **§59f:** the member's other eight reports are investigated and not yet built — the guild lead picks which fixes go into the next beta round |
| **The Vex Thal celebration (Sunday 2026-09-27; an earlier draft said the 28th, which is a Monday)** | **⚠ The Discord embed did NOT post (checked 2026-09-28 13:00 UTC).** The kill relayed at 02:46 UTC (encounter `cae39ee6…`, 10 min 46 s) and `_announceVexThalClearedOnce` logged `[vt-cleared] no #raid-chat channel — skipping` 17 times, once per relaying agent. Cause: it finds the channel ONLY through `RAID_CHAT_CHANNEL_ID`, which is not set on Railway; the other one-shots fall back to the channel named `raid-chat`, which is why the film card at 06:17 UTC posted. No latch was written, and `_announceVexThalFilmOnce` has the same env-only lookup and waits on that latch, so a pasted film link would post nothing either. The embed would have read *kill number 20*, *approximately 22.6 million damage since the first kill on February 26, 2026*. Guild trigger `fdf89cd5…` still enabled. Earlier plan: **Armed 2026-09-27 (§58, reworded §58a).** On `Aten Ha Ra has been slain by`: every Mimic in the zone flashes two lines — *Congrats Wolf Pack on the last Aten Ha Ra of Luclin!* and the guild's damage total since the first kill — speaks them and plays a fanfare (guild trigger `fdf89cd5…`, sound at `/sounds/vex-thal-cleared.wav`); the bot posts one embed to #raid-chat with the same two lines computed live (bot 3.1.159, latched in `bot_kv`). **The film posts itself:** paste its link into the tuning key `celebration_video_url` and the bot puts the video in #raid-chat within a minute (once, after the kill embed) | the guild lead: **disable the trigger** on /admin/triggers; decide whether the celebration posts late (the fix: the same by-name channel fallback in both Vex Thal functions, plus a one-time catch-up for last night's kill) or is skipped (then the film poller must stop waiting on the embed); after either, the pasted `celebration_video_url` posts; send a Mimic Mail from /admin/notices; add the roadmap line then |
| **Mimic 3.0 — the open overlay builder** | **Planned 2026-09-27 (§57).** The catalog of every overlay is `docs/DESIGN-overlay-catalog.md`; the plan with phases, the access options and their costs, and the October 1 answer is `docs/DESIGN-mimic-3.0-overlay-builder.md`. Honest size: 21–34 sessions; **3.0-alpha.1 by October 1 is possible, the full 3.0 is not** | the guild lead: the seven questions in the plan's §8 — window model, snap targets, first parts, the Zeal upstream ask, alpha testers, "see the screen" meaning geometry, and whether alpha.1-by-Oct-1 is the target |
| **Stable Mimic 2.7.2** | **Cut 2026-09-27 (§57)**: everything from beta.15–.21 (agent 3.7.31). Beta re-parked at 2.7.3, agent 3.7.32 | the guild lead: pick bars or dials on the Tick overlay; the #pvp note posts itself once the installer is out |
| **Tick overlay (was Zeal health)** | **Stable in 2.7.2 (§56).** A standalone server tick per character + charmed mobs' own ticks, bars or dials; the Zeal check and this PC's clock offset behind its status line | the guild lead + the co-leader: try both layouts, pick bars or dials |
| **PvP assists for guildmates our agents see** | **Bot 3.1.156 on main; agent 3.7.30 on beta (§54, §55).** Any player's hits or landed debuffs on the victim count; 4-minute window; the bot keeps roster names only and merges the same assist from several witnesses; opt-in logs credit the same way. **§55:** an opt-in parse posts ONE #pvp note (@you, N new kills + assists, per guildmate) and nothing per old event; replayed kills no longer double. **The 23 duplicate kill rows were deleted 2026-09-27 (§56)** | the guild lead: update to the new beta, then Re-run your log in Opt-in Logs; the note lands in #pvp ~90 s after it finishes. Assists from raiders on stable arrive when a stable is cut |
| **The co-leader's feedback batch + Settings drafts** | **On beta, `v2.7.2-beta.16/.17` (§52).** /who fixed height + filters; tray menu always opens + dashboard ⏻ Quit; settings survive a force-close; faster trigger speech; Server tick bar; Settings drafts + close reminder. **`beta.18` (§53): ⤴ beta button on the dashboard next to Check for update** (stable builds; same code as the tray). The co-leader is on stable 2.7.1, which does not have the button | the guild lead: send the co-leader the `v2.7.2-beta.18` installer, or cut a stable (your call). Session: HUD builder mana/endurance split + the half-circle mini HUD; later, the active-character flip-flop |
| **Feedback + suggestions take screenshots** | **Done 2026-09-26 (§51).** Web `/feedback` + roadmap boxes (members, up to 3, 📷 or paste), Discord `/feedback` images kept, officer inbox thumbnails, bot relays images; private bucket. Bot 3.1.154, web 1.8.20; Mimic 📸 in `v2.7.2-beta.15` | the guild lead tries one from each surface |
| **Charm overlay: server tick + mob tick** | **On beta, agent 3.7.25 (§50).** Mob tick learned from DoT ticks + log breaks; "learning" until known | the co-leader: charm with a DoT up (or let one break) and check the M countdown against the next break |
| **EQLogParser-style timer bars + trigger fixes for the guild's co-leader** | **On beta, agent 3.7.24 (§49).** Recharm tick, lull timers and your-spells-on-mobs as filled bars in the trigger window (Suggested → Timer bars); an instant "Your charm broke" alert. Fixed: "Rampage on you" never fired, unticked triggers still fired, `{c}` personal triggers dead after a restart, saves stripped EQLogParser warnings, the Charm overlay's mob-tick countdown stuck | the guild lead: (1) the co-leader is on STABLE 2.7.1 — switch them to beta, or cut a stable; (2) all trigger countdowns as filled bars, yes or no; (3) paste the Discord answer from this session |
| **Zeal: Bandolier chat filter (PR ready)** | **2026-09-25 (§26).** Branch `bandolier-chat-filter` on github.com/davehess/zeal; PR text + test plan in `docs/zeal-bandolier-filter-request.md`; both builds passed in game; **all** bandolier messages now go to the filter, failures in red (the guild lead's call) — `30a79bb` | the guild lead: open the PR upstream (compare link + paste-ready text in the doc). Next candidate: #213 (target level/class/race + loc on the pipe) |
| **Zeal: tags survive crash/relog/character switch + no cross-zone tagging (branch; first build crashed at launch, fixed)** | **2026-09-25 (§28).** Branch `tag-persistence` on the fork (`ca71999`): name check on received tags; per-character `<name>_tags.txt`, restored by zone + spawn id + name, 3 h expiry, `/tag persist` on by default. `0d66a28` crashed EQ at launch (init order; dump symbolized, fixed). **2026-09-26 (§40): players are now kept by name** (`9a3fd09`), so a tagged player keeps the tag through their zoning, a camp or a death; in `test-all` (`d32bed1` now) | the guild lead: build + run the 8-step test plan, confirm or change the four defaults in the PR doc, re-author, open the PR |
| **Zeal: icon tag shapes, numbered badges, lettered paws, traced wolf, guild banners + icons (branch; rendered in game 2026-09-26, §39)** | **2026-09-25 (§27, §30–§33).** Branch `tag-shapes` on the fork (`3c02f65`): letters `K X A D F T M U N H E $` = skull, X, sword, diamond, flame, star, moon, lasso, lute, shield, euro, dollar; **`^WP^` = the wolf**; `^1^`–`^12^` badges; `^P0^`–`^PZ^` paw with a charmer's initial; **`^B<code>^` banner + `^I<code>^` icon for 30 guilds** (`/tag guilds` lists them). `test-all` = `d32bed1` (now with tag pictures §38 and player tags kept by name §40). **In game 2026-09-26:** every symbol, badge, lettered paw and all 30 guild icons draw correctly, including over other guilds' players | the guild lead: try the banners (`^B<code>^`, not in the screenshots yet), correct any guild codes, re-author, open the PR. Ours after upstream ships: agent `_ZEAL_TAG_SHAPES` + prettyprint regex learn the new keys |
| **Zeal: tag corpses (branch; built, not yet in game)** | **2026-09-25 (§34).** Branch `tag-corpses` on the fork (`aa975e1`, from main): NPC + player corpses taggable; a mob's pre-death tag stays hidden on its corpse, tags set on the corpse show; `/tag target` picks a corpse only by its own tag. In `test-all` (`d32bed1` now). A target whose model is not drawn is still refused (spawn-id hold proposed, not built) | the guild lead: try the "Corpses" steps in `TRY-IN-GAME.md`; say whether far/unloaded targets need the spawn-id hold; open the PR (`docs/upstream/zeal-tag-corpses/`) |
| **Zeal: guild logos as tag pictures from a folder (branch; built, not yet in game)** | **2026-09-26 (§38).** Branch `tag-icon-files` on the fork (`ac5d177`), in `test-all` (`d32bed1` now): `uifiles/zeal/tagicons/<name>.png` (or `.tga`) shows as `^I<name>^`, like target rings; a picture beats the built-in icon with the same code; files checked before decoding (PNG/TGA header, ≤512 px, ≤1 MB); `/tag icons` lists and reloads. Draw path not compiled here; logic tested + mutation-checked | the guild lead: rebuild `test-all`, run TRY-IN-GAME → "Pictures" (the UP card first: it catches a mirrored quad); send the reply to the requesting guild; open the PR (`docs/upstream/zeal-tag-icon-files/`) |
| **Zeal tag icons gallery `/zeal-icons` (beta preview, two layouts)** | **2026-09-26 (§39).** The guild lead: *"yes, host the picture files in the gallery"*. Public page on `beta`: every guild's banner + icon with copyable keys, symbols/badges/paws, Europa's picture as `EUR.png`/`EUR.tga`; logos come in via Discord, no uploads. **A** `b.wolfpack.quest/zeal-icons` (one catalogue page) · **B** `b.wolfpack.quest/zeal-icons?v=b` (guild index + `/zeal-icons/<code>` per guild). Beta `f71e9975` | the guild lead: pick A or B. Session: graduate the pick to main (roadmap entry, web bump, footer link), delete the other; optional for B, the guild's icon in Discord link previews (touches the shared preview route) |
| **HUD tracking arrows (agent 3.7.18 on beta)** | **2026-09-26 (§35).** A member's idea, the guild lead's "YES": eight arrows round the HUD ring, the tracked mob's direction lit gold, from the client's own tracking lines (eqstr 12676–12680). ⚙ → Tracking: all/lit + size. Beta `fe43d0b8`. **The wording comes from the client string file, not yet a real log** | a tracker on beta: track a mob and confirm the arrow follows; if the words differ, send the log lines. Later: turn-with-you rotation needs EQ's heading direction checked in game |
| **Security audit before a public guild-logo page** | **2026-09-26 (§36).** Web + bot + database audited; the most severe finding reproduced locally first. Two fixes live: web 1.8.10 (every officer page gates itself) and bot 3.1.150 (agents get only the tuning keys their role needs). **Findings are in the guild lead's private report, not here.** Logo page: gallery + Discord intake first; no outsider sign-in until the membership fixes land | the guild lead: rotate the credential named in the report; check the Supabase Auth settings it lists; pick the fix order. Session: membership gate (web + database) next, then the logo gallery |
| **Private briefing doc (read-aloud status + private decisions)** | **2026-09-26 (§37).** A private claude.ai doc, "Wolf Pack — private briefing", found by title in the guild lead's artifact list. It holds the read-aloud status, the waiting-on-you list, private decisions and the private audit report. Link never committed | Every session with the docs connector: rewrite its Read aloud section when you finish. The guild lead: try asking Claude in the phone app to read it |
| **Mimic 3.0 = the overlay engine, with an alpha channel** | **2026-09-26 (§36).** One transparent freeform view combining every overlay, later screen-aware layout. Alpha channel planned: its own updater channel + opt-in, pruned alpha releases, the workflow on the branch | build the alpha channel when 3.0 work starts |
| **Clicky charge counters on the HUD** | **2026-09-26 (§36).** From a zeal-suggestions thread (last-charge warning). Quarmy export count + observed clicks → charges left, as a HUD builder part | session: next after the security follow-ups |
| **Quests vs inventory sharing split · keys for every keyed zone** | **2026-09-25 (§24).** Keys: live — five door-derived keyed zones, quest rewards excluded, 168 ms per page. Split: **live, web 1.8.8**; the 11 characters with the old combined switch keep public quest pages and their inventory pages went private (the guild lead's call) | optional: catalog quests for the Charasis + Sleeper's keys; a guild-wide "who can enter" keys view on the sweep |
| **Agent stalled mid-fight (guild lead's, Emperor Ssraeshza)** | **Cause found + fixed on beta, agent 3.7.17 (§23 follow-up).** Cross-flush recursion: two peer trackers flushed each other until the stack overflowed (4,656 levels), swallowed by a bare catch. Reset-before-propagate + a real test; three earlier cascades in the same logs. Server not flooded | (1) the guild lead: take the beta build, confirm no `[cross-flush]` storms next raid; (2) graduate to stable — the stable agent 3.7.16 has the same bug (the guild lead's call); (3) optional, still open: a hang watchdog in Mimic |
| **Privacy audit + statement rewrite** | **2026-09-25 (§21).** `/privacy` + `docs/PRIVACY.md` rewritten to what the code does today (web 1.8.5, main after the raid freeze). Two public-executable SECURITY DEFINER functions revoked live. Security findings deliberately not written into this public repo | the guild lead's calls: (1) live status + raid roster — honour both exclusion switches, raid-only, guild members only? (2) Mimic's inert Tells radio — remove or wire up, and fix its "never upload / encrypted" copy (`apps/mimic/settings.html` ~220); (3) a retention schedule — `page_views`, chat, tells, the archive's forever copy; (4) inventory sharing split from "Quests: public", and officer inventory access kept (now disclosed) or removed; (5) `exclude_inventory` honoured on `/inventory` + `/spells` and purging on set; (6) member mirror drops people who left, Mimic tokens expire; (7) which Discord channels Visitor/Applicant roles can read; (8) Vercel toolbar off for Preview; (9) security headers + `poweredByHeader: false`; (10) whether the Supabase MCP stays auto-allowed; (11) the feedback log filter drops by default; (12) names still in `/ai`, `/bards`, the `/mimic/mini` mocks, and the SUNO default in `index.js` + `.env.example`. **Once any of these ships, update `/privacy` in the same change** |
| **Jev context compaction (`fast-jev-compaction`)** | **assessed 2026-09-23 (§6), not adopted. Laya, the open local alternative, assessed 2026-09-24 (§14), not adopted either:** it would keep the data local, but the plugin cannot be pointed at it without a fork, its server rejects the plugin's default request size, and it reads only the first 512–1,024 tokens of the state. §6 as it stood: Real tool, real vendor, and it fixes a real loss — but our compaction pain is CROSS-session (cloud ↔ desktop cannot share a conversation at all) and Jev only helps within one session. It also routes every user and assistant message verbatim, plus every tool input, to a third-party early-access API | the guild lead's call, and it is a privacy call, not a tooling one. ⚠ **Blocked from here**: `typesafe.ai` and `docs.typesafe.ai` are both refused by the cloud egress proxy, so the data-retention/training policy, the price, and waitlist status are unverified. A desktop session can read them |
| **Tower archive: CAUGHT UP 2026-09-23** | Merged the 09-23 dump (131 → 141 tables staged, ~2.72M → 3.44M rows), then 09-11, 09-17, 09-22 and 09-23 again, latest last. Recovered `buff_casts` 09-06 → 09-15 (+78.6k from the 09-11/09-17 dumps alone) and the `target_observations` production swept this morning (+78.7k). Threat snapshots already complete: 1,201,796 rows in the archive vs production's count at dump time | ⚠ **Production watermark deliberately NOT set** — see §8: the per-fight graphs now exist (bot 3.1.141), but July's snapshots cannot be graphed at all, so setting it is now the guild lead's July decision, not a technical gap. Two more facts for that call: the snapshot_at index was never applied (CONCURRENTLY cannot run in the migration runner), and a DELETE does not shrink the database — the "~890 MB reclaimed" claim in `CLAUDE.md`/`COSTS.md` is really "no growth for about a month" unless VACUUM FULL or pg_repack runs. Optional: merge the 09-01 dump (then latest again) for `buff_casts` 08-25 → 08-29 |
| ~~⚠ **Tower archive: five merge bugs fixed, catch-up IN PROGRESS**~~ (superseded by the row above) | 2026-09-23. The nightly merge failed 17 nights. Root cause was `encounters` never restoring into the snapshot (its id default lives in the `extensions` schema, which `--schema=public` never creates); four more bugs sat behind it (alphabetical order, one conflict target, DISTINCT FROM joins, generated/identity columns). All fixed; `archive-merge.sql` on Tower is now the repo's file (md5 `0b2ceb1a`), its own `refresh-local-archive.sh` carries the extensions block, 20/20 self-test on Tower. The last run was started 06:2x PDT and appeared to hang in the restore | find out whether that run finished or collided with the 05:30 nightly job (§7 has the check). Then merge the older dumps oldest-first and latest LAST — `docs/PATCH-tower-merge-order.md`. ⚠ `buff_casts` 09-06 → 09-15 is **recoverable** from the 09-11+ dumps if still on disk (an earlier note here said lost — wrong). ⚠ `target_observations` was swept in production at 2026-09-23 04:00 UTC; the 09-22 dump holds them, the 09-23 one does not. Then the production watermark |
| **Duplicate callouts** | **DONE 2026-09-23 (§7).** Five guild triggers disabled — each doubled by a built-in agent callout on the same line. No guild-vs-guild overlaps exist (4,321 spell lines checked) | nothing. Re-enable the slow ones if slows on ADDS need a callout: the built-in is main-target only |
| **Item page: recipes + quests, B or C** | **On beta 2026-09-24 (§12).** Quests from Quarm's own scripts (Orc Scalp, Bone Chips now match PQDI) + a Tradeskills section in two layouts + `/db/recipe/<id>`. PQDI links fixed on production (web 1.8.2) | the guild lead compares `b.wolfpack.quest/db/item/13073?v=b` and `?v=c`, picks one; graduate it with the Quests section and the recipe page, delete the other |
| **HUD (was "Me"): one HUD + a ⚙ builder, and Box (was A); C retired** | **On STABLE, Mimic 2.7.1 / agent 3.7.16 (§11, §13 rounds 2–5, §15 round 6, §16 round 7, §17 round 8, §18, §19).** §19: not dockable; ✥ [Box\|HUD\|⚙] ✕ centred under the ring, no name. §18: C removed, A renamed Box, the HUD the default; HUD ✥/✕ under the tick and swing bars, its background a shadow; Box without a card, thin endurance. Round 8: the swing timer is fitted from log seconds + arrivals (was ~240 ms off); hit columns hug the ring, out flush right, in flush left; older rounds one number each, the newest two hit by hit; procs purple; target name on top of its bar, level, class, resists and slow curved inside; ready is always ✓. Round 7: a round of hits on one line; in/out swapped; the name along the inside of its bar, its target on top; FD ✗ on a failed feign; cast time from the cast bar (clickies); builder with All-text and a ↺ per line; a Shadow Knight mob's Harm Touch on Target Info. Round 6 as follows: One HUD built from parts in a ⚙ checklist that opens BESIDE the ring, saved per character, with a text-size slider per part; thin lines by default. Target: level and class under its bar, F/R fists for flurry/rampage, summon mark at 97%, enrage outline on the last 8%, nothing but the name on a corpse. Hit columns are ledgers: each mob's running total on top, the last few rounds as separate hits under it, older hits sliding up into the total, which drops out when the mob dies. Target Info no longer takes a player's level from /consider | the guild lead plays with round eight and says whether the ⚙ opens a NEW dashboard window or reveals one already open (§17). Optional: the one-line Zeal PR makes the swing timer exact |
| **Contributing: AI brief + public roadmap refreshed** | **On `beta` 2026-09-25 (§20); main after the raid freeze (web 1.8.4).** Stale items pruned against the ledger, #209–#211 minted, the /roadmap 404 link fixed, nineteen member names removed from the roadmap | the guild lead hands out the brief link; a sweep of the names left in `STATUS.md` and two code comments |
| **Mimic mini mode — the nine renditions** | **Built and on stable, Mimic 2.7.1 / agent 3.7.16 (§19).** Three data gaps: Target Info has no ROOT row (the agent does not flag roots), Charm shows no MR (no resists in its data), Pet shows the haste buff's name, not its % | the guild lead tries them in raid; then, if wanted: the agent flags roots (SPA 99) like pacify; a name → haste % table for pets; resists into the charm data |
| **Colour-blind themes, opacity split, "key in use"** | **On STABLE, Mimic 2.7.1 / agent 3.7.16 (§18, §19).** Three fitted colour matrices; Opacity = the whole overlay, Background its own slider (old values migrate once); a taken hotkey is named, another program's is detected | the guild lead tries the three themes with someone who has that colour vision, if anyone in the guild does — the fit is measured, not yet seen by a colour-blind eye |
| **A hotkey per overlay · DPS History fight list · L size 420 px** | **On beta, agent 3.7.11 (§13, after round five).** Hotkey column on the dashboard's Overlays table (no default keys; refused keys shown red). History lists the last six fights on the right. L is 420 px for every overlay | the guild lead sets a key or two and checks the History list at L size. Optional: show each overlay's key in the tray menu |
| **Cursor with the UI hidden (F10)** | **Answered 2026-09-24 (§13).** No client or Zeal setting keeps it; the game draws the cursor as part of the UI, and eqw.dll hides the Windows cursor over the game | the guild lead passes on options 1–2 (close windows instead of F10; a PowerToys crosshair). Decide whether to ask the eqw_takp or Zeal maintainer for the real fix |
| **Mob mana drains · PvP drain tally · player level on Target Info** | **On beta, agent 3.7.4 (+ bot 3.1.147), 2026-09-24 (§11).** Server rules verified from source; high-level NPC cut applied; con phrases for blue/green are learned, not typed | test in game: a ToT on a raid mob should read −105; /consider an anonymous player for a range. Stable with the next cut |
| **Next five from the roadmap** | **Proposed 2026-09-24 (§11):** debuffs by spawn id · mez owner + timer · same-name tracking by spawn id · charm credit by `pet_id` · one archive entry per fight | the guild lead picks order |
| **Deathrolls** | **Recording + Discord post LIVE with bot 3.1.142 (§10).** Display option A shipped to beta (agent 3.7.1: one line in the Rolls card and the Command Center, whose turn while live). /fun card **graduated to production 2026-09-24 (web 1.8.1)** at the guild lead's word. Tonight's first game backfilled as a record (not posted) | the Mimic display rides the next stable cut; nothing else |
| **Extended Target: a `tags:` row piled up tags on mobs already dead** | **FIXED bot 3.1.143 (2026-09-24).** The guild lead picked option 1 (each distinct tag once; option 2, a 2-min expiry for unmatched tags, not taken) plus the spawn-id matching: `_extPlaceTags` now puts a tag on the row whose raiders' Zeal reports its spawn id | nothing. Tags still live 10 min after death; if one stale chip still bothers anyone, option 2 is the next step |
| **Reply shape** | 2026-09-24, the guild lead: *"TLDR up top, details in the middle, todo at the end, marked with steps."* Now a working rule at the top of `CLAUDE.md` | nothing |
| **Cloud sessions → Tower over Tailscale** | **WORKING 2026-09-23 (§9).** Database verified end to end as `claude_ro`; Coolify reachable. ⚠ `COOLIFY_TOKEN` in the environment holds the setup brief's placeholder text, not a token, so Coolify answers 401 | the guild lead pastes the real read-only token into `COOLIFY_TOKEN`. Rotate `TS_AUTHKEY` before it expires (90 days from 2026-09-23). Coolify's web UI returns 500 at `/` (the API is fine) — look when next in Coolify |
| **Trigger disables never reached the fleet** | **FIXED 2026-09-23 (§7)** — bot 3.1.139, on `main` since the 467b0fc push. Worked around in data meanwhile | nothing |
| **UI calls made on the guild lead's behalf today** | 2026-09-23, on `beta`. Extended Target's toggles drop to icons below 380px wide (alternative: a two-row header that keeps the labels). Settings columns via a load-time section wrap (alternative: pure CSS columns — cheaper, but splits a section's controls across two columns). Roadmap entry titled with the plain version string. **All of it went stable as Mimic 2.7.0 / agent 3.7.0 on 2026-09-23, at the guild lead's word, unnamed** | the guild lead can still swap either UI alternative in a 2.7.x beta; a release name can be added to the roadmap entry any time |
| **Understand-Anything** | **assessed 2026-09-21 (§1), not adopted.** Overlaps `scripts/graphify.sh`, which already owns the deterministic half by decision; the LLM layer answers 1 of the 4 problems that test was built on, and that one is a grep | the guild lead's call on the bounded trial: run `/understand` against `packages/wolfpack-logsync/` **from a desktop session**, diff its tour against `HOW-ITS-BUILT.md`. Output is a draft for a human, never a committed authority. No auto-update hook, no `curl \| bash` |
| **Target Info: mana bar + Factions tab** | **BUILT 2026-09-22** — bot 3.1.130 on `main` (mob-info carries `mana`, per-spell landing text, faction rows), agent 3.6.50 + overlay on `beta`. Identification measured at 97.6% via `npc_spells_id` + level, cast time splitting 151 of the remaining 185. 27 tests, all running the real functions, all mutation-checked | the guild lead compares the two views on beta with the ⚡ toggle. ⚠ **Resting regen is NOT implemented** — `eqemu_npc_types` has no `mana_regen` column, so a reset restores to full and `_NPC_MANA_REGEN_PCT_PER_TICK` is left null. **A local session against the `peq` DB is the only way to get the real rate** — and to confirm Quarm NPCs spend mana at all |
| Crash reports are opt-in and OFF by default | open — a Mimic user can read a perfect local diagnosis while our table has nothing, which is why 2026-09-20 was triaged off screenshots | consider defaulting the toggle on, or prompting once after a raider's first crash |
| Crash review headline says "inside the EverQuest client" when the same dump shows GPU churn | open | for an `eqgame.exe` fault with driver churn, say the driver reset and the client could not survive it |
| ⚠ `scripts/` missed by the 2026-09-16 name sweep | open — `read-minidump.py` (prose ×2), `mimic-netdiag.ps1` (prose **and** user-facing output), `gen_screenshots.py` (bakes a name into published screenshots). `test-archive-merge.sh` is fixture DATA and stays | sweep the three; treat `gen_screenshots.py` like the `OverlayDemo` swap |
| ⚠ **Nothing warns a raider that their EQ log has grown to gigabytes** | open (2026-09-22). A member's `eqlog_<name>_pq.proj.txt` reached **1.33 GB, unbroken since Nov 2024**, and they only noticed by accident. Our own source already says players rotate by hand *"to keep it small — EQ slows down on multi-GB logs"*, but no surface says so: nothing in `docs/`, nothing on the dashboard. ⚠ And renaming in place does not help — `_isEqLogFile` accepts `.txt2`/`.txt.old`/`" BACKUP.txt"` on the stem + welcome-line sniff, so a renamed log in the EQ folder is still tailed | surface the size where the logs are already listed (Logsync tab / Setup card) with a threshold and the move-it-out-and-add-as-old-log-folder action. UI, so it gets options first |
| Overlay progress bars animate `width`, not `transform` | **CLOSED 2026-09-22 — not doing it.** Detector finding on `.hpbar` / `.manabar` / `.tbuff .bbar`. Measured: the panel already rebuilds via `innerHTML` **and forces a synchronous layout via `scrollHeight` every 500ms**, so the bars' layout cost is a rounding error and the conversion changes no perceivable frame. ⚠ I had also argued it from the GPU-driver resets we triaged this week — **that was a stretch and is withdrawn**; those came from the game's D3D8 path, not our CSS. And the sweep I proposed would have been actively harmful: the guild lead confirmed the Tank overlay's bar transition is load-bearing information (*"the HP bar's transition pre/post heal is important to know where it will land the tank"* — `.hpbar` is `.25s ease` for readability while `.ih-fill` is `.1s linear` for cast rate, already deliberately tuned) | nothing. Suppressed in `.impeccable/config.json` as domain-appropriate motion — a bar filling **is** a length change — with the measurement in the reason. Revisit only if someone reports real overlay stutter |
| Incoming-heal **landing marker** on the Tank HP bar | proposed 2026-09-22, not built. The data is already there — `.ih-amt` carries the heal amount and the bar knows cur/max — so "will this CH top him?" is answerable before it lands | the guild lead picks a shape: a faint tick at the projected position, or a translucent fill from current HP to projected. They differ mainly in how they read with several heals inbound at once |
| `apps/mimic/pets.html` has a second copy of `fmtNum` | open (2026-09-22) — still rounds to whole thousands, so the Pet tracker will read "5k" where Target Info now reads "4.7k" | match it, and decide whether the two copies should become one shared helper rather than drift again |
| ⚠ **CAPTURED: the "too high of a level" failure string — for CHARM** | 2026-09-22, from a live bard pull: `Your target is too high of a level for your charm spell.` (followed in the same second by `Your target resisted the Solon's Bewitching Bravura spell.`). `CLAUDE.md`'s lull-line note says this failure family *"has a message we have not captured"* — now half of it is captured. ⚠ **The PACIFY/HARMONY wording is still NOT captured**; it is presumably the same template with a different spell word, but `CLAUDE.md` says do not invent the string and that still holds | grep confirms the agent handles `Your target resisted the …` and `Your charm spell has worn off.` but **not** the too-high line. Decide whether a too-high failure can leave `_pendingCharmSpell` staged when no resist line follows — if it can, that is a phantom charm timer |
| **Faction history: real windowed TOTALS** | **half done 2026-09-22 (§5).** `faction_hits` is live and recording; the page filter ships, but it filters rows only — the numbers in them are still all-time and the UI says so. ⚠ The table knows nothing before 2026-09-22 | once there is enough history, recompute Raised/Lowered over the window from `faction_hits`. **To recover the pre-2026-09-22 history, raiders re-run a `--since` backfill over their own logs** — the unique index makes that safe to repeat. Also: no retention sweep yet (~851 rows/day; the `ts` index is in place for when one is wanted) |
| `beta.yml` vs `latest.yml` | observation 2026-09-21 — `CLAUDE.md`'s channel table says Windows beta publishes `beta.yml`; beta.8/9/10 all publish `latest.yml`, and beta.9's has 163 downloads, so the channel demonstrably works | doc looks stale, not the build. Confirm next time the release workflow is open |

## 5. Faction page, time-bound — and the aggregate that made it impossible (2026-09-22)

The guild lead: *"I'm working on my faction and I think it would be worthwhile to
have this data be timebound for how recently these hits have come in. Show last
N days worth."*

**It could not be answered as asked.** `faction_standing` is running counters
only (`better_count` / `worse_count` / `better_total` / `worse_total` +
`first_hit_at` / `last_hit_at`), written by the additive `bump_faction_standing`
RPC. No per-hit table existed anywhere — `faction_cons` is latest-standing-per-mob,
not a log. So **749,753 hits across 179 characters existed purely as numbers**,
and no window could be computed from them at any price.

⚠ **The events were reaching the bot the whole time.** `_handleAgentFaction`
loops over them with `kind` / `faction` / `mob` / `ts`, resolves the point value
from the line's magnitude or the catalog, aggregates — and dropped the detail.
Capturing it was one extra row, not a rebuild.

**Both halves shipped together, deliberately:**
- **`faction_hits`** (migration `20260922200000`, applied live + committed
  identical): one row per event. ⚠ Carries a unique index and inserts with
  ignore-duplicates, because **re-running a backfill is the documented way to
  enrich history** and the aggregate path has no such defence (a second pass
  inflates the counters). That same property is what makes the lost history
  recoverable: the database cannot rebuild it, but a `--since` backfill over the
  raiders' own logs replays the identical lines.
- **A recency filter** on `/character/<name>/factions` — 7 / 30 / 90 days,
  filtering *which factions are listed* by `last_hit_at`. "Any time" stays the
  default so nobody's page changes unasked.

⚠ **The filter states in the UI that the totals are still all-time.** A window
that silently showed lifetime numbers under a "last 7 days" heading would be
worse than no window — and that caveat is precisely why the capture had to ship
alongside rather than after.

**Sizing** (database size being the metered thing that only grows): 851 hits/day
measured guild-wide → ~310k rows and tens of MB a year, two orders of magnitude
under `encounter_threat_snapshots`. **No sweep yet**, and the `ts`-leading index
is already there so one will actually work when it is wanted — which is more
than that table ever had.

## 4. NPC tells were reaching Discord DMs (2026-09-22)

The guild lead: *"Some NPCs will tell you things like this privately."* The DM
thread read **`Gage → <character>: Welcome to my bank!`** and **`Come back soon!`**,
twice over.

`Gage` is a real `eqemu_npc_types` row, and it defeats **both** existing guards:
the sender is one capitalised word (so it has a player's name shape, and the
multi-word/lowercase heuristic passes it) and the text carries no `Master` and
no coin (so `_isNpcTellText` passes it too).

⚠ **String-matching the greeting was the obvious fix and is the wrong one.**
Banker and merchant lines are **not in our mirror** — checked
`eqemu_npc_emotes`, which holds 4,144 combat/quest emotes and neither of these —
so the list could only ever be guessed at and extended forever. And *"Come back
soon!"* is something a player might genuinely type. The rule already stated in
that source file is the one that governs: **an NPC tell slipping through is
harmless; dropping a real one is not.**

**Shipped instead (agent 3.6.52):** drop only when the sender is **the mob we
are looking at** *and* that name resolves to a catalog NPC. Both halves matter —
you target a banker to bank with it, and requiring the target match means a real
player who shares an NPC's name is silenced only if they tell you in the very
moment you are targeting their namesake. Fails open on every error; never
applies to outgoing tells. Mutation-checked both ways.

## 3. Target Info — mana bar + Factions tab, measured 2026-09-22

Asked for by the guild lead; feasibility pass in
`docs/DESIGN-target-info-mana-and-factions.md`. The findings that matter:

- **The log never names an NPC's spell** — only `X begins to cast a spell.` The
  way in is the LANDING message, which the guild lead spotted live: *"This
  should display the spell he cast that covers his hand with a dull aura"* →
  `eqemu_spells.cast_on_other` → **Grim Aura, 25 mana**.
- **Text matching alone is unsafe**: 153 landing strings are ambiguous and the
  worst maps to 27 spells. On The Spire Lord's own list `"staggers."` is seven
  lifetaps from 9 to 225 mana.
- **Narrowing by `npc_spells_id` + the NPC's level fixes it: 7,621 of 7,806
  (NPC, landing) pairs — 97.6% — resolve to exactly one spell**, worst residual
  4. For The Spire Lord at 49 the collision vanishes entirely.
  `eqemu_npc_spells_entries.manacost` is a per-entry override and is the cost to
  use, not `eqemu_spells.mana`.
- ⚠ **Two unknowns gate the bar itself, and a cloud session cannot close
  either**: whether Quarm NPCs actually spend mana, and at what rate it returns
  — **our `eqemu_npc_types` mirror has no `mana_regen` column**, so "resting
  regen" has no authoritative number behind it.
- **Other players' mana is not on the Zeal raid pipe.** Our own code proves it:
  the CH-chain roster is `mana: null` per slot and the healer roster parses
  percentages out of raid chat. Player bars work only for raiders uploading live
  state.
- ⚠ **The Factions tab is mostly already built** — `_factionValueMap()` resolves
  mob → faction values, is 6h-cached, and was validated against a real client
  log. It already knows that names come from `eqemu_faction_list_full` because
  `eqemu_faction_list` is **empty** in our mirror.

**Recommendation: ship the Factions tab and a "last cast" line first** (the
second thing actually asked for), and hold the mana bar until a local session
answers the two unknowns — an invented number on a mid-raid overlay is the one
thing this platform's design rules forbid.

## 6. Jev compaction assessed — not adopted; the blocker is a privacy call (2026-09-23)

The guild lead: *"please review and tell me your view of using Jev"* —
`github.com/tamaratran/fast-jev-compaction`, MIT, v0.2.0, zero runtime
dependencies. Reported on its GitHub page as **6.3k stars / 357 forks / 13
watchers / 27 open issues / 45 open PRs / 30 total commits**; ⚠ figures read off
the page, not the API (our GitHub access is scoped to our own repository).

### What it actually does — read from the source, not the README

A Claude Code plugin that replaces `/compact`'s summary. Instead of asking an
LLM to summarise old turns, it scores every tool call and asks TypeSafe's **Jev**
model two questions per call — *should the call stay* and *should its result stay
verbatim* — then deletes or truncates the losers and leaves everything else byte
for byte. Nothing is ever rewritten. Failures throw and the built-in summary
takes over, so it is fail-open by construction.

The claim worth checking is what leaves the machine, and the code answers it
cleanly (`src/state.ts`):

| Leaves the machine | Stays local |
|---|---|
| Every user and assistant message, **verbatim** (abridged head+tail only when the state will not fit) | **Tool results.** `resultNote()` sends `ok, 4213 chars (omitted)` — the contents are never transmitted |
| Every tool **input**, JSON-serialised, capped at 1000 → 200 → 60 chars as the state is squeezed | |
| `goal` — the last three user prompts, 500 chars each | |

So file contents do not leave via results — but they leave via **inputs**, because
`Edit` inputs carry `old_string`/`new_string`, `Write` carries file bodies, `Bash`
carries whole command lines, and `execute_sql` carries the SQL. For a session like
this one that would have shipped the Tower report, our retention figures, the
database sizes and the guild lead's quotes to `api.typesafe.ai`.

### Why it does not fit here, even though the problem is real

**Our compaction loss is cross-session, and Jev is within-session.** This whole
file exists because *"a decision that lives only in chat is lost: cloud and
desktop sessions cannot share a conversation"* — no compaction strategy touches
that. Jev keeps chat text verbatim inside one context window; committed docs keep
it across sessions, machines and container resets. We already pay for the
stronger mitigation, and it is the one that survives.

Where it genuinely would help is the narrower case: one long session that
compacts mid-task and then re-reads files it had already read. Real, and modest.

### Cost, in the four numbers

- **build** low — install the plugin, set `TYPESAFE_API_KEY`. For cloud sessions
  the key has to live in the environment config, which is the guild lead's action.
- **maintenance** ⚠ high — v0.2.0, 30 commits against 45 open PRs and 27 open
  issues, one author, and a hard dependency on a proprietary early-access model
  behind a waitlist. That ratio says the repo went viral faster than it is being
  maintained.
- **runtime** unknown, and unknowable from here — the full state is resent with
  every request batch, so a long history costs several 25–30k-token calls to a
  paid API, at the moment you are already stalled waiting to compact.
- **change** low — one plugin, removable in a command, and it falls back to the
  built-in summary on any failure.

### The call this needs

Not a tooling question. **Every message either of us types, plus every command
and query, would go to a third party** — that is the same family as the standing
rules on credentials, member privacy and the public repo, and it is the guild
lead's to make, not a session's.

⚠ **And it cannot be answered from a cloud session.** `typesafe.ai` and
`docs.typesafe.ai` are both refused by the egress proxy, so the retention policy,
whether submissions train the model, the price and the waitlist status are all
unverified. Same shape as the eqemulator.org/PQDI block: a desktop session can
read them in a minute.

**Recommendation: do not commit it as a repo plugin.** If it is wanted, run it
from a **desktop** session first, where the key stays on the box — and only after
the retention answer is in hand.

## 7. Callout and overlay fixes from a live afternoon (2026-09-23)

Reported by the guild lead one screenshot at a time, mid-session. Each was traced
to its cause before anything changed.

**Duplicate callouts — five guild triggers disabled (data, reversible).** "Need to
comb through duplicates and remove them." No two enabled guild triggers overlap:
4,321 spell landing/fade lines checked, max one guild trigger per line, no
identical patterns. Every duplicate was a guild trigger shadowing a BUILT-IN agent
callout on the same line: Shaman / Shaman Plague / Enchanter / Bard Slow landed
vs the built-in "Slow landed" (agent ≥3.4.17), and "Divine Intervention fired
(death save)" vs "DI DOWN" (agent ≥3.5.59, which also names who recasts). All 32
players active in 14 days run agent ≥3.6.38, so no one lost coverage. Disabled,
not deleted, with a dated note on each row. ⚠ One real difference: the built-in
slow callout is main-target only, so a slow landing on an ADD no longer calls out.

**The disable did not reach anyone — bot bug, bot 3.1.138.** The guild-triggers
`version` (the agent's no-change gate) was max(updated_at) over ENABLED rows; a
disable or delete removes the row and never moves it. Every disable ever made
from `/admin/triggers` kept firing until Mimic restarted. Worked around by
touching one enabled all-classes trigger; fixed by hashing which rows are served
and when each changed.

**Enrage was mute — agent 3.6.54.** The #136 callout allow-list mutes guild
triggers whose name/tags/text match none of its categories, and enrage was never
one. Added whole-word. The suggested "Mob is enraged" trigger read an invented
string (`begins to enrage`); now `has become ENRAGED`.

**Damage shield undercount — agent 3.6.54.** "60 returned · 1 hit" for a fight on
a tank wearing 60/hit. The pairing only looked BACKWARD from the shield line for
its swing; replayed, shield-then-swing counted 0 of 10. Now either order pairs;
what counts as a shield is unchanged.

**Extended Target, outside a raid = your group (the guild lead's default).**
"If we're in group but not raid the default is to not show extended target for
outside of group." Agent-side (only the client knows its group); in a raid,
unchanged; fails open. Also: one mob split into #1/3 #2/3 #3/3 by POSITION while
the spawn ids agreed it was one — ids now merge rows too (bot 3.1.139), and a `0`
target_id no longer mints a phantom `#0` instance.

**Mute vs "Trigger alerts speak out loud" — "which one works?"** Neither did what
it said. Mute also HID trigger alerts (a stale gate from when Quiet mode hid
overlays), and the tray's Quiet mode never muted the CH-chain or charm voices
(only a Settings save broadcast Mute). "Trigger alerts speak out loud" is the
master switch for the whole trigger overlay, banner and voice — relabeled. The
old test for "still flashes" only checked that a flash() function existed and
passed throughout; replaced with one that runs fire().

**Tray and Settings.** "No overlays" added to the tray (same flag, same apply
path — parity rule). Overlays submenu sorted A–Z at build time. Settings flows
into columns when maximized. Slow callouts name the mob and its spawn id when
Zeal proves it (agent 3.6.55).

**Tower archive, where it stands.** Three more merge bugs past the FK order —
`encounters` never restored into the snapshot (its id default lives in the
`extensions` schema), one conflict target for 17 tables with two unique indexes,
and DISTINCT FROM joins that could not finish at 1.2M rows. The last manual run
sat silent in the restore at ~06:2x PDT, possibly colliding with the 05:30
nightly job. To check, from a second terminal:
`ps -eo pid,etime,args | grep -E 'refresh-local-archive|pg_restore' | grep -v grep`
— two refresh processes means a collision: stop both, run once. (Resolved: the
catch-up completed that afternoon.)

## 8. The per-fight threat graph — built; deletion still waits on July (2026-09-23)

The guild lead, 2026-09-22: *"per fight, consolidate the threat data into a
flattened graph, married up with the player deaths from those fights. make sure
that the data isn't removed from the on-prem database then make deletions from
the table."* Consolidate → confirm on-prem → delete.

**Consolidate — DONE (migration `20260923200000`, applied live via `execute_sql`,
file committed).** The graph already existed as a query: `encounter_timeline`
(5 s buckets, per character, damage and damage-taken deltas, best uploader per
character). It is now stored once per fight in `encounter_threat_graph`:
- `rows` holds `encounter_timeline`'s own output, in its own order.
- `deaths` holds each uploader's RAW death array from
  `contributions.raw_parse->'deaths'` — the exact input of the canonical JS
  dedup. Stored raw because that rule already lives in three mirrored places
  (`utils/parseDeaths.js`, the parse page, `web/lib/raidReview.ts`) and must not
  gain a fourth copy in SQL.
- `encounter_timeline` is now a wrapper: live while raw snapshots exist
  (unchanged output), the stored graph once they don't. The live body is
  `encounter_timeline_live`, copied verbatim from production (which carries a
  later baseline fix the original migration file lacks).

**Backfill: 16,980 fights, 508,035 rows, 2.4 MB** (against ~1.4 GB of raw
snapshots). 21 sampled fights matched live exactly, including the largest
(12,294 rows), five with deaths, and three empty ones. The stored-graph read
path returned all 4,645 rows of the biggest fight identically, in the same
positions, before the wrapper went live.

**Bot 3.1.141** builds each day's graphs at midnight before anything can delete,
and adds a second watermark, `threat_graph_built_through()`. **Both** deletion
paths now require both watermarks:
- the 30-day sweep;
- the 7-day `thin_threat_snapshots`, which had **no gate at all** until today.
  It was dormant only because it timed out on the same missing index as the
  sweep — measured 2026-09-23: rows per uploader-minute are the same either side
  of 7 days (3.78–4.77 older, 3.67–4.78 newer). Fixing that index would have
  woken an ungated deletion.

Rule tested by running it (`test/threat-delete-gates.test.js`); both gates
mutation-checked.

**⚠ Why deletion is still off — the guild lead's decision.** Graphs can only be
built for snapshots that name their fight:

| Month | Snapshots | Name the boss | No boss or target |
|---|---|---|---|
| July | 439,870 | **0** | **439,870** |
| August | 416,245 | 358,539 | 55,094 |
| September | 352,014 | 352,010 | 1 |

`encounter_timeline` matches snapshots by boss name, and **every July snapshot
has none**, so July fights show no curve today (live) and store empty graphs. The
raw July data is intact on Tower and in production. Options:
- **(a)** accept it — July's detail lives on Tower only; set the watermark and
  let deletions start;
- **(b)** attribute unnamed snapshots to a fight by time window + uploader.
  That is a new heuristic that changes what the parse page shows for July
  fights, so it needs building and checking first.

The watermark stays unset until this is decided.

**Two facts for that call, previously recorded only in the handoff:**
- **A DELETE does not shrink the database.** Postgres reuses the space; the file,
  and so the size Supabase bills, stays put until `VACUUM FULL` (locks the table
  while it runs) or `pg_repack`. The "~890 MB reclaimed immediately" figure in
  `CLAUDE.md` / `docs/COSTS.md` really means "no growth for about a month".
- **The `snapshot_at` index** (`20260923010000`) has never been applied —
  `CREATE INDEX CONCURRENTLY` cannot run inside a migration runner's transaction.
  Now that thinning is gated it is safe to create by hand with `execute_sql`
  (outside a transaction), but it only matters once deletion is switched on.

**Also still open:** nobody advances the archive watermark nightly (needs a
design — Tower writing `bot_kv` after a successful merge, or a manual step);
Tower's archive never receives tables created after it was built (e.g.
`faction_hits`, and now `encounter_threat_graph`); the Tower healthcheck ignores
the merge; and Tower's own `refresh-local-archive.sh` lacks the repo's
report-window fix (`0bf44d8`).

**`docs/HANDOFF-2026-09-23-session.md` was deleted in this change** at the guild
lead's word ("we no longer need this handoff document"). Everything durable in it
is now here, in the open table above, or in `docs/STATUS.md`.

## 9. Cloud sessions reach Tower over Tailscale (2026-09-23)

The guild lead: *"how can we build you a path to work on the local instance of
this database rather than me having to do it?"* The choice was between running
Claude Code ON Tower (a container driven via `claude remote-control`) and letting
cloud sessions JOIN the tailnet. **The guild lead picked Tailscale.** A Claude in
Chrome session did the Tailscale-console and Unraid work, from a private
setup brief (an artifact, not in the repo; it names the steps, not the values).

**What exists now.** A cloud session joins as an ephemeral device tagged
`tag:claude-cloud`, using a reusable, pre-approved, 90-day auth key. The tailnet
policy lets that tag reach exactly two things: Tower on 5432 (the Supavisor
pooler — `supabase-db` itself publishes no port, and still doesn't) and the
Coolify VM on 8000, through Tower's existing subnet route. The default
`src: ["*"]` grant became `autogroup:member`, because a tagged device counts as
`*`. Policy `tests` refuse a save that opens anything else. The database login is
`claude_ro`: SELECT on `public` + `archive_meta`, minus `tells` and
`chat_messages`, password set with `\password` so it is in no history file. The
Coolify token is read-only without `read:sensitive`, because that scope reads
every deployed app's environment variables.

**Verified the same evening** from this session: joined as `claude-cloud`;
`select current_user` → `claude_ro`; `tells` → permission denied; Tower 22 and
8000 time out (blocked by policy); Coolify answers. Relay-only over DERP, since
UDP is blocked.

**Three things that cost time, for the next session:**
- **`no_proxy` sends LAN addresses around SOCKS.** The cloud environment's
  `no_proxy` lists the private ranges, so `curl --socks5-hostname` to the Coolify
  VM dials it DIRECTLY and times out. Prefix `no_proxy= NO_PROXY=`. psql goes
  through a `socat` → `tailscale nc` forward, which is unaffected.
- **`pgrep -f 'tailscaled --tun'` matches its own shell's command line**, so a
  "start it unless running" guard never starts it. Run `tailscaled` and `socat` as
  background tasks.
- **Supavisor wants `claude_ro.<tenant-id>`** as the username; plain `claude_ro`
  fails to log in.

**The values live in the cloud environment's variables** (`TS_AUTHKEY`,
`TOWER_TS_HOST`, `TOWER_DB_PORT`, `TOWER_PGDATABASE`, `TOWER_PGUSER`,
`TOWER_PGPASSWORD`, `COOLIFY_HOST`, `COOLIFY_TOKEN`). Anyone who can use that
environment can read them, which is why each is scoped as above. The repo carries
names only, never values.

## 10. Deathrolls (2026-09-23)

The guild lead, on a Rolls card showing one game as eleven "1 roller · open"
sets: *"These are called Deathrolls. First one to roll a zero loses - we should
track these for fun."*

**The calls.** Display option **A** (one expandable line per game in the Rolls
card and the Command Center), not B (a separate Deathrolls card). And *"yes post
it to Wlfpck-general"* — `DEATHROLL_CHANNEL_ID`, set on Railway.

**Where it landed.** Detection is BOT-side over `roll_sets`, which every Mimic
already uploads, so recording needed no fleet update (bot 3.1.142,
`utils/deathroll.js`). Each game: one `deathroll` fun_event, one post. The
shape that identifies a game — each range is the last result, a different
player each step, ≤2 min apart, ≥3 rolls, ends on 0 — is one loot rolls never
have. The first captured game was seen by seven uploaders whose clocks
disagreed by up to 9 s, which is why detection runs per uploader and merges
after. `fun_events.detail` (migration `20260924050246`) carries start, rolls,
players and steps so /fun can rank without parsing a sentence.

**Still to land:** the one-line display (agent, beta) and the /fun card (web,
beta first at `b.wolfpack.quest/fun`). Not changed, and worth knowing: the
event-night rolled-loot card, the Hot Dice night award and `/rolls` still see a
deathroll's steps as ordinary one-roller sets.

## 11. The Me overlay, Blind Mode, and the next five (2026-09-24)

**The asks.** *"we need another overlay for the player. essentially a 'me'
overlay. my target, my casting, my health, mana, XP detail. avg DPS per fight,
total per day/night during raids, then the things that are important to
classes with mana — clerics focus on how many CHs are left, enchanters, charms
or mezzes left, theft of thought or harvest timers, party health data"*; *"a
concept … to automatically show the overlays that make sense if the character
is blinded"*; then *"generate me those me overlays as versions a/b/c to deploy
live into beta … give me a picker in game. nillipuss has some good display
bits we could learn from."*

**What landed (beta, agent 3.7.2; catalog fields in bot 3.1.144–145).** One
overlay, `apps/mimic/me.html`, three layouts of the same `/api/me` data, picked
with the A/B/C switch in its title bar (remembered per machine):
- **A · Classic** — the Nillipuss player window: cur/max inside the bars, the %
  column on the right, XP/hr and AA/hr, spell bar with casts left, group, DPS.
  Build S · maintenance M (the most fields to keep true) · runtime: the largest
  DOM of the three, still a 500ms local poll · change M.
- **B · HUD** (replaced "Glance" the same night — the guild lead: *"one of those
  me overlays should be a HUD style that goes around the players center of
  their screen … as well as damage in/out shown clearly. resists and cast
  damage too with elements associated with it"*; agent 3.7.3, element = catalog
  resist type, bot 3.1.146). HP/endurance and mana/cast as arcs either side of
  the character, target + cast above, damage OUT | IN below with per-element
  chips and a hit feed, resists left, class numbers right. The window grows to
  a centred rectangle when B is picked. ⚠ Screen centre is sacred in the
  overlay rules, so the ring is HOLLOW (a test pins it) — that is the
  compromise with the ask, and the thing to judge in game. Build M ·
  maintenance M (geometry is JS, so it moves when content changes) · runtime:
  one SVG repainted per poll · change M. An incoming unnamed spell's element
  comes from the landing text just before it, only when unambiguous.
- **C · Role** — the class's numbers first, large (CH left, Mez/Charm left,
  ToT/Harvest countdowns), then vitals, group, DPS. Build S · maintenance M (a
  new class focus means agent + overlay) · runtime small · change M.
All three read one serializer, so graduating one is deleting two render
functions. The catalog now carries `mana`, `recast`, `mez` (SPA 31) and `blind`
(SPA 20); the agent measures XP/AA per hour itself and keeps tonight's damage
in memory (a restart starts the night over).

**Blind Mode.** It never auto-showed for a capitalised name (state stored
lowercase, looked up in display case) — fixed. It also knew one spell's text;
it now reads every SPA-20 spell's landing and fade from the catalog, skipping
any text a non-blind spell shares. Me joins the four overlays it forces open.
Not changed: the old hand list matches both the Pitted Iron Ring's "Flames of
mana…" line and its manaflare line, so a ring that prints both is announced
twice — as before.

**Mob mana drains (a member's request) — scoped, not built.** Drains exist in
the catalog as SPA 15 with a negative base: Theft of Thought, Mana Sieve, Mind
Wrack, the Torments, bard songs (Cassindra's, Denon's, Ervaj's) and eight proc
spells on ~20 items. What the agent can see: its OWN drains exactly (the cast
names the landing); others' TIMED drains through the bystander index (per-tick
drain must be synthesized — no log line per tick); others' INSTANT drains and
all procs only where the landing text is unique (most share "staggers."). Needs
a `drain` catalog field with formula decoding (formulas 1–99 are unmodelled;
ToT reads 40 + 360 = 400 at L60, its max — verify before trusting). Also found:
the mana ledger's reset/evict functions are never called in production.

**Verified against the Quarm server source (2026-09-24, EQMacEmu
`zone/spell_effects.cpp`, `SE_CurrentMana` + `CalcSpellEffectValue_formula`):**
- Formulas 1–99 are `base + level × formula` — ToT 40 + 60×6 = 400 at L60 is
  right, not a guess.
- ⚠ **Instant drains are CUT on NPCs above level 52** ("from client decompile"):
  ÷2 at levels 53–54, ÷3 and capped at **105** at 55+. Nearly every raid mob is
  55+, so a ToT takes at most 105 from a raid boss, not 400; Mind Wrack ~100.
  **Timed drains are not cut** — Torment of Argli's 35 × 20 ticks = 700 beats
  six ToTs on a raid mob. The design must apply this or the bar lies downward.
- Bards — NPC or player — are immune to mana effects, good or bad.
- A mana TAP on a class with no mana does nothing at all.
- A timed drain does nothing on landing; it works per tick.
- **Players take instant drains at FULL strength** (the NPC cut is `IsNPC()`),
  and no PvP-specific reduction exists in that code.

**PvP (the guild lead asked, 2026-09-24): the bar cannot work on a player.**
The bar needs a max, which for an NPC comes from the NPC catalog; a player is
not in it, and Zeal sends a target's HP only — never mana (groupmate mana is
not on the pipe either). What CAN work: a "you drained N from them this fight"
tally for your OWN drains (the cast names the spell; full strength on players),
shown as an upper bound because the server only takes what they have. /who
class says whether there is anything to take (no-mana classes and bards: none).

**Built the same day (agent 3.7.4 on beta, catalog `drain` in bot 3.1.147).**
The guild lead: *"go on the mob version, and yes to the PvP tally. add in class
and level from /who data for target overlay for players … capturing exact
level from even con or /who, or a range from con and anon."*
- Mob drains follow the rules above, including the high-level cut; timed ticks
  count to the nearest whole tick (the server's tick phase is unseen). The
  ledger now dies with its mob and evicts idle entries — the reset bug found in
  scoping is fixed.
- Target Info for a player: class and level from live /who → raid roster →
  /who history; when anonymous, a /consider gives the exact level on an even
  con and a RANGE otherwise, by the server's `Mob::GetLevelCon` table
  (mirrored exactly). Only three con phrases are typed in (red, yellow, white —
  documented by ZAM and the Project 1999 wiki); the blue/green phrases vary by
  level bracket and the references disagree, so the agent **learns** them from
  considers of targets whose level it already knows, and keeps what it learns
  in `logsync.con-phrases.json`. Until a phrase is learned, that consider gives
  no range rather than a guessed one.

**The next five** (from the roadmap review — 13 roadmap votes from 3 voters,
so votes break ties, they don't set order; 20 of 30 active players now send
spawn ids):
1. Extended Target places each debuff on its mob by spawn id — `buff_casts.target_id`
   is stored and unused there (S, bot, #194 vote).
2. Mez owner + timer chip on Extended Target — design already in
   `DESIGN-extended-target-v2.md` (M, bot + overlay).
3. Mimic's same-name mob tracking uses spawn ids — a death clears only that
   mob's debuffs (M, agent, #194 vote).
4. Charm-pet damage credited by `pet_id` — the bot still credits by name and
   time, the class of bug behind the open Blood-phantom report (M, bot).
5. One archive entry per fight, #191 (S, bot, 1 vote).
Housekeeping alongside: the roadmap vote queue is stale (it still lists the
Zeal spawn-id request, golden-log CI, `/guide`, `/raid/review` as open).

## 12. PQDI links, and recipes + quests on the item page (2026-09-24)

**The report** (a member, relayed by the guild lead): clicking an item on the
inventory pages *"don't ever load — https://pqdi.cc/item/11594 for example.
Our pages don't have tradeskill recipes or quests listed."*

**Links — FIXED on `main`, web 1.8.2.** PQDI answers only on `www.pqdi.cc`; the
bare host resets the connection. Four links used it (`/me/inventory`, the
inventory hover card ×2, `/admin/spells`). The hover card's no-id fallback went
to `pqdi.cc/search?term=`, which PQDI never served — its search is a POST with a
CSRF token, so no GET link can exist; it now searches our `/search`.
`test/pqdi-links.test.js` fails on either shape anywhere in `web/`.

**Quests — the data was the gap, not the page.** `/db/item` already had a
"Quest turn-ins" section, but it reads `scripted_npc_turnins`, parsed from the
**ProjectEQ** scripts and only for branches whose reward is a literal. That
drops every script that computes its reward (Orc Scalp → Captain Ashlan in
Highpass: PQDI has it, we had nothing) and the `count_handed_item` form (most
Bone Chips quests). New RPC `quest_scripts_for_item` reads **Quarm's own**
mirrored scripts (`eqemu_quest_scripts`, via its trigram index — 2–30 ms) and
classifies each hit as component / reward. Checked against PQDI's quest tab on
three items: identical NPC lists, plus two PQDI omits (an alternate-zone copy,
an event script). A bare number match is dropped — item and NPC ids share a
number space.

**Recipes — new RPC `item_recipes`** over the tradeskill mirror (7,448 recipes).
Four roles per recipe: made · used · **tool** (consumed and returned — the
Smithy Hammer is in 777 recipes and comes back from 772; without the split every
one read as "makes a Smithy Hammer") · container (a portable kit). Skill and
world-container labels are read off the EQMacEmu source (`skills.h`,
`item_data.h` `BagTypes`), and PQDI's recipe pages agree wherever they name one.
New page `/db/recipe/<id>`: components, container, tools, results, what a failure
keeps.

**UI on `beta` as two layouts** (`b.wolfpack.quest/db/item/<id>?v=b` / `?v=c`;
no `?v=` is production's page). Both carry the new Quests section; they differ
only in Tradeskills:
- **B · Inline** — each recipe on one line with its whole combine (components →
  result, container, skill + trivial); this item in gold. First 25 recipes get
  the combine, the rest a name list. Build S · maintenance S · runtime: parts for
  25 recipes (~10 KB) · change M (the row is coupled to the recipe shape).
- **C · Grouped** — PQDI's shape: Made by / Used in, split by tradeskill, recipe
  names as chips with the trivial; groups start closed past 40 recipes. Build S ·
  maintenance S · runtime: names only (Water Flask's 744 ≈ 40 KB, collapsed) ·
  change S. Ingredients are one click away on `/db/recipe`.
Migrations landed on `main` and are applied (both functions only read the
mirrors). The recipe page is beta-only until a layout is picked.

## 13. The HUD, round two: three circle HUDs (2026-09-24)

**The asks** (the guild lead, after a night with layout B): *"The circle looks
nice, but managing it is rough right now resizing is rough. It's so spread out
on mode B The Circle should be the bounds for the resizing with some light info
on the inside of the circle"* · *"Monks, rogues, and warriors have no mana so
don't expose that for them"* · *"Melee cooldowns and discipline cooldowns need
to be in here"* · the target *"should have their target's health as well. If
it's slowed, does it enrage? If it enrages make it a red outline on that
section"* · *"Nillipuss is able to provide server tick counters and melee delay
timers"* · hits inside the circle, MH/OH *"would be a nice addition"* ·
*"Give me 3 versions of the circle hud to work on in beta release."*

**What landed (beta, agent 3.7.5).** B is gone (a saved B opens H1); the picker
reads A · H1 · H2 · H3 · C and sits in the window's bottom-right corner. Every
HUD is ONE square SVG (viewBox 400×400) filling the window: resize the window
and the ring resizes, nothing is placed in screen pixels, and picking a HUD
makes the window a centred square. Four costs each:
- **H1 · Rings** — everything is an arc: target on top (name written along the
  ring), HP left, mana/endurance right, resists written along the bottom, a
  cooldown ring across the bottom, swing and tick as short inner arcs; the
  centre stays clear (a test pins it). Build M · maintenance M (angular layout —
  a seventh cooldown needs room found) · runtime: one ~60-node SVG repainted
  10×/s · change M.
- **H2 · Dial** — an instrument cluster: a nameplate-style target panel, big
  numbers, cooldowns as a row of round buttons that wipe clockwise like the
  game's. Most text of the three. Build M · maintenance S · runtime same · change S.
- **H3 · Reticle** — a hairline sight: slim HP/mana arcs, the target as a
  straight bar across the top, a timer strip across the bottom that shows only
  what is cooling down (ready ones collapse to one green word). Least clutter.
  Build S · maintenance S · runtime lowest · change S.

**Where each number comes from — and how sure it is:**
- **Server tick — exact.** Zeal gauge 24, which the pipe already sent and
  nothing read. Zeal's reverse option is detected from the gauge's own text.
- **Swing timer — learned, marked "~".** Zeal computes an attack-recovery gauge
  (34, `labels.cpp`) — that is what Nillipuss draws — but the pipe's
  `GaugeNames` map stops at 33, so it never reaches us. Until it does, the
  agent learns the delay from your own swing rounds (the log is read every
  500 ms and stamped to the second: ±0.5 s). The one-line Zeal PR is drafted in
  `docs/zeal-attack-timer-pipe-request.md`; the agent switches to 34 on sight.
- **Combat abilities — the server's rule, haste estimated.** Kick, Bash,
  Backstab and the monk specials share ONE timer (`special_attacks.cpp`):
  base × 100 / haste − 1 s, bases from `common/features.h` (kick/bash/FK/RK 8,
  backstab 10, TC 7, DP/ES 6). Haste is not on the pipe, so the timer starts at
  the unhasted ceiling and tightens to your quickest repeats, never below the
  100%-haste floor. Mend 289 s and Taunt 5 s from their server messages.
- **Disciplines — the server's rule.** The disc's own landing text starts it,
  with `CastDiscipline`'s reuse: base − 54 s per level above where it unlocks,
  clamped 3:54–72:00. The refusal line (*"You can use a new discipline in …"*)
  is exact and wins. ⚠ Kept OUT of the Command Center's refusal-only timer: if
  Quarm runs the server's disc timer groups, a disc from another group is
  usable while this counts down.
- **Enrage** — "can it" from the mob-info row (`Enrage` special); "is it now"
  from the server's own `has become ENRAGED.` / `is no longer enraged.` (10 s
  default, `EnragedDurationTimer`).
- **Target's target** — Zeal's own when a build sends it, else who the mob is
  meleeing in the log; their HP from you, your group's gauges, or the relay.
- **MH/OH** — only when your hands swing different verbs (the server swings the
  primary first). A monk's punch and punch cannot be told apart, so no hand is
  claimed — exactly the case the guild lead expected.

**Bug found on the way (fixed, same commit).** The Command Center's discipline
countdown has never worked in the live agent: `trackDisciplineTimerLine` added
milliseconds to the Date that `parseEqTimestamp` returns, which in JS is string
concatenation, so every read was NaN and `toISOString` threw. Its test passed
because its stand-in parser returned a number; the stand-in now returns a Date,
and fails 9 of 17 against the old code.

**Round two, same day (agent 3.7.6).** After playing all three: *"Bars are a
little too thick"* · *"I would need feign death and Mend on here as a monk /
warriors would use taunt and kick / paladins and shadowknights would have their
lay on hands and harmtouch"* · *"The way the text wraps on H1 for the name up
top is the format I want to see for the other pieces. Ticks, swing, HP and
Endurance."* · *"There needs to me more open space in the middle"* · *"I can
add in /pipeoutput for FD too"* · *"Lets also change the name to HUD"*.
- Arcs roughly halved in width. HP, mana/endurance, tick and swing are now
  written along the ring like the target's name; hits are written along the
  inside of the ring (H2, H3) or in the bottom band (H1). A test measures every
  straight line's full width and keeps it ≥ 95 units from the centre — the old
  side columns reached ~75.
- **Class cooldowns always shown**, as *unknown* (a dash, never green) until
  first used this session — we cannot tell "ready" from "used before Mimic
  started". Monk Kick · Mend · Feign Death; warrior Kick · Taunt; paladin Lay
  on Hands; shadow knight Harm Touch.
- **Feign Death** (`Handle_OP_FeignDeath`): the server prints only the
  FAILURE (*"You have fallen to the ground."*); a feign that works is silent.
  So `/pipe <word>` on a hotkey starts a timer at the press — `fd`, `mend`,
  `taunt`, `loh`, `ht`, or an ability verb — read from Zeal's custom messages
  at Mimic's receive time, each line once. **Length (corrected in agent 3.7.7):**
  the CLIENT's button timer, not the server's — the guild lead, Rapid Feign 3/3:
  *"my feign death is only 5 seconds because of my AAs"*; the AA text says it
  cuts reuse by 10/25/50%, so a 10 s base. The server's own 9 − 1 s (3 s at
  3/3) is shorter than the button and never the limit. The pipe carries no AA
  ranks and Rapid Feign unlocks at 59, so a monk of 59+ is taken as 3/3 (5 s),
  anyone else 10 s — marked `~`.
- **Lay on Hands / Harm Touch** are spells with a 72-minute recast, less 12
  minutes per rank of Fervent Blessing / Touch of the Wicked (`zone/spells.cpp`)
  — hence `~`. Started by the cast line, *"You harm touch …"*, or the landing
  text on YOUR target when you are the class that has it (a bystander sees the
  same landing text, so an off-target one is not credited).
- Renamed "HUD" in every label a raider sees; the internal key stays `me` so
  saved positions and settings carry over. ⚠ Sits next to the existing "DPS
  HUD" and "Tank HUD" overlays in the tray list.

**Round three, same day (agent 3.7.8): one HUD, built from parts.** The guild lead
after a night with all three: *"I think we need an overlay builder for this one
in mimic - people will want to customize it, and we can make subelements on
this"* · *"The wrap mode on H1 is the way i want things to be"* · *"H2's
separation of hits against me vs hits out"* · H3's hits *"should be smaller and
more - i sometimes hit 6 times in one round, that will fill everything up"* ·
*"Damage shield hits are also mixed in there - those should be separate, and
should have a button with current DS amount per hit in it"*.
- **H1/H2/H3 merged into one HUD** in H1's wrapped style (the pick, per the UI
  rule: graduate it and delete the rest — H2/H3 code and tests are gone). A
  saved H1/H2/H3/B opens the HUD. A and C stay until the guild lead says otherwise.
- **Parts**, each with a fixed place so switching one off leaves a gap instead
  of moving the others: target · who it is hitting · slow/enrage · health ·
  mana or endurance · DPS · class number · tick · swing · cast · cooldowns ·
  hits on you (left) · your hits (right) · damage shield · resists · rounds per
  lane (2–5).
- **Hits: one ROUND per line** — every hit sharing a log second — numbers only,
  newest line outermost; `main | off` when the two hands swing different verbs.
- **Damage shield: its own kind.** A named shield line, or *"<mob> was hit by
  non-melee for N"* when that mob meleed you within 1.5 s and N fits the shield
  you visibly wear (+30 slack) — the same test the fight parser applies, which
  runs too late for the HUD's hook. A weapon proc lands on YOUR swing, so it
  stays a spell. The button shows the worn shield's per-hit value, else the last
  one that landed (marked `DS~`).
- **Builder — what shipped and the alternative, four costs each:**
  - *Shipped:* a ⚙ checklist over the ring, saved per computer. Build S ·
    maintenance S (one list: `HUD_PARTS`, with a test that every part has a
    default and vice versa) · runtime nil · change S.
  - *Alternative:* a builder on the dashboard's Overlays tab with a live preview
    and drag-to-place slots. Build M–L (a preview renderer outside the overlay,
    slot geometry per part) · maintenance M (every new part needs a slot rule) ·
    runtime nil · change M. Worth it only if people want to MOVE parts, not just
    hide them; the checklist answers "what do you want displayed".

**Round four, same day (agent 3.7.9).** The guild lead: *"Tick and swing timer
should be their own bars underneath abilities"* · *"Everything feels very bold,
we need to be able to make it thinner."* · *"The configuration section needs to
pop up on the side and not over the overlay."* · *"I lost my discipline timer"* ·
*"The ENRAGES section should just make a red outline for the last 8% of the
healthbar"* · *"Each overlay should get its own hotkey config as well. so if i
want to pull one up i can do it without much effort"*. A seventh line, *"The
numerical text should be"*, was cut off; round five's *"Text should be
vertically aligned"* reads as its end, and was built as that.
- **Bottom of the ring:** cooldowns on an inner arc (r 150, up to five, each
  labelled beneath); under them, on the ring itself, the tick bar (left) and
  the swing bar (right; the cast takes it while casting), each labelled
  beneath. Resists move inside the cooldowns.
- **Line weight** is a builder part — thin (the new default), normal, bold (the
  round-three look). It scales every arc and the text's dark edge, and takes the
  numbers off bold. Thin reads as regular on Consolas, which has no 500 weight.
- **Builder opens beside the ring.** The window grows by 240 px toward whichever
  side of the screen has room; the ring keeps its exact size and place; closing
  puts the window back. The pre-open bounds stay on the computer until the panel
  closes, because the HUD window saves its size on every resize — quitting with
  the panel open would otherwise leave the ring off-centre at the next launch.
  One design, no variant: it is a placement fix inside an established design.
- **Enrage** is a red outline around the last 8% of the target's health bar only,
  the low end the bar empties toward, solid while ENRAGED. 8% is the Tank
  overlay's existing threshold (`threshold_pct: 8`). The "enrages" word is gone.
  "ENRAGED" stays while the mob is enraged: that is the moment melee acts on it.
- **The lost discipline timer had two causes.** Timers were memory-only, so a
  Mimic update (which restarts the agent) wiped them. A ready discipline was
  also dropped 60 s after it came up. Now every disc class has a Discipline slot
  from the start (dim "—" until one is seen). Ready stays ready. Discs, the
  refusal line and skill cooldowns save to `logsync.hud-timers.json` next to the
  agent and are kept 12 h past ready.
- **Damage shield leak fixed:** the shield line can print BEFORE the mob's hit,
  so the mob's hit now re-reads the unnamed non-melee lines of the last 1.5 s on
  that mob. With no visible shield, non-melee stays a spell.
- **Per-overlay hotkeys: built (agent 3.7.11), in the Overlays table.** Mimic
  already had four global hotkeys (hide-all, backdrops, damage alert,
  minimize-all), a key-capture "Change…" row on the dashboard, and one toggle
  path per overlay (the `toggle-overlay` IPC). A per-overlay hotkey is that
  toggle bound to a key: `cfg.overlayHotkeys`, bound by `_registerOverlayHotkeys`,
  running `_toggleOverlay` — the same function as the row's ON/OFF button.
  No default keys: a global shortcut takes its key away from EverQuest, so
  nobody gets one they did not ask for. A key the OS refuses (another app,
  another overlay, malformed) is shown in red.
  - *Shipped — a Hotkey column on the Overlays table:* click, press the keys,
    saved; Backspace clears. Build S–M · maintenance S (a new overlay row
    gets the button for free, and a test fails if a row has no toggle case) ·
    runtime nil (OS-level shortcuts) · change S.
  - *Alternative — one "Overlay hotkeys" card* using the existing "Change…"
    rows. Build S · maintenance S · runtime nil · change S. All the keys in
    one place for spotting clashes, but away from the toggle each one drives.
  The key capture is now one function (`_wpCaptureAccel`) shared with the old
  rows. It reads letters and digits from the physical key, so Ctrl+Shift+1
  saves as `Shift+1`. The old rows used to save it as `Shift+!`, and that
  bug is fixed too.
  The tray does NOT show the keys yet: the parity rule runs tray → dashboard,
  and putting a key on each tray item means touching all seventeen of them.
  That is a cheap follow-up if wanted.

**Round five, same day (agent 3.7.10).** The guild lead: *"if a mob summons we
should get a marker next to the 97%"* · *"Text should be vertically aligned,
and each round of damage can come out as individual hits but get merged into a
single line item after the next round shows up. It should be animated and
smooth, not just jump. Have them slide and smoosh together into the new
number"*.
- **Hits are upright columns** (on you left, yours right, damage shield under
  yours). The newest round is one line per hit. When the next round lands, the
  last round's hits slide onto a single line with the round's total and fade
  into it. Older rounds are one line each.
- **Why a separate layer:** the ring is rebuilt as a string every repaint (10×
  a second), so nothing inside it can animate. The columns are kept `<text>`
  elements keyed per hit (`#hudlanes`), moved by CSS transitions — the one
  deliberate motion on the HUD, 0.3 s, off under the OS "reduce motion" setting.
  Motion is a cost on an overlay read mid-fight (the design skill's rule); this
  is spent because the guild lead asked for it, and it runs only when a round lands.
- **Summon mark at 97%:** an orange tick across the target bar plus a pointer
  outside the ring when the mob can summon. 97% is the server's default
  threshold (eqmac `Mob` summon code: `hp_ratio` falls back to 97). A mob's own
  override is in the special ability's parameter, which our catalog row does
  not carry.

**Same day, two more asks on the DPS meter (agent 3.7.11):**
- **History lists its fights on the right** (the guild lead: *"History should give
  us a list of the fights to choose from on the right side"*). The last six
  fights, newest first, with each one's duration and how long ago it ended;
  the one on screen is marked; "…" while the guild numbers settle. It replaced
  the ◀ 1/6 ▶ pager. The 7-column layout now keys off the scoreboard's own
  width (a container query) instead of the window's, so History uses the
  compact columns until the window is wide enough for both. The requested
  design is the one built; the alternative (grow the window by the list's
  width, like the HUD builder) costs more to keep right and was not built.
- **The L size is 420 px, not 400** (a member: *"the large 400px preset cuts off a
  bit on the dps window. and the xl is just a bit too wide"*). It applies to
  every overlay's right-click L size.

**Answered, not built — keeping the mouse cursor on screen with the UI hidden
(the guild lead: "is there a way to keep EQ from hiding the mouse when using
hide UI mode?").** No setting does it, in the client or in Zeal. The cursor is
a UI-skin sprite (`A_DefaultCursor`) drawn by the game's own window manager,
and F10 (UI state 3 at `0x0063B918`) stops that drawing. Sources:
`EQMacEmu/eqgame_dll_takp` `eqmac_functions.h`/`eqmac.h`;
`CoastalRedwood/Zeal` `game_functions.cpp` `is_gui_visible()`,
`camera_mods.cpp`. The new eqw.dll also blanks the Windows cursor over the
game window (`CoastalRedwood/eqw_takp` `eq_game.cpp`, `WM_SETCURSOR` →
`SetCursor(NULL)`). So another program cannot bring the real cursor back,
only draw one of its own. Practical options:
1. Close the windows you don't want instead of pressing F10 (the game keeps
   drawing its cursor).
2. Use a stand-in cursor such as PowerToys' Mouse Pointer Crosshairs with
   "hide when the pointer is hidden" turned off. It lines up with the game
   cursor on the new eqw. Not tested in game.
3. Ask upstream: either eqw_takp skips `SetCursor(NULL)` while the UI is
   hidden, or Zeal draws the cursor when the UI is hidden.
4. A Mimic-drawn cursor is possible but only worth building if Zeal adds the
   UI state to its pipe — without it Mimic cannot tell F10 is on.
Unverified: that the game's own cursor-draw call sits behind the same UI-state
check. That needs a disassembly from a local session.

## 14. Laya assessed as a Jev alternative — not adopted (2026-09-24)

The guild lead: *"Evaluate this Jev alternative https://github.com/NandhaKishorM/laya"*.
Read from the source, cloned at `970dc8c` (v0.3.20). The repo was created
2026-09-18 and had 276 commits by then. Checked against the §6 plugin
(`tamaratran/fast-jev-compaction` at `e3f262a`).

**What it is.** Laya is not a compaction tool. It is an open-weights
replacement for Jev, the *model*: typed `choice` / `score` / `noul` decisions
from an encoder in one forward pass. Three checkpoints (ModernBERT-large 421M
and mmBERT-base 322M), Apache-2.0, run locally on torch + transformers.
`laya-serve` speaks Jev's own `/v1/systemone` wire protocol, so a Jev client
can point at it.

**Why that matters here.** §6's blocker was privacy: the plugin sends every
message and every tool input to `api.typesafe.ai`. A local Laya server would
keep all of that on the machine. That part is real.

**Why it still does not work as a drop-in — each point read from the code:**
1. **The plugin cannot be pointed at it without a fork.** The library takes a
   `baseUrl`, but the Claude Code hook calls `buildJevRequest({ apiKey, model })`
   with no URL (`hooks/fast-jev.ts` `jevAsker`). The plugin settings have no URL
   field either. It always calls `https://api.typesafe.ai/v1/systemone`.
2. **The defaults are rejected outright.** The plugin sends up to 25,000 tokens
   of state (about 100k characters). `laya-serve` refuses more than 50,000
   characters (`MAX_STATE_CHARS`, HTTP 413). A batch of about 40 calls also
   comes to about 80 questions against `MAX_QUESTIONS = 64`. The plugin treats
   any error as failure and falls back to the built-in summary, so it would
   silently never work.
3. **Laya would not see the calls it is asked about.** `laya-serve` passes no
   `max_len`, so each request is cut to the checkpoint default: 512 tokens for
   English, 1,024 for multilingual. It keeps the *start* of the state (`truncate_left`
   is only set for list states), and the plugin's state is an object: the task
   text, the last three prompts, then the history oldest-first. So almost every
   "should call N stay" question would be answered from the same first few
   hundred tokens, before any of the calls.
4. **Even at its longest, it cannot hold the history the plugin sends.**
   `laya-multilingual` goes to 8,192 tokens, and by its own measurements is
   16–18 of 20 correct up to about 4,000 tokens and 8–17 of 20 beyond. The
   plugin wants 25,000.
5. **Nobody has measured it on this task.** Laya was trained and benchmarked
   on support triage, phishing, moderation, retrieval relevance and routing,
   not on "is this tool output still needed". Zero-shot, the base English
   checkpoint scores 0.362 on Laya's own typed-decisions benchmark, against
   0.766 fine-tuned. The Laya-vs-Jev charts use Jev numbers published by a
   third party, which Laya never ran (its `BENCHMARKS.md` says so).
6. **A wrong answer does not fail safe.** The plugin falls back only on errors.
   A confident wrong "drop" deletes context the session still needed, and it
   only shows up later, as re-reading or as a decision made without it.

**Cost, in the four numbers, for the smallest version that could work** — fork
the plugin to add a URL, patch `laya-serve` to pass `max_len=8192`, and shrink
the plugin's state budget to about 6k tokens:
- **build** M — two forks, plus a small labelled set of our own compactions to
  check the answers against. Without that set, nobody would know whether it
  works.
- **maintenance** ⚠ high — a six-day-old project with 23 tagged releases so far,
  two forks to keep rebased, and `torch` + `transformers` 5.x.
- **runtime** ⚠ high, and it lands exactly when the session is stalled waiting to
  compact. Each question re-encodes the whole state, so the cost is questions ×
  state length. Laya's own figure is about 1.7 s for a 4,000-token input on an
  Apple GPU, and a compaction asks tens of questions. On a cloud container
  there is also a CPU-only install of a few GB of dependencies and weights on
  every fresh session, against the disk allowance.
- **change** low — it can be removed, and failures fall back to the built-in
  summary.

**§6's other finding still stands.** Our compaction pain is cross-session, and
this, like Jev, only helps within one session. The committed docs are the fix
that survives.

**Recommendation: do not adopt.** Watch it: a Laya checkpoint fine-tuned on
keep/drop decisions, served with a real context length, would answer §6's
privacy objection properly. The fastest honest test is a desktop session
running `laya-serve` with `max_len=8192` against about 20 compactions we label
by hand. Clones for re-reading: the session scratchpad (not committed).

## 15. HUD round six, and a player's /consider is not a level (2026-09-24, agent 3.7.12)

The guild lead, with four screenshots: *"INcorrectly characterizing 'looks like
quite a gamble' as a yellow con. these folks are level 60"* · *"Please display
level or level range and class under the target's bar, above the target of
target"* · *"Corpses shouldn't ever say 'not slowed'"* · *"If a mob is
unslowable it should say that in its place., but also smaller text."* · *"The
combining of rounds of combat is happening strangely. I liked seeing the
separate hits, but it wasn't clear how that was operating."* · *"Huds should be
configurable per character as well."* · *"Have the damage shield hits roll into
a total instead of roll off."* · *"Have the damage done and taken per mob roll
off into a total as well, then drop out after each mob."* · *"When a mob flurries
or Rampages denote that with an F in a fist outline or an R in a fist outline
next to the boss's name."* · *"Lets try adding in small sliders next to each of
the hud's elements for font size on the config page."*

**A player's consider does not give a level — decided, from the evidence.**
- **What the server does:** it sends only a colour. `Handle_OP_Consider` →
  `GetLevelCon`, the same table Zeal copies from the client, and by that table
  60-vs-60 is white.
- **What the client printed:** level-60 players read *"looks like quite a
  gamble"* to a level 60, which is yellow (ZAM agrees with our phrase map). It
  also printed *"regards you indifferently"* where the server sends players
  faction 1.
- **So** the client handles a player's consider its own way. The exact rule is
  unknown, and could only be pinned in game.
- **Two changes:**
  - Target Info takes a player's level from `/who` only, live or the last one
    history saw. It shows no con chip for players.
  - The phrase learner only learns from NPCs, whose catalog level is fixed. A
    player could otherwise have taught a phrase the wrong colour.
- NPC considers are unchanged.
- If the character that did those considers was actually level 58–59, yellow was
  correct. The change is still right: the phrase gave a 61–62 range for someone
  `/who` had seen at 60, and `/who` is the better source.

**HUD, round six:**
- **Under the target's bar:** its level (or range) and class, above who it is
  hitting. An NPC's come from the catalog, a player's from `/who` (marked "last
  seen" when that is all there is).
- **Corpse:** a corpse shows only its name and 0%. No slow line, enrage outline,
  summon mark or badges.
- **Unslowable:** says "unslowable" where the slow state goes, one size smaller.
- **F / R badges in a fist outline, left of the name:** the mob can flurry or
  rampage. The ability comes from the catalog's special abilities (Rampage or
  Area Rampage count as R). A badge turns solid red for 6 s after the log
  shows it happen. The server strings are NPC_FLURRY *"%1 executes a FLURRY of
  attacks on %2!"*, NPC_RAMPAGE (Quarm adds *"against <target>"*) and
  AE_RAMPAGE *"%1 goes on a WILD RAMPAGE!"*.
- **Hit columns are ledgers now**, replacing round five's merge-the-last-round
  rule that read as strange:
  - On top, each mob's running total, "Σ 3,340". The mob is named when two are
    in the column.
  - Under it, the last few rounds as separate hits: oldest first, newest at
    the bottom, a small gap between rounds.
  - Rounds that fall out of the window slide up into their mob's total.
  - When the mob dies, all its hits roll in, the total dims, and after 8 s it
    drops out.
  - The damage shield column works the same way.
  - The totals come from the agent (`combat.tallies`, per mob and per life,
    split at the slain / died lines). They are not summed from the hits on
    screen, so they cover the whole fight.
- **Per character:** the builder's settings save per character. A character with
  none of its own starts from the last settings saved by any character.
- **Size sliders:** a small slider beside each part with text, 0.7×–1.6×,
  scaling only that part.

Design notes: one build, no variants. It is the established HUD, refined to
explicit instructions. The ledger is the one real design change. Its
alternative is to keep round five's per-round totals but label them (a "Σ" and
a hit count per merged line). Costs: build S · maintenance S · runtime nil ·
change S. It was not built, because per-mob totals are what was asked for.

## 16. HUD round seven, Feign Death failures, clicky cast times, NPC Harm Touch (2026-09-24, agent 3.7.13)

The guild lead: *"on Large size for abilities we should just show the name of the
ability and a checkmark instead of ready"* · *"IN and Out should be
side-swapped. Damage in should be next to health and out should be on the
right"* · *"Target name should curve with the HP bar"* · *"Move target of
target's healthbar and name to the top of the circle above the current"* ·
*"It's hard to tell when the different rounds are there. The concurrent hits in
a round should show up sidebyside before merging into a single line. Then
after the fight a ghost of those shows up."* · *"Replace the fist you made with
this fist shape i've uploaded"* · *"Add Harmtouch tracking to Shadowknight mobs
in Target Info"* · *"Config for hud should be able to scroll easily, and have a
top level slider for all of the text as well as reset to defaults for each
line."* · *"I did not get an 'FD Failure' message when this happened - FD
cooldown in the Hud should show an X on it"* · *"Cast time is definitely wrong,
especially for clickies"*.

**Three were bugs, and the causes are worth keeping:**
- **Feign Death failure** prints in the THIRD person with your own name —
  *"<name> has fallen to the ground."* The agent only knew *"You have fallen to
  the ground."*, so a failure never registered. Now either form marks the FD
  timer failed. The HUD shows "FD ✗" in red until 5 s after the timer ends.
- **Cast time** came from the spell's catalog cast time. A clicky casts at the
  ITEM's time, and haste or a focus changes it too. It is now timed from
  Zeal's own cast gauge (how fast its percentage moves). The catalog time is
  only used, marked "~", for the first quarter-second of a cast.
- **Cooldown labels cut off at large sizes** ("ND rea" for "MEND ready"): a
  label longer than its arc is clipped. Now "ready" becomes "✓" when it would
  not fit, and every ring label is fitted to its arc (it shrinks, never clips).

**NPC Harm Touch on Target Info — how it is decided:**
- **The timer:** an NPC Shadow Knight casts Harm Touch off its knight-attack
  timer and waits **40 minutes** (`HarmTouchReuseTimeNPC = 2400`, eqmac
  `zone/special_attacks.cpp`; its own comment reads "NPCs have 40 minute
  timers according to logs"). The timer is not running at spawn, so a fresh
  knight has it.
- **The log line:** it lands as *"You writhe in the grip of agony."* (Harm
  Touch, Harm Touch NPC — spells 88, 929, 2821), or *"<name> writhes …"* on
  anyone else. The log never names the caster.
- **Pinned at once** when your target is a Shadow Knight mob on the victim:
  it hit YOU in the last 20 s, or the victim is its target's target.
- **Pinned later**, as the guild lead proposed ("if we tab target to a
  shadowknight that's attacking us, there's a good chance we can assign that HT
  to it"): the landing is held with the list of mobs that were hitting you,
  and pinned on the first Shadow Knight among them you target that has none
  on record.
- **Keyed by name + spawn id**, so same-named knights are told apart on Zeal
  1.4.6+.
- **What it cannot see:** a knight that used its Harm Touch on someone else
  before you targeted it still shows "HT ✓". The log gives no way to know.

**HUD layout:**
- **Damage in** now sits on the health label, **out** on the mana/endurance
  label.
- **The target's name** runs along the INSIDE of its bar and keeps to the bar's
  span: it gets smaller (to 70%), then is cut with "…". The health is never cut.
- **Who the target is hitting** sits on top of the circle: a thin bar just
  outside the target's, with its name along the outside of that.
- **Hits:** a round is ONE line of hits side by side. If it is too wide, it
  shrinks (to 75%) and then wraps, with its wrapped lines closer together
  than the 4.5-unit gap between rounds.
  - The columns now start at y 146 instead of 126, because the circle is
    narrowest at the top. The right-hand column had 39 units there; now its
    narrowest row has about 48.
  - Older rounds still slide up into the mob's total.
  - After a fight, a dead mob's total stays, dim, as the fight's ghost until a
    live mob takes the column. The agent now keeps a dead mob's total 90 s
    (was 8 s).
- **The fist** is now drawn from the image the guild lead supplied.
- **Builder:**
  - 300 px wide, so the rows stop wrapping.
  - The header — name, close, and a new **All text** slider that multiplies
    every part's own size — stays put while the list scrolls under it, with
    a visible scrollbar.
  - A **↺** on every line puts that line's on/off and size back to default.

One build, no variants: these are explicit refinements of the established HUD.

## 17. HUD round eight: the swing timer fitted, columns along the ring, procs (2026-09-24, agent 3.7.14)

The guild lead: *"swing timer is completely wrong."* · *"Summations of hits should
not overlap with the outside rings."* · *"Right justify outbound hits and left
justify inbound hits. These should travel up the outside arc, but still be
oriented correctly."* · *"In the last screenshot the 62 69 110 line should have
been combined into [one number] for that round of combat on the third line
up."* · *"Remember that several classes can have up to 6 melee hits at once, on
TOP of procs. Procs should be purple."* · *"L40-43 Necromancer should also be
curved to fit the top bar."* · *"Put the name of the mob on the top of their
healthbar."* · *"Put their resists below their name. and the slowed/not
slowed/unslowable next to that"* · *"Clicking on the config button brings [up]
the mimic main dashboard."* — and, mid-round, *"FD still shows ready instead of
a checkmark"*.

**The swing timer — why it was wrong, and what replaced it.**
- **The old reading** took each round's ARRIVAL time (when the agent read the
  line) as the swing. Arrivals come in 500 ms polls against 1-second log
  stamps, so the phase could be off by most of a second, and the period
  (median gap) wandered with it — about 240 ms off in simulation. On a hasted
  two-hander (~1.8 s) that is a large part of the bar.
- **The fit (`_meSwingFit`):** each round is pinned by two facts — it happened
  inside its log second, and before we read it but no more than
  `_ME_SWING_LAG` (1 s) before. At the right delay those windows, carried
  forward to the newest round, all overlap, and many rounds overlap in a far
  narrower slot than any one of them (a vernier). The delay is searched at
  5 ms steps within ±20% of the median gap; the middle of the delays that fit,
  and the middle of the slot they leave, are the answer. A skipped swing (out
  of range, stunned) counts as a double gap, not a new delay; if nothing fits,
  the oldest rounds are dropped until it does. `swing.spread_ms` says how wide
  the slot is.
- **Measured:** it predicts the next swing within 0.12 s over realistic
  simulated logs (four delay/phase cases); with lag spread over the whole
  second it degrades to ~0.26 s and says so in `spread_ms`. The one-line Zeal
  change (attack timer on the pipe) would still make it exact.

**Procs.** A spell hit of yours in the same moment as your own swing (within
1.5 s, printed either side of it) is a proc and is drawn purple. ⚠ **Your own
nuke usually prints anonymously too** (*"<mob> was hit by non-melee for N"*),
so a spell hit with no name claims the cast you began in the last 12 s — once
(the cast lands one hit; a proc after it is still a proc). A fizzle or an
interruption drops the cast. Up to six swings plus their procs sit on one line,
shrinking and then wrapping as before.

**Hit columns.**
- **Along the ring:** out is flush right and in is flush left. Each line's
  outer end sits on an arc just inside the ring (r 158), so the column's edge
  curves with the ring while every number stays upright. Nothing reaches
  inside r 100.
- **Rounds:** the mob's Σ total on top, then older rounds as ONE number each
  (the round's sum), and only the newest rounds hit by hit — two by default,
  set in the builder ("Newest rounds hit by hit", 1–3), under "Rounds listed"
  (3–8). When the next round lands, the oldest split round's hits slide
  together onto their sum; a sum past the rounds listed slides into the total.
  (The example line 62 + 69 + 110 reads **241**.)
- **Totals** are fitted to their row: smaller (to 70%), then without the mob's
  name — never past the ring.
- **Checked by rendering what is drawn**, not by the lane constants: six
  four-digit hits a round with off-hand tags, eight rounds all split, two
  long totals, at 1× and 1.6× text — every box inside r 169 and outside r 95.

**Target block, from the outside in:** who it is hitting (its own thin bar) ·
the name + health **on top of its bar**, fitted then cut with "…" · level and
class **curved** inside the bar · its resists with the slow state beside them,
curved under that ("unslowable" smaller). ENRAGED stays the one straight line.
⚠ The resists come from the bot's mob-info row, which carries them nested as
`resists: { mr, fr, cr, pr, dr }` — the first draft read them flat and would
never have shown them; a test now pins the shape.

**Ready is always ✓.** Round seven only swapped "ready" for ✓ when the word did
not fit its arc, so FD (short enough) kept "ready" beside KICK ✓ and DISC ✓.
Every ready cooldown is now "<name> ✓", at every size.

**The ⚙ opening the dashboard — not reproduced, question out.** The HUD's ⚙ is
wired only to the builder panel inside `me.html` (a local file, so preload's
injected dashboard gear never runs there), and no IPC from it opens the
dashboard. Leading guess: the click takes focus from EQ, the game drops
behind, and a dashboard window that was already open shows through. Asked
whether a NEW window opens or an existing one is revealed; the fix differs.

One build, no variants: explicit refinements of the established HUD.

## 18. Colour-blind themes, hotkeys that say "in use", opacity split, mini mode found unbuilt (2026-09-24, agent 3.7.15)

The guild lead, in one evening: *"Put the Move icon and X at the bottom underneath
the tick timer and the swing timer. We can remove version C, default the HUD
to version, rename A into Box."* · *"Endurance can be small"* · *"Remove the
background from the Box version. Give the numbers on health some drop
shadow."* · *"Add the colorblind color schemes to themes as well."* · *"When
setting hotkeys it should tell you when you're trying to use one that's
currently in use rather than doing nothing."* · *"I don't see any of the
Mini-mode overlays in here. Those need to go in"* · *"Currently mini mode
doesn't do anything on 2.7.1 beta 14"* · *"Currently opacity only works on
backgrounds, not on the actual content. The Opacity slider at the top of the
Setup this overlay doesn't work at all. The HUD mode shouldn't include the
background as a square, rather as a shadow behind the content."* · *"Make the
top section of the overlays dashboard into two columns and put the opacity
slider with the background button. Put the actual overlays in alphabetical
order, keeping the dock and TTS up top."*

**Mini mode did nothing because it was never built — found, not regressed.**
The 2026-09-17 framework commit (`4cb14cff`) says so itself: *"this lands the
framework they all hang off, and nothing else."* The toggle, the 📌, the
Ctrl+Shift+M hotkey and the `body.wp-mini` class all worked; no overlay had a
single `wp-mini` rule, so the only visible change was the corner buttons
fading. The vote result (`DECISIONS-2026-09-18.md`, open table) is what gets
built: tank A · target B · CH chain B · charm A · ext A · pet B · dps B ·
pop A · buff B. ⚠ The main.js comment claimed the dashboard had a mini
button; it did not (the preload bridge `setOverlayMini` had no caller). Both
are now there: a **Mini** column (▭ + 📌) on the Overlays table and a
**Minimize ALL** key row — the tray-parity rule. And `miniHotkey` was missing
from the save path's re-register list, so a changed key would have waited for
a restart.

**Colour-blind themes — fitted, not the textbook daltonize.** Each is one
colour matrix over every overlay (preload `_WP_CVD_MATRICES`, an SVG
`feColorMatrix` the body filter points at), the same one-filter-per-theme idea
as the existing five.
- **Scored against an independent simulation** (Machado, Oliveira & Fernandes
  2009, severity 1.0), not the model used to fit them, on the platform's own
  tokens and the pairs that sit side by side with different meanings:
  danger/healthy (red/green), warning/OK (orange/green), danger/warning, a
  proc/a plain hit (purple/white), mana/health (blue/green), and gold/green
  (orange/gold for tritan).
- **The textbook daltonize (Fidaner 2005) was measured and rejected:** it
  lifted deutan red/green from 12.7 to 49 ΔE but dropped gold/green to 5.7,
  and its tritan matrix put red and orange at 0.4 ΔE — identical.
- **An unconstrained fit was rejected too:** it separated everything by
  pushing red to near-black (#500000), invisible on a dark overlay.
- **What shipped:** every row sums to 1, so greys and text stay grey; every
  token stays at L\* ≥ 45 as that eye sees it; every key pair is ≥ 30 ΔE.
  Deutan: key pairs from 12.7–17.3 up to ≥ 33.7, drift 14 — red reads
  vermillion, green light green, orange amber (Okabe-Ito-like). Protan: from
  7.8 up to ≥ 53, drift 31. Tritan: from 8.5 up to ≥ 42, drift 22.
  `test/overlay-themes-cvd.test.js` holds all three to it.

**Hotkeys that say "in use" — why it looked like nothing happened.** A key
held as a GLOBAL shortcut never reaches the focused window; Windows hands it
to its owner. So pressing Ctrl+Shift+H in the capture fired hide-all and the
dashboard saw nothing at all. Now:
- while the dashboard captures, Mimic lets go of every key it holds
  (`hotkey-capture` IPC; `_setHotkeysSuspended`, resumes on its own after
  30 s) and returns them (`_mimicHotkeyUses`), so its own keys arrive and the
  clash is named — *"Ctrl+Shift+H is already the Show / hide ALL key"* — while
  the capture keeps listening;
- a key another PROGRAM holds still never arrives; its signature is the
  modifiers going down and up with no key between, and that is now said;
- after a save, a key the OS refused says so instead of "Saved", for the
  per-overlay keys and now the four all-overlay keys too (`hotkeysBlocked`).

**Opacity split in two (main `_opacityMaps`).** Mimic 1.2 had made the one
slider drive only the card background (`--bg-alpha`) so text stayed bright —
which is why an overlay with no card, the HUD ring above all, showed no change
at all ("doesn't work at all").
- `cfg.overlayOpacity[k]` — **Opacity**, the whole overlay, faded in the
  renderer (preload `--wp-content-alpha`) — never its setup bar, menu, corner
  buttons or banners, or at 15% the slider would vanish under the cursor. The
  setup-bar slider and "Opacity — all overlays" set it.
- `cfg.overlayBgAlpha[k]` — **Background**, the 1.2 meaning (100% = solid
  card). Its own slider, beside the backgrounds button.
- Every value saved before the split was a background value, so it moves
  across once (`opacitySplit`) and Opacity starts at 100%: nobody's overlays
  change on update.

**The Me overlay:** C is gone; A is **Box** (its stored key stays `a`, so a
pick survives the rename); the **HUD is the default**, and a first run opens
in the centred square the HUD button gives. HUD: ✥ under the tick bar and ✕
under the swing bar (206° and 154° at r 199); the name and picker moved to the
top corners they left, which the ring never reaches. The backgrounds toggle
draws a drop shadow round the arcs and text, strength from the Background
slider, instead of a square. Box: no card, a thin endurance bar, a dark halo
on the numbers inside the bars, and no mana row for warriors, rogues and
monks (the screenshot showed an empty 0% bar for a monk; the HUD already had
that rule).

**The Overlays page:** two columns — how overlays look (theme, opacity and
background with the backgrounds key, size) and the all-overlay keys with
placement (show/hide ALL + lock, setup, arrange, rescue; minimize ALL; the
damage alert; per-character layouts) — folding to one on a narrow window.
The table: the Dock and trigger alerts first, the rest alphabetical.

One build, no variants: explicit instructions plus fixes inside established
surfaces. The mini renditions follow as their own change.

## 19. The nine mini renditions, and Mimic 2.7.1 to stable for raid night (2026-09-24, agent 3.7.16)

The guild lead: *"These are the mini modes to build to start from"* (the ballot:
tank A · target info B · CH chain B · charm A · extended target A · pet B ·
DPS/tank meter B · PoP raids A · buff queue B) · *"HUD doesn't make sense to
dock, remove that"* · *"after these mini modes are built and included, I want
to push all of this to main so we have them available for tonight"* · *"For
the Hud, the character name doesn't need to be at the top left. The
selection for Box/Hud should be in the middle horizontally, vertically below
the bottom tick/swing timers, directly next to the movement and X buttons"* ·
*"When this is over make sure to post to raid-chat in discord so that people
know to get the new version … Looking for feedback on skills that people want
to track."*

**The nine minis**, each behind `body.wp-mini` in its own overlay; full mode
is byte-identical to before (each was run through the same harness before and
after). What each shows, and the calls made where the data or the mock left
room:
- **Tank A** — one strip: the tank's bar, "tank ← mob", the damage-shield box
  showing the SUM of the tank's DS buffs per hit (grey "no DS" when none); a
  rampage row only while rampage has a target, with the DA countdown and CH!.
  The DA is labelled "DA" as voted even when full mode would say "INV".
- **Target Info B** — the mob's bar and name (Shadow Knight HT chip beside it),
  a draining amber SLOW row. ⚠ **No ROOT row:** nothing the overlay receives
  marks a debuff as a root. The fix is agent-side — flag root (SPA 99) on
  `target_buffs` as pacify is flagged — then one more row. Open item.
- **CH chain B** — timeline lanes (see the CH agent's notes in HOW-ITS-BUILT).
- **Charm A** — the pet's bar → its target, then a draining purple timer (red
  "recharm" on the overlay's own imminent flag — 12 s bard, 30 s others — so
  the bar turns red when the overlay speaks). ⚠ **No MR:** the charm data
  carries no resists. Open item.
- **Extended Target A** — one row per mob: bar, name → its target, S / M
  pills, and every OTHER debuff folded into a "·N" whose hover lists them
  (slow and mez are not double-counted in N — the guild lead to confirm).
- **Pet B** — the pet's bar → target, then a haste bar. ⚠ **No haste %:** the
  pet data carries the buff's name, not its haste value, so the short name
  stands in. A dim "⚡ no haste" line keeps the slot when none is up (reads as
  "rebuff", not "not tracked").
- **DPS B** — the player above me, me, the player below, from whichever tab
  was last picked (me first → me and the two below; last → the two above; no
  row → the top three). The title row stays, because it carries the /rs copy
  button the vote said to leave alone.
- **PoP A** — the shared checklist and the ↗ guide link only; a row click still
  checks it raid-wide.
- **Buff queue B** — buffs left, cures right, a chip per category with its
  character count; click one to list who needs it with their group; the open
  chip survives repaints.
Every mini hides its overlay's connection dot (it lives in the title bar) —
worth knowing when an overlay "freezes" in mini. Found in passing, not fixed:
the full Buff queue's category headers and the full Pet list's dismiss ✕ have
no hover handshake, so on a locked overlay those clicks likely fall through
to EverQuest.

**The HUD:** no longer dockable (out of main's `_DOCK_CATALOG`, no DOCK button;
a HUD that was docked gets its own window back in `loadConfig`, as undocking
would have). Its chrome is one row centred under the ring: ✥ [Box | HUD | ⚙] ✕,
below the tick and swing labels, and no character name (the Box keeps it).

**Graduated to stable the same evening, before the raid freeze.** Mimic
**2.7.1**, agent **3.7.16**, bot **3.1.148**, web **1.8.3** (the roadmap entry).
A file-level promotion as always: `apps/mimic/`, `packages/wolfpack-logsync/`
and their tests. ⚠ **Left on beta deliberately:** the item page's quests and
tradeskills layouts (`?v=b` / `?v=c`) — two variants not yet picked, and a
variant never goes to main unpicked. Beta re-parked at **2.7.2**.

**The raid-chat post** is a one-shot in the bot (`_announceMimic271Once`),
latched in `bot_kv` so it posts once ever, and gated on the stable v2.7.1
release carrying its installer — the bot deploys minutes after the push, the
installer builds after that, and a post that beat it would send the raid to
an update that did not exist yet. It checks every 5 minutes for up to 12 hours.
An unreadable latch (Supabase down) holds and retries rather than posting.

## 20. Contributing: the AI brief and the public roadmap brought up to date (2026-09-25, web 1.8.4)

The guild lead: *"`docs/AI-CONTRIBUTOR-BRIEF.md` … this and the roadmap need
updating so people can contribute"*, then, mid-raid: *"push it up to either
main because it's just a document … or give me a link to the new version on
beta that I can get to someone."*

**Beta, not main, during the raid.** The change touches the `/roadmap` page as
well as the doc, and any push to `main` redeploys the bot on Railway whatever
the files are — the mid-raid restart the freeze exists to prevent. Beta carries
no bot, and these files cut no Mimic build, so the brief went to `beta` and the
link handed out was the brief's GitHub page on that branch. Main follows after
00:30 ET.

**What was stale, and how it was checked.** A read-only audit of both lists
against the ledger and the code (file:line evidence for each):
- **Roadmap "What's next":** 4 of 23 items had shipped and came off — #75 golden
  log, #80 raid review, #81 raid guide (phase 0), #193 Zeal spawn id (upstream,
  Zeal 1.4.6). Ten more were partly done and now say so in their status line
  (#190 the engine repair is in, the re-count is not; #144 displays guarded,
  source not; #142, #192, #56, #87, #68–70, #199, #194, #195, #196). Three were
  added and numbered: **#209** mini-mode data gaps, **#210** the overlay
  click-throughs + the CH row that turns blue again, **#211** more skills on the
  HUD (a "we need" item, so raiders' answers arrive through the roadmap box).
  Next free number: #212.
- **The brief's menu:** 8 of 10 items had shipped long ago (#134, #132, #133,
  #99, #83, #66, #67, #130; #100 partly). The new menu is #209–#211, #144 at the
  source, the charm too-high-level line, #191, #54, #199 phase one, the
  "| local" / "| merged" parse-paste suffix, and two log-line asks (#169, #142).
- **The page's only contributor link pointed at `docs/roadmap.md`, which does
  not exist** — a 404. It now points at the brief, the coding-assistant helper
  and `STATUS.md`, with drafts sent to `/feedback`, one item per post (the box
  holds 4,000 characters).

**The brief itself** gained what it lacked since July: current sizes and
routing (the dashboard is authored in `dashboard.html`; web previews on beta),
the public-repo rules (attribution by role, never a character → player
mapping, no machine details), UI-as-options, colour semantics, the overlay
chrome + mini mode, test discipline, and Supabase's cost model.

**Names on public pages.** The roadmap's prose carried nineteen member or
character names — credits ("Reported by …"), another member's attendance
record, an alt-family reference ("…'s family has 83 …"), a
character-with-its-player pairing in a fleet example, and a set that read as
one person's mule characters. All are roles now, or the invented placeholders
where an example needs a name-shaped token. ⚠ **Seen and NOT fixed** (outside
this change): names in `docs/STATUS.md` (five places), a member's handle in an
agent comment, a mob-name-shaped member reference in an agent comment, and the
third-party OpenDKP maintainer named in `web/app/opendkp/page.tsx` (the rule
says "the upstream maintainer"). A sweep task is queued.

## 21. Privacy audit, and the privacy statement rewritten to match the code (2026-09-25, web 1.8.5)

The guild lead: *"do a privacy audit and update the privacy information. are
there application privacy best practices we can make claims about?"*

**How it was checked.** Three read-only audits ran in parallel — the Mimic
client and agent, the bot and database (aggregate SELECTs only, no personal
data read out), and the website (code, public pages, count-only queries). Each
claim on the old page was marked true, partly true or false with file:line
evidence. `docs/PRIVACY.md` and `/privacy` were then rewritten from the
evidence, not from the old text.

**Fixed live the same night.** Two SECURITY DEFINER functions were executable
with the public key — the 11-argument `bump_agent_upload_stat` (added
2026-09-01; the July lockdown revoked only the two older overloads by exact
signature) and `prune_opendkp_call_stats`. EXECUTE is now service-role only
(`20260925021113_revoke_public_exec_upload_stat_and_prune.sql`, applied and
committed). The bot kept writing upload stats afterwards (133 rows in 15
minutes).

**What the old statement got wrong** (dated 2026-05-30, partly updated since):
- "We never upload tells" — the opt-in tell relay stores tells in both
  directions, the other party's words included.
- "Only what you opt into is synced" / "no agent running = nothing collected" —
  about twenty streams are on by default once Mimic is signed in, and other
  raiders' agents record people who never installed anything.
- "No out-of-raid position collection" — your own live status (position
  included) goes out whenever Zeal is connected, in or out of a raid, even with
  logging off, and it ignores both exclusion switches.
- "Never cross-guild" (raid positions) — the raid roster upload includes
  pick-up members from other guilds.
- "Only opens EQ's own log" / "no startup changes" / "one server plus GitHub" —
  it reads Zeal's feed, ini and UI files, exports and crash files; the installer
  turns on Start with Windows; it also talks to public time servers, Zeal's and
  UI packs' GitHub repos, and Amazon's sign-in for OpenDKP.
- "Exclude any character from stats" — by design it stops only your own
  uploads (the 2026-08-13 decision), and deletes nothing.
- "See everything we have on you on /me" — /me shows a fraction; there is no
  export.
- Crash reports: "metadata only" undersold it, and "nothing older than 30 days"
  holds only on the first sweep.
- Not disclosed at all: the Discord email, sign-in IP/browser records, page-view
  logging, cookies, the retention reality (most data kept indefinitely; a
  permanent archive and 30 days of full backups on the guild lead's server),
  the sub-processors, and AI coding sessions' database access.

**What the new statement promises** — only what the code keeps today: open
source; private channels filtered on the user's PC first; sensitive features
off by default (tell relay, crash reports, old-log uploads, UI backups, log
attachments); no selling, ads or third-party trackers on the site; encrypted in
transit and at rest (with the at-rest layers named); members-only website pages.
And a **"What we can't promise yet"** section: no deletion dates for most data,
no self-serve export or delete, opt-outs that don't reach backwards, and other
raiders' Mimic recording you. Editing rule, in the file's header: *describe what
the software does today; a promise goes in only once the code keeps it.*

**Kept out of the public statement on purpose.** Some audit findings are
security weaknesses rather than data flows. The page does not describe them and
neither does this file; the guild lead has them from the session. A data flow
gets disclosed; a way in does not.

**Best-practice frameworks, and where we stand** (the second half of the ask).
We can say we follow these *in part* — never "compliant", which is a legal
claim we have no basis for:
- **Privacy by Design** (Cavoukian's 7 principles): meets *visibility and
  transparency* (open source + the new page) and partly *privacy as the
  default* (sensitive features off). Misses *full lifecycle protection* (no
  retention for most data) and *respect for user privacy* (no self-serve
  controls).
- **GDPR Article 5 principles, as good practice** (we are a hobby guild, not a
  data controller claiming compliance): *transparency* now met; *data
  minimisation* partly (filtering on the PC; but server-wide /who and position
  every few seconds); *storage limitation* not met; *integrity and
  confidentiality* partly.
- **Mozilla's Lean Data Practices** ("stay lean, build in security, engage your
  users"): engage — met by the page; stay lean — partly.
- **OWASP Top 10 Privacy Risks**: *non-transparent policies* is addressed by
  the rewrite; the ones that still apply most are *insufficient deletion of
  personal data*, *collection of data not required for the primary purpose*
  (server-wide /who), and *missing or insufficient session expiration* (Mimic's
  sign-in tokens never expire).

Also in this change: the real character name in the page's hail example became
the invented `Brackwyn`; the relayed-tell quote in §4 lost the character name;
`CLAUDE.md`'s "HTTP-only cookies" and "excluded characters never contribute or
display" lines were corrected; the roadmap gained the Web 1.8.5 entry.

## 22. DPS meter header: a bare 📋, and the controls in two stacked columns (2026-09-25, Mimic 2.7.2 beta)

The guild lead, mid-raid, from a screenshot of the DPS meter on Blood of
Ssraeshza (the name wrapped to three lines beside `📋 /rs`, `− 16 +` and a
one-row `DPS Tank History` strip): *"the /rs is too big, should just be a copy
icon. We should stack DPS and Tank on top of each other and make more
horizontal room."*

**Built as asked, plus one step, and why.** The copy button is a bare 📋 (✓
for two seconds after a copy) and DPS sits on top of Tank. Measured in a
headless render at the screenshot's 321px: that alone took the name from
three lines to two — the name needs ~147px and got 86. History, left beside
the DPS/Tank column, was the next-widest thing (~52px), so it moved under the
− N + counter: `[− N +] / [History]` then `[DPS] / [Tank]`, two columns, the
header two rows tall. With Consolas-width text (what Windows renders; the
cloud box has none, so widths were scaled) the name then fits on one line,
with ~4px to spare after trimming two margins; at 260px it wraps to two. The
header row is centred vertically, which also moves the name clear of the ✥
corner.

**The alternative, if History under the counter reads wrong:** History back
beside DPS/Tank (as literally asked). Cost: the name wraps to two lines at
~320px. Build and change cost are one markup move either way.

## 23. The guild lead's agent stalled mid-fight on Emperor Ssraeshza (2026-09-25, ~03:20 UTC)

The guild lead, mid-raid: Target Info *"is frozen mid-fight"*; the full
screenshot also showed the CH chain overlay's red **"OVERLAY BLIND — agent not
responding. GO MANUAL."** (no answer from the local agent for 5 s). A Mimic
restart fixed it.

**What the server side shows** (aggregate counts only):
- **It was the agent, not one overlay.** The guild lead's threat-snapshot
  uploads ran at 5–10 a minute from 03:10, fell to **1 in the 03:20 minute**,
  and came back at 03:21 with the restart. Uploads are the agent's own
  outbound work, so the whole process went quiet, not just its local server.
- **Only this one agent.** The other 13 uploaders in the fight held a steady
  10 a minute straight through 03:20.
- **Already running slow before the stall:** the guild lead's rate was 5–9 a
  minute in the minutes before, against everyone else's 10.
- **Not a slow leak over the night:** the agent had been running only ~15 min,
  since the update to 2.7.2-beta.2 (between 02:49 and 03:09 UTC). beta.2 changed
  only the DPS meter header (renderer code, cannot stall the agent); the agent is
  3.7.16, the same as the 2.7.1 stable.
- **Ruled out by reading the code:** the HUD's per-request work (`_serializeMeState`):
  the hit list is capped at 400, swing rounds at 40, the swing fit is bounded,
  and the three loops added since 09-22 all terminate.

**Cause: not found yet.** Mimic restarts an agent that CRASHES; nothing restarts
one that HANGS (no watchdog in `main.js`), which is why this needed a manual
restart mid-fight. Next: the guild lead's `%APPDATA%\wolfpack-mimic\agent.log`
around 23:15–23:22 ET (it appends, so the lines before the restart survive), and
a proposed hang watchdog — ping the agent, and restart it after ~30 s without an
answer, without counting that as a crash for the rollback logic.

**Follow-up, same day — cause found in the agent.log, fixed on beta (agent
3.7.17).** The log has no per-line timestamps, but three boots can be dated from the
catalog-cache stamps and the queue-file names: beta.2 at **03:05:06 UTC**, the
manual restart at **03:21:23 UTC** (the server-side gap), and beta.3 the next
morning. Nearly all of the session between the first two is one line repeated
**4,656 times**: "<A>'s fight on Emperor Ssraeshza ended via peer <B>",
alternating with the reverse.

- **Mechanism:** `EncounterBuilder.flush()` closes matching fights on its live peer
  trackers, so one whose log missed the kill line doesn't sit open forever. It did
  that **before resetting itself**, so the peer's own flush found the first tracker
  still open and flushed it back, A → B → A → B, until the call stack overflowed.
  A bare `catch (e) { void e; }` swallowed the RangeError. Every level then unwound
  normally, each having re-run a whole boss flush and re-queued its upload. That
  is the minute-plus of blocked process.
- **Not the first time:** the same logs hold three earlier cascades that nobody
  noticed: Thall Va Kelun **5,417** levels deep, A Shissar Defiler **3,344**, and an
  earlier Emperor attempt **1,033**. The code has been like this since at least
  2026-09-11.
- **Server not flooded:** no uploader has more than 11 contribution rows in
  02:30–04:00 UTC, so the repeats either never left the blocked process or merged.
- **Fix:** reset *before* closing peers (capturing the boss name and last-event time
  first), so a peer's loop finds nothing open and the chain ends at one level; the
  catch now logs. `test/cross-flush-no-recursion.test.js` drives the real class:
  two and three trackers each flush once, and a tracker on another boss stays
  open. On the old code it fails with **440 flushes per tracker instead of 1**.
  Full gate green (293 files / 4,036 tests).
- **Scope:** only installs running more than one live tracker in the same fight.
  The stable agent 3.7.16 carries the same code, so stable needs a graduation.
  The hang watchdog is still worth doing as a backstop, but it is no longer the
  fix.
- **Found in passing, not changed:** every boot logs "queue file unreadable
  (Unexpected end of JSON input)" and moves the queue aside as `.corrupt-*`. It is
  a false alarm: an empty queue saves as a zero-byte file, and the loader's legacy
  fallback runs `JSON.parse('')`. Nothing is lost, but it leaves a corrupt-file
  artifact at each start.


## 24. Keys assumed from NO DROP loot, for every keyed zone; quests and inventory get separate switches (2026-09-25)

The guild lead: *"we should separate out inventory versus quests"* and *"sweep
for no drop items from zones that require keys and make key assumptions for
them."*

**Which zones need keys — from the server, not memory.** `eqemu_doors` rows with
a key item that teleport into another zone (all `opentype` 58: each player
clicks the door with the key in hand, so one key-holder cannot let a group in).
Exactly five on the Quarm mirror: **Veeshan's Peak** (Key of Veeshan),
**Sleeper's Tomb** (Sleeper's Key — new; not keyed on classic live, keyed on
Quarm), **Howling Stones** (Key to Charasis — the old seed had no key item),
**Sebilis** (Trakanon Idol), **Vex Thal** (The Scepter of Shadows). Each zone's
one `zone_points` row sits on its door (the door's destination record), except
Veeshan's Peak's, ~200 units off — treated the same, unconfirmed.

**The rule, tightened** (`20260925112238`, made fast in `20260925112514`): an
item is evidence when it is NO DROP, drops in exactly one zone and that zone is
keyed, and is not a quest reward anywhere. Two changes from June's version:
- a drop's zone now also comes from the NPC id's zone prefix for NPCs with no
  placed spawn (scripted bosses) — +12 evidence items, and stricter where a
  scripted NPC drops the same item elsewhere;
- quest rewards are excluded — the sweep found five false positives: the four
  Resistance Stones (Sleeper's Tomb drops, also Shadowhaven rewards) and A Dusty
  Iksar Skull (Howling Stones, also a Cabilis reward). No evidence item is a
  tradeskill product.
Polarity re-verified: `eqemu_items.nodrop = false` means NO DROP on this mirror.

**The sweep** (`inferred_zone_access('wolfpack')`, service role only): 24
characters with Howling Stones access, 97 Sebilis, 64 Sleeper's Tomb, 69
Veeshan's Peak, 76 Vex Thal. Sebilis looks high and is real: the NO DROP
Fungus Covered Great Stick and Scale Shirt drop 100% from the Myconid Spore
King, a level 56 named on a 26-minute respawn that people have camped for
years (the tradeable Staff/Tunic come from ordinary myconids at 0.5%).
The quests page's "Inferred zone access" card uses the same rules and now knows
all five zones — live on production already, since it reads the database.
Per-call cost: 4.5 s in the first version, 168 ms after filtering to the
character's own NO DROP items first.

**Not done:** catalog quests for the Charasis and Sleeper's keys (there are none,
so those two zones show access but tick no quest), and a guild-wide keys view
("who can enter VT tonight") — the sweep function is there for one when wanted.

**The split** (on `beta`, `a77c58fd`; column live as `20260925112702`):
- `characters.show_quests_publicly` is new and backfilled from the old flag, so
  the 11 characters that had "Quests: public" on keep their quest pages public.
- `/me` has **"Quest page"** and **"Inventory page"** switches. "page" keeps
  them apart from the existing "Inventory: on / EXCLUDED" upload switch.
- The quests page gates on the quest switch; a visitor who can see the quest
  page but not the inventory page does not get the inventory listings on it
  (key-evidence names, discovery, stack turn-ins, rewards held, hidden/dismissed,
  the "probably don't need" lists, broken items).
- **Graduated, web 1.8.8 (same day).** The guild lead: *"go ahead, make their
  inventories private."* Those 11 characters only ever saw a switch labelled
  "Quests", yet it also shared their inventory. Their inventory pages went
  private (`20260925120704`), applied only after 1.8.8 was serving so their
  quest pages never showed as private under the old code; the quest pages stay
  public. Result: 0 inventory pages public, 11 quest pages public.
- Before graduation, production was unchanged: main read the old flag for all
  three pages until 1.8.8.

## 25. The sharing change announced in #wlfpck-general; HUD hit numbers can sit outside the ring (2026-09-25)

**The post.** The guild lead: *"post the inventory change to Wlfpck-general
channel."* No session can post to Discord directly, so it went out the way the
2.7.1 card did: a one-time post in the bot (bot 3.1.149,
`_announceInventorySplitOnce`), latched in `bot_kv`
(`announce_inventory_split_general`) so no redeploy can repeat it. Posted
2026-09-25 12:37 UTC. It says what the "Quest page" and "Inventory page"
switches do, that the old switch also shared inventory, and how to turn
inventory back on; it names and pings nobody.

**HUD numbers outside.** The guild lead: *"add an option for the HUD to have
damage numbers outside the circle."* ⚙ builder → Hits → *Numbers inside or
outside the ring* (default inside), on `beta` (`cfb53ee5`, Mimic 2.7.2 beta).
Outside, the columns mirror — your hits flush left against the right side of
the ring, hits on you flush right against the left — starting clear of the
health/mana labels (r ≈ 197) and running outward. The window widens 1.6× about
its centre when the option flips (and narrows back), so the ring keeps its
size; nothing else had to move because both SVG layers were already
`overflow: visible`. One layout, as asked — the inside/outside choice *is* the
option. The picker row now sits by the ring's height (`--ring-h`), since the
window is no longer square.

## 26. A Bandolier chat filter for Zeal — change on the guild lead's fork (2026-09-25)

The guild lead, from the Quarm Discord thread "Bandolier Spam/Filter Option":
*"This is something I'd like to get implemented in Zeal. Please review Zeal and
lets find a way to add a chat filter for Bandolier messages. Currently they're in
Other i believe."*

**Confirmed in Zeal's source (v1.4.7):** `/bandolier` is Zeal's own feature and
prints with `print_chat()`'s default color 0 — the client's **Other** filter. So
it is fixable entirely inside Zeal, no server change.

**The change** (`docs/zeal-bandolier-filter-request.md` has the PR text; branch
`bandolier-chat-filter` on github.com/davehess/zeal, 25 lines across 5 files):
a new `CHANNEL_BANDOLIER` and a **Bandolier** entry in the Zeal chat-filter
submenu, on the existing `/mystats` pattern. Routine status lines (loading, swap
complete, already equipped, please wait, saving, list) go there; failures keep
their channels so a swap that did not happen is still seen. Same colour as
before; unassigned it shows in the main window, so nothing moves until someone
assigns it. Appended last because Zeal saves each filter's window by list
position (`ChannelMap41+index`). A filter, not a suppress checkbox: it covers
both asks (own window, or a window kept out of the way) and adds no setting.

Not compiled here (no MSVC in a cloud session). The other open Zeal issues the
guild lead shared are triaged in the same doc — #218 is already done (can be
closed), #213 (target level/class/race + loc on the pipe) is the one worth doing
next for Mimic.

**Follow-up, same day — failures go in the filter too.** The first build (`4d16f8d`)
compiled clean (0 warnings, 0 errors) and passed in game: Bandolier listed after
Zeal Spam, loads and swaps in their own window. The guild lead then spotted a red
*"You cannot swap items when holding something in the cursor!"* and asked where it
went. Zeal prints the same "cannot swap" text two ways: default colour (Other) when
the pre-swap check catches it, spell-failure red when a step fails mid-swap; "no
empty inventory slot" / "item not found" were red too. Offered: A (leave as
tested), B (make the pre-swap ones red for consistency), and the option the session
advised against, routing failures into the filter (a hidden Bandolier window would hide a
failed swap). **The guild lead's call: *"B, those should all be part of the
filter"*** — every bandolier message goes to the Bandolier filter, failures in red.
Landed as a second channel, `CHANNEL_BANDOLIER_FAILURE` (1012) → spell-failure
colour, taken by the same filter entry, so failures still stand out *inside* that
window. Usage stays default colour (it also prints after a successful `/band bag`,
a pre-existing fall-through that was left alone). Amended into the single commit
(`30a79bb`, still the guild lead's authorship), force-pushed. **Rebuilt and passed
in game the same day**: cursor, no-empty-slot and set-does-not-exist failures red in
the Bandolier window, loads/swaps in the default colour. A load typed mid-cast never
reaches Zeal — the client answers "You can't use that command right now" first —
which the guild lead called fine; the PR's test step was reworded to match. Ready to
open.

## 27. Six icon shapes for Zeal `/tag` — branch on the guild lead's fork (2026-09-25)

The guild lead: *"We should make another branch for additional zeal tag icons. see
about generating some of these"*, with a reference strip of six raid markers
numbered 1–6: skull, red X, gold sword, blue diamond, green flame, purple star.
The upstream maintainer had said in the Quarm Discord that a skull was tried and
dropped because *"the 2-d extrusion approach"* did not look right.

**The approach that gets past that:** each shape is several convex parts (fan-
triangulated), concave outlines come from overlapping parts, and detail is a part
standing 0.03 proud of both faces in a dark or light accent tone — eye sockets,
nose and teeth on the skull, the sword's fuller, the diamond's facet, the flame's
core. Same unlit, vertex-coloured triangle-strip path as the arrow/octagon/paw; no
textures. Geometry lives in a new DirectX-free `tag_shapes.cpp`, which is what made
an off-client check possible: `docs/upstream/zeal-tag-shapes/preview/` compiles it
unchanged with g++, decodes the strips exactly as Direct3D draws them (all indices
in range, no stray join triangles) and rasterises `preview.png` with the same
gradients. Keys `^1^`–`^6^` follow the numbering on the reference strip; older
clients ignore an unknown key and still show the text. Side fix in the same
change: the shape is chosen from the tag's own colour before a nameplate colour is
substituted, so a nameplate colour can no longer draw a paw by coincidence.

Not compiled with MSVC yet (no Windows SDK in a cloud session). Branch `tag-shapes`
(`fefa1c0`), starts from 1.4.7, independent of the Bandolier branch. Our agent's
tag parser knows only R/O/Y/G/B/W/P/S — it needs `1`–`6` (and the prettyprint
regex the six names) once upstream ships, not before.

## 28. Zeal tags that survive a crash, relog or character switch — and stay in their zone (2026-09-25)

The guild lead: *"We should see what it would take to persist zeal tags in zones
for users that crash and come back in and lose the tags on mobs or switch
characters and lose them. That's a current issue"*, then *"As well as not tag same
spawn-ids in other zones"*.

**Both causes, read from Zeal 1.4.7:** tags live only in `nameplate_info_map`
(keyed by entity pointer), which `clean_ui()` empties on zoning, character select
and a graphics device reset — nothing is ever written to disk. And
`handle_tag_message` applies a received tag by `get_entity_by_id(spawn_id)` alone.
Spawn ids are per zone, so an rsay or chat-channel tag from someone in another zone
lands on whichever local mob has that number, even though the sender already puts
the stripped target name in the message.

**Built rather than scoped** — branch `tag-persistence` on the fork (`0d66a28`, now `ca71999` — see the crash note below),
starting from 1.4.7:
- a received tag must also match the local entity's stripped name; no message
  format change, so older clients and our agent's parser are unaffected;
- about once a second, live tags are mirrored into a map keyed by {zone, spawn id}
  with the name, written to `<character>_tags.txt` on change (temp file + rename),
  and restored onto a returning entity with the same zone, id and name;
- dropped when the mob becomes a corpse, when another name holds the id, on a
  `clear` (the whole zone, out-of-view mobs included), or 3 hours after last seen.
  `/tag persist` toggles it and defaults to on.

The file load and save functions were extracted verbatim and round-trip tested with
g++. Mutating the merge rule and the expiry rule each made the test fail. Not
compiled with MSVC yet.

**Choices made without asking, listed in the PR doc so the guild lead can change
them:** 3 h expiry (a zone that repops overnight reissues the same ids and names,
so a long window would restore yesterday's tags on today's mobs); on by default;
one file per character; name-only cross-zone check (a zone field in the message
would close the rare same-name-same-id case but changes the wire format our agent
parses). **Not covered:** tags sent while a client was offline — recovering those
needs a resync between clients over rate-limited chat channels, a separate design.
Doc: `docs/upstream/zeal-tag-persistence/`.

**Crash on first build, same day.** The combined `test-all` build crashed EQ at
launch: Zeal's own dialog, a null read in `Zeal.asi`, `Callbacks: Startup`. The
Windows 11 update in §29 was ruled out by `winver` (the guild lead is on Windows 10,
build 19045). The guild lead sent the crash zip plus their `Zeal.asi` and `Zeal.pdb`.
`scripts/read-minidump.py` gave the offset `Zeal.asi+0x9fcd9`, and `llvm-symbolizer`
on the PDB named the chain: `NamePlate::NamePlate` → `setting_zeal_fonts`'
constructor → `ZealSetting::init` runs its change callback → `clean_ui()` → the new
`saved_tags` loop, on a map declared *below* the settings and so not yet
constructed. Fix `ca71999`: the persistence state moved to the top of the class,
with a comment. **Lesson for any Zeal change:** a `ZealSetting` with a callback runs
that callback during construction, so anything the callback touches must be
declared above it. **Method worth keeping:** crash zip + `Zeal.asi` + `Zeal.pdb` →
`read-minidump.py` → `llvm-symbolizer --obj=Zeal.asi <0x10000000+offset>` gives
file:line from a cloud session in two commands.

## 29. Field issue — Windows 11 preview update KB5124010 breaks EQ at launch (2026-09-25)

A member reported in the Quarm Discord (shared by the guild lead): EQ would not
launch, or crashed at once, with Windows' *"Memory could not be read"* box, **even
with Zeal disabled**. The cause was the Windows 11 preview update **KB5124010**
(build **26200.9550**), installed overnight, and uninstalling it fixed the client.
One machine, mechanism unknown. Written into `docs/RUNBOOK-client-crash-triage.md`
§3b as the first question for any "worked yesterday, crashes at launch even without
Zeal" report, ahead of the §5 ladder.

## 30. Zeal tags, round two — letter keys, numbered badges, a wolf; corpse tags checked (2026-09-25)

**In game, first test build (`test-all`):** all six icons rendered over live mobs.
Persistence held through a camp and through `/q` (the
guild lead's stand-in for a crash, quicker to log back in from).

**The guild lead's calls:**
- *"we should have numbered tags 1-12, each of those other icons should have their
  own tag that's not a number"*.
- *"add in a wolf"*, with the guild's wolf-head logo as the reference.

**Landed on `tag-shapes` (`b83036b`):**
- **Icon letter keys:** `K` skull, `X` X, `A` sword, `D` diamond, `F` flame, `T`
  star, `L` wolf.
  - Chosen to avoid R/O/Y/G/B/W/P/S. An older Zeal reads only the first key
    character, so a free letter shows the text and no shape. `S` for skull would
    have drawn a stop sign on those clients, the opposite message.
  - `L` is the only free letter in "wolf".
- **Numbered badges `^1^`–`^12^`:** a white disc with block digits.
  - `^10^`–`^12^` are read as two-digit keys only when both characters are digits
    and a `^` follows, so no existing prefix changes meaning.
  - The digits sit on each face separately, with the back copy mirrored, so a badge
    never reads backwards.
  - A dark badge was rendered too and lost contrast on dark backgrounds, so white
    is the default (one constant).
- **Tests:** the key parser was extracted verbatim and tested with g++ for every
  number, every letter, `13`/`0`/`-`, and no collision between badge values and
  named colours. All 19 meshes pass the strip check.

**Corpse tags — why they don't work today.** It is deliberate code in
`nameplate.cpp` (1.4.7), not an engine limit:
1. `is_taggable_target()` allows only Player and NPC types, so `/tag` on a corpse
   answers "Must have a valid target with a visible nameplate".
2. `handle_tag_message` adds tag text only to `Type == NPC`.
3. `render_ui` skips both tag text and shape when `is_corpse`.
4. The tagged-nameplate colour is skipped for corpses.
5. `/tag target` needs a tab-targetable NPC, and corpses are not.

A tag on a living mob therefore stays in memory after it dies, just hidden. Our
persistence branch drops it at death.

**Allowing it** would take about five small edits, plus one design choice: whether
a kill marker should vanish at death. The recommendation is yes. Hide tags a mob
carried before it died, and show only tags set on the corpse itself (a flag saved
when the tag is applied). Otherwise every "kill skull" would linger on the corpse.

Not built: the guild lead's call, together with whether player corpses (rez
priority) are in scope. The corpse keeps the NPC's spawn id on EQEmu, as far as we
know. That is **unverified on Quarm**, and so is whether a player corpse keeps the
player's id. The name check would still hold either way, since `strip_name` drops
"'s corpse".

## 31. Zeal tags, round three — traced wolf (five variants), moon, lasso, lute, shield, lettered paws (2026-09-25)

**The guild lead's calls, in order:**
- *"That wolf doesn't look good, try 5 more versions. use the wolfpack.quest
  landing page svg and make the eyes yellow"*.
- A moon, a lasso and a lute as reference images: *"that's a moon, lasso for
  pulling, and a lute for bard"*.
- *"Take the pet paw and add each digit and letter in so charmers can add their
  initial in"*.
- *"we also need a version of this shield"*.

**The wolf is now traced, not hand-built.** The landing-page wolf is a PNG, not
an SVG: `web/public/wolf.png` (bone, alpha-keyed) plus `wolf-eyes.png` (the
`#FFCF5C` eye islands); provenance in `wolf.provenance.txt`.

`trace_wolf.py` builds it with the standard library only: a PNG decoder,
crack-following contours, Douglas–Peucker, ear clipping. It follows the artwork's
nesting (face → dark linework → yellow eye islands → pupils) and fills each region
as its own layer, one step prouder than its parent, so nothing needs a polygon
with holes. The output is `Zeal/tag_shapes_wolf.inc`, generated data like the
paw's point tables.

**Five variants, all built from that trace** (`wolf-variants.png`):
1. **classic:** the landing wolf in bone.
2. **outlined:** a dark border, for bright backgrounds.
3. **badge:** on a dark disc, matching the numbered badges.
4. **shadow:** a dark silhouette with glowing eyes, like the site's
   `wolf-solid` + `wolf-eyes` layering.
5. **steel:** grey with light linework.

A full-detail trace and a silhouette-only version were tried and dropped: the
first reads the same as classic at tag size, and the second lost its eyes on a
bone face. **Classic ships as a placeholder until the guild lead picks.**

**New keys** (all avoid the letters an older client already draws):
- `M` moon (mez);
- `U` lasso (pull);
- `N` lute (bard);
- `H` shield (tank; the reference was a 50-px grey heater shield, built with a
  darker rim, cross band and boss);
- `^P0^`–`^PZ^`: the paw with a 5×7 block letter or digit on its pad. It is
  drawn as the paw plus a glyph shape queued at the same spot, so there are 36
  small glyph meshes rather than 36 paws. An older client reads `^PK^` as a
  plain paw.

**Checks:**
- All 59 meshes pass the strip check, and each wolf variant was compiled through
  the real code.
- The key parser was extracted verbatim and tested: every number and paw glyph,
  every letter, lowercase paw letters, and no collision among named, numbered and
  paw-glyph colours.
- `static_assert`s now tie `TagArrows::Shape` to `TagShapes::Kind`.

**Found in passing:** a `test-all` rebuild hit a merge conflict (the include lists
of the shapes and persistence branches). A pipe masked the failed merge, so
`test-all` was briefly pushed without persistence (`e4af8d0`). Fixed within
minutes as `302f764`. Lesson: never pipe a `git merge` whose exit status gates a
push.

## 32. Zeal tags, round four — outlined wolf on `^WP^`, $ and €, and a symbol for each guild (2026-09-25)

**The guild lead's calls, in order:**
- *"Dollar Symbol, Euro symbol. For the wolf i like the second column"*: the
  **outlined** wolf ships, plus `^$^` (green) and `^E^` (amber).
- *"We should try to make a symbol for each of these guilds"*, with a list of 29
  guilds.
- *"make the wolf WP"*: the wolf's key moved from `^L^` to **`^WP^`**, and `L` is
  free again.
- *"before you render all of those symbols in c++ please show me a preview of all
  of those guild symbols"*: **no C++ for the guild symbols until the guild lead
  has picked from the preview.**

**`^WP^` is the one icon key that an older client draws as something.** It reads
the `W` and shows a white arrow, where every other new key shows text only. A white
arrow is still a plain marker, not a contradicting one. Only an exact `^WP^` changes
meaning; `^W^` and `^WPx^` stay white arrows. The extracted-parser test covers all
three, and it was mutation-checked in both directions: dropping the two-character
read, and mapping `WP` back to white.

**Guild symbols: two directions, prototyped in Python only**
(`docs/upstream/zeal-guild-emblems/`, the script in
`zeal-tag-shapes/preview/guild_emblems.py`). Both use the same part rules as
`tag_shapes.cpp`, for 30 guilds: the list plus Wolf Pack, whose symbol is the
`^WP^` wolf from a dump of the real meshes.
- **Pictograms, one per guild.** These read far better at tag size.
  - Cost: every new, renamed or redesigned guild is a Zeal release.
  - Risk: a table of guild artwork may not be something upstream wants.
- **Monogram banners.** One template, with any code typed in the tag.
  - Cost: no maintenance per guild.
  - Measured weaknesses: colour computed from the letters collides (9 of 30
    green), and three letters are barely legible at about 40 px.
- **Proposed: both behind one key, `^#<code>^`.** Zeal draws the guild's pictogram
  when it has one, and the banner otherwise. What people type never changes when
  a guild gains a pictogram.
  - Checked against upstream `e24a3ed`: an older client turns the shape off and
    shows the text.

**Guessed, for the guild lead to correct:**
- Every code (guilds may have their own).
- The symbols the proposal marks as a stretch: Axiom, Hardened Casuals, The Drift
  and Mass Group Ego.

**Checks:**
- All meshes pass the strip check (wolf 854 vertices, dollar 650, euro 500).
- `preview.png` was re-rendered with 13 icons.
- The patch was regenerated from `22ce809`.

**Found in passing: a chained push command reset a local branch.** A
`--force-with-lease` push with no remote-tracking ref (the fork's fetch refspec
covers only `main`) was refused as "stale info". The command's `a && b || c`
chain then ran the fallback `git reset --hard main` on the current branch, which
was `tag-shapes`. Nothing reached the remote. It was restored from the reflog, and
the diff was verified to be only the `WP` change.

Lessons:
- On that fork, give the lease explicitly: `--force-with-lease=<branch>:<sha>`.
- Never let `||` follow a chain that contains a push.
- Check the merge state by hand: `set -e` did not stop the merge loop that
  rebuilt `test-all`.

## 33. Guild marks built: a banner (`^B<code>^`) and an icon (`^I<code>^`) for 30 guilds (2026-09-25)

**The guild lead's calls:**
- *"I like the flags, make them B__ for Banner. Lets put them all in and give me a
  list of each of the tag commands so i can try them out in game after we compile"*
- *"I want both"*: the banners and the icons.

**What landed on `tag-shapes` (`3c02f65`; `test-all` `dfe6143`):**
- **One table, `TagShapes::kGuilds`**, one row per guild: code, name, banner colour,
  icon colour. Changing a code is a one-row edit.
- **`^B<code>^`** is the swallowtail banner with the code in the paw glyphs' 5×7
  font.
  - Banner colours step round the hue wheel by the golden ratio, alternating bright
    and deep. This replaces the preview's colour hashed from the letters, which put
    9 of 30 in green.
  - Wolf Pack's banner is the platform gold.
- **`^I<code>^`** is the guild's icon: 27 ported from the Python prototype.
  - Wolf Pack, Europa and Loot & Some Fun use the existing wolf, € and $ through
    an `icon_key` alias, so no mesh is duplicated.
  - The d20 now shows its "20": the prototype drew the digits level with the face,
    so they were hidden.
- **Keys:** `B` or `I`, then letters up to the next `^`, read as a guild key only
  when they name a guild (either case).
  - So `^Blue^` stays a blue arrow, as does `^BC^` (Breakfast Club is `^BBC^`).
  - On an older client a banner shows as a blue arrow; an icon shows as text only.
  - **The icon letter `I` was our pick**: the guild lead named only `B`. `I` is not a
    key on older clients, so nothing wrong is drawn there.
- **`/tag guilds`** prints every code and name, five to a line. The help, README,
  prettyprint (`Banner EUR`, `Icon MAY`) and tooltip all know the new marks.
- **Geometry additions:**
  - a small ear-clipping triangulator, for the concave outlines (bolt, crescent,
    wings, claws, crown);
  - tapered-stroke, petal and chain-link helpers;
  - a settle step that centres each icon and puts its base at z = 0.

**Checks:**
- All 120 new meshes pass the strip check. The three alias icons are empty by
  design.
- The build is clean with `-Wall -Wextra -Wconversion`. Zeal builds with MSVC `/W2`
  and does not treat warnings as errors.
- The key test covers every guild in both cases, the alias icons, the unknown-code
  cases, and all **126 tag colours distinct**.
  - It now also extracts `TagArrows::Shape` from `tag_arrows.h`, so the shape
    lookup is tested against the real enum.
  - Four mutations were each caught: dropping the guild key read, the banner
    colour, the icon alias, and the banner shape.
  - The test ran on the `tag-shapes` source and again on the merged `test-all`.
- The vertex buffer grows from about 12k to about 32k vertices (about 0.5 MB).
- `guilds.png` is rendered from the real meshes.

**For the guild lead:** `docs/upstream/zeal-tag-shapes/TRY-IN-GAME.md` has the build
steps, every command, and the cases that must not change.

## 34. Corpses can be tagged; the test list is labelled key-then-name (2026-09-25)

**The guild lead's calls:**
- *"give me the testing list for the /tag local <tag> but the actual name at the end
  should be the tag lettering and then afterwards the guild name"*.
  - Done: every line in `TRY-IN-GAME.md` now reads `/tag local ^BEUR^BEUR Europa`
    (`^K^K Skull` for the non-guild shapes).
  - A tag's text is capped at 32 characters **including the `^key^` prefix**. Only
    the two Here There Be Monsters lines (33) are cut, to "…Be Monster".
- *"Also i can't tag corpses or anything without visible nameplates"*, with a
  screenshot of "Must have a valid target with a visible nameplate to tag". **Read as
  the §30 corpse decision: build it**, with the design recommended there.

**Built on a new branch, `tag-corpses` (`aa975e1`, off upstream main).** It is its own
branch so it can be its own PR. The change is 31 lines added, 11 removed:
- NPC and player corpses are taggable, and take text and the default arrow.
- `NamePlateInfo::corpse_tag` marks a tag set on the corpse itself.
  - The render path, the tagged colour and `/tag target` honour a corpse's tag only
    with that flag.
  - The first tag on a corpse replaces the mob's pre-death tag, which stays hidden
    until then.
  - So "kill skull" never lingers on the body, while "loot" or "rez me" on a corpse
    shows.
- `/tag target` reaches corpses: its filter is line of sight, not entity type.
- It merges cleanly into `test-all` (`1f866c4`). The key test passes on the merge.
- The persistence branch still drops a mob's saved tag at death, and does not save
  corpse tags across a relog (corpses decay).

**Not built: tagging a target whose model is not drawn** (too far away, or not loaded
yet).
- A tag lives on the per-nameplate entry keyed by entity pointer, which is created only
  for a drawn actor and erased in the entity-destructor hook.
- Pre-creating one for an undrawn actor risks a dangling pointer if that hook does not
  fire for it.
- The safe design is to hold the tag by spawn id and apply it when the nameplate
  appears (what the persistence branch already does on restore).
- **Waiting on the guild lead:** which mob hit the message, and whether this case is
  wanted.
- Race-hidden nameplates and "names off" were checked: those mobs have an entry and
  can be tagged today.

**Not compiled with MSVC here.** The corpse change touches only `nameplate.cpp/.h`,
which needs the DirectX headers. It was reviewed and formatted but not compiled.
`test-all` is the first real build of it.

## 35. HUD tracking arrows — eight round the ring, the tracked mob's direction lit (2026-09-26, agent 3.7.18 beta)

**Where it came from:** a member, in a Discord DM to the guild lead, with a mockup of
eight yellow arrows round the HUD: *"for tracking. Ahead, Head and to right/left,
behind left/right behind you? you think thats too much?"* The guild lead: *"YES omg
great idea"*, then to this session: *"let's get to work"*.

**The data is the client's own tracking lines**, from eqstr_us.txt. It was checked in
two independent copies of the file (a Trilogy-era `eqstr_en.txt` and an archived
`eqstr_us.txt`); the EQMac server source only defines the IDs, so the client prints
them itself:
- 12040 `You begin tracking %1.`
- 12676 `%1 is straight ahead.` · 12677 `%1 is ahead and to the %2.` · 12678 `%1 is
  to the %2.` · 12679 `%1 is behind and to the %2.` · 12680 `%1 is behind you.` —
  with %2 = 12674 `right` / 12675 `left`.
- 12681 `You have lost your tracking target.` · 12499 `You have lost or do not have a
  tracking target.`

**Not yet seen in a real log.** Quarm's client is expected to print these words, and
community posts quote the same shape ("Gorenaire is ahead and to the left"). If the
live wording differs, the parser table `_ME_TRACK_DIRS` is the one place to change.

**Decisions taken while building (the guild lead to overrule):**
- **Guard against /emote.** A player can emote "Bob is behind you." So a direction
  line counts only for the mob named by "You begin tracking", or when the character
  is a Ranger, Druid or Bard.
- **How long a direction lasts.** It is kept 5 minutes after its line, because the
  client speaks when the direction changes, so silence is not a lost track. It dims
  after 15 s on the HUD, and a zone change or either "lost" line clears it.
- **Where the arrows sit.** The diagonals are in the square's corners, as in the
  mockup. The four others sit INSIDE the ring (inner end at r 110), because the edge
  is taken at 12, 3, 6 and 9 o'clock:
  - the target's target on top;
  - the HP and mana labels at the sides;
  - the always-visible ✥ Box HUD ✕ row underneath.

  A Playwright render measured the result. The first try put all eight at the edge
  and collided at all four; inside, "behind" ends 4 units above your resists at the
  default size.
- **Builder options.** A new ⚙ section, Tracking: on/off, "Arrows drawn: all | lit",
  and a size slider. All eight is the default, matching the mockup.
- **No rotation between lines, yet.** Zeal sends our own heading, so the arrow could
  turn as you turn. But which way EQ's heading counts is not pinned down, and a wrong
  sign would swing the arrow the wrong way. Left out until it can be checked in game
  (turn left, watch the number).

**Checks:**
- 5 agent tests and 4 HUD render tests.
- Mutations of the class gate, the zone drop and the lit-only option were each
  caught.
- The full suite passed (4,045 tests); lint and check:dashboard are clean.
- Beta `fe43d0b8` (Mimic builds as 2.7.2-beta.N); roadmap entry with Web 1.8.9.

## 36. Security audit before a public guild-logo page; two fixes live; 3.0 = the overlay engine (2026-09-26)

**The guild lead:** *"could we make a site for the other guilds to upload their
consolidated logos to turn into zeal icons? it's inviting traffic into our site so
we need to do a security audit first. so far people are receptive to more icons"*

**How it was checked.**
- **In parallel:**
  - a read-only audit of the website (sign-in, every route handler and server
    action, headers, uploads);
  - a read-only audit of the bot's HTTP surface (every route, auth, limits);
  - the database: Supabase security advisors, and every policy that lets
    `anon`/`authenticated` read. Schema and counts only; no member data was read.
- **The most severe claim was reproduced before anything was reported**, locally,
  against a fake Supabase that logged each query.

**Kept out of this file on purpose**, as in §21: the findings themselves, how they
could be used, and their evidence. The guild lead has the full report privately. A
data flow gets disclosed; a way in does not.

**Fixed live the same night:**
- **web 1.8.10**: every `/admin` page that loads data now calls `requireOfficer()`
  (`web/lib/officer.ts`) as its first statement, instead of relying on the admin
  layout alone.
  - Verified locally before and after.
  - `test/admin-pages-officer-gate.test.js` walks every admin page and was
    mutation-checked.
- **bot 3.1.150**: `_tuningForAgent()` sends each agent only the tuning keys its role
  needs.
  - `test/tuning-for-agent.test.js` covers it.
  - The guild lead is to rotate the credential it concerned.

**Decided for the logo page (recommendation, the guild lead to confirm):**
- **Outsiders never get a member-grade session.** The membership work in the private
  report lands before any page invites outsiders to sign in.
- **Near-term: a public gallery plus a Discord intake.** Logos go to an officer; no
  upload on our site.
- **Later: an anonymous upload with a CAPTCHA** into a private bucket, officer-
  approved. PNG only, checked by content, capped, re-encoded; originals are never
  shown publicly.
- **Conversion stays offline, on our side.** Each new icon is a Zeal build, the same
  as the 30 guild marks (§33).

**Also decided tonight (the guild lead):**
- **Mimic 3.0 = the overlay engine.** *"a HUD/overlay builder engine where we could
  combine everything into a single transparent freeform view, or be able to have it
  see the screen and move windows accordingly"* · *"in fact that will be 3.0. can
  we have an alpha channel"*.
  - It gets an **alpha channel** of its own.
  - Traps to design around:
    - Mimic treats any pre-release as beta, so alpha needs its own updater channel
      and an opt-in;
    - old alpha releases must be pruned so they never push betas out of GitHub's
      10-entry release feed (the Linux lesson, 2026-07-30);
    - the build workflow must live on the alpha branch itself.
  - Planned, not built.
- **Clicky charge counters on the HUD.** A zeal-suggestions thread asks for a
  last-charge warning (`/protect expendable`). The Quarmy export's per-item count,
  merged with the clicks the agent sees, gives charges left.
  - Queued, not built.

## 37. A private briefing doc for read-aloud status and private decisions (2026-09-26)

**The guild lead** (while driving, after asking for the status to be read back):
*"a secure place for the outputs … and for the decisions … so that we can more
easily turn that over for text to speech to tell me what the current status is
without exposing all of the decisions publicly"*.

**The call:**
- The home is a **private claude.ai doc**, titled "Wolf Pack — private briefing".
  It is not a repo file, because the repo is public.
- **What it holds:**
  - a Read aloud status, rewritten at the end of each session's work;
  - the Waiting on you list;
  - private decisions;
  - one tab per private audit report. The September 26 audit report is its
    first tab.
- **This file stays the default** for every decision that isn't sensitive. A
  private call gets a pointer here only when other sessions need to know about it.
- **Where it landed:** CLAUDE.md, under the "decisions get written down" rule.
  - Sessions find the doc by its title. Its link is never committed.
  - **Untested:** whether Claude in the phone app can open the doc by voice
    request. The fallback is the phone's own read-aloud on the open doc.

## 38. Guild logos become tag pictures you drop in a folder, like target rings (2026-09-26)

**The ask.** Another guild's leader sent their painted shield logo. They wrote *"This
graphic is probably too complex to make into one of those"*, but asked anyway.

**The guild lead:** *"requests are coming in, probably best to have a preset and treat
them like the target rings where you can add some"*.

**The call:**
- The 30 built-in marks stay as the presets.
- New marks are **picture files** that anyone can add, the way target ring textures work:
  - `uifiles/zeal/tagicons/<name>.png` or `.tga`, used as `^I<name>^`;
  - no code change and no Zeal release per guild.
- A picture takes over from a built-in icon with the same code.

**Why pictures, not shape files** (both costed in the PR doc):
- **The requests are painted art.** A detailed shield cannot become an extruded shape
  without being redrawn.
- **Shape files would need tracing per guild.** A file format for outlines is also a
  contract that is painful to change once guilds hold files.
- **Pictures cost one textured-quad path, once.** It is modelled on the target ring and
  the 3-D nameplate text.

**Built:** branch `tag-icon-files` on the fork (`ac5d177`), merged into `test-all`
(`e742081`).
- It is not compiled here: the draw path needs the Windows build.
- The key parser, folder scan and file-header check are tested off-client with g++ and
  mutation-checked (8 of 8 breaks caught).
- PR text, patch and harness: `docs/upstream/zeal-tag-icon-files/`.
- In-game steps: `TRY-IN-GAME.md` → "Pictures".
- A picture is checked before it is decoded:
  - PNG or true-colour TGA, recognised by its header;
  - at most 512 pixels a side;
  - at most 1 MB.

**Consequences:**
- **Only players who have the file see the picture.** Everyone else sees the guild's
  built-in shape, or just the text. Tag messages are unchanged.
- **Nobody outside our own build sees any of this until the Zeal maintainers merge
  it.** Any reply to the requesting guild has to say so.
- **The logo page (§36) gets simpler.** The public gallery can offer each guild's picture
  as a download, still with no upload on our site.
  - Our step is offline: remove the background, crop, and cap the size.
  - Installing a pack through Mimic is a later option. It is not built.
- **Other guilds' art stays out of this public repo.** The test copy of the requesting
  guild's shield went to the guild lead privately. Only our own orientation card
  (`test-pictures/UP.png`, `UP2.tga`) is committed.
- **Known gap:** a picture tag comes back as its fallback shape after a relog. The
  tag-persistence file stores the shape colour, not the picture name. It is a small
  follow-up once both branches land.

## 39. The tag icons render in game; the gallery hosts the picture files (2026-09-26)

**In game.** The guild lead sent screenshots from the combined test build. They show:
- all 13 symbols (the sword and diamond close up in 3-D);
- the numbered badges 1–12;
- the lettered paws;
- every guild icon, on the labelled test list and over real players of those guilds in
  a crowded scene (Nocturnal, Mayhem, Savage, Erud's Crossing Guard, Hardened Casuals,
  Axiom, Former Glory).

The banners (`^B<code>^`) were not in the screenshots, so they are still to check.

**The call:** *"yes, host the picture files in the gallery"*. It answers §38's open
question and confirms §36's option A: a public gallery, logos through Discord, no uploads
on our site.

**Built on `beta` as a preview (`f71e9975`):**
- `/zeal-icons`, in two layouts to pick from, per the UI-options rule:
  - **A**: `b.wolfpack.quest/zeal-icons`, one catalogue page. All 30 guilds with an anchor
    each (`#eur`), the downloads, the symbols, badges and paws.
  - **B**: `b.wolfpack.quest/zeal-icons?v=b`, a short guild index. Each guild gets its
    own page, `/zeal-icons/<code>`, to hand one guild leader.
- **Costs:**

| | Build | Maintenance | Runtime | Change |
|---|---|---|---|---|
| **A** | S | S: a row in the data file plus two images | One page; 121 small PNGs (828 KB), lazy-loaded | S |
| **B** | M | S: the guild pages come from the same data | Index ~30 icons; a guild page loads 2–3 images | M: 30 URLs go out in Discord, so the path is a promise once shared |

- **The images are ours, rendered from the real Zeal meshes.**
  - The exporter is `docs/upstream/zeal-tag-shapes/preview/export_marks.py`.
  - Provenance is in `web/public/zeal/PROVENANCE.txt`.
- **The one picture file so far is Europa's shield**, as `EUR.png` and `EUR.tga`. Its
  background was removed here. It is published because their guild leader asked for it to
  become a Zeal icon.
- **The test refuses any hosted picture Zeal would refuse:** a bad header, over 512 px,
  over 1 MB, or a file name that does not match the key.

**Kept off the public page on purpose:**
- **The crowded in-game screenshots.** They carry other players' character names. Tight
  crops of the icons alone would be fine, if wanted.
- **An image in Discord link previews for guild pages (B).** It needs a change to the
  shared preview route, `api/embed-meta`, so it waits for the pick.

## 40. A tagged player keeps the tag: players are saved by name, not spawn id (2026-09-26)

**The guild lead:** *"tagged players should keep their tags if possible - i know they have
spawn ids that change"*.

**What was wrong** on the tag-persistence branch (§28): saved tags were keyed by zone and
spawn id, which only works for NPCs.
- **A player gets a new spawn id every time they zone in.** So a tagged player who
  zoned out and back, or zoned with you, came back untagged.
- **Worse:** if they left and returned while you stayed in the zone, the saved copy was
  still marked "seen live". The untagged newcomer read as a clear, and the saved tag was
  deleted.

**The call:** players are saved by name, in their own map and tied to no zone. A
character name is unique on the server.
- **The tag comes back** when they return after zoning, camping or dying.
- **It follows them** into another zone with you.
- **Their corpse** neither takes the tag nor drops it.
- **The entity destructor** marks a leaving player's saved tag as not live, so their
  return restores it.
- **A clear in view still drops it**, and a `clear` drops every player tag. Tags expire 3
  hours after the player was last seen.
- **The tag file** gains player lines (zone `-1`, spawn id `0`, then the name). Older
  builds never match them.

**Where it landed:** `tag-persistence` `9a3fd09`, merged into `test-all` `d32bed1`.
- **Tests:** `docs/upstream/zeal-tag-persistence/test/sync.sh` runs the real save/restore
  loop and destructor hook, extracted verbatim, through each case above. It also runs
  the file round trip. Six deliberate breaks, all caught.
- **Steps to try in game:** TRY-IN-GAME → "Tagged players keep their tags"; the PR
  test plan, steps 9–11.

## 41. /who overlay: the player you click goes on top, guild under the name; tags when you alone zone (2026-09-26)

**The guild lead**, raiding alongside Dungeons and Dragons and other guilds: *"add guild
under the player's name when we know it. When we click on them put them at the top of
the /who overlay"*. Then: *"If we can persist the tags per name per spawnid that would be
good if we zone out and zone back in and most people didn't"*.

**The /who overlay (agent 3.7.19, beta `f087f5c3`):**
- The player you target (click on in game, or in the raid window) gets a **Target
  card at the top**.
  - Their name, class and level show on the first line.
  - **Their guild shows on its own line underneath**, like a nameplate.
  - They are taken out of the lists below.
- **Sources, in order:** this session's /who, then /who history from the bot, then the
  raid roster's class. So an /anon raider or one you never /who'd still gets a card.
  - A history value is in italics.
  - The card appears even before any /who.
- **A pet never gets a card:** a card needs a /who row, history or a raid class.
- **The EverQuest raid window itself cannot show guilds.** It is the client's own
  window. The card is where the guild goes.
- **Considered and not built:** a guild line under every row of the list. It doubles
  each row's height, so half as many raiders fit. It is one CSS rule if wanted.

**Tags when you zone and others don't:** no change needed; it already works.
- **NPCs** have been restored by zone, spawn id and name since §28. A mob that
  stayed put keeps its id, so its tag comes back when you return.
- **Players** are restored by name since §40. That covers both the ones who stayed and
  the ones who zoned too.

## 42. /who overlay: a Zek only mode (2026-09-26, agent 3.7.20 beta)

**The guild lead:** *"Show me a Zek only mode on the Who tab"*, then *"who overlay"*.

**Built (beta `6df10cac`):**
- **The toggle:** a `ZEK` button in the overlay's title bar, lit in the ZEK flag's red
  when on.
  - **On:** Current and Recently gone show just the Zek players, and the header reads
    "Zek N of M". The Target card stays whoever it is. With none, it says "No Zek in
    your last /who".
  - It is remembered on that machine, and it has the hover handshake, like every
    clickable control on a locked overlay.
- **"Zek" is what the bot already means by it:** the guild named Zek, or an unguilded
  player the bot inferred belongs to it (who_directory's `ever_zek_guild` /
  `ever_inferred_zek`).
- **A fix that came with it:** every row now carries its Zek flag. Before, only an /anon
  row did, so a player showing `<Zek>` in /who was not flagged red.
- **Test:** `test/who-target-card.test.js`, five deliberate breaks, all caught. The
  screenshots of both states went to the guild lead.

## 43. When a character dies, Discord DMs the owner the zone and corpse /loc (2026-09-26)

**The guild lead:** *"when a character dies we should discord message them to send them their
corpse coordinates and what zone they were in. we have all of that detail"*.

**Built:** bot 3.1.151 on main, and agent 3.7.21 on beta. Only beta agents send it for now.
- **Agent (`_corpseNoteLine`, on the live tail only, so a backfill never DMs):**
  - At your own "You died.", it notes the zone and position Zeal has for that character
    right then. That is where the corpse lies; the move to the home point comes seconds
    later.
  - It sends once the death is confirmed real: "You are bleeding to death!" or "Returning
    to home point", which a feign never prints. The confirmation must come within 60 s.
  - It uses the durable queue, as upload kind `corpse`.
  - Zeal data more than 30 s old counts as unknown. The DM then says the position is
    unknown rather than quoting an old one.
- **Bot (`POST /api/agent/corpse`):** the same owner rules as the tell relay.
  - The owner is the character's `discord_id`, or its family root's.
  - **The uploading Mimic must own the character**, so nobody can aim a corpse DM at
    someone else.
  - A re-sent death is DMed only once, and each owner gets at most 6 an hour.
  - `flag_shed_corpse=1` turns it off.
- **The DM reads:** "💀 **Aldenmar** died in **Plane of Sky** 9:42 PM (5 minutes ago).
  Corpse at `/loc` **1234, -568, 89**". The time is a Discord timestamp, so it shows in
  each reader's own time zone.

**Coordinates, settled from Zeal's source, because this repo had it both ways:**
- `zone_map.cpp` notes "Position is y,x,z".
- Zeal's own `/loc noprint` prints `Position.x, .y, .z`.
- So the pipe's x, y, z are already the numbers `/loc` shows, in that order.
- The agent dashboard's Position line shows Zeal's `y` first, labelled "Y". That is
  backwards, and it is flagged as a separate small fix, not changed here.

**Left for the guild lead:**
- **An off switch per person.** Today it is only officer-wide (`flag_shed_corpse`).
  The tells relay has a toggle on /me; the same could go next to it.
- **Deaths that get rezzed still DM**, since a rez is not visible to the agent at the
  moment of death. The cap keeps a bad raid night to 6.

**Tests:**
- `test/corpse-dm.test.js` runs the bot handler: owner match, family root, a mismatched
  uploader, no linked account, a bad name, duplicate, the cap, and mentions suppressed.
  Six deliberate breaks, all caught.
- `test/corpse-dm-agent.test.js` (on beta) runs the agent side: confirmed, feign or
  unconfirmed, the position at death not at home point, another character, the 60 s
  window, and stale Zeal. Five breaks, all caught.

## 44. "Background: ON" is a near-opaque plate; Melody's bard strip gets readable (2026-09-26)

**The guild lead**, with a screenshot of Melody over bright grass: *"Really hard to see this
bandolier and the background doesn't work"*. "Bandolier" was read as Melody's bard buff
strip (Amplification, Resonance, Selo's, Niv's, Nature's Melody), the part of that
screenshot that was unreadable.

**Why the Background did nothing (every overlay, not just Melody):**
- The backdrop rule in `apps/mimic/preload.js` painted `rgb(8 10 14 / var(--bg-alpha,0.92))`.
  Every overlay defines `--bg-alpha`, so the 0.92 fallback never applied.
- Since the plate moved onto `#wrap` (July, so it hugs the content), it paints the card
  itself. Turning it on only swapped the card's tint at the same see-through level.
- Measured in Chromium with the card at 0.45: ON was 0.45 before, 0.92 after. OFF is 0.45
  both ways.

**The call:** Background ON means a plate you can read through grass: at least 0.92, and a
higher card alpha still wins. With the backdrop on, the Background slider can only make it
darker; with it off, the slider works as before.

**Melody:** a 1px dark text edge on the card (the other overlays already have one), the
strip's labels in the lighter song-chip purple, and the grey "off" chips a step lighter.

**Landed:** beta `08d4e892` (Mimic files only, so no agent bump; the beta build picks it
up). `test/overlay-opacity-and-mini-dashboard.test.js` checks the rule; putting the old
rule back fails it.

## 45. Melody: the DIRGE NUKE board (2026-09-26, agent 3.7.22 beta)

**The guild lead:** *"the melody overlay needs a little switch and a red button that says DIRGE
NUKE on it when amplification and resonance/harmonize and Puretone is available … As soon as
Amplification flips on as the last item, the control board slides out quickly but animated and
shows the Puretone Key (that turns if you do it) and then the NUKE button that has a cooldown on
it for recast and HOW MANY Dirges you can do (mana divided by 800)"*. The pre-buffs named: both
Guardian Rhythms and Psalm of Mystic Shielding, 3 minutes left on Selo's, Niv's Harmony.

**Built** as asked, with an animated preview for the guild lead (a private page, not in the repo).
How it works: `HOW-ITS-BUILT.md`, "Melody: the DIRGE NUKE board".

**Calls made from the data, for the guild lead to confirm:**
- **Selo's: 2:00, not 3:00.** Selo's Accelerating Chorus is 25 ticks (2:30) at most: formula 4 in
  `eqemu_spells` 2605, and 25 is the highest of 73 live samples in `character_live_state`. A 3:00
  lamp could never light. 2:00 means it was sung in the last 30 seconds. One constant,
  `DIRGE_SELO_MIN_SECS` in `melody.html`.
- **"Niv's Harmony" is Niv's Harmonic** (spell 1763), the only Niv's song with "Harmon" in it.
  The bard strip's existing "Niv's Melody" row is a different song (Melody of Preservation →
  Breath of Harmony) and is left alone.
- **The NUKE "cooldown" is the 3-second sing.** Denon's Desperate Dirge (742) has
  `recast_time 0`, so there is no lockout after it. The ring fills while Zeal shows the Dirge
  being cast and starts over for each back-to-back cast.
- **Puretone "ready"** uses the agent's existing disc timer. That timer is an estimate of the
  shared discipline timer (4320 s at 60), except when the refusal line gives the exact time. A
  timer never seen counts as ready, since the board is a reminder, not a gate.
- **Exact spell names** for the pre-buffs. The strip's matcher falls back to the first word,
  which would take any "Psalm of …" for Psalm of Mystic Shielding.

**Found on the way, fixed in the same change:** `melody.html` read `curKind` in the label shown
between casts but never defined it. Every tick in that gap threw, so the song list froze and the
connection dot went red until the next cast. It is also on stable. One line defines it.

**Landed:** beta `611b145b`. `test/melody-dirge-board.test.js` covers both halves; seven
deliberate breaks, all caught.

**Round two, the same morning (beta `bb40c989`, now "DIRGE TACTICAL NUKE").** The guild lead:
*"Make it Harmonize instead of Resonance, and do that first, then Selo's, then your resists, Niv's
Harmonic is a Breath of Harmony Clicky … put each of the Dirges as its own button and have the
Keyturn under a little plastic cover … Underneath put in 'Dirge Team 6 Tactical Nuke'"*.
- **Steps**, numbered and in singing order: Harmonize, Selo's (2:00+), Guardian Rhythms, Psalm of
  Mystic Shielding, Niv's (Breath of Harmony), Amplification.
  - Resonance alone reads amber: the guild lead asked for Harmonize "instead of".
  - The Niv's step checks on either buff. In `eqemu_items` the Breath of Harmony item (5156)
    clicks Niv's Melody of Preservation (748), not Niv's Harmonic (1763).
- **Cover and key:** with all six checked, a plastic cover over the key flips up. Puretone turns
  the key, and the Dirge buttons pop in.
- **One button per Dirge:** `floor(max mana ÷ 800)` buttons (up to 12), numbered. The ones current
  mana holds are lit, and the one being sung is the top lit button, its ring filling.
- **Recast:** the guild lead believes Dirges have a small recast delay. Our spell catalog and PQDI
  both give spell 742 a 0.0 s recast and 0.0 s recovery, so the only wait shown is the 3 s sing.
  That stays open until someone measures one in game.
- **Also asked for:**
  - the current Dirge count by the switch;
  - a DISC key in the bottom right: up (ready), down with the time left, or lit while Puretone
    runs;
  - the "Dirge Team 6 · Tactical Nuke" labelmaker strip under the board;
  - preview steps you can click to jump to.
- The single big NUKE button and the lamp chips are gone.

**Public demo (web 1.8.18):** the guild lead: *"throw this up on wolfpack.quest and i'll use it. I
want to place it in Discord."* It is at **wolfpack.quest/mimic/dirge**, public (it reads nothing and
names no real player), with a large Discord card. Link previews can now carry a picture, per page,
through `pageMeta.ts`. The page is a snapshot of beta's board, built by
`scripts/build-dirge-demo.js`; rebuild it when the board changes.

## 46. PvP: every death stored, grouped into fights; the alliance night in Vex Thal (2026-09-26)

**The guild lead**, the morning after an alliance of Dungeons and Dragons, Wolf Pack, Freedom and
one Squirrels of War fought the Zeks in Vex Thal: a full list of assists for everyone in the
alliance; the /who overlay with every Zek at their peak; the videos and clips on the PvP page; and
*"Lets start combining PVP encounters into history. 2+ deaths nearby constitutes encounters I
think."*

**What the data could and could not see that night** (read from the database; the numbers went to
the guild lead in chat):
- `pvp_kills` holds a kill only when Wolf Pack is on one side. An alliance-vs-Zek night was mostly
  missing from it.
- **Assists are only ever a Wolf Pack character's, and only when its own agent was running.**
  `_checkPvpAssist` credits the uploader's own character (or pet) for damage in the 120 s before a
  broadcast death, and the bot drops any assister not on our roster. Nobody else's assists, and
  no PvP damage totals, exist anywhere. Widening that is a design question, not a query: an agent
  can see other players' melee on a target in its own log, but not their spells.
- /who showed the Zek side at its peak at 05:46 UTC (35 of 70 in zone). Their wipe was
  06:03:37–06:05:07 UTC, 12 Zek deaths in 90 seconds.
- Death broadcasts carry no location. "Nearby" can only mean the same zone, close in time.
- Aside, not changed: the agent's `_isZekGuild` reads only "Zek", while the database's Zek checks
  read "Zek" or "Rise of Zek". One Zek player has worn both tags.

**Built (bot 3.1.152 on main, migration `20260926085942_pvp_deaths_and_fights`):**
- **`pvp_deaths`**: every death the PvP broadcast reports, any guilds, player kills and deaths to
  NPCs alike. It is written from `POST /api/agent/pvp` before the Discord post loop, so a post
  dedup or a missing channel cannot drop one. Its key is victim + minute, because two agents'
  relays of one death can differ by a second or two. Boss kills are not deaths.
- **Backfilled 30 days** (1,301 deaths). Wolf Pack kills come from `pvp_kills`. The rest is
  rebuilt from the `who_observations` rows the relay writes for each broadcast: victim row, then
  killer row, in one upsert, so the killer's id is the victim's + 1 (checked 9 of 9 against
  `pvp_assists.raw_text`). `source` says how each row was recovered. A killer the relay never
  stored (a death to an NPC) is left null.
- **`pvp_fights()`** groups deaths in two steps:
  - a **wave** is deaths in one zone each within 3 minutes of the last, with 2+ deaths and at
    least one player kill, so an NPC raid wipe is not a PvP fight;
  - a **fight** joins waves less than 20 minutes apart.
  3 minutes is where the gaps between player kills thin out. At 3 minutes alone the Vex Thal
  night was 19 pieces; with the 20-minute join it is five fights, the largest 04:49–06:05 UTC
  with 56 deaths (36 Zek). "Zek" is Zek or Rise of Zek, as the database reads it.

**On /pvp, beta only, two layouts for the guild lead to pick** (beta `fd1d7299`; with no `?v=` the
page is what production shows):
- **B, `b.wolfpack.quest/pvp?v=b`:** every fight is a card (zone, start, length, waves, deaths with
  the Zek share as a bar, deaths by guild, top killers), and a night's videos and clips open on its
  biggest fight.
- **C, `b.wolfpack.quest/pvp?v=c`:** a compact table of fights, and the film in its own gallery.
- The film lives in `web/lib/pvpMedia.ts`: two YouTube videos and four Medal clips, with our own
  captions (two of the clips' own titles are crude) and credits by role, plus a link to a member's
  channel. The guild lead's two screenshots join it when re-sent; pictures sent mid-task never
  reached the session's disk.

**Also fixed on main (web 1.8.16):** the /pvp trophy wall's caption, alt text and file names said
"boxers". Your rule is no boxing wording anywhere public, so they now say "a group", and the files
are `deeps-pit*.gif`.

**Tests:** `test/pvp-deaths.test.js` runs the row builder (player kill, death to an NPC, boss kill,
pet credit, no-guild spellings, two relays of one death) and checks the write comes before the
post loop. Five deliberate breaks, all caught.

## 47. /about gets pictures: two layouts on beta (2026-09-26)

**The guild lead:** *"https://wolfpack.quest/about could use some updating, possibly some generated
images and assets so it's not just blocks of text"*.

**What "generated" could honestly mean here:** there is no image model in a session. So the
pictures are made from the platform itself:
- figures drawn in the overlays' own look: the boss board, a log line being filtered on your PC,
  a merged parse card, the follow-you log folder, a raid night's ticks and bid windows, and the
  week's deploy freeze;
- a real render of the Melody Dirge board;
- ten of the Zeal tag marks;
- the landing page's wolf.
Every name in them is from the invented set, because /about is public and gets shared outside the
guild.

**Two layouts, beta `f2db9423`** (with no `?v=` the page is still the old one):
- **B, `b.wolfpack.quest/about?v=b` (Illustrated):** the story as it was, each chapter opening
  with its picture.
- **C, `b.wolfpack.quest/about?v=c` (Tour):** pictures first with one line each, and the long
  text folded under "The long version".

**Facts refreshed in both:** "five months" (was "six weeks"), 4,000+ tests in 290+ files (was
1,372 in 84), 240-odd migrations (was 189), and an eighth chapter for Zeal marks and PvP fights.
The old page still carries the stale numbers until one layout graduates.

**Next:** the guild lead picks B or C. It then graduates to main, the other layout and the old page
are deleted, and the roadmap gets an entry.

## 48. The alliance gate in front of /who (2026-09-26)

**The guild lead:** *"I mentioned an alliance gate in front of the /who overlay and page. we
shouldnt just give away our secret weapon. admins can choose to submit who observations, but end
users should ultimately decide on if their characters are linked outside of the guild"*.

**The policy.** It extends §8.6–§8.7 of `DECISIONS-2026-09-18.md`, which covered other guilds'
own deployments, to our own site.
- **The secret weapon stays ours.** That means /who history that fills in anonymous players, the
  Zek flags built from it, and which character is whose alt. Members get it; nobody else gets it
  by default.
- **Allies get in only through an alliance grant**, issued by our officers to an allied guild.
  What a grant shows is limited: what the game itself shows in /who, and no filling-in of
  anonymous players from our history.
- **Guild-level: admins choose whether their guild submits /who observations** to what the
  alliance can see. Off until an admin turns it on.
- **Person-level: each player decides whether their characters are linked outside the guild.**
  That is a switch on /me, off by default, and never an officer's or a guild's choice for them.
  An ally sees a main/alt link only for characters whose owner turned it on.

**Done now (bot 3.1.153):** the Discord `/who`, `/whois` and `/whoall` lookups, their autocomplete
and the Show Family button answer members only (`isGuildMember()` in `utils/roles.js`). Anyone
else gets one line saying the lookup is for members.
`test/who-commands-members-only.test.js`: four deliberate breaks, all caught. The first
autocomplete test passed with its gate removed, because the test roster was empty; it now fails if
the command reads anything before refusing.

**Build order, the rest waiting on the guild lead:**
1. **The member gate on the /who page, its database tables and the Mimic /who lookup**, so every
   /who surface checks membership at the moment of use, not just at sign-in. This is part of the
   membership fix already planned (private briefing), and waits on the guild lead's fix order.
2. **The ally tier:** the alliance grant, the guild-level submit switch, and the per-person link
   switch on /me.

Private specifics (how each surface was reachable) are in the private briefing, not here.

## 49. EQLogParser-style timer bars, and the trigger bugs a guild leader hit (2026-09-26, agent 3.7.24 beta)

**Who and why.** The guild's other leader, a bard, is trying Mimic in place of EQLogParser. The guild lead: *"this is a huge deal for me..this is one of the two guild leaders
buying into the platform"*. Their asks, from #bards:
- *"the only thing i need to get is the recharm tick count down timer … and i could get rid of
  eqlogparser i think"*, with screenshots of EQLogParser's timer window: "Recharm Tick", "PACIFY",
  "CALM", "A Soriz Skeleton - Tashania" and a 60-minute "Ring 10";
- *"are guild triggers something that happen no matter what? i dont need to copy to personal?"*;
- *"i added 'rampage on you' to personal triggers, then deleted it … now i cant get it back"*;
- *"i didnt see it on the regular or mini"*, and *"the 'charm break' is a few seconds late?"*.

They run stable Mimic 2.7.1 / agent 3.7.16 (their last agent report says so), not beta, so none
of this reaches them until they switch to beta or a stable is cut.

**What shipped (agent 3.7.24, beta `7b6a0cc9`):**
- **Timer bars.** A new "Timer bars" group in the dashboard's Suggested triggers, with three
  switches:
  - **Recharm tick:** a 6-second countdown to the charmed pet's next break check, counted from the
    charm landing, pinned at the bottom;
  - **Pacify / Calm / Harmony** on the mobs you lulled;
  - **every spell you land on a mob** lasting 30 seconds or more.

  Each row is built by the agent from what it already tracks, and only for your own casts. The
  trigger overlay draws them as full-height filled bars, like EQLogParser's; trigger countdowns
  keep the thin strip. They show in the trigger window, the "TTS box". That window has no mini
  mode, so there is nothing to miss there.
- **"Your charm broke"**, a Suggested alert on the log line "Your charm spell has worn off." Bards
  get that line too. It speaks at once. The Charm overlay's own call waits out a 6-second grace on
  the Zeal pet slot (so a recast does not false-alarm) plus a 1.5-second kill guard. That wait is
  the "few seconds late".

**Bugs found and fixed on the way:**
1. **"Rampage on you" could never fire.** It matched "rampages on you", which no log contains. The
   real line is "*<mob>* goes on a RAMPAGE against *<name>*!". A saved copy with the old text is
   rewritten on load; a pattern someone edited by hand is left alone.
2. **An unticked or "parked" personal trigger still fired.** Nothing on the fire path read
   `enabled`. Guild triggers were fine, because the bot sends only enabled ones.
3. **Personal triggers using `{c}` (your character) never fired after a restart.** They compiled
   before the agent knew your character names. EQLogParser imports use `{C}` a lot, so this would
   have hit the co-leader next.
4. **Every dashboard save stripped warning times, end text and bar colour from EQLogParser
   imports.** A save rebuilds the whole list from a fixed set of fields.
5. **The Charm overlay's "next mob tick" countdown never counted down.** The "pet still there"
   check overwrote the tick anchor on every poll. This is the likely "didn't see it on the regular
   or mini": the countdown was on the Charm overlay but stuck near 6 seconds.
6. **"Can't get it back"**: deleting the Suggested copy from the personal list left the Suggested
   panel showing it ON. Unticking it then looked like nothing happened. Both panels now redraw
   together.

**Answers for the co-leader.** Guild triggers fire on their own; there is no need to copy them to
personal. "Copy to personal" only makes an editable copy of your own. EQLogParser trigger packages
import directly (Triggers → Import). A 60-minute timer like "Ring 10" is a personal trigger with
a 3600-second timer.

**Not done, offered:**
- **All trigger countdowns as filled bars**, not just the timer-bar rows. It costs one CSS rule
  and nothing more to maintain. It would change every raider's overlay, so it is the guild lead's
  call.
- **A separate timers window.** That is Mimic 3.0's overlay-engine work (§36), not a new overlay
  now: a new window owes the whole overlay parity checklist.
- **Same-name mobs share one bar.** Landings are keyed by mob name, so two "a soriz skeleton" with
  Tash show one bar, the most recent.

## 50. Charm overlay: server tick + mob tick (2026-09-26, agent 3.7.25 beta)

**The guild lead:** *"charm overlay needs both server and mob tick on them (they're different, and
we can tell because of the interval the mob sees a DOT land it's non-initial damage typically. same
thing for when a charm breaks, that indicates the mob tick. the charm overlay is the priority"*.

**Shipped (beta `fff90e1e`):**
- The charm card shows two rows, **server** (blue, from Zeal's gauge 24, the HUD's source) and
  **mob** (purple). The mini keeps its voted two rows and carries both as "S 3.2 M 1.4".
- The mob tick is **learned**, per mob name:
  - **from DoT damage** ("*<mob>* has taken N damage from …"), counted only when the same source hit
    the same mob a whole number of ticks earlier — that interval is what rules out a cast-time hit;
  - **from a charm break read from the log**. A break noticed through the Zeal pet slot does not
    count: it is only seen after a 6-second grace.
- Each log line is stamped to the second, so an observation is a window from the second's start to
  when the agent read the line. Windows are intersected, and several ticks narrow the estimate
  below a second. One stray observation cannot replace a good estimate; two agreeing ones can.
- **Until a mob's tick is known, the overlay says "learning"** rather than guessing. The old
  "next mob tick" counted from the charm landing, which has no relation to the mob's tick.
- The Recharm tick timer bar (§49) now follows the learned tick, and appears once it is known.

**Limits:** keyed by name, like the other per-name trackers, so two live mobs with one name share a
tick; a death clears it, so the next spawn learns its own. Precision is capped by the second-stamped
log: at best a few hundred ms.

## 51. Feedback and suggestions take screenshots (2026-09-26, bot 3.1.154, web 1.8.20; Mimic next)

**The guild lead:** *"feedback and suggestion needs to be able to take screenshots..top priority"*.

**Where:** every feedback path writes the same `feedback` table, now with `screenshot_paths`
(migration `20260927003234`, applied), pointing into a **private** Storage bucket,
`feedback-screenshots`, which has no policies (service role only).
- **Web `/feedback` and the roadmap's "submit here"** get 📷 and paste (Ctrl+V), up to three images,
  shrunk in the browser to ≤1600 px JPEGs. **Signed-in pack members only**: an anonymous form that
  stores images and reposts them into Discord is an open door. Anonymous text feedback is unchanged.
- **Discord `/feedback`** already took a screenshot but only linked Discord's signed CDN URL, which
  expires. The image is now copied into the post and into the bucket.
- **Mimic/Parser feedback card**: the bot route takes `screenshots` (body cap 1 MB → 16 MB). The 📸
  button that captures the screen is the Mimic half, next on beta.
- **Officers** see thumbnails in `/admin/feedback` through one-hour signed links; the bot re-posts
  every image into the feedback thread as a real attachment.

**Safety:** the bytes are sniffed, never the client's label. Only JPEG, PNG or WebP of at most 5 MB
is stored, three per report. Storage paths are month/source/random — no names.

**Fixed on the way:** feedback from Mimic was posted **twice** — plain text by the agent route, then
again a minute later as an embed by the web-feedback relay (it posts every row with no
`discord_msg_id`, and the agent route never set one). The agent route now stamps its post.

**Noticed, not changed:** `/feedback` says "(Officers only)" in its description but anyone can run
it.

**Mimic half shipped (agent 3.7.26, `v2.7.2-beta.15`):**
- The dashboard feedback card has 📸 "Screenshot my screen" (Mimic only): the dashboard hides for
  the shot, and every display is captured.
- With one monitor, the shot is attached for review. With several, nothing is attached until the
  reporter picks a screen.
- 📎 attach and Ctrl+V paste work in any browser, so Parser and the tray route get them too.

## 52. The co-leader's feedback batch, the /who window, Settings drafts (2026-09-26, agent 3.7.27 beta)

The guild's co-leader filed seven Mimic feedback reports in 25 minutes (00:22–00:47 UTC) and followed
up in Discord. They are on **stable 2.7.1**, so none of this reaches them until they switch to beta or a
stable is cut.

| Report | What was wrong | Shipped |
|---|---|---|
| "/who window … a certain modifiable size … scroll down it" | It sized itself to the zone | `v2.7.2-beta.16`: fixed height with a drag grip (double-click = fit), a scrolling list, CLASS/GUILD filter chips like the tracking window, sort (seen/name/class/level/guild) — the guild lead: *"treat it like the in game tracking with filters for guilds or classes"* |
| "Feedback should include a copy/paste for snips" | — | `beta.15`: Ctrl+V into the feedback card (§51) |
| "right clicking it [the tray] does nothing … no exit, no nothing" | The tray menu was rebuilt on every status push and every change of "active character". Active means whichever Zeal stream reported last, so it can change several times a second, and on Windows replacing the context menu closes the open one | `beta.17`: right-click builds the menu then pops it up, so nothing replaces it; a fallback menu with Quit if the build fails; **⏻ Quit on the dashboard** (tray ↔ dashboard parity) |
| "i closed mimic with task manager and it seems none of settings were saved" | `saveConfig` wrote in place and runs often (auto-sizing overlays persist bounds). A kill mid-write tore the file, and a torn file loaded as all defaults | `beta.17`: atomic write (.tmp → rename), a last-good `.bak`, and loading falls back to it |
| Charm break TTS "about a second off … ONe of the only reasons for me to continue using eqlogparser" | Log read every 500 ms, then a 700 ms overlay poll behind a 400 ms cache; the Charm window added a 1.5 s kill guard | `beta.17`: 150 ms reads while a log is active; a long-poll that speaks a trigger the moment it fires; kill guard 600 ms |
| "server tick … broken out … as a standalone timer" | Only on the HUD | `beta.17`: a Server tick timer bar (Suggested → Timer bars) |
| HUD builder: "mana or endurance … separated to be either or" | — | **not yet**, queued with the half-circle mini HUD |

**Settings drafts (the guild lead: *"saving potential settings changes as drafts as people start
making changes, and give them a reminder to save before exiting the page"*), `beta.17`:**
- Every edit that Save would send is kept as a local draft, never the token.
- The next open brings the draft back with Save / Discard.
- Closing with unsaved edits asks: Save and close / Close without saving / Keep editing.
- Quitting Mimic closes Settings without asking (Electron would otherwise cancel the quit); the
  draft is already on disk.

**Flagged, not changed:** the "active character" flip-flop itself. Besides the tray, it re-applies
per-character overlay layouts on every flip when that feature is on. The right fix is focus-based
(which game window is in front), not "last Zeal report". That touches core behaviour, so it is its own
piece of work.

## 53. ⤴ beta on the dashboard, next to Check for update (2026-09-27, agent 3.7.28, `v2.7.2-beta.18`)

**The call (the guild lead):** *"put the move to beta on the dashboard next to check for updates"*.

**Why:** the only way into the beta channel was the tray's "Receive beta updates". The co-leader is on
stable 2.7.1, and on that build the tray menu is the thing that would not open (§52). This is the tray ↔
dashboard parity rule (2026-08-19) applied to the one updater control that was tray-only.

**What shipped:**
- A small **⤴ beta** button right after "↻ Check for update", styled like the beta build's ↩ stable.
- It shows on **stable Mimic builds only**. Beta builds keep BETA + ↩ stable; the standalone parser
  gets neither.
- It stays hidden until the shell answers. An older Mimic without the bridge, or a dev build with no
  updater, never shows a button that does nothing.
- Click → Mimic's own confirm → join. The button then reads "✓ beta on next restart" and a second click
  offers to leave.
- The tray checkbox and the button call the same `setBetaChannel(on, source)` in `main.js`. The tray's
  old click body moved there unchanged, so the two cannot drift.

**⚠ It does not reach anyone already on stable 2.7.1.** The button lives in the build, and a stable
user gets the next build only when a stable is cut. So the co-leader still needs one of these:
- the `v2.7.2-beta.18` installer from the releases page (it installs over stable and keeps settings);
- the tray, if it opens for them once;
- or a stable cut.

After that, the button is always there.

**Where:**
- `apps/mimic/main.js`: `setBetaChannel`, plus the `get-beta-channel` / `set-beta-channel` IPC.
- `preload.js`: the bridge.
- `dashboard.html`: the header `{{WP:…}}` else-arm and the `wpJoinBeta` wiring.
- Tests: `test/dashboard-join-beta.test.js`, 14 tests; 8 of 8 mutants killed.

## 54. PvP assists: credit the guildmates our agents see, spells count, 4-minute window (2026-09-27, bot 3.1.155, agent 3.7.29 beta)

**The call (the guild lead):** *"credit assists to guildmates our agents see. we should also attribute
when a guild member has cast non-damage on those characters and expand the timeframe to 4 minutes..
make sure all of this can be parsed through vis opt-in-logs"*.

**Why:** two raiders had kills on the 2026-09-25 Vex Thal night but no assists. All 9 assists that night
went to the one character whose agent was running. An assist came only from the assister's OWN log (their
damage to the victim), so anyone not running Mimic could never get one, even when another raider's log
showed them on the victim.

**What counts now** (agent `EncounterBuilder`, identical in the live tail and the opt-in-log backfill):
- **Any player's hits on the victim** that the log shows. A pet's hit counts for its owner
  (`petLeaders`, the charm trackers, or a `<Owner>`s warder` name).
- **Debuffs that land on the victim**: the timed detrimental spells in the `parseDebuffLanding` index
  (slows, snares, roots, mez, Tash/Malo, DoTs). A landing never names its caster, so:
  - our own cast of that spell, begun up to 12 s before, is ours;
  - otherwise it goes to the player whose `<X> begins to cast a spell.` started closest to the spell's
    cast time before the landing. The slack is ±1.5 s, or ±35% for long casts (spell haste). Each start is
    used once, and if nobody's timing fits, nobody is credited.

  ⚠ This is a timing match, not a fact the log states. It also needs the cast-start line, which a raider
  sees only in range and with others' spell messages switched on.
- **The window is 4 minutes** (it was 2).
- **The killer never gets an assist** on their own kill. One death uses the evidence up.
- **Instant spells are not covered.** Stuns and dispels have no entry in that index, and bard songs print
  no cast-start line for anyone else.

**Guildmates only, decided by the bot.** It already drops any assister not on the `characters` roster, so
the agent reports everyone it saw and the roster decides. Alliance guilds' players are dropped there.

**One assist, many witnesses (bot 3.1.155).** Every raider running Mimic now reports the same guildmate's
assist, each stamped off their own clock a second or two apart. `dedup_key` is per second, and the /pvp
leaderboard counts rows. So the bot:
- drops a report when the same assister on the same victim is already stored within ±30 s;
- reads those neighbours one fight at a time, in clusters of up to 10 minutes;
- takes one upload at a time, so two witnesses posting together cannot both miss each other.

A failed read stores everything, and the per-second key still holds.

**Opt-in logs:** the catch-up path runs the same hook before `shouldKeep`, which would otherwise drop the
landing lines. It also uploads assists 200 per request, because one replayed log can now hold thousands and
the bot refuses a body over 256 KB.

**Re-run** on a log in the Opt-in Logs tab replays it from the start. That credits every past PvP night it
covers, including the one that started this.

**Where:**
- Agent: `PVP_ASSIST_WINDOW_MS`, `_checkPvpAssists`, `_pvpStamp`, `_pvpAssistLine`, `_pvpCasterFor`, the
  damage branch of `add()`, both line loops, and `uploadPvpAssists`.
- Bot: `_pvpUnseen`, `_pvpNeighbours` (named `_pvpAssist…` until §55 put kills through them too), and
  `_handleAgentPvpAssists`.
- Tests:
  - `test/pvp-guildmate-assists.test.js`: 18 tests, 17 of 17 mutants killed.
  - `test/pvp-assist-witness-dedupe.test.js`: 7 tests, 7 of 7 mutants killed.

## 55. An opt-in log parse posts ONE PvP note, never one per old event (2026-09-27, bot 3.1.156, agent 3.7.30 beta)

**The call (the guild lead):** *"when parsing through old logs make sure we're not posting in the channels
for it each time. we can put in a note in pvp that the @user's opt-in log parse found N new pvp kills and
assists and total them out per guildie"*.

**Audit: what a replayed log could post.** Every upload the opt-in backfill makes was checked against
what the bot sends to Discord.
- **Already silent:**
  - PvP kills: the relay post and the boss auto-timer both skip `backfill`.
  - Fight cards, session damage and boss timers: `isBackfill`.
  - Deathrolls: rolls are captured live only, and the bot never announces a game older than 10 minutes.
  - Fun events, faction, PoP flags, buff/debuff sightings and chat: none of their handlers post.
- **One was not:** the assist handler posted a "🪶 Assist on <victim>" note for every assist group,
  replayed or not — its header said it didn't. With §54 (guildmates count, Re-run replays a whole log),
  one Re-run would have posted every PvP assist in the log. It now posts only rows stored just now that
  came from live play. The post dedupe is "same victim ±30 s" (it was the exact second), so several
  witnesses of one live kill make one note.

**The note:**
- When a run ends, meaning every file finished or paused, the agent flushes its buffered assists.
- It then queues `POST /api/agent/optin_summary { started_at }` as backfill, so it drains behind the
  run's own uploads.
- 90 s later the bot counts what that uploader's replay inserted since the run began:
  - `pvp_kills` with source `log_backfill` and a Wolf Pack killer;
  - `pvp_assists` with source `log_backfill`.
- It posts once to `PVP_THREAD_ID`/`PVP_CHANNEL_ID`: "📜 @you's opt-in log parse found **N new PvP
  kills** and **M new assists** (first – last date)", then one line per guildmate, busiest first, capped
  at 30 lines.
- The mention reaches only the uploader.
- Nothing new means no note, and a failed read also means no note (never a wrong count).
- A /who-only rescan and a dry run send nothing.

**Replayed kills no longer double.** Measured the same night: **23 duplicate pairs in 611 `pvp_kills`
rows, every one from a log catch-up**. Each is 1–4 s off a row another raider's Mimic had stored,
because `dedup_key` is per second on each machine's own clock. Replayed kills now go through the same
±30 s check as assists (§54).
- The helpers were renamed `_pvpUnseen` / `_pvpNeighbours` and take the name column.
- Live kills are unchanged: `_isPvpDupe` already covers them.

The 23 existing pairs are left in place. Deleting them is the guild lead's call.

**Caught before shipping:** the kill check referenced `guildId`, which in the relay handler lives inside
the per-broadcast loop.
- At runtime that would have thrown inside the persist `try`, and every PvP kill would have silently
  failed to store.
- Lint (`no-undef`) caught it.
- A test now runs the real persist block against a stub database, and fails with the fix removed.

**Where:**
- Bot: `_handleAgentOptinSummary`, `_postOptinPvpSummary`, `_optinPvpSummaryText`, the assist post
  filter, `_recentPvpAssistPost`, and the pvp_kills persist block.
- Agent: `runOptinBackfill` (`runJobs`, `runStartedAt`) and the `optin_summary` upload route.
- Tests:
  - `test/optin-pvp-summary.test.js`: 11 tests.
  - `test/pvp-assist-witness-dedupe.test.js`: 12 tests.
  - `test/optin-run-summary.test.js`: 5 tests.
  - 21 of 21 mutants killed, plus the scope bug itself.

## 56. The duplicate kills deleted; the Zeal health overlay becomes the Tick overlay (2026-09-27, agent 3.7.31 beta)

**Duplicate kills — the call (the guild lead):** *"yes delete the 23 duplicate kills"* (§55).
- Checked first: each kill was stored exactly twice, and no `pvp_assists` row pointed at either copy.
  (The FK is `ON DELETE SET NULL`, so a pointing assist would otherwise have lost its link.)
- Kept: the row written when the kill happened, either the live `pvp_channel` row or the first
  catch-up.
- Deleted: the later catch-up copy.
  - The DELETE also required `source = 'log_backfill'`, so a live row could not be removed by mistake.
  - Ids: 393, 394, 402, 404, 405, 406, 414, 417, 419, 426, 436, 461, 462, 482, 483, 517, 518, 519,
    535, 547, 606, 612, 619.
- After: 0 duplicate pairs, 589 rows. §55's check stops new ones.

**Tick overlay — the call (the guild lead):** *"let's change the zeal health overlay into the tick
overlay request that [the co-leader] asked about. the zeal health info could still be accessible there.
could also display clock skew offset"*.

The co-leader's request, feedback 2026-09-27 00:32 UTC: *"The server tick function within the HUD thing
is awesome, but would be even better if it could be broken out or customized to put somewhere else, as a
standalone timer"*.

**What shipped:**
- `apps/mimic/zealhealth.html` is now the **Tick** overlay.
  - Key `zeal`, flag `showZeal`, the file name and the saved bounds are unchanged, so anyone who had
    Zeal health on finds Tick in the same spot.
  - The labels were renamed: tray "Tick timer (server + charm ticks, Zeal health)", overlay list,
    hotkey names, window title, dashboard Overlays row, and the no-Zeal notification.
- **One server-tick row per character streaming Zeal**, from the new `/api/state.serverTicks`
  (`_serverTicksNow`: gauge 24 via `_meTick`, sorted by name).
  - Per character rather than "the active one", because that flips with whichever Zeal stream
    reported last (the flip-flop flagged in §52). The countdown never jumps.
- **A charmed mob's own tick** while a charm is active, from `charmPets.mob_tick_at`. It shows "?"
  plus "learning" until a DoT tick or a break reveals it.
- It counts down locally ten times a second from absolute tick times.
- **Two layouts on beta** (the UI-options rule), switched with ◯/▭:
  - **Bars:** one shared grid, a number plus a draining bar. Server is blue, the mob is purple.
  - **Dials:** a ring per tick with whole seconds inside.

**Status line:** "📡 Zeal ok · ⏱ clock 2.4s slow". The clock is green under 1 s, orange under 5 s, red
past that; 5 s is also where the agent warns. Clicking it opens:
- the old Zeal type table, pid line and admin-mismatch hint, unchanged;
- the clock in words, against the Wolf Pack server (`clockOffsetMs`) and against internet time
  (`ntpOffsetMs`), with the `w32tm /resync` fix.

**The cost of the two layouts:**
- Bars are CSS widths (cheapest to change).
- Dials are one SVG `stroke-dashoffset` per tick (cheap too, but geometry to touch when resizing).
- Both are rebuilt only when which rows exist changes.

**Left for the pick:** whichever layout loses goes when a stable is cut.

**Where:**
- Agent: `_serverTicksNow` and the `serverTicks` field in `_serializeForDashboard`.
- Mimic: `zealhealth.html`, plus the `main.js` labels.
- The dashboard `WP_OVERLAY_ROWS` row.
- Tests:
  - `test/tick-overlay.test.js`: 10 tests, 11 of 11 mutants killed.
  - `test/tray-overlay-order.test.js` follows the label.
- Both layouts were rendered in Chromium with sample data. That caught the bar rows not lining up.

## 57. Stable 2.7.2; the #pvp note; a Day window; fight sizes; who follows Discord; buffs on the entity's tick; the overlay catalog and the 3.0 plan (2026-09-27)

**The calls (the guild lead, one message):** *"do those and move us up to a new patch release. make a
note in the PVP channel for people to run their opt in logs to get historical credit on pvp kills
and assists. also add in a 24hr filter for pvp, and try to figure out fight sizes for opponents vs
allies when a fight happens in pvp. start looking for the messages when people #togglepvp in game
and follow the way of discord vs order. don't forget about server ticks. debuffs and buffs wear off
on entity's ticks, which do not correspond with the server ticks..rather with when an entity
spawned. every component of the overlays … need to be cataloged in a master overlay design doc and
then prepared for an open overlay builder system that I want to develop for a 3.0 release for
mimic … start a full life cycle research and planning cycle … ideal to complete before October 1st."*
And the follow-up: *"this can be an extension of the UI builder, but it needs to be a lot smarter …
elements should have displayed sample data … build out overlays on the fly … snap to other windows
inside the EQ client from native or zeal … adaptivity to a specific character's abilities, clickies,
levels."*

### Stable Mimic 2.7.2 (agent 3.7.31) — `7f82926d`, the tip of its own push
- File-level promotion from beta `07a4765c`: `apps/mimic/`, `packages/wolfpack-logsync/` and their
  tests. Beta.15–.21 all ship: guildmate PvP assists + the one-note parse, the Tick overlay, timer
  bars, the /who window, feedback screenshots, the DIRGE board, HUD tracking arrows, the corpse DM,
  Settings drafts, the ⤴ beta and ⏻ Quit buttons, the tray and config fixes.
- **Four beta-only web tests were left behind** (`about-figures`, `pvp-fights-page`, `tradeskills`,
  `zeal-icons-page`): they test web variants that exist only on beta. The first promotion attempt
  pulled them in and went red; the rule for next time is `--diff-filter=AM` on the test list and
  then drop any test whose subject is a beta-only web file.
- Beta re-parked at **2.7.3** (agent 3.7.32, then 3.7.33 — see the slip below).

### The #pvp note (bot 3.1.157)
`_announceOptinPvpOnce`: the 2.7.1 raid-chat card's shape — bot_kv latch (fail-closed), a wait for
the **stable v2.7.2 release to carry its .exe**, one embed to the PvP thread/channel, pinging nobody.
It waits for 2.7.2 because guildmate assists and the one-note parse reach stable users only in that
build; a note before it would send people to a catch-up that still floods or credits only themselves.

### A Day window on /pvp (web 1.8.26)
The picker already knew `1d`; /pvp now offers it.

### Fight sizes (migration `20260927040000`, applied)
- `pvp_fights` returns `zek_players`, `ally_players`, `players_by_guild`.
- "On the field" = everyone a Wolf Pack log saw: the dead and their killers (`pvp_deaths`), the
  assisters (`pvp_assists`, ±3 min round the fight), everyone `/who` listed in the zone from 4 min
  before the first death to 1 min after the last. One row per name, best guild any source gave.
- Sides: Zek and Rise of Zek are the opponents (the death split's rule); any other guild is an ally;
  no guild or /anon is listed by guild but on neither side.
- **It is a floor.** A /who nobody typed, an anon player, a raider whose log never uploaded — all
  missing. /who's short zone names ("vexthal") don't match the broadcast's long name and are left
  out. The cards and table say "at least".
- Drawn on the beta fight cards ("On the field: Zek 14 v 21 allies (Wolf Pack 9 · …) · at least")
  and the table's Sides column. The default page is unchanged until the layout pick (§46).

### Who follows Discord (migration `20260927040100`, applied)
- **The toggle lines were already parsed** — since 2025-02, `parsePvpFlag`: *"You are now player
  kill and follow the ways of Discord."* → `pvp_flag_on`; *"You now follow the ways of Order."* →
  `pvp_flag_off`. So "Discord" is the PvP-enabled alignment and "Order" the peaceful one, and the
  data was 1,498 toggles across 115 characters waiting to be read.
- `pvp_flag_state` (a `security_invoker` view) is the latest line per character. `/pvp` lists
  "Following Discord now" with how long ago, only when someone is. Measured tonight: 22 characters
  following Discord, 5 of them toggled in the last week.
- ⚠ Self-only lines, so only characters running Mimic have a state. A guildmate without Mimic is
  invisible here; their flag shows only when a fight names them.

### Buffs and debuffs fade on the entity's own tick (agent 3.7.32/3.7.33 beta)
- The rule, in the guild lead's words: *"debuffs and buffs wear off on entity's ticks, which do not
  correspond with the server ticks..rather with when an entity spawned."* The server counts a buff's
  ticks down once per beat of the mob's own 6 s timer, started at spawn; the "server tick" Zeal
  shows (gauge 24) is the *player's* own beat, not the mob's.
- `_entityTickFadeAt(landedMs, durTicks, tick)`: an N-tick buff fades on the Nth of the mob's beats
  after it landed — the first beat strictly after landing, then N−1 more. That is up to 6 s earlier
  than the naive landed + N × 6 s. With no learned tick the naive estimate stands and `snapped` is
  false.
- Used by the trigger window's spell timer bars (a ⏱ after the effect when snapped) and Target
  Info's buff/debuff rows (`tick_snapped`). The mob-tick learner (§50) feeds it: a DoT ticking on
  the mob, or a charm break.
- **Not yet:** six more expiry sites still use landed + N × 6 s (pet buffs, the slow tracker, the
  buff timeline, the target-buff relay rows), and **other raiders' buffs** — each player's own beat
  is their gauge 24, which their agent has and could relay in the live-state upload so the buff
  queue and Extended Target snap too. Both are queued in STATUS.
- "Don't forget about server ticks" is read two ways and both are done: the Tick overlay is in the
  stable, and the entity-tick rule now governs mob timers.

### The slip: 3.7.32 went out red
`npm test | grep …` reports grep's exit status, not the suite's, so the beta push chain did not stop
on six failing tests (`pacify-tracking`, which slices `targetBuffsFor` alone and met the new helper
calls as a ReferenceError). Fixed in 3.7.33 minutes later with the repo's `typeof` guard; behaviour
in the running agent never changed. **Rule:** `set -o pipefail` (or test the suite's own exit code)
in every push chain. Recorded because the fleet hot-swaps the agent from the beta ref.

### The catalog and the 3.0 plan
- `docs/DESIGN-overlay-catalog.md` — every overlay's identity, data sources down to the Zeal pipe
  type, outputs, surfaces, dependencies, raid impact, persisted state and caveats; the shared
  machinery; **twelve findings** the sweep turned up (the two that matter: the DPS HUD and Threat
  meter never know who "you" are, and the active-character flip-flop); and the data contract a
  builder needs.
- `docs/DESIGN-mimic-3.0-overlay-builder.md` — requirements R1–R10 from the ask; what exists to
  build on (UI Studio, the HUD's parts builder, panel overlays, the dock, auto-arrange, the ini
  reader, the character knowledge already on the platform); **the access question** with four
  options costed the guild lead's way (ini files now; a Win32 window-geometry helper next; a Zeal
  "ui windows" pipe message as the standing upstream ask; screen capture only as a one-shot
  self-check, never for layout); the spec → signal → part architecture with sample data per
  signal; six phases sized at **21–34 sessions**; risks; and seven questions for the guild lead.
- **October 1:** the full 3.0 is not achievable in four days, one of them a raid night. What is:
  **3.0-alpha.1** — the alpha channel, the signal registry with sample data, the two identity fixes,
  and the first builder canvas (EQ's windows and Mimic's overlays together, snapping, per-resolution
  save, fake numbers while arranging). The plan says so plainly rather than promising the rest.

### Where
- Stable: `7f82926d` on main; beta re-park `d48a258e`, fix `3.7.33`.
- Bot: `_announceOptinPvpOnce`; web: `loadFlagged`, the Day window; agent: `_entityTickFadeAt`,
  `_serverTicksNow`; migrations `20260927040000`, `20260927040100`.
- Tests: `announce-optin-pvp` (4), `pvp-flag-state` (4), `entity-tick-fade` (8, 6 of 6 mutants
  killed), `pvp-fight-sizes` (5, 2 of 2 mutants killed).

## 58. A one-time celebration for every Mimic user on the Aten Ha Ra kill (2026-09-27, bot 3.1.158, web 1.8.28)

**The ask (the guild lead):** *"how can I create a one time celebration for all miMIC users after
tomorrow's defeat of Aten Ha Ra in our last scheduled Vex Thal raid. I have some ideas about an
animated anime style video of our raiders all attacking her, with crash cuts on each player and
their name tag and the things they typically do during a fight against her."*

### The call: no build, three existing channels
Sunday's raid is 20 hours away and every Mimic on the fleet already polls three things that can
carry a one-off. Nothing new ships to Mimic; the celebration is DATA on surfaces that exist.

| Moment | Channel | What happens | Where it is set |
|---|---|---|---|
| The kill line | **guild trigger** `fdf89cd5-dae7-4cb6-971e-275efe35c202` (`Vex Thal cleared — Aten Ha Ra`) | every Mimic in the zone: a 12 s flash *"🐺 ATEN HA RA IS DOWN — VEX THAL CLEARED"*, the spoken line *"Aten Ha Ra is dead. Vex Thal is cleared. Wolf Pack."*, and a 3.4 s brass fanfare | inserted directly in `guild_triggers` (served live by `_guildTriggersFor`; reaches every agent within the 2-min poll). Pattern `^\[.+?\]\s+Aten Ha Ra has been slain by`, cooldown 3600 s |
| The relay of that kill | **bot one-shot** `_announceVexThalClearedOnce` on `/api/agent/bosskill` | one embed in #raid-chat: who landed it, *"Wolf Pack's Aten Ha Ra kill number N since the first, on February 27"* (N from `encounters`, npc 158436, confirmed kills > 2 min that started more than two hours ago — so tonight's own parse is not counted twice), the film link if set, else *"the film is in the works"* | `bot_kv` latch `announce_vex_thal_cleared`, fail-closed like the other announcers; only for `boss = Aten Ha Ra` (the Kaas Thox pair share the name and are excluded) and `guild = Wolf Pack`; pings nobody |
| The film, whenever it is cut | **tuning key** `celebration_video_url` + **Mimic Mail** | the embed prints the link only if it is `https://…`; a Mimic Mail from /admin/notices puts the ✉ dot on every Mimic ≥1.6 | `/admin/overlays` tuning editor; `/admin/notices` |

The sound is `web/public/sounds/vex-thal-cleared.wav` — synthesized (a C-major brass arpeggio into
a held chord; no licensing question), 300 KB, served from `wolfpack.quest`. Guild triggers already
carry a `sound` URL and Mimic plays it with `new Audio(url)`, so this is the first guild-wide use of
a feature that has been there since triggers v2. The TTS passes the #136 allow-list because
"dead" matches its death category — checked, not assumed.

**Why the trigger fires only in the zone:** guild triggers match the local log, and the kill line
is zone-wide. Raiders not in Vex Thal get the Discord embed, not the flash — which is right.

**Deliberately not done:** no Mimic release (nothing would reach the fleet in time, and the
stable just cut is what everyone is on); no confetti/animation in an overlay (a one-night effect
is not worth a permanent code path in the trigger window); no name on the roadmap entry before
the kill (a teaser line only — *"You will know it when it happens"*).

### The film — services, not a prompt
The shot list (style bible, per-raider shot cards with class, race and what each one is seen
doing in the Aten Ha Ra parses, prompt lines) is **private** — it names members — and went to
the guild lead as a file, not into the repo. The service answer, in short: Gemini/Veo for the
handful of hero shots (its 3/day cap fits four establishing beats); a credit-pack service
(Kling, Runway, Hailuo) for crash-cut volume via image-to-video from consistent stills; stills
from one image model with a locked style prefix; **name tags and cuts in an editor (CapCut /
DaVinci), never generated** — text in generated video is the one thing none of them do
reliably. Host unlisted on YouTube; the link goes in the two places above.

### After the raid
1. **Disable trigger `fdf89cd5…`** on /admin/triggers (the 1-hour cooldown stops a double fire on
   the night; the disable stops a fire on a later Vex Thal kill).
2. Paste the film link into `celebration_video_url`; send the Mimic Mail; add the real roadmap line.
3. The bot one-shot stays latched forever in `bot_kv`; the code can be removed in a later tidy.

### Where
- Bot: `_announceVexThalClearedOnce` + the hook after the next-spawn line in `_handleAgentBossKill`.
- Test: `test/announce-vex-thal-cleared.test.js` (5, running the real function against fakes).
- Sound: `web/public/sounds/vex-thal-cleared.wav`; generator kept out of the repo (scratchpad).

### 58a. Reworded the same night, and the film posts itself (bot 3.1.159)
**The guild lead:** *"perhaps it's best to flash 'congrats Wolf Pack on the last Aten Ha Ra of
Luclin!' 'The guild has done approximately N damage to Aten Ha Ra since <First kill>' and post the
video into discord."*

- **The flash is two chips** (two `text_overlay` actions on the same trigger — the agent renders
  every action, so both show at once, both spoken in turn): the congratulations, then *"The guild
  has done approximately 22.6 million damage to Aten Ha Ra since February 26."* The number is
  baked into the trigger text because a trigger cannot compute; it is the parsed total of her
  19 confirmed kills (`encounters.total_damage`, cross-checked against `encounter_players` to
  within 50 points), and "approximately" is the honest word — partial parses make it a floor. The
  first kill was 2026-02-27 02:41 UTC, which is **February 26 in Eastern time**, so the text says
  the 26th; §58's "February 27" above was the UTC date.
- **The embed computes the same two lines live** (`_vtBigNumber`, `_vtKillDate` in New York time)
  from the confirmed kills that started more than two hours ago, and adds the kill number.
- **"Post the video into discord" is automatic.** The link lives in `celebration_video_url`
  (/admin/overlays). If it is set when she dies, the kill embed carries it as message CONTENT so
  Discord unfurls the player (a link inside an embed's text does not unfurl). If it arrives
  later, `_announceVexThalFilmOnce` polls the tuning map once a minute and posts the video once,
  after the kill embed exists (never before — the film is a follow-up, not a spoiler), latched in
  `bot_kv` `announce_vex_thal_film`; the interval clears itself once posted. Fail-closed on an
  unreadable latch, like every announcer.
- **The film brief was rewritten** as an anime opening built class by class, mains only (alts
  collapsed onto their mains from `characters.main_name`; names not in the character table dropped),
  with the two character sheets the guild lead gave. Private file, sent again; not in the repo.
- Test file grown to 10 (the poller's states, the content-vs-embed rule, the rounding, an empty
  history reading as kill number 1 while an unreadable one prints no number).

## 59. A member's Sunday-morning batch: feedback acks, the charm break, targeting the pet, timer order (2026-09-27)

Relayed by the guild lead from the feedback thread and a DM with a member (an enchanter on
Mimic 2.7.3-beta.2):

- *"these feedback have no acknowledgement in discord"*
- *"The 'charm break' TTS still feels slightly behind. like 1 or 2 seconds maybe ... not perfect
  like eqlogparser, clock seems fine"* — and the guild lead: *"charm break needs to be as close to
  instant as possible, like EQLogParser"*
- *"It would be awesome if you could click target the pet from the charm tracker window"* — the
  guild lead: *"I don't know if we can inject a target back into EQ, it would be neat if we could."*
- *"he wants an option for reverse ordering on the timers"* (the timer bars grow upward from the
  bottom; he wants the list to read top-down).

### 59a. Feedback acknowledgement — built (bot 3.1.160, main)
**Cause:** the Mimic route (`_handleAgentFeedback`) posted a plain message with no components. Only
`/feedback` and web reports carried 📬 Acknowledge / ❌ Not Implementing, and their handlers read the
submitter from an embed footer, so a plain post could not be acknowledged even with buttons.
**Fix:** the Mimic post carries the same pair (`_feedbackRecvRow`); `handleFeedbackRecv` /
`handleFeedbackClose` handle a plain post by looking the row up by its `discord_msg_id`, DM the
reporter on ack, and write the status onto the post's FIRST line (everything after it is a `>>>`
quote, so a trailing line would read as part of the report). Every button now also moves the row
(`acked` + `acked_by/at`, or `addressed` + `addressed_by/at`) so `/admin/feedback` agrees with the
thread — the embed path did not do this before either. The 11 Mimic reports still open got the
buttons once at boot (`_backfillMimicFeedbackButtonsOnce`, bot_kv `feedback_mimic_buttons_backfill`,
fail-closed, skips any post that already has buttons). Test `feedback-ack` (7, real functions,
3 of 3 mutants caught).

### 59b. The timers report posted twice — the web relay raced the Mimic route (bot 3.1.161, main)
The guild lead: *"double posted in the feedback channel"* (the timers report, row `7ed3116b`,
12:40 UTC). **Cause:** the Mimic route inserts the row, uploads to Discord, and only THEN stamps
`discord_msg_id`. `relayWebFeedback` runs every 60 s and posts any row with `discord_msg_id IS
NULL`, so a report that landed just before a relay tick was posted by both. The relay's stamp won,
so the row points at the "via web" embed and the Mimic post is the orphan: acking the Mimic post
marks it but finds no row, so no DM. (§51's "Mimic feedback posted twice" was a different cause —
a retried upload.) **Fix:** the relay posts web rows (`client IS NULL`) at once, and a client row
only once it has sat unstamped for 5 minutes — which still rescues a Mimic report whose own post
failed. Test `feedback-ack` +1 (the query at a frozen clock; reverting the filter fails it).
**The one duplicate:** acknowledge the "via web" embed (it is the one the row points to — DM +
row write), then delete the plain Mimic post.

### 59c. The charm break is called the moment the line is read (agent 3.7.34, beta)
**Cause of the lag:** the Charm overlay's own call (`charm.html`) saw the break only on its 500 ms
`/api/state` poll, behind the agent's 400 ms state cache, and then held a 600 ms guard to tell an
intentional kill from a break. Worst case ~1.5 s after the line, which matches the member's "1 or 2
seconds". EQLogParser speaks straight off the log line.
**Fix:** the agent's `charm_break` handler calls `_pushCharmBreakInstant` for the player's OWN charm
(a `__self__` line, or the owner is this character), only for a live line (within 15 s of now, so a
backfill never speaks) and once per pet per 4 s (the self line and a bystander line both arrive). It
pushes a `charm` fire down the existing `/api/fires/wait` long-poll — the same path the trigger
overlay already uses, so no new route. The Charm overlay long-polls it and speaks; the trigger
overlay's `fire()` skips `charm` fires so it is never said twice; the deferred call stays as the
fallback for a break with no log line and is skipped when the instant one came (8 s). If the "Your
charm broke" suggested trigger is on with speech, the fire carries `charm_spoken` and the Charm
overlay stays quiet. **A trap it hit:** the overlay's long-poll had no floor between requests, so a
stub `fetch` that answered at once spun a test worker at 100% CPU forever
(`test/mini-popraid-charm`). It now waits 250 ms after a fast answer with nothing new. The trigger
overlay's older `waitFires` loop has the same shape and no floor; the agent holds the request 20 s,
so it is safe in practice, and it was left alone (minimal diff). Test `charm-break-instant`.

### 59d. Trigger timers can start at the top (agent 3.7.34, beta)
The member's own words, relayed by the guild lead: *"It would be nice if the trigger timer had an
option to start the timers at the top, and go down with successive triggers to track, instead of
always starting at the bottom of window and growing up."* Right-click the trigger overlay →
**⇅ Timers start at: TOP**. On: `#timers` hangs off the top edge below the ✥/🗑/✕ gutter (34 px, 58 px
in setup) and reads down, the centred callout column is pushed DOWN off the stack instead of up, and
the window's ⬆ grow-upward is switched OFF for this overlay — without that, auto-height keeps the
bottom edge fixed and walks the first timer up the screen as rows arrive. Off restores both (the
grow entry is deleted so the default returns). The bottom-anchored default stays the default: it is
the guild lead's 2026-08-10 call that the screen centre is reserved (v2 §3). One option, not
variants: it is a small change inside an established overlay, and the member described exactly
what they want. `cfg.triggerTimersTopDown`; test `charm-break-instant`.

### 59e. Targeting the pet from the Charm window — not buildable from Mimic alone; a Zeal change
*"It would be awesome if you could click target the pet from the charm tracker window"* / the guild
lead: *"I don't know if we can inject a target back into EQ."*
**What is true today** (read from the Zeal source, 2026-09-27):
- **The pipe only goes one way.** `named_pipe.cpp` creates it `PIPE_ACCESS_OUTBOUND`: Zeal writes,
  Mimic reads. There is no channel for Mimic to ask the client for anything.
- **Zeal already has everything on the client side.** `Zeal::Game::get_pet()` returns the player's
  pet entity (off `PetID`), and `Zeal::Game::set_target(Entity*)` targets an entity without the
  `/target` range rules. A `/targetpet` command is a few lines in the commands registry.
**Options, cheapest first:**
1. **A `/targetpet` slash command in Zeal (fork).** No Mimic change; the member binds it to a social
   hotkey. Build: an hour. Maintenance: none. Runtime: none. Change: easy. It does not give a click
   in the Charm window, which is what was asked.
2. **An inbound command channel in Zeal, one verb only** — a second pipe Zeal opens
   `PIPE_ACCESS_INBOUND`, accepting exactly `target_pet` (and nothing that casts, moves or sends
   text), which Mimic writes when the pet row is clicked. Build: a day (C++ + the Mimic bridge + the
   click handshake). Maintenance: low, but it is our fork only — members on upstream Zeal do not get
   it. Runtime: none. Change: every new verb is a new decision. **Its risk is policy, not code:**
   anything outside the game driving the client is the category server rules are written about, so
   it needs the guild lead's call and ideally a word with the server staff before it ships.
3. **Keystroke injection** (Mimic sends a keypress into the EQ window). **Not recommended:** it
   steals focus mid-fight, breaks under a remapped key, and is squarely automation.
**Recommendation:** 1 now (it answers the need with no policy question), 2 only if the guild lead
wants the click and is comfortable with the server question. Nothing built.

### 59f. The same member's other reports that day, investigated, none built yet (2026-09-27)
The guild lead asked for every remaining item from that member's Sunday feedback to be looked into.
Five read-only investigations ran against beta at `f24af63f`, and the load-bearing lines were
re-checked by hand. **Nothing here is built.** Each fix is the smallest change that answers the
report, and all of them fit inside one agent + Mimic beta round.
| # | Report | Root cause | Smallest fix | Size |
|---|---|---|---|---|
| 1 | Two charm-break rows that switch on together; "charm break" spoken twice, even with its speech box unticked | **One** suggested trigger (`self_charm_broke`). Its personal-trigger copy is listed again under Personal triggers, on the same object, which is why ticking either box moves both. It is spoken twice because the same log line reaches the overlay twice: once as 3.7.34's instant break (§59c) and once as the trigger fire. `_pushCharmBreakInstant` marks the instant fire as already spoken only when the trigger's speech box is ON. `triggers.html` `fire()` speaks any fire with text whether or not that box is ticked, so unticking the box turns one call into two | `charm_spoken` on `sug.enabled` alone (index.js ~36087) + update `test/charm-break-instant.test.js`; label `suggested:` rows in the Personal list as the Suggested panel's copy | S |
| 2 | An imported bard charm trigger fires on Test, never live | An import whose pattern will not compile is stored **disabled** with `import_error` (index.js ~28641). The live matcher skips it (`enabled === false`, `!_regex`), but `_rehearseTrigger` checks neither and fires the actions anyway, so Test succeeds on a trigger that can never fire live | `_rehearseTrigger` refuses a disabled or uncompiled row, and the Test note names the import error | S |
| 3 | Bard charm-break speech lags a few seconds; the Recharm tick bar never appears on the bard | The log-line break path (instant speech + `_noteMobTick`) needs the charm to be known as ours. `_gaugeOwnerIsBard` reads the class only from /who or the raid roster. Unlike every other class lookup in the agent, it never reads Zeal's own class label (`_meLabel(zst, 3)`). So a solo bard who has not /who'd themselves can go untracked. The break then comes only from the gauge reconciler, after a **6 s** grace, and that path calls neither the instant speech nor `_noteMobTick`. The Recharm bar waits for a known mob tick, so it never shows | `_gaugeOwnerIsBard` reads `_meLabel` first; the gauge break branch also calls `_noteMobTick` | S–M, medium confidence (no live capture) |
| 4 | Separate my triggers from the pop-up that shows Tash | The Tash callout is a **guild** trigger. Every fire goes through one `fire()`, which shows the Earlier / Good / Too early vote strip for all of them (`triggers.html:696`). The fire already carries `scope`, but nothing uses it here | Show the vote strip on personal fires only, or add a per-trigger "no feedback" flag. **The member's intent needs confirming first** | S |
| 5 | Clicking a trigger in the manager does not show or edit it | Personal rows have no Edit and no click handler; `onAdd()` only appends. `prefill()` already fills every field, but only "Copy to personal" calls it | An Edit button calls `prefill(t)` and saves in place over the same id. Guild and suggested rows get a read-only detail view | S (personal) / M (with detail) |
| 6 | Does Mimic have EQLP's "Warn with time remaining"? | **Yes, except in the hand-made trigger form.** The warning columns exist, the EQLP import maps `WarningSeconds`/`WarningTextToSpeak`, and the overlay speaks the warning (`triggers.html` `paintTimers`). The dashboard's Add-personal-trigger form has no fields for it | Two inputs in `buildEditorHtml` + two lines in `onAdd()` | S |
| 7 | DPS copy leaves out the charmed pet; History copy shows the pet's damage but not whose pet it is | The on-screen meter folds pets into their owners with `_foldPetsIntoOwners` (`overlay.html:547`/`689`). Neither copy builder calls it. The current-fight copy drops pet rows outright, so the header total includes the pet while no line shows it. The History copy gets the owner's damage already folded in by the bot, with no "+pet" mark, and a leftover local pet row can be counted twice in the header | Build both copies from the folded rows and print "+pet" where the meter shows it | S |
| 8 | Per-character layouts do not seem to work at all | Saving and applying work. The trigger is the problem: the active character is **whichever Zeal stream reported last** (§52), so with an enchanter and a bard boxed, it flips several times a second and each flip re-applies the other character's layout | Debounce in Mimic `_onActiveCharacter`: a switch counts after the new name holds for ~5 s. The real fix, focus-based detection, stays the separate item from §52 | S |
Row 8 assumes the member runs both characters at once; one client at a time would not flip, so ask.

## 60. DPS HUD: your row always, highlighted, a % bar under every name, and the HUD finally knows who you are (2026-09-27, Mimic 2.7.3 beta)
The guild lead, mid-raid on Thall Xundraux Diabo: *"your own row always, and always highlight it so
its easier to see. Have a thin row underneath each person with their percentage done."*

**The call and where it landed** (`apps/mimic/overlay.html`, beta `4d89add1` + `881f07c0`):
- **Your row always shows.** It was already appended under a dashed rule when you fell below the
  visible rows. It now also appears at zero, rank "—", when you did nothing this fight, on every
  tab and in mini. An empty board stays empty.
- **Highlighted as a band:** gold background and a gold left edge, not only a gold name.
- **A 2px bar under every row**, drawn against the TOP row rather than the raw share. A raw share
  of a 50-person raid tops out near 7% of the width, so every bar would be a stub. The % column
  still shows the real share. Gold for you, blue on DPS, red on Tank. Mini already had its own
  share-of-raid bar and keeps it.
- The rank column went from 1.1em to 24px: two-digit ranks spilled out of it into the new gold
  edge, and the em also differed between the 9px header and the 11px rows.

**Why none of this showed before (root cause).** The HUD looked for you under `s.character`,
`s.uploaderCharacter` and `s.self`, and `/api/state` sends none of them. That is the overlay
catalog's finding 1 (§57, `DESIGN-overlay-catalog.md` §3). So the gold name, the always-show-you row
and mini's centring on you had never run, and the screenshot had no highlighted row. The HUD
now reads `activeCharacter`, then the live fight's `uploader`, with the old three kept as fallbacks.
When two characters are boxed, `activeCharacter` still flips with whichever Zeal stream reported last
(§52), so the highlight follows that flip.

**Deliberately not touched:** the Threat meter has the same wrong keys (the same catalog finding).
It is a one-line fix of the same shape; it was left for its own change.

## 61. The Aten Ha Ra film goes on YouTube; `/film` plays it (2026-09-27, web on beta)
**The call** (the guild lead, answering "how can we make these available on wolfpack.quest"): **YouTube**,
option 1 of three that were costed. The full film is hosted on YouTube. The raider clips are to stay
members-only on the site, as the next change.

**Why not the repo or our own storage for the film.** The repo is public, the film carries
members' names, and the two 1080p masters are 230 and 210 MB. Supabase Storage would work for the
720p copies, but YouTube costs the platform nothing in storage or egress and plays well on phones.
The guild lead was uploading there anyway (the covers were made for it).

**Where it landed** (beta `6fa74bef`): `/film`, signed-in members only, in the Stats menu. The two takes
come regular first, then the remix. Each poster is our own cover image, and the YouTube embed loads
only on the click. The takes and links are **data**: bot_kv `film_youtube`, seeded 2026-09-27 with
empty links. Until a link is set the poster reads "On YouTube soon". Setting it is one SQL update, no
deploy. `web/lib/film.ts` accepts any usual YouTube link shape and refuses everything else. Two
layouts for review: the default stacks both takes, `?v=b` is one player with a switch.

**Parked, same night:** a raid-say "Divine Intervention to < X >" should start that cleric's DI
cooldown (the CH chain showed a cleric as "DI ?" right after he announced his DI). Investigated,
not built: the guild lead asked for the YouTube work first. STATUS carries it.

### 61a. Everything into the guild lead's Drive folder, by an import script (2026-09-28)
The guild lead asked for every film asset in the raiders Google Drive folder. The Drive connector cannot
carry video: it only creates files from content typed into a call, and its grant could not even list
files. The guild lead chose an **import script**. Every asset is staged for 24 hours in a public Supabase
bucket, `film-staging`, under a random 32-character path that is not written here. That is 105 objects,
1,073 MB: 78 raider clips, both 1080p films as 19 MiB parts, the 720p copies and the covers. The bucket
cannot be listed without auth, so only the exact links reach anything. The anon upload policy existed
only for the upload, scoped to that path, and was dropped straight after. The guild lead runs a Google Apps
Script that pulls it all into the folder and rebuilds each film from its parts with a resumable upload.
Deletion is scheduled for 2026-09-29 04:00 UTC. The same night one raider got a new clip, breaking their
chains (Gemini still, LTX pro 6 s, about $0.61), which replaced their clip in the set.

**The HQ raider clips (same night).** The guild lead found the clips blurry and smeared. The cause was
our smoothing step, not the generator: 78 of the 104 renders were drawn on twos, and the pipeline had
ffmpeg invent the missing frames (motion-compensated interpolation), which ghosted every fast move. The
name card's punch-in zoom and the song sat on top of that. The clips were rebuilt straight from the
generator's files: the video stream is copied untouched (720p; the one 1080p redo stays 1080p), with no
card and no song. They went up in a new `Raider clips (HQ)` folder. The importer skips files already in
Drive, so re-running it adds only these. Deletion moved to **2026-09-30 04:00 UTC**. **Rule: never
interpolate hand-drawn animation.** On twos is how it is meant to move. A native-1080p re-render was
tested on one raider ($0.48). Its lines are sharper, but it is a fresh take with new motion and some
camera drift. All 78 would cost about $37; that is the guild lead's call.

**Outtakes too (same night).** The guild lead asked for every other generated piece: *"some of them are
worth having a laugh over, others looked better."* Staged under `Outtakes/` in twelve folders: both
rounds of stills with their tries, every animation take (the film's take marked), the class, opening,
ending and transition renders, the cold open and storyboard takes, the one-raider redo, the earlier cuts
of the film, the cover candidates, and the old clips with the song. Only raw generations and finished
cuts went in; intermediates such as frame sheets, smoothed copies and card composites stayed out. The
bucket now holds 676 objects, about 4.1 GB (PNG added to its allowed types). The importer now **books
its own next run** on a one-minute timer when it pauses, and a script lock stops two runs overlapping. A
mocked end-to-end run landed all 630 files, and a second run added nothing.

**Then every attempted version (same night).** The guild lead: *"add all of the other versions ... each
attempted version."* The earlier cut had left out the smoothed copies and composites; those are versions
too, so four more folders went in: `13 Name cards, every round` (all six rounds, 506 clips),
`14 Smoothed animations (the blurry ones)` (118), `15 Class intro versions` (47) and `16 Other versions`
(28). Still left out: files byte-identical to one already in (the hash-named first stills), the same cut at
a second resolution, frame grabs and contact sheets. The bucket now holds 1,375 objects, 6.6 GB. The
script's file list is packed one line per file (folder numbers, not names), which brings it to 74 KB for
1,329 files, below the 82 KB version already saved. Saving new code while the timer chain runs is safe;
the next run reads the new list.

## 62. Guild media: long-term storage per character; the making-of page and character galleries (2026-09-28, web on beta)
The guild lead asked for everything behind the film on wolfpack.quest: *"with this process, all of the
pronunciations, everything that went into making it."* Then, mid-build: *"we should have a gallery
available for our players on their character pages, not to hold every picture in the world, but it
would be cool to treat it like a longterm storage of that."* One store serves both.

- **The store.** A private bucket, `guild-media`, and a table, `guild_media` (migration
  `20260928045235`, applied via MCP and committed identically). One row per stored file: `collection`
  (the film is `aten-ha-ra`), `section` (the step it came from), `character_name` (whose gallery it
  belongs in; NULL for shots that are not one raider), `kind`, `path`, `thumb_path`, `title`, and `meta`
  (the generation record: model, resolution, prompt). Neither the table nor the bucket has policies, so
  anon and signed-in users can neither list nor read them. The web server reads with the service role
  and signs links, the same shape as `feedback-screenshots`.
- **What went in.** 628 files for 98 characters, 3.3 GB, plus a 480-wide thumbnail for each (1,256
  objects in all). That is both rounds of stills with their tries, every animation take (the film's
  take marked in `meta.used`), each raider's clean clip and the older clip with the song, the class,
  opening, ending, transition and cold-open renders, the earlier cuts, the covers, and both takes at
  720p. Two cuts over one 50 MB object were re-encoded to fit. The 1080p masters stay on YouTube and
  Drive. Loaded with temporary anon insert grants (on storage, `guild_media` and one `bot_kv` key), each
  revoked straight after and checked at zero.
- **The film's facts are data.** bot_kv `film_making` holds, per raider, how the name was written for
  the song, when each take sings it, and what the speech-to-text model heard. It also holds the lyric
  sheet, the style prompt and the counts. The repo carries none of it: it names raiders.
- **One auth check per page, not per picture.** Pages sign one batch of links per render and show a
  first screenful per section; the rest of a section, or one raider's whole set, comes from
  `/api/media` on a click. That route checks sign-in first and refuses a request with neither a section
  nor a character. The viewer fetches a file's prompt only when "How it was made" is opened. The
  per-picture alternative, a redirect route, would have cost two auth calls per thumbnail, and the
  middleware notes why auth load matters (the 2026-07-13 incident).
- **Pages, two layouts each, on beta.** `/film/making` defaults to the story, chapter by chapter; `?v=b`
  is "find your raider". A character page shows a Gallery card under its header, only when the character
  has media: by default the clip, action still and first picture large with the rest behind "All";
  `?g=b` groups everything by source. `/film` links to the making-of.
- **Not shown:** money. The per-file cost is in `meta` but no page renders it; whether the guild sees
  the spend is the guild lead's call.
- **Retention:** kept indefinitely, no pruning. That is the point of the store, and 3.3 GB sits well
  inside Pro's 100 GB of storage. Recorded in `DESIGN-selfhost-wizard.md` §3.
- **Not built yet:** uploads by players. The table is shaped for it (`collection`, `section`), but an
  upload path needs the public-upload security audit that is already open for the guild-logo page first.

### 62b. Graduated to main, with the filter on top and a #raid-chat card (2026-09-28, web 1.8.30, bot 3.1.162)
The guild lead: *"push this up to main and send a link to the guild's raid-chat using this image as the
'come look at the stuff' ... make sure people can filter just see specific characters at the top."* That
is the layout call. `/film/making` now opens with the raider finder (search a name, pick a class, click a
raider for their whole set), and the story follows. `?raider=<name>` opens on that raider, and each
character's Gallery links there. The unpicked alternates (`/film?v=b`, `/film/making?v=b`, Gallery
`?g=b`) were deleted on beta first, so beta and main carry byte-identical files and the main→beta sync
has nothing to conflict on. This was a file-level promotion as always, plus the Film nav link, the
page-meta entries, the roadmap entry and the version bumps.
- **The card** is a bot one-shot, `_announceFilmMakingOnce`, in the shape of the 2.7.1 card: latched in
  `bot_kv` (`announce_film_making_raid_chat`, fail-closed), pings nobody, links `/film/making`, and uses
  the guild lead's picture. It waits until that picture answers 200 on wolfpack.quest, because it ships
  in the same web deploy as the page, so the post can never beat the page. The first try is a minute
  after boot, then every 5 minutes for up to 12 hours.
- **The picture is public** at `web/public/film/making-of.jpg`: a drawing with no name on it, like the
  covers. `/film/making` also unfurls with it when the link is pasted.

The guild lead has acquired `eqmimic.quest` and wants Mimic available there without the Wolf Pack
branding, and asked whether that means moving to a new, closed repository if it is offered as a service.
**Open; the guild lead's call.** What any answer has to carry:
- **Every package is already AGPL-3.0-or-later** (root, Mimic, agent, web). AGPL is the licence built for
  this case: anyone who runs a modified copy as a network service must publish their source. It does not
  stop the copyright holder running their own service. Nearly every commit is either the guild lead's or
  made in their sessions, so relicensing future code is theirs to decide. Code already published under
  AGPL stays AGPL for anyone who has it.
- **The installed fleet updates from THIS repository being public.** Mimic's `electron-updater` publishes
  to and reads from this repo's GitHub releases, and the bot serves agent hot-swaps from
  `raw.githubusercontent.com/davehess/QuarmBossTracker/...`. Making this repo private would silently stop
  updates for every installed Mimic. Moving the update feed (a public releases-only repo, or a feed on
  eqmimic.quest) comes first, through one last release on the old feed that points clients at the new one.
- **Groundwork that is not wasted either way:** one brand config for Mimic (name, icons, colours, default
  server) with Wolf Pack as the first tenant; Mimic fully usable without a guild backend; eqmimic.quest on
  the same Vercel project behind a host rewrite. This is the self-host wizard epic seen from the other
  side.
- The recommendation and the non-technical questions went to the guild lead in chat, not into this file.

## 63. #petstats feeds the Pet and Charm windows (2026-09-28, agent 3.7.35 beta)
The guild lead, with a #petstats screenshot: *"We will be able to see what pets are using and build this
into the pet window and charm window for sure. This will help with haste percentage and damage
expectations, as well as negative MR of charm pets or positive stats."* #petstats is a live player command
from the PoP patch (the notes list it under New Player Commands), not a test hook.
- **What the agent reads:** the block the server prints into the owner's log: pet HP, AC, ATK, damage range
  and average, attack delay, melee DPS, the five resists (signed, so a Tashed pet shows negative MR) and
  21 equipment slots. `applyPetSheetLine` in the agent, per owner, a 3-second line window, lines that do
  not belong skipped. It rides `/api/state` as `sheet` on the petHealth row that both `pets.html` and
  `charm.html` already read, only when the sheet's pet is the row's pet. Local only, like all pet state.
- **Haste is "observed":** the catalog carries no NPC attack delay, so haste is measured against the
  slowest delay seen for that pet. A pet first read while slowed over-states its later haste.
- **Charmed mobs expire, summoned pets keep:** a sheet for an "a/an/the" name expires with the 30-minute
  pet TTL, because the next mob of that name is a different mob. A proper-named summoned pet keeps it.
- **Display is not built.** Overlay rule: options first. Pending the guild lead's pick.
- An equipped slot's exact wording has not been seen yet (the screenshot's pet wore nothing), so the
  parser stores the text after the slot name as it comes.

### 63a. The PoP patch notes against the boss board (2026-09-28, bot 3.1.163)
The guild lead posted the server's PoP patch notes (July 23 to September 28). The board unlocks PoP on
Oct 1, and `data/bosses.json` matches kills by EXACT name or nickname, so a wrong name means a kill that
silently never starts a timer. Fixed, all confirmed by the notes and the NPC catalog:
- **Quarm 168 → 162 hours** ("Boss lockouts are 6 days 18 hours" in the Plane of Time).
- **Mujaki the Ravager → Mujaki the Devourer.** The notes and `eqemu_npc_types` 204039 both say
  Devourer; the old name stays as a nickname.
- **"Avatar of Earth" on the Rathe Council slot.** The notes name the Avatar as Earth's elemental god
  (5 days 18 hours, matching the slot's 138 hours); the Council summons it in instances.
Not changed, for the guild lead: the notes put "most PoP raid bosses" at 66 hours and list them, but do not
name Xanamech, Ture, Mujaki, Askr or Charassis, which the board has at 72. The notes also name two
66-hour bosses the board lacks (Mithaniel Marr, the Manaetic Behemoth) and shorter lockouts it has never
tracked (Emmerik and Evynd 6 h, Grioihin 18 h, Halls of Honor trials 18 h, Keeper of Sorrows and Tylis
2 h, An Unimaginable Horror 30 min).
- Also from the notes, recorded for whoever touches them next: NPCs no longer equip bows handed to them,
  so the bow-pet reasoning in the agent's pet verb table is historical; PoP graveyards move corpses after
  60 minutes, so a corpse DM's /loc goes stale there; quakes open an 8-hour raid window in the PvP
  instance; new commands #popflags, #timelockout and #glory are parser candidates like #petstats.

## 64. The lore behind the raids: `docs/LORE-planes-of-power.md` (2026-09-28)
The guild lead: *"Consume the Lore for Everquest so that we can build a larger narrative around our raids
moving forward. Use Haiku agents to comb through the site and build a better understanding of how Planes
of Power matters and what happens in the pantheon of gods."* Six Haiku agents split
loreofnorrath.wordpress.com (about 990 posts, read through the WordPress public API) into pantheon, PoP
story, timeline, dark gods, light and elemental gods, and Luclin. A second pass checked every
load-bearing claim against the source text before anything went into the doc.
- **The frame it gives us:** PoP is where mortals break into the gods' own realms, kill their champions
  and reach the Plane of Time. Afterwards (EverQuest 2's *Tome of Destiny*) the gods agree mortals are
  too strong and withdraw from Norrath, which leads to the Rending and the Shattering of Luclin. Our
  raids are the cause of the gods' silence.
- **Source tiers are part of the doc.** EQ1 in-game text wins; EQ2 text is canon only for what happens
  AFTER PoP; the tabletop RPG and fan essays are "legend has it".
- **Haiku alone was not good enough for lore.** The first pass put the EQ2 bridge story before PoP,
  called Tallon and Vallon goddesses and Aerin`Dar a priestess, and padded gods with invented "raid
  hooks". The corrections are listed in the doc. Any later lore pass should verify against the source
  text the same way.
- Not built: lore lines on `/pop` zone cards, a story block on `/guide/[bossId]`, a flavour line on
  Discord kill cards. Those are UI changes, so options come first.

## 65. The PoP checklist, `/pop/guide` (2026-09-28, web on beta)
The guild lead: *"we need a page made up for PoP guidance, where to start, what quests are must haves,
what can be done with a group or a raid or solo. Make this a checkbox type of thing."*
- **One list, 46 items, 8 sections:** start here, the PoK quests open now (the nine from the
  2026-09-28 PoK list, easy to hard with PQDI links), spells, tiers one to four, the Plane of Time.
  Each item says **Solo, Group or Raid** and whether it is a **must-have** (27 are). Items live in
  `web/lib/popGuide.ts`; the `key` is a storage key and must never be renamed.
- **Who-you-need is measured, not guessed:** every flag boss from tier one up is 150k HP or more in
  the NPC catalog, so it is a raid. The group work is tier-one trash, Grummus, the hedge maze
  (capped at 4 groups per dream by the patch), the Storms medallions (compound trash and minibosses
  drop them) and the parchment farming. Rows the classic chart has not confirmed for Quarm say
  "verify at launch".
- **Ticks are per character and saved.** A hand tick is a row in `pop_guide_ticks` (migration
  `20260928192730`, applied). A flag Mimic already recorded in `pop_flags` ticks its row by itself
  and locks it, so the page and `/pop` never disagree. Members only; you see and tick only your own
  characters (household and alt family, `ownedCharacters`); the action rejects unknown items and
  other people's characters before it writes.
- **Two layouts on beta:** A (default) is the path, one list in progression order with Solo / Group /
  Raid filter chips. B (`?v=b`) opens on "your next five must-haves", then Solo / Group / Raid
  columns. The pick is the guild lead's; the other goes when it graduates.
- Found on the way: the patch says Tranquility portals no longer let anyone in on level alone, but
  `/pop` still labels tiers two and three "Classic: 55 / 62 if unflagged". Label only (access maths
  ignores it). Not changed here.

### 65a. Live, with every flag step, /say and /map lines, and item cards (2026-09-28, web 1.8.31)
The guild lead: *"this looks good, push it to live, add in mousover for any items mentioned, Put
Locations for anyone that we need to reach with a copy of /map <Y> <x>"*, then *"anything you have to
say should also have a copy button next to it with /say in front of it"*, then asked that the
[EQProgression flagging guide](https://www.eqprogression.com/planes-of-power-planar-progression-flagging/)
be fully folded in. "This" was the single-list layout (A); B was deleted in the same change.
- **The steps now follow EQProgression's checklist:** the talk BEFORE each boss, the planar-projection
  hail after it, the NPC to see afterwards, the zone-ins that set flags, the Tribunal plea, the three
  Halls of Honor trial hails, Karana's line, Maelin before and after the Zeks, the optional keys, and the
  way into Time. Also the two PoK flag fixers (Seer Mal Nae`Shi, Grand Librarian Maelin) and Gram
  Dunnar's free charm. 74 steps, 48 of them must-haves; 35 `/say` lines; 51 items with cards.
- **Every `/say` phrase was checked against the NPC's quest script** (`eqemu_quest_scripts`). Gram
  Dunnar has no script in our mirror, so his row says "verify at launch". The Seer also answers
  "delete", which clears flags; the page never offers it, and a test holds that.
- **`/map` is the NPC's placed spawn, Y then X,** the order `/loc` prints and Zeal's `/map` takes.
  Checked against PQDI, which labels its coordinates "(Y, X, Z)": the Seer is (-42, -224) in both. NPCs
  that only appear after an event (Karana, Tarkil Adan, the post-kill Giwin, Loreseeker Maelin) get a
  `/say` but no `/map`.
- **Items:** `[[Name#itemId]]` in a step renders the existing inventory item card on hover; one
  `item_card_info` call per render. A click on an item never ticks the box.

## 66. Rallosian Glory PvP kills (2026-09-28, agent 3.7.36 beta, bot 3.1.164 main)
The guild lead posted two new broadcast lines after the PoP patch (*"Some new messages"*):
`[PVP] Rallos Zek watches as <killer> spills <victim>'s blood in <zone>, but finds no worthy conquest.`
No pattern matched it and the unmatched capture only kept lines with "has killed", so both kills in the
screenshot are in neither `pvp_kills` nor `pvp_deaths`.
- **Agent:** `parseGloryKill` reads killer, victim, zone (split at the clause, not the first comma, so
  "Doomfire, the Burning Lands" survives), `source: 'rallos_glory'`, guilds null. `glory` is `false` only
  for the "no worthy conquest" ending we have seen; any other ending is kept as `gloryText`. The unmatched
  capture now also keeps any Rallos Zek / Glory line that fails to parse, so the worthy-kill wording is
  on record the first time it appears.
- **Bot:** the line names no guilds, so `_resolveGloryGuilds` fills them: each name's latest non-anonymous
  `/who` guild in the last 30 days, else our roster → Wolf Pack, else unknown. A Glory kill is always
  player-versus-player: it counts as ours when one side is ours even if the other guild is unknown, and
  never takes the boss-timer path. Its guilds came from `/who`, so it is not written back as a sighting.
  The post dedup also keys on killer + victim, so the same kill in both wordings posts once.
- ⚠ **Reaches players only through Mimic.** Beta testers get it now; stable users will not read Glory
  lines until a stable Mimic is cut.

### 66a. The Sebilis Glory kills that were missed (2026-09-28, no code change)
The guild lead, with two "…spills …'s blood in Ruins of Sebilis, but finds no worthy conquest" lines:
*"did these get missed"*. Yes, and nothing is broken now.
- **Why:** PvP in Sebilis came back on about 19:51 UTC, and guild chat reacts to a kill at 20:25. Only two
  machines uploaded PvP that day, and both still ran agent 3.7.35, which predates `parseGloryKill`
  (3.7.36 went to beta at 20:28). The line matched nothing and was dropped without a trace, because
  3.7.35's unmatched capture needed "has killed". The first Glory row stored is 22:18 UTC, after the
  uploading machine took 3.7.37 (about 21:20–21:40). The two posts it did make at 20:11 and 20:25 were
  instanced boss kills (Fright, Lord of Ire), both in `pvp_boss_kills`.
- **Checked, not the cause:** the live tail runs `parsePvpBroadcast` before `shouldKeep`, and the Opt-in
  Logs replay does too, so no filter drops the line on 3.7.36+. Glory rows from 22:18 on are all stored.
- **Recovery:** anyone whose log holds the lines runs Opt-in Logs over that afternoon on 3.7.36+. The
  replay reads the line, sends it flagged as backfill (no per-kill Discord post, one summary), and the
  bot's dedup keys make re-sending the three stored kills harmless.
- ⚠ **What this shows:** PvP collection rests on the few members whose client displays the `[PVP]`
  channel, not on the whole fleet. Two uploaders on 2026-09-28, the column only exists since 2026-09-26.
  A new server broadcast is lost for exactly as long as those few run an agent that predates its parser.

## 67. Missing spells: vendor names link, 📍 copies `/map Y X` (2026-09-28, web 1.8.32)
The guild lead, on the Shopping list: *"This page needs to have the people be links and a map icon next
to each with a copy with /map <y><x>"*.
- **Every vendor and dropper name links to its NPC page** (`/db/npc/<id>`: every spawn point, loot,
  faction), in both the By-level dropdowns and the Shopping list.
- **Each vendor gets a 📍 button** that copies `/map Y X` for that zone, Y first, the same order as the
  checklist (§65a). The point comes from `eqemu_spawnentry` → `eqemu_spawn2`, one per vendor per zone,
  lowest spawn id first.
- **Droppers get the link, not a 📍.** Across every spell scroll no vendor has more than 3 spawn points
  (463 in all), while a dropper can have 119; one point for a roaming mob would send people to the
  wrong place. Its NPC page lists them all.
- **Found on the way:** the boss guide (`/guide/[bossId]`) asks PostgREST to embed `eqemu_spawn2` from
  `eqemu_spawnentry`. The two tables share `spawngroup_id` but have no key between them, so the call
  fails (PGRST200) and no boss guide shows a spawn point. Filed as a separate task; not changed here.
- The copy button moved to `web/components/CopyChip.tsx`, shared by the checklist and this page.

## 68. UI pack layout options become checkboxes (2026-09-28, Mimic beta)
The guild lead: *"NIllipuss update with Default is not this, this adds a different bank"* (screenshots:
✓ Applied "Hotbar + Bag 1 slots", the small default bank, and the huge all-bags bank), then *"Default
should be no options, but you should be able to choose or remove multiple options. Resolve which ones
have overlap and make it checkboxes."*
- **What went wrong.** In Nillipuss 3.1 the pack's main `EQUI_BankWnd.xml` IS the all-bags bank (340
  slots); `Options/Bank - Default layout` is the 40-slot one. The old dropdown could only add a layout and
  never showed which were on, and an install or update wrote the all-bags bank back. The Hotbar message
  was the dropdown's real value at the click (value and message are the same string); nothing mapped one
  option to another.
- **The call:** nothing on by default; tick any mix; a tick takes effect at once. Two options that change
  the same file can't both be on, and the other box says which window they share. Two versions of one
  option (Theme - Colors · Purple / Teal) are alternatives even where their files differ. Everything else
  stacks.
- **An option file identical to the pack's own file is ignored.** That was the one open policy question
  from the diagnosis: QQ Layout ships the default hotbar, so it would otherwise clash with both hotbar
  options for no reason. "Blue (default)" shows as what you already have.
- **Restores need the pack's own files,** so Mimic keeps them in `uifiles/<pack>/.mimic-defaults/`, taken
  from the release zip at install. A pack installed before this fetches them once from GitHub (the tag
  Mimic installed, else the latest). Whether a box is on is read off the files, never a saved list, so
  the boxes can't drift from what EQ loads. An update keeps the ticked options on.
- Installs no longer write backup copies inside `Options/`: those copies were being applied as if they
  were layout files. A file the member edited by hand is still backed up before an option replaces it.
- Measured against the real 3.1 packs. 1080p clashes: Bank ↔ QQ, Horizontal Layouts ↔ Hotbar + Bag 1, Mana
  Bar ↔ Mana Timer, and the theme versions. 1440p has more options that share the player/target and
  inventory windows; the matrix is worked out from the files at run time, never written into the code.
- **To get the normal bank back today on stable Mimic:** apply "Bank - Default layout" again, check that
  the ✓ line names it, then `/reloadskin`.

## 69. Quest NPC lines that look like tells are not tells (2026-09-28, bot 3.1.165)
The guild lead, with a Discord DM reading "Maelin → <character>: Welcome to Myrist! …": *"this is an NPC
message, not a tell"*.
- **Cause:** Grand Librarian Maelin's PoK script prints its own chat line,
  `e.other:Message(0, "Maelin tells you, '…'")`, 17 times across the PoP flag steps. It lands in the log
  exactly like a `/tell`. The agent's NPC-sender rule (3.6.52) compares against the targeted NPC's FULL
  name, and "Maelin" is not "Grand Librarian Maelin". In game it shows as `[Fr] [Maelin]:` because Zeal's
  `/abc` abbreviation rewrites any "X tells you" text; that label does not mean it came in as a tell.
- **Fix, on the bot so the whole fleet has it without a Mimic update:** drop an incoming tell whose sender
  AND text are a line some quest script prints as a tell. The lines are read from `eqemu_quest_scripts`
  (20 scripts, 67 lines, 16 senders; cached 6 h, fail-open). A name rule alone was measured and rejected:
  four real players share an NPC's name or last word, with 49 real tells between them, and 27 senders
  never seen on /who sent 90 tells that look real. Covers Maelin, Mavuin (PoJ) and Thelin; the 13
  multi-word senders were already dropped by the agent.
- **Stored rows:** the 8 Maelin rows (all 2026-09-28) were deleted by the same exact match; nothing else
  matched. Older NPC rows (bankers and a merchant, ~77 in all, mostly before 3.6.52) are left alone.
- **Not changed:** the agent's local Recent Tells card still lists these lines until the agent's
  NPC-sender rule also accepts the target's last word. The exact long-term signal is Zeal's chat colour
  (0 for this line, 257 for a real tell), which Mimic does not forward to the agent.
- **Side finding, filed in STATUS:** with Zeal `/abc 2` ("Chat and Log") the LOG line itself becomes
  `[Fr] [X]: …`, which the agent's tell pattern never matches, so those users' real tells are not
  captured at all.

## 70. Target Info F/Q/V: Faction, Quest, Vendor (2026-09-28, bot 3.1.166 main, agent 3.7.37 + Mimic beta)
The guild lead: *"lets make a quest tab on target info that has the quest details for what to say and
copyable /say and /map items for who to talk to next"*, then *"Lets make it the same tab as Faction, Make
it F/Q/V for Faction, Quests, and Vendor. Don't bother showing Vendor if its not a vendor mob"* and *"Then
have sub-tabs underneath that."*
- **The tab:** Factions became F/Q/V with sub-tabs Faction / Quest / Vendor. Vendor appears only when the
  NPC sells something. The chosen sub-tab is remembered per viewer.
- **Quest** is read from the NPC's own script (`utils/questDialog.js` over `eqemu_quest_scripts`; all
  5,719 mirrored scripts are Lua). Keywords come from `e.message:findi("…")`, never the [brackets] in
  replies, which can differ (Tarerd Gahar says "[from you]" and listens for "from me"). Each keyword is a
  `/say` chip with the reply; "depends on you" when the answer turns on flags, items or faction; "flag"
  when it can give one. GM-only branches are never offered (the Seer's "delete" wipes every PoP flag and
  is gated on `GetGM()`). Hand-ins come from `scripted_npc_turnins`; who to talk to next is every named
  NPC the replies mention (full names anywhere, a bare surname only in the same zone) with a placed
  spawn for `/map Y X`.
- **Data path:** `GET /api/agent/npc-interact?id=` (bot, 6 h cache) → agent `/api/npc-interact` (asked
  only while the tab is open; an empty answer retried after 10 minutes, not pinned for 6 h the way
  mob-info pins a miss) → `mobinfo.html`.
- **One overlay fix rode along:** Target Info's body is only rewritten when its HTML changed. Before, it
  was replaced every 500 ms, which would have wiped a chip's "copied" and the hover under the cursor.
- **Not built, the one alternative:** a one-line "next step" strip on Stats for quest NPCs, with no tab
  switch. Cheaper to read mid-fight, but it can only show one keyword, and the ask was the full dialogue.
- **Fix, bot 3.1.169:** Willamina's "Some are not even aware…" listed an NPC called Some in Grieg's End
  under who to talk to next (the guild lead: *"Why does this mention Grief's end?"*). The catalog also
  has NPCs named "One" and "Perhaps". A bare word the replies only capitalise at a sentence start is no
  longer looked up catalog-wide; it can still match this zone's NPCs by surname ("Thiran will give you
  the book" → Vicar Thiran). The agent caches an answer for 6 h, so Mimic shows the old list until it
  restarts or the entry expires.

## 71. The PoP checklist shows Willamina's whole chain (2026-09-28, web 1.8.34)
The guild lead: *"Willamina's quest needs Bolcen Tendag's section in it"*, then *"Follow the chain and
show the first item that seems to be required (gives you an item, spawns an npc, etc) and show the full
quest chain with minimize sections there. Highlight stages where you will have input/output."*
- **Traced through ten PoK scripts:** Willamina → Bolcen Tendag → Mirao Frostpouch → Oracle Cador →
  Onirelin Gali → Arch Mage Narik → Elisha Dirtyshoes → Boiron Ston → Caden Zharik → Agrakath Theric. It
  all hangs on one ground spawn: *History of Evils: The Age of Scale* on the upper level of Myrist
  (`/map -94 973`, one up at a time, 30-minute respawn, from `eqemu_ground_spawns`).
- **No NPC checks that you talked to it first** (every `event_trade` checks only the item), so with the
  book you can walk the ten hand-ins straight through.
- **On the page:** a gold "Start with this" box with the book and its `/map`; "Hand-ins, in order" (each
  row give → get, gold, with `/map`); "The story: who sends you where" (each NPC's `/say` and what they
  tell you). Both lists fold away. Every `/say` was checked against the NPC's `findi` keyword; Mirao,
  Boiron and Agrakath listen for phrases ("have come for the elixir", "like elisha dirtyshoes", "erase
  the debt"), written as sentences that contain them.
- The chain is data on the step (`GuideItem.chain`), so other chained steps can use the same view; a
  test holds that each hand-in gives what the one before it got.
- **It starts at Agrakath Theric (web 1.8.35).** The guild lead: *"That quest chain really looks like it
  should start from … Agrakath Theric"*. The first hand-in is his, so the step opens there: the PQDI link
  is his, and the "Start here" box carries his `/say erase the debt`, his `/map` and the book's `/map`. The
  story, which runs from Willamina's end, is labelled optional. Step-level `/say` and `/map` chips were
  dropped for this step because the box already carries them.

### 71a. The Seer only listens while you sit (2026-09-28, web 1.8.36, bot 3.1.167)
The guild lead, with an in-game log: *"For Seer Mal Nae'Shi i had to sit down first and then say 'unlock
my memories'"*. Her script answers "guided meditation" and "unlock … memories" only when
`e.other:IsSitting()`; standing, she says to sit down. "unlock" alone does nothing, because the branch
needs both words. "You manage to recover some images from your childhood, but no recent events spark a
memory" means it worked and there was nothing new to unlock.
- **Checklist:** `Say.sit`; each Seer line gets a gold "sit first" and a `/sit` chip before it, on both
  steps that send you to her. A test holds that every Seer meditation/unlock line carries it, and that an
  unlock line says "memories".
- **Target Info Quest:** `utils/questDialog.js` marks a branch `sit` when it checks `IsSitting()`, so any
  NPC like her is flagged, and puts "sit first" + a `/sit` chip before the `/say`. Bot 3.1.168 also sends
  `say`: every word a branch needs when its condition ANDs them ("unlock memories"), one word when it ORs
  them. Before, the chip would have offered a bare `/say unlock`, which she ignores.

## 72. Stable Mimic 2.7.3 (2026-09-28, agent 3.7.37)
The guild lead: *"push all of this to main"*. File-level promotion from beta (`43f290af`):
`apps/mimic/`, `packages/wolfpack-logsync/` and their seven tests (charm-break-instant, entity-tick-fade,
mini-dps-buffqueue, pet-sheet, pvp-glory, target-info-fqv, ui-pack-options), byte-identical to beta. The
beta-only web variants stay on beta, as at 2.7.2 (/about layouts, the item page's tradeskills, the /pvp
fight pages, the Zeal marks gallery, and their tests). Full gate on the promoted tree: 330 test files,
lint and the dashboard check clean. Beta re-parked at 2.7.4.
- **In it:** F/Q/V on Target Info (§70, §71a), UI pack checkboxes (§68), Rallos Zek kill lines (§66), your
  own row on the DPS meter, buffs fading on the mob's own tick, the instant charm break and top-down trigger
  timers, and the #petstats parser (§63; nothing draws it yet).
- **Open, the guild lead's pick:** *"we need to add a forward and backward button and keep history of who
  we targetted that have quests so we can access the quests. Would this make more sense to have as its own
  overlay?"* Two ways:
  - **A. Inside Target Info's Quest sub-tab:** ◀ ▶ through the quest NPCs you have targeted.
    Build: small (history list, a pinned view). Maintenance: low. Runtime: nothing new; the data is already
    cached per NPC id. Change: the hard part. Target Info's header (name, HP, slow) must follow the live
    target, so a pinned quest body under a different NPC's header reads wrong, and every other tab has to
    respect the pin.
  - **B. Its own Quests overlay (recommended):** it follows your target whenever that NPC has a quest, keeps
    the history (◀ ▶ plus a recent list), and stays on the last quest NPC while you walk, fight or target
    something else. Build: bigger, because a new overlay owes the full parity checklist (✕, ✥ drag +
    right-click, hover handshake, Overlays-tab row, visibility, hide-all, tray + dashboard parity).
    Maintenance: one more overlay in the parity audits. Runtime: one more small window reading data the
    agent already caches. Change: easy, because it stands alone. Target Info keeps the Quest sub-tab as the
    quick look.

### 72a. Stable Mimic 2.7.4: UI pack layouts get an Apply button, and stray screenshots stop clashing (2026-09-28)
The guild lead's screenshot of 2.7.3: nearly every layout box greyed out with "both change the
Screenshot.png", and *"There's no button to install, only reset and untick"*.
- **Cause:** the old Apply copied every file of an option, its `Screenshot.png` included, into the pack's
  main folder. The 2.7.3 rule counted a file as a layout file when the main folder on disk had one by that
  name, so on any machine the old Apply had touched, every option "changed Screenshot.png" and clashed
  with every other. Bank - Default layout could not be ticked. The rule now reads the pack's own main
  folder from the stored release defaults; only before those are fetched does the disk decide, with
  screenshots and readmes named out. A test reproduces the littered folder.
- **Tick, then Apply:** a tick only plans the change; Apply writes the files, lights up while the ticks
  differ from what is on, and says how many changes are waiting. Untick all only clears the boxes. The
  instant-apply of 2.7.3 read as "nothing happens", and the greyed-out boxes hid that anything could.
- **Why a second stable the same evening:** 2.7.3 broke the feature for exactly the members who had used
  the old Apply, the guild lead among them. Promoted file-level from beta (`66dc3d1a`), byte-identical;
  330 test files green, lint and the dashboard check clean. Beta re-parked at 2.7.5.

## 73. The /who overlay gets a Zone column (2026-09-29, agent 3.7.38 beta)
The guild lead: *"lets include zone on /who overlay as toggleable column"*.
- **Switch:** `ZONE` in the title bar, next to CLASS and GUILD. Off by default so the overlay looks as
  it did; remembered on this machine. The column sits after level, a fixed 96px, full text on hover;
  the Target card holds an empty cell so it stays lined up.
- **Where the zone comes from:** `/who all` prints each player's short zone name on the row
  (`ZONE: wakening`). A plain /who prints none there, but its footer names the zone everyone listed is
  in (`There are 12 players in The Wakening Land.`), so every row gets that. A `/who all` row with no
  zone (an /anon player) goes blank instead of keeping an older zone. Recently gone rows keep the zone
  they were last seen in.
- **Shown as the game printed it,** so the column can mix `wakening` and `The Wakening Land` across the
  two kinds of /who. The agent has an id-to-name zone table but no short-name one; adding one (about
  200 rows from `eqemu_zone`) would make it read one way. Left for the guild lead to ask for.
- **Upload untouched:** the zone map (`_whoZoneSeen`) sits apart from `whoData`, whose rows upload to
  the bot as they are, so a footer's long name never lands in `who_observations`.
- **Can follow on the same data:** a zone filter chip, or sort by zone.
- `test/who-zone-column.test.js` runs the real /who tracking and row markup; mutation-checked (the /anon
  blanking and the off state).






