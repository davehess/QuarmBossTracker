# Gemini Spark helper — how to work in this repo

**Who this is for.** An agentic coding session (Gemini Spark, or any assistant
with file + shell access to a checkout) that is expected to ship real changes
here the way the Claude Code sessions do: read the committed context, make a
minimal change, prove it with tests, bump the right version, update the docs,
commit, push.

**Not to be confused with `docs/AI-CONTRIBUTOR-BRIEF.md`** — that one is for a
chat AI with *no* repo access; you paste it in and get back draft text a human
carries over. This file assumes you can read files and run commands.

**The prime directive:** this repo is worked on by several sessions that cannot
see each other's conversations. Anything that matters is written into a
committed file, or it is lost. That cuts both ways — read before you conclude,
and write before you finish.

---

## 1. Boot sequence — read these before touching anything

Claude sessions get this printed automatically by
`.claude/hooks/session-digest.sh`. You almost certainly do not, so run it
yourself or read the four files by hand. In this order:

| # | File | Why |
|---|---|---|
| 1 | **`CLAUDE.md`** (repo root) | The architectural map and the rules. It **overrides `README.md`** where they disagree, and it overrides your own instincts about branching, versioning and scope. Read it fully once per session — it is long, and skimming it is how sessions ship to the wrong branch. |
| 2 | **`docs/STATUS.md`** | The status ledger and durable work queue. What is done, what is queued, what was abandoned and why. Check here before proposing work — it may already be decided. |
| 3 | **`docs/HOW-ITS-BUILT.md`** | Feature → file + surface index. **Read this before ever saying "we don't have that."** |
| 4 | **`docs/DECISIONS-<newest>.md`** | Recent calls with their reasoning. `ls docs/DECISIONS-*.md \| tail -3`. |

Then, only if your task touches them: the matching `docs/DESIGN-*.md`,
`docs/RUNBOOK-*.md`, `docs/PRIVACY.md`, `docs/eqemu-catalog-cheatsheet.md`
(mandatory before any `eqemu_*` query).

```bash
bash .claude/hooks/session-digest.sh   # open items + doc index + live versions
ls docs/DECISIONS-*.md | tail -3
```

### The "do we already have X?" rule
A feature can live on **four** surfaces and often spans several:

- the bot — `index.js`, `commands/`, `utils/`
- the web app — `web/`
- the agent dashboard — the `WEB_HTML` template literal inside
  `packages/wolfpack-logsync/index.js`
- Mimic — `apps/mimic/*.html` + `main.js` + `preload.js`

**"No, we don't have that" is the failure-prone answer.** Never conclude it
from one grep of one file. Check `docs/HOW-ITS-BUILT.md`, then grep all four.

### Who you are talking to
There is **one** person: **Hitya**. They also play Uilnayar, Canopy, Rockin,
vj, Hopeya, Utoh, Melting and others — a report under any of those names is
still Hitya, and gets credited to Hitya. The single exception is the `feedback`
table (the wolfpack.quest form and `/feedback`), whose submitters are real other
members and keep their own names. Those names are also real **characters** in
fixtures and golden logs — this rule is about attribution text only, never a
blanket rename.

---

## 2. Order of operations for a task

1. **Read** the boot files above, plus the design/runbook doc for the area.
2. **Locate** the real code. Grep all four surfaces. Read the surrounding code
   and its comments — the comments here carry hard-won reasons, not decoration.
3. **Check the clock.** See §4 — a `main` push inside the raid window is
   forbidden.
4. **Change the minimum.** See §3.
5. **Test.** Write the test first if it is a pure function. See §6.
6. **Verify** — the full gate in §5. All of it, not the parts you think apply.
7. **Version.** Bump the right `package.json` per §4. Never edit a version
   anywhere else.
8. **Document, in the same change.** See §7. A ship without the doc edit is
   not finished.
9. **Commit + push** per §8.
10. **Report honestly.** If a test failed, say so with the output. If you
    skipped part of the scope, say which part and why.

---

## 3. Scope — the minimal-diff rule

> Touch only the code the task requires. If a change appears to need edits to
> adjacent or unrelated code, **stop and flag it** before proceeding.

`index.js` is ~18k lines and the agent is ~35k lines in a single file. That
makes "small line count" a bad proxy for "small blast radius" — reaching into
unrelated behavior is the structural hazard here, not diff size.

Two more standing rules:

- **Fail open.** Missing data, an unknown value, a service being down → degrade
  to safe defaults. Never crash, never hide data that exists.
- **Never deduplicate a per-observer stream** (live-state, threat, casting,
  target-casts, encounter). Each observer's view is a distinct fact.

---

## 4. Branch routing, versions, and the deploy freeze

### Where a change goes

| Change touches | Push to | Bump |
|---|---|---|
| Bot (`index.js`, `commands/`, `utils/`) | `main` | root `package.json` |
| Web (`web/`) | `main` | `web/package.json` |
| Agent (`packages/wolfpack-logsync/`) | `beta` | `packages/wolfpack-logsync/package.json` |
| Mimic (`apps/mimic/`) | `beta` (or `main` to cut a stable) | `apps/mimic/package.json` stays **parked** — the workflow auto-increments `-beta.N` |
| Supabase migration | `main` (the file) + apply | see §9 |
| Docs only | `main` | none |

**Versions live in `package.json` and nowhere else.** Never write a version
number into a doc. Patch bump by default.

A change spanning bot + agent lands as **two commits on two branches**.
Cherry-pick or file-checkout between them — never merge whole branches, and
never merge `beta` into `main` (beta carries the parked Mimic version and
in-flight work).

### Raid-night deploy freeze — hard rule
**No pushes to `main` on Sun / Wed / Thu between 19:30 and 00:30 ET.** A push
restarts the production surfaces the raid depends on.

```bash
TZ=America/New_York date '+%A %H:%M'    # check before every push to main
```

`beta` pushes are always fine (Mimic updates are pull-based). If something is
broken *during* a raid and the fix must ship now, put `[hotfix]` in the commit
message — that is also the escape hatch for the `raid-freeze.yml` tripwire.
Otherwise stage the work on a branch and land it after midnight ET.

### Release-visible text is member-facing
The graduation/stable commit body becomes the GitHub release body, which gets
reposted verbatim to raiders. Write it for someone on a phone: **one `- ` bullet
per user-facing item**, no prose paragraphs, and **no code identifiers or
library names**. EverQuest terms (rampage, DA, slow, CH chain, mez) are fine.
Detailed technical commits stay technical — this applies only to release
surfaces. **Never name a release without asking Hitya first.**

---

## 5. The verification gate

Run **all** of these from the repo root before you commit. The first three are
what CI runs (`.github/workflows/test.yml`); the rest catch things CI does not.

```bash
npm run lint             # eslint no-undef on the two monoliths — nothing else
npm run check:dashboard  # agent dashboard escaping + command.html embed drift
npm test                 # vitest, 151 files / ~2280 tests, ~18s
```

```bash
cd web && npx tsc --noEmit    # NOT in CI — Vercel is the only other place
                              # this fails, i.e. after you have already pushed
npm run golden:check          # parser expectations still describe the parser
```

What each one actually protects:

- **`npm run lint`** is a deliberately narrow `no-undef` tripwire, and the only
  rule in `eslint.config.js`. An undeclared global in an 18k-line monolith ships
  silently and throws only when that line executes (this caused a real outage).
  **Do not add style rules** — the value is that it is zero-noise.
- **`npm run check:dashboard`** parses every `<script>` block the agent
  dashboard emits and fails on a `SyntaxError`. See the escape hazard in §10.
  It also fails if `apps/mimic/command.html` has drifted from its embedded copy.
- **`npm test`** is the characterization suite. Everything must be green; there
  is no accepted-failures list.
- **`npm run golden:check`** replays a committed synthetic EQ log through the
  shipped parser and diffs the known-good result. If you changed the parser on
  purpose: `npm run golden:update`, **read every changed number** (each one is a
  change in what the raid's parses will say), and commit the expectation update
  with the code.

Useful extras: `npm run drill` (pre-raid checklist dry run),
`node scripts/sync-command-embed.js` (regenerate the Command Center embed after
editing `apps/mimic/command.html`).

---

## 6. Writing tests here

Three tiers, pick by what you touched.

**Pure module (preferred).** If logic can live in a small `utils/*.js` or
`web/lib/*.ts` with no I/O, put it there and import it directly in the test.
Recent examples: `utils/killLockouts.js`, `utils/lockoutBriefing.js`,
`web/lib/sharedBank.ts`. This is the shape to aim for when adding logic to a
monolith — extract the decision, leave the plumbing.

**Source-slice.** For a function that only exists inside a monolith and cannot
be exported (importing `index.js` boots the Discord client), use
`test/_source-slice.js`: it reads the real file, slices out the function by
start/end markers and `eval`s it, so the test tracks the **shipped** code and
fails loudly if the function is renamed or deleted.

```js
import { readSource, BOT_INDEX, sliceBlock } from './_source-slice.js';
const block = sliceBlock(readSource(BOT_INDEX),
  'async function _myFunction({', '\n}\n');   // end marker = closing brace at column 0
```
See `test/kill-lockouts-ingest.test.js` for a worked example with a fake
Supabase injected through a `require` shim.

**Guard tests.** Some tests exist to hold a rule, not to cover a function —
`db-read-discipline`, `workflow-yaml`, `pop-lock-guard`, `golden-log`,
`dashboard-tabs`. If one of these goes red, **read its header comment before
changing anything**; it explains the outage it was written for.

Conventions that matter:
- Test the **behavior Hitya described**, and quote them in the test name or a
  comment. Tests here double as the record of why a rule exists.
- Use **real fixtures**. A hand-written fixture that is subtly unlike production
  has shipped bugs here (a header parser silently dropped `"Raid Set 1 - Vex
  Thal"` because the invented fixture had no digits).
- When a test disagrees with your code, work out which one is wrong. Both
  outcomes happen.

---

## 7. Documentation is part of the change

Not optional polish. A feature that ships without its doc edit is what made
`/recall` report a shipped item as "blocked" the day after it landed.

In the same commit:

- **`docs/DECISIONS-<YYYY-MM-DD>.md`** — every call Hitya makes (a default, a
  threshold, a policy, a "we don't do that"), with **why** and where it landed.
  Append to today's file, creating it if needed.
- **`docs/HOW-ITS-BUILT.md`** — add or refresh the feature's row. A stale index
  produces exactly the wrong "we don't have that" answer.
- **`docs/STATUS.md`** — the ledger entry.
- **`web/lib/roadmapData.ts`** — a `releases[]` entry at the **top** for any
  user-facing change, in plain member-facing language (see the release-text rule
  in §4). Bump `web/package.json` for the roadmap edit like any web change.
- **`docs/DESIGN-selfhost-wizard.md` §3** — additionally, for any decision that
  changes how the platform is deployed, what it stores, or what it costs to run.
- **`docs/DESIGN-*.md`** — if the task has one, update it.

Write the *reason*, not just the change. "Threshold is 0.5" is worthless in six
weeks; "0.5 because our raids measure 0.75–0.89 roster share and pug raids
0.14–0.22, and it matches `REVIEW_FOREIGN_MAX_MEMBER_FRAC`" is the whole point.

---

## 8. Commit and push

```
<component> vX.Y.Z — short reason
```

Railway shows the merge commit message as the deploy name. Body: explain **why**,
not a file list — the diff already lists files.

```bash
TZ=America/New_York date '+%A %H:%M'   # freeze check (§4)
git add -A
git commit -F -                        # heredoc; keep the body readable
git push -u origin <branch>            # always -u origin <branch>
```

Retry a push only on network failure, with backoff (2s, 4s, 8s, 16s).
**Do not open a pull request unless you were explicitly asked to.**

### When git state looks wrong
This environment's clone can come up with **stale refs** — local `main` and
`origin/main` pointing at an old commit, so it looks like work vanished. It has
happened, including in this session. Before concluding anything was lost, and
**before force-pushing anything**:

```bash
git fetch origin main beta
git log --oneline -3 origin/main
```
Then rebuild on the true head. Force-push only when you have verified the real
remote state and have a specific reason.

---

## 9. Supabase migrations

Files are `supabase/migrations/YYYYMMDDHHMMSS_description.sql` and must be
**idempotent** (`IF NOT EXISTS`, `EXCEPTION WHEN duplicate_object THEN NULL`).
The GitHub integration auto-applies on merge to `main`.

If the column is needed *now* (agents already sending the field): apply it via
your Supabase tooling **and commit the byte-identical file**, so repo history
and production history stay in sync. One without the other is the bug.

Two things that will bite you:

- Read `docs/eqemu-catalog-cheatsheet.md` **before** any `eqemu_*` query. NPC
  ids encode the zone (`id = zoneid*1000 + n`), `eqemu_npc_types.zone_short` is
  NULL across the catalog (join `spawnentry → spawn2` instead), and spell scrolls
  are items with no level data.
- `DELETE` on a published table needs a replica identity. If a migration drops a
  primary key and then deletes, Postgres refuses — **dedupe before dropping the
  key**, not after.

---

## 10. Traps that have already cost us

Each of these shipped a real bug. They are not hypothetical.

**`data/state.json` does not persist.** There is no volume on the Railway
service; every deploy boots fresh. Anything keyed per-night, per-fight or
per-anything-dynamic goes in the `bot_kv` table. (A per-night message id in
`state.json` posted the same raid review **eleven times in one night**.) Treat
`state.json` as a within-process cache only.

**The agent dashboard is one backtick template literal.** Two escape layers
apply, and one wrong character renders the whole localhost page blank with an
`Uncaught SyntaxError` — no partial degradation. In browser-side JS inside
`WEB_HTML`: newline is `\\n`, an apostrophe in a single-quoted string is `\\'`,
a client-side backslash is `\\\\`. **Run `npm run check:dashboard` after any
edit to that template.** This bug shipped twice.

**`apps/mimic/command.html` is embedded verbatim.** It must contain **no**
backtick, no `${...}`, no backslash — not even a `\uXXXX` escape. Use the
literal character. After editing, run `node scripts/sync-command-embed.js`.

**PostgREST silently caps every response at 1000 rows.** `.limit(5000)` does
**not** lift it — it is an upper bound applied on top of the cap, and you get a
short array with a `200`. Use `utils/supabase.js selectAllPaged` (bot) or
`web/lib/selectAll.ts` (web), always with a stable `.order()`. This footgun was
rediscovered independently four times; `test/db-read-discipline.test.js` is a
ratchet that fails CI when a new over-cap `.limit()` appears.

**Trigger patterns match the RAW log line.** The line is
`[Sun Aug 02 21:10:01 2026] <message>` and patterns compile with `i` and **no**
`m`, so `^` anchors before the **timestamp**, not the message. Write patterns
unanchored or anchored as `^\[.+?\]\s+`. **Never "fix" one by deleting the `^`**
— `{s}` expands to a class that includes space, so an unanchored pattern
captures `" Uilnayar"` with a leading space and corrupts every name-keyed
consumer downstream.

**Every `<details>` the dashboard emits needs `wpKeep(...)`.** Sections repaint
via `innerHTML` every 2s; a plain `<details>` snaps shut on each repaint.
`check-agent-dashboard.js` enforces this. Relatedly, a section's HTML must be
**byte-stable across polls when nothing changed** — anything volatile
(timestamps, counters, gauges) belongs in its own `wp*`-id placeholder filled by
a dedicated render function.

**Overlay feature-parity checklist.** A new Mimic overlay needs all of: a ✕ hide
button with its branch in the `hide-overlay` IPC handler; a ✥ move button with
manual-drag IPC (never CSS `app-region`) plus a right-click menu; the
`overlayHoverInteractive(true/false)` handshake on **every** clickable control
(locked overlays are click-through, so without it clicks fall through to EQ and
"the button does nothing"); a row in `WP_OVERLAY_ROWS` + `wpRefreshOverlayToggles`
+ the `toggle-overlay` IPC; an `apply*Visibility()` function; and its `cfg.show*`
flag in `_HIDEALL_FLAGS` and `_overlayEntries()`. A whole class of beta bugs was
overlays missing exactly one of these.

**PoP is locked until 2026-10-01** via `isPopLocked()` in `utils/config.js`.
PvP-event lockouts named for the war gods name-match Plane of Tactics bosses and
will synthesize phantom timers if you skip the gate.

**Adoption is counted in PLAYERS, never characters.** One person runs 3–12
characters, so character counts inflate roughly 10×. The honest figure is
distinct `uploaded_by_discord_id`.

---

## 11. What you probably cannot do from here

Say so plainly and write it down rather than guessing.

- **Local-machine data** — the live EQ client, the local `peq` MariaDB, crash
  bundles, character exports. Add a `⚠ Needs a local session` item to
  `docs/STATUS.md` with the **exact query or file** wanted.
- **Blocked egress** — pqdi.cc, eqemulator.org and the Porkbun API are
  unreachable from cloud sessions.
- **Dashboard-only settings** — Vercel domains, Supabase auth redirect URLs.
  There is no MCP tool for them; they are human-only steps.
- **Naming a release** — always Hitya's call. Propose, don't pick.

---

## 12. Definition of done

- [ ] Read `CLAUDE.md`, `docs/STATUS.md`, `docs/HOW-ITS-BUILT.md`, newest `DECISIONS`
- [ ] Minimal diff; anything beyond the task's scope flagged, not silently done
- [ ] `npm run lint` · `npm run check:dashboard` · `npm test` all green
- [ ] `cd web && npx tsc --noEmit` clean (if `web/` changed)
- [ ] `npm run golden:check` clean (if the agent parser changed)
- [ ] New behavior has a test that would fail without the change
- [ ] Correct `package.json` bumped — and only that
- [ ] Docs updated **in the same commit** (§7)
- [ ] Not inside the raid-night freeze window
- [ ] Pushed to the branch the routing table names
- [ ] Outcome reported honestly, including anything skipped or still failing
