# Beta test plan — what's in beta, and how to prove it works

*The running ledger of features shipped to the **beta** channel awaiting
verification. Each entry names the exact component versions it needs, then splits
test cases into **✅ Solo** (you can do these alone) and **👥 Multi-person**
(need 2+ raiders on separate machines). Mark a row ✔ when verified in a real
raid; move it to STATUS.md's "Done" once graduated to stable.*

> How to read component versions: **bot** ships from `main` (live on Railway
> immediately). **agent** ships bundled in the **beta Mimic** — testers must be
> on the beta channel and have updated Mimic so the agent version below is what's
> running (check the agent dashboard footer / `/status`).

> **Graduated 2026-07-18 (#89):** the 1.9 beta line — Mimic **1.9.5** / agent
> **3.3.80** — is now the **stable** build. Everything below (reporter election
> #72, `{s}` backtick triggers, callout trifecta #76) rides in it, so these are
> live for the whole raid on **stable**, not just beta testers. Verify-in-raid
> is still welcome; the ledger entries move to STATUS.md's Done as each is
> confirmed. Beta re-parked at **1.9.6**.

---

## #113 — Extended Target: same-zone-targets-only option

**Needs:** agent **3.3.96** (beta Mimic) + bot **3.0.218** (live on Railway).

**What changed:** the Extended Target overlay can now hide targets reported by
Mimics that are in a *different zone* from you, so a splinter group off in
another zone stops cluttering your raid's target list. It's a per-user toggle —
a **Same-zone targets only (default on)** checkbox in the dashboard's **Overlays**
tab — and it takes effect within a couple of seconds, no restart. The filter
runs on the bot (it already scopes the aggregation by zone); the agent just
tells the bot whether to. **Fail-open:** if we can't resolve your zone, or a
particular raider's zone is unknown, that data is shown, never hidden.

**✅ Solo (one machine)**
- Open Mimic → **Overlays** tab. The 🎯 **Extended Target options** card shows a
  **Same-zone targets only** checkbox, **checked** by default. Uncheck it, then
  reopen the dashboard (or switch tabs and back) — it stays unchecked. Re-check
  it — persists again. (Persisted in `logsync.optin.json`, so it survives a Mimic
  restart too.)
- With the box checked, the Extended Target overlay shows your current-zone
  targets as before — no regression to the count, HP, debuffs, off-tank/players
  toggles, or the ✕ per-row hide.

**👥 Multi-person (2 raiders, separate machines)**
- Two Mimic users in **different zones**. With **Same-zone targets only ON**
  (default) on each, neither sees the other's target in their Extended Target
  list (each list stays scoped to their own zone).
- Now both zone into the **same** zone and target different mobs — each raider
  sees the other's target appear in the list. Move one raider back to a different
  zone: their target drops off the other's list within a couple of seconds.
- Turn the toggle **OFF** on one raider while they're in a different zone from the
  other — they should now see the other raider's target again (all zones), while
  the raider who left it ON still sees only their own zone.

## #118 — In-console officer kill switches + Mimic version in the fleet table

**Needs:** agent **3.3.95** (beta Mimic) + bot **3.0.217** (live on Railway).
Officer-only — you must be signed into Mimic as an officer to see any of this.

**What changed:** the `/admin/overlays` 🛑 **Kill switches** now live inside Mimic,
in the 🛡 **Admin** tab, so an officer can flip them mid-raid without opening the
web admin. Each whitelisted flag is a one-click toggle showing its current LIVE
value; `☠ AGENT KILL` asks you to type a confirm first ("this pauses EVERY
agent's uploads"); `min_agent_ver_num` is a small number field. The bot only
accepts the whitelisted control-plane keys — the free-form numeric knobs stay
web-only. Separately, the 📡 **Reporters** fleet table's **VER** column now shows
`agent/mimic` (e.g. `3.3.95/1.9.6`; standalone Parser.bat shows `3.3.95/—`), and
the **LOG** column gained a legend explaining the last-log-line staleness signal
and the fresh/stale dot.

**✅ Solo (one machine, officer)**
- Open Mimic → 🛡 Admin tab. The 🛑 Kill switches card renders with every flag at
  its real live value (a non-officer, or a signed-out agent, must see **no card
  and no data**). `dedup_chat` shows **OFF (0)** with the re-enable hint.
- Flip a **shed** flag (e.g. *Shed: fun events*) ON. Within ~60s, load
  `wolfpack.quest/admin/overlays` — the same flag shows checked. Flip it OFF in
  **either** place and confirm it clears in the other within ~60s. (Round-trips
  the same `overlay_tuning.tuning` row both ways.)
- Click `☠ AGENT KILL`. It must demand a typed confirm BEFORE writing. Confirm it,
  verify `/admin/overlays` shows it ON — then clear it and confirm the fleet
  **RESUMES cleanly** (uploads resume within one ~20s heartbeat; nothing dropped,
  the durable queue held).
- Set `min_agent_ver_num` to a value, Save — `/admin/overlays` shows the floor;
  clear it (0/empty) and confirm it unsets.
- 📡 Reporters table: your own row's **VER** shows `agent/mimic` with both
  versions when running under Mimic. The **LOG** column shows its legend line.

**👥 Multi-person (optional)**
- A second officer on beta Mimic appears in the fleet table with their own
  `agent/mimic`; a standalone Parser.bat agent (no Mimic) shows `<agent>/—`.

## #117 — Pet buffs on the Pet tracker + advisory buff-range hints

**Needs:** agent **3.3.94** (beta Mimic) + the `buffqueue.html` overlay in Mimic
**1.9.6** beta + bot **3.0.216** (live on Railway).

**What changed:** two things. (1) **Pet buffs now show on the Pet tracker.** A
single-target buff you cast on your *summoned* pet (Girdle of Karana, Aegolism,
Strength, etc.) used to vanish from the Pet tracker unless the pet happened to be
your live target the instant you cast — because those buffs aren't in the tracked-
buff list, the only way to attribute them is "we cast it and it named our pet,"
and the old code threw the landing away when your target had moved on. Now, when a
buff lands on a name we can prove is *your* pet, it's attributed no matter what you
had targeted. (2) **The buff queue now hints who's out of range.** Every raider's
position now rides the live feed, and a same-zone raider more than ~200 units from
you gets dimmed with a 📍 chip on the buff-queue overlay — a hint, never a removal.
Position updates at the live-state heartbeat, so treat range as advisory.

**✅ Solo (one machine)**
- Summon a pet (mage/necro/beastlord/druid warder). **Buff it with a single-
  target buff while targeting something else** (yourself, the mob, nothing) — cast
  e.g. Girdle of Karana / Strength / Aegolism on the pet. The **Pet tracker must
  now show that buff** with a countdown, not just the pet's HP.
- Repeat with the pet *targeted* when you cast — it must still show (regression
  check; that path always worked).
- Sanity: cast a single-target buff on **yourself or a groupmate** (not the pet) —
  it must NOT appear as a phantom pet buff on the Pet tracker.
- If you type **/pet report** in game, any buff the report lists should also appear
  (that path is the belt-and-suspenders source).

**👥 Multi-person (2+ machines) — needs a raid partner**
- Open the **Buff queue** overlay and pick your class. Have a same-zone raider who's
  missing one of your buffs **run well away from you (>~200 units)**: their row
  should **dim and grow a 📍 "likely out of range" chip** — but still be listed.
  When they run back into range, the chip clears within a heartbeat or two.
- **Fail-open check:** a raider whose position we don't have yet (just logged in,
  no fresh live-state) must show **normally** (never flagged out of range). A raider
  in a **different zone** is handled by the existing "same zone first" sort, not the
  range chip.

---

## #111 — /who overlay enrichment: 🐺 Mimic presence, aligned columns, anon levels, mains

**Needs:** bot **3.0.215** (live on Railway) + agent **3.3.93** (beta Mimic) +
the `who.html` overlay in Mimic **1.9.6** beta.

**What changed:** the in-game /who overlay's rows now carry four things. (1) A
🐺 next to any guildmate whose Mimic is running right now (their agent is a fresh
primary in the reporter registry). (2) Class and level are each in their own
left-aligned column that lines up down the list, instead of floating ragged after
the guild tag. (3) A guildmate who's /anon shows the level we know from our own
who history, rendered dimmed/italic so you can tell it didn't come from the game.
(4) Wolf Pack alts show their main in parentheses after the character name, from
`characters.main_name` — with a server-enforced privacy exception (`hide_main_names`
tuning key; seeded with **Tildias** and **Serreth**, who never show a main). The
bot supplies all four via the existing `who-lookup` endpoint; if the bot is
unreachable the overlay renders exactly as it did before.

**✅ Solo (one machine)**
- Run **/who** in a busy zone. The overlay's rows must line up in columns —
  every class in one column, every level left-aligned in the next — not drifting
  after the `<Guild>` tag.
- Your OWN row must show a **🐺** (your Mimic is running). If you're grouped with
  another Mimic user, theirs gets one too.
- Log an **/anon** alt whose level we've seen before and /who yourself: the level
  must appear **dimmed/italic** (our data), even though EQ printed no level.
- A Wolf Pack alt (with a `main_name`) shows **(Main)** after its name; a pure-PUG
  stranger shows neither a 🐺 nor a main.
- **Fail-open check:** quit Mimic's connection to the bot (or go offline) and /who
  again — rows still render (de-anon from local cache), just without the new 🐺 /
  main enrichment. Nothing should blank out.

**👥 Multi-person / officer**
- Two raiders on separate machines both running Mimic: each sees the OTHER's 🐺
  on their /who within ~a minute of both being live.
- **Hide list (officer):** add a name to `hide_main_names` in the `overlay_tuning`
  row (MCP/SQL update — comma-separated, e.g. `Tildias,Serreth,Newname`). Within
  ~60s (bot tuning cache) + the agent's who-lookup refresh, that character's **(Main)
  disappears** from everyone's /who while its 🐺 (if running Mimic) stays. Removing
  the name brings the main back.
- **Known limit:** the 🐺 tracks each agent's REPORTED PRIMARY character, so a raider
  running Mimic while playing an alt only lights up on the alt's row if that alt is
  their `--character`/first-watched log. Playing an unwatched alt → the 🐺 rides
  their primary's row instead. This is a registry-identity limit, not a bug.

---

## #116 — Overlay bug round: stale Spell Casting card + stuck setup chrome

**Needs:** agent **3.3.92** (beta Mimic). No bot change.

**✅ Solo**
- **Stale casting card**: cast anything, then camp that character (or kill EQ).
  The Spell Casting card's entry must clear within ~a minute — no frozen
  "stopped N ago" card, no doubled border. Previously it lingered until restart.
- **Setup chrome teardown**: right-click the trigger alert box → Setup THIS →
  move it → Done. The blue outline + placeholder chrome must disappear
  immediately. Repeat exiting via 🔒 (lock) and via ✕ — chrome must tear down on
  all three paths, and the same applies to any overlay's Setup THIS.
- **#35 regression sweep** (was already functional, confirm): CH overlay drags
  by its ✥; the opacity slider changes the overlay backdrop live.

---

## #112 — Chat-election liveness + zone-spread (the 2026-07-19 chat-blackout fix)

**Needs:** bot **3.0.214** (live on Railway) + agent **3.3.91** (beta Mimic).

**The incident this fixes (real, 2026-07-19):** guild chat → Discord went dark
~6:43am–3:16pm. The single elected chat reporter's AGENT kept heartbeating while
its CHARACTER was logged out — so it stayed elected and saw no chat, and the 60s
TTL never noticed (the agent was alive). The PvP death feed (every agent uploads
it, no election) posted all day — the fleet was fine; only the one elected stream
died. **Mitigation currently in place:** `dedup_chat = 0` in the `overlay_tuning`
editor (everyone uploads chat, so nothing can go dark). This work makes
re-enabling `dedup_chat` safe.

**What changed:** (1) the agent heartbeat now sends `last_line_ms` — how long
since it last processed a live log line from its PRIMARY character's tail (a
logged-out char tails nothing → it climbs). (2) Chat candidacy now requires that
to be **fresh** (< `reporter_liveness_max_ms`, default 90000); a stale reporter is
demoted like a camper. (3) Chat now elects one reporter **per zone** (redundancy;
the bot's 10s chat dedup collapses the duplicate posts) so one reporter logging
out never darkens chat. Fail-open throughout: older agents (no `last_line_ms`) are
treated fresh; if nobody anywhere is fresh, everyone stays eligible.

### Re-enable procedure (officer, do this once the fleet is on agent ≥3.3.91)
1. Confirm the raid's Mimics are updated (agent dashboard footer shows **3.3.91+**;
   the 📡 Reporters panel — see #115 — lists them with a **fresh** column).
2. On `/admin/overlays`, **delete the `dedup_chat` key** (or set it to `1`). Chat
   election resumes; only LIVE reporters are eligible, spread across zones.
3. If anything looks off, set `dedup_chat = 0` again — instant fail-open, everyone
   uploads (the current safe state).

### ✅ Solo (one machine) — *needs `dedup_chat` re-enabled to observe*
1. Log in, sit in a zone; on the agent dashboard the reporter line shows your
   chat role active and your log **fresh**.
2. **Log the character out** (leave Mimic running). Within ~20s the dashboard
   reporter line flips to **stale**, and within ~90s + one poll your chat role
   drops (you're demoted — no live log flow). Log back in → fresh again, role
   returns.

### 👥 Multi-person (2+ machines) — **needs a raid partner in another zone**
1. Two testers in **different zones**, `dedup_chat` on. Both should show as chat
   reporters (one per zone) — the bot's dedup means Discord still sees each `/gu`
   once.
2. One tester logs their character out. Their role drops within ~90s; the other
   zone's reporter keeps chat flowing the whole time — **no gap in #guild-chat**.

## #115 — Officer reporter control panel (📡 Reporters: swap / include)

**Needs:** bot **3.0.214** (live on Railway) + agent **3.3.91** (beta Mimic).
Officer OpenDKP/Discord identity linked in Mimic (same sign-in as the DKP tick
widget).

**What it is:** a 📡 Reporters card on the agent dashboard's **🛡 Admin** tab
(officer-only, same data gate as the DKP/loot widgets). It shows the live reporter
fleet (character · zone · group · agent version · camping · last-line age · fresh),
the elected reporter set per service (chat/buffs/roster), and any active pins. Per
service you can **swap** (pin a specific live character as the reporter) and **add
an include** (extra always-on reporter), or **clear** the override. Overrides are
tuning keys (`reporter_pin_<svc>` / `reporter_extra_<svc>`) so they survive
deploys and take effect within ~60s. A pinned name that is dead/stale is ignored
(fail-open — election proceeds normally); per-observer streams (mob/encounter)
can never be pinned.

### ✅ Officer (one person)
1. Open Mimic → **🛡 Admin** tab → **📡 Reporters**. You should see yourself (and
   any other live agents) with zone / fresh / elected badges. A NON-officer opening
   the same tab sees no Reporters panel at all.
2. **Swap:** pick another live character in the chat **swap** dropdown. Within ~60s
   the elected-chat badge moves to them (the pin is honored because they're
   live+fresh). Clear the override → it reverts to the computed pick.
3. **Include:** type a live character into the chat **add-include** box. They join
   the elected chat set on top of the computed pick (both report; dedup collapses).
4. **Dead pin is safe:** pin a character who is offline. The panel keeps the
   computed pick and the bot logs `pin … ignored — not live+fresh`; nothing breaks.

### 👥 Multi-person
1. With 2+ live agents, swap the chat reporter to a specific teammate and confirm
   in `#guild-chat` that relay is unbroken through the swap (dedup + fail-open).

---

## #94 / #92 — guild-rules ingest + family-aware attendance metrics

**Needs:** bot **3.0.213** (live on Railway) + web **1.0.244** (Vercel). No
Mimic/agent change. **Post-merge setup required:** (1) run `node deploy-commands.js`
(or the usual command-deploy) so `/ingestrules` registers with Discord; (2) set
`RULES_CHANNEL_ID`, `RAID_RULES_CHANNEL_ID`, `LOOT_RULES_CHANNEL_ID` in the bot's
Railway env (any left unset are skipped and reported).

**What it does (#94):** `/ingestrules` (officers only) reads the three rules
channels and stores each message as a row in the new `guild_rules` table.
Numbered rules ("12. Raid Kit …") get a rule number + title; anything else is
kept verbatim as a raw row so nothing is dropped. Re-running updates edited
messages in place and marks deleted ones inactive. The result is browsable at
`wolfpack.quest/admin/rules`. **(#92):** `/admin/attendance` now also shows a
family-aware **60d / 90d / lifetime RA% + tick counts** table (main+alts rolled
up), read from the `member_attendance_metrics` SQL view.

### ✅ Officer (one person)
1. **Ingest + view.** Run `/ingestrules`. The ephemeral reply should summarize
   each configured channel: `N rows · X numbered · Y raw · (Z deactivated) ·
   scanned M`. Open `wolfpack.quest/admin/rules` → the rules appear grouped by
   channel, numbered rules with a `#N` + title, non-numbered ones tagged **raw**,
   full body shown verbatim.
2. **Re-run is idempotent + tracks edits/deletes.** Edit a rule message in
   Discord (fix a typo), then delete a throwaway test message you posted. Run
   `/ingestrules` again: the edited rule's body updates on `/admin/rules` (no
   duplicate row), and the deleted message flips to **deactivated** (dimmed).
   Counts on the reply reflect the deactivation.
3. **Attendance metrics.** Open `wolfpack.quest/admin/attendance` → the new
   "Family RA%" table lists mains with 60d/90d/lifetime RA% (hover a cell for the
   `attended/held` tick counts). A known main and its alts appear as **one** row.

---

## #95 / #93 — Raid Kit readiness (rule 12) + comp templates & sign-up gap matcher

**Needs:** web **1.0.245** (Vercel). No bot/Mimic/agent change. Migration
`20260719140000_comp_templates` auto-applies on merge (already applied to prod
via MCP). Data prerequisites: Raid Kit reads the Quarmy **gear** snapshot the
agent already uploads (so a character needs a `…Quarmy.txt` export on file); the
comp matcher's *planned* side reads RaidHelper `rh_signups` (run `/scanraidhelper`
or the RH API sync first — the table is otherwise empty and the matcher renders
with nothing to match).

**What it does (#95):** a 🎒 **Raid Kit** card on `/character/[name]/gear` and an
officer roster board at `/admin/readiness` check raid **rule 12** — a 100
magic-resist floor from worn gear plus a utility checklist (Enduring Breath,
Levitate, self-invis, self-port, and the Necro coffin). MR is the only hard check
and only when a gear snapshot exists; utilities are *covered / not-detected*,
never a red fail. **(#93):** officers author named target compositions at
`/admin/comp` (validated JSON + live preview), and `/admin/signups` gains a
🧩 **Comp vs template** panel that diffs a template against an event's "Going"
signups — role/archetype gap deltas — plus a live-roster "actual" column when a
raid ran during the event window.

### ✅ Member (one person)
1. **Your Raid Kit card.** Open `wolfpack.quest/character/<yourname>/gear`. If you
   have a gear snapshot, the 🎒 card shows your worn **MR** (green ≥100 / red
   below) and the four utilities as ✓ covered (with the source item/spell) or
   ○ not-detected. A blank utility must read as "not detected", never a red fail.
2. **No-snapshot honesty.** Open a character with no Quarmy export → the card says
   "no gear snapshot", **not** a failing MR. Confirm a class self-buff shows
   (e.g. a Druid reads self-covered for all four) even with sparse gear.

### ✅ Officer (one person)
3. **Readiness board.** Open `wolfpack.quest/admin/readiness`. One row per roster
   raider; anyone actually below the 100 MR floor sorts to the top; raiders with
   no export read "no gear snapshot"; opted-out characters show "opted out". The
   header links `/admin/rules`.
4. **Author a template.** At `wolfpack.quest/admin/comp`, edit the starter JSON
   (or write your own), watch the live preview update the per-archetype demand,
   and Save. Break the JSON (delete a brace, use archetype `"dps"`) → Save is
   disabled and the errors list what's wrong.
5. **Match a raid.** On `wolfpack.quest/admin/signups`, open an event with signups,
   pick your template in the 🧩 panel → confirm the gap chips ("Need N more
   healer", "M over on melee DPS") and the archetype table (Need / Signed / Δ).
   If a raid ran during the event window, a **Live** column appears from the
   raid_roster snapshot; otherwise the panel notes there's no snapshot in window.

---

## #110 — OpenDKP audit-trail reconciliation (deletions propagate to the mirror)

**Needs:** bot **3.0.212** (live on Railway). No Mimic/agent change.

**What it does:** when an officer **deletes or edits loot in OpenDKP**, that
change now propagates to our Supabase mirror (`opendkp_loot`) instead of
lingering as a ghost on wolfpack.quest's parses/loot surfaces. Each OpenDKP →
Supabase sync (every 30 min, or on-demand via `/syncopendkp`) re-pulls only
**recent raids'** loot and removes any mirrored award that no longer exists
upstream. Driven by the OpenDKP audit trail as a trigger; the sync log prints
one line per removed ghost.

### ✅ Officer (one person, needs OpenDKP officer access)
1. **A deleted award disappears within one sync cycle.** In OpenDKP, open a
   recent raid (within the last 14 days), award a throwaway test item to a
   character (e.g. "Backpack" → your alt for 1 DKP), and let the next sync mirror
   it (or run `/syncopendkp` — you'll see loot rows written). Confirm the item
   shows on `wolfpack.quest` (the raid's loot / a character's wins). Now **delete
   that award in OpenDKP**, then run `/syncopendkp`. The reply's **Reconcile
   (#110)** line should read `1 ghost loot removed`, and the item should be **gone
   from wolfpack.quest** — no manual mirror edit needed. Re-running `/syncopendkp`
   a second time reports `0 ghost loot removed` (idempotent). *(Railway logs show
   the `[opendkp-reconcile] removed ghost loot: …` line for the audit trail.)*

---

## #109 — Mimic dashboard restructure (Me card + officer Admin menu)

**Needs:** agent **3.3.90** (beta Mimic) · NO bot change.

**What it does:** two changes to the Mimic dashboard. (1) The Dashboard tab now
opens on a **🐺 Me** card instead of the logsync/status wall — your current
character + zone, a compact line of your buffs, the characters Mimic is watching,
your last few tells (local — they never leave your PC), and your last few fights
(with a jump to the parse), plus a big **Open /me ↗** button to wolfpack.quest/me.
The engine/sync details (files being read, upload queue, session counts, reporter)
didn't go away — they're tucked into a collapsed **⚙ Engine** section right below
the Me card. (2) Officers get a new **🛡 Admin** tab that gathers the officer
tools — DKP ticks, loot capture, "Post for bidding" — into one place with quick
links to the wolfpack.quest admin pages. Non-officers don't see the tab at all.

**Where to look:** the top of the **Dashboard** tab (🐺 Me card + ⚙ Engine), and
— officers only — the **🛡 Admin** tab in the nav row.

### ✅ Solo (one machine)
1. **Me card shows your character.** With a character logged in (Zeal running),
   the 🐺 Me card names your character, your zone, and a compact buffs line. Your
   watched characters, recent tells, and last fights all populate. **Open /me ↗**
   opens your wolfpack.quest/me page.
2. **Engine section persists open/closed across polls.** The ⚙ Engine section is
   collapsed by default. Expand it — it should show the setup checklist, files
   tailed, upload queue, and session counts — then leave it open and watch a few
   2-second refreshes go by: it must **stay open** (the wpKeep rule; a plain
   `<details>` would snap shut every poll). Collapse it again and confirm it stays
   collapsed across refreshes too.
3. **Non-officer sees no Admin tab.** On a non-officer account (or not signed in),
   there is **no 🛡 Admin tab** in the nav row at all — not just hidden, absent.

### 👥 Multi-person / officer
1. **Officer sees the Admin tab collecting the officer tools.** On an officer
   account, a **🛡 Admin** tab appears. Open it: it collects the **🎫 DKP ticks**
   and **💰 Loot capture** cards (these moved here from the Info tab) plus quick
   links to /admin/overlays, /admin/triggers, /admin/encounters. Run a DKP tick /
   review a captured loot list from here exactly as before — same controls, new
   home. Confirm a **non-officer** partner still has no Admin tab.

**Status:** ⏳ awaiting verification (solo is quick; officer case needs an officer
account signed into Mimic).

---

## #108 — Loot bidding dashboard element (Mimic)

**Needs:** agent **3.3.89** (beta Mimic) · bot **3.0.211** (live on Railway).

**What it does:** the agent dashboard now has a **💰 Loot bidding** card (with a
**BETA** tag) where you can place your sealed OpenDKP bids without leaving the
game. It's gated: you have to log into your OpenDKP account in Mimic first —
until you do, every bid box is locked and you'll see "Log into OpenDKP to enable
bidding." Your login stays on your PC and is never uploaded. Once you're in, open
auctions show up (both what an officer just called in chat AND the real OpenDKP
auctions), each with the item's last winner + runner-up, a bid box, and a **+1**
button that pre-fills the previous runner-up + 1 (you still click Bid — it never
bids for you). You set your main + alts once in the little ✎ characters editor,
then pick who you're bidding as per bid. When you're logged in it also shows your
own recent wins and your wishlist, tagging each item as a real prereg or one it
learned from your past bids.

**Where to look:** the **💰 Loot bidding** card near the top of the agent
dashboard. If you're not connected to the bot (no token in Mimic Settings) the
login won't work — set your token first.

### ✅ Solo (one machine)
1. **The gate blocks until you log in.** Fresh install / logged out: the card
   shows "🔒 Log into OpenDKP to enable bidding" and any auction row shows
   `🔒 locked` instead of a bid box. Click **Log in to OpenDKP**, enter a WRONG
   password → you should see "incorrect username or password" and stay locked.
   Enter your REAL OpenDKP username + password → the banner flips to a green
   `● OpenDKP <you>` line and bid boxes appear.
2. **Family editor persists across restart.** Click **✎ characters**, set your
   main and add an alt or two, **save**. Close Mimic completely and reopen it →
   your main + alts are still there and the "bidding as" picker lists them.
3. **+1 prefill shows runner-up + 1.** With an item that has bid history, click
   its **+1** button → the bid box fills with the previous runner-up + 1 (or, if
   the runner-up wasn't recorded, the last winning bid + 1 — hover the button to
   see which). It should NOT submit — you have to click **Bid**.
4. **A called drop lights the panel up.** In `/rs` post a drop list (as in the
   #107 test). Within a few seconds the item appears in the Loot bidding card
   marked `(called)` with a countdown, even before an OpenDKP auction exists.
5. **Log out re-locks.** Click **log out** → the gate returns and bid boxes lock
   again.

### 👥 Multi-person (2+ machines on beta) — **needs a raid partner**
1. **Two users see the same live auction.** With an OpenDKP auction open, both
   logged-in raiders see the same item(s), the same last-winner/runner-up, and
   can each place a bid from their own Mimic.
2. **Sealed bids stay sealed.** Neither raider can see the other's bid amount in
   the panel — only their own bids appear under "your open bids" (the values ride
   the encrypted place-bid path; nobody sees a competitor's number).

**Status:** ⏳ awaiting verification (solo is quick; multi-person needs a real
open auction + 2 testers).

---

## #107 — Loot-post TTS + auction countdown chips + trigger overlay auto-grow

**Needs:** agent **3.3.88** (beta Mimic) · NO bot change (web **1.0.241** is
roadmap copy only).

**What it does:** when an officer posts a drop list in guild or raid chat, every
raider's Mimic now speaks it locally — "Loot posted, 3 items, bids open 2
minutes" (item count, not the list) — and drops a gold countdown chip on the
trigger overlay that ticks down the auction like a Death Touch timer (with a 15s
warning). The window length comes from the bid call ("2 min", "90s") or a
default you set. Re-posting the same items resets the clock instead of stacking a
duplicate; each separate drop gets its own chip; any chip can be dismissed with
its ✕. Separately, the trigger overlay now grows on its own to fit its content
(timers + pinned callouts + loot chips), so the buttons along the bottom stop
getting cut off.

**Where to look:** the agent dashboard Triggers tab has a new **💰 Loot auction
announce** card (toggle `lootAuctionTts`, default ON + a default-duration knob).
The callout also needs **Trigger alerts (TTS)** on (it shares that voice). The
chip appears on the trigger-alert overlay alongside any Death Touch / debuff
timers.

### ✅ Solo (one machine)
1. **Hear the announce + see the chip.** With Trigger alerts (TTS) ON and the
   loot toggle ON, in `/rs` (to yourself is fine) post a fake drop list, e.g.
   `Cloak of Flames, Ring of the Ancients, Short Sword of the Ykesha`, then a
   separate line `bids open 90 seconds`. You should HEAR "Loot posted, 3 items,
   bids open 1 minute 30 seconds" and SEE a gold `💰 Loot bids (3)` chip counting
   down from 1:30 on the trigger overlay, warning at 15s.
2. **Default duration when none is stated.** Post just a drop list with no bid
   call (`Fungus Covered Scale Tunic, Reaper of the Dead`). The chip should use
   your configured default (120s out of the box) and the voice should say "bids
   open 2 minutes".
3. **Repeat post RESETS, doesn't stack.** Re-post the SAME item list ~30s later.
   The existing chip's clock should jump back up (reset) — you should still see
   exactly ONE chip for that set, and NOT hear a second announce.
4. **Distinct posts stack.** Post a different drop list while the first chip is
   still live → a SECOND chip appears (concurrent auctions are real).
5. **Dismiss with ✕.** Hover a loot chip (overlay can be locked/click-through)
   and click its ✕ — the chip goes away immediately and does not come back on
   the next poll.
6. **Toggle OFF = silent.** Turn the dashboard 💰 Loot auction announce toggle
   OFF, post a drop list → no voice, no chip. Turn it back ON.
7. **Overlay grows / shrinks + honors grow direction.** With several timers +/or
   loot chips live, confirm the trigger window grows tall enough that its bottom
   controls (feedback vote buttons, sticky ✕, loot-chip ✕) are never clipped, and
   shrinks back when they clear. Right-click the ✥ move icon → toggle **⬆ Grow
   upward** and repeat: grow-down should keep the top edge fixed, grow-up should
   keep the bottom edge fixed and move the top up. The ✕ hide + ✥ move buttons
   stay reachable at every size.

### 👥 Multi-person (2+ machines on beta) — **needs a raid partner**
1. **Both clients announce locally, exactly once.** One raider posts a drop list
   in `/rs`. BOTH raiders (each running beta Mimic with the toggle on) should
   hear the announce and see the chip on their own overlay — driven off their own
   local log tail, no relay. Neither should hear it twice (multibox second-log
   copies reset silently).

**Status:** ⏳ awaiting verification (solo is quick; multi-person needs 2 testers).

## #106 — Multiplexed agent poll (six GET loops → one) + encounter-burst jitter

**Needs:** bot **3.0.210** (live on main) · agent **3.3.87** (beta Mimic).

**What it does:** the agent used to run six independent GET loops against the bot
(recent-fires 1.5s, overlay-tuning 90s, guild-triggers 2min, backfill 5min,
ui-edits 5min, character-prefs 10min). It now runs ONE loop hitting a single
`GET /api/agent/poll` bundle — recent-fires + tuning every tick, the slow streams
folded in only when due — so a 60-raider room drops from ~six per-client request
streams to one. On fight end a real encounter's upload is delayed by a
deterministic `hash(uploader) % 15s` to flatten the ~90MB-at-60 simultaneous
offer (solo/duo small parses skip the delay so the dashboard card stays instant).
It's **fully fail-safe**: an older bot 404s the new route and the agent falls back
permanently to the individual loops, and dormancy/kill-switch semantics are
preserved (while paused the loop asks for the tuning/kill stream ONLY).

**Where to look:** the agent dashboard at `http://localhost:7777` — Triggers tab
(journal + fires) must keep working exactly as before; `/api/state` now carries a
`poll: { mode, streams, lastOkAt }` block (mode `multiplexed` normally,
`fallback` against an old bot).

### ✅ Solo (one machine)
1. **Dashboard still shows triggers + fires (new bot + new agent).** With bot
   3.0.210 and agent 3.3.87, open the dashboard and confirm the Triggers tab
   journal populates, guild triggers load, and a self-fired trigger still shows —
   i.e. the streams that used to be six loops all still arrive over the one poll.
   `/api/state` `poll.mode` reads `multiplexed`.
2. **Tuning/notices/raid-hold still land.** Change an officer knob or post a Mimic
   Mail notice on `/admin` → it reaches the agent within ~1.5–90s as before (now
   via the poll's `tuning` stream).
3. **Solo/duo parse feels instant.** Parse a short solo fight → the dashboard's
   recent-parse card appears immediately (small payload + empty queue → jitter
   bypassed). A big raid fight may take up to ~15s to card (the jitter) — expected.
4. **Kill switch still works over the poll.** Flip ☠ AGENT KILL (`/admin/overlays`)
   → the agent goes dormant within ~20s and, while dormant, the poll asks for the
   tuning/kill stream only; clearing it resumes within a heartbeat (as in #74).
5. **Forced-404 fallback** — *code-review-only note* (no safe way to force in
   normal play): pointing the agent at a bot without `/api/agent/poll` makes the
   first poll 404 (or return the catch-all `OK`), the agent logs the permanent
   fallback once, and the individual loops resume for the rest of the process.

### 👥 Multi-person (2+ machines on beta) — **needs a raid partner**
1. **Cross-client fires still arrive <2s during a fight.** One raider fires a
   guild trigger; the other hears/sees the relayed callout within ~1–2s — the
   multiplexed poll preserves recent-fires latency (still a 1.5s cadence).

**Status:** ⏳ awaiting verification (solo is quick; multi-person needs 2 testers).

---

## #74 — Guild control plane: agent kill switch + version floor + beta hot-swap

**Needs:** bot **3.0.209** (live on main) · agent **3.3.86** (beta Mimic 1.9.6) ·
Mimic beta build (LKG rollback + beta-channel hot-swap).

**What it does:** officers get a fleet-wide **kill switch** and a **version
floor** on `/admin/overlays` → 🛑 Kill switches, served over the agent's 20s
reporter-poll (and the 2-min guild-trigger backup). Beta Mimic installs now
**hot-swap along the beta agent line** via the per-channel manifest, guarded by
crash-loop **auto-rollback to last-known-good**. **⚠ Policy semantics are
conservative v1 — Hitya to sign off before relying on kill/floor in a real raid.**

### ✅ Solo (one machine)
1. **Kill switch pauses the fleet, cleanly.** On `/admin/overlays`, check
   **☠ AGENT KILL** and Save. Within ~20s the agent dashboard shows the banner
   **"⏸ Agent paused by guild control plane"**, the upload queue **stops
   draining** (watch the queue chip: pending count holds, doesn't climb-then-
   drain), and the agent log prints `[control] flag_agent_kill → DORMANT`. Confirm
   your **overlays keep working on local data** (HUD/threat still update in a
   fight — nothing blanks). Uncheck + Save → within one heartbeat the banner
   clears, `[control] flag_agent_kill → resumed` logs, and the held queue drains.
   **Nothing should be lost.**
2. **Version floor stands down an old agent + nudges update.** Set
   **`min_agent_ver_num`** to a number just ABOVE your running agent (its numeric
   form is `major*10000+minor*100+patch`, e.g. running 3.3.86 → set `30387`).
   Save. The dashboard shows **"Your agent is below the guild minimum — update via
   [U]"**, uploads stand down exactly like the kill switch, and the log prints
   `[control] min_agent_ver_num → 30387 … BELOW floor`. Clear the field + Save →
   resumes. Set the floor at/below your version (e.g. `30386` on 3.3.86) → **no**
   stand-down (at-floor is fine).
3. **Fail-open regression:** stop the bot (or point Mimic at a bad URL) while a
   kill was NOT set — the agent keeps running normally (never goes dormant on a
   bot outage).
4. **LKG rollback (harder to force safely):** if a bad agent ever ships to beta
   and crash-loops right after a hot-swap, Mimic auto-reverts to `index.lkg.js`,
   the tray/dashboard shows **"reverted to last-known-good"**, and it won't
   re-offer that version until a newer one ships. Observe via the agent log
   (`[mimic] CRASH-LOOP after hot-swap … reverted to last-known-good vX`). No safe
   way to force in normal play — verified by unit test + code review.

### 👥 Multi-person
- **Beta hot-swap via the channel manifest.** With ≥2 beta Mimic testers on the
  beta channel: bump the agent on `beta` (this round → **3.3.86**). Each beta
  Mimic, on its next `latest-version?channel=beta` poll, hot-swaps the agent in
  place (window stays up, no installer) to the new beta agent — confirm the agent
  dashboard footer version ticks up without anyone reinstalling. Previously beta
  builds only got a new agent bundled inside a full beta installer.
- **Kill switch across the raid:** one officer flips ☠ AGENT KILL; every tester's
  dashboard should show the pause banner + stop uploading within ~20s, and all
  resume within a heartbeat when cleared.

**Status:** ⏳ awaiting verification (solo kill/floor is quick; the multi-person
beta hot-swap needs a beta bump + 2 testers).

---

## #73 — Admission-control 429/Retry-After honored by the durable queue

**Needs:** agent **3.3.85** (beta Mimic 1.9.6) · bot **3.0.208** (live on main).

**What it does:** the bot can now rate-limit a runaway/crash-looping uploader
per-endpoint (per-uploader budgets, off by default for durable data). When it
does return a **429 + `Retry-After`**, the agent's durable upload queue treats
it as backpressure: it backs off for exactly the time asked (capped at the
existing 10-min ceiling) and **re-sends — nothing is dropped**. (429 was already
retryable pre-3.3.85; this makes the wait precise and stops a rate-limited durable
upload from being shunted to the 30-min poison-park lane.)

### ✅ Solo (one machine)
1. **Force a tiny budget on a durable kind and watch the queue back off, then
   drain — nothing lost.** On `/admin/overlays`, set `budget_rolls_per_min = 1`
   **and** `budget_enforce_rolls = 1` (rolls is a low-volume durable kind, safe
   to squeeze). Trigger 2–3 `/random` roll uploads within a minute. Expected: the
   first lands; the next get a **429** and sit in the agent's queue (dashboard
   shows "⏳ N queued"); within a minute they **drain on their own** with no
   permanent-drop. Confirm the roll rows all eventually appear — **zero data
   loss**. Then clear both keys (or set to 0) to restore.
2. **Kill switch works.** With the budget keys still set, add
   `flag_disable_budgets = 1` → uploads stop 429ing immediately (within the 60s
   tuning cache). Remove it to re-enable.

> Do NOT set `budget_enforce_<kind>=1` on a busy raid night until the fleet is on
> agent ≥3.3.85 — older agents still retry a 429 (no data loss) but on the blunt
> exponential ladder rather than the honored Retry-After.

---

## #105 — Richer per-fight timeline: slow on/off · mob self-heal · disc usage

**Needs:** agent **3.3.84** (beta Mimic 1.9.6) · web **1.0.239** (live on main,
for the colored ticks + legend). No bot change — `encounter_events` ingest is
generic over kind/subtype.

**What it does:** three new event types join the existing `/parses/[id]` fight
timeline (#98), each a distinctly-colored tick with a legend:
- **Slow on / off** (gold / amber) — a known slow (shaman Turgur's/Togor's/…,
  enchanter Forlorn/Tepid Deeds/…) landing on the fight target marks a **slow
  on**; when its estimated duration runs out mid-fight it marks a **slow fell
  off** warning. Slows still up at the kill emit nothing.
- **Mob healed** (green) — the boss's HP bar rising for the same target (a heal
  add or a self-heal) marks a **Mob healed (+N%)** tick. Guardrailed against
  target-swap false positives (same name required, ≥5% rise, ≥10s debounce).
- **Disc** (purple) — a defensive/evasive/precision/aggressive discipline emote
  marks who dropped a disc and when (third-person **and** self attributed).

**Where to look:** `wolfpack.quest/parses/<id>` → the **🕒 Fight timeline** card.

### ✅ Solo (one machine)
1. **Self-disc shows.** Drop a discipline (e.g. Defensive) during any fight you
   parse → your next parse's timeline shows a purple **Disc** tick attributed to
   you at that moment.
2. **Slow on/off (if you can slow).** On a shaman/enchanter (main or alt), slow
   the mob → a gold **Slow on** tick appears; if the mob outlives the slow, an
   amber **Slow off** tick appears at the estimated expiry. A slow that's still
   up at the kill leaves no off-tick.

### 👥 Multi-person (2+ machines on beta) — **needs a raid partner**
1. **Mob heal on a real boss.** On a boss that self-heals or has a healer add,
   watch for a green **Mob healed (+N%)** tick on the parse timeline at the heal
   moment.
2. **Cross-uploader dedup holds.** With several raiders uploading the same
   fight, each new event type collapses to ONE tick per moment (the read-side
   3s dedup keys on kind+subtype+actor) — no doubled slow/disc/heal ticks.

---

## #76 remainder + #103 — Callout trust infrastructure + CH chain "0X GO"

**Needs:** agent **3.3.83** (beta Mimic 1.9.6) · web **1.0.238** (live on main,
for the officer sticky checkbox). No bot change — the relay already carried the
original fire timestamp end-to-end.

**What it does (five parts):**
1. **Trigger checkpoint journal** — a "why didn't my trigger fire?" panel on the
   dashboard Triggers tab (🧭 *Trigger checkpoint journal*). Each candidate
   evaluation records how far it got — *line seen → pattern matched → gates
   passed → actions built → dispatched → relayed* — and, when it stopped short,
   why (cooldown remaining, suppressed by your charm pet, roster-suppressed,
   stale-skipped). In-memory only, never uploaded.
2. **Real REHEARSE** — the per-row **▶ Rehearse** button (was "Test") no longer
   fakes it: it synthesizes a matching log line and drives it through the ACTUAL
   pipeline (pattern exec, cooldown, charm-pet suppression), then speaks the real
   TTS. Cooldown/suppression are *evaluated and reported* but never enforced or
   consumed; nothing relays/uploads and the fight timeline is untouched. A
   gauge-condition trigger rehearses the action tail and is journalled
   "pattern not exercised (gauge condition)".
3. **Sticky critical callouts** — an officer can tick **📌 Sticky** on a guild
   trigger (`/admin/triggers`); the alert then pins on the trigger overlay until
   the raider clicks it away (or ~5 min), instead of the 3.5s fade. Backward-
   compatible — older agents ignore the field.
4. **Ghost-callout TTL** — a relayed fire that arrives >15s after it originally
   fired (queue backlog replayed late) is dropped and journalled "stale-skipped"
   instead of being spoken minutes out of date. Fail-open on a missing timestamp.
5. **CH chain "0X GO" (#103)** — when the chain reaches a slot owned by the
   character you're playing, the agent speaks "0N GO" (e.g. "04 GO") through the
   trigger pipeline (so the master **Trigger alerts (TTS)** switch still gates
   it). A dedicated **📣** button on the CH chain overlay toggles just this
   callout (default ON, persists per machine). Once per rotation pass.

**Where to look:** dashboard `http://localhost:7777` → **Triggers** tab (the 🧭
journal card + the ▶ Rehearse buttons). The CH chain overlay's 📣 button sits
left of ⚙/🔊/✕. Officer sticky checkbox: `wolfpack.quest/admin/triggers`.

### ✅ Solo (one machine)
1. **Journal shows checkpoints.** Add a personal trigger with a real pattern +
   a cooldown, then paste/emit two matching lines quickly. The journal shows the
   first as **5/6 dispatched** and the second as **3/6 gates passed —
   cooldown … remaining**. A charm-suppressed `{s}` call shows **2/6 pattern
   matched — suppressed (capture is your charm pet)**.
2. **REHEARSE really rehearses.** With **Trigger alerts (TTS)** ON, click
   **▶ Rehearse** on a saved trigger → you HEAR the real callout, a 🧪-badged
   flash appears, and the journal adds a **REHEARSAL** row ("pattern matched
   synthesized line; cooldown/suppression not consumed"). Confirm NO Discord
   post and no new parse-timeline fire. Break the trigger's pattern (make it
   match nothing) and Rehearse again → journal says "pattern not exercised
   (could not synthesize a matching line)" — the tell that a live line would
   never fire it.
3. **Stale fire is skipped.** Take the agent offline briefly while a guild
   trigger fires on another machine (or let a backlog build), then reconnect. A
   relayed fire older than 15s at arrival is NOT spoken — it appears in the
   journal as **stale-skipped — fire was Ns old**.
4. **CH GO speaks on your slot.** Get into a CH chain slot for the character you
   play (roster call names you, or you shout your number). With 📣 ON and
   Trigger TTS on, when the chain reaches your slot you hear "0N GO" once per
   pass. Click 📣 off → silent; the button state survives a Mimic restart, and
   re-syncs the agent after an agent restart.

### 👥 Multi-person (2+ machines on beta) — **needs a raid partner**
1. **Sticky stays pinned during a fight.** Officer ticks 📌 Sticky on a critical
   guild trigger (e.g. Death Touch). When it fires mid-fight, the callout stays
   on screen on every raider's overlay until each clicks it away — it does NOT
   fade after a few seconds like a normal alert.
2. **Relay fresh, not late.** With two raiders, a guild trigger one raider's log
   sees relays to the other and speaks within ~1–2s (fresh). Now induce a
   backlog on the receiver (brief offline), and confirm the delayed relay is
   dropped (journal: stale-skipped) rather than spoken well after the event.

---

## #72 — Designated-reporter election (chat pilot)

**Needs:** bot **3.0.196** (live on main) · agent **3.3.74** (beta Mimic) · a
guild admin to toggle the kill switch in `/admin/overlays`.

**What it does:** at scale, every raider's agent used to independently upload the
same guild/raid chat (`/gu`·`/rs`). Now the bot elects **one** agent as the chat
reporter; the rest stand down. Chat still reaches Discord exactly once. It's
**fail-open** — if the election is unreachable, everyone uploads (nothing goes
dark). This is the pilot for the bigger buff/roster de-duplication to come.

**Where to look:** the agent dashboard at `http://localhost:7777` → the agent
`/status` now carries `reporter: { roles: {chat,buffs,roster}, electionOn }`.
Also `agent.log` prints `[reporter] chat role → REPORTER (uploading /gu·/rs)` or
`→ stand down` whenever your role flips.

### ✅ Solo (one machine)
1. **Elected by default.** Running only your machine, open `/status` (or watch
   `agent.log`): within ~20s you should be the chat reporter — `electionOn: true`,
   `roles.chat: true` (you're the only/lowest name, so you win).
2. **Chat still relays.** Type in `/gu` or `/rs` in game → the message still
   posts to the Discord relay as before. (You're the reporter, so nothing
   changed for you.)
3. **Kill switch works.** On `/admin/overlays`, tick **"Disable reporter
   election (#72)"** under 🛑 Kill switches and Save. Within ~60–80s your
   `/status` shows `electionOn: false` and `roles` all `true` (election disabled
   → everyone uploads). Chat still relays. Untick + Save → `electionOn: true`
   returns.
4. **Fail-open on bot loss.** (Optional) Point the agent at a bad bot URL or kill
   connectivity briefly → roles reset to all-`true`, chat keeps uploading. No
   silent failure.

### 👥 Multi-person (2+ machines on beta) — **needs a raid partner**
1. **Only one uploads.** Two raiders both in guild chat, both on beta Mimic.
   Exactly **one** shows `roles.chat: true`; the other shows `chat: false`
   ("stand down" in its log). The reporter is the alphabetically-lower primary
   character name.
2. **Chat posts once, not twice.** Send one `/gu` line. Confirm it appears in the
   Discord relay **exactly once** (previously each machine would have submitted
   it). No duplicate.
3. **Failover.** The chat reporter closes Mimic (or camps). Within ~60s the other
   raider's `/status` flips to `roles.chat: true` and takes over. Confirm `/gu`
   still relays after the handoff — **no chat lost** during the switch.

### Now built (P1c, 2026-07-18)
- Raid-roster de-duplication (group-aware) — see the **#72 P1c** section below.
  This completes the #72 election work (chat + buffs + roster all elect).

**Status:** ⏳ awaiting solo + multi-person verification.

---

## #72 P1b — Buff-landing election (coverage-per-zone)

**Needs:** bot **3.0.206** (live on main) · agent **3.3.81** (beta Mimic) · a
guild admin to tick **`dedup_buffs`** in `/admin/overlays` 🛑 Kill switches.

**What it does:** buff landings are the same for every same-zone client, so at
scale N raiders upload N copies of each land. Now the bot ranks agents by
**coverage** (how many distinct landings each actually saw over a rolling 10-min
window) and elects the **top 3 per zone**; the rest stand down. Charm timers
(`is_charm_spell` — synthesized per observer, no log line for other clients) are
**exempt and always upload**. Everything is **fail-open** (bot down / flag off /
zone unknown / no coverage yet → everyone uploads) and gated behind the
`dedup_buffs` flag, default OFF, so production is unchanged until it's flipped.

**Where to look:** `/status` `roles.buffs` (true = you upload ordinary landings;
false = you stand down) and the new `buffs_zone: { zone, reporters, mine,
coverage }` block. `agent.log` prints `[reporter] buffs role → REPORTER … / →
stand down` when it flips.

### ✅ Solo (one machine)
1. **Flag off = no change.** With `dedup_buffs` unchecked, `roles.buffs` stays
   `true` and buff landings upload exactly as before. Nothing to see — that's the
   point (production default).
2. **Flag on, sole candidate.** Tick `dedup_buffs` + Save. Running only your
   machine, within ~60s `/status` still shows `roles.buffs: true` — you're the
   only (top) candidate in your zone, so you stay elected and keep uploading.
   `buffs_zone.mine: true`, `reporters: 1`.
3. **Charm rows upload regardless.** With the flag on, charm a mob (Allure /
   Beguile / Charm). The charm timer still reaches cross-client Mob Info — charm
   rows never gate on the buffs role, so even a stood-down agent keeps sending
   them.

### 👥 Multi-person (2+ machines on beta) — **needs raid partners**
1. **Only the elected 3 upload.** 4+ raiders in the SAME zone, flag on. After a
   few minutes of buffs flying, exactly **3** show `roles.buffs: true`
   (`buffs_zone.reporters: 3`); the rest show `false` ("stand down" in the log).
   The 3 are the highest-coverage agents — a raider off in a corner self-selects
   out. Ordinary landings still reach Mob Info / the buff queue (the 3 cover the
   zone); no landing goes dark.
2. **Failover within ~60s.** One elected buff reporter closes Mimic (or zones
   out). Within ~60s a previously-stood-down agent in that zone flips to
   `roles.buffs: true` and takes over — coverage stays complete across the swap.
3. **Zone-split raiders elect independently.** Split the raid across two zones
   (e.g. a pull group ahead). Each zone runs its own election — up to 3 reporters
   per zone, and an agent in zone A is never gated by zone B's reporters. Confirm
   both zones' landings keep flowing.

**Status:** ⏳ awaiting solo + multi-person verification.

---

## #72 P1c — Roster election (per-group) + stray-endpoint gates + camp-out handoff

**Needs:** bot **3.0.207** (live on main) · agent **3.3.82** (beta Mimic) · a
guild admin to tick **`dedup_roster`** in `/admin/overlays` 🛑 Kill switches (for
the roster cases). This completes the **#72** election work — chat, buffs, and
roster all elect now.

**What it does:**
- **Roster election (per-group).** The Zeal raid roster is identical from every
  raider's view, but per-member HP arrives only for the uploader's OWN group. So
  with `dedup_roster` on, exactly **one agent per raid group** uploads the roster
  snapshot; the rest stand down. An agent not in a raid (or without Zeal) is its
  own group and always uploads. Composition + every group's HP stay fully
  covered. Fail-open everywhere (bot down / flag off / unknown group → upload).
- **Stray-endpoint gates.** The "buffs feel laggy" report now rides the buffs
  role (a stood-down agent stops sending the diagnostic — but its own local
  snappy-mode still engages, so nothing changes for the clicker). The "✓ cured"
  debuff-clear is a manual raid-wide action and is **intentionally NOT gated** —
  any raider's click still clears the chip for everyone.
- **Camp-out early handoff.** When you type `/camp`, your agent flags itself
  `camping` and tells the bot immediately (no 20s wait). The bot stops electing
  you as a reporter ~30s before your logout would trip the TTL, so a groupmate
  takes over the roster/buffs/chat handoff *before* you vanish. If you're the
  ONLY candidate in your scope you keep reporting until you're actually gone.

**Where to look:** the agent `/status` `reporter.roles.roster` (true = you upload
the roster; false = you stand down) and the reporter status line, which now shows
**camping** while a camp is in progress. `agent.log` prints
`[reporter] roster role → REPORTER / → stand down` and a camp start/abandon line.

### ✅ Solo (one machine)
1. **Flag off = no change.** With `dedup_roster` unchecked, `roles.roster` stays
   `true` and the roster uploads exactly as before (production default).
2. **Flag on, sole candidate.** Tick `dedup_roster` + Save. Running only your
   machine, within ~60s `/status` still shows `roles.roster: true` — you're the
   only candidate in your group, so you keep uploading. The /raid board is
   unchanged.
3. **`/camp` shows camping + hands off.** In game, type `/camp`. Immediately (not
   after 20s) the dashboard reporter line shows **camping**, and `agent.log` notes
   the camp start. Type a move key to **abandon** the camp (`You abandon your
   preparations to camp.`) → the camping flag clears and the line returns to
   normal. (Solo, you stay elected the whole time — sole candidate, fail-open.)

### 👥 Multi-person (2+ machines on beta) — **needs raid partners**
1. **Two Mimics, same group → one uploads.** Two raiders in the SAME raid group,
   both on beta Mimic, `dedup_roster` on. After ~60s exactly **one** shows
   `roles.roster: true` (the lower primary-name rank); the other stands down. The
   /raid board still shows the whole group's HP (the elected one covers it).
2. **Different groups elect independently.** Put the two raiders in DIFFERENT
   groups → BOTH upload (`roles.roster: true` for each), because each group elects
   its own reporter. No group's HP goes dark.
3. **Camper hands off within ~20s of camp-start.** The elected roster (or buffs,
   or chat) reporter types `/camp`. Within ~20s — well before the 60s TTL — a
   groupmate/zone-peer flips to `roles.*: true` and takes over. Confirm the board
   / buff queue / chat never stalls during the swap.
4. **Kill the reporter → TTL failover.** Instead of camping, the elected reporter
   hard-closes Mimic (no `/camp`). Within ~60s (the TTL) a peer takes over. This
   is the backstop the camp handoff front-runs.

**Status:** ⏳ awaiting solo + multi-person verification.

---

## Chunk 0 hotfix — `{s}` triggers now fire on backtick names

**Needs:** agent **3.3.75** (beta Mimic).

**What it does:** name-captured guild triggers (`{s} has become ENRAGED.`,
`{s} slows down.`, etc.) compiled to a pattern that excluded the backtick
character, so Luclin mobs whose names carry one — **Rhag\`Zhezum, Aten\`Ha\`Ra,
Yar\`Lir** and friends — could *never* match. Those triggers silently never
fired. Fixed; multi-word and apostrophe names still match.

### ✅ Solo (near a backtick-named mob)
1. Enable a guild `{s}` trigger that a backtick mob will produce — e.g. an
   Enrage (`{s} has become ENRAGED.`) or Slow (`{s} is slowed.`) trigger.
2. Engage a backtick-named Luclin mob (Ssraeshza Temple has several). When the
   line fires in your log, the trigger overlay/TTS should now **fire with the
   mob's name filled in** (previously: nothing).
3. Regression: confirm a **space-named** mob (e.g. "an ancient croaker") and an
   ordinary single-word name still fire as before.

### 👥 Multi-person
- Not required — trigger matching is per-client. One person near the mob proves it.

**Status:** ⏳ awaiting verification on a backtick-named pull (Luclin raid).

---

## Callout trifecta — "why TTS never fires" (#76)

### Triggers now fire on ENRAGED / snared / mez / fizzle lines
**Needs:** agent **3.3.76** (beta Mimic).

**What it does:** the trigger engine only ever saw lines the combat filter
positively *kept*, so a whole class of templates — mob **ENRAGED**, self
**snared / mesmerized**, spell **fizzles**, cure/emote lines — matched lines
that were dropped before a trigger could run. 9 of the 17 shipped suggested
templates could never fire. Now triggers evaluate on those lines too. Privacy is
unchanged: tells / officer / group / custom-channel lines still never reach a
trigger, and only the trigger name + captures relay, never the raw line.

#### ✅ Solo
1. Enable a trigger on one of the newly-visible lines, e.g. `{s} has become
   ENRAGED.` or `You are snared.` (personal trigger is fine).
2. Produce the line in-game — get snared by a mob, or tank one to enrage. The
   trigger overlay/TTS should now **fire** (previously: silence).
3. Privacy regression: a trigger on `{s} tells you` must **not** fire on an
   actual `/tell` — private lines stay invisible to triggers.

#### 👥 Multi-person — not required (per-client matching).

**Status:** ⏳ awaiting verification.

---

## Not in beta (shipped straight to main — noted here for completeness)
- **Trigger relay: no more post-deploy deafness** (bot **3.0.198**, live): the
  relay id counter now seeds from a monotonic boot base, so after a bot deploy
  agents no longer skip every relayed callout for hours. **Not directly
  user-testable** — the symptom (cross-client callouts silent for hours after a
  deploy) simply won't recur.
- **Auth 503-not-401 data-loss fix** (bot **3.0.197**, live): a Supabase blip
  during a fight no longer turns valid uploads into permanent loss. **Not
  user-testable** without inducing a Supabase outage — verified by unit test
  (null→503, []→401) and code review. Watch for: fewer "my parse vanished"
  reports after a Railway/Supabase wobble.
