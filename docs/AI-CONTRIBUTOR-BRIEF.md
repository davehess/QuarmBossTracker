# AI contributor brief — self-contained (for chat AIs that can't browse the repo)

**How to use this file:** paste this ENTIRE file into a fresh Gemini / ChatGPT /
Claude chat, then send the prompt at the bottom (§7). Everything the AI needs is
here — it does **not** need to browse GitHub or read live files. Its job is to
produce **reviewable draft revisions as text**, which you then send to the
project (§5) to be checked against the real code, hardened, tested and merged.

*Snapshot date: 2026-11-03 (Mimic 3.0.6 stable · agent 4.0.53 on main, 4.0.60
on beta · bot 4.0.50 · web 2.1.103 · Bristlebane 1.0.0). The live work list is
`docs/STATUS.md` plus the open-items table in `docs/decisions/OPEN.md` (the
dated `DECISIONS-*.md` files are retired stubs); the member-facing version is
wolfpack.quest/roadmap. The guardrails below are stable.*

> **Wrong file?** If the assistant CAN read the repo and run commands (Claude
> Code, Gemini Spark, an agentic IDE session), use
> **`docs/GEMINI-SPARK-HELPER.md`** instead — it covers boot order, branch
> routing, the verification gate and the test tiers. This file is only for a
> chat with no repo access.

---

## 1. What the project is

Wolf Pack is a guild platform for the EverQuest emulator **Project Quarm**,
now also productizing as **raidmimic.com** for other guilds. Five components
in one public monorepo (github.com/davehess/QuarmBossTracker):

| Component | Path | Language | Branch |
|---|---|---|---|
| **Bot** — Discord bot + HTTP API for the agents | `index.js` (~26k lines), `commands/` (~90 slash commands), `utils/` | Node (CommonJS), discord.js v14 | `main` |
| **Web** — wolfpack.quest | `web/` | Next.js 14 (App Router), TypeScript, Tailwind | `main`; previews on `beta` at b.wolfpack.quest |
| **Agent** — log-parsing engine on each raider's PC | `packages/wolfpack-logsync/index.js` (one ~68k-line file, zero npm deps); its local dashboard is authored in `packages/wolfpack-logsync/dashboard.html` | Node (CommonJS) | `beta` |
| **Mimic** — Electron desktop app that bundles the agent + the overlays | `apps/mimic/` (`main.js`, `preload.js`, one `*.html` per overlay) | Electron/Node + browser HTML | `beta` (stable releases are cut from `main`) |
| **Bristlebane** — raid-voice bot, its own Discord app | `apps/bristlebane/` (own lockfile + Dockerfile) | Node 22 | `main` (redeployed by hand in Coolify) |

**Data flow (one direction):** EQ log file + Zeal named pipe → **agent** (player's
PC) → **bot** HTTP API (per-user bearer token) → **Supabase** (Postgres) →
**web** reads Supabase / **bot** posts Discord. The agent never talks to Supabase
or Discord directly; the web never talks to the bot/agent directly. Zeal 1.4.6+
puts a **spawn id** on the pipe, so same-named mobs can be told apart for
raiders on current Zeal; older Zeal is name-keyed, and the code must keep
working for both.

## 2. The guardrails — hard constraints (this is the review bar)

Any draft that violates these will be rejected. Treat them as non-negotiable.

**Privacy:**
- Officer chat, tells, group, and custom EQ channels are dropped at BYTE LEVEL
  before parsing, on the user's machine — they never leave it. **Never draft a
  feature that uploads, logs, or transmits private-channel content.**
- Every log-derived stat has a visibility scope: PRIVATE (owner only), ANON
  (nameless aggregates), or GUILD (named, signed-in members). New stats must
  declare one.
- Honor opt-out flags `exclude_from_stats` / `exclude_inventory`. Be precise
  about what they mean: they stop the character's OWN uploads and hide it on
  /me, the raid review and the quartermaster — they do NOT erase what other
  raiders' agents observe, and those rows still store and display. Never
  write "excluded characters never contribute or display"; it is false.
- **The repository is public.** Never put a member's name or character name in
  code, comments, docs or commit text — attribute by role ("the guild lead",
  "a member", "an officer"). Worked examples use invented names (Aldenmar,
  Brackwyn, Corvale, Nyssara, Rethlan). **Never write down which characters
  belong to which player.** No addresses, hostnames or anything describing a
  member's own machine or network.

**Security:**
- Supabase Row-Level Security tiers: public `eqemu_*` catalog is anon-readable;
  guild data is authenticated-only; encrypted bid columns are service-role-only.
  The bot uses the service-role key and bypasses RLS. **Never expose the
  service-role key or any secret to the browser, web bundle, or agent
  dashboard.** No secrets hard-coded or committed — everything from env vars.
- New `SECURITY DEFINER` SQL functions must NOT be callable by `anon`.

**Correctness:**
- **Minimal diff** — change only what the item needs; never refactor unrelated
  code. The two monoliths (`index.js`, the agent file) mean "few lines" ≠ "safe";
  reaching into unrelated behavior is the main hazard.
- **Fail open** — on missing/unknown data or a service being down, degrade to
  safe/default behavior; never crash or hide data.
- **Never deduplicate a `per_observer` data stream** (live-state, threat,
  casting, target-casts, encounter) — every observer's view is a distinct fact.

**Screens people read mid-fight:**
- **UI changes come as options.** A change to how something looks is proposed
  as two genuinely different designs (not one design in two colours), each
  previewed on the beta site or beta Mimic, and the guild lead picks one. Say
  which you would pick and why; never assume yours is the one that ships.
- **Colour means something.** Red = danger/death, green = healthy/ready,
  orange/amber = warning, blue = mana/casting, gold = rolls/XP, purple =
  rare/mez/procs. Monospace everywhere. An overlay is read at a glance over a
  moving game: density beats whitespace, and motion is a cost.
- **Every Mimic overlay has the same chrome:** ✕ hide (top-right), ✥ move
  (top-left) with a right-click menu, and a hover handshake on every clickable
  control — locked overlays are click-through, so a control without it passes
  the click to EverQuest. Nine overlays also have a **mini mode** (a small
  version drawn when `body.wp-mini` is on); a change to one of those says what
  it does in mini.

**Agent dashboard caveat:** the dashboard is authored in
`packages/wolfpack-logsync/dashboard.html` and folded into the agent file by
`npm run sync:dashboard`; `npm run check:dashboard` fails the build on drift.
Draft changes against `dashboard.html`. Sections must stay byte-stable across
polls (volatile numbers live in their own small placeholder), or the page
flickers every two seconds.

## 3. How things currently work (enough to draft correctly)

- **Parses:** each raider's agent uploads its own view of a fight; the bot merges
  max-damage-per-player into one encounter (`find_or_create_encounter` dedups by
  npc + ±30-min window). The website `/parses/[id]` page renders the merged view.
- **Web pages** are React server components reading Supabase via a
  service-role client server-side (`supabaseAdmin()`); pure logic lives in
  `web/lib/*.ts` (importable, unit-tested).
- **Overlays** (Mimic `*.html`) poll the local agent (`/api/state`,
  `/api/tank-state`, `/api/me`, …) every 1–2 s and render. They're LOCAL — they
  read the player's own agent, not Supabase. Themes (including three
  colour-blind ones) are one CSS filter over every overlay.
- **The HUD** (`apps/mimic/me.html`) is the player's own panel — a ring round
  the screen centre, or a Box — fed by the agent's `/api/me`.
- **Triggers/callouts** run in the agent: compiled patterns + Zeal gauge
  conditions → text/timer/TTS. Patterns match the RAW log line, which starts
  with a timestamp. Rehearsal-flagged paths never upload.
- **Supabase is on a paid plan with no request quota.** Writes are cheap;
  reads cost egress and the database only grows, so prefer narrow selects and
  cached reads, and say what a new table keeps and for how long.
- **Tests:** vitest. `web/lib/*` and `utils/*` are imported directly; logic
  inside the monoliths is tested by "source-slicing" the real function out of the
  shipped file and running it. Prefer testing behaviour over matching source
  text; a test that matches text must strip comments first (a comment can make
  it pass on its own). New logic needs a test, and a new test is checked by
  breaking the code on purpose and watching it fail.

## 4. Your output format (per item you pick)

For EACH item you draft, produce exactly this, in plain text/markdown — one item
per message, so each fits the 4,000-character feedback box (§5):

1. **Item** — which queue item (name/number).
2. **Understanding** — what the issue/feature actually is, in 2–3 sentences.
3. **How it works today** — the current behavior/code path you're changing
   (state your assumptions explicitly, since you can't see the code).
4. **Proposed change** — the fix, as concretely as you can: which file(s), which
   function(s), pseudocode or actual code blocks. Keep the diff minimal. For a
   UI change, two options (§2).
5. **Guardrail check** — confirm it respects privacy, security, minimal-diff,
   fail-open (§2). Flag anything you're unsure about.
6. **Confidence + why** — high/medium/low and the reason. Call out assumptions a
   reviewer must verify against the real code.
7. **Test idea** — how you'd prove it works, and how you'd break the code to
   prove the test can fail.

## 5. What you CANNOT do (and how a draft gets in)

- You can't run the code, see live data, or open a pull request. Your output is a
  **draft**. The person who asked you sends it in — one item per post at
  **wolfpack.quest/feedback** (signed in; 4,000 characters per post), or in
  **#feedback** on Discord — and a Claude Code session working in the real repo
  verifies your assumptions against the code, hardens it, adds tests, and
  merges it to the right branch (bot/web → `main`, agent/Mimic → `beta`).
- So: **be honest about assumptions**, prefer well-specified items over
  speculative ones, and don't invent file paths/function names you're unsure of —
  describe the change at a level the reviewer can map onto the real code.

## 6. Menu of good async items (snapshot 2026-11-03, Mimic 3.0.6 — pick from these or ask for the live list)

These are self-contained and reviewable without officer-only data or a live
raid. The reviewer checks every assumption against the code, so say plainly
what you are assuming.
<!-- menu refreshed 2026-11-03: shipped items removed (Charm MR chip, buff-queue
     headers FB-49), replacements sourced from docs/decisions/OPEN.md + STATUS.md -->


**Mimic and agent drafts (destination `beta`):**
- **#210 — A CH heal that was interrupted turns blue again.** In the full CH
  chain overlay, a healer's row goes red for 4 s after an interrupt, then back
  to a blue "casting" bar for the rest of the 10 s cast, as if a heal were
  still coming. The compact version already follows the right rule. Draft:
  once a cast is interrupted, it never counts as casting again (a NEW cast
  afterwards is fine). *(`apps/mimic/chchain.html`, `beta`. Quick.)*
- **#209 — Pet mini: the haste percentage.** The mini Pet overlay shows the
  pet's haste buff by NAME, but the guild voted for its PERCENT. Draft: a
  small name → haste-% table in the page, next to the existing list of pet
  haste buffs; the reviewer pulls the numbers from the spell catalog.
  *(`apps/mimic/pets.html`, `beta`. Quick.)*
- **#209 — Target Info mini: a ROOT timer row.** The mini Target Info shows
  health and a draining SLOW row but no ROOT row, because nothing the overlay
  receives marks a debuff as a root. Draft: in the agent, flag root spells
  (spell effect 99) on the target's buff list the way pacify and slow are
  flagged; in the overlay, add a blue ROOT row that drains like SLOW and
  vanishes when no root is up. *(Agent `packages/wolfpack-logsync/index.js` +
  `apps/mimic/mobinfo.html`, `beta`. Medium.)*
- **Muting a countdown should mute its warning.** Today a raider can silence a
  timer's countdown, but the warning callout attached to it can still fire.
  The guild picked: muting the countdown also mutes its own warning, nothing
  else. Draft where the mute is stored and where the warning checks it.
  *(Agent trigger/timer code + `apps/mimic/triggers.html`, `beta`. Quick.)*
- **Warn before levitate or run speed ends.** Zeal reports each buff's
  remaining ticks. The guild wants a callout shortly before Levitate or a
  run-speed buff drops. Draft: the rule (which buffs, how many ticks before
  the end, once per buff) and how the agent reads the tick count; state
  whether you assume the tick count is exposed on every buff. *(Agent,
  `beta`. Medium.)*
- **Guard the Zeal/UI zip install.** Installing a downloaded UI or Zeal zip
  can currently overwrite `uifiles/default`. Draft a guard: before
  extracting, list which existing folders would be overwritten and refuse (or
  ask for a yes) when the target is `default` or an existing custom UI.
  *(Mimic `apps/mimic/uiPacks.js` and `zealUpdater.js`, `beta`. Medium.)*
- **A refused charm should clear the staged charm.** When a charm fails with
  "Your target is too high of a level for your charm spell.", the engine does
  not read that line. A resist line usually follows, but if none does the
  expected charm stays staged ~12 s and the next pet event could start a
  charm timer that never happened. Draft: clear the staged charm on the
  too-high line itself. *(Agent charm pipeline, `beta`. Quick.)*
- **#144 — Health read from the wrong gauge, at the source.** Mimic works out
  which of Zeal's numbers is the player's own HP, and a weight reading (like
  130/180) can be mistaken for health. Displays ignore any pool under 500;
  the source does not. Draft: a candidate must look like a real HP pool (max
  at least 500, a clear margin between candidates), with a test.
  *(`apps/mimic/main.js` self-HP detection, `beta`. Quick.)*
- **Say what a pasted parse is.** The DPS meter's copy-to-/rs line should end
  in "| local" (this client's view) or "| merged" (the raid's merged view),
  but only once the bot's chat parser is shown to accept the extra token
  without misreading the line. Draft both halves: the suffix in Mimic and the
  parser check (plus fix if needed) in the bot. *(`apps/mimic/overlay.html`
  on `beta` + bot `utils/parseEqLog.js` on `main`. Medium.)*
- **#211 — More skills on the HUD.** The HUD tracks each class's key
  cooldowns (combat ability, discipline, Mend, Feign Death, Lay on Hands,
  Harm Touch …). Draft additions for a class you play: the skill, how its use
  shows in the log, and its reuse time on this server (reviewer checks the
  server source). *(Agent per-class cooldown table + the HUD, `beta`. Medium.)*
- **Name the fight after the right boss.** When a boss fight includes many
  adds, the agent names the fight after the most-damaged target, so a god
  fight can be filed under one of its adds. Proposed rule: name it after a
  known named boss that took at least 25% of the fight window's damage. Draft
  the rule and its edge cases (two bosses, a boss that dies early). The guild
  lead has not said go yet, so mark it a proposal. *(Agent fight naming,
  `beta`. Medium.)*

**Bot drafts (destination `main`; nothing that restarts the bot in a raid window):**
- **Compress the heavy routes.** The three busiest reads (agent poll, buff
  queue, live damage) send large JSON every few seconds, and the hosted-guild
  price only works if they are compressed. Draft: gzip those three responses
  when the client accepts it, and lift the live-damage cap (currently the
  first 60 rows). State what you assume about the current response code.
  *(Bot `index.js`, `main`. Medium.)*
- **Delete raw threat data 30 days after the fight's graph is saved.** The
  nightly sweep waits on an archive marker stuck since early September, so
  raw threat snapshots (about 60% of the database) pile up. Picked rule:
  delete a fight's raw threat rows 30 days after its summary graph is stored,
  archived or not. Draft the sweep in small batches with a time limit and the
  index it needs. *(Bot `index.js` + a migration, `main`. Medium.)*
- **#191 — One archive entry per fight.** The parse archive thread sometimes
  gets near-identical entries seconds apart from different uploaders.
  Collapse them, carefully, because the bot rebuilds its history from that
  thread on restart. *(Bot `index.js`, `main`. Medium.)*
- **Tag guest-raid roster rows.** Guest raids are stored as the guild's own,
  skewing attendance and stats. The pick: tag the rows and keep them out of
  the guild's numbers. Draft the tag and the filter wherever the numbers are
  computed. *(Bot + a migration, `main`. Medium.)*

**Web drafts (destination `main`; a new page ships live marked [beta]):**
- **#199 phase one — richer fight pages.** The fight page has a
  damage-over-time chart; add melee / DoT / spell mix bars and a per-ability
  breakdown per player, from the per-ability rollups the database already
  stores (only for uploads that carry them). *(`web/app/parses/[id]/`,
  `main`. Medium.)*
- **#54 — Named-mob kill counts on /me.** On the member's own page, how many
  of each named mob each of their characters has killed, with a search and a
  timeframe filter. PRIVATE scope; honor the opt-out flags. *(`web/app/me/`
  plus a query or database function, `main`. Medium.)*

**Not code — a log line or an observation unblocks these:**
- A verbatim log line (timestamp and all) of a **pet** being hit by Death
  Touch. May already be moot (the pattern was among the dead ones) but a real
  line settles it.
- From the next Emperor pull: did the **tank-buster** countdown fire once or
  twice per cast? Two detection paths exist and must not both speak.
- The exact "thread of time" **slow-mode ON** line from Druzzil, verbatim.
  The agent reads any such line as on/off but the ON text is not pinned.

For any other item, ask the human to paste the relevant entry from
`docs/STATUS.md`, or pick one from wolfpack.quest/roadmap ("What's next").

## 7. The prompt to send (after pasting this file)

> You are drafting revisions for the Wolf Pack Project-Quarm platform described
> above. You cannot browse the repo or run code — work only from this brief.
> Review the guardrails (§2) and the "how things work" notes (§3) as binding.
> Pick up to THREE items from the menu (§6) that you're most confident you can
> draft a real revision for. For each, produce the §4 output format exactly, one
> item per message. Do NOT try to implement or open a PR — produce clean drafts
> a reviewer can verify and harden. Then, in at most three sentences total, tell
> me your overall understanding of what these items share, what your drafts
> change about the present behavior, and why you're confident. Be explicit about
> every assumption a reviewer must check against the real code.
