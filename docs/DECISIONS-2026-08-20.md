# Decisions — 2026-08-20

Overnight (the Wed 08-19 raid ran into this morning) plus the Thursday-morning
landing. Previous file: `DECISIONS-2026-08-19.md`.

## DT countdown: a gated fire on a timer-bearing trigger still ARMS the timer (Hitya, mid-raid)

**The call.** *"we still missed the deathtouch timer from the second cursed
cycle mob on a pet."* Two holes, two fixes: (1) the guild trigger's target
capture had no space in its class, so multi-word victims (warders, charm pets)
never matched on ANY agent — pattern broadened in the `guild_triggers` row
directly (live in ≤2 min via the poll, no deploy); (2) the
`require_raid_member` gate early-returned BEFORE `_startTimer`, so a fire whose
victim an agent couldn't prove dropped the whole countdown — agent **3.5.93**
arms the timer on a gated fire and suppresses only the text/tts actions.

**Why.** A DT countdown is CYCLE state, not a victim callout — a Death Touch
spent on anyone's pet still means the next one is 120s away. This deliberately
INVERTS the 2026-08-09 note that treated "a pet got a countdown" as the bug;
the inversion is recorded in the trigger row's notes so it doesn't get
re-fixed backwards.

**Where it landed.** `packages/wolfpack-logsync/index.js`
(`_fireTriggerActions`), guild_triggers `d1a04e39…`, beta build off `0debca07`.

## /parses: collection is open, DISPLAY is curated (Hitya: "not the right parses for nonbosses")

**The call.** Bot 3.1.52's self-registration (first kills are sacred) turned
out to have removed the page's only boss filter — one overnight farm session
put 336 trash cards on /parses and ate the 250-row query window. Collection
stays open; display gets its own axis: `bosses_local.auto_registered`
(migration, backfilled for the 188 rows since 3.1.52). Cards = curated rows
only; everything else rolls up to one 🗡 line per zone per night
(`parses_offcard_rollup` RPC, zone derived from npc_id = zone_id*1000+n — the
page finally says Ssraeshza Temple instead of "Unknown zone").

**Where it landed.** Web **1.1.77** + bot **3.1.60**, two migrations (applied
via MCP 2026-08-20 ~02:1x UTC, identical files committed).

**Post-deploy leak + cleanup (Hitya, Thu morning: "Still seeing a bunch of
trash").** The backfill ran at 02:13 UTC but the flag-stamping bot only
deployed at 13:46 UTC — for those ~11.5 hours the OLD bot kept self-registering
first-seen mobs with the column DEFAULT (false = curated), so last night's
Sebilis frogloks/myconids and Thursday's farm (34 rows, 03:23–13:32 UTC) came
through as cards. Flipped by hand at ~14:10 UTC with the exact gap-window
predicate; verified the 2-day card query then returned only the 11 real raid
bosses. Lesson: **a default-valued backfill has a race against the still-running
old writer — re-run the backfill after the writer deploys, or write the
migration idempotently enough to re-apply.** Open-world farm nameds caught in
the sweep (Tolapumj, Prophet Grikplag, Centurion Regorator, Legionnaire Rukos)
stay off-card by the lockout rule; any that ever appears in a lockout/bosskill
relay self-promotes.

## "If they have a loot lockout we can keep them on" (Hitya) — lockout ⇒ card-worthy, self-enforcing

**The call.** Uncurated NAMEDS (instanced City of Mist / Ssra minis) shouldn't
be promoted by hand-picked lists: the SERVER already declares what's a boss —
it hands out loot lockouts. The /sll relay and bosskill broadcasts carry
exactly those names, so bot **3.1.61** promotes any auto-registered
`bosses_local` row they mention (`_promoteLockoutBoss` — flips the flag only;
never creates rows, never touches timers, war-god PVP names are no-ops).

**Why organic, not backfilled.** No lockout history is stored (the old handler
dropped non-board names), so tonight's nameds promote the first time anyone
locked to them runs /sll after the deploy, or on their next kill broadcast.

## /announce for a future event DEFERS its parse session (Hitya: "it hasn't happened yet!")

**The call.** The All-Night Leaderboard appeared at 12:21 AM in the "Sanctus
Seru — Thu, Aug 20, 10:30 PM EDT" thread, full of overnight FARM kills.
`/announce` auto-opened the parse session at ANNOUNCE time whenever none was
active — and the event was announced just after midnight, right after the
midnight chain cleared Wednesday's session, so tomorrow-night's thread became
"tonight's session home" for every agent upload. Bot **3.1.62**: announce
opens the session only when the event starts ≤2h out; further-out announces
park `pending_parse_session` in `bot_kv` (NOT state.json — deploys wipe it)
and the spawn checker opens it 30 min before start. /adjusttime + /adjustdate
move it, cancel clears it, an officer /raidnight supersedes it, start+6h
drops it unopened.

**One-off for tonight (2026-08-20 10:30 PM).** The event was announced BEFORE
3.1.62, so no pending record exists, and the deploy wipes the polluted
session. An officer should run `/raidnight here` in the event thread at raid
time (or re-announce ≤2h out, which now opens immediately). Also: the stale
All-Night Leaderboard message from 12:21 AM in that thread is farm data —
delete it by hand.

## Inventory auto-upload: the third sibling was never built (Hitya: "are we not consuming inventory files when they get updated?")

**The finding.** The bot's `/api/agent/inventory` endpoint has existed since
2026-06-23 (Hitya: *"load the inventory, spellbook, and quarmy files via
mimic the way we are the logs"*) and the `/character/<name>/inventory` page
copy claimed "Mimic uploads this automatically in 1.0.78+" — but the
agent-side scan was NEVER written, in any version, anywhere (repo history
searched). Quarmy and spellbook shipped their halves; inventory silently
stayed manual-/me-upload-only. Result: 2 of 122 characters fresher than 30
days, family snapshots frozen at July 15, August's Ancient scrolls invisible
to the item search, Manamana's file sitting unconsumed in the scanned dir.

**The fix.** Agent **3.5.94** (beta): `scanInventoryUploads`, an exact
sibling of the quarmy/spellbook scans — same dir, same exclude_inventory
prefs gate, fingerprint + checksum dedup persisted in logsync.uploaded.json,
10-min cadence. Coin slots / Currency / the Held cursor never leave the
machine; bank ITEM slots upload (the manual path always included them). Web
**1.1.78** fixes the page copy to the truth.

**The lesson (rhymes with "an enabled trigger reads as coverage").**
Aspirational UI copy is how a missing feature hides: the page SAID uploads
were automatic, so nobody filed "it doesn't upload" for two months — the
report only came when a specific item (an Ancient scroll) was visibly
missing. When copy promises an automated behavior, the behavior's absence is
invisible by construction — verify the pipe end-to-end when shipping the
copy, not just the endpoint.

**Verify (next Mimic beta on any box):** `[inventory] queued inventory
upload for <Char>` in the agent log within ~40s of boot; Manamana's page
fills; `character_inventory.observed_at` goes current for every character
with a file on a running box.

**Graduated same-day (Hitya: "lets go to a new minor version for agent and
send this out as a miMIC update as well since this is pretty important").**
Agent re-versioned **3.6.0** (new minor line), Mimic stable **2.6.0** cut
from main carrying the whole beta delta (inventory auto-upload + buff-queue
overlay + DT timer-arm — byte-identical file promotion, verified), release
notes written member-facing per the v1.1.20 rule, beta re-parked at 2.6.1.
Unnamed release (plain version string — naming is the guild lead's call and
none was given).

## Backfill Dismiss was a no-op inside Mimic: Electron has no window.prompt()

**The finding (Hitya: "dismiss button for backfill doesn't do anything, and
closing that panel just refreshes and brings it back").** Two bugs. (1) The
Dismiss handler opened `window.prompt()` for the optional officer reason —
Electron renderers do not support prompt() (it THROWS), so inside Mimic the
async handler died before the POST. It worked in a plain browser, which is
why it survived testing: **test dashboard interactions inside Mimic, not just
localhost in Chrome — prompt/alert/confirm support differs** (prompt: never;
alert/confirm: fine). (2) The per-card ✕ persisted its hide, but renderers
that rebuild innerHTML (renderOptin) resurrected hidden cards — only some
renderers had learned the Watched Logs re-consult lesson. Agent **3.6.1**
(beta, 2.6.1-beta.N): confirm() guards the dismiss (optional reason dropped),
and decorateButtons — which already observes every section — re-asserts
wp-hidden from the persisted set on every repaint, healing all sections
generically.

**Cleanup.** Hitya's two stuck June-12 requests (Rockin, Manamana) dismissed
server-side per his clicks. ⚠ **~115 more stale June 9–15 data-gap requests
are still open fleet-wide** — every member with a matching character sees
their own undismissable-until-3.6.1 nag card. Bulk-dismissing the June sweep
is Hitya's call (the four 2026-08-17 Sleeper's Tomb recovery requests must
survive any sweep — they are the live P1 tail).

## Shared banks: fingerprint the content, group by account, count once (Hitya: "build fingerprinting on shared bank lines")

**The problem.** The shared bank is ACCOUNT-level — every character on a game
account exports identical SharedBank rows — so /me/inventory's totals counted
shared-bank items up to 8×, and the auto-upload (3.6.0) made that the default
state. No game-account grouping existed anywhere (person-level family via
Discord/OpenDKP is a different axis), and characters can move between game
accounts (same TAKP forum account), so a curated mapping would rot.

**The design (web 1.1.81 + `shared_bank_groups` view).** The shared bank's
identity IS the account fingerprint: hash each character's SharedBank row-set
(slot|item|qty, ordered); identical hash = same game account; the freshest
snapshot in a group is its representative and the only one whose shared bank
counts. Regrouping is automatic — a moved character's next upload carries the
new account's shared bank. Verified against live data: Hitya's alt account
(Utoh/Manamana/Melting/Pearlclutcher/Rockin) and the mule accounts
(Zbag/Hurryupandbuy/Morebagsplz/…, Holdquest/Holdgems/…) grouped correctly on
the first query. Designed-in caveats, recorded in the migration: empty shared
banks never group (no rows → no fingerprint); differently-aged snapshots can
transiently split a group until the stale one refreshes (auto-upload closes
that within ~10 min); cross-family collisions on trivial identical banks are
possible, so family-scoped consumers pick the representative within their own
subset.

**Scope corrections made alongside.** `DESIGN-quarmy-gear.md`'s "no bank data
persisted anywhere, by construction" was true for the Quarmy path only — the
`/outputfile inventory` paths deliberately persist bank + shared-bank ITEM
rows (coin never uploads); the doc now says so. `web/lib/quartermaster.ts`'s
"bank already stripped upstream" comment was false — and per-character kit
checks are CORRECT to count bank/shared-bank (reachability), so behavior is
unchanged there; only /me/inventory sums across characters and only it dedups.
Worn/equipped items were already uploaded + searchable on every path (Hitya
asked — confirmed, no change needed). Follow-up noted, not built: the
`character_missing_spells` `held_by[]` list can still name every same-account
character for a shared-bank scroll (names, not counts — low harm).

## Character filing moves to the MEMBER; traders stop needing a class (Hitya)

**The call.** *"I need a way for the end user that we suspect these are a part
of to tell us about these users."* Plus the blocker: *"For all of the ones that
uploaded from my files, they are primarily traders and I can't easily make them
traders because of the class requirement."*

**Why officers couldn't do this.** ~110 characters upload from members' machines
with no `characters.discord_id`. An officer cannot classify them — they don't
know whose Beltbroker is whose — and the one button that fit (Trader) was
disabled until a class was picked, for a bank mule `/who` has never seen. So
the queue only grew.

**The ownership signal already existed.** The agent authenticates as its owner,
so `agent_upload_stats.uploaded_by_discord_id` says whose machine a character
uploads from — the same first-party signal the web mule-upload already trusts
(`claimVerdict`: unclaimed → yours, someone else's → refuse). `/me` now lists
those characters and their owner files each: **Trader** (one click, no class,
never OpenDKP), **Raid alt** (class + level, through the same
`opendkp_register_requests` queue officers use), **Not mine** (`link_ignored`).
Both surfaces refuse anything your agent never uploaded or that someone else
owns. Filed traders link to the family root, so their inventories join
`/me/inventory` immediately (shared-bank dedup from earlier today applies).

**The raid-alt ladder is DATA, not a number** (`web/lib/characterRoles.ts`,
tested): 46 Classic / 50 Kunark / 55 Velious / 60 Luclin. We never answer
"is this a raid alt" yes/no — we answer WHICH ERAS, because a L50 alt genuinely
raids Classic + Kunark and genuinely cannot raid Velious. Only "below 46, no
era at all" hard-stops OpenDKP registration, and it points at Trader rather
than scolding. Trader placeholders are fixed: level 1, Human, class Unknown.

**Bot fix riding along (3.1.63).** The register queue only stamped
`discord_id`/`rank` on a local-only rank when a family root ALSO resolved — so
a trader whose owner had no OpenDKP family was filed and came back unlinked,
reappearing in the review queue forever. Ownership is now stamped
unconditionally; the parent link is a bonus.

**Two tests earned their keep in review**: the db-read-discipline ratchet
caught a new `.limit(2000)` (PostgREST silently caps at 1000 — switched to the
shared paginator), and the roles test caught `Number(null) === 0` rendering an
unknown level as the nonsense "L0".

## Process: a silent Monitor death delayed the freeze-lift landing ~9h

The 00:31 ET landing (bot 3.1.59 + web 1.1.77) was armed on a persistent
Monitor that died at its 30-min timeout without firing — the second monitor to
do so that night. The landing happened Thursday morning instead (no harm —
freeze-safe window), but the lesson stands: **a cloud-session timer is a hope,
not a schedule.** For time-critical follow-ups, prefer `send_later` /
scheduled triggers (they survive container churn) over Monitors, and write
the pending landing into the task list + docs so ANY next session picks it up.

---

## Open — read this first

| Item | State |
|---|---|
| **Tonight (Thu 10:30 PM): Sanctus Seru event needs `/raidnight here`** | Announced pre-3.1.62 → no pending session record. Officer runs `/raidnight here` in the event thread at raid time (or re-announce ≤2h out). Delete the stale 12:21 AM All-Night Leaderboard message in that thread |
| **Instanced nameds promote on first /sll** | Post-deploy, anyone locked to the CoM/Ssra instanced nameds runs `/sll` once → they earn /parses cards with history. Verify the first few promotions in the bot log (`[lockout] promoted …`) |
| **Buff-queue batch needs a field pass** | Landed: overlay collapse groups + burst ⏳ countdowns (mimic beta), dashboard cures-only/Feral-only filters (agent 3.5.92), bot 3.1.59 burst carry. Watch tonight's raid |
| **DT trigger: verify on the next cursed cycle** | Pattern fix is fleet-wide already; agent 3.5.93 (timer-arm) reaches beta Mimics via hot-swap. The next Vyzh`dra cycle DT on a pet should produce a raid-wide countdown with no callout |
| **Tray↔dashboard parity audit — remainder** | Still tray-only: quiet mode, tells mode + DM pause, melody toggles, auto-arrange-on-show, start-with-Windows, check-for-updates (task #52) |
| **P1 recovery tail (bot 3.1.52)** | 4 backfills (Chadivarius/Bardtholemu/Dafeet/Lowang) recover The Final Arbiter — still pending. Stage branch `…-stage-web-1-1-62` still needs local-session deletion |
| **Overlay design-consistency pass** | Task #54 — load frontend-design skill first; Hitya flagged it hardest |
| **Task #27 — the 8 muted trash triggers** | Restore on Hitya's word — raid-noise call |
| **Dead-triggers runbook needs re-measuring** | Agent 3.5.46+ auto-heals bare-`^`; the Aug-4 "37 of 109" predates it |
| **Item icons / Zeal EPERM / #204–#207 / Data Sentinel / guild-gate / ratchet+O1 / Mob Info DoT grouping / eql-support doc** | Unchanged — see `DECISIONS-2026-08-19.md` for detail (tasks #36, #31, #42, #40, #41, #44) |
