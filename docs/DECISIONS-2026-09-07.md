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

## Ashieron's "Mimic takes my internet down" report — what the bot saw (investigated, no fix)

Ashieron via Mimic 2.6.5, 21:22 ET: zoning out while strafe-running, *"the
game hangs, then disconnects, and then my internet connection completely goes
down … Discord disconnects, browser can not connect … adapter looks active.
Only way to fix is to restart. When I stop running mimic, it does not happen
again."* Twice ME→DSP, once Seru→DSP. Hitya: *"serious implications here."*

**Tonight's instance, reconstructed from the bot's HTTP log and Supabase.**
His household's address was identified by pairing his 436-event upload with
the request that carried it (⚠ the deploy log's timestamps are batched
flushes, not event times — two uploads from different people share the same
microsecond — so pair on the HTTP stream, never on `[agent] upload from`).

| ET | What |
|---|---|
| 20:27–20:31 | Donaldus (his alt) at the Seru mini, Sanctus Seru; last live-state 20:31:27 |
| 20:31:31–20:32:47 | Agent still polling the bot at the normal 2/s, every request 200, no retries, no burst — but **no live-state posts** in those 75s: the Zeal-fed stream had gone quiet, i.e. EQ was already hung |
| **20:32:47.666** | Last request ever from his machine. Clean cut mid-heartbeat |
| 20:33–21:08 | Nothing from his address, in every sample |
| 21:09:20 | Ashieron enters Dawnshroud (after his restart); 21:22 files the report |

So this was the **Seru→DSP** case, on the alt, and the hang preceded the
network death by about 75 seconds.

**What that rules out.** The obvious theory — Mimic exhausting the machine's
outbound sockets or a router's NAT table — predicts *new* connections failing
while *established* ones keep working, and the agent rides warm keep-alive
sockets, so under that failure its polls would have continued. They stopped
dead instead, in the same second, with no error shape before it. Combined
with the wire rate (2/s, fleet-wide ~20/s to the bot across ~19 machines) and
the code review below, the "too many connections" class is refuted for this
instance.

**Code review, for the record.** Mimic batches the 225-event/s pipe into one
localhost POST per ~2s and throttled state pushes, all with `res.resume()` and
3s timeouts; overlays poll the agent at 0.5–2s over keep-alive; the agent's
outbound goes through a 15s-drain durable queue with flat 30s transport
backoff and fire-and-forget ephemeral posts with 8s timeouts; no
immediate-retry patterns, no intervals under 1s. Nothing here can open
connections at the rate a port or NAT exhaustion needs.

**What is left, honestly.** The bot can only see the wire. A total cut with
the adapter still "up", fixed only by a reboot, is the signature of a NIC or
Wi-Fi driver hang or a Winsock-level failure on the box — and those correlate
with gaming load, which is exactly the kind of correlation that reads as
"only when Mimic is running" at n=3. The one Mimic mechanism that could
plausibly touch the *game* at zone time is Zeal-pipe backpressure (Zeal emits
a burst at zone-in; if its pipe write blocks on a slow reader, EQ's thread
stalls). Untested; do not assert it.

**Settling it needs the box, not the bot:**
1. Event Viewer → Windows Logs → System, around 20:32 on 09-07: any adapter
   reset / link-down / driver event names the real culprit in one line.
2. `%APPDATA%\wolfpack-mimic\agent.log` (Mimic's `userData/agent.log`) around
   20:31–20:33: the `[zeal]` disconnect line and its reason.
3. If it recurs: before rebooting, `netstat -ano | find /c "TIME_WAIT"` and
   `Get-NetTCPConnection | Group-Object OwningProcess | Sort Count -Desc`.
   Thousands of TIME_WAITs or one PID with thousands of sockets would revive
   the exhaustion theory; a normal count buries it.
4. One question splits the space: **do other devices in the house lose
   internet at the same time?** Yes → router. No → the PC.
5. Bisect Mimic, not all-or-nothing: `"zealPipe": false` in
   `mimic.config.json` (the opt-out exists in `main.js` but is not in
   Settings). If the zone hang stops with the pipe off, the pipe coupling is
   real and worth fixing upstream.

**Two product follow-ups this exposed, both queued:** bug feedback attaches
only the EQ log — the agent log is the one that answers "what was Mimic doing"
and should ride along; and the Zeal-pipe opt-out should be a Settings toggle
so members can bisect without editing JSON.


## Open — read this first

| Item | Where it stands | Next |
|---|---|---|
| Event threads route by ZONE when two events overlap | ✅ bot 3.1.124 (2026-09-07) — `pickEventAt` zone-first; vocabulary in `data/zones.json` `aliases` | extend aliases as officers coin words; no code change needed |
| 🎲 rolled-loot card is still ONE event per refresh | open — `_refreshEventRollCardNow` picks a single target; with two events one thread gets both zones' rolls, the other none | per-event cards filtered by `looted_items.zone` (a zone id string); `roll_sets.zone` is NULL tonight so rolls attribute via their looters |
| Sequential-kill splitter splits one fight in two | open — one-line RPC fix diagnosed + tested on 2026-09-06 data (`p_started_at > ended_at`); NOT applied, Hitya's call | also two duplicate rows (Thall Xundraux 22:05, Kaas Thox 23:14) untouched — merging is destructive |
| Loot bidding: update / remove a bid | open — options A (withdraw), B (edit), C (show stack) presented; awaiting pick | first live cancel on a low-stakes bid |
| Zeal sends target id 0 for "no target" | open — bot guards it (3.1.123); Mimic `main.js` should null a 0 at the edge and its "pipe omits the field" comment is wrong; agent `_provableTargetId` should refuse 0 | beta |
| Ashieron: "Mimic takes my internet down" | investigated 2026-09-07 — bot-side evidence refutes socket/NAT exhaustion (total cut at 20:32:47 ET, established sockets died too, wire rate normal); root cause is on the box | needs his Event Viewer System log + agent.log around 20:32; the "other devices?" question; `zealPipe:false` bisect |
| Feedback should attach agent.log; Zeal-pipe opt-out should be a Settings toggle | open — both surfaced by the above | Mimic → beta |
| P40 / local model | open — assessment given 2026-09-07 (stats first, no GPU; if the card goes anywhere it is Tower, first job voice transcription, gated on a consent call); design doc offered, not written | Tower has no free x16; Hitya may move a card out to make room |
