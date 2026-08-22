# Decisions — 2026-08-21

Previous file: `DECISIONS-2026-08-20.md`.

## PoP flag coverage for raiders without Mimic: witnessed hails (Hitya)

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

## Foreign lockouts are CAPTURED; foreign raids stay excluded (Hitya)

**The call.** *"several raiders have spent time with Breakfast Club doing raids
on alts. we need to remain vigilant about these not being included, but also
capture loot lockouts for raid mobs when they don't occur with our guild — put
those into another admin section."*

**⚠ Corrected same day by Hitya — a lockout is an ENGAGE lock.** I built and
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

## Pre-raid lockout briefing to officer chat (Hitya)

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

## Officer pre-raid checklist + midday raid-info post (Hitya)

**The calls.** *"let's build an admin-facing officer-chat pre-raid checklist,
active mimics, class shortages below our average, lockouts, other pertinent
details (suggest some)"* and, with the real signup embed attached, *"this is
the information that we go off of from signups. post the raid info midday to
our channel."*

**The design rule I picked, and why.** Every section must be **actionable in the
next hour**. A number an officer can't do anything about before the pull belongs
on a web page, not in a Discord post — which is why there is no DKP, no
attendance history and no parse stats here. All true, all useless at 7pm.

**Officer checklist (`/preraid`, auto at T-90m, bot 3.1.66):**
1. Signups — going/tentative/out, flagged thin only against OUR OWN recent
   average, never a magic number.
2. Class shortages — a class is short when it fails BOTH a ratio and an
   absolute-head test (2 of 3 clerics is a crisis, 9 of 12 wizards is a
   Tuesday), sorted by heads missing rather than ratio: 0-of-4 warriors
   outranks 3-of-6 clerics because you can raid a cleric light and you cannot
   raid with no warriors.
3. Mimic coverage — counted in PLAYERS, never characters (CLAUDE.md adoption
   rule), naming who we won't see. A signup with no Discord id is assumed
   covered rather than accused.
4. Lockouts on tonight's targets — the engage-lock briefing, folded in.
5. Targets actually UP — the most expensive thing to discover at pull time.

**Midday member post (`/raidinfo`, auto in the noon hour, to the raid
channel):** re-surfaces the header block the officers ALREADY typed into the
signup post — Raid Set / Muster Point / Raid Lead / Raid Window / Loot / Ticks —
rather than inventing a format, plus who has signed by class and which classes
are still wanted. Deliberately NOT the officer checklist: no Mimic coverage, no
lockout names. What a raider needs at noon is where to be, who's leading, and
whether their class is wanted.

Both dedupe per night in `bot_kv` (not state.json — deploys wipe it). The
header parser is tested against the REAL Vex Thal signup post; its first cut
silently dropped "Raid Set 1 - Vex Thal" because the label pattern didn't allow
digits, which the fixture caught.

## The officer channel is wired from Discord, not from an env var (Hitya: "wire it to officer channel")

**The finding that forced this.** `OFFICER_CHAT_CHANNEL_ID` is **not set on
Railway** (checked against the live service, 2026-08-21). Both officer posts I
had just shipped would have skipped silently with "not set" — the same
shipped-but-never-fires shape as the inventory uploader earlier this week, and
for the same reason: nothing forces a config value to exist just because the
code reads one.

**Why not simply set the env var.** It can only be set by a human in the
Railway UI, and it needs a redeploy to take effect. That is a poor dependency
for "which channel do officer posts go to" — a thing an officer should be able
to point at themselves, in Discord, at the moment they care.

**Resolution order** (`utils/officerChannel.js`): bot_kv `officer_channel_id`
→ `OFFICER_CHAT_CHANNEL_ID` → `OFFICER_ALERT_CHANNEL_ID`. `/preraid here:true`
run in a channel stores its id in **bot_kv**, which survives deploys (state.json
does not — the eleven-copies-of-the-raid-review lesson). When nothing resolves,
callers SAY so and post nothing: an officer briefing in the wrong channel is
worse than no briefing.

---

# 2026-08-22

## A kill parse IS a lockout observation (Hitya: "taeya reported this Ventani kill so they should have a lockout")

**Context.** Hitya linked a Ventani parse
(`/parses/1b943d2d-0059-4407-8ab2-9346421f0d79`) uploaded by **Taeya** from a
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
  the work: Taeya is a **cleric** — zero damage, therefore no
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
lockouts across 162 characters and 21 bosses. Taeya's three now show, all
lifting Aug 28.

## Two things the new data volume broke, found by looking at what the post would say

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
