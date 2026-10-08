# Zeal PR draft — put the attack-recovery gauge on the named pipe

*Drafted 2026-09-24 against Zeal `main`. Not compiled here (a cloud session has
no MSVC) — build it once locally before opening the PR. Same route as #229 and
the target-of-target draft (`docs/zeal-tot-pipe-request.md`): the guild lead
opens it under their own GitHub account.*

## Why we want it

The guild lead, 2026-09-24, on the Me overlay's HUD: *"Nillipuss is able to
provide server tick counters and melee delay timers, and I would like to see
those as well."*

Nillipuss is a UI skin, and it gets both from Zeal's own gauges:

| Gauge | What it is | On the pipe? |
|---|---|---|
| 24 `ServerTick` | time to the next server tick | **yes** — the HUD reads it (agent 3.7.5) |
| 34 attack recovery | time until your next melee swing | **no** |
| 35 AA exp per hour | | no |

`Zeal/labels.cpp` computes gauge 34 in `get_attack_timer_gauge()` (primary
weapon delay, or hand-to-hand, or the ranged item after a ranged attack, run
through `ModifyAttackSpeed` so haste counts). The named pipe emits a gauge only
if its id is in `GaugeNames` in `Zeal/named_pipe.cpp`, and that map stops at 33.
So the number exists, is drawn in-game, and never reaches a pipe reader.

Without it the agent **learns** the swing timer from your own log lines (agent
3.7.5): swings that land together are one round, round-to-round is the delay.
The log is read every 500 ms and stamped to the second, so that is about ±0.5 s
and the HUD marks it "~". With gauge 34 it would be exact, and the agent
already prefers 34 the moment a build sends it — no agent change needed.

## The patch

`Zeal/named_pipe.cpp`, in `GaugeNames`:

```diff
     {32, "Spell6Recast"},
-    {33, "Spell6Recast"},
+    {33, "Spell7Recast"},
+    {34, "AttackRecovery"},
+    {35, "AltExpPerHR"},
 };
```

That is the whole change. The pipe loop already calls
`labels_hook->GetGauge(id, text)` for every entry, and `GetGaugeFromEq` already
answers 34 and 35. The `33` line is an existing typo (two entries named
`Spell6Recast`); fixing it changes only the name string, which the pipe does not
send.

## PR title

`named_pipe: emit the attack recovery and AA/hr gauges`

## PR body (paste as-is)

`GaugeNames` in `named_pipe.cpp` stops at 33, so gauge 34 (attack recovery,
`get_attack_timer_gauge`) and gauge 35 (AA exp per hour) never reach a pipe
reader, although both are computed and drawn in game. This adds them to the
map; no other code changes, since the pipe loop already asks `GetGauge` for
every entry.

Also renames the second `Spell6Recast` entry (id 33) to `Spell7Recast`. The
name is not sent on the pipe, so this changes nothing for readers.

Test plan: attach any pipe reader, turn on auto attack, and watch gauge 34 fall
from 1000 to 0 once per swing; gauge 35 matches the AA/hr readout.

## After it merges

Nothing to change in the agent: `_meSwingState` switches to gauge 34 on sight
(`source: 'zeal'`, `est: false`) and the "~" drops off the HUD. Only the fleet
has to update Zeal.
