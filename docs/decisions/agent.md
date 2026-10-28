# Agent & log upload

The log agent, its dashboard, backfill, the upload queue, ingest and load-shed. Oldest first. Find an entry by its ID in [the index](README.md); new decisions go in `inbox/` and are merged here.

## 2026-08-07/4 — Mimic / agent
*2026-08-07 · DECISIONS-2026-08-07.md · Log archiving on by default at 500 MB*

**Log archiving: ON by default at 500 MB**, idle 15 min, `WP_LOG_ROTATE_MB=0`
disables. Archive, never cull — old logs feed `--since` backfill and historical
chat. Announced with a one-time in-app banner, not a Discord post.

**Guild management window is read-only**; editing belongs on existing web
pages. Note EQ gives us no guild roster at all — `/outputfile` takes
`inventory | spellbook | quarmy | raidlist`, all character-scoped. Public and
personal notes would have to be OUR fields.

## 2026-08-13/1 — Dashboard navigation: a sidebar, and a split by JOB rather than by size
*2026-08-13 · DECISIONS-2026-08-13.md · Dashboard gets sidebar and job-based tab split*

**The ask (the guild lead):** *"the dashboard having a sidebar for quick navigation is
something I'd like to consider — having to scroll in our dashboard is somewhat
annoying to navigate."* Confirmed as the **Mimic** dashboard (not wolfpack.quest),
and scoped to **sidebar + split the fat tabs** rather than the sidebar alone.

**Why both halves.** A sidebar moves the navigation but does not remove the
scroll — the cards are still stacked in the same piles. Splitting the piles is
what fixes the hunting; the sidebar is what makes room for the extra
destinations, because a horizontal tab strip runs out of width at about eight
buttons and a vertical rail does not. Neither half is worth much alone.

**The split rule: carve by the QUESTION a card answers, not by card count.**
Info had reached 16 cards and Triggers 12, and both had grown the same way — by
absorbing cards that had nowhere else to live. Measured, Info was answering three
unrelated questions at once:

| Question | Went to |
|---|---|
| "What did my log see this session?" | **📊 Stats** (new) |
| "Is the machinery working?" | **🩺 Diagnostics** (new) |
| "What is this parser / this install?" | Info (kept) |
| "What will call out, and did it?" | Triggers (kept) |

Splitting on *volume* instead ("take the bottom half of Info") would have left
the same three questions interleaved across two tabs, which is worse than one
long tab — a member would have to know which half a card fell into.

**What deliberately did NOT move:**

- **The crash review card stays on Info.** the guild lead placed it there the same day
  (*"the review my crashes button in the dashboard is the wrong spot for it,
  lets put that in info"*). It is arguably a diagnostic, but it was a direct
  call and a fresh one — moving it would have quietly reversed a decision
  hours old.
- **Client versions stays on Info.** "What build is my client running" is a
  fact about the install, not a health check.
- **The Dashboard tab was left alone** at 9 cards, despite being third-fattest.
  Its cards are all "me, right now" and most are hidden until they have data;
  the only structural candidate for eviction was ⚙ Engine → Logsync, and Engine
  is already a collapsed `<details>` contributing one summary line of scroll.
  Moving it would also have buried the **setup checklist** — the first-run
  "is this working" panel — under a tab a new user has no reason to open. Not
  worth the blast radius. Revisit only if Dashboard grows.

**Implementation constraint that shaped the diff: move MARKUP, never renderers.**
Each card's volatile content lives in its own `wp*` placeholder filled by its own
render fn, which is what keeps a section's HTML byte-stable between 2s polls (a
section that differs every poll rewrites wholesale — flicker, form resets, lost
scroll). Relocating a card therefore means moving one `h += '<div id="wpFoo">'`
line to a different render fn and leaving the filler untouched. Two new section
owners (`renderStats`, `renderDiag`) rather than two rewritten ones.

**Ordering rule this exposed.** A filler that runs BEFORE the fn emitting its
placeholder is a no-op — the card is blank for one poll on a cold load, then
silently fixes itself. `renderCrashReview` had been in exactly that state since
the crash card moved to Info earlier the same day. `renderDiag` had to be
inserted into `_sections` above its six fillers for the same reason.

**Known benign side effect: hidden panels come back once.** The ✕/⚙ Panels
preference key is `sectionId|title`, so a card the user hid on Info reappears
under its new section. Nothing is lost and re-hiding sticks. Recorded because it
will look like a bug the first time someone hits it.

**Shipped:** agent 3.5.72 on `beta`. Tests: `test/dashboard-tabs.test.js` —
guards the four lists that have to agree (nav buttons ↔ `.section` panes ↔
`_sections` entries ↔ placeholder ownership) plus filler ordering. Every one of
those disagreements previously failed silently; the ordering assertion is what
caught the crash-card bug.

## 2026-08-13/4 — Two machines rewrite guild chat before we ever see it (chat double-posting)
*2026-08-13 · DECISIONS-2026-08-13.md · Guild chat reaching Discord twice, rewritten*

**The report (guild lead, 2026-08-13).** Guild lines were reaching Discord twice —
once verbatim, once tidied up. Four pairs from one afternoon:

| verbatim | rewritten |
|---|---|
| `its usually 5-7 k per full clear` | `Its usually 5 7 k per full clear` |
| `ok!/camp` | `Ok camp` |
| `well i'll die tonight lol.. i gotta run.. errand to do` | `Well i'll die tonight lol . i gotta run . errand to do` |
| `thx.. but do have to go =x` | `Thx . but do have to go x` |

The rewrite capitalises the first letter and turns `-` `!` `/` `=` into spaces
or drops them. Apostrophes survive.

**⚠ The cause written into our own code was wrong, and the guild lead's screenshot
disproved it.** `index.js` claimed EQ shows the speaker their own line as typed
and broadcasts an auto-capitalised copy to bystanders. The guild lead is a **bystander**
on every one of these lines and his client shows the raw text verbatim. So EQ is
not rewriting anything on the wire.

**It is two specific machines.** Grouping `chat_messages` by `uploaded_by`:
rewritten copies came from **a member** (×3) and **a member** (×1); verbatim copies
from a member's owner, the guild lead, a member and a member/a member. **Not our code** —
a member, a member, a member and a member's owner were all on agent **3.5.58**, and
that build sits on both sides of the split. Not compat mode either: a member
has it on (see the Zeal-pipe entry above) and ships verbatim.

**Cause still unidentified, and deliberately not guessed at** — that is three
wrong mechanism-guesses avoided in one day. The decisive test is cheap: have
a member search his own `eqlog_*_pq.proj.txt` for one of those lines.
- log contains the REWRITTEN text → client-side (UI mod, chat filter, client
  build) and there is nothing for us to fix beyond dedup;
- log contains the VERBATIM text → our agent is mangling it on upload, which
  would be a much bigger deal and entirely ours.

**Fixed in bot 3.1.42 regardless of cause**, because two strings for one line
must not double-post:
- Dedup keys (`_chatDedup` and `_chatRelayDedup`) now key on a
  **punctuation-insensitive** shadow of the normalised text. Both variants
  collapse to one.
- **The fuzzy slur-variant matcher could not have caught this** and must not be
  loosened to try: it requires equal token counts, and `..` → ` . ` *inserts* a
  token. Loosening it would degrade drunk-speech dedup, which is what it is for.
- Punctuation-only messages (`...`, `!!!`) fall back to the exact key — stripping
  punctuation reduces them all to the empty string, which would collapse every
  one of them together.
- **Collapsing alone would have been a regression half the time.** The rewritten
  copy is lossy (`5-7 k` → `5 7 k` changes the meaning; `=x` → `x` eats the
  emoticon) and whichever copy lands first wins the post. So the relay now
  scores each copy by surviving punctuation and **heals the posted message** when
  a higher-fidelity copy arrives, reusing the existing speaker-heal edit path.
  Text and speaker heal on independent axes so neither undoes the other.

**Not widened: the witness key.** `_witnessKey` has the identical blind spot —
a rewritten copy lands in its own slot, so that uploader's testimony about the
speaker is lost for that line. Merging them would strictly improve attribution,
but the witness map is what drives speaker relabelling and has its own history
of subtle bugs (the stray-log ghost-rename). Left alone on purpose; separate,
considered change. Tests: `test/chat-rewrite-dedup.test.js`.

## 2026-08-20/5 — Inventory auto-upload: the third sibling was never built (Guild lead: "are we not consuming inventory files when they get updated?")
*2026-08-20 · DECISIONS-2026-08-20.md · Inventory auto-upload was never actually built*

**The finding.** The bot's `/api/agent/inventory` endpoint has existed since
2026-06-23 (Guild lead: *"load the inventory, spellbook, and quarmy files via
mimic the way we are the logs"*) and the `/character/<name>/inventory` page
copy claimed "Mimic uploads this automatically in 1.0.78+" — but the
agent-side scan was NEVER written, in any version, anywhere (repo history
searched). Quarmy and spellbook shipped their halves; inventory silently
stayed manual-/me-upload-only. Result: 2 of 122 characters fresher than 30
days, family snapshots frozen at July 15, August's Ancient scrolls invisible
to the item search, a member's file sitting unconsumed in the scanned dir.

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
upload for <Char>` in the agent log within ~40s of boot; a member's page
fills; `character_inventory.observed_at` goes current for every character
with a file on a running box.

**Graduated same-day (Guild lead: "lets go to a new minor version for agent and
send this out as a miMIC update as well since this is pretty important").**
Agent re-versioned **3.6.0** (new minor line), Mimic stable **2.6.0** cut
from main carrying the whole beta delta (inventory auto-upload + buff-queue
overlay + DT timer-arm — byte-identical file promotion, verified), release
notes written member-facing per the v1.1.20 rule, beta re-parked at 2.6.1.
Unnamed release (plain version string — naming is the guild lead's call and
none was given).

## 2026-08-20/6 — Backfill Dismiss was a no-op inside Mimic: Electron has no window.prompt()
*2026-08-20 · DECISIONS-2026-08-20.md · Backfill dismiss broken by missing prompt*

**The finding (Guild lead: "dismiss button for backfill doesn't do anything, and
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

**Cleanup.** the guild lead's two stuck June-12 requests (a member, a member) dismissed
server-side per his clicks. ⚠ **~115 more stale June 9–15 data-gap requests
are still open fleet-wide** — every member with a matching character sees
their own undismissable-until-3.6.1 nag card. Bulk-dismissing the June sweep
is the guild lead's call (the four 2026-08-17 Sleeper's Tomb recovery requests must
survive any sweep — they are the live P1 tail).

## §402 — Local Mimic site B, guest pass A, and the rest of the 2026-10-21 desk picks
*2026-09-21 · DECISIONS-2026-09-21.md · Local Mimic site and guest pass*

- **Local Mimic site: B** — the website's own pages bundled into Mimic (web/local, static export, served by the
  agent under /local/), not a second copy as dashboard tabs. The guild lead: *"We need the local things to be
  accessible on the left nav still, things that are local to the game client."* So the dashboard rail gets an
  "On this PC" group. Shipping (inside Mimic vs a downloaded pack) not answered yet.
- **Guest mode: A, a 6-hour pass.** The guild lead's note, verbatim: *"The intent is for them to be able to see the
  target info, command center, the TTS callouts, buff queue. Really overlays to work, the rest of the info and dkp
  bits should not be mixed into anything in Wolf Pack. Parses they attend should have a *GUEST* on them and point
  them out. We are already letting some guests into our raids for flagging purposes. They really need their own view
  rules. They could be asked if they want to associate any alts/mains/discord with their character."* So a guest
  pass grants READ of the raid's overlay feeds (guild triggers, buff queue, target info, Command Center relay) plus
  marked uploads — never DKP, member pages or Wolf Pack's own record — and it also covers guests in OUR raids.
  Earlier the same night: *"if the environments are separate, the user data would need to be local to their
  machines to push up to production later for their guild."*
- **Not now:** rev-merch, rev-appliance, rev-raid-content, rev-operator-bundle.
- **Also picked:** fold-copy-corrections A; buffs-classic-grid B (*"needs demo data to preview, updated for pop
  spells"*); brand-protection A with legal review first; rev-setup-service A; rev-decision-desk-kit A (*"nobody
  will pay these options try again"*).
- **Desk:** every card now has "Neither" and "Not now" (*"Decision desk needs a neither choice or not now"*).

## §403 — Overnight 2026-10-21/22: local-first built, and the 3.0 cut prepared
*2026-09-21 · DECISIONS-2026-09-21.md · Local-first built overnight, 3.0 cut prepared*

Built on `beta` in one night after the §401 picks (local-first personal mode A, §402 local site B). Agent versions:
- **3.8.42** dashboard layout A (Triage: grouped rail, section index per tab, folded lists).
- **3.8.43** the local store and Mimic's own raid recorder (a minute of the raid per row, 90 days on the PC).
- **3.8.44** the local site opens: Inventory (account-wide, shared bank once).
- **3.8.45** My replay on the local site, with boss kills and the timeline strip.
- **3.8.46** Rebuild from my logs (fights, raid sessions, zones, deaths, loot from old logs; pauses in a fight).
- **3.8.47** My parses on the local site, with the difference against the guild's record.
- **3.8.48** raid codes: join another group's raid with a six-hour code; raid-wide uploads are held and the data
  stays on the PC; export and import as a file (the first slice of guest pass A, §402).
- **Promoted to `main` as the 3.0 release** (bot 4.0.0 · web 2.0.0 · agent 4.0.0 · Mimic 3.0.0): beta's whole tree,
  because `web/local` imports 12 web files that differ from main. The bot, data and migrations were already
  identical on both branches, so the cut applies no database change. The release has no name yet (the guild lead
  names releases).
- **NOT done:** (1) the hub change-cursor route `GET /api/agent/local-sync` and its migration, which My parses'
  difference needs on a guild hub: written on a bot branch that is not pushed, migration not applied (the agent
  feature-detects the 404 and says so). (2) Item icons from the game's own files: running in the guild lead's own
  PC session, not here. (3) Guest slice 2: the hub reading a guest's overlay feeds (guild triggers, buff queue,
  target info, Command Center relay). (4) The Rehearse tab itself (only its bot route, §401, is on main). (5) The
  Saryrn naming fix (§399) and a callout-history decision (§401) are still open. (6) The public privacy page
  (`web/app/privacy/page.tsx`) still carries the 2026-10-15 text; `docs/PRIVACY.md` was updated 2026-10-22 with the
  local-store, raid-code and rebuild paragraphs. (Items 1 and 6 changed in §404.)

## §23 — The guild lead's agent stalled mid-fight on Emperor Ssraeshza (2026-09-25, ~03:20 UTC)
*2026-09-25 · DECISIONS-2026-09-21.md · Agent stalled mid-fight; server-side evidence*

The guild lead, mid-raid: Target Info *"is frozen mid-fight"*; the full
screenshot also showed the CH chain overlay's red **"OVERLAY BLIND — agent not
responding. GO MANUAL."** (no answer from the local agent for 5 s). A Mimic
restart fixed it.

**What the server side shows** (aggregate counts only):
- **It was the agent, not one overlay.** The guild lead's threat-snapshot
  uploads ran at 5–10 a minute from 03:10, fell to **1 in the 03:20 minute**,
  and came back at 03:21 with the restart. Uploads are the agent's own
  outbound work, so the whole process went quiet, not just its local server.
- **Only this one agent.** The other 13 uploaders in the fight held a steady
  10 a minute straight through 03:20.
- **Already running slow before the stall:** the guild lead's rate was 5–9 a
  minute in the minutes before, against everyone else's 10.
- **Not a slow leak over the night:** the agent had been running only ~15 min,
  since the update to 2.7.2-beta.2 (between 02:49 and 03:09 UTC). beta.2 changed
  only the DPS meter header (renderer code, cannot stall the agent); the agent is
  3.7.16, the same as the 2.7.1 stable.
- **Ruled out by reading the code:** the HUD's per-request work (`_serializeMeState`):
  the hit list is capped at 400, swing rounds at 40, the swing fit is bounded,
  and the three loops added since 09-22 all terminate.

**Cause: not found yet.** Mimic restarts an agent that CRASHES; nothing restarts
one that HANGS (no watchdog in `main.js`), which is why this needed a manual
restart mid-fight. Next: the guild lead's `%APPDATA%\wolfpack-mimic\agent.log`
around 23:15–23:22 ET (it appends, so the lines before the restart survive), and
a proposed hang watchdog — ping the agent, and restart it after ~30 s without an
answer, without counting that as a crash for the rollback logic.

**Follow-up, same day — cause found in the agent.log, fixed on beta (agent
3.7.17).** The log has no per-line timestamps, but three boots can be dated from the
catalog-cache stamps and the queue-file names: beta.2 at **03:05:06 UTC**, the
manual restart at **03:21:23 UTC** (the server-side gap), and beta.3 the next
morning. Nearly all of the session between the first two is one line repeated
**4,656 times**: "<A>'s fight on Emperor Ssraeshza ended via peer <B>",
alternating with the reverse.

- **Mechanism:** `EncounterBuilder.flush()` closes matching fights on its live peer
  trackers, so one whose log missed the kill line doesn't sit open forever. It did
  that **before resetting itself**, so the peer's own flush found the first tracker
  still open and flushed it back, A → B → A → B, until the call stack overflowed.
  A bare `catch (e) { void e; }` swallowed the RangeError. Every level then unwound
  normally, each having re-run a whole boss flush and re-queued its upload. That
  is the minute-plus of blocked process.
- **Not the first time:** the same logs hold three earlier cascades that nobody
  noticed: Thall Va Kelun **5,417** levels deep, A Shissar Defiler **3,344**, and an
  earlier Emperor attempt **1,033**. The code has been like this since at least
  2026-09-11.
- **Server not flooded:** no uploader has more than 11 contribution rows in
  02:30–04:00 UTC, so the repeats either never left the blocked process or merged.
- **Fix:** reset *before* closing peers (capturing the boss name and last-event time
  first), so a peer's loop finds nothing open and the chain ends at one level; the
  catch now logs. `test/cross-flush-no-recursion.test.js` drives the real class:
  two and three trackers each flush once, and a tracker on another boss stays
  open. On the old code it fails with **440 flushes per tracker instead of 1**.
  Full gate green (293 files / 4,036 tests).
- **Scope:** only installs running more than one live tracker in the same fight.
  The stable agent 3.7.16 carries the same code, so stable needs a graduation.
  The hang watchdog is still worth doing as a backstop, but it is no longer the
  fix.
- **Found in passing, not changed:** every boot logs "queue file unreadable
  (Unexpected end of JSON input)" and moves the queue aside as `.corrupt-*`. It is
  a false alarm: an empty queue saves as a zero-byte file, and the loader's legacy
  fallback runs `JSON.parse('')`. Nothing is lost, but it leaves a corrupt-file
  artifact at each start.

## §66 — Rallosian Glory PvP kills (2026-09-28, agent 3.7.36 beta, bot 3.1.164 main)
*2026-09-28 · DECISIONS-2026-09-21.md · New Rallos Zek PvP kill lines parsed*

The guild lead posted two new broadcast lines after the PoP patch (*"Some new messages"*):
`[PVP] Rallos Zek watches as <killer> spills <victim>'s blood in <zone>, but finds no worthy conquest.`
No pattern matched it and the unmatched capture only kept lines with "has killed", so both kills in the
screenshot are in neither `pvp_kills` nor `pvp_deaths`.
- **Agent:** `parseGloryKill` reads killer, victim, zone (split at the clause, not the first comma, so
  "Doomfire, the Burning Lands" survives), `source: 'rallos_glory'`, guilds null. `glory` is `false` only
  for the "no worthy conquest" ending we have seen; any other ending is kept as `gloryText`. The unmatched
  capture now also keeps any Rallos Zek / Glory line that fails to parse, so the worthy-kill wording is
  on record the first time it appears.
- **Bot:** the line names no guilds, so `_resolveGloryGuilds` fills them: each name's latest non-anonymous
  `/who` guild in the last 30 days, else our roster → Wolf Pack, else unknown. A Glory kill is always
  player-versus-player: it counts as ours when one side is ours even if the other guild is unknown, and
  never takes the boss-timer path. Its guilds came from `/who`, so it is not written back as a sighting.
  The post dedup also keys on killer + victim, so the same kill in both wordings posts once.
- ⚠ **Reaches players only through Mimic.** Beta testers get it now; stable users will not read Glory
  lines until a stable Mimic is cut.

## §66a — The Sebilis Glory kills that were missed (2026-09-28, no code change)
*2026-09-28 · DECISIONS-2026-09-21.md · Missed Sebilis kills explained, old agents*

The guild lead, with two "…spills …'s blood in Ruins of Sebilis, but finds no worthy conquest" lines:
*"did these get missed"*. Yes, and nothing is broken now.
- **Why:** PvP in Sebilis came back on about 19:51 UTC, and guild chat reacts to a kill at 20:25. Only two
  machines uploaded PvP that day, and both still ran agent 3.7.35, which predates `parseGloryKill`
  (3.7.36 went to beta at 20:28). The line matched nothing and was dropped without a trace, because
  3.7.35's unmatched capture needed "has killed". The first Glory row stored is 22:18 UTC, after the
  uploading machine took 3.7.37 (about 21:20–21:40). The two posts it did make at 20:11 and 20:25 were
  instanced boss kills (Fright, Lord of Ire), both in `pvp_boss_kills`.
- **Checked, not the cause:** the live tail runs `parsePvpBroadcast` before `shouldKeep`, and the Opt-in
  Logs replay does too, so no filter drops the line on 3.7.36+. Glory rows from 22:18 on are all stored.
- **Recovery:** anyone whose log holds the lines runs Opt-in Logs over that afternoon on 3.7.36+. The
  replay reads the line, sends it flagged as backfill (no per-kill Discord post, one summary), and the
  bot's dedup keys make re-sending the three stored kills harmless.
- ⚠ **What this shows:** PvP collection rests on the few members whose client displays the `[PVP]`
  channel, not on the whole fleet. Two uploaders on 2026-09-28, the column only exists since 2026-09-26.
  A new server broadcast is lost for exactly as long as those few run an agent that predates its parser.

## §69 — Quest NPC lines that look like tells are not tells (2026-09-28, bot 3.1.165)
*2026-09-28 · DECISIONS-2026-09-21.md · NPC quest lines are not tells*

The guild lead, with a Discord DM reading "Maelin → <character>: Welcome to Myrist! …": *"this is an NPC
message, not a tell"*.
- **Cause:** Grand Librarian Maelin's PoK script prints its own chat line,
  `e.other:Message(0, "Maelin tells you, '…'")`, 17 times across the PoP flag steps. It lands in the log
  exactly like a `/tell`. The agent's NPC-sender rule (3.6.52) compares against the targeted NPC's FULL
  name, and "Maelin" is not "Grand Librarian Maelin". In game it shows as `[Fr] [Maelin]:` because Zeal's
  `/abc` abbreviation rewrites any "X tells you" text; that label does not mean it came in as a tell.
- **Fix, on the bot so the whole fleet has it without a Mimic update:** drop an incoming tell whose sender
  AND text are a line some quest script prints as a tell. The lines are read from `eqemu_quest_scripts`
  (20 scripts, 67 lines, 16 senders; cached 6 h, fail-open). A name rule alone was measured and rejected:
  four real players share an NPC's name or last word, with 49 real tells between them, and 27 senders
  never seen on /who sent 90 tells that look real. Covers Maelin, Mavuin (PoJ) and Thelin; the 13
  multi-word senders were already dropped by the agent.
- **Stored rows:** the 8 Maelin rows (all 2026-09-28) were deleted by the same exact match; nothing else
  matched. Older NPC rows (bankers and a merchant, ~77 in all, mostly before 3.6.52) are left alone.
- **Not changed:** the agent's local Recent Tells card still lists these lines until the agent's
  NPC-sender rule also accepts the target's last word. The exact long-term signal is Zeal's chat colour
  (0 for this line, 257 for a real tell), which Mimic does not forward to the agent.
- **Side finding, filed in STATUS:** with Zeal `/abc 2` ("Chat and Log") the LOG line itself becomes
  `[Fr] [X]: …`, which the agent's tell pattern never matches, so those users' real tells are not
  captured at all.

## §109 — An assist on an NPC is not a PvP assist (2026-09-30, bot 3.1.177)
*2026-09-30 · DECISIONS-2026-09-21.md · NPC kills not counted as PvP assists*

The guild lead: *"query and flag any pvp kills that are probably an NPC name. trakanon is an NPC"*.
- **Why it happened:** the server announces a boss kill in the same words as a player kill ("<name> of
  <guild> has killed Trakanon in Ruins of Sebilis!"). Kills were already handled; the ASSIST path
  (`_checkPvpAssists`, §54) credited every raider who hit the boss with a PvP assist.
- **Found, flagged, not deleted:** `pvp_kills` id 10 (Lord of Ire); `pvp_assists` on Trakanon 162–171
  (2026-09-29 22:49 ET), 126–132, 82 and 83; on Fright 80, 81, 86; Terror 85; Dread 84. A player who
  shares a boss's name was checked by `/who` and kept. Deleting the rows waits for the guild lead's yes.
- **Fix:** `_victimIsNpc` in `_handleAgentPvpAssists` drops an assist whose victim had no guild in the
  broadcast, is in `eqemu_npc_types`, and was never seen in `/who` with a class or a guild. Cached per
  name per request. `test/pvp-assist-npc-victim.test.js` runs it against a stub.
- **Missing kill (same night):** no kill row for any of the guild lead's characters in the last 7 days,
  and their agent's PvP uploads were healthy. To find it: the victim's name and the time or zone, or the
  log line.
- **Deleted 2026-09-30 on the guild lead's yes:** the 24 assists and the one kill above, nothing else (no
  assist pointed at the kill). A re-run of the NPC check found none added since bot 3.1.177.
- **Found after, then deleted on a second yes (2026-09-30):** 20 rows in `pvp_deaths` whose victim is an
  NPC (Aten Ha Ra, Emperor Ssraeshza, Shik`nar mobs, Fright, Dread…), all from the table's 30-day backfill
  at its creation (2026-09-26). They fed the fight history (2+ deaths = a fight).
- **The missing kill was a Glory-worthy one, and the agent could not read that wording.** The guild lead,
  with a screenshot: killed a player of another guild in Ruins of Sebilis, 2026-09-29 22:55:44 ET. The line was
  *"[PVP] Rallos Zek marks <killer> with his favor for spilling <victim>'s blood in Ruins of Sebilis.
  <killer> now bears 1 of 10 measures of Rallosian Glory."* `parseGloryKill` only knew the "watches as …
  finds no worthy conquest" wording (§66), so this line went to the local unmatched capture and no kill,
  death or assist uploaded. Every Glory-worthy kill since the PoP patch was missed the same way.
  Agent 3.7.51 (beta `3f0dd0a3`) reads it (`PVP_GLORY_WORTHY_RX`, `glory: true`); no bot change. The kill
  was written by hand: `pvp_kills` 779, `pvp_deaths` 1816, source `log_backfill`, with the bot's own dedup
  keys so an Opt-in Logs rerun collapses onto them. Other raiders' missed Glory kills come back only through
  Opt-in Logs on 3.7.51+.

## §123 — A plain /who uploads its zone; the eqmimic.quest demo; where eqmimic.quest can live (2026-10-02)
*2026-10-02 · DECISIONS-2026-09-21.md · Plain who uploads zone, eqmimic demo*

The guild lead: *"using /who all doesn't give us who is in my current zone. it gives every zone."* Then:
*"where is the standalone miMIC? is it on eqmimic.quest? individuals can use it locally. still uses the
wolfy miMIC logo, but generate a demo site around it with demo data that users could expect to see. you
may use obscured data from our guild's parses and whatnot. no who data. sample admin pages, etc."*

**/who, agent 3.7.62 (beta `5250261a`).** `/who all` puts each player's short zone on the row; a plain
/who (your own zone, the one people type) prints none there, only in its footer ("There are 12 players
in Plane of Storms."). The agent used the footer for the /who overlay alone (§73 kept it out of the
upload on purpose), so those rows uploaded with no zone: **7,263 of about 9,400 /who rows in two days**.
Now the footer's zone goes onto that run's rows in `whoData`, lower-cased, and the who flush runs even
when no new name appeared (a /who of people already seen used to upload nothing at all). This
**supersedes §73's "upload untouched"**: `who_observations.zone` now holds short names and lower-cased
long names, and `web/lib/popWho.ts` maps both (Ragrax shares "Plane of Earth" with the plane above it,
so a long-name sighting there proves only the outer gate).
**Hot-swapped to stable the same night** (the guild lead: *"hot-swap the /who fix to stable. we're not
raiding tonight."*): main's agent went 3.7.59 → **3.7.63** with only this change, so every stable Mimic
picks it up on its next agent check; beta's agent went to **3.7.64** so the beta line stays above it.
Pushed at 22:30 ET on a Thursday with `[hotfix]` (inside the freeze window; no formal raids until 10/14,
§113). ⚠ The agent's raid hold is schedule-driven (§115), so stable Mimics take 3.7.63 after 00:30 ET,
not at once, unless an officer sets `flag_raid_hold = 0`.

**The standalone Mimic (the answer).** There is no separate program: it is Mimic in local mode, in the
Mimic 2.7.7 beta from beta.7 on (§118). Pick "Run local-only" in setup. The download page that offers it
is at `hesstastic.com/eqmimic/` (A) and `/eqmimic/b/` (B). **eqmimic.quest is not live**: on 2026-10-02
it resolved to the registrar's parking address and failed TLS.

**Where eqmimic.quest can live (correcting §118).** §118 and the hesstastic README said to add the domain
to "the Vercel project that builds this repo". There is none: every deployment of the hesstastic repo is
`github-pages`, and a Pages site carries one custom domain (hesstastic.com). Two ways:
- import the hesstastic repo into Vercel as a project and add `eqmimic.quest` there; `vercel.json`
  already routes that host to `eqmimic/`; or
- a new `eqmimic` repo with the contents of `eqmimic/` at its root, Pages on, `CNAME` = eqmimic.quest.
Either way the registrar's DNS points at the chosen host. Both are the guild lead's steps (a cloud
session cannot create repos or Vercel projects, and the Vercel connector needs sign-in).

**The demo (hesstastic `e2d2f62`).** `hesstastic.com/eqmimic/demo/` is a tour of one raid night and
`/eqmimic/demo/b/` an app to click around, the same screens in two layouts (one gets picked, the other
deleted):
- **Overlays:** a real 7-minute fight (Xerkizh The Creator, 32 raiders) replayed in 48 seconds: the damage
  meter with your row pinned, timers, callouts, Target Info with the boss's real stats.
- **Mimic's control panel:** your fights, triggers, overlays, settings in local mode.
- **Guild site:** the raid night and every boss's parse.
- **Officer pages:** guild triggers (real game text), attendance, loot and DKP, members and their Mimic,
  bugs and ideas.
- **The data:** the 2026-09-24 Ssraeshza Temple night: damage per raider, boss stats, attendance over
  seven nights, the night's drops. Every character name is replaced by an invented one, checked against
  every name in `characters`, `who_observations` and `eqemu_npc_types` (four collisions dropped); the
  guild is "Lantern Watch"; dates move back eight weeks; ranks, DKP, Mimic versions and the bug reports
  are made up. No /who data is shown. The mapping is shuffled at random and never saved.
  `eqmimic/demo/tools/build-data.cjs` builds `data.js` from a private export (not committed) and
  refuses to write if a real name survives; a second scan of every published file found none.
- Both download pages now carry the wolf Mimic logo and link to the demo. Smoke-rendered at 1280 and
  390 wide: no console errors, no sideways scroll.
- **Cost:** build moderate (one shared panel script, two thin layouts); maintenance low (static,
  regenerated only when wanted); runtime light (~20 KB data, no requests); change easy (screens are
  functions).

## §162 — FB-51: EverQuest stopped writing the log, and nothing said so (2026-10-05)
*2026-10-05 · DECISIONS-2026-09-21.md · Silent log stop now detected*

- **Report (the guild lead, late Sunday):** "I'm not currently seeing rolls", then "the damage isn't loading
  either", then FB-51 "NO damage on fights, no rolls, missing plenty of stuff". Zeal's abbreviated chat showed
  rolls as `[0:222]: 26 rolled by X.`, a red herring: the log file keeps the two-line form, and four other
  agents (one on the same 3.7.80 beta) captured those rolls.
- **What it was:** the player's `eqlog_<char>_pq.proj.txt` (540 MB) stopped being written at 00:45 while they
  kept playing; Explorer showed "Date modified 12:45 AM" at the size the agent found on its 00:49 restart. Every
  agent line after that came from Zeal's pipe or relays; nothing local. **Fix in the field:** move the log
  aside, restart EverQuest, which starts a fresh file. **Why EQ stopped is NOT known** (size, a `/log` toggle, or
  another folder were all possible; the fresh file fixed it). Do not cite a size limit as the cause.
- **Ruled out on the way, so the next session need not re-check:** roll format, Zeal chat display,
  `exclude_from_stats`, agent 3.7.80 (worn-DS code runs only in the HUD state), a client switch, the camp
  state, log rotation (none ran), disk space (37 GB free).
- **Shipped to beta, agent 3.7.81 (`27022a44`, "Fixes FB-51"):**
  - `[log-silent]`: Zeal has the primary character in game (< 60 s) and their log has had no line for 5 min →
    one warning per episode and `logSilent` on `/api/state`. No UI yet; the on-screen form is the guild lead's
    call (UI rule). It would have flagged this case at about 00:50.
  - Tail watchdog: a hung `fs.promises` call in `tailFile` can no longer end the read loop silently.
  - Bug-report excerpts keep the NEWEST lines over the cap (they kept the oldest; FB-51's ended at 00:31).
  - An empty upload-queue file no longer reads as "corrupt" (it did on every boot after an empty shutdown:
    24 times in one member's log).
- **Found, not changed: log archiving has never run in Mimic.** `_logRotateSweep` (500 MB, default on since
  2026-08-07) has its timers inside the `--once` branch, which exits after a few seconds; watch mode returns
  before reaching them. That is how the log reached 540 MB. Wiring it into watch mode would start renaming
  members' logs for the first time, so it waits on the guild lead's yes.
- Also noted: the bug-report preview shows the first 400 lines of the kept slice (now the oldest of the newest).

## §251 — Zone copies: the zone server port from dbg.txt, and the /who live/PvP check (2026-10-13, agent 3.7.140 beta `bcc6f1d6`, bot 3.1.250)
*2026-10-13 · DECISIONS-2026-09-21.md · Detect live or PvP zone copies from zone port*

- **The ask** (the guild lead): *"we can see the different zones in the debug file we reviewed earlier in this session
  with port numbers. if a /who reveals anyone in the zone that's not in our guild and not in our raid, we are in live
  or PVP."* This builds phase 3 of `DESIGN-mimic-2.9-spawn-map.md` (option B of §248's "A now, B later").
- **dbg.txt reader (agent):** tails `<EQ>/dbg.txt` the way eqlog is tailed. It parses only `Zone addr [<host>:<port>]
  received`, `StartWorldDisplay: <zone>` (not the `_chr`/`_lit`/`_obj` loads) and `Starting char select`, and keeps
  host, port, zone and time. ⚠ The file also holds install paths and hardware lines: those are never kept or sent.
  A port names one running copy and is reused after it shuts down, so a copy is host:port plus its zone-in time.
- **/who check (agent):** after the zone-in, a plain /who (its footer names the zone) listing anyone who is in neither
  our guild (their tag, or the tag last seen on them, since /anon hides it) nor the raid/group marks the copy
  **open: the live zone or PvP**, for the life of that copy. Only guild + raid = "closed so far": our instance, or a
  raid instance we were brought into. A quiet live zone looks the same, so "closed" is never proof. Our own guild
  comes from a /who that lists you, or /guildstatus.
- **Sync by copy:** each synced map event carries `inst` (host:port; `map_spawn_events.inst`, migration
  `20261013013000`, applied). An event from the same copy is taken from anyone; one from another copy never, even from
  your raid; when either side does not know its copy, §248's raid/group rule stays. Known ceiling: a port reused for a
  new copy of the same zone inside the 8 h pull window would match.
- **Map header:** `<zone> · :<port> live / PvP | guild + raid only | /who to check`, with a tooltip saying why.
- **Not done:** slow mode and PvP ±20% in Map timers (slow mode is not served to agents yet, and trash respawn in slow
  copies is still unknown); telling PvP from live (nothing on the agent says which); pull suggestions (§250, next).
- **Found on the way:** Map target-of-target (3.7.138) and the pin rule's "not aggroed" check (3.7.139) read
  `target_of_target`, which no released Zeal sends. The pipe export was our draft `docs/zeal-tot-pipe.patch`, never sent
  and no longer applying. Both fail open (no arrow; the on-spot/still test still guards the pin). Ported to current Zeal
  main as fork branch `tot-pipe` (`21f41f3`, +123/−39 across `assist_target.*`, `named_pipe.cpp`, README; not compiled,
  reviewed by reading). The push to the fork was refused by this session's permission check: the guild lead's step.

## §392 — Game data for everyone off the Wolf Pack server (2026-10-21, bot 3.2.15)
*2026-10-21 · DECISIONS-2026-09-21.md · Weekly game data pack for standalone raiders*

- **A, weekly data pack** for standalone raiders (built, step 1): `scripts/build-data-pack.js` and
  `scripts/lib/botBuilders.js`, run by `.github/workflows/build-data-pack.yml` after "Sync EQMacEmu" into ONE rolling
  prerelease, tag `data-latest` (files first, manifest last, stale files dropped after). Checks fail the build:
  catalog row counts against the database, zone packs, sha256, a 60 MB budget; estimated 11–14 MB. The #mimic-releases
  announcer now requires a `v<number>` tag so the data release can never be announced as Mimic. Step 2 (Mimic reads the
  pack) is not built.
- **C, a self-host "load game data" step** for self-hosted guilds (built): `scripts/selfhost-load-game-data.js`, run after
  `selfhost-bootstrap-db.sh`; it verifies per-table counts, refuses Wolf Pack's project, takes `DUMP_URL` for a guild's
  own server and `SYNC_STATE_FILE` so a new guild never inherits Wolf Pack's "already synced" state. Guide in
  `docs/SELFHOSTING.md`; the old "no self-serve import" bullet in `docs/DESIGN-selfhost-wizard.md` §3 is replaced.
- **Wolf Pack stays on the live database.**
- **Next:** dispatch the pack workflow once and record the real size; step 2; run the self-host step on a throwaway
  project (Open table).

## §401 — Dashboard triage, a Rehearse tab, and local-first personal mode (2026-10-21)
*2026-10-21 · DECISIONS-2026-09-21.md · Dashboard triage layout, Rehearse, local-first*

Picked on the Decision Desk the same night.
- **Dashboard layout A — Triage** (*"Things are so spaced out, important sections are buried at the bottom of a
  huge scrolling page"*; *"Anywhere that could run off with the vertical estate of an area ... collapse it down and
  say 'X more' and a pulsing highlight"*): same tabs, importance order, the rail grouped Live / After the raid /
  Set up / Machine, a pinned section index per tab, every growing card folded with `wpMoreList` (the fold itself
  shipped on beta, `d58d910f`). B (a cockpit band per tab) was not picked.
- **Replay A — a Rehearse tab:** scrubber with kills, deaths and callouts; the target and raid health as the raid
  recorded them (`raid_track_minutes`); the user's own log lines stepping in sync, the clock offset matched from
  kills and nudgeable. Needs a bearer-auth bot route for a recorded window. Open: whether to keep a server-side
  callout history (not answered).
- **Local-first personal mode A, all three first pieces together** (account inventory, own spectator/replay, own
  parses from a local database in Mimic; the hub keeps the shared raid record; a guildless player needs no hub).
  The guild lead's notes: *"The parses definitely need the difference ... In this mode everyone gets a copy of the
  data. We should try to rebuild more of the past data ... We really need to get object images working locally,
  and it can come from EQ files if need be. It would be nice to find a way to replace specific items with a custom
  image locally."* Not picked: volunteer relays (B), a full peer network (C — home IPs, no referee, weak PCs).
  Hosting note for `docs/DESIGN-selfhost-wizard.md` §3 once the plan lands: personal reads move off the hub
  (written there 2026-10-22, §403).

## §411 — Live zone or instance comes from the zone server's port, never from /who (2026-10-22, agent 4.0.5)
*2026-10-22 · DECISIONS-2026-09-21.md · Live zone detected from server port*

The guild lead, in a quiet live Emerald Jungle: *"we made an assumption that this was guild/raid only, but it is not. it's live"*.
A /who listing only guild and raid proves nothing (a quiet live zone looks the same, and the server's /who has no copy filter).
The server gives static zones their own ports and starts guild/raid/PvP instances on a separate dynamic pool (EQMacEmu
world/zonelist.cpp TriggerBootup / GetAvailableZonePort); measured on our events: every zone 7100..7315, extra copies 10001..11785.
The Map reads "live zone" or "instance" from that; the bands are an observation on Quarm, not a server constant. Nothing the
client receives says guild vs raid vs PvP instance.

## §425 — The screen reader: Mimic reads the screen where there is no pipe (2026-10-24, design only)
*2026-10-24 · DECISIONS-2026-09-21.md · Screen reading as third input for games*

The guild lead: *"if we need to read the screen perhaps that is a good way for us to operate moving forward. I suppose we need
OCR locally? not every game has a named pipe"*, then *"EQ without Zeal first... wow second. perhaps gta6 afterwards"*.
- **The call:** screen reading becomes the third input beside the log and the Zeal pipe, never a replacement. Order: EverQuest
  without Zeal first (the pipe scores every read), WoW second, GTA 6 afterwards and only after its anti-cheat terms are read.
- **Rules that ship with it:** regions only, never a full frame stored or uploaded (the chat window holds tells; the same
  chokepoint as the log filter); reading sends nothing into the game; regions follow the game's own window layout from the ini
  Mimic already reads; it works where the overlays work (windowed and borderless).
- **Open:** the engine (A Windows' built-in OCR, recommended; B a small ONNX model; C template matching for bars and icons
  alongside), on the Decision Desk with a picture each. A two-day dry run on the guild lead's PC decides A vs B with numbers.
- **Where it landed:** `docs/DESIGN-screen-reader.md`. Nothing built.
