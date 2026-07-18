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

### Not yet in this build (coming in P1c, still fail-open = everyone uploads)
- Raid-roster de-duplication (group-aware) — `roles.roster` is always `true` today.

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
