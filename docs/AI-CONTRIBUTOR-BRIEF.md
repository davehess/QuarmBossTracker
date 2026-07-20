# AI contributor brief — self-contained (for chat AIs that can't browse the repo)

**How to use this file:** paste this ENTIRE file into a fresh Gemini / ChatGPT
chat, then send the prompt at the bottom (§7). Everything the AI needs is here —
it does **not** need to browse GitHub or read live files. Its job is to produce
**reviewable draft revisions as text**, which a human then brings back to the
project's Claude Code session to evaluate, harden, and merge.

*Snapshot date: 2026-07-20. The live queue lives in `docs/STATUS.md` +
`docs/DESIGN-platform-queue.md`; the guardrails below are stable.*

---

## 1. What the project is

Wolf Pack is a guild platform for the EverQuest emulator **Project Quarm**. Four
components in one monorepo:

| Component | Path | Language | Branch |
|---|---|---|---|
| **Bot** — Discord bot + HTTP API for the agents | `index.js`, `commands/`, `utils/` | Node (CommonJS), discord.js v14 | `main` |
| **Web** — wolfpack.quest | `web/` | Next.js 14 (App Router), TypeScript, Tailwind | `main` |
| **Agent** — log-parsing engine on each raider's PC | `packages/wolfpack-logsync/index.js` (one ~24k-line file, zero deps) | Node (CommonJS) | `beta` |
| **Mimic** — Electron desktop app that bundles the agent + overlays | `apps/mimic/` (`main.js`, `preload.js`, `*.html`) | Electron/Node + browser HTML | `beta` |

**Data flow (one direction):** EQ log file + Zeal named pipe → **agent** (player's
PC) → **bot** HTTP API (per-user bearer token) → **Supabase** (Postgres) →
**web** reads Supabase / **bot** posts Discord. The agent never talks to Supabase
or Discord directly; the web never talks to the bot/agent directly.

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

**Agent dashboard caveat:** the agent's browser dashboard is one giant backtick
template literal (`WEB_HTML`) with two escape layers; one bad char blanks the
page. If an item touches it, note that the change needs `npm run check:dashboard`
to pass and that sections must stay byte-stable across polls.

## 3. How things currently work (enough to draft correctly)

- **Parses:** each raider's agent uploads its own view of a fight; the bot merges
  max-damage-per-player into one encounter (`find_or_create_encounter` dedups by
  npc + ±30-min window). The website `/parses/[id]` page renders the merged view.
- **Web pages** are React server components reading Supabase via a
  service-role client server-side (`supabaseAdmin()`); pure logic lives in
  `web/lib/*.ts` (importable, unit-tested).
- **Overlays** (Mimic `*.html`) poll the local agent (`/api/state`,
  `/api/tank-state`, etc.) ~1.5–2s and render. They're LOCAL — they read the
  player's own agent, not Supabase.
- **Triggers/callouts** run in the agent: compiled patterns + Zeal gauge
  conditions → text/timer/TTS. Rehearsal-flagged paths never upload.
- **Tests:** vitest. `web/lib/*` and `utils/*` are imported directly; logic
  inside the monoliths is tested by "source-slicing" the real function out of the
  shipped file. New logic needs a test.

## 4. Your output format (per item you pick)

For EACH item you draft, produce exactly this, in plain text/markdown:

1. **Item** — which queue item (name/number).
2. **Understanding** — what the issue/feature actually is, in 2–3 sentences.
3. **How it works today** — the current behavior/code path you're changing
   (state your assumptions explicitly, since you can't see the code).
4. **Proposed change** — the fix, as concretely as you can: which file(s), which
   function(s), pseudocode or actual code blocks. Keep the diff minimal.
5. **Guardrail check** — confirm it respects privacy, security, minimal-diff,
   fail-open (§2). Flag anything you're unsure about.
6. **Confidence + why** — high/medium/low and the reason. Call out assumptions a
   reviewer must verify against the real code.
7. **Test idea** — how you'd prove it works.

## 5. What you CANNOT do (and what happens next)

- You can't run the code, see live data, or open a pull request. Your output is a
  **draft** — a human copies it back to the project's Claude Code session, which
  verifies your assumptions against the real code, hardens it, adds tests, and
  merges to the right branch (bot/web → `main`, agent/Mimic → `beta`).
- So: **be honest about assumptions**, prefer well-specified items over
  speculative ones, and don't invent file paths/function names you're unsure of —
  describe the change at a level the reviewer can map onto the real code.

## 6. Menu of good async items (snapshot — pick from these or ask for the live list)

These are self-contained and reviewable without officer-only data. (Numbers are
the project's queue ids.)

- **#134 — Discord death post over-counts.** The website shows correct deaths
  (each raider once), but the Discord auto-parse card multi-counts (e.g. "Melting
  ×3"). The website already does correct cross-uploader death dedup (name+ts, ~3s
  window, + suppress names any single uploader reported dying 2+ times). Draft:
  port that dedup logic to the bot's Discord death-block rendering so the two
  match. *(Bot, `main`.)*
- **#132 — Loot-capture parser misses multi-item lists + false positive.** The
  officer loot-capture parser reads comma/pipe-separated item lists from `/gu`/`/rs`
  chat, but drops large multi-item lists and false-positives on chatter like
  "Grats Fungal". Draft: a more robust item-list parser (handle `Song:`/`Spell:`/
  multi-word item names, don't truncate) + a tighter guard against non-loot
  chatter. *(Bot/agent.)*
- **#133 — Collapse duplicate items into multiples.** When the same item appears
  multiple times in the auctions panel or loot capture, collapse into one entry
  with ×N instead of separate rows. Draft: group-by-name + sum quantities.
  *(Web + agent display.)*
- **#99 — Per-mob view.** A page/section showing every recorded fight against a
  given boss (all encounters for one npc), so the guild sees trends over time.
  Draft: a `/boss/[id]` enhancement or new page reading `encounters` grouped by
  npc. *(Web, `main`.)*
- **#100 — Per-person cross-fight performance.** On `/character/[name]`, show a
  raider's damage/healing/deaths across many fights (their history), respecting
  the ANON/GUILD scopes and opt-outs. *(Web, `main`.)*
- **#54 — /me named-mob kill counts.** On the member `/me` page, show how many of
  each named mob the character has killed, with a search + timeframe filter.
  *(Web + a Supabase query over encounters.)*
- **#83 — "Where's the parse" deep links.** One-click "Post to /rs" from the DPS
  HUD, and deep links between a Discord parse post and the wolfpack.quest parse
  page (each links to the other). *(Web + bot.)*
- **#66 — Command Center per-line dismiss.** The Command Center overlay needs a
  per-line ✕ / dismiss-all for stale cure entries. *(Mimic overlay, `beta`.)*
- **#67 — Buff-queue redraw fix.** Dismissing one buff-queue item currently
  collapses + redraws the whole overlay (disruptive mid-raid); it should remove
  just that row. *(Mimic overlay, `beta`.)*
- **#130 — Slow info on Target Info.** Show the active slow(s) on the current mob
  with the remaining timer, and mark the highest-% slow as the effective one
  (in EQ only the strongest slow applies). *(Agent + overlay, `beta`.)*

For any other item, ask the human to paste the relevant entry from
`docs/STATUS.md` or `docs/DESIGN-platform-queue.md`.

## 7. The prompt to send (after pasting this file)

> You are drafting revisions for the Wolf Pack Project-Quarm platform described
> above. You cannot browse the repo or run code — work only from this brief.
> Review the guardrails (§2) and the "how things work" notes (§3) as binding.
> Pick THREE items from the menu (§6) that you're most confident you can draft a
> real revision for. For each, produce the §4 output format exactly. Do NOT try
> to implement or open a PR — produce clean drafts a reviewer can verify and
> harden. Then, in at most three sentences total, tell me your overall
> understanding of what these three share, what your drafts change about the
> present behavior, and why you're confident. Be explicit about every assumption
> a reviewer must check against the real code.
