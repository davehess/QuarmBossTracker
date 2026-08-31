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

```markdown
Update: I've now built and run this, so it's no longer unverified.

**Build** — `msbuild /m /p:Configuration=Release /p:Platform=x86 Zeal.sln`,
MSVC linker 14.44 (v143 family). `Build succeeded. 0 Warning(s) 0 Error(s)`.
The produced `Zeal.asi` is PE32/x86 as expected, and `spawn_id`, `target_id`
and `pet_id` are all present in the binary.

**Runtime** — running that build on Project Quarm, reading the pipe:

```
[PASTE the zeal-pipe-peek.js output here]
```

[If you confirmed it against a tag, say so here — e.g. "`/tag`'d the same mob
and the ZEALTAG id matched `target_id` exactly."]

Happy to gather anything else useful — a raw capture with several same-named
mobs up, or the same run against a stock build for comparison.
```
