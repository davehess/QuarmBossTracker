# Decisions — 2026-09-06

## A trigger placeholder only resolves if its capture group ALWAYS participates

Hitya, mid-raid: *"this one trigger is showing {tank} instead of the tank's name
on the overlay. what should the syntax be?"*

**The syntax was never wrong — the capture was conditional.** The old pattern:

```
(?:(?<tank>\w+) feels the watchful eyes of the gods upon them|You feel the watchful eyes of the gods upon you)\.
```

Two branches, and `tank` lives in only the FIRST. When the self-cast line
matched ("You feel…") the group did not participate, so `m.groups.tank` was
undefined. `_buildCaptureBag` only copies groups that are non-null, and
`_expandTemplate` leaves an unresolved token **exactly as written** — by design,
so literal braces in a callout survive. Hence a literal `{tank}` on the overlay,
and "D I landed on open-brace tank" out of TTS.

**The fix is one group over both wordings, not a second placeholder:**

```
^\[.+?\]\s+(?<tank>\w+) feels? the watchful eyes of the gods upon (?:them|you)\.
```

`feels?` covers "feels"/"feel" and `(?:them|you)` covers the tail, so the ONE
`tank` group captures on both lines — the name when it is someone else, the
literal word **You** when it is you, which reads correctly in both surfaces
("D.I. ✓ You"). Verified against the real spell text: `eqemu_spells` 1546,
`cast_on_other` = "feels the watchful eyes of the gods upon them.",
`cast_on_you` = "You feel the watchful eyes of the gods upon you."

⚠ **Duplicate named groups are NOT an option** — `(?<tank>…)|(?<tank>…)` is a
SyntaxError on the Node the fleet runs. One group covering both wordings is the
only shape that works.

**Also anchored past the timestamp** (`^\[.+?\]\s+`, the `TIMESTAMP_PREFIX`
convention in `web/lib/triggerPattern.ts`). The negative tests found the old
unanchored pattern fired on a guild-chat line QUOTING the message — a raider
pasting "You feel the watchful eyes of the gods upon you." set off everyone's
D.I. callout. Anchoring makes the message have to START with the name.

### The general rule, for the next one

A `{placeholder}` renders literally whenever its group did not participate in
the match. Two ways that happens, and the second is the sneaky one:
1. no group of that name exists in the pattern at all;
2. the group sits inside ONE branch of an alternation.

An alternation that does not contain the group (a damage-number choice, a
list of spell names inside the group) is fine. Check whether the group is on
every path, not whether the pattern has a `|`.

## Two more found by the same sweep — NOT changed, awaiting a word

A sweep of all 120 guild triggers for unresolvable placeholders flagged five;
three were benign (the alternation does not touch the captured group:
"Death touch — countdown", "AOE — dodge", "Resisted (your cast)"). Two are real
and are left alone because only the D.I. row was asked for, and both would be
live edits during a raid:

- **`Carnage` (enabled)** — overlay text is `Carnage: >>> ${name}` and the
  pattern is the bare string `prepares for carnage!` with **no capture group at
  all**, so it has always rendered `${name}` literally. Fix, same shape as
  above, against `eqemu_spells` 2158:
  `^\[.+?\]\s+(?<name>[\w'` -]+?) prepares for carnage!`
- **`Copied Carnage` (enabled)** — pattern `You prepare for carnage!` but the
  real `cast_on_you` is **"You prepare for carnage."** with a PERIOD. The `!`
  cannot match, so this trigger has never fired. It is the self-side of the pair
  above, which is why nobody noticed: the other one fires and shows `${name}`.

Both are one-field updates whenever Hitya wants them.

## Note — the D.I. row was edited during a raid, deliberately

`guild_triggers` is a database row, not a deploy: `_guildTriggersFor` reads
Supabase live and the fleet picks it up on the ~2-minute poll, so no restart and
no push. The raid-night freeze covers pushes to `main` (which redeploy Railway
and Vercel); it does not cover this. **The doc you are reading was committed
during the freeze and pushed after it lifted at 00:30 ET.**
