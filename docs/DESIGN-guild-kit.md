# DESIGN — The guild kit: one configurable spot, a wizard, and a route back upstream

*Status: **designed 2026-09-18, slice 0 landed** (the config contract in
`guild/`). Nothing else built. Numbers below were measured against the tree at
`e83520c6` the same day; where something is an estimate it says so.*

**The guild lead's ask (verbatim):** *"let's work towards having a configurable
spot for users to fill out their guild's particular bits that we wouldn't
consider improvements, just their own style and format. color scheme(s) or
wording/language/channels/passwords/sites/APIs. it should be build able into
their own guild in as comfortable a way possible, perhaps through a wizard. an
installer or step through process that lets them install into on prem
infrastructure, or choose our path to start in as the fremium or paid models.
we would need to allow you or other AI tools to assist with troubleshooting if
that was necessary as a framework that their own AI platforms could also use to
comprehend the build and assist with. those artifacts should have a direct
route upward that we can review from their GitHub, and the config should be
their promise bits (envs and whatnot)"*

This sits on top of two designs that already exist and are not repeated here:
`DESIGN-external-tenancy.md` (the honest friction and the staged plan — Stages
2 and 3 are this document's slices 1–3 made concrete) and
`DESIGN-selfhost-wizard.md` (§3 is the ledger of deployment decisions the wizard
must carry; today's are appended there). The license that makes the hosted path
possible landed the same day (`docs/LICENSING.md`).

---

## 0. TL;DR

1. **Split "their bits" into two kinds and put each where it belongs.** A
   committed, public **`guild/config.json`** (name, palette, wording, channel
   *names*, raid nights, sites, APIs, feature flags) plus a generated
   **`guild/discord.json`** (the anchor IDs) — versus the platform secret store
   (**`.env`** / Railway / Vercel) for the ~11 things that are actually secret.
   Today those are mixed into one 114-variable env file, and **75 of the 114 are
   Discord identifiers that were never secrets.** Moving them into a committed
   file is what makes a guild's repo describe its own deployment.
2. **The wizard is a CLI engine, not a web form.** It provisions the Discord
   layout (killing the ~30-ID ceremony the tenancy doc names as the #1 give-up
   point), bootstraps the database, writes both config files and the secrets,
   and generates the AI-readable manifest. The hosted path calls the same
   engine behind a web skin later; on-prem runs it directly. §4 has the options
   with the four costs.
3. **AI assistance is a generated `TENANT.md` + `tenant.json` + `wolfpack
   doctor`.** Plain markdown and JSON at the repo root — the same thing
   `CLAUDE.md` is for us — so a tenant's Copilot, Gemini or Claude reads it
   identically. The doctor bundle is redacted by construction: no secrets, no
   member data.
4. **The route upward is a fork.** Their repo is a fork of this one; `guild/` is
   theirs and the upstream sync never touches it; anything they change *outside*
   `guild/` shows up in a `wolfpack diff-upstream` report and becomes a PR we
   can review and promote.

---

## 1. Measured: where our identity is baked in today

Counted in code only (not docs, not tests), `e83520c6`:

| String | bot | agent | Mimic | web | total |
|---|---|---|---|---|---|
| `Wolf Pack` (literal) | 58 | 40 | 73 | 126 | **297** |
| `wolfpack.quest` | 78 | 89 | 17 | 83 | **267** |
| raid tag channel name | 0 | 8 | 0 | 1 | 9 |
| officer channel name | 0 | 4 | 0 | 0 | 4 |
| bot URL (`…up.railway.app`) | 0 | 1 | 3 | 0 | 4 |
| Discord guild id, Supabase ref | in **7 source files**: `utils/openDkpSync.js`, agent `index.js` + `supervisor.js`, `apps/mimic/main.js` + `settings.html`, `web/lib/discord.ts`, `web/lib/quartermaster.ts` | | | | |

So the de-branding sweep (tenancy Stage 3) is **~580 sites across four
surfaces**, plus seven files that hardcode identifiers a tenant must never
inherit. That is the size of slice 2, and it is why the config contract comes
first: a sweep with nowhere to point is a sweep you do twice.

The env surface, `.env.example`:

| Kind | Count | Where it should live |
|---|---|---|
| Discord identifiers (channel / thread / message / role ids, user lists) | **75** | `guild/discord.json` — generated, committed |
| Real secrets (Discord token, Supabase service role, OpenDKP creds, bid key, agent token, RH key, ARI password, sheet id…) | **11** | the platform secret store, never committed |
| Tunables and URLs (budgets, cadences, base URLs, flags) | 28 | `guild/config.json` — or keep as env where the wizard doc §3 says they are per-deployment knobs |

⚠ The tag-channel **passwords** are the one thing the guild lead listed under
"their bits" that must *not* go in the committed config. They are referenced by
channel **name** from `config.json` and supplied as secrets. `CLAUDE.md`'s
standing rule already draws this line for our own repo; the kit just makes it
the tenant's line too.

---

## 2. The contract — `guild/`

Slice 0, landed. `guild/README.md` explains the split to a human;
`guild/config.example.json` is the schema by example. The shape:

```
guild/
  config.json          their style + format: identity, palette, wording,
                       channel names, raid schedule, sites, APIs, features
  discord.json         GENERATED by the provisioner: every anchor id the bot
                       needs. Committed — ids are not secrets
  TENANT.md            GENERATED: the AI/human-readable description of THIS
                       deployment (§5). Committed
  tenant.json          GENERATED: the same, machine-readable
.env                   the ~11 real secrets. Never committed
```

Three rules that make it work:

- **Nothing in `guild/` is ever read by upstream code as a default.** Upstream
  ships `config.example.json`; a tenant's `config.json` is theirs. The upstream
  sync (§6) is configured to never touch `guild/`.
- **Every consumer resolves in one order: env → `guild/` → built-in
  fallback.** The bot's anchor resolver already does `process.env.<KEY>` →
  `state.channelSlots` → `null`; slice 1 inserts `guild/discord.json` between
  the first two. Env keeps winning so nothing we run today changes.
- **A built-in fallback stays for anything safety-critical.** The agent's
  officer-chat privacy filter (`DEFAULT_DROP_PATTERNS`) derives the channel name
  from config *and keeps the hardcoded pattern* — a tenant who misconfigures the
  name must not start uploading officer chat.

---

## 3. What "their bits" are, and what they are not

The guild lead's line — *"their guild's particular bits that we wouldn't
consider improvements, just their own style and format"* — is the test for
what goes in `config.json`. If two guilds would legitimately want it different
and neither is *wrong*, it is config. If one way is better, it is code, and it
comes upstream.

| Config (theirs) | Code (ours, improvable) |
|---|---|
| name, short name, tagline, server | how a parse is merged |
| palette tokens, display font | overlay layouts and the rules behind them |
| wording: role names, the assistant's name, callout phrasing | trigger patterns matching the log |
| raid nights, window, timezone, deploy-freeze window | the freeze *mechanism* |
| channel names; which expansions are locked and until when | the lock logic |
| sites and APIs: web domain, bot base, OpenDKP host, PQDI | the OpenDKP citizenship budgets (env, per §3 of the wizard doc) |
| feature flags: pvp, opendkp, web, assistant | the features |

Palette is the one to be careful with. The tokens are shared across all four
surfaces on purpose (`.claude/skills/frontend-design`), and colour is semantic
there — red is death, gold is a roll value. A tenant may re-skin; the kit should
ship the tokens as a *set* with the semantics named, not eleven free hex fields.

---

## 4. The wizard — three shapes, one recommendation

Per the UI rule: genuinely different tradeoffs, four costs each.

### A. A CLI engine — `npx wolfpack-setup` *(recommended)*
Node, zero-dep like the agent. Asks the path first (on-prem / hosted-by-us),
then identity, then a Discord bot token — and **provisions the channel/thread
layout through the Discord API, capturing every anchor id into
`guild/discord.json`.** That single step is the one the tenancy doc estimates as
the likeliest abandonment point. Then: database (on-prem docker via the existing
`scripts/selfhost-bootstrap-db.sh`, or their Supabase project), secrets written
to `.env` or pushed to Railway/Vercel, `TENANT.md` generated, `doctor` run.

| build | maint | runtime | change |
|---|---|---|---|
| **med** — the provisioner is the real work; prompts and file writes are cheap | low–med | n/a, one-shot | **low** — a new question is a new step |

Works for on-prem because it runs *there*. Works for hosted because the same
engine runs on our side with our credentials.

### B. GitHub-native — template repo + a `setup` workflow
"Use this template", then a `workflow_dispatch` collects inputs and commits the
config. Strong on "their repo derives from ours" and on AI-readability
(everything is in git). Two things break it as the *form*: `workflow_dispatch`
caps inputs at ten, against a config with dozens of fields; and an Actions
runner cannot reach an on-prem LAN without a self-hosted runner, which is more
setup than the thing it is setting up.

| build | maint | runtime | change |
|---|---|---|---|
| med–high | med | n/a | med |

**Adopt its repo shape (§6); do not use it as the form.**

### C. A web wizard on wolfpack.quest
Prettiest, and the right skin for the hosted/paid path where *we* hold the
credentials. Wrong tool for on-prem: it cannot reach their infrastructure, so it
can only emit a bundle for them to apply by hand — which is the ceremony we are
trying to remove.

| build | maint | runtime | change |
|---|---|---|---|
| high — multi-step form + provisioning backend + tenant records | med | low | med |

**Later, for Stage 5 only, calling engine A.**

### The fork at the start of the wizard
*"install into on prem infrastructure, or choose our path to start in as the
freemium or paid models."* Same questions, different targets:

| | on-prem | hosted by us |
|---|---|---|
| database | their Postgres / Supabase docker (`selfhost-bootstrap-db.sh`) | a schema or project we provision |
| bot | their Railway / docker / box | a bot process we run per guild (tenancy §5.2) |
| web | their Vercel / Coolify | our deployment, their subdomain |
| secrets | written to their `.env` / platform | held by us; they never see ours |
| cost | **shown before starting**, from `DESIGN-selfhost-wizard.md` §2a | the arrangement (`docs/LICENSING.md`) |

⚠ "Freemium" is a product decision the tenancy doc's §10 leaves open, and the
Vercel Hobby non-commercial clause applies the moment anyone pays. The wizard
should be built with the hosted branch present but *stubbed* — a path that
prints "talk to us" — until Stage 5 is real.

---

## 5. The AI-assist framework — `TENANT.md`, `tenant.json`, `doctor`

*"allow you or other AI tools to assist with troubleshooting … a framework
that their own AI platforms could also use to comprehend the build."*

The framework already exists; it is what `CLAUDE.md` does for this repo. A
tenant gets the generated equivalent, describing *their* build:

- **`guild/TENANT.md`** — which surfaces are deployed and where (hosts, not
  secrets), the versions of each, which features are on, the raid schedule and
  freeze window, where the logs are, how to run `doctor`, what has been changed
  relative to upstream (from §6), and the one-paragraph explanation of each
  surface lifted from our own `CLAUDE.md`. Regenerated by the wizard and by
  `wolfpack doctor --write`.
- **`guild/tenant.json`** — the same facts as data, for tools.
- **`wolfpack doctor`** — the startup self-check the tenancy doc's Stage 2
  already wants, as a command: reachability of each surface, schema version vs
  code version, anchor ids resolving to real channels, agent token accepted,
  catalog present. Output is a redacted bundle a person can paste to any
  assistant.

**The redaction rule is structural, not a filter.** `doctor` reads
`config.json`, `tenant.json` and health endpoints — it never opens `.env`, never
queries member tables. So the bundle *cannot* contain a secret or a member's
tell, rather than being scrubbed after the fact. This is the tenant-data policy
(`DECISIONS-2026-09-18.md` §3) applied to support.

Deliberately vendor-neutral: markdown and JSON at the repo root, no
Claude-specific format. If we want extra guidance for a specific assistant, it
goes in that assistant's own conventional file and points at `TENANT.md`.

---

## 6. The route upward

*"those artifacts should have a direct route upward that we can review from
their GitHub."*

- **Their repo is a fork of this one.** Forks keep the native PR route, which is
  the whole point. ⚠ A fork of a public repository is public — acceptable
  because `guild/` holds no secrets by construction (§2), and anchor ids are
  visible to anyone in their Discord anyway. A guild that insists on a private
  repo can use "Use this template" instead and gives up one-click PRs (they
  contribute through a scratch fork). Default: fork.
- **`.github/workflows/sync-upstream.yml`** — `sync-beta.yml` pointed the other
  way: pull upstream `main` on a schedule, merge, and treat any conflict
  *outside* `guild/` as a loud failure. `guild/` is excluded from the merge
  entirely, so their config can never be clobbered by our release.
- **`wolfpack diff-upstream`** — lists every file they changed outside
  `guild/`, which is by definition an improvement candidate, and writes the
  summary into `TENANT.md`. "Promote" is then a normal PR from their fork,
  reviewed here under the contribution terms in `CONTRIBUTING.md` §9.

---

## 7. Build order, mapped onto the tenancy stages

| Slice | What | Tenancy stage | Size (est.) |
|---|---|---|---|
| **0** | `guild/config.example.json`, `guild/README.md`, this design | — | **done 2026-09-18** |
| 1 | Config loader + `guild/discord.json` in the bot's anchor resolver (env → file → state → null). Agent + Mimic read `guildLabel` / `webBaseUrl` from the bot manifest | 2 (partial), 3 | 1–2 days |
| 2 | The de-branding sweep: ~580 sites → config; the seven identifier hardcodes; the officer-filter fallback rule | 3 | 2–3 days (the tenancy doc's own estimate, now with a target) |
| 3 | The Discord provisioner — layout → `discord.json`. Usable standalone, before a bot exists | 2 | 2–3 days |
| 4 | `wolfpack doctor` + `TENANT.md` / `tenant.json` generation | 2 | 1–2 days |
| 5 | The CLI wizard stringing 1–4, with the on-prem / hosted fork (hosted stubbed) and `sync-upstream.yml` | 4 | 2–3 days |
| — | **One pilot guild, sat with** — exit: under 5 h, ≤ 3 questions | 4 | 1 week + support |
| — | Hosted skin (option C) calling the engine | 5 | only after two pilots ask to be hosted |

Slice 1 is deliberately tiny and is the seam everything else uses; slice 2 is
the one that should not start until slice 1 gives it somewhere to point.

---

## 8. Open for the guild lead

1. **Wizard shape** — A is recommended; B's repo shape adopted; C deferred to
   Stage 5. Pick, or say why not.
2. **Fork vs template as the default** — fork (public, native PRs) is
   recommended; see the privacy caveat in §6.
3. **Palette as a set or as free fields** — a set with named semantics is
   recommended (§3).
4. **What the hosted stub says** — a "talk to us" page is the minimum; the
   tenancy doc §10 questions 1–3 decide anything more.
