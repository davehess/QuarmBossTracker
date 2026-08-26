# DESIGN — Bid assist: per-character bid ledger, roaming planned bids, auto-bid

**Status:** specified 2026-08-26, foundation shipping. Owner: Hitya.

> ⚠ **This document exists because the feature was described in a session and
> never written down.** Hitya, 2026-08-26: *"the local mimic bidding piece I
> described and queued up with you disappeared."* It had — a search of
> `STATUS.md`, `DESIGN-platform-queue.md`, every `DECISIONS-*.md` and git
> history across all branches found nothing. This is the CLAUDE.md
> "decisions get WRITTEN DOWN, same session" rule failing in the exact way it
> warns about. Do not let this file go stale; it is the record.

## The ask, verbatim

> "I had described an addition to bidding in the dashboard view where our
> opendkp login is.
>
> local sync of a player's per-character bid items won vs lost, the last winning
> bid, runner up, and what they bid. then the ability to bid n+1 by default but
> also choose a higher amount. those are the wishlist items that people can
> easily add since they bid on them previously. we don't ever want to default
> these on in case they won other items for the same slots.
>
> tickbox for auto bid, load the bid for that item when that loot item is
> posted. have these all local and sync them up to the DB and bring them back
> down to a local mimic."

## Where it lives

The **Loot bidding panel on the agent dashboard** (`WEB_HTML` in
`packages/wolfpack-logsync/index.js`, card id `wpBiddingCard`) — the card that
already carries the OpenDKP login gate. Not a new surface.

## What already exists (do not rebuild)

| Piece | Where |
|---|---|
| OpenDKP login gate, token kept local, never uploaded | `_opendkpAuth`, `logsync.opendkp.json` |
| Per-item **last winner + winning bid + runner-up** | `_lootItemSummary` (bot), `server-panel?key=item-history` |
| **"+1" prefill** (runner-up + 1, falls back to last-win + 1) — never auto-submits | bidding panel |
| Caller's **wins** + **wishlist inferred from past bids** | `server-panel?key=bid-history` |
| "Already won" set, uncapped sweep (bot 3.1.33 fix) | `wonItemIds` |
| **Planned next bid per item** | `logsync.plannedbids.json` — **LOCAL ONLY** |
| Per-item dismissal from the misses list | `logsync.lootdismiss.json` — **LOCAL ONLY** |
| Bid character family (main + alts) | `logsync.bidfamily.json` — **LOCAL ONLY** |
| Sealed bid submission | `POST /api/agent/place-bid` (officer-mediated) |

## The delta — what is actually missing

1. **Roaming.** The three `logsync.*.json` files above have **no bot-side
   counterpart at all** (verified 2026-08-26). Reinstall Mimic, switch machines,
   or run the Deck instead of the desktop and every planned bid is gone. This is
   the "sync them up to the DB and bring them back down" half.
2. **Losses.** `bid-history` returns wins. The ask is **won vs lost, and what
   they bid** — the losing bids are already mirrored in `opendkp_auction_bids`
   but are not surfaced per character.
3. **Auto-bid.** A per-item tickbox that submits the planned bid when that item
   is posted for auction. Does not exist in any form.

## Design

### 1. Roaming store — `character_bid_prefs`

One row per (guild, character, item). Owner-scoped: a member only ever reads and
writes their own family's rows.

```
guild_id      text
character     text        -- the bidding character, not the account
item_id       integer     -- OpenDKP game item id
planned_bid   integer     -- next bid to place; null = none
autobid       boolean     -- submit planned_bid when this item is posted
dismissed     boolean     -- hidden from the misses/wishlist list
updated_at    timestamptz
PRIMARY KEY (guild_id, character, item_id)
```

**Last-writer-wins on `updated_at`.** Deliberately not a merge: these are one
person's preferences edited on one machine at a time, and a merge would let a
stale Deck resurrect a planned bid the desktop just cleared. The agent sends its
local rows with their local `updated_at`; the bot keeps whichever is newer.

**The local file stays the source of truth for the live UI** — sync is a
background convenience, never a blocker. A dashboard that cannot reach the bot
must keep working exactly as it does today (the whole panel is already built
that way).

### 2. Won vs lost ledger

Extend `server-panel?key=bid-history` with a `lost[]` alongside `wins[]`, drawn
from `opendkp_auction_bids` where the caller's character bid and someone else
won: `{ item_id, item_name, my_bid, winning_bid, runner_up, won_by, at }`.

⚠ **The cap lesson applies here.** bot 3.1.33: a `limit=100` DISPLAY query was
reused as a SET, and 87 of one family's 187 awards read as unwon. Any "did I win
this" set must be its own **uncapped** sweep, never seeded from a display array.
`test/loot-won-set.test.js` pins that; add the same shape for losses.

### 3. Auto-bid — the safety-critical part

Hitya's own constraint is the governing rule:

> "we don't ever want to default these on in case they won other items for the
> same slots."

Therefore:

- **Off for every item, always, until explicitly ticked.** No bulk enable, no
  "enable all wishlist", no inheriting from a previous character.
- **Never inferred.** Appearing in the wishlist (which IS inferred from past
  bids) must never imply autobid.
- **A win clears it.** When the character wins any item, every autobid they hold
  is cleared — that is exactly the "won other items for the same slots" case,
  and it is cheaper to make them re-tick than to spend DKP they meant to save.
- **A ceiling is required, not optional.** Autobid submits
  `min(planned_bid, ceiling)`; without a ceiling the tickbox is an open cheque
  against a number nobody re-read since last month.
- **Bids still ride the sealed officer-mediated path** (`/api/agent/place-bid`).
  Autobid changes *what* is submitted and *when*, never *how*.
- **Every autobid submission is announced locally** in the panel and logged, so
  a member can see a bid was placed on their behalf without reading OpenDKP.

### ANSWERED — "you have to be in the raid for it to fire"

Hitya, 2026-08-26. Away-from-keyboard is fine; **not being in the raid is not.**
That is a better gate than any time window: away-but-raiding is exactly when you
want autobid, and not-in-the-raid is exactly when you do not.

**Implemented as `_isCharacterInRaid()` (bot), against `raid_roster` with a
10-minute freshness bound** — "was in a raid last night" must never read as
"is in the raid now".

Three properties, each pinned by `test/autobid-raid-gate.test.js`:

1. **It FAILS CLOSED, and that is an INVERSION of the identical predicate in
   the agent's trigger path.** `require_raid_member` there deliberately falls
   OPEN on an empty roster ("so out-of-raid testing still fires") because a
   missed callout is worse than a spurious one. For autobid the polarity flips:
   an empty roster means we cannot *prove* you are in the raid, and "cannot
   prove" must never spend DKP. Same question, opposite correct answer — which
   is precisely the kind of thing that gets copied across by pattern and
   silently inverted.
2. **Enforced on the BOT, not the agent.** The agent's local
   `_raidRosterHas()` is a useful fast path, but the bid is submitted from the
   bot; a gate living only next to the decision is advisory, and stale local
   state would walk straight past it.
3. **A lookup failure is not permission.** Errors, a disabled Supabase, and a
   missing character name all return false.

**Stated plainly so it is not discovered later: Zeal populates `raid_roster`, so
a member without Zeal — every Deck user until the pipe bridge lands — gets no
autobid at all.** That is the safe direction, and it is the honest cost of this
gate.

## Order of work

1. **Foundation (now):** `character_bid_prefs` + a bot read/write endpoint +
   the agent syncing its three local files up and down. Nothing user-visible
   changes; planned bids simply survive a reinstall.
2. **Ledger:** `lost[]` on `bid-history`, and the won/lost/what-I-bid table in
   the panel.
3. **Autobid:** the tickbox + ceiling + clear-on-win, once the open question
   above is answered.

Autobid is deliberately last. Steps 1 and 2 are useful on their own and carry no
risk of spending anyone's DKP.
