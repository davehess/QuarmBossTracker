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
3. **Kill switch works.** Admin sets `flag_disable_reporter_election = 1` in
   `/admin/overlays`. Within ~60–80s your `/status` shows `electionOn: false`
   and `roles` all `true` (election disabled → everyone uploads). Chat still
   relays. Set it back to `0`/delete → `electionOn: true` returns.
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

### Not yet in this build (coming in P1b/P1c, still fail-open = everyone uploads)
- Buff-landing de-duplication (zone-aware) — `roles.buffs` is always `true` today.
- Raid-roster de-duplication (group-aware) — `roles.roster` is always `true` today.

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

## Not in beta (shipped straight to main — noted here for completeness)
- **Auth 503-not-401 data-loss fix** (bot **3.0.197**, live): a Supabase blip
  during a fight no longer turns valid uploads into permanent loss. **Not
  user-testable** without inducing a Supabase outage — verified by unit test
  (null→503, []→401) and code review. Watch for: fewer "my parse vanished"
  reports after a Railway/Supabase wobble.
