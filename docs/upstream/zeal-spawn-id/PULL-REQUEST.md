# Upstream PR: expose spawn ids on the named pipe

Everything needed to open this on
[CoastalRedwood/Zeal](https://github.com/CoastalRedwood/Zeal). The two commits
are in `0001-*.patch` and `0002-*.patch` in this directory, based on `a5f5cbf`
(ZEAL_VERSION 1.4.5).

**To submit** (from a fork, by a human with a GitHub account on it):

```
git clone https://github.com/<you>/Zeal.git && cd Zeal
git remote add upstream https://github.com/CoastalRedwood/Zeal.git
git fetch upstream && git checkout -b pipe-spawn-id upstream/main
git am /path/to/0001-*.patch /path/to/0002-*.patch
git push -u origin pipe-spawn-id
```

Then open the PR with the title and body below.

---

## Title

```
named_pipe: emit spawn ids for raid, group, self, target and pet
```

## Body

```markdown
### What

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

The diff is 10 added lines and 0 changed lines in `Zeal/named_pipe.cpp`. A
second commit documents the new fields in the README's "Zeal pipes" section and
can be dropped independently if you would rather document it elsewhere.

### Why

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
  `game_structures.h`, but they are yours to name.
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

Posted to the Zeal community forum on 2026-07-20 ("Zeal tags exposed in
Pipes") with no responses. Bringing it here as a concrete diff instead, since
that is easier to accept or decline than a design question.

### Who this is from

Guild tooling for a Project Quarm raid guild — a companion app that reads the
Zeal pipe read-only and never writes to it. The two use cases driving it are
attributing damage to the correct charmed pet when a charmed and a hostile mob
share a name, and telling raiders which of four same-named mobs already has the
slow or tash on it.
```

---

## Notes for us (not part of the PR)

- Our own consumer changes wait until this is merged and released. The agent's
  pipe parser should treat all five keys as optional — Zeal versions without
  them will keep working, and `docs/zeal-pipe-protocol.md` needs a row per key
  once a build carrying them exists.
- `docs/zeal-tag-spawn-id-collision.md` is a **separate** upstream ask (tags are
  applied by id and ignore the name they were sent). Do not bundle them; that
  one is a bug report, this one is a feature.
- If this is declined, the fallback stays what it is today: operator-driven
  `/tag` for the few mobs that matter, layered over position/HP clustering.
