# Contributing (for anyone changing the code)

For anyone changing code or docs here: officers, members who code, outside contributors and AI assistants.

## Layout and setup

- `index.js`, `commands/`, `utils/`: the bot, with the `/api/agent/*` surface.
- `web/`: the website (Next.js 14).
- `packages/wolfpack-logsync/`: the agent, one file with no dependencies. Its dashboard is authored in `dashboard.html`.
- `apps/mimic/`: the Electron app, which bundles the agent. `apps/bristlebane/`: the raid-voice bot (Node 22).
- `supabase/`: migrations and bootstrap SQL. `test/`, `scripts/`, `docs/`: tests, tooling, documentation. `guild/`: a guild's own config. `data/`: the boss list.

Use Node 20. Run `npm install` at the root, and in `web/` if you touch the site. Copy `.env.example` to `.env` for the bot; it documents every variable.

Read `CLAUDE.md` and `docs/STATUS.md` first. Before saying "we don't have X", read `docs/HOW-ITS-BUILT.md` and check all four surfaces (bot, web, agent dashboard, Mimic): one grep is not enough.

Source: `CLAUDE.md`; `README.md`; `docs/HOW-ITS-BUILT.md`.

## The review bar (everyone)

- **Minimal diff.** Touch only what the task needs; flag edits to unrelated code instead of making them.
- **Fail open.** Missing data or a downed service degrades to safe defaults. Never crash or hide data that exists.
- **Never deduplicate a per-observer stream** (live state, threat, casting, target casts, encounters): each raider's view is a separate fact.
- **Privacy scopes.** Every log-derived stat declares PRIVATE, ANON or GUILD and honours the opt-outs (chapter 9).

Source: `CLAUDE.md`; `CONTRIBUTING.md` §4; `docs/GEMINI-SPARK-HELPER.md` §3.

## The verification gate

Run all of it before you commit.

| Command | What it catches |
|---|---|
| `npm run lint` | Undeclared globals in the bot and agent. The **only** ESLint rule, on purpose: such a name throws only when its line runs |
| `npm run check:dashboard` | Drift between `dashboard.html` and the generated dashboard, a `<script>` that does not parse, eaten backslashes, a `<details>` without `wpKeep`, drift in `command.html`'s embedded copy |
| `npm test` | The vitest suite. No failure is accepted |
| `npm run golden:check` | The parser no longer matches a committed synthetic EQ log. After a deliberate change run `golden:update` and **read every changed number**: each changes what a raid's parses say |
| `cd web && npx tsc --noEmit` | Web type errors. CI skips it; Vercel is the next place it fails |

CI runs lint, `check:dashboard` and the tests on every pull request and on pushes to `main`, `beta` and `alpha`; `golden-log.yml` runs the parser checks.

Source: `package.json`; `.github/workflows/test.yml`, `golden-log.yml`; `scripts/check-agent-dashboard.js`.

## The agent dashboard

**Edit `packages/wolfpack-logsync/dashboard.html`, run `npm run sync:dashboard`, commit both.** Never hand-edit the `WEB_HTML` literal in the agent; two blank dashboards shipped that way. Agent-side values are written `{{WP:expr}}`; a `${}` in the `.html` is page text. `apps/mimic/command.html` is the opposite: it is embedded verbatim, so it may contain no backtick, `${` or backslash. After editing it, run `node scripts/sync-command-embed.js`.

Rendering rules:

- A section's HTML must be **byte-stable across polls** when nothing changed, or the whole section rewrites every 2 seconds.
- Volatile values (times, counters, gauges) live in their own `wp*`-id placeholder, filled by a dedicated function.
- Build every `<details>` as `'<details ' + wpKeep('stable|unique|key') + …`. A plain one snaps shut on every repaint. `check:dashboard` enforces it.

Source: `CLAUDE.md` (Dashboard authoring, rendering rules); `scripts/sync-dashboard-embed.js`.

## Writing tests

- **Strip comments before any text assertion.** Comments here are detailed enough to satisfy a `toMatch` on their own. Use `stripJs`, `stripSql` or `stripCss` from `test/_source-slice.js`, and strip whole lines only. Never strip a source you also slice with comment anchors.
- **Prefer behaviour to text.** `sliceBlock(src, start, end)` and `evalBlock(block, names)` pull a function out of a monolith and run it. Import `utils/*.js` and `web/lib/*.ts` directly.
- **Beware the vacuous assertion.** A cap tested with fewer rows than the cap passes without the cap. Break the code on purpose and watch the new test fail. Prefer real fixtures to hand-made ones.
- **Guard tests** (`db-read-discipline`, `workflow-yaml`, `pop-lock-guard`, `golden-log`, `dashboard-tabs`) hold a rule, and each header explains the outage behind it. Read it before changing one.

Source: `CLAUDE.md` (comments satisfy text assertions); `test/_source-slice.js`.

## Adding an overlay: the parity checklist

Beta bugs kept turning out to be an overlay missing one of these.

1. ✕ hide button, plus its branch in the `hide-overlay` IPC handler.
2. ✥ move button with manual-drag IPC (never CSS `app-region`), and a right-click menu.
3. The hover handshake `overlayHoverInteractive(true/false)` on **every** clickable control. Locked overlays are click-through, so without it the click reaches EverQuest. Buttons and inputs get it automatically; a clickable `<div>` needs `data-wp-interact`.
4. A row in `WP_OVERLAY_ROWS`, its key in `wpRefreshOverlayToggles`, and a case in the `toggle-overlay` IPC.
5. Visibility through its `apply*Visibility()` function.
6. Its `cfg.show*` flag in `_HIDEALL_FLAGS`, and an entry in `_overlayEntries()`.

Anything in the tray menu also goes on the dashboard, wired to the same code.

Source: `CLAUDE.md` (Overlay feature-parity checklist, tray parity).

## This repo is public

- **Attribute by role**: "the guild lead", "a member", "an officer", "a third party". Keep the date and the quote; drop the name. Never record which characters belong to which person.
- **Fixtures, golden logs and trigger patterns hold real names as data.** Do not rename them: a name can be load-bearing. Worked examples in prose use invented names.
- **No addresses or identifiers of anyone's machine** (LAN IPs, VM ids, hostnames, tunnel URLs): write `<home-server-ip>`. Sweep with `grep -rn -E '192\.168\.|10\.[0-9]+\.' docs/ scripts/`.
- **No secrets in code or commits.** New variables go in `.env.example`. The service-role key never reaches the browser, the web bundle or the agent dashboard. A new `SECURITY DEFINER` function must not be callable by `anon`.
- **Security findings, credential locations and member-specific detail** go in the private briefing. Summarise a feedback report; never copy the sender's name.

Source: `CLAUDE.md` (attribution, public repo); `CONTRIBUTING.md` §4.

## Writing decisions down

- **Calls** go in `docs/DECISIONS-<date>.md`: a numbered section with the call, why, and where it landed. Keep its `## Open — read this first` table current (Item, Where it stands, Next); the session-start hook prints it. Append, never rewrite: `.gitattributes` merges these ledgers by union. ⚠ One running file (dated 2026-09-21) still carries the log: append to the newest.
- **Deployment, storage or cost decisions** also get a line in `docs/DESIGN-selfhost-wizard.md` §3, when you make them.
Source: `CLAUDE.md`; `.claude/hooks/session-digest.sh`; `.gitattributes`.

## Licence

The code is **AGPL-3.0-or-later**. Any guild may run, modify, fork and self-host it for free. **Section 13** is the one obligation: if you modify it and let others use your version over a network, offer them your source. Unmodified use, or changes nobody else reaches, trigger nothing. Hosting a modified version without publishing it needs a commercial licence.

There is no CLA. **Opening a pull request is the agreement**: you have the right to contribute it, it is AGPL like the rest, you grant the Licensor the right to relicense it, and you keep your authorship.

Source: `LICENSE`; `docs/LICENSING.md`; `CONTRIBUTING.md` §9.

## Outside contributors: the pull-request path

1. Branch `contrib/<yourname>/<item>` from the component's home branch and open the PR into it: bot and web use `main`; agent and Mimic use `beta`.
2. Pick work from `docs/STATUS.md`. Web fixes, agent parsing with a clear repro and overlay polish suit a first PR. Ask an officer before touching OpenDKP auth, DKP money maths, reporter election and dedup, or migrations.
3. In the PR, give the item, the change, the gate results, a guardrail self-check and open questions.
4. Do not merge your own PR, push to `main` or `beta`, bump versions or edit release files. An officer routes and cuts the release.

Source: `CONTRIBUTING.md` §2 to §7.

⚠ `CONTRIBUTING.md` is partly stale: it counts four components and three gates, and says excluded characters "never contribute or display", which is wrong (chapter 9; `docs/AI-CONTRIBUTOR-BRIEF.md` repeats it). Follow this chapter and `CLAUDE.md`.

## If an AI assistant does the work

The working agreements for AI sessions (how to reply, when to offer options, which skills win, which tools to edit with) live in `CLAUDE.md` under "Working rule" and are loaded automatically by Claude Code sessions. A non-Claude assistant starts from `docs/GEMINI-SPARK-HELPER.md`. Two rules apply to every assistant: commit messages go through a file (`git commit -F`), and the gate above runs before every commit.

Source: `CLAUDE.md` (Working rules); `.claude/settings.json`.

## Filing feedback as a member

Use the tray's **Send feedback**, the dashboard's **Feedback** button, `wolfpack.quest/feedback` (up to 4,000 characters; screenshots when signed in), or `/feedback` in the guild Discord. All land in one list and one Discord thread, and your report gets an **`FB-<n>`**. You get a DM when it ships. GitHub issues are public: strip names, tells and channel names from any pasted log.

Source: `web/app/feedback/`; `.github/ISSUE_TEMPLATE/`.
