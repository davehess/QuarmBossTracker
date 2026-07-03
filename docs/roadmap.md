# Wolf Pack roadmap — retrospective + near-term queue

> Consolidated view for resuming cold: how much of the previous backlog
> (`docs/BACKLOG.md`) actually shipped, what landed most recently, and the
> near-term queue at the bottom. This is the source content for the public
> `/roadmap` page on wolfpack.quest (`web/app/roadmap/page.tsx` +
> `web/lib/roadmapData.ts`) — that page has its own member-facing copy (plain
> language, no file paths), not a byte-for-byte mirror of this doc.

## Retrospective — `docs/BACKLOG.md` (captured 2026-06-04, last touched 2026-06-23)

Checked each tracked item against the actual codebase rather than trusting
the doc's own "✅ SHIPPED" annotations, since a month passed between that
doc's last edit and now.

**Confirmed shipped:**
- **A. Pet slot 16 → charm/pet overlay** — live pet HP wired into `_zealAbsorb`.
- **B. Resisted-spells dropdown** — expandable per-spell mob breakdown on the
  agent dashboard Info tab.
- **C. Overlays submenu expansion** — named panel-overlay toggles in the tray.
- **E. Character live-state sync** — `character_live_state` table, `/me`
  Buffs & Zone card. This became the backbone for a lot of later work (Tank
  overlay MT resolution, Extended Target, Command Center all read it).
- **G. Mimic overlay/setup overhaul** — setup page, EQ-folder detection,
  opt-in overlays, ✕ hide buttons all present.
- **H. Buff/Debuff coordination queue** — fully realized as the Buff Queue
  overlay + bot's `/api/agent/raid-buff-queue` (curse/cure tracking, HP
  slots, category gaps, tier sort). Went well beyond the original design doc
  — got an entire latency-overhaul pass this session (see below).
- **I. CH-chain tracking** — not literally the "DDR minigame" pitched in
  `docs/DESIGN-ch-chain.md`, but the CH Chain overlay (rotation order, caller
  + mana, beat countdown, slip/pivot detection) is a mature, actively-used
  feature.
- **`/who` web directory** — shipped (`web/app/who/`).
- **Supabase retention concern** — solved architecturally rather than by
  building the proposed prune job: the row-per-upload `agent_uploads` log
  (the thing that was going to need pruning) was replaced with a
  per-(character, endpoint) counter table (`agent_upload_stats`), so the
  growth problem doesn't exist anymore.

**Still open / not confirmed:**
- **D. PvP detrimental-spell assist credit** — blocked on real Quarm log
  samples for a landed debuff on an enemy player; no evidence it unblocked.
- **`/me` named-mob kill counts** — no matching component found; likely
  still queued.
- **`/raid` unified view** (`docs/raid-hub-roadmap.md`) — most of "the data
  backbone" it depends on has shipped (raid roster, live-state, buff
  categorization, DKP), but no line-by-line audit of every pitched feature
  was done here — treat that doc as still partially open.
- **Windows code-signing** — pre-staged per `docs/code-signing.md`, gated on
  SignPath Foundation approval; no evidence that landed.

**Rough hit rate: 9 of 13 tracked initiatives confirmed shipped**, one
solved differently than proposed (retention), three still open/blocked.

## Recently shipped (this work session)

In roughly chronological order — versions are exact from git history.

| Feature | Where |
|---|---|
| **[PQDI] link on parse pages** | web v1.0.168 |
| **Beastlord Warder pet damage attribution** | agent v3.1.87 — possessive-named summoned pets self-attribute without waiting for the "my leader is" declaration line |
| **Enchanter charm-break self-only detection** | agent v3.1.90 — the self-only "Your charm spell has worn off" log line (no pet name, bystanders never see it) now resolves via reverse lookup against `_activeCharms` |
| **CH-neck (Necklace of Resolution) tracker** | built (agent v3.1.86, mimic v1.3.8, bot v3.0.132) then fully reverted (agent v3.1.88, mimic v1.3.10, bot v3.0.133) per explicit call — not useful in practice |
| **Debuff/buff queue latency overhaul** | agent v3.1.89 (poll interval + cache TTL tightened) and, more importantly, v3.1.91 (root cause: the live-state heartbeat was gated behind `target_name`, so most raiders' data was never fresh at all — 0 of 30 rostered raiders had current data at time of diagnosis) |
| **CH Chain: Druid gap-fills, auto-scaling GAP SOON, muted by default** | agent v3.1.84–v3.1.85, mimic v1.3.5–v1.3.12 |
| **Tank overlay maturation** | MT focus + real hate formulas (v3.1.83/1.3.4), DS per-hit breakdown + known sources (v3.1.81/1.3.2), Rampage target HP (v3.1.93/1.3.13), invulnerability highlight generalized beyond Divine Aura to Harmshield/etc. (v3.1.95/1.3.15), Death Touch countdown (v3.1.95/1.3.15) |
| **Extended Target — three separate bugs fixed** | (1) missing `target_name`/`target_hp_pct` columns meant the overlay showed nothing — migration existed in the repo but had never actually been applied to prod; (2) HP excluded from the freshness signature meant every row froze at 100%; (3) HP-clustering ran unconditionally, splitting a single real player/pet/named-NPC into fake "★1/2"/"★2/2" duplicate rows — now scoped to only apply for genuinely ambiguous generic mob names (bot v3.0.134) |
| **Command Center overlay** | agent v3.1.96, mimic v1.4.0 — new standalone "one window" board: everything the Tank overlay resolves (boss/MT/rampage/enrage/Death Touch) plus two sections built from mining 60 days of actual guild raid chat for recurring macro patterns: a raid-wide DA/invulnerability broadcast tracker and a healer mana roster, plus Curse/Cure alerts reusing the existing buff-queue debuff tracking |

## Near-term queue

Full detail lives in `docs/mimic-1.4-roadmap.md` (Pull Tracker research
findings, Trigger Alerts onboarding design questions, UI Studio positioning
scoping, Phase B-2 per-character overlay layout, `/me` sync, UI Studio
per-character launch + previews). Condensed here:

1. **Extended Target glide animation** — mobs visually climb/drop the target
   list as `raider_count` changes (FLIP-style CSS transition), instead of
   snapping to position on repaint. Cheap, no new data, ships first.
2. **Per-character overlay position + opacity (Phase B-2)** — the existing
   per-character *visibility* profile system gets extended to also
   remember where each overlay sits and how opaque it is, per character.
   Most concretely scoped item in the queue.
3. **Sync overlay layout to `/me`** — depends on #2 shipping; read-only v1.
4. **Trigger Alerts ↔ Triggers tab + class/role-aware onboarding** — needs a
   scoping conversation before estimating.
5. **UI Studio-powered overlay positioning** + **UI Studio launch scoped to
   a character + preview generation** — both need further research; UI
   Studio edits EQ's ini layout via a different mechanism than Mimic's
   overlay windows, so this is "borrow the UX pattern," not shared code.

**Blocked, not on Mimic's critical path:** true mob-distance/ETA tracking
for the Pull Tracker needs Zeal to add position telemetry to its gauge
pipe — nothing in the current pipeline carries position for mobs OR
players (confirmed: `eqemu_npc_types.runspeed`/`walkspeed` exist, but no
location data exists anywhere, live or logged). Worth folding into the same
ask as `docs/zeal-spawn-id-request.md` whenever that conversation happens.
