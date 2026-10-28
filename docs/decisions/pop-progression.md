# PoP flags & progression

#popflags, the Seer and Maelin, flag checklists, quests. Oldest first. Find an entry by its ID in [the index](README.md); new decisions go in `inbox/` and are merged here.

## 2026-08-20/11 — PoP spell turn-ins are LEVEL TIERS, not per-class lists
*2026-08-20 · DECISIONS-2026-08-20.md · Spell turn-ins are level tiers, not per class*

**The finding.** The quest script hands a random spell per turn-in item, which
reads like a per-class pool needing every NPC's script. Resolving all 25 spells
in the one script we had (a cleric NPC) against the catalog showed the pools are
level tiers with no overlap: **Ethereal Parchment 61-62 · Spectral Parchment
63-64 · Glyphed Rune Word 65**. Tier is therefore a function of the spell's
LEVEL, which `spell_level_seed` holds for every class — one script generalises
to all of them.

**Held as one witness, not a law.** `web/lib/popSpells.ts` records the
provenance and returns null for an unknown level rather than guessing;
`docs/HANDOFF-pop-quest-extract.md` asks a local session to try to FALSIFY it
against another class's script.

**Shipped with it (web 1.1.86):** `pop_spell_needs(guild)` — each main × the
PoP spells they haven't scribed, ordered by character level desc so
first-to-level is first in the queue; restricted to mains who submitted a
spellbook, because without one we can't tell "doesn't have it" from "we don't
know". /pop renders needs-per-tier and takes spellbook submissions. First cut of
the RPC timed out at 60s scanning every 'Spell: %' item; rebuilt from the 209
seeded PoP rows.

## 2026-08-21/1 — PoP flag coverage for raiders without Mimic: witnessed hails (the guild lead)
*2026-08-21 · DECISIONS-2026-08-21.md · Witnessed hails record flags for non-Mimic raiders*

**The call.** *"we need people that don't use mimic to be covered as well. When
someone Hails a flagging NPC and we see that from a mimic-enabled raider, we
should record that as a proper flag when hailing is the thing that correctly
grants a flag (or saying a key phrase)."*

**Why the gap exists.** The authoritative line — "You have received a character
flag!" — is a SELF message. It only ever reaches us for people running Mimic,
which is exactly the population that doesn't need help. A hail is visible to
everyone in range, so one Mimic user in the zone covers the rest.

**The privacy shape is the interesting part.** Public `says` chat is dropped at
the byte filter and stays dropped; agent **3.6.4** adds ONE exception: a say-body
that begins with "Hail". Not say-chat, not shouts, not OOC — and "we should hail
him after" is not a hail. Stored: hailer, NPC, zone, time. Written up in
`docs/PRIVACY.md` AND in member-facing language on `/privacy` (web 1.1.87),
because a filter change people can't see is one they can't consent to.

**Evidence, not proof.** A hail only grants a flag if the hailer already meets
the prerequisites, which we cannot see. Rows carry `source='hail_witnessed'`
and must never render as equal to a self-reported grant.

**Which NPCs matter is a BOT decision**, not an agent one, so the list grows
data-only with no agent release. That matters because the catalog names three
flagging NPCs today. `docs/HANDOFF-pop-quest-extract.md` is the local-session
runbook for the full list — and for the phrase list, without which the "or
saying a key phrase" half stays unbuilt (we will not hunt for phrases by
capturing arbitrary say-chat).

## 2026-08-25/1 — PoP parchment pools come from the quest scripts, not spell levels (Lacunanight's catch)
*2026-08-25 · DECISIONS-2026-08-25.md · Parchment pools come from quest scripts*

> "The spells I think are double dipping on the Matrix page … Necros have 9
> spells but shows 12" → "Necro turns in a Glyphed and can only get 3 spells
> which the matrix shows as correct but we have 4 spells at 65 but because we
> can get one through cleric with a 64 scroll it is not counted."

First night with site access (via the new invite flow) and he found a real
data bug — with the Quarm quest source in hand. The v1 page inferred parchment
pools from spell LEVELS (one-witness cleric inference, flagged as such in its
own header). The second witness broke it: pools are hand-curated per class in
the trainer scripts, and multi-class scrolls (Destroy Undead, cleric 64 /
necro 65) live in ONE class's pool.

**The fix was already in our database.** `scripted_npc_turnins` (the
ProjectEQ quest mirror, imported 2026-06) holds every PoK trainer's exact
per-parchment reward list. Verified against Lacunanight's live-Quarm
screenshot: the necro Glyphed trio (Blood of Thule / Child of Bertoxxulous /
Word of Terris) matches byte-for-byte.

- **`pop_parchment_pools` view** (migration 20260825030000): per (class,
  tier, scroll). The trainer's class is DERIVED — `bit_and` over the pool's
  scroll class-bitmasks resolves to exactly one class bit for all 13 PoK
  trainers (verified; both druid Wanderers collapse to one pool) — so a
  script re-import updates pools with no view change.
- **`pop_spell_needs` v2**: gains a `tier` column (the parchment that buys
  the spell FOR THAT CHARACTER'S CLASS); membership now also matches
  `'Song: %'` — **the old `'Spell: %'` filter silently dropped every bard
  reward** (Minstrel Eoweril's 19 rewards are all Songs). Bard pools: 8/8/3.
- **/pop matrix**: buckets by script-truth tier, plus an **Other** column for
  needed-but-not-from-your-turn-ins (research, or another class's tradeable
  scroll) — visible instead of miscounted, which was the "double dipping".
- **Spell-page badges** name the parchment from the pools; a PoP spell
  outside the class's pools says "not a turn-in" rather than guessing.

**Known divergence, deliberately left open:** our mirrored necro Ethereal
pool holds 7 scrolls; Lacunanight counted 8 in Quarm's (Lua) script. Quarm's
fork differs by ~one spell there. ProjectEQ ≈ Quarm everywhere we could
verify, so the mirror ships as the source — but the reconcile needs Quarm's
actual script files (⚠ needs a local session via
`docs/HANDOFF-pop-quest-extract.md`, or Lacunanight's copy of the repo).

**Queued, found while here:** `character_missing_spells` (the non-PoP
missing-spells path) likely has the same `'Spell: %'`-only filter — bards
under-served there too. Not expanded tonight (minimal diff).

## 2026-08-26/1 — PoP page: My Characters tab, and default views scope to mains (the guild lead)
*2026-08-26 · DECISIONS-2026-08-26.md · PoP page My Characters tab, default mains*

> "let's have a my characters mode on the pop page for individuals can track
> all of their characters in one place. due to the nature of pop flagging
> they may do it for many of their toons and we shouldnt only track mains.
> we should default our views to mains"

Two calls, opposite directions, both land in `web/app/pop/page.tsx`:

1. **Guild-wide surfaces (chart, matrix, planner, "PoP spells ... still
   need") default to `?scope=mains`**, with a one-click toggle to
   `?scope=all`. That's the number an officer planning a raid night wants —
   how many MAINS can walk into a zone tonight — without alts inflating or
   deflating it.
2. **A new `?view=mine` tab ignores scope entirely** and always shows every
   character linked to the viewer's account (`ownedCharacters()`, same helper
   `/me`'s inventory page uses) — main and alt alike, same table shapes as
   Matrix (zone access) and the spell-needs table, plus which of their
   characters have no spellbook on file yet (a distinction the guild-wide
   table can't make in aggregate — see its long-standing "nothing missing, or
   nothing submitted" hedge, unchanged, it just doesn't apply per-character
   the way `?view=mine` can afford to check).

**Required widening `pop_spell_needs` off main-only** (migration
`20260826010000_pop_spell_needs_all_characters.sql`) — it now returns every
non-deleted, non-excluded character with a submitted spellbook (main or alt)
and an `is_main` column per row, so the mains-default and the My Characters
view both read the same RPC and just filter differently. Signature changed
(new column) → dropped and recreated, same pattern as every prior
`pop_spell_needs` revision.

### ⚠ The widening exposed a real perf bug, not caused by widening itself
Going from 28 mains to 117 eligible characters (4.2×) turned a latent problem
into a reproducible 60s+ hang calling the function directly: the per-character
level lookup was a **correlated subquery against `who_directory`** — a view
with six `DISTINCT ON` / `GROUP BY` passes over the full `who_observations`
table (120k+ rows), not materialized. Postgres can't push a character filter
below those passes, so *every row* of the candidate set re-ran the entire
view — measured at 267k buffer hits for one run; ×117 ≈ 31M. Fixed with a
plain `LEFT JOIN who_directory wd ON wd.character_key = lower(c.name)`
instead of `(SELECT MAX(w.level) FROM who_directory w WHERE ...)` — the view
computes once, characters hash-join against it. Verified against prod:
1.185s end-to-end for all 2,550 output rows. `who_directory` already returns
one row per character (its own internal `DISTINCT ON`), so the join is exact,
not an approximation of the old `MAX()`.

**Lesson for next time a guild-wide RPC's input set gets widened**: if it
touches `who_directory` (or any other unmaterialized multi-pass view) via a
correlated subquery, check whether the row count multiplier turns a "fine at
N" query into "broken at 4N" *before* shipping — `EXPLAIN ANALYZE` on the
inlined function body (not the wrapped `SELECT * FROM fn(...)` call, which
Postgres treats as an opaque black box and won't show the real plan) is what
caught this.

Shipped: web 1.1.97, migration applied + committed, `test/pop-spell-needs-all-characters.test.js`
(9 cases) guards both the mains-only-filter removal and the join-not-subquery
fix so neither regresses silently. Full test suite green (2,340 passed),
`tsc --noEmit` clean.

---

## §296 — The hedge maze board opens on Thelin's first flag, not on the hails that start the maze (bot 3.1.262, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Hedge maze board opens after last boss*

- **The call (the guild lead, 2026-10-14, from a morning raid):** *"This is supposed to come up after the last
  boss dies, not right at the beginning of the hedge event, based on the raid"*; *"the one on the inside won't
  give you flags until after he talks to terris thule at the end."*
- **Why it popped early:** §285's opener fired on hails from two raid groups inside a minute. Raids hail Thelin
  in groups to START the maze, so that is the first thing it saw. The production rows show it: a burst of
  Thelin hails at 14:48–14:51 UTC, no grant.
- **What the script says (`ponightmare/encounters/Maze.lua`):** a hail gives a flag only in state 4. State 4 comes
  after the last construct dies, its shard is handed in, and Terris-Thule's talk ends. Both state-4 answers are
  rows we already store: "Please destroy her…" (`thelin_2`, said even to raiders who already hold it) and
  "I do not recognize your face…" (`cl_maze`). State 4 also starts Thelin's 10-minute depop.
- **Where it landed:** `utils/hailBoard.js` `noteGrants` replaces `noteHails`. The first `thelin_2` (event) or
  `cl_maze` (checklist) row whose zone resolves to `ponightmare` opens the window, which runs 10 minutes
  (`minutes: 10`) from that grant. Recitals, other zones' Thelins and zoneless rows open nothing. Hails no longer
  open anything; inside an open window they still count as seen. The two-groups rule and `GROUPS_WITHIN_MS` are
  gone. `index.js` `_hailGrants(rows)` passes every stored row.
- **Known limit:** if no raider with Mimic hails Thelin in state 4, nobody's grant reaches us and no board opens.
  That is the same reach the boss boards already have.

## §297 — "Latest flags" strip on /pop: two layouts on beta, awaiting a pick (web 1.8.152, beta `7257bed1`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Latest flags strip with two layouts*

- **The ask (the guild lead, 2026-10-14):** *"we should show a 'latest flags completed/verified' section at the top
  of the pop page."*
- **What it shows:** `pop_flags` rows from the last 7 days whose source is `event` (the server's flag line) or
  `recital` (an NPC recited it), each badged with its source. `checklist` and `hail_witnessed` rows are left out.
  Traders, hidden characters and known levels under 46 are filtered with the page's existing lists.
- **The two layouts:** `?flags=a` = newest first, one row per character per moment (rows within 90 s fold
  together, implied steps dropped). `?flags=b` = grouped by flag step. The param is not `?v=` because `/pop` already
  uses `?v=b|c` for the Essences queue. No param = production's page.
- **Open:** the pick; whether checklist rows should appear as "self-reported"; recital rows can look newer than
  the flag (the tooltip says so). Files: `web/lib/popLatestFlags.ts`, `web/app/pop/LatestFlags.tsx`,
  `test/pop-latest-flags.test.js`.

## §302 — /pop: alts grouped under their main, latest-change sort, 24 h / 3 day highlights (web 1.8.153, beta `6def4593`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Flag matrix groups alts under mains*

- **The ask (the guild lead, 2026-10-14):** *"Lets group the flagging for alts by main with collapse turned on, we can expand all
  from a button. Then if we want to sort by latest changes, highlight the things that have changed in the last day, and last 3 days."*
- **The calls:** grouping is on the Matrix only, behind `?alts=group` (`&sort=latest`, `&open=1` to expand all). Native `<details>`,
  collapsed by default; the summary line carries the family's newest change. A "change" is an `event` or `checklist` row, or a
  recital that newly added a flag (no earlier row for that character + flag). `hail_witnessed` is never a change. Buckets: 24 h
  (strong) and 3 days (soft). Main links come from `characters.main_name` at runtime; nothing is written into the repo.
- **Known caveat:** a character's first-ever recital marks every flag it recites as new at that moment.
- **Cost:** zero new queries; the page's existing paged `pop_flags` read adds `source`, the roster read adds `main_name`.
- **Where it landed:** `web/lib/popAltGroups.ts`, `web/app/pop/AltGroupMatrix.tsx`, `web/app/pop/page.tsx`; `test/pop-alt-groups.test.js`.

## §304 — Seer paste on the PoP guide; Start here and the figurine removed (web 1.8.154, beta `26737a4d`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Seer paste box on PoP guide*

- **The asks (the guild lead, 2026-10-14):** *"reverse engineer [takp.info/flag-check] so that peoples flags can just copy what the
  seer says and fix their flags and get next steps"*; then *"players need to be able to submit the seer's stuff at the top of the page
  with a collapsible text field"*, *"These top items can be removed, they're superflous"*, *"The intricate wooden figurine is not in
  the game right now"*.
- **Where:** a collapsed "Paste what the Seer says" box at the top of `/pop/guide` (all three layouts), not a separate page. It lands as
  the default on beta: the removals are shared data, so no variant param could gate them.
- **How:** the paste is read in the browser (`web/lib/popRecital.ts`); it ticks the guide's steps, rings the next step per open plane,
  lists closed planes and unrecognised lines. Save sends only matched sentences; the server re-reads them, checks the character is on
  the member's account, and writes `pop_flags` source `recital` at one time, skipping keys that already have a recital row. The raw
  paste is never stored. `RECITAL_STAGES` / `STAGE_IMPLIES` are copied into `web/` (it imports nothing outside), held in step by
  `test/pop-seer-paste.test.js`.
- **takp:** substring-match each Seer sentence to a per-chain level, then a hand-written decision tree. No licence stated; no code or
  text copied. Our 44 guided-meditation sentences are complete against Quarm's Seer script. Not yet read: the 14 "unlock memories"
  locked texts (a kill done, an earlier hail missing), the best next-step signal.
- **Removed:** the Start here section and the figurine step. `start_flag_fixers` (Seer + Maelin loop) and `start_traveler_manual`
  (Willamina chain) carry content that tests and Mimic's Quests mode use, so they moved to the Knowledge quests section, same keys.
- **Open:** keep or delete those two moved items; whether to tag pasted rows (e.g. `npc='web paste'`) so they can be told from
  Mimic's. Today they are identical, so a paste for your own character reads as a real recital.

## §306 — PoP guide in collapsible sections with a sidebar (web 1.8.155, beta `c717eb93`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · PoP guide collapsible sections with sidebar*

- **The ask (the guild lead, 2026-10-14):** *"Collapse all of the pop/guide stuff down into subsections, Tiers and plane of knowledge,
  move the POK stuff except for the seer at the top. Give a sidebar nav for the different sections to drop down. It should be a simple
  set of clicks."*
- **Shape:** the Seer paste stays first. Below it, closed sections Tier One … Tier Four and the Plane of Time (the `/pop` chart's own
  tiers), then the Plane of Knowledge. A tier's planes are sub-sections (the lower crypt, Temple of Marr and Ragrax fold into their
  parent). Each summary shows "n / m done" and "▶ next" when the Seer paste rings a step inside. Sidebar on wide screens, drop-down on
  phones; Expand all / Collapse all; URL hashes (`#tier-2-valor`, `#pok`) open on load and on back.
- **PoK after the tiers:** the tiers are the route; Knowledge is the side shelf (flag fixers, the Traveler's Manual, the Knowledge
  quests, the spells), and the Seer box already covers flag repair. Maelin hand-ins between raid kills stay with their tier; moving one
  is a line in `STEP_HOME`.
- **Open:** "▶ next" from Mimic data on this layout (today only the Seer paste drives it); whether to retire `?v=b` / `?v=c`.

## §307 — /pop opens on My Characters; missing spells collapsed with copy; wider chart (web 1.8.156, beta `6c704690`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · PoP page opens on my characters*

- **The asks (the guild lead, 2026-10-14):** *"The 'your pop spells still needed' should be collapsed and let you expand to see the full
  list and what the spell does, link to pqdi, and a copy button…"*; *"The pop flags page should start on your characters by default,
  with mains being the second toggle and all characters being the third (grouped by mains like I mentioned)"*; *"Pop flags breakdown
  should be a little wider and less dense."*
- **Toggles:** scope (`?scope=`) My Characters → Mains → All characters; view (`?view=`) Chart | Matrix. A bare `/pop` opens on My
  Characters (its table). All characters' Matrix groups alts under mains (`?alts=flat` opts out). Old links that name a zone, view or
  alts but no scope stay Mains; `?view=mine` is My Characters. Signed-in with no linked characters → Mains.
- **Spells:** a closed `<details>`; per character a copy line (≤200 characters, split "(1/3)" without cutting a spell) and per spell
  the PQDI link, level, scroll and a one-line description synthesized from `eqemu_spells` (no prose exists in the catalog). One chunked
  `eqemu_spells` lookup, My Characters only.
- **Chart:** full container width, 3 cards per row from `xl`, more padding, step rows that don't wrap the counts. CSS only.
- **Open:** whether the guild-wide spell table at the bottom collapses too; whether My Characters' Chart view shows your spells.

## §309 — /pop/latest [beta]: a grouped stream and stage cards in step order (web 1.8.157, beta `7167ca91`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Latest flags page grouped stream and stage cards*

- **The ask (the guild lead, 2026-10-14):** *"I like the verbose stream of A, but for flags that go together I think that a list view in
  alpha order by default would be helpful … There should be a collapsible latest section that has B's layout format, in order of stages
  and what relies on each flag … The (and 29 more) item isn't useful if we can't open it up. Make me a new beta page to try all of this
  out."*
- **What it is:** https://b.wolfpack.quest/pop/latest, linked from `/pop`'s header. Stream: characters who earned the same steps within
  5 minutes are one row (names A–Z by default, or latest first); with a live raid, a collapsed "N in the raid still need this". By
  stage (open by default): cards per progression line in dependency order, each step with its own plane, an expandable name list and an
  "unlocks →" line. Filters 24 h / 3 d / 7 d, Mains / All.
- **Fixes to the §297 strip:** a recital row shows only steps new to that character (repeats collapse); a step shows its own plane,
  never the zone the row was heard in (the Seer's Plane of Knowledge).
- **Calls:** chain order is derived (`NEXT_LINES` → `STEP_GUIDE` / guide flags → `STEP_IMPLIES`), no second order table; "unlocks →"
  also reads plane gates (so the hedge shows "enter Lair of Terris Thule"); every fold is a native `<details>` (`ExpandList`); "still
  needs it" counts event / recital rows only; idle chain steps show dimmed for context.
- **Cost:** one paged `pop_flags` read (90 days), one paged `raid_roster` read, the shared roster read, one levels call.
- **Open:** A–Z vs latest; dimmed idle steps; first-ever recitals still read as new (labelled "first recital").

## §373 — Raid night 2026-10-18: Halls of Honor trials, a rez-board NPC, three rampagers (bot 3.2.3–3.2.6, agent 3.8.2–3.8.4)
*2026-09-21 · DECISIONS-2026-09-21.md · Halls of Honor trial hail cards, rampagers*

Shipped live during the raid at the guild lead's request (*"can we push this during the raid as a hotfix"*, then
*"do it on beta too"*); the rest held until *"raid is complete"*.
- **HoH trial hail cards (bot 3.2.3 + 3.2.4, `[hotfix]`).** *"we did not get credit on the command center for this trial
  hailing - we should do it for each HoH trial."* `utils/hailBoard.js` `HAIL_TRIALS`: Trydan Faye opens on Rydda`Dar's
  death; Rhaliq Trell when all 12 villager attackers have died; Alekson Garn when Advocent Joran, Halgoz Rellinic and
  Freegan Haun have all died (`noteTrialKill`, within 15 min). 10-minute windows (the zone scripts' depop). 3.2.3 named the
  NPCs "Trydan Faye (trial 1)", which the agent's `_hailNpcWanted` never matches, so 3.2.4 made them bare — a window's
  `npc_name` must be the NPC's exact name. Trial 3 opened on the night and credited 59 raiders.
- **Trial credit lines (agent 3.8.3, beta).** The agent reads "An ethereal mist … the power of <NPC>." as a grant
  (`kind:'trial'`) and "You have already received credit for completing this trial." (the same words for all three) as
  held credit, naming the NPC this character hailed in the last 30 s. The bot: `utils/popFlagStages.js` `resolveTrial`,
  source `credit` in `PROOF_SOURCES`. Old agents send neither.
- **The dragon on the needs-rez board (agent 3.8.2, beta).** *"The dragon is on this list."* `isConfirmedPlayer` now
  refuses any name that is not letters only (a player's name never carries a backtick, apostrophe, space or digit), for
  every caller. `test/death-confirmation.test.js`.
- **Flag counter (bot 3.2.6).** *"shows only 1 flag used but 59 of us flagged"*: `flags_granted` counted only grants an
  agent saw. It now counts every hailed raider (grant, witnessed hail or tap), since each spends one of the cap.
  ⚠ The Mimic tooltip still says "counts only the flags we saw granted"; fix it with the next Command Center change.
- **Named bosses (bot 3.2.5).** *"The named bosses in Halls of Honor can be listed, same with the other major named
  bosses in the zones."* The catalog's `raid_target` is false for nearly all of PoP (5 NPCs flagged, not even Mithaniel
  Marr), and the weekly sync overwrites the table, so the fix is a committed list: `data/named-bosses.json` (140 bosses,
  20 zones, every entry tied to a catalog id) read by `utils/namedBosses.js` `raidTarget()`, which `_buildMobInfo` and
  `utils/zoneSpawns.js` now serve. `_MOB_PACK_VERSION` 9 rebuilds the zone packs. Agents see it within ~6 h (mob info)
  to 1–2 days (cached zone packs). Left out on purpose: the 12 villager attackers, The Tribunal, three HoH rare spawns.
  Not in the catalog: Charassis the Corrupter, Ture. `utils/charmPets.js` still reads the catalog flag alone.
- **Three rampagers (agent 3.8.4, beta).** *"for the third trial in HoH we have 3 bosses each with a rampage"*: rampage
  targets are tracked per attacker (`stats.currentRampages`), tank state carries `rampages: [...]` beside the unchanged
  `rampage`, and the Command Center draws one "💀 <boss>: rampage on <victim>" row each when 2+ are live (0–1: the old
  card, byte for byte). A named raid mob's rampage now speaks even when it is not the main target ("Rellinic rampage on
  X"); trash stays silent (#155). That rule reads `raid_target`, so it depends on the named-boss list above.
- **DPS meter seconds (Mimic beta).** *"dps totals look wrong and too high"*, *"not counting enough time on sec"*. The
  Oct 14 rule (each row's first hit to its last, 1 s minimum) made a lone nuke read as 1 s. The guild lead picked **A —
  first hit to the end of the fight**, plus *"if someone stops attacking … we stop their DPS Sec counter"*: the clock
  stops one tick (6 s, `DPS_IDLE_MS`) after a raider's last hit. `apps/mimic/overlay.html` `_rowSecs`/`_fightEndMs`;
  the total row and the Tank tab keep the fight's seconds.
- **FB-84 (a raider, new): a death log of the last 10–20 s before a death**, to judge the CH chain delay. Scoped, not
  built: nothing today keeps per-hit damage and heal landings before a death; the agent holds them in memory per
  encounter, and the bot receives but does not store them. Options for the guild lead: A local recap in Mimic/dashboard
  from the uploader's own log (cheap, beta only), B a cross-client per-death panel on the web (needs an upload + a
  table + a retention call), C extend the heal-gap and timeline data. Recommended first slice: A, one line per death
  ("died 3.1 s after the last CH landing; chain beat 12 s; took 9.4k in the last 6 s; killed by X").

## §24 — Keys assumed from NO DROP loot, for every keyed zone; quests and inventory get separate switches (2026-09-25)
*2026-09-25 · DECISIONS-2026-09-21.md · Keys assumed from no-drop loot in keyed zones*

The guild lead: *"we should separate out inventory versus quests"* and *"sweep
for no drop items from zones that require keys and make key assumptions for
them."*

**Which zones need keys — from the server, not memory.** `eqemu_doors` rows with
a key item that teleport into another zone (all `opentype` 58: each player
clicks the door with the key in hand, so one key-holder cannot let a group in).
Exactly five on the Quarm mirror: **Veeshan's Peak** (Key of Veeshan),
**Sleeper's Tomb** (Sleeper's Key — new; not keyed on classic live, keyed on
Quarm), **Howling Stones** (Key to Charasis — the old seed had no key item),
**Sebilis** (Trakanon Idol), **Vex Thal** (The Scepter of Shadows). Each zone's
one `zone_points` row sits on its door (the door's destination record), except
Veeshan's Peak's, ~200 units off — treated the same, unconfirmed.

**The rule, tightened** (`20260925112238`, made fast in `20260925112514`): an
item is evidence when it is NO DROP, drops in exactly one zone and that zone is
keyed, and is not a quest reward anywhere. Two changes from June's version:
- a drop's zone now also comes from the NPC id's zone prefix for NPCs with no
  placed spawn (scripted bosses) — +12 evidence items, and stricter where a
  scripted NPC drops the same item elsewhere;
- quest rewards are excluded — the sweep found five false positives: the four
  Resistance Stones (Sleeper's Tomb drops, also Shadowhaven rewards) and A Dusty
  Iksar Skull (Howling Stones, also a Cabilis reward). No evidence item is a
  tradeskill product.
Polarity re-verified: `eqemu_items.nodrop = false` means NO DROP on this mirror.

**The sweep** (`inferred_zone_access('wolfpack')`, service role only): 24
characters with Howling Stones access, 97 Sebilis, 64 Sleeper's Tomb, 69
Veeshan's Peak, 76 Vex Thal. Sebilis looks high and is real: the NO DROP
Fungus Covered Great Stick and Scale Shirt drop 100% from the Myconid Spore
King, a level 56 named on a 26-minute respawn that people have camped for
years (the tradeable Staff/Tunic come from ordinary myconids at 0.5%).
The quests page's "Inferred zone access" card uses the same rules and now knows
all five zones — live on production already, since it reads the database.
Per-call cost: 4.5 s in the first version, 168 ms after filtering to the
character's own NO DROP items first.

**Not done:** catalog quests for the Charasis and Sleeper's keys (there are none,
so those two zones show access but tick no quest), and a guild-wide keys view
("who can enter VT tonight") — the sweep function is there for one when wanted.

**The split** (on `beta`, `a77c58fd`; column live as `20260925112702`):
- `characters.show_quests_publicly` is new and backfilled from the old flag, so
  the 11 characters that had "Quests: public" on keep their quest pages public.
- `/me` has **"Quest page"** and **"Inventory page"** switches. "page" keeps
  them apart from the existing "Inventory: on / EXCLUDED" upload switch.
- The quests page gates on the quest switch; a visitor who can see the quest
  page but not the inventory page does not get the inventory listings on it
  (key-evidence names, discovery, stack turn-ins, rewards held, hidden/dismissed,
  the "probably don't need" lists, broken items).
- **Graduated, web 1.8.8 (same day).** The guild lead: *"go ahead, make their
  inventories private."* Those 11 characters only ever saw a switch labelled
  "Quests", yet it also shared their inventory. Their inventory pages went
  private (`20260925120704`), applied only after 1.8.8 was serving so their
  quest pages never showed as private under the old code; the quest pages stay
  public. Result: 0 inventory pages public, 11 quest pages public.
- Before graduation, production was unchanged: main read the old flag for all
  three pages until 1.8.8.

## §65 — The PoP checklist, `/pop/guide` (2026-09-28, web on beta)
*2026-09-28 · DECISIONS-2026-09-21.md · PoP checklist guide page*

The guild lead: *"we need a page made up for PoP guidance, where to start, what quests are must haves,
what can be done with a group or a raid or solo. Make this a checkbox type of thing."*
- **One list, 46 items, 8 sections:** start here, the PoK quests open now (the nine from the
  2026-09-28 PoK list, easy to hard with PQDI links), spells, tiers one to four, the Plane of Time.
  Each item says **Solo, Group or Raid** and whether it is a **must-have** (27 are). Items live in
  `web/lib/popGuide.ts`; the `key` is a storage key and must never be renamed.
- **Who-you-need is measured, not guessed:** every flag boss from tier one up is 150k HP or more in
  the NPC catalog, so it is a raid. The group work is tier-one trash, Grummus, the hedge maze
  (capped at 4 groups per dream by the patch), the Storms medallions (compound trash and minibosses
  drop them) and the parchment farming. Rows the classic chart has not confirmed for Quarm say
  "verify at launch".
- **Ticks are per character and saved.** A hand tick is a row in `pop_guide_ticks` (migration
  `20260928192730`, applied). A flag Mimic already recorded in `pop_flags` ticks its row by itself
  and locks it, so the page and `/pop` never disagree. Members only; you see and tick only your own
  characters (household and alt family, `ownedCharacters`); the action rejects unknown items and
  other people's characters before it writes.
- **Two layouts on beta:** A (default) is the path, one list in progression order with Solo / Group /
  Raid filter chips. B (`?v=b`) opens on "your next five must-haves", then Solo / Group / Raid
  columns. The pick is the guild lead's; the other goes when it graduates.
- Found on the way: the patch says Tranquility portals no longer let anyone in on level alone, but
  `/pop` still labels tiers two and three "Classic: 55 / 62 if unflagged". Label only (access maths
  ignores it). Not changed here.

## §65a — Live, with every flag step, /say and /map lines, and item cards (2026-09-28, web 1.8.31)
*2026-09-28 · DECISIONS-2026-09-21.md · PoP guide live with say and map copy*

The guild lead: *"this looks good, push it to live, add in mousover for any items mentioned, Put
Locations for anyone that we need to reach with a copy of /map <Y> <x>"*, then *"anything you have to
say should also have a copy button next to it with /say in front of it"*, then asked that the
[EQProgression flagging guide](https://www.eqprogression.com/planes-of-power-planar-progression-flagging/)
be fully folded in. "This" was the single-list layout (A); B was deleted in the same change.
- **The steps now follow EQProgression's checklist:** the talk BEFORE each boss, the planar-projection
  hail after it, the NPC to see afterwards, the zone-ins that set flags, the Tribunal plea, the three
  Halls of Honor trial hails, Karana's line, Maelin before and after the Zeks, the optional keys, and the
  way into Time. Also the two PoK flag fixers (Seer Mal Nae`Shi, Grand Librarian Maelin) and Gram
  Dunnar's free charm. 74 steps, 48 of them must-haves; 35 `/say` lines; 51 items with cards.
- **Every `/say` phrase was checked against the NPC's quest script** (`eqemu_quest_scripts`). Gram
  Dunnar has no script in our mirror, so his row says "verify at launch". The Seer also answers
  "delete", which clears flags; the page never offers it, and a test holds that.
- **`/map` is the NPC's placed spawn, Y then X,** the order `/loc` prints and Zeal's `/map` takes.
  Checked against PQDI, which labels its coordinates "(Y, X, Z)": the Seer is (-42, -224) in both. NPCs
  that only appear after an event (Karana, Tarkil Adan, the post-kill Giwin, Loreseeker Maelin) get a
  `/say` but no `/map`.
- **Items:** `[[Name#itemId]]` in a step renders the existing inventory item card on hover; one
  `item_card_info` call per render. A click on an item never ticks the box.

## §71 — The PoP checklist shows Willamina's whole chain (2026-09-28, web 1.8.34)
*2026-09-28 · DECISIONS-2026-09-21.md · Checklist shows full Willamina quest chain*

The guild lead: *"Willamina's quest needs Bolcen Tendag's section in it"*, then *"Follow the chain and
show the first item that seems to be required (gives you an item, spawns an npc, etc) and show the full
quest chain with minimize sections there. Highlight stages where you will have input/output."*
- **Traced through ten PoK scripts:** Willamina → Bolcen Tendag → Mirao Frostpouch → Oracle Cador →
  Onirelin Gali → Arch Mage Narik → Elisha Dirtyshoes → Boiron Ston → Caden Zharik → Agrakath Theric. It
  all hangs on one ground spawn: *History of Evils: The Age of Scale* on the upper level of Myrist
  (`/map -94 973`, one up at a time, 30-minute respawn, from `eqemu_ground_spawns`).
- **No NPC checks that you talked to it first** (every `event_trade` checks only the item), so with the
  book you can walk the ten hand-ins straight through.
- **On the page:** a gold "Start with this" box with the book and its `/map`; "Hand-ins, in order" (each
  row give → get, gold, with `/map`); "The story: who sends you where" (each NPC's `/say` and what they
  tell you). Both lists fold away. Every `/say` was checked against the NPC's `findi` keyword; Mirao,
  Boiron and Agrakath listen for phrases ("have come for the elixir", "like elisha dirtyshoes", "erase
  the debt"), written as sentences that contain them.
- The chain is data on the step (`GuideItem.chain`), so other chained steps can use the same view; a
  test holds that each hand-in gives what the one before it got.
- **It starts at Agrakath Theric (web 1.8.35).** The guild lead: *"That quest chain really looks like it
  should start from … Agrakath Theric"*. The first hand-in is his, so the step opens there: the PQDI link
  is his, and the "Start here" box carries his `/say erase the debt`, his `/map` and the book's `/map`. The
  story, which runs from Willamina's end, is labelled optional. Step-level `/say` and `/map` chips were
  dropped for this step because the box already carries them.

## §71a — The Seer only listens while you sit (2026-09-28, web 1.8.36, bot 3.1.167)
*2026-09-28 · DECISIONS-2026-09-21.md · Seer only answers while sitting*

The guild lead, with an in-game log: *"For Seer Mal Nae'Shi i had to sit down first and then say 'unlock
my memories'"*. Her script answers "guided meditation" and "unlock … memories" only when
`e.other:IsSitting()`; standing, she says to sit down. "unlock" alone does nothing, because the branch
needs both words. "You manage to recover some images from your childhood, but no recent events spark a
memory" means it worked and there was nothing new to unlock.
- **Checklist:** `Say.sit`; each Seer line gets a gold "sit first" and a `/sit` chip before it, on both
  steps that send you to her. A test holds that every Seer meditation/unlock line carries it, and that an
  unlock line says "memories".
- **Target Info Quest:** `utils/questDialog.js` marks a branch `sit` when it checks `IsSitting()`, so any
  NPC like her is flagged, and puts "sit first" + a `/sit` chip before the `/say`. Bot 3.1.168 also sends
  `say`: every word a branch needs when its condition ANDs them ("unlock memories"), one word when it ORs
  them. Before, the chip would have offered a bare `/say unlock`, which she ignores.

## §86 — PoP checklist: Justice and the Bastion of Thunder corrected; the page rebuilt on beta; auto-fill (2026-09-29, web 1.8.48, bot 3.1.176)
*2026-09-29 · DECISIONS-2026-09-21.md · PoP guide Justice corrections, auto-fill*

The guild lead, top priority, after officers asked in chat "is this all we have to do for justice?", "who to
turn the mark into?" and "are the medallions the giant heads?": *"the pop guide page needs some love. more
detail, maps, who to turn things into, expectations and who you will go back to. a sidebar nav with
sections. automatic fill in when someone is running mimic … and note when it's been filled in by database
or mimic in a line item. need this reviewed as top priority"* — with EQProgression's Talisman of Thunderous
Foyer page.
- **Reviewed against the server, not memory.** The quest scripts in `eqemu_quest_scripts` were the
  authority, read alongside EQProgression's Talisman, flagging and Symbol of Torden pages. The scripts are
  #Mavuin, The_Tribunal, pojustice/player.lua, Askr_the_Lost (postorms and bothunder), postorms/player.lua,
  bothunder/player.lua and Karana. Every place was checked in `eqemu_spawn2` or `eqemu_doors`.
- **Justice (live now):**
  - A trial's boss drops **six** of its Mark, one each.
  - The Tribunal **checks** your Mark and never takes it.
  - The second "Tribunal" location (Y 1225 X 75) is inside the Seventh Hammer's room, so it was wrong and
    is gone.
  - The last Mavuin hail is the Justice flag, and the Storms shrine checks it.
  - New optional step: **the Seventh Hammer**. Say "knowledge" to a Tribunal while holding all six Marks to
    get The Mark of Justice. The member in chat was right that it takes all six.
- **Storms / Bastion of Thunder (live now):**
  - Askr is **three hand-ins**: one Storm Giant Head, then a sealed bag of beard + bone + sash, then a meld
    of two medallions from different camps. The phrases are "it was me", "paying attention", "continue"
    ×2 and "bastion of thunder".
  - The **Talisman of Thunderous Foyer is a flag**, granted by clicking the shrine at Y -163 X -362. It is
    not a keyring item; EQProgression's flagging page says keyring, but its own Talisman page and the
    script both say flag.
  - The shrine needs **Askr's flag AND the Justice flag**.
  - The **Symbol of Torden is required**, one per raid, with a 5-minute window. The old guide wrongly said
    optional.
  - New step: the tower walk (Evynd → Askr "transport" → Emmerik → Askr "what storm" → the vortex).
  - Karana answers only the raid with kill credit, and "send me" is Gate.
  - `test/pop-guide.test.js` pins each correction.
- **Auto-fill fix, bot 3.1.176.** The flag map was keyed on short boss names, but the server names seven
  flag bosses differently: The Keeper of Sorrows, Lord Mithaniel Marr, Coirnav the Avatar of Water,
  Fennin Ro the Tyrant of Fire, #Xegony_the_Queen_of_Air, A Mystical Arbitor of Earth and A Rathe
  Councilman. Those flags would never have ticked. The map now carries those names, and `_popBossKey`
  reads the catalog and log spellings alike (`test/pop-flags-boss-map.test.js`).
- **Maps:** `zone_outline(zone)` is a read-only SQL function, migration `20260929123000`. It draws a zone
  from the server's own spawn points, doors, ground spawns and objects, snapped to a grid, plus the doors
  that lead elsewhere. No map files are borrowed. About 5 KB per zone; the page caches it for a day.
- ⚠ **Found, not fixed (the guild lead's call):**
  - `pop_flags` holds **9,846 `unmapped` rows**, all hails the agent witnessed during log backfill, not
    flag grants. The bot drops their `source` and `npc` and stores each as a grant for the person who
    hailed. The guide ignores `unmapped`, so nothing shows wrong today.
  - Two options: (a) stop writing hails as grants and delete those rows, or (b) store `source` and `npc`
    so they become useful evidence. Deleting is irreversible, so it waits for a yes.
  - `PRIVACY.md` also says we keep the hail's NPC text and witness, which we don't.

**The page itself: two layouts on beta, `d0e69d49`.** Read them at `b.wolfpack.quest/pop/guide?v=b` and `?v=c`.
With no `?v=`, the page is production as it stands.
- **Shared:** a sidebar with the character, must-have progress and "N filled in for you". It lists every
  section with its count and follows the section on screen; on a phone it becomes a row of chips that
  scrolls sideways. It also holds the filters and a key for the two sources.
- **Each row says how it got its tick:** "✓ filled by Mimic · date", "✓ from our records · date", or
  "✓ ticked by you".
- **A step's detail:** what to expect, what to say, who takes what (give → get), who you go back to, where
  to go, the quest chain, and a map of each zone involved.
- **B, "Guide":** the detail opens in place under its step.
- **C, "Route":** a compact list, with one sticky panel beside it that shows the step you pick. On a phone
  the panel opens in place instead.
- **Cost, the four numbers:**

  | | Build | Maintenance | Runtime | Change |
  |---|---|---|---|---|
  | B | low | low | lightest: a map draws only when its step is opened | easy |
  | C | a little more (selection state and a second column) | low | same | harder: a two-pane layout is harder to rework |

  Both read the same data.
- **What fills itself in** (`web/lib/popGuideAuto.ts`):
  - *Mimic:* a mapped flag after a boss kill, a looted Justice Mark, and Mimic reporting the character.
  - *Our records:* level on /who, the spellbook upload, and holding a step's item or reward in the last
    inventory upload. Never for a character that hides its inventory.
  - About 19 steps can fill themselves today.
- **Next captures, not built yet — each one is a `PRIVACY.md` change first:**
  - the NPC reply lines of the guide's own NPCs (matched on the machine; only the step key uploads);
  - keyring lines;
  - zone entries (Storms shrine → Bastion of Thunder, Valor → Halls of Honor);
  - the `#popflags` output.
- **Smoke-rendered before pushing,** both layouts plus one opened step, at desktop and phone width, with
  the site's own compiled CSS. That caught two layout bugs (long section names overflowing the sidebar,
  and the row sizing to its content on phones), both now fixed.
- Graduating needs the guild lead's pick. When one is picked, promote it and delete the other in the same
  change.

## §95 — PoP checklist: the Essences of Power quest (2026-09-29, web 1.8.49)
*2026-09-29 · DECISIONS-2026-09-21.md · Essences of Power quest on guide*

The guild lead: *"https://www.eqprogression.com/essences-of-power-quest-pop-elemental-gods/ please consume
this too and put it on the pop guide"*. Two optional steps on `/pop/guide`, each checked against the
server's scripts rather than copied:
- **Part 1, tier one (`essences_escort`, group).**
  - **Start:** say "Quellious be my guide" by the big tree near the waterfall on Nightmare's upper
    plateau (`/map -510 1687`).
  - **Night only:** the hidden spawn that hears the phrase lives from 8 PM to 7 AM game time
    (`EinoInvisNight`). EQProgression's "10 PM" is inside that window.
  - **Repeats:** a start sets its respawn to 36 minutes.
  - **The run:** four waves (4 banshees; 2 nightstalkers; 5 hobgoblins; 4 banshees + 4 bats), then The
    Dreamkeeper (level 64, 40,000 HP, hits up to 622). Keep the waves off Aid Eino: level 50,
    10,000 HP.
  - **The reward:** hand him the Strand of Nightmare after "Hand me the strand from the beast". You get
    the Tiny Gold Fist and 100,000 experience.
  - **New over the source page — one Fist per run.** The Dreamkeeper drops one strand, and Eino depops
    on the first hand-in. A group needs a run per person.
- **Part 2, elemental planes (`essences_power`, raid).**
  - **The Fist is the only gate.** Councilwoman Kerasha answers only while you carry it, and she checks no
    flags. EQProgression's "you may have to be Elemental flagged" is not in her script.
  - **The bowl:** "essences of power" gives the Sacred Bowl. It combines (recipe 9921) the four
    essences: Fire (Fennin Ro), Wind (Xegony), Water (Coirnav), Earth (the Avatar of Earth). The result
    is Power of the Planes.
  - **The reward:** Power of the Planes buys the Jade Hoop of Speed. Handing a reward back cycles it
    Hoop → Coin Purse → Cord → Mace → Ring → Hoop.
  - **New over the source page — a loot call.** Each essence is lore and drops on 40% of its god's
    kills, one per kill, so the guild has to decide who gets them. These are not the Plane of Time's
    four (the Globe, Cloud, Sphere and Mound), and the step says so.
- **Pinned in `test/pop-guide.test.js`, mutation-checked:** the phrases, the places, the item order
  (reward cycle included) and the one-per-run line.
- **Beta layouts (`beta` `7670ade4`):** each step gets what to expect, who you go back to and
  Kerasha's hand-ins.
  - **Auto-fill:** the Tiny Gold Fist in an inventory upload ticks part one. Any ONE of the five rewards
    ticks part two; she swaps them, so requiring all five would never tick. A held-item rule can now say
    `any`.

## §99 — /pop read only its first 1,000 flag rows; the planner is now mains (alts) (2026-09-29, web 1.8.50)
*2026-09-29 · DECISIONS-2026-09-21.md · PoP flag read cap, planner mains and alts*

The guild lead, on the raid-night planner: *"make this mains and in parenths alts"*, then *"I see 1000
unmapped grants so that's probably a database row restriction"*.
- **The row cap was real, and worse than it looked.**
  - **The data:** `pop_flags` holds 9,846 `unmapped` hail rows (the open item in §86) across 2,191
    characters. Only 212 of them are ours, and every row is older than any real flag.
  - **The bug:** the page read `pop_flags` once with `.limit(20000)`, and the API caps a read at 1,000
    rows.
  - **What that did:** "1000 unmapped grants"; about 456 mostly-foreign characters counted as able to
    attend. After the 10/1 unlock, every real flag would sort after those rows and never be read.
- **Fixed:**
  - Real flags only are read, a page of 1,000 at a time.
  - The unmapped rows are an exact count, not a download.
  - The matrix's "+N?" is fetched only for characters with a real flag.
  - The page's population is characters with a real flag; today there are none, so the planner says
    "No flags recorded yet".
- **Planner:** every number is mains, with alts in parentheses: attend, gain, and each unlock (alt names
  listed apart). It is ranked by mains and ignores the Mains / All characters toggle, which still
  governs the chart and matrix.
- ⚠ **Every other `.limit(>1000)` read is the same trap.** `test/` keeps a baseline of 85 such sites
  that may only shrink; this change removed one.
- **Tests:** `test/pop-planner-mains-alts.test.js`.

## §100 — /pop counts the raid roster, and the planner follows Mains / All (2026-09-29, web 1.8.51)
*2026-09-29 · DECISIONS-2026-09-21.md · PoP planner counts raid roster*

The guild lead, on the planner still reading "456 in": *"it should be mains only when i'm on mains, vs all
characters. Also traders or anyone not of level range shouldn't be counted in there. we should go off of
raiders and raid alts, pack members toons at level and above"*. Partly reverses §99's planner rule.
- **Who counts (`web/lib/popRoster.ts`), by OpenDKP rank on `characters`:**
  - mains: Pack Leader, Officer, Raid Pack, Recruit;
  - alts: Raid Alt;
  - out: Trader, Inactive, Non-raid Alt, no rank, UNKNOWN, and every other guild's character.
  - Active characters only, at level 60 or higher on the last `/who` (`who_directory`). Web 1.8.51
    shipped 46 (PoP's entry level); the guild lead set it the same day: *"for us it's 60. Recruits are
    raider, include them"* (web 1.8.52).
  - A raider never seen on `/who` still counts. A raid alt needs a seen level, because that is where the
    low and trader characters are.
  - Measured the same day at 60: 66 raiders and 101 raid alts (at 46 it was 67 and 135).
- **The page's population is that roster, with each character's flags attached.** §99 counted characters
  with a real flag, and before that every character with a hail row. Today no one has a real flag, so
  the charts start at zero for everyone.
- **Mains means raiders everywhere on the page, the planner included.** All characters adds the raid
  alts, and only there does the planner show "mains (alts)". §99 had the planner ignore the toggle.
- **The matrix's "+N?" marker is gone.** It counted a character's hail rows, which are not flags.
- **Settled by the guild lead:** level 60, and Recruits are raiders. Both live in `popRoster.ts`. The 60
  is our guild's floor, not a rule of the game (self-host epic, §3).
- **Tests:** `test/pop-planner-mains-alts.test.js` runs `popRoster` for real.

## §119 — PoP flags from the server's own scripts; Quarm's real gates; Justice marks (2026-10-01)
*2026-10-01 · DECISIONS-2026-09-21.md · PoP flags from server scripts, Justice marks*

The guild lead, the day PoP opened: *"POP is open, we need the flags to start updating"*, then *"PLANE OF
STORMS REQUIRES flagging, but it shows everyone. We should also capture what they have specifically done
For Justice capture the Marks they have based on the one that they did"* (with a Mark of Execution
screenshot).

**Why nothing updated.** All 21,291 `pop_flags` rows were `unmapped`. The grant line never names the flag
and the bot could only name one from the boss killed just before it; the trials and the Tranquility
NPCs have no boss. Two more faults, found in the server's scripts (`eqemu_quest_scripts`):
- Elder Poxbourne prints **"You receive a character flag!"**, which the agent never matched.
- NPCs re-print the flag line every time a flagged player hails them (10 characters gave 30 Justice
  "grants" today), so counting lines counts nothing.
- And the bot stored the agent's **witnessed hails** as `unmapped` grants with the NPC thrown away.

**The fix: name flags the way the server keeps them.** Quarm's flags are ~20 character variables the zone
scripts set (`mavuin` 1–3, `fuirstel` 1–5, `thelin` 1–4, `zeks` 1–7, `karana` 1–4, …; the list heads
`poknowledge/Seer_Mal_Nae-Shi.lua`). A *stage* is one value of one of them (`mavuin_3`).
- **Agent 3.7.59** (`parsePopFlagLine`, same function on every path): both grant spellings and the
  checklist flag; the line just before the grant, **sent only when it opens like a flag NPC** (every
  script prints a fixed NPC line there); and Seer Mal Nae`Shi's guided-meditation sentences, one per
  flag held. Shipped to `main` as a scoped hotfix of the stable agent (3.7.54 → 3.7.59, this function
  only), so stable Mimics hot-swap it with no installer: PoP opening day with zero flags recorded is a
  broken stable. Beta carries it as 3.7.60.
- **Bot 3.1.182** (`utils/popFlagStages.js`): the NPC line → stage table, the recital table, zone-only
  names for single-grant zones (so older agents still resolve those), and `STAGE_IMPLIES` (what each
  stage proves in the catalog's terms). It writes a row for the stage and for each catalog flag it proves,
  with the new `stage` column; hails become `flag_key 'hail'` with the new `npc` column (migration
  `20261001220000_pop_flags_stage_npc`, applied). The boss map stays as the fallback.
- **Today's 42 grants stay `unmapped`**: they arrived with only a zone. Re-running Opt-in Logs over
  today's log with the new agent names them; so does one guided meditation with the Seer.

**Quarm's real gates (web 1.8.65).** `potranquility/player.lua` is the portal script, and Quarm switched
the level bypasses off. Valor AND Storms need `mavuin 3` (Storms showed everyone in); Torment needs
`fuirstel 5` and `thelin 4`; Thunder `karana` 3 or more (so Askr's medallion alone no longer counts);
Tactics `zeks` 2+; Sol Ro the cipher and `zeks` 6+; Air, Earth and Water `zebuxoruk 2`; Time the time
flag and level 65. `web/lib/popFlags.ts` gates now name those steps directly where no classic flag fits,
and every `levelBypass` is gone. `test/pop-flag-stages.test.js` pins each gate to the script.

**Justice marks.** The six trial marks are loot from each trial's last mob (ids 31796 Flame, 31842
Execution, 31844 Torture, 31845 Stone, 31846 Suffocation = Hanging, 31960 Lashing; 31599 The Mark of
Justice), and the agent already records loot: 7 Marks of Execution today. `/pop` shows them per character
from `looted_items` in Justice (zone 201; another "Mark of Stone" exists elsewhere) and from uploaded
inventories unless the character opted out (`exclude_inventory`): counts on the Justice card, names beside
each character on the Justice page, and a Marks column on My Characters.

**Privacy.** A grant now carries one NPC line, only from the allow-listed flag NPCs, and the Seer's
sentences. `docs/PRIVACY.md` and `/privacy` say so.

## §122 — PoP flags from /who; the checklist by progression level, closed, maps on hover (2026-10-01, beta `4f5e68e1`)
*2026-10-01 · DECISIONS-2026-09-21.md · PoP flags from who, checklist by level*

The guild lead: *"how are we updating the pop pages? from /who in the zone for users that don't have
mimic, and if they're in that zone that requires other zones we should note it. make the items a
checklist style instead of just a big block of text. group them by the progression level and give us a
side bar in that page. collapse them as well by default. in live map images when you roll over the map
icon on the guide page"*.

**How the pages were updating (the answer).** Only from Mimic: the flag NPC's line before each grant,
the Seer's recital, the boss-kill fallback, a looted Justice Mark, and uploaded inventories (§119). A
character whose owner does not run Mimic showed nothing.

**/who now fills that in.**
- `/who all` prints every visible player's zone, and any raider's Mimic uploads it (`who_observations`,
  zone as the server's short name). A character inside a gated plane passed its gate.
- `pop_who_sightings(guild, names, zones)` (migration `20261002010000`, applied by MCP; the same file on
  `beta` and staged for `main`) returns one row per character and plane: first and last seen, GMs
  skipped, service role only. About 90 ms for the whole roster.
- `web/lib/popWho.ts` decides what a sighting proves: the plane's gate, and, by following each gate flag
  to the plane it is earned in, the gates on the way in (Thunder → the shrine → Storms → the Justice
  flag). A server step proves what the bot's `STAGE_IMPLIES` says; `test/pop-who.test.js` keeps the two
  equal. Instanced copies are not counted (they show as "… (Instanced)"); it never takes a flag away.
- On the day it shipped: 26 of our characters seen in Storms, 6 in Valor, 3 in Thunder.
- `/pop`: those flags count everywhere. A gate only /who proves is a **blue ✓** whose tooltip names the
  plane and the planes passed through; the zone page adds "seen in Storms on /who"; the header counts
  them. The checklist ticks the flag steps (and Mavuin's information, the Tribunal and the Mavuin hail
  before the Justice flag) as "✓ seen on /who", and its sidebar names the planes.

**The checklist (both beta layouts, `?v=b` and `?v=c`).**
- Steps sit under their **progression level**: Before the planes, then the `/pop` chart's tiers in its
  colours, each naming its planes (`GUIDE_LEVELS` in `web/lib/popGuideMore.ts`).
- **Every level starts closed**, showing done / total, the must-haves, a bar and the next step. The
  sidebar opens the level you pick (Open all / Close all; a `#lvl-`/`#sec-` link opens itself).
- **Maps on hover:** 🗺 on a row and 📍 in a step's detail show the zone map with the NPCs marked; on a
  phone a tap opens it. Kept inside the window, closed on scroll.
- Read as: the production page (no `?v=`) was the "big block of text"; B already had the sidebar and
  closed detail, so the ask lands there. **B and C still wait on a pick**; graduating one deletes the other.
- Smoke-rendered from the real component at 1280 and 390 wide: no sideways scroll, the map opens on
  hover and on tap and closes again.
- **Cost:** build low (one component, one SQL function); maintenance low (levels derive from the chart);
  runtime one ~90 ms grouped read per page, maps drawn only on hover; change easy.

## §138 — Extra PoP spells: an officer list (2026-10-03, web 1.8.82, migration `20261003150000`)
*2026-10-03 · DECISIONS-2026-09-21.md · Officer list of duplicate PoP spells*

The guild lead: *"extra PoP spells. when someone does a turnin for their new spells and gets one they
already have, put that into an officer only list so we can help direct who needs it."*

- **New page, so live with the tag:** [`wolfpack.quest/admin/extra-spells`](https://wolfpack.quest/admin/extra-spells),
  officer only (`requireOfficer` + the admin layout), one card on `/admin`.
- **Phase 1, from data we already hold.** No turn-in log line has been captured, so the page cannot see the
  hand-in itself. What it does see: one of the 225 PoK trainer reward scrolls (`pop_parchment_pools`) in a
  character's inventory export, whose spell that same character's spellbook export already lists. Each row
  gives the holder, bag slot, both export times, and who still needs the spell in the same first-dibs order
  as /pop (it calls `pop_spell_needs`, so the order cannot drift). 3 rows on the first run.
- **Stale rows are possible:** a scroll scribed after the last inventory export stays until the next one.
  Rows whose spellbook export is newer than the bags say "check".
- **Opt-outs:** holders with `exclude_from_stats` or `exclude_inventory` are skipped, as are needers with
  `exclude_inventory`. That is stricter than the older spell-exchange list, which ignores both.
- **Access:** the function is executable by the service role only (revoked from public, anon and
  authenticated). The older `pop_spell_needs` and `guild_held_spell_needs` keep the default grant; they are
  not security-definer, so table RLS still governs what they return.
- **Phase 2 needs the guild lead:** a dozen raw log lines from one hand-in to a PoK trainer (ideally one that
  gave a duplicate). With those, the agent can record the moment of the turn-in, and the list can track
  "passed to X". Until then the list depends on members exporting inventory and spellbook.

## §141 — The PoP overlay gets a Quests mode (2026-10-03, Mimic beta `b84e25b8`)
*2026-10-03 · DECISIONS-2026-09-21.md · PoP overlay gets Quests mode*

The guild lead: *"the pop overlay should include the quests and a mode for selecting them and all of the
things to say or do for any of the pop quests or flags so we can reference them."*

- A **Slides / Quests** toggle in the PoP overlay's title bar. Quests mode lists every step of the website's
  PoP guide (78, grouped by the guide's levels and sections); pick one or walk them with ◀ ▶. Each shows who
  to talk to and where, with copyable `/map Y X`, `/sit` and `/say …` chips, hand-ins ("give … → get …"), and
  what to expect. Mode and choice are remembered. Slides mode is unchanged.
- **One source, no second copy to drift:** the website's `web/lib/popGuide.ts` + `popGuideMore.ts`.
  `npm run sync:pop-quests` writes `apps/mimic/pop-quests.js`; `test/pop-quests-sync.test.js` fails when it
  is stale.
- **The missing words, filled from the quest scripts (beta `48048dd6` + `4c7dbe24`):** the guide now has 83
  steps and 86 things to say (from 78 and 43). Every phrase is one of its script's own `findi("…")`
  keywords and carries the script path (`src`); `test/pop-guide-steps.test.js` holds them to that. Filled:
  Poxbourne, both Fuirstel visits, the hedge maze (outside, inside, the dagger hand-in), Tarkil Adan, Giwin,
  the last Mavuin hail, Fahlia and Tylis, the three Halls of Honor trials, Nitram's factory trade, Muon's time
  machine, and new steps for Maelin's cipher, "lore" and "information" (the Zek notes) and Miak in
  Tranquility. Valor's globe and the Sol Ro wings are clicks, with their spots.
- **Still words-free, on purpose:** the boss projections (every one only answers "hail"), and a few steps
  whose NPC is spawned by a script or wanders (no fixed spot).
- **Found while filling, not changed:** the flag map's note on `zebuxoruk_2` ("Karana's and Mithaniel's
  notes") reads like `zebuxoruk_1` in Maelin's script ("lore"); `zebuxoruk_2` comes from "information" after
  the Zeks. The factory "key" is a flag from hailing Nitram after Xanamech, not an item. Aerin`Dar's projection
  needs the last Mavuin hail too. The flag map is marked verified by the guild lead, so it was left alone.
- All of it is upstream SecretsOTheP quest scripts; Quarm may differ in places nobody has checked.
- Because `popGuideMore.ts` is still a beta file, this graduates to stable only with the guide's beta
  layouts, or after that file moves to main on its own.

## §144 — The PoP pages go live; stable Mimic 2.7.8; the release posted to #raid-chat (2026-10-03, web 1.8.85 · Mimic 2.7.8 · agent 3.7.75 · bot 3.1.194)
*2026-10-03 · DECISIONS-2026-09-21.md · PoP pages live, stable 2.7.8*

The guild lead: *"push this up to live. then cut a new stable release of mimic with the new things that we put
in."*, then *"post the release to raid chat"*.

- **Web 1.8.85, file-level from beta:** /pop, /pop/guide and /me with their libs and tests, as they stood on
  beta — the character tiers and Hide from lists (§140, §143), the spellbook picker that keeps everyone, the
  guide's words from the quest scripts (§141), and the /who-proven flag marks (§230's work). ⚠ Those files also
  carry two unpicked previews, the guide redesign and the Essences queue; on production they are reachable only
  at `?v=b` / `?v=c` and change nothing by default. They are still waiting on a pick, not graduated. Left on
  beta: /about, the item page, /pvp.
- **Stable Mimic 2.7.8 (agent 3.7.75), `d2862878`:** apps/mimic and packages/wolfpack-logsync byte-identical to
  beta, plus `scripts/sync-pop-quests.js`, the `sync:pop-quests` script line and their tests (dashboard-tabs,
  listable-chars, night-loot-section, pop-overlay-quests, pop-quests-sync, raid-split-agent). Gate: 398 files,
  5,370 tests, lint, check:dashboard, golden logs. Pushed alone so the release body is its own (verified). No
  FB numbers since 2.7.7. Beta re-parked at 2.7.9 (`52526491`).
- **Raid chat:** bot 3.1.194 `_announceMimic278Once`, the 2.7.1 card's shape — one embed, pings nobody, posts
  only once v2.7.8 carries its installer (it did), latched in `bot_kv` `announce_mimic_2_7_8_raid_chat`.
- **Found and fixed on the way:** a `web/node_modules` symlink had been committed to beta in a sync-resolution
  commit (`9d0510a5`): `node_modules/` matches only directories. Removed, and `.gitignore` now also ignores a
  bare `node_modules` (`d1522e16`, on main with 2.7.8).
- **Next, building:** members ticking their own PoP flags on /pop without Mimic (§145).

## §145 — Members tick their own PoP flags on /pop (2026-10-03, web 1.8.86)
*2026-10-03 · DECISIONS-2026-09-21.md · Members tick their own PoP flags*

The guild lead: *"I need [a way] for people to be able to check off their own flags for their own characters
outside of using mimic or relying on someone else with mimic to do it. they could do it on the matrix page or
somewhere else that makes sense."*

- **Where:** [wolfpack.quest/pop?view=matrix](https://wolfpack.quest/pop?view=matrix) and
  [?view=mine](https://wolfpack.quest/pop?view=mine). Each gate cell on a character you own is a small button:
  tap "—" and it becomes a gold ☑ (your word); tap again to take it back. Torment and Sol Ro need two flags, so
  one tap ticks both. Other members' cells stay plain marks.
- **Proof outranks a tick:** a flag Mimic recorded (green ✓) or /who proved (blue ✓) shows that proof and is not
  a button. A gate is only as proven as its weakest flag.
- **It counts everywhere** a flag counts: the chart (☑N beside the count), the planner, the zone page, the Flags
  column. A legend sits under both tables.
- **One store, no new table:** a tick is a `pop_guide_ticks` row — the guide step that grants the flag, or
  `flag:<key>` when no step names it. So a tick on the PoP checklist counts on /pop, and a tick on /pop shows on
  the checklist. Same ownership gate as the checklist (your account and family).
- **One design, live**, not options: it is a change to an existing page the guild lead asked to go live, inside
  the page's own look.
- **Open, for the guild lead:** the checklist's "Win a trial" step carries the Justice flag, but Justice also needs
  the Mavuin hail, so ticking that one step counts as Justice (which opens Valor and Storms). Moving the flag to
  the hail step would be one data edit. Three flags (`fuirstel_5`, `thelin_4`, `hoh_trials`) have no checklist
  step, so a /pop tick for them does not show on the checklist.
  ⚠ **Superseded the same evening:** the guild lead asked for exactly that move (§147).

## §146 — Loot proves PoP flags (2026-10-03, web 1.8.87, migration `20261003190000`)
*2026-10-03 · DECISIONS-2026-09-21.md · Looted items prove PoP flags*

The guild lead: *"if anyone has looted any distinct items from any of the planes we should go through and flag
them up to that plane"*.

- **The rule:** loot is presence proof, the same as a /who sighting. A character that looted something inside a
  plane stood in it, so it holds that plane's gate and every gate on the way in. Two sources, one RPC
  (`pop_loot_sightings`, service role only):
  - **looted** — `looted_items` (the agent's own "You have looted" line, self-only) whose Zeal zone id maps to a
    plane. Verified: the zone column is the numeric zone id as text and maps cleanly through `eqemu_zone`.
  - **inventory** — a NO DROP item that drops in exactly one zone, that zone a plane, and no quest reward, in an
    uploaded inventory. The same rule as the keyed-zone inference (`locked_zone_evidence_for`), so "distinct"
    items are covered whether or not the loot line was captured. Honours `exclude_inventory`.
- **Shown as a purple ✓** ("Looted in <plane>"), counted wherever a /who proof counts (chart, matrix, planner,
  My Characters, zone page), and the guide checklist auto-ticks it ("looted there"). Precedence: Mimic (green) >
  /who (blue) > loot (purple) > the owner's tick (gold ☑). Purple therefore means "the loot is the only proof".
- **Measured on production after applying:** 71 (character, plane) rows across 38 characters — Bastion of Thunder
  25, Storms 38, Valor 8; nothing yet in the other planes. Every one of those flags was already proven by Mimic
  or /who, so no purple ✓ shows today; it appears the first time someone loots in a plane before /who places them.
- **Not changed:** the plane list is the /who table's (`WHO_ZONE`); the open planes (Justice, Disease,
  Nightmare, Innovation) prove nothing, and an instanced copy is not counted. A test keeps the SQL list and the
  site's list equal.

## §147 — The PoP guide in script order; the Justice and Bastion flags where the server sets them (2026-10-03, web 1.8.88 · Mimic beta)
*2026-10-03 · DECISIONS-2026-09-21.md · PoP guide in script order*

The guild lead: *"some of the steps require you to hail after something else or say a line multiple times. the
hand in items should be in order with the text we say to them"*, *"we say continue twice for the plane of storms
quest for bastion of thunder"*, *"move the justice flag to the mavuin hail step. the flagging for bastion of
thunder REQUIRES you to enter the zone from plane of storms after doing the turnin. find other instances of
this"*.

- **One ordered list per step.** 65 of the 83 guide steps carry a `seq` (313 acts: hail / say / give / get / kill /
  click / zone / wait / note, with "×N", "repeat until …" and "sit first"), every act cited to the
  `eqemu_quest_scripts` file it was read from. A test checks every say is one of its script's own keywords and
  every item is a real id and name. Drawn as one numbered list on
  [wolfpack.quest/pop/guide](https://wolfpack.quest/pop/guide) (and its `?v=b`/`?v=c` previews) and in Mimic's
  PoP overlay Quests mode (beta). Askr is the model case: the head, "it was me", "paying attention", "continue"
  **twice** for the bag, the three parts, the sealed bag, "bastion of thunder", the meld. Sage Balic's
  "continue" twice and the Seer's "unlock my memories" until nothing new are the others.
- **The Justice flag is the Mavuin hail's** (as asked): the hail is the server's mavuin 3, which the Storms shrine
  and the Tranquility portals check. Every Mimic-recorded Justice flag is that stage (36 rows).
- **The Bastion of Thunder flag is the shrine click's** (the same rule, applied by this session): Askr's meld is
  karana 2, and only the shrine click (`postorms/player.lua` door 4) makes it karana 3. Every Mimic-recorded
  Bastion flag is that stage (31 rows), so the flag moves from Askr's step to "Click the shrine". A tick on
  Askr's step alone no longer opens the Bastion on /pop.
- **A recorded flag ticks the steps it needs** (Mimic now, as /who and loot already did): the Justice flag ticks
  the trial, Mavuin's information and the Tribunal; the Bastion flag ticks Askr's step. A looted Mark still names
  the trial more exactly.
- **Flags finished by a click or a zone-in, not by the NPC** (the "other instances"), each now the last act of its
  step, read from the zones' `player.lua`:

  | Where | What finishes it | Step |
  |---|---|---|
  | Storms shrine (door 4) | Askr's flag + Justice → the Bastion of Thunder | Click the shrine |
  | Valor (door 3) | Aerin`Dar's flag → the Halls of Honor | Zone into the Halls of Honor |
  | Halls of Honor (doors 19/20) | all three trials → the Temple of Marr | the last trial |
  | Nightmare (portal 59) | Thelin at 2 → the Lair of Terris Thule | Thelin's hedge maze |
  | Disease (the pit) | the Grummus flag → the Crypt of Decay | Grummus |
  | Earth A (doors 9–11) | the Earth B key → Earth B | the Arbitor |
  | Innovation (door 145) | Zebuxoruk 2 + Quintessence → Time | Muon |
  | Solusek Ro tower (doors, the pit) | each wing's cauldron; then the lava pit → Fire | Sol Ro's minis; Solusek Ro |
  | Tranquility portals | Mavuin 3 → Valor/Storms; Zeks → Tactics, Sol Ro; Fuirstel 5 + Thelin 4 → Torment; Zebuxoruk → Air/Earth/Water | the Mavuin hail; the Behemoth; Maelin; Poxbourne/Fuirstel |
- **Text corrected on the way:** the four elemental gods' items come from "Essence of Fire / Air / Water / Earth",
  not "A Planar Projection" (the scripts spawn them; the NPC table agrees); the hedge maze's hail is Thelin 2, and
  the Lair opens on the portal click.
- **Open, for the guild lead:** (1) Aerin`Dar's flag could move to "Zone into the Halls of Honor" the same way
  (the door click is aerindar 2), but the bot still records it from the Aerin`Dar kill, so a move would tick the
  door step from a kill — left where it is. (2) Relv in Storms also takes "continue" twice; it has no guide step.
  (3) Gram Dunnar's charm has no quest script in our mirror, so it keeps its old says. (4) The win conditions of
  the second and third Halls of Honor trials are a note only.

## §152 — PoP overlay round: Justice trials as folds, one-line "What to do", text size, fixed height, the mouse (2026-10-04, web data on main · Mimic beta)
*2026-10-04 · DECISIONS-2026-09-21.md · PoP overlay folds, text size, mouse*

The guild lead, from overlay screenshots: *"The Justice Trials each could use their own subsection … The What to
do is wordy. … Needs a text size slider, and it jumps around when resizing, and also doesn't like to always show
the mouse over it."*

- **Data** (`web/lib/popGuide.ts`, `popGuideMore.ts` → `scripts/sync-pop-quests.js` → `apps/mimic/pop-quests.js`, in
  one commit as the sync test requires):
  - **Justice trials:** the step gains six `parts`, each verified against `The_Tribunal.lua`, the trial
    encounter scripts, `eqemu_spawn2` and the bosses' 100% Mark drops. Each part carries its Tribunal's
    `/map`, the three says, the boss and the Mark.
    - "Stoning" and "Hanging" are the right words to say, though the Marks are Stone and Suffocation.
    - Each Tribunal answers only its own trial.
  - **Briefs:** 23 steps get a `brief` of 120 characters or fewer: every step whose detail runs over 300
    characters, Justice included. Detail and Expect are untouched.
  - The website does not draw `parts` or `brief` yet.
- **Overlay** (`apps/mimic/popraid.html`, beta):
  - The six trials fold under IN ORDER.
  - WHAT TO DO shows the brief, with the full text under "More".
  - An **Aa** slider (80–160%) zooms the text only (`wp:pop:fs`).
- **The jumping:** the window refitted to every step's height on each ◀ ▶, and a tall step ran off screen
  with no scroll.
  - Fixed height is now the default, 480 px (`wp:pop:height`): the content scrolls, a grip sets the
    height, and double-clicking the grip fits it.
  - The who.html pattern.
- **The mouse:** EQ hides the Windows cursor over its own window, so a click-through overlay shows no
  pointer over its text.
  - In fixed mode the card now takes the mouse, so the pointer shows over the text and the wheel scrolls
    it. The trade-off: clicks over the card no longer reach EQ.
  - Every clickable summary, row and link gained `data-wp-interact`. Without it, the preload's mousemove
    disarmed the window after a hop from a button, so a click fell through to EQ.
- **Waiting on the guild lead:** the catalog navigation (era → plane → step) is an option pick in
  `docs/DESIGN-history-and-quest-nav.md`. It needs one plane tag per step, because the data has none.

## §165 — The hail board ships, no RIP for a named mob, kills that are not ours, and how a pick is asked (2026-10-05)
*2026-10-05 · DECISIONS-2026-09-21.md · Hail board ships, kill attribution rules*

- **Hail board, option A** (the guild lead: *"For me it's A"*). Bot 3.1.206 (release branch, rides the next
  main push): `utils/hailBoard.js` opens a window when one of the 15 hail-spawning PoP bosses dies, the raid
  at the kill is the list, `pop_flags` + `STAGE_IMPLIES` drop anyone already flagged, and the windows live in
  `bot_kv` (`hail_windows`), not state.json. `GET /api/agent/hail-board`, `POST /api/agent/hail-mark`.
  Agent 3.7.89 (beta `564de49c`): the Command Center's hail section (still to hail / hailed, the clock, tap a
  name to mark it), polled every 30 s (5 s with a window open, 10 min after a 404, so beta is quiet until the
  bot deploys). A hail of a flag NPC — yours or one your log saw — now leaves the machine live; `PRIVACY.md`
  and `/privacy` say so in the same change.
- **RIP on a one-word named mob** (the guild lead: *"a RIP callout on one of the wolf named mobs in Bastion of
  THunder that has a single name"*). "Death touch — RIP" asks for a raid member; with no raid roster the gate
  fell open. Out of a raid it now suppresses a name that is a known NPC (the zone's mob pack or a resolved
  Target Info lookup) and not a known player (our characters, our group, /who, our pet); unknown names still
  fall open (agent 3.7.89, `test/rip-gate-known-npc.test.js`).
- **Kills that are not ours start no timer** (the guild lead: *"Lord of Ire PVP kills are still being
  triggered as regular guild instance kills … If anyone from outside of our guild is in the zone there's a
  good chance they are in live and we do not count those timers"*). Zone ids cannot tell open world, guild
  instance and PvP instance apart (Hate is 76 for all three). The rule, in order: **pvp** if the
  "(Instanced)" PvP kill broadcast for that boss lands within 2 minutes, or a participant had the PvP flag on
  in Hate/Fear/Sky/Hole; **live** if 3+ fought and under half are guild, or a /who that one of the
  fighters took within 10 minutes shows another guild in the zone; **unknown** for a 1–2 person kill with
  nothing else; otherwise **ours**. The /who rule was narrowed to the fighters' own /who before it shipped:
  checked against the day's 20 Bastion of Thunder named kills, "anyone's /who" would have marked 6 live —
  mostly all-guild groups — because a guildmate in live Bastion sees a dozen guilds there while our group
  is in the guild instance; "a fighter's /who" marks only the 2-of-5 group the roster rule already catches.
  Checked the PvP rule the same way: every Lord of Ire kill in four months was by 1–2 people and every
  broadcast names "Plane of Hate (Instanced)", the PvP instance, so it cannot catch a guild-raid kill. Only
  ours starts a board timer; every parse is still kept. pvp/live set `encounters.classification`
  (never over an officer's mark) — the same mark an officer sets, so, like the 2026-06-29 'foreign' rule
  (*"if the majority of members of a raid are not Wolfpack members we should flag that, not display on
  parses"*), those fights leave /parses and the guild kill counts. The restart re-seed
  (`latest_kill_per_npc`, migration `20261005220000`) reads only unclassified, finished kills with 3+
  players, so an 'unknown' duo kill (left unclassified — the CHECK has no 'unknown') cannot come back on a
  deploy. Bosses in Hate/Fear/Sky/Hole wait 150 s before the decision (the broadcast trails the upload);
  any failed read falls back to recording the timer. Kill-derived lockouts are still written for every
  verdict (the character really is locked); only their `ours` flag follows pvp/live. Bot 3.1.207.
  Not gated: `/api/agent/bosskill` and the `/kill` buttons — a human or a lockout relay, not a parse. The day's three board timers from a 2-of-5-guild group (Hreidar, Oreen and Gaukr in Bastion of
  Thunder, 15:35–16:07 ET) were marked `live` / `classification_by = 'auto'` on production by hand
  (2026-10-05), so a restart cannot re-seed them; that day's 5–7-player all-guild group kills were left alone.
- **Grummus 24 h** (the guild lead: *"If grummus is 24h then make it so"*): `data/bosses.json` (bot 3.1.204)
  and `bosses_local.timer_hours_override` 72 → 24 on production, applied directly 2026-10-05.
- **How a pick is asked** (the guild lead: *"This format for asking me for answers isn't acceptable. It
  should tell me the difference, show me the samples"*). Every ask writes each option out with what it
  includes, a rendered sample, and a tag (faster / can become B / recommended long-term) — never a bare
  "A or B for X?", including in a to-do line. Folded into `CLAUDE.md` beside the one-liner rule.

## §186 — The hail board shows each flagger's flag cap and when it leaves (2026-10-07, bot 3.1.220, agent 3.7.102 beta)
*2026-10-07 · DECISIONS-2026-09-21.md · Hail board flag cap and despawn timers*

The guild lead: *"add the 72-flag cap to the hail board, and the countdown timers for when those mobs disappear"*.

- **Read from the scripts, not assumed.** Every flagger in `HAIL_BOSSES` states a cap: 72 for the Planar
  Projections, Tylis Newleaf and Giwin Mirakon; `72 * 2` for Grummus and Mithaniel Marr (one hail ticks twice, so
  the board shows 72 raiders); 54 keys for the Arbitor of Earth. Each script's `<` or `<=` is noted on its row.
  Every row's stay already matched its script (20 minutes for a projection, 10 for Tylis and Giwin).
- **The count is a lower bound.** Only grants we saw after the kill count; a raider with no Mimic, and anyone
  outside the raid hailing Tylis (whose script has no raid check), burn flags we never see. The card says
  "seen only".
- **No timer-window row.** The Command Center's own clock carries it; a plain timer row would be logged as an
  unknown expired trigger in the callout-feedback learning set.
- **Session picks:** the cap reads in raiders (144 shows as 72), and the warning fires when flags left are at or
  below the raiders still to hail.

## §191 — PoP checklist: The Binden Concerrentia (2026-10-08, web 1.8.118)
*2026-10-08 · DECISIONS-2026-09-21.md · Binden Concerrentia quest tracked*

The guild lead: *"https://www.eqprogression.com/the-binden-concerrentia-quest-guide/ this needs to be tracked"*.
Three optional steps on `/pop/guide`, built like §95: every claim read off the server's scripts and data, not
copied.
- **The quest:** a Plane of Knowledge gate built over three trades with no flag, level or phrase checks:
  Jimlok Keylifter (Tranquility), Tabben Bromal (Knowledge, the Jeral section) and Elder Clinka (Tranquility).
  Part 1 `binden_small` (tier one) gives the Small Clockwork Talisman; part 2 `binden_powered` (end of tier
  three) the Powered Clockwork Talisman; part 3 `binden_final` (tier four) The Binden Concerrentia. Sources:
  the three NPC scripts (`eqemu_quest_scripts`), recipes 9983 / 9874 / 9980, `eqemu_npc_drops`, `eqemu_spawn2`.
- **New over the source page, each pinned in `test/pop-guide.test.js` and mutation-checked:** the silk is
  Disease's and the ooze Nightmare's (the page has them swapped); the Tactics casing is from Diaku, not ogres;
  Valor is arachnae only; sun guardians also drop the power source; the Torment chain is 50%, not a sure drop;
  the elemental fragments are not from mephits; the Justice rats respawn in about 20 minutes, not 10 to 13;
  Tabben's "ready to write down" only reads the parts out (and only while you hold the Small Parts Container).
- **No loot call:** none of the parts is lore or no drop, unlike the essences (§95).
- **Auto-fill** (`popGuideAuto.ts`, `any`): a later item ticks the earlier parts, because each talisman is used up
  in the next combine. It proves possession, not completion (nothing here is no drop).
- **Not confirmed:** where Talisman Gate lands and its reagent (the spell row carries only effect slots), so the
  guide says our data cannot confirm the destination. The Mimic PoP overlay data (`apps/mimic/pop-quests.js`)
  is regenerated with the three steps; it reaches Mimic with the next beta build and stable cut.

## §214 — PoP flags are piecemeal, so the guide gets a "next steps" panel at the top: two previews on beta (2026-10-10)
*2026-10-10 · DECISIONS-2026-09-21.md · PoP guide next-steps panel*

**The ask** (the guild lead): *"are we taking piecemeal flags? if so we should put at the top of the guide next steps
for flags in a consolidated place"*. Yes: each character's flags arrive one at a time from four sources (Mimic's server
flag lines, /who in a plane, loot from a plane, the owner's ticks), and nothing summed them into "what next".
- **Built** (web 1.8.134 on `beta`, `ca6631c2`): `web/lib/popNextSteps.ts` (`nextSteps`/`charNextSteps`/`nextCard`,
  14 progression lines in `NEXT_LINES`, gated by `POP_ZONES.requires` and `GATE_IMPLIES`; a later hand tick is trusted
  and the steps it skipped are reported, not hidden). Two panels above every layout, only with `?nx=`:
  **A** (`NextUp.tsx`) the picked character's next 3–5 steps; **B** (`NextTable.tsx`) every listed character × line.
  https://b.wolfpack.quest/pop/guide?nx=a · https://b.wolfpack.quest/pop/guide?nx=b. No `?nx` = the page as production.
- **Fixed on the way:** `routeData.ts` read `pop_flags` without excluding witnessed `hail` rows, so a household's
  1,000-row read could miss real flags (page.tsx already excluded them). Now the same filter.
- **Known gaps:** three server flags (`fuirstel_5`, `thelin_4`, `hoh_trials`) have no checklist step, so the panel reads
  them from the raw flags; steps with no flag (the HoH zone-in, the Maelin hails) can only be ticked by hand; the
  panel shows the state as the page loaded. Drafted by a Sonnet agent, reviewed here; 42 tests, mutation-checked.
- **Next:** the guild lead picks A, B or both; the pick graduates to main and the `?nx` switch goes.

## §277 — /pop shows every character-flag step, and the Grummus gap was eligibility, not the hail (2026-10-13, web beta `471f7c69`)
*2026-10-13 · DECISIONS-2026-09-21.md · PoP page shows every character-flag step*

- **The trigger:** a raider asked which mains still needed Grummus, and the page could not say. The data showed
  41 raiders at the Oct 10 kill, Mimic users witnessed 48 characters hailing the projection, yet only 5 got the
  visible flag. 14 of the rest had Mimic on and Adler done.
- **What the server's script says** (podisease/A_Planar_Projection.lua + lua_modules/projection_eligibility.lua):
  a projection flags only the raid (or group) that got the kill, and refuses everyone else silently (the refusal
  goes to GMs only). An eligible hail with fuirstel 1 prints the Milyk line and the flag; without it, a checklist
  flag. The Crypt of Decay key (`grummus`) is set on every eligible hail with NO chat line. So "no line in the
  log" never means "no Crypt access", and "hailed but no flag" most likely means "not in the kill-credit raid".
  Unconfirmed until those raiders do the Seer meditation.
- **The call** (the guild lead): *"update the entire page with all of the character flag steps required, not
  just the main ones"*. Shipped: `web/lib/popSteps.ts` lists every step the server keeps per zone card, read
  off the scripts (pre-kill hails, silent steps, the Tranquility return trips, Maelin's steps, the five Sol Ro
  wings, Miak's pre-flag); `stepsHeld` expands a series. Cards show holders, ☑ owner-tick-only, ⏳ checklist
  waiting on the Seer, 🔇 silent step; `/pop?zone=` lists who can enter and still needs each step.
- **Found on the way:** the Sol Ro projection checks all five wing cauldrons, Miak's pre-flag AND zeks 7 (the
  Rallos Zek step) before it opens Doomfire; Aerin`Dar's projection flags only holders of the Justice flag.
- **Backfill answer:** Opt-in Logs and `--since` read flag grants, checklist lines, Seer recitals and witnessed
  hails, the same as live.

## §285 — The hail board opens for the hedge maze when two raid groups hail Thelin (2026-10-13, bot 3.1.258 main)
*2026-10-13 · DECISIONS-2026-09-21.md · Hail board opens for hedge maze flag*

- **Report (the guild lead):** the Command Center's hail board did not show the Nightmare hedge-maze flag (the
  Terris Thule unlock) or how many already held it; *"it's something that should pop up when more than one group
  of a raid talks to one flagging mob"*.
- **Why:** the board only opened on one of 14 boss kills. The maze ends on a hail to Thelin Poxbourne with no kill.
- **Fix (bot only, so every Mimic gets it with no update):** `HAIL_FLAGGERS` + `noteHails` in `utils/hailBoard.js`.
  Hails of Thelin from 2+ distinct raid groups within 60 s open a window over the current raid; the card shows
  who already holds the step (thelin 2 or later) and the count, through the existing `buildViews`. Thelin only for
  now: a "Planar Projection" hail does not say which boss it belongs to, and those windows already open on the kill.
- **Caveat:** a hail is seen only by Mimics whose log shows it, and a raider with no group number counts as no
  group (undercounts, never overcounts).

## §369 — Quarm's October 18 patch notes: what we changed and what we did not (2026-10-18)
*2026-10-18 · DECISIONS-2026-09-21.md · Quarm October patch notes applied*

The guild lead pasted the notes (the Discord ingestion stores no text, below). Same approach as §352.
- **Applied, main (bot 3.2.1 · web 1.9.4):** the corpse DM gives 30 minutes in zone 223 (`potimeb`, "the second part
  of the Plane of Time") instead of an hour; every other PoP zone keeps an hour (`_POTIME_B_CORPSE_MOVE_SEC`). The PoP
  guide now says PoK spell turn-ins never drop on the ground or cursor (a spell or returned parchment goes to a free bag
  slot, or is held until you make room and speak to any planar spell turn-in vendor; extras are held the same way), and
  gives the Plane of Time rules: one fixed 6 day 18 hour cycle from the guild's first entry that kills no longer extend,
  Phase 1 loot limited 12 hours and Phases 2–3 3.5 days (never past the cycle end), Phases 4–6 down until the cycle ends,
  the Phase 3 checkpoint, the 10-minute empty-zone visit end, the 90 cap with 18 into each Phase 1 wing. Roadmap entry +
  onboarding changelog. No web/bot text anywhere said "drops on the ground" — the guide only lacked the new facts.
- **Applied, beta (agent 3.8.1):** the agent's zone-name table stopped at 221, so a death in zones 222/223 sent its
  corpse DM with no zone; added `222 Plane of Earth` (`poearthb`) and `223 Plane of Time` (`potimeb`), checked against
  `eqemu_zone`.
- **NOT applied — the Plane of Time timer model.** Only Quarm is on the board (`data/bosses.json`, 162 h = 6d18h, counted
  from the kill). Under the new rule the cycle starts at the guild's first ENTRY and kills don't extend it, so "kill +
  162 h" is now the wrong meaning, and slow mode's 18 h override would also be wrong for Quarm. Options: **A** read the
  server's own numbers (`#timelockout` / `/sll` — needs one captured sample first), **B** infer the cycle start from the
  first guild member seen in zone 219/223, **hybrid** B's ledger overwritten by any observed value. Nothing is known to
  log an entry, a cycle start or the portal's other-guild message. Waiting on the guild lead's pick + a capture.
- **Not written, no safe wording:** the portal's "belongs to another guild" message, repeated portal clicks, Phase 5
  room guards returning, the failed-attempt reset rules before/after the checkpoint.
- **Catalog lag:** Putrescent Blood (item 26635) still lists only flayed horrors and skinless creatures; the 7% from the
  Torment constructs and twisted crawlers lands when `sync-quarm.yml` pulls a newer upstream dump (the last one is from
  2026-09-27). Venenzi's self-found turn-ins are in the mirrored script, but `scripted_npc_turnins` lacks them (an
  importer gap that predates this patch — separate fix).
- ⚠ **Patch-note ingestion holds no text.** All 1,358 `quarm_patch_notes` rows have `content_missing = true` because the
  bot runs without Discord's Message Content intent. Fix order matters: turn the intent ON in the Discord developer
  portal FIRST, then set `MESSAGE_CONTENT_INTENT=1` on Railway — requesting an intent the portal hasn't granted makes
  Discord refuse the bot's login.

**Same session, art and brand (records only):** the guild lead bought `raidmimic.com`, `.net` and `.quest` (Porkbun;
what they point at is still a pick: park → eqmimic.quest, rename the front door, or a separate game-agnostic service
page). Pixel art made with the MIT `claude-pxl` kit (not vendored; a yes/no is open): the friendly eared Mimic from the
app icon, a "just a chest" variant, Discord emoji + a sticker, and a guild hall + roster card drawn from each active
main's race and class. The roster, names and rendered images stay outside the repo; only a name-free generator could
ever be committed. (Corrected by §370: the guild lead's "C" answered the raidmimic question, not the art one. Where the
art goes first is still open.)

## §372 — A summoned pet showed on the hail board as a raider (2026-10-19, bot 3.2.2)
*2026-10-19 · DECISIONS-2026-09-21.md · Summoned pet excluded from hail board*

The guild lead, with a screenshot of the Command Center hail card for Tylis Newleaf: *"Larerer is a pet, should not be in
this grouping"*. The kill roster unions the raid_roster snapshot with the fight's player list, and a pet whose owner the
parse could not resolve sits in that list as a player with damage (single generated words are not skipped; only
multi-word names are). A raider then tapped it, so it showed under "Hailed" as a marked chip. **Fix:** in
`utils/hailBoard.js` `openWindow`, a name that comes only from the fight must be in `characters` to join the board
(`guildOnly`); a failed read keeps the names. Test: `test/hail-board.test.js`. **Not fixed here:** the same unowned
pet still counts as a player in the parse and `encounter_players` (the attribution in `index.js` near the "direct
player damage" branch); that is its own task.

## §442 — Vercel CPU fix live; flag steps as a command then a page; the Torment chain from the scripts (2026-10-26)
*2026-10-26 · DECISIONS-2026-09-21.md · Flag steps as command then page; Torment chain*

- **Live on main (web 2.1.41):** link prefetching off site-wide and the slower live-page refreshes (§440), graduated
  from beta as the two commits' changes only. Production build: all 121 pages use the no-prefetch link.
- **FB-97, corrected:** "Giwin" is Giwin Mirakon, the Plane of Innovation flag NPC. The Command Center already opens a
  Giwin window after the Manaetic Behemoth (`utils/hailBoard.js` row `manaetic_behemoth`); the report came 95 s before
  that kill, while the raid was doing Giwin's PRE-flag (`poinnovation/Giwin_Mirakon.lua`: say "great warrior" → "task" →
  "test the machine", sets zeks=1), which the board does not cover. The flag-steps card below adds pre-flags.
- **Torment pre-flag, from the scripts** (the member's Discord recipe was incomplete): `potranquility/Fahlia_Shadyglade.lua`
  gates on thelin==4 AND fuirstel==5; only "will go" sets tylis=1 and prints "You have received a character flag!".
  fuirstel 3→4 = the Bertoxxulous projection (`codecay/A_Planar_Projection.lua`), 4→5 = Elder Fuirstel; thelin 4 =
  Elder Poxbourne after the Terris Thule projection.
- **Flag steps for a raid: the guild lead picked A then B.** A: an officer-only `/preflags` command posting one card
  (steps, phrases, who still needs each, Refresh + My steps buttons, links to the Seer paste at /pop/guide). B after:
  an officers' page at /pop/raid/flags that picks the raid and bosses, shows names per step and posts the same card
  (fixing /pop/raid's hard-coded raid date). The card builder is shared.
- **On beta (web 2.1.42):** FB-99 (the inventory hover card clipped by its grid cell, and PQDI icons requested from a
  case-wrong `/Icons/` path) and FB-98 (a /me door in Mimic's local site; the website's /me names where inventory sync
  and hiding live).
- **Open:** FB-100 (expandable respawns on the Mimic map) — option A (accordion + pulse the down spawns) recommended;
  the kite-circle drift prediction, speed/nearby filter and stale circles are being drafted.

## §444 — Per-person flag link: A, with a #popflags / Seer paste box, a "Sync from my logs" button, and #popflags read live (2026-10-26)
*2026-10-26 · DECISIONS-2026-09-21.md · Per-person flag link with Seer paste and sync*

- **The guild lead picked A:** a signed-in page `/pop/raid/me`, "with a copy/paste box for the seer's info or popflags
  content. lets add a button for that sync as well to comb through the latest on logs." Then: *"ideally users are able to
  have that text come through anytime they do it from mimic"*: Mimic reads `#popflags` output from the log as it happens.
- **`#popflags` text is from the server source**, `SecretsOTheP/EQMacEmu` @ `11024c19`, `zone/gm_commands/popflags.cpp`
  (967 lines; a Player command). Plain `#popflags` is an overview; `#popflags 1`..`5` print each tier, so a paste needs
  those five. No real capture of its output exists in our data yet: the first live read is the check.
- **Sync from my logs does NOT reuse `agent_backfill_requests`:** agents only show a banner for those and never complete
  them (81 pending, 0 completed on 2026-10-26). A small `pop_rescan_requests` table instead; the member's Mimic takes the
  request on its poll (minutes), re-reads N days of that character's logs through the existing PoP gates, and reports a count.
- **Two parsers on purpose** (the agent is zero-dependency and cannot import the web's TypeScript): one shared fixture
  and a parity test keep them the same.
- Drafts in progress; ship order: migration, bot, web (main), then the agent (beta).
- **The page shipped first (web 2.1.44, live, [beta]):** the #popflags tab and the sync button are disabled slots until
  their draft lands. Its step list uses the fixed 2026-10-14 plan only on that night; any other night shows each
  character's next steps with "No flag plan is set for this night yet" (an old plan must never read as tonight's).
- **Shipped the same day:** the guild lead ran `pop_rescan_requests` in the SQL Editor (the MCP apply stalled again);
  bot 4.0.19 + web 2.1.47 on main (the #popflags paste, "Sync from my logs", the `popflags` source); agent 4.0.25 on
  beta (#popflags read live from the log through an exact-line gate, and the rescan). A stage-5 Thelin line
  ("Nightmare progression complete") is stored as `thelin_4`: check that in game. A backfill run before agent 4.0.25
  reaches a member's PC finds Seer and grant lines but not #popflags output.
- **The night slicer's label stays "Another guild's raid"** (the guild lead first said "Non-guild", then "it's another
  guild", then "really its other-guild"; the stored kind is `other_guild`). The 2026-10-22/23 late Crypt of Decay run
  was another guild's with some of ours along, so its four 'foreign' marks stay.

## §449 — Seer pending memories are checklist flags (`cl_*`, source `recital`), never steps; no-time lines settle a paste (2026-10-26)
*2026-10-26 · DECISIONS-2026-09-21.md · Seer pending memories treated as checklist flags*

A partway character's Seer log carried two sentences no reader knew ("a small trinket by Grummus' body", "the Warlord's flaming
axe"). They are the Seer's PENDING memories: what she prints on 'unlock memories' when the step a checklist flag waits for is
missing (`Seer_Mal_Nae-Shi.lua` `checklistFlags`, second entry of each row).
- **Stored as the existing checklist flag_key** (`cl_grummus`, `cl_rallos`, …), source `recital`. Not `pending:cl_x`: the
  bot already stores `cl_*` for a kill without its prerequisite (PREV_STAGES 'checklist'), and `/pop` already counts "killed it
  before the step that comes first" as `flags.has(cl_x) && !holdsStep`. A recital row just adds a second way to learn it. No
  STAGE_IMPLIES/STEP_IMPLIES entry, so `stepsHeld()` carries nothing from it. `#popflags` source keeps its closed vocabulary
  (no `cl_*`).
- `pendingHint(key, held)` → ready / blocked / moot with a plain-words "do this next" (prerequisite pairs from the script and
  `PopFlagsHasReadyMemory`, popflags.cpp:126-150). Exported only; `/pop/raid/me` and the guide can use it later.
- cl_maze and cl_behemoth print nothing (empty text in the script); `#popflags` does print "Pending memory: Thelin's hedge maze"
  and "Pending memory: Karana", not stored here.
- The paste/log reader treats a boss line reading `Missing` / `Pending memory`, the Seer notice, the Miak advice,
  `Pending memory: <x>` and a Tier 1-3 that is not Complete as "time not held" (the server prints them only without it).

## §451 — Per-character PoP flags checklist in Mimic: "A then B", A built first (2026-10-27)
*2026-10-27 · DECISIONS-2026-09-21.md · Per-character PoP flags checklist in Mimic*

The guild lead: *"A then B"* for the per-character PoP flags checklist in Mimic, then *"Build in this sort of logic and put the flags checklist per
character into motion … as a main addition to the pop overlay … with deep linking to steps in the rest of that overlay"*. "This sort of logic" is what the
website already does with `#popflags` and the Seer's lines: read what a character holds into "what to do next".
- **A (built, drafts not pushed): a Flags mode in the PoP overlay**, the third segment next to Slides and Quests, for the character being played, with links
  that jump into the Quests steps. **B comes after A** (the guild lead's order); what B needs on top is in the STATUS entry of the same date.
- **One engine, not a third copy.** The bot reads the website's own TypeScript, bundled into `utils/popEngine.js` by `scripts/sync-pop-engine.js` (rolldown,
  already installed, no new dependency); a drift test fails when the web rules change and the bundle is stale. Why not port the functions by hand: the Seer's
  tables already exist twice (web + `utils/popFlagStages.js`, held together by a parity test) and that was one copy too many.
- **Read, not written.** A new `pop` stream on `GET /api/agent/poll` answers only about the caller's OWN characters (their `discord_id`'s `characters` rows;
  the agent's watched list can only narrow it). Nothing new leaves the machine, so `docs/PRIVACY.md` is unchanged. Mimic's agent caches the answer and
  serves it to the overlay on localhost.
- **The payload carries keys, not prose.** The overlay turns them into words and links from its own generated tables, so a newer bot with an older overlay
  (and the reverse) disagree only about a key they do not know.
- **Ship the bot first** (it is additive: no agent asks for the stream yet), then the agent on `beta`. An older bot without the stream makes the overlay say
  "Flags need the newer bot".
- **The engine was wrong about Maelin; fixed in the web engine, so the website gets it too.** `popNextSteps.ts` offered her Zek-notes reading (zeks 5 to 6) as
  doable without the cipher. Her script (`poknowledge/Grand_Librarian_Maelin.lua`, sha `b1d5b43b`) moves zeks 5 to 6 only inside `if ( qglobals.cipher )`
  (:65-77); without it she only says to go and find the cipher (:78-81). Now the reading waits on `cipher_1`, which waits on the Saryrn and Marr halves (:15-20).
  Checked against the same script: the lore reading needs Karana's notes AND Mithaniel's (:37) and sets zebuxoruk 1 (so holding it completes the stage); the
  second reading needs zebuxoruk 1 and **zeks 7**, not 6 (:57). Left as it was: the `maelin` line is linear, so the lore (which her script does not tie to the
  cipher) is offered after the cipher stage.
- **A pending memory says what its own step waits on** (`pending[].waits_on`, one level down): Rallos Zek's memory waits on the Zek-notes reading, which waits
  on the cipher, which waits on the missing half.
