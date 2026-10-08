# XP tracking by zone, group and mob — review of FB-37 (2026-09-29)

**The ask (FB-37, from a member, via wolfpack.quest):** track XP gained per hour, compare it across zones
now that PoP is out, and have Mimic say where the best **solo** and the best **group** XP per hour has been
over the past week. Count **total XP, not percent**, or a character in their 30s makes Lower Guk look like
the best zone. A break-out per five levels would be good on a fresh server.

**The guild lead added (2026-09-29):** percent **and** AA per hour, **group composition** and who was in
the groups — *"The goal is to be able to say 'i see the number 1 groups is doing X mob, i could do the
number 2 grouping which is Y mobs'"*.

Status: **review only — nothing built.** The options at the end need the guild lead's pick.

---

## 1. What exists today

| Piece | Where it lives today | Leaves the machine? |
|---|---|---|
| XP % into the level, AA % into the point, AA banked | Zeal pipe label 26 / gauge 4, label 27 / gauge 5, label 71. The agent reads them in `_serializeMeState` | **No** |
| XP/hr and AA/hr as "% of a level per hour" | `_meRate`: a one-hour sliding window in the agent's memory, shown on the HUD's Box layout | **No** |
| Zeal's own "XP per hour" | label 81 / gauge 23. Mapped in the pipe explorer, never used | **No** |
| Experience lines ("You gain experience!!", "…party experience…", "…raid experience…") | not parsed; not in the agent's keep list | — |
| Kill lines ("You have slain X", "X has been slain by Y") | parsed into encounter events; a trash fight uploads, but the bot keeps it only when the name resolves to one catalog NPC | partly |
| Group roster (names; class and level with `/pipeverbose`) | Zeal type 6, used locally by the HUD and Extended Target | **No** |
| Raid roster | Zeal type 5 → `raid_roster`, the latest snapshot only | yes, no history |
| Zone | Zeal type 3 → `character_live_state`, current row only | yes, no history |
| Race (needed for total XP) | `/who` rows (`race`), `characters` | yes |

**So: nothing about XP reaches the server, and neither group membership nor zone has a history.**
Everything this request needs is present on the raider's machine; none of it is kept or uploaded.

## 2. Percent vs total XP — solvable exactly

EQ does not print an amount: every experience line is a bare "You gain party experience!!" (TAKP
`zone/exp.cpp`, the server Quarm descends from). But the XP a level needs is a fixed formula
(`Client::GetEXPForLevel`):

```
xp for level L = (L − 1)³ × 10 × race × band
race: Halfling 95 · most races 100 · Barbarian 105 · Ogre 115 · Iksar / Troll 120
band: 1.0 up to 29, stepping up per level band to 3.0 at 60
AA:   one point = RuleI(AA, ExpPerPoint), 18,750,000 on a non-custom server
```

So **total XP gained = the change in (level, percent) run through that table**, given the character's race
(from `/who`). The two bars Zeal already hands us, plus the race, give total XP per kill, with no guessing.
⚠ Two things to verify on Quarm before trusting the numbers: the exact band table (the code has it; copy it,
do not re-derive it), and Quarm's AA-per-point value (a server rule, so it can be custom).

⚠ **Resolution.** Gauge 4 is per-mille, 0.1 % of a level. At 60 a single group kill can be well under
0.1 %, so gauge-to-gauge deltas would read 0 and then jump. Label 26 carries the percent as text and may
carry more decimals. **Measure one evening's labels before building**; if both are coarse, sum over a
kill streak instead of per kill.

## 3. What a design looks like

**One event per experience line**, built by each raider's agent. Fields: character, race, level, zone,
time, XP gained (total), AA gained (fraction of a point), which line it was (solo / party / raid), the group
at that moment (names, and class and level where known), and the mob killed (the kill line within the same
second or two).
- Uploaded like `buff_casts`, batched on the durable queue, into a new table (`xp_events`). It is a few
  thousand rows a night for the whole fleet, so storage is small. Retention is a hosting-bill decision:
  the week the request asks about, or 30 days for trends (self-host epic).
- **Sessions**: one character's events in one zone, split by gaps over ~10 minutes. XP per hour =
  session XP ÷ session duration. A group session = the members who stayed together.
- **Brackets**: level 1–5, 6–10 … 56–60, 61–65, by the character's level at the time. Ranking is always
  within a bracket, which is what makes total XP comparable (a 35 and a 58 never compete).
- **The board** answers the guild lead's sentence directly. For your bracket, over the past 7 days:
  - #1 group — its XP/hr, its composition (e.g. WAR CLR ENC ROG MNK SHM), its zone, and its top mobs;
  - #2 group, the same, and so on;
  - the best solo sessions the same way, so there are two tables;
  - AA/hr beside XP/hr, in points per hour.

**Privacy scope** (CLAUDE.md "stat visibility scopes") is a call to make, not a default:
- XP rates are about a character's evening, not a raid.
- GUILD scope (named, signed-in members) fits "who was in the groups".
- A group often includes people outside the guild; those appear on our uploads without ever opting in.
- `exclude_from_stats` must be honoured, and it does not stop another raider's agent recording you (the
  known rule).
- **Proposal: show guild members by name and everyone else by class only.**

## 4. Options — four costs each (build · maintenance · runtime · change)

**A. Local only.** Your own XP/hr, AA/hr and total XP per zone for this session, as Mimic pieces and on the
HUD. It uses the table in §2 and the data on your machine; no upload.
- Build **low** (one session). Maintenance **low**. Runtime **none**. Change **easy**.
- Answers "how am I doing here", **not** "where are the best groups". Worth doing either way: it is the
  measuring half of B.

**B. Guild XP board.** A plus agent upload (`xp_events`), bot ingest, and a `/xp` page on wolfpack.quest:
the best zones per bracket over 7 days, solo and group tables, the top groups with composition and their
mobs.
- Build **medium**: 3–4 sessions (agent parse + upload, migration, bot ingest, web page with two layouts
  on beta, tests).
- Maintenance **medium**: it rests on the XP table, Zeal's bars and the fleet running Mimic.
- Runtime **small**: one row per kill; one page read.
- Change **medium**: the event shape is a stored contract.
- **Only raiders running Mimic are counted**, so "the best group" means the best group we can see.

**C. B plus a live piece.** "Best XP right now" in the Mimic chooser: your bracket's top groups over the
last hour, with the mobs.
- Build **+1 session**. Maintenance **+ low**. Runtime: one small bot read a minute. Change **easy** once B
  exists.

**Recommendation: A now, then B**, with the web page previewed on beta in two layouts for the pick. C
waits until B's numbers have been looked at for a week. First step before any of it: measure label 26's
resolution for one evening (§2).

## 5. Questions for the guild lead
1. A, B, or B then C?
2. Retention: 7 days (the ask) or 30 (trends)?
3. Names: guild members by name, others by class only?
4. Does raid XP count, or only solo and group? (Raid XP is shared differently and would crowd the board
   on raid nights.)
