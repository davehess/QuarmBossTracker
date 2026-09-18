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

## Open — read this first

*(Rows carried forward from `DECISIONS-2026-09-16.md`; the sanitization sweep
itself is done and recorded there.)*

| Item | Where it stands | Next |
|---|---|---|
| **License → BSL 1.1 / AGPL Change License** | **done 2026-09-18** on `main` (§1). `beta` receives it via the sync workflow; the two version-parked `package.json` files there may keep `BSD-3-Clause` if the sync sides with beta | verify the four `license` fields on `beta` after the sync; if two are stale, fix them with the next beta push. **Commercial terms (the percentage) are undecided** — decide before the first arrangement, not in the license |
| Hosted tenants — fork-per-tenant model (§2) | recorded, nothing built | the three prerequisites in §2 before any tenant; then the wizard epic |
| Tenant data policy (§3) | recorded | `docs/PRIVACY.md` tenant edition before the first tenant |
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
