# PvP Capture Audit — brief for a Claude instance pointed at an EQ log folder

**Goal:** A player's `eqlog_*_pq.proj.txt` (≈2.25 GB) did **not** surface all of
their PvP kills, nor the PvP deaths their attacking contributed to. Find out
*why*, and produce the complete list the tracker missed.

You have been pointed at the folder that contains the EverQuest (Project Quarm)
log file(s). Everything below is what you need — no repo access required.

---

## TL;DR — just run this

A ready-made, zero-dependency, streaming auditor lives next to this file at
`scripts/pvp-audit.js` (copy it into the log folder if needed — it has no repo
dependencies):

```bash
node pvp-audit.js .  YourCharacterName --json pvp-findings.json
```

It streams the files (safe for multi-GB logs) and prints:
- **CAPTURED** — kill/death lines the tracker's regexes match (would be uploaded).
- **MISSED** — lines that clearly *are* PvP kills but **fail** the tracker's
  regexes, grouped by reason. **This is the capture gap.**
- **ASSISTS** — players this character was damaging who died within N seconds,
  where the killing blow was credited to someone else (un-credited assists).

Then read the report and write up: (a) the gap's root cause, (b) the full list of
missed kills/assists, (c) which are recoverable and how.

---

## How the tracker detects PvP today (so you can see what it misses)

The `wolfpack-logsync` agent recognizes PvP **only** via these line shapes, in
both a god-broadcast wrapper and a bare `[PVP]`-channel form:

```
[ts] PVP Druzzil Ro BROADCASTS, '<Name> of <Guild> has been killed in combat by <Name> of <Guild> in <Zone>!'
[ts] PVP Druzzil Ro BROADCASTS, '<Name> of <Guild> has killed <Name> of <Guild> in <Zone>!'
[ts] PVP Druzzil Ro BROADCASTS, '<Name> of <Guild> has died to <Mob> in combat in <Zone>!'
[ts] [PVP] <Name> of <Guild> has been killed in combat by <Name> of <Guild> in <Zone>!   (bare form)
```

The exact regexes (verbatim from the agent) are embedded at the top of
`pvp-audit.js`.

### The two structural blind spots — check these first

1. **Unguilded participants are dropped.** Every pattern hard-requires
   `<Name> of <Guild>`. If the killer **or** the victim has no guild, the line
   has no ` of <…>` segment for that side and **no pattern matches** → the kill
   is silently lost. On a server with many unguilded/solo PvPers this is usually
   the dominant miss. The auditor labels these explicitly.

2. **Assists are invisible.** The broadcast names **only the killing blow**. If
   this character damaged a victim who was then finished by someone else (or by a
   mob, or a fall), there is **no broadcast crediting them** — and the agent does
   **not** mine the player's own combat lines (`You crush X for N…`) for PvP
   credit. The auditor reconstructs these by correlating the player's outbound
   damage with the victim's death timestamp.

### Two operational reasons capture can also be incomplete

3. **Live tailing only sees new lines.** The agent tails from the *end* of the
   file. Anything already in a 2.25 GB historical log was never live-captured; it
   only enters the system through a `--since <ISO>` backfill run. If no backfill
   was run over this log, all of its history is missing regardless of regex.

4. **Backfill uses the same regexes.** Even a `--since` pass applies patterns 1–2
   above, so it inherits the unguilded/assist blind spots.

---

## What to produce

1. **Root cause** in one or two sentences (e.g. "78% of missed kills are
   unguilded victims; the rest are assists").
2. **The recovered list**: every PvP kill where this character is the killer, and
   every death they assisted, with timestamp/zone/opponent — including the ones
   the tracker's regexes can't see. Use `pvp-findings.json` for the full set.
3. **Recoverability**: which entries could be captured by (a) running a `--since`
   backfill, vs (b) only after the agent's regexes are relaxed to allow
   `<Name>` with an *optional* `of <Guild>`, vs (c) require assist-from-own-combat
   support that doesn't exist yet.

## Notes / caveats for the write-up

- Names are single tokens; guild names may contain spaces. The auditor's loose
  detector (`has been killed in combat by` / `has killed` / `has died to … in
  combat`) is deliberately broad so it catches kills the strict patterns reject.
- Assist correlation is heuristic: "you damaged X, X died ≤30s later, killing
  blow not yours." Tune the window with `--assist-window <seconds>`. Treat these
  as *candidates*, not certainties (X could have died to an unrelated source).
- Outbound-damage detection covers common melee verbs + non-melee ("Your <spell>
  … for N points of non-melee damage"). If this character is a pure caster using
  unusual spell phrasings, spot-check a few `You`/`Your` lines in the log and
  extend `YOU_MELEE_RX` / `YOU_NONMELEE_RX` if needed.
