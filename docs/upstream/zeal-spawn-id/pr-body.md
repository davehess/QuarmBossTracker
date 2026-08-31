### What

Implements the **pipe half of #218** ("Allow for Native Display of Zeal ID to
Target Bar + Pipe Zeal ID for overlays"). That issue asks for two things; this
is only the second one. The target-bar display is **not** included, so please
don't let it auto-close the issue — I've deliberately used `Refs` rather than
`Closes`.

Refs #218

Adds the client's own spawn id to the pipe messages that already describe an
entity. Five keys, all additive:

| Message | Key | Source |
|---|---|---|
| `raid` (type 5) | `spawn_id` | `entity->SpawnId` |
| `group` (type 6) | `spawn_id` | `member->SpawnId` |
| `player` | `spawn_id` | `get_self()->SpawnId` |
| `player` | `target_id` | `get_target()->SpawnId` |
| `player` | `pet_id` | `get_self()->ActorInfo->PetID` |

`target_id` and `pet_id` are omitted rather than zeroed when there is no target
or no pet, so a consumer tests for presence instead of a sentinel.

The diff is 14 added lines and 0 changed lines in `Zeal/named_pipe.cpp`. A
second commit documents the new fields in the README's "Zeal pipes" section and
can be dropped independently if you would rather document it elsewhere.

### Why

**This is a standing request, not a new one.** #218 (open since June 29) asks
for exactly this, and its author is running the same workaround I am: a
`/tag` hotkey to force the id into the chat log, then scraping it back out to
feed an overlay. Two people writing unrelated tools hit the same wall and built
the same rate-limited hack around it.

Worth confirming explicitly, because it is what makes that issue and this patch
the same thing: the number in their example `ZEALTAG | this | Lookout Reloen |
156` **is** `Entity::SpawnId`. `nameplate.cpp` builds the broadcast with

```cpp
int spawn_id = is_clear ? 0 : target->SpawnId;
```

which is the identical field this patch emits as `target_id`. So the workaround
in #218 becomes unnecessary the moment this lands.

A pipe consumer cannot tell two spawns of the same type apart. For mobs the
entire surface is the gauge stream — target is slot 6, pet is slot 16, each
carrying a display name and an HP per-mille value. Spawns of the same type
share a byte-identical name, and they frequently share the HP value too.

We measured this on Project Quarm. In a 71.5 second raw pipe capture spanning
four *different* `an orc warrior` spawns, all four appear as the identical
string in slot 6, and nothing in 2,386 events distinguishes them. Name-only
correlation (death boundaries, HP continuity) resolves *sequential* same-name
kills but provably cannot separate two that are alive at once — which is the
normal case for adds, pulls, and enchanter charm rotations.

The identity plainly exists in the client, and Zeal already surfaces it
elsewhere: `/tag` broadcasts carry a spawn id, and using tags as a side door we
separated ~17 simultaneous `an elder thought horror` in The Deep, every one
distinct. That confirms the spawn id is exactly the right key — but tags are
chat messages, so they are server rate limited (bursts trip "you cannot send
more messages for 32 seconds") and require a player to manually target and tag
every mob. That cannot be the mechanism for anything that wants to *track*
mobs continuously.

### Why it is cheap

Every one of these loops already holds the `Entity*` and dereferences it for
`Position` / `Heading` / `HpCurrent`, so this reads an id off an object that is
already in hand:

- no new spawn-list walk, and no extra per-frame work;
- `ActorInfo->PetID` **is** the pet's spawn id — `zone_map.cpp`
  (`add_self_pet_position_vertices`) passes it straight to `get_entity_by_id`,
  which is an O(1) bounds-checked array index;
- `NamedPipe::main_loop()` is registered with
  `callbacks->AddGeneric(...)`, which defaults to `callback_type::MainLoop`, so
  it runs on the game thread. `get_target()` is exactly as safe here as the
  `get_self()` calls beside it.

### Compatibility

Additive only. Existing consumers key on the fields they already read and
ignore unknown ones; no existing key changes shape or meaning. Nothing is
emitted that was not already being computed.

I deliberately kept the hunks purely additive — no existing line is touched,
including the repeated `Zeal::Game::get_self()` calls in the player block. Happy
to hoist a local there if you would prefer that tidied while it is open.

### Things I am happy to change

- **Key names.** `spawn_id` / `target_id` / `pet_id` mirror the field names in
  `game_structures.h`, but they are yours to name — #218 suggested `NPC_ID`,
  which I did not use only because these ids cover players and pets too, not
  just NPCs. Happy to switch to whatever you prefer.
- **Gating.** These are unconditional because the id is what makes the rest of
  the entity data addressable, but they can sit behind `pipe_verbose` (as
  `hp_current` / `zone_id` do) if you would rather keep the default payload
  fixed.
- **Scope.** If you would rather take only the raid/group lines and leave
  target/pet for a separate change, say so and I will split it.

### Testing

I want to be straight about this: **I have not been able to compile it.** The
change was written against `a5f5cbf` (1.4.5) by reading the source — field
names and offsets checked against `game_structures.h` (`SpawnId` at `0x0094`,
`ActorInfo::PetID` at `0x01C2`), signatures against `game_functions.h`, and
thread context against the callback registration — but I have no Windows/MSVC
x86 environment to produce a build in.

So please treat the diff as a proposal rather than a tested change. I can test
any build you produce against the four-simultaneous-same-name-mob repro on
Project Quarm and report back, and I will fix anything the compiler finds.

### Prior discussion

- **#218** (open, June 29) — the same request, from someone else, with the same
  `/tag` workaround. This PR is the pipe half of it.
- The Zeal community forum, 2026-07-20 ("Zeal tags exposed in Pipes") — no
  responses.

I wrote this as a diff rather than a third request because #218 has sat
unactioned for two months, and a small patch is easier to accept or decline
than a design question.

### Who this is from

Guild tooling for a Project Quarm raid guild — a companion app that reads the
Zeal pipe read-only and never writes to it. The two use cases driving it are
attributing damage to the correct charmed pet when a charmed and a hostile mob
share a name, and telling raiders which of four same-named mobs already has the
slow or tash on it.
