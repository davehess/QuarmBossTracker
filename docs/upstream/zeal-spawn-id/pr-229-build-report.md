# Build + runtime report for PR #229

Post as a comment on https://github.com/CoastalRedwood/Zeal/pull/229 once the
runtime numbers are filled in. **Fill the bracketed bits from
`scripts/zeal-pipe-peek.js` output before posting — do not post placeholders.**

Build facts already confirmed (2026-08-31, from the produced binary, not just
the build log):

- `Build succeeded. 0 Warning(s) 0 Error(s)`
- artifact is **PE32 / Intel 80386** — correct 32-bit x86
- `spawn_id`, `target_id`, `pet_id` all present as string literals in the
  compiled `Zeal.asi` (`autoattack` / `heading` checked alongside as a control)
- linker **14.44**, i.e. the v143 toolset family
- version stamped `1.4.5 (pr229)` via `/p:zeal_build_version=pr229`

---

⚠ **The live run found a real bug and the patch changed.** With no pet up the
build emitted `pet_id: -1`, contradicting the body's promise that the key is
omitted rather than sentinel-valued. `ActorInfo::PetID` is a SHORT holding -1
(not 0) for "no pet", and the guard tested truthiness. Now range checked
(`PetID > 0`). `zone_map.cpp` uses the same truthiness test but survives it,
because `get_entity_by_id()` rejects a negative id downstream — the pipe line
had no such backstop. So the branch must be REBUILT and force-pushed before
this comment is posted, or it describes code that is no longer there.

---

```markdown
Update: I've built and run this on Project Quarm, so it is no longer unverified.

I also found a bug doing so, and have pushed the fix: with no pet up the first
version emitted `pet_id: -1`. `ActorInfo::PetID` is a SHORT that holds -1 rather
than 0 for "no pet", so a truthiness guard let the sentinel through and broke the
"omitted, never sentinel-valued" contract this PR describes. It is now
`PetID > 0`. (`zone_map.cpp` uses the same truthiness test and is fine, because
`get_entity_by_id()` rejects negative ids downstream; the pipe had no such
backstop. Reading that code is what made the original guard look idiomatic.)

**Build** — `msbuild /m /p:Configuration=Release /p:Platform=x86 Zeal.sln`,
MSVC linker 14.44 (v143 family). `Build succeeded. 0 Warning(s) 0 Error(s)`.
The resulting `Zeal.asi` is PE32/x86 and contains all three new keys.

**Runtime** — all five keys observed on a live client:

| key | observed |
|---|---|
| `player.spawn_id` | 2354 |
| `player.target_id` | 3385 |
| `player.pet_id` | 3005 with a pet; key absent with none (verified on the rebuilt client) |
| `raid[].spawn_id` | 2533, 1027 (2 members) |
| `group[].spawn_id` | 3385 |

**Cross-checked against `/tag`**, which is the part that matters for #218 —
the tag broadcast and the pipe agree on the same mob, from independent code
paths:

```
ZEALTAG | hawknizzle | Hawkner | 3385     ->  target_id 3385, group[] 3385
ZEALTAG | canoopp | Canopy | 2354         ->  player.spawn_id 2354
ZEALTAG | hi | Jayson Bri`Tian | 10       ->  target_id 10
```

The raid values are internally consistent too: `player.spawn_id` 1027 appeared
in its own `raid[]` list, and targeting the other raid member gave
`target_id` 2533, also present in that list.

So the id on the pipe is the same id `/tag` already exposes — which is exactly
what #218 asks for, without the hotkey and the chat rate limit.

Happy to gather more if useful: a capture with several same-named mobs up, or
the same run against a stock build for comparison.
```
