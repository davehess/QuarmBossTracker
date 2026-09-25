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
| **Zeal: Bandolier chat filter (PR ready)** | **2026-09-25 (§26).** Branch `bandolier-chat-filter` on github.com/davehess/zeal; PR text + test plan in `docs/zeal-bandolier-filter-request.md`; both builds passed in game; **all** bandolier messages now go to the filter, failures in red (the guild lead's call) — `30a79bb` | the guild lead: open the PR upstream (compare link + paste-ready text in the doc). Next candidate: #213 (target level/class/race + loc on the pipe) |
| **Zeal: tags survive crash/relog/character switch + no cross-zone tagging (branch, not built yet)** | **2026-09-25 (§28).** Branch `tag-persistence` on the fork (`0d66a28`): name check on received tags; per-character `<name>_tags.txt`, restored by zone + spawn id + name, 3 h expiry, `/tag persist` on by default. File code round-trip tested off-client | the guild lead: build + run the 8-step test plan, confirm or change the four defaults in the PR doc, re-author, open the PR |
| **Zeal: six icon tag shapes (branch, not built yet)** | **2026-09-25 (§27).** Branch `tag-shapes` on the fork (`fefa1c0`): `^1^`–`^6^` = skull, X, sword, diamond, flame, star; multi-part extrusion with proud accent parts, preview rendered off-client from the real geometry code. PR text + preview: `docs/upstream/zeal-tag-shapes/` | the guild lead: build + test in game, re-author, open the PR. Ours after upstream ships: agent `_ZEAL_TAG_SHAPES` + prettyprint regex learn `1`–`6` |
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

**Built rather than scoped** — branch `tag-persistence` on the fork (`0d66a28`),
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

## 29. Field issue — Windows 11 preview update KB5124010 breaks EQ at launch (2026-09-25)

A member reported in the Quarm Discord (shared by the guild lead): EQ would not
launch, or crashed at once, with Windows' *"Memory could not be read"* box, **even
with Zeal disabled**. The cause was the Windows 11 preview update **KB5124010**
(build **26200.9550**), installed overnight, and uninstalling it fixed the client.
One machine, mechanism unknown. Written into `docs/RUNBOOK-client-crash-triage.md`
§3b as the first question for any "worked yesterday, crashes at launch even without
Zeal" report, ahead of the §5 ladder.






