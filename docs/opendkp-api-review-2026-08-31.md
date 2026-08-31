# OpenDKP API review — are we targeting them well?

Hitya supplied OpenDKP's full API reference (2026-08-31) and asked for a review
of every interaction. This is that review, ranked by **measured** cost rather
than by guesswork: the table below is our real 7-day spend from
`opendkp_call_stats`, not an estimate.

| Endpoint | calls / 7d | MB / 7d | Auth per the reference |
|---|---:|---:|---|
| `/clients/{c}/audits` | 575 | **189.1** | `oauth2` |
| `/clients/{c}/characters` | 439 | 59.7 | `oauth2` |
| `/clients/{c}/auctions` | 135 | 54.9 | `noauth` |
| `/clients/{c}/raids/{id}` | 1097 | 6.9 | `noauth` |
| `/clients/{c}/raids` | 154 | 5.3 | `noauth` |
| `/clients/{c}/adjustments` | 73 | 4.2 | `noauth` |
| `/clients/{c}/dkp` | 34 | 3.4 | `noauth` |
| Cognito `InitiateAuth` (ours) | 405 | 1.6 | — |
| `/clients/{c}/auctions/active` | 4586 | 0.8 | `noauth` |
| `/clients/{c}/auctions/{id}` | 164 | 0.3 | `noauth` |

≈ **325 MB/week**. Two lines are 76% of it.

## ⚠ CORRECTION — the 7-day average misranks the top two

The live `/opendkp` dashboard for the **last 24h** tells a different story, and
it is the more actionable one:

| endpoint | calls / 24h | MB / 24h |
|---|---:|---:|
| `/characters` | 128 | **17.5** |
| `/audits` | 37 | 8.6 |
| `/auctions` | 30 | 5.6 |
| `/dkp` | 20 | 2.0 |
| `/raids/{id}` | 204 | 1.4 |
| `/auctions/active` | 968 | 0.4 |

**`/characters` is the real number one.** The 7-day average put `/audits` on top
because it includes the weekly Sunday full sweep — a once-a-week 6.2 MB event
amortised across seven days looked like a daily cost. Averaging over a window
containing a rare expensive event is exactly how a ranking lies; the 24h view is
the honest one for "what does a normal day cost".

**And it concentrates in the raid window**: 100 of those 128 calls, 13.7 MB of
the raid window's 27.7 MB total. Half of raid-night traffic is the roster.

### Why the roster costs 17.5 MB/day

Two callers page the full roster, neither cached:

- `openDkpSync._fetchAllCharacters` — up to 40 pages, **every 30-minute sync
  pass**.
- `dkpTick._resolveCharacterIds` — up to 12 pages, **per tick submission**,
  purely to map names → CharacterIds.

⚠ And the endpoint may **ignore `?page` entirely** — our own comment says so,
and the walk relies on a new-id check to stop after page 2 in that case. So a
"walk" is at least 2 full-roster pulls of ~137 KB.

We re-pull the entire roster every half hour to detect changes that happen on
officer action — the same "poll everything to discover nothing changed" shape as
audits, which we already fixed once.

### Two fixes, neither needing upstream

1. **Gate the roster walk on a Character audit signal.** `classifyAuditAction`
   already classifies `loot` and `adjustment`; the audit taxonomy carries
   `Character Created` / `Character Updated` (2,530 rows). Add a `character`
   class and walk the roster only when one appears since the last walk, plus a
   periodic floor. This is the #110 reconcile-trigger pattern, already proven in
   this file.
2. **`dkpTick._resolveCharacterIds` should read `characters.opendkp_id`**, which
   the 2026-08-30 decision made the authoritative char_id→name map. It is
   resolving names against a 12-page upstream walk when the answer is already
   mirrored locally, for free. Fall back to the walk only for unresolved names.

⚠ Both are worth doing even if the upstream ask lands — they remove OUR waste,
which is the half we control, and they are the credibility behind the ask.

⚠ Note `auctions/active`: **4,586 calls for 0.8 MB.** The shared bot-side cache
is doing its job — that is the whole fleet's bidding panel served for less than
a megabyte. It is not a problem and should not be "optimised".

---

## 1. Audits is 58% of everything — and the fix is persistence, not paging

**It is load-bearing.** `opendkp_audits` is the TRIGGER for mirror
reconciliation (#110): a new "Raid Updated"/"Raid Deleted" since our watermark
means some raid's loot may have changed, so we re-pull and delete ghosts.
Without it the 2026-07-19 "Backpack" class of bug (rows deleted upstream,
lingering forever locally) comes back. Do not switch it off.

**The walk is already well optimised** — cold-start jump to the last page,
last-page fast path, idle backoff. Per idle pass it is ~2 calls, not 17.

**The residual cost is the page SIZE, not the page count.** 189 MB ÷ 575 calls
= **330 KB per call**. We fetch a 330 KB page to learn one number: the highest
audit id. The reference confirms there is no cheaper way to ask — `/audits`
takes `page` and nothing else. No `since`, no count, no HEAD.

### The actionable finding

`_lastPageHint` and the audit watermark live **in process memory**. This
platform redeploys on every push to `main` — **12–42 times a day** (CLAUDE.md).
Every one of those boots starts cold, and a cold boot must fetch page 1 purely
to learn `TotalPages` before it can jump to the last page. That is a 330 KB call
per deploy that buys a number which has not changed in months (a page fills
~every couple of months at ~37 audits/day).

**Persist the page hint + watermark to `bot_kv`** and the cold-start leg
disappears. Same shape as the raid-review message id and the trash tally, and
for the same documented reason: `data/state.json` does not survive a Railway
deploy, so anything keyed per-anything-dynamic belongs in `bot_kv`.

Estimated saving: roughly the cold-start half of the audits bill. Not measured
— which is why it should be measured after, not promised before.

## 2. We already pay for `AssociatedId` and throw it away

`GET /clients/{c}/characters/{id}` returns:

```json
{ "ClientId": "", "Id": 0, "AssociatedId": 0, "Active": 0, "Name": "", "Rank": "", … }
```

**`AssociatedId` is the main/alt link.** We do not capture it anywhere —
`grep -rn AssociatedId` across the repo returns nothing.

Meanwhile `utils/opendkp.js` says of the audit trail: *"This is the canonical
source for main-switch history — the bid/tick heuristics on the character page
approximate what audits could pin down exactly."* We are inferring family
membership from bidding patterns (`_suggestFamily`, MODE-over-loot) while the
authoritative answer sits unread in a roster call we already make and already
pay 59.7 MB/week for.

This is the cheapest accuracy win available: no new call, no new traffic.

## 3. Most of what we read is `noauth`, and we authenticate anyway

405 Cognito `InitiateAuth` calls a week. Per the reference these reads need no
token at all:

`/dkp` · `/characters/{id}/dkp` · `/characters/{id}` · `/characters/{id}/adjustments` ·
`/characters/{id}/raids` · `/characters/{id}/items` · `/raids` · `/raids/{id}` ·
`/auctions` · `/auctions/active` · `/auctions/{id}` · `/adjustments`

Only `/characters` (the full roster), `/audits`, `/settings/*` and every WRITE
are `oauth2`.

Dropping the token on public reads removes a failure mode as well as traffic:
today a Cognito blip breaks reads that never needed a token.

⚠ **Verify before relying on it.** "Auth: noauth" in a Postman collection means
*that request is configured to send no auth*, which is evidence but not proof
the server accepts anonymous callers. Test one endpoint unauthenticated first.

## 4. Adjustments has a per-character endpoint we are not using

`GET /clients/{c}/characters/{id}/adjustments` (`noauth`) → `Id, Name,
Description, Value, Timestamp, CharacterId`.

Today `_familyDkpFromMirror` pulls the WHOLE adjustments table with a 1,000-row
cap and filters in JS, because *"adjustments have no queryable character
column"* — with a comment warning that hitting the cap silently understates
balances. That column exists; it is just on a different endpoint.

Low value in bytes (4.2 MB/week) — this is a **correctness** fix that retires a
documented hazard, not a cost one.

## 5. The DKP field bug — the reference confirms the diagnosis, not the fix

`GET /clients/{c}/dkp` returns *"current DKP, character information, attended
ticks, total ticks, and calculated values for different time periods (30, 60, 90
days, and lifetime)"*.

So the balance IS in the response we already fetch, and
`_pickAccountDkpFromModels` is reading a period or lifetime figure out of a row
that also holds the right one — 192 shown where OpenDKP says 143.

**The reference has no example response for this endpoint**, so the field NAME
is still unknown, and guessing a sixth spelling is exactly how `/auctions/active`
returned `[]` for weeks. `_logStandingsShapeOnce` (bot 3.1.105) prints the real
keys on the next standings refresh — raid-window only, so Wednesday.

⚠ `GET /characters/{id}/dkp` is **not** a balance. It is a LEDGER (`Order, Date,
SourceType, Source, Value, Cumulative, TickId`); the balance is `Cumulative` on
the last entry. One call per character — the per-member traffic Moncs flagged.
Right basis for a future DKP-history view, wrong tool for the pill.

## 6. Smaller leads, recorded not actioned

- **`GET /raids?count=N`** — already used (`getRaids({count})`). Note the
  documented behaviour: *"if count is less than 50, stats will be returned
  otherwise stats will be empty"*, so asking for ≥50 silently changes the
  payload shape.
- **`GET /characters/{id}/raids?lookback=60`** (`noauth`) — per-character raid
  history with a day window. A cheaper per-member attendance answer than
  walking all raids, if we ever need one.
- **`GET /settings/dkp_info`** (`oauth2`) — likely carries the DKP config
  including decay settings. Worth a look if we ever want to model decay
  ourselves rather than reading it out of adjustments.
- **`GET /characters/{id}/decay`** (`oauth2`) — per-character decay models.

## What this review does NOT settle

- The `/dkp` field name. Needs the probe output or one sample response.
- Whether `noauth` truly works unauthenticated against the live API.
- The size of the audits saving from persisting the hint — measure after.
