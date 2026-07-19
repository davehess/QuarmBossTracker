# HANDOFF — resuming the platform queue (~Wed 2026-07-23, Opus session)

*Written 2026-07-20 by the Fable session that ran the 07-17→07-20 sprint, at the
usage-limit pause. Hitya (Monk officer, EST) directs; this doc is the complete
state + process transfer. Read CLAUDE.md first, then this, then `docs/STATUS.md`
(the ledger) and `docs/BETA-TESTING.md` (what awaits field verification).*

---

## 1. Where everything stands (verified heads at pause)

| Component | Branch | Version | Head |
|---|---|---|---|
| Bot | `main` | **3.0.221** | `5225eba`/`b32447c` |
| Web | `main` | **1.0.252** | `b32447c` |
| Agent | `beta` | **3.3.100** | `13e1513` |
| Mimic | `beta` parked **1.9.6** (stable = **1.9.5**, cut 07-18) | auto `-beta.N` builds |

Test suite on `main`: **275 passing, 27 files** (`npm test`), plus `npm run lint`
(ESLint no-undef gate) and `npm run check:dashboard` — all three are BLOCKING in
`.github/workflows/test.yml`. The suite grew 0→275 this sprint; treat it as the
regression net and extend it with every change (source-slice pattern for monolith
code, real imports for `utils/*` and `web/lib/*` — see `test/` for both tiers).

**The weekend in one paragraph:** Wave 0/1/2 of `docs/DESIGN-platform-queue.md`
are fully closed (election #72 incl. camp/liveness/zone-spread, admission control
#73 + multiplexed poll #106, control plane #74, health-gated deploys #58, callout
trust #76). The rules thread closed (#94 ingest, #92 rescoped audit, #95 raid-kit,
#93 comp matcher, #91 roll-night review). Stable 1.9.5 graduated (#89). Security:
SECURITY DEFINER lockdown + search_path pins (advisor clean except leaked-password
toggle). Field-driven fixes: TTS user-activation gate (#120), dashboard flash
(#120), melody stale card + setup chrome (#116), chat-blackout election liveness
(#112), /who enrichment (#111), kill switches in-console (#118), loot bidding
v1→v2 (#108→#121), Mimic Me card + Admin tab (#109), pet-buff verdict (#117/#119
— user was pre-fix; diag card shipped), OpenDKP reconciliation (#110).

## 2. Live state flags you MUST know (control plane / data)

- **`dedup_chat = 0`** in `overlay_tuning.tuning` — the 07-19 chat-blackout
  mitigation. Everyone uploads chat. RE-ENABLE only per the procedure in
  BETA-TESTING #112 (fleet on agent ≥3.3.91 first). Do not "clean up" this key.
- **`hide_main_names = "Tildias,Serreth"`** (same tuning row) — Hitya's explicit
  privacy exception; server-side enforced in who-enrichment. Officers extend via
  the same key (a dedicated input is an open fast-follow).
- **`roll_sets` was EMPTY until 07-19 night** — Friday's off-night rolls were
  never captured (no 3.3.78+ agent ran). The Sunday raid was the first real
  capture; check whether `/rolls` now has data before debugging it as broken.
- **`loot_drops` is empty in prod** (sealed auctions discard losing bids on
  settle) — runner-up figures come from `opendkp_auction_bids` when pre-settle
  bids were mirrored, else the panel falls back to last-win+1. Not a bug.
- **`rh_signups` empty** until an officer runs `/scanraidhelper` — the #93 comp
  matcher renders cleanly on zero but shows nothing planned.
- **`opendkp_character_id_to_name` is empty**; char_id→name resolution in the
  bidding panel is MODE-inference over won-auction↔loot joins (see #121 in
  STATUS). If OpenDKP capture later fills the table, prefer it.
- A **`git stash`** may exist locally from interrupted work — NEVER pop/drop a
  stash you didn't create; the recovery drill is §6.

## 3. Awaiting FIELD verification (BETA-TESTING.md has exact cases)

Priority order for the next raid nights:
1. **#120 TTS playback** — Rehearse a suggested trigger: hear it, Mimic appears
   in the Windows volume mixer, journal shows green "playback started". The
   root-cause (Chromium user-activation gate) fix could only be best-evidence
   from Linux; checkpoint 5b makes the field self-diagnosing.
2. **#119 pet-buff diag card** — user updates past 3.3.94, casts on the pet;
   tracker should show buffs; if not, the 🐾 card names the failing checkpoint.
3. **#121 bidding v2** — the family-pooled DKP figure vs the OpenDKP UI
   (officers), and the 6-column misses layout (6th col = current DKP was the
   coordinator's INTERPRETATION — Hitya never confirmed; adjust on feedback).
4. **#112 re-enable** — once fleet ≥3.3.91, flip `dedup_chat` back on per the
   documented procedure; watch #guild-chat for gaps.
5. **P1b/P1c dedup flips** (`dedup_buffs`, `dedup_roster`) — built dark; flip
   with 2+ beta Mimics and watch upload thinning + failover.
6. Camp handoff, /who enrichment (wolf/columns/anon levels/mains), kill-switch
   round-trips, sticky callouts, loot announce chips, CH "GO", ext-target zone
   filter, auto-grow — all have ✅/👥 cases in BETA-TESTING.

## 4. Officer actions pending (Hitya, no code)

- `node deploy-commands.js` (registers `/ingestrules`), set
  `RULES_CHANNEL_ID`/`RAID_RULES_CHANNEL_ID`/`LOOT_RULES_CHANNEL_ID` on Railway,
  run `/ingestrules`, check `wolfpack.quest/admin/rules`.
- Supabase Dashboard → Authentication → enable leaked-password protection (the
  last advisor WARN; no API can do it).
- Sign off the conservative-v1 `flag_agent_kill` / `min_agent_ver_num` semantics
  (STATUS notes them), and the misses-table/DKP-pooling shapes (§3.3).
- `/scanraidhelper` to light up the comp matcher.

## 5. The deferred queue (resume in this order)

Close-out first if the Fable session didn't finish it (check STATUS):
- **(a) Light regression pass** — full gate both branches + spot-greps.
- **(b) Since-Thursday writeup + shareable image** — plain-language summary card
  (PNG via the bundled Chromium at /opt/pw-browsers) for Discord.
- **(c) Plan-check + roadmap sync** — audit delivered work vs
  `DESIGN-platform-queue.md` + STATUS; sync `web/lib/roadmapData.ts` (bump web).

Then implementation (board task numbers; every brief pattern below in §6):
1. **#122 UI Studio polish** — online-typical windows default-visible;
   char-select Zeal components (ZealZoneSelect) get their own default-off
   category; Hotbar Pages button must toggle/collapse. (`apps/mimic`, beta.)
2. **#123 UI Inspector enrichment** — chat chips named from a GROUNDED EQ filter
   enumeration ("Others' Misses", not "Ch 26"; unmappable stays "Ch N (unknown)");
   chip click-to-inspect; UI-file visualization (EQUI XML) + skin/version detect;
   version-diff vs Nillipuss/DuxaUI via checksum manifest (no live fetch).
3. **Analytics cluster** — #98 P2b (AOE detection: threshold **5 players hit
   within ~2s**; tank-switch detection), #99 per-mob all-fights view (/boss),
   #100 per-person cross-fight performance (healers/ranks/DPS on /character).
4. **#101 local replay/TTS test** — walk a log timeframe through the real
   trigger pipeline; site link-back for uncaptured fights.
5. **#114 multi-raid awareness** — DESIGN PASS FIRST (see
   `docs/DESIGN-multi-raid.md` if the Fable session produced it; else this is
   the one item where the design must precede any agent: concurrent raid
   identity from roster composition + zone clustering, partitioning for
   raid_roster/buff queue/boards/encounters/comp matcher, interaction with
   election zone/group scoping, all under the no-spawn-id constraint of
   `docs/DESIGN-dedup-and-mob-serialization.md`).
6. **Wave 3**: #78 boss playbook v1 (+Discord pipe) → #83 post-to-/rs deep links
   → #84 AOE burn windows (retire /parseaoe) → #36 AoE dance callouts → #85
   script-learning v1.
7. **Wave 4**: #75 pre-raid drill + golden-log CI → #86+#53 first-raid
   onboarding → #87 officer runbooks → #88 discovery nudges → #77 transparency.
8. **Wave 5 + tail**: #80 Raid Night Review (seed from a real Monday review) →
   #81 Raid Guide → #82 Quartermaster → #65 hot-servable overlays (four-gate
   rule!) → data tail: #46/#52 base stats, #47/#51 same-name segmentation, #54,
   #55 immunities, #56 HP serialization (observer-anchored — read the dedup
   design doc), #64 Zeal exit-crash, #66/#67/#3/#1 overlay polish, #68/#69/#70
   DKP round-out. Plus #71's remainder (res.ok guards + contract boot-test) and
   the #110 follow-up (whole-raid deletes / auction+adjustment ghosts).

## 6. Process rules (hard-won this sprint — follow them exactly)

1. **One Opus agent at a time in the shared tree**; `isolation: worktree` for
   genuinely disjoint parallel work (it worked once — clean rebase — but REMOVE
   the worktree after (`git worktree remove … && git worktree prune`) or vitest
   double-counts every test).
2. **Verify every agent** before the next launch: `git show --stat` footprints
   match the brief's allowed files; run the full gate; targeted greps for the
   claimed subsystems. Agents' reports are usually accurate but two lied by
   accident (a lint claim from the wrong checkout; an inflated test count from a
   stale worktree).
3. **Repro-first for every bug**: fixture must FAIL before the fix and PASS
   after, and the report separates OBSERVED FACTS from diagnosis. Hitya
   corrected three overconfident diagnoses in one day (clicky→charm→target-self,
   all wrong; truth = user was on a pre-fix version). Never state a hypothesis
   as a finding, in briefs OR in replies.
4. **Never amend/force-push a pushed commit** (one agent did, with lease, own
   commit, no loss — still banned; follow-up = new commit).
5. **Raid freeze**: Sun/Wed/Thu 19:30–00:30 ET (23:30 UTC–04:30 UTC). Agents
   must `date -u` before any `main` push inside the window; beta pushes are
   always fine. `[hotfix]` in the message is the emergency escape.
6. **Branch discipline**: bot/web from `main`; agent/Mimic files ONLY on `beta`
   (staging only `packages/wolfpack-logsync/**` + `apps/mimic/**` there — the
   beta checkout shows main-side files as stale, that is NORMAL, never commit
   them). Mimic version stays PARKED (1.9.6) — the workflow auto-tags `-beta.N`.
   Versions: patch bumps per component per the CLAUDE.md routing table; commit
   convention `<component> vX.Y.Z — reason` + the Co-Authored-By trailer; git
   identity `noreply@anthropic.com`/`Claude` (a stop-hook enforces it).
7. **Dashboard edits** (`WEB_HTML` in the agent): `npm run check:dashboard` is
   MANDATORY; byte-stable sections (two idle renders identical — fixture
   pattern exists from #120); volatile bits in `wp*` placeholder cards;
   `wpKeep(` on every `<details>`; never `class="name"` on non-character cells
   (the #121 404 was exactly this).
8. **Migrations**: timestamped idempotent file + MCP `apply_migration` with the
   SAME name + the identical file committed. Ground every query/mirror
   assumption against live Supabase BEFORE wiring (this caught: empty
   loot_drops, label-only audits, string group numbers, missing SPA columns).
9. **Session-limit interruptions**: agents die mid-task sometimes. Drill:
   `git stash push -m "WIP <task> — interrupted"`, clean tree, then
   `SendMessage` the SAME agent with stash-pop instructions — context survives
   and it resumes cheaply. Two successful recoveries this sprint.
10. **Budget**: report spend at bundle boundaries; Opus runs cost ~180–330k
    tokens each; verify-inline costs almost nothing. When limits pinch,
    finish + verify the in-flight agent, pause the chain, do close-out inline.

## 7. Key docs map

`CLAUDE.md` (architecture + the law) · `docs/STATUS.md` (ledger; #-entries match
the board) · `docs/BETA-TESTING.md` (field cases, newest-first) ·
`docs/DESIGN-platform-queue.md` (the wave plan; 2.x marked done) ·
`docs/DESIGN-dedup-and-mob-serialization.md` (the serialization bounds — read
before ANY same-name-mob or dedup work) · `web/lib/roadmapData.ts` (member-facing
changelog; the `callout-trust-and-ch-go-196` beta entry accumulated this
sprint's bullets, pill = Agent 3.3.100).
