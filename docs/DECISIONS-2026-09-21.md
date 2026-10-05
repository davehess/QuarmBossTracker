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
| **Log stops / Enrage 12% / « Earlier / Buff-block rename / UI Studio Save / flag hails** (§164) | On beta: agent 3.7.84 (Enrage soon at 12%, spoken first), 3.7.85 (🗄 Archive log & start fresh + the log-silent banner that 3.7.81 never drew), the Canvas vote row fix, 3.7.86 (Buff blocks rename). Why EQ stops logging is unknown. Tower patch written (`PATCH-tower-raid-track.md`), not yet run | the guild lead: A or B for the Command Center hail slot (A recommended); run the Tower patch (local terminal or Claude in Chrome). UI Studio Save: **A picked and on beta** (`c281fea6`) — the guild lead: move a window in Studio, save, log in, check bags kept their spots. A session: build the hail pick |
| **Lag meter** (§163) | On beta (agent 3.7.83, reads the Quarm client's eqhost.txt): router + Quarm login server pinged once a second, local only; Diagnostics card + Tick overlay line | the member with lag (or any beta tester): run beta Mimic, open Diagnostics → 📶 Connection during a laggy stretch, paste the Copy summary |
| **FB-51: EverQuest stopped writing the log** (§162) | Field fix: log moved aside + EQ restarted. On beta (agent 3.7.81): `[log-silent]` warning (state field, no UI), tail watchdog, newest-lines bug-report excerpt, empty queue not "corrupt". Found: log archiving has never run in watch mode | the guild lead: (1) yes/no to wiring log archiving into watch mode (renames logs over 500 MB on members' machines for the first time); (2) whether the silent-log warning gets an on-screen form |
| **Spectator map on wolfpack.quest** (§160) | **Built** (web 1.8.98): `/spectator` [beta], Brewall's lines underneath (the guild lead's call, members only, never in the repo), generated EQEmu walls as a second layer, live raid dots every 3 s. Checked against the 2026-10-04 raid: dots sit inside the walls. **Raid replay (§161):** recorder built (bot 3.1.203 on `claude/sharp-lamport-dC0TW`, migration applied), NOT on main yet; every raid kept, Tower keeps a permanent copy once its merge script is updated | the guild lead: release bot 3.1.203 to main before Wednesday's raid or nothing is recorded; copy the new `archive-merge.sql` onto Tower (or a local session does); look at the spectator on the next raid night; pick the replay look (A night scrubber / B fight replays / C trails). A session: replay previews on b.wolfpack.quest after Wednesday; target markers (the agent reads Zeal 1.4.8 `target_loc`; fleet still on 1.4.7), and the in-game heading-direction check |
| **Quarm patch notes mirror** (§158) | Live (bot 3.1.200): 1,348 Quarm posts since 2023-11-17 stored, every one blank, because the Message Content intent is off in production | the guild lead: (1) Discord Developer Portal → the bot → Bot → turn on **Message Content Intent**; (2) THEN set `MESSAGE_CONTENT_INTENT=1` on Railway (the other order stops the bot connecting). The next sweep (≤6 h, or a restart) rewrites the blank rows |
| **Buff-block picker** (§157) | On beta: agent 3.7.79 (`f1b9a4e2`), a Buff blocks dashboard tab with sets, copy lines, and socials written at logout | anyone: type `#blockbuff` in game and paste the reply (it unlocks reading the live list); a bard + monk test of whether a blocked song still pulls the bard into the fight |
| **Row-cap fixes: what they turned up** (§155) | Every read past the 1,000-row cap is complete (bot 3.1.198 · web 1.8.95, nine migrations applied). Found along the way, not fixed | the guild lead: **haste foci** (`_refreshFocusHaste` reads `worneffect`, the foci are in `focus_effect`; changes cast bars for ~103 characters); **trigger Votes** (count only earlier/good/too_early, not 48k `expired`). A session: /admin/encounters curated-only? (`/encounter tonight`, the doubled OpenDKP auctions and the 29 s spell-needs call were fixed 2026-10-04) |
| **`raid_nights` counts group nights as raids** (§154) | The bot opens a raid night for any Sun/Wed/Thu encounter after 20:30 ET; real raids are the OpenDKP raids. The /fun card now uses OpenDKP (web 1.8.93) | a session: list every reader of `raid_nights` / `encounters.raid_night_id` and decide which should mean "an OpenDKP raid"; no raids until 2026-10-14 |
| **History + quest navigation picks** (`docs/DESIGN-history-and-quest-nav.md`) | Options written 2026-10-04; the meter-history correctness fixes and the PoP overlay fixes are being built | the guild lead: Target Info history **A — Pager**, **B — Ledger** or **C — Kill log**; Tank history **A — same list, both tabs** or **B — one fight card**; quest navigation **A — drill-down blocks** or **B — two fixed rows**, and what ▶ does at the end of a plane |
| **Zeal crashes on the fork** (§151) | 3 new teardown crashes, all on the fork's test build; crash list now tags official vs test (agent 3.7.77 beta) | the guild lead: A/B on official Zeal (or `/tag persist off`); a local session reads the three dumps |
| **Buffs by raid group** (§149) | Bot 3.1.195 live (`groups[]`, group-buff keyword fixes); /buffs previews + buff queue By group on beta | the guild lead: pick https://b.wolfpack.quest/buffs?v=b (**group cards**) or ?v=c (**buff lines**); try By group in the Mimic beta buff queue at the next raid |
| **Discord onboarding overhaul** | Re-mapped 2026-10-03 (`docs/DESIGN-onboarding-overhaul.md`, "2026-10-03 refresh"): the parser card says Mimic v1.0.0, its link renders raw, the Parser.bat zip 404s, it says paste a /token; the welcome never links /start; joiners with closed DMs pile into the shared thread; the agent-release DMs carry the dead zip | the guild lead: pick **A — Doorway: Discord just points at wolfpack.quest/start**, **B — Walkthrough inside Discord: five click-through pages**, or **C — Self-ticking checklist: shows what you've done**; stop or keep the agent-release DMs |
| **Discord setup on the website** (§148) | Mapped 2026-10-04 (`docs/DESIGN-discord-setup-page.md`): 45 destinations are env-only, no permission check, no job last-run record; web → Supabase → bot polling is the proven path | the guild lead: pick **A — Health page: see what's wired**, **B — Pick on the site: dropdowns, live in a minute** (recommended, A first), or **C — The bot builds it: one button creates what's missing** |
| **PoP pages live; stable Mimic 2.7.8; self-ticked flags; loot proof** | **§143–§146.** Live: web 1.8.83–1.8.85 (the /pop, /pop/guide, /me work from beta, the spellbook fixes), Mimic 2.7.8 stable (agent 3.7.75), the #raid-chat post (bot 3.1.194), members tick their own flags (1.8.86), loot proves flags (1.8.87, purple ✓), the guide in script order with the Justice flag on the Mavuin hail and the Bastion flag on the shrine click (1.8.88, §147; the overlay's ordered steps on Mimic beta) | the guild lead: (1) accept 2.7.8 when EverQuest is closed; (2) check https://wolfpack.quest/pop?view=mine and https://wolfpack.quest/me on a phone; (3) pick the guide redesign and Essences queue previews (`?v=b`/`?v=c`) when ready; (4) read the ordered steps on https://wolfpack.quest/pop/guide; (5) say whether Aerin`Dar's flag moves to the Halls of Honor door step (§147) |
| **The eight-part request of Oct 3** | **§135–§142.** Live: `/zeal-icons` + `/db/recipe` and `/admin/extra-spells` with the `[beta]` tag (web 1.8.81–1.8.82), the loot panel (bot 3.1.192). Beta (agent 3.7.72–3.7.74): Command Center raids card, crash review on Diagnostics, Loot tab who-looted-what, traders and under-46 tucked away on `/pop` `/pop/guide` `/me`, PoP overlay Quests mode with the guide's words filled from the quest scripts. Alpha `5adafea8`: Canvas presets are the real overlays, tight margins, HUD ring + builder | the guild lead: (1) look at the beta pages and Mimic beta; (2) look at the Canvas on the alpha; (3) send a dozen log lines from a PoK trainer hand-in (extra spells phase 2); (4) pick a Zeal icons layout; (5) the calls listed in §139–§142 |
| **Stable Mimic 2.7.7; the site says PoP is open** | **§134.** Stable 2.7.7 (agent 3.7.71) carries everything since 2.7.6, incl. the buff queue and update fixes below; beta re-parked at 2.7.8. Web 1.8.80: no PoP locks or "not yet" copy left; PoP AAs and spells listed as available. The website previews on beta were NOT promoted | the guild lead: (1) accept the 2.7.7 update when EverQuest is closed; (2) pick the beta website previews (about, PoP guide, Essences queue, PvP fights, tradeskills, Zeal icons) when ready |
| **Buff queue clicks; a game crash on update; Feral Avatar timers** | **§133.** Beta `16bf4795`: buff queue section headers take the click on a locked overlay (FB-49). Beta `0bd27df1`: the first run after an update stays in the tray while EverQuest is open (FB-50, the member's crash). Feral Avatar / Savagery: the ⏳ exists on the Shaman/Beastlord queue; one gap found (non-Mimic targets timed at 65 ticks, real ~102) | the guild lead: (1) on the next beta, click a buff queue header with overlays locked; (2) say which character / view showed no Feral Avatar timer, and whether the 65-vs-102-tick gap is it; (3) a stable cut carries the update fix to the fleet — your call |
| **The Oct 1–2 server patch notes** | **§130, §132.** Bot 3.1.190 + web 1.8.77: the corpse DM says when and where a PoP corpse moves. Bot 3.1.191 + web 1.8.78: Xanamech is off the board and the 72 h override; his website row still needs one delete. Agent 3.7.71 on beta `c82ae5b4` reads all 168 unread Rallos Zek lines: NPC deaths, no-killer deaths, forfeits (🏃), the "exults" kill. NPC deaths post to #pvp again, about 50 a day. Still open: the Oct 2 "Glory lost/gained" wording (none seen yet); whether an open-world raid-target kill starts the instance timer | the guild lead: (0) approve or run `delete from bot_boards where boss_id = 'xanamech_nezmirthafen';` (§132); (1) on the beta, run Opt-in Logs from Sep 28 to send the missed deaths; (2) say if NPC deaths should record without posting to #pvp; (3) after the guild's first open-world raid-target kill, paste the Druzzil line; (4) want open-world spawn windows for those targets? |
| **Our own zone map (A website, then B Mimic overlay)** | **§131.** Queued, not started — "A then B, but not yet". First step when it starts: mirror pather routes (`grid`, `grid_entries`) into the weekly sync | the guild lead: say when to start; ask staff before anything shows live NPC positions |
| **Fifteen more suggested triggers; four dead ones fixed** | **§129.** Bot 3.1.189 (catalog `cc`) + web 1.8.76 on `main`; agent 3.7.70 on beta `e2f06f69`. FD failed / broken, resist naming the mob ({mytarget}), immune slow/snare/stun, can't mez/charm, mez / slow / fear wore off, silenced, LoS, range, mana, invis fading. Snared/mezzed/feared now match by the spell's effect; interrupted has the real text. Every line from the server's own messages | the guild lead: (1) on the beta, tick a few in the Triggers tab and get resisted once — check the alert names the mob you were casting at; (2) on a monk, fail a feign and check "FD FAILED"; (3) say whether the buff-dropped triggers should change — see §129, unverified |
| **Shield OFF under Mark of the Plague Lords; Boastful Bellow timer** | **§128.** Bot 3.1.188 (catalog `ds_heal`) + web 1.8.75 on `main`; agent 3.7.69 on beta `a66d208d`. The Mark replaces every shield and heals the mob 50 a hit (server code); HUD "DS OFF" + time left, Tank card names it. Bellow: 18 s, from your resist or your landing + your own damage; HUD "BB" once used; Triggers-tab bar. Fading Memories: no duration — invis until broken, 900 mana, 1 s reuse | the guild lead: (1) in Plane of Disease with the beta, check the HUD reads DS OFF while the Mark is up and the Tank card names it; (2) on a bard with the AA, bellow once and check BB counts 18 s — and that another bard's bellow on your mob does not start it |
| **HUD batch, auction timers, MA, XP events, fight split (one message, nine asks)** | **§127.** Bot 3.1.186 + 3.1.187, web 1.8.72 + 1.8.73 on `main`; agent 3.7.67 on beta `d0a54a4d`. Enrage at 10% with "Enrage soon", red gone once it ends; "DPS/Tank Meter"; DS thorns/lava; rampage + under-25% arcs; clicky counters; one timer per auction (late bids move it) + Command Center Auctions; MA on Extended Target; XP events uploading (`xp_events` live); back-to-back same-name fights split by your own target window; History 30 fights, local / sent / synced. Defaults picked for XP: kept 30 days, raid XP stored but kept apart | the guild lead: (1) on the beta, fight an enraging mob and check "Enrage soon" at 10% and the red clearing; (2) open an auction with a late bid and watch its timer move; (3) say yes or change the XP defaults (30 days; names stay to signed-in members); (4) make a Quarmy export (or `/output inventory`) once so the clicky counters have items — agent 3.7.68 reads either, the newer wins |
| **A targeted player's timers on Target Info; FB-46/47/48** | **§126.** Bot 3.1.185 + web 1.8.71 on `main` (column applied); agent 3.7.66 on beta `a100da84`: disc, Mend, LoH/HT and AAs from the player's own Mimic, a disc you saw them start, ✓ or time left. AAs exact from the refusal line; `/pipe at` learns Area Taunt's reuse. Alpha `9e33af91`: the timers as a Canvas part, and the "slowed null%" / "0 / 0 HP" pieces fixed. FB-46 (Zeal notice → Settings at Zeal), FB-47 (feedback text kept), FB-48 (overlay size kept) on beta | the guild lead: (1) on the beta, with a second Mimic raider, Mend or fire a disc on one and target them from the other; (2) put `/pipe at` on the Area Taunt key, press it twice and check Target Info counts down; (3) say if this should also show on Extended Target rows |
| **3.0: every overlay exactly on the Canvas, then taken apart** | **§125.** Audit: 3 of 378 overlay elements were exact as parts.js pieces. Alpha `a29075d9`: pieces cut from the overlay's own page (exact by construction), ✂ Take it apart, ✂ Overlay parts in the chooser; Target Info's 19 parts first (marks on beta `5eae2d53`) | the guild lead: (1) on the next alpha, put Target Info on the Canvas, ⚙ → ✂ Take it apart, pull out Loot; (2) say if this is the way (A) before the other 14 overlays get their maps; (3) watch Resource use with several pieces on |
| **Two raids at once stay two raids** | **§124.** Bot 3.1.184 + web 1.8.70 on `main`: each Mimic's latest upload names its raid leader; buff queue and Extended Target keep to your raid; `/raid` one tab per raid by leader; crowns work (rank is text). Agent 3.7.65 on beta: "⚔ N raids at once" on Extended Target, Buff queue, Command Center, dashboard Raid tab | the guild lead: (1) at the next split raid, check `/raid` shows two tabs and the overlays say whose raid; (2) call it: should attendance ticks and the trigger relay split by raid too (§124 "not split yet") |
| **eqmimic.quest demo with sample data; a plain /who uploads its zone** | **§123.** Demo at `hesstastic.com/eqmimic/demo/` (tour) and `/eqmimic/demo/b/` (app), hesstastic `e2d2f62`; a real raid night with every name invented, no /who data. Agent 3.7.62 on beta `5250261a`, **stable agent 3.7.63** (hot-swapped 2026-10-01; beta 3.7.64): a plain /who's footer zone goes up with its rows (7,263 of ~9,400 rows in two days had none) | the guild lead: (1) pick the tour or the app; (2) get eqmimic.quest a host: Vercel project for the hesstastic repo, or an `eqmimic` Pages repo (§123); (3) on the beta, `/who` in a PoP plane and check `/pop` on beta shows the blue ✓ |
| **PoP from /who; checklist by level, closed, maps on hover** | **§122.** Beta `4f5e68e1` (web on `b.wolfpack.quest`; SQL function applied). Anyone /who shows inside a gated plane holds its gate and the ones on the way in: blue ✓ on `/pop`, "✓ seen on /who" on the checklist. Checklist B/C: progression levels, closed by default, sidebar opens them, 🗺 map on hover | the guild lead: (1) open `b.wolfpack.quest/pop` and `b.wolfpack.quest/pop/guide?v=b` (and `?v=c`); (2) pick B or C so it graduates with the /who counts |
| **Trigger timing votes can be switched off** | **§121.** Agent 3.7.61 + Mimic on beta `db4d21d5`: dashboard → Triggers → Timing votes, or 🔕 on the vote buttons. Off = no vote row and no votes, ✕ or age-outs sent | the guild lead: on the next beta build, fire a test trigger, press 🔕, check the dashboard switch shows off and the row stops appearing |
| **Quest tab: Askr's lines, hand-ins that give a flag** | **§120.** Bot 3.1.183 + web 1.8.66, **live on `main`** (landed 2026-10-01 22:30 ET with the /who hot-swap, `853c75df`) | the guild lead: once the 6 h cache turns over, target Askr the Lost and check the Quest tab shows his conversation and "a character flag" under GET |
| **PoP flags now record by name; Quarm's real gates; Justice marks** | **§119.** Agent 3.7.59 on `main` (stable Mimics hot-swap it), bot 3.1.182, web 1.8.65. Every grant is named from the flag NPC's line or the Seer's recital; Storms now needs the Justice flag; marks show on `/pop`. Today's 42 earlier grants stay unmapped until re-read | the guild lead: (1) tell raiders: sit by Seer Mal Nae`Shi in Knowledge, say "guided meditation", and every flag they hold records; (2) or re-run Opt-in Logs over today's log; (3) check `/pop` Justice shows the 7 Marks of Execution |
| **Local mode (Mimic without the guild server); eqmimic.quest** | **§118.** Agent 3.7.58 on beta `0ec64fef` (`v2.7.7-beta.7`): no token = nothing sent to our server (it used to post uploads and live state that were then refused), no sign-in nag, Buff queue and Extended Target say "sign in". Installers carry the spell and item lists (bot 3.1.180 public catalog route). Found on the way: the bot's item catalog served 1,000 of 11,104 items (fixed in bot 3.1.181; nothing on screen used it, so no player saw it). eqmimic.quest: two designs at `hesstastic.com/eqmimic/` (A) and `/eqmimic/b/` (B), in the hesstastic repo | the guild lead: (1) pick A or B; (2) eqmimic.quest: no Vercel project builds the hesstastic repo (Pages only, §123), so import it into Vercel or make an `eqmimic` Pages repo, then DNS; (3) say whether to build the generic "Mimic" edition (§118, about 2 days); (4) cut a stable when ready, so the download is not a beta |
| **Threat meter: Concussion, Jolt values, zoning clears your hate** | **§117.** Agent 3.7.57 on beta `2fe18e75`, your own meter only (A). Voice of Quellious and the flat Voice of Thule removed; fizzles/interrupts handed back; "LOADING, PLEASE WAIT..." clears you and your pet | the guild lead: on a wizard, Concussion a mob and watch the row drop; zone out mid-fight and see it clear. B (other raiders' meters) when wanted |
| **Zeal 1.4.8: branches synced; new pipe fields; tag pictures** | **§117.** Main merged into all five branches, no force-push. **`test-all` now builds on GitHub on every push** (`0a2e25d`, first run green, so the merges compile): download `zeal_test-all.zip` from the fork's `test-all-build` prerelease. Pipe target fields reviewed, adoption planned, not built. Mimic beta `567c5911` stops backing up unchanged files and clears the identical old copies | the guild lead: (1) on Mimic beta, Settings → Zeal → Test build → Install (Mimic beta `0e5eb23b`), and try it in game, including the custom-folder steps 10–15 in `zeal-tag-shapes/TRY-IN-GAME.md`; (2) say when to build the pipe-field adoption. Tag pictures: option A built (custom folder, banners, 60 templates + README, `test-all` `da88716`) |
| **FB-45: a new loot call with the same numbers starts new rolls** | **§116.** Agent 3.7.56 on beta `2020a8c4`: a later call that puts a roll number on a different item closes the old set and starts a new one under the new name | the guild lead: on the beta, post two loot calls a few minutes apart reusing the numbers and check the Rolls card shows two batches. Raiders on stable get it at the next stable cut, which must repeat "Fixes FB-45" |
| **Target Info: mob info kept on disk; the state payload** | **§114–§115.** Bot 3.1.179 builds zone packs; agent 3.7.55 (beta `effdc609`) keeps the Planes of Power and every visited zone on disk. The likelier cause of the slowness is untouched: `/api/state` carries 591 KB of guild triggers, and Target Info reads it twice a second | the guild lead: on the beta, target something in a PoP zone and say whether it is instant. Then pick whether to slim the payload (a Target-Info-only endpoint, or trigger notes out of `/api/state`). Raid hold: `flag_raid_hold = 0` if updates should land on raid-schedule evenings before 10/14 |
| **PoP trigger pack (opens 2026-10-01)** | **§112–§113. Imported and live.** 374 guild-trigger rows (`pop-2026-10`), server recasts, corrected event patterns. NPC speech reaches triggers from agent 3.7.54, stable Mimic 2.7.6. Ring of Fire (Acrylia) pack of 5. No formal raids until 10/14 | the guild lead: in a PoP zone, run the boss short-name lookup once to see which command prints the "not online" reply the stat cards fire on. Raiders: update to 2.7.6 for the NPC-speech callouts |
| **Feedback FB-38 to FB-42** | **§110.** FB-38 (XS kept), FB-41 (Ree slow), FB-42 (kill leaves the HUD in 10 s) on beta `0d782606`, agent 3.7.50; FB-40 on alpha `f7881fc3`; FB-39 (Extended Target debuffs per mob) bot 3.1.178 + beta `dde2f702` | the guild lead: with the partner on the beta, fight two same-name mobs and check each row's debuffs. FB-38 was reported from the stable, so its reporter gets it at the next stable cut |
| **PvP: NPC rows gone; Glory-worthy kills now read** | **§109.** 24 assists, 1 kill and 20 `pvp_deaths` rows deleted on the guild lead's yes. The missed kill was a Glory-worthy one the agent could not parse: agent 3.7.51 (beta `3f0dd0a3`) reads it, and the kill is restored by hand | Glory-worthy kills are missed by every Mimic below 3.7.51, so cut a stable soon. Raiders: after updating, run Opt-in Logs over nights with a Glory kill |
| **Mimic setup walkthrough: two layouts** | **Beta `a9f2db26` + `bbfe59e6` (§93; agent 3.7.46).** A: one step at a time. B: three essentials, then cards. Main pick, Zeal / Defender / clock state, the /me abilities, the main's old log at the finish | the guild lead: tray → ✨ Setup walkthrough → try A and B, pick one; it then becomes the first-run page |
| **Essences of Power loot queue on /pop** | **Beta `7b942d11` (§96).** The guild's rule as code: one bid buys the set, the next drop goes to the first in line who lacks it and is there, else bid and join the end. `?v=b` by person, `?v=c` by essence, `&demo=1` sample data | the guild lead: open `b.wolfpack.quest/pop?v=b&demo=1` and `?v=c&demo=1`, pick one. Officers: record every piece in OpenDKP (bid, then 0 DKP hand-outs); name the set bid "Essences of Power" |
| **PoP checklist: Essences of Power** | **Live, web 1.8.49 (§95).** Nightmare escort (one Fist per run) + the four essences in Kerasha's bowl for a reward she cycles | the guild lead: read it on `/pop/guide`; say who gets essences when they drop (a loot call) |
| **Companion suite review, round two** | **Doc updated 2026-09-29 (§94).** 28 missing / 38 partial / 19 covered; gear upgrade finder written up | the guild lead: say which gaps to queue (gear finder, client version check, maps) |
| **Mimic 3.0 alpha channel** | **Built 2026-09-29 (§81).** `alpha` branch = beta + builder work (synced automatically); builds replace one rolling release, `mimic-alpha`; opt in from the tray or the dashboard's α alpha. First alpha = today's beta, to prove the path | the guild lead: click α alpha, restart, check the header says ALPHA; then α again to leave. Sessions: builder work → `alpha`, agent parts → `beta` first |
| **Overlays tab: option C** | **Beta `b8c6b98c` (agent 3.7.49, §107) and alpha `703a6017`.** Layout tiles, Arrange on screen, what is on screen now with one keycap format (clashes red), an Add drawer of overlay cards, Keys and Look strips | the guild lead: open the dashboard's Overlays tab on the next beta or alpha; say what to change. Role filters on the Add drawer only if wanted (you pick the roles) |
| **3.0: pieces (legos)** | **Alpha `994eb032` (§103) + round two `291ddcaa` (§105) + group sizing `a5532ace` (§106) + round three `ec8ad702` (§107): Target Info's every tab, HUD formats, per-piece look, menu beside the piece.** 116 pieces in 12 categories in a movable 🧩 chooser; today's 17 overlays as groups. ✕ deletes (Undo); a drag moves the whole group or selection, Alt-drag pulls one out; click/Shift-click to select, then lock together or save; ✥ click opens settings; "Arrange the canvas" in every overlay's right-click menu and `/pipe mimic edit` | the guild lead: on the next alpha, drop the Tank group and drag it whole, Alt-drag a piece out, lock two far-apart pieces and move them, save a set; say what still feels slow |
| **FB-37: XP tracking** | **Reviewed, not built (§104; `docs/DESIGN-xp-tracking.md`).** Nothing about XP leaves the machine today; total XP is exact from EQ's own formula | the guild lead: pick A (local), B (guild XP board) or B then C (live piece); retention 7 or 30 days; names for non-guild group members; does raid XP count |
| **3.0: every overlay on the canvas** | **Alpha `d2dadf94`, build `3.0.0-alpha.846` (§102).** Any of the 15 overlays as a canvas panel, as it is today; "Bring in" moves everything on screen at its spot and size; one copy of each | the guild lead: on the alpha, arrange the canvas → ＋ Overlay → Bring in; play a session; say which overlay should get its new views first |
| **3.0: sets, edit in place, six display types** | **Order taken 2026-09-29 (§83, §83a). Step 1 on alpha `e9e4f3d6`:** overlay sets — `/pipe mimic load/save/next/prev/lock`, tray 🗂 Overlay sets, Settings → Overlay sets; kept locally | the guild lead: on the alpha, save two sets, put `/pipe mimic next` on a social, flip between them in game; say whether a character switch should load that character's set. Sessions: step 2, the database backup |
| **PoP checklist: two layouts on beta** | **Beta `d0e69d49` (§86).** Sidebar nav; each step's expectations, what to say, who takes what, who you go back to, and a zone map; rows that fill themselves say "filled by Mimic" or "from our records". Reworked 2026-10-01 (§122: levels, closed, maps on hover) | the pick is now the §122 row's |
| **PoP checklist: Justice + Bastion of Thunder** | **Corrected live, web 1.8.48 + bot 3.1.176 (§86).** Six Marks per trial, the Mark is checked not taken, the wrong Tribunal location removed; Askr is three hand-ins; the Talisman is a flag from the Storms shrine and needs Justice; Symbol of Torden required; tower walk added; seven flag bosses now map | the guild lead: tell officers the page is corrected; decide the 9,846 hail rows in `pop_flags` (delete, or store them as evidence) |
| **DPS HUD +pet breakdown** | **Beta `672ff15e` (agent 3.7.45) + bot 3.1.175 (§85).** Pet's share of the bar in pet orange, "+pet" in the same colour; click for name, damage, spawn id | the guild lead: on a pet class's row, check the orange end reads apart from the row colour (gold on your own row); click +pet. Say if orange should be purple |
| **FB-34 per-character suggested triggers · FB-35 pets on the meter** | **Beta `f857fa6f` (agent 3.7.44) + bot 3.1.174 (§84).** A **For:** picker on Suggested triggers; pets named by anyone's `/pet leader` credited on every Mimic, otherwise labelled (pet) | the guild lead: pick one character in For:, tick a trigger, check it stays quiet on another; members: pet owners type `/pet leader` once per night |
| **🧲 Rescue** | **Beta `1cd1d423` (§82).** Only lost overlays move, each to its own spot; nothing re-arranged; other-screen overlays only on a yes | the guild lead: drag an overlay half off a screen, Rescue, check nothing else moved |
| **Stable Mimic 2.7.5** | **Cut 2026-09-30 (§111; agent 3.7.52):** everything on beta since 2.7.4, including Glory-worthy PvP kills, the Canvas, the new Overlays tab, screens and Rescue. The setup walkthrough stays beta-only until its layout is picked. Beta re-parked at 2.7.6 | the guild lead: accept the update; tell raiders to run Opt-in Logs over nights since Sep 28 with a Glory kill |
| **Rallosian Glory PvP kills** | **Whole fleet with Mimic 2.7.3 (§66, §72); bot 3.1.164.** The new "Rallos Zek watches as X spills Y's blood" line is read, guilds come from `/who` and the roster, and the old and new wordings of one kill post once. Kills from about 19:50–21:30 UTC on 2026-09-28 were missed: the uploading machines still ran 3.7.35 (§66a) | the guild lead: run Opt-in Logs over that afternoon to recover them; anyone: paste the first "worthy conquest" line when one appears |
| **Quest tab: warnings, give/get, faction, Quarm-only hand-ins** | **Beta + bot 3.1.171 (§74).** NPC text folded; ⚠ despawn / spawn / faction loss; GIVE / GET; every faction change; hand-ins from Quarm's own script; ProjectEQ-only ones flagged | the guild lead: pick the quest catalog shape (deep link page vs Quests overlay, §72 picked "its own overlay") |
| **Bard charm + recharm call + clicky buffs** | **Beta, agent 3.7.40 (§75).** Class from Zeal; a bard's charm gets its song's duration; "recharm pet" at 4s left; clicky casts land on the pet with a timer | the guild lead: confirm on the next charm cycle |
| **Screens changed → ask; EQ's real window; Zeal bars in UI Studio** | **Beta 2026-09-29 (§80).** Positions remembered per screen setup; a monitor coming back offers "put them back", a lost or reshaped screen offers "bring them to EQ's screen"; Mimic reads EQ's window from Windows; UI Studio moves `/raidbars` and `/assistbar`. **§80a (`f3e444dd`):** each overlay keeps its screen — auto-arrange works per screen, a side-screen overlay goes to another side screen; overlays do not need windowed EQ | the guild lead: pull a monitor's power with overlays on it, then plug it back, and answer both prompts; move the raid bars in UI Studio and relog |
| **3.0: formats, anchoring to game windows, one product (R11–R15)** | **Recorded 2026-09-29 (§80).** Every part in horizontal / vertical / arc / circle / thin / thick / transparent / locked-to-a-window; know EQ's window shapes; charm parts around the pet window; HP over the target window; the dashboard folded into one product | the guild lead: say whether to file the Zeal "ui windows" ask now (R12–R14 depend on it); options for how the dashboard and the builder fit together come next |
| **Timers canvas (option A, FB-33)** | **Beta 2026-09-29 (§79; agent 3.7.42).** One screen-sized click-through window: Callouts, Timers and Charm panels, each dragged and sized alone; ＋ more timer panels that claim groups or timers by name; the trigger window stays the voice. **Every panel now has an always-on ✥** (§87, `v2.7.5-beta.14`). **Look signed off:** the guild lead, 2026-09-29, in game with four panels: *"panels look good"* | the guild lead: move a panel by its ✥ while locked (beta.14+), run a pull; say what the next panel type should be (Charm tracker, Tick, CH chain) and whether it feels heavy on the raid machine |
| **Share a whole Mimic setup (file + direct)** | **Options written 2026-09-29 (§91), not built.** A: file + six-character share code (24 h). B: file + send to a named guildmate. Recommended: A now, B later on the same storage (which is also 3.0's "back up to your account") | the guild lead: pick A or B. Sessions: build on beta (Mimic + agent), bot routes + migration on main |
| **CH chain: drag stutter, overlap ✕, grey out who didn't pick up** | **Queued 2026-09-29 (§77).** Stutters back when dragged after EQ was active; a stale slot's ✕ is hard to hit on overlap; grey the slot-holder another cleric covered | next session: needs a Windows repro for the drag |
| **Trigger TTS "stopped working" (beta.3, a bard)** | **Open 2026-09-29 (§77).** Charm callouts no longer cancel shared speech; root cause unconfirmed | the member: send Mimic feedback with logs attached next time it goes quiet |
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
| **Zeal: Bandolier chat filter** | **Shipped upstream in Zeal 1.4.8 (#238, §117).** The #213 ask (target level/class/race + loc on the pipe) shipped in the same release (#239), from a third party | the guild lead: delete the fork's `bandolier-chat-filter` branch when ready (and `pipe-spawn-id`, obsolete since 1.4.6). Pipe fields: pick when to build the adoption in §117 |
| **Zeal: tags survive crash/relog/character switch + no cross-zone tagging (branch; first build crashed at launch, fixed)** | **2026-09-25 (§28).** Branch `tag-persistence` on the fork (`ca71999`): name check on received tags; per-character `<name>_tags.txt`, restored by zone + spawn id + name, 3 h expiry, `/tag persist` on by default. `0d66a28` crashed EQ at launch (init order; dump symbolized, fixed). **2026-09-26 (§40): players are now kept by name** (`9a3fd09`), so a tagged player keeps the tag through their zoning, a camp or a death; in `test-all` (`7d49ae6` now, on Zeal 1.4.8, §117) | the guild lead: build + run the 8-step test plan, confirm or change the four defaults in the PR doc, re-author, open the PR |
| **Zeal: icon tag shapes, numbered badges, lettered paws, traced wolf, guild banners + icons (branch; rendered in game 2026-09-26, §39)** | **2026-09-25 (§27, §30–§33).** Branch `tag-shapes` on the fork (`3c02f65`): letters `K X A D F T M U N H E $` = skull, X, sword, diamond, flame, star, moon, lasso, lute, shield, euro, dollar; **`^WP^` = the wolf**; `^1^`–`^12^` badges; `^P0^`–`^PZ^` paw with a charmer's initial; **`^B<code>^` banner + `^I<code>^` icon for 30 guilds** (`/tag guilds` lists them). `test-all` = `7d49ae6` (on Zeal 1.4.8, §117; with tag pictures §38 and player tags kept by name §40). **In game 2026-09-26:** every symbol, badge, lettered paw and all 30 guild icons draw correctly, including over other guilds' players | the guild lead: try the banners (`^B<code>^`, not in the screenshots yet), correct any guild codes, re-author, open the PR. Ours after upstream ships: agent `_ZEAL_TAG_SHAPES` + prettyprint regex learn the new keys |
| **Zeal: tag corpses (branch; built, not yet in game)** | **2026-09-25 (§34).** Branch `tag-corpses` on the fork (`aa975e1`, from main): NPC + player corpses taggable; a mob's pre-death tag stays hidden on its corpse, tags set on the corpse show; `/tag target` picks a corpse only by its own tag. In `test-all` (`7d49ae6` now, on Zeal 1.4.8, §117). A target whose model is not drawn is still refused (spawn-id hold proposed, not built) | the guild lead: try the "Corpses" steps in `TRY-IN-GAME.md`; say whether far/unloaded targets need the spawn-id hold; open the PR (`docs/upstream/zeal-tag-corpses/`) |
| **Zeal: guild logos as tag pictures from a folder (branch; built, not yet in game)** | **2026-09-26 (§38).** Branch `tag-icon-files` on the fork (`ac5d177`), in `test-all` (`7d49ae6` now, on Zeal 1.4.8, §117): `uifiles/zeal/tagicons/<name>.png` (or `.tga`) shows as `^I<name>^`, like target rings; a picture beats the built-in icon with the same code; files checked before decoding (PNG/TGA header, ≤512 px, ≤1 MB); `/tag icons` lists and reloads. Draw path not compiled here; logic tested + mutation-checked | the guild lead: rebuild `test-all`, run TRY-IN-GAME → "Pictures" (the UP card first: it catches a mirrored quad); send the reply to the requesting guild; open the PR (`docs/upstream/zeal-tag-icon-files/`) |
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

**A player's consider does not give a level — decided, from the evidence.** ⚠ *Superseded in part by §98
(2026-09-29): "looks like quite a gamble" to a player IS the even con, so it gives your own level. Every
other phrase still gives a player nothing.*
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

## 74. Quest tab: NPC text folded, warnings, give/get, faction; Quarm's own hand-ins (2026-09-29, bot 3.1.170–3.1.171, Mimic beta)
The guild lead: *"we should be collapse the npc text and put a warning on anything that despawns a mob or
spawns something else, or causes negative faction. If there are turn-in requirements or you get an item as
output from a quest we should denote that"*, *"we should also track faction for these quests as well where
it makes sense"*, then *"go out and get the missing script info"*.
- **Folded:** what the NPC says sits behind "▸ says" per row (open rows kept per NPC in JS, so the 500ms
  repaint keeps them).
- **⚠ tags** from the script: the NPC despawns; it despawns another NPC; it spawns a mob (named, "may
  attack" on hover); a faction loss (red, the factions on hover). `utils/questDialog.js` `effects()` reads
  both the Lua mirror and the Perl turn-in snippets; the call forms are the ones the scripts actually use
  (eq.depop() 646 scripts, eq.depop_with_timer() 480, e.other:Faction(e.self, id, n)).
- **Items:** a say branch shows "needs <item>" (a HasItem in its own condition) and "get <item>"; a
  hand-in reads GIVE / GET ("one of" for random, "· exp"). **Faction:** every change a branch or hand-in
  makes, gains green and losses red.
- **The script gap, measured** against a fresh clone of SecretsOTheP/quests (5,806 Lua files): every real
  zone's count matches the mirror; the 87 skipped files are `iceclad2`, `lua_modules`, `global`,
  `cshome2` and two `_tryout` folders, none quest NPCs. 16 files changed upstream since the 2026-09-20
  sync (PoP events, the Timekeeper of Druzzil Ro's new dialogue, the Tribunal) and a manual run of
  `sync-quarm.yml` pulled them in (run 47). ⚠ That step is `continue-on-error`, so a failing quest sync
  still shows green; read its log line ("N new/changed").
- **The real gap was the hand-in table:** `scripted_npc_turnins` is ProjectEQ's (every era), not
  Quarm's. So each `check_turn_in` branch in Quarm's script with no ProjectEQ row is now added as a
  hand-in (bot 3.1.171), and a ProjectEQ row with no branch in Quarm's script says "not in Quarm's
  script" on the tab.
- Tests: quest-dialog, npc-interact, target-info-fqv. Mutation-checked.

## 75. Bard charm: the class comes from Zeal; the recharm callout speaks; clicky buffs on the pet (2026-09-29, agent 3.7.39–3.7.40 beta)
The guild lead, a bard holding Dragen Faux under Solon's Bewitching Bravura: *"why is bard charm tracking not
working?"*, *"a character's class is output by zeal pipes, on top of us knowing their class. we shouldn't
need to rely on anything else"*, *"I SOWed my pet using my sow sword clicky and it did not register, and i
did not get a recharm pet tts at 4 seconds left"*, *"i'm not hearing the recharm pet tts, where is that"*.
- **Class from Zeal:** a pet with no a/an/the only counts as a charm when the owner is a bard or a charm
  was just cast. The bard test read /who and the raid roster only. `_classOf()` now reads Zeal's class
  label (3) first, then /who, then the raid roster; the charm test and the melody overlay's bard checks
  use it (both also read a `zealSt.class` that was never filled in).
- **Recharm:** a charm opened from the gauge had no duration, so the tracker showed "~" and kept its
  callouts quiet. A bard's charm now takes the duration of the charm song in their twist, else Solon's
  Bewitching Bravura. The bard last call now says **"recharm pet" at 4s left** (was "recharm now" at
  3.1s); "charm breaking" at 12s and the user-set "recharm warn at N s" (setup bar, seconds since the
  charm, 0 = off) are unchanged.
- **Clicky:** "Your Blood Orchid Katana begins to glow." logs no "You begin casting", and SoW's landing
  text on another target is shared by five spells, so the pet's SoW stayed "SOW (?)". The glow line now
  records the item's click spell as a self-cast.
- Tests: `bard-charm-zeal-class` (real agent, fake clock), mutation-checked.

## 76. "Save layout" stuck on "no active character yet" (2026-09-29, Mimic beta)
The guild lead: *"Why doesn't this work"*. Two causes, both fixed: Mimic's state poll, the only source of
the active character, dropped any response over 256 KB without a word (a long session's state grows past
that; cap now 16 MB, logged when hit); and a quiet Zeal (zoning, camping) cleared the character without
rebuilding the menu, so another rebuild in that gap froze the item disabled. The last character is kept
now. `test/char-profile-active.test.js`.

## 77. The same evening's beta reports, and the timers question (2026-09-29)
- **Charm tracker REMOVE** (the guild lead: *"It's hard to read the REMOVE"*): the button also carried the
  corner ✕'s class, so it inherited its absolute top-right spot and 35% opacity, under the owner's name.
  Back inline beside BROKE, full strength (beta `6a0931fe`).
- **Trigger TTS "stopped working"** (a bard on beta.3, in Discord): not reproduced. The trigger queue has a
  watchdog, so it cannot wedge for good. What changed that evening: bard charms became tracked, and the
  Charm tracker called `speechSynthesis.cancel()` before every line, which may cut off another Mimic
  window's speech if Chromium's engine is shared. It no longer cancels. The member's agent log records
  trigger playback failures; the next report should come as Mimic feedback with logs.
- **More reports from the same member on beta.1** (feedback table): "charm pet tracker not working"
  (answered by §75), "click one of these and look at the settings it has set for it", "this NEEDS a loop
  timer setting", "does not appear to work as intended when swapping characters" (likely §76). Their
  screenshots sit in the private bucket and need the service key to open.
- **Timers, individually placed** (a member's idea on beta.3: *"What if EVERY timer could be put on the
  screen and resized how you wanted it to be?"*; the guild lead: *"would we be able to accomplish this
  with a single overlay that lets us individually move components? That would be part of my vision for
  3.0's UI/Overlay builder, but this seems like a good starting point"*). Yes — it is the "one freeform
  window" branch of `DESIGN-mimic-3.0-overlay-builder.md` §5.3, and timers are the simplest part to pilot
  it with. Options, costs as build / maintenance / runtime / change:
  - **A. Freeform timers canvas (3.0 pilot):** one transparent click-through window per monitor; the
    three groups in the picture (charm, callouts, debuff timers) are panels placed and sized inside it,
    and any group or single timer can be pulled into its own panel later. Dragging moves an element, not
    an OS window, so the EQ-focus drag fight (the CH chain's) cannot happen. Build 3–4 sessions;
    maintenance medium (per-part hit-testing, per-resolution layouts); runtime one surface, but a
    screen-sized transparent layer over EQ that must be measured on a raid machine first; change low —
    it becomes the 3.0 engine.
  - **B. Split windows now (EQLogParser's shape):** timers leave the trigger overlay for their own
    window, and more timer windows can be made, each trigger assigned to one. Build 1–2 sessions;
    maintenance medium (every window owes the parity checklist); runtime a renderer per window; change
    medium — throwaway once A exists.
  - Recommendation: A, scoped to timers, behind beta.

## 78. Reports get numbers: FB-<n>, closed by commits (2026-09-29, bot 3.1.172, web 1.8.41)
The guild lead: *"We need to start having referenceable IDs for each bug or enhancement request so the bot
can update these when they get implemented"*.
- **The number:** `feedback.ref`, a sequence (migration `20260929020000_feedback_ref`, applied); the 33
  existing reports were numbered in submission order, FB-1 … FB-33. New cards carry it: a Mimic post's
  first line ("🐞 Bug FB-34 from …"), a web or `/feedback` embed's title; the open cards were numbered in
  place once (`_backfillFeedbackRefsOnce`, latched in bot_kv). `/admin/feedback` shows it.
- **Closing by commit:** every 10 minutes the bot reads the public repo's last 40 commits on `beta`,
  then `main` (no token; last sha seen per branch in bot_kv). A line saying fixes / implements / closes /
  resolves and FB-n moves report n: beta → `on_beta` (🧪 On beta, buttons kept), main → `addressed`
  (✅ Implemented, buttons removed). The card is edited, the row gets a dated note, the submitter a DM.
  A mention alone moves nothing; a report never moves backwards, and won't-fix / duplicate stay closed.
  Rule in `CLAUDE.md`; logic in `utils/feedbackRefs.js`, `test/feedback-refs.test.js`.
- **Open reports that earlier work looks to have answered** (for the guild lead to confirm, not closed
  here): FB-9 (the /who fixed size + scroll, 2026-09-26), FB-10 (pasting screenshots into feedback),
  FB-13 (the server tick as its own timer: the Tick overlay), FB-19 (timers can start at the top, agent
  3.7.34), FB-3 / FB-4 (June's PvP kill reports), and tonight FB-27 / FB-25 (bard charm, §75) and FB-32
  (switching characters, §76) pending a beta check.

## 79. The Timers canvas — option A, first slice (2026-09-29, agent 3.7.42, Mimic beta; FB-33)
The guild lead: *"Go with A"* — the freeform timers canvas from §77, as the first piece of the 3.0
overlay builder. A member's report FB-33: *"What if EVERY timer could be put on the screen and resized
how you wanted it to be?"*
- **What shipped (beta):** `apps/mimic/canvas.html`, one transparent window the size of a screen. Three
  starting panels — **Callouts** (the text of what the voice says), **Timers** (every countdown nothing
  else claims) and **Charm** (recharm tick, charm songs and spells). Arranging: drag a panel by its tab,
  size it from ◢, snaps to the screen's edges and centre and to other panels (Shift: off). ⚙ per panel:
  name, text size, stack up or down, and what it shows — groups (charm, trigger countdowns, lulls, my
  spells on mobs, server tick, loot bids) and timers **by name**, with the countdowns on screen now as
  one-click claims. ＋ Timers panel adds more (12 at most). Hidden panels dim while arranging.
- **Routing, the rule that makes it safe:** a name claim beats a group claim beats the catch-all, and
  there is always exactly one catch-all and one Callouts panel (`sanitize()` restores them), so no
  countdown and no callout can end up with nowhere to show.
- **One voice:** the panels ARE `triggers.html` (`?part=timers` / `?part=callouts`), not a copy. A part
  never speaks or plays a sound; a timers part reads no fires and fires no warnings. The trigger window
  keeps running hidden as the voice (#97's rule — hidden, never freed) and, while the canvas is on,
  speaks without flashing or pinning (`canvasOwnsTriggers`), so a pinned callout lives in one place.
- **Out of the way:** click-through always, unlocked included — a panel takes the mouse only through
  the hover handshake, with a drag shield holding it mid-drag. Dragging moves an element, not a
  window, so there is no focus fight with EQ (the CH chain's stutter). Never force-shown by setup or
  unlock (it is an alternative home for the trigger visuals — on means on); never rescued or
  auto-arranged as a rect; re-covers its screen on display changes; ⇆ Next screen moves it.
- **Where it lives:** layout per screen resolution in Mimic's config (`canvasLayouts`, positions as
  fractions of the screen, sizes in px — EQ's ini rule), saved only by the canvas itself and bounded.
  Tray: "Timers canvas" + "↳ Arrange the canvas…"; dashboard Overlays row with ✥ Arrange; hotkey,
  hide-all, per-character layouts, process name. Agent: `GET /api/timers` (the three fields a part
  reads) and a `group` on every timer row.
- **Cost, measured and not:** one renderer for all panels (iframes share it). Each timers part polls
  the slim `/api/timers` at 700 ms instead of the multi-MB `/api/state`. **Not measured:** a
  screen-sized transparent window over EQ on a raid machine — the guild lead's first run is that
  measurement; it is opt-in and off by default.
- **Next slices** (not built): the Charm tracker, Tick and CH chain as panels (the dock's iframe host
  pattern, one host at a time); a per-panel background; the trigger overlay's 🗑 clear-all on the
  Timers panel. The trigger window's own `/api/state` poll could move to `/api/timers` too — a real
  saving for every raider, left alone here under the minimal-diff rule.
- **Also this evening (agent 3.7.41):** the dashboard's 💾 Save layout button now answers — "✓ Saved for
  <char>" in green or "✗ Not saved — no character yet" in red, for 2.5 s (the guild lead: *"this button
  has no feedback"*).

## 80. Zeal's bars in UI Studio, where EQ really is, ask before moving; the 3.0 requirements (2026-09-29, Mimic beta)
The guild lead: *"we need to account for /raidbars and /assistbar in uistudio as well, as parts of zeal.
add B, and if the desktop orientation changes or the monitor setup changes, prompt the user to bring the
overlays back to the screen where EQ is. if I kick the power out of my monitor it moves everything to a
different screen and I have to rearrange it."*
- **UI Studio shows Zeal's raid bars and assist bar** as Zeal windows. They are not EQ windows: Zeal keeps
  them in `zeal.ini` as screen pixels at the game's resolution (read from Zeal's own `raid_bars.h` /
  `assist_target.h`): `[RaidBars]` Left/Top/Right/Bottom (0 = the bars may run to the screen edge),
  `[AssistBar]` Left/Top with a size that follows FontSize. Moving writes Left/Top; sizing the raid bars
  writes their box; the assist bar has no size to set, so it shows at an estimate with no grip. Auto-arrange
  keeps overlays off the bars that are switched on. Zeal reads `zeal.ini` at login, so an edit applies
  after a relog, the same as EQ windows (UI Studio's save-on-logout covers it).
- **B is in** (3.0 plan §4): Mimic asks Windows where each EverQuest window and its client area are
  (PowerShell + user32, DPI-aware), on demand and cached, never polled. It decides the overlay home screen,
  projects the UI layout onto a windowed EQ's real client area, picks the Timers canvas's screen, and runs
  before auto-arrange. A 🧲 Rescue clicked after the last reading still wins ("this screen").
- **Screens changed → remember, then ask.** Mimic no longer snaps overlays to the primary screen when the
  screens change. Every overlay's position is remembered per screen setup (the last six), and moves that
  land while the screens settle — Windows shoving windows off a dead monitor — are not remembered. A few
  seconds after the screens stop changing: a setup it remembers gets **"Put them back where they were?"**
  (the power-kick case, when the monitor comes back); overlays whose screen went away or changed shape
  (rotation, resolution) get **"Bring them to the screen EverQuest is on, each at the same spot?"**;
  anything else gets no question. "Leave them" only rescues an overlay left fully off-screen.
  ⚠ Someone running EQ in exclusive fullscreen at a resolution other than the desktop's changes the screen
  on every launch and alt-tab, and would be asked each time. How many raiders run that way is **not
  measured** (the UI backups that carry `eqclient.ini` are encrypted). ~~Not seen in the guild (overlays
  need a windowed EQ)~~ — corrected in §80a: overlays do not need a windowed EQ.
- **The 3.0 requirements, recorded as R11–R15** in `DESIGN-mimic-3.0-overlay-builder.md` §2:
  - R11 every part in formats — horizontal, vertical, arc, circle, thin, thick, transparent, or locked to
    another window;
  - R12 know the shape of EQ's and Zeal's windows;
  - R13 anchor a part to a game window, e.g. charm parts on or around the pet window;
  - R14 minimal parts over the game's own window, e.g. just the HP numbers over the target window, to cut
    the latency people feel while targeting;
  - R15 one product: *"many parts of our mimic feel disjointed. the overlays are the main thing people
    focus on, and the rest of the dashboard has gone to the wayside, with bits of goodness sprinkled in."*
  R12–R14 need live window rects, which only Zeal has (§4 D), so the Zeal "ui windows" pipe message moves
  from a nice-to-have to the load-bearing ask; it should carry Zeal's own bars too.
- **Not decided here:** how the dashboard and the builder fit together (R15). That is a design question,
  so it goes to the guild lead as options before any build.

### 80a. Overlays keep their screen — with EverQuest, on another screen, or both (2026-09-29, Mimic beta `f3e444dd`)
The guild lead: *"why do overlays need windowed mode? it won't work with full screen? folks might want these
overlays on a second monitor, it's up to us to know if they're on the same or a different monitor. or both."*
- **Correction: overlays do not need windowed EQ.** §80 said so; that was an assumption, and too strong.
  What actually holds (general Windows behaviour, **not measured on our fleet**):
  - on a **second screen**, overlays work whatever mode EverQuest runs in; clicking one moves focus off
    EQ, and an exclusive-fullscreen EQ may minimize when it loses focus;
  - on **EverQuest's own screen**, they show over EQ when it runs windowed or borderless; over
    **exclusive** fullscreen, windows generally do not draw on top (Windows' fullscreen optimizations
    change that on some machines, so it varies).
  The crash runbook already recommends windowed or borderless for display-reset crashes, for a different
  reason.
- **It is on Mimic to know each overlay's side.** Built (beta):
  - **Auto-arrange works screen by screen.** An overlay on a side screen is arranged on that screen; only
    EverQuest's screen carries EQ's own windows and the keep-the-middle-clear rule. Before, everything was
    packed onto one screen, and with tonight's live EQ reading that screen had become EQ's, pulling
    second-screen overlays onto the game.
  - **The screen-change question keeps sides.** Each remembered setup also records where EverQuest was;
    an overlay that sat with EverQuest follows it, one that sat on another screen goes to another screen
    that is not EverQuest's, and lands with EverQuest only when no other screen is left. The prompt names
    which is which.
- **Not built, proposed:** knowing EverQuest's display mode. The client's `eqclient.ini` should say
  whether it runs windowed; the exact key on Quarm needs a local session to confirm before Mimic reads it.
  With it, Mimic could warn when an overlay sits on EverQuest's screen while EQ runs exclusive fullscreen,
  and skip the screen-change question that EQ's own resolution switch causes.

### 81. A Mimic 3.0 alpha channel (2026-09-29, Mimic beta `1cd1d423`, bot 3.1.173, web 1.8.45)
The guild lead: *"can we make an alpha channel for 3.0 testing as well? I'm sure we're going to do more beta
releases before that, but I think I should test out the overlay builder soon after this new round of beta
elements."*
- **The branch.** `alpha` = `beta` + the 3.0 overlay-builder work. `sync-alpha.yml` merges beta and main
  into it on every push to either (the sync-beta rule one step down); alpha keeps its park,
  `apps/mimic/package.json` at 3.0.0. CI (`test.yml`, `golden-log.yml`) runs on it.
- **Agent changes land on beta, not alpha.** So the alpha's agent is always beta's, and an alpha Mimic can
  keep hot-swapping along the beta agent line (`?channel=beta`) with no bot change. Builder work that
  needs the agent: agent part to beta first, Mimic part to alpha.
- **The release.** Each push to alpha builds `3.0.0-alpha.<run number>` and REPLACES the files of one
  rolling GitHub release, tag `mimic-alpha` (prerelease). Alpha installs read its `alpha.yml` from that
  fixed download address (a generic feed, `_ALPHA_FEED`), never through GitHub's release feed.
  **Why not a normal `-alpha.N` tag per build:** the feed lists only the newest 10 releases, and
  electron-updater's alpha channel takes the newest non-custom entry — beta included — so a beta pushed
  after an alpha would hide it (checked in electron-updater 6.8.9's `GitHubProvider`), and a day of beta
  pushes would scroll it out of the feed entirely (the 2026-07-30 Linux lesson). One release, replaced
  in place, also never takes more than one slot in the feed.
- **Who gets it.** Opt in from the tray ("Receive alpha updates (Mimic 3.0 builder)") or the dashboard's
  α alpha button — one function, `setAlphaChannel`, confirm first. An alpha build stays on alpha until
  the raider leaves; leaving goes back to beta and is allowed to step down from 3.0.0. Revert-to-stable
  clears the alpha opt-in. The header says ALPHA (purple) on an alpha build.
- **Nothing else may mistake it for the beta.** The #mimic-releases beta card, the bot's beta download
  link (`utils/mimicReleases.js`), `/mimic/beta` and `/admin/agents` all took "the newest prerelease";
  each now takes only a `-beta.N` tag. Any new consumer of releases owes the same filter.
- **Not announced.** The rolling release never reaches #mimic-releases. Alpha testers are told directly.
- ⚠ **electron-builder writes only `latest.yml` under the github publish provider**, whatever the version
  says — the beta releases carry only `latest.yml` too, and beta installs quietly fall back to it. The
  alpha's fixed-address reader has no fallback, so the first alpha (`v3.0.0-alpha.832`) shipped with
  nothing an alpha install could read. The alpha build now copies `latest.yml` to `alpha.yml` and
  publishes that; the second alpha is the first one an install can actually take.
- `test/mimic-alpha-channel.test.js`, `test/alpha-release-isolation.test.js`; CLAUDE.md channel table.

### 82. 🧲 Rescue brings back only what is lost (2026-09-29, Mimic beta `1cd1d423`)
The guild lead: *"not only does the rescue capture all of the overlays but it puts them all into one spot
which is dreadfully annoying."*
- **Cause.** Rescue parked every overlay whose middle was off the cursor's screen at the same corner,
  24 px apart, then ran auto-arrange over the whole set — so overlays kept on a second screen were
  captured, anything auto-arrange could not place stayed in the pile, and everything already placed got
  re-arranged.
- **Now.** Only a LOST overlay moves: its middle, or its top-left corner (where ✥ sits), is on no screen.
  It goes back to where it last sat on this screen setup, else to the first free spot beside the
  overlays already there and EverQuest's windows. Nothing else moves and nothing is re-arranged.
- **Overlays on another screen** stay unless the raider says so: *"Bring them to this screen too, each at
  the same spot?"*, default "Leave them there" (§80a's rule: keep each overlay's side). With nothing
  lost and nothing elsewhere, Rescue says so instead of doing nothing silently.
- `test/rescue-overlays.test.js` runs the real rescue over two fake screens.

### 83. 3.0: edit in place, overlay sets, sharing, local-first storage, six display types (2026-09-29)
The guild lead: *"when we do get this new format working we should be able to edit displays in place, and
lock/unlock windows will be crucial for whether we drag and resize during gameplay. we also need to build in
multiple overlay modes per character, switchable via hotkeys or a simple pipe output that we pick up /pipe
mimic load <overlay set name> or /pipe mimic save <overlay set name> the same load/save should also be
available from taskbar or cycle through via command. overlay designs can be saved and shared, even
suggested … we need our overlays arrangements to be stored locally in case of server issues, but backups
will need to be saved to our database for portability."*
- Recorded as **R16–R21** in `DESIGN-mimic-3.0-overlay-builder.md` §2, with how each lands on what
  exists (the `/pipe` channel is already live — Zeal type 4; sets replace `cfg.charProfiles` and
  `cfg.canvasLayouts`; UI Studio's `ui_layout` backup is the precedent for the database copy).
- **Six display types rendered** on the claude.ai canvas "Mimic 3.0 display types" (the guild lead's
  artifact list): Bar, Ring, Readout, Pips, Timeline, Chips, each applied to target HP, the charm
  timer and the debuff list side by side, with a board per type and an edit-in-place board (locked vs
  unlocked, the set switcher, the `/pipe mimic` verbs). **Not picked yet** — the guild lead's call.
- **Not built.** These land on the `alpha` branch (§81) when the builder does. Proposed order: sets +
  `/pipe mimic` verbs + local file first (useful on today's overlays), then the database backup, then
  sharing, then the display types on the canvas panels.

### 83a. The build order is taken (2026-09-29)
The guild lead: *"do your ordering for the new types and the two latest entries."* So the proposed
order stands, and the display types go in pairs by what they reuse:
1. **Overlay sets** — local file, `/pipe mimic load|save|next|lock`, tray load/save/cycle, the same on
   the dashboard (tray ↔ dashboard parity). Useful on today's overlays before any builder exists.
2. **Database backup** of the sets, then **sharing / suggesting** a set.
3. **Display types: Bar, Readout, Chips first** (what today's overlays already draw, so the builder
   proves itself on known shapes), **then Ring and Pips, Timeline last** (it needs a time axis every
   data element would have to supply).
Builder work goes to `alpha`; anything the agent needs goes to `beta` first (§81).

**Step 1 shipped the same day — alpha `e9e4f3d6`.** Overlay sets: which overlays are on, where each one
sits, how see-through and how big, and the Timers canvas panels, saved under a name in
`overlay-sets.json` beside Mimic's config (no network). Switched by `/pipe mimic load <set>`,
`save [set]` (no name = over the set you are on), `next`, `prev`, `lock` / `lock on|off` / `unlock`;
the tray's 🗂 Overlay sets; and Settings → Overlay sets (tray ↔ dashboard parity, through one command).
Choices made in the build, each the guild lead's to overturn:
- **A set is loaded only when asked.** A character switch does not load one: with two clients open
  the active character flips on every alt-tab, and the screen must not rearrange itself under you.
  The old per-character layouts keep working beside sets until sets replace them.
- **`next` cycles the sets that character has used**; a character with fewer than two cycles every set.
- **No delete from the game** — a hotbar typo must not lose a set; Settings deletes.
- **The hotkey is EverQuest's own**: a social with `/pipe mimic next`. No new Windows-wide key.
- **Feedback shows on the trigger overlay** ("Overlay set: raid"), because a Windows notification does
  not show over full-screen EverQuest.
- A set saved on another screen setup lands like a screen change (§80a): each overlay keeps its side.

### 84. Suggested triggers per character; pets on the meter (2026-09-29, agent 3.7.44 beta `f857fa6f`, bot 3.1.174)
Two member reports the same morning.
- **FB-34** — *"Can these be made to per character triggers and not across the board?"* (the Suggested
  triggers panel). A personal trigger may now carry a list of characters; no list means every character,
  as before. A line fires it only from the log of a character on that list (after a character swap on
  one client, Zeal's live character wins); Zeal gauge triggers scope the same way; the timer-bar
  switches, which have no line of their own, count as on while one of their characters is being
  played. The panel has a **For:** picker (Every character, or each character this machine has logs
  for). Unticking one character keeps the trigger on for the others, even from an every-character row.
  Guild triggers are untouched — they already have class targeting and are the officers' call.
- **FB-35** — *"This doesn't show pets? maybe its only if they dont use /pet leader, not sure."* Right:
  a summoned pet names its owner only in "My leader is <Owner>." The pet in the report never said it
  on the reporter's screen, its owner does not run Mimic, and the fight's uploads credited the pet as a
  raider. Two layers:
  - The bot already pooled every declaration any raider's agent uploaded (`addPetOwners`). The poll
    now serves that pool as a `pet_owners` stream (bot 3.1.174; latest declaration wins, 12 h max,
    one-word pet names only, sheddable with `flag_shed_pet_owners`). The agent asks every minute while
    fights run, five idle, and a live fight adopts the owner the first time the pet swings — so one
    `/pet leader` seen by anyone names that pet on every Mimic for the night. Old-log replays do not
    borrow tonight's owners.
  - A pet nobody named, whose name came out of the server's pet-name generator (EQMacEmu
    `GetRandPetName`: G/J/K/L/V/X/Z + two optional middles + ab/er/n/tik) and that /who and the raid
    window never showed, is sent as a pet: the DPS HUD labels it **(pet)** and leaves it out of the
    parse copied to /rs.
  - ⚠ **Not changed: the bot's parse cards.** An unowned pet still reaches the Discord parse as a
    player when no upload carried its owner. The pool fixes it whenever anyone saw the leader line;
    folding generator-named pets on the bot side is a separate call (it would touch every parse card).
- Tests: `per-character-triggers-and-pet-owners` (beta; the agent runs for real, every rule
  mutation-checked) and `pet-owners-stream` (main).

### 85. DPS HUD +pet: the pet's share on the bar; click for name, damage, spawn id (2026-09-29, agent 3.7.45 beta `672ff15e`, bot 3.1.175)
The guild lead: *"show the +pet on the DPS hud, then the color of the +pet and the section of the bar that
is highlighted should match to distinguish how much was the player vs the pet, and if you click on +pet it
should open a line below to show the pets name and damage and spawnid. we should be able to get this when
someone does pet leader and has zeal tags on"*
- **Built as asked, one design.** The request named the design, so there were no variants to offer.
  The one open choice was the colour: the pet's end of the row bar and the "+pet" label are the
  dashboard's pet orange `#f0883e`. The owner's part keeps its row colour: blue, red on the Tank tab,
  gold on your row. If orange next to your gold reads too close in the 2 px bar, purple `#a371f7` is
  the alternative.
- **Click +pet** → a line per pet under the owner: name, damage, its share of the owner's number, and
  the spawn id, or "spawn id unknown" with a tooltip. The locked HUD takes the mouse only over a +pet,
  so the rest of the scoreboard stays click-through to EverQuest.
- **Where the spawn id comes from — provable only, best first** (`_petSpawnIdFor`):
  1. this machine runs the owner, and Zeal's pet gauge names that pet → Zeal's `pet_id` (1.4.6+);
  2. a fresh Zeal `/tag` on the pet (the tag line carries the id);
  3. one of this machine's characters has it targeted;
  4. the owner's own Mimic uploaded (1) with the pet's damage, and the bot pooled it beside the
     "My leader is" owner (bot 3.1.175: `addPetSpawnIds`, served as `ids` on the `pet_owners` poll,
     one hour max, since an id lasts one zone and one summon).
  So "when someone does pet leader and has Zeal" works through (1) and (4): the owner's Mimic knows the
  id, and the declaration names the owner for everyone else. Otherwise the line says unknown; it never
  guesses.
- Tests: `dps-hud-pet-breakdown` (beta) and `pet-owners-stream` (main), each rule mutation-checked.

### 86. PoP checklist: Justice and the Bastion of Thunder corrected; the page rebuilt on beta; auto-fill (2026-09-29, web 1.8.48, bot 3.1.176)
The guild lead, top priority, after officers asked in chat "is this all we have to do for justice?", "who to
turn the mark into?" and "are the medallions the giant heads?": *"the pop guide page needs some love. more
detail, maps, who to turn things into, expectations and who you will go back to. a sidebar nav with
sections. automatic fill in when someone is running mimic … and note when it's been filled in by database
or mimic in a line item. need this reviewed as top priority"* — with EQProgression's Talisman of Thunderous
Foyer page.
- **Reviewed against the server, not memory.** The quest scripts in `eqemu_quest_scripts` were the
  authority, read alongside EQProgression's Talisman, flagging and Symbol of Torden pages. The scripts are
  #Mavuin, The_Tribunal, pojustice/player.lua, Askr_the_Lost (postorms and bothunder), postorms/player.lua,
  bothunder/player.lua and Karana. Every place was checked in `eqemu_spawn2` or `eqemu_doors`.
- **Justice (live now):**
  - A trial's boss drops **six** of its Mark, one each.
  - The Tribunal **checks** your Mark and never takes it.
  - The second "Tribunal" location (Y 1225 X 75) is inside the Seventh Hammer's room, so it was wrong and
    is gone.
  - The last Mavuin hail is the Justice flag, and the Storms shrine checks it.
  - New optional step: **the Seventh Hammer**. Say "knowledge" to a Tribunal while holding all six Marks to
    get The Mark of Justice. The member in chat was right that it takes all six.
- **Storms / Bastion of Thunder (live now):**
  - Askr is **three hand-ins**: one Storm Giant Head, then a sealed bag of beard + bone + sash, then a meld
    of two medallions from different camps. The phrases are "it was me", "paying attention", "continue"
    ×2 and "bastion of thunder".
  - The **Talisman of Thunderous Foyer is a flag**, granted by clicking the shrine at Y -163 X -362. It is
    not a keyring item; EQProgression's flagging page says keyring, but its own Talisman page and the
    script both say flag.
  - The shrine needs **Askr's flag AND the Justice flag**.
  - The **Symbol of Torden is required**, one per raid, with a 5-minute window. The old guide wrongly said
    optional.
  - New step: the tower walk (Evynd → Askr "transport" → Emmerik → Askr "what storm" → the vortex).
  - Karana answers only the raid with kill credit, and "send me" is Gate.
  - `test/pop-guide.test.js` pins each correction.
- **Auto-fill fix, bot 3.1.176.** The flag map was keyed on short boss names, but the server names seven
  flag bosses differently: The Keeper of Sorrows, Lord Mithaniel Marr, Coirnav the Avatar of Water,
  Fennin Ro the Tyrant of Fire, #Xegony_the_Queen_of_Air, A Mystical Arbitor of Earth and A Rathe
  Councilman. Those flags would never have ticked. The map now carries those names, and `_popBossKey`
  reads the catalog and log spellings alike (`test/pop-flags-boss-map.test.js`).
- **Maps:** `zone_outline(zone)` is a read-only SQL function, migration `20260929123000`. It draws a zone
  from the server's own spawn points, doors, ground spawns and objects, snapped to a grid, plus the doors
  that lead elsewhere. No map files are borrowed. About 5 KB per zone; the page caches it for a day.
- ⚠ **Found, not fixed (the guild lead's call):**
  - `pop_flags` holds **9,846 `unmapped` rows**, all hails the agent witnessed during log backfill, not
    flag grants. The bot drops their `source` and `npc` and stores each as a grant for the person who
    hailed. The guide ignores `unmapped`, so nothing shows wrong today.
  - Two options: (a) stop writing hails as grants and delete those rows, or (b) store `source` and `npc`
    so they become useful evidence. Deleting is irreversible, so it waits for a yes.
  - `PRIVACY.md` also says we keep the hail's NPC text and witness, which we don't.

**The page itself: two layouts on beta, `d0e69d49`.** Read them at `b.wolfpack.quest/pop/guide?v=b` and `?v=c`.
With no `?v=`, the page is production as it stands.
- **Shared:** a sidebar with the character, must-have progress and "N filled in for you". It lists every
  section with its count and follows the section on screen; on a phone it becomes a row of chips that
  scrolls sideways. It also holds the filters and a key for the two sources.
- **Each row says how it got its tick:** "✓ filled by Mimic · date", "✓ from our records · date", or
  "✓ ticked by you".
- **A step's detail:** what to expect, what to say, who takes what (give → get), who you go back to, where
  to go, the quest chain, and a map of each zone involved.
- **B, "Guide":** the detail opens in place under its step.
- **C, "Route":** a compact list, with one sticky panel beside it that shows the step you pick. On a phone
  the panel opens in place instead.
- **Cost, the four numbers:**

  | | Build | Maintenance | Runtime | Change |
  |---|---|---|---|---|
  | B | low | low | lightest: a map draws only when its step is opened | easy |
  | C | a little more (selection state and a second column) | low | same | harder: a two-pane layout is harder to rework |

  Both read the same data.
- **What fills itself in** (`web/lib/popGuideAuto.ts`):
  - *Mimic:* a mapped flag after a boss kill, a looted Justice Mark, and Mimic reporting the character.
  - *Our records:* level on /who, the spellbook upload, and holding a step's item or reward in the last
    inventory upload. Never for a character that hides its inventory.
  - About 19 steps can fill themselves today.
- **Next captures, not built yet — each one is a `PRIVACY.md` change first:**
  - the NPC reply lines of the guide's own NPCs (matched on the machine; only the step key uploads);
  - keyring lines;
  - zone entries (Storms shrine → Bastion of Thunder, Valor → Halls of Honor);
  - the `#popflags` output.
- **Smoke-rendered before pushing,** both layouts plus one opened step, at desktop and phone width, with
  the site's own compiled CSS. That caught two layout bugs (long section names overflowing the sidebar,
  and the row sizing to its content on phones), both now fixed.
- Graduating needs the guild lead's pick. When one is picked, promote it and delete the other in the same
  change.

### 87. Timers canvas: a ✥ on every panel, all the time (2026-09-29, Mimic beta `1a292133`)
The guild lead, looking at the canvas in game: *"these windows look good, they do not have a move button
on them which should be there at all times"*. Until now a panel moved only inside Arrange.
- **Every panel carries a small ✥** just outside its top-left corner, tucked inside when the panel sits at
  the screen's left edge. Drag it to move the panel; right-click it for the panel's settings. While
  arranging it hides, and the panel's tab carries ✥ as before.
- **The canvas stays click-through.** Locked, the ✥ is the only part of a panel that takes the mouse: it
  arms the hover handshake, the drag shield holds the drag, and a panel's body still passes clicks to EQ.
  So the §79 rule ("click-through always, unlocked included") holds; the ✥ is one more control on the
  handshake, like the ✕ on every other overlay.
- A settings menu opened from ✥ while locked closes when the cursor leaves it, because a click outside
  would land in EQ and never reach the canvas.
- Resize stays in Arrange (the ◢ grip). Sizing mid-play was not asked for, and a second always-on handle
  is one more thing on screen during a fight.
- `test/timers-canvas.test.js` pins the ✥, its any-time drag and that the panel body takes the mouse only
  while arranging; the guard was mutation-checked. Rendered headless, locked and arranging, before pushing.

### 88. "Mimic just closed" during a crash review was an update installing itself (2026-09-29, Mimic beta `7c82aa0a`)
The guild lead, live with a member: *"mimic just closed as we were reviewing his crash reporting"*.
- **Not a crash.** The member's agent reported Mimic 2.7.2 at 12:35 UTC; the next screenshot showed 2.7.4.
  Stable 2.7.4 had been downloaded and was waiting. EverQuest was not running: it had just failed to start
  with its own "Failed to load the graphics DLL!" box. Since 2026-08-04, Mimic installs a waiting update
  15 seconds after it sees EQ closed, and the new build starts hidden in the tray. So the window vanished
  mid-review, and the new build sat hidden in the tray.
- **The trap is who it hits:** people with Mimic open while EQ is shut are the people troubleshooting EQ.
- **Fix (beta):** the install waits while the Mimic window is up and not minimized. The dashboard's update
  banner still offers "restart now", and the first poll after the window is hidden or minimized installs
  it. Stable users get this at the next stable cut. Until then, if it happens, Mimic is in the tray.
- **The graphics DLL box is EverQuest's, not Mimic's.** Not diagnosed. It is what 32-bit EQ says when its
  graphics layer cannot load, and the crash review had just suggested copying dgVoodoo2's `d3d8.dll` +
  `ddraw.dll` from its `MS\x86` folder. A copy from the x64 folder would produce exactly this box. That is
  the first thing to ask, not a finding.
- Also seen: `AcLayers.dll` on the stack of the member's last EQ crash. That is the Windows compatibility
  layer, so a compatibility-mode setting (or one Windows applied itself) is on for `eqgame.exe`. It is worth
  checking against the XP-compat field issue in CLAUDE.md.
- `test/update-on-eq-close.test.js` has three new cases, and both guards were mutation-checked.

**Follow-up, same hour — EQ still would not start.** Compatibility mode was off, running as administrator
did not help, and removing the two dgVoodoo files did not help either. Evidence from the file fingerprints
his crash report carried (`crash_reports.system.files`, hashed at upload, 12:35 UTC):
- **His `eqgame.dll` is not Quarm's.** It is 241,664 bytes and was written 2026-09-29 01:43 UTC, three hours
  after his last in-game crash. The one other player whose report carries it has 318,464 bytes, dated
  2026-07-07, which matches "eqgame.dll version: 7 (Jul 7 2026)" from `/zeal version`. Mimic and the agent
  never write this file (checked). So the file changed after the last time EQ ran, and EQ has not started
  since. That is the lead. It is not proven: Quarm's own repository is not reachable from a cloud session,
  so a Quarm release that night cannot be ruled out here.
- `eqgfx_dx8.dll`, `dpvs.dll`, `eqw.dll` and `dgvoodoo.conf` are byte-identical to the other players'.
- A normal Quarm install ships dgVoodoo's `D3D8.dll`. Removing it falls back to Windows' own, so it does
  not explain the error, but it should go back.
- **Drivers:** Windows installed a batch of Intel drivers on 9/27. His display driver was 31.0.101.2127 on
  9/17 and 31.0.101.2145 in the 9/28 crash, and that crash shows the graphics driver resetting. That fits
  the in-game crashes, not the refusal to start.
- **What to ask, in order:** put Quarm's `eqgame.dll` (and `D3D8.dll`) back from a working install or the
  official client download, keeping the current one as `.bak`, and ask what was run around 9:40 PM ET on
  9/28. If the crashes continue once it starts, roll the Intel display driver back to 31.0.101.2127.
- **Worth building (not built):** the crash review could compare a player's fingerprints with the rest of
  the fleet and say "your eqgame.dll differs from everyone else's". The data to do that is already
  uploaded.

**Then the driver was blamed, and the driver fix did not work.** From Intel's own driver assistant, install
history: *"Intel 7th–10th Gen Processor Graphics — Windows"*, driver **31.0.101.2145**, released 2026-09-22,
installed **2026-09-27 9:24 AM**; before it, 31.0.101.2141 (2026-04-06). The guild lead: *"THE TOP ONE BROKE
HIS SYSTEM"*. I switched the lead to the driver on that call. Installing 2141 then did not work.

**Resolved: `eqgame.dll`.** The guild lead: *"He replaced the eqgame.dll FROM THE ORIGINAL takp and that got
him working"*. So the first lead was right, and switching off it was the mistake.
- **The likely sequence:** driver 2145 went in on 9/27. An in-game crash with driver resets followed on
  9/28 at 6:39 PM ET. At 9:43 PM ET a different `eqgame.dll` landed in the folder, most likely swapped in
  to chase that crash. From then on, EQ would not start.
- **Where the swapped file came from is still unknown.** If a guide or a Discord post is handing it out,
  others will hit this.
- **The lesson,** now in the runbook: "Failed to load the graphics DLL!" is a file-in-the-folder problem
  first. The fingerprint comparison that found it took one query. The runbook's §3c is now this cause, and
  the driver moved to §3d as a suspect for the in-game crash only.
- **The rest of the guild's drivers:** crash reports carry the GPU driver only for players who share them.
  One other player on Intel graphics has ever sent one (UHD 630, driver 2140, in August).
- **The build idea above earns its place:** the crash review comparing a player's game files with everyone
  else's would have said "your eqgame.dll is not the one the guild has" on the first look. The data is
  already uploaded. It is the guild lead's call (it is UI, so options on beta first).
- **Closed:** after the swap, `/zeal version` on the member's client read `eqgame.dll version: 7 (Jul 7
  2026 09:14:03)`, which is Quarm's current build. It matches the guild lead's working copy (318,464 bytes,
  md5 `d45c9b22…`; full fingerprint in the runbook §3c).

### 89. Rescue never relocates an overlay you can see (2026-09-29, Mimic beta `a12d157c`)
The guild lead, on beta.15, which already had §82: *"make it so that rescue to screen only brings the
overlays that were missing from the screen, not the ones that are already arranged"*.
- **Why §82 still moved arranged ones.** Lost was "middle OR top-left corner on no screen", and the corner
  half assumed every ✥ sits top-left. An overlay whose see-through edge hangs past a screen edge counted
  as lost and was relocated. The clearest case is the HUD ring: its corners are transparent, and in the
  ring layout its ✥ sits under the ring.
- **Now:** lost means you cannot see it, i.e. its middle is on no screen or under half of it is on a screen.
  Only those are brought back (remembered spot, else a free one), as before.
- **A visible overlay whose ✥ is past the edge** is nudged just far enough that its top-left corner is on
  its own screen, and the "No overlay was lost" note names it. For the HUD, either the top-left or the
  spot under the ring counts as grabbable, so an arranged ring is left alone.
- `test/rescue-overlays.test.js`: the old "top-left off the top is lost" case is now "moves only as far as
  its ✥ needs". New cases cover under half showing (lost) and the HUD ring against the corner (untouched).
  Each rule was mutation-checked.

### 90. Right-click 🖥 Move to another screen; Rescue always lands what it brings (2026-09-29, Mimic beta `f494f41c`)
The guild lead: *"rescue did not bring the extended target to the current monitor. perhaps we add it to the
right click menu"*.
- **Why Rescue left it:** when this screen had no free spot for an overlay, the placement skipped it, so it
  stayed where it was. "Bring them here" then did nothing for it, and a lost overlay stayed lost. Now a
  brought overlay lands at the same spot on this screen, and a lost one at its remembered spot (else a
  cascade near the top-left), overlapping if it must. (If Extended Target was sitting whole on the other
  screen and the answer was "Leave them there", that was the old design working as meant; the new menu
  row is the direct way.)
- **The menu row:** every overlay's right-click menu gets one row per other screen, "🖥 Move to the screen
  on the left / right / above / below". EverQuest's screen is marked when Mimic has read where EQ is, and
  the size is added when two screens sit on the same side. The overlay goes to the same spot on that
  screen, kept whole, and the spot is saved (`_persistBounds`; `setBounds` alone does not save).
  There is no row with one screen, and none on the Timers canvas, which follows its own screen.
- Tests: `test/move-to-screen.test.js` (new; the real handler over fake screens) and two new
  `rescue-overlays` cases. Mutation-checked.

### 91. Copying a whole Mimic setup to another person's install — options, not built (2026-09-29)
The guild lead, relaying a member setting up a second install in their household: *"wants to be able to
copy overlays and triggers and everything. we should support this, Direct sharing should be an option as
well"*. Nothing does this today: Mimic has no settings export, and trigger import reads GINA/EQLP only.
An inventory (file:line in the session that wrote this) says a setup lives in three places:
- **Mimic's `mimic.config.json`** (Windows: `%APPDATA%\wolfpack-mimic\`). It holds overlay positions (absolute
  pixels per screen setup), looks, hotkeys and the canvas layout (fractions). ⚠ **It also holds the sign-in
  and identity**, so copying the file makes the other install upload as the first person. Never tell
  anyone to copy it.
- **Mimic's own `localStorage`:** the HUD builder per character (`wpHudParts:<char>`), plus the DPS HUD,
  Melody, Buff queue, /who, Extended Target and CH chain options.
- **The agent's `agent\personal_triggers.json`:** personal and suggested triggers. Rows can be scoped to
  character names.
**Never in a shared setup:** the sign-in, tokens and Discord identity, EQ and log paths, crash-report consent,
the updater channel, the OpenDKP login, bids, the excluded-characters list, auto-start, and anything tied to
what is installed in the EQ folder. On import:
- per-character parts are re-pointed at the recipient's characters;
- positions are placed on the recipient's EQ screen as fractions;
- triggers that post to Discord arrive switched off, and sounds that point at a file on the sender's PC
  are dropped.

**Options (direct sharing; a file export/import underlies both):**

| | What it is | Build | Maintenance | Runtime | Change |
|---|---|---|---|---|---|
| **A. File + share code** | Export → a file, or "Get a code" (six characters, 24 h). The other person: Import → file or code → preview with ticks → pick which of their characters get the per-character parts | M (the collector and the preview are most of it; one table and two bot routes) | M: every new setting must be marked shareable or private. A test fails on unmarked keys | one row per share, ~50 KB, deleted at expiry | low |
| **B. File + send to a guildmate** | Pick a member; it arrives in their Mimic as "<name> sent you their setup — Preview / Import / Dismiss", via the existing notices | L: A's storage plus a picker, delivery, accept or decline, and limits against spam | M+: who-can-send rules | low | M |

- **Recommendation:** A now; B later on the same storage if people ask. For a household, both people are
  in the room, so a code is as quick as a push.
- The same table is also the 3.0 "back up your setup to your account" (§83 step 2): owner-only rows that
  never expire.
- **Today, on stable, by hand:** copy `personal_triggers.json` between the two installs with Mimic closed,
  then re-pick "For:" characters in Suggested triggers. Overlays: place by hand or use ✨ Auto-arrange.
- Waiting on the guild lead's pick. Then build on beta: Mimic and agent on `beta`; bot routes and the
  migration on `main`.

### 92. Timers canvas: 🧪 test rows per panel; the settings view stays on screen (2026-09-29, Mimic beta `7ebe2989`)
The guild lead, on a panel's settings opened from ✥: *"This view could go off the screen. give me a button to
show test data there of each type that's selected there"*.
- **🧪 Show test rows** (every timers panel's settings): that one panel shows a sample of every kind of
  countdown that would land in it: one per group it claims, and one per timer it claims by name. It lasts
  30 seconds or until pressed again, works locked or while arranging, and nothing is saved.
  - The catch-all panel shows samples of whatever no other panel claims. The samples are routed exactly
    like real countdowns.
  - A callouts panel gets **🧪 Show a test callout** instead: one sample, shown and never spoken.
- **The samples now cover all six groups.** "My spells on mobs" and "Loot bids" had none, so a panel
  claiming only those looked empty while arranging too.
- **The settings view is placed whole on the screen:** under the ✥ or panel it came from, else above it,
  else as low as it can sit. It is never taller than the screen (it scrolls inside). It is placed again
  when the "on screen now" list fills in, which used to grow it past the bottom edge. Opened from ✥, it
  anchors to the ✥.
- Tests in `test/timers-canvas.test.js`, mutation-checked:
  - the samples cover every canvas group and the claimed names (run for real);
  - `placeMenu` is run for real in three positions.
  Rendered headless near the top and bottom of a screen.

### 93. Mimic setup walkthrough: two layouts on beta (2026-09-29, Mimic beta `a9f2db26` + `bbfe59e6`, agent 3.7.46)
The guild lead, reviewing another companion app's onboarding: *"i like the clickthrough. Build out a version
of this for mimic instead of the single setup view. It shouldn't look the same, and should show some of the
optional setup pieces that we have for /me and the abilities that entails"*.
- **`apps/mimic/welcome.html`, one step registry, two layouts.** They differ in shape, never in what they do:
  - **A (`?v=a`), the trail.** A rail of every step, one step at a time, Back / Skip / Next. The three
    needed steps hold Next until done.
  - **B (`?v=b`), essentials then unlocks.** Account, EverQuest folder and characters as a three-part
    stepper. Under it, Zeal, Set up EverQuest, Overlays, Your /me page and Old fights and chat are cards,
    opened one at a time in any order. "Open the dashboard" is always in reach once the gate passes.
- **The gate is the classic page's:** signed in or local-only, a folder saved, the engine up.
- **What it adds over the classic page:**
  - every optional step leads with a "What this turns on" box;
  - a main pick (`cfg.mainCharacter`) whose own log files are read at the finish when "read my main's
    whole log" is left ticked. Not a character set not to send; not a file already being read;
  - Zeal's install state with check and install;
  - Defender exclusions and the clock with their current state and the measured drift. These are the
    dashboard's three fixers, the same calls;
  - the /me abilities: tells, inventory, UI backups, parses, PoP flags, corpse DMs, UI Studio, crash reports.
- **Reached from:** the tray (✨ Setup walkthrough → A / B), the dashboard Setup card (✨ Walkthrough A / B),
  and a link on the classic page. **`loading.html` stays the first-run page until the pick.** Then:
  - `loading.html` sends a first run to the picked layout. Keep it for the engine-failed diagnostics;
  - the other layout is deleted in the same change;
  - web `/start`'s Mimic steps follow the same order.
- **Cost, four numbers each.** Both are one file, so the costs are nearly the same; the difference is who
  they suit.

  | | Build | Maintenance | Runtime | Change |
  |---|---|---|---|---|
  | A trail | S (done) | low: a step is one registry entry | nil | low |
  | B essentials + unlocks | S (done) | low: same registry | nil | low |

  A suits a first install: nothing to choose. B suits reopening it later to do one thing.
- **Found while building (the classic page):**
  - **Unticking "Transmit" only takes effect at the engine's next start** (`excludedCharacters` reaches the
    agent as an env var at launch). Until then that character's log still uploads. The walkthrough restarts
    the engine 2.5 s after the last change (`bbfe59e6`). The classic page is left as it is, since the pick
    retires it. If the pick waits long, give the classic page the same restart; it is one line.
  - **The tells radio (`cfg.tellsMode`) is stored and shown in the tray, but nothing reads it.** The agent
    never receives it; tells are governed on `/me/tells`. The walkthrough leaves it out.
  - **Nothing after setup edits the don't-send list.** The walkthrough can now be reopened for it; a
    Settings entry is still worth adding.
  - **Old logs, two paths.** The classic page saves `cfg.importedLogPaths` and restarts the engine. The
    dashboard hands paths to the agent's importer (`/api/optin` `import`). The walkthrough uses the
    importer: no restart, and the same list the Logsync tab shows.
  - **The Discord `/onboarding` Mimic card is stale** (`utils/onboarding.js`). It says "Mimic v1.0.0" and
    tells people to paste a `/token` into Settings, where Discord sign-in replaced that. This is bot copy,
    left for a bot change.
- **Tests:** `test/setup-walkthrough.test.js`, mutation-checked. It covers:
  - `gateOk`, `mainBackfillPaths` and the restart debounce, run for real;
  - every bridge call the page makes exists on `window.mimic`;
  - the `welcome-optin` relay over a fake http: only `import` and `backfill` pass, paths are cleaned and
    capped at 200;
  - tray, dashboard and preload wiring.
  Rendered headless at 1100 px and 390 px (no sideways scroll).

### 94. Companion suite review, round two: settings pages, bandolier, spell sets, maps, the gear finder (2026-09-29)
The guild lead kept sending screenshots of the same app: *"bandolier builder looks really clean as are
spellsets"*, its Settings pages (audio, accessibility, navigation, overlays, spell timers, DPS meters,
Discord, maps, advanced), its raid summary, and *"THIS GEAR UPGRADE FINDER IS INTERESTING"* / *"Overview
tells me what gear scores i could replace"*.
- **All of it is in the review doc** (a claude.ai doc in the guild lead's artifacts, "Companion suite review —
  what we don't have yet"; the other app is not named there by request). **Counts now: 28 missing, 38
  partial, 19 covered.** Each item was checked on all four surfaces.
- **The gaps worth knowing about first:**
  - **A client version check.** Our Client versions card shows the eqgame.dll build from `/zeal version`
    but compares it with nothing. A check against known-good builds would have flagged §88's wrong
    eqgame.dll.
  - **The gear upgrade finder** (L), written up in the doc's closer look:
    - by slot, and an overview of each slot's best upgrade by score;
    - class weights (off / low / med / high / crit) with rules for the attack, haste, mana-regen and
      weapon-damage caps; filters.
    Ours would build on the gear page's worn totals and caps, the item mirror and the wishlist. Ours could
    also rank against what the guild actually loots.
  - **Zone maps with in-game map markers** written to Zeal's map files (L).
  - **Per-overlay lock modes:** interactive, click-through, display only.
  - **Timers that stay red until recast.**
  - **Mimic's own voice settings:** volume, speed, voice.
- **Nothing is queued.** Waiting on the guild lead to say which gaps to build.

### 95. PoP checklist: the Essences of Power quest (2026-09-29, web 1.8.49)
The guild lead: *"https://www.eqprogression.com/essences-of-power-quest-pop-elemental-gods/ please consume
this too and put it on the pop guide"*. Two optional steps on `/pop/guide`, each checked against the
server's scripts rather than copied:
- **Part 1, tier one (`essences_escort`, group).**
  - **Start:** say "Quellious be my guide" by the big tree near the waterfall on Nightmare's upper
    plateau (`/map -510 1687`).
  - **Night only:** the hidden spawn that hears the phrase lives from 8 PM to 7 AM game time
    (`EinoInvisNight`). EQProgression's "10 PM" is inside that window.
  - **Repeats:** a start sets its respawn to 36 minutes.
  - **The run:** four waves (4 banshees; 2 nightstalkers; 5 hobgoblins; 4 banshees + 4 bats), then The
    Dreamkeeper (level 64, 40,000 HP, hits up to 622). Keep the waves off Aid Eino: level 50,
    10,000 HP.
  - **The reward:** hand him the Strand of Nightmare after "Hand me the strand from the beast". You get
    the Tiny Gold Fist and 100,000 experience.
  - **New over the source page — one Fist per run.** The Dreamkeeper drops one strand, and Eino depops
    on the first hand-in. A group needs a run per person.
- **Part 2, elemental planes (`essences_power`, raid).**
  - **The Fist is the only gate.** Councilwoman Kerasha answers only while you carry it, and she checks no
    flags. EQProgression's "you may have to be Elemental flagged" is not in her script.
  - **The bowl:** "essences of power" gives the Sacred Bowl. It combines (recipe 9921) the four
    essences: Fire (Fennin Ro), Wind (Xegony), Water (Coirnav), Earth (the Avatar of Earth). The result
    is Power of the Planes.
  - **The reward:** Power of the Planes buys the Jade Hoop of Speed. Handing a reward back cycles it
    Hoop → Coin Purse → Cord → Mace → Ring → Hoop.
  - **New over the source page — a loot call.** Each essence is lore and drops on 40% of its god's
    kills, one per kill, so the guild has to decide who gets them. These are not the Plane of Time's
    four (the Globe, Cloud, Sphere and Mound), and the step says so.
- **Pinned in `test/pop-guide.test.js`, mutation-checked:** the phrases, the places, the item order
  (reward cycle included) and the one-per-run line.
- **Beta layouts (`beta` `7670ade4`):** each step gets what to expect, who you go back to and
  Kerasha's hand-ins.
  - **Auto-fill:** the Tiny Gold Fist in an inventory upload ticks part one. Any ONE of the five rewards
    ticks part two; she swaps them, so requiring all five would never tick. A held-item rule can now say
    `any`.

### 96. Essences of Power: the loot queue, and where it shows (2026-09-29, web beta `7b942d11`)
**The guild's rule (the guild lead):** *"it will be an opendkp bid out for the entire item. this means the
guild needs to see the order for who is next on the loot list for those items, and if they're present to
get them, if they are not, we would bid out the item again and add to the queue. That person that bids
would get to loot that item, and we would continue onwards · raid 1, someone bids and wins the item,
they're queued up for the first set · if raid 3 that person's not there, we bid the item and whoever comes
in is next in the queue · as long as we bid the item only when we don't have someone in queue we're good"*.
As written into `web/lib/essencesQueue.ts`:
1. **One OpenDKP bid buys the whole set.** Winning it puts you in the queue, in the order you won.
2. **An essence drop goes to the first person in the queue** who lacks that essence and is in the raid.
3. **Nobody like that there? Bid it again.** The winner loots it and joins the end of the queue.
4. **Four pieces and you are done.** You leave the queue.

**Where the page reads it from.** It is guild-wide on `/pop`, members-only like the rest of that page
(the guild lead: *"a public item on the pop landing page … we can see who has which pieces"*).
- **The queue** is every OpenDKP award (`opendkp_loot`) of an essence, or of the bid item, in award
  order: oldest raid first, then the order OpenDKP recorded them.
  - An award with DKP is a bid won; 0 DKP is a queued hand-out.
  - The bid item may be entered as **"Essences of Power"** or **"Power of the Planes"**. Anything else
    is not seen.
- **Pieces** come from those awards, plus Mimic seeing someone loot an essence (`looted_items`). A loot on
  its own never queues anyone.
- **"In the raid"** is the live raid roster: a row in the last 15 minutes, as `/raid` uses. With no raid on,
  the next name is simply the first in line.

**Two layouts on beta, to pick from.** No `?v=` stays production as it was.
- **`?v=b` by person:** the queue as rows, one ✓ per piece held, "next" in the cell of the essence that
  person gets next, and a "next drop" strip on top. It answers *"who has which pieces"*.
- **`?v=c` by essence:** four columns, each the order that essence goes out in, first one "next". It
  answers *"who gets this drop"* at loot time.
- **Sample data:** `&demo=1` shows invented names, labelled on the card, since nothing has dropped yet.
- **Costs:**

  | | Build | Maintenance | Runtime | Change |
  |---|---|---|---|---|
  | b | S | low | 5 small reads per /pop view with ?v | low |
  | c | S | low | same | low |

- **Needs the guild to record every piece in OpenDKP:** a bid for the first, 0 DKP for each queued
  hand-out. Mimic's loot line is a backstop, not the record.
- **Tests:** `test/essences-queue.test.js` runs the guild lead's story raid by raid. Mutation-checked.

### 97. Command Center: 📋 on a deathroll (2026-09-29, Mimic beta `013e2e0c`, agent 3.7.47)
The guild lead: *"add in a copy button for deathrolls"*.
- **What it copies:** the whole game as one chat line, e.g. "Deathroll 32,000: A 26189 > B 24160 > … >
  B 0. B loses.". A game still going ends with whose roll it is.
- **Fits EQ chat:** plain ASCII (EQ's chat font has no dash or arrow glyphs), at most 250 characters.
  A long game keeps the first roll, "...", then as many of the last rolls as fit.
- **The button:** ✓ for two seconds after a copy; on the hover handshake, so it works on a locked overlay.
  The clipboard is the only path; the agent never types into chat.
- **Tests:** `test/deathroll-copy.test.js`.

### 98. Target Info: a player who cons even shows your level (2026-09-29, Mimic beta `386cfc99`, agent 3.7.48)
The guild lead: *"Faedar conned even to me he should show up as level 60"* — an anonymous bard, whom Target
Info had called "level unknown until a /who sees them out of anonymous".
- **Partly reverses §15.** §15 stopped using a player's /consider after "looks like quite a gamble",
  yellow by the documented table, gave level 60s a range of 61–62.
- **The evidence:** both reports are level-60 players reading that phrase to a level 60. For a PLAYER it
  is the even con.
- **Now:** a player's level comes from live `/who`, else an even con (that phrase or "looks like an even
  fight") = your own level, shown "(even con)", else `/who` history. The con outranks history, which can
  be weeks old.
- **Unchanged:** every other phrase still gives a player no level and no colour. NPC considers, and the
  phrase learner (NPCs only), are as they were.
- **Tests:** `test/mana-drain-and-con.test.js`.

### 99. /pop read only its first 1,000 flag rows; the planner is now mains (alts) (2026-09-29, web 1.8.50)
The guild lead, on the raid-night planner: *"make this mains and in parenths alts"*, then *"I see 1000
unmapped grants so that's probably a database row restriction"*.
- **The row cap was real, and worse than it looked.**
  - **The data:** `pop_flags` holds 9,846 `unmapped` hail rows (the open item in §86) across 2,191
    characters. Only 212 of them are ours, and every row is older than any real flag.
  - **The bug:** the page read `pop_flags` once with `.limit(20000)`, and the API caps a read at 1,000
    rows.
  - **What that did:** "1000 unmapped grants"; about 456 mostly-foreign characters counted as able to
    attend. After the 10/1 unlock, every real flag would sort after those rows and never be read.
- **Fixed:**
  - Real flags only are read, a page of 1,000 at a time.
  - The unmapped rows are an exact count, not a download.
  - The matrix's "+N?" is fetched only for characters with a real flag.
  - The page's population is characters with a real flag; today there are none, so the planner says
    "No flags recorded yet".
- **Planner:** every number is mains, with alts in parentheses: attend, gain, and each unlock (alt names
  listed apart). It is ranked by mains and ignores the Mains / All characters toggle, which still
  governs the chart and matrix.
- ⚠ **Every other `.limit(>1000)` read is the same trap.** `test/` keeps a baseline of 85 such sites
  that may only shrink; this change removed one.
- **Tests:** `test/pop-planner-mains-alts.test.js`.

### 100. /pop counts the raid roster, and the planner follows Mains / All (2026-09-29, web 1.8.51)
The guild lead, on the planner still reading "456 in": *"it should be mains only when i'm on mains, vs all
characters. Also traders or anyone not of level range shouldn't be counted in there. we should go off of
raiders and raid alts, pack members toons at level and above"*. Partly reverses §99's planner rule.
- **Who counts (`web/lib/popRoster.ts`), by OpenDKP rank on `characters`:**
  - mains: Pack Leader, Officer, Raid Pack, Recruit;
  - alts: Raid Alt;
  - out: Trader, Inactive, Non-raid Alt, no rank, UNKNOWN, and every other guild's character.
  - Active characters only, at level 60 or higher on the last `/who` (`who_directory`). Web 1.8.51
    shipped 46 (PoP's entry level); the guild lead set it the same day: *"for us it's 60. Recruits are
    raider, include them"* (web 1.8.52).
  - A raider never seen on `/who` still counts. A raid alt needs a seen level, because that is where the
    low and trader characters are.
  - Measured the same day at 60: 66 raiders and 101 raid alts (at 46 it was 67 and 135).
- **The page's population is that roster, with each character's flags attached.** §99 counted characters
  with a real flag, and before that every character with a hail row. Today no one has a real flag, so
  the charts start at zero for everyone.
- **Mains means raiders everywhere on the page, the planner included.** All characters adds the raid
  alts, and only there does the planner show "mains (alts)". §99 had the planner ignore the toggle.
- **The matrix's "+N?" marker is gone.** It counted a character's hail rows, which are not flags.
- **Settled by the guild lead:** level 60, and Recruits are raiders. Both live in `popRoster.ts`. The 60
  is our guild's floor, not a rule of the game (self-host epic, §3).
- **Tests:** `test/pop-planner-mains-alts.test.js` runs `popRoster` for real.

### 101. Only main and beta build the website; Vercel's 100-a-day cap (2026-09-29, web 1.8.53)
The guild lead, on the Essences card: *"still not showing for me"*. The code was on beta and built; the
website was not being built.
- **Cause: Vercel's Hobby plan allows 100 deployments a day, and every push to every branch spends one.**
  Each commit's Vercel status read *"Deployment rate limited — retry in 24 hours"*. In the 24 hours before,
  alpha took 103 pushes, beta 87 and main 57. Alpha began that morning (§81), and `sync-alpha.yml` merges
  into it on every main and beta push. So b.wolfpack.quest was stuck on a 15:47 build, seven minutes
  before the Essences card, and production missed 1.8.52 too.
- **Picked by the guild lead:** only main and beta build the site. `web/vercel.json`:
  `"deploymentEnabled": { "**": false, "main": true, "beta": true }`. Alpha, `claude/*`, dependabot and
  task branches stop building. Mimic's alpha builds are GitHub Actions and are unaffected. Offered and
  not picked: Vercel Pro ($20 a month, 6,000 a day), both, or leaving it.
- ⚠ **An Ignored Build Step does not help:** Vercel counts a skipped build as a deployment. A docs-only
  push to main still spends one; that is accepted.
- **How to check next time:** a commit's Vercel status is readable without a token at
  `api.github.com/repos/<owner>/<repo>/commits/<sha>/status`. The Vercel connector in the session needed
  authorising, so this was the only window.
- **Also fixed (web 1.8.53):** a signed-out visit to `/pop?v=b&demo=1` sent you to sign-in with
  `next=/pop`, so you landed on plain `/pop` and never saw the card. The redirect now keeps the query.
  It sat next to beta's Essences lines, so the beta merge was resolved by hand (`e107f523`).
- **Tests:** `test/vercel-deploy-branches.test.js`; the redirect in `test/pop-planner-mains-alts.test.js`.

### 102. 3.0 alpha: every overlay can live on the Timers canvas, as it is today (2026-09-29, alpha `d2dadf94`)
The guild lead: *"i would like the next version of alpha to have all of the data elements from the current
overlays. each current overlay's data elements can come in as they are today, no new modalities if that makes
this less of a lift, but the end goal is to incorporate the different views"*.
- **The least lift is the builder plan's "compat part":** each overlay's own page in an iframe, the way the
  Dock already hosts panes. No fork, no new display type. The 15 are the Dock's 14 plus the HUD ring, which
  a free screen can hold even though a grid cell cannot. The trigger overlay was already there as its
  callouts and timers panels.
- **One copy of each overlay.** While an overlay is on the canvas, it has no window of its own
  (`_canvasHostedKeys` in `_overlayWanted`, ahead of every force-show), and it leaves the Dock. Adding one
  switches its own flag on, so Remove gives its window back visible, the Dock's undock rule. Hiding a panel
  keeps the overlay on the canvas and unloads its page. Turning the canvas off gives every overlay back to
  its own switch.
- **"Bring in the N on screen now"** moves every overlay that has a window or a Dock pane onto the canvas, at
  its window's spot, size and zoom. So the first alpha looks like the raider's current setup, in one window.
- **What the canvas owns:** the always-on ✥, size (A−/A+ scales the whole page), hide, remove. The page's own
  ✥, ✕ and setup bar are hidden there (preload `WP_IN_CANVAS`); its buttons and tabs work through the hover
  handshake as they do in its window.
- **The end goal:** the six display types (§83) replace these panels one overlay at a time. Each overlay's
  data becomes parts, and the compat panel goes.
- ⚠ **Not measured:** the cost of 15 pages in one screen-sized transparent window on a raid machine. The Dock
  shows iframes cost less memory than windows, but not the compositing cost of a full-screen surface. Watch
  the tray's "Resource use — what Mimic costs this machine" on the alpha.
- ⚠ **Known gap:** docking an overlay that is already on the canvas shows it in both places until one is
  removed. Only the canvas-to-Dock direction is guarded.
- Alpha only, like all builder work. Tests `test/canvas-overlays.test.js`; the full alpha suite is green.

### 103. 3.0 alpha: pieces — every data element on its own, by category, in the mode you pick (2026-09-29, alpha `994eb032`)
The guild lead, the same day, after §102: *"break them up and put them into categorization like we did with
the HUD. My Info, Group info, Raid info, target info, pet info, charm info, etc. Make it a persistent chooser
that i can pull up and move things around, then select the mode for the data. break out every data element.
when I'm designing this it should feel like i'm putting down individual legos instead of prebuilt pieces,
then be able to save groups. Start with the groups of our overlays today and let me pull pieces out as
well."* This supersedes §102 as the direction; the whole-overlay panels stay as one section of the chooser.
- **116 pieces in 12 categories:** My info, Target, Group, Raid, Pet, Charm, Fight, Main tank, Healing,
  Timers & ticks, Zone, Casting (`apps/mimic/parts.js`).
  - Each piece reads one field of an agent endpoint the overlays already use: `/api/me`, `/api/state`,
    `/api/tank-state`, `/api/command-center`, `/api/extended-target`, `/api/buff-queue`, `/api/timers`.
  - Each has a kind: gauge, value, countdown or list.
  - Each has a sample for building with no game running.
  - Field paths come from the serializers themselves, not from the catalog's prose.
- **Modes per kind**, a subset of the six display types (§83):
  - gauge: bar, ring, readout, big number, pips;
  - countdown: bar, ring, readout, big number;
  - value: readout, big number;
  - list: rows, chips.
  - Timeline and the "locked to a window" anchor are still to come.
- **The chooser** is a movable palette that remembers whether it is open, where it sits, and its tab.
  - Drag a piece onto the screen, or drag one of its mode chips to place it in that mode.
  - Every piece shows its live value in the list.
  - The Groups tab holds today's 17 overlays as groups of pieces, laid out as the overlay had them, then
    "my groups", then the whole overlays as today (§102).
- **Legos:**
  - A dropped group lands as separate pieces that share a group id.
  - Ctrl-drag moves the group; a plain drag pulls one piece out.
  - Shift-click selects; 💾 saves the selection as a group (`cfg.canvasGroups`, one list for every screen).
  - Delete removes the selection; right-click a piece to change its mode, backing and size.
- **Cost to watch:** a source is polled only while a placed piece, or the open chooser tab, needs it. A
  piece's HTML is only written when it changes. But `/api/state` is multi-MB on a raid machine, and a piece
  that reads it pulls the whole thing every second. **A slim endpoint per piece family is the next
  performance step** once the pick of pieces settles.
- Not measured on a raid machine. Alpha only. Tests `test/canvas-pieces.test.js` (the library run for real,
  mutation-checked). A headless run against a fake agent showed live values, a Tank group dropped as 11
  linked pieces, and a saved group.

### 104. FB-37 reviewed: XP / AA per hour by zone, group composition, the best groups (2026-09-29)
A member asked for XP per hour by zone, and for "best solo / best group XP per hour this week", in total XP
not percent and per five levels. The guild lead added AA/hr, group composition and *"i see the number 1
groups is doing X mob, i could do the number 2 grouping which is Y mobs"*. **Review only; the options wait
on a pick** (`docs/DESIGN-xp-tracking.md`).
- **Nothing about XP reaches the server today.** Zeal's XP/AA bars and the agent's own per-hour rate stay on
  the machine. Experience lines are not parsed. Group membership and zone have no history.
- **Total XP is exact, not estimated.** TAKP's `GetEXPForLevel` is (L−1)³ × 10 × race × a level band. So
  the change in (level, %) plus the race from `/who` gives total XP per kill. Verify the band table and
  Quarm's AA-per-point rule, and measure label 26's resolution for an evening, before building.
- **Options** (four costs each in the design doc):
  - A: local only (your own XP/AA per hour and total XP per zone, as pieces);
  - B: a guild XP board (agent upload of one event per experience line, `xp_events`, a `/xp` page with
    per-bracket solo and group tables, compositions and top mobs);
  - C: B plus a live "best XP right now" piece.
- **Recommendation:** A, then B.
- **Questions:** retention (7 or 30 days), names (guild by name, others by class), and whether raid XP counts.

### 105. Pieces, round two: delete, a group drags whole, edit from any corner, lock and save your own sets (2026-09-29, alpha `291ddcaa`)
The guild lead, on the first pieces alpha:
- *"when i hit the X on one of these elements it just hides it … I should be able to delete out the elements
  instead of hiding them"*;
- *"I should also be able to drag the whole group that came out from the panel at the same time instead of
  grabbing the top one and having it get disconnected"*;
- *"I have no way of bringing up the overlay editing other than the taskbar now. It needs to be something
  that i can get to from the right click menu in the top corner of the overlay panel"*;
- *"I need a faster way to get to the editing mode for individual components"*;
- *"I should be able to select multiple pieces, lock them together (and not necessarily touching) and move
  them at the same time. Should be able to save my own subsets."*

This reverses §103's drag rule. What changed:
- **✕ on a piece deletes it**, with an Undo toast for 8 s (and Ctrl+Z). Other panels' ✕ still hides. The
  callouts panel and the catch-all timers panel can never be deleted.
- **A plain drag moves the set:** the selection the piece is in, else its group, else just the piece. The
  grabbed piece snaps; the rest keep their distance.
  - **Alt-drag** pulls one piece out and takes it out of its group.
  - Ctrl-drag is gone.
- **Selecting:**
  - Click selects; Shift- or Ctrl-click adds, however far apart.
  - A bar under the toolbar then offers 🔗 lock together, 🔓 unlock, 💾 save as a group, and 🗑 delete.
  - Any panel kind can be locked with pieces, including an overlay or a timers panel.
- **The ways into editing:**
  - One click on a piece's always-on ✥ while playing opens its settings, and the settings open with ✏
    Arrange the canvas / ✓ Done and 🧩 Pieces.
  - Double-click a piece while arranging.
  - "🧩 Arrange the canvas (pieces)" in every overlay's right-click menu.
  - `/pipe mimic edit` (also `arrange`, with `on` / `off` / `done`) from the game.
- Tests `test/canvas-pieces.test.js` (the drag set and delete/undo run for real). A headless run moved all 11
  Tank pieces by one offset, pulled one out with Alt, deleted and undid, and moved a far-apart locked pair
  as one.







### 106. Old characters fold away; the Overlays tab gets three mockups; a group sizes as one (2026-09-29)
**Characters touched in the last 3 months show; the rest fold into "more".** The guild lead, on the
setup walkthrough's character list: *"i have too many old files in here. we should really just show things
that have been touched in the last 3 months and then a collapsed section with more. Same thing for the /me
page."*
- **Mimic setup walkthrough** (beta `3f390c1c`): the table shows characters whose log was written in the
  last 90 days, plus the starred main. The rest sit under a closed "N more · not played in 3 months",
  with the same Main and Send controls. `splitRecentChars()` in `apps/mimic/welcome.html`.
- **/me** (web 1.8.54, main `318cbe1d`): "touched" means the newest agent upload on any stream, or a
  live-state snapshot, within 90 days. The character cards and the Mimic sync list both split this way.
  The sync list's old "with no uploads" section now holds the older characters too.
- On both surfaces, if nothing is recent, everything shows. An empty list would be worse than a long one.

**The Overlays tab: three mockups, no pick yet.** The guild lead, from a screenshot of the tab: *"Show me a
few mockups for a new overlays tab that can build these overlays faster, right now it's just a wall of
text and toggles, then mismatched keybinds. We should have a gallery view in here if it's a selection
tool, but ideally it would be a home for the builder to live."* The mockups are a
private page in the guild lead's artifact list, titled "Overlays Tab Mockups". The three options:
- **A, gallery:** cards with a sketch, a switch, a key and "Open in builder".
- **B, studio:** a pieces library, a miniature of the screen and a settings panel. The builder lives in
  the tab.
- **C, layouts:** saved layouts as tiles, "on screen now" with one key each, and "Arrange on screen". The
  tab launches the on-screen builder. A's cards become C's Add drawer.

All three share one key format, with clashes shown in red. The recommendation is C, which does not
build a second editor. B's costs are high on build and on maintenance, because two editors of one layout
have to agree. ⚠ The tab lives in the agent dashboard (`packages/wolfpack-logsync/dashboard.html`), so
whichever option is picked lands through `beta` and must show the builder parts only on a Mimic that has
the canvas.

**A group sizes as one** (alpha `a5532ace`). The guild lead: *"when a group is selected by grabbing the top
bar you should be able to resize the entire group"*.
- A click on a grouped piece now selects the whole group; Alt-click selects just the one piece.
- Two or more selected get a dashed box with a single ◢. Dragging it stretches every piece from the box's
  top-left corner, keeping their places relative to each other.
- A piece's text grows with the height. A wider group alone keeps the text size. Shift keeps the group's
  shape.
- The ◢ on any grouped piece does the same; Alt-drag on it sizes only that piece.
- `groupBox()` and `scaleGroup()` are pure functions and are tested for real in
  `test/canvas-pieces.test.js`.

**Background on the Timers canvas** (beta `45e76402`). The guild lead: *"background on the timer canvas just
makes the whole screen dark"*. The backdrop painted `<body>` on any overlay without a `#wrap` card. The
canvas window covers the screen, so the whole screen went dark. On the canvas the plate now goes on each
visible panel instead, in `preload.js`, marked by the canvas's own `#screenBtn`. The alpha picks it up by
sync; the merge was checked and is clean.

### 107. Canvas round three: Target Info's every tab as pieces, the HUD's formats, a menu that moves aside, option C for the Overlays tab (2026-09-29)
The guild lead, on alpha 848, with screenshots:
- *"Go with C, change the name of the Timer Canvas to Canvas."* Also: *"we're going with C for Overlay
  screen."*
- *"When the Canvas has a background toggled it just greys out the whole screen instead of individual
  components within it."*
- *"We need more element types, sizes, formats like in the hud"*.
- *"The Target Info is missing all sorts of data. no drops no spells no fwv"*.
- *"The right click in the corner of an element completely covers the overlay. We need to adaptively find a
  spot where we can put it above or to the side depending on how far from the edge of the screen it is."*
- *"Selecting Chips in the target info's breakout 'its buffs' version doesn't expand to match the size of
  the overlay."*

**Picked: Overlays tab option C** (§106's mockups). The tab becomes layouts, what is on screen now, and an
Add drawer, and "Arrange on screen" launches the builder. The build is in the next entry once it lands on
beta.

**Built on the alpha (`ec8ad702`, 3.0.0-alpha.852):**
- **Renamed Canvas** on the tray, window title, overlay name list, toolbar and the overlay-sets note. Beta
  follows with the Overlays tab (`e07d75fa`, held for one build). Code comments keep the old name.
- **Background:** §106's per-panel plate reaches the alpha only on its next own push, because syncs do not
  rebuild. `ec8ad702` is that push. Checked headless: with Background on, the body stays transparent and
  each panel takes the 0.92 plate.
- **Target Info, every tab** — from the bot's catalog row (`mobInfo.mob`):
  - Stats tab: level, zone, HP (live cur/max when known), damage, AC, the AC-and-resists grid (coloured by
    how hard it is to land on), special attacks (dangerous ones red, immunities blue), sight ("Sees Invis"
    judged as the overlay does: undead → IVU only), and a PQDI link that opens the browser.
  - Other tabs: drops (drop-rate colours, ⭐ unique, LORE, "N× won"), spells (what it casts at you first,
    resist and cast time), and faction hits on kill.
  - Quest and Vendor from a new `npc` source. Its path is a function of the state source
    (`/api/npc-interact?id=<target npc>`); it waits while there is no target, drops the old answer on a
    new target, and asks again every 1.5 s while the bot is still reading the script.
  - Quest rows copy a `/say` or `/map` when clicked, locked or not (a `.ctl data-wp-interact` span).
  - The Target Info group gains a second column with the tabs. A separate "Target: drops, spells,
    F/Q/V" group has just those.
- **Formats like the HUD:** slim bar, upright bar, half ring, badge (the HUD's DS circle), one coloured
  line (the HUD's resist row; resists now carry its colours) and columns.
  - Every piece can also hide its label, and take a thin, normal or thick bar or ring, its own colour and
    left, centre or right text.
  - These settings go through sanitize, saved groups and placement.
- **The menu moves aside:** `menuSpot(W, H, box, mw, mh)` is pure. It tries right, then left, then below,
  then above, and takes the first side with room for the whole menu. Otherwise it takes the spot that
  covers the least of the piece. The box it keeps clear is the piece's whole group.
- **Pieces fit:** a mode change keeps the piece's width (rings excepted) and takes the height its content
  needs. "↕ Fit" does the same on demand. Checked headless: chips on "Its buffs" stayed 200 px wide and
  grew to 79 px, all shown.
- **Found while testing:** double-click on a piece never opened its settings. The first press raises the
  drag shield, so the browser's dblclick lands on the body. The canvas now counts two clicks on one piece
  within 450 ms itself.
- Tests: `test/canvas-pieces.test.js` round three (modes, look options, resist colours, every target piece
  on real-shaped data, the npc source, the preset, sanitize, fit, clicks, two clicks) and
  `test/timers-canvas.test.js` (menuSpot on five placements). Full suite green.

**The Overlays tab, option C, on beta** (`b8c6b98c`, agent 3.7.49; the Canvas rename `e2116fa2` rides with it).
Layout tiles, an Arrange bar, what is on screen now, an Add drawer of overlay cards, and one keycap
format everywhere with clashes in red. Every control of the old tab has a home in the new one; the list
is in HOW-ITS-BUILT ("Dashboard: the Overlays tab, option C").
- **A bug the old tab had**: its per-character layouts card read `charProfiles` from the agent's state,
  which never carries them. So its saved list was always empty, and the auto-switch box was never shown
  ticked. The new tiles read Mimic's own status.
- **Left out, on purpose**:
  - Sketches on the layout tiles: a saved layout records which overlays are on, not where they sit.
    Tiles list the overlay names instead of inventing positions.
  - Role filter pills: 12 of 18 overlays would land in "Everyone", and which overlay belongs to which role
    is the guild lead's call.
- **The alpha got it by a hand merge** (`703a6017`). The sync workflow failed, as expected: the tray label,
  the canvas hint line and their test changed on both branches. The alpha kept its own wording.

**The Pieces chooser, readable again** (alpha `7f239374`). The guild lead, on the chooser once the new
formats landed (one crowded line per piece, names cut off, a sideways scrollbar): *"i can't read this"*.
- Each piece shows its whole name and current value, with its ways to draw it on a wrapping line
  underneath, by name.
- The chooser went from 300 to 360 px and from 11 to 12 px text.
- Its right edge drags from 280 to 640 px, and the width is kept with the layout.

### 108. Vercel Deployment Storage over the Hobby 10 GB (2026-09-29)
The guild lead, with the Usage page: *"vercel is overdeployed on storage it seems"* — Deployment Storage
**10.32 GB / 10 GB** ("Exceeded free resources"). The 7-day chart climbed about 2 GB a day, dropped once
on Sep 26, and climbed again.
- **Why:** every finished build keeps its whole output until retention deletes it (Hobby default: 30 days
  for every kind). `web/public` alone is about 40 MB, and a 23 MB GIF (`pvp/deeps-pit-full.gif`) is more
  than half of that. Until §101 today, every push to every one of 50 branches built the site. Vercel also
  keeps the latest build of every branch that still exists, however old it is.
- **Done:** `web/vercel.json` `ignoreCommand: "git diff --quiet HEAD^ HEAD -- ."`. A main or beta push that
  changes nothing under `web/` now skips the build, and skipped builds store nothing; most pushes are
  bot, agent or docs changes. This does not change the 100-deployments-a-day count, since a skipped build
  still counts there. The site imports nothing from outside `web/`. `test/vercel-deploy-branches.test.js`;
  CLAUDE.md release playbook.
- **The guild lead's, in the dashboard** (the Vercel connector is not signed in, and no token is in the
  repo):
  1. Project → Settings → Security → Deployment Retention Policy: set Preview, Canceled and Errored to the
     shortest option offered. Production keeps its last builds anyway, because the live one carries the
     domain.
  2. Deployments list: delete old preview builds. The CLI does it in one line: `vercel remove <project>
     --safe --yes` removes every build that carries no live URL or domain.
- **Offered, not done:** deleting merged `task/*` and `claude/*` branches (about 40 of the 50) so their
  last builds can expire. Deleting branches cannot be undone, so it waits for a yes. Also offered:
  replacing the 23 MB GIF with a video of a few MB.
- **2026-09-30:** the guild lead said yes to both. Neither landed from the cloud session: the git proxy
  refused the remote branch deletes (403) and further attempts were then blocked. Both are the guild
  lead's to do on GitHub or from a local session.

### 109. An assist on an NPC is not a PvP assist (2026-09-30, bot 3.1.177)
The guild lead: *"query and flag any pvp kills that are probably an NPC name. trakanon is an NPC"*.
- **Why it happened:** the server announces a boss kill in the same words as a player kill ("<name> of
  <guild> has killed Trakanon in Ruins of Sebilis!"). Kills were already handled; the ASSIST path
  (`_checkPvpAssists`, §54) credited every raider who hit the boss with a PvP assist.
- **Found, flagged, not deleted:** `pvp_kills` id 10 (Lord of Ire); `pvp_assists` on Trakanon 162–171
  (2026-09-29 22:49 ET), 126–132, 82 and 83; on Fright 80, 81, 86; Terror 85; Dread 84. A player who
  shares a boss's name was checked by `/who` and kept. Deleting the rows waits for the guild lead's yes.
- **Fix:** `_victimIsNpc` in `_handleAgentPvpAssists` drops an assist whose victim had no guild in the
  broadcast, is in `eqemu_npc_types`, and was never seen in `/who` with a class or a guild. Cached per
  name per request. `test/pvp-assist-npc-victim.test.js` runs it against a stub.
- **Missing kill (same night):** no kill row for any of the guild lead's characters in the last 7 days,
  and their agent's PvP uploads were healthy. To find it: the victim's name and the time or zone, or the
  log line.
- **Deleted 2026-09-30 on the guild lead's yes:** the 24 assists and the one kill above, nothing else (no
  assist pointed at the kill). A re-run of the NPC check found none added since bot 3.1.177.
- **Found after, then deleted on a second yes (2026-09-30):** 20 rows in `pvp_deaths` whose victim is an
  NPC (Aten Ha Ra, Emperor Ssraeshza, Shik`nar mobs, Fright, Dread…), all from the table's 30-day backfill
  at its creation (2026-09-26). They fed the fight history (2+ deaths = a fight).
- **The missing kill was a Glory-worthy one, and the agent could not read that wording.** The guild lead,
  with a screenshot: killed a player of another guild in Ruins of Sebilis, 2026-09-29 22:55:44 ET. The line was
  *"[PVP] Rallos Zek marks <killer> with his favor for spilling <victim>'s blood in Ruins of Sebilis.
  <killer> now bears 1 of 10 measures of Rallosian Glory."* `parseGloryKill` only knew the "watches as …
  finds no worthy conquest" wording (§66), so this line went to the local unmatched capture and no kill,
  death or assist uploaded. Every Glory-worthy kill since the PoP patch was missed the same way.
  Agent 3.7.51 (beta `3f0dd0a3`) reads it (`PVP_GLORY_WORTHY_RX`, `glory: true`); no bot change. The kill
  was written by hand: `pvp_kills` 779, `pvp_deaths` 1816, source `log_backfill`, with the bot's own dedup
  keys so an Opt-in Logs rerun collapses onto them. Other raiders' missed Glory kills come back only through
  Opt-in Logs on 3.7.51+.

### 110. Feedback round FB-38 to FB-42 (2026-09-30)
- **FB-38 (stable 2.7.4): XS not remembered after a restart.** XS is 200 px; twelve overlays had a 220–300 px
  minimum width. A locked window takes XS anyway (Electron pins a non-resizable window's minimum to its
  new size), so 200 was saved, and the next launch built the window at its own minimum. Every overlay's
  minimum is now `_OVERLAY_MIN_W` (200), the same number as XS. Beta `0d782606` (agent 3.7.50). Not
  reproduced on Windows; the report does not name the overlay, so the member should confirm after the
  update.
- **FB-41: "Reslow" spoken as REH-slow.** The built-in slow callouts now speak "Ree slow" and "Ree slow
  soon"; the text on screen still says reslow. Beta `0d782606`.
- **FB-42: a kill stayed on the HUD for 90 s.** The HUD kept a dead mob's hit tally as a dim ghost for
  90 s (`_ME_TALLY_DEAD_MS`); now 10 s. Beta `0d782606`.
- **FB-40 (alpha): Canvas target mana, move icons, labels.** Target mana was blank until the agent saw the
  mob cast; it now shows the catalog pool as a full bar ("no casts seen"), as Target Info does. A group
  shows one ✥ (its top-left piece), which moves the group. "Its …" labels read "Target …". Alpha `f7881fc3`.
- **FB-39: Extended Target did not tell two same-name mobs' debuffs apart.** The guild lead, after the
  first round: *"FB-39 is extended target. You can see the spawnids are varied and the buffs should have
  been associated but they weren't, even though both of us were using miMIC."* Three causes, all fixed:
  1. The bot never selected `buff_casts.target_id`; debuffs came from a NAME-keyed map.
  2. That map kept one entry per spell (the newest landing), so a slow on one of two same-name mobs
     vanished when the other was slowed.
  3. The overlay drew per-row debuffs only when a row carried position-clustering tank labels; rows
     split by spawn id went into the pooled "on one of these N" block.
  Bot 3.1.178 (main): `_extDebuffInstances` makes one entry per spell per mob, pooling a cast seen by
  several Mimics and trusting neither id when two disagree (a bystander's agent stamps its OWN target's
  id when the names match, `_provableTargetId`); `_extAttributeDebuffs` places by id first. Overlay: beta
  `dde2f702`. Evidence: two `froglok krup shaman` alive at once (spawn ids 1296 and 1329); the guild
  lead's agent sent id 0 on landings the partner's agent tagged. K=1 rows are unchanged.
  ⚠ Open, not fixed: `_provableTargetId` can stamp a wrong id when a bystander targets another mob of
  the same name. The bot now distrusts disagreeing ids; a lone wrong one still places wrongly.

### 111. Stable Mimic 2.7.5 (2026-09-30, agent 3.7.52)
The guild lead: *"new stable now please"*, after the Glory-worthy kill fix (§109) landed on beta. Every
Mimic below agent 3.7.51 misses those kills, so the stable was the fix's real delivery.
- **What:** everything on beta since 2.7.4 — the Canvas (§79, §87, §106), the Overlays tab option C
  (§107), screens and Rescue (§80, §80a, §82, §89), per-character suggested triggers and pets on the meter
  (§84, §85), bard charm (§75), the Quest tab warnings (§74), the /who Zone column (§73), UI Studio's Zeal
  bars (§80), the α alpha opt-in (§81), and today's fixes (§109, §110). FB-33, 34, 35, 38, 39, 41, 42.
- **How:** file-level promotion, as every cut: `apps/mimic/`, `packages/wolfpack-logsync/` and their 44
  tests copied from beta `fadf95f8`, byte-identical (a diff of those two trees against beta is empty).
  Seven tests for beta-only website pages stayed behind. Full gate on the promoted tree: 352 test files,
  lint and the dashboard check clean. Roadmap entry and web 1.8.57 in the commit below the stable one, so
  the release body comes from the stable commit's player notes.
- **Held back:** the setup walkthrough's two layouts (§93) still wait on a pick, and unpicked UI variants
  do not go to production. Rather than let main drift from beta, beta `fadf95f8` (agent 3.7.52) shows its
  tray entry and dashboard buttons on prerelease builds only, so the stable carries the page but offers no
  way in. When a layout is picked, it becomes the first-run page and the gate goes.
- **Beta re-parked at 2.7.6** above the stable, in the same session.
- **The alpha needs no re-park** (the guild lead asked): `3.0.0-alpha.N` sorts above every 2.x. But a
  sync never builds the alpha (it pushes with `GITHUB_TOKEN`), so alpha testers stay on the last alpha
  build until something is pushed to `alpha` under `apps/mimic/`. After this cut, alpha `640018c0` touched
  `apps/mimic/ALPHA.md` (not shipped) to build one; ALPHA.md now says so. The stable push's own alpha sync
  failed on add/add conflicts (main had the Canvas files by file copy, alpha its own); the beta sync a minute
  later carried main in cleanly, so alpha lost nothing.

### 112. The PoP trigger pack: checked against our own data, reviewed before import (2026-09-30)
The guild lead, the day before Planes of Power opens, sent a 551-trigger PoP pack from another guild's
public material and asked for its triggers, timers, boss info and strategy *"so that we can bring them in
directly"* — reviewed first, and **not attributed in this repository**. The review is a private page
(owner-only, its link kept out of the repo); choices made on it save to that page's own store. Nothing is
imported yet. Our library had no PoP triggers (131 rows, 0 overlap).
- **Spell triggers (354):** every pattern matches the landing, resist and fade text in our spell catalog.
  **53 recast timers disagree with the server:** the pack times each spell by its own recast, while the
  server's NPC spell lists (`eqemu_npc_spells_entries.recast_delay`) often set another, from 2 s vs 60 s to
  30 s vs 8 s. The guild lead picks: server recast, pack numbers, or leave them out.
- **Boss stat cards (139):** 138 match `eqemu_npc_types` exactly (level, MR/CR/FR); the last is a spelling
  variant. Which command prints the "is not online at this time" reply on Quarm is untested.
- **Event callouts (58):** rebuilt from the quest scripts' say, shout, emote and message calls
  (`eqemu_quest_scripts`). **25 never fire on our server as written**: the pack anchors `^…$` on words that
  sit inside a longer zone emote or shout (Bertoxxulous, Fennin Ro's Doomfire, Coirnav, the Air avatars,
  Earth A's rings, the Halls of Honor flag) or keeps one space where the script prints two. Each has a
  corrected pattern tested against the script's line. 6 texts are not in our copy of the scripts.
- **8 triggers are dead in our engine whatever the pattern:** `triggerVisibleLine` drops every `says,` and
  `tells you,` line (the privacy list), which includes NPC speech — the Tribunal's trial lines, Mavuin's
  flag, Thelin, Etumer and Nitram. Proposed: let triggers see NPC speech only (speaker name with a space,
  plus Etumer by name); player tells stay hidden. An agent change, so beta then a stable cut. Waiting on
  the guild lead's yes.
- **Delivery:** imported triggers are guild-trigger rows, which reach raiders in about two minutes with no
  release. Only the NPC-speech change needs a Mimic update.
- The alpha Canvas work (HUD shapes, chat feeds; task list) is paused for this; nothing of it was written.
- **Imported, same day, on the guild lead's calls** (stat cards on, corrected event patterns, server
  recast, NPC speech yes; every zone kept): **374 guild-trigger rows**, `source_pack = 'pop-2026-10'`,
  tagged `pop` + zone + tier, all enabled. 150 recast timers, 134 stat cards, 58 event callouts, 32
  "on you" alerts. 118 of the 551 were left out: 43 "audible" rows that repeat a "Self" alert for the same
  spell, 32 timers whose spell the server recasts instantly, and 43 whose server recast is under 6 s (the
  bar would restart on every cast). Pack triggers that share one pattern across bosses became one row.
  Timer and spell patterns were rebuilt from our catalog's own landing, resist and fade text; landing
  texts too generic to name a spell ("staggers." and 16 others) were dropped from the "someone else" half.
  Checked by row count and checksum after insert.

### 113. NPC speech reaches triggers; stable 2.7.6; Ring of Fire; no raids until 10/14 (2026-09-30)
The guild lead: *"yes to NPC speech, privacy page gets updated with the NPC messages in an exceptions
section that's collapsed / we have no formal raid tonight, or any night until 10/14. / the guild will be
encountering the Ring of Fire event in Acrylia Caverns"*.
- **NPC speech (agent 3.7.54, beta `685bb5db`):** `npcSpeechLine` lets a `says`/`shouts`/`tells you` line
  reach the trigger engine when the speaker's name has a space in it, or is a one-word NPC on a short
  list (Etumer). Pets count (their names have a space). It is ORed in at the live trigger gate and in the
  golden replay only; `triggerVisibleLine` and the feedback log excerpt are unchanged, so player chat
  stays where it was and NPC lines never leave the PC in a feedback report.
  `test/npc-speech-triggers.test.js`.
- **Privacy:** `/privacy` gets a collapsed "Exceptions: NPC speech that triggers can hear" section listing
  the rule and the NPC lines watched; `docs/PRIVACY.md` has the same section.
- **Stable Mimic 2.7.6 (agent 3.7.54)**, cut the same evening so the PoP event triggers fire on the whole
  fleet when the zones open. It also carries the update-gate fix (agent 3.7.53). Beta re-parked at 2.7.7.
- **No formal raids until 2026-10-14**, so the 19:30–00:30 ET freeze does not hold main pushes until
  then. The freeze itself is unchanged.
- **Acrylia Caverns, the Ring of Fire** (server script `acrylia/RingOfFire`): 7 guild triggers,
  `source_pack = 'acrylia-ring-of-fire'`, tagged `acrylia`, `ring-of-fire`, `luclin`:
  - *first wave*: on the start emote, a 70 s bar (waves come 70–80 s after start), ended early by the reset;
  - *boss 1, 2, 3*: bars to waves 10, 20 and 30, each warned at 60 s. Bosses 2 and 3 show only in their
    last 5 minutes (`display_threshold_sec = 300`);
  - *ring reset*: the warder's shout when the ring empties;
  - *Curse of Eternal Suffering on you*: the bosses' proc (spell 2934);
  - *possessed mob completely healed*: a priest healed its group.
  How it runs, from the script: waves alternate 70–80 s and 90–100 s apart, three mobs each (possessed
  corpses, wizards, priests, or a Battlemaster / Battlelord miniboss at 58, unslowable); every 10th wave
  adds one of four level-63 bosses (200k–500k HP, summon, flurry, magic-only melee). Unengaged trash
  depops after 60 s. **The event ends the moment no living, un-feigned player stands in the ring**
  (checked every 2 s) — the bosses depop and the warder shouts the reset. So: keep someone alive and
  standing in the ring the whole time, interrupt or kill the priests first, and do not feign death as the
  last one in. The ring's own speech needs agent 3.7.54, so the reset trigger fires on 2.7.6 and later.
- **Ring of Fire boss cadence: every 10 waves** (the guild lead, same evening: *"the boss waves are
  supposed to change to every 10 waves instead of 30 to start then 15 after"*). Our copy of the script
  (synced 2026-09-29) already reads `wave % 10 == 0`, so bosses come at waves 10, 20, 30 and on. The
  first import timed only the first boss, and at 800 s, which was 20 s late:
  - The gap after each wave flips between 70–80 s and 90–100 s, off a toggle the script never resets
    between events. Wave 10 therefore lands 780–880 s after the start emote when the toggle starts false
    (a fresh zone), and 800–900 s when it starts true.
  - Every later boss is ten gaps on, five of each length, so 800–900 s after the one before. Boss 2 lands
    1,580–1,800 s after the start, boss 3 2,380–2,700 s.
  - The bars run to the earliest time (780, 1,580 and 2,380 s), because no log line marks a wave.
  - If the server still ran the old cadence (first boss at wave 30, then every 15), boss 1's bar would
    end about half an hour early. So if no boss shows by around 15 minutes, the change is not live yet.

### 114. Target Info: mob info kept on the member's machine (2026-09-30, bot 3.1.179, agent 3.7.55 beta `effdc609`)
The guild lead, on Target Info loading slowly, picked the disk cache (option B of four) and widened it:
*"keep all of the PoP mobs cached on a user's machine, as well as zones that the user frequents"*.
- **What was slow, measured:** the bot's `mob-info` answer is flat over the week (median 110–240 ms, p95
  0.5–1 s, p99 up to 2.6 s, 10,691 calls in 7 days), so Railway did not get slower. Target Info reads the
  agent's whole `/api/state` twice a second to use two fields from it, and that payload now carries every
  guild trigger with its notes: **591 KB, 457 KB of it added by the PoP and Ring of Fire imports (§112–§113)**.
  That is the likelier cause and this change does not touch it (open item below).
- **Bot:** `_buildMobInfo` is the mob-info lookup lifted out of its handler unchanged. `GET
  /api/agent/mob-pack?zone=<id>` builds every NPC name in the zone's id block (`zoneid*1000 + n`, so
  scripted spawns come too) with that zone as the requester's, keyed by `_mobCaseKey`. A pack is built once
  a week, one zone at a time and three lookups at a time, kept in memory (up to 120 zones) and in `bot_kv`
  (`mob_pack:<zone>`, stored as the exact string served, so the ETag survives a deploy), and served gzipped
  with an ETag (304 on a match). Not built yet: 202, built in the background. A build where most lookups
  failed is not saved, so a database hiccup cannot pin a hollow pack for a week. `?pinned=1` lists zone
  ids 200–223, the Planes of Power: codecay and pojustice carry expansion 0 in our mirror, so the id range
  is used rather than the flag. `test/mob-pack.test.js`.
- **Agent:** `mobinfo-cache/` beside the agent, one file per zone. `fetchMobInfo` answers from it before
  any network call, and Target Info shows the hit on the same poll. Every 20 s the agent records each
  character's zone and fetches its pack, and fetches one pinned zone. A held pack revalidates daily.
  Eviction drops unpinned zones unvisited for 90 days, then the oldest past 80 MB. Mimic updates replace
  only the agent's three code files, so the cache survives them. `test/mob-pack-agent.test.js`.
- **Size:** PoP is about 1,800 distinct mob names across 24 zones. Deployment cost: DESIGN-selfhost-wizard §3.
- **Not built:** loading one tab at a time. It would show Stats sooner on a first lookup but make every tab
  click wait on the bot; with the pack on disk, one call is the better trade.

### 115. Two things found in the guild lead's `/api/state` paste (2026-09-30)
- **The DPS HUD and the player HUD's Σ count different things.** The DPS HUD's damage (`currentEncounterThreat.perPlayer[].dmg`)
  includes damage-shield hits. The player HUD's Σ is the `out` lane of `_meMobTallies`, which puts DS in its
  own `ds` lane. On the screenshot's fight that is 4,072 against 3,938. The 134 difference is thorns plus any
  small hit the HUD judged to be DS. The second DPS HUD row, named after the mob, is the total row, not a
  mis-parsed attacker. No change made; the fix, if wanted, is to label the Σ as "your hits, DS apart" or add
  the DS lane into it.
- **The raid hold is on every Sun/Wed/Thu 19:00–00:30 ET, raid or not.** The paste showed
  `updateBlocked: raid hold — the bot reports an active raid` on a no-raid Wednesday. `_raidHoldNow` is
  schedule-driven; with no formal raids until 10/14 (§113), agent updates and background scans wait on those
  evenings unless an officer sets `flag_raid_hold = 0` in /admin/overlays, and clears it before 10/14.

### 116. FB-45: a new loot call with the same numbers starts new rolls (2026-10-01, agent 3.7.56 beta `2020a8c4`)
The guild lead, from a Command Center Rolls card that showed two loot calls as one: *"when we do rolls way
later we should post the new items - we had a long time in between these rolls and we should have made them
separate rolls even if it's the same numbers"*.
- **What happened:** one raid call put 111/222/333 on three items at 22:08, the next put the same numbers on
  three new items at 22:15. Seven minutes is inside the 10-minute same-range window and rolls were still
  landing, so the second wave joined the first wave's sets under the old names (a set is only labelled
  once), and a raider who rolled in both waves showed as re-rolling.
- **The rule now:** a set ends when a call made after it started gives its number to a **different** item.
  The same item posted again is a reminder and keeps the set. A set that has no item yet ends only when the
  call comes more than **2 minutes after its last roll**: calls often follow the first rolls by up to a
  minute (54 s and 10 s measured), and that call names the set rather than starting a new one. Only the
  newest set of a range can take a roll. An ended set shows closed at once on the Rolls card and the
  Command Center.
- **Where:** `_rollSetSuperseded` in the agent, used by `trackRollLine` and `rollSetsSnapshot`. No bot
  change: uploaded sets are keyed on `started_at`, so a new set is a new row. `test/roll-sets-new-call.test.js`.
- **Not done:** an item-less call ("roll 333") still cannot start a new set, because it carries no name to
  compare. A long pause on its own (no new call) still runs to the 10-minute window as before.

### 117. Zeal 1.4.8; threat meter for the non-tanks; no more identical backups (2026-10-01)
**Threat meter, your own meter (agent 3.7.57, beta `2fe18e75`).** The guild lead: *"A for now, B later.
It's for the non-tanks primarily that don't want to get hit."* Values are each spell's own hate effect (SPA 92)
in `eqemu_spells`; the behaviour was checked in the server source (EQMacEmu `aggro.cpp`, `spells.cpp`,
`zoning.cpp`).
- Added: Concussion −400, Ancient: Greater Concussion −600 (there is no plain "Ancient: Concussion").
  Corrected: Jolt −400 → −500, Cinder Jolt −570 → −500.
- Removed: Voice of Quellious (−2500), an enchanter mana buff with no hate effect, so every cast dropped
  the enchanter's own meter; Voice of Thule (flat +3000), which is a 12% hate multiplier (SPA 114), not a flat
  amount. Left in, and flagged: Quivering Veil of Xarn (−2000) has no hate effect in our mirror either.
- A resisted spell still applies its own hate on the server, so a resisted Concussion keeps its −400 and no
  longer also gets the generic +120. A fizzle or an interrupt applies nothing: the amount is stamped at cast
  begin and handed back if the failure line comes inside the cast time (the Divine Intervention pattern).
- "LOADING, PLEASE WAIT..." clears your hate and your pet's. Zoning removes you from every hate list,
  despawns your pet and breaks a charm; Evacuate, Exodus, Succor, Lesser Succor, Levant, Abscond, Egress,
  Decession and Banishment of Nightmares reload the zone, so they print the line and do the same. Damage
  dealt stays on the DPS meter.
- **B, later:** other raiders' meters. The Concussion landing line names the mob, not the wizard, and nobody
  else's log sees you zone. The cast relay (spell + target) and each Mimic's zone report can carry both for
  Mimic users; raiders without Mimic stay invisible to others. Costs reads during a fight.
- `test/threat-concussion-zoning.test.js`.

**Zeal 1.4.8 and the fork.** Upstream merged our Bandolier filter (#238) and a third party's target
fields on the pipe (#239, the #213 ask), plus `/shownames raid` (#242) and `/tag rsgs` (#243). The fork's
main was synced by the guild lead; then main was merged into each branch (no force-push): `tag-shapes`
`8b4ff07`, `tag-persistence` `a5f104d`, `tag-corpses` `ccf7c07`, `tag-icon-files` `da36d4b`, `test-all`
`7d49ae6`. The conflicts were all `nameplate.cpp` (include lists, the MainLoop callbacks, the `/tag` help
text) and one README line; each branch's own change set is unchanged, checked line for line, and
`test-all`'s differs from before only by the Bandolier lines, which now come from upstream.

**`test-all` builds on GitHub (fork `0a2e25d`).** The guild lead: *"can we render this in github directly to
make a new test executable via script or does it need to be done on my machine"*. Until now every test
build was local (Visual Studio): the fork had never run a workflow, and its copied "Create manual release"
cannot run there, since it tags the release with the version in `zeal.h` (`v1.4.8`, the same as the real
release) and its changelog step needs an existing tag, of which the fork has none.
`.github/workflows/build-test-all.yml`, on `test-all` only (so it never rides into an upstream PR): every
push builds on `windows-2022` with upstream's msbuild line, labels the build `testall-<hash>` (Zeal's
options window shows it), zips what an upstream release zips, and replaces the zip on ONE rolling
prerelease, tag `test-all-build` (not `test-all`, which would make the branch name ambiguous). The first
run passed in about three minutes, which is also the first compile of the 1.4.8 merges:
`https://github.com/davehess/Zeal/releases/tag/test-all-build`.

**Mimic can install it (Mimic beta `0e5eb23b`).** The guild lead: *"build the option into mimic to pull my
zeal repo's build as an option"*. Settings → Zeal now has two choices, Official Zeal (default) and Test build.
The choice saves at once and re-runs Check; Install, the 12-hour reminder, the dashboard's Zeal button and
the setup walkthrough all follow it. The test release keeps one tag, so a build is named by its commit,
`testall-<hash>` (the label Zeal's options window shows), and every push to `test-all` reads as a new
version. Going back is "Official" then Install. `test/zeal-source.test.js`.

**Tag pictures: option A, plus every guild mark as an editable picture (fork `tag-icon-files` `e8254ec`,
`test-all` `da88716`).** The guild lead picked A: *"A"*, then *"output the current set of guild tag images as
tgas or pngs as well so if someone wanted to override they could edit and drop in"* and *"a readme in the
folder about it"*.
- **Zeal (`tag-icon-files`, upstreamable):** `uifiles/zeal/tagicons/custom/` is read too; nothing installs
  into it and a picture there wins over a shipped one under either name. A picture can now replace a guild's
  **banner** as well (`BEUR.png` for `^BEUR^`, real guild codes only), and an icon's picture may be named for
  the whole key (`IEUR.png`). The whole-key name is required, not cosmetic: Windows allows no file called
  `CON.png`, so `ICON.png` is the only way to picture the CON guild. `/tag icons` creates `custom`, prints its
  path and marks a player's own pictures "(yours)".
- **The build (`test-all` only, so no upstream PR carries guild marks):** `tagicons/README.txt` (the three
  folders, how to change a mark, the rules, the Windows-reserved names) and `tagicons/templates/`, all 30
  guilds' icon (`I<code>.png`) and banner (`B<code>.png`), 160×160 RGBA. They are the gallery's face-on renders
  of the real meshes. Zeal does not read `templates`, so shipping them changes nothing until a player copies
  one into `custom`.
- **What broke on the way:** the first push named the CON icon `CON.png`, and the Windows build failed at
  checkout. The rename to `I<code>.png` fixed it, and the next build passed (`727cee6`).
- **Tested:** the off-client test (`docs/upstream/zeal-tag-icon-files/test/`, g++ against the real
  functions) covers custom-wins under either name, whole-key names, banners and a non-guild `B<name>.png`.
  Three deliberate breaks (shipped searched first, banners off, no whole-key name) each fail it.
  clang-format is clean. In-game steps 10–15 are in `zeal-tag-shapes/TRY-IN-GAME.md`. `bandolier-chat-filter` is merged upstream and
`pipe-spawn-id` (unrelated history; spawn ids shipped in 1.4.6) is obsolete; neither was touched.

**The new pipe fields, reviewed.** `target_name`, `target_type` (0 player, 1 NPC, 2 NPC corpse, 3 player
corpse), `target_level`, `target_class`, `target_race`, and `target_loc` (only within 250 units), all
omitted with `target_id` when there is no target. Mimic does not read them yet: `main.js`'s player-message
handler copies only the zone, autoattack, the ids, target of target and our own position.
- **Where they help, in order:** (1) Target Info picks the exact NPC body. `_buildMobInfo` already lists
  the class variants of a same-name mob and waits for a "gender hint once the pipe can supply one"; level,
  class and race pick the row outright, so stats, loot and spells are right for same-name bodies.
  (2) Player targets get class and level from the client instead of `/who`. (3) `target_type` says corpse
  directly. (4) Name and id now arrive in one message, so they cannot disagree the way a lagging gauge name
  can. (5) `target_loc` gives the distance to the target when close.
- **Build when picked:** Mimic reads the six (null when omitted, like the ids); the agent sends level,
  class and race with the mob-info request; the bot picks the body with them.

**No more identical backups (Mimic beta `567c5911`).** The guild lead, on `uifiles/zeal/targetrings`: every
ring had three `.zealbak` copies, *"even though they're byte-identical"*. The Zeal installer (and the UI-pack
installer, same helper) backed up every file it wrote. Now a file that already holds the bytes is skipped,
and that installer's old copies identical to the file are deleted (only exact matches; a copy of a different,
older file stays). `test/install-no-identical-backups.test.js`.

**Tag pictures as files, the way target rings are (decided: A, built below).** The guild lead: *"I would
prefer to allow for additional tags in this way or overrides of the ones that are defaulted in from our
repo."* Built later the same day: a `custom` folder that wins, banners overridable, templates shipped. Still
not overridable by a picture: the symbols, badges, paws and the wolf (they have no `I`/`B` key).

### 118. Local mode: Mimic for players outside the guild; eqmimic.quest (2026-10-01)

The guild lead: *"i'm getting a lot of interest in individual users using this just for the overlays - can we
make a purely local version work?"* Picked A: *"I think A makes sense to begin with here"*. A means: stop
the leak and the nags, label the guild-only overlays, and ship the spell and item data inside the installer.

**A leak, closed (agent 3.7.58, beta `0ec64fef`, `v2.7.7-beta.7`).** With no token, the agent still posted
the upload queue and the live state (zone, buffs, pet) to the bot. Each post was refused with a 401, but the
data had already left the machine. It also polled the version endpoint every 10 minutes. Now `_localOnly()`
(started with no token): `enqueueUpload` drops, `_postLiveState` returns, and the drain and the version poll
are never started. Anything queued in an earlier signed-in session waits on disk for the next one. The
dashboard state carries `localOnly` (its "(local-only)" tag already read it; nothing set it before).
- **No nag.** `cfg.localOnly` is the saved choice: setup's "Run local-only", the welcome screen and the
  banner's new **Stay local-only** set it through the `set-local-only` IPC; `_setupIssue` treats it as
  finished; signing in clears it. `checkAgentUpdate` does not ask the bot without a token, because a local
  Mimic gets its agent inside Mimic's own releases, from GitHub.
- **Guild-only overlays say so.** Buff queue and Extended Target showed "loading" forever; now *"guild
  feature: it needs your raid's Mimics, so sign in to use it"*. Mob Info has no local source (the bot builds
  it) and stays empty in local mode; the eqmimic.quest pages list it under "needs a guild server".
- **What leaves the machine in local mode:** nothing to the guild server. Mimic still checks GitHub for its
  own updates and Zeal's. Checked by listing every host the agent and the Mimic shell contact; the rest are
  links a player clicks.

**Spell and item data in the installer (bot 3.1.180 `301a1274`; Mimic beta).** A local install never
fetches the catalogs, so without this its spell timers and buff names had nothing to read.
- `GET /api/public/catalog/<spell-catalog|item-clickies|item-catalog>` serves the agent routes' cached,
  ETag'd bodies without sign-in. Safe to publish: every row is from the `eqemu_*` mirror, already readable
  with the site's public key, and a hit is served from memory (no database read).
- `apps/mimic/scripts/stage-catalog.js` runs as `predist`, writes the three into `staged-agent/catalog/`
  under the agent's own cache names, and never fails the build (no snapshot = how every installer before
  shipped). On launch `seedBundledCatalog` copies each into the agent folder when it is newer than the copy
  there, so a signed-in install keeps what it fetched itself.
- beta.7's build log: 3,933 spells, 26,972 clicky items, and an item catalog of **1,000**, which is wrong:

**Found on the way: the wishlist item catalog served 1,000 of 11,104 items (bot 3.1.181 `f4557341`).** The
handler asked for pages of 2,000; PostgREST answers at most 1,000, so the first page came back "short" and
ended the loop. Every agent's on-disk item catalog has held only the 1,000 lowest item ids since it shipped
on 2026-08-30. **No player saw it:** nothing calls the agent's `/api/item-search` (the local wishlist search
was built, but no screen was ever wired to it), so the cost was this snapshot. The bot 3.1.181 commit
message says players' searches were affected; that is wrong, and this entry is the correction. `PAGE =
1000`; the test runs the real handler against a fake database with the 1,000 cap (2,500 in, 2,500 out; the
old value returns 1,000). The next beta build's snapshot carries the full list.

**eqmimic.quest.** The guild lead: *"And also a generic miMIC without all of the Wolf Pack detail would work,
we have eqmimic.quest domain now. Does a branch of the parser make sense?"*, then *"lets set this up to work
on eqmimic.quest please, vercel restricts me per project, perhaps this is something that can exist in the
hesstastic project"*.
- **Two page designs, in the hesstastic repo (`7b70545`), not yet picked.** A, demo-led: mock overlays
  over a scene, then the two lists and the steps (`hesstastic.com/eqmimic/`). B, ledger-led: "On your PC"
  beside "Needs a guild server", then privacy in three lines and a short FAQ (`hesstastic.com/eqmimic/b/`).
  Both noindex until picked. The download button asks GitHub for the newest installer with local mode
  (2.7.7-beta.7 or later, the newest stable once one exists) and falls back to the releases page.
  Costs: A builds slower and its mock drifts from the real overlays (maintenance and change: medium);
  B is cheaper on every count (all low). Runtime is the same: one page, inline styles, one GitHub request.
- **Hosting.** The hesstastic repo is a GitHub Pages site, and a Pages site carries one custom domain
  (already hesstastic.com), so Pages cannot serve eqmimic.quest from it. `vercel.json` there routes the
  eqmimic.quest host to `eqmimic/` for the Vercel project that builds that repo. It uses `routes`, not
  `rewrites`, because Vercel serves a matching file before a rewrite, and `/` would hit hesstastic's own
  `index.html`. **Unverified:** that a Vercel project builds that repo (the Vercel connector needs sign-in
  in this session), and the route itself until the domain is added.
- **A branch of the parser: no (recommendation, not yet decided).** A branch rots the way beta did
  (79,199 lines behind before the sync rule) and every fix has to land twice. Recommended instead: one
  codebase with a build-time edition switch. Mimic built as plain "Mimic" with its own app id (so it
  installs beside Wolf Pack Mimic), local mode as the default, the Wolf Pack surfaces hidden (sign-in,
  wolfpack.quest links, guild tabs), and its own update channel. That channel must follow the alpha's
  pattern, one rolling release, because GitHub's release feed keeps only 10 entries and Deck builds once
  pushed the Windows betas out of it. Four costs: build about 2 days (Wolf Pack surfaces are many and
  spread across `main.js`, the dashboard and setup); maintenance low-to-medium (every new guild feature
  needs the edition check); runtime none; change low. Until then, today's installer works for anyone
  in local mode, and the pages say why it is named Wolf Pack Mimic.

### 119. PoP flags from the server's own scripts; Quarm's real gates; Justice marks (2026-10-01)

The guild lead, the day PoP opened: *"POP is open, we need the flags to start updating"*, then *"PLANE OF
STORMS REQUIRES flagging, but it shows everyone. We should also capture what they have specifically done
For Justice capture the Marks they have based on the one that they did"* (with a Mark of Execution
screenshot).

**Why nothing updated.** All 21,291 `pop_flags` rows were `unmapped`. The grant line never names the flag
and the bot could only name one from the boss killed just before it; the trials and the Tranquility
NPCs have no boss. Two more faults, found in the server's scripts (`eqemu_quest_scripts`):
- Elder Poxbourne prints **"You receive a character flag!"**, which the agent never matched.
- NPCs re-print the flag line every time a flagged player hails them (10 characters gave 30 Justice
  "grants" today), so counting lines counts nothing.
- And the bot stored the agent's **witnessed hails** as `unmapped` grants with the NPC thrown away.

**The fix: name flags the way the server keeps them.** Quarm's flags are ~20 character variables the zone
scripts set (`mavuin` 1–3, `fuirstel` 1–5, `thelin` 1–4, `zeks` 1–7, `karana` 1–4, …; the list heads
`poknowledge/Seer_Mal_Nae-Shi.lua`). A *stage* is one value of one of them (`mavuin_3`).
- **Agent 3.7.59** (`parsePopFlagLine`, same function on every path): both grant spellings and the
  checklist flag; the line just before the grant, **sent only when it opens like a flag NPC** (every
  script prints a fixed NPC line there); and Seer Mal Nae`Shi's guided-meditation sentences, one per
  flag held. Shipped to `main` as a scoped hotfix of the stable agent (3.7.54 → 3.7.59, this function
  only), so stable Mimics hot-swap it with no installer: PoP opening day with zero flags recorded is a
  broken stable. Beta carries it as 3.7.60.
- **Bot 3.1.182** (`utils/popFlagStages.js`): the NPC line → stage table, the recital table, zone-only
  names for single-grant zones (so older agents still resolve those), and `STAGE_IMPLIES` (what each
  stage proves in the catalog's terms). It writes a row for the stage and for each catalog flag it proves,
  with the new `stage` column; hails become `flag_key 'hail'` with the new `npc` column (migration
  `20261001220000_pop_flags_stage_npc`, applied). The boss map stays as the fallback.
- **Today's 42 grants stay `unmapped`**: they arrived with only a zone. Re-running Opt-in Logs over
  today's log with the new agent names them; so does one guided meditation with the Seer.

**Quarm's real gates (web 1.8.65).** `potranquility/player.lua` is the portal script, and Quarm switched
the level bypasses off. Valor AND Storms need `mavuin 3` (Storms showed everyone in); Torment needs
`fuirstel 5` and `thelin 4`; Thunder `karana` 3 or more (so Askr's medallion alone no longer counts);
Tactics `zeks` 2+; Sol Ro the cipher and `zeks` 6+; Air, Earth and Water `zebuxoruk 2`; Time the time
flag and level 65. `web/lib/popFlags.ts` gates now name those steps directly where no classic flag fits,
and every `levelBypass` is gone. `test/pop-flag-stages.test.js` pins each gate to the script.

**Justice marks.** The six trial marks are loot from each trial's last mob (ids 31796 Flame, 31842
Execution, 31844 Torture, 31845 Stone, 31846 Suffocation = Hanging, 31960 Lashing; 31599 The Mark of
Justice), and the agent already records loot: 7 Marks of Execution today. `/pop` shows them per character
from `looted_items` in Justice (zone 201; another "Mark of Stone" exists elsewhere) and from uploaded
inventories unless the character opted out (`exclude_inventory`): counts on the Justice card, names beside
each character on the Justice page, and a Marks column on My Characters.

**Privacy.** A grant now carries one NPC line, only from the allow-listed flag NPCs, and the Seer's
sentences. `docs/PRIVACY.md` and `/privacy` say so.

### 120. Quest tab: lines kept in a table; hand-ins that give a flag (2026-10-01, bot 3.1.183)

The guild lead, on Askr the Lost's Quest tab: *"This is missing the actual instructions"* — the tab
listed three hand-ins with "GET nothing listed" and no dialogue.

**Why.** Quarm's `pofire`-era Askr script keeps every line in `local RESPONSES = { … }` and says them with
`e.other:Message(0, RESPONSES[11])` or `RESPONSES[state]`; the reader only knew string literals. His
rewards are `SummonCursorItem` (the bag) and `set_global` (the Thunder flag steps), neither of which the
reader counted as "gives", and his three giant-head hand-ins sit in one `or` condition, so two of them
got an empty branch.

**The fix (`utils/questDialog.js`, `_npcInteract`).** String tables are read; a fixed index resolves, and
a variable index gives one line per value the `if`/`elseif` above allows. `SummonCursorItem` and
QuestReward's exp count. `or`-joined hand-ins share the branch, carry the same `group`, and the bot shows
a group's identical hand-ins once. A branch that sets a flag lists "a character flag" under GET. No
overlay change: GET already prints whatever outputs carry. Checked against a trimmed copy of the script
(`test/quest-dialog.test.js`); not yet against the live row, which needs a fresh `npc-interact` (6 h cache).

### 121. Trigger timing votes can be switched off (2026-10-01, agent 3.7.61 beta)

The guild lead: *"Need to be able to opt out for tts timing feedback."*

**What it covers.** After a callout the trigger overlay offers « Earlier / ✓ Good! / » Too early, and since
#207 the agent also reports each callout's ✕ and age-out. All of it lands in `trigger_timing_feedback`.
One switch turns off both halves, because asking and recording are the same thing to the person opting
out.

**Where it lives.** The agent keeps it (`_optinState.timingFeedback`, default on, absent = on) since the
agent is what uploads: while it is off the feedback route answers 200 and records nothing, and
`_recordCalloutFeedback` drops the agent's own ✕ / age-out paths too. Two ways to flip it: the dashboard's
Triggers tab (Timing votes card) and a 🔕 on the vote row, which is where the annoyance happens. The overlay
reads the switch every 30 s, so an overlay that has not caught up yet still sends nothing. No tray item,
so the tray ↔ dashboard rule is not touched. `docs/PRIVACY.md` and `/privacy` list the votes as an upload
with the way to switch it off.

**Beta only.** Stable agents keep asking. If it should reach stable before the next cut, the change is
agent + `triggers.html`, so the overlay half needs a Mimic build, not just the hot-swap.

### 122. PoP flags from /who; the checklist by progression level, closed, maps on hover (2026-10-01, beta `4f5e68e1`)

The guild lead: *"how are we updating the pop pages? from /who in the zone for users that don't have
mimic, and if they're in that zone that requires other zones we should note it. make the items a
checklist style instead of just a big block of text. group them by the progression level and give us a
side bar in that page. collapse them as well by default. in live map images when you roll over the map
icon on the guide page"*.

**How the pages were updating (the answer).** Only from Mimic: the flag NPC's line before each grant,
the Seer's recital, the boss-kill fallback, a looted Justice Mark, and uploaded inventories (§119). A
character whose owner does not run Mimic showed nothing.

**/who now fills that in.**
- `/who all` prints every visible player's zone, and any raider's Mimic uploads it (`who_observations`,
  zone as the server's short name). A character inside a gated plane passed its gate.
- `pop_who_sightings(guild, names, zones)` (migration `20261002010000`, applied by MCP; the same file on
  `beta` and staged for `main`) returns one row per character and plane: first and last seen, GMs
  skipped, service role only. About 90 ms for the whole roster.
- `web/lib/popWho.ts` decides what a sighting proves: the plane's gate, and, by following each gate flag
  to the plane it is earned in, the gates on the way in (Thunder → the shrine → Storms → the Justice
  flag). A server step proves what the bot's `STAGE_IMPLIES` says; `test/pop-who.test.js` keeps the two
  equal. Instanced copies are not counted (they show as "… (Instanced)"); it never takes a flag away.
- On the day it shipped: 26 of our characters seen in Storms, 6 in Valor, 3 in Thunder.
- `/pop`: those flags count everywhere. A gate only /who proves is a **blue ✓** whose tooltip names the
  plane and the planes passed through; the zone page adds "seen in Storms on /who"; the header counts
  them. The checklist ticks the flag steps (and Mavuin's information, the Tribunal and the Mavuin hail
  before the Justice flag) as "✓ seen on /who", and its sidebar names the planes.

**The checklist (both beta layouts, `?v=b` and `?v=c`).**
- Steps sit under their **progression level**: Before the planes, then the `/pop` chart's tiers in its
  colours, each naming its planes (`GUIDE_LEVELS` in `web/lib/popGuideMore.ts`).
- **Every level starts closed**, showing done / total, the must-haves, a bar and the next step. The
  sidebar opens the level you pick (Open all / Close all; a `#lvl-`/`#sec-` link opens itself).
- **Maps on hover:** 🗺 on a row and 📍 in a step's detail show the zone map with the NPCs marked; on a
  phone a tap opens it. Kept inside the window, closed on scroll.
- Read as: the production page (no `?v=`) was the "big block of text"; B already had the sidebar and
  closed detail, so the ask lands there. **B and C still wait on a pick**; graduating one deletes the other.
- Smoke-rendered from the real component at 1280 and 390 wide: no sideways scroll, the map opens on
  hover and on tap and closes again.
- **Cost:** build low (one component, one SQL function); maintenance low (levels derive from the chart);
  runtime one ~90 ms grouped read per page, maps drawn only on hover; change easy.

### 123. A plain /who uploads its zone; the eqmimic.quest demo; where eqmimic.quest can live (2026-10-02)

The guild lead: *"using /who all doesn't give us who is in my current zone. it gives every zone."* Then:
*"where is the standalone miMIC? is it on eqmimic.quest? individuals can use it locally. still uses the
wolfy miMIC logo, but generate a demo site around it with demo data that users could expect to see. you
may use obscured data from our guild's parses and whatnot. no who data. sample admin pages, etc."*

**/who, agent 3.7.62 (beta `5250261a`).** `/who all` puts each player's short zone on the row; a plain
/who (your own zone, the one people type) prints none there, only in its footer ("There are 12 players
in Plane of Storms."). The agent used the footer for the /who overlay alone (§73 kept it out of the
upload on purpose), so those rows uploaded with no zone: **7,263 of about 9,400 /who rows in two days**.
Now the footer's zone goes onto that run's rows in `whoData`, lower-cased, and the who flush runs even
when no new name appeared (a /who of people already seen used to upload nothing at all). This
**supersedes §73's "upload untouched"**: `who_observations.zone` now holds short names and lower-cased
long names, and `web/lib/popWho.ts` maps both (Ragrax shares "Plane of Earth" with the plane above it,
so a long-name sighting there proves only the outer gate).
**Hot-swapped to stable the same night** (the guild lead: *"hot-swap the /who fix to stable. we're not
raiding tonight."*): main's agent went 3.7.59 → **3.7.63** with only this change, so every stable Mimic
picks it up on its next agent check; beta's agent went to **3.7.64** so the beta line stays above it.
Pushed at 22:30 ET on a Thursday with `[hotfix]` (inside the freeze window; no formal raids until 10/14,
§113). ⚠ The agent's raid hold is schedule-driven (§115), so stable Mimics take 3.7.63 after 00:30 ET,
not at once, unless an officer sets `flag_raid_hold = 0`.

**The standalone Mimic (the answer).** There is no separate program: it is Mimic in local mode, in the
Mimic 2.7.7 beta from beta.7 on (§118). Pick "Run local-only" in setup. The download page that offers it
is at `hesstastic.com/eqmimic/` (A) and `/eqmimic/b/` (B). **eqmimic.quest is not live**: on 2026-10-02
it resolved to the registrar's parking address and failed TLS.

**Where eqmimic.quest can live (correcting §118).** §118 and the hesstastic README said to add the domain
to "the Vercel project that builds this repo". There is none: every deployment of the hesstastic repo is
`github-pages`, and a Pages site carries one custom domain (hesstastic.com). Two ways:
- import the hesstastic repo into Vercel as a project and add `eqmimic.quest` there; `vercel.json`
  already routes that host to `eqmimic/`; or
- a new `eqmimic` repo with the contents of `eqmimic/` at its root, Pages on, `CNAME` = eqmimic.quest.
Either way the registrar's DNS points at the chosen host. Both are the guild lead's steps (a cloud
session cannot create repos or Vercel projects, and the Vercel connector needs sign-in).

**The demo (hesstastic `e2d2f62`).** `hesstastic.com/eqmimic/demo/` is a tour of one raid night and
`/eqmimic/demo/b/` an app to click around, the same screens in two layouts (one gets picked, the other
deleted):
- **Overlays:** a real 7-minute fight (Xerkizh The Creator, 32 raiders) replayed in 48 seconds: the damage
  meter with your row pinned, timers, callouts, Target Info with the boss's real stats.
- **Mimic's control panel:** your fights, triggers, overlays, settings in local mode.
- **Guild site:** the raid night and every boss's parse.
- **Officer pages:** guild triggers (real game text), attendance, loot and DKP, members and their Mimic,
  bugs and ideas.
- **The data:** the 2026-09-24 Ssraeshza Temple night: damage per raider, boss stats, attendance over
  seven nights, the night's drops. Every character name is replaced by an invented one, checked against
  every name in `characters`, `who_observations` and `eqemu_npc_types` (four collisions dropped); the
  guild is "Lantern Watch"; dates move back eight weeks; ranks, DKP, Mimic versions and the bug reports
  are made up. No /who data is shown. The mapping is shuffled at random and never saved.
  `eqmimic/demo/tools/build-data.cjs` builds `data.js` from a private export (not committed) and
  refuses to write if a real name survives; a second scan of every published file found none.
- Both download pages now carry the wolf Mimic logo and link to the demo. Smoke-rendered at 1280 and
  390 wide: no console errors, no sideways scroll.
- **Cost:** build moderate (one shared panel script, two thin layouts); maintenance low (static,
  regenerated only when wanted); runtime light (~20 KB data, no requests); change easy (screens are
  functions).

### 124. Two raids at once: a raid is the one your Mimic's raid window names (2026-10-02, bot 3.1.184 · web 1.8.70 · agent 3.7.65 beta)
The guild lead: *"earlier tonight we had two concurrent raids running for flagging our members. the second
raid started nearly an hour or so after the first one. mimic should be able to report up the raid
structure from the Zeal pipe and if that varies from the rest of the raiders reporting we should be
taking note. that means that things like extended Target, buff queue, the in-mimic raid dashboard and
the wolfpack.quest raid page should reflect that. the site page can show that there are two or more
raids"*

**What the night's data showed** (counts only). 24 uploaders between 18:22 and 22:20 ET; two raid
leaders live at once for about an hour, one raid of ~16 and one of ~26. Mimic already reported the raid
structure (Zeal type 5, every member with group and rank); nothing new was needed from the agent. Two
things were wrong on the reading side:
- **Raids were told apart by shared members** (union-find in the buff queue and on `/raid`). Rows are
  upserted and never deleted, so a raider who moves across stays in the first raid's uploads for the
  15-minute window, and one move joins the two raids into one. 6 uploaders held both leaders' rows that
  night, so the two raids read as one.
- **Rank is text.** Zeal sends `Raid Leader` / `Group Leader` (48 `Raid Leader` rows, no `'2'`); `/raid`
  and the dashboard Raid tab looked for `'2'` / `'1'`, so no crown, no leader banner and no leader on a
  raid tab had ever shown.

**The rule now (`utils/raidGroups.js`, ported to `web/lib/raidGroups.ts`).** Every row of one upload
carries the same `captured_at`, so each Mimic's latest upload is the raid it is in now, and that upload's
`Raid Leader` names the raid. Uploads naming the same leader are one raid; every latest upload that night
named exactly one. Uploads older than 2 minutes have no say (a raid that ended is not a second raid); two
raids sharing 60% of their members are one raid mid leader-change (DESIGN-multi-raid.md §2). With one raid
every caller keeps its old code path, and the bot's responses are byte-for-byte what they were.

**Where it shows.**
- **Buff queue** (bot): your raid's members only; the payload names the raids
  (`raids: [{ key, leader, size, mine }]`) only when there are two or more.
- **Extended Target** (bot): the other raid's raiders and their targets drop out, even in the same zone;
  raiders in no raid stay. Same `raids` field.
- **`/raid`** (web, main): one tab per raid, labelled with its leader, "N raids at once"; the tab you
  picked stays picked when the other raid grows past yours (it was held by position before); crowns.
- **Mimic** (beta, agent 3.7.65): Extended Target's count line, the Buff queue, the Command Center and the
  dashboard Raid tab say "⚔ N raids at once" and whose raid they show; the Command Center's priest mana
  keeps to your raid while two run; the Raid tab's crowns.
- **Taking note:** the bot logs one `[raids]` line each time the set of raids changes. Nothing is stored:
  `raid_roster` is pruned hourly, so tomorrow nothing records that two raids ran. A per-night record (for
  the raid review) is a small follow-up if wanted.

**Design.** One design, inside the existing `/raid` tab strip and the overlays' existing count lines,
rather than variants: the tabs were already there and broken, and the overlays get one line each. If the
guild lead wants a page that shows both raids at once (officers watching two crews), that is the
alternative: build moderate, maintenance moderate (two of every panel), runtime about double the render,
change moderate.

**Not split yet, each its own call:**
- **Attendance ticks** take every fresh roster together, so one tick covers both raids. Whether a flagging
  raid earns the main raid's tick is a DKP question (DESIGN-multi-raid.md §8 kept DKP out).
- **The trigger relay** is guild-wide during the raid window, so a guild trigger fired in one raid plays
  on the other raid's Mimics.
- `/buffs`, the signup comp matcher and the essence queue still take everyone's names together; the
  `dedup_roster` election (off by default) keys by group number alone.
- A machine boxing characters in both raids sends whichever raid window Mimic read first in each flush.

### 125. 3.0: every overlay reproduced exactly on the Canvas, then taken apart (2026-10-02, alpha `a29075d9`, beta `5eae2d53`)
The guild lead: *"when we're done with the alpha 3.0 version every one of the overlays should be exactly
reproduced within the canvas so the people can disassemble them and use any element of them in the way
that they feel fits best on their screen. and in my mind we can take their exact layout with where their
windows are and arrange those pieces in a way that makes the most sense and takes up just the right amount
of screen real estate while getting out of their way so that they can play the game."* And: *"in its
current implementation the overlays as they exist outside of the canvas are not reproducible inside of the
canvas. that needs to be a priority before we can optimize anything else."*

**The call: parity first.** Every overlay reproducible inside the Canvas, exactly, before anything else is
optimised. Then any part of it can be pulled out and placed; later, Mimic arranges the parts around the
raider's actual EQ windows.

**The audit** (three read-only passes, every element a raider sees or uses, window chrome left out):

| Overlay | Elements | Exact as a parts.js piece | Data only (drawn differently, or no interaction) | Missing |
|---|---|---|---|---|
| DPS HUD | 21 | 0 | 7 | 14 |
| Tank | 22 | 0 | 13 | 9 |
| Threat meter | 12 | 0 | 4 | 8 |
| HUD (me) | 41 | 0 | 30 | 11 |
| Command Center | 24 | 0 | 13 | 11 |
| Target Info | 49 | 0 | 37 | 12 |
| Extended Target | 30 | 0 | 8 | 22 |
| Buff queue | 25 | 0 | 10 | 15 |
| CH chain | 27 | 0 | 8 | 19 |
| /who | 21 | 0 | 9 | 12 |
| Charm | 24 | 1 | 10 | 13 |
| Pets | 16 | 1 | 8 | 7 |
| Melody | 31 | 0 | 10 | 21 |
| Tick | 15 | 1 | 6 | 8 |
| PoP raid | 20 | 0 | 0 | 20 |
| **Total** | **378** | **3** | **183** | **192** |
| *Trigger overlay, loaded from its own page* | *19* | *18* | *0* | *1* |

The parts.js pieces (§103) redraw one value their own way, with no tooltips, no clicks beyond copy and
open, no per-row actions (dismiss, cure, rez), no speech, none of the page's own state (tabs, filters,
collapsed sections), different colour steps and number formats. The one overlay that was already exact on
the Canvas was the one loaded as its own page.

**Two ways to make every overlay exact:**
- **A. Cut each piece from the overlay's own page (shipped on alpha).** The page runs once per piece, with
  every other part made invisible and the panel cropped to its part. Same code, same look, same buttons, so
  exact by construction. Build low per overlay (a list of its parts; a mark only where a part has no class);
  maintenance low (one code path, and an overlay change reaches its pieces); runtime heavier (each piece is
  a page with its own poll); change low.
- **B. Rebuild every overlay from parts.js** (the 3.0 plan's end state, §102). Build very high (about 380
  elements with their interactions and speech); maintenance lowest in the long run (one engine); runtime
  lightest; change medium (every overlay hangs off the engine).
- **Taken: A now**, then B for single pieces only where the runtime cost is measured and matters. The two
  sit together in the chooser: parts exactly as drawn, and parts.js values drawn other ways.

**What shipped (alpha `a29075d9`; Target Info's marks on beta `5eae2d53`):**
- A Canvas piece kind cut from a page (`apps/mimic/sections.js`, `canvas.html` kind `sect`). It follows its
  part (grows, shrinks, steps aside with no target), keeps the card it sat on behind it, and A−/A+ and a page
  width size it.
- **✂ Take it apart** on a whole overlay: one piece per part showing, each where it was, moving together
  until one is Alt-dragged out. The chooser's **✂ Overlay parts** tab lists every part.
- One voice per overlay: copies of a page that speaks (Charm, CH chain) stay silent but one.
- **Target Info first:** 19 parts. Loot, Spells and F/Q/V pin their own tab; the other copies share the tab
  picked on the title-bar part.
- Checked in Chromium against a fake agent: the whole overlay and its parts side by side are identical.
- Limits:
  - an effect on the whole window (Charm's red flash) belongs to the whole page, not to a part;
  - the Command Center is served by the agent from another origin, so it cannot be cut until the Canvas
    loads the local `command.html`;
  - each piece is a page; measure on a raid night with the tray's Resource use.

**Next, in order:** section maps for the other 14: DPS HUD, Extended Target, Buff queue, Tank, Charm,
Command Center, CH chain, HUD, Tick, Pets, Melody, /who, Threat meter, PoP raid. Page state the parts must
share (the DPS/Tank/History tab, the buff class picker, the /who filters) follows Target Info's
sessionStorage pattern.

**Recorded for after parity: Target Info that keeps its context** (the guild lead, same message):
- *"as soon as you stop targeting that you lose the context"*: a history of recent targets with what they
  showed, and per-NPC quest steps you can tick off (*"a way to mark off or log the things that you
  specifically already did for that quest line with that NPC"*).
- Loot in context, without leaving the screen: hover an item for its stats; can this character use it
  (class, race, slot); could someone with you use it; vendor price; is it a tradeskill part
  (`eqemu_tradeskill_recipe_entries`), a quest item (`eqemu_quest_scripts`), a spell component, rare,
  worth a bag slot. Today the loot payload carries id, name, chance, raw chance, lore, the guild's win
  count, how many NPCs drop it and whether only this one does; items link nowhere and nothing checks
  can-use. Spell components are not mirrored (`eqemu_spells` has no component columns): a sync gap.
- Auto-arrange: read where the raider's windows are and place the parts to take *"just the right amount of
  screen real estate while getting out of their way"*.

**Found on the way:** Target Info's corpse "last fight" scoreboard read a key `/api/state` does not have,
so it never showed (fixed, beta `5eae2d53`). The threat meter's gold "your row" never lights for the same
kind of reason (queued as its own task).

### 126. A targeted player's timers on Target Info; FB-46, FB-47, FB-48 (2026-10-02, bot 3.1.185 · web 1.8.71 · agent 3.7.66 beta `a100da84` · alpha `9e33af91`)
The guild lead: *"When we have a known timer, for someone's disciplines or mend or area taunt, we should
display those on target info. When we're targeting them"*, and *"check the latest feedback too"*.

**What can be known, and from where.** Checked against the server source (EQMacEmu `zone/aa.cpp`,
`special_attacks.cpp`, `client_packet.cpp`) and `eqemu_spells`:
- **Disciplines:** everyone near the player sees the disc spell's `cast_on_other` text ("Brackwyn assumes an
  aggressive fighting style", "…'s fists begin to blur"). All 35 are unique in the catalog, so a seen line
  names the disc exactly. The reuse is estimated from their /who level (or the longest, at the unlock level,
  when the level is unknown).
- **Mend, Lay on Hands, Harm Touch:** the messages go to the user only. A bystander sees nothing.
- **AAs (Area Taunt):** `ActivateAA` starts the timer silently, and Area Taunt makes the mobs say nothing.
  The only line is the refusal, when pressed before ready: "You can use the ability %s again in %u
  hour(s) %u minute(s) %u seconds." It is exact. Reuse times sit in `aa_actions`, which we do not mirror.
So the player's **own Mimic** is the one source for all of them, and a seen disc covers players without it.

**Built:**
- Agent: your own timers of a minute or longer (disc, Mend, LoH, HT, AAs) ride live-state as `cooldowns`
  with absolute ready times (`_liveCooldownsFor`). A timer starting is a change-signature term; the
  countdown is not, so this adds one upload per timer started, not a stream.
- Bot: `character_live_state.cooldowns` (migration applied), sanitised on the way in and returned by
  `character-live-state`, the route Target Info already calls for a player target.
- Target Info: a row under the health bar (`target_timers`): ✓ ready, else time left, `~` when estimated;
  the tooltip says where it came from (your own character, their Mimic, or a disc you saw).
- AAs: the refusal line is read for any AA. `/pipe at` (or `/pipe area taunt`, `/pipe aa <name>`) on the
  hotkey marks the press, as `/pipe fd` does for Feign Death; the first refusal after a press teaches the
  reuse, and later presses count down from it.
- Alpha: "Their timers (a player)" is a Target Info part on the Canvas.

**Not done:** Feign Death, Taunt and Kick are under a minute and are not uploaded (back before anyone could
act). A player without Mimic shows only a disc you saw. Extended Target rows do not show these yet (asked
in the open table).

**The latest feedback (FB-46 to FB-48), all on the beta, `Fixes` lines in `a100da84`:**
- **FB-46** (Zeal update notice should link to the updater): the desktop notice opens Settings scrolled to
  Zeal (`openSettings('zeal')`, `settings.html#zeal`), and is now held so its click is not lost to garbage
  collection; the dashboard's notice has an "Open Settings → Zeal" button.
- **FB-47** (Send feedback refreshes and loses the text): Recent Parses sat inside `#dash`, so each kill
  rewrote `#dash` and rebuilt the feedback card empty. It has its own card now, and the card keeps the
  words, the bug/idea choice and the pictures if it is ever rebuilt.
- **FB-48** (an overlay's scale is back to normal after close and reopen, at the larger size): the overlay's
  own size slider saved under the bounds-key name (`mobInfo`, `extTarget`, `chChain`, `popRaid`,
  `panelBounds_<x>`) while every reader used the overlay name (`mobinfo`, …). Fixed for the slider and for
  the opacity in Setup THIS (same mismatch); sizes already saved under the old name still apply.

**Also from the screenshot:** the alpha's Target pieces read "slowed null%" and "0 / 0 HP" because the
pieces' number helper turned a missing value into 0. Fixed (alpha `9e33af91`).

**Feedback housekeeping:** FB-45 (the threat meter and a resisted Concussion) was closed by the loot-call
commit's `Fixes FB-45`, a numbering slip: that commit answered a different report. The threat question
itself is answered by §117 (a resisted spell still applies its hate on the server, so the meter is right
to drop). FB-43 (a "RIP" callout for an NPC killed by a pet) and FB-44 (more vertical bars, text on any
side) are still open.

### 127. HUD batch, auction timers, the main assist, XP events, back-to-back fights (2026-10-02, bot 3.1.186 + 3.1.187 · web 1.8.72 + 1.8.73 · agent 3.7.67 beta `d0a54a4d`)

One message from the guild lead with a DPS meter screenshot, then two more mid-work. Each ask, quoted, and
where it landed:

- **"what area in planes of power have a lot of mobs that we could aoe farm? plane of innovation?"** —
  answered from the spawn tables: yes, the Plane of Innovation's junkyard (many low-HP clockwork mobs close
  together); the Plane of Disease's pusling rooms second. The higher PoP zones are packed too, but with
  level 62–66 mobs of 25–38k HP, which is not AoE work.
- **"Enrage timer and TTS should go off at 10%, not 8% … when it ends, it should no longer be red
  underneath the name."** The HUD's red zone covers the last 10%; a spoken "Enrage soon" plays once per mob
  as your target crosses 10% (only for a mob that can enrage — the mob-info flag or the boss list), re-armed
  for a fresh mob of the same name. "no longer enraged" clears the red; the Tank overlay and Command Center
  drop the box; a death clears it all. The Tank overlay's threshold moved to 10% too.
- **"We need to rename DPS/Tank Meter."** Done everywhere the name shows (tray, Settings, setup screens,
  dashboard, the window's process name, the site, /parsehelp).
- **"the Thorns amount should show as wrapped in a thorny green area if it's druid DS or glowing lava if
  mage ds."** The Thorns amount is the HUD's damage-shield button (the DPS/Tank Meter has no DS figure). It
  is wrapped in a ring of green thorns for a druid/ranger shield and a glowing lava halo for a magician's,
  read from the shield you wear (else the last shield hit); the shield's numbers take the same colour.
  Static on purpose — a glow that pulses would pull the eye mid-fight. One design, not options: the ask
  named the look.
- **"when there's a rampage, it can be listed next to the main tank on the side as an arc … characters
  that are approaching 20% or less HP on the left side of the top."** The rampage target is a thin arc to the
  right of its target's arc; raiders at 25% or under ("approaching 20%") stack as arcs top left, lowest
  first, three at most, from the Zeal raid window and your group's bars — never you, never the dead, never
  the one already shown. Both are ⚙ parts ("Raid").
- **"there should be clicky counters for each item you have."** The HUD lists your clickies from your last
  `/output inventory` with charges left; each "Your X begins to glow" after the export spends one. ∞ for an
  item that never runs out. The catalog's `maxcharges` (column added and applied; the weekly sync fills it,
  and the bot now serves it) is what tells a 1-charge item from an unlimited one; until it lands, a 1 shows
  with no number. Nothing about the inventory leaves the machine for this. **Follow-up the same morning**
  (the guild lead: "quarmy has the charges per item I believe"): agent 3.7.68 (beta `a9934e62`) reads the
  Quarmy export too — same Count column — and the newer of the two exports wins (`_quarmyLocalItems`).
- **"add in loot auction timers on the control center as well as in the timers window for each individual
  one … as people bid when it's low time left, it does extend it further out."** The bot's auction panel had
  never carried an end time (it read `EndTime`; OpenDKP calls it `EndTimestamp`) — fixed in 3.1.186. The
  agent polls it (20 s, 10 s while one is open) and keeps one timer per auction whose end is re-read each
  poll, marked "extended" once a bid moved it; the Command Center has an Auctions section. Deliberately
  silent: four auctions closing together must not be four spoken warnings.
- **"when someone is declared as main assist in raid chat, their target should be at the top of the extended
  target list. And it is typically the person that has more targets than anyone's."** Bot 3.1.186 reads the
  declaration (`utils/mainAssist.js`) and pins the MA's target first; the overlay marks the row "MA" and names
  the MA in its header. With no MA declared, the most-targeted mob stays on top.
- **"observe group composition and xp totals for groups that are together during the day …" · "Also track
  when we have an XP potion on."** FB-37 option B: each experience line becomes one `xp_events` row (bars
  before and after, level, zone, loc, group, the mob just killed, Maelin's Magical Concoction up or not).
  `xp_events` had not reached production — the GitHub integration does not apply migration files pushed
  straight to `main` (the history holds only MCP-applied versions) — so it was applied by hand, in five
  steps (`xp_events`, two indexes, the read policy, the comment), because the MCP times out whenever
  `drop policy if exists` or `enable row level security` share a call with other statements. The committed
  file is the same DDL. The board that answers the question needs a week of rows first.
- **"This fight was backtoback with the same name. Kept the damage History should be much longer and
  specific if it's local or synced."** Cause, found by reading the code: a fight closes on the slain line,
  which is range-limited, and nearby casts kept the 120 s idle from ever firing, so the second
  "A brann geistlig" joined the first (479 s). Your own target window now closes the fight when its mob
  dies — its name turning into its corpse, or its bar hitting 0 under the same name — 1.5 s later, so the
  killing blow lands first. History: 30 fights (was 6), kept across a restart, one entry per pull (the dedup
  window was 60 s, which also swallowed a real second pull), each marked **local** (never left this
  machine), **sent** (uploaded, guild numbers pending) or **synced** (guild numbers in). The guild numbers
  are now asked for by the fight's start (bot 3.1.187), not just the mob's name.

**Defaults picked, for the guild lead to confirm (open table):** XP events kept 30 days (the bars and the
mob, not a log); raid XP stored with its kind but kept out of the group-composition answer; the rows are
readable by signed-in members only, like every guild table. Clicky counters show no number until the
weekly sync fills `maxcharges`.

**Not done:** the XP board (needs data); a "RIP"-style split for a mob you did not have targeted (the slain
line still covers it when in range); clicky charges for items whose inventory export is older than the
glows we saw (counts start from the export).

### 128. Mark of the Plague Lords turns the shield OFF; a Boastful Bellow timer; Fading Memories answered (2026-10-02, bot 3.1.188 · web 1.8.75 · agent 3.7.69 beta `a66d208d`)

The guild lead, with a screenshot of the debuff on a tank whose HUD still read "DS 23": *"how long does
faded memories last for? Note that this debuff exists for damage shield reduction and should be reflected in
the hud and overlays"* — then, mid-session: *"add Boastful Bellow AA as a timer for Bards that have the AA"*.

- **The debuff is not a reduction, it is an off switch.** Mark of the Plague Lords (spell 1067: SPA 59
  base **+50**, 3m12s, PBAE range 50, unresistable) reads "Decrease Damage Shield by 50" in game, but the
  Quarm server's spell-bonus sum (`zone/bonuses.cpp`, `SE_DamageShield`) lets a positive value REPLACE the
  shields already summed, and skips any shield after it. A positive total then runs the "healing shield"
  branch of `Mob::DamageShield` (`zone/attack.cpp`): **each melee hit that lands on the wearer heals the
  attacker 50**, and item and AA shields never get added (they only join a negative total). So the HUD's
  "DS 23" was wrong twice: the shield returns nothing, and the mob is being fed. Mark of Karn (+6, a cleric's
  spell on a mob) is the same mechanic pointed the other way. Nine catalog spells carry a positive SPA 59.
- **Where it landed.** The bot's spell catalog carries the positive value as `ds_heal` beside `ds` (it used
  to drop it as an "NPC guard mechanic"). The agent's `_dsOffFrom` reads it off any buff list; while one is up
  `_knownDsPerHitFor` is 0 (so the anonymous-hit settle stops crediting shield hits), `/api/me` and
  `/api/tank-state` carry `off` {name, heals, seconds}. HUD: the DS button goes red, dashed, "DS OFF" with
  the time left. Tank overlay: the card leads with the debuff and its time, says "each hit heals the mob 50",
  and strikes the worn shields through; the mini box reads "DS OFF" in red. One design, in the family the
  thorns/lava button already set; the alternative was a struck-through number that kept the shield's value,
  rejected because it reads as "still 23, slightly less".
- **Boastful Bellow.** Reuse **18 s** (Quarm `aa_actions` row for AA 592, spell 3282 — a 10–50 magic nuke
  with a short stun). It is instant, and the server sends the begin-cast only when `cast_time > 0`
  (`zone/spells.cpp`), so no "You begin casting" line exists. Started by the resist line ("Your target
  resisted the Boastful Bellow spell.", seen only by the caster), or by "<mob> is shaken by a loud bellow."
  paired within 1.5 s with your own "You hit <mob> for N points of non-melee damage." — the landing alone is
  seen by every bard near the mob, and raids run several. Bards only. An early press's refusal line corrects
  the same timer rather than opening a second AA slot. The HUD shows **BB** once a bard has used it (the
  pipe does not carry AAs owned — use is the proof), kept 12 hours past ready like the other timers. The
  Triggers tab has a "Boastful Bellow reuse" timer bar, off until ticked, per character.
- **Fading Memories (the question).** It has **no duration**. It is the bard PoP AA (6 points, one rank),
  costs **900 mana**, and its reuse is **1 second** (`aa_actions` aaid 630: reuse_time 1, nonspell_mana 900,
  nonspell_duration 0). The server runs `Escape()` (`zone/client.cpp`): you are wiped from every NPC's hate
  list and made **invisible** — ordinary invisibility, held until you break it (attack, cast, and so on), not
  a timed buff. A rogue gets hide instead. Mana is the limit, not a timer.

**Not done:** the sibling path in the raid card's spell decode (`_spellFxMap` takes `Math.abs` of SPA 59, so
a positive value would read as a shield there) — left alone, it never sees the Mark today; the bundled
local-mode spell snapshot gains `ds_heal` only when it is next regenerated.

### 129. Fifteen more suggested triggers, and four that could never fire (2026-10-02, bot 3.1.189 · web 1.8.76 · agent 3.7.70 beta `e2f06f69`)

The guild lead: *"We need more in suggested triggers, like failed feign death and spell resisted <spell name -
mob name>"*.

- **The rule this ran on: every line is the server's own text, checked, never written from memory.** The
  source of truth is EQMacEmu `zone/string_ids.h` (server messages) and `eqemu_spells.cast_on_you` (spell
  landings). That check is what found the dead ones below.
- **New (15):** Feign Death failed (`STRING_FEIGNFAILED`, "%1 has fallen to the ground." — said with your OWN
  name, so the pattern is `{c} has fallen…` and a monk beside you does not set it off); a spell broke your
  feign; immune to slow / snare / stun; cannot be mezzed (both forms); cannot be charmed (both forms); your mez
  wore off; your slow / root / snare wore off; your fear wore off; you are silenced; no line of sight; out of
  range; not enough mana; invisibility fading.
- **Resists name the mob.** "Your target resisted the %1 spell." never names it, so a new alert word,
  `{mytarget}`, fills it: your Zeal target when you began casting THAT spell (recorded on "You begin casting"),
  else your target now — an instant spell has no begin-casting line, `zone/spells.cpp` sends the begin-cast
  only when `cast_time > 0` — else "your target". "RESISTED: Tashanian — a gnoll warlord". The immunity alerts
  use the same word. A saved row still reading "RESISTED: {1}" is updated on load.
- **Wearing off names the spell, never the mob.** `zone/spell_effects.cpp` `BuffFadeBySlot` sends the caster
  `SPELL_WORN_OFF` ("Your %1 spell has worn off."), with charm and fear spelled "charm" and "fear". So "your mez
  wore off" says which mez, not which mob. A "worn off of <mob>" string exists in the client's list but this
  server never sends it.
- **Dead and fixed (4).** "You are snared / rooted" waited for "You have been ensnared/rooted/bound",
  "mezzed / charmed" for "You feel calm/charmed", "feared" for "You are afraid" — none appears in any spell. The
  real landings run to 70+ snare texts, 30+ mez, 30+ root, 16 fear. So those three now match **by the spell's
  effect**: the bot catalog carries `cc` (mez, charm, fear, stun, root, snare, slow, silence — SPA 31, 22, 23,
  21, 99, 3 negative, 11 under 100, 96) and the agent fires when a line is the landing text of a spell with
  that kind (`catalog_match`). A text that a spell WITHOUT that kind also prints is left out, the Blind Mode
  rule. "Interrupted" read "Your spell interrupted"; the server prints "Your spell is interrupted." Saved rows
  move on load (exact old pattern only; an edited one is the member's).
- **Not touched, and unverified:** the five "your buff dropped" suggestions read "Your Clarity spell has worn
  off." The server sends that line to the CASTER of a DETRIMENTAL spell only; a buff fading on you shows the
  spell's own fade text ("The cool breeze fades."). Whether the client also prints "Your … spell has worn off"
  for your own buffs is not settled from the code here, and fire history has no evidence either way. Left as
  they are; one look at a log when Clarity drops settles it. "You are stunned" is unverified for the same reason.

**Not done:** the buff-drop question above; a stun "on you" by catalog (161 landing texts — wired the same way
when wanted).

### 130. The October 1–2 server patch notes against the platform (2026-10-02, bot 3.1.190 · web 1.8.77)

The guild lead posted the server's patch notes for October 1–2 and asked us to consume them (§63a did the same for
the July–September notes). Each change, what it touches here, and what was done:

- **PoP corpses move after an hour** — guild instances to the Plane of Tranquility graveyard, open-world
  PoP zones to their own graveyard; a failed Plane of Justice trial's corpse to the Tribunal; Thelin's hedge
  maze corpses with the players; the PvP instance keeps its 30-minute timer. **Done:** the corpse DM now
  says when (an hour after death) and where, for zone ids 200–223 less the Plane of Knowledge and
  Tranquility. Listed by id: the catalog files the Crypt of Decay and the Plane of Justice under expansion 0.
  It cannot tell an instance from the open world (same zone id), so it names both. Both the stable and beta
  agents already send the zone id, so this reached everyone with the bot deploy.
- **Xanamech has no lockout; existing lockouts cleared; Nitram ready as soon as the flagging window ends;
  Nitram can't be killed once Xanamech is up.** The board has Xanamech at **72 hours**, now simply wrong
  (the §63a open question — 66 or 72 — is moot). Not changed: taking a boss off the board changes the
  visible board, and a kill of a boss not in `bosses.json` posts "not in timer database — use /addboss" to
  raid chat. Recommended: remove him from the board. `character_lockouts` held **no** Xanamech rows
  (checked), so nothing to clear.
- **Rallosian Glory death broadcasts reworded:** "Name <Guild>", shorter, Glory lost and gained stated;
  kills by an NPC, unworthy kills and forfeits now report Glory lost and the zone. Our parser reads the OLD
  wording (`PVP_GLORY_RX`, `PVP_GLORY_WORTHY_RX`). The newest parsed row is 10:00 UTC Oct 2, still in the
  old wording, so either the patch was not live yet or new lines are being missed. A line the parser can't
  read is not lost: the agent's `captureUnmatchedPvpKill` saves every unparsed Rallos / Glory broadcast to
  `logsync.pvp-unmatched.json` beside the agent. **Not changed, deliberately:** writing a pattern from the
  notes' description is the invented-pattern failure (CLAUDE.md, trigger rules). One real line fixes it, and
  the new lines carry the guilds, so /who will no longer be needed to fill them in.
- **Classic–Luclin raid targets also respawn in the open world** (instances stay; open-world spawns are
  not GM-enforced, racing allowed). Two things touch us:
  - **Risk:** the board is guild-INSTANCE timers, fed by "Druzzil Ro tells the guild, '<X> of <Guild> has
    killed <Boss> in <Zone>!'". If our guild kills an open-world copy and Druzzil says the same thing, the
    bot starts the instance timer on the board. Whether the line differs is unknown until our first
    open-world kill.
  - **Possible feature, the guild lead's call:** open-world spawn windows for those targets. The server's own
    respawn time and variance are in `eqemu_spawn2`; another guild's kill is not broadcast to us, only
    seen if someone is there.
- **Reduced open-world respawns are back.** Any respawn time we quote from the database is the full
  timer; the real one can be shorter. Applies to the AoE-farming answer and the map below.
- **Terris Thule:** adds despawn on reset or her death; pulling her out of the chamber wipes hate and heals
  her. **The Tribunal hands back items. Plane of Sky's 13 quest NPCs move again.** No repo text mentions
  any of these; nothing to change.
- **`#pvpzone quake <luclin|pop> <on|off>`:** quakes can now include or leave out an expansion. Our quake
  tracking reads the quake broadcast; it is unaffected until that wording changes. Watch for it.

### 131. Our own zone map: the website first, then a Mimic overlay — queued, not started (2026-10-02)

The guild lead, on whether we can render our own map instead of Zeal's, with NPCs, pathers and aggro / call-for-help
rings: *"A then B, but not yet. Queue them."*
- **A — website map** (`/map/<zone>`, reusing the PoP guide's `ZoneMap`): every spawn point by family,
  aggro and assist rings from `eqemu_npc_types` (giants 60 / 80, some Vind 100, storm guardians 400),
  pather routes as dashed lines, a floor filter, name / level / respawn on hover.
- **B — Mimic overlay**, reusing A's drawing: the same layers plus live dots for you, your group and raid
  from Zeal (already sent). It owes the full overlay parity checklist.
- **Prerequisite for both:** mirror the server's `grid` and `grid_entries` (pather routes; Bastion of
  Thunder alone has 469 waypoints on 30 routes) into the weekly eqemu sync. Walls need EQ map files or a map
  pack whose licence is checked first; the current outline is inferred from spawn points.
- **Not in scope:** live NPC positions. That is ShowEQ territory, which the server's rules likely forbid;
  ask staff before anything shows them. Respawn labels carry the §130 caveat (reduced respawns).
- The reasoning behind the giants' call-for-help, which the map is meant to make visible: EQMacEmu
  `NPC::CallForHelp` / `EntityList::AIYellForHelp` (zone/aggro.cpp): an engaged or fleeing NPC calls on
  engage and every 3 s (`AIassistcheck_delay`); any NPC within ITS OWN assist radius of the caller, with
  line of sight, answers when it shares the primary faction or lists the caller's faction as an ally
  (`npc_value` 1). All four greater-giant families list each other, so any giant answers any giant. An
  answerer does not call in turn (`IsAssisting`), so adds come from wherever the first giant goes.

### 132. Xanamech off the board; every Rallos Zek line read (2026-10-02, bot 3.1.191 · web 1.8.78 · agent 3.7.71 beta `c82ae5b4`)

The guild lead, answering §130's two questions: *"1. yes"* (take Xanamech off the board) and *"2. attached"*,
the agent's `logsync.pvp-unmatched.json` from their machine.

- **Xanamech is off the timer board.** No lockout since the Oct 1 patch, so the 72 h timer was wrong.
  - `data/bosses.json` entry removed. The PoP thread still has three board panels, so the board edits
    in place with no repost.
  - The website's `bot_boards` row still has to be deleted by hand. The mirror only upserts, so a removed
    boss's row stays on /boards until someone deletes it. The deployed bot no longer writes it (its
    18:23 UTC mirror left the row at 17:36). The delete from the cloud session timed out twice, probably
    waiting for an approval nobody could give: `delete from bot_boards where boss_id = 'xanamech_nezmirthafen';`.
    ⚠ `/removeboss` has the same gap; queued as a separate task, not fixed here.
  - `bosses_local.timer_hours_override` set to null (it said 72). The row stays: the guide page and
    encounter matching still use it, and he is still a raid target.
  - A kill relay naming him now says *"no lockout — not on the timer board"*. It no longer asks an
    officer to `/addboss` him back. The list is `_OFF_BOARD_NO_LOCKOUT` in `index.js`.
  - Test: `test/xanamech-off-board.test.js`.
- **The unread lines: 168 Rallos Zek broadcasts, Sep 28 – Oct 1, no pattern read any of them.** Each family
  was checked against the whole file; all 168 now parse.

  | Line | Count | Read as |
  |---|---|---|
  | "looks on as X falls to `<NPC>` in `<zone>`, but grants no Glory." | 87 | a death to an NPC (`killType: 'npc'`), as Druzzil's "has died to" used to be |
  | "looks down in disgust as X [`<Guild>`] falls to `<NPC>` in `<zone>`." | 60 | the same; the newer wording carries the guild |
  | "looks down in disgust as X falls in `<zone>` without a worthy foe." | 1 | a death with no killer named |
  | "… X flees / abandons the battlefield like a cowardly dog, surrendering 1 measure of Rallosian Glory." | 13 | a forfeit (`killType: 'forfeit'`), not a death |
  | "exults as K cuts down V in `<zone>` and claims 1 measure of hard-won Glory. K now bears 1 of 10." | 1 | a Glory-worthy kill |
  | "marks K with his favor for spilling V's blood …" | 6 | already read since agent 3.7.51; these came from an older agent |

  - **NPC and zone split at the LAST " in ".** Checked in `eqemu_zone` and `eqemu_npc_types`: no zone name
    has " in " or a period in it, but one NPC does ("a lady in waiting"). Padded NPC names
    ("Emperor Ssraeshza  in") come out trimmed.
  - **Guilds:** a guild the line names is kept. `_resolveGloryGuilds` now fills only a side the line left
    null. Old agents always send null, so their behaviour is unchanged.
  - **What the bot does with each:**
    - NPC deaths: a `pvp_deaths` row (`killer_is_npc`) and a plain ☠️ post in #pvp. This is what the
      Druzzil wording got before the PoP patch, so #pvp gets roughly 50 of these a day back.
    - A death with no killer: a death row, and a ☠️ post with **no** backup ping. `isWpDeath` now
      needs a killer.
    - A forfeit: a 🏃 post. No death row and no assist credit.
    - The worthy kill: a kill like any other.
  - **Not yet seen:** the Oct 2 wording the patch notes describe ("Glory lost and gained stated"). The
    newest line in the file is Oct 1 11:36 UTC. The patterns allow a guild after any name, and a trailing
    clause on the NPC-death and no-foe lines, but nothing was written for wording nobody has seen.
    Unread lines still land in `logsync.pvp-unmatched.json`.
- **Reach:** beta Mimic only until a stable cut. After updating, Opt-in Logs over Sep 28 onward sends the
  missed deaths. Backfill rows record but do not repost to #pvp.
- Tests: `test/pvp-glory.test.js` (each family, invented names) and `test/pvp-glory-bot.test.js`
  (line guilds kept, NPC/no-killer deaths recorded, forfeit not, the 🏃 post).

### 133. Buff queue headers take the click; an update no longer opens over the game (2026-10-02, beta `16bf4795` + `0bd27df1`)

- **Buff queue (FB-49).** The guild lead: *"i do not see my mouse over the buff queue and can't click
  it"*, and FB-49 *"Buff queue is not clickable for opening these sections"*.
  - Sections start collapsed, so a header is the first thing clicked. A header is a `<div>`, and the
    preload's hover handshake arms the window only over `button, a, input, select, textarea,
    [role=button], [data-wp-interact]`. On a locked overlay the click went to EQ.
  - Why the cursor vanishes: the game draws its own cursor and blanks the Windows one over its window
    (§13). Over a click-through overlay the game's cursor is drawn UNDER the overlay. The Windows
    pointer shows only where the overlay takes the mouse.
  - Fix: the header carries `data-wp-interact`. The rest of the panel stays click-through, as every
    overlay's body does. Rule added to the CLAUDE.md parity checklist.
- **Crash on update (FB-50).** A member, stable 2.7.6: *"crash game when starting it up while already
  have game running"*. The guild lead: *"i believe they went to update and it crashed"*.
  - Evidence: the old build's last upload was at 01:57:35 UTC. The game log (attached to the report)
    stops mid-raid at 01:57:44. The same characters upload from the new version afterwards. No crash
    dump was uploaded.
  - Cause: only the unattended install-on-EQ-close path set `pendingSilentRelaunch`. A clicked "Restart
    to install update" relaunched with the main window shown and focused. That was deliberate (*"they
    asked for it and expect the window back"*), but a player who clicks it and goes back to the raid
    has the window land over the game. Taking focus from a fullscreen DirectX 8 game is the classic
    way to crash it. Most likely, not proven.
  - Fix, in the NEW build because the old build ran the update and sets nothing:
    - `createMainWindow` records `lastRunVersion`. A changed version, or an existing config without
      the mark, is the first run after an update.
    - On that run the window starts hidden. `_checkEqRunning` decides: EverQuest closed → the window
      shows; EverQuest open → tray plus a silent notification.
    - A brand-new install, autostart and the unattended path are unchanged.
    - This protects the update that delivers it: 2.7.6 → the next stable starts quietly.
  - Ruled out by a read of the startup path: nothing writes Zeal, DLL or UI files without a guard,
    nothing sends input or messages to the game window, and nothing kills it. Not changed, possibly
    related: the screen-setup prompt is a modal dialog with no parent, and a fullscreen game changing
    the display mode can raise it over the game.
  - `test/mimic-update-relaunch.test.js` runs both new blocks against fakes.
- **A test with a fixed date.** `test/suggested-triggers-more.test.js` (§129) wrote its log lines with a
  fixed "Fri Oct 02 21:10:01" stamp, and `{mytarget}` trusts a "You begin casting" line for 15 s only.
  It passed the day it was written and failed from the next morning. It now stamps lines with the
  current time.
- **Feral Avatar / Savagery timers, asked, not changed.** The guild lead: *"we need the timer on these
  feral avatar and savagery in the queue"* — the time left on targets.
  - Today a target already carrying the buff shows ⏳ on the Shaman or Beastlord's ⚡ queue.
    Auto-class follows the EQ window in front, so on a boxed monk the section is not there at all.
  - One real gap found: a raider not running Mimic is timed from the catalog, 65 ticks, but Zeal
    reported **102** ticks on a raider tonight (buff-duration AAs). So after about 6.5 minutes the
    queue moves them back to "needs it", with no timer, for the last ~3.5 minutes they still carry
    the buff.
  - Waiting on the guild lead to say which view and character showed no timer before changing either.

### 134. The website stops saying PoP is locked; stable Mimic 2.7.7 (2026-10-02, web 1.8.80 · Mimic 2.7.7 · agent 3.7.71)

The guild lead: *"go through the site and remove all the locks from pop release, or mentions of things not
being available yet. please roll out a fresh stable release"*.

- **The PoP sweep (web).**
  - Raid guide index and boss pages: the date lock (`POP_UNLOCK_MS`), the 🔒 and the "locked until
    2026-10-01" banner are gone. They had stopped rendering on Oct 1; this removes the dead code.
  - /pop: the "(Preview)" title and badge are gone, and the empty state no longer says "PoP unlocks
    2026-10-01".
  - Missing spells: PoP spells are no longer greyed out or labelled "locked until Oct 1, don't chase it
    yet". The count reads "PoP"; the PoP pill stays as a label.
  - Gear: PoP AAs join "Available to train"; the "+N more arrive with PoP (locked until Oct 1)" line is
    gone.
  - The bot-board runbook text and two comments updated.
  - Left as they are, on purpose: roadmap entries (they are history), dated incident notes, the lockouts
    page (raid lockouts, not PoP), and the bot's own `isPopLocked`, which is date-based and has done
    nothing since Oct 1.
- **Stable Mimic 2.7.7, agent 3.7.71.** File-level promotion from beta `b5684da0`:
  - `apps/mimic/` and `packages/wolfpack-logsync/` byte-identical to beta, plus their tests.
  - **Not promoted:** the website previews still on beta for the guild lead's pick — the about page,
    the PoP guide redesign, the Essences queue, /who flags, PvP fights, tradeskills, Zeal icons — and
    their nine tests. `test/pop-planner-mains-alts.test.js` keeps main's version.
  - Gate on the promoted tree: 384 test files, 5,118 tests, lint, the dashboard check, golden logs.
  - Carries everything since 2.7.6 (agent 3.7.55–3.7.71). That includes the §133 update fix, so updating
    2.7.6 → 2.7.7 is the first update that starts quietly in the tray while EverQuest is open.
  - Repeats FB-46, FB-49 and FB-50 so the bot marks them implemented.
  - Beta re-parks at 2.7.8.
- **The website deploy was skipped once, and why.** The sweep (web 1.8.79, `aab72c65`) and the stable
  commit (`7dcba505`) went up in one push. Vercel builds only the push's last commit, and its Ignored
  Build Step (`git diff --quiet HEAD^ HEAD -- .`) saw no `web/` change in that last commit, so it
  skipped the build and the sweep never deployed. Fixed by web 1.8.80 on top. Rule added to
  CLAUDE.md: a push whose last commit does not touch `web/` deploys nothing for the website, even if
  an earlier commit in the same push did.

### 135. New pages go live marked [beta]; beta pages come with links; Sonnet agents do the scoping (2026-10-03)

The guild lead, opening an eight-part request: *"for research or preliminary coding you need to do spin
up sonnet agents. first, give me the links for beta pages when you reference them. I'm not always going
to scroll through beta to check. push them up to live to start if it's a new page that didn't exist
previously, and mark the page as a [beta] at the top so people know it's new. we can iterate over the
preview b.wolfpack.quest for new versions of existing pages unless I say to make main changes."*

- **A new page ships to `main`, with a `[beta]` marker at the top.** A route that does not exist on
  `main` no longer waits on `beta` for a pick. Changes to a page that already exists keep iterating on
  `b.wolfpack.quest` until the guild lead says to put them on main. This narrows the 2026-09-04
  "never straight to production" rule to existing pages. CLAUDE.md updated.
- **Every beta page I mention comes with its link** — `https://b.wolfpack.quest/<path>`, with the `?v=`
  for a variant.
- **Scoping and first-draft code go to Sonnet subagents**, several in parallel. The shipping session
  still reviews, runs the gate and writes the docs. CLAUDE.md has the rule.
- **The two new pages that were waiting on beta went live (web 1.8.81):**
  [`wolfpack.quest/zeal-icons`](https://wolfpack.quest/zeal-icons) (and layout B at `?v=b`, with a page
  per guild) and `wolfpack.quest/db/recipe/<id>`. Both carry the tag, built once as
  `web/components/NewPageTag.tsx`, and their titles and link previews start with `[beta]`. The recipe
  page is linked only from the item page's beta layouts, so on production it is reached by its
  address until the item page graduates. Everything else on beta is a change to an existing page
  (about, the item page, /pop, /pop/guide, /pvp) and stays there.
- The other seven parts of the same message are below as they land (§136 onward).

### 136. Command Center: every raid's leader and player count (2026-10-03, agent 3.7.72 beta `1af59bd6`)

The guild lead: *"command center could use raid overview information (raid leaders and player counts)
for when we have multiple raids going."*

- With two or more raids, the Command Center's one-line note ("⚔ 2 raids at once · yours: …") becomes a
  **Raids card**: one row per raid with 👑 leader and player count, yours first (green, "yours"), then the
  biggest. The header reads "⚔ 2 raids · 43 players" and collapses like the other sections.
- **No new data or request.** The bot already names every raid on the buff-queue payload when there are
  two or more (§124); the overlay only showed yours. With one raid nothing renders, as before.
- Not added: zone or class mix per raid. The roster has no zone and no raid id; zone would need a join
  to live state that covers only Mimic users. Ask if wanted.
- A raid shows only if one of its members runs Mimic, and drops off two minutes after its last upload.

### 137. Crash review moves to the Diagnostics tab (2026-10-03, agent 3.7.72 beta `1af59bd6`)

The guild lead: *"crash reporting should be on the diagnostics tab of mimic"*.

- The whole Crash review card (the "Automatically send crash reports" checkbox, Review my crashes, the
  results) now leads the 🩺 Diagnostics tab. Nothing about it changed; the auto-review still runs once when
  crash files exist.
- **Reverses 2026-08-13**, when the card was put on Info on purpose. The tray toggle still drives the same
  setting.
- Not built (offered by the scoping pass, not asked for): a per-crash "send this one" button and a
  sent/not-sent badge. They need an agent endpoint and a privacy-copy check, since reports are opt-in.

### 138. Extra PoP spells: an officer list (2026-10-03, web 1.8.82, migration `20261003150000`)

The guild lead: *"extra PoP spells. when someone does a turnin for their new spells and gets one they
already have, put that into an officer only list so we can help direct who needs it."*

- **New page, so live with the tag:** [`wolfpack.quest/admin/extra-spells`](https://wolfpack.quest/admin/extra-spells),
  officer only (`requireOfficer` + the admin layout), one card on `/admin`.
- **Phase 1, from data we already hold.** No turn-in log line has been captured, so the page cannot see the
  hand-in itself. What it does see: one of the 225 PoK trainer reward scrolls (`pop_parchment_pools`) in a
  character's inventory export, whose spell that same character's spellbook export already lists. Each row
  gives the holder, bag slot, both export times, and who still needs the spell in the same first-dibs order
  as /pop (it calls `pop_spell_needs`, so the order cannot drift). 3 rows on the first run.
- **Stale rows are possible:** a scroll scribed after the last inventory export stays until the next one.
  Rows whose spellbook export is newer than the bags say "check".
- **Opt-outs:** holders with `exclude_from_stats` or `exclude_inventory` are skipped, as are needers with
  `exclude_inventory`. That is stricter than the older spell-exchange list, which ignores both.
- **Access:** the function is executable by the service role only (revoked from public, anon and
  authenticated). The older `pop_spell_needs` and `guild_held_spell_needs` keep the default grant; they are
  not security-definer, so table RLS still governs what they return.
- **Phase 2 needs the guild lead:** a dozen raw log lines from one hand-in to a PoK trainer (ideally one that
  gave a duplicate). With those, the agent can record the moment of the turn-in, and the list can track
  "passed to X". Until then the list depends on members exporting inventory and spellbook.

### 139. Mimic's Loot tab: who looted what, and who looted a roll (2026-10-03, bot 3.1.192 · agent 3.7.73 beta)

The guild lead: *"the loot tab on mimic should have the 'who looted what' section on there for items, as
well as the rolls for loot."*

- **Who looted what · last 12 hours**, a new section on the Loot tab: time, looter, item, zone, newest
  first, with a day line where the date changes. Each agent only sees its own "You have looted" lines, so
  the list comes from the bot: server-panel key `night-loot` (bot 3.1.192, live), the guild's
  `looted_items` for 12 hours plus the roll sessions, cached 60 s for the whole guild.
- **Rolls:** a roll set someone other than the winner looted now says "📦 looted by <name>". The merge is
  the one the Discord rolled-loot card and `/rolls` already use (`utils/rollLoot.js`), not a third copy.
- Polls only while the Loot tab is open or a raid window is on (the bidding card's gate), every 30 s.
- No `exclude_from_stats` filter on read, matching `/rolls` and the Discord card: an excluded character's
  own agent never uploads its loot or rolls.
- Open for the guild lead: the Rolls card still lists only the rolls this Mimic heard; the guild-wide
  sessions are in the panel and could be listed. The Command Center's rolls row does not show "looted by".

### 140. Traders and characters under 46 leave the character lists (2026-10-03, agent 3.7.73 beta · migration `20261003120000`)

The guild lead: *"low level characters do not need to show up on the pop flag page. all of my traders and
mule characters destroy my views anywhere we display all of our logs."*

- **The rule (`web/lib/listableChars.ts`):** a character is left out when its guild rank is Trader, or its
  level is KNOWN and under 46 (the lowest PoP zone-in level). A non-trader nobody has a level for stays
  listed: hiding a raider because nobody /who'd them is the worse mistake. Level is the higher of /who
  history and the highest scribed spell (`me_levels`).
- **Where (beta):** [b.wolfpack.quest/pop?view=mine](https://b.wolfpack.quest/pop?view=mine) (My Characters,
  your spells needed, the spellbook picker, sightings, and the spell-needs table), with "Show all (N
  hidden)" (`?all=1`); [b.wolfpack.quest/pop/guide](https://b.wolfpack.quest/pop/guide) (character picker);
  [b.wolfpack.quest/me](https://b.wolfpack.quest/me) (they move into the existing collapsed "more" sections,
  nothing removed); the Mimic dashboard's Watched characters and Replay log picker ("show N low-level").
- **Not filtered, on purpose:** `/me/inventory`, `/quartermaster`, mule uploads (a mule's bags are the point
  there), and the dashboard's Watched Logs diagnostic. `/me/ui` is left as it was; say if it should follow.
- On today's data the rule hides 52 of 556 characters: 36 traders and 16 others under 46.
- The dashboard knows levels but not ranks, so a trader with no known level still shows there.
- **`me_levels` sped up** (migration `20261003120000`, applied): it matched names with `ilike any()`, a full
  scan (7 s for 170 names); `lower(name) = any()` uses the existing indexes (53 ms), same rows. `/me` gets
  the same speed-up.

### 141. The PoP overlay gets a Quests mode (2026-10-03, Mimic beta `b84e25b8`)

The guild lead: *"the pop overlay should include the quests and a mode for selecting them and all of the
things to say or do for any of the pop quests or flags so we can reference them."*

- A **Slides / Quests** toggle in the PoP overlay's title bar. Quests mode lists every step of the website's
  PoP guide (78, grouped by the guide's levels and sections); pick one or walk them with ◀ ▶. Each shows who
  to talk to and where, with copyable `/map Y X`, `/sit` and `/say …` chips, hand-ins ("give … → get …"), and
  what to expect. Mode and choice are remembered. Slides mode is unchanged.
- **One source, no second copy to drift:** the website's `web/lib/popGuide.ts` + `popGuideMore.ts`.
  `npm run sync:pop-quests` writes `apps/mimic/pop-quests.js`; `test/pop-quests-sync.test.js` fails when it
  is stale.
- **The missing words, filled from the quest scripts (beta `48048dd6` + `4c7dbe24`):** the guide now has 83
  steps and 86 things to say (from 78 and 43). Every phrase is one of its script's own `findi("…")`
  keywords and carries the script path (`src`); `test/pop-guide-steps.test.js` holds them to that. Filled:
  Poxbourne, both Fuirstel visits, the hedge maze (outside, inside, the dagger hand-in), Tarkil Adan, Giwin,
  the last Mavuin hail, Fahlia and Tylis, the three Halls of Honor trials, Nitram's factory trade, Muon's time
  machine, and new steps for Maelin's cipher, "lore" and "information" (the Zek notes) and Miak in
  Tranquility. Valor's globe and the Sol Ro wings are clicks, with their spots.
- **Still words-free, on purpose:** the boss projections (every one only answers "hail"), and a few steps
  whose NPC is spawned by a script or wanders (no fixed spot).
- **Found while filling, not changed:** the flag map's note on `zebuxoruk_2` ("Karana's and Mithaniel's
  notes") reads like `zebuxoruk_1` in Maelin's script ("lore"); `zebuxoruk_2` comes from "information" after
  the Zeks. The factory "key" is a flag from hailing Nitram after Xanamech, not an item. Aerin`Dar's projection
  needs the last Mavuin hail too. The flag map is marked verified by the guild lead, so it was left alone.
- All of it is upstream SecretsOTheP quest scripts; Quarm may differ in places nobody has checked.
- Because `popGuideMore.ts` is still a beta file, this graduates to stable only with the guide's beta
  layouts, or after that file moves to main on its own.

### 142. Canvas presets are the real overlays; the HUD ring, and its builder, on the Canvas (2026-10-03, alpha `5adafea8` · agent 3.7.74 beta)

The guild lead: *"on alpha the canvas versions of existing overlays don't match the real overlays. they have
many of the elements but they are so spread out. the canvas elements themselves do not all have to be prim and
properly squared off with no overlay. the margins around the actual data is too large. the HUD overlay's circle
mode is unconstructive (or meant to be) but the canvas version is a bunch of small dials. we need the ability to
craft the circular HUD, but we also should have the default HUD circle view in canvas. when I look at an overlay
outside of the canvas or choose it as a preset within the canvas they should be extremely close to being
identical."*

- **Why they differed:** every preset in the chooser's Groups tab was a stack of re-made pieces (`parts.js`), not
  the overlay. The real pages were only under "Whole overlays".
- **Now a preset IS the overlay:** choosing one puts the real page on the Canvas (same code, so a change to an
  overlay reaches its preset). Each preset row keeps an "as pieces" chip for the old stack, and ✂ Take it apart
  still works. Fifteen overlays are mapped; group, timers and target tabs stay pieces (no overlay of their own).
- **Margins:** on the Canvas each overlay page drops its window padding and the gutters it kept for its own ✥/✕
  (the panel owns those), and an overlay panel has no plate, border or padding — the data sits at the edge. A
  preset is fitted to its content as data arrives (it only grows); the panel menu's "↕ Fit to content" is exact.
  The Command Center's half is on beta (agent 3.7.74) because the agent serves that page.
- **HUD ring:** "HUD (ring)" is the default HUD preset: the real ring, one piece. "HUD (box)" is the box. Both are
  the same page pinned to a look (`?wpstyle=hud|a`), and either can be on the Canvas once.
- **Craft the ring on the Canvas:** the panel menu's "⚙ Build the ring" opens the HUD's own builder; the panel
  widens beside the ring instead of the window resizing. It edits the same per-character ring as the HUD window.
- Not verified in Electron (only in tests and a headless load): how each trimmed page looks, the builder's widening
  and click-through on a locked Canvas. Two calls for the guild lead: should "＋ Overlay → HUD" also mean the ring
  (it does not yet), and fit-on-add only grows (an empty page would otherwise shrink to a sliver).

### 143. Hide from lists; no-known-level characters folded; the spellbook upload fixed (2026-10-03, web 1.8.83–1.8.84 · bot 3.1.193 · agent 3.7.75 beta · migration `20261003170000`)

The guild lead: *"spellbook upload is screwing up the upload. put any unknown characters into a minimized area
and make it so I can hide these characters from anything but account inventory"*, then, with a phone screenshot
of b.wolfpack.quest/pop: *"clarification on breaking the page"*.

- **The page break (live, web 1.8.83):** the "Submit a spellbook for [character] [Upload spellbook]" row on
  /pop sat in a box told never to shrink, so on a phone it ran past the card and the whole page scrolled
  sideways. It wraps now. Production had the same bug.
- **A second upload bug found on the way (live, web 1.8.84):** the upload accepted a character only if its own
  Discord link matched yours. Alts often have none, so 11 alts linked through their main were refused with "not
  your character". It now falls back to the main, the rule the /me switches already used.
- **Hide from lists (beta):** a new switch per character on [b.wolfpack.quest/me](https://b.wolfpack.quest/me),
  "Hide from lists". A hidden character leaves every character list — /pop, the PoP guide, /me's main list,
  Mimic's Watched characters and Replay picker — and still shows in account inventory, the quartermaster and
  every upload. /me keeps them in a closed "Hidden by you" section with Unhide. Column
  `characters.hidden_from_lists` (applied); display only, it stops nothing being collected. The bot passes it to
  Mimic with the other character prefs (3.1.193).
- **No known level → minimized (beta):** characters nobody has a level for are no longer listed with the rest;
  they fold into a closed "N characters with no known level — upload a spellbook or get them seen in /who"
  section (/pop, /me, Mimic) or a "No known level" group at the bottom of a picker (/pop/guide).
- **The spellbook picker keeps everyone**, grouped: your listed characters, then "No known level", then
  "Hidden". A spellbook upload is how an unknown character gets a level, so the filter must never block one.
- Not changed: who may flip the switch is the owner (or the owner's main's account) only, like the other /me
  switches; officers have no bypass there.

### 144. The PoP pages go live; stable Mimic 2.7.8; the release posted to #raid-chat (2026-10-03, web 1.8.85 · Mimic 2.7.8 · agent 3.7.75 · bot 3.1.194)

The guild lead: *"push this up to live. then cut a new stable release of mimic with the new things that we put
in."*, then *"post the release to raid chat"*.

- **Web 1.8.85, file-level from beta:** /pop, /pop/guide and /me with their libs and tests, as they stood on
  beta — the character tiers and Hide from lists (§140, §143), the spellbook picker that keeps everyone, the
  guide's words from the quest scripts (§141), and the /who-proven flag marks (§230's work). ⚠ Those files also
  carry two unpicked previews, the guide redesign and the Essences queue; on production they are reachable only
  at `?v=b` / `?v=c` and change nothing by default. They are still waiting on a pick, not graduated. Left on
  beta: /about, the item page, /pvp.
- **Stable Mimic 2.7.8 (agent 3.7.75), `d2862878`:** apps/mimic and packages/wolfpack-logsync byte-identical to
  beta, plus `scripts/sync-pop-quests.js`, the `sync:pop-quests` script line and their tests (dashboard-tabs,
  listable-chars, night-loot-section, pop-overlay-quests, pop-quests-sync, raid-split-agent). Gate: 398 files,
  5,370 tests, lint, check:dashboard, golden logs. Pushed alone so the release body is its own (verified). No
  FB numbers since 2.7.7. Beta re-parked at 2.7.9 (`52526491`).
- **Raid chat:** bot 3.1.194 `_announceMimic278Once`, the 2.7.1 card's shape — one embed, pings nobody, posts
  only once v2.7.8 carries its installer (it did), latched in `bot_kv` `announce_mimic_2_7_8_raid_chat`.
- **Found and fixed on the way:** a `web/node_modules` symlink had been committed to beta in a sync-resolution
  commit (`9d0510a5`): `node_modules/` matches only directories. Removed, and `.gitignore` now also ignores a
  bare `node_modules` (`d1522e16`, on main with 2.7.8).
- **Next, building:** members ticking their own PoP flags on /pop without Mimic (§145).

### 145. Members tick their own PoP flags on /pop (2026-10-03, web 1.8.86)

The guild lead: *"I need [a way] for people to be able to check off their own flags for their own characters
outside of using mimic or relying on someone else with mimic to do it. they could do it on the matrix page or
somewhere else that makes sense."*

- **Where:** [wolfpack.quest/pop?view=matrix](https://wolfpack.quest/pop?view=matrix) and
  [?view=mine](https://wolfpack.quest/pop?view=mine). Each gate cell on a character you own is a small button:
  tap "—" and it becomes a gold ☑ (your word); tap again to take it back. Torment and Sol Ro need two flags, so
  one tap ticks both. Other members' cells stay plain marks.
- **Proof outranks a tick:** a flag Mimic recorded (green ✓) or /who proved (blue ✓) shows that proof and is not
  a button. A gate is only as proven as its weakest flag.
- **It counts everywhere** a flag counts: the chart (☑N beside the count), the planner, the zone page, the Flags
  column. A legend sits under both tables.
- **One store, no new table:** a tick is a `pop_guide_ticks` row — the guide step that grants the flag, or
  `flag:<key>` when no step names it. So a tick on the PoP checklist counts on /pop, and a tick on /pop shows on
  the checklist. Same ownership gate as the checklist (your account and family).
- **One design, live**, not options: it is a change to an existing page the guild lead asked to go live, inside
  the page's own look.
- **Open, for the guild lead:** the checklist's "Win a trial" step carries the Justice flag, but Justice also needs
  the Mavuin hail, so ticking that one step counts as Justice (which opens Valor and Storms). Moving the flag to
  the hail step would be one data edit. Three flags (`fuirstel_5`, `thelin_4`, `hoh_trials`) have no checklist
  step, so a /pop tick for them does not show on the checklist.
  ⚠ **Superseded the same evening:** the guild lead asked for exactly that move (§147).

### 146. Loot proves PoP flags (2026-10-03, web 1.8.87, migration `20261003190000`)

The guild lead: *"if anyone has looted any distinct items from any of the planes we should go through and flag
them up to that plane"*.

- **The rule:** loot is presence proof, the same as a /who sighting. A character that looted something inside a
  plane stood in it, so it holds that plane's gate and every gate on the way in. Two sources, one RPC
  (`pop_loot_sightings`, service role only):
  - **looted** — `looted_items` (the agent's own "You have looted" line, self-only) whose Zeal zone id maps to a
    plane. Verified: the zone column is the numeric zone id as text and maps cleanly through `eqemu_zone`.
  - **inventory** — a NO DROP item that drops in exactly one zone, that zone a plane, and no quest reward, in an
    uploaded inventory. The same rule as the keyed-zone inference (`locked_zone_evidence_for`), so "distinct"
    items are covered whether or not the loot line was captured. Honours `exclude_inventory`.
- **Shown as a purple ✓** ("Looted in <plane>"), counted wherever a /who proof counts (chart, matrix, planner,
  My Characters, zone page), and the guide checklist auto-ticks it ("looted there"). Precedence: Mimic (green) >
  /who (blue) > loot (purple) > the owner's tick (gold ☑). Purple therefore means "the loot is the only proof".
- **Measured on production after applying:** 71 (character, plane) rows across 38 characters — Bastion of Thunder
  25, Storms 38, Valor 8; nothing yet in the other planes. Every one of those flags was already proven by Mimic
  or /who, so no purple ✓ shows today; it appears the first time someone loots in a plane before /who places them.
- **Not changed:** the plane list is the /who table's (`WHO_ZONE`); the open planes (Justice, Disease,
  Nightmare, Innovation) prove nothing, and an instanced copy is not counted. A test keeps the SQL list and the
  site's list equal.

### 147. The PoP guide in script order; the Justice and Bastion flags where the server sets them (2026-10-03, web 1.8.88 · Mimic beta)

The guild lead: *"some of the steps require you to hail after something else or say a line multiple times. the
hand in items should be in order with the text we say to them"*, *"we say continue twice for the plane of storms
quest for bastion of thunder"*, *"move the justice flag to the mavuin hail step. the flagging for bastion of
thunder REQUIRES you to enter the zone from plane of storms after doing the turnin. find other instances of
this"*.

- **One ordered list per step.** 65 of the 83 guide steps carry a `seq` (313 acts: hail / say / give / get / kill /
  click / zone / wait / note, with "×N", "repeat until …" and "sit first"), every act cited to the
  `eqemu_quest_scripts` file it was read from. A test checks every say is one of its script's own keywords and
  every item is a real id and name. Drawn as one numbered list on
  [wolfpack.quest/pop/guide](https://wolfpack.quest/pop/guide) (and its `?v=b`/`?v=c` previews) and in Mimic's
  PoP overlay Quests mode (beta). Askr is the model case: the head, "it was me", "paying attention", "continue"
  **twice** for the bag, the three parts, the sealed bag, "bastion of thunder", the meld. Sage Balic's
  "continue" twice and the Seer's "unlock my memories" until nothing new are the others.
- **The Justice flag is the Mavuin hail's** (as asked): the hail is the server's mavuin 3, which the Storms shrine
  and the Tranquility portals check. Every Mimic-recorded Justice flag is that stage (36 rows).
- **The Bastion of Thunder flag is the shrine click's** (the same rule, applied by this session): Askr's meld is
  karana 2, and only the shrine click (`postorms/player.lua` door 4) makes it karana 3. Every Mimic-recorded
  Bastion flag is that stage (31 rows), so the flag moves from Askr's step to "Click the shrine". A tick on
  Askr's step alone no longer opens the Bastion on /pop.
- **A recorded flag ticks the steps it needs** (Mimic now, as /who and loot already did): the Justice flag ticks
  the trial, Mavuin's information and the Tribunal; the Bastion flag ticks Askr's step. A looted Mark still names
  the trial more exactly.
- **Flags finished by a click or a zone-in, not by the NPC** (the "other instances"), each now the last act of its
  step, read from the zones' `player.lua`:

  | Where | What finishes it | Step |
  |---|---|---|
  | Storms shrine (door 4) | Askr's flag + Justice → the Bastion of Thunder | Click the shrine |
  | Valor (door 3) | Aerin`Dar's flag → the Halls of Honor | Zone into the Halls of Honor |
  | Halls of Honor (doors 19/20) | all three trials → the Temple of Marr | the last trial |
  | Nightmare (portal 59) | Thelin at 2 → the Lair of Terris Thule | Thelin's hedge maze |
  | Disease (the pit) | the Grummus flag → the Crypt of Decay | Grummus |
  | Earth A (doors 9–11) | the Earth B key → Earth B | the Arbitor |
  | Innovation (door 145) | Zebuxoruk 2 + Quintessence → Time | Muon |
  | Solusek Ro tower (doors, the pit) | each wing's cauldron; then the lava pit → Fire | Sol Ro's minis; Solusek Ro |
  | Tranquility portals | Mavuin 3 → Valor/Storms; Zeks → Tactics, Sol Ro; Fuirstel 5 + Thelin 4 → Torment; Zebuxoruk → Air/Earth/Water | the Mavuin hail; the Behemoth; Maelin; Poxbourne/Fuirstel |
- **Text corrected on the way:** the four elemental gods' items come from "Essence of Fire / Air / Water / Earth",
  not "A Planar Projection" (the scripts spawn them; the NPC table agrees); the hedge maze's hail is Thelin 2, and
  the Lair opens on the portal click.
- **Open, for the guild lead:** (1) Aerin`Dar's flag could move to "Zone into the Halls of Honor" the same way
  (the door click is aerindar 2), but the bot still records it from the Aerin`Dar kill, so a move would tick the
  door step from a kill — left where it is. (2) Relv in Storms also takes "continue" twice; it has no guide step.
  (3) Gram Dunnar's charm has no quest script in our mirror, so it keeps its old says. (4) The win conditions of
  the second and third Halls of Honor trials are a note only.

### 148. Options carry a few-word "what makes it different"; Discord setup belongs on the website (2026-10-04)

The guild lead, answering the onboarding A/B/C (`docs/DESIGN-onboarding-overhaul.md`, 2026-10-03 refresh):
*"when you ask me a/b/c I need you to give me a few word view of the suggestion, what makes it different or
special.. I feel like the discord setup is probably frustrating for people. setting up the threads should
just be a spot in the website, wolfpack.quest and then permissions reviews, scheduled tasks, etc"*.

- **Rule, standing:** every option offered for a pick leads with its letter, a short name and a few-word
  line on what makes it different, before any mock or cost. Landed in CLAUDE.md under the reply-shape rule.
- **Direction:** the bot's Discord setup — which channel or thread each card goes to, checking the bot's
  permissions, the scheduled jobs — should be a place on wolfpack.quest, not env vars and Discord commands.
  Same line as "Discord is a projection" (2026-08-16) and the self-host wizard epic. Being mapped; options
  follow in the same shape.

### 149. Buffs grouped by raid group, on /buffs and in the buff queue (2026-10-04, bot 3.1.195 · web beta · Mimic beta)

The guild lead: *"we should be grouping people for buffs on https://wolfpack.quest/buffs — treat that like the
buff queue as well"*.

- **The rule everything rests on:** in this era a GROUP buff lands on the CASTER'S OWN group (no Target
  Group Buff before Omens of War; Quarm's behaviour unverified, and the wording is right either way). So a
  hint only ever names a caster IN the group that is short ("Haste ×4 → Corvale: Vallon's Quickening"), or
  says nobody there can ("no enchanter in G3", meaning single-target it or move someone). Never "an
  enchanter somewhere in the raid".
- **Bot 3.1.195 (live):**
  - `raid-buff-queue` gains `groups[]`, built from every raid member before the 40-row caps, plus
    `self_group` and per-line `classes`. Pure builder: `utils/buffGroups.js`.
  - `GROUP_SPELLS` (`utils/raidBuffs.js`): the group version of each line per class, with the level it
    needs. A caster is named for the best spell their level allows. All 28 ids verified in
    `eqemu_spells`: targettype 41, except Kazad`s Mark, which is 3.
- **Keyword gaps fixed** (they read as "missing" before):
  - the Marzin / Naltron / Kazad marks;
  - Focus of the Seventh, Vallon's Quickening, Spirit of Bih`Li (the backtick never matched), Spirit of
    Eagle;
  - Spirit of the Predator, Spiritual Vigor (attack) and Spiritual Dominion (mana regen, verified by its
    effects);
  - Boon of the Clear Mind, Maelstrom of Ro and Aegis of Ro.
  - Comments corrected: Aegolism, Temperance and POTC are single-target; Khura's Focusing is group.
- **Website, beta previews** (default page unchanged):
  - [b.wolfpack.quest/buffs?v=b](https://b.wolfpack.quest/buffs?v=b) — **Group cards: one card per raid
    group**, each saying who's short and who in that group can cast it.
  - [?v=c](https://b.wolfpack.quest/buffs?v=c) — **Buff lines: one section per buff**, listing the groups
    that need it.
  - Both split by raid first: two raids both have a group 1.
  - Fixed for all three views: the freshest roster row wins. A regroup used to show a stale group for up
    to 15 minutes.
  - `web/lib/buffGroups.ts` carries the same `GROUP_SPELLS`; a test fails if the two tables differ.
- **Mimic beta (the buff queue overlay):**
  - a **By buff | By group** switch;
  - By group puts your group first, with the caster hints;
  - By buff clusters each buff's people by group;
  - mini adds the group that needs each buff most.
- **Open, for the guild lead:** pick ?v=b or ?v=c.
- **"Ungrouped" settled from Zeal's source** (2026-10-04, §150's research): `named_pipe.cpp` sends
  `"0"` for `kRaidUngrouped` and `GroupNumber + 1` otherwise, so groups are 1–12 and 0 is ungrouped,
  which is what all three surfaces already assume.
- **Left alone, on purpose:**
  - Spiritual Purity sits in HP slot C though it is a regen buff;
  - `UPGRADE_CHAINS` still spells Bih`Li without the backtick;
  - Mark of the Predator is uncategorized.

### 150. Our own players' levels fill in on /who and Target Info (2026-10-04, bot 3.1.196 · agent 3.7.76 beta)

The guild lead, with a /who overlay screenshot: *"We shouldn't have a gap in our own players levels."* Two
of ten guildmates, both /anon, showed an italic class and no level.

- **Why it was blank:** who-lookup's class came from the guild roster or an override, neither of which
  carries a level, and the history pass that does carry one ran only for names still missing a class.
- **History alone would have been wrong:** one of the two had last shown 59 in /who (September 28) and
  reported 64 from their own Mimic that day. Planes of Power raised the cap in between.
- **Bot 3.1.196 (live):** a new pass asks `latest_character_levels` (migration `20261004120000`, applied
  to production in the same session) for every name:
  - the newest level the character's own Mimic uploaded to `xp_events`;
  - the last non-anon /who level from `who_observations`.
  - The highest of those wins (levels only rise).
  - It reads `who_observations` on its own index, about 3 ms for 10 names, not through the
    `who_directory` view, which scans the whole table at about 1.4 s. That is why the history pass was
    left alone.
- **Agent 3.7.76 (beta):** `_zealLevelFor` takes the exact level from Zeal, no older than 2 minutes:
  - raid data always carries it;
  - group data only with `/pipeverbose` on.
  - It fills /anon rows on /who and outranks history.
  - On Target Info and the /who card it ranks after a live /who and before an even con, with no
    "(last seen)" tag.
  - Group mates' levels in the experience log fill the same way.
  - An /anon row that still carries a level from before the person went anon gives way to a newer one.
- **Verified on production:** all ten people in the screenshot now resolve: the two blanks to 60
  (history) and 64 (their own Mimic).
- **Privacy:** an /anon guildmate's level now reaches other guild Mimics, the same GUILD scope their
  class already had. Their own Mimic uploaded that level already (the group XP analysis reads it).

### 151. The guild lead's recent Zeal crashes are on the fork's test build (2026-10-04, agent 3.7.77 beta)

The guild lead: *"i've had a number of zeal crashes lately that i can't tell if they're from my test versions
or from the main version, please look into them"*. Read from `crash_reports` (639 rows since 2026-08-03).

- **How a build identifies itself:** the crash dialog's `Zeal Version: 1.4.8 (<label>)`, stored
  verbatim in `crash_reports.zeal_version`.
  - An official release labels it with the bare short commit hash (`create_release.yml`).
  - Our fork's CI build uses `testall-<hash>` (`build-test-all.yml`).
  - A hand build uses whatever was typed (`testall`, `pr229`), or `UNOFFICIAL`.
  - ⚠ `agent_upload_stats.zeal_version` drops the label, so fleet-wide fork vs official can only be
    read from crash rows.
- **What it found:**
  - All four crashes the guild lead uploaded since 2026-09-20 were on fork or test builds; none on
    official since 2026-08-14.
  - **Three are one new signature:** `eqgame.exe` at `0x00520EFF`, last Zeal callback
    `CleanUpUI : Exit`, game state 1 (leaving the world for character select).
    - On 10-01 (twice) and 10-02, all on `1.4.8 (testall-0a2e25d)`.
    - Seen nowhere else in the corpus: no other player, never on official.
  - The fourth (09-25, `Zeal.asi` at Startup) is the fork init-order bug already fixed (§28).
- **Not proven:**
  - The fault is in the client's own code (between `MountEQPlayer` and `GetFullZoneName`), so naming the
    function needs the dumps.
  - The fork runs code in that teardown window at two points: `NamePlate::handle_entity_destructor`
    reads the entity's name for saved player tags, and the CleanUI path releases tag-picture textures.
  - In all three crashes the freed `Self` entity was overwritten with pixel-like bytes; official-build
    teardown crashes still held a real zone id there.
  - The NVIDIA driver also changed in the same weeks (a confounder).
  - The newest test build changes neither path, so updating is not a fix.
- **Shipped:** Mimic's crash list (Info → Crash review) printed the version only in a closed fold.
  Each crash's title now carries **"Zeal official"** or **"🧪 Zeal test build"** (`wpZealBuildTag`,
  agent 3.7.77, beta).
- **Next:**
  - The guild lead A/Bs on official Zeal for a few nights, or runs `/tag persist off` on the fork. Not
    both changes at once with the driver.
  - A local session reads the three dumps (STATUS, ⚠ Needs a local session).
  - Fork change only after one of those points at the fork's code.

### 152. PoP overlay round: Justice trials as folds, one-line "What to do", text size, fixed height, the mouse (2026-10-04, web data on main · Mimic beta)

The guild lead, from overlay screenshots: *"The Justice Trials each could use their own subsection … The What to
do is wordy. … Needs a text size slider, and it jumps around when resizing, and also doesn't like to always show
the mouse over it."*

- **Data** (`web/lib/popGuide.ts`, `popGuideMore.ts` → `scripts/sync-pop-quests.js` → `apps/mimic/pop-quests.js`, in
  one commit as the sync test requires):
  - **Justice trials:** the step gains six `parts`, each verified against `The_Tribunal.lua`, the trial
    encounter scripts, `eqemu_spawn2` and the bosses' 100% Mark drops. Each part carries its Tribunal's
    `/map`, the three says, the boss and the Mark.
    - "Stoning" and "Hanging" are the right words to say, though the Marks are Stone and Suffocation.
    - Each Tribunal answers only its own trial.
  - **Briefs:** 23 steps get a `brief` of 120 characters or fewer: every step whose detail runs over 300
    characters, Justice included. Detail and Expect are untouched.
  - The website does not draw `parts` or `brief` yet.
- **Overlay** (`apps/mimic/popraid.html`, beta):
  - The six trials fold under IN ORDER.
  - WHAT TO DO shows the brief, with the full text under "More".
  - An **Aa** slider (80–160%) zooms the text only (`wp:pop:fs`).
- **The jumping:** the window refitted to every step's height on each ◀ ▶, and a tall step ran off screen
  with no scroll.
  - Fixed height is now the default, 480 px (`wp:pop:height`): the content scrolls, a grip sets the
    height, and double-clicking the grip fits it.
  - The who.html pattern.
- **The mouse:** EQ hides the Windows cursor over its own window, so a click-through overlay shows no
  pointer over its text.
  - In fixed mode the card now takes the mouse, so the pointer shows over the text and the wheel scrolls
    it. The trade-off: clicks over the card no longer reach EQ.
  - Every clickable summary, row and link gained `data-wp-interact`. Without it, the preload's mousemove
    disarmed the window after a hop from a button, so a click fell through to EQ.
- **Waiting on the guild lead:** the catalog navigation (era → plane → step) is an option pick in
  `docs/DESIGN-history-and-quest-nav.md`. It needs one plane tag per step, because the data has none.

### 153. Meter history credited the wrong things; fixed, and it keeps 100 fights (2026-10-04, agent 3.7.78 beta)

The guild lead: *"damage/tanking meter could have more history in it. Make sure the history correctly attributes
pet data to owners and DS hits from tanks."* An audit drove the real code; every bug below was behind green
tests whose fixtures encoded it.

- **Threat, not damage:**
  - History (`_recordFightHistory`), the Target Info corpse list and the HUD's "this fight" / "tonight"
    added swing + proc + spell. That is threat: taunts, proc and cast hate, and 120 per resist.
  - Repro: a tank who dealt 100 showed 1,961 and topped the board.
  - All now read raw `dmg`.
  - Zoning mid-fight also dropped you from History; fixed by the same change.
- **Pets:**
  - History never folded pets into owners (the live meter does). Once the guild numbers settled, a pet
    counted twice: 1,009 shown on a 909 fight.
  - History also lost the "(pet)" label, so an unowned pet was pasted into /rs as a raider.
  - Both fixed: `_histRows` in overlay.html runs the live fold, and drops a guild row for a pet whose
    owner this machine knows, because the bot folded it already.
- **Charm breaks:** a charm pet whose charm broke before the kill vanished from the live meter and from
  History.
  - It now falls back to the proven-pets list the upload already uses.
  - Accepted trade-off: that mob's damage after the break also credits the charmer, as the upload
    already does.
- **Backfill:** a background (silent) log backfill could stamp the live fight ended and record it into
  History. Gated.
- **Damage shields:** correct for one wearer, in live and History. Known limit, unchanged: when two tanks
  are hit in the same second, the shield credit goes to the last one hit, since the log line does not name
  the wearer.
- **More history:**
  - 100 fights, up from 30.
  - Kept in `logsync.fights.json` for 7 days across restarts. It used to survive only a restart within
    10 minutes.
  - Fetched from `GET /api/fight-history` only while History is open. `/api/state` keeps a 10-fight
    digest, which alpha's `fight.history` part reads.
  - Each fight now also stores damage taken and the biggest hit, for a Tank history whose layout is an
    option pick (`docs/DESIGN-history-and-quest-nav.md` §2).
- **Not yet:** saved fights keep only rows with damage dealt, so a tank who dealt none has no row. That
  is for the Tank-history build to decide.

### 154. /fun crash card: a /quit can be forgiven, and only real raid nights count (2026-10-04, web beta preview)

The guild lead: *"since this is a fun item, Peopleslayer should be able to override Linkdeaths if he used /quit
or /q to leave the game. it looks like a crash but it happens much faster"*, then *"also last night wasn't a
real raid"*. The card showed "1 raid since", counting a Saturday group night.

- **Why it has to be manual:**
  - The LD comes from other raiders' logs ("<name> has gone Linkdead.").
  - A /quit drops the connection exactly like a crash, so no log can tell them apart.
- **Override:**
  - "It was a /quit" sits next to the card's Last LD line, drawn only for the Discord account that owns
    the character or an officer (`isOfficer`).
  - The server action re-checks that, and refuses if the LD on screen is not the one it would mark.
  - It merges `{quit, by, at}` into `fun_events.detail` on every row within ±2 minutes, since several
    raiders upload the same LD. No migration.
  - A row arriving later within 2 minutes of a marked one is forgiven too.
  - Forgiven LDs drop out of last LD, raids-since, the record and the lifetime count. The card says
    "N /quit forgiven", and "Undo /quit" takes it back.
- **Raid nights:**
  - "Raids since" and the record now count `raid_nights` dates he took part in. That table holds all 228
    raid nights since 2025-01, all Sun/Wed/Thu, written by the bot at the first fight of each raid.
  - An encounter maps to the Eastern date of (start − 5 h).
  - The two old encounter queries were silently capped at 1,000 rows; he has 1,739. Now `selectAll`.
- **Display:** the card stays up top at 0 ("0 raids since" is the joke), not in "Quiet for now".
- **On today's data:**
  - Unmarked, the card reads 0. The Oct 3 LD stands, and no raid night since.
  - Once the Oct 3 LD is marked a /quit, it reads 3 (Sep 24, Sep 27, Oct 1) since the Sep 14 LD.
- Files: `web/lib/funLd.ts` (rules), `web/lib/funLdAuth.ts` (gate), `web/lib/funLdRaids.ts`,
  `web/app/fun/actions.ts`, `QuitButton.tsx`. Test: `test/fun-ld-quit.test.js`.
- **Ruling, same day:** *"Saturday wasn't a raid, so it doesn't count. it should only happen during actual
  raids and ours doesn't happen next until Oct 14th. promote it"*. Live in **web 1.8.93**.
  - **A raid is an OpenDKP raid the officers logged** (`opendkp_raids`, date = the UTC date of its
    noon-UTC `ts`). It is not a `raid_nights` row.
  - **He attended it** when his name is in one of its `opendkp_ticks`.
  - **An LD counts only during a raid:** its night (the Eastern date of ts − 5 h) is a raid date, and it
    happened 19:00–05:00 ET.
  - On today's data, 2 of 15 LDs count, both Fri Jan 16 2026 around 20:15 ET. Raids since: 63 (stays
    there until the next raid). Lifetime: 2.
  - Next guild raid: **2026-10-14** (the guild lead).
- **Found on the way, not fixed (follow-up, in the open-items table):** `raid_nights` is not a record of real raids.
  - `linkEncounterToRaidNight` opens a row for any encounter on Sun/Wed/Thu after 20:30 ET.
  - Since mid-August it holds every Wednesday and Oct 1, with no raid, and misses the off-schedule raids
    (Sat 8/22, Tue 9/1).
  - Anything that reads `raid_nights` or `encounters.raid_night_id` as "a raid" inherits that. Until
    Oct 14, any group night on Sun/Wed/Thu adds a false one.

### 155. Every read past PostgREST's 1,000-row cap now returns complete data (2026-10-04, bot 3.1.198 · web 1.8.95)

The guild lead: *"review all of the other tables for silent 500 or 100 caps. I thought we had something in
the design."* The design had `selectAll` / `selectAllPaged` and a ratchet that counted `.limit(N>1000)` text.
It missed three things. A single `.range(0, N)` call is capped too. So are a set-returning RPC and a view.
And a page that orders on a non-unique key drops and repeats rows at page boundaries.

- **How it ran:** three Sonnet audits (web pages, web lib/API, bot) measured every read against production.
  Eight Sonnet branches then fixed them, each with a cap-enforcing fake and a mutation check. They were merged
  here, with nine migrations applied through the MCP (`20261004140000` … `140800`).
- **What was broken, measured on production (a few of many):**
  - Timer recovery and the raid review read the first 1,000 boss kills. The review showed no slows on
    2026-09-27, with 174 in the window.
  - The buff queue saw 4 minutes of a 3-hour window: 49 of 354 running (target, spell) pairs, 0 of 71
    Aegolism-line casts.
  - Extended Target saw 27 of 97 running debuffs.
  - The Mimic damage panel's "30 d" top 25 shared 16 names with the real one.
  - 18 families' mirror DKP read low by up to 2,347.
  - /guide counted 581 kills of 1,436. /leaderboards' top spender was the wrong character.
  - /admin/agents was missing 190 of 435 characters. The analytics page showed 1,000 of 12,242 views.
  - /me stats for the heaviest raider read 1,000 of 3,807 fights.
  - /me/tells counted 1,000 of 9,156. 29 of 117 characters were missing from /pop spell needs.
  - /quartermaster lost 12 inventory rows and doubled 12 (non-unique order).
- **The fixes take one of three shapes:**
  - **Paged** over a unique ORDER BY (`selectAll` / `selectAllPaged`).
  - **Summed in SQL**: an aggregate RPC whose answer is a few rows.
  - **One jsonb value**, which is not row-capped.
  - New RPCs are `security invoker`, `search_path` pinned, and granted to `service_role` only.
    `me_tell_summary` filters on the owner inside the function.
- **Guards, so it cannot come back quietly:**
  - **Bot:** `select()` warns once per call site when a read returns exactly 1,000 rows unpaged, and
    `/health` carries `supabase_row_cap`. Two ratchets cover over-cap limits (now **22**, was 82) and
    unbounded big-table reads (**4**).
  - **Web:** `test/db-read-discipline-web.test.js` ratchets four counts: one-call `.range(0, N≥1000)` (**1**),
    unpaged set-returning RPCs (**24**), unbounded big-table reads (**93**) and paged reads on a non-unique
    key (**2**). The map of each paged table's unique key comes from `pg_index`.
- **Ruling made here: `selectAll` throws on a failed page.** It used to return the rows it had, which is the
  same silent partial set.
  - A page that can live without a section catches the throw. /me's suspects, attendance, heartbeats and loot
    do; the admin loaders turn it into their error banner.
  - Everything else shows the error page instead of a short list.
- **Behaviour changes worth knowing:**
  - /admin/encounters lists backfill candidates only on fights with missing damage (673 a week, not ~44
    names on every trash row).
  - The item-clickies catalog served to agents is the 1,611 real clickies, not the 1,000 lowest item ids.
  - Mimic's threat rank rows are now whole fights.
  - Bid-history's pooled DKP counts every family name (it stopped at 25).
  - `BUFF_QUEUE_POLL_LIMIT` is retired.
- **Found, not fixed (open items):**
  - `_refreshFocusHaste` decodes `eqemu_items.worneffect`, so it finds no foci. The foci are in
    `focus_effect`: 183 haste foci across 103 characters.
  - The /admin/triggers "Votes" total counts 48,200 `expired` rows; 12 are real votes.
  - ~~`/encounter tonight` reads `e.id` from a view that has no `id`.~~ **Fixed in bot 3.1.201** (2026-10-04):
    it threw on any day with a fight, so the command always answered with its error. It now reads
    `encounter_id`; `test/cap-safe-reads.test.js` §5 runs the command.
  - ~~`opendkp_loot_recent` repeats 13 auctions, because one OpenDKP id matches two characters.~~ **Fixed
    2026-10-04** (migration `20261004220000_opendkp_loot_recent_one_character`, applied and recorded). It was
    26 auctions: one OpenDKP id sits on two `characters` rows, a rename leftover the sync never cleared
    (`utils/openDkpSync.js` dedups by name only; left alone). The view now takes one character per id: not
    deleted, then most recent `updated_at`. 9,251 → 9,225 rows, one per auction. That also stops
    `leaderboard_loot_spend()` double-counting those auctions' DKP. The file also commits the two name fallbacks
    that were applied through the MCP in May and never written down.
  - ~~`guild_held_spell_needs` takes ~31 s, so /admin/spells likely shows its error.~~ **Fixed 2026-10-04**
    (migration `20261004221000_guild_held_spell_needs_fast`, applied and recorded): 29 s → under half a second,
    same 561 rows with the same md5. The per-spell subquery called `eq_class_bit()` ~312k times and scanned the
    spellbook unindexed; class bits are now computed once per character (a MATERIALIZED CTE: without it the
    planner put the call back and it took 12 s) and needers are one grouped join.
  - The threat rollup has not run since 2026-08-19. It is the unapplied `snapshot_at` index above.
  - Beta's /db/item preview (`?v=b` / `?v=c`) reads `item_recipes` in one call. One item is in 1,450
    recipes, so it must page before that preview graduates. The beta sync by hand (`015d55d2`) paged
    `quest_scripts_for_item`, which already stops at 200.
  - 627 `loot_observations` rows disagree with the drop tables (officer decision).
- **Self-host wizard:** the cap is a Supabase/PostgREST default (`max-rows`). A self-hosted PostgREST may set
  another, and the paged reads work under any value. Logged in `DESIGN-selfhost-wizard.md` §3.

### 156. A character's UI backups list only that character (2026-10-04, bot 3.1.197 · Mimic beta)

The guild lead, after backing up nine characters at once: *"What 19 files were backed up for <main>? My
macros/socials/bandoliers?"* The Backups list under that character showed every character on the account,
unnamed, each with Restore. It was filtered by owner only.

- **Fix:** the bot filters by character too (`test/ui-layout-list-scope.test.js`, live in 3.1.197).
- **New:** Settings → UI backups → 📄 Files lists what a backup holds. The server stores the bundle encrypted
  and keeps no names, so it downloads the backup to list them.
- **What a bundle holds:**
  - `eqclient.ini` and `zeal.ini`.
  - Every top-level `.ini` named for the character: `UI_<Name>*` (layout), `<Name>_pq.proj.ini` (hotbuttons,
    socials, Zeal key binds), and Zeal's `_bandolier.ini` / `_spellsets.ini` / `_protected.ini`.
  - That main's backup was 18 files, with 98 socials indexed from `<Name>_pq.proj.ini`.
- **No harm from a wrong row:** restore writes each file under its own name. Another character's row never
  overwrote this character's files, only the shared `eqclient.ini` / `zeal.ini`.

### 157. A buff-block picker in Mimic for Quarm's `#blockbuff` (2026-10-04, agent 3.7.79 on beta)

**Shipped to beta** as `f1b9a4e2`: a Buff blocks tab on the dashboard. The agent side has
`logsync.buffblocks.json`, `GET /api/buffblocks`, `POST /api/buffblocks/{sets,state,socials}`, and the
`_bb*` helpers. It reuses `_applyIniKeyEditsToFile` behind `_charLooksLoggedIn`. Tests are in
`test/buff-blocks.test.js` (44). The details below are the research and the calls behind it.

Quarm added three player commands (patch notes Oct 2–4): `#blockbuff <id>` (alone, it lists your blocks),
`#blockbuffif <id> <active id>` and `#allowbuff <id> [active id]`. Blocks live on the character, server-side.

- **The ask (the guild lead):** *"start building out a picker for this on mimic so that people can see their own
  sets of block and allow lists buffs and make some for any of the songs that are bards use some monks can
  toggle them off while pulling and toggle them back on when they're in camp"*.
- **The delivery call (the guild lead):** *"mimic builds the copy for the player or makes a hotkey if desired if
  the user is currently logged in on next log out update the social"*. So:
  - Mimic shows the command lines to copy.
  - On request, it writes Block and Allow socials into `<Char>_pq.proj.ini`, five lines each.
  - While the character is logged in, the write is queued until logout. It uses the agent's existing
    web-edit gate (no Zeal sample for 2 min, log idle 90 s) and its key-level ini writer.
- **Why nothing else:** Quarm rule 3 forbids software "interacting with the game client", and Zeal's pipe is
  outbound only (`named_pipe.cpp`, `PIPE_ACCESS_OUTBOUND`). Mimic never types into the game.
- **Alternative, not built:** Zeal's page-10 social keybinds (Zeal 1.4.4+) re-read
  `Page10Button<N>Line1-5` from the ini on every press (`page10_binds.cpp` `execute_social`). That would
  make a live write work without a logout, after a one-time keybind setup. Still five lines per key, and keys
  can't chain.
- **Unknowns, which shape v1:**
  - The server's reply text for all three commands is in no public source. The upstream EQMacEmu has only
    a stub `IsBlockedBuff()`. v1 records what the player's sets did and reads nothing from the log.
  - A real `#blockbuff` reply, pasted by anyone, unlocks a list parser beside `parseSllLine`.
  - Upstream calls `AddHealAggro` before buff slotting (`zone/spells.cpp`). A blocked song may still put
    the bard on the hate list of the monk's pull. A live test is needed before anyone relies on the pulling
    set.
  - Block cap: undocumented. EQEmu's analogue is 20, so the UI warns past 20.
- **Data:** 66 bard songs that land on others, from `eqemu_spells`. Skills 12/41/49/54/70, good effect,
  group/AE/single targets. Levels from PQDI, since `spell_class_levels` has no bard rows. Starter sets:
  "Pulling: bard twist (L47+)" (20 ids), "every rank" (40), "No bard run speed" (717, 2605, 1750, 1330), and
  a `#blockbuffif` damage-shield pair.

### 158. The bot mirrors Quarm's patch-notes channel into Supabase (2026-10-04, bot 3.1.199)

The guild lead: *"1175117242682331146 is the Quarm patch notes channel id in our discord. pull everything from
there"*.

- **What:** every message in that channel goes into `quarm_patch_notes`, one row per Discord message.
  - The channel is `QUARM_PATCH_NOTES_CHANNEL_ID`, defaulting to the id above.
  - Each row keeps the content, embeds flattened, attachments, author, posted and edited times.
  - Signed-in members can read it; only the service role writes.
- **How:**
  - A sweep a minute after boot and every 6 h. It pages backward 100 at a time.
  - The first run takes the whole history, capped at 20,000 per run with a resume point.
  - Later runs stop at already-stored territory.
  - New posts are caught by the existing messageCreate handler, before its bot-author early-out
    (crossposts are bot posts). Edits are caught by a new messageUpdate listener.
  - Status lives in bot_kv `quarm_patch_notes_sync`.
- **⚠ The Message Content intent:** without it, Discord returns blank content, embeds and attachments. Those
  rows are stored flagged `content_missing` and counted in the status. Turning the intent on (portal toggle,
  then `MESSAGE_CONTENT_INTENT=1`) makes the next sweep re-walk and rewrite them.
- **Not done, deliberately:** `Partials.Message` on the client would catch edits to posts from before the last
  restart, but it changes every message handler's inputs. The sweep plus the live listener cover the
  common case.
- **Migration:** `20261004160000_quarm_patch_notes.sql`. The MCP `apply_migration` call timed out three times,
  so it went in as four separate `execute_sql` statements. The version was then recorded in
  `supabase_migrations.schema_migrations` by hand. Same SQL, same version as the committed file.
- **Only Quarm's own posts (bot 3.1.200, the same day).** The first sweep stored all 4,265 messages in the
  channel. Only 1,348 were Quarm's: the channel follows Quarm's #patch-notes, #announcements and
  #server-status-downtimes, and members talk in it too.
  - A followed-channel post is written by a webhook. So the sweep and the live writer now keep only messages
    with a `webhookId`.
  - The sweep's "already stored" stop looks at the oldest Quarm post on the page. A member's message is never
    stored, so it cannot be the stop.
  - **Cleanup:** the sweep deletes any member message on a page it reads. A `feed_only` flag in the bot_kv
    status forces one full walk after the upgrade, so the 2,917 member rows go on the first run.
  - Why the bot cleans up and not SQL: the Supabase MCP holds a `DELETE` for a confirmation, and a
    non-interactive session cannot give one (both `execute_sql` and `apply_migration` timed out on it).
    A migration file would not help either: the GitHub integration does not apply files pushed to `main`.
  - Every stored row is still blank: the intent is off. The open-items row has the two steps.
  - **Verified after the deploy** (first run 20:34 UTC): 4,265 messages read, 1,350 rows left, `feed_only`
    set. The 1,350 are the 1,348 Quarm posts plus two of Discord's own "Community Updates" notices from 2024.
    Those are webhook posts too, so the filter keeps them; harmless, left in.

### 159. The HUD's DS badge adds the shield from worn gear, only on top of a shield spell (2026-10-04, bot 3.1.202 · agent 3.7.80 beta)

The guild lead, with screenshots (badge "DS 10", shield hits "for 18 points", a Talisman of Vah Kerrath
with "Increase Damage Shield by 8"): *"Missing my additional DS from my neck slot. It only gets added when
you have other damage shield."*

- **The rule, confirmed upstream:** EQMacEmu `zone/attack.cpp` `Mob::DamageShield` returns early when the
  spell shield is 0 and adds the item part only inside that branch; item shields come from the worn-effect
  spell (`zone/bonuses.cpp`), never from the flat `eqemu_items.damageshield` column. So: spell shield +
  gear shield while a spell shield is up, nothing from gear otherwise. Quarm's own rules (a cap, say) are
  unknown; none is modelled.
- **Data:** view `item_worn_damage_shield` (migration `20261004223000`, applied and recorded) reads SPA 59
  from every slot of the worn-effect spell's `raw` (the Talisman's sits in slot 5, past the indexed
  columns). Two items today: Talisman of Vah Kerrath 8, Shroud of Eternity 5.
- **Bot:** `/api/agent/item-clickies` v2 adds `worn_ds: [{id, name, ds}]`, its own list so nothing that
  reads the clicky `entries` sees non-clickies. A failed read serves the catalog with an empty list.
- **Agent (beta):** `_wornItemDs(character)` sums `worn_ds` over worn slots of the newer of
  `/output inventory` and the Quarmy export; `_serializeMeState` adds it to `combat.ds.per_hit` only when
  `_knownDsPerHitFor` found a shield spell, and reports it as `combat.ds.from_items`. The last-hit fallback
  is unchanged (it already includes gear). A disk cache from before `worn_ds` drops its ETag so the next
  fetch is a full one.
- **Left alone:** `_knownDsPerHitFor` itself (the anonymous-hit settle already allows 30 points of unseen
  shield, `DS_UNLISTED_SLACK`), and the Tank window's shield sources for another tank (their gear is not
  known to this client).

### 160. A 3D "spectator mode" map on wolfpack.quest: options, not yet picked (2026-10-04)

The guild lead: *"3d map like this design on https://foreverchanges.pro/map with our location data and target
location data overlayed like spectator mode on Wolfpack.quest"*. Same day as `DESIGN-zone-radar.md` (options
1-3, unpicked); this ask is that doc's Option 2 (one shared raid picture on the website) with a 3D look.

- **The reference is a World of Warcraft map** (WoW Classic "Forever" fan site). Its 3D terrain is built from
  Blizzard's client files (height tiles, ~20 KB each; 8 MB for one zone view) in a hand-written three.js
  engine: tiled terrain with LOD, draped map imagery, fog, DOM labels, "Top down" and "N" buttons, shareable
  view in the URL. Its terms forbid republishing its compiled data. So: copy the controls and feel, never its
  data or code.
- **We have no EverQuest terrain.** No meshes, and Brewall's map lines carry no licence (`DESIGN-zone-radar.md`).
  What we can draw from freely: `eqemu_spawn2` (43,655 points with x/y/z in 182 zones), doors (8,207), ground
  spawns (514) and objects (322).
- **Positions we have:** `raid_roster.loc_x/y/z` + heading, every 3 s per raid group, latest only, kept 1 h;
  `character_live_state.loc_*` every 45 s, no heading. Nothing on the website reads them yet, and nothing
  serves them to it. `/raid` refreshes every 15 s.
- **Targets:** Zeal 1.4.8 sends `target_loc`, only within 250 units ("server policy"). Mimic does not read it
  yet, and the fleet reports Zeal 1.4.7 (5 of 5 that report a version).
- **Options** (build / maintenance / runtime / change):
  - **A, point-cloud 3D:** the zone drawn from our own points, orbit/tilt/zoom like the reference; looks like
    a constellation, not terrain. ~6-9 days for the page plus the live layer / low / three.js ~150 KB lazy +
    one small points file per zone / easy.
  - **B, real zone geometry:** meshes extracted from the EverQuest client files by a local session, then the
    same engine. The look of the reference. Needs a rights call (Daybreak's art on our site) and a per-zone
    extraction step; several MB per zone. ~15-25 days / high / heavy / hard.
  - **C, flat live board:** top-down 2D with height as colour, no 3D engine. Fastest to read mid-raid, best on
    phones. ~4-6 days / low / tiny / easy.
  - Common to all: a member-gated positions endpoint (2 s poll), agent adoption of `target_loc`, and the
    one-hour in-game axis and heading check.
- **Gates already on record:** §131 and `DESIGN-zone-radar.md` say to ask server staff before anything shows
  mobs' positions raid-wide. Raiders' own positions on the website are a new surface: `PRIVACY.md` says
  signed-in members see zone and HP only, so it needs a line there first.
- **Preview:** a private artifact (not in the repo) shows A and C over real Vex Thal spawn points with a
  made-up sample raid, so the look can be picked before any build.
- **Picked (the guild lead, same evening):** *"I need to have the map displayed underneath or it's useless
  though. we can start with C. I'm not asking the server for permissions beyond what has already been cleared
  for zeal"*.
  - **C first**, the flat live board.
  - **A real zone map under the dots is a requirement.** The spawn-point cloud and `zone_outline()` alone are
    not enough. So the map-line source (whose lines, under what licence) is the first thing to settle; Brewall's,
    the ones Zeal draws, state no licence.
  - **No ask to server staff.** The page shows only what Zeal already exposes to a player: raid members'
    positions (pipe types 5 and 6) and a target's position within Zeal's 250 units. Nothing beyond that is
    built: no positions for mobs nobody targets, no pather predictions. This supersedes the "ask staff" gate in
    §131 and `DESIGN-zone-radar.md` for that scope.
  - Still needed before raider dots show on the site: a `PRIVACY.md` line (positions shown to signed-in members).
- **Brewall's maps underneath (the guild lead, 2026-10-05):** *"include brewall maps underneath. I'm not
  concerned with the licensing right now because this is still gated behind Discord."* So the board's default
  layer is Brewall's lines, as Zeal ships them. Rules that keep that call contained:
  - **Never in this public repo.** The route fetches each zone's files at run time from Zeal's public repo
    (`coastalredwood/Zeal`, `Zeal/zone_map_src/map_files/`, 180 zones), caches them in `zone_map_lines`, and
    serves them only through the signed-in route. Tests use invented strings.
  - **`zone_map_lines` has no read policy at all** (service role only). A Discord account can get an
    `authenticated` session from Supabase without passing the guild check in the sign-in callback, so an
    `authenticated` policy would have handed the art to anyone with Discord.
- **Built (web 1.8.98, 2026-10-05), live after the raid freeze:**
  - `/spectator` [beta], under Raid in the nav. `web/app/spectator/` + `web/lib/spectator.ts`.
  - **Positions:** `GET /api/spectator/positions` (signed-in) calls `spectator_positions()` (migration
    `20261005003000`): one row per raider, freshest wins, (0,0,0) rows dropped (an uploader reports a raider
    in another zone that way). raid_roster holds one row per uploader × raider: 1,125 rows inside 30 s for 45
    raiders on 2026-10-04, so the raw read the first draft used would have dropped raiders. The board polls
    every 3 s, the upload cadence.
  - **Axes, settled on live data:** server x = `raid_roster.loc_y`, server y = `loc_x`. With the swap, 15 of
    19 raiders in the Plane of Innovation stood within 8 units of a floor in the collision mesh; without it,
    none had a floor anywhere below. The page draws north-up like Zeal's map (screen = −server).
  - **Zone:** raid_roster has none. A raider's own `character_live_state` zone, else the zone most of that
    uploader's raiders are in, else the raid's.
  - **Map:** `GET /api/spectator/map?zone=` (signed-in) returns two layers in the server frame: `eqemu` (wall
    lines sliced from the GPL EQEmu collision mesh, `web/lib/zoneMap/slice.ts`, the Python reference ported
    exactly) and `brewall`. Each is fetched on the first request for a zone and cached in `zone_map_lines`
    (migration `20261005010000`; ~170 KB a zone, ~30 MB for all 180 at worst). Zone names are checked
    against `eqemu_zone` before any URL is built.
  - **Board:** Brewall, generated walls or both; floors (the raid's floor bright); fit raid uses the raid's
    core so a corpse run does not shrink the view; group roster with tap-to-find; scale bar, north arrow.
  - **Not yet:** target markers (needs the agent to read Zeal 1.4.8 `target_loc`); heading direction is
    assumed counter-clockwise from north (`HEADING_CCW`) until checked in game.
  - **Privacy:** one line in `docs/PRIVACY.md` and `/privacy`: while you are in a raid, your latest position
    is shown to signed-in members on this page; nothing new is stored. (Superseded the same night by §161:
    positions are now kept for replay.)

### 161. Raid replay: keep every raid's positions, replay look not yet picked (2026-10-05)
- **The ask (the guild lead, 2026-10-05):** *"can we replay raid timeline with the locations? I'd love to keep them
  for a raid and be able to figure out how things look after the fact."*
- **Nothing was kept before this.** `raid_roster` is an upsert, one row per uploader × raider, and the midnight
  chain drops rows over an hour old. No other table holds positions over time (`xp_events` has a loc per XP kill
  only). So the 2026-10-04 evening group (51 placed, 28 uploaders, gone by 21:08 ET) cannot be replayed.
- **Measured for sizing:** each Mimic posts the roster every ~4 s with ~50 members (3,755 posts in 10 minutes on
  2026-10-04 ≈ 6.3 a second); 72% of member rows are (0,0,0), an uploader's way of saying "another zone". Full
  nights run 41–51 raiders; Wednesday and Thursday 7–28. Appending raw uploads would have been ~3.4 M rows a night.
- **Recorder (bot 3.1.203), built without waiting for the pick** because every look needs the same data and
  Wednesday is the next chance to capture a raid:
  - `utils/raidTrack.js`. The raid-roster handler hands its rows to `noteRows()` (memory only, never throws).
    The first uploader to report a raider keeps them for 6 s so two slightly different views do not shimmer;
    HP is taken from any uploader, since each one only has gauges for its own group.
  - Every 3 s (`RAID_TRACK_STEP_S`) the raiders seen in the last 6 s become a frame, if six or more are placed
    (`RAID_TRACK_MIN_PLACED`). Each finished minute is ONE row in `raid_track_minutes` (migration
    `20261005020000`, applied 2026-10-05): `data` is compact JSON text (`who`, `zones`, frames of
    `[dt, i, x, y, z, heading, hp, zone]`; −1 = unknown), text rather than jsonb because number arrays store
    about 3× smaller. x/y are raw `loc_x`/`loc_y`; the web swaps them when plotting.
  - Zone is stamped at write time, per uploader (an uploader only places raiders in its own zone): the majority
    `character_live_state` zone of that uploader's raiders, else the minute's majority.
  - **`exclude_from_stats` characters are never written**, matching the raid review; a minute is not written
    until that list has loaded once (fail closed).
  - Size: ~2–4 MB a full night, ~0.5 GB a year.
  - **Retention — the guild lead's call (2026-10-05):** *"I want this captured to the local tower backup and kept
    there. let's plan on retaining raids for now until it becomes a storage issue."* So:
    - Supabase keeps every raid. `RAID_TRACK_RETENTION_DAYS` is unset by default; the sweep is off.
    - Tower keeps a permanent copy: `raid_track_minutes` is an ARCHIVE table in `scripts/lib/archive-merge.sql`
      (insert and update, never delete), and that script creates the table on Tower, because the merge skips a
      table Tower lacks without a word (how `faction_hits` never arrived). `scripts/test-archive-merge.sh`
      covers both: the table is created and filled, and a minute production drops stays.
    - If storage ever forces a sweep, it deletes only up to `bot_kv archive_watermark_raid_track_minutes`
      (`{ through }`), the threat-snapshot gate: no watermark, nothing deleted. Nobody writes that watermark
      yet, so turning the sweep on today deletes nothing.
    - Manual step: Tower's copy of the merge script is not a git checkout, so the guild lead or a local session
      copies it over (STATUS ⚠ item). A cloud session reaches Tower read-only, and could not start a Postgres
      to run the self-test here either.
  - Service role only (RLS on, no policies, no anon/authenticated grants). `docs/PRIVACY.md` and `/privacy`
    now say positions are kept for replay, with a permanent copy in the Archive (web 1.8.99).
  - **Not on main yet.** Committed 2026-10-05 on `claude/sharp-lamport-dC0TW`; the push to main inside the
    Sunday freeze window was held back by the session's permission check (the guild lead's "no raid, push it"
    covered the spectator push before it). It lands when the guild lead releases it. The migration is already
    applied; the empty table is harmless until the bot code lands, and `/privacy` keeps saying "nothing is
    stored" until then, which stays true.
- **The look, offered (not picked):** **A — Night scrubber: the live map gets a timeline** (play/pause, 1–60×,
  boss kills marked; recommended); **B — Fight replays: each kill on the raid review gets a ▶**; **C — Trails:
  one still picture per fight, no playback.** Previews go on b.wolfpack.quest once Wednesday is recorded.
- **Not in a replay yet:** mobs. Target positions need Zeal 1.4.8 across the fleet and the agent sending
  `target_loc`.

### 162. FB-51: EverQuest stopped writing the log, and nothing said so (2026-10-05)
- **Report (the guild lead, late Sunday):** "I'm not currently seeing rolls", then "the damage isn't loading
  either", then FB-51 "NO damage on fights, no rolls, missing plenty of stuff". Zeal's abbreviated chat showed
  rolls as `[0:222]: 26 rolled by X.`, a red herring: the log file keeps the two-line form, and four other
  agents (one on the same 3.7.80 beta) captured those rolls.
- **What it was:** the player's `eqlog_<char>_pq.proj.txt` (540 MB) stopped being written at 00:45 while they
  kept playing; Explorer showed "Date modified 12:45 AM" at the size the agent found on its 00:49 restart. Every
  agent line after that came from Zeal's pipe or relays; nothing local. **Fix in the field:** move the log
  aside, restart EverQuest, which starts a fresh file. **Why EQ stopped is NOT known** (size, a `/log` toggle, or
  another folder were all possible; the fresh file fixed it). Do not cite a size limit as the cause.
- **Ruled out on the way, so the next session need not re-check:** roll format, Zeal chat display,
  `exclude_from_stats`, agent 3.7.80 (worn-DS code runs only in the HUD state), a client switch, the camp
  state, log rotation (none ran), disk space (37 GB free).
- **Shipped to beta, agent 3.7.81 (`27022a44`, "Fixes FB-51"):**
  - `[log-silent]`: Zeal has the primary character in game (< 60 s) and their log has had no line for 5 min →
    one warning per episode and `logSilent` on `/api/state`. No UI yet; the on-screen form is the guild lead's
    call (UI rule). It would have flagged this case at about 00:50.
  - Tail watchdog: a hung `fs.promises` call in `tailFile` can no longer end the read loop silently.
  - Bug-report excerpts keep the NEWEST lines over the cap (they kept the oldest; FB-51's ended at 00:31).
  - An empty upload-queue file no longer reads as "corrupt" (it did on every boot after an empty shutdown:
    24 times in one member's log).
- **Found, not changed: log archiving has never run in Mimic.** `_logRotateSweep` (500 MB, default on since
  2026-08-07) has its timers inside the `--once` branch, which exits after a few seconds; watch mode returns
  before reaching them. That is how the log reached 540 MB. Wiring it into watch mode would start renaming
  members' logs for the first time, so it waits on the guild lead's yes.
- Also noted: the bug-report preview shows the first 400 lines of the kept slice (now the oldest of the newest).

### 163. A lag meter in Mimic (2026-10-05)
- **Ask (the guild lead):** a member "is complaining about lag. can we help diagnose network lag?" Nothing on any
  surface measured a player's connection to the server (the buff queue's "lag?" button is about that overlay).
- **Offered:** A — check-now `pathping` button; B — always-on meter; C — lag inferred from the log. **Picked B**
  (*"Lets go with B"*).
- **Built (agent 3.7.82, beta `874ccbfd`):** two targets pinged once a second from the player's PC: the default
  gateway and the login server in `eqhost.txt` (read per install, never hard-coded; it is the route to the host,
  not an exact zone ping). The verdict splits home network from beyond it, which is the question a lag complaint
  needs answered. Samples are marked when a fight is live. Diagnostics card + one Tick overlay line.
- **eqhost.txt has two shapes (agent 3.7.83, `899b2ded`):** the guild lead's file is the Quarm/TAKP client's
  `[Login Servers]` block of quoted `"loginserver.takproject.net:6000"` entries, not the classic
  `[LoginServer]` + `Host=` the first parser expected, so 3.7.82 would have pinged only the router on a real
  install. The parser reads both; `[Registration Servers]` is ignored.
- **The login server is a fair proxy for the zone server (measured 2026-10-05):** Resource Monitor on the guild
  lead's PC showed eqgame.exe sending to 70.35.159.26 while in a zone; the login server
  (`loginserver.takproject.net`) resolves to 70.35.159.18, the same /24, so the route is the same until the
  last hop. No zone-server override needed for now. (Finding the address without admin rights is not possible
  for UDP: `netstat` shows no remote end, and Resource Monitor needs elevation.)
- **Local only, on by default, switchable off;** `PRIVACY.md` and `/privacy` say so (web 1.8.101).
- **Counted pings, not `ping -t`:** Mimic kills the agent with TerminateProcess on Windows, so an endless ping
  would outlive every restart. A counted run dies within 5 minutes at worst.
- **Not yet seen on Windows:** the parser was checked against hand-written English and localized output and a
  fake ping on Linux. Next: a beta tester (or the member who reported the lag) runs it and sends the Copy summary.

### 164. Enrage at 12%, a fresh log in one click, and what rewrites EQ's ini files (2026-10-05)
- **Enrage soon (agent 3.7.84, beta `2853825c`).** The guild lead: *'"Enrage Soon" goes off WAY too late. it
  should be hitting at 12-10% of mob hp left'*. `ENRAGE_WARN_PCT` 10 → 12 (also the HUD zone and the Tank /
  Command Center threshold), the check every 250 ms instead of 1 s, and "Enrage soon" at speech priority 2
  beside CH GO. The plumbing from Zeal to speech is under 1.5 s; the late part was the threshold and the
  speech queue, which made it wait behind the line being spoken and dropped it after 5 s or behind 3 others.
- **The log stopped again at 10:50 (FB-53).** The guild lead: *"that's unacceptable. We need a quick way to
  backup log and start fresh in the mimic client"*. Built (agent 3.7.85, beta `9a5f5a4a`): 🗄 Archive log &
  start fresh, and the log-silent header banner, which 3.7.81 computed but never drew. Not caused by the bug
  report's log read: both FB-51 and FB-53 were sent after the log had already stopped. Why EQ stops writing is
  still unknown; `/log off` + `/log on` is the in-game step to try first.
- **« Earlier (the guild lead: *"the earlier button no longer works on TTS"*).** Votes now file under the
  trigger's name and id, not the shown text, so a built-in callout's votes add up (`f568d5fe`); votes still
  change no timing. The guild lead confirmed the Canvas is on. Reproduced in Chromium with the real Canvas:
  the callout column was centred in the callouts panel, so a panel shorter than callout + vote row cut the
  row off first (0–15% of « Earlier visible at 420×120, 420×60, 720×36, 300×120, scale 1.5; no vote sent).
  Fixed (`b67bc333`): the column sits on the panel's bottom edge; all of those send the vote. By design a vote
  still cannot land while the Canvas is being arranged, or under another panel.
- **Buff blocks: a set's Name could not be edited** (the guild lead: *"the starter set ne set for blocking
  buffs does not let me edit the Name from New set"*). Opening "✏ Edit this set" changes the markup (wpKeep
  writes `open`), so the next 5 s poll rewrote the tab under the Name field, which has no id to restore:
  typing "My Pull Set" saved "My Pul". Fixed (agent 3.7.86, `7b6a2606`): the tab holds its repaint while an
  id-less text field has focus and repaints on focusout; and a rename followed at once by another set button
  no longer puts the old name back (the change goes into the view before the save).
- **Bags and the lost /corpse social.** Zeal's toggle-all-bags (keybind 215) opens bags with the client's own
  call and places nothing; positions come from EQ's own save. The one Mimic writer that can revert
  `UI_<char>` (bag spots) is UI Studio's Save: it writes the position of EVERY window it read (the ~50 bag
  windows included, though the stage hides them) from the copy read when Studio opened, as whole files; its
  deferred "after logout" form runs unattended and keeps EQ's copy as `.bak-eq-<ms>`. It does not write the
  socials file, so the lost /corpse social more likely came from EQ closing without a zone or camp. Backups
  only read (`readFileSync`, no lock). Offered: **A** (Save writes only the windows you moved, into the file as
  it is on disk; a cloud snapshot loaded into Studio still writes every window; old whole-file pending saves
  are dropped at upgrade) or **B** (keep whole files, guard the deferred queue). **Picked A** (the guild lead,
  2026-10-05: *"A for UI Studio"*). **Built** (Mimic beta, `c281fea6`): Save sends key edits for the windows
  moved or resized only (every window on a rescale to another resolution block; a moved-only window keeps
  EQ's current size), main re-reads each file and changes only those keys (`apps/mimic/iniKeyEdits.js`),
  immediate and after-logout alike; old whole-text pending saves are dropped at load. One departure from the
  draft: a cloud backup loaded into Studio keeps the whole-file restore (a new PC may have no files to
  merge into) and refuses while the character is logged in rather than queueing a restore.
- **Flag hails in the Command Center** (the guild lead: *"Upon boss death and spawn of a creature that needs
  to be hailed … track who has not yet hailed and who has already"*). Scoped: 15 PoP kills spawn a hail NPC
  (Planar Projection and others, 10–20 min, Agnarr/Karana wants a phrase not a hail); only the raid at the
  kill can get credit; "hailed" comes from a raider's own flag line (Mimic) or a witnessed
  "<Name> says, 'Hail, …'" (wired only into old-log imports today, `parseWitnessedHail`); "already flagged"
  from `pop_flags` + `STAGE_IMPLIES`. Offered **A** shared board (bot-backed, everyone sees the same list,
  tap to mark) or **B** local only. Recommended A; waiting on the pick.
- **Timers for the PoP named on the board** (the guild lead: *"timers for the guild instances bosses in our
  zones. They're 3 hours"* → *"put them on the pop board per zone"*, with Quarm's Oct 4–5 notes). Bot
  3.1.204 (release branch): Bastion of Thunder's eight named at 3 h, the 24 h named per zone (Crypt of Decay,
  Disease incl. Grummus 66→24, Innovation's Prototypes IX–XI, the Justice crawler, Nightmare's five, Valor's
  two). Buttons for timers ≤ 24 h show the Eastern time the boss is up; ≤ 6 h bosses stay off spawn alerts
  and "Spawning in 24 Hours". The new named file no character lockouts (`lockout: false`; the notes give
  respawns only) — Grummus keeps its old lockout behaviour, unconfirmed. The PoP board grows to 4 messages:
  someone runs `/board` once after the deploy (until then the board silently does not refresh). Found while
  scoping, fixed in the same change: the boss matcher took "a tortured soul" / "a tortured banshee" for
  **Ture** (8 trash fights since Oct 2, 24 false lockout rows, a false Ture board timer to 2026-10-07 23:08 ET;
  the rows are left to expire unless the guild lead says delete) and would take "a chokidai terror" /
  "a cleric of vallon zek" for Terror / Vallon Zek.
- **HUD procs and stuns/aggro per mob** (the guild lead: *"the number of procs that you have had on a mob, as
  well as how many stuns/aggro spells you've put into the mob. on the right side of the circle hud above the
  damage shield"*). Agent 3.7.88 (beta `9050be57`): ⚡ procs (the hit ledger's proc flag) and ✦ stuns/aggro
  (a landed own-cast whose catalog entry is cc 'stun', SPA 21, or adds hate, SPA 92 positive base), per mob
  keyed name#spawn id, reset on death; one row flush against the ring above the DS badge, builder part
  `procs`. The hate field comes from bot 3.1.205 (release branch); until it deploys only stuns count.
  Placement read: procs then stuns left to right, above the DS column; no separate damage chip (the damage
  is already the hit column and the END arc's "out").
- **HUD "1 6%" arc** (the guild lead: *"what is this little bar at the top left"*). The low-HP side arc
  (`_meSideArcs`) took every Zeal gauge with text except 1/6/16, so the XP, AA XP, cast, tick and spell-gem
  gauges could list as raiders under 25%. Fixed (agent 3.7.87, `f1f1f38a`): group-member gauges 11-15 only,
  beside the raid window.
- **Tower patch for raid positions:** `docs/PATCH-tower-raid-track.md` (pinned to `04d90890`, md5s, 22-check
  self-test). This session cannot write to Tower (read-only login, SSH blocked by tailnet policy), so a local
  terminal or a Claude in Chrome session runs it.
