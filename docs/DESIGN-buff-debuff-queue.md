# Design — Buff / Debuff Coordination Queue (backlog H)

Status: **proposal, awaiting sign-off.** Build is ~1 day once the open questions
below are answered. This is the "keep a boss debuffed without gaps / nobody
misses a rez or cure" shared queue.

## Goal
A shared, live raid queue of *needs*: "Malo on the boss is about to drop",
"Tashan needs recast", "Bob needs a rez", "Sue is cursed → needs cure". Anyone
can push an item; items can be bumped to the top; items auto-clear when resolved.
Surfaced as a Mimic overlay so raiders act without alt-tabbing.

## Why it's two phases
The hard/valuable part is **sharing across the raid** (everyone sees the same
queue). That needs a relay. The per-player detection is easy. So:

- **Phase 1 (local, no sign-off needed):** agent detects YOUR own
  worn-off/dispel/cursed lines and shows a personal "Recast / Cure" overlay.
  Genuinely useful, zero new infra, ships behind a tray toggle.
- **Phase 2 (shared):** push detections + manual adds to the bot, fan them back
  out to every connected agent → one shared raid queue overlay.

## Auto-detection signals (agent, byte-level on the log)
Confidence-ranked. **Need a few real Quarm log lines to lock the exact regex**
(EQ wording varies by client; Quarm/Zeal may differ):

| Need | Log line (approx — CONFIRM ON QUARM) | Confidence |
|---|---|---|
| Your buff/debuff dropped | `Your <Spell> spell has worn off.` | high |
| You were dispelled | `Your <Spell> spell fades.` / dispel msg | med |
| You are cursed | curse-counter / "afflicted by" line | med |
| Boss debuff landed (for "who has it") | `<Boss> has been slain` no — the *land* msg from the caster's own log | med |
| Rez needed | death line `You have been slain by <X>` (the dead player's log) | high |

Detection only sees the **local** player's lines (same privacy model as
everything else). So "boss debuff about to drop" can only be known by the caster
of that debuff — which is correct: the mage/ench/cleric who cast Malo is the one
whose log says it wore off, and they're the one who recasts. The queue just makes
it visible to backups.

## Data shape
```
QueueItem = {
  id,                       // uuid
  guild_id,
  kind,                     // 'recast' | 'rez' | 'cure' | 'custom'
  text,                     // "Malosini on Lord Nagafen" / "Bob needs rez"
  subject,                  // optional target (boss name / player)
  spell,                    // optional spell name
  priority,                 // int; higher = top. Bumps add +10.
  created_by,               // character
  created_at, resolved_at,  // resolved_at null = open
  ttl_ms,                   // auto-expire (recasts: ~30s; rez: 5m; cure: 60s)
}
```

## Phase 2 infra (mirrors the live-state pattern we just shipped for E)
- Agent → `POST /api/agent/queue` (bearer): push new items + "resolve <id>".
- Agent ← `GET /api/agent/queue?since=<ts>` (poll every ~5s) OR piggyback on the
  existing latest-version poll response. Returns open items for the guild.
- Bot store: Supabase `raid_queue` table (or in-memory ring + 1h TTL — a shared
  scratchpad doesn't need durability). Lean toward in-memory on the bot to avoid
  RLS/migration overhead; it's ephemeral by nature.
- Mimic overlay: new `queue.html` overlay (reuse the overlay chrome + ✕ + tray
  toggle we just built in G). Rows sorted by priority desc, color by kind, a
  one-click "✓ got it" that resolves the item for everyone.

## Open questions — ALL RESOLVED 2026-08-11

1. **Auto vs manual** — OVERTAKEN BY SHIPPED CODE: auto-detection exists (the
   bot's `raid-buff-queue` — online raiders, same-zone first, tank-HP priority,
   curse-counter sort — plus Mimic's Buff queue overlay). The rez half is owned
   by `DESIGN-death-awareness-and-rez-queue.md`. Remaining build = the shared
   MANUAL layer on top ("Sue cursed", "kite help") with one-click resolve.
2. **Which auto-enqueue** — OVERTAKEN: the curated list exists bot-side
   (`_CURSE_COUNTERS` + the queue's sort rules) and is editable there.
3. **Who can resolve** — **ANYONE (Hitya, 2026-08-11).** Same philosophy as the
   Wrong-button everyone-workflow call: a wrong resolve costs one re-enqueue, a
   locked resolve costs a stale queue mid-fight.
4. **Durable or ephemeral** — **EPHEMERAL (Hitya, 2026-08-11).** In-memory ring
   on the bot, ~1h TTL, same shape as the trigger-relay ring. No table, no
   migration; a shared scratchpad has no business surviving a deploy.
5. **Real log lines** — SATISFIED: detectors ground in `eqemu_spells`
   `cast_on_you/cast_on_other/spell_fades` text now, not guesses.
