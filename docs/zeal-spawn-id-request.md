# Feature request for Zeal: expose `spawn_id` on the named-pipe target/pet gauges

**Status:** draft to send upstream to [CoastalRedwood/Zeal](https://github.com/CoastalRedwood/Zeal).
This is not a Wolf Pack change — it documents the one upstream addition that
would unblock same-name mob identification for any companion tool reading
Zeal's named pipe. Keep it here so the ask (and the reasoning) survives.

---

## Summary

The named pipe (`\\.\pipe\zeal_<PID>`) is the only first-party way for an
external companion app to read live game state. For mobs, the entire surface is
the **gauge (type 2)** stream: target = slot 6, pet = slot 16, each carrying a
display **name** and an **HP per-mille** value — and nothing else. Because EQ
mobs of the same type share an identical display name (`an orc warrior`,
`a cliff golem`, …), two or more of them are **completely indistinguishable**
to a pipe consumer: same string, frequently the same HP%, no handle to tell
them apart.

The client already tracks a unique spawn id for every entity (`Spawn->SpawnID`),
and Zeal already resolves the target/pet to those `Spawn` objects to populate
the gauge. **The request is to add that existing id to the gauge payload** — an
additive, backward-compatible field. With it, a consumer can key on a stable
identity instead of guessing from name + HP.

## What the pipe sends today

A gauge object (decoded), abbreviated to the mob-relevant slots:

```json
{
  "type": 2,
  "character": "Hopeya",
  "data": [
    { "type": 1,  "text": "Hopeya",        "value": 999 },
    { "type": 6,  "text": "an orc warrior", "value": 1000 },
    { "type": 16, "text": "an orc warrior", "value": 874 }
  ]
}
```

- `type` (inner) = gauge slot: **1 = self, 6 = current target, 16 = pet**.
- `value` = HP per-mille (0–1000).
- `text` = display name.

That is the *complete* mob description available over the pipe. There is no
level, body type, location, or id. (Rich per-entity data — name, level, class,
loc, heading — is serialized only for **raid (5)** and **group (6)**, i.e. your
guildmates, never for arbitrary NPCs.)

## The gap (reproduced from a live capture)

A 71.5 s raw-pipe capture on Project Quarm, fighting/charming four *different*
`an orc warrior` spawns over the window:

- All four appear as the byte-identical string `"an orc warrior"` in slot 6.
- No field anywhere in 2,386 events distinguishes them — no id, no per-spawn
  tag (in-client nameplate tags do **not** serialize to the pipe).
- HP per-mille is the only varying signal, and it routinely collides (multiple
  spawns sitting at full health), so it cannot stand in for identity.

Consumers are left with name-only correlation heuristics (death-boundary
segmentation, HP-continuity matching) that work for *sequential* kills but
**cannot** disambiguate same-name mobs that are alive simultaneously — exactly
the case for enchanter charm rotations, adds, and pulls.

## Proposed change

Add the spawn id Zeal already has to the **target (slot 6)** and **pet
(slot 16)** gauge entries. Suggested key: `spawn_id` (a non-negative integer;
omit or `0`/`-1` when there is no current target/pet).

```json
{
  "type": 2,
  "character": "Hopeya",
  "data": [
    { "type": 1,  "text": "Hopeya",         "value": 999 },
    { "type": 6,  "text": "an orc warrior", "value": 1000, "spawn_id": 14823 },
    { "type": 16, "text": "an orc warrior", "value": 874,  "spawn_id": 14911 }
  ]
}
```

That single field collapses every consumer-side disambiguation heuristic into a
trivial exact key, and lets a charmed pet be told apart from a same-name mob
you're fighting even when both read `an orc warrior`.

### Why this is low-risk

- **Additive only.** Existing consumers parse `data` by inner `type` and read
  `text`/`value`; an extra key is silently ignored. No existing field changes
  shape or meaning, so nothing breaks.
- **No new walk / no new cost.** Zeal already holds the `Spawn*` it used to
  fill the gauge; this reads an id off an object it already has — no spawn-list
  iteration, no extra per-frame work.
- **Scoped to two slots.** Only target and pet need it for the disambiguation
  case, so the change is confined to where those gauges are serialized.

## Alternatives considered (and why they fall short)

- **Consumer-side correlation** (name + HP‰ + damage epochs + death lines):
  resolves sequential same-name kills, but provably cannot separate ≥2
  same-name spawns alive at once — there is no information in the stream to do
  it with.
- **Companion-side memory reader** to walk the spawn list ourselves: duplicates
  what Zeal already does, breaks on every client patch, and crosses the
  third-party-injection line we don't want to cross. The id lives in Zeal; the
  clean place to expose it is Zeal.

## Optional, larger ask (separate, lower priority)

A new pipe message that serializes the **nearby spawn list** (per spawn:
`spawn_id`, `name`, `level`, `type`, `loc`, `hp_pct`) would let companion tools
build a true zone/threat model rather than only the current target. We
understand that's a bigger change; the `spawn_id`-on-gauges ask above is the
minimal unblock and stands on its own.

## Motivating use cases (the guild's own words)

1. **Charm attribution.** Differentiate the mob we are *currently charming*
   from same-named mobs in the fight, so damage attributes to the correct
   `/pet` leader. Today a charmed `an orc warrior` and a hostile
   `an orc warrior` are the same string on the pipe.
2. **Debuff QoL for raiders.** Differentiate same-named mobs while debuffing —
   "which of the four crypt guardians has the slow/tash on it" — instead of
   the honest-but-unhelpful "on one of these 4" our overlay shows today.

## Supporting observation: Zeal tags prove the identity exists

Zeal's in-client tag feature targets exactly **one mob at a time** among
same-named spawns — which demonstrates Zeal already tracks a per-spawn
identity in memory. We verified by uniquely tagging several identically-named
mobs while exporting the verbose pipe: **tag state does not serialize to the
pipe** (consistent with the capture above). The ask is only to expose the id
that tagging demonstrably already keys on.

## Prior outreach

Posted to the Zeal community forum on 2026-07-20 ("Zeal tags exposed in
Pipes") — no responses. Filing on the GitHub repo instead, where the
implementation context below is actionable by maintainers; the issue should
link the forum post for continuity.

## Implementation sketch (from reading upstream `main`, 2026-07-31)

Grounding for the "additive, low-risk" claim — the change is one loop in
`Zeal/named_pipe.cpp`, `NamedPipe::main_loop()`:

```cpp
nlohmann::json gauge_array = nlohmann::json::array();
for (auto &[id, name] : GaugeNames) {
  nlohmann::json gauge_data = nlohmann::json::object();
  std::string text;
  int val = ZealService::get_instance()->labels_hook->GetGauge(id, text);
  gauge_data["type"] = id;
  gauge_data["text"] = text;
  gauge_data["value"] = val;
  gauge_array.push_back(gauge_data);
}
```

For `id == 6` (target) and `id == 16` (pet), the entity is already resolved a
call away (that's how `GetGauge` computes the HP text/value) — so the addition
is conditionally attaching `gauge_data["spawn_id"]` from the same `Spawn` the
gauge already reads, however the maintainers prefer to source it (directly in
the loop, or by widening `GetGauge`'s signature). No new walk, no per-frame
cost, no existing key changes shape.

## How we intend to route this (etiquette)

**Issue first, PR second.** This is a pipe-protocol surface — the maintainers
may prefer a different key name, a protocol version bump, or a config toggle,
and a cold PR would pre-decide all three. The issue carries this document's
summary + the capture evidence + the implementation sketch, and explicitly
offers: (a) to submit the PR ourselves if the approach is blessed, and (b) to
test any build against the four-same-name-mob repro. Filed by the guild lead
from their own account; this repo's tooling only prepares the material.

## Contact

Filed on behalf of the Wolf Pack guild tooling for Project Quarm (a Mimic/agent
companion that reads the Zeal pipe read-only and never writes to it). Happy to
test a build against the four-same-name-mob repro on request.
