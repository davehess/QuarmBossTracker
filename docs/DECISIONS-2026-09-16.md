# Decisions — 2026-09-16

## The repo is public, so it names nobody (the guild lead)

> *"i want the references cleaned up. At the very least obscure names and
> anything specifically privacy invasive, credentials."*
> *"Make sure there aren't mentions of who is in what character family."*
> *"sweep the source code comments"*

Four passes in one day. Three over `docs/` + `CLAUDE.md` + `README.md`, then one
over the source.

### 1. Attribution is by ROLE now, and the alt list is gone
The confirmed alt list that lived in `CLAUDE.md` mapped one person to seven
character names — the exact artefact the cleanup exists to delete. It was
removed, not rewritten, and must not be reconstructed from `characters.main_name`
or anywhere else. The replacement is a table of roles (`the guild lead`,
`a member`, `an officer`, `a third party`) and one line that carries the reason:
**you cannot misattribute what you do not name.** Dates and quotes stay; they are
the evidence. Full rule in `CLAUDE.md`.

### 2. The source sweep, and what it deliberately left alone
Comments only — the sweep never edits a string literal, a trigger pattern or a
fixture. Three mechanical categories plus a hand pass:

| | What | Count |
|---|---|---|
| Prose attribution | `(Name 2026-08-11)` → `(the guild lead, 2026-08-11)`; anyone else → `a member` | 1,264 |
| Worked examples | log lines, callout formats, API payloads → invented names | 176 |
| Test-file prose | the same rule over `test/`'s own comments | 313 |
| By hand | ~60 comments where two people were named in one breath, a family was mapped out, or the mechanical pass read as nonsense | — |

**Invented names are a convention, not people.** `Aldenmar`, `Brackwyn`,
`Corvale`, `Rethlan`, `Nyssara`, `Zarrin` and the rest were checked against
`characters` and `eqemu_npc_types` before use, and a stable map was used so a
two-name example still reads as two different people.

**Things fixed that were not just names:**
- an OpenDKP account login and a `char_id → character` map in `index.js`;
- a comment stating one member's family relationship to another (it survived in
  `test/raid-swap-return.test.js` after being cleared from the web page);
- a member's LAN address in `web/lib/request-origin.ts`;
- every comment attributing multiple simultaneous clients to a named member;
- gendered pronouns left dangling on an anonymised subject — they/them per
  `CLAUDE.md`, since after anonymising, `he`/`she` is itself a leak.

**Verification:** 245 test files / 3,416 tests green, lint clean, `golden:check`
matches, `tsc --noEmit` clean, and `check:dashboard` confirms `WEB_HTML` /
`COMMAND_HTML` are back in sync after the `dashboard.html` and `command.html`
edits. A green suite is the evidence that renaming example names in comments
broke no text assertion — `CLAUDE.md`'s stated hazard, checked rather than
assumed.

### 3. What was NOT swept, and why
- **Test fixtures and golden logs** (~1,700 mentions). `CLAUDE.md` forbids
  blanket-renaming them and the reason is real: a fixture's name is load-bearing.
  A rename is its own change, with `golden:update` inside it.
- **The mock data on public pages** (`/about`'s overlay demo, `/mimic/mini`'s
  three mock overlays). These render the real raid — names, classes, groups,
  mana, a DPS ranking — on pages anyone can open. The mini page's cast was a
  deliberate choice so the guild recognises itself, and its vote is still open,
  so all three files were skipped whole rather than edited around.

Both are rows in the table below.

---

## Open — read this first

| Item | Where it stands | Next |
|---|---|---|
| **Source-comment sanitization** — the sweep docs got, applied to code | **done 2026-09-16.** Comments only, across the bot, agent, Mimic, web, migrations, scripts and `test/`'s own prose: 1,264 prose attributions rewritten to roles, 176 worked examples given invented names, ~60 comments rewritten by hand where two people were named in one breath or a family mapping was spelled out. Zero member names left in any comment. Full gate green (245 files / 3,416 tests, lint, golden, `tsc`). Rules + the invented-name convention are in `CLAUDE.md` | nothing — but see the two rows below, which are what the sweep deliberately did NOT touch |
| ⚠ Test FIXTURES and golden logs still name every member | **open — the guild lead's call.** ~1,700 mentions across `test/` and `data/`. `CLAUDE.md` forbids blanket-renaming them because a fixture's name is load-bearing (the `{s}`-capture rule), and a rename has to regenerate the golden expectations in the same change. So a test file now reads in roles while its fixtures still carry real names | decide whether to rename. If yes: one stable map, `npm run golden:update`, full suite, and re-check `{s}`/leading-space assertions by mutation — not a mechanical pass |
| ⚠ Public pages name the real raid in their MOCK DATA | **open — the guild lead's call.** `web/components/about/OverlayDemo.tsx` (the /about overlays), `web/app/mimic/mini/mocks.tsx` and `web/lib/miniReview.ts` (the mini vote page) render real raiders with classes, groups, mana and a DPS ranking. The mini page's cast was a deliberate choice so the guild recognises itself, and its vote is live — so the sweep skipped all three whole rather than editing them | pick per page: /about has no reason to use real names and can be swapped now; `/mimic/mini` should wait for the vote to close |
| Mimic mini mode — every overlay in a less-tall version, right-click ▭ toggle, per-overlay 📌 lock, Minimize-all hotkey (Ctrl+Shift+M) | **guild vote page LIVE on `main` 2026-09-11 — `wolfpack.quest/mimic/mini` (web 1.7.31); reviewed on beta first, graduated so nobody re-signs-in; the guild gets the link today.** Ballot lists only people who have picked; the three minis sit side by side with their descriptions collapsed underneath, opened by your pick (guild lead 2026-09-11). Full mode left, THREE options right (a third was added to every overlay), vote + persistent feedback per overlay, animated mocks with real raiders, Zeal 1.4.6 vs older-Zeal toggle. DS box on the Tank mini = damage returned PER HIT, not the running total (guild lead 2026-09-11). Rampage tank on the Tank mocks is a member, a paladin — warriors do not go DA (guild lead 2026-09-11). Copy button shrinks to tab size, copied line carries `\| local` / `\| merged` (parser tolerance must be checked first); Target-info resists show current-after-debuffs over full | the guild lead notifies the guild; watch the votes + feedback (`overlay_design_votes` / `_feedback`); re-park beta at 2.6.8 (page is on main now, nothing to carry); build nothing in Mimic until the picks land |
| Lord Mobsincamp — local assistant as the members' search | **designed 2026-09-12** (`docs/DESIGN-lord-mobsincamp.md`); name decided + configurable (`ASSISTANT_NAME`); nothing built | the guild lead's four calls (§9): broker vs tunnel; IPv4 add-on for a live replica; hosted-model bridge / fallback; accept the desktop (where the P40 actually is, 2026-09-12 — not Tower) as the model host, up when that PC is. Then Phase 0 = tool service + site UI |
| Zeal: put Target of Target on the pipe | **patch drafted 2026-09-12** (`docs/zeal-tot-pipe.patch`, applies to v1.4.7, NOT compiled here; PR text in `docs/zeal-tot-pipe-request.md`). **Consumer side LIVE on `beta` (agent 3.6.40, 2.6.8-beta.3):** Mimic sanitizes the two keys, the agent folds the answer into `observed_tanks` (raid-wide via the bot's #194 clustering) and patches the Extended Target row that is my own target (`mob_victim_source`, `mob_hit_by`), the overlay marks 🎯 / → / ⚔ | the guild lead builds the Zeal patch locally and opens the PR; nothing shows until a Zeal that carries it is released. **Second ask added 2026-09-15: the target's race + gender on the same message** (Plane of Hate's revenants — one name, two classes, only the sex differs; bot 3.1.127 already honours a `gender` hint). Bot follow-up (main): store `target_of_target` / `target_hit_by` on `character_live_state` and prefer authoritative connects in the clustering |
| Old-log importer + onboarding backups question + Setup row on top | **on `beta` 2026-09-13 (agent 3.6.42, 2.6.8-beta.8), stable 2.6.8 cut on `main`, beta re-parked at 2.6.9**; Guild lead: *"After that's set, lets push to main as well and get the split set up"* → cut stable 2.6.8, re-park beta at 2.6.9 | a member and others add archive folders from the Setup card or the Logsync tab; watch the first imports' validation messages |
| Night timeline · Central HUD · reuse timers + casts-left | **designed 2026-09-13**, `docs/DESIGN-night-timeline-and-central-hud.md`; nothing built | the guild lead picks: ring vs strip HUD; night view on the review page or its own route; Cooldowns class presets. Then timeline first (web, beta `?v=a`/`?v=b`), overlays after the mini picks |
| Tank overlay shield card credited 150-point procs as the tank's DS | **on `beta` 2026-09-13 (agent 3.6.41, 2.6.8-beta.6); stable 2.6.8 on `main` the same night.** A hit is a shield only when the log names one on that mob in the same second, or the tank's known DS buffs vouch for the amount; held for the pair window, re-added decided | watch the next raid's Tank overlay + `encounter_combat_rollup` `ds:*` keys — small named shields only; measure whether bystanders ever see the flavor line; graduate with the next stable |
| Quiet mode split — mute vs hide overlays | **on `beta` 2026-09-11 (agent 3.6.39, 2.6.8-beta.2).** Quiet mode = mute only; new "Don't show any overlays" switch owns visibility; Setup row follows it | beta testers confirm voice stops with Mute on and overlays stay; graduate with the next stable |
| Recent-fires card cannot tell a relayed fire from a local one | open — `dashboard.html` collapses `guild_relay` into "guild" (line ~2973); it hid which side the Shaman Slow leak was on | beta, agent bump: label relays "relay · from <name>" |
| Graphify of the codebase | **decided 2026-09-13 (the guild lead): keep a regen script, keep the outputs out, do not install the hook.** `scripts/graphify.sh` (also `npm run graphify`) rebuilds `graphify-out/` (gitignored) in ~30 s from the tracked tree minus the vendored skills; `--portable` writes an artifact-publishable copy. Honest scope: "who calls X / what does X reach" with line numbers, plus import cycles; blind to config keys threaded through code, cross-process payload contracts and `#if 0` C++ | none — rebuild when a call-chain question comes up; HOW-ITS-BUILT stays the index of intent |
| PoP timers: fixed schedule vs our ±20% | open — guidance says fixed; `utils/state.js`, `utils/supabase.js` and the kill cards hard-code 0.8/1.2 | per-boss `variancePct` in `bosses.json` (0 for PoP), honoured in the three sites + card text, before 10-01; confirm against the official notes |
| A per-character PoP progression dump command is coming → authoritative flags on `/pop` | open — the guild lead holds the pre-release detail; the log-line format is unknown until it is live | when live: a real `eqlog_*` excerpt, then agent parser → `pop_flags` |
| Mimic-wide audit of raw `try/catch` error text + a way to submit errors to the guild lead | **requested 2026-09-10, NOT started.** The Zeal-install `EPERM` is one instance, now fixed; the guild lead wants every surface swept and a submit path | scope it as its own pass — inventory the catch sites first, then decide the submit channel (the `feedback` table + `/api/agent/feedback-send` already exist and could carry it) |
| Zeal spawn id: Mimic should null a pipe `target_id` of 0 at the edge | **done on `beta` 2026-09-12** — `_pipeSpawnId` in `apps/mimic/main.js` nulls 0 / non-numbers for spawn, target and pet ids (agent 3.6.40); the bot guard (3.1.123) stays for older Mimics | the agent's `_provableTargetId` still trusts a finite 0 from a pre-3.6.40 Mimic — tighten when convenient |
| Spawn-id adoption is ~half the fleet | open — 11 of 19 on 2026-09-10; poster built to push it | share `zeal-update-why.png`; re-measure the blind % in a week |
| 🎲 rolled-loot card is still ONE event per refresh | open (2026-09-07) | per-event cards filtered by `looted_items.zone` |
| Sequential-kill splitter splits one fight in two | open — one-line RPC fix diagnosed + tested, NOT applied, the guild lead's call | plus two duplicate rows from 09-06, untouched (merging is destructive) |
| Loot bidding: update / remove a bid | open — options A/B/C presented, awaiting pick | first live cancel on a low-stakes bid |
| A member: "Mimic takes my internet down" | investigated 2026-09-07; `scripts/mimic-netdiag.ps1` collects the evidence and NOW ACTUALLY PARSES (see above) | they run `-Watch` while playing, `-Live` when it breaks |
| P40 / local model | superseded 2026-09-12 by the Lord Mobsincamp design above; the card is in a member's desktop, not Tower, and stays there — no slot swap | see that row |
