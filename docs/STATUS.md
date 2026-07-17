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
