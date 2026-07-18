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
