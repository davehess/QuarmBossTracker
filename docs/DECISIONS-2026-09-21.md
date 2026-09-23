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
| **Jev context compaction (`fast-jev-compaction`)** | **assessed 2026-09-23 (§6), not adopted.** Real tool, real vendor, and it fixes a real loss — but our compaction pain is CROSS-session (cloud ↔ desktop cannot share a conversation at all) and Jev only helps within one session. It also routes every user and assistant message verbatim, plus every tool input, to a third-party early-access API | the guild lead's call, and it is a privacy call, not a tooling one. ⚠ **Blocked from here**: `typesafe.ai` and `docs.typesafe.ai` are both refused by the cloud egress proxy, so the data-retention/training policy, the price, and waitlist status are unverified. A desktop session can read them |
| ⚠ **Tower archive: five merge bugs fixed, catch-up IN PROGRESS** | 2026-09-23. The nightly merge failed 17 nights. Root cause was `encounters` never restoring into the snapshot (its id default lives in the `extensions` schema, which `--schema=public` never creates); four more bugs sat behind it (alphabetical order, one conflict target, DISTINCT FROM joins, generated/identity columns). All fixed; `archive-merge.sql` on Tower is now the repo's file (md5 `0b2ceb1a`), its own `refresh-local-archive.sh` carries the extensions block, 20/20 self-test on Tower. The last run was started 06:2x PDT and appeared to hang in the restore | find out whether that run finished or collided with the 05:30 nightly job (§7 has the check). Then merge the older dumps oldest-first and latest LAST — `docs/PATCH-tower-merge-order.md`. ⚠ `buff_casts` 09-06 → 09-15 is **recoverable** from the 09-11+ dumps if still on disk (an earlier note here said lost — wrong). ⚠ `target_observations` was swept in production at 2026-09-23 04:00 UTC; the 09-22 dump holds them, the 09-23 one does not. Then the production watermark |
| **Duplicate callouts** | **DONE 2026-09-23 (§7).** Five guild triggers disabled — each doubled by a built-in agent callout on the same line. No guild-vs-guild overlaps exist (4,321 spell lines checked) | nothing. Re-enable the slow ones if slows on ADDS need a callout: the built-in is main-target only |
| **Trigger disables never reached the fleet** | **FIXED 2026-09-23 (§7)** — bot 3.1.139 on branch `claude/sharp-lamport-dC0TW`, **not yet on `main`**. Worked around in data meanwhile | land the branch on `main` (outside 19:30–00:30 ET) |
| **UI calls made on the guild lead's behalf today** | 2026-09-23, on `beta`. Extended Target's toggles drop to icons below 380px wide (alternative: a two-row header that keeps the labels). Settings columns via a load-time section wrap (alternative: pure CSS columns — cheaper, but splits a section's controls across two columns). Roadmap entry titled with the plain version string | the guild lead picks, or keeps, before stable; and names the release if it wants a name |
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
thread read **`Gage → Hitya: Welcome to my bank!`** and **`Come back soon!`**,
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
— two refresh processes means a collision: stop both, run once.
