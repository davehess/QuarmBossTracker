# Decisions — 2026-09-07

## Two events at once: kill cards go to the thread for the ZONE, not the clock (bot 3.1.124)

Hitya, Monday night, #event-chat: *"there are two events going on tonight and
mobs are being posted to each one. instead of specific ones posted per zone."*
Fargan had two Discord events up — **Seru mini for Dongru** and **Ring War
Ashieron** — and the bot opened a 🎲 thread for each, as designed. Then every
kill went to whichever event's *scheduled start* was nearest the kill time
(`pickEventAt`, "overlapping events → nearest", 2026-07-31). Past the midpoint
between the two starts, that is the Ring War thread for every Seru kill.

**The rule was fine for one event and wrong for two.** Nearest-start is the
only thing a timestamp can decide. The zone can decide more, and the bot
already knows it: every encounter has a catalog `npc_id`, the catalog encodes
the zone in it (`floor(npc_id/1000)`, `mobSpecials.zoneIdOf`), curated bosses
carry their zone in `bosses.json`, and every uploader's live-state row carries
`zone_id`. What it did NOT know was which zone an *event* was about.

**Events now read their zone from their own text.** Title first, then
description, then location — tiered, not unioned, because the Ring War
description says *"Directly after Seru Mini heading to Great Divide"* and
names both zones; a union would have routed every Seru kill to it all over
again. The vocabulary is whole phrases only (never single tokens — "plane" is
in 25 zone names) from three places:

| Source | Gives | Example |
|---|---|---|
| `eqemu_zone` | long name ± leading "The", short name; instanced twins fold into the base | "Plane of Sky" → {71, 1071} |
| `data/zones.json` | the guild's `name`, `shortName`, and a new **`aliases`** list | `"seru"` → Sanctus Seru; **`"ring war"` → Great Divide** (added tonight) |
| `data/bosses.json` | boss names + nicknames → the boss's zone | "LIS" → Sanctus Seru |

**`aliases` in `zones.json` is where guild words go.** It is data, read fresh
every 6h, and an officer can extend it without a code change. That is the
answer to "what if the next event is called something we have not seen".

**The pick:** live events naming the kill's zone win; failing that, live events
naming *no* zone (an event that names a different zone is not this kill's
event; one that names nothing could be); failing that — and whenever the
kill's zone is unknown — the nearest start, exactly as before. The zone only
narrows, it never empties, so single-event nights are byte-identical to
yesterday.

**Verified on tonight's data** in `test/event-thread-zone-routing.test.js`,
which carries both of Fargan's entries verbatim: at 21:30 (45 min from the
Ring War start, 90 from Seru's) a Seru kill now threads under Seru and a Great
Divide kill under Ring War. A mutation pass caught one vacuous assertion — the
"un-zoned event" fixture shared Seru's start time, so the id tie-break handed
the test its answer for free; fixed by starting it earlier.

**Not done, deliberately:** the 🎲 rolled-loot card still resolves one event
per refresh, so with two events one thread carries both zones' rolls and the
other none. Same class of bug, different path; it needs `looted_items.zone`
(a zone-id string) to scope each card. Queued below.


## Open — read this first

| Item | Where it stands | Next |
|---|---|---|
| Event threads route by ZONE when two events overlap | ✅ bot 3.1.124 (2026-09-07) — `pickEventAt` zone-first; vocabulary in `data/zones.json` `aliases` | extend aliases as officers coin words; no code change needed |
| 🎲 rolled-loot card is still ONE event per refresh | open — `_refreshEventRollCardNow` picks a single target; with two events one thread gets both zones' rolls, the other none | per-event cards filtered by `looted_items.zone` (a zone id string); `roll_sets.zone` is NULL tonight so rolls attribute via their looters |
| Sequential-kill splitter splits one fight in two | open — one-line RPC fix diagnosed + tested on 2026-09-06 data (`p_started_at > ended_at`); NOT applied, Hitya's call | also two duplicate rows (Thall Xundraux 22:05, Kaas Thox 23:14) untouched — merging is destructive |
| Loot bidding: update / remove a bid | open — options A (withdraw), B (edit), C (show stack) presented; awaiting pick | first live cancel on a low-stakes bid |
| Zeal sends target id 0 for "no target" | open — bot guards it (3.1.123); Mimic `main.js` should null a 0 at the edge and its "pipe omits the field" comment is wrong; agent `_provableTargetId` should refuse 0 | beta |
| P40 / local model | open — assessment given 2026-09-07 (stats first, no GPU; if the card goes anywhere it is Tower, first job voice transcription, gated on a consent call); design doc offered, not written | Tower has no free x16; Hitya may move a card out to make room |
