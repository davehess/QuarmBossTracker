# What this platform has cost to build and run

**Why this file exists** (the guild lead, 2026-09-18): *"I would like to have an
accounting for how much this project has cost since its inception… so that I can
justify donations against it. I don't have intentions of recouping all of the
spend, I just want to make sure that my bases are covered in case someone asks
why I'm accepting donations for this."*

That is the standard this page is written to: **if a guild member asks why
donations are being accepted, this is the answer, and every number in it is
either measured or explicitly marked as needing a source.** Nothing here is
padded and nothing is invented.

Measured **2026-09-18**. Refresh the figures the same way (§5) before quoting
them.

---

## 1. The project, in numbers

| | |
|---|---|
| First commit | **2026-04-21** |
| Age at measurement | **4.9 months** (150 days) |
| Commits | **2,278** |
| Releases published | **730 tags** — 145 stable, 584 prereleases |
| Live surfaces | 4 (Discord bot, web app, parsing agent, Mimic desktop client) |
| Database today | **2.20 GB** |

## 2. Infrastructure — measured

| Service | Plan | Running since | Rate | Elapsed | Spend to date |
|---|---|---|---|---|---|
| **Railway** (bot) | Hobby | 2026-04-21 | $5/mo | 4.9 mo | **≈ $25** |
| **Supabase** (database, auth) | Pro | 2026-05-25 | $25/mo + compute | 3.8 mo | **≈ $95** org-wide — see §3 |
| **Vercel** (web) | Hobby | 2026-05-27 | **$0** | 3.7 mo | **$0** |
| **Claude** (development) | subscription | 2026-04 | **$100/mo** | 6 billing months (Apr–Sep) | **≈ $600** |
| **Domain** `wolfpack.quest` | — | — | — | — | ⚠ **needs your figure** (§4) |

### The total

| | |
|---|---|
| Infrastructure (Railway + Supabase + Vercel) | **≈ $120** |
| Development tooling (Claude, $100/mo × 6) | **≈ $600** |
| Domain | *pending* |
| **Total spend to date** | **≈ $720**, plus the domain |

**The shape of that number is the story: development tooling is ~5× the
infrastructure.** If someone asks what the donations are for, the honest answer
is that the servers are the small half. ⚠ And state which kind of subscription
it is — a plan you would hold anyway is weaker justification than one taken out
for this work. Six months at $100 is what was paid; whether all of it is
attributable to this project is yours to say.

### Railway — the bill is the plan, not the usage
Measured over the last 30 days: **0.080 GB RAM average, 0.0196 vCPU average.**
At Railway's published rates ($10/GB-month, $20/vCPU-month) that is **$1.20/month
of actual resources** — comfortably inside the $5 of usage the Hobby plan
includes. So the platform costs $5/month because that is the plan floor, not
because it consumes $5.

Worth stating plainly when someone asks: **the bot is cheap to run.** What costs
money is the database, and what costs the most is time.

### Vercel — genuinely free, and that is conditional
The web app runs on Hobby, which is $0. ⚠ **Hobby is non-commercial under
Vercel's terms.** A guild site qualifies. It keeps qualifying under a donation
model — donations are not payment for a service — but if the arrangement ever
became a paid service, this line stops being $0
(`docs/DESIGN-selfhost-wizard.md` §2a).

## 3. The Supabase line — why Pro, honestly

The **Pro plan is billed per organisation, not per project**, and the
organisation (`hesstastic`) holds **two** projects: `RaidBosses` (this platform,
created 2026-05-25) and an unrelated one created the day before. So "$25/month"
is not automatically this project's cost.

⚠ **An earlier draft of this page said "this platform cannot run on the free
tier." That was too strong, and the guild lead was right to push back.** The
accurate statement is narrower and more useful:

**Pro is required by retention decisions we made, not by the platform.**
`docs/DESIGN-selfhost-wizard.md` §2a already established that a guild *can* run
on Supabase Free with retention tuned down, and named the exact settings. Our
2.20 GB is what our own choices produced:

| Table | Size | Share | Why it is that size |
|---|---|---|---|
| `encounter_threat_snapshots` | **1,266 MB** | **56.2%** | ⚠ **Its 30-day sweep has never worked** (`DECISIONS-2026-09-01.md`). This is a bug's worth of disk, not a requirement |
| `chat_messages` | 225 MB | 10.0% | Deliberate — years of guild history, no retention by choice |
| `who_observations` | 142 MB | 6.3% | 60-day raw + latest-sighting |
| `target_observations` | 93 MB | 4.1% | — |
| everything else | ~528 MB | ~23% | includes the ~119 MB `eqemu_*` reference catalog, which is the same for every deployment |

### 3a. The trend — measured again 2026-09-22

Three dated measurements now exist, so the shape is visible rather than
inferred. Sizes are `pg_total_relation_size`, i.e. table + indexes + TOAST.

| | 2026-09-01 | 2026-09-18 | **2026-09-22** | Δ over the 21 days |
|---|---|---|---|---|
| **Database total** | 1,761 MB | 2,253 MB | **2,451 MB** | **+690 MB (+39%)** |
| `encounter_threat_snapshots` | 920 MB | 1,266 MB | **1,414 MB** | **+494 MB (+54%)** |
| `chat_messages` | — | 225 MB | 227 MB | +2 MB in 4 days |
| `who_observations` | — | 142 MB | 142 MB | flat |
| `target_observations` | — | 93 MB | **111 MB** | **+18 MB in 4 days** |

**One broken sweep is 72% of all growth.** Of the 690 MB the database gained
in three weeks, 494 MB is the threat table — roughly **23 MB/day** of the
~33 MB/day total. Everything else combined adds under 10 MB/day, and the two
big deliberate tables (`chat_messages`, `who_observations`) are effectively
flat.

⚠ **The sweep is measurably still not running**, and it is getting worse, not
holding: **1,190,281 rows, of which 746,964 (62.8%) are past the 30-day
retention window, oldest 2026-07-02** — 82 days old under a 30-day policy. On
2026-09-01 the same measurement was 448k stale rows at 52%. It has added
~299k stale rows since.

**Headroom against Pro's 8 GB ceiling:** 2,451 of 8,192 MB = **29.9% used**,
5,741 MB free. At the 21-day average (~33 MB/day) that is **~5.7 months**; at
the last-four-days rate (~50 MB/day) it is **~3.8 months**. Neither is
urgent, and neither is far away.

**Fixing the sweep reclaims ~890 MB immediately** — 62.8% of the threat
table — taking the database to roughly **1,560 MB, below where it stood on
2026-09-01**, and removing ~23 MB/day of ongoing growth. That is still the
single highest-value item on the list, and it is now worth about eight months
of headroom rather than the four it was worth three weeks ago.

⚠ **Watch `target_observations`.** It is small but it is the second-fastest
grower at ~4.5 MB/day over the last four days, faster than `chat_messages`
which we keep on purpose. Nobody has checked whether it has a retention
policy at all.

**So: more than half the database is a retention sweep that does not run.** Fix
it and the database roughly halves. At the 7-day window §2a recommends for a
free deployment, that table would be ~105 MB instead of 1,266 MB.

That still would not fit Free's 500 MB with our full chat history — but the
honest framing is *"we keep more than we need to, and one sweep is broken"*,
not *"the software demands a paid plan."* A guild starting fresh on the settings
§2a recommends would fit Free for a good while.

### What to tell someone who asks

| Basis | Monthly | To date | The argument |
|---|---|---|---|
| **Marginal** — what this project adds to a bill that would exist anyway | ~$10 | ~$38 | The other project keeps the org on Pro regardless; this adds a second compute instance |
| **Causal** — the plan is on Pro because of this project's data | ~$25 | ~$95 | Our 2.20 GB is 4.5× Free's ceiling. True, but the honest footnote is that 56% of it is the broken sweep |

**Use whichever you like, but state the basis and state the footnote.** The
credible version of this is "we're on Pro because of how much we keep, over half
of which is a bug we haven't fixed yet" — that is a better answer than a bigger
number, and it comes with an obvious action attached.

## 4. The figure still outstanding

I have no visibility into this one. **Do not let anyone, including me, estimate
it — get it from the source:**

| Figure | Where it lives | Note |
|---|---|---|
| **Domain** `wolfpack.quest` | Your registrar's billing page. `web/next.config.js` names Porkbun, and `CLAUDE.md` flags that as **unverified** — a cloud session cannot check (DNS-over-HTTPS and the registrar API are both blocked by the egress proxy) | Registration + renewals since inception. `.quest` renewals are typically the larger number, not the first-year promo |

*(Claude was supplied by the guild lead on 2026-09-18 as **$100/month since
April** and is now in §2. Only the domain is outstanding.)*

**Fill the domain in and the accounting is complete.** Leave it blank rather than
guessing; a made-up number is worse than a missing one for the purpose this page
serves.

## 5. Keeping it current

- **Railway usage:** the Railway MCP `get-service-metrics` over a 30-day window
  (RAM and CPU averages), multiplied by the published rates above.
- **Database size:** `select pg_size_pretty(pg_database_size(current_database()))`.
- **Project age and releases:** `git log --reverse`, `git rev-list --count HEAD`,
  `git tag | wc -l`.
- **Plans:** Supabase MCP `get_organization` (returns the plan), Vercel MCP
  `list_teams` (returns the plan).

Re-measure before quoting. Every number above carries its measurement date for
that reason.

## 6. What a donation is, and is not

This section matters more than the arithmetic, because it is what actually
answers "why are you accepting donations".

- **The project is not for profit.** It is AGPL-3.0-or-later, open source, and
  free for any guild to run forever (`docs/LICENSING.md`). Donations exist to
  offset the bills above — nothing more.
- **A donation buys nothing.** No priority, no feature, no support tier, no
  say in the roadmap. Every feature is in the repository for everyone,
  including people who give nothing. Say this wherever the link appears.
- **Giving nothing costs nothing.** No functionality is gated on payment and
  none ever will be.
- **Contributions are worth more than money.** The guild lead's own position,
  2026-09-18: *"I'd rather have someone contribute quality enhancements over
  dollars if they are going to use the platform."* A pull request that improves
  the platform for every guild is worth more than the monthly bill. AGPL §13
  already requires anyone running a modified version as a network service to
  offer their source; sending it here as a PR is the version of that which
  actually helps (`CONTRIBUTING.md`).
- **Cost-share for a hosted deployment is a different thing** and has its own
  terms (`docs/TERMS-hosted.md`): it covers that deployment's infrastructure
  and time, it is not a donation, and it is not profit.

## 8. Cost model for the hosted plans, per guild (2026-11-02, DECISIONS §527)

The guild lead: *"break out the paid sections by cost … that way we can form a better cost model."* The rule (§527,
`docs/DESIGN-raidmimic-hosted.md` §8e) is that what costs us money is what we charge for; this is what each paid piece
costs. **A guild** = about 36 raiders uploading, 3 raid nights a week, ≈ 13 nights a month (the night measured in
`DESIGN-raidmimic-hosted.md` §7a). Prices are list prices as known on 2026-11-02 and need checking against each provider's
page before anyone quotes them; storage is billed only above Supabase Pro's included 8 GB, at $0.125/GB-month.

### 8a. Fixed: what the platform costs before the first guild

| Line | Monthly | Note |
|---|---|---|
| Supabase Pro | $25 | includes $10 of compute (the Micro instance) and 8 GB of database |
| Vercel Pro | $20 | **needed the day we charge**: Hobby is non-commercial (§2). One seat |
| Railway | $5 | Hobby floor; the bot uses about $1.20 of it (§2) |
| Domains | ≈ $3 | raidmimic.com and its sister hosts, about $35 a year together |
| **Total** | **≈ $53** | before development time (§7.1), which is the real cost and is not in this model |

### 8b. Per guild, per month, by paid piece

| Paid piece | What drives the cost | Basis (measured) | ≈ per guild-month |
|---|---|---|---|
| **Card fee on the $25** | Stripe: 2.9% + $0.30 per charge | fixed by the processor | **$1.03**, the largest per-guild line |
| **The per-second fight feed** (replays, threat, raid review, spectator) | storage at 30-day retention; but mostly **database work**: ~43k rows a night per guild | 41 MB a night → ≈ 0.53 GB held → **$0.07 storage**. Load: today's one guild runs on the included Micro instance | **$0.07 storage + a share of compute** (8c) |
| **Merged parses and fight detail** (rollups, contributions, per-player rows, the raid tracker) | storage that grows forever | ≈ 100 MB a month kept → 1.2 GB after a year | **$0.01 in month 1, $0.15 by month 12** |
| **Chat relay and /who history** | storage that grows forever | ≈ 4 MB a night → 52 MB a month | **$0.08 by month 12** |
| **Shared buff landings** | storage, kept 7 days | ≈ 13 MB held | **< $0.01** |
| **A Raid Mimic bot in the guild's Discord** | bot memory and its connection | one shared bot: today $1.20 of resources for one guild with 99% headroom; a dedicated bot per guild: one more Railway service | **≈ $0.10 shared, ≈ $1 to $2 dedicated** |
| **Pages and overlays reading from us** (reviews, replays, live boards) | egress, $0.09/GB beyond Pro's 250 GB | not measurable from here (dashboard only, §3); a fight replay is a few MB, read by ~30 raiders a night ≈ 2 GB a guild-month | **$0 inside the 250 GB, ≈ $0.18 beyond it** |
| **Cloud UI backups** (Pro · Individual) | storage per player, autos pruned to 5 | 10 MB today for everyone | **< $0.01 a player** |

### 8c. The one line that scales: database compute

Storage is cents. What grows with guilds is the database's **work**: the fight feed is ~43k row writes a night per guild, plus
the reads behind replays and live boards. ~~One guild fits in the included Micro instance today (§334: the slow spots were
indexes, not size).~~ **2026-11-04: it did not** (DECISIONS §538): the Micro's Disk IO burst budget ran out mid-raid, disk fell
to 11 MB/s and the database hung for 90 minutes, so the guild lead upgraded compute to **Small** ($15 list, about +$5 a month after Pro's $10 credit). One guild needs more
than Micro on a raid night. Supabase sells bigger instances by the month (list: Small $15, Medium $60, Large $110, XL $210). As a
planning guess, not a measurement: Small around 5 guilds, Medium around 20, Large around 50, which is **about $2 to $3 per
guild-month**. Moving the fight feed out of Postgres into compressed files (`DESIGN-raidmimic-hosted.md` §7a: ~40 KB per fight
gzipped, $0.02/GB) takes most of that work away and is the cheapest lever we have.

**Revised 2026-11-05 against Supabase's published limits** (supabase.com/docs/guides/platform/compute-and-disk, read that day;
the guild lead: "look into how it scales if we bring in other guilds now that we're on a larger plan"). The limit that bit us is
**sustained disk IO**, and it scales with compute size like this (sizes up to 2XL burst to 261-594 MB/s on a daily budget, then
fall to baseline; 4XL and up do not burst and do not throttle below their line):

| Size | $/mo list | RAM | Baseline disk | Baseline IOPS | × Micro | Rough concurrent raiding guilds* |
|---|---|---|---|---|---|---|
| Micro | 10 | 1 GB | 11 MB/s | 500 | 1× | under 1 (ran dry 2026-11-04) |
| **Small (ours)** | 15 | 2 GB | 22 MB/s | 1,000 | 2× | 1-3 |
| Medium | 60 | 4 GB | 39 MB/s | 2,000 | 4× | 4-8 |
| Large | 110 | 8 GB, dedicated CPU | 79 MB/s | 3,600 | 7× | 8-15 |
| XL | 210 | 16 GB | 149 MB/s | 6,000 | 12× | 15-25 |
| 4XL | 960 | 64 GB | 594 MB/s | 20,000 | 40× | 60+ |

\* **Estimates, not measurements.** The only data point is one guild exhausting Micro's budget about 1 h 45 m into a raid, before
the read trim (bot 4.0.55) and before the fight feed leaves Postgres; both cut that guild's load, the feed by most of its writes.
The column assumes that roughly halves a guild's raid-night demand. What counts is **guilds raiding at the same time**, not
guilds signed up: Quarm raids cluster in US evenings, so plan for most guilds overlapping. Replace the column with the dashboard's
"Disk IO % consumed" on Small for a raid night after the fight feed moves (1% or more = above baseline that day).
**This means the 2026-10 guess above (Small ~5, Medium ~20, Large ~50 guilds; ~$2-3 per guild-month) was optimistic** by roughly
3×: plan on **~$8-12 of compute per raiding guild-month** at 5-15 guilds, falling toward ~$5 on the larger, non-bursting sizes.

**First measurement, raid night 2026-11-05 on Small** (one guild, ~53 raiders, ~30 Mimic uploaders, Plane of Water; after the read
trim; fight files in mode 1, so every snapshot row was still written). Postgres's own counters (`pg_stat_io` reads + writes and
`pg_stat_wal` bytes), sampled hourly from 7:57 PM to 12:45 AM ET:

| Window (ET) | MB/s (read + write + WAL) | I/O ops/s | Share of Small's 22 MB/s · 1,000 IOPS |
|---|---|---|---|
| 7:57–9:00 | 0.36 | 22 | ~2% · ~2% |
| 9:00–10:00 | 0.36 | 16 | ~2% · ~2% |
| 10:00–11:00 (two Coirnav attempts) | 0.44 | 25 | ~2% · ~2.5% |
| 11:00–12:45 (incl. the midnight jobs) | 0.62 | 65 | ~3% · ~6.5% |
| **Raid window 7:57–11:00** | **0.38** | **21** | **~2% · ~2%** |

⚠ These are Postgres's view, not the dashboard's Disk IO budget: reads may be OS-cache hits (an upper bound), and checkpoint
fsyncs, temp files and the OS are not in them. They are also far too low to explain Micro running dry on 2026-11-04 (its baseline is
11 MB/s), so either the read trim (bot 4.0.55) removed most of that night's load or most metered I/O is invisible here. The guild
lead's dashboard reading of "Disk IO % consumed" for the same night is the number that settles which; until then the guild column
above stays an estimate.
The other limits are far away: files in Storage (Pro includes 100 GB; keeping everything is ~3.6 GB per guild-year), database
size (Small's recommended maximum is 50 GB; a guild's durable rows are ~1.2 GB a year once the feed is out), connections (one bot
process talks to the database, so 90 direct / 400 pooled on Small is not in play), the bot's memory for live fights (~12 MB per
fight in progress), and egress (250 GB a month included; never measured, read it from the dashboard).

### 8d. What it adds up to

| Guilds | Fixed | Per-guild costs (≈ $1.03 fee + ≈ $0.30 storage, bot, egress + ≈ $2.50 compute) | Total cost | Revenue at $25 | Margin |
|---|---|---|---|---|---|
| 1 | $53 | ≈ $4 | ≈ $57 | $25 | −$32 |
| 3 | $53 | ≈ $12 | ≈ $65 | $75 | +$10 |
| 10 | $53 | ≈ $38 | ≈ $91 | $250 | +$159 |
| 50 | $53 | ≈ $190 | ≈ $243 | $1,250 | +$1,007 |

⚠ The table's ≈ $2.50 compute per guild is the 2026-10 guess that §8c's 2026-11-05 revision calls optimistic. At ~$10 a guild
the 10-guild row is ≈ $166 against $250 and break-even moves to about **four or five** paying guilds; the shape holds.
**Break-even is three paying guilds** (at the old compute guess). Above that the per-guild cost is about $4 of a $25 plan, and the biggest single line is
the card fee, not the servers. Free users (§527: flags, kills, the overlays) cost almost nothing per head and are not in
these rows; a free player's sync is a few KB a night.

Re-measure: table sizes with `pg_total_relation_size`, Railway with `get-service-metrics`, and egress from the Supabase
dashboard (§5). The compute steps in 8c are the guess most worth replacing with a measurement once a second guild uploads.

## 7. The honest caveats

1. **The largest real cost is not on this page.** 2,278 commits over 4.9 months
   is a very large number of evenings, and it is unpaid. It is deliberately not
   converted into a dollar figure here — doing so would invite an argument about
   the rate, and the rate is not the point.
2. **Infrastructure cost grows with retention, not with guild size** — see §3.
   **Fixing the threat-snapshot sweep would roughly halve the database**, and
   that is a better answer to cost than asking for money. It is arguably the
   single highest-value item on the open list for this reason.
3. **Nothing here is tax or accounting advice.** How donations are treated where
   you live is a question for an accountant — `docs/DESIGN-business.md` §7.2 has
   the specific questions to ask.
