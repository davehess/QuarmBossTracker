# Contributing to the Wolf Pack platform

**This is the one file to read before you open a pull request.** It's written so
either a person *or* an AI coding assistant (Claude Code, etc.) can pick an open
queue item, build it correctly, and hand back a PR that's ready for an officer +
Claude to review, harden, and merge. Follow it and your work merges fast; skip
it and it bounces on the guardrails below.

If you're pointing an AI assistant at this repo: give it this file first, then
`CLAUDE.md` (the architecture + rules). Treat the "Guardrails" and "The review
bar" sections as hard constraints, not suggestions.

---

## 0. What you're working on

The platform is four components in one monorepo (full map in `CLAUDE.md`):

| Component | Path | Branch it lives on |
|---|---|---|
| **Bot** (Discord + HTTP API) | `/` (`index.js`, `commands/`, `utils/`) | `main` |
| **Web** (wolfpack.quest) | `web/` (Next.js 14) | `main` |
| **Agent** (logsync engine) | `packages/wolfpack-logsync/` (single file) | `beta` |
| **Mimic** (Electron desktop) | `apps/mimic/` | `beta` |

**Which branch you start from depends on the component you touch** — see §3.

## 1. One-time setup

Node 20, then from the repo root:

```
npm install                 # root deps (bot + test suite + lint)
cd web && npm install       # web deps (only if you touch web/)
```

The three gates every PR must pass (run them locally before you push):

```
npm run lint                # ESLint no-undef wall over the bot + agent
npm test                    # vitest suite (currently 289 tests)
npm run check:dashboard     # agent-dashboard escape check (see §4)
cd web && npx tsc --noEmit  # web type-check (only if you touched web/)
```

CI runs the same three on every PR and push; a red gate blocks the merge.

## 2. Pick an item

Open work lives in three places — read them in this order:

1. **`docs/STATUS.md`** — the ledger (what's done, what's TODO, what was
   abandoned). Start here.
2. **`docs/DESIGN-platform-queue.md`** — the ordered wave plan with rationale.
3. **`docs/HOW-ITS-BUILT.md`** — the feature-by-feature index. **Read this
   before assuming a feature doesn't exist** — "we don't have X" is the
   easy-to-be-wrong-about answer, and it wastes your tokens rebuilding
   something that's already there. A feature can live on any of four surfaces
   (bot, web, agent dashboard, Mimic overlays) — check the index first.

**Good first items** (self-contained, no officer-only data or decisions):
web-only features and fixes, agent parsing/trigger logic with a clear repro,
overlay UI polish, documented bugs with a screenshot. **Avoid without checking
with an officer first**: anything touching OpenDKP auth, DKP/loot money math,
the reporter-election/dedup guardrails, Supabase migrations, or anything marked
"needs officer sign-off." When in doubt, comment on the item and ask before
building.

## 3. Branch, build, gate

**Branch from the component's home branch, and PR back into that same branch:**

- Touching **bot** (`index.js`, `commands/`, `utils/`) or **web** (`web/`)?
  → branch from **`main`**, PR into **`main`**.
- Touching **agent** (`packages/wolfpack-logsync/`) or **Mimic** (`apps/mimic/`)?
  → branch from **`beta`**, PR into **`beta`**. (Agent/Mimic development happens
  on `beta` and soaks there before graduating to stable — so your work lands on
  the beta channel first, exactly where new features are tested.)

Name your branch `contrib/<yourname>/<short-item>` (e.g.
`contrib/kravenn/quartermaster-immunities`).

Then build to the guardrails in §4, add tests (§5), and get all three gates
green.

## 4. Guardrails — the hard constraints

These are non-negotiable. A PR that violates any of them will be sent back.

### Privacy (load-bearing — `docs/PRIVACY.md` is the source of truth)
- **Officer chat, tells, group, and custom channels are dropped at BYTE LEVEL,
  before parsing, on the user's machine — they never leave it.** Never add a
  feature, upload, or log line that sends private-channel content anywhere.
- Every log-derived stat declares a visibility scope: **PRIVATE** (owner's `/me`
  only), **ANON** (nameless aggregates), or **GUILD** (named, signed-in members).
  New stats must declare and honor one.
- Honor the opt-out flags on `characters`: `exclude_from_stats` and
  `exclude_inventory`. Excluded characters never contribute or display.

### Security
- **Supabase RLS tiers**: public `eqemu_*` catalog is anon-readable; guild data
  is `authenticated`-only; encrypted bid columns are service-role-only. The bot
  uses `service_role` and bypasses RLS — **never expose the service-role key or
  any secret to the client / web bundle / agent dashboard.**
- New SECURITY DEFINER SQL functions must **not** be callable by `anon` (we just
  closed exactly this hole — don't reopen it). Pin `search_path`.
- **No secrets in code or commits** — API keys, tokens, and creds come from env
  vars, never hard-coded, never committed. Add new env vars to `.env.example`
  with a comment.

### Correctness & blast radius
- **Minimal diff.** Touch only the code your item requires. If your change
  seems to need edits to unrelated code, stop and flag it in the PR rather than
  reaching into it — the 13k-line `index.js` and 24k-line agent make "small line
  count" a poor proxy for "small blast radius."
- **Fail open.** Where the platform expects graceful degradation (missing data,
  a service down, an unknown value), your code must fall back to safe/default
  behavior, never crash or hide data.
- **Never dedup a `per_observer` stream** (live-state, threat, casting,
  target-casts, encounter). Read `docs/DESIGN-dedup-and-mob-serialization.md`
  before touching anything reporter/dedup/same-name-mob related.

### Agent dashboard (`WEB_HTML` in the agent) — the twice-shipped bug
The whole agent dashboard is one backtick template literal with two escape
layers. One mis-escaped char blanks the page. **After any change there, run
`npm run check:dashboard`** — it enforces the escape rules and that every
`<details>` uses `wpKeep(...)`. Sections must be byte-stable across polls
(volatile bits live in dedicated `wp*` placeholder cards).

## 5. Tests

Add tests for new logic — CI won't accept untested behavior for anything
non-trivial. The repo has three fidelity tiers (see `test/`):

- **Real import** for `utils/*.js` and `web/lib/*.ts` (import the function,
  drive it).
- **Source-slice** for logic inside the two monoliths (`index.js`, the agent) —
  slice the real function out of the shipped source and exercise it, so the test
  stays coupled to the real code. See `test/_source-slice.js` and
  `test/election.test.js` for the pattern.
- **Mirror** (last resort) only when slicing is impractical — mark it with a
  `// MIRROR:` header naming the source + drift risk.

## 6. Open the PR

Your PR description should include:

- **Which queue item** it implements (link the `STATUS.md`/queue entry).
- **What you changed** and why, in plain language.
- **Gate results** — paste that lint / test / check:dashboard / tsc all pass.
- **Guardrail self-check** — confirm no private-channel data, no secrets, RLS
  respected, opt-outs honored, minimal diff.
- **Open questions / judgment calls** you'd like the reviewer to weigh in on.
- If you shipped a user-facing feature, **update `docs/HOW-ITS-BUILT.md`** so the
  feature index stays trustworthy.

**Do not** merge your own PR, push directly to `main`/`beta`, bump version
numbers, or edit release/roadmap files — an officer handles versioning, routing,
and the release cut at merge time.

## 7. What happens after you submit

An officer + Claude will:

1. **Review** against the bar below — security, privacy, correctness, blast
   radius, the gates.
2. **Harden** — tighten edge cases, add fail-open guards, extend tests, and
   adjust for anything that spans the monolith's non-obvious behavior.
3. **Route + merge** — agent/Mimic PRs soak on the **beta** channel first, then
   graduate to stable; bot/web PRs land on `main`. We handle the version bump,
   the signed commit, and the release cut.

Your job ends at "a clean, gated, reviewable PR." Expect review comments —
they're how we keep the raid's data spine safe, not a knock on the work.

## 8. The review bar (self-check before you submit)

- [ ] All three gates green (lint, test, check:dashboard) + web tsc if touched.
- [ ] Minimal diff — no unrelated files, no drive-by refactors.
- [ ] No private-channel data leaves the machine; scopes + opt-outs honored.
- [ ] No secrets committed; RLS + service-role boundary respected; no
      anon-callable SECURITY DEFINER functions.
- [ ] Fail-open on missing/unknown data.
- [ ] Tests added at the right fidelity tier for new logic.
- [ ] `docs/HOW-ITS-BUILT.md` updated if a feature shipped.
- [ ] Branched from and targeting the right branch (bot/web→`main`,
      agent/Mimic→`beta`).

---

## Quick reference

```
# Setup
npm install ; cd web && npm install

# Gates (run before every push)
npm run lint && npm test && npm run check:dashboard
cd web && npx tsc --noEmit          # only if web/ touched

# Branch routing
bot/web changes     → branch from main,  PR into main
agent/Mimic changes → branch from beta,  PR into beta
```

Read next: `CLAUDE.md` (architecture + rules) · `docs/STATUS.md` (the queue) ·
`docs/HOW-ITS-BUILT.md` (what already exists) · `docs/PRIVACY.md` (privacy) ·
`docs/DESIGN-platform-queue.md` (the plan). Questions on a specific item — ask
an officer before you build.
