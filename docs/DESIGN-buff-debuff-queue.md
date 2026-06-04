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

## Open questions for sign-off
1. **Auto vs manual:** start auto-detect-only (Phase 1), or go straight to the
   shared manual+auto queue (Phase 2)? (Recommend Phase 1 first — testable
   tomorrow, then Phase 2.)
2. **Which buffs/debuffs auto-enqueue?** A curated list (Malo/Tash/Slow/CH-target
   markers) or everything that "wears off"? (Everything is noisy; recommend a
   short curated raid-debuff list, editable.)
3. **Who can resolve an item** — anyone, or only the creator/officers?
4. **Durable or ephemeral** on the bot? (Recommend ephemeral in-memory.)
5. **Need:** paste 5–10 real Quarm log lines for: a buff wearing off, a dispel,
   a curse/cure, and a death — so the detectors are exact, not guessed.
