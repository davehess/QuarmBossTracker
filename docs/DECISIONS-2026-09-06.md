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

## Target Info went blank on debuffs, and 0 was the reason (live, mid-fight)

Hitya, on Kaas Thox Xi Aten Ha Ra in Vex Thal: *"not seeing any of this
target's debuffs at all during this fight"* — Target Info showed three, all
"fell off", while Extended Target showed eight with live timers.

**The server was fine.** 129 `buff_casts` rows on that exact target name in 24
minutes, 17 distinct debuffs, still arriving as we looked. Not shed, not a
keying mismatch, not the ingest.

**`target_id = 0` is what did it.** Zeal reports a target id of **0** when
there is no target — it does not omit the field, which is what
`apps/mimic/main.js` still says it does — and `Number.isFinite(0)` is true, so
the id was stamped onto the row as a real spawn. `_idScopeKeep` only treated
`null` as unproven, so a requester whose Zeal DID send a real id evaluated
`0 === 592` and dropped every one of those rows.

The measurement, taken live on that boss:

| `target_id` | rows | observers |
|---|---|---|
| **0** | 111 | 13 |
| 592 | 16 | 1 |
| 153 | 7 | 1 |

The three debuffs left on screen — Boil Blood, Ignite Blood, Splurt — are
exactly the spells carried by the id-matching rows. Extended Target sends no
spawn id, so it never reaches this filter, which is why the same data rendered
correctly one overlay over.

**Blast radius was one person.** In the trailing hour exactly one client sent
real ids (Melting), so only that raider saw it. That is not luck, it is the
leading edge: every raider who updates Zeal walks into it next.

**Fixed in `_idScopeKeep` (bot 3.1.123): 0 is unproven on BOTH sides.** Done in
the read path rather than the write path deliberately — it repairs the 111 rows
already stored, and needs no Mimic update.

⚠ **This overrode a test that asserted the opposite** ("spawn id 0 is a real
slot", guarding a real falsy-zero trap). The premise was wrong, and the live
data is what settles it: 13 observers wrote ONLY 0, and the one spawn-id-capable
client wrote 0 on 169 observations against 51 real ids. Nobody targets slot 0
that often. The guard is an explicit `Number(v) === 0`, never `!v`, so the trap
that test feared still cannot creep back in.

**Two follow-ups, neither shipped:**
- `apps/mimic/main.js` should map a pipe `target_id` of 0 to null at the edge,
  and its comment claiming the pipe OMITS the field is wrong — Zeal sends 0.
- The agent's `_provableTargetId` should refuse 0 for the same reason, so we
  stop writing rows that need the read-side guard at all.
