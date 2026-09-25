# AI contributor brief — self-contained (for chat AIs that can't browse the repo)

**How to use this file:** paste this ENTIRE file into a fresh Gemini / ChatGPT /
Claude chat, then send the prompt at the bottom (§7). Everything the AI needs is
here — it does **not** need to browse GitHub or read live files. Its job is to
produce **reviewable draft revisions as text**, which you then send to the
project (§5) to be checked against the real code, hardened, tested and merged.

*Snapshot date: 2026-09-25 (Mimic 2.7.1 stable · agent 3.7.16 · bot 3.1.148 ·
web 1.8.3). The live work list is `docs/STATUS.md` plus the "Open — read this
first" table at the top of the newest `docs/DECISIONS-*.md`; the member-facing
version is wolfpack.quest/roadmap. The guardrails below are stable.*

> **Wrong file?** If the assistant CAN read the repo and run commands (Claude
> Code, Gemini Spark, an agentic IDE session), use
> **`docs/GEMINI-SPARK-HELPER.md`** instead — it covers boot order, branch
> routing, the verification gate and the test tiers. This file is only for a
> chat with no repo access.

---

## 1. What the project is

Wolf Pack is a guild platform for the EverQuest emulator **Project Quarm**. Four
components in one public monorepo (github.com/davehess/QuarmBossTracker):

| Component | Path | Language | Branch |
|---|---|---|---|
| **Bot** — Discord bot + HTTP API for the agents | `index.js` (~20k lines), `commands/` (~90 slash commands), `utils/` | Node (CommonJS), discord.js v14 | `main` |
| **Web** — wolfpack.quest | `web/` | Next.js 14 (App Router), TypeScript, Tailwind | `main`; previews on `beta` at b.wolfpack.quest |
| **Agent** — log-parsing engine on each raider's PC | `packages/wolfpack-logsync/index.js` (one ~42k-line file, zero npm deps); its local dashboard is authored in `packages/wolfpack-logsync/dashboard.html` | Node (CommonJS) | `beta` |
| **Mimic** — Electron desktop app that bundles the agent + the overlays | `apps/mimic/` (`main.js`, `preload.js`, one `*.html` per overlay) | Electron/Node + browser HTML | `beta` (stable releases are cut from `main`) |

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
- Honor opt-out flags `exclude_from_stats` / `exclude_inventory` — excluded
  characters never contribute or display.
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

## 6. Menu of good async items (snapshot — pick from these or ask for the live list)

These are self-contained and reviewable without officer-only data or a live
raid. Most come out of Mimic 2.7.1 (2026-09-24), where the new HUD and the
nine "mini mode" overlays shipped with a few known gaps.

**Code drafts:**
- **Target Info mini: a ROOT timer row.** The mini Target Info shows the mob's
  health bar and a draining SLOW row, but no ROOT row, because nothing the
  overlay receives marks a debuff as a root. Draft: in the agent, flag root
  spells (spell effect 99, "root") on the target's buff list the way pacify is
  already flagged; in the overlay, add a blue ROOT row that drains like SLOW and
  vanishes when no root is up. *(Agent `packages/wolfpack-logsync/index.js` +
  Mimic `apps/mimic/mobinfo.html`, `beta`. Medium.)*
- **Pet mini: the haste percentage.** The mini Pet overlay shows the pet's haste
  buff by NAME where the guild voted for its PERCENT, because the pet data only
  carries the name. Draft: a small name → haste-% table in the page, the way the
  Extended Target overlay already carries slow percentages, sourced from the
  spell catalog (the reviewer can pull the numbers). *(Mimic `apps/mimic/pets.html`,
  `beta`. Quick.)*
- **Charm mini: the mob's magic resist.** The vote wanted "MR current (full)" —
  the resist after debuffs like Tashanian, with the base in brackets — but the
  charm data carries no resists. Draft where the numbers could come from (Target
  Info already receives the mob's catalog resists) and how the debuff is
  subtracted. *(Mimic `apps/mimic/charm.html` + possibly the agent, `beta`. Medium.)*
- **Two clicks that fall through to the game.** On a locked overlay every
  clickable thing needs the hover handshake (§2). Two do not: the category
  headers in the full Buff queue, and the dismiss ✕ on each pet in the full Pet
  list. Draft: add the handshake to both, matching how each page does it for its
  other buttons. *(Mimic `apps/mimic/buffqueue.html`, `apps/mimic/pets.html`,
  `beta`. Quick.)*
- **CH chain: an interrupted heal turns blue again.** In the full CH chain
  overlay, a healer's row goes red for 4 s after an interrupt, then back to a blue
  "casting" bar for the rest of the 10 s cast — as if a heal were still coming.
  Draft: once interrupted, a cast never counts as casting again (a NEW cast
  afterwards is fine). *(Mimic `apps/mimic/chchain.html`, `beta`. Quick.)*
- **Say what a pasted parse is.** The DPS meter's copy-to-/rs line should end in
  "| local" (this client's view) or "| merged" (the raid's merged view) so a
  paste says what it is — but only once the bot's chat parser is shown to accept
  the extra token without mis-reading the line. Draft both halves: the suffix in
  Mimic, and the parser check (plus fix, if needed) in the bot. *(Mimic
  `apps/mimic/overlay.html` on `beta` + bot `index.js` on `main`. Medium.)*
- **More skills on the HUD.** The HUD tracks each class's key cooldowns
  (combat ability, discipline, Mend, Feign Death, Lay on Hands, Harm Touch …).
  The guild has been asked which other skills people want tracked; draft the
  additions for a class you play: the skill, how its use shows in the log, and
  its reuse time on this server (the reviewer checks it against the server
  source). *(Agent's per-class cooldown table + the HUD, `beta`. Medium.)*

**Not code — a log line or an observation unblocks these:**
- A verbatim log line (timestamp and all) of a **pet** being hit by Death Touch —
  the callout recognises players but not pets.
- From the next Emperor pull: did the **tank-buster** countdown fire once or
  twice per cast? Two detection paths exist and must not both speak.

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
