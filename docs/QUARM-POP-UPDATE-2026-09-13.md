# Quarm — Plane of Power progression & server update (captured 2026-09-13)

*Source: the "Plane of Power Progression & Server Update" post in the guild
Discord on 2026-09-13 (posted by Kyinen), captured from Hitya's screenshots.
Server-side rules, not ours. Where a section was not in the screenshots it is
marked **NOT CAPTURED** — do not fill those from memory or other servers.*

**Standing caveat:** the post says some changes were "still awaiting final
merge/deployment" and the Luclin section is "specifically still pending
approval". Treat every number here as *announced*, verified only when a live
kill or `#popflags` output confirms it.

---

## 1. The three timers (vocabulary the whole post uses)

| Timer | Meaning |
|---|---|
| **Successful-kill respawn / reuse** | how long the event stays down after you beat it |
| **Failed-event retry** | how long after the raid FAILS before the encounter or its trigger is available again — usually much shorter |
| **Active event window** | time to finish a scripted event once started; expiry = fail, then the retry timer starts. Not the respawn |

## 2. Respawn and lockout schedule

| Class | Successful kill | Per-character lockout |
|---|---|---|
| Standard PoP raid bosses (the 66-hour cycle, §3) | **66 h** | **66 h** |
| The four elemental gods (Xegony, Coirnav, Fennin Ro, Avatar of Earth) | **5 d 18 h (138 h)** | **5 d 18 h** |

- A wipe does **not** mean waiting the full successful-kill timer; scripted
  events have their own (shorter) failed-event retries, listed per zone below
  where captured.
- The post calls the per-character timer a "loot lockout". Our own rule stands
  (`CLAUDE.md`, Hitya 2026-08-21): on Quarm a raid lockout is an **engage**
  lock — a locked character is ported out on engage. Keep our wording; the
  duration is what the post gives.
- "The selected spawns have no random timer variance" (stated for the trash
  list; the boss cycle is given as a fixed schedule). ⚠ Our bot applies ±20% to
  every timer (`utils/state.js`, `utils/supabase.js`, the kill cards) — see §8.

## 3. The standard 66-hour cycle (as listed)

**Bastion of Thunder / Halls of Honor / Tactics / Valor:** Agnarr the Storm
Lord · Lord Mithaniel Marr · Tallon Zek · Vallon Zek · Rallos Zek the Warlord ·
Aerin`Dar.
**Nightmare / Disease / Decay / Torment / Justice:** Terris Thule · Grummus ·
Bertoxxulous · Carprin Deatharn · Saryrn · The Seventh Hammer.
**Plane of Air:** Queen Silandria · Arch Mage Alchtonion · Gakamenial
Fir`Disralsi · Rinturion Windblade · Baltaldor the Cursed · Sigismond Windwalker.
**Tower of Solusek Ro:** Arlyxir · Jiva · Rizlona · Xuzl · Guardian / Protector
of Dresolik · Solusek Ro.
**Plane of Fire named:** Arch Mage Yozanni · Babnoxis the Spider Queen ·
Blazzax the Omnifiend · Criare Sunmane · General Druav Flamesinger · General
Reparm · Jaxoliz Dawneyes · Magmaton · Pyronis · Quavonis Firetail.

Not on any captured list (so NOT confirmed 66 h): Xanamech Nezmirthafen,
Manaetic Behemoth, Ture, Mujaki, Askr the Lost, Charassis, Keeper of Sorrows,
the Plane of Water named, everything in Plane of Time, Quarm.

## 4. Access and trash respawns

- PoP gameplay and progression zones require **level 46**. Plane of Knowledge
  stays open to everyone.
- Standardized open-world trash, **no variance**:
  - **19.5 min** — Bastion of Thunder, Crypt of Decay, Plane of Nightmare,
    Plane of Storms, Plane of Torment, Tower of Solusek Ro
  - **25.5 min** — Plane of Air, Plane of Fire, Plane of Water

## 5. Per-zone event rules (captured parts)

**Plane of Justice** — trials "cleaned up considerably": success → trial
reopens after **10 min**; fail → retry after **1 min**; failed participants
returned after a short cleanup; successful ones get a warning before the room
clears; boss corpses stay **8 min** to loot; pets and leftover hate cleaned up
on removal. The Seventh Hammer: standard 66 h.

**Plane of Nightmare — Hedge Maze** — expanded for raid-sized flagging: each
room supports **24 players**; unstarted rooms warn and self-clean; success and
failure remove players, pets and hate properly; **Thelin receives Spirit of
Wolf** when the event begins. Terris Thule: standard 66 h.

**Crypt of Decay — Bertoxxulous** — recovery improvements: event trash uses a
**3 min 50 s** instance respawn override; opening sequence shortened; defeat →
event returns after 66 h, lockout 66 h. **Fail → NOT CAPTURED** (screenshot
ends at the heading).

**NOT CAPTURED (between Bertoxxulous and "Other Server Cleanup"):** whatever
the post says about Torment (Keeper / Saryrn), Innovation, Storms / Askr,
Valor, Halls of Honor trials, Tactics / the Rallos event, Tower of Solusek Ro
windows, the four elemental planes' failed-event retries ("listed in their
individual sections below"), and Plane of Time / `#timelockout` semantics.

## 6. Other server cleanup

- Offline Bazaar traders no longer appear in broad player listings as online.
  (⚠ Relevant to `/who` harvesting and `who_observations`: fewer trader
  ghosts, and any "online" inference from listings changes shape.)
- NPCs no longer equip player-handed fishing poles, torches, light sources or
  inappropriate bows as weapons; normal NPC equipment unchanged.

## 7. Luclin — PENDING APPROVAL (not final)

- Vex Thal warders would no longer spawn.
- Emperor Ssraeshza's guards would no longer respawn.
- Neither removes bane requirements: **Emperor Ssraeshza and Lord Seru still
  need their bane weapons.**
Do not change raid notes on this until it is announced as live.

**Guild 1 / PvP Changes — NOT CAPTURED** (only the heading was in frame).

## 8. Player progression commands (the big one for us)

- `#popflags` — overall PoP progression for the character.
- `#popflags 1` … `#popflags 5` (also `tier1`–`tier5`) — one tier.
- `#timelockout` — the guild's Plane of Time timeline and encounter
  availability.

Output vocabulary seen in the screenshots (the lines arrive as server text in
the chat window; **the exact log-file line format is not yet captured** and
must come from a real `eqlog_*` excerpt before anything is parsed):

```
=== Planes of Power Progression ===
Tier 1: In progress / Tier 2: Not started / … / Tier 5 - Plane of Time: Not started
Details: #popflags 1, 2, 3, 4, or 5 (tier1-tier5 also work).
=== Tier 1 Progression ===
--- Plane of Justice ---
Mavuin's case: The evidence needed to save Mavuin has been requested
Seventh Hammer access: Locked
--- Plane of Disease ---
Fuirstel progression: The Ward was recovered
Crypt of Decay access: Unlocked
--- Plane of Nightmare ---
Thelin progression: Not started
--- Plane of Innovation ---
Factory door access: Locked
Giwin and Manaetic Behemoth progression: Not started
=== Tier 3 Progression ===
--- Halls of Honor ---            Halls of Honor trials: None completed · Mithaniel Marr cipher half: Incomplete
--- Bastion of Thunder ---        Agnarr and Karana progression: Not started
--- Plane of Tactics ---          Giwin and Zek progression: Not started
--- Grand Librarian Maelin ---    Cipher information / Zebuxoruk lore / Combined Zek information / Final elemental information: Missing
                                  If one of these is missing, hail Maelin and ask about new lore and new information.
--- Tower of Solusek Ro ---       Xuzl / Arlyxir / Dresolik / Rizlona / Jiva: Incomplete|Complete
Plane of Fire progression: Not started
```

**Why it matters:** this is the authoritative per-character flag state the
`/pop` page has been waiting for. Today the agent only sees the self-only
"You have received a character flag!" line and witnessed hails
(`HANDOFF-pop-quest-extract.md`); a `#popflags` dump answers every gate at
once, for any character that types it. Design: agent recognises the
`=== … Progression ===` block in the log, parses the `key: value` lines into a
structured state, uploads it to `pop_flags` (or a sibling table keyed by
character + tier + line), and `/pop` prefers it over inferred grants. Needs a
real log excerpt first — the chat-window screenshot does not show the
line prefix.

## 9. Missing launch-era loot restored

| Item | Source | Rate |
|---|---|---|
| Ossein of Limitless Time | shared Plane of Time Phase 3 pool | — |
| Bo Staff of Transcendence | Cazic Thule | independent 10% |
| Recurved Wormwood Bow | Mujaki the Devourer | independent 10% |
| Alabaster Hilted Wind Bow | Avatar of Smoke | independent 10% |
| Ornate Abalone Recurve Bow | Krziik the Mighty | independent 10% |

Our `eqemu_*` loot mirror comes from the weekly server dump
(`sync-quarm.yml`); check after the next sync that these rows appear
(`eqemu_npc_drops` for the four NPCs) — if the dump lags the deployment, the
wishlist picker and Mob Info loot tab will not know them.

## 10. What changes on our side

| Item | Where | Status |
|---|---|---|
| PoP boss timers: 66 h standard, 138 h elemental gods; Aerin`Dar → Plane of Valor, Agnarr → Bastion of Thunder (were wrong zones) | `data/bosses.json` | **done 2026-09-13** (PoP is locked until 10-01, so no live timer moves) |
| No-variance timers for PoP (bot applies ±20% everywhere) | `utils/state.js`, `utils/supabase.js`, kill cards in `index.js` | **open** — needs a per-boss `variancePct` (0 for PoP) honoured in the three sites + card text |
| Overlay notes: the timer rules, trash respawns, Justice / Hedge / Bertox facts | `apps/mimic/pop-raids.js` `quarmGlobalNotes` + encounter callouts | **beta** (agent-side data only) |
| `#popflags` / `#timelockout` parser → authoritative flags on `/pop` | agent + bot + `pop_flags` | **open** — blocked on a real log excerpt of the output |
| Restored loot visible in Mob Info / wishlist | weekly eqemu sync | **verify after next sync** |
| Luclin: VT warders, Emp guards | raid notes | **wait** — pending approval upstream |
| The uncaptured sections (§5, PvP) | this doc | **needs Hitya's screenshots** |
