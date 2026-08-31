Post this as a comment on
[#218](https://github.com/CoastalRedwood/Zeal/issues/218) **after** the PR is
open, with the PR number filled in. It links the two, notifies `derekwolfson`,
and makes clear we are not trying to take over their request.

---

```markdown
I've opened a PR for the pipe half of this: #<PR NUMBER>.

It adds `spawn_id` to the raid and group messages and `spawn_id` / `target_id` /
`pet_id` to the player message — 10 added lines, nothing existing changed. Your
`ZEALTAG | this | Lookout Reloen | 156` number is `Entity::SpawnId`
(`nameplate.cpp` builds it with `int spawn_id = is_clear ? 0 : target->SpawnId`),
and `target_id` is that same field, so it should drop straight into your overlay
and let you retire the tag-hotkey workaround. I've been running the same hack,
which is why I went looking for this issue.

I deliberately used `Refs` rather than `Closes` because I've only done half of
what you asked — the native target-bar display isn't in there, so this issue
should stay open for that part.

I have no Windows/MSVC setup to build it in, so the diff is unverified beyond
reading the source. If you can build it, I'd value a second pair of eyes.
```
