# Decisions — 2026-08-24

Previous file: `DECISIONS-2026-08-21.md`.

## Mimic defends the chosen resolution against the client (#156, Hitya)

**The call.** *"make sure we're resetting the height and width each time the
game tries to overwrite it into the crapped 4:3 formats it expects."*

**The problem.** The old EQ client owns `eqclient.ini` and rewrites its
`[VideoMode]` block — on exit, and from the first-run display dialog. A Steam
Deck set to its native **1280×800** (or the **1440×900** supersample
quarm.guide's Bonus Step 7 recommends) comes back as **640×480 / 800×600 /
1024×768**, and every session after that is letterboxed until the player edits
the file by hand again. It is not a one-time setup problem; the client re-does
it every time.

**Where it landed.** `apps/mimic/resolutionLock.js` (new) + wiring in
`apps/mimic/main.js`, tests in `test/resolution-lock.test.js`. Indexed in
`docs/HOW-ITS-BUILT.md`.

### The decisions inside it

**Off by default, and the Deck value is a SUGGESTION not a switch.**
`cfg.resolutionLock = { enabled, width, height }` ships `enabled: false`.
Detecting a Deck fills in 1280×800 when the user leaves the numbers blank —
it never turns the lock on. Silently pinning somebody's resolution is the same
class of surprise we are fixing, pointed the other way. Off-Deck, an enabled
lock with no numbers stays inert rather than guessing.

**Timing is the whole design: every write is gated on EQ being DOWN.** EQ holds
`eqclient.ini` open and flushes it *on exit*, so a write landing mid-session is
overwritten anyway **and** risks a torn file — two writers, one file, and a
half-written `eqclient.ini` is a client that will not start. The three live
triggers are the running→stopped edge (+2.5s so the client's own flush lands
first), an `fs.watch` on the EQ folder, and a settings save; all three re-check
`_isEqRunning()` before touching anything.

**A no-op must not write.** An already-correct file is returned byte-identical
with `changed: false` and never rewritten — a pointless rewrite churns the
mtime and, through our own `fs.watch`, feeds straight back as another change
event. Pinned by test.

**Regex-level edits, never a parse-and-re-serialize.** We rewrite only `Width=`
and `Height=`, only inside `[VideoMode]`, preserving CRLF and every untouched
byte. We never invent the section or its keys: if the client has not written
the block there is no user choice to defend, and guessing at a file format we
only half-understand is how you brick someone's client. One-time `.mimic-bak`
(never overwritten — it is the pristine pre-Mimic copy), then tmp + rename.

**Watcher is Linux-only for now.** Windows users manage resolution in-client
and their behaviour is deliberately unchanged. The module itself is
platform-agnostic, so graduating it is a wiring change, not a rewrite.

**No launch-time trigger, because there is no launcher.** Mimic does not start
EverQuest today. The hook is documented in the module header for whoever adds
one — enforce immediately before spawning the client.

---

## Open — read this first

| Item | State |
|---|---|
| Resolution lock UI | The config key is live and readable/writable through the existing `get-config` / `save-config` IPC, but no Settings card exposes it yet — turning it on needs a hand-edited config. A Settings control (with the Deck suggestion prefilled) is the next step. |
| Resolution lock on Windows | Watcher is Linux-gated. Whether the Windows fleet wants this at all is Hitya's call — Windows users have an in-client display dialog that mostly sticks. |
| 1280×800 vs 1440×900 as the Deck suggestion | Shipped as 1280×800 (native panel) per tonight's call. quarm.guide's Bonus Step 7 recommends 1440×900, and UI Studio offers both presets — worth a second look once a Deck tester has run both. |
