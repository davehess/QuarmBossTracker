# STATUS — the one place to see where everything stands

*Consolidated 2026-07-17 (EST). This replaces the tangle of overlapping queue
docs (BACKLOG, CONTINUATION_QUEUE, the platform-queue, the old roadmaps). If you
want to know **what's done, what's still TODO, what we abandoned, and what was
folly** — it's here.*

## How to read this (three layers, no more)

1. **Live working queue** — the durable, ordered plan is
   [`DESIGN-platform-queue.md`](./DESIGN-platform-queue.md) (the post-audit
   waves + agreed execution order). The fine-grained active checklist is the
   session **task board** (#1-96), which mirrors whatever wave is in flight.
2. **This doc (`STATUS.md`)** — the durable big-picture ledger + the map of
   every doc in `docs/`. Point new sessions here first.
3. **`archive/`** — retired docs, kept verbatim (nothing deleted). Everything
   they held that's still live has been lifted into the ledger below.

> **Rule for future sessions:** don't start a new queue file. Open TODOs go on
> the task board and, if durable, into the ledger here. Deep designs get their
> own `DESIGN-*.md` and a row in the Document Map.

---

## Document map — what every file in `docs/` is for

### Living reference (keep — actively relied on)
| File | What it is | Why it stays |
|---|---|---|
| `DESIGN-platform-queue.md` | The post-audit wave plan + agreed execution order | **The live queue.** |
| `BETA-TESTING.md` | Test plan for features in the beta channel (versions + ✅ solo / 👥 multi-person cases) | **Where to verify beta work.** |
| `DESIGN-buff-debuff-queue.md` | Design spec for the raid buff/debuff/cure queue overlay | CLAUDE.md roadmap ref; feature is live but spec still guides changes |
| `DESIGN-ch-chain.md` | Design spec for the CH-rotation overlay | CLAUDE.md roadmap ref |
| `DESIGN-quarmy-gear.md` | Build spec for Quarmy gear/AA/spell import to character pages | Unbuilt — still the spec |
| `mimic-1.4-roadmap.md` | **Active Mimic beta queue** (overlay layout sync, UI-Studio UX, trigger onboarding) | Real open work; see ledger |
| `raid-hub-roadmap.md` | `/raid` hub design; Stages 1-2 shipped, Stages 3-5 open | CLAUDE.md roadmap ref; open TODOs in ledger |
| `beta-releases.md` | Beta-channel mechanics (electron-updater, cutting beta/stable) | Evergreen process reference (dated "current state" block is stale, harmless) |
| `HOW-ITS-BUILT.md` | Long-form "how each feature actually works" companion to CLAUDE.md | Living companion doc |
| `MIMIC.md` / `MIMIC_AGENT.md` | Mimic vision + the Electron/self-updating-agent rearchitecture assessment | CLAUDE.md roadmap refs |
| `PRIVACY.md` | Source-of-truth privacy statement, mirrored to the web page | Load-bearing (CLAUDE.md) |
| `eqemu-catalog-cheatsheet.md` | Load-bearing conventions for the `eqemu_*` mirror + gear/spells pages | Load-bearing (CLAUDE.md) |
| `zeal-pipe-protocol.md` | Full field reference for the Zeal named-pipe protocol | Load-bearing spec |
| `zeal-spawn-id-request.md` | Drafted upstream ask to Zeal for `spawn_id` on the gauges | Load-bearing (CLAUDE.md); the fix for same-name mob ambiguity |
| `code-signing.md` | Pre-staged (OFF) Windows signing pipeline + flip-on checklist | CLAUDE.md (CLOSED 2026-07-14, kept for if a provider appears) |
| `opendkp-capture-playbook.md` | OpenDKP endpoint-capture playbook | CLAUDE.md ref; reusable for future captures |
| `eq-legends-formats.md` | EQ Legends client config-format spec | Future-build spec |
| `bazaar-filter-pack.md` | Bazaar search presets + tradable watchlists (Luclin) | Standalone reference |
| `pop-raids-local.md` | Local-session playbook: capture PoTime slideshow stubs | Actionable pending local task |
| `spell-levels-local.md` | Local-session playbook: fill `spell_level_seed` via PQDI scrape | Actionable; seed still used |
| `pvp-capture-audit.md` | Reusable local runbook for PvP kill/assist recovery (`scripts/pvp-audit.js`) | Diagnostic runbook |

### Archived 2026-07-17 → `archive/` (superseded; live bits lifted into the ledger)
| File | Was | Why archived |
|---|---|---|
| `roadmap.md` | Point-in-time platform retrospective/roadmap | Superseded by this doc + platform-queue; its few live TODOs migrated below |
| `trigger-system-roadmap.md` | Trigger-system design/research history | Foundation shipped; straggler TODOs + the event-engine idea migrated below |
| `EFFICIENCY-REVIEW-2026-07-07.md` | One-time efficiency audit | Most fixes shipped; the ⏳ web/Mimic items migrated below |
| `TIME-WINDOWS.md` | 2026-07-08 hardcoded-timeframe audit | Shared window infra shipped; telemetry query preserved below |
| `mimic-recruitment-copy.md` | One-time Discord recruitment copy | Served its purpose |
| `BACKLOG.md` | The old catch-all queue (~70% shipped history + local-session asks) | Unique live TODOs + "needs local session" asks lifted below; full file retained in `archive/` |
| `CONTINUATION_QUEUE.md` | Older session queue, heavily overlapping BACKLOG | ~70% shipped/duplicated; its 6 unique TODOs lifted below |

---

## The work ledger

### ✅ Done — major shipped features (not exhaustive; see git + roadmapData.ts)
- **#91 roll-loot review surface (remainder) — DONE end-to-end (2026-07-19,
  agent 3.3.97 beta + bot 3.0.219 + web 1.0.250 on main).** The capture half
  shipped a week ago (roll_sets since 3.3.78, Hot Dice PERFECT events since
  3.3.80). This completes the three original guild-lead asks:
  1. **Who-looted attribution.** The agent captures the character's OWN
     `--You have looted <item>.--` lines on the live tail (`trackLootedLine`,
     self-only in EQ so the looter is the log's character; the a/an article is
     stripped so the name lines up with the loot-link roll convention). Upload
     rides the durable queue as a new `looted` kind → `POST /api/agent/looted`,
     with the **same recency+high-water discipline as roll sets** (only events
     `< 30 min` old and past the HW mark upload) so `--since` backfill never
     re-posts old loots. Stored in a **NEW narrow `looted_items` table**
     (migration `20260719010000`, applied) rather than `loot_observations` —
     that table requires `item_id` AND `npc_name_lower` NOT NULL, and a looted
     line carries neither, so reuse would have meant faking columns. Upsert
     dedups on `(guild, looter_lower, item_name, looted_at)`.
  2. **Hot Dice NIGHT award.** The per-roll PERFECT event already fires; this
     adds the sibling `hot_dice_night` fun_event, computed on the midnight chain
     (`computeHotDiceNightAward` in `index.js`) over the ET-day-window's
     `roll_sets`. Pure decision in `utils/hotDiceNight.js`: merge multi-uploader
     rows → per-set winner (highest first-roll) → award the top winner iff their
     share of **contested** (≥2-roller) sets is **>20%** with a **≥5-set floor**.
     Idempotent: `event_ts` pinned to the night start so a re-run upserts the
     same fun_events row (unique `guild,event_type,caster,event_ts`).
  3. **Roll-night summary.** New member-gated **`/rolls`** page: per raid night,
     each roll session (item, range, rollers, winning roll), the LOOTED-BY name
     beside the winner when they differ, and Hot Dice callouts (perfects + the
     night crown). Merge/attribution logic is the pure `web/lib/rolls.ts`
     (tolerant item matcher: normalize + article-strip + substring + ≥2-token
     overlap; window join `[last−2min, last+10min]`). A 🎲 Hot Dice card also
     lands on `/fun` linking through. Tests: `test/roll-attribution.test.js`
     (matcher/merge/window join, real-imports `web/lib/rolls.ts`) +
     `test/hot-dice-night.test.js` (award math: >20%, floor, dedup,
     determinism/idempotency) — 20 assertions, all green. `roll_sets`/
     `looted_items` are **empty in prod** (no captured off-night raid yet), so
     the render was grounded against a representative fixture through the real
     lib. See BETA-TESTING #91.
- **#113 Extended Target same-zone-only option — DONE (2026-07-19, bot 3.0.218 on
  main + agent 3.3.96 beta; Mimic parked 1.9.6; web 1.0.249 docs).** Guild-lead
  ask: "we don't need to include other Mimics' targets when they're not in the
  same zone." **Layer chosen: bot-side** (`_handleAgentExtendedTarget` in
  `index.js`). Recon showed zone already lives on the bot (`character_live_state.
  zone_name`) and the endpoint *already* scoped every target to the requester's
  zone via `inScope` — but unconditionally, with a non-fail-open predicate
  (`=== scopeZone` dropped unknown-zone rows) and no toggle. The payload rows
  carry only the requester's `scopeZone`, never a per-uploader zone, so
  agent-side filtering would have needed the bot to attach per-row zones (NEW
  plumbing) — bot-side was the only layer where zone is already present. Change:
  the endpoint now reads a `same_zone` query param (absent/`1` → on = default;
  only `same_zone=0` disables), and the same-zone predicate is fail-open per row
  (a raider whose `zone_name` we can't resolve rides along instead of vanishing;
  my-zone-unknown → no scoping). Old agents send no param → unchanged
  (default-on) behavior. **Agent (beta):** a per-user pref `extSameZoneOnly`
  (default true) persisted in `logsync.optin.json`, a labeled checkbox in the
  dashboard Overlays tab ("Same-zone targets only (default on)"), and a
  `GET/POST /api/ext-pref` pair; `fetchExtendedTarget` appends `same_zone=0`
  only when the user turns it OFF, so the toggle takes effect within one proxy
  TTL, no restart. The overlay (`extarget.html`) needed no change — the bot
  serves the already-filtered list. Decision covered by
  `test/extended-target-zone.test.js` (source-sliced param parse + `inScope`
  predicate). See BETA-TESTING #113.
- **#118 in-console officer kill switches + Mimic version in the fleet table —
  DONE (2026-07-19, bot 3.0.217 on main + agent 3.3.95 beta; Mimic parked 1.9.6).**
  Guild-lead ask off live 📡 Reporters-panel screenshots: put the `/admin/overlays`
  🛑 kill switches inside Mimic (officers rarely have the web admin open mid-raid),
  and show the Mimic shell version next to the agent version in the fleet table.
  - **Bot (`flag-override` endpoint).** New `POST /api/agent/flag-override`
    (officer-gated, same `is_officer` gate as reporter-override #115) does the
    identical read-modify-write on `overlay_tuning.tuning` + local cache-bust, but
    accepts ONLY a WHITELISTED set of control-plane keys — `_FLAG_OVERRIDE_KEYS`:
    `flag_disable_reporter_election`, `dedup_chat`/`dedup_buffs`/`dedup_roster`,
    every `flag_shed_<kind>` enumerated live from `_SHED_KINDS`, `flag_raid_hold`
    (the "raid hold" toggle), `flag_agent_kill`, `flag_disable_budgets`, and
    `min_agent_ver_num`. Anything else (the free-form `ext_*`/`offheal_*`/`ch_*`
    knobs, and the `reporter_pin_*` strings) is rejected 400 — those stay web-only.
    Boolean flags are written LITERALLY (explicit `0`, never an omitted key, so
    `dedup_chat`-off persists); `min_agent_ver_num` is a floored int and `<=0`
    clears it. Whitelist + gate + value-semantics covered by
    `test/flag-override.test.js` (source-sliced from the real handler).
  - **Mimic 🛡 Admin tab (agent).** A byte-stable 🛑 Kill switches card renders
    every whitelisted flag as a labeled toggle showing its LIVE value (read from
    the tuning the agent already polls, `_overlayTuning`), mirroring the
    `/admin/overlays` copy. `flag_agent_kill` requires a typed confirm before the
    write ("pauses EVERY agent's uploads"); `min_agent_ver_num` is a number input.
    The whole card + its data are gated on `is_officer` (the #109/#115 gate) — a
    non-officer sees nothing. `dedup_chat` carries the incident hint (currently
    **0**; re-enable only once the fleet is on agent ≥3.3.91).
  - **Mimic version in the heartbeat + fleet table.** The reporter-poll heartbeat
    now carries `mimic_version` — sourced from `process.env.WOLFPACK_APP_VERSION`,
    which `apps/mimic/main.js` ALREADY passes at spawn (line 2028), so no Mimic
    change was needed; standalone Parser.bat agents report null. The bot stores it
    on the registry entry and includes it in `server-panel/reporters`; the fleet
    table's VER column now reads `agent/mimic` (e.g. `3.3.95/1.9.6`, or
    `3.3.95/—` for standalone). The LOG column also gained a legend explaining the
    last-log-line staleness signal + the fresh/stale dot. See BETA-TESTING #118.
- **#117 pet buffs on the Pet tracker (proven-cause fix) + advisory range awareness
  — DONE (2026-07-19, agent 3.3.94 beta + Mimic 1.9.6 beta; bot 3.0.216 + web
  1.0.248 on main).** Two halves.
  - **Half 1 — pet buffs weren't showing (PROVEN cause, two prior guesses were
    wrong).** Repro: Canopy (druid) casts **Girdle of Karana** on her summoned
    pet Kabn; the in-game pet window + Zeal show the buff, but the Mimic Pet
    tracker shows only Kabn's HP. The earlier clicky-path and charm-pet-
    misclassification theories were both wrong. **Real cause (fixture-proven,
    `test/pet-buff-landing.test.js`, source-sliced from the agent): Girdle of
    Karana is a single-target buff (`eqemu_spells` id 1557, `targettype 5`,
    `cast_on_other "looks stronger."`, `good_effect 1`, dur 720/formula 3) that
    matches NONE of the agent's `_TRACKED_BUFF_KEYWORDS`.** So `parseBuffLanding`
    can never index its landing message — the ONLY attribution path is
    `resolveSelfCastLanding`, and that path's `rc.target` guard **rejected the
    "Kabn looks stronger." land whenever the pet wasn't the caster's live Zeal
    target at cast time** (you buff yourself / keep the mob targeted, or the
    target moves on during the cast). Land dropped → `_petBuffLandings` empty →
    Pet tracker (which reads `petBuffsForOwner`) empty, even though the land is
    right there in the log and Kabn is provably our pet (Zeal slot 16). The
    fixture reproduces both: the WORKING path (pet targeted → buff shows) and the
    BUG (pet not the live target → empty). It also explains **#116's phantom
    "Girdle of Karana ×1 · 71:48" melody card** — 71:48 ≈ the 720-tick catalog
    max, i.e. the buff riding Canopy's OWN Zeal buff list into the bard melody
    overlay (already fixed separately in #116). **Fix (log-path, evidence-
    supported — NOT pipe-side, since the land IS in the log and resolves
    correctly): in `resolveSelfCastLanding`, when the resolved land names one of
    OUR OWN pets (`_petOwnerByName` → an owner == the observer), attribute it
    regardless of the stale live target.** We already know we cast that exact
    spell (matched by its `cast_on_other`); the strict guard stays for non-pet
    (bystander) targets, and `recordPetBuffLanding`'s own `_petOwnerByName` gate
    still blocks any non-pet leak. Residual gap (noted, not built): a buff cast
    on your pet by SOMEONE ELSE, or an untracked self-only cast with no pet land
    line, still relies on the /pet report path (`applyPetHealthLine`) — the
    honest pipe-side source when it's typed.
  - **Half 2 — position-based buff-range awareness (advisory, v1).** The Zeal
    pipe already surfaces each client's Position (`loc {x,y,z}` + heading) and
    `_zealState` carries it; it just never rode the live-state upload.
    **Plumbing:** agent now sends `loc_x/loc_y/loc_z` on `/api/agent/live-state`
    (rides the heartbeat, NOT the change signature — position churns on every
    step), the bot ingests them, and migration
    `20260718000000_add_position_to_character_live_state.sql` adds the three
    `real` columns (applied via MCP + committed identical). **Consumer:** the
    raid-buff-queue now flags a **SAME-ZONE** target beyond a named
    `BUFF_RANGE_UNITS = 200` heuristic from the requesting buffer as
    `out_of_range` — the buffqueue overlay dims the row + shows a 📍 chip, it is
    NOT removed. Pure helper `utils/range.js` (distance + threshold + fail-open),
    unit-tested (`test/range.test.js`). **Advisory everywhere:** positions are
    stale up to the heartbeat cadence and unknown position on either side FAILS
    OPEN (treated in range), so the wording is "likely out of range", never
    authoritative. **Follow-up (not built, needs new event plumbing):** the
    cross-client "likely missed (out of range) at land time" cue — `buff_casts`
    rows carry no positions, so a landing-time range comparison needs positions
    on the land event; filed rather than half-built. See BETA-TESTING #117.
- **#111 /who overlay enrichment — DONE (2026-07-19, bot 3.0.215 + web 1.0.247
  on main; agent 3.3.93 beta + who overlay in Mimic 1.9.6 beta).** The in-game
  /who overlay now (1) drops a 🐺 next to any raider running Mimic, (2) lines
  class and level into their own left-aligned columns instead of drifting ragged
  after the guild tag, (3) shows the level we know for a guildmate who's /anon
  (dimmed/italic, marking it as our-data not the game's), and (4) appends the
  main in parentheses for Wolf Pack alts, from `characters.main_name`.
  - **Enrichment surface (bot).** Extended the existing `GET
    /api/agent/who-lookup` idiom (not a new endpoint): the same de-anon response
    now also carries `{ main, mimic }` per name. `main` from a 60s-cached
    name→`main_name` map; `mimic` from the in-memory reporter registry
    (`_freshMimicPrimaries` — primaries whose heartbeat is within `REPORTER_TTL_MS`).
    Registered a `who_lookup` admission-control budget kind (120/min, GET,
    non-durable) and gated the route. The main/mimic merge is a pure, unit-tested
    helper `_assembleWhoEnrichment` (test/who-enrichment.test.js, source-slice tier).
  - **Hide-main mechanism = the `hide_main_names` tuning key** (comma-separated,
    case-insensitive) in `overlay_tuning.tuning` — the SAME string-tuning-key idiom
    #115 uses for `reporter_pin_*`/`reporter_extra_*` (same jsonb, same 60s cache,
    survives deploys, preserved by the /admin/overlays save passthrough). Chosen
    over a `characters.hide_main` column because it is **zero-migration** (rode
    tonight's beta with no schema change) and edited with no code release. Enforced
    SERVER-side: a hidden name never has a main emitted (matched by its own name OR
    its main's name, so listing either the alt or the main hides the link).
    **Seeded `hide_main_names = "Tildias,Serreth"`** via the Supabase MCP (both are
    alts — Tildias→Stupidrichard, Serreth→Peopleslayer — the explicit privacy
    exception). Editing the list today is an MCP/SQL update to that row (like the
    #115 pins before they got their Mimic panel); a dedicated officer input is the
    natural fast-follow.
  - **Mimic-detection limit (honest).** The reporter registry keys on
    `discord_id → { primary, … }`, where `primary` is the agent's reported
    `primary_character` (the `--character` box, else the first watched log). So the
    🐺 lands on a raider's **reported primary**, not necessarily the exact toon on
    screen: a member running Mimic while playing an ALT gets the wolf only when that
    alt IS the reported primary/watched character. N≥2 identities per agent aren't
    tracked. Fail-open throughout: bot unreachable → the overlay renders exactly as
    before (de-anon still served from the agent's local cache). See BETA-TESTING #111.
- **#116 overlay bug round — DONE (2026-07-19, agent 3.3.92 beta + web 1.0.246
  docs/roadmap).** Repro-first fixture round; also closes long-open #35.
  - **Spell Casting (melody overlay) stale card**: a stopped caster could
    linger forever as a frozen "stopped N ago" card with the buff-duration chip
    and a doubled frame (lone red stopped-row nested inside the wrap border).
    `melody.html` now decouples the /api/state fetch from paint (a disconnect
    can't freeze the view) and ages out characters idle >45s (agent drops
    melodies at 30s). Fixture: fail-before/pass-after under a DOM mock.
  - **Setup chrome never dismissed**: `overlay.html` + `triggers.html` Done
    always called the GLOBAL set-setup-mode(false), which
    `applyOverlayInteractivity()` skips for windows in the single-overlay
    ("Setup THIS") registry — chrome stayed up. Both are now scope-aware like
    the 13 panel overlays, and `main.js` also tears down single-setup on 🔒 and
    ✕. Fixture drove the real overlay script + a faithful single-setup registry
    model.
  - **#35 CLOSED**: CH-chain drag wiring + opacity slider verified functional
    on current beta — the remaining Spell-Casting backdrop item was this bug.
- **Rules-mechanization thread R.1+R.2 — DONE (2026-07-19, bot 3.0.213 + web
  1.0.244 on main).** First bundle of the queue's rules thread (#94 ingest + #92
  attendance audit).
  - **#94 guild-rules store + `/ingestrules` + admin view.** New `guild_rules`
    table (migration `20260719120000`; RLS authenticated-read, service-role
    write — the roll_sets Tier-2 idiom). Officer slash command `/ingestrules`
    (`commands/ingestrules.js`, officer-gated via `hasOfficerRole`) reads the
    three rules channels (`RULES_CHANNEL_ID` / `RAID_RULES_CHANNEL_ID` /
    `LOOT_RULES_CHANNEL_ID`, added to `.env.example`), shapes every message into
    a rule via the zero-dep pure parser `utils/rulesParser.js` (numbered-item +
    heading/bold detection; **every message lands at least as a raw-body row
    with rule_number null — nothing dropped**; embed-only messages fall back to
    embed title/description), and **upserts by (guild, channel_key,
    source_message_id)** so re-runs update edited messages in place and flip
    vanished messages `active=false`. Reply summarizes per channel
    (rows · numbered · raw · deactivated · scanned). Read surface: read-only
    `/admin/rules` (server component + supabaseAdmin, officer gate via the admin
    layout), grouped by channel in rule order, parsed-vs-raw + deactivated
    flags. **We do NOT interpret rule semantics** — `category` is a reserved
    NULL column for #95/#93 to fill. Tests: `test/rules-ingest.test.js` (18 —
    numbered shapes, heading/bold, raw fallback, title clip, and the
    build-row edit-upsert idempotency mapping). *Officer/infra — no CHANGELOGS
    or roadmap entry.*
  - **#92 attendance gap-check (RESCOPED to an audit + small fill).** **What
    OpenDKP + existing surfaces already cover:** `opendkp_attendance_recent`
    (view) gives per-CHARACTER raid COUNTS for 30d/90d/lifetime + first/last
    seen; `/admin/attendance` computes TICK-level RA% for 30d + prior-30d per
    character with denominators; targets/roster-headcount + new/downturn cohorts
    are already there. **Genuine gaps filled:** no 60d window, no RA% beyond 30d,
    no tick counts exposed reusably, and **nothing was family-aware** (main+alts
    counted separately). Fix = ONE SQL view, no engine: `member_attendance_metrics`
    (migration `20260719121000`, `security_invoker=on`) rolls up main+alts via the
    established `lower(coalesce(nullif(main_name,''),name))` family idiom (same as
    `character_data_floor`), and emits **60/90/lifetime (and 30d) tick-based RA%
    + attended tick counts + denominators + raid-attended counts + first/last**.
    RA% is tick-based to match OpenDKP's "30 Day (52/52)" and the page's math
    (empty-attendee ticks excluded as sync gaps; a tick counts once per family).
    Attendee names not in `characters` become singleton families so no attendance
    is dropped. Small addition to `/admin/attendance`: a "Family RA%" table
    reading the view (sorted by 90d RA%). **Verified live:** family rollup
    matched an independent DISTINCT-union cross-check exactly (Peopleslayer family
    `raids_att_lifetime=229`). **Consumers (seating, #80 review cards) should read
    RA% + tick counts from `member_attendance_metrics`.**
- **Rules-mechanization thread R.3 (#95) + R.4 (#93) v1 — DONE (2026-07-18, web
  1.0.245 on main).** Both are pure-lib + web surfaces off gear/signup data we
  already collect; no bot, agent, or Mimic change.
  - **#95 Raid Kit readiness (rule 12).** Pure compute in `web/lib/raidKit.ts`
    (`computeRaidKit`): 100-MR floor summed from **worn gear only** (same
    resist-sum idiom as the gear page) + a best-effort utility checklist
    (Enduring Breath / Levitate / self-invis / self-port + the Necro coffin).
    **"Helping not watching"**: MR is the ONLY hard pass/fail and only when a
    gear snapshot exists; utilities read *covered / not-detected* (amber, never
    red) because a source can sit in the privacy-stripped bank or an un-uploaded
    spellbook. Detection under-claims on purpose — a class-innate self-buff is
    credited only for the certain Luclin cases (Druid/Wizard/Enchanter/Necro/
    Shaman), otherwise it needs a real item click/worn effect or a scribed spell
    (`character_spellbook`). Honors `exclude_from_stats`/`exclude_inventory`.
    Member surface: compact 🎒 card on `/character/[name]/gear` (`RaidKitCard`).
    Officer surface: **`/admin/readiness`** — whole-roster table (membership =
    the attendance page's roster-rank predicate), MR + checklist columns, MR-fail
    rows floated to top, links `/admin/rules`. Tests: `test/raid-kit.test.js`
    (13 — MR edge cases, no-snapshot, opt-out, See-Invisible≠invis, scribed/item
    ladder, necro coffin + poison-bottle false positive + level-title fold).
    **Live-verified:** 16 roster chars have snapshots, all meet the 100 floor
    (lowest Squeekie 108; Hitya 158). *Member-facing — roadmap entry added.*
  - **#93 comp template + planned-vs-actual matcher.** Pure lib `web/lib/comp.ts`
    — the ONE class→archetype map (tank/healer/support/melee/ranged), template
    validation, and gap math (`computeCompGaps`: archetype + per-class deltas,
    minimums as floors, unmapped count, human summary). Store: new
    `comp_templates` table (migration `20260719140000`, overlay_tuning pattern —
    one jsonb-array row per guild, RLS authenticated-read + service-role write;
    applied via MCP + committed). Officer editor **`/admin/comp`** (client
    `CompEditor` = validated JSON textarea + live rendered demand preview,
    server action re-validates, `/admin/overlays` precedent). Matcher **extends**
    `/admin/signups` detail view: template picker → planned gaps from the Going
    signups' classes, plus an **actual overlay** from the best-coverage
    `raid_roster` snapshot in the event window (cheap; reuses existing capture,
    no new stream — omitted with a note when no snapshot falls in the window).
    Tests: `test/comp-matcher.test.js` (14 — archetype map + title fold, validate
    accept/reject, demand expansion + minimum floor, gap shortfall/surplus/
    per-class, met-clean). *Officer-facing — roadmap entry added.*
  - **Follow-ups (not v1):** MR is worn-gear-only (no base/buff/self-resist
    layer — the naked-stat-snapshot follow-up that the gear page's attribute box
    also waits on would let it show true in-play MR); utility detection can't see
    bank items or un-uploaded spellbooks (structural — privacy by design);
    the comp matcher's "actual" only appears for events whose window overlapped a
    live raid (raid_roster is live-capture, not per-event); RaidHelper `rh_signups`
    is empty until the RH API/scan runs, so the planned side has no data to match
    yet (matcher renders cleanly on zero). Rule-12 semantics are still hard-coded
    in the lib rather than read from `guild_rules.category` (R.1's reserved column).
- **Overlays**: DPS/Tank HUD, Extended Target (+ glide animation), Command
  Center, Charm & Pet trackers, Mob Info, Buff/Debuff queue, CH-chain,
  per-character overlay position + opacity (B-2), auto-arrange, theme picker.
- **Raid hub `/raid`**: structured view, color tiers, raid-leader badge,
  buffer mode, Mob Info overlay, RaidHelper sign-up sync (data side).
- **Agent/data backbone**: character live-state, cross-client HP, buff
  landings, charm/pet timers, Quarmy AA parser, `/who` web directory, PvP
  assist credit (`pvp_assists`).
- **Triggers**: trigger→Discord pipe, real voice audio broadcast, gauge
  conditions.
- **Platform mechanics**: redeploy-free agent manifest (`AGENT_RELEASE_REF`),
  beta/stable channels, remote overlay tuning + mid-raid load-shed, Mimic Mail.
- **Efficiency pass (2026-07-07/09)**: hot-handler memos, agent pre-filters,
  retention trims (buff_casts 7d, threat 30d, who prune), web single-RPC /who,
  VACUUM FULL reclaim.
- **Scale safeguards, in progress (2026-07-17)**: reporter-election chat pilot
  (bot 3.0.196 + agent 3.3.74 beta, #72) — see `BETA-TESTING.md`. Chunk-0
  hotfixes: auth 503-not-401 data-loss fix (bot 3.0.197); `{s}` triggers match
  backtick names (agent 3.3.75 beta). *Note:* the buff_casts 409-storm P0 the
  audit flagged was already fixed in prod (`insertIgnoreDuplicates`).
  - **P1b done (2026-07-18, bot 3.0.206 + agent 3.3.81 beta)**: buff-landing
    election — coverage-ranked, 3 reporters/zone. Bot tallies distinct
    (spell,target) landings per uploader over a 10-min window and elects the top
    3 per heartbeat-zone; agent honors `roles.buffs` in the buff_casts path,
    `is_charm_spell` rows exempt (always upload). Gated behind `dedup_buffs`
    (default OFF) on `/admin/overlays`; fail-open everywhere.
  - **P1c + strays + camp-out done (2026-07-18, bot 3.0.207 + agent 3.3.82
    beta)**: **#72 election work complete.** (1) **Roster election** — 1 reporter
    per RAID GROUP (`_electRosterReporters`), partitioned by the `group_num` the
    agent already sends in its heartbeat (derived from the Zeal raid pipe for its
    primary); unknown group → own singleton (always elected). Agent honors
    `roles.roster` in the raid-roster upload path. Gated behind `dedup_roster`
    (default OFF). **Write-path (2.1):** ingest is now a plain per-uploader upsert
    (was DELETE+upsert) — one round trip, departed rows age out via the readers'
    existing 15-min `captured_at` window + a daily midnight prune. (2) **Stray
    endpoints:** `buff-lag-report` (diagnostic) now rides `roles.buffs`
    agent-side (local snappy-mode unaffected); `debuff-clear` deliberately LEFT
    UNGATED (per-actor control action — gating would drop a non-elected clicker's
    "✓ cured" feedback). (3) **Camp-out early handoff** — agent detects `/camp`
    (`/prepare your camp/i`), sets `camping`, fires an immediate heartbeat; bot
    demotes camping agents from every election unless they're the sole live
    candidate in scope (`_dropCampers`, fail-open), starting handoff ~30s before
    the TTL. Fail-open throughout; per-observer streams untouched (no roles).
- **#73 admission control + Supabase resilience — CORE done (2026-07-18, bot
  3.0.208 + agent 3.3.85 beta).** Four pieces landed:
  1. **Per-uploader × per-kind ingest budgets** (`_overBudget`, index.js) on the
     hot `/api/agent/*` surface, keyed by session-token hash (IP fallback),
     60s windows. Defaults sized generously from the audit (a healthy agent
     never trips). Tunable via the SAME 60s overlay-tuning map as `flag_shed_*`:
     `budget_<kind>_per_min` (default per kind; `0`=unlimited),
     `budget_enforce_<kind>=1` (durable kinds: log-only → real 429+Retry-After),
     `flag_disable_budgets=1` (kill switch). **Fleet-safe defaults:** durable
     kinds (encounter/chat/historical_chat/buff_casts/bosskill/lockout/rolls) →
     **log-only** (no 429 until an officer opts in); ephemeral/redundant kinds
     (live_state/casting/threat_snapshot/raid_roster) → **200-ack-and-drop**
     over budget (the shed pattern); `recent_fires` GET → 429. One log line per
     uploader per window. Defaults per kind (per-min): encounter 120, chat 120,
     historical_chat 120, buff_casts 240, bosskill 30, lockout 30, rolls 60,
     live_state 240, casting 240, threat_snapshot 120, raid_roster 90,
     recent_fires 240.
  2. **Supabase timeout + circuit breaker** (`utils/supabase.js`): `_request`
     now carries a ~10s AbortController timeout (a brownout resolves null, not a
     zombie await) + a consecutive-failure breaker (open after N, cooldown,
     single half-open probe). Timeout/network/5xx trip it; 4xx counts as
     reachable. null/[] contract unchanged. Knobs are ENV (not tuning — they
     guard the tuning store): `SUPABASE_REQUEST_TIMEOUT_MS` (10000),
     `SUPABASE_BREAKER_THRESHOLD` (5), `SUPABASE_BREAKER_COOLDOWN_MS` (30000).
     State on `GET /health`.
  3. **`target-buffs` GET cache** — 2s per-target in-memory cache, mirroring
     `character-live-state`; it was the only hot GET hitting Supabase per
     request. (`target-casts` needs none — it reads the in-memory relay.)
  4. **Poison hardening** — buff_casts `cast_at` and chat `ts` now
     sanitize-and-skip an unparseable date instead of throwing a 500 (which a
     5xx-retrying agent re-posted forever). encounter/live-state/casting were
     already defended. **Agent 3.3.85 beta**: honor 429 `Retry-After` in the
     durable queue (429 was already retryable — not in `QUEUE_PERMANENT_CODES` —
     so no data was ever lost; the fix makes backoff precise and excludes 429
     from poison-parking).
  - ✅ **#73 tail DONE as #106 (2026-07-18, bot 3.0.210 + agent 3.3.87 beta)** —
    see the #106 entry below; the six-GET-loop consolidation + encounter-burst
    flattening close #73 entirely. **Wave 2 is now fully closed** (#72 election,
    #73 admission control incl. tail, #74 control plane, #58 zero-downtime).
- **#109 Mimic dashboard restructure — DONE (2026-07-19, agent 3.3.90 beta;
  web 1.0.243 roadmap on main; BETA).** Guild-lead ask, two halves. **(1) 🐺 Me
  card replaces the logsync region.** The Dashboard tab opens on a new `#wpMeCard`
  (renderMeCard, all-LOCAL: own Zeal client → character + zone + compact
  buff-NAMES line; watched-log characters; last ~5 local tells; last few uploads
  as name + duration + a /parses jump) with a prominent wolfpack.quest/me link.
  Buff names (no ticking counts) keep it byte-stable mid-combat; fmtAgo lives
  inside this dedicated placeholder per the rendering rules. The engine/sync guts
  moved into a collapsed **⚙ Engine** `<details>` (`#wpEngine`/renderEngine,
  wpKeep('engine')) that now houses `#wpSetupChecks` (moved from #dash),
  `#wpEngineStats` (new — files tailed, queue depth, upload counts, reporter
  line), and `#wpWatchedLogs` (moved from #info). Every existing id/render fn is
  preserved — placement change, not plumbing. **(2) 🛡 Admin menu.** A new
  officer-only nav tab + `#admin` section (renderAdmin) that collects the officer
  widgets that were scattered: `#wpDkpTick` + `#wpDkpLoot` (with "Post for
  bidding") MOVED here from #info, plus quick links to /admin/overlays,
  /admin/triggers, /admin/encounters, /admin. **Gate is agent-side, not CSS:**
  the sensitive card DATA (`dkpTick`/`dkpLoot`) is only serialized into
  /api/state for officers (null otherwise), and renderAdmin reveals the nav tab
  + fills the section ONLY when `mimicIdentity.is_officer` (the bot's
  authenticated reply). A non-officer never receives the tab or the data.
  **Quick-flip:** raid_hold/flag_shed are polled READ-ONLY by the agent and set
  on web /admin/overlays — no officer-authed agent write endpoint exists, so the
  Admin tab ships LINKS to it (a local one-click flip is a noted follow-up; no
  new write endpoint built this task). Verify: agent `node --check` +
  `check:dashboard` green (WEB_HTML restructure); scratchpad smoke 18/18 (Me card
  populated from synthetic state; Engine details present + collapsed by default;
  Admin tab absent for non-officer, present + collecting DKP/loot for officer).
  See BETA-TESTING #109.
- **#112 chat-election liveness + zone-spread — DONE (2026-07-19, bot 3.0.214 on
  main + agent 3.3.91 beta).** *Incident (2026-07-19, real):* guild chat → Discord
  went dark ~6:43am–3:16pm. The single elected chat reporter's AGENT kept
  heartbeating while its CHARACTER was logged out — it stayed elected and saw no
  chat. The election TTL never noticed (the agent was alive), and the PvP death
  feed (not election-gated) posted all day, proving the fleet was healthy — only
  the one elected stream died. Mitigation IN PLACE since the incident: `dedup_chat=0`
  in `overlay_tuning` (everyone uploads chat). **Fix, two defenses:**
  (1) **Liveness** — the agent heartbeat now carries `last_line_ms` (ms since it
  last processed a live log line from its PRIMARY's tail; a logged-out char tails
  nothing, so it climbs past the threshold within ~a minute). Chat candidacy
  requires `last_line_age < reporter_liveness_max_ms` (default 90000); a stale
  candidate is demoted exactly like a camper. Older agents that omit the field are
  treated FRESH (fail-open for the whole fleet during rollout); if NO candidate
  anywhere is fresh, all live agents stay eligible (never zero uploaders).
  (2) **Zone-spread** — chat now elects one reporter PER OCCUPIED ZONE (reusing
  the buff election's zone grouping); /gu is global so one live reporter suffices,
  but the per-zone spread is deliberate redundancy and the bot's existing 10s chat
  dedup collapses the duplicate posts. Unknown zone → own singleton (fail-open).
  Failover: a reporter whose log goes quiet is demoted on the next poll after its
  age crosses the threshold (~90s + one 20s cycle), bounding an outage to ~a minute
  instead of hours; another zone's reporter (or the freshest same-zone candidate)
  takes over. **Re-enable:** once the fleet is on agent ≥3.3.91, flip `dedup_chat`
  back on (delete the key / set 1) in `/admin/overlays`. Verify: `lint` + `test`
  (election slice extended: liveness demotion, missing-signal fail-open, zone-spread
  two-zones, no-fresh fail-open) + `check:dashboard` green ON MAIN. See BETA-TESTING #112.
- **#115 officer reporter control panel — DONE (2026-07-19, bot 3.0.214 on main +
  agent 3.3.91 beta).** Companion to #112: officers can SEE and STEER the reporter
  election from Mimic. **Read** — `GET server-panel/reporters` (officer-gated, same
  `is_officer` gate the DKP/loot widgets use) returns the live registry (per
  uploader: character, zone, group, agent_version, camping, last_line_age, fresh)
  + per-service elected sets + active pins/extras. **Write** — `POST
  /api/agent/reporter-override` (officer-authed, proxied through the agent's
  generic `/api/server/` passthrough) sets the override TUNING KEYS
  `reporter_pin_<svc>` (a character name) / `reporter_extra_<svc>` (comma names),
  so they ride the 60s control-plane cache and survive deploys (string-tuning
  precedent: `agent_release_ref_beta`); read-modify-write preserves other knobs.
  **Election honors overrides:** a pin that is LIVE+FRESH replaces the computed
  pick for its scope; a dead/stale pin is IGNORED (one log line, fail-open); extras
  are additive. Pins exist ONLY for chat/buffs/roster — per-observer streams are
  never passed to the override path, so mob/encounter data can never be pinned.
  **Panel (agent, #109's 🛡 Admin tab):** a 📡 Reporters card (officer-gated by the
  same data gate) — table of live uploaders + elected badges per service, a swap
  dropdown (sets the pin), an add-include input (sets extras), and a clear button.
  Byte-stable render into its own `wp*` placeholder; non-officers get no data and
  no panel. Verify: election-slice tests (pin honored/ignored, extras additive) +
  scratchpad smoke (panel renders from synthetic registry; swap POST shape; empty
  for non-officer). See BETA-TESTING #115.
- **#110 OpenDKP audit-trail reconciliation — DONE (2026-07-19, bot 3.0.212 on
  main).** Path shipped: **BOTH** — audit feed as TRIGGER + WATERMARK, scoped
  reconcile as the precise removal. Motivated by the 2026-07-19 "Backpack"
  incident (3 test awards deleted in OpenDKP but still on wolfpack.quest's
  parses/loot surfaces; `opendkp_loot` is append-only via upsert and
  `_raidNeedsDetail` stops re-fetching a settled raid, so the deletion never
  propagated).
  - **Evidence the audit path can't stand alone:** `opendkp_audits.raw` carries
    only `{AuditId, CognitoUser, ClientId, Timestamp, Action}` across all 46k
    rows — `Action` is a bare label ("Raid Updated", "Raid Deleted", …) with **no
    entity ids** and **no per-item "Loot Deleted" event**. A loot removal shows
    up only as a raid-level "Raid Updated". So an audit entry can't be mapped to
    the loot row it changed — precise reconciliation from audits alone is
    impossible.
  - **What shipped (`utils/openDkpSync.js` `reconcileRecentLoot`, wired into
    `runSync` after `syncAudits`):** each sync reads new audits since a watermark
    (`bot_kv` key `opendkp_reconcile`, `{lastAuditId, lastReconcileAt}` — no new
    schema); a new "Raid Updated"/"Raid Deleted" (or a 6h floor) warrants a pass.
    The pass re-pulls ONLY recent raids' loot (default 14d, `OPENDKP_RECONCILE_
    WINDOW_DAYS`), upserts upstream (edits/adds propagate), and deletes local
    rows absent upstream (ghosts). Idempotent (empty diff on a clean mirror),
    watermarked, one log line per removal. **Fails SAFE:** never deletes for a
    raid whose detail fetch errored/was malformed, and the whole pass aborts its
    deletes if the removal set exceeds `max(20, 25% of scanned)` (guards an
    upstream empty-`Items[]` glitch). `/syncopendkp` reports reconcile stats;
    `full:true` reconciles every raid.
  - **Scope:** deletions apply ONLY to the `opendkp_loot` mirror (pure mirror —
    no bot-owned rows; verified). Whole-raid deletes (a `getRaid` 404 leaves the
    `opendkp_raids`+cascade row) and auction/adjustment ghosts are a documented
    same-class follow-up, out of this incident's scope.
  - **Verify:** `lint` + `test` (142, incl. new `test/opendkp-reconcile.test.js`,
    14: classify mapping, scoped-diff removal set, watermark advance, idempotency,
    dry-run, fail-safe cap, bad-fetch guard) + `check:dashboard` green ON MAIN. A
    true live dry-run couldn't run here (OpenDKP Cognito secrets are Railway-only,
    and the reconcile needs upstream `getRaid`); prod SQL confirms the first real
    pass is near-zero + safe — recent 14d window: 171 loot / 6 raids, **0** NULL
    `game_item_id` (no key churn), **0** duplicate dedup-keys, backpacks already
    gone, safety cap 43. See BETA-TESTING #110.
- **#108 loot bidding dashboard element (Mimic) — DONE (2026-07-19, agent
  3.3.89 beta + bot 3.0.211 on main; BETA).** Guild-lead ask. A "💰 Loot
  bidding" card (BETA-tagged) in the agent dashboard:
  1. **Hard OpenDKP login gate (agent).** Every bid control is disabled until
     the user signs into their OpenDKP account. The agent drives AWS Cognito
     `USER_PASSWORD_AUTH` directly (built-in `https`, zero deps — same flow as
     `utils/opendkp.js`); the token lives ONLY in `logsync.opendkp.json` and is
     never uploaded. The PUBLIC Cognito app-client id + region come from the
     bot's `server-panel/opendkp-auth-config` (one source of truth, zero secrets
     in the agent). Bids still ride the existing officer-mediated, sealed
     `/api/agent/place-bid` — the login is the GATE + bid-history unlock, not a
     new bid path.
  2. **Live auctions (agent).** Surfaces the v3.3.88 `_lootAuctions` detection
     via `GET /api/loot/auctions` (one source of truth — no re-parse) MERGED
     with the bot's live OpenDKP auctions. Per item: wishlist ★, last winner +
     runner-up, a bid box, and a "+1" prefill (runner-up + 1, fallback last-win
     + 1 — never auto-submits; the Bid button submits).
  3. **Local main+alt family (agent).** `logsync.bidfamily.json` + a small
     editor (add/remove/mark-main) + a per-bid character picker.
  4. **Bid history + wishlist (bot).** Once authed, `server-panel/bid-history`
     serves the caller's wins (`opendkp_loot`) + wishlist — explicit prereg
     (`wishlists`) MERGED with items inferred from OpenDKP bid history
     (`opendkp_auction_bids.user_login`/`character_name`), each tagged
     `prereg` vs `from bid history`. `server-panel/item-history` serves the
     last winner + runner-up per item.
  - **Data-chain reality:** `loot_drops` is empty in prod and sealed auctions
    DISCARD losing bids on settle, so the RUNNER-UP is often unavailable — the
    winner + winning bid come reliably from `opendkp_auctions` (13k rows), the
    runner-up from `opendkp_auction_bids` when the pre-settle bids were mirrored,
    else null (panel falls back to last-win + 1). OUT of scope (later board):
    officer auction management (#70), posting auctions (#68) — read-only +
    place-bid only.
  - Verify: agent `node --check` + `check:dashboard` green; scratchpad smoke
    20/20 (gate, family persistence across restart, auth transitions, local-
    auction surfacing, prefill math); bot `lint` + `test` (128, incl. new
    `test/loot-bidding.test.js` source-slice, 10) + `check:dashboard` green ON
    MAIN. See BETA-TESTING #108.
- **#107 loot-post TTS + auction countdown chips + trigger overlay auto-grow —
  DONE (2026-07-19, agent 3.3.88 beta; web 1.0.241 roadmap on main — NO bot
  change).** Guild-lead ask, two halves, all agent + Mimic-overlay:
  1. **Loot-post announce (agent).** `noteLootAuction()` hooks the LIVE /gu+/rs
     tail (never the `--since` backfill) and reuses `parseLootChatBody`'s strict
     Title-Case guard: a multi-item drop list is a loot post on its own; a lone
     single item needs bid context (a bid word inline, or a bid call heard in the
     last 30s). The chat line is the universal signal — every raider's agent sees
     it locally — so the callout is per-client LOCAL TTS + a chip, no relay/dedup.
     Duration parsed from the bid call ("2 min", "90s"), else the configurable
     `lootAuctionDefaultSec` (120s); a later bid call that states a duration
     re-anchors the most-recent auction. TTS rides the existing overlay-fire
     pipeline (`_pushOverlay` → `recentTriggerFires`), so it respects the master
     `enableTriggerTts` flag for free: "Loot posted — N items, bids open X"
     (item COUNT, not the list).
  2. **Auction countdown chip (agent + triggers.html).** Reuses the trigger
     `_activeTimers` machinery so it looks/behaves like a Death Touch timer (gold,
     15s warning). Same item set = reset in place (multibox + repeat posts stay
     silent — the announce fires only on first open); distinct sets stack.
     Per-chip ✕ dismiss (`kind:'loot'`/`dismissible` in the snapshot → overlay
     draws a ✕ with the hover-interact handshake → `POST /api/timers/cancel`).
     Dashboard Triggers-tab toggle (`lootAuctionTts`, default ON) + default-
     duration knob (`POST /api/loot-prefs`), persisted in `logsync.optin.json`.
  3. **Trigger overlay auto-grow (triggers.html).** The renderer measured ONLY
     the `#timers` stack and shrank the window to 50px when no timer was live —
     cropping the sticky stack (#76) + feedback buttons in the centered
     `#alertcol` (the "bottom buttons cut off" bug). Now a `ResizeObserver` on
     BOTH `#alertcol` and `#timers` drives `measureWanted()` → the existing
     `overlayAutoHeight` IPC (grow-up/down + work-area clamp already handled
     there). Grow immediate, shrink debounced 250ms, clamp ~60% work area with
     `#timers` internal scroll beyond. **Interaction rule shipped:** height is
     fully auto-managed; the right-click resize presets only change WIDTH, so
     manual sizing and auto-grow never fight — 50px baseline floor, ~60% ceiling.
     `main.js` untouched.
  - Verify: scratchpad smoke over the parser (announce text + duration incl.
     default path, chip payload, reset-vs-stack, false-positive guards) 38/38;
     agent `node --check` + `check:dashboard` green; triggers.html `<script>`
     parses. See BETA-TESTING #107.
- **#106 multiplexed agent poll + encounter-burst jitter — DONE (2026-07-18, bot
  3.0.210 on main + agent 3.3.87 beta).** The deferred #73 tail, built on the
  budgets/breaker/shed/kill-switch already shipped:
  1. **`GET /api/agent/poll` (bot).** One bundle endpoint assembled from the SAME
     in-memory/cached stores the individual routes read — no new Supabase hit per
     poll. Request carries `streams=<csv>` + per-stream cursors reusing each
     stream's existing semantics (`since_id` recent_fires · `tuning_ver` hash ·
     `trig_ver` max-updated_at · `classes`/`characters`). Response
     `{streams:{<key>:{data}|{unchanged:true}}, agent_kill, min_agent_ver_num}`;
     a stream shed via `flag_shed_<key>` is OMITTED (client fails open). Control
     plane rides every poll (the dormancy/floor channel). The six individual
     routes stay live (extracted to shared `_*For` helpers so bundle + standalone
     never drift). Gated by a new `poll` admission budget (240/min, 429 over).
  2. **Single agent poll loop (agent, fallback-safe).** One 1.5s loop asks for
     `recent_fires`+`tuning` every tick and the slow streams (triggers 2min,
     prefs 10min, backfill/ui_edits 5min) only when due — same per-stream rate as
     before, six request streams → one. **Feature-detect:** a 404 or a non-poll-
     shaped 200 (old bot's catch-all `OK`) flips to permanent per-process
     fallback to the individual loops (they no-op behind an `_multiplexActive()`
     gate until then). **Dormancy preserved:** while paused/below-floor the loop
     asks for `tuning` ONLY (nothing else), throttled to the control cadence.
  3. **Deterministic encounter-upload jitter (agent).** On fight end a real
     encounter's network enqueue is delayed `hash(uploader) % 15s` (deterministic
     per client — re-runs don't re-randomize), flattening the ~90MB-at-60
     simultaneous offer; the ±30min find_or_create dedup makes a few seconds
     immaterial and the durable queue already honors 429/Retry-After. **Bypass:**
     an empty queue AND a payload < 256KB (solo/duo parse) enqueues immediately so
     the dashboard card feels instant. Local overlay/UX is never delayed — only
     the enqueue-to-network moment; backfill replays skip the jitter.
  - **Req-rate math (steady-state GET polling, per bot):** at 15 clients the
     recent-fires loop alone was ~10 req/s and the 5 slower loops added a light
     tail; after #106 it's ~10 req/s TOTAL (one loop, the slow streams absorbed).
     At 60 clients recent-fires was ~40 req/s + 5 more loops → after #106 ~40
     req/s total, the other five collapsed into it (Supabase read rate for the
     slow streams unchanged — they ride only their own cadence).
  - Tests: `test/poll-bundle.test.js` (source-slice of the bundle's per-stream
     decision — shed-omission + cursor/unchanged), `test/encounter-jitter.test.js`
     (mirror of the pure jitter helpers — determinism, 0..15s bounds, bypass;
     upgrade to source-slice at the next agent→main graduation). Full main gate
     (lint/test/check:dashboard) green; agent `node --check` + check:dashboard.
- **#74 control plane COMPLETE + #58 zero-downtime deploys DONE (2026-07-18, bot
  3.0.209 + web 1.0.240 on main; agent 3.3.86 + Mimic LKG on beta 1.9.6).** Built
  on the reporter election + budgets + breaker + `GET /health` already shipped:
  1. **Full `flag_shed_<kind>` coverage (#74 Part 1, bot).** The 200-ack-and-drop
     load-shed now covers every sheddable ingest kind — the original four
     (`live_state`/`raid_roster`/`casting`/`threat_snapshot`) PLUS `buff_casts`,
     `pvp`, `pvp_assists` (the /who-harvest rides these two — no separate who
     endpoint), `fun_event`, `trigger_relay`, `ui_layout`, `tells`. **Deliberate
     exceptions, NEVER sheddable** (`_SHED_NEVER`): `encounter`, `chat`,
     `bosskill`, `lockout`, `historical_chat` — `_isShedded` refuses them even if
     the flag is set (documented at the shed map; enforced by
     `test/shed-exceptions.test.js`). Web toggles added for every new shed kind.
  2. **`flag_agent_kill` + `min_agent_ver_num` (#74 Part 2, bot main + agent
     beta).** Served on BOTH the reporter-poll (20s primary) and guild-trigger
     (2min backup) responses. `flag_agent_kill=1` → fleet dormancy: agents stop
     all uploads + non-control polls, HOLD the durable queue (nothing dropped),
     keep only the heartbeat, banner "⏸ Agent paused by guild control plane";
     overlays keep working on local data; clearing resumes within one heartbeat.
     `min_agent_ver_num=<n>` → agents whose numeric version (`major*10000+minor*100
     +patch`, 3.3.85 → 30385) is below the floor stand down + show an update nudge.
     Both are labeled controls in the `/admin/overlays` 🛑 Kill switches section
     (kill = scary checkbox, floor = number input, empty = unset; merge-preserving
     save intact). **Fail-open everywhere** (missing/unparseable = no effect; the
     agent only stands down on a FRESH reading — bot down = runs normally after a
     5-min TTL). **⚠ These are POLICY semantics — conservative v1, Hitya to sign
     off.**
  3. **LKG crash-loop auto-rollback (#74 Part 3, Mimic beta).** Before any agent
     hot-swap Mimic snapshots the working agent to `index.lkg.js` + `package.lkg.json`
     in the userData agent dir. If the swapped-in child exits ≥3× within 2 min
     (crash-loop right after a swap), Mimic restores LKG, relaunches from it, sets
     a tray/dashboard "reverted to last-known-good" notice, and BLACKLISTS the bad
     version (won't re-offer it until a strictly newer build ships). Crash-loop
     with no recent swap keeps the existing exponential backoff + surfaces a
     diagnostic notice (no infinite tight restart). One log line per transition;
     blacklist decision covered by `test/lkg-blacklist.test.js`.
  4. **Per-channel manifest → beta hot-swaps (#74 Part 4, bot main + Mimic beta).**
     `GET /api/agent/latest-version?channel=beta` resolves a per-channel ref
     (`AGENT_RELEASE_REF_BETA` env, default the `beta` branch, live-overridable via
     the `agent_release_ref_beta` tuning key) and serves that file+sha. Beta Mimic
     builds (detected by the `-` prerelease suffix) now hot-swap along the beta
     line instead of waiting for a full electron-updater installer. Safe ONLY
     because the kill switch (Part 2) + LKG rollback (Part 3) are the four-gate
     safeguards for an auto-hot-swappable beta.
  5. **#58 Railway zero-downtime (main).** `railway.toml` healthcheck moved from
     `/` to the readiness-gated `/health`, which returns 503 until the Discord
     client is ready + state loaded (`_botReady`, set in ClientReady) and 503
     again once a graceful shutdown begins. Graceful SIGTERM/SIGINT drain: stop
     accepting new HTTP work (503, `Connection: close`), `server.close()`, give
     in-flight handlers ~10s (`SHUTDOWN_DRAIN_MS`) to finish, `client.destroy()`,
     exit. **Config + drain is our half; full overlap/zero-downtime also needs the
     Railway plan's overlap feature.** Watch-paths unchanged (bot deploys stay
     decoupled from web pushes). Tests: version-floor comparator + shed exception
     list + LKG blacklist (`test/version-floor.test.js` mirror,
     `test/shed-exceptions.test.js` source-slice, `test/lkg-blacklist.test.js`).
- **Callout trifecta, in progress (2026-07-17, #76)** — the "why TTS never
  fires" fixes: triggers evaluate before the privacy/combat filter so
  ENRAGED/snare/mez/fizzle templates fire (agent 3.3.76 beta, 9/17 dead
  templates); trigger relay seeds a monotonic id base so a bot deploy no longer
  makes the fleet relay-deaf for hours (bot 3.0.198). Deferred: ✕-mutes-TTS
  overlay decouple (#97, since shipped in the 1.9 line).
- **#76 remainder (callout trust infra) DONE + #103 CH GO (2026-07-18, agent
  3.3.83 beta + web 1.0.238)** — the trifecta closed the fire-path bugs; this
  closes the trust gap. (1) **Trigger checkpoint journal** — in-memory ring
  buffer (cap 250, no disk/upload) records how far each candidate evaluation got
  (line seen → matched → gates → actions → dispatched → relayed) + why it
  stopped; dashboard Triggers-tab card (`renderTriggerJournal`, own
  `#wpTriggerJournal` placeholder, no `<details>`). (2) **Real REHEARSE** — the
  ▶ Test button now `_rehearseTrigger`: synthesizes a matching line
  (`_synthesizeMatchingLine`, verified against the real regex) and drives the
  ACTUAL pipeline (pattern/cooldown/charm-suppression EVALUATED + reported but
  NOT enforced/consumed), speaks real TTS, `test=true` so no relay/upload/Discord
  and no `_fireLog` pollution; gauge triggers rehearse the action tail, journal
  "pattern not exercised (gauge condition)". (3) **Sticky callouts** — optional
  per-trigger/per-action `sticky` pins the trigger overlay until click/~5min;
  portable, backward-compatible, rides the relay via the action object (no bot
  change); officer checkbox on `/admin/triggers`. (4) **Ghost-callout TTL** — a
  relayed fire >15s old at consumption is journalled `stale-skipped`, never
  spoken (fail-open on missing ts); bot relay already carried `fired_at_ms`
  end-to-end, so NO bot change was needed. (5) **#103 CH chain "0X GO"**
  (guild-lead ask) — when the chain reaches a watched character's slot the agent
  speaks "0N GO" via `_pushOverlay` (the trigger pipeline — master
  `enableTriggerTts` still gates it); dedicated 📣 toggle on the CH chain overlay
  (default ON, localStorage + `POST /api/chchain/go-tts`, self-heals via the
  snapshot's echoed `go_tts`), debounced once per rotation pass. Verified:
  `node --check` + `check:dashboard` + 18/18 runtime smoke assertions. See
  `BETA-TESTING.md` for the raid-verify plan.
- **#105 richer fight timeline DONE (2026-07-18, agent 3.3.84 beta + web
  1.0.239)** — three new event types on the #98 `/parses/[id]` timeline, guild-
  lead ask. All ride the existing `noteTimelineEvent` → `timeline_events` →
  `encounter_events` path (bot ingest is generic over kind/subtype — NO bot
  change). (1) **slow_on / slow_off** — a known slow (data-driven `SLOW_SPELLS`
  named list: shaman Drowsy/Walking Sleep/Tagar's/Togor's/Turgur's/Cripple,
  enchanter Languid Pace/Shiftless/Tepid/Forlorn Deeds; the agent spell catalog
  carries no SPA-11 attack-speed marker so a list is the data-driven path)
  landing on the CURRENT fight target emits `slow_on` (hooked at the two
  `recordTargetBuffLanding` call sites via `EncounterBuilder.noteSlowLanding`,
  self-cast attributes the caster, bystander leaves it null); the estimated
  expiry (era-cap caster level, `_durTicksForLevel`) emits `slow_off` at flush
  IFF it fell inside the fight window — a slow still up at the kill emits
  nothing; a re-slow refreshes the window. (2) **mob_heal** — the Zeal target-
  gauge HP% rising for the SAME target name across two `/api/zeal-state` frames
  (`_noteMobHealFromState` → the observing char's live builder's `noteMobHeal`);
  guardrails: identical gauge name required, prior HP > 0 (a rise off 0% is a
  new same-name spawn), ≥5pp rise, ≥10s per-target debounce, target must match
  the fight (`_fightTargetMatches`). Same-name babysit fights can false-positive
  — accepted + documented at the source. (3) **disc** — discipline emotes via
  a data-driven `DISC_LINES` table hooked in `noteRaidLine`; the four grounded
  "fighting style" stance discs shipped (Defensive verified in-repo, Evasive/
  Precision/Aggressive share the server grammar), third-person + self both
  attributed; non-stance discs (Fortitude/Furious/Mighty Strike/Weapon Shield/
  Holyforge/Sanctification/Whirlwind) are a one-row addition once exact emote
  text is confirmed. Web: `FightTimeline.tsx` colors ticks by subtype (gold/
  amber slow pair, green heal, purple disc; enrage/rampage stay orange) + a
  present-only legend; `parses/[id]/page.tsx` now passes `subtype` through
  (read-side 3s dedup already keys on it). Verified: agent `node --check` +
  `check:dashboard` + a 12/12 runtime smoke script; main `lint` + `test` +
  `check:dashboard` + web `tsc --noEmit` green. See `BETA-TESTING.md`.
- **1.9 beta line → stable (2026-07-18, #89)**: graduated Mimic **1.9.5** /
  agent **3.3.80** to the stable channel by file-checkout of `apps/mimic` +
  `packages/wolfpack-logsync` onto `main` (never a whole-branch merge); beta
  re-parked at **1.9.6** above stable. Maiden run of the redeploy-free
  pipeline. Carries the healing overlays, seconds-fast restarts + 🛟 settings
  backups, officer loot capture + DKP ticks, ↩ revert-to-stable, faster
  (10→2min) + backtick-safe `{s}` triggers, ✕-decoupled-from-TTS (#97), and the
  fleet tank/Command-Center blanking fix (`_mtLiveStateByName`, on beta since
  3.3.73). The #72 / #76 / `{s}` beta items in `BETA-TESTING.md` graduate with
  it. Also upgraded the two MIRROR vitest suites (`trigger-class`,
  `timeline-events`) to source-slices now that the real functions ship on main.

- **Supabase RPC lockdown (2026-07-18)**: closed the advisor's SECURITY DEFINER
  hole — 10 SEC-DEFINER RPCs (11 signatures incl. `bump_agent_upload_stat` ×2)
  were EXECUTE-able by `anon`/`authenticated` via `/rest/v1/rpc/*`, worst being
  `prune_who_observations` (an anon-callable *data-deletion* vector). Migration
  `20260718040000` revokes EXECUTE from PUBLIC + anon + authenticated on all,
  grants `service_role` explicitly (bot + web already call these only as
  service_role), adds `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE … FROM PUBLIC`
  so new functions don't reopen it, and flips the 2 SEC-DEFINER views
  (`who_directory`, `opendkp_loot_recent`) to `security_invoker = on`. Advisor
  now clean on all 19 fn warnings + both view ERRORs. **Follow-ups (next entry):**
  mutable-search_path WARN ×23 (done) + leaked-password protection (dashboard);
  RLS-no-policy INFOs still deferred (out of scope).
- **Supabase search_path pin (2026-07-18)**: pinned `SET search_path = public` on
  all 23 `function_search_path_mutable` WARN functions (migration `20260718043553`).
  Bodies reference only public tables (mostly unqualified) + pg_catalog built-ins,
  none hit the `extensions` schema, so `public` is the safe pin (NOT `''`, which
  would break unqualified refs). Advisor re-run now clean of every fn WARN;
  smoke-tested `eq_class_bit`/`character_missing_spells`/`turnins_by_id`/
  `item_card_info`/`who_directory_json` still resolve their tables (write RPCs
  verified by static body inspection — not executed against prod).
  **⚠ Pending dashboard action (Hitya):** enable Auth leaked-password protection
  (HaveIBeenPwned check) — Dashboard → Authentication → password settings. No
  MCP/SQL toggle exists; it's an Auth config flip.

### ⏳ Open TODO — carried forward from the retired docs
*(These are durable items; the active wave order is in `DESIGN-platform-queue.md`.)*
- **Mimic beta queue** (`mimic-1.4-roadmap.md`, still live): sync overlay
  layout to `/me` (#5, now unblocked since B-2 shipped); Trigger-Alerts↔Triggers
  onboarding (#2); UI-Studio overlay-positioning UX (#3); UI-Studio per-char
  launch + previews (#6).
- **`/raid` hub Stages 3-5** (`raid-hub-roadmap.md`): raid-leader→Discord
  interactive ARI button; RaidHelper diff **display** on `/raid` (Stage 5);
  Feral Avatar queue + mass-buff cooldown (Stage 3); per-buff cast attribution
  + timer; DKP auction-winner highlight + "Add as looter" (Stage 4); group-buff
  regrouping suggestions; buff-slot request from own row; Discord name→mention
  in summaries.
- **Efficiency ⏳** (`EFFICIENCY-REVIEW`): web revalidate sweep
  (/leaderboards, /boards, /pop, /fun/lord-of-ire, factions); family/household
  walk extraction (×3 dup); heavy fetches (/character `.limit(10000)`, /parses
  `range(0,99999)`); `/planner` + `/loadouts` — build or retire the stubs;
  Mimic unify 3 tasklist spawners + lazy overlay renderer creation.
- **PvP** (`pvp-capture-audit.md`): relax the unguilded-participant regex
  (currently hard-requires `\w+ of <Guild>`) if unguilded PvP still matters.
- **TIME-WINDOWS telemetry (preserved)**: after ~a month, retire unused window
  chips —
  `select page, win, sum(count) from ui_window_usage group by 1,2 order by 3 desc;`
- **From `BACKLOG.md`** (unique, still open): guild bazaar price index; per-class
  name colors on overlays; multi-monitor pretty-place (c) + observed overlay sets
  (b2); wolfpacktag raid-channel capture; stale-log-filename attribution beyond
  chat (encounter/who still filename-keyed); pet buffs (`/pet health`); base
  stats v1 + bind location from `/charinfo`; "Set up for me" Mimic first-run
  wiring; tank-overlay bot-side heal-amount fallback; bulk re-merge of historical
  `encounter_players` (RPC exists — run gated on owner go); 72-raider scale prep
  (burst mode / replay harness / QPS counters — overlaps board #71-75). Board
  already tracks: #47/#51 same-name segmentation, #52 base stats, #55 mob
  immunity, #56 same-name HP serialization, #65-67 overlay polish.
- **From `CONTINUATION_QUEUE.md`** (unique, still open): ARI Phase-2 auto-handoff
  detection; CothBot labels + parked location; class-signature-counter **display**
  (collection shipped); PoP flagging tracker (greenfield; PoP locked to
  2026-10-01); guided walkthrough tours (overlaps board #86-88); `/me` loot
  per-expansion grouping (needs item→expansion map — UNCERTAIN); local log-browser
  tab in Mimic.

**⚠ Needs a local (desktop) session** — cloud sessions can't reach the local
`peq`/PQDI/EQ machine. Exact queries/files live in `archive/BACKLOG.md`; the asks:
- Mob-immunity backfill from the local `peq` DB (fix B for board #55).
- Zeal exit-crash bundles from `crashes/` (board #64 — `crash_reports` is empty).
- Per-class overlay colors / PoP P2-P3 slideshow stubs (blocked on local capture).
- Any migration needing local verification (per CLAUDE.md Migrations rule).

### 🚫 Abandoned — deliberately dropped or blocked on something external
- **Windows code-signing** — CLOSED 2026-07-14 (SignPath declined; user base too
  small). Installers stay unsigned unless another provider appears. (`code-signing.md`)
- **True mob-distance / ETA "Pull Tracker"** — blocked: needs Zeal position
  telemetry the pipe doesn't emit. Revisit only if Zeal adds it.
- **Historical chat display / era-thread routing** — collection kept, replay
  deliberately not built (CLAUDE.md scope boundary).

### 💀 Folly — built, then pulled
- **CH-neck (Necklace of Resolution) tracker** — built and fully reverted; not
  useful in practice.

### ❓ Uncertain — needs a code-owner to confirm before filing
*(No shipping evidence found, but a negative couldn't be proven exhaustively.)*
- `/me` named-mob kill counts (board #54 covers this) · overlay font-size
  control · tell-back sender-mention in relayed DMs · the unguilded-PvP regex
  status.

---

## Correction the old docs got wrong
`roadmap.md`'s own retrospective **understated progress**: PvP assist credit,
the Extended-Target glide animation, and per-character overlay position+opacity
(B-2) are all **shipped**, not pending. Trust this ledger over the archived
roadmaps.
