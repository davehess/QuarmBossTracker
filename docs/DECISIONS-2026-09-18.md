# Decisions — 2026-09-18

## 1. The license: Business Source License 1.1, converting to AGPL-3.0-or-later (the guild lead)

> *"we're not making any money from this, but perhaps we could make it off
> hosting the services like opendkp or raid helper does?"*
> *"I want others to use it, then can deploy their own version and fork. if they
> take it and charge with it I should be entitled to a fair percentage."*
> *"can we make it where they can't charge for it without us coming to an
> arrangement?"*

**The call.** Relicense from BSD-3-Clause to **BSL 1.1** with an Additional Use
Grant that lets any guild run, modify and self-host it for its own community,
free; reserves *offering it to third parties for a fee* to the Licensor; and
names **AGPL-3.0-or-later** as the Change License, four years from each
version's publication. Landed as `LICENSE`, `docs/LICENSING.md` (plain
language), a **§9 Licensing** section in `CONTRIBUTING.md`, a License section in
`README.md`, `license: "BUSL-1.1"` in all four `package.json` files (two were
BSD-3-Clause, two declared nothing), and a correction in `docs/code-signing.md`
(the SignPath application claimed OSI status; BSL is not OSI).

**Why not the two obvious choices.**
- *BSD-3 (where it was)* lets anyone take the code, host it, charge for it and
  owe nothing back — including a guild we would decline, which is already
  question 3 in `DESIGN-external-tenancy.md` §10. Permissive licensing funds a
  competitor; that is the story behind every relicensing-under-pressure of the
  last decade.
- *AGPL alone* was the first recommendation and it is **wrong for the stated
  requirement**: AGPL §10 forbids adding any further restriction, royalties
  included, so under it anyone may charge freely as long as they publish their
  changes. "A fair percentage" is impossible on AGPL. It was recommended before
  the revenue requirement was stated and withdrawn the moment it was.
- *BSL → AGPL* reserves commercial use now, so charging requires an
  arrangement, and still ends fully open source on the copyleft license that
  actually reaches hosted services.

**What BSL cannot do, said plainly.** The guild lead also wants self-hosters to
*"provide their optimizations and platform compatibility so others can also use
it."* The BSL Covenants of Licensor (#2) allow the Additional Use Grant only to
*add* permission, never to impose a condition — so share-back **cannot be a term
of the grant**. Until the Change Date it is a norm asked for in `CONTRIBUTING.md`
and served by the fork-per-tenant model (§2 below); on the Change Date AGPL §13
makes it an obligation for anyone running a modified copy as a service.

**Two notes for a lawyer, if there is ever one** (nobody involved is one):
1. Covenant 1 requires the Change License to be GPL-2.0-or-later-compatible.
   AGPL-3.0 combines with GPL-3.0 under GPL-3.0 §13, which is the reading relied
   on. Fallback if judged too thin: GPL-3.0-or-later, losing only the
   network-service clause.
2. The relicense was clean because the repository has effectively one copyright
   holder (`git log`: the guild lead, Claude co-author trailers with no
   competing claim, the Actions bot). **That stops being true at the first
   merged outside contribution**, which is why the contribution grant
   (CONTRIBUTING §9, item 3) landed in the same change and not later.

**The commercial terms themselves — the percentage — are deliberately NOT in
the license.** The license only makes charging require a conversation; the
terms are agreed per arrangement. Nothing about them is decided.

## 2. The hosted-tenant model (recorded, nothing built)

> *"if I choose to host others instances we should have this able to be spun up
> quickly, know the full cost and be able to turn it over quickly, fully working
> and in their own repo that derives from this one, where we could see the
> optimizations and choose to promote them up."*

Recorded as the target shape for `DESIGN-external-tenancy.md` and
`DESIGN-selfhost-wizard.md`, which already carry the deployment analysis:
**tenant = a fork of this repository**, deployed from that fork, upstream = this
repo, improvements flow up as PRs the guild lead can promote. Four properties
every tenant stand-up must have: fast to spin up, **full cost known before
starting** (both layers are paid — `DESIGN-selfhost-wizard.md` §2a), fast to hand
over, and working on day one. Three prerequisites already on record and not to
be forgotten: **Vercel Hobby is non-commercial under Vercel's ToS** (a paid
service needs a paid plan — selfhost §2a); the tenancy doc's **§10 data and
trust questions** are prerequisites to taking money, not follow-ups; and a
**conversation with the Project Quarm operators** before charging — this is
tooling for an emulator that runs on tolerance, and its value depends entirely
on their server continuing to exist.

## 3. A tenant's data is the tenant's (policy)

> *"their guild data should be theirs and I should not see theirs without their
> express access and consent for troubleshooting, and honestly we should be able
> to extract anonymized data if need be."*

This answers tenancy §10 question 4. **Policy:** tenant data is tenant-owned;
the operator does not read it without **express, per-incident consent** for
troubleshooting; **anonymised aggregate extraction is permitted** — which means
the anonymisation must run *inside* the tenant before anything leaves it, so
"we can extract aggregates" never becomes "we can read the rows." Needs a
tenant edition of `docs/PRIVACY.md` before the first tenant, and shapes the
tenancy design toward per-tenant isolation with no standing operator
service-role access.

## 4. Other databases (MSSQL) — an epic, sized honestly

> *"I would be interested in additional database options, like running it
> directly in mssql."*

Recorded, not started, and **not a driver swap.** The platform is coupled to
Supabase-flavoured Postgres in four places at once: the bot talks through a
PostgREST client (`supabase.insert` / `.from()`), not SQL; the RPCs
(`find_or_create_encounter`, `merge_encounter_players` and 77 others — 79
functions, 124 tables per the tenancy doc) are PL/pgSQL; row visibility is RLS;
sign-in is Supabase Auth. MSSQL has none of those in the same shape. The honest
prerequisite is a real data-access layer that both databases sit behind, and
that refactor is the epic; the port is what follows it.

## 5. Field finding — Intel iGPU ghosting on the login screen was a missing `ddraw.dll`

A member setting up on a Comet Lake-U laptop (Intel UHD only, no discrete GPU)
saw a doubled/ghosted cursor on the EQ login and server-select screens. Their
EQ folder had `D3D8.dll`, `dgVoodoo.conf` and `dpvs.dll` byte-size-identical to
our known-good install — so dgVoodoo was present, not missing. **Copying
`d3d8.dll` and `ddraw.dll` from dgVoodoo2's `MS/x86` folder into the game folder
fixed it.** The mechanism that fits every observation: the login screens are
DirectDraw-era 2D surfaces; with only `d3d8.dll` wrapped, the 3D world went
through dgVoodoo while the 2D UI still hit Intel's native DirectDraw, which has
no real legacy path. Two follow-ups: `CRASH_FINGERPRINT_FILES` in the agent does
not hash `ddraw.dll`, so telemetry cannot say who else is exposed; and there is
no low-end-hardware guidance anywhere — Mimic's up-to-17 transparent
always-on-top windows are composited by the same 15 W iGPU that renders EQ.

## 6. Also today (the code is the record; one line each)

- **Mini-mode framework** on `beta` (v2.6.9-beta.5): ▭/📌 menu rows for the
  nine voted overlays, `Ctrl+Shift+M`, one writer behind menu/hotkey/dashboard.
  The nine renditions are not built; the vote result is in the table below.
- **Settings Save floats bottom-right, only when dirty** (beta.6).
- **A callout about your own character says "You" from every direction**
  (agent 3.6.44, beta.7) — relayed fires carried the originator's captured
  name. Applied to overlay text + speech only; deliberately not to the dedup
  key or the Discord/voice message.
- **v2.6.9-beta.4 shipped with no installer** — the `.exe` upload errored after
  the release was already published; re-running resolved the *next* tag
  (beta.5) and reported success while beta.4 stayed broken. Fix designed
  (publish as draft → verify the asset → flip live), stashed, not landed.

## 7. The guild kit — one configurable spot, a wizard, and a route back upstream (the guild lead)

> *"a configurable spot for users to fill out their guild's particular bits that
> we wouldn't consider improvements, just their own style and format … it should
> be build able into their own guild … perhaps through a wizard … install into
> on prem infrastructure, or choose our path … allow you or other AI tools to
> assist with troubleshooting … a framework that their own AI platforms could
> also use … a direct route upward that we can review from their GitHub, and the
> config should be their promise bits (envs and whatnot)"*

**Designed, slice 0 landed.** `docs/DESIGN-guild-kit.md`; the contract is
`guild/config.example.json` + `guild/README.md`; the deployment decisions are in
`DESIGN-selfhost-wizard.md` §3 under today's date. The four calls it makes:

1. **The "promise bits" are two kinds, and today they are mixed.** Of the 114
   variables in `.env.example`, **75 are Discord identifiers and 11 are real
   secrets.** Identifiers go in a committed `guild/discord.json`; style and
   format go in a committed `guild/config.json`; the ~11 secrets stay in the
   platform's secret store and are referenced by name. Channel *passwords* are
   secrets; channel *names* are config. Resolution everywhere is env → file →
   fallback, so nothing we run changes.
2. **The de-branding sweep now has a target and a size.** ~580 hardcoded sites
   across the four surfaces (297 × "Wolf Pack", 267 × `wolfpack.quest`) plus
   seven source files that hardcode the Discord guild id or the Supabase ref.
   It does not start until slice 1 gives it somewhere to point.
3. **Wizard shape picked (the guild lead, same day, "yes" to all four):** a
   CLI engine that provisions the Discord layout itself (the tenancy doc's #1
   abandonment point); fork as the default repo shape; palette as a semantic
   set; the hosted path stubbed to "talk to us" until Stage 5. Options and
   four-number costs in the design §4.
4. **AI assistance is the `CLAUDE.md` pattern, generated per tenant, vendor
   neutral:** `TENANT.md` + `tenant.json` + `wolfpack doctor`, whose bundle
   cannot contain a secret or member data because it never reads either.

Route upward: their repo is a fork; `sync-upstream.yml` never touches
`guild/`; `wolfpack diff-upstream` lists what changed outside it — improvement
candidates by definition — and a PR brings them here under `CONTRIBUTING.md` §9.

## 8. The tenancy questions, answered (the guild lead)

Ten answers to `DESIGN-external-tenancy.md` §10, each with the decision it
makes and where it landed. The one-line versions are appended to that doc's
§10; the hosted terms they imply are drafted in `docs/TERMS-hosted.md`.

1. **Size for the free tiers.** *"its more talking about the setup wizard, if
   they would size the environment for the free levels of railway, supabase,
   and vercel."* → The wizard gets a **free-tier profile** (the S size in §8.8):
   retention windows derived from the tier's storage, features that do not fit
   turned off, and honesty where free is impossible — **Railway Free cannot run
   the bot** (0.5 GB ceiling against a 0.70 GB peak, `CLAUDE.md`), so the S
   profile runs the bot on the guild's own box via Docker or names the smallest
   paid tier. Vercel Hobby is fine for a guild and not for anything paid.
2. **The window is short, and that shapes everything.** *"this server only has
   about 9 months or less in viability for large groups before people start to
   merge together to have enough people to play … people leaving and coming back
   to guilds a quarter their size, or raiding severely less often. eventually
   [the operator] may turn off this server."* → Three consequences: keep the
   commercial ambition proportionate — Stage 5 is not where the effort goes;
   **design for merges** — tenants combining, rosters shrinking to a quarter,
   raid cadence dropping (tick math already assumes nothing per night; roster
   and DKP merges do not exist yet); and **export and portability outrank
   hosting** — a shutdown must leave every guild holding its own archive, and
   the Quarm-specific seams (`_pq.proj` log suffix, the `eqemu_*` catalog) are
   the portability list for any other EQEmu server.
3. **Gate the competitive parts; "commercial" means managed hosting.** *"I
   would rather gate certain components, like the pvp who collection or pvp
   timers. but that's for competition. the commercial part would be if I were
   hosting it and providing feature requests without set timelines for a fee
   that would cover the architecture of their deployment and my time and
   resources."* → PvP /who collection and PvP timers are **feature-gated**, not
   license-gated. The commercial offering is **managed hosting plus best-effort
   feature requests with no committed timelines**, priced to cover that
   deployment's infrastructure and the guild lead's time. **No SLA.**
4. **Privacy, stated up front — and cross-tenant data is untrusted.** *"yes
   privacy is important, observations made by a guild are their own. data is
   easily fake able and could be garbage."* → Confirms §3 and answers the
   "do we say so" half: yes, in the terms. New rule: **observations made under
   another tenant are never merged into ours as fact** — the same data can be
   fabricated, and a shared pool would be a poisoning vector.
5. **Exit: monthly, in advance, encrypted handover at term end.** *"if the
   tenant costs money it needs to be exited by the next month, or the guild
   needs to be on a cycle where they've already paid for that month. if they
   have not paid or renewed the hosted option by then, their data will be
   encrypted and provided to them at term end."* → Paid tenants are on a
   monthly cycle paid in advance; non-renewal ends the term; **at term end
   their data is exported, encrypted to a key they hold, and handed over.**
   Deletion from our side after handover follows; its window is the one open
   detail (terms draft §6).
6. **No `/who` ingestion — with a per-person opt-in kept for later.** *"no we
   don't ingest their who data, unless individuals choose to have their who
   data synced up to a central repository - it lets them be known if they want
   to, as not everyone pvps. many just want their current player online to be
   known … our members could also have this info synced if they so chose, not
   to be taken lightly."* → Default **no**. Recorded, not built, and flagged
   sensitive: a **per-individual "be known" presence opt-in** — one player
   choosing to publish that they are online as a given character — applying
   equally to our own members, consent-gated per person, never per guild.
7. **PvP code ships; de-anonymising is double-locked.** *"lock the ability to
   override anon players without a feature flag or generated alliance code."*
   → The code ships in the bundle; the **anon-override path (the who-lookup
   de-anonymisation) requires BOTH `features.pvp` AND a generated alliance
   code** supplied as a secret. Stage 1's intent (split the PvP data) is served
   by this gate for tenants; our own project is unchanged.
8. **T-shirt sizes, all available at once; whatever we set up is in their
   name.** *"what can stand on its own? t-shirt sizes for effort and features
   make sense to me. some guild should be able to have everything if they
   deploy a website and own the domain. same thing with hosting, if I make it
   for them, they have everything for billing in their names, own the server.
   if I'm hosting it and pay for the domain perhaps we need what the industry
   permits. do I own the domain or do they? I think all at once."* → **S** =
   bot + Mimic on free tiers; **M** = + the web app on the guild's own domain;
   **L** = everything. All three offered from the start. **Ownership rule:
   anything we set up is in the guild's name — billing, server, domain.** On
   the question asked back — *who owns the domain when we host?* — the answer
   recorded is **the guild, always**: we take DNS delegation, never the
   registrar account, because §8.5's exit promise is impossible if the host
   owns the name. A subdomain under `wolfpack.quest` is the zero-setup start
   and is ours by nature; moving to their own domain is supported and expected.
9. **Mimic stays Mimic; guilds may rename their copy.** *"mimic is probably
   pretty engrained but if people want to change it for their guild I think
   that's fine."* → The binary and installer keep the name; the displayed name
   is per-tenant (`wording.mimicName`, already in the kit).
10. **Terms first, then the path, then the instructions.** *"make sure if
    someone starts doing some of it today, I'm covered. terms first then start
    on the way to spin it off, instructions for other guilds to follow."* →
    Order of work: (1) coverage — the license (done), `CONTRIBUTING.md` §9
    (done), **`docs/TERMS-hosted.md` drafted today for legal review**, tenant
    privacy folded into it and pointed to from `PRIVACY.md`; (2) the guild-kit
    slices; (3) `SELFHOSTING.md` → the wizard, as the instructions other guilds
    follow. Stages 0–1 of the tenancy plan are not scheduled ahead of these.

## 9. The launch pack — brochure, request page, polish, and the business pass (the guild lead)

> *"the output when I wake up tomorrow is that we'll be able to give our guild
> leaders a brochure style ad to the other guilds on the server … start a
> public request page built into the GitHub perhaps? the app probably needs a
> lot of polish, like making the quiet mode actually say 'quiet mode (no TTS
> audio)' … primarily use sonnet and opus subagents … go through all forms of
> what we need to implement in an architect capacity, from sales and marketing
> to accounting and if we would take payment how we would have to incorporate."*

**How it was run, because the guild lead asked for utilization to last the
week:** one workflow, eleven agents — four Sonnet readers at low effort
(features with evidence, the offer, public-safe numbers, a copy-polish
inventory), three Sonnet brochure angles → one Opus judge, one Opus business
architect, one Opus verifier over the polish inventory, one Opus public-repo
critic. ~1.06M subagent tokens, fourteen minutes, no adversarial fan-out.

**Brochure — `docs/marketing/guild-brochure.html`, a published page, and a
one-page PDF.** The judge chose the *less admin* angle (the reader is an
officer doing bookkeeping) and grafted the "One parse, not six" opener from
the *better data* draft. The critic returned six findings and all six were
applied before anything was published: "5 expansions" implied PoP is live
(it is locked until 10-01 — now "Classic through Luclin, with PoP flag
tracking in preview"); "backed up automatically" overstated a one-click
capture; "tells are filtered out" is false for a raider who opts into the
relay; the self-host CTA now says "budget an evening or two"; the terms are
named as a DRAFT with the no-SLA line on the page itself; and a reputational
claim about a named payment processor in the business doc was neutralised.
Numbers on the page are the public aggregates already used on the site plus
the boss count from `data/bosses.json`. Nobody is named.

**Request page — `.github/ISSUE_TEMPLATE/`.** Three issue forms (a guild's
request, a feature request, a bug report), each opening with the one warning
a public page needs, and a `config.yml` that turns off blank issues and links
SELFHOSTING, LICENSING and the roadmap first. **Enabling Discussions is one
click in Settings → Features — a repository setting, not a file.**

**Polish — beta.8 (agent 3.6.45) and beta.9 (3.6.47).** Quiet mode's wording
was not vague, it was wrong: the first-run page still said it hid overlays and
the tray called it "I use EQLogParser / other parser (Quiet mode)", while the
control has been mute-only since the 09-11 split. All three surfaces now say
"no TTS audio or sounds (overlays still show)". Nine more labels and tooltips
verified against their code before applying.

⚠ **Incident, recorded honestly.** Three things went wrong in that batch and
each has a rule now:
1. **3.6.46 (`e4c89158`) would have blanked the dashboard** — a tooltip with
   "guild's" folded into a single-quoted JS string unescaped. `check:dashboard`
   caught it *and the chain committed anyway*, because the check was piped
   through `tail`, which swallowed the non-zero exit. The release run was
   cancelled 52 seconds in and never published; 3.6.47 is the fix. **Rule: a
   gate's exit code must reach the shell — never `npm run check:dashboard |
   tail`.** This is the third apostrophe-class blank (v2.4.25, v2.4.27, now).
2. **3.6.45's release note described ten changes; three landed.** The apply
   step aborted on the first escaped apostrophe and the chain continued. The
   note reposted to `#mimic-releases` overclaimed for one build; 3.6.46/47's
   notes correct it. **Rule: escape apostrophes in the PROPOSED text whenever
   the target is inside a JS string, not only when the current text had one.**
3. **The verifier approved a change that would have broken a test** — it
   grepped for the full label and missed that `quiet-mode-split.test.js`
   asserts on its *prefix*. Caught by reading the test. **Rule: a verifier
   checks prefixes and regexes, not just whole strings.**

**Business — `docs/DESIGN-business.md`,** §0–§9: positioning and the offer,
channels that reach emulator guilds, the funnel with the tenancy doc's
abandonment estimate, cost-plus pricing from the real infrastructure numbers
and what a merge does to two paying guilds, taking payment as one person,
incorporation as a liability question with the sequence entity → bank →
processor → signed terms, proportionate bookkeeping, a risk register, and a
30/90/270-day plan with the point at which it is not worth doing. Not legal,
tax or accounting advice; it writes the questions for the professionals.

**Stale figure found on the way:** `CLAUDE.md` says 133 bosses;
`data/bosses.json` holds **135** across five expansions.

## Open — read this first

*(Rows carried forward from `DECISIONS-2026-09-16.md`; the sanitization sweep
itself is done and recorded there.)*

| Item | Where it stands | Next |
|---|---|---|
| **License → BSL 1.1 / AGPL Change License** | **done 2026-09-18** on `main` (§1). `beta` receives it via the sync workflow; the two version-parked `package.json` files there may keep `BSD-3-Clause` if the sync sides with beta | verify the four `license` fields on `beta` after the sync; if two are stale, fix them with the next beta push. **Commercial terms (the percentage) are undecided** — decide before the first arrangement, not in the license |
| **The guild kit** — config spot · wizard · AI-assist manifest · route upstream (§7) | **designed 2026-09-18, slice 0 landed:** `docs/DESIGN-guild-kit.md`, `guild/config.example.json`, `guild/README.md`. Code does not read `guild/` yet | **four picks made 2026-09-18** — CLI engine · fork · palette as a set · "talk to us" stub. Next: **slice 1** — config loader + `guild/discord.json` in the bot's anchor resolver (env still wins) — before the ~580-site de-branding sweep (slice 2). **§10 answered (§8); terms first → `docs/TERMS-hosted.md` drafted. Slice 1a landed (bot 3.1.129):** `guild/discord.json` fills unset anchor env at boot, refuses secret-shaped keys, env wins; `discord.example.json` generated from the 44 anchor reads. ⚠ There is no anchor resolver in the bot — the layer runs in front of env, not behind a function. Next: 1b (`config.json` + the manifest's `guildLabel`/`webBaseUrl`), then the sweep |
| **The brochure** — `docs/marketing/guild-brochure.html`, the published page (https://claude.ai/artifact/QwY1JG18UzZQNgkDtJAPgF, private until shared), the one-page PDF (§9) | **done 2026-09-18**, critic's six fixes applied before publishing; the share line is in §9's workflow result | the guild lead adds context or reworks wording; **enable GitHub Discussions** (Settings → Features, one click); hand the PDF to guild leaders |
| **Brochure targeting — which guilds already have tooling** | **done 2026-09-18 as a PRIVATE artifact** (https://claude.ai/artifact/LaCnGk8duoBohSCE1V4PCx), deliberately not in this public repo because it names other guilds and public tool authors. Method: every guild seen in `who_observations` over 60 days ranked by characters seen (never players — other guilds' alt families cannot be resolved); PQ Companion and DnDOverlay READMEs + `git shortlog`; Zeal's last 211 commits; the TAKP server codebase; every contributor handle matched against characters seen in 180 days. Result: four guilds with their own tooling or an active tool-builder (two high-confidence from self-credits and exact handle matches, two medium), **fifteen raid-sized guilds with no known tooling** — the brochure's list — and a smaller tail. quarm.guide is blocked from cloud sessions and GitHub search is session-scoped, so those two sources are missing | hand the top five a brochure each; treat the tooling guilds as an alliance conversation (merged parses across allied raids), not a sales one; **re-run in 60 days** — the 9-month forecast says the rosters will move |
| **Request page** — three issue forms + `config.yml` (§9) | **done 2026-09-18** | watch the first `guild-request` issues; labels are created on first use |
| **Plain-words polish** — beta.8 / beta.9 (§9) | **done**; the "Don't show any overlays" label kept on purpose (a test asserts its prefix) | the inventory found more than ten; a second pass is cheap once these are seen in the wild |
| ⚠ **Release gate incident** — 3.6.46 would have blanked the dashboard; 3.6.45's note overclaimed (§9) | contained: run cancelled before publish, 3.6.47 fixed, notes corrected | the three rules in §9 are now standing; the draft → verify → publish workflow hardening (row above) would have made the first one impossible to publish even if the gate were skipped |
| `CLAUDE.md` says 133 bosses; `data/bosses.json` has 135 | noted 2026-09-18 | fix on the next `CLAUDE.md` touch |
| `docs/DESIGN-business.md` — the architecture pass (§9) | **landed 2026-09-18**; not legal/tax/accounting advice by its own first paragraph | the professional questions in §5.2, §6.3, §7.2 are the guild lead's to take to a lawyer and an accountant before any money moves |
| **Hosted terms — `docs/TERMS-hosted.md`, DRAFT for legal review** | **drafted 2026-09-18** from §8: managed hosting + best-effort requests, no timelines, **no SLA**; monthly in advance; **exit = encrypted export handed over at term end**; the guild owns billing, server and **domain** (we take DNS delegation only); gated components identical hosted or self-hosted | a lawyer settles §9: service liability/warranty, governing law, the **deletion window after handover**, the notice period, and the conversation with the server's operators — a prerequisite to the first paid arrangement |
| Hosted tenants — fork-per-tenant model (§2) | recorded; mechanism in the guild-kit design §6; the offering's shape in §8.3/8.8 and the terms draft | the three prerequisites in §2, plus the terms' legal review, before any tenant |
| Tenant data policy (§3, §8.4/8.6) | **recorded and written down for members**: `PRIVACY.md` tenant edition + terms §5 — observations are the guild's; per-incident consent only; anonymise inside the tenant; **no `/who` ingestion**; **cross-tenant data never merged as fact** | nothing until a tenant exists |
| **Free-tier profile (size S)** | decided 2026-09-18 (§8.1): the wizard sizes for Supabase Free / Vercel Hobby, derives retention from the tier (7-day threat window or shed — wizard doc §2a), and is honest that **Railway Free cannot run the bot** (0.5 GB vs 0.70 GB peak) — S runs it on the guild's box via Docker | belongs to wizard slice 5; the retention-from-tier rule must be computed, not typed |
| **Alliance-code gate** on the anon-override | decided 2026-09-18 (§8.7): PvP /who collection + PvP timers behind `features.pvp` (off by default); de-anonymising anonymous players additionally needs a generated `ALLIANCE_CODE` secret, never set by the wizard | build with slice 2 (the flags) — the who-lookup path is the seam |
| Per-person "be known" presence opt-in | **noted for later, NOT to be built now, sensitive** (§8.6): one player choosing to publish that they are online as a character; applies to our own members too; consent per person, never per guild | design only when asked; the guild lead: *"not to be taken lightly"* |
| **~9 months of viability** — merges, quarter-size rosters, fewer raids, possible shutdown (§8.2) | recorded as the planning horizon | keep Stage 5 proportionate; **export completeness outranks hosting**; a **tenant/roster/DKP merge** operation does not exist and will be needed; the Quarm-specific seams (`_pq.proj` suffix, `eqemu_*` catalog) are the portability list |
| MSSQL / other databases (§4) | recorded, not started | data-access layer first; do not attempt a port before it exists |
| Release workflow: publish as draft → verify installer → flip live | **designed + half-written, stashed** (`git stash` on the session's beta checkout, "release-mimic draft-verify-publish"). Held for the raid freeze | land on `main` AND `beta` in one go — the workflow file runs from the branch pushed |
| `v2.6.9-beta.4` is a published release with no installer | open — the guild lead's call, deletion is destructive | delete it, or let it age out of the 10-entry atom feed |
| Mimic EQ-folder discovery: three bugs from one member's setup | open (2026-09-17). (a) `findEqInstalls` probes a candidate only, never its children — `C:\Quarm\TAKPv22` is invisible though `C:\Quarm` is on the default list; (b) `_zealEqDir()` never got the 2026-08-14 `knownDirs` fix, so "Check / install Zeal" refuses until a log file exists; (c) "Set up for me" returns `ok:true` with every file `(missing)` — a green ✓ for a no-op | fix all three on `beta`: one-level child descent, resolve Zeal's folder from known dirs, fail the setup call when nothing was written |
| `ddraw.dll` not in `CRASH_FINGERPRINT_FILES`; no low-end-hardware guidance (§5) | open | add `ddraw.dll` (+ `d3d9.dll`) to the fingerprint list; write the Intel-iGPU note into `docs/MIMIC.md` once one more case confirms it |
| UI Studio: add hotkeys · add chat windows · split chat routing out of the socials-shaped inspector · `[VideoMode]` width/height editor | open (2026-09-17). The inspector's DOM id is literally `socialsInspector`; eqclient.ini keys confirmed from a real file: `[VideoMode] Width/Height/RefreshRate/BitsPerPixel`, and `WindowedMode` exists in BOTH `[Defaults]` and `[Options]`. ⚠ The editor must be **allow-listed to specific keys, never a raw dump** — that file carries both channel passwords and a full alt roster | build in that order; the resolution setter offers the detected size with the borderless `−1` convention rather than applying it |
| UI Studio backups: bandolier, spell sets, socials | open. Socials are already bundled (`Socials_<c>` + `Sock_<c>`); bandolier is not an ini — it comes from `<Char>-Inventory.txt`; spell sets unplaced | need a `dir *.ini` + `dir *-Inventory.txt` of an EQ folder; then widen the bundle to the character's whole ini family + the inventory export |
| The guild lead's `eqclient.ini` (both channel passwords + 15 alt sections) was shared into a session | noted 2026-09-17; nothing written to the repo | rotate the two passwords (`TAG_CHANNEL_SPEC` env / `tag_channel_spec` tuning, then "Set up for me" for raiders) |
| ⚠ Test FIXTURES and golden logs still name every member | **open — the guild lead's call.** ~1,700 mentions across `test/` and `data/`. `CLAUDE.md` forbids blanket-renaming them because a fixture's name is load-bearing (the `{s}`-capture rule), and a rename has to regenerate the golden expectations in the same change | decide whether to rename. If yes: one stable map, `npm run golden:update`, full suite, and re-check `{s}`/leading-space assertions by mutation — not a mechanical pass |
| ⚠ Public pages name the real raid in their MOCK DATA | **open — the guild lead's call.** `web/components/about/OverlayDemo.tsx`, `web/app/mimic/mini/mocks.tsx` and `web/lib/miniReview.ts` render real raiders with classes, groups, mana and a DPS ranking. Under any license, that is published | `/about` can be swapped now; the mini page's vote has closed (below), so it can be swapped too |
| Mimic mini mode — the nine renditions | **vote closed 2026-09-17, one voter (the guild lead): tank A · target B · CH chain B · charm A · ext A · pet B · dps B · pop A · buff B.** Framework on `beta` (2.6.9-beta.5): ▭/📌 menu rows, `Ctrl+Shift+M`, `body.wp-mini`. No overlay implements its rendition yet | build in cost order — pop, charm, ext, tank, target, dps, pet, buff — then CH chain B on its own pass (`build: high`, needs a 100 ms local ticker). The DPS `\| local` / `\| merged` copy-line change stays gated on checking the bot's chat parser |
| Lord Mobsincamp — local assistant as the members' search | **designed 2026-09-12** (`docs/DESIGN-lord-mobsincamp.md`); name decided + configurable (`ASSISTANT_NAME`); nothing built | the guild lead's four calls (§9): broker vs tunnel; IPv4 add-on for a live replica; hosted-model bridge / fallback; accept the desktop as the model host. Then Phase 0 = tool service + site UI |
| Zeal: put Target of Target on the pipe | **patch drafted 2026-09-12** (`docs/zeal-tot-pipe.patch`, applies to v1.4.7, NOT compiled here). Consumer side LIVE on `beta` (agent 3.6.40) | the guild lead builds the Zeal patch locally and opens the PR. Second ask (2026-09-15): the target's race + gender on the same message. Bot follow-up: store `target_of_target` / `target_hit_by` on `character_live_state` |
| Old-log importer + onboarding backups question + Setup row on top | on `beta` 2026-09-13 (agent 3.6.42), stable 2.6.8 cut, beta re-parked at 2.6.9 | members add archive folders from the Setup card or the Logsync tab; watch the first imports' validation messages |
| Night timeline · Central HUD · reuse timers + casts-left | **designed 2026-09-13**, `docs/DESIGN-night-timeline-and-central-hud.md`; nothing built | the guild lead picks: ring vs strip HUD; night view on the review page or its own route; Cooldowns class presets. Then timeline first, overlays after the mini renditions |
| Tank overlay shield card credited 150-point procs as the tank's DS | on `beta` 2026-09-13 (agent 3.6.41); stable 2.6.8 | watch the next raid's Tank overlay + `encounter_combat_rollup` `ds:*` keys; graduate with the next stable |
| Quiet mode split — mute vs hide overlays | on `beta` 2026-09-11 (agent 3.6.39) | beta testers confirm voice stops with Mute on and overlays stay; graduate with the next stable |
| Recent-fires card cannot tell a relayed fire from a local one | open — `dashboard.html` collapses `guild_relay` into "guild" | beta, agent bump: label relays "relay · from <name>" |
| Graphify of the codebase | **decided 2026-09-13:** keep `scripts/graphify.sh`, outputs gitignored, no hook | none — rebuild when a call-chain question comes up |
| PoP timers: fixed schedule vs our ±20% | open — guidance says fixed; `utils/state.js`, `utils/supabase.js` and the kill cards hard-code 0.8/1.2 | per-boss `variancePct` in `bosses.json` (0 for PoP), honoured in the three sites + card text, before 10-01 |
| A per-character PoP progression dump command is coming → authoritative flags on `/pop` | open — the log-line format is unknown until it is live | when live: a real `eqlog_*` excerpt, then agent parser → `pop_flags` |
| Mimic-wide audit of raw `try/catch` error text + a way to submit errors | **requested 2026-09-10, NOT started** | inventory the catch sites first, then decide the submit channel (`feedback` table + `/api/agent/feedback-send` exist) |
| Zeal spawn id: `_provableTargetId` still trusts a finite 0 from a pre-3.6.40 Mimic | Mimic side done on `beta` 2026-09-12 | tighten the agent side when convenient |
| Spawn-id adoption is ~half the fleet | open — 11 of 19 on 2026-09-10 | share `zeal-update-why.png`; re-measure the blind % |
| 🎲 rolled-loot card is still ONE event per refresh | open (2026-09-07) | per-event cards filtered by `looted_items.zone` |
| Sequential-kill splitter splits one fight in two | open — one-line RPC fix diagnosed + tested, NOT applied, the guild lead's call | plus two duplicate rows from 09-06, untouched |
| Loot bidding: update / remove a bid | open — options A/B/C presented, awaiting pick | first live cancel on a low-stakes bid |
| A member: "Mimic takes my internet down" | investigated 2026-09-07; `scripts/mimic-netdiag.ps1` collects + parses | they run `-Watch` while playing, `-Live` when it breaks |
| P40 / local model | superseded 2026-09-12 by Lord Mobsincamp; the card stays in a member's desktop | see that row |
