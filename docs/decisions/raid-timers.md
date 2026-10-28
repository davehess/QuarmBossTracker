# Raid timers & boards

Boss kill timers, spawn alerts, lockouts, the #raid-mobs boards. Oldest first. Find an entry by its ID in [the index](README.md); new decisions go in `inbox/` and are merged here.

## 2026-08-10/4 — Boss zone audit — `bosses_local.zone_short` had drifted from the repo seed
*2026-08-10 · DECISIONS-2026-08-10.md · Boss zone data drifted; audited against sources*

**Reported (the guild lead):** `/parses` filed Galiel Spirithoof under *Plane of Mischief*.

**It is Plane of Growth**, and the error was in the database, not the page.
`bosses_local.zone_short` said `mischiefplane`; `data/bosses.json` — the seed —
correctly says "Plane of Growth". The DB drifted from the repo.

**Method — three independent sources, not one guess.** For every boss:
1. `data/bosses.json`, the committed seed;
2. the npc-id convention (`id = zoneid*1000 + n`, per the catalog cheat-sheet);
3. the **authoritative** `spawnentry → spawn2` join, which carries real placement
   data (the denormalised `eqemu_npc_types.zone_short` is NULL catalog-wide, so
   this join is the documented way to read a mob's zone).

Nine rows disagreed with the id convention. Only fixing the reported one would
have left eight.

**Fixed (≥2 sources agreeing), 6 rows in `bosses_local` + 35 in `encounters`:**

| boss | was | now |
|---|---|---|
| galiel_spirithoof | mischiefplane | growthplane |
| master_yael | chardok | hole |
| nortlav_scalekeeper | chardok | hole |
| kelorek_dar | *(null)* | cobaltscar |
| severilous | *(null)* | emeraldjungle |
| ssraeshzian_blood_golem | *(null)* | ssratemple |

The encounter backfill reached back to **January 2025** — Galiel was mis-zoned on
8 separate kill dates and Severilous carried no zone across 20.

**Deliberately NOT fixed — needs a human, all PoP (locked until 2026-10-01):**

- `bertoxxulous` — seed and DB both say `podisease`; only the id convention says
  `codecay`, and it has **zero spawn points**, so nothing corroborates. Two
  sources against one is not enough to overwrite.
- `aerin_dar` (seed+DB `postorms` vs spawn `povalor`) and `agnarr_storm_lord`
  (seed+DB `postorms` vs spawn `bothunder`) — here the *spawn* data contradicts
  both the seed and the DB. Spawn placement is the stronger source, so these are
  probably wrong in the seed too, but they are locked content nobody can verify
  in-game right now.

**Add to the PoP unlock checklist** (alongside `/board` and refreshing
`pqdiUrl`s): re-run this audit and settle those three against PQDI.

**Re-runnable audit** — the query that found it, worth repeating after any boss
import:

```sql
select b.internal_id, b.zone_short as recorded, z.short_name as by_npcid,
       string_agg(distinct s2.zone_short, ', ') as by_spawn_join
from bosses_local b
join eqemu_zone z on z.zone_id = (b.npc_id / 1000)
left join eqemu_spawnentry se on se.npc_id = b.npc_id
left join eqemu_spawn2 s2 on s2.spawngroup_id = se.spawngroup_id
where b.zone_short is distinct from z.short_name
group by b.internal_id, b.zone_short, z.short_name;
```

## 2026-08-19/6 — Seru Minis are a GROUP EVENT, not board bosses (the guild lead, bot 3.1.56)
*2026-08-19 · DECISIONS-2026-08-19.md · Seru Minis tracked as group event*

**The call:** *"we're not tracking them today because they're an 18 hour
respawn. But the group of them is a worthy event. we call them Seru Minis."*
(From a member's "Seru Mini's" thread — the nudge card had mis-detected Lord
Inquisitor Seru.)

**The roster (the guild lead's correction, same hour): "they are these four"** — the
Praesertum: Bikun (NW → Shard of the Shoulder), Vantorus (SW → Hand), Rhugol
(NE → Eye), Matpa (SE → Heart). A first pass wrongly fingered the city's
20-named office tier; the Praesertum rows hide behind `#` prefixes in the
mirror, which that query excluded.

**Where it landed:** `GROUP_EVENTS` in `utils/suggestNudge.js` — pseudo-bosses
(`evt_` ids) that ride the whole tap-through flow but can never reach
bosses.json, the board, or timers. `evt_seru_minis` detects "seru minis" /
"house leaders" / "praesertum", leads the buttons ahead of any boss match,
and tops the Luclin picker (which truncates 46→25). Roster, per-mob ability
kits, shard drops + mirror caveats: `docs/seru-minis.md`. The pattern is
reusable — the next multi-mob outing is one `GROUP_EVENTS` entry.

## 2026-08-20/3 — "If they have a loot lockout we can keep them on" (the guild lead) — lockout ⇒ card-worthy, self-enforcing
*2026-08-20 · DECISIONS-2026-08-20.md · Loot lockout promotes mob to card-worthy*

**The call.** Uncurated NAMEDS (instanced City of Mist / Ssra minis) shouldn't
be promoted by hand-picked lists: the SERVER already declares what's a boss —
it hands out loot lockouts. The /sll relay and bosskill broadcasts carry
exactly those names, so bot **3.1.61** promotes any auto-registered
`bosses_local` row they mention (`_promoteLockoutBoss` — flips the flag only;
never creates rows, never touches timers, war-god PVP names are no-ops).

**Why organic, not backfilled.** No lockout history is stored (the old handler
dropped non-board names), so tonight's nameds promote the first time anyone
locked to them runs /sll after the deploy, or on their next kill broadcast.

## 2026-08-21/2 — Foreign lockouts are CAPTURED; foreign raids stay excluded (the guild lead)
*2026-08-21 · DECISIONS-2026-08-21.md · Capture foreign lockouts, exclude foreign raids*

**The call.** *"several raiders have spent time with Breakfast Club doing raids
on alts. we need to remain vigilant about these not being included, but also
capture loot lockouts for raid mobs when they don't occur with our guild — put
those into another admin section."*

**⚠ Corrected same day by the guild lead — a lockout is an ENGAGE lock.** I built and
described this as a *loot* lockout. It is stronger: a locked character
**cannot fight the mob at all** and is **teleported out of the zone on
engage**. That moves the whole feature from a loot-distribution question to a
PRE-PULL one — a locked raider who engages is a body that vanishes mid-fight.
It is per character, so for a current-era boss it is normally an ALT that
carries one; a MAIN appearing on the foreign list is the surprising case, which
is why the page now marks main vs alt. Recorded in CLAUDE.md's don't-re-derive
section, and the UI no longer says "loot lockout" anywhere. The stored data was
already right — only my model of what it meant was wrong.

**Two jobs that were being conflated.** A foreign RAID must stay out of our
numbers — /parses already auto-hides an upload whose players are mostly not
ours, and /admin/anomalies owns the review. A foreign LOCKOUT is the opposite:
it must be kept, because it binds US. Someone who killed a boss with another
guild on Tuesday cannot loot it on our Sunday. We were reading `/sll` purely to
nudge boss timers and discarding the rest.

**Bot 3.1.64 + web 1.1.88.** New `character_lockouts` table; the lockout relay
records a per-character row alongside the timer work. `ours` is THREE-state and
never guessed: true = lines up with a kill on our board (30-min tolerance, since
a personal lockout and a guild timer are both derived and drift); false = we
have a kill and it does not line up, so it happened elsewhere; **null = we have
no kill of that boss at all, so we cannot say**. /admin/lockouts shows the three
bands separately, and the null band is labelled "usually just a boss we don't
track — not evidence of anything". An unknown must not read as an accusation.

## 2026-08-21/3 — Pre-raid lockout briefing to officer chat (the guild lead)
*2026-08-21 · DECISIONS-2026-08-21.md · Pre-raid lockout briefing posted to officers*

**The call.** *"put it into a post in officer chat about characters currently
locked out for the upcoming night's raid by zone from the raid planner's
event."*

**Why the timing is the feature.** Because a lockout is an ENGAGE lock, the
useful moment is BEFORE the pull — a locked raider who engages is a body that
vanishes mid-fight. So the briefing is answered against the planner's target
list and posted in the 90 minutes before start, not after loot.

**Shape.** `utils/lockoutBriefing.js` is pure and tested: given tonight's target
boss ids (`loadTonightsTargets` reads the RaidHelper event), the boss catalog
and the active `character_lockouts` rows, it groups blocked characters by ZONE,
busiest zone first, MAINS first within each boss, and also names the targets
nobody is locked to — so the post reads as a check that ran rather than a list
that happened to be short.

**Two ways in:** `/lockoutcheck` (officer) posts on demand; the spawn checker
posts automatically once per raid night in the T-90m window, deduped on
`nightKey` in `bot_kv` (not state.json — deploys wipe it). Bot **3.1.65**.

**Mains are called out** because lockouts are per character: an alt carrying one
for a current-era boss is the expected Breakfast Club case, a main is the
surprising one.

## 2026-08-21/6 — A kill parse IS a lockout observation (Guild lead: "taeya reported this Ventani kill so they should have a lockout")
*2026-08-21 · DECISIONS-2026-08-21.md · A kill parse counts as lockout observation*

**Context.** the guild lead linked a Ventani parse
(`/parses/1b943d2d-0059-4407-8ab2-9346421f0d79`) uploaded by **a member** from a
raid that was not ours, and asked why she had no lockout.

**The finding.** She had none because `character_lockouts` had **zero rows,
full stop** — the table shipped 2026-08-21 reading only the `/sll` relay, and
`/sll` needs a human to type it in game. The last lockout relay of any kind
arrived 2026-08-21 01:26 UTC, 23 hours *before* the write path existed. In that
same window the encounter pipe had already captured **three** foreign raid kills
from that one player (Tukaarak, Ventani, Seru). The evidence was in the
database; nothing was reading it.

Same shipped-but-never-fires shape as the officer channel above and the
inventory scanner earlier in the week. The pattern to watch for: **a feature
whose only input is an action a human has to remember to take.**

**The call.** A confirmed kill of a lockout-bearing raid boss is itself a
lockout observation, so derive them from parses (`utils/killLockouts.js`, wired
into the encounter handler as `_recordKillLockouts`). Load-bearing details:

- **Participants come from four places, not just the damage list.** The
  uploader, `players`, `healers`, `defenders`. This is the case that prompted
  the work: a member is a **cleric** — zero damage, therefore no
  `encounter_players` row on the very kill she uploaded. A damage-list-only
  derivation would still have missed her.
- **We never infer who else was there.** A healer on a night nobody ran Mimic
  is invisible to us and stays invisible.
- **`ours` stays three-state**, now on better evidence than the /sll path's
  ±30min timer heuristic: bound to a `raid_nights` row → true; unbound but
  inside a raid window → **null** (a binding that didn't take, not an
  accusation); unbound and outside every window → false.
- **The primary key changed to (guild, character, boss).** /sll reports the
  server's remaining time; a kill row computes expiry from the boss timer. The
  two disagree by minutes about the *same* lockout, so keeping `expires_at` in
  the key filed them as two. A character cannot hold two live lockouts on one
  boss. This table is a **current-state projection**; the permanent audit trail
  of who killed what with whom is `encounters` + `contributions`, which is
  richer than this table could ever be.
- **A kill row never overwrites a live /sll row** (`dropRowsShadowedBySll`).

**Backfill** (`scripts/backfill-kill-lockouts.sql`, run 2026-08-22): 753 live
lockouts across 162 characters and 21 bosses. a member's three now show, all
lifting Aug 28.

## 2026-08-21/7 — Two things the new data volume broke, found by looking at what the post would say
*2026-08-21 · DECISIONS-2026-08-21.md · Lockout data volume exposed non-roster names*

Both were invisible while the table was empty.

1. **Non-roster names.** A parse of a joint raid carries the *other* guild's
   whole roster, so ~90 of those 753 rows are strangers. The officer briefing
   now counts them and does not list them (`outsiders`); `/admin/lockouts` gives
   them their own section. Sixty strangers would bury the two names that matter.
2. **The headcount was the wrong number.** A lockout runs the same length as the
   boss's respawn, so after one of OUR kills the whole raid is locked *and* the
   boss is down — 32 names, nothing to act on. The briefing now splits on the
   **divergence**: a target that is UP with our people still locked to it, which
   essentially only happens when somebody killed it elsewhere. Down-target
   lockouts are counted (`onDownTargets`), never dropped — lockout-length ==
   respawn-length is a model we have not measured, and an unknown timer is
   treated as UP so a missing boss state can never hide a real block.

## 2026-08-21/8 — Three corrections to the lockout model, same evening (the guild lead)
*2026-08-21 · DECISIONS-2026-08-21.md · Lockout model corrections: internal events, current era*

> "Friday was a guild rolling event, so internal, but still a lockout. only the
> lockouts from current era or night's targets really matter, and as long as
> mains are good to go"

**1. A raid night is not the only thing we run.** The first cut decided `ours`
from the `raid_nights` binding with the raid window as fallback, so Friday's
guild classic run (Vox / Nagafen / Terror, seven roster characters) came out as
FOREIGN. Wrong, and the wrong direction to be wrong in.

The fix is a signal the codebase already had: **roster share**. Over ten days of
real encounters the separation is not close —

| | roster share |
|---|---|
| our raid-night kills | 0.75 – 0.89 |
| Friday's guild rolling event | 0.78 / 0.88 / 1.00 |
| the Breakfast Club morning raids | 0.14 / 0.18 / 0.20 / 0.22 |

so `classifyOurs` now reads: bound to a raid night → true; **else majority of
named players on the roster → true** (a guild event, calendar or not); else a
clear minority on ≥3 players → false; else null. The 0.5 line is
`GUILD_EVENT_MIN_MEMBER_FRAC`, deliberately identical to
`REVIEW_FOREIGN_MAX_MEMBER_FRAC` in `web/lib/anomalies.ts` so the two surfaces
can never disagree about the same fight. Under 3 named players it returns
**null**, never false — a duo that happens to name one outsider is not evidence.

Reclassifying the backfill moved Friday's 14 rows to `ours`, and left the
foreign list as exactly the five Breakfast Club bosses.

**2. Era scoping.** A Lady Vox lockout is real and changes nothing about a
Sunday in Vex Thal. `currentEraNames()` in `web/lib/eras.ts` returns the era
containing *now* **plus the one below it** — Luclin + Velious today, because
Sleeper's Tomb is very much a current target; PoP + Luclin from 2026-10-01,
derived from the same `ERAS` table the rest of the site uses, so nobody has to
edit a list. `/admin/lockouts` leads with those and drops older content to the
bottom. The officer briefing needs no era filter — it is already scoped to the
night's targets, which is the other half of the same sentence.

**3. Mains are the verdict.** A blocked alt is a swap; a blocked main is a hole
in the raid. `buildLockoutBriefing` now returns `mainsBlocked` / `altsBlocked`
counted **only on targets that are up**, and that drives the ✅/⚠, the embed
colour and the checklist flag. An alt-only night reads "✅ All mains clear —
2 alts blocked, swap and carry on" instead of a warning. `/admin/lockouts`
sorts mains first inside each band.

**What the three filters do to the signal.** 753 rows → the officer-relevant
set for Sunday Aug 23 is **six**, of which four are mains: a member and
a member on Grieg Veneficus (locked to Mon Aug 24, boss up since Aug 19), and
a member on both Sleeper's warders (locked to Fri Aug 28, both up Sun ~4pm).

## 2026-09-07/1 — Two events at once: kill cards go to the thread for the ZONE, not the clock (bot 3.1.124)
*2026-09-07 · DECISIONS-2026-09-07.md · Kill cards go to the zone's event thread*

The guild lead, Monday night, #event-chat: *"there are two events going on tonight and
mobs are being posted to each one. instead of specific ones posted per zone."*
a member had two Discord events up — **Seru mini for a member** and **Ring War
a member** — and the bot opened a 🎲 thread for each, as designed. Then every
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
which carries both of a member's entries verbatim: at 21:30 (45 min from the
Ring War start, 90 from Seru's) a Seru kill now threads under Seru and a Great
Divide kill under Ring War. A mutation pass caught one vacuous assertion — the
"un-zoned event" fixture shared Seru's start time, so the id tie-break handed
the test its answer for free; fixed by starting it earlier.

**Not done, deliberately:** the 🎲 rolled-loot card still resolves one event
per refresh, so with two events one thread carries both zones' rolls and the
other none. Same class of bug, different path; it needs `looted_items.zone`
(a zone-id string) to scope each card. Queued below.

## 2026-09-10/13 — PoP timers set from leadership guidance ahead of the official notes (2026-09-13)
*2026-09-13 · DECISIONS-2026-09-10.md · PoP boss timers set from leadership guidance*

The guild lead passed along pre-release PoP guidance that guild leadership holds ahead
of Quarm's official notes. **It is not public and the finals are not out**, so
the capture itself stays OUT of this repo — the guild lead holds it. What landed here
is only our own configuration: `data/bosses.json` PoP timers set to the
guided values (standard cycle and the elemental gods), and two zone
corrections (Aerin`Dar is Plane of Valor, Agnarr is Bastion of Thunder).
Re-verify every value against the official notes when they publish, and
against the first live kills after 10-01. The overlay notes that had carried
the detail on beta were reverted the same day; they return when the notes are
official.

## §63a — The PoP patch notes against the boss board (2026-09-28, bot 3.1.163)
*2026-09-28 · DECISIONS-2026-09-21.md · PoP patch notes fixed against boss board*

The guild lead posted the server's PoP patch notes (July 23 to September 28). The board unlocks PoP on
Oct 1, and `data/bosses.json` matches kills by EXACT name or nickname, so a wrong name means a kill that
silently never starts a timer. Fixed, all confirmed by the notes and the NPC catalog:
- **Quarm 168 → 162 hours** ("Boss lockouts are 6 days 18 hours" in the Plane of Time).
- **Mujaki the Ravager → Mujaki the Devourer.** The notes and `eqemu_npc_types` 204039 both say
  Devourer; the old name stays as a nickname.
- **"Avatar of Earth" on the Rathe Council slot.** The notes name the Avatar as Earth's elemental god
  (5 days 18 hours, matching the slot's 138 hours); the Council summons it in instances.
Not changed, for the guild lead: the notes put "most PoP raid bosses" at 66 hours and list them, but do not
name Xanamech, Ture, Mujaki, Askr or Charassis, which the board has at 72. The notes also name two
66-hour bosses the board lacks (Mithaniel Marr, the Manaetic Behemoth) and shorter lockouts it has never
tracked (Emmerik and Evynd 6 h, Grioihin 18 h, Halls of Honor trials 18 h, Keeper of Sorrows and Tylis
2 h, An Unimaginable Horror 30 min).
- Also from the notes, recorded for whoever touches them next: NPCs no longer equip bows handed to them,
  so the bow-pet reasoning in the agent's pet verb table is historical; PoP graveyards move corpses after
  60 minutes, so a corpse DM's /loc goes stale there; quakes open an 8-hour raid window in the PvP
  instance; new commands #popflags, #timelockout and #glory are parser candidates like #petstats.

## §130 — The October 1–2 server patch notes against the platform (2026-10-02, bot 3.1.190 · web 1.8.77)
*2026-10-02 · DECISIONS-2026-09-21.md · October patch notes against platform*

The guild lead posted the server's patch notes for October 1–2 and asked us to consume them (§63a did the same for
the July–September notes). Each change, what it touches here, and what was done:

- **PoP corpses move after an hour** — guild instances to the Plane of Tranquility graveyard, open-world
  PoP zones to their own graveyard; a failed Plane of Justice trial's corpse to the Tribunal; Thelin's hedge
  maze corpses with the players; the PvP instance keeps its 30-minute timer. **Done:** the corpse DM now
  says when (an hour after death) and where, for zone ids 200–223 less the Plane of Knowledge and
  Tranquility. Listed by id: the catalog files the Crypt of Decay and the Plane of Justice under expansion 0.
  It cannot tell an instance from the open world (same zone id), so it names both. Both the stable and beta
  agents already send the zone id, so this reached everyone with the bot deploy.
- **Xanamech has no lockout; existing lockouts cleared; Nitram ready as soon as the flagging window ends;
  Nitram can't be killed once Xanamech is up.** The board has Xanamech at **72 hours**, now simply wrong
  (the §63a open question — 66 or 72 — is moot). Not changed: taking a boss off the board changes the
  visible board, and a kill of a boss not in `bosses.json` posts "not in timer database — use /addboss" to
  raid chat. Recommended: remove him from the board. `character_lockouts` held **no** Xanamech rows
  (checked), so nothing to clear.
- **Rallosian Glory death broadcasts reworded:** "Name <Guild>", shorter, Glory lost and gained stated;
  kills by an NPC, unworthy kills and forfeits now report Glory lost and the zone. Our parser reads the OLD
  wording (`PVP_GLORY_RX`, `PVP_GLORY_WORTHY_RX`). The newest parsed row is 10:00 UTC Oct 2, still in the
  old wording, so either the patch was not live yet or new lines are being missed. A line the parser can't
  read is not lost: the agent's `captureUnmatchedPvpKill` saves every unparsed Rallos / Glory broadcast to
  `logsync.pvp-unmatched.json` beside the agent. **Not changed, deliberately:** writing a pattern from the
  notes' description is the invented-pattern failure (CLAUDE.md, trigger rules). One real line fixes it, and
  the new lines carry the guilds, so /who will no longer be needed to fill them in.
- **Classic–Luclin raid targets also respawn in the open world** (instances stay; open-world spawns are
  not GM-enforced, racing allowed). Two things touch us:
  - **Risk:** the board is guild-INSTANCE timers, fed by "Druzzil Ro tells the guild, '<X> of <Guild> has
    killed <Boss> in <Zone>!'". If our guild kills an open-world copy and Druzzil says the same thing, the
    bot starts the instance timer on the board. Whether the line differs is unknown until our first
    open-world kill.
  - **Possible feature, the guild lead's call:** open-world spawn windows for those targets. The server's own
    respawn time and variance are in `eqemu_spawn2`; another guild's kill is not broadcast to us, only
    seen if someone is there.
- **Reduced open-world respawns are back.** Any respawn time we quote from the database is the full
  timer; the real one can be shorter. Applies to the AoE-farming answer and the map below.
- **Terris Thule:** adds despawn on reset or her death; pulling her out of the chamber wipes hate and heals
  her. **The Tribunal hands back items. Plane of Sky's 13 quest NPCs move again.** No repo text mentions
  any of these; nothing to change.
- **`#pvpzone quake <luclin|pop> <on|off>`:** quakes can now include or leave out an expansion. Our quake
  tracking reads the quake broadcast; it is unaffected until that wording changes. Watch for it.

## §132 — Xanamech off the board; every Rallos Zek line read (2026-10-02, bot 3.1.191 · web 1.8.78 · agent 3.7.71 beta `c82ae5b4`)
*2026-10-02 · DECISIONS-2026-09-21.md · Xanamech off board, Rallos lines read*

The guild lead, answering §130's two questions: *"1. yes"* (take Xanamech off the board) and *"2. attached"*,
the agent's `logsync.pvp-unmatched.json` from their machine.

- **Xanamech is off the timer board.** No lockout since the Oct 1 patch, so the 72 h timer was wrong.
  - `data/bosses.json` entry removed. The PoP thread still has three board panels, so the board edits
    in place with no repost.
  - The website's `bot_boards` row still has to be deleted by hand. The mirror only upserts, so a removed
    boss's row stays on /boards until someone deletes it. The deployed bot no longer writes it (its
    18:23 UTC mirror left the row at 17:36). The delete from the cloud session timed out twice, probably
    waiting for an approval nobody could give: `delete from bot_boards where boss_id = 'xanamech_nezmirthafen';`.
    ⚠ `/removeboss` has the same gap; queued as a separate task, not fixed here.
  - `bosses_local.timer_hours_override` set to null (it said 72). The row stays: the guide page and
    encounter matching still use it, and he is still a raid target.
  - A kill relay naming him now says *"no lockout — not on the timer board"*. It no longer asks an
    officer to `/addboss` him back. The list is `_OFF_BOARD_NO_LOCKOUT` in `index.js`.
  - Test: `test/xanamech-off-board.test.js`.
- **The unread lines: 168 Rallos Zek broadcasts, Sep 28 – Oct 1, no pattern read any of them.** Each family
  was checked against the whole file; all 168 now parse.

  | Line | Count | Read as |
  |---|---|---|
  | "looks on as X falls to `<NPC>` in `<zone>`, but grants no Glory." | 87 | a death to an NPC (`killType: 'npc'`), as Druzzil's "has died to" used to be |
  | "looks down in disgust as X [`<Guild>`] falls to `<NPC>` in `<zone>`." | 60 | the same; the newer wording carries the guild |
  | "looks down in disgust as X falls in `<zone>` without a worthy foe." | 1 | a death with no killer named |
  | "… X flees / abandons the battlefield like a cowardly dog, surrendering 1 measure of Rallosian Glory." | 13 | a forfeit (`killType: 'forfeit'`), not a death |
  | "exults as K cuts down V in `<zone>` and claims 1 measure of hard-won Glory. K now bears 1 of 10." | 1 | a Glory-worthy kill |
  | "marks K with his favor for spilling V's blood …" | 6 | already read since agent 3.7.51; these came from an older agent |

  - **NPC and zone split at the LAST " in ".** Checked in `eqemu_zone` and `eqemu_npc_types`: no zone name
    has " in " or a period in it, but one NPC does ("a lady in waiting"). Padded NPC names
    ("Emperor Ssraeshza  in") come out trimmed.
  - **Guilds:** a guild the line names is kept. `_resolveGloryGuilds` now fills only a side the line left
    null. Old agents always send null, so their behaviour is unchanged.
  - **What the bot does with each:**
    - NPC deaths: a `pvp_deaths` row (`killer_is_npc`) and a plain ☠️ post in #pvp. This is what the
      Druzzil wording got before the PoP patch, so #pvp gets roughly 50 of these a day back.
    - A death with no killer: a death row, and a ☠️ post with **no** backup ping. `isWpDeath` now
      needs a killer.
    - A forfeit: a 🏃 post. No death row and no assist credit.
    - The worthy kill: a kill like any other.
  - **Not yet seen:** the Oct 2 wording the patch notes describe ("Glory lost and gained stated"). The
    newest line in the file is Oct 1 11:36 UTC. The patterns allow a guild after any name, and a trailing
    clause on the NPC-death and no-foe lines, but nothing was written for wording nobody has seen.
    Unread lines still land in `logsync.pvp-unmatched.json`.
- **Reach:** beta Mimic only until a stable cut. After updating, Opt-in Logs over Sep 28 onward sends the
  missed deaths. Backfill rows record but do not repost to #pvp.
- Tests: `test/pvp-glory.test.js` (each family, invented names) and `test/pvp-glory-bot.test.js`
  (line guilds kept, NPC/no-killer deaths recorded, forfeit not, the 🏃 post).

## §194 — A kill by one or two guildmates starts its board timer (2026-10-08, bot 3.1.224 · migration 20261008160000)
*2026-10-08 · DECISIONS-2026-09-21.md · Small-group kill starts board timer*

The guild lead, from the Planes of Power board: *"I don't see the timers updated on bastion of thunder's timers
GAUKR and one other … This needs to stay updated."* Two guildmates killed Gaukr Sandstorm and Hreidar Lynhillig;
the bot logged each as `unknown: 2 fighter(s) — too few to judge` and started nothing (§165's rule 5). Laef
Windfall fell out the same way with `1 fighter(s)`: the uploader's own list held one name while the merged parse
held five, all guild.
- **Rule 5 now:** 1–2 fighters who are ALL on the roster → `ours`. Anyone off the roster, or no roster to read,
  is still `unknown`. Rules 1–4 still run first, so a PvP broadcast, a PvP flag, or another guild in a fighter's
  own /who still makes the kill pvp/live.
- **Fighters = this upload's list + the merged `encounter_players`** (`gatherKillSignals`, one bounded read; a
  failed read falls back like the others). A lone uploader of a mostly-stranger fight is now judged on the whole
  fight, which can turn an old `unknown` into `live`.
- **The restart re-seed agrees** (`latest_kill_per_npc`, migration `20261008160000`, applied on production
  before the deploy): 3+ players, or 1–2 all on the roster. The roster is read once as an array — 153 ms over
  every tracked boss for 186 h; a correlated anti-join took 2.3 s.
- **Today's three timers come back on the deploy itself:** the startup reconcile reads Gaukr, Hreidar and Laef
  through the new function (checked on production) and seeds them from the fights' start times.
- **The risk accepted:** two guildmates killing a named in the open world with no /who taken get a timer they
  should not. An officer's 'live' mark on /parses takes it back on the next reconcile.

## §202 — More named mobs on the boards: the rule is "drops parchments, glyphed runes or real loot" (2026-10-08, bot 3.1.228 + 3.1.229 data)
*2026-10-08 · DECISIONS-2026-09-21.md · More named mobs on boards*

**The ask** (the guild lead): *"We need to add a bunch of the other mobs to the boards, like Glykus Helmir, and The
Diaku Overseer. Any of the named mobs with a long respawn timer should be tracked on that page"*, then, on the cut:
*"any of the ones that drop parchments or glyphed runes, or real loot"*. Picked **A, the PoP sweep** first; the loot rule
then widened it past PoP.
- **Glykus Helmir, Tagrin Maldric, The Diaku Overseer** (Plane of Tactics, 24 h, from `eqemu_spawn2`) went on first
  (3.1.228), same shape as the Plane of Valor 24 h entries (`lockout:false`).
- **The rule**, run against `eqemu_npc_types` + `eqemu_spawn2` + `eqemu_npc_drops` (3.1.229): a named mob (not `a_` /
  `an_`), level 45 or more, a spawn timer of 18 h or longer (placeholder timers over ~277 h left out), not already on the
  board, AND it drops an Ethereal Parchment, a Spectral Parchment or a Glyphed Rune Word (the spell turn-in tiers, §63-64
  of DECISIONS-2026-08-20), or real loot: a wearable item that is magic or NO DROP, with at least 30k HP for the
  loot-only ones. 87 named mobs have no loot rows at all; 140 more drop only junk or quest bits; neither group is added.
- **Result: 90 added, 251 bosses on the board**: Plane of Fire 10, Air 7, Earth 6, Water 5, Torment 5, Innovation 1,
  Tower of Solusek Ro 5, Temple of Marr 4 (all PoP); Temple of Veeshan 19, Vex Thal 12, Plane of Growth 7, Dragon
  Necropolis 3, Western Wastes 3, Akheva Ruins 3, Echo Caverns, Grieg's End, Katta Castellum. Timer = the server's spawn
  timer in hours. Data: `data/bosses.json`, ids by slug, PQDI link by npc id, nicknames only where unique on the board.
- ⚠ **Not decided:** `lockout` is left unset on the 90 (the board's default, which can create raid lockouts from kills);
  the 18-30 h ones may have none. And a high-HP named with no drop rows in this mirror (87) could be a gap in the loot
  tables rather than a mob that drops nothing. Both are for the guild lead's eye on the first kills.
- Rejected: option B (every named mob, ~180 names, mostly trash-named Vex Thal / Temple of Veeshan) and option C (the
  board grows itself on a kill; a bot change that only learns a mob after the guild kills it). C is still the better
  long-term rule and stays an open item.

## §204 — The Glyphed Rune Word drop list is the board's rule: anyone on it with a spawn over 2 h (2026-10-08, bot 3.1.231 data)
*2026-10-08 · DECISIONS-2026-09-21.md · Rune Word droppers over 2h on boards*

**The ask** (the guild lead, pasting pqdi item 29132, Glyphed Rune Word, with its 167 droppers): *"Anyone from this list
should be on that boards page if they have a longer than 2 hour spawn cooldown"*. This replaces the §202 loot guess
with PQDI's own list for the Planes of Power.
- **Checked against `eqemu_spawn2`:** of the 167 ids, 53 spawn on a timer over 2 h, 53 on 2 h or less (the trash named of
  Fire and Water, the Doomfire mobs and so on), and 61 have **no spawn row** (spawned by a zone script, so there is no
  respawn to read). 44 of the 53 were already on the board (§202 + earlier); **nine were added**: Emmerik Skyfury and
  Evynd Firestorm (Bastion of Thunder, 6 h), An Undead Inhabitant, A Rabid Wrulon and A Recuso Degenerate (Halls of Honor, 12 h),
  Lossenmachar and Calebgrothiel (Plane of Air, 4 h), Neffiken, Lord of Kelek`Vor and Gurebk, Lord of Krendic (Plane of Storms, 3 h).
  260 on the board. The six on 6 h or less are short-timer bosses (§isShortTimerBoss): on the board and in Active
  Cooldowns, off the spawn alerts, `lockout:false` like their Bastion siblings; the tests that pinned "exactly the eight" now name them.
- ⚠ **Open: the 61 scripted spawns are NOT on the board**, because their cooldown is unknowable from the catalog. They are the
  event and boss mobs of the planes: Falto, Ston`Ruak and Jeplak (Storms), Rydda`Dar (Halls of Honor), Rizlona and The Protector of
  Dresolik (Tower of Solusek Ro), Pherlondien Clawpike, the four Avatars (Wind, Smoke, Mist, Dust) and Melernil, Inlokher, Escalardian
  (Air), Pwelon / Nrinda / Vamuil (Water), Azobian, Javonn, Reaxnous, Warlord Prollaz, Omni Magus Crato, Chancellors Kirtra and Traxom,
  Hebabbilys (Fire), and the Earth event set, plus Rallos Zek / Vallon Zek's instance bodies (already on the board by name). They need
  a kill or a PQDI read to learn the timer.

## §208 — Zone timers: the stampede timer follows you into the zone (2026-10-08, bot 3.1.233 · agent 3.7.115)
*2026-10-08 · DECISIONS-2026-09-21.md · Stampede timer follows you into zone*

**The ask** (the guild lead, on the Plane of Tactics stampede): *"if one person had the stampede window it should go to anyone
currently in the zone when it opens"*. Picked **B — the timer follows you in** (over a bot-side announce): a raider who zones in
after `You hear the pounding of hooves.` gets the countdowns that are still running, with the time left, and they end with
their own end text. Then two more calls the same evening: the window has an **earliest and a latest** bound, it **clears for
everyone** when the latest passes unobserved or a fresh sighting replaces it, and it **survives a bot restart** in bot_kv.
- **The tag contract.** A guild_triggers row opts in with the tag `zone-timer` (`tags` is `text[]`). The bot reads the tag
  itself (`_zoneTimerTriggerMap`, one select by tag, 2-min cache, only when a relayed fire names a trigger), so it works
  whatever agent the OBSERVER runs. Tagged rows sharing a `source_pack` are ONE window: the shortest timer is the earliest
  bound (`min_at_ms`, "window opens" 2400 s), the longest the latest (`max_at_ms`, "stampede by" 7200 s). A tagged row with no
  pack is a window of its own. The relay's 3600 s clamp is raised to 4 h for tagged rows only. **Do not tag "Tactics: boar
  stampede incoming"** (15 s, overlay + TTS): it would be handed to late joiners, and the point is that it is never replayed.
- **Why the bot reads the tag, not the agent:** carrying a flag from the agent would only work once every observer updated
  Mimic; the bot already holds `trigger_id` on every relayed fire, so a tag set in the database works on the whole fleet the
  moment the bot deploys. Only the LISTENER needs agent 3.7.115.
- **A window and how it ends** (`utils/zoneTimers.js`): waiting before `min_at`, open until `max_at`, then cleared:
  `expired_unobserved` when `max_at` passes with no sighting (the stampede happened and nobody with Mimic heard it, so the
  old countdown is wrong and is never handed out again), or `replaced_by_sighting` when anyone in the zone hears the next one
  (more than 2 min after the held window's sighting; inside 2 min it is another observer of the same emote). One `cleared`
  record per pack + zone stays, so a page can say "no timer, the last stampede went unobserved". An older straggler (a
  queue backlog) never brings a replaced window back.
- **Placing the zone.** The bot knows the sender's live zones, not which character heard the line. One live zone places it;
  several (a boxed trader in the Bazaar) place it only in a zone that already has a window or cleared record for that pack,
  otherwise the sighting is skipped and the next observer places it. A wrong-zone window would hand a stampede timer out in
  the Bazaar.
- **Delivery.** `_recentFiresFor` appends, after the ring's own fires, one `late_join` fire per still-running timer of each
  window whose zone the listener stands in: `actions: []`, `timer_duration_sec` the timer's FULL length, `fired_at_*` the
  original stamps (so the agent's clock translation lands it on the listener's clock), plus `window_id`, `window_status`,
  `remaining_sec`, `end_text`. Once per listener while they stay in the zone; leaving forgets it. Never to an observer of
  that window. Raid mode carries no zones in the scope, so the listener's zones come from the warm live-state caches.
  Late joiners after the 40-minute mark get only "stampede by". This differs from the brief on purpose: sending the full
  length from the original time (instead of the remaining time) keeps the bar's proportion right and gives an older agent the
  correct end too.
- **Agent** (`_runLateJoinFire`, 3.7.115): a `late_join` fire skips the 15 s ghost TTL and the fire dedup, runs NO actions, and
  arms the trigger's own countdown from its own definition (end text, warnings, colour; the bot's fields are the fallback).
  Skipped when it already runs that trigger's countdown from the same window (started within 2 min of the sighting), so an
  observer or a live-relay receiver never gets a second end callout; a countdown from an OLDER window is replaced.
- **Older agents:** a `late_join` fire is older than their 15 s ghost TTL, so they journal it as stale-skipped and drop it.
  Inside the first 15 s they arm the same correct countdown through the normal relay path, without the end text (a relayed
  timer has never carried one; see below).
- **Storage: bot_kv key `zone_timer_windows`**, never state.json. Write-through on every record, replace and expiry; expired
  windows are cleared on load. Plain JSON the website can read with the service role:
  ```json
  { "windows": [{ "window_id": "potactics-stampede|Drunder, the Fortress of Zek@1791234567890",
                  "trigger_name": "Tactics: stampede by", "zone": "Drunder, the Fortress of Zek",
                  "observed_at_ms": 1791234567890, "min_at_ms": 1791236967890, "max_at_ms": 1791241767890,
                  "pack": "potactics-stampede", "fired_at_ms": 1791234567000,
                  "timers": [{ "trigger_id": "<uuid>", "name": "Tactics: stampede window opens", "duration_sec": 2400,
                               "ends_at_ms": 1791236967890, "end_text": "…", "cooldown_seconds": 120 }] }],
    "cleared": [{ "trigger_name": "Tactics: stampede by", "zone": "Drunder, the Fortress of Zek",
                  "at_ms": 1791241767890, "reason": "expired_unobserved", "pack": "potactics-stampede" }] }
  ```
  Times are epoch ms on the bot's clock (`observed_at_ms` is the skew-resolved sighting). `trigger_name` is the longest
  timer's name. `reason` is `expired_unobserved` or `replaced_by_sighting`. **No discord ids or character names are
  stored**: who saw a window and who was handed it stay in memory. After a restart a listener still in the zone (an observer
  included) is handed the window once more, which the agent skips because it already runs that countdown. A failed bot_kv
  read or write is logged and the ledger runs from memory; it never throws into the relay POST. The `zone` is the live-state
  long name (Plane of Tactics is `Drunder, the Fortress of Zek`). No web code yet: a wolfpack.quest/boards countdown is a
  separate beta change.
- **Cost:** one guild_triggers select per 2 min while relays arrive, one bot_kv upsert per sighting or expiry, and nothing
  per poll while no window is open.
- **Not done, flagged:** a timer armed through the NORMAL relay (someone in the zone whose own log missed the emote) still
  has no end text, because `_runRelayedFire` builds its trigger without one. Pre-existing, outside this change.
- **The guild lead runs this to switch it on** (not run by the session):
  ```sql
  update guild_triggers
     set tags = array_append(coalesce(tags, '{}'::text[]), 'zone-timer'), updated_at = now()
   where guild_id = 'wolfpack'
     and source_pack = 'potactics-stampede'
     and name in ('Tactics: stampede window opens', 'Tactics: stampede by')
     and not ('zone-timer' = any(coalesce(tags, '{}'::text[])));
  ```
  It should report `UPDATE 2`. The bot picks the tag up within 2 minutes; no deploy needed after the bot change is live.

## §267 — The Map takes the boss board's respawn over the spawn mirror's (2026-10-13, bot 3.1.256 main)
*2026-10-13 · DECISIONS-2026-09-21.md · Map uses boss board respawn over mirror data*

- **The ask** (the guild lead, Bastion of Thunder Map timers at "up in 5h35m"): *"timers were updated for the named in
  here to 3 hours not 6"*.
- **Cause:** `eqemu_spawn2.respawntime` is still 21600 s for every BoT named. The weekly eqemu dump lags the live
  server's change. `data/bosses.json` already said 3 h (and 6 h for Emmerik and Evynd).
- **Fix:** `utils/zoneSpawns.js` uses the board's `timerHours` for a point whose NPC is on the board with
  `lockout: false` (there the hours ARE the respawn; on a lockout boss they are the lockout). An instanced point stays
  null. So the board is now the override for any spawn time the mirror has wrong: fix the board entry, not the map.
  Test: `test/zone-spawns.test.js` (mutation-checked both ways).

## §275 — A corrected respawn reaches every running Map timer within the hour (2026-10-13, agent 3.7.159 beta `25c9d7ed`)
*2026-10-13 · DECISIONS-2026-09-21.md · Corrected respawn reaches running map timers hourly*

- **The report** (the guild lead, a screenshot of the Bastion of Thunder named still counting ~6 h): *"Still has the
  wrong timers"*. §267's bot fix was live (07:32 UTC) and correct; Oreen Wavecrasher died at 14:22 UTC and still ran
  6 h.
- **Cause, two parts, both in the agent:** (1) each Mimic re-checked its cached zone data once a day, so a copy taken
  before the fix kept 6 h; (2) a timer's window was worked out once at the death and stored.
- **Now:** the zone copy is re-checked hourly (a 304 when nothing changed), and every pass re-works each running
  timer's window from its death time and the point's current respawn. The death time never moves; with no zone data
  loaded, a timer is left as it was.
- **Rule for later:** a stored timer is a death time plus the point's CURRENT respawn, never a frozen window. A fix
  to a respawn on the board reaches the Map within an hour, for kills already counted too.

## §441 — After the first Bertoxxulous wipe: the event clock, missing deaths, and shared-bank accounts (2026-10-26)
*2026-10-26 · DECISIONS-2026-09-21.md · Bertoxxulous event clock window from script*

- **Bertoxxulous, from the server script** (`SecretsOTheP/quests` `codecay/encounters/Bertox.lua` @ ea0c7661, lines 22,
  79-80, 198-215, 357-368): no despawn timer of his own; he lives inside a 123-minute event window that starts at the
  Spectre of Corruption's death (warning 5 min before), then everything event-spawned is cleaned up. A failed attempt
  re-arms the Spectre after 5 min; a kill sets it to 66 h (matches `data/bosses.json`). Triggered by the Spectre, then
  trash, 8 Adan kings by kill count, the final 4, then him. The script spawns him in Crypt of Decay, where
  `data/bosses.json` says Plane of Disease (not yet changed).
- **The wipe (2026-10-25, 11:32 pm ET):** 59 engaged, 42 died, 17 survived; the first two deaths were bards. The parses
  missed the first death entirely; the position data (3-second frames, health 0 = dead, health -1 = unknown) had all 42.
  An officers-only review was written as a private doc the guild lead shares (its link is not in this repo); its data
  is read with the queries in this session's notes: `raid_track_minutes` frames, 7 values per raider, 6th = HP.
- **Two Mimic log-reading gaps, fixed on beta (agent 4.0.22):** the uploader's own "You have been slain by X!" was never
  read (the byte filter dropped it and the parser had no first-person pattern), and other raiders' deaths were kept
  only for names already confirmed by /who, chat or heals; Zeal raid-list names now confirm a player.
  `test/death-self-and-raid-reading.test.js`. Ships to the fleet with the next Mimic beta, then stable.
- **Shared banks on Mimic's "On this PC" inventory** count accounts by guessing from bank snapshots (23 for the guild
  lead), while the owner's own placements on /me/accounts (35 characters on 6 game accounts) are only used by the
  website's /me/inventory. A draft that merged tiny identical banks was NOT shipped: the guild lead's smallest bank is 11
  slots, so it would change nothing. Next: let the local page use the placements.
- **FB-97** — CORRECTED in §442: the name in the report is the Plane of Innovation flag NPC, not a character.
