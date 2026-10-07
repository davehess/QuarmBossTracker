# Docs inventory and handbook map — Wolf Pack EQ platform

Basis: worktree of `origin/main` at `8a8ce5ee` (2026-10-07). Read-only; nothing in the repo was edited. Method: header and headings of every doc, cross-checked against `docs/STATUS.md`, `docs/HOW-ITS-BUILT.md`, the code, `.github/workflows`, and `git log` dates. The counts below were computed, not estimated. Per the public-repo rule, people appear only by role; no real ids, hosts or names are repeated here. An untracked `docs/media/readme/` folder (images for a README draft) appeared in the worktree at 03:13 from another session; it is not in `origin/main` and is not inventoried.

## Summary

- **The doc set is large and mostly not instructions.** `docs/` holds 138 files (131 `.md`), including 22 `DECISIONS-*` logs, 56 `DESIGN-*` files (11 built, 22 partial, 19 not built, 4 reference), 7 `RUNBOOK-*` and 7 Zeal drafts or patches. Only about a dozen files tell a person how to do something that is still mostly true.
- **The same setup is written in three to six places and the copies disagree.** Part 2 lists 16 contradictions. The ones that would send a reader the wrong way: dashboard authoring (CONTRIBUTING and GEMINI say edit the generated literal), the agent token (three docs say the bot checks a shared secret it rejects), the PoP lock and boss counts, and a privacy claim CLAUDE.md says is false.
- **README is the entry point and is out of order.** Bot install (L44) comes before the Discord app (L232), env vars (L303) and permissions (L431); the standalone Parser sits under "Bot install".
- **`.env.example` is not the full list.** 36 variables the bot reads are missing, and it carries real Wolf Pack ids and a member's Discord username as defaults.
- **The ledgers cannot be the map.** STATUS's document map lists about 50 of 131 `.md` files and 3 of 22 DECISIONS files. One DECISIONS file (named for 2026-09-21) now holds 176 sections and the live "Open — read this first" table.
- **Constraint for the handbook:** existing docs cannot be moved (the `/ai` page, two tests and the SessionStart hook name them by path). Add `docs/guide/` beside them.

State legend: `current-instructions`, `current-reference`, `decision-log`, `design — BUILT | PARTIAL | NOT BUILT` (checked against STATUS, HOW-ITS-BUILT and the code, not the doc's own header, which is often stale), `runbook`, `handoff/historical`, `marketing`, `stale`. "Feeds" is a handbook chapter (01-11, from Part 3) or `none`.

# Part 1 — Inventory

## 1A. Entry points and root files

| File | Lines | What it is | State | Feeds |
|---|---|---|---|---|
| `README.md` | 484 | User-facing setup guide and command reference: raider install, bot install, channel layout, commands, Discord app, deploy, env vars, permissions, licence. Setup steps are scattered and out of order. Stale: PoP lock, 133 bosses, 83 commands | current-instructions (partly stale) | 02, 03, 06 |
| `CLAUDE.md` | 1394 | Architecture map, working rules and release playbook for AI sessions; says it outranks README. Stale in places (Part 2 items 1-3, 6, 10, 12) | current-reference (partly stale) | 01, 07, 08 |
| `CONTRIBUTING.md` | 247 | One-file contributor guide: setup, gates, branch routing, guardrails, tests, PR checklist, licence terms. Stale numbers, the wrong dashboard instruction and the wrong privacy sentence (L102) | current-instructions (partly stale) | 08 |
| `.env.example` | 620 | Bot env catalog with reasons, section by section. Claims to be authoritative but omits 36 vars; stale comments at L524, L557, L570; real Wolf Pack ids as defaults | current-reference (incomplete) | 03, 11 |
| `web/.env.example` | 55 | Website env catalog. Omits OFFICER_ROLE_NAMES, DEMO_OBFUSCATE_SALT, DISCORD_INVITE_URL | current-reference (incomplete) | 04 |
| `LICENSE` | 697 | Binding AGPL-3.0-or-later text | current-reference | 08, 11 |
| `PrivacyPolicy.md` | 80 | Policy for the original timer bot (dated April 2025 in the text); contradicts the current platform. Nothing references it | stale (superseded by docs/PRIVACY.md) | none |
| `TermsOfService.md` | 69 | Same vintage and scope as PrivacyPolicy.md | stale | none |
| `Parser.bat`, `RUN-FIRST-for-Node.js.bat`, `install-node.ps1`, `start-logsync.ps1` | 11 / 19 / 113 / 824 | Standalone agent launchers. The `.ps1` header documents flags and says it self-updates from `main` | current-instructions | 06 |
| `Dockerfile`, `docker-compose.yml`, `railway.toml` | 26 / 17 / 46 | Bot deploy config. `railway.toml` explains watchPatterns and `/health`; its header comment names a character | current-reference | 03, 11 |
| `web/vercel.json`, `web/next.config.js` | 31 / 86 | Vercel build gating (main and beta only, `ignoreCommand`), host redirects, beta flag | current-reference | 04, 07 |
| `.github/workflows/*.yml` (10 files) | 39-303 | CI, release and sync automation. `release-mimic.yml` header is the most precise statement of the release channels | current-reference | 07, 08 |
| `.claude/hooks/session-digest.sh`, `.claude/commands/recall.md`, `.claude/settings.json` | 53 / 44 / n/a | Session-memory tooling: prints the newest DECISIONS Open table; `/recall` | current-instructions | 08 |

## 1B. `docs/` top level (138 files, alphabetical)

| File | Lines | What it is | State | Feeds |
|---|---|---|---|---|
| `AI-CONTRIBUTOR-BRIEF.md` | 256 | Paste-in brief for a chat AI with no repo access: guardrails, output format, menu of items. Versions snapshot is 2026-09-25 (stale) and L53 repeats the privacy claim CLAUDE.md calls wrong. | current-instructions | 08 |
| `ARCHITECT-REBUILD-2026-08-16.md` | 418 | "If we rebuilt from scratch" assessment with measured numbers; explicitly not a migration plan. Its direction (Postgres is the home, Discord a projection) was adopted. | design — NOT BUILT | 01 |
| `audit-mob-specials.md` | 242 | Maintainer audit of the mob-special-ability catalog vs PQDI (#173); needs a machine that can reach pqdi.cc. | runbook | none |
| `AUDIT-site-monologues-2026-10-06.md` | 305 | Sweep of 130 instruction blocks on 63 routes (9,945 words) and 13 explanations repeated across pages; the two fix options await the guild lead's pick (§168). | current-reference | 04 |
| `bazaar-filter-pack.md` | 74 | Bazaar search presets and watchlists for the Luclin era; standalone, validated 2026-07-11. | current-reference | none |
| `beta-releases.md` | 66 | How the beta channel works (two tracks only, manual dispatch). Predates alpha and Linux; its "current state" block is 2026-06-05. | stale | 07 |
| `BETA-TESTING.md` | 2080 | Running ledger of beta test cases (solo / multi-person) per feature. "Current state" block is 2026-08-09 (Mimic 2.3.4, bot 3.1.34); everything in it has since graduated. | handoff/historical | none |
| `code-signing.md` | 187 | Windows signing plan. Contradicts CLAUDE.md: says REOPENED 2026-08-13, pipeline deleted (not "pre-staged OFF"), AGPL removes the OSI blocker. | design — NOT BUILT | 07 |
| `COSTS.md` | 224 | What the platform cost to build and run, measured, written to justify donations. Use only the free-vs-paid shape in a handbook, never the bills. | current-reference | 11 |
| `DECISIONS-2026-08-07.md` | 274 | Storage/threat, attendance, release process, Zeal /tag, loot bidding, the {s} P1, branches stop drifting; Open table. | decision-log | 07, 08 |
| `DECISIONS-2026-08-10.md` | 546 | Ssra callout prep, the "main also goes to beta" rule, "docs updated at both gates" rule, Unraid backup decision, repo could not rebuild its own schema. | decision-log | 07, 11 |
| `DECISIONS-2026-08-13.md` | 354 | Dashboard sidebar split, attendance sources, the XP-compatibility-mode (EPERM) Zeal pipe finding, chat double-posting, icon atlas. | decision-log | 02, 10 |
| `DECISIONS-2026-08-14.md` | 621 | CH chain, hover-reveal does not work on repainting overlays, loot-row fold, "Discord is a projection" call. | decision-log | 01, 08 |
| `DECISIONS-2026-08-19.md` | 146 | Tray and dashboard parity rule, overlay-size design, Seru minis as a group event, /who base classes. | decision-log | 08 |
| `DECISIONS-2026-08-20.md` | 361 | DT countdown, /parses curation, lockout cards, inventory auto-upload, shared-bank fingerprinting, PoP tiers. | decision-log | none |
| `DECISIONS-2026-08-21.md` | 333 | Witnessed-hail PoP flags, foreign lockouts, pre-raid briefing, officer channel wiring, the /ai methodology page. | decision-log | 03 |
| `DECISIONS-2026-08-24.md` | 94 | Officer-assisted Mimic linking and site access without Discord (the design behind RUNBOOK-site-access). | decision-log | 04 |
| `DECISIONS-2026-08-25.md` | 188 | PoP parchment pools, per-class spell levels, the OpenDKP incident and its call governor. A heading names a member's character. | decision-log | 03 |
| `DECISIONS-2026-08-26.md` | 370 | PoP My Characters tab, public OpenDKP counter plus kill switch, audit cadence and fast path. | decision-log | 03 |
| `DECISIONS-2026-08-27.md` | 212 | OpenDKP full download follows the raid calendar; an unexplained midnight sweep; the attribution rule that was wrong for three weeks. | decision-log | 03 |
| `DECISIONS-2026-08-30.md` | 43 | OpenDKP full bid histories, one detail call per auction. | decision-log | 03 |
| `DECISIONS-2026-09-01.md` | 168 | Zeal spawn-id capability observed not inferred; we are on Supabase Pro and there is no call budget; the retention sweep that never swept; free tier vs paid. | decision-log | 05, 11 |
| `DECISIONS-2026-09-02.md` | 114 | Website checklist audit (four real gaps), what was deliberately not done, the 2.6.4 graduation. | decision-log | 04 |
| `DECISIONS-2026-09-03.md` | 81 | Attendance heatmaps: what a night is, what "full" means. | decision-log | none |
| `DECISIONS-2026-09-04.md` | 216 | Attendance round two, uncurated-mob gate, "UI ships as options", Tower picture, personal deployment details stay out of the public repo. | decision-log | 08, 11 |
| `DECISIONS-2026-09-06.md` | 163 | A trigger placeholder resolves only if its capture group always participates; Target Info blank-on-0. | decision-log | 08 |
| `DECISIONS-2026-09-07.md` | 140 | Two events at once: kill cards go to the zone's thread (bot 3.1.124); a member's network report, no fix. | decision-log | none |
| `DECISIONS-2026-09-10.md` | 355 | Zeal 1.4.6 ships spawn ids (supersedes a CLAUDE.md boundary), setup-checklist walls, main CI red, wrong release body, graphify, Lord Mobsincamp named. | decision-log | 07, 10 |
| `DECISIONS-2026-09-16.md` | 93 | The sanitization record: attribution by role, source-comment sweep, what was deliberately left (fixtures, mock data). | decision-log | 08 |
| `DECISIONS-2026-09-18.md` | 605 | BSL then AGPL relicense, tenant-data policy, guild kit, tenancy answers, launch pack, cost accounting, repo-rename risk (the auto-updater). | decision-log | 08, 11 |
| `DECISIONS-2026-09-21.md` | 7706 | The running log: 176 sections to 2026-10-07 in one file, plus the live "Open — read this first" table the SessionStart hook prints. Name is misleading; see Part 2. | decision-log | 07, 08, 11 |
| `DESIGN-75-golden-log.md` | 375 | Golden-log parser regression net plus the pre-raid drill; CI workflow golden-log.yml exists. | design — BUILT | 08 |
| `DESIGN-80-raid-night-review.md` | 291 | Generated Raid Night Review (Discord embed plus /raid/review); /raidreview exists. | design — BUILT | 03 |
| `DESIGN-81-raid-guide.md` | 974 | Raid guide: phase 0 built (/guide, /guide/[bossId]); mechanics/callout blocks wait on an accretion table. | design — PARTIAL | none |
| `DESIGN-87-officer-console.md` | 921 | Officer runbooks RB-01..RB-12 and console. /admin/console shipped; RB-01..04 are full, RB-05..12 outlines, bot-side levers proposed only. | design — PARTIAL | 03, 10 |
| `DESIGN-agent-third-party-calls.md` | 330 | The rule for who the agent may call, with the full call list (§3) and local-only list. In force since agent 3.6.2. | current-reference | 09, 06 |
| `DESIGN-announcer-engine.md` | 284 | Announcer engine (miMIC, Bristlebane, Lord Mobsincamp). Only Bristlebane phase 1 (apps/bristlebane) exists. | design — PARTIAL | none |
| `DESIGN-bid-assist.md` | 193 | Per-character bid ledger, roaming planned bids, autobid safety rules; roaming prefs shipped (bot 3.1.77). | design — PARTIAL | none |
| `DESIGN-buff-debuff-queue.md` | 84 | Buff/debuff/cure queue. Header still says "proposal"; the overlay and raid-buff-queue endpoint are live. | design — BUILT | 02 |
| `DESIGN-business.md` | 942 | Positioning/selling/hosting/payment plan written for commercial hosting; banner says the model changed to AGPL cost recovery the same day. | design — NOT BUILT | none |
| `DESIGN-callout-overlay.md` | 209 | Countdown dismissal and timing feedback (#207); steps 2 and 4 built, 1, 3 and the health panel open. | design — PARTIAL | none |
| `DESIGN-ch-chain.md` | 53 | CH chain "DDR" overlay. Header still says "proposal"; chchain.html ships. | design — BUILT | 02 |
| `DESIGN-clock-correction.md` | 231 | Applying the clock offset (#202) and drift (#203): estimator live, apply-at-ingest still pending. | design — PARTIAL | none |
| `DESIGN-crash-review.md` | 402 | Consent-driven crash review; the review half shipped (agent 3.5.67). | design — PARTIAL | 09, 10 |
| `DESIGN-death-awareness-and-rez-queue.md` | 101 | Tombstones across overlays and a rez queue; still listed open in STATUS. | design — NOT BUILT | none |
| `DESIGN-death-semantics.md` | 369 | What counts as a death; sections 1-2 shipped (FD, corpse-run tail), 3-5 not. | design — PARTIAL | none |
| `DESIGN-dedup-and-mob-serialization.md` | 295 | Mental model for reporter election, dedup, load shedding, same-name mobs; the control plane section is built. Contributors must read before touching per_observer streams. | current-reference | 01, 08 |
| `DESIGN-di-callout.md` | 333 | Divine Intervention callout (#204): triggers and two-name selector shipped. | design — BUILT | none |
| `DESIGN-discord-setup-page.md` | 83 | Options for moving Discord setup (45 destinations at ~54 sites, permissions, ~20 loops) onto the website. Best map of what the bot reads from env. | design — NOT BUILT | 03 |
| `DESIGN-extended-target-v2.md` | 228 | Extended Target: tag retention, engage time, hate seats; display half shipped in agent 3.5.61-62. | design — PARTIAL | none |
| `DESIGN-external-tenancy.md` | 868 | Letting other guilds use the platform: self-host vs tenant vs hybrid, the PvP /who carve-out, staged plan. Partly superseded by the guild kit and the AGPL decision. | design — NOT BUILT | 11 |
| `DESIGN-faction-attribution.md` | 84 | Header says UI not built; Target Info's Faction tab shipped (DECISIONS §172). | design — PARTIAL | none |
| `DESIGN-fight-cards.md` | 139 | Fight Cards v1 shipped (web 1.1.61). | design — BUILT | none |
| `DESIGN-fight-timeline.md` | 449 | Boss HP curve plus MT/RAMP lanes; data layer built (encounter_timeline), chart v2 not. | design — PARTIAL | none |
| `DESIGN-group-death-watcher.md` | 276 | Group/raid HP death watcher (#205): agent half built, durable death_evidence not. | design — PARTIAL | none |
| `DESIGN-guild-kit.md` | 468 | The guild/ config contract (slice 0 and bot reader 1a live), wizard options, TENANT.md, upstream route. Section 1 measures what is hard-coded to Wolf Pack. | design — PARTIAL | 11 |
| `DESIGN-history-and-quest-nav.md` | 109 | Target Info history, Tank history, quest navigation: options awaiting picks. | design — NOT BUILT | none |
| `DESIGN-intentional-deaths.md` | 185 | Standing rules for intentional deaths; phase 1 (rules table) built. | design — PARTIAL | none |
| `DESIGN-live-guild-dps.md` | 174 | Guild-reported vs locally captured live DPS (bot 3.1.41). | design — BUILT | none |
| `DESIGN-live-raid-review.md` | 342 | Raid review written during the raid; the RAID_REVIEW_LIVE_* settings in .env.example belong to it. | design — BUILT | 03 |
| `DESIGN-lord-mobsincamp.md` | 249 | Local LLM assistant as the members' search; "nothing built, two calls needed". | design — NOT BUILT | none |
| `DESIGN-mechanic-capture.md` | 263 | Capturing instant boss mechanics (#206); step 1 (record-only capture) built. | design — PARTIAL | none |
| `DESIGN-mimic-3.0-overlay-builder.md` | 314 | Life-cycle plan for Mimic 3.0. The Timers canvas is on beta; the parts library and overlay sets exist on the alpha channel only. | design — PARTIAL | 07 |
| `DESIGN-mimic3-voice.md` | 73 | Recorded callouts and a virtual raid leader, parked as a v3 item. | design — NOT BUILT | none |
| `DESIGN-mob-serialization.md` | 443 | Same-name mob separation by player-position clustering; phases 0-1 shipped (bot 3.1.10). | design — PARTIAL | none |
| `DESIGN-mobinfo-dot-groups.md` | 73 | DoTs grouped by class on Target Info; blocked on class data; no code. | design — NOT BUILT | none |
| `DESIGN-multi-raid.md` | 152 | Two raids at once (bot 3.1.184, web 1.8.70, agent 3.7.65). | design — BUILT | none |
| `DESIGN-night-timeline-and-central-hud.md` | 182 | Night timeline, Central HUD, reuse timers: designed 2026-09-13; the Me/HUD overlay shipped separately (§11, §13). | design — NOT BUILT | none |
| `DESIGN-onboarding-overhaul.md` | 663 | "New Here?" walkthrough. Header says unbuilt; /start is live since 2026-08-28. The 2026-10-03 refresh lists what is wrong with the Discord onboarding card today. | design — PARTIAL | 02 |
| `DESIGN-opendkp-audit-cursor.md` | 175 | API proposal to OpenDKP for an incremental audit feed; never sent. | design — NOT BUILT | none |
| `DESIGN-outcome-backfill.md` | 441 | Outcome-driven backfill requests; utils/backfillScan.js and /backfillscan exist. | design — BUILT | none |
| `DESIGN-overlay-catalog.md` | 357 | Every Mimic overlay: what feeds it, what it shows, what breaks. Written from code at Mimic 2.7.2; best raider-facing overlay inventory. | current-reference | 02 |
| `DESIGN-platform-queue.md` | 266 | Post-audit wave plan (2026-07-17). Last real edit that day; the live queue is now the DECISIONS-2026-09-21 Open table. | design — PARTIAL | none |
| `DESIGN-quarmy-gear.md` | 152 | Quarmy gear/AA/spell import, v1 shipped. STATUS's doc map still says "Unbuilt". | design — BUILT | none |
| `DESIGN-raid-announcers.md` | 561 | Cast bible for the announcer personas; content for a feature that does not exist yet. | design — NOT BUILT | none |
| `DESIGN-raid-screen-activity.md` | 337 | Raid screen as a Discord Activity (option C); research only. Option B (/screen, /spectator) shipped. | design — NOT BUILT | none |
| `DESIGN-samename-took-ratio.md` | 135 | Damage-taken ratio to separate same-name mobs; measured, not built. | design — NOT BUILT | none |
| `DESIGN-selfhost-wizard.md` | 643 | Epic. The wizard is not built, but section 2a (free vs paid) and section 3 (deployment decisions by topic) are living reference and the chapter-11 spine. | design — NOT BUILT | 11, 05 |
| `DESIGN-sentinel.md` | 168 | Data Sentinel: continuous raid-aware ingest review; deliberately not built. | design — NOT BUILT | none |
| `DESIGN-SKILLS.md` | 189 | Which design skills are installed and what each earned. | current-reference | 08 |
| `DESIGN-target-info-mana-and-factions.md` | 183 | Target Info mana bar (unbuilt, two unknowns) and Factions tab (built). | design — PARTIAL | none |
| `DESIGN-threat-mt-margin.md` | 162 | Threat meter: margin to the MT and who is closing; listed open in STATUS. | design — NOT BUILT | none |
| `DESIGN-trap-disarm-tracking.md` | 135 | Track disarmed traps by disarmer location, 10-minute timer; no code. | design — NOT BUILT | none |
| `DESIGN-trigger-overlay-v2.md` | 238 | Slow labels, one row per mob, mute/feedback loop; parts shipped, the rest open. | design — PARTIAL | none |
| `DESIGN-wpqdi.md` | 199 | Guild-gated EQ database browser. Header says "not started"; /db and item/npc/spell/recipe/faction pages exist. | design — PARTIAL | none |
| `DESIGN-xp-tracking.md` | 115 | XP per hour by zone and group (FB-37); review only. | design — NOT BUILT | none |
| `DESIGN-zone-radar.md` | 87 | Live top-down map from Mimic coordinates; options awaiting a pick. | design — NOT BUILT | none |
| `DESIGN.md` | 106 | The wolfpack.quest visual system as shipped (CLAUDE.md remains the authority). | current-reference | 08 |
| `eq-legends-formats.md` | 90 | EQ Legends client file formats; spec for support nobody has built. | design — NOT BUILT | none |
| `eqemu-catalog-cheatsheet.md` | 175 | Load-bearing facts about the eqemu_* mirror and derived data (NPC id encodes zone, export surfaces, missing-spells path). Updated 2026-10-05. | current-reference | 05 |
| `FINDINGS-2026-08-10-trigger-overlay.md` | 703 | Raid-night findings on the trigger overlay with a status table; fixes shipped as agent 3.5.56+. | handoff/historical | none |
| `flyer-v2.gif` | binary (1769 KB) | 680x545 animated flyer (binary); referenced only by DESIGN-business. | marketing | none |
| `GEMINI-SPARK-HELPER.md` | 407 | How an agentic session works here: boot order, branch routing, verification gate, tests, traps, definition of done. Numbers stale (151 files, ~2280 tests, 18k/35k lines). | current-instructions | 08 |
| `HANDOFF-2026-07-20-opus.md` | 185 | Session handoff at a usage-limit pause; versions and heads are three months old. | handoff/historical | none |
| `HANDOFF-pop-quest-extract.md` | 164 | Local-session task: extract PoP flag and turn-in data. Partly overtaken by §119 (flags from the eqemu_quest_scripts mirror), though STATUS still lists it pending. | handoff/historical | none |
| `HANDOFF-tower-archive-catchup.md` | 290 | Local-session fix for the nightly archive merge on the guild lead's home server. | handoff/historical | none |
| `HOW-ITS-BUILT.md` | 4335 | Feature to file/surface index, organised by date added rather than by topic. The release section (L124-197) is stale. | current-reference | 01, 02, 03, 06, 07 |
| `LICENSING.md` | 88 | Plain-language AGPL-3.0-or-later: what a guild may do, hosting for others, what happens to a PR. | current-reference | 08, 11 |
| `LORE-planes-of-power.md` | 232 | Planes of Power story and pantheon, checked against source text; content for kill cards and films. | current-reference | none |
| `MIMIC_AGENT.md` | 82 | 2026-05-30 rearchitecture assessment: "agent cannot update itself", 6,492 lines (now 49k). Hot-swap and the supervisor replaced it. | stale | none |
| `mimic-1.4-roadmap.md` | 173 | Working queue for the 1.4 beta line (Mimic is 2.7); open items were carried into STATUS. | design — PARTIAL | none |
| `MIMIC.md` | 85 | 2026-05-30 vision doc ("vision / pre-build"). Mimic is now at 2.7.x; useful only as origin story. | stale | none |
| `opendkp-api-review-2026-08-31.md` | 208 | Review of every OpenDKP call ranked by measured cost; basis for the call-budget decisions. | current-reference | 03 |
| `opendkp-capture-playbook.md` | 178 | How to capture OpenDKP requests from a logged-in browser; all write endpoints captured 2026-05-26. | runbook | none |
| `PATCH-tower-merge-order.md` | 524 | One-off patch instructions for the home server's archive-merge SQL. | handoff/historical | none |
| `PATCH-tower-raid-track.md` | 73 | One-off patch for the same file (raid positions and looks), 2026-10-05. | handoff/historical | none |
| `pop-raids-local.md` | 85 | Local-session task to fill PoTime phase 2 and 3 stubs in apps/mimic/pop-raids.js (still pending). | runbook | none |
| `PRIVACY.md` | 425 | Source of truth for the privacy statement, mirrored on /privacy; rewritten 2026-09-25 from an audit, last updated 2026-10-02. Includes a tenant edition. | current-reference | 09, 02, 06 |
| `PRODUCT.md` | 71 | Product truth for design work: audience, "every client is a sensor" mechanism. | current-reference | 01 |
| `pvp-capture-audit.md` | 99 | Brief for a Claude instance pointed at a log folder to recover missed PvP kills. | runbook | none |
| `raid-hub-roadmap.md` | 189 | /raid hub design; stages 1-2 shipped, 3-5 open. | design — PARTIAL | none |
| `RAID-WATCH-2026-08-16.md` | 234 | Pre-raid review and triage lists for Mimic 2.5.0's first raids. | handoff/historical | none |
| `RESEARCH-HELPER.md` | 88 | Local-only maintainer tool (scripts/research-helper.mjs) for calling Gemini; not part of the product. | current-instructions | none |
| `RUNBOOK-client-crash-triage.md` | 330 | How to read a Zeal "D'oh! Client crash" dialog, look the signature up, and what to ask the raider, cheapest first. Current to 2026-09-29. | runbook | 10, 02 |
| `RUNBOOK-dead-triggers.md` | 166 | Fix for 37 "^"-anchored triggers that never fire; unapplied, and agent 3.5.46 changed the premise (needs re-measuring). | runbook | none |
| `RUNBOOK-death-backfill.md` | 236 | Correcting the death record (#200-202); "rehearsed, not executed". | runbook | none |
| `RUNBOOK-linux-zeal-pipe.md` | 132 | Getting Zeal's pipe into Mimic under Wine (Linux, Steam Deck). "Built, never proven end to end". | runbook | 02, 10 |
| `RUNBOOK-local-web-coolify.md` | 392 | Step-by-step for a local copy of the website on Coolify in a VM; Wolf Pack's own box. Generalise, do not copy. | runbook | 11, 04 |
| `RUNBOOK-site-access.md` | 95 | Officer procedure: site invite and Mimic 6-character code for members Discord OAuth blocks; reset and troubleshooting. Current. | runbook | 04, 10 |
| `RUNBOOK-unraid-supabase-replica.md` | 303 | Replicating/backing up Supabase to an Unraid box; Phase 1 proven 2026-08-11. The traps are universal, the box is not. | runbook | 05, 11 |
| `screenshot-already-installed.png` | binary (25 KB) | Binary; orphaned, nothing references it. | marketing | none |
| `screenshot-install.png` | binary (43 KB) | Binary; referenced only by marketing/discord-post.md. Dated 2026-05-26. | marketing | none |
| `screenshot-logsync-run.png` | binary (36 KB) | Binary; Parser.bat run screenshot used by README (2026-05-26; recheck before reuse). | current-instructions | 06 |
| `screenshot-logsync-setup.png` | binary (40 KB) | Binary; Parser.bat setup-wizard screenshot used by README (2026-05-26; recheck before reuse). | current-instructions | 06 |
| `SELFHOSTING.md` | 130 | Zero-fee self-hosting order of operations (DB, schema bootstrap, bot, web, Mimic). Partly stale: step 3 shared agent token, "no self-serve catalog import". | current-instructions | 11 |
| `seru-minis.md` | 52 | Name and roster of the Seru group event; deliberately not on the boss board. | current-reference | none |
| `spell-levels-local.md` | 155 | Local-session task to fill spell_level_seed via a PQDI scrape. | runbook | none |
| `STATUS.md` | 5412 | The work ledger (done, TODO, abandoned, folly) plus a document map. The map lists about 50 of 131 top-level files. | current-reference | none |
| `TERMS-hosted.md` | 130 | DRAFT cost-share terms for a deployment run for another guild; for legal review, not binding. | design — NOT BUILT | none |
| `TOWER-coolify-and-supabase-backups.md` | 319 | One-page overview of the guild lead's home server: nightly Supabase backup, archive merge, Coolify VM, restore cases, five-minute check. Placeholders only; still personal. | runbook | 05, 11 |
| `zeal-attack-timer-pipe-request.md` | 75 | Draft upstream Zeal PR: attack-recovery gauge on the pipe; uncompiled. | handoff/historical | none |
| `zeal-bandolier-filter-request.md` | 150 | Draft upstream Zeal PR: Bandolier chat filter; pushed to a fork branch. | handoff/historical | none |
| `zeal-bandolier-filter.patch` | 260 | Patch file for the Bandolier filter against Zeal v1.4.7. | handoff/historical | none |
| `zeal-pipe-protocol.md` | 212 | Full field reference for Zeal's named pipe (types, labels, gauges, ini settings). Stale on spawn ids: still says none exist and not to document them. | current-reference | 06, 02 |
| `zeal-spawn-id-request.md` | 327 | Measurements behind the spawn-id ask; filed as upstream PR #229. Zeal 1.4.6 now exposes spawn ids and DECISIONS-2026-09-10 closes this request. | handoff/historical | none |
| `zeal-tag-spawn-id-collision.md` | 206 | Draft bug report: /tag applies by spawn id alone; not sent. | handoff/historical | none |
| `zeal-tot-pipe-request.md` | 101 | Draft upstream Zeal PR: target-of-target on the pipe. | handoff/historical | none |
| `zeal-tot-pipe.patch` | 248 | Patch file for the target-of-target change against Zeal v1.4.7. | handoff/historical | none |

## 1C. `docs/` subfolders

| Folder or file | Lines | What it is | State | Feeds |
|---|---|---|---|---|
| `docs/archive/` | 8 files | Retired queue and roadmap docs, superseded 2026-07-17 by STATUS; kept verbatim; its README says do not add work here | handoff/historical | none |
| `docs/archive/README.md` | 20 | Index of the archive and why each file retired | handoff/historical | none |
| `docs/archive/BACKLOG.md` | 691 | Old catch-all queue (about 70% shipped history); its "needs a local session" asks were lifted into STATUS | handoff/historical | none |
| `docs/archive/CONTINUATION_QUEUE.md` | 589 | Older session queue that overlaps BACKLOG | handoff/historical | none |
| `docs/archive/EFFICIENCY-REVIEW-2026-07-07.md` | 164 | One-time efficiency audit of all four components; most fixes shipped | handoff/historical | none |
| `docs/archive/TIME-WINDOWS.md` | 63 | 2026-07-08 audit of hard-coded timeframes | handoff/historical | none |
| `docs/archive/mimic-recruitment-copy.md` | 101 | One-time Discord recruitment copy | handoff/historical | none |
| `docs/archive/roadmap.md` | 101 | Point-in-time platform retrospective; the public `/roadmap` now renders from `web/lib/roadmapData.ts` | handoff/historical | none |
| `docs/archive/trigger-system-roadmap.md` | 219 | Trigger-system design and research history; the foundation shipped | handoff/historical | none |
| `docs/diagrams/` | 5 files | README plus four JSON sources for the `/platform/architecture` diagrams (the HTML in `web/public/platform/` is build output; regenerate with archify) | current-reference | 01 |
| `docs/evidence/` | 1 file | `zeal-tags-2026-08-06.md`: a raid-night snapshot showing the `/tag` channel carries spawn ids | handoff/historical | none |
| `docs/marketing/` | 2 files | `discord-post.md` (a post for the main Quarm Discord's leader channel) and `guild-brochure.html` (one-page handout for other guilds) | marketing | none |
| `docs/pq-companion/` | 7 files | Five deep-dive comparisons with a third-party companion app plus README and data-provenance note. Partly shipped as agent 3.5.44-3.5.48. Its legal note still says "BSD-3 repo" | design — PARTIAL | none |
| `docs/release-cards/` | 1 file | `mimic_v1.0.70.png`, an orphaned release card image | marketing | none |
| `docs/upstream/` | 47 files, 6 subfolders | Pull-request packages for upstream Zeal: spawn-id (filed as #229; Zeal 1.4.6 now exposes spawn ids), tag corpses, icon files, persistence, shapes, guild emblems; patches, previews, test harnesses. Three patch files carry private session links in their trailers | handoff/historical | none |

## 1D. Doc-bearing files outside `docs/`

| File | Lines | What it is | State | Feeds |
|---|---|---|---|---|
| `supabase/README.md` | 109 | Schema tiers, migrations workflow, security and privacy posture, first-time setup. Last touched 2026-05-25. Stale: "deny-all for now", future migrations "0002_*", no bootstrap step | stale (partly) | 05 |
| `web/README.md` | 149 | Local dev, Vercel deploy, domain, Discord OAuth with Supabase Auth. Stale: "HTTP-only cookies", no `b.` redirect URL, four-page route table, "Discord OAuth (next iteration)" | stale (partly) | 04 |
| `apps/mimic/README.md` | 55 | "Parity-test build" notes from 2026-05-31: "not built from CI", "paste the /token value" | stale | 02 (replace) |
| `apps/mimic/build/README.md` | 10 | Icon placeholder note | stale | none |
| `apps/bristlebane/README.md` | 185 | Raid-voice bot: setup, permissions, opt-in-only recording, `/bristlebane` commands | current-instructions | 03, 09 |
| `guild/README.md` | 43 | The guild-kit contract (`config.json`, `discord.json`, resolution order). It names `TENANT.md` and `tenant.json`, which do not exist yet | current-reference (partial) | 11 |
| `experiments/mimic-agent/README.md` | 51 | Supervisor prototype from 2026-05-30 | handoff/historical | none |
| `resume/README.md` | 104 | A personal site that shares the repo; not part of the platform | none (exclude from the handbook) | none |

## Part 2 — Duplication and contradictions

Line numbers are as of `8a8ce5ee`. "L" = line.

### 2A. One fact, several homes (the most current copy is named)

| Topic | Where it is written | Most current |
|---|---|---|
| Install Mimic, first run | README L15-43; `commands/parsehelp.js` STEPS; `web/app/start/page.tsx` (calls parsehelp "the guide of record"); `utils/onboarding.js` parser card; `apps/mimic/README.md` | parsehelp + `/start`. The onboarding card (`utils/onboarding.js` L890-914) is wrong (hard-coded "v1.0.0", dead zip link, "paste /token"): DESIGN-onboarding-overhaul L17-50 |
| Standalone Parser | README L63-100 (filed under "Bot install"); `releases/WolfPackParser.zip` (2026-05-28); `start-logsync.ps1`; MIMIC_AGENT | `start-logsync.ps1` header. README omits `-NoUpdate`/`-ForceUpdate`. It self-updates from `main`, so beta-only agent fixes never reach it |
| Env vars | README L303-376; `.env.example`; `web/.env.example`; supabase/README; bristlebane/README; DESIGN-guild-kit §1; DESIGN-discord-setup-page "what exists" | The code. `.env.example` claims to be authoritative (README L325) but 36 `process.env.X` names the bot reads are missing (AUDIT_TRAIL_THREAD_ID, PORT, WEB_BASE_URL, MIMIC_RELEASE_ANNOUNCE, the SUPABASE_*_MS knobs, retention knobs). `web/.env.example` omits OFFICER_ROLE_NAMES, DEMO_OBFUSCATE_SALT, DISCORD_INVITE_URL |
| Discord app and permissions | README L232-250 and L431-465 (complete since 2026-10-06); bristlebane/README L100-103 (voice-only integer) | README. A new guild uses one app |
| Release process | CLAUDE.md L354-648; `release-mimic.yml` header; HOW-ITS-BUILT L124-197; beta-releases.md; GEMINI §4; CONTRIBUTING §3 | Workflow header plus CLAUDE.md. HOW-ITS-BUILT still says beta tags are "forced to -beta.1" (changed 2026-07-08); beta-releases.md has two tracks, no alpha or Linux |
| Privacy | PRIVACY.md and `web/app/privacy/page.tsx` (in sync, 2026-10-02); root PrivacyPolicy.md and TermsOfService.md; CONTRIBUTING §4; supabase/README "Privacy posture" | PRIVACY.md |
| Zeal and EQ settings | README L26; HOW-ITS-BUILT L2316-2362; DESIGN-87 RB-07; zeal-pipe-protocol L84-97; catalog cheatsheet L91-110; CLAUDE.md L1013-1090 | No single doc. HOW-ITS-BUILT plus CLAUDE.md for behaviour |
| Supabase and sign-in setup | supabase/README; SELFHOSTING steps 1-2; web/README L65-121; RUNBOOK-site-access L80-95; CLAUDE.md L366-449 | SELFHOSTING (bootstrap) plus CLAUDE.md. web/README lacks the `b.` redirect URL and the Email-provider requirement |
| What is next | STATUS ledger; DESIGN-platform-queue (2026-07-17); DECISIONS-2026-09-21 Open table; the task board | The DECISIONS Open table |
| Gates, test counts | CONTRIBUTING §1/§8; GEMINI §5; AI-CONTRIBUTOR-BRIEF §2; `test.yml`; `golden-log.yml` | CI |

### 2B. Contradictions

1. **PoP "locked until 2026-10-01".** README L406, CLAUDE.md L718, GEMINI L369, DESIGN-81 L500/L958, DESIGN-87 L614, spell-levels-local L4-5. DECISIONS §134 (2026-10-02): it unlocked; `isPopLocked()` has been inert since.
2. **Counts.** README L406 and CLAUDE.md L793: 133 bosses (Velious 35, PoP 20). `data/bosses.json`: 158 (Velious 37, PoP 43). README L146 "83 slash commands", CLAUDE.md L791 "~80": 88 command modules.
3. **Agent token.** CLAUDE.md L790/L871, `.env.example` L524-526 and SELFHOSTING L84 say the bot checks a shared `WOLFPACK_AGENT_TOKEN`. README L338, `utils/mimicLink.js` L302-306 and `utils/onboarding.js` L375 are right: it has been rejected since 2026-06-04; only per-user `wpms_` tokens work. `commands/preraiddrill.js` L97 still fails the drill when it is unset (a code bug).
4. **"Free tier".** `.env.example` L557 "calibrated for Supabase Free (5 GB)" against CLAUDE.md L1158 (Pro, no call quota). Same file L566-570 gives threat retention default 60; `index.js` L3258 and CLAUDE.md say 30.
5. **Zeal spawn ids.** zeal-pipe-protocol L3-8 and L177-181 ("not in any released Zeal", "no spawn ids anywhere", "do NOT document") against CLAUDE.md L731 and DECISIONS-2026-09-10 §1 (Zeal 1.4.6 ships them).
6. **Code signing.** CLAUDE.md L1389 and STATUS's doc map ("CLOSED", "pre-staged OFF") against code-signing.md's own banner (reopened 2026-08-13, pipeline deleted, AGPL removes the OSI blocker).
7. **Licence.** pq-companion/README L10 says "this BSD-3 repo". LICENSE is AGPL-3.0-or-later since 2026-09-18.
8. **Privacy promises.** CONTRIBUTING L102-103 and AI-CONTRIBUTOR-BRIEF L53: "excluded characters never contribute or display". CLAUDE.md L1316-1323 says that is false and must not be written again. web/README L111 "HTTP-only cookies" against CLAUDE.md L1138. Root PrivacyPolicy.md and TermsOfService.md (dated April 2025 in the text, committed 2026-04-22) describe a bot that stores only Discord ids.
9. **Dashboard authoring.** CONTRIBUTING L128-134 and GEMINI L49/L329 teach editing the hand-escaped `WEB_HTML` literal. CLAUDE.md L969-990 and AI-CONTRIBUTOR-BRIEF L96-98 are right: edit `dashboard.html`, run `npm run sync:dashboard`; a hand edit to the literal fails `check:dashboard`.
10. **Sizes and gates.** `index.js`: 13k (CONTRIBUTING), 18k (CLAUDE.md, GEMINI), actual 23,309 lines. Agent: 24k, 35k, 42k (AI-CONTRIBUTOR-BRIEF L31), 6.5k (MIMIC_AGENT), actual 49,437. Tests: 289 (CONTRIBUTING), ~2,280 (GEMINI), 5,118 in 384 files on 2026-10-02 (§134). "Three gates" (CONTRIBUTING) against five commands (GEMINI) against two CI workflows. CLAUDE.md bans version numbers in docs; AI-CONTRIBUTOR-BRIEF L9 carries a snapshot.
11. **STATUS doc map says "Unbuilt".** DESIGN-quarmy-gear (v1 shipped), DESIGN-onboarding-overhaul (`/start` live), DESIGN-wpqdi (`/db` exists); DESIGN-buff-debuff-queue and DESIGN-ch-chain headers still say "proposal" (both live). The map covers about 50 of 131 files and 3 of 22 DECISIONS files.
12. **DECISIONS naming.** CLAUDE.md L282 says one file per date. Since 2026-09-21 one file has taken 176 sections (7,706 lines). The SessionStart hook prints the newest file's Open table, so a new dated file would hide the live one.
13. **Officer role default.** `.env.example` L308 `Officer,Guild Leader`; `web/lib/officer.ts` L15 falls back to `Officer,Pack Leader`.
14. **Self-host gaps overtaken.** SELFHOSTING L105 "no self-serve catalog import": `sync-quarm.yml` plus `scripts/sync-from-eqmac.js` is one (a fork needs the Supabase secrets). supabase/README says the migrations alone build the schema; SELFHOSTING measured 11 failures without `supabase/bootstrap/`. `/addboss` writes `data/bosses.json` inside the container, which Railway discards on deploy (README L404-429 does not say so).
15. **Component READMEs predate the product.** apps/mimic/README ("parity-test build", "not built from CI", "paste the /token value"); web/README ("Discord OAuth login (next iteration)", four-page route table, no beta mirror); supabase/README ("deny-all for now", future migrations "0002_*").
16. **Public-repo hygiene still open.** The crawl found a short list of places where a name, a default value or a link does not belong in a public repository. The specifics are recorded in the private briefing, not here; the guild lead decides each one.

Checked and consistent: dashboard ports (Parser 7777, Mimic 7779 and up), Node 20 (Dockerfile, CI, `RUN-FIRST-for-Node.js.bat`; `package.json` says >=18), Supabase Pro (CLAUDE.md, COSTS, the wizard doc), licence (AGPL in LICENSE, all four `package.json`, README, CONTRIBUTING), and PRIVACY.md against its website mirror.

## Part 3 — Proposed handbook: `docs/guide/`

### Constraints found in the repo

- **Do not move existing docs.** `web/app/ai/page.tsx` links six by path (CLAUDE.md, GEMINI-SPARK-HELPER, AI-CONTRIBUTOR-BRIEF, HOW-ITS-BUILT, STATUS, PRIVACY). `test/runbooks-catalog.test.js` L138 asserts DESIGN-87 exists, `test/upstream-zeal-pr.test.js` reads `docs/upstream/zeal-spawn-id`, and the SessionStart hook globs `docs/DECISIONS-*.md`. Add `docs/guide/` beside them and shrink README to a pointer.
- **State precedence on page 00.** The handbook owns instructions. CLAUDE.md owns agent rules and architecture, once Part 2's stale lines are fixed. STATUS, HOW-ITS-BUILT and DECISIONS stay ledgers.
- **Generate what drifts.** Env table (code scan; 36 bot names are missing today), slash commands (88 modules, 32 in README), versions (package.json only), workflow list. Add a test in the style of `runbooks-catalog.test.js` that every path and env var a chapter names exists.
- **One home per explanation.** AUDIT-site-monologues lists 13 explanations repeated across website pages (how data arrives, install Mimic, privacy, change latency, engage lock, RA maths). Chapters 02, 03 and 09 become the link targets.

### Changes to the skeleton, with evidence

- **02 splits in four:** install; Zeal and EQ settings; overlay tour; channels and local mode. Zeal setup sits in six places, and compatibility mode, elevation and install location are the recurring faults.
- **03 splits in four:** Discord app and permissions; channels, env and first-time order; deploy and recovery; raid-night operations. README orders them badly (bot install L44, Discord app L232, env L303, permissions L431) and day-2 operations had no home.
- **04 gains one procedure, "sign-in wiring":** Discord app, Supabase provider, Site URL and redirects (including `b.`), Vercel env for Production and Preview, role names, the no-Discord path. It is split across three docs today.
- **06 shrinks to two pages after 02.** README collapses Parser in a `<details>` for raiders and puts the full steps under "Bot install", `/parsehelp` omits it, the zip has no release since 2026-05-31, and it follows `main`, not beta.
- **07 splits in three:** branches and channels; cutting a release; deploy limits and the raid freeze. Say which surfaces restart: `railway.toml` watchPatterns exclude `web/`, `apps/`, `packages/`, `docs/`.
- **08 merges** CONTRIBUTING, GEMINI and AI-CONTRIBUTOR-BRIEF into one page with three entry paths.
- **09 is a map, not a fourth copy.** PRIVACY.md stays the only prose; the chapter adds the engineering rules and the tenant edition.
- **10 splits by reader** (raider, officer).
- **Appendices:** A env reference (generated), B slash commands (generated), C glossary (tick, per_observer, anchor, hot-swap, engage lock, spawn id), D source map.
- **Left out:** business and legal drafts, announcer cast, lore, upstream Zeal PRs, DESIGN specs. Link, do not restate.

### Audience map

- **Raider:** 00, 02, 06 (CLI only), 09, 10 (raider half).
- **Officer:** 00, 01, 03, 04, 05, 07 (skim), 09, 10 (officer half), 11.
- **Contributor:** 01, 05, 07, 08, 09, appendices.

### Chapters: what to write from, what never to copy

| # | Write from | Never copy |
|---|---|---|
| 00 Index | STATUS L8-30 (three layers); this inventory | adoption counts; the private briefing's title or link |
| 01 Overview | CLAUDE.md L1-24, L788-1257 condensed; PRODUCT "unique mechanism"; HOW-ITS-BUILT L14-123; DESIGN-dedup-and-mob-serialization; ARCHITECT-REBUILD "What the rebuild keeps"; `docs/diagrams/*.json` | our Supabase ref and guild id (use `<project-ref>`, `<guild-id>`); measured DB or bill figures; the Vercel owner slug |
| 02 Raiders | README L15-43; parsehelp STEPS and `/start`; PRIVACY L64-155; HOW-ITS-BUILT L2316-2362; CLAUDE.md L1013-1090; DESIGN-overlay-catalog; RUNBOOK-linux-zeal-pipe; RUNBOOK-site-access §2 | tag and officer channel names and passwords; `wpms_` tokens; our invite and short links; the guild lead's drive layouts; real log lines; the 2026-05-26 screenshots until rechecked |
| 03 Bot | README L102-143, L232-301, L431-465; `.env.example` rewritten with placeholders; DESIGN-discord-setup-page "What exists today"; `railway.toml`, Dockerfile, compose; guild/README; DESIGN-87 RB-01..04; CLAUDE.md L808-920; bristlebane/README | every real `.env.example` value (ids, sheet id, the Suno user, OpenDKP, Raid-Helper, bid, screen and Bristlebane secrets, bot URL) |
| 04 Website | web/README L27-121 (corrected); `web/.env.example`; vercel.json; next.config.js; CLAUDE.md L366-449; RUNBOOK-site-access; DECISIONS §101, §108, §134, §135; DESIGN.md | service-role key; SCREEN_TOKEN_SECRET; DEMO_OBFUSCATE_SALT; preview-host slug; the unverified registrar guess; mock data naming a real raid |
| 05 Database | supabase/README (fixed); CLAUDE.md L634-640, L1156-1257; eqemu-catalog-cheatsheet; DECISIONS-2026-09-01; COSTS §3; SELFHOSTING §1-2; HOW-ITS-BUILT L3493-3673 | any key; home-server read-only credentials, tailnet tags, `TS_AUTHKEY` (DECISIONS §9); egress or Spend Cap figures nobody measured |
| 06 Standalone agent | README L63-100; `start-logsync.ps1` header; CLAUDE.md L922-1012; HOW-ITS-BUILT L1653, L1736; DESIGN-agent-third-party-calls §3; zeal-pipe-protocol L84-97 | tokens; our raw-GitHub URLs without a "change if you fork" note |
| 07 Releases | CLAUDE.md L354-648, L268-277; headers of release-mimic, sync-beta, sync-alpha, raid-freeze; DECISIONS §78, §81, §101, §108, §134; beta-releases two-track table | release names (the guild lead's call); the private branch inventory; adoption counts; session links |
| 08 Contributing | CONTRIBUTING; GEMINI §3, §5-§10, §12; AI-CONTRIBUTOR-BRIEF §2; CLAUDE.md L50-55, L199-267, L339-353, L969-1131; DESIGN-75; DESIGN-dedup-and-mob-serialization; DESIGN-agent-third-party-calls §2; LICENSING | the reply-shape, Sonnet-agent and UI-options rules (maintainer working agreements); the example branch name that looks like a person |
| 09 Privacy | PRIVACY.md and the page; DESIGN-agent-third-party-calls §3.1, §3.4; DESIGN-crash-review (consent); CLAUDE.md L1258-1340; bristlebane/README "opt-in only"; DECISIONS-2026-09-18 §3 | player or character counts; per-member examples; any character-family mapping |
| 10 Troubleshooting | DESIGN-87 RB-01..04 and outlines; RUNBOOK-client-crash-triage; RUNBOOK-linux-zeal-pipe §6; CLAUDE.md L1013-1090; RUNBOOK-site-access "Troubleshooting"; README L293-301; HOW-ITS-BUILT L628-662; DECISIONS-2026-08-13 | crash dialogs or log lines with names; one-machine fixes |
| 11 Self-hosting | SELFHOSTING (fixed per Part 2); DESIGN-selfhost-wizard §2a, §3; DESIGN-guild-kit §1-§2, §7a with guild/README; DESIGN-external-tenancy (PvP `/who` carve-out); LICENSING; DECISIONS-2026-09-18 §3, §12; RUNBOOK-local-web-coolify Parts C-E and RUNBOOK-unraid-supabase-replica's "no `volumes/` tree" trap, generalised | home-server docs verbatim; the private "Home lab" advice; COSTS bills; DESIGN-business pricing; the TERMS-hosted draft; Wolf Pack hard-codes (about 580 sites, 7 files) |

### Load-bearing traps the chapters must carry (each already cost something)

- **02, 10:** XP compatibility mode on `eqgame.exe` breaks the Zeal pipe (`EPERM`); install Mimic outside the EQ folder; match elevation; run "Set up EQ for me" with EQ closed, because EQ rewrites `eqclient.ini` on exit (CLAUDE.md L1021-1060; DESIGN-87 RB-07).
- **03:** Railway has no volume, so `state.json` is a cache, per-night state lives in `bot_kv`, message-id anchors go in env, and `/addboss` file edits vanish at deploy (README L253-259; CLAUDE.md L808-842).
- **03, 07:** no pushes to `main` Sun/Wed/Thu 19:30-00:30 ET; `[hotfix]` is the escape (CLAUDE.md L624-633).
- **04:** Supabase silently ignores a `redirectTo` that is not allow-listed; Preview needs every env var; `vercel.json` rejects a `comment` key; `NEXT_PUBLIC_*` must be build variables (CLAUDE.md L406-449; SELFHOSTING step 4).
- **05:** reads, not writes, are what bill; PostgREST caps a read at 1,000 rows (DECISIONS §155); migrations are idempotent and any MCP-applied one is also committed; new SECURITY DEFINER functions must not be anon-callable (CLAUDE.md L634-640, L1156-1200; CONTRIBUTING §4).
- **07:** the stable commit must be the tip of its push, because the release body is `git log -1`; re-park beta above each stable; write `Fixes FB-n` on its own line (CLAUDE.md L268-277, L534).
- **08:** edit `dashboard.html`, never the `WEB_HTML` literal; strip comments before text assertions; commit messages go through a file (CLAUDE.md L208-267, L969-990).

**Writing order** (most reuse, most contradictions first): 02, 03, 07, 08, then 11, 05, 04, 10, 09, 01, 06.

## To-do before the writers start

1. **A session:** correct the stale one-liners in CLAUDE.md, README, CONTRIBUTING, GEMINI, AI-CONTRIBUTOR-BRIEF and `.env.example` named in Part 2 items 1-10 and 13, so the writers do not copy them.
2. **The guild lead:** decide whether raiders still get the standalone Parser (README clone, the 2026-05-28 zip, the short-link redirect) or whether chapter 06 is dropped to a one-page appendix.
3. **The guild lead:** choose the DECISIONS convention (one running file or one file per day) so chapter 08 can state it, and say whether the private session links and the character names in Part 2 item 16 are stripped from the files.
4. **A session:** generate appendices A and B from the code, and add the docs-guide path and env check beside `test/runbooks-catalog.test.js`.
5. **The writers:** draft in the Part 3 order, chapter 02 first, using the "Never copy" column as the review checklist.
