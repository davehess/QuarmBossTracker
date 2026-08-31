# Zeal: expose spawn ids on the named pipe — the EVIDENCE

**Status: superseded as an ASK — the code is written.** Hitya, 2026-08-31:
*"I think we should prepare the pull request for Zeal to include spawn id in
pipes. It's not happening otherwise."* Two softer approaches (a forum post on
2026-07-20, and this document as a would-be issue) produced no response, so the
ask is now a concrete diff.

👉 **The submittable PR lives in `docs/upstream/zeal-spawn-id/`** — two
`git am`-able patches against Zeal `a5f5cbf` (1.4.5) plus the PR title, body and
push instructions. Read that first. This file is kept for the MEASUREMENTS the
PR body summarises, which are the actual argument and are not repeated in full
there.

⚠ **The ask below was aimed at the GAUGES, and that was wrong.** The gauges are
a stringly-typed `GetGauge(id, text)` channel with no room for structured
fields, which is probably why it got no traction. The patch we are sending
targets the **entity** surface instead: the raid/group loops already hold the
`Entity*` and dereference it for `Position`/`Heading`, so the id is 10 added
lines. The gauge proposal is retained below only as the rejected alternative.

> **See also `zeal-tag-spawn-id-collision.md`** — a separate upstream ask, and a
> BUG rather than a feature (Zeal applies a received tag by id alone and ignores
> the name it was sent, so tags land on unrelated mobs across zones). Do not
> bundle the two.

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

The client already tracks a unique spawn id for every entity (`Entity.SpawnId`,
offset `0x0094`), and the pipe's raid (type 5) and group (type 6) loops ALREADY
hold that exact `Entity*` and dereference it for `Position`/`Heading`/
`HpCurrent`. **The request is to emit that id** — additive and
backward-compatible. With it, a consumer can key on a stable identity instead
of guessing from name + HP.

## Why we are asking again, with evidence (2026-08-07)

**We built the workaround, it works, and it cannot scale. That is the argument.**

Zeal's own `/tag` broadcasts carry a spawn id (`ZEALTAG | <text> | <mob name> |
<spawn id>`), so we used tags as a side door to the identity the pipe withholds.
Measured live on Project Quarm:

- **It proves spawn id is the right key.** In The Deep, one zone held **~17
  simultaneous `an elder thought horror`**, ~11 `a horror guard`, ~9 `a thought
  horror evoker`. Every one carried a distinct spawn id, and every one was
  separable. Nothing else in the client's external surface can do this — the
  gauges give name + HP‰, and seventeen mobs at full health are seventeen
  identical strings.
- **It cannot be the answer.** Getting those ids required a player to manually
  target and tag **every single mob**, one at a time. Tags are chat messages, so
  they are rate limited by the server: bursts trip *"You are currently rate
  limited, you cannot send more messages for 32 seconds."* And Zeal draws the
  nameplate arrow whether or not the send succeeded, so a raider cannot even
  tell which of their marks actually went out.

So the shape of the problem is now precisely known. The identity exists, it is
exactly what consumers need, and the only route to it is a manual, rate-limited,
human-driven one that no raid can sustain while actually raiding. A tool that
wants to *track* mobs continuously — which is the entire point — needs the id on
the wire, not typed in by hand.

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

## What we actually implemented (2026-08-31)

⚠ **This is the section that matches the patch.** Everything above is the
argument; everything below "Secondary" is the rejected alternative. The shipped
diff is 10 added lines and 0 changed lines in `Zeal/named_pipe.cpp`:

| Message | Key | Source |
|---|---|---|
| `raid` (type 5) | `spawn_id` | `entity->SpawnId` |
| `group` (type 6) | `spawn_id` | `member->SpawnId` |
| `player` (type 3) | `spawn_id` | `get_self()->SpawnId` |
| `player` (type 3) | `target_id` | `get_target()->SpawnId` |
| `player` (type 3) | `pet_id` | `get_self()->ActorInfo->PetID` |

Two deliberate departures from the earlier sketch above:

- **Flat scalars, not a `target: {id, name}` object.** `player_data` is flat
  (`zone`, `location`, `heading`, `autoattack`), so `target_id` matches the
  surrounding style. The NAME is deliberately left out: the gauge stream already
  carries the target's display name in slot 6, and `Entity::Name` is the
  *internal* form (`an_orc_warrior00`), so emitting it would put two different
  spellings of the same mob on the wire. The id is the only missing piece.
- **`pet_id` needs no entity lookup at all.** `ActorInfo->PetID` IS the pet's
  spawn id — `zone_map.cpp` passes it straight to `get_entity_by_id`, which is
  an O(1) bounds-checked array index. So the pet line costs a struct read.

`target_id` and `pet_id` are OMITTED when there is no target / no pet, so a
consumer tests for presence rather than for a `0`/`-1` sentinel.

### ⚠ NOT in the patch: pet position

The third item in the original sketch — emitting the pet's `loc`/`heading` —
is **not** in this PR and remains an open ask. Zeal already resolves the pet
every frame to draw the map arrow (`zone_map.cpp`
`add_self_pet_position_vertices`), but the pipe emits `loc` only for raid
member, group member and self, so a pet-tanked mob is unplaceable for a
companion tool while being plainly visible on the user's own map.

It was left out on purpose: it is a different kind of change (new data, not an
id the loop already holds), and bundling it would turn a 10-line diff that is
easy to say yes to into a design conversation. Raise it separately if this one
lands.

### Secondary: the gauge slots

If the entity surface is not workable, the same id on the **target (slot 6)** and
**pet (slot 16)** gauge entries would also serve. Suggested key: `spawn_id` (a
non-negative integer; omit or `0`/`-1` when there is no current target/pet). We
list this second deliberately — the gauges are a stringly-typed
`GetGauge(id, text)` channel with no room for structured fields, which is likely
why this request got no traction the first time it was made.

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

## Implementation sketch for the GAUGE path (rejected — kept for the record)

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

## How we routed it, and why that changed (2026-08-31)

This section used to read **"issue first, PR second"** — the reasoning being
that a pipe-protocol surface is the maintainers' to shape, and a cold PR
pre-decides the key names, any version bump, and whether it sits behind a
config toggle.

That reasoning was sound and it still is, but it assumed someone would answer.
Two attempts got no response: the forum post (2026-07-20) and this document,
which was never filed. So the calculus flipped — **a small diff is now the
cheaper thing to hand a maintainer than a design question.** A PR costs them a
review they can decline in one line; an issue costs them a conversation.

What we kept from the etiquette, because it still matters:

- the PR body **explicitly offers** to rename the keys, to gate them behind
  `pipe_verbose`, or to split target/pet out of the raid/group change;
- it **states plainly that we could not compile it** — no Windows/MSVC x86
  environment here — and offers to test any build they produce against the
  four-simultaneous-same-name-mob repro;
- it links the prior forum post for continuity;
- it is filed by the guild lead from their own account. This repo's tooling only
  prepares the material.

## Contact

Filed on behalf of the Wolf Pack guild tooling for Project Quarm (a Mimic/agent
companion that reads the Zeal pipe read-only and never writes to it). Happy to
test a build against the four-same-name-mob repro on request.
