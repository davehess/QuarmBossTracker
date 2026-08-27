# Who the agent is allowed to talk to

**Status: rule in force as of 2026-08-27 (agent 3.6.2 / bot 3.1.87).**
Written because we broke it for fourteen months without noticing.

---

## 1. The blindspot

> **A counter that watches one caller reads as "we're clean" when a second
> caller exists.**

On 2026-08-26 we published `wolfpack.quest/opendkp` — a public, no-sign-in
counter of every request we make to OpenDKP — specifically so its operator
would not have to take our word for our traffic. We spent two days driving the
numbers on it down: 140 MB/day of audits to under 10, a fan-in auction cache,
an outbound governor, a kill switch.

The next morning Moncs asked:

> "Do you purposefully call /dkp once a minute? Looking back over the past 60
> minutes, it looks like theres about 54 calls from 184.144.103.149 calling it"

**That ip was a member's home PC.** `opendkp_call_stats` is populated by
`utils/opendkp.js`, which is bot code. The agent called `api.opendkp.com`
directly, from every machine running Mimic, and so:

- it never appeared on the counter we built for exactly this purpose;
- it was not covered by `OPENDKP_MAX_CALLS_PER_MIN`;
- it scaled with **how many people had Mimic open**, which is the one dimension
  a server-side counter cannot even see; and
- we showed the counter to the person paying the bill and said "watch this
  rather than take our word for it."

The bug was one line — a 60-second cache. The blindspot was the belief that the
bot was the only thing that talked to OpenDKP. Nobody checked, because the
question never got asked: **every conversation about our OpenDKP volume was
implicitly scoped to the bot.**

### The general form

Ask it of any integration, not just this one:

1. **How many processes can originate this call?** If the answer is "one per
   user", the cost is a fleet multiplier and no server-side number can see it.
2. **Does the thing that measures us sit on the same path as the thing that
   calls?** If measurement is in `utils/opendkp.js` and a caller is in
   `packages/wolfpack-logsync/`, the measurement is structurally incomplete.
3. **Can the kill switch reach every caller?** `OPENDKP_HALT` does reach the
   agent, but only within ~2h via token expiry — a real gap while an incident
   is live.
4. **Whose money is it?** Our own bandwidth is a budget question. A third
   party's is a relationship question, and it is not ours to spend.

---

## 2. The rule

> **The agent does not call third-party APIs. The bot does, and the agent asks
> the bot.**

Not "the agent calls them slowly", not "the agent caches harder". A TTL is a
number somebody can turn back up; an absent hostname is not. The agent has no
address for OpenDKP's API and must not regain one —
`test/opendkp-standings-cache.test.js` fails the build if it does.

**Why the bot instead:** a call from the bot is one call for the whole guild
regardless of fleet size, it lands in `opendkp_call_stats` so the public
counter is honest, `OPENDKP_MAX_CALLS_PER_MIN` caps it, and `OPENDKP_HALT`
stops it in seconds rather than hours.

### The one exception, stated so it is never mis-described

**AWS Cognito, for the member's own OpenDKP login.** The agent drives
`USER_PASSWORD_AUTH` against `cognito-idp.<region>.amazonaws.com` and stores the
token locally (`logsync.opendkp.json`, never uploaded). This stays on the client
because it is the member's own credential and a bid must be attributable to a
person — routing it through the bot would mean the bot handling member
passwords. It is **per-token (~1h), not per-minute**, and it is not OpenDKP's
API Gateway. Anyone saying "the agent talks to no third party" is wrong; the
accurate sentence is "the agent makes no third-party **data** calls."

### What the trigger is, and what it is deliberately not

Hitya, when this was scoped: *"if there is an auction it should be something
they receive, or it should be a poll that happens on the bot side that happens
after a named mob is killed. maybe there's a better design than those two given
what we know about loot being posted from trash mobs as well."*

There is, and the trash-mob observation is what rules the second option out.
**The refresh trigger is an open auction, not a mob kill.** Keying off named
kills is wrong on both sides:

- it **misses** loot, because loot gets posted off trash mobs too — the exact
  case the question raises; and
- it **fires for nothing**, because a mob dying does not move anybody's DKP.
  A *bid settling* does.

An auction being open is the precise signal that bidding is happening, and we
already have it for free: `_panelAuctions` is 113 bytes a call, demand-driven
and shared fleet-wide. So the policy in `_standingsRefreshDecision` is:

| State | Upstream refresh |
|---|---|
| **Raid window** + an auction open | at most every **60s** |
| **Raid window**, nothing open | at most every **30 min** |
| **Outside a raid window** | **never** — answer from the mirror instead |
| Last attempt failed | not for 60s, even mid-auction |

### ⚠ The gate is the raid window. An open auction only sets the pace inside it.

Corrected 2026-08-27, same day, after the first cut let an open auction alone
justify a live call. Hitya:

> "the live dkp checkin should be raids-only since users are getting more dkp
> with each tick. the rest of the time the checkin should be just to the bot and
> database."

That is the actual reason a live figure is worth paying for: **DKP moves per
TICK, and ticks only happen while raiding.** Between raids nobody is earning, so
the mirror holds the same number — an off-raid live call buys a value we already
have, on somebody else's bill. And an auction *can* sit open off-raid (a market
night, a late award), so the first version would have kept a trickle running all
week for nothing.

**Off-raid the panel is not empty** — `account-dkp` falls back to
`_familyDkpFromMirror()`: ticks earned + adjustments − loot spent, straight from
Supabase, no upstream call. The response carries `source: 'opendkp' | 'mirror'`
so the panel can label an estimate as an estimate rather than quietly present it
as live.

⚠ `_familyDkpFromMirror` was **extracted** from the `bid-history` key, not
copied. Two hand-maintained copies of a DKP formula is how the loot panel and
the bid panel start disagreeing about what somebody can afford.

---

## 3. Every call the agent makes

Complete as of agent 3.6.2. Everything in §3.2 goes to **our own bot**
(`WOLFPACK_AGENT_TOKEN` bearer); nothing in it reaches a third party.

### 3.1 Outside our infrastructure — the whole list

| Destination | What | When | Notes |
|---|---|---|---|
| `cognito-idp.<region>.amazonaws.com` | member's OpenDKP login + token refresh | on login, then ~1h token life | The documented exception above. No data calls. |
| ~~`api.opendkp.com/clients/{name}/dkp`~~ | ~~standings~~ | ~~every 60s per agent~~ | **REMOVED 2026-08-27.** This entire row is the incident. |

That is the list. Two rows, one of them deleted.

### 3.2 To the bot — ingest (POST, durable queue)

Every one persists to `logsync.queue.json` first: 15s drain, exponential backoff
to 10m, 4xx drops as permanent.

`encounter` · `chat` · `historical_chat` · `bosskill` · `lockout` ·
`live-state` · `raid-roster` · `buff_casts` · `casting` · `tells` · `pvp` ·
`pvp_assists` · `trigger` · `trigger-relay` · `trigger_feedback` · `fun_event` ·
`quake` · `ui_layout` · `threat-snapshot` · `crash_report` · `inventory` ·
`spellbook` · `quarmy` · `pop_flags` · `pop-anomaly` · `faction` · `rolls` ·
`looted` · `loot-post` · `dkp-tick` · `hatekill` · `live-damage` ·
`extended-target` · `di-status` · `debuff-clear` · `buff-lag-report` ·
`who-override` · `reporter-override` · `flag-override` · `place-bid` ·
`ui-edit-result` · `bid-prefs` · `ari-lead`

**Load-shed:** `flag_shed_<kind>` 200-acks-and-drops the ephemeral streams.
`_SHED_NEVER` protects `encounter`, `chat`, `bosskill`, `lockout`,
`historical_chat` — the durable ones — so nobody can fat-finger the raid's
parse collection off.

### 3.3 To the bot — polls (GET), with cadence

| Cadence | Endpoint | Purpose |
|---|---|---|
| 1.5s | `poll` (#106 multiplexed) | one loop carrying `recent_fires` + `tuning` + `triggers` + `prefs` + `backfill` + `ui_edits` at each stream's own cadence, with per-stream cursors. Falls back to the individual routes on a 404. |
| 20s | `reporter-poll` | reporter heartbeat + control plane (`flag_agent_kill`, `min_agent_ver_num`) |
| 2 min | `guild-triggers` | backup path for the trigger set, and the second carrier of the control-plane keys |
| on demand | `mob-info`, `target-casts`, `target-buffs`, `who-lookup`, `raid-buff-queue`, `incomplete-encounters`, `raid-objectives` | overlays, as the fight needs them |
| ETag'd | `spell-catalog`, `item-clickies` | catalogs; 304s cost nothing |
| on update check | `latest-version` | agent update prompts |
| **raid window or Loot tab open** | `server-panel/*` — `auctions`, `my-bids`, `account-dkp`, `bid-history`, `item-history`, `loot`, `reporters` | the Loot tab. **Gated as of 2026-08-27** — see §4. These reach the bot only; whether the BOT then goes upstream is §2's raid-window question, answered separately. |

### 3.4 Local only, never uploaded

`logsync.opendkp.json` (bearer token) · `logsync.bidfamily.json` ·
`personal_triggers.json` · `logsync.queue.json` · the dashboard on
`localhost:7777`. Officer chat, tells, group and custom channels are filtered at
byte level **before** parse and never leave the machine (`docs/PRIVACY.md`).

---

## 4. The Loot tab, and the raid gate

Hitya: *"move the opendkp bits to their own loot tab with rolls and make sure it
only checks for loot during raids."*

Bidding lived on the Dashboard and rolls lived on Stats — two ways of handing
out the same drop, on two different screens. Both now live on **💰 Loot**
(`renderLootTab`, `#loot`), bidding above rolls.

**The gate is `wpLootPollWanted()`: a raid window OR the Loot tab being open.**

These are two different gates and it matters which is which:

| | Gate | Effect of being wrong |
|---|---|---|
| Agent → **bot** | raid window **OR** Loot tab open | our own infrastructure; costs us bandwidth |
| Bot → **OpenDKP** | raid window, **full stop** (§2) | somebody else's API bill |

So off-raid a member with the tab open still gets a live-updating panel — it is
just being served from our database instead of from OpenDKP.

⚠ The `OR` is deliberate and should not be tightened to raid-window-only. Loot
*is* handed out off-raid — DKP-market nights, a late award, an officer clearing
a backlog — and a hard raid-only gate leaves the panel dead with no explanation
for exactly the person who went looking for it. Opening the tab is an explicit
"I am doing loot right now", which is the same signal a raid window is, only
stated by hand. What the gate does stop is the background case: a dashboard left
open on the Fights tab all week, polling loot nobody is looking at. That was the
entire problem.

---

## 4a. The mirror sync also backs off between raids

Hitya, 2026-08-27: *"cut down the number of calls as much as possible outside of
raid times."*

Once the agent stopped calling OpenDKP, the **30-minute mirror sync** became the
bulk of what he sees from us. Measured over a 12h window that day:

| endpoint | calls | data |
|---|---|---|
| `/auctions` | 26 | 11.9 MB |
| `/characters` | 65 | 8.9 MB |
| `/audits` | 26 | 7.3 MB |
| `/raids/{id}` | 245 | 1.5 MB |
| `/raids` · `/adjustments` | 33 | 0.8 MB |
| `/auctions/active` | 537 | ~0 |

All maintenance, none urgent, and between raids it overwhelmingly re-learns that
nothing changed — the same argument that made the live DKP check raids-only, and
it applies harder here: a raid is also the only time new raids, new auctions and
new loot appear at all.

**Full 30-minute cadence inside the raid window (widened to start at 6pm ET so
the board is current when the pull starts); once every three hours otherwise**
(`OPENDKP_OFFRAID_SYNC_HOURS`). Roughly a 6× cut on off-raid passes.

⚠ **Anchored to clock BLOCKS, not to elapsed time, and that is load-bearing.**
The marker is process-local and `main` takes 12–42 pushes a day. With a relative
"has it been three hours" test, either every boot forces a sync — the redeploy
amplification that turned out to dominate the audits bill — or a cold process
adopts the clock and a bot restarting more often than the interval **never syncs
at all**, silently, looking exactly like it is working. Wall-clock blocks make
both impossible: a restart re-adopts the current block, and the next block
arrives on schedule regardless.

⚠ **There is no boot pull.** Hitya, 2026-08-27: *"can we take the opendkp pull
out of main redeploy? we have the data that isn't stale prior to the raid, save
for peoples saved bids and wishlists."* A sync used to run 45s after start; on a
platform that redeploys on every push to `main` that is a per-deploy pull of data
the process we just replaced had mirrored minutes earlier — the same
redeploy-amplification shape that dominated the audits bill, and a hole straight
through the block-anchored cadence above. The interval is now the only trigger.
After a deploy the mirror waits one scheduled pass (≤30 min in a raid window,
else the next 3h block).

⚠ **A bids-only boot pass is not the answer to the wishlist caveat.** Bids arrive
on `/auctions`, which at ~680 KB is the single most expensive call we make — so
"just refresh the bids" costs more than waiting. Live auctions never come from
the mirror anyway (`_panelAuctions` reads `/auctions/active` on demand), so
bidding itself is unaffected; what waits is bid HISTORY, from which the wishlist
is inferred.

⚠ **The officer command is never throttled.** `/syncopendkp` passes
`force: true`, and `full` implies force. That is an officer saying "go now",
usually *because* something looks wrong or they just made an off-raid
adjustment — the exact moment a silent throttle would report success having done
nothing. (Caught pre-ship: the command did not pass force.)

The cost is latency on an off-raid officer edit — it reaches the mirror within
three hours rather than thirty minutes, the same trade already accepted for the
audits idle backoff.

⚠ **Measured 2026-08-27, and it is bigger than the "DKP only moves during raids"
reasoning implies.** Adjustments are the exception to that rule, and they are
almost entirely off-raid: of 295 adjustment rows, **only 8 (2.7%) were made
during raid hours** (8pm–midnight ET). The largest single cluster is **Friday**
— 113 rows, 101 of them a `30 days no raids` inactivity purge — i.e. officer
housekeeping done after the raid week ends. Small ±20 corrections (a pass
because someone was locked out, a ceded item, a missed tick) are real but a
minority at 78 rows, and they are also logged after the raid rather than during
it.

So the accurate statement is: **ticks only move DKP during raids; adjustments
move it mostly on Fridays.** The design still holds — off-raid the panel reads
the mirror, and the mirror catches up within the 3h block — but a member who
checks their balance in the hours right after a bulk purge can see a stale
figure. **An officer doing a purge should run `/syncopendkp`**, which is
force-flagged and never throttled, rather than waiting for the block. We cannot
hook this automatically: adjustments are made in OpenDKP's own web UI, not
through our bot, so the first we hear of one is the next sync.
(If the audit-cursor proposal lands, `Adjustment Created` in the delta feed
closes this properly — see `DESIGN-opendkp-audit-cursor.md`.) Bidding is unaffected: the loot panel reads `_panelAuctions`
on demand, not this sync.

---

## 5. Open

| Item | State |
|---|---|
| **`/opendkp` still under-reports** | It counts the bot only. Now that the agent makes no OpenDKP data calls that is *true* rather than misleading — but the page should say so explicitly, because the guarantee is a code property, not something a reader can see. |
| **`OPENDKP_HALT` reaches agents in ~2h, not instantly** | Via Cognito token expiry (`DECISIONS-2026-08-25.md` §3). With the data call gone this no longer gates any traffic, but the same latency would apply to any future client-side integration. |
| **Nothing enforces the rule for OTHER third parties** | The test names OpenDKP. A future integration could reintroduce the same class of bug against a different host; a generic "no third-party hosts in agent code" lint would be the real fix. |
