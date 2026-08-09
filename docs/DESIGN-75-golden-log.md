# [#75] Pre-raid drill + golden-log CI

*Design + shipped state. Wave 4 of `docs/DESIGN-platform-queue.md` — "also the
regression net for everything above". Ordering constraint (queue line ~170):
"Drill [#75] before first-raid mode [#86] — the drill *is* the tutorial."*

---

## The problem

`packages/wolfpack-logsync/index.js` (~30k lines) turns EQ log lines into every
number the guild sees: parse cards, DPS/tank meters, charm sessions, kill
credit, the `encounter_combat_rollup` history, the Mob Info debuff list. A
change to `parseEvent` or `EncounterBuilder` is verified today by an ad-hoc
`node -e` harness and then, in practice, **by a live raid**. That is how a
regression reaches 40 people at once, and it is why the four-gate rule
(queue doc) lists "drill test" as gate 3 for every independently-updatable
component.

The golden log is the fix: a committed synthetic log that every parser change
replays, asserting a known-good result.

---

## What ships

| Piece | Path | What it is |
|---|---|---|
| Fight fixture | `test/fixtures/golden/raid-pull.log` | 68-line synthetic raid pull. Drives both tiers. |
| Family catalogue | `test/fixtures/golden/line-families.log` | 49 lines, one per parser family a single bard's raid log wouldn't naturally contain (mend, taunt, bandolier…). Tier A only. |
| Replay harness | `test/fixtures/golden/_replay.js` | The one pipeline both the test and the regenerator drive. |
| Expectations | `test/fixtures/golden/expected-parse.json`, `expected-encounter.json` | Generated, committed, reviewed. |
| Spec | `test/golden-log.test.js` | 147 tests. Rides `npx vitest run`. |
| Regenerator | `scripts/update-golden.js` (`npm run golden:update` / `golden:check`) | Accepts a behavior change, on purpose, with a diff. |
| CI gate | `.github/workflows/golden-log.yml` | PRs + pushes to `main` and `beta`. |
| Drill | `scripts/preraid-drill.js` (`npm run drill`) | Read-only chain check an officer runs before the pull. |

---

## Design decision 1 — what the golden log contains

**Synthetic, always.** `docs/PRIVACY.md` is the whole reason: a real
`eqlog_*_pq.proj.txt` carries tells, officer chat, group chat and real player
names, none of which may enter this repo. Every character name in the fixtures
is invented (`Sylvarra`, `Torvahk`, `Kaelthorne`, `Brambleth`, `Draggomir`,
`Fenrisk`, `Nyxaria`, `Orvo`) and matches no Wolf Pack member. NPC and spell
names are game content, not personal data, so those are real (`Lord of Ire`,
`Tuyen's Chant of Flame`, `Legacy of Spike`) — realism where it is free.

The fight fixture is a full pull, not a pattern list, because the aggregate tier
needs a coherent encounter: an engage, a tank taking hits, a death, a charm
cycle that breaks and re-lands, and a killing blow. Coverage was built by
reading `parseEvent` top to bottom and writing a line for each branch.

### Families covered (all 25 `parseEvent` can emit)

`damage` (7 distinct branches: self-melee verb, third-person verb, `Your <X>
hits`, `<Name>'s <X> hits`, DoT-from-your, DoT-from-third-party, sourceless
`was hit by`) · `ds_flavor` · `rampage` · `bandolier` (all 5 actions) · `mend`
(crit/regular/fail) · `avoid` (miss/dodge/parry/riposte/block/invulnerable) ·
`critical` (melee + spell) · `guildstatus` · `resist` · `spell_resisted` (both
forms) · `death` (all 4 forms) · `heal` (third-person, self-received,
self-outgoing) · `crit_heal` · `cast` (casting + singing + third-person) ·
`melody_start` / `melody_stop` · `taunt` · `stun` · `feign_death` · `evade` ·
`dirge_cast` (both `SOURCELESS_SPELLS`) · `pet_leader` (declaration, charm ack,
summoned-pet ack, `regards X as an ally`) · `charm_break` (bystander + self) ·
`dire_charm_cast` · `who` (levelled, AFK, rank-suffixed, ANONYMOUS, GM, `ZONE:`).

The coverage is **enforced, not aspirational**: the spec slices the real
`parseEvent` block out of the shipped source, extracts every `type: '…'`
literal, and fails if any of them is absent from the golden. Adding a new event
family without a golden line for it turns CI red — deliberately, because an
unexercised family is exactly the one that breaks quietly.

### Deliberately excluded

- **Anything from a real log.** See above.
- **Zeal-gauge-sourced state** — charm tick anchoring via slot 16, mob self-heal
  (`noteMobHeal`), `target_hp_pct` trigger conditions. These arrive over the
  named pipe, not the log file; a log fixture cannot exercise them and
  pretending otherwise would give false confidence. A pipe-capture fixture is a
  separate, later piece of work.
- **Trigger evaluation and TTS.** `evaluateTriggersAgainstLine` has its own
  suite (`test/trigger-class.test.js`) and needs a trigger set, not a log.
- **The upload/queue path.** `test/rate-limit.test.js`, `budgets.test.js`,
  `supabase-resilience.test.js` already own that; the golden stops at the
  flushed payload, which is precisely the agent/bot contract boundary.
- **Multi-character (multi-box) cross-flush.** One builder, one character. The
  peer-flush propagation in `flush()` needs two logs and is worth its own
  fixture later.
- `X misses Y.` is present in the family log and parses to **nothing** —
  see "Known gaps".

---

## Design decision 2 — what "known good" means

**Both**, split by tier, because the two halves fail differently.

### Tier A — per-line snapshot, additive-tolerant

`expected-parse.json` holds one row per log line:

```json
{ "i": 19, "line": "[…] You slash Lord of Ire for 96 points of damage.",
  "keep": true, "trigger_visible": true,
  "event": { "ts": "…", "type": "damage", "attacker": null,
             "defender": "Lord of Ire", "ability": "slash", "amount": 96 } }
```

Compared with `toMatchObject`, not `toEqual`. That is the tolerance the
brittleness problem demands: **adding** a field to an event passes; **changing**
a value, **removing** a field, or **changing** the type fails. `keep`,
`trigger_visible` and "this line parses to nothing" are exact — those are
decisions, not payloads.

Both gates are recorded because the agent has two filters with *opposite*
defaults, and recording only one leaves a blind spot:

| Gate | Default | Gates | Exported? |
|---|---|---|---|
| `shouldKeep()` | **DROP** | parse + upload | yes |
| `triggerVisibleLine()` | **KEEP** | the local trigger/callout engine | no |

Deleting a privacy drop pattern does **not** change `shouldKeep`'s verdict on a
`/tell` (nothing in `KEEP_PATTERNS` matches a tell either) — but it does open
the trigger gate. A golden that recorded only `shouldKeep` would sit green
through that regression. `_replay.js` therefore slices the real
`triggerVisibleLine` body and the real `PRIORITY_KEEP_PATTERNS` array out of the
shipped source and evals them — the same fidelity tier
`test/privacy-filter.test.js` already uses, and **zero edits to the agent**.

### Tier B — encounter digest, exact

`expected-encounter.json` is *not* the upload payload. It is a projection this
suite owns (`digestEncounter` in `_replay.js`): event counts by type, damage by
attacker and by defender, `pet_leaders`, per-defender avoidance breakdown, healer
totals, deaths, `ds_reflects`, charm sessions, the per-character/per-skill
rollup, kill slayer + kill credit, `active_duration_s`, `is_raid_window`, and
the identity fields of `who_data`.

Snapshotting the raw payload was rejected: it carries `agent_version` (churns on
every release), wall-clock `observedAt` on every `/who` row, and the entire raw
`events[]`. A golden that goes red on every version bump gets regenerated
reflexively and stops being read — the classic snapshot failure mode. The
digest inverts that: **additive payload fields cannot reach it, so it only moves
when a number moves**, which is what makes an exact `toEqual` safe.

On top of the digest the spec spells out ten named invariants (charm kill credit,
pet attribution, avoidance breakdown, DS wearer attribution, per-skill rollup,
active-duration trimming, privacy…) so a failure reads as a sentence instead of
a 300-line object diff.

### Determinism

`parseEqTimestamp` does `new Date("Sun Aug 02 20:41:00 2026")`, which JS resolves
in the **process** timezone. Every derived number that subtracts two timestamps
is TZ-invariant, but `is_raid_window` re-projects the absolute instant into
`America/New_York`, so it is not. `_replay.js` sets `process.env.TZ =
'America/New_York'` before requiring the agent — otherwise the golden would
differ between a dev box and CI (which runs UTC).

Non-finite numbers are rendered as the string `"NaN"` rather than being allowed
to stringify to `null`, so a NaN in the payload is **visible in the golden file**
instead of masquerading as an absent field. This is not hypothetical — see the
charm-session gap below.

---

## Design decision 3 — how it runs

- **Locally / in `Test`**: the spec is a normal `test/*.test.js`, so `npx vitest
  run` picks it up. Suite went from 32 files / 375 tests to **33 / 522**.
- **Its own CI gate**: `.github/workflows/golden-log.yml` on `pull_request` and
  pushes to `main` + `beta` (agent changes ship from `beta` — the gate has to
  cover both). Three steps, ~1s of work:
  1. `npm run golden:check` — fails if the committed expectations no longer
     describe the parser, i.e. *you forgot to regenerate*. Reported as itself,
     separately from a real invariant break.
  2. `npx vitest run test/golden-log.test.js`.
  3. The drill's offline parser self-test.
- **Accepting a change**: `npm run golden:update` rewrites both expectation
  files and prints a loud reminder to read the diff. The script exists so that
  blessing a change is a deliberate act with a reviewable artifact — never
  "make the test pass".

**The privacy assertions read the LIVE parser, not the expectation file.**
That is the one place where a golden could be dangerous: if the privacy floor
were asserted against `expected-parse.json`, running `golden:update` would
launder a privacy hole into the repo and the suite would stay green. It reads
`R.parseLines()` instead, so the only way to make it pass is for the agent to
actually drop the line.

### Proven, not assumed

Three mutations were applied to the shipped agent and reverted (the agent file
is byte-identical — `git diff` is empty):

| Mutation | Result |
|---|---|
| Drop `shoots?` from `ATTACK_VERBS_RX` (ranger archery) | 🔴 2 tests — the named line `L33 damage: Fenrisk shoots Lord of Ire…` **and** the encounter digest |
| Delete the `/tells you,/` privacy drop pattern | 🔴 the per-line row **and** the privacy floor — and the privacy floor **stayed red after `golden:update`**, as designed |
| `_owner === '__SELF__' → null` in kill-credit resolution | 🟢 not caught — that branch is unreachable in this fixture (`petLeaders` resolves first). Honest limitation; noted rather than papered over. |

---

## Known gaps this pins

The golden is a **characterization** fixture: it records what the code does
today so a change is visible. Six of those recorded behaviors were defects. They
were **pinned, not endorsed** — each had a named `KNOWN GAP` test so that fixing
one shows up as a deliberate red test with a sentence attached instead of a
mystery diff in a 1300-line JSON. #75 itself added the net without changing
behavior; the follow-on change described in "Gaps 1–4: fixed" below then used
that net to fix the first four.

1. **The Quarm two-line damage-shield flavor line never reaches the parser.**
   `parseEvent` emits `ds_flavor` for `"Lord of Ire was pierced by thorns."`,
   and `EncounterBuilder.add()` uses it to retag the buffered DS hit with the
   real spell name — but no `KEEP_PATTERNS` entry matches the line, so
   `shouldKeep` drops it before `parseEvent` is ever called. In the live tail
   the retag **never happens**: DS damage stays tagged `non-melee` forever. The
   golden digest shows it — `ds_reflects` has a `non-melee` bucket that the
   flavor line should have renamed to `thorns`.
2. **Bystander exceptional heals never reach the parser.** Same shape:
   `"X performs an exceptional heal! (N)"` parses to `crit_heal`, and the source
   comment calls it "the one that lets us build a public crit-heal leaderboard
   from a single parser anywhere in the raid" — but `shouldKeep` drops it. The
   leaderboard cannot exist until a keep pattern is added.
3. **Spell crits are filtered while melee crits are kept.** `"X scores a
   critical hit!(N)"` has a keep pattern; `"X delivers a critical blast!(N)"`
   does not. Caster crit data is unreachable.
4. **`charm_sessions[].duration_sec` is always `NaN`.** `EncounterBuilder`
   computes `(ended_at - started_at)` where both are **ISO strings**, so the
   result is NaN and `JSON.stringify` sends `null` to the bot — every charm
   session is uploaded with no duration. Both golden sessions show it.

Two more, lower stakes:

5. **Two of the three Dire Charm cast forms are shadowed.** Only
   `"<Name> begins casting Dire Charm."` reaches `dire_charm_cast`; the self form
   and the `"begins to cast"` form are claimed by the earlier generic `cast`
   matchers, so a Dire Charm is recorded as a regular charm cycle (wrong duration
   model on the overlay).
6. **`"X misses Y."` parses to nothing.** The `avoid` family only handles
   `"X tries to <verb> Y, but …"`. Recorded as a documented null, not a target —
   the plain form may not occur on Quarm at all.

### Gaps 1–4: fixed (agent, follow-on to #75)

The net did its job: all four were fixed as one agent change, the golden went
red in exactly the places the pins predicted, `npm run golden:update` produced a
reviewable 21-line diff, and the five `KNOWN GAP` tests became four `FIXED`
tests asserting the correct behavior plus one still-pinned gap (#5).

| Gap | Fix | Site |
|---|---|---|
| 1 DS flavor filtered | keep pattern `/\bwas\s+(?:pierced\|burned\|…)\s+by\b/i` — the flavor line carries no number, so no damage pattern matched it. `was` only, so the numbered `"X is burned by YOUR Shield of Lava for N points"` form stays with the damage patterns | `KEEP_PATTERNS` |
| 2 crit heals filtered | keep pattern `/\bperforms an exceptional heal!/i` | `KEEP_PATTERNS` |
| 3 spell crits filtered | keep pattern `/\bdelivers? a critical blast!/i` — the caster-side twin of the existing `/\bScores? a critical hit!/i` | `KEEP_PATTERNS` |
| 4 charm `duration_sec` NaN | `_elapsedSec(from, to)` helper (module scope, above `EncounterBuilder`) coerces via `Date.parse` and returns **null**, not NaN, when either end is unusable. Applied at the three sites that subtracted `started_at`/`ended_at`/`last_damage_at` | `EncounterBuilder` charm-break, owner-change, and flush paths |

Privacy is unchanged. `shouldKeep` checks **priority-keeps → drops → keeps**, so
every drop pattern (officer channel, tells both directions, group chat, custom
numbered channels, public say/shout/auction) still wins over all three new keep
patterns. The one widening is that a `/gu` or `/rs` line whose *text* contains
e.g. "was burned by" is now kept — guild and raid chat are deliberately not
private (they are the `/gu` relay), and the same exposure already existed for
every damage keep pattern. The privacy-floor test reads the live parser, so it
would have gone red if any of this touched a private line; it did not.

What moved in the golden (all four expected, none incidental):

- 4 lines flipped `keep: false → true` (three in `raid-pull.log`, one in
  `line-families.log`).
- `ds_reflects` `non-melee` → `thorns`, and the rollup skill `ds:non-melee` →
  `ds:thorns` — the retag the `ds_flavor` handler was written for, now reaching
  it for the first time.
- `event_count` 39 → 41, `critical` 1 → 2, new `crit_heal: 1` — the spell crit
  and the bystander crit heal now reach `EncounterBuilder`.
- Both `charm_sessions[].duration_sec` `"NaN"` → `12` and `9`.

**Left unfixed, deliberately.** Gap 5 (Dire Charm cast forms) keeps its
`KNOWN GAP` pin — the fix is a reordering inside `parseEvent`, not a filter
entry, and reordering the cast matchers has a blast radius (`cast` feeds the
melody overlay, `_pendingCharmSpell`, and the cross-client casting relay) that
does not belong in a filter-table change. Gap 6 (`"X misses Y."`) stays a
documented null.

**Adjacent, NOT fixed (flagged):** `stats.recentParses[].durationSec` in the
agent dashboard has the identical ISO-string subtraction
(`(e.ended_at - e.started_at) / 1000`, ~line 19900), but only on the fallback
branch taken when `active_duration_s` is null. Different object, dashboard-only,
and outside the golden's reach — left alone under the minimal-diff rule.

---

## The drill

The queue pairs the golden log with a drill — "a command an officer runs before
raid to prove the whole chain is alive". Splitting it by side effects:

### Already exists (found while building this — index it)

`_preRaidHealthCheck()` in `index.js` (~line 9260, Hitya 2026-07-13) already
runs at 19:30 ET on raid nights and posts one green/red line to Discord, probing
the Discord gateway, Supabase REST, GoTrue, and `wolfpack.quest/api/health`, with
a `bot_kv` once-per-day latch. **It is not in `docs/HOW-ITS-BUILT.md`** — which is
precisely the "we don't have that" failure mode CLAUDE.md warns about; it nearly
got rebuilt here. The infra half of the drill is done. What was missing is the
**parse chain**.

### Shipped now — `npm run drill` (read-only, zero side effects)

`scripts/preraid-drill.js`. Safe at any time, including mid-raid and inside the
deploy freeze. Exits non-zero if any probe is red.

1. **Parser self-test** — replays the golden log through the agent *in this
   checkout* and compares to the committed digest. Catches "the build you are
   about to hand 40 raiders parses differently from the one we signed off on",
   offline. This is also the tutorial surface the queue's `#86` ordering note
   wants: it prints what a good parse looks like.
2. **`GET /health`** — bot readiness, Supabase circuit-breaker state, any
   uploader over an admission-control budget.
3. **`GET /api/agent/latest-version`** for both `stable` and `beta` — the agent
   version each channel will hand the fleet tonight, next to this checkout's.
4. **Ingest auth** — a bearer `GET /api/agent/guild-triggers` when
   `WOLFPACK_AGENT_TOKEN` is set. A 401/403 here is the silent outage that kills
   every upload on raid night; 503 means the token is unset *on the bot*.
   Skipped (not failed) without a token.
5. **`GET wolfpack.quest/api/health`.**

### Designed, NOT enabled — the write-path drill (needs Hitya's sign-off)

The read-only drill cannot prove the half that actually breaks: agent → bot →
Supabase → Discord parse card. The natural extension is to POST the golden log's
own payload up the real pipe (`--live`), which would be a genuine end-to-end
proof and reuse the fixture that already exists. It is not enabled because it
**writes to production**. What it needs before it can be:

- A reserved boss name (`Wolf Pack Drill Dummy`) and character (`DrillDummy`)
  that can never collide with a real boss, timer, or member — the PoP lock
  incident (CLAUDE.md, 2026-07-13) is the precedent for name-matching hazards.
- A bot-side allow-list so a drill payload is recognised, routed to a drill
  thread rather than `#raid-mobs`, and **never** creates a spawn timer or moves
  a board.
- A retention story for the `encounters` row (drill rows excluded from
  `/parsestats`, leaderboards, and the data floor).

Those are all bot-side (`index.js`) changes, which this task deliberately did not
touch. **Officer call for Hitya: do we want a write-path drill at all, given it
puts synthetic rows in `encounters`?** The read-only drill plus the golden CI
already covers the failure modes we have actually seen; the write drill covers
"the bot accepted it but Discord never showed a card", which we have not.

### Discord surface (proposed, not built)

`/drill` as an officer slash command running the same probes and posting the
same block, so it is reachable from a phone at 19:25. Deferred — it touches
`index.js`/`commands/`, and `#171` owns that file in this batch.

---

## Maintenance contract

- **Green golden ≠ correct parser.** It means the parser matches what we signed
  off on. New behavior needs a new fixture line, and the family-coverage test
  enforces that for whole new event types.
- **Never regenerate to make a test pass.** Regenerate when you have decided the
  new parse is right, then read the diff. Every changed number is a change in
  what the raid's parses will say.
- **The fixtures are hand-written and stay hand-written.** `update-golden.js`
  regenerates only the expectation JSON.
- **Never paste a real log in.** If a field bug needs a real line to reproduce,
  transcribe the *shape* of the line with invented names.
