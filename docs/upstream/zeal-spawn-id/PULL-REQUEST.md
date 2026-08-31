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

## ⚠ Read first: this implements an EXISTING open issue

[#218](https://github.com/CoastalRedwood/Zeal/issues/218) (open since
2026-06-29, `derekwolfson`) asks for exactly this, and its author is running the
same `/tag` hotkey workaround we are. Verified same field, not merely similar:
the `156` in their `ZEALTAG | this | Lookout Reloen | 156` is `Entity::SpawnId`
(`nameplate.cpp:960`), which is what the patch emits as `target_id`.

That changes the submission in three ways, all already reflected in the body:

- it opens by naming #218 and uses **`Refs #218`, never `Closes`** — #218 also
  asks for a native target-bar display, which we do NOT implement, and
  auto-closing it would drop that half;
- the "why" leads with two independent tool authors hitting the same wall,
  which is a stronger argument than ours alone;
- after the PR is open, post `issue-218-comment.md` on #218 with the PR number
  filled in. That links the two and notifies its author.

## Title and body

⚠ ONE COPY of each, so they cannot drift apart:

- **`pr-title.txt`** — paste into the PR title field.
- **`pr-body.md`** — paste the whole file into the PR description field.

`test/upstream-zeal-pr.test.js` checks `pr-body.md` against the patch: same set
of keys, the line count the diff actually has, purely additive, and the
not-compiled note still present.

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
