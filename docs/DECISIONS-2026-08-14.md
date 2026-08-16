# Decisions — 2026-08-14 (Aten Ha Ra raid night, continued)

Same raid session as `DECISIONS-2026-08-13.md`, past UTC midnight. That file
still holds the compat-mode / item-icon / dashboard-split write-ups; this one
carries the live **Open — read this first** table forward, so read this one
first and reach back for the older detail.

---

## Open — read this first

| Item | State |
|---|---|
| **Architect's rebuild assessment — three metrics need Hitya's call** | `docs/ARCHITECT-REBUILD-2026-08-16.md`. First decision changed: durable state gets ONE home (Postgres), Discord becomes a projection. Most under-engineered: the DB read/write layer (three independent paginators, 1000-row cap bit twice, **337 dup groups / 560 excess rows live in `loot_observations` this morning**) — it costs ~an order of magnitude more than the most over-engineered thing (the never-armed `budget_enforce_*` half of #73). Asks: adopt the unpaged-read CI gate (U1)? land #39's cleanup + unique index (U2 → 0)? set 2026-12-01 as the delete-or-keep review for budget enforcement (O1)? |
| **Does guild membership belong in front of PERSONAL tooling?** | Hitya, on the mule upload: *"Being in the guild should not be a limiter for someone making a new character and trying to use the inventory function or target info overlays or any of those things outside of raids."* The claim rule is fixed (below); **the two sign-in gates are not** — someone outside the guild can't reach `/me`, so the upload they need is behind a door they can't open. Splitting personal surfaces from guild surfaces changes who can see guild data, so it needs Hitya's call on shape: guest role, a separate personal tier, or Mimic-only with no web account (task #40) |
| **Roll labels — one line of chat is still unreachable** | Agent 3.5.84 reads commas, tier lists and bare `Item 333` calls, but `"Do a 777 if you want a Shield of the Immaculate"` names the item AFTER the number mid-sentence, and every rule that would catch it also catches real chatter. It stays unlabeled — the same line the `roll_set_overrides` migration cites as why officer edits exist. Also accepted: a roll for TURN ORDER (`Holytomato 111, Emoo 222…`) labels player names as items |
| **Task #27 — the 8 muted trash triggers** | Gate is *"the fleet is on the fix"*, not *"the fix exists"*. Mimic 2.5.0 (agent 3.5.80) shipped 04:08 UTC and **nobody has installed it yet** — flipping the rows on now puts the wall back for every raider still on 2.4.x, which is exactly what the gate prevents. Also a raid-noise call, not a code change: it reaches the whole fleet in ~2 min with no review. Restore after the fleet has updated, on Hitya's word |
| **560 pre-existing duplicate loot rows** | 337 groups across raids 44080–92092, from overlapping `/backfillopendkploot` runs. They inflate "N× won" the same way the fold's bug did. Cleaning them is a destructive edit to historical guild data → needs Hitya's word (task #39). Once gone, a unique index on (source, raid_id, item_id, winner_character, dkp_amount) makes this class of bug structurally impossible |
| **Mimic 2.5.0 — first raid** | The whole 2.5 line (History tab, CH ✕, dashboard split, pet fold, backup-log rule) is browser-verified and unit-tested but has not been through a raid. Sunday is the first real test |
| **Stale live-state can shadow fresher inferred buffs** | A character who returns after a swap keeps their OLD `character_live_state` buff list (Bwavair: 9 buffs, 2h old) because `live?.buffs ?? inferred` prefers any live row over inference. Not changed — she only has 2 observed casts, so falling back would paint a cleric RED "no buffs" and that is a worse lie than a timestamped stale list. Revisit if inferred coverage improves |
| **Item icons DISABLED — needs a local session** | The atlas maps to the wrong icon ids (633 = boots → shovel). Off behind `ICON_ATLAS_DISABLED` since web 1.1.50. Repack via `scripts/pack-item-icons.ps1` on the EQ machine, check `uifiles/default` is stock, and VERIFY 633 is boots before re-enabling |
| **Who rewrites guild chat?** | Hawkner + Syko ship punctuation-stripped, capitalised copies of lines they witnessed. Not our code (same agent build on both sides). Have Hawkner grep his own eqlog for one of the lines — that says client-side vs ours in one step |
| **Zeal `EPERM` → ask about compat mode FIRST** | XP compatibility mode on eqgame.exe kills the pipe, and the guide we recommend tells people to turn it on. Mechanism unconfirmed; `lastError` still isn't surfaced anywhere in the UI |
| **#204–#207** | Graduate to stable after beta test + one raid cycle |
| **Item icons** | Above icon 1723 render blank — count how many real items are affected. Atlas is 1.6 MB; `pngquant` would roughly halve it |
| **Noisy eqlogparser triggers** | Offered, not accepted: disabling Too Far / Can Not See / Can Not Hit From Here / Out of Range / Range, which were filling the trigger checkpoint journal |
| **`docs/DESIGN-eql-support.md`** | Stranded on `claude/sharp-lamport-dC0TW` — land it or drop it |

---

## The number is what makes it a CH chain

**The call (Hitya, live on the Aten Ha Ra pull).** Pyxil was spot-healing the
RAMPAGE target and shouting each heal:

```
[R] [Pyxil]: TUNARE'S RENEWAL Inc to Timberowl - 98% Mana Left
```

Tunare's Renewal is in `CH_EQUIVALENT_SPELLS`, so the agent auto-assigned her a
chain slot the first time it saw one. She landed on **006 — where Mcdorf
actually was** — which lit the ORDER CONFLICT banner and dropped a druid who was
nowhere near the rotation into the middle of it. *"She shouldn't be placed back
onto the CH chain even though she's posting CHs."*

**Where it landed.** The auto-slot branch is gone (agent 3.5.79). An un-numbered
personal-macro shout now becomes a **spot heal**, whatever the spell is, keeping
its CH-equivalent label so the banner can read "Pyxil spot healing (Druid CH)".
A druid who calls a number still joins the rotation exactly as before.

**Why the old reasoning was wrong, since it sounded right.** The auto-slot
existed so a rotation member who doesn't say their number out loud still keeps a
stable row (#148, 2026-07-02). The flaw: **a spot-healer shouting the same spell
is indistinguishable from that person.** One shape of evidence, two very
different situations, and the failure is silent — a corrupted rotation looks
exactly like a working one until a beat is missed.

## ✕ removes someone from the chain — and keeps them off

**The call (Hitya).** *"For the Pyxil scenario we should be able to remove from
the chain via a [x]Remove button."*

`POST /api/chchain/remove {num,name}` → `removeChChainSlot`. The half that is
easy to miss: **deleting the row is not enough.** Whoever seated them is still
shouting the number, so a plain delete is undone within one beat and the button
reads as broken. The removal also blocks that (name, number) for the chain's
life.

**Kept deliberately narrow, because over-blocking is the worse failure — a chain
missing a real cleric kills the tank:**
- a *different* healer calling that number is a genuine re-assignment and seats
  normally;
- a roster announcement is the raid stating its own order, and clears the block
  for every slot it names;
- the block dies with the chain (5-minute idle reset) — it never carries into
  the next pull;
- on a **contested** slot the row survives and passes to the remaining claimant.
  This matters more than it looks: the LAST caller owns the row, so in Pyxil's
  own scenario she is the row's owner by the time anyone reaches for the ✕.
  Deleting the slot would have taken Mcdorf's 006 down with her.

## ⚠ Hover-reveal controls do not work on a repainting overlay

Worth its own entry because it is a general trap, not a CH-chain detail.

The ✕ was first built as a hover-reveal (`opacity:0`, `.row:hover .rmv{opacity:1}`)
to keep a resting chain looking untouched. **Measured in headless Chromium
against `chchain.html`:**

| row state | `.row:hover .rmv` opacity |
|---|---|
| idle | reaches 1 in ~100ms |
| **casting** | **stays 0 indefinitely** |

The rows' innerHTML is rebuilt on every paint while a cast bar moves, and a
freshly-created element under a **stationary** cursor never picks up `:hover`.
So the control would have been invisible precisely on the slot someone is trying
to fix, mid-fight — a new instance of the "the button does nothing" class of bug
that CLAUDE.md already lists for this overlay.

**Rule: on any overlay section that repaints, a control is always drawn and
merely dimmed.** The ✕ sits at opacity 0.30, brightening on hover, inside an
18px right gutter reserved by the row's padding so it can never cover the
countdown.

## Loot rows really are missing — 758 of them

**The question (Hitya).** Target Info → Loot showed *Silver Band of Secrets*
with no "N× won" pill, but Kazmodon had won it. *"Are we missing rows of loot
drops?"*

**Yes, and the boundary is exact.** Kazmodon won it at **raid 98561 for 150
DKP** — present in `opendkp_loot`, which syncs automatically and was current
(last fetch 02:22 that night, up to raid 100367). The Loot tab reads
`loot_observations`, which **stops at raid 96805 / 2026-06-04**: **758 awards
across 28 raids**, roughly ten weeks.

**Cause: two tables, one sync.** `opendkp_loot` has an automatic job.
`loot_observations` has none — it is only ever written by the officer command
`/backfillopendkploot`, and someone last ran it on June 4. Note `loot_drops` is
a third table and is **completely empty** (0 rows); nothing reads it for this
surface, but do not mistake it for the source.

**Where it lands.** Immediate: `/backfillopendkploot days:90`, no deploy needed.
Durable: a scheduled fold of new `opendkp_loot` rows into `loot_observations`
reusing the existing NPC resolution (single-NPC-drop = confident, multi =
ambiguous) — task #37, bot, after the raid freeze. Hitya: *"Yes we need that."*

**The shape to recognise.** A derived table fed only by a manual command looks
identical to a working one right up until someone notices a specific missing
row — the surface degrades silently and partially (older items still show
counts), which is why it survived ten weeks. Same failure family as the
Raid-Helper sync above: **any table whose only writer is a human running a
command needs a staleness alarm or an automatic feeder.**

## A character swap ends when they log back in — and POSITION is what proves it

**The report (Hitya, live).** */raid* showed **Bwavair** under "Not seen /
offline — *(swapped to Bardtholemu)*", 2h ago, and Group 2 rendered "5 chars"
without her. In game she was right there in Group 2 with a full health bar.
*"Bwavair is Bardtholemu's wife, he will play her cleric if we are short on
some, she is online currently."*

**Everything upstream was correct.** Earlier in the night Bardtholemu really did
play her toon on his client, and the same-pid detector in `apps/mimic/main.js`
stamped a legitimate swap at **00:12:40**. The defect is that nothing ever ends
a swap: `swapFor` honoured the marker for a flat six hours, and a marked
character has `raidGroup` nulled and `inRaid:false`, which files them under
"Not seen / offline".

**Measured at 02:59, from `raid_roster`:**

| | group | loc | sampled |
|---|---|---|---|
| Bwavair | 2 | 109.13, −1705.99 → 109.14, −1705.95 (moving) | 0.3s ago |
| Bardtholemu | 8 | −392, −567 | 0.3s ago |

Two bodies, two groups, two positions, same instant, both moving. **One client
cannot do that**, so the swap was over hours earlier.

**The discriminator is POSITION, not presence** — and getting that right is the
whole decision. Presence in the raid window proves nothing: EQ keeps listing
people who camped, which is exactly *why* the swap marker was needed. But Zeal's
raid stream reads loc off a live `Entity*`, so **only someone actually in the
zone has one** — a camped body has none. A position stamped after `swapped_at`
(plus a 30s grace, since snapshots arrive ~1/sec and one can land from just
before the swap) means they logged back in. HP counts too; it is entity-derived
the same way.

Note the asymmetry that makes this safe: *presence* of loc proves life, *absence*
proves nothing (an online raider in another zone has no entity here either). The
rule only ever CLEARS a swap on positive evidence, never sets one.

Web 1.1.51, `web/app/raid/page.tsx`. Tests: `test/raid-swap-return.test.js` — 15
cases, including the ones that must NOT clear it.

## Live combined damage comes off the in-fight view

**The call (Hitya).** *"Instead of displaying the combined damage during the
fight, perhaps we just have the overlay give the last few mobs in a history tab
that can be opened up once it's properly deduped — the overcount from time skew
and whatnot is too much to account for in a live stat review and it is
legitimately doubling damage."*

Bot 3.1.44's corroboration estimator got the headline numbers right (Atlasius
99,979 vs his own 100k; Hitya, Damyu and Wabumkin all within ~1%), but
corroboration is a settling process and mid-fight it has not settled. The
decision is about **when** a number is shown, not whether the estimator works:
combined damage becomes a post-fight artifact, and the live view stays on what
this client observed itself. Task #38.


## The post-raid change train — 2026-08-14

Five things shipped once the raid ended, in this order and for this reason.

**1. Bot 3.1.45 — OpenDKP loot folds itself in.** The night's own finding: a
derived table (`loot_observations`) whose only writer was a human command had
been ten weeks stale, and nobody could have known. Shipped first because it was
the explicit ask and because every hour it waits is more availability of the
kind that has no second copy.

**2. Mimic 2.5.0 stable.** Graduated the whole beta line — nine agent versions,
3.5.72 → 3.5.80 — because the two things Hitya hit live during the raid (the CH
chain picking up a spot-healer, the damage meter doubling people) were both
fixed on beta and both worth the fleet having before Sunday. A meaningful line
takes a minor bump.
- **The graduation was verified byte-exact, not assumed.** After promoting the
  files, `git diff origin/main origin/beta -- apps/mimic packages/wolfpack-logsync`
  returned exactly one line: the version park. That is the check worth repeating
  — a graduation that silently drops a file looks identical to one that doesn't.
- Beta re-parked at **2.5.1**, above the stable. A park at or below would tag
  prereleases that semver-sort *below* the stable and the updater would quietly
  stop offering betas. Discarding beta's history was safe because every beta
  build's commit stays reachable through its release tag (v2.4.1-beta.1 … .11).

**3. Web 1.1.52 — roadmap.** The 2.4.0 entry's headline feature was "the damage
meter now shows the whole raid", which 2.5.0 partly reverses. Leaving that
unqualified would have read as a regression rather than a correction.

**4. Bot 3.1.46 — Raid-Helper staleness alarm.** Same failure family as #1,
caught before it cost anything.

**5. Task #27 held.** See the Open table. Worth stating the general rule: *the
gate on a fleet-wide content change is whether the fleet has the fix, not
whether the fix exists.* The stable was minutes old; nobody had it.

**One process note, recorded because it nearly shipped to the wrong place.** The
RH alarm was committed while checked out on `beta` and pushed with
`git push -u origin main`, which reported "Everything up-to-date" — it pushed
the *local* `main` ref, which had not moved, while the commit sat on beta. The
tell is a push that succeeds with nothing to say. Cherry-picked onto main and
beta reset. Check `git branch --show-current` before committing, not after.


## The loot fold read only the first 1000 rows

Caught by checking, hours after shipping it, whether the thing had actually run.
It had — badly.

**PostgREST caps a response at the server's max-rows setting (1000 on Supabase),
and `limit=50000` in the query string does NOT lift it.** The cap is silent:
1000 rows and a 200.

Both sides of the fold's set-difference were truncated. The dangerous side is
the already-folded set: raids that HAD been folded fell outside the first 1000
rows, looked unfolded, and got re-inserted on the next pass. Two 30-minute
passes ran, leaving **116 duplicate rows** — inflating the very "N× won" counts
the feature exists to fix. The same truncation meant it was walking the OLDEST
pending raids instead of the newest, so only 5 of 28 pending raids had moved.

**Fixed in bot 3.1.47:** `selectAllPaged()` walks with ordered limit/offset until
a short page ends it. Two details that are load-bearing:
- **ordered**, because an unordered offset walk can skip and repeat rows;
- a failed page returns **null, not a short list**. Reading a failure as "the
  table is empty" would mean "nothing is folded yet" and re-fold all history.

The 116 duplicates were deleted, one row kept per award, and the folded range
verified clean.

**Why the tests didn't catch it, which is the part worth keeping.**
`test/opendkp-loot-fold.test.js` shipped with 18 cases and all of them passed
while the thing was truncating in production — because every one tested the
*logic given its inputs* (id reconciliation, dedup keys, wiring) and none tested
*whether the inputs were complete*. `utils/supabase.js` had documented this exact
cap for months, on `upsert()`'s return path. It bites reads identically.

**The general lesson: "did the deploy work?" is a different question from "do
the tests pass", and only the first one would have found this.** A feature whose
whole job is to move rows between tables should be verified by counting rows in
the destination, on the day it ships — not by trusting green CI.

---

## Holding the file is the claim

**The call (Hitya, overruling me the same session).** The mule upload's
`claimVerdict` shipped with four cases; three were uncontroversial and the
fourth was wrong:

> unclaimed but carrying an `opendkp_id` → take the data, do NOT link it

My reasoning was that an OpenDKP row with no `discord_id` is a *real member who
merely hasn't linked Discord*, so linking it to whoever uploaded a file would
silently transfer someone's character. It sounded careful. Hitya:

> "We should at least take the data and allow them to see their characters in
> their account if they have the inventory files and are not already claimed by
> someone. Being in the guild should not be a limiter for someone making a new
> character and trying to use the inventory function or target info overlays or
> any of those things outside of raids."

**The rule is now one question: is it already claimed by somebody else?**
Household → upload, nothing to claim. Linked to another member → refuse.
Everything else — new name, or in `characters` but unclaimed — becomes yours.

**Why the careful-sounding version was the worse trade.** Three things, and the
first is the one I missed:

- **Holding the file is real evidence.** You only have `Pyxtrade-Inventory.txt`
  because you logged in on Pyxtrade and typed `/outputfile inventory`. That is a
  stronger ownership signal than an unlinked OpenDKP row, which proves only that
  the name once got a DKP tick.
- **It broke the real case to guard a hypothetical one.** The population it
  refused is overwhelmingly *your own alt that already raids*, which is exactly
  the character a member most wants to see on `/me` — and the population it
  protected (a stranger deliberately stealing a guildmate's character) has not
  happened once.
- **It guarded that weakly anyway.** The check keys on a file NAME. Anyone
  wanting someone else's character renames a file. A guard that a rename defeats
  is not buying the safety it costs.

And the errors are asymmetric: a wrong claim is visible on `/me`, stamped with
`registered_via_web_at` + `registered_via_web_by_discord_id`, and an officer
reassigns it in one click. A wrong refusal is a dead end a member can't route
around and probably won't report.

**What kept the permissiveness honest:** the audit stamp now goes on the
**claim-of-an-existing-row** branch too, not just on creation
(`web/app/me/inventory-actions.ts`). That was the one thing genuinely missing —
before, taking over an existing row left no trace of who took it. Refusing is
not the only way to make a rule safe; being able to see and undo it is the
other, and it's the one that doesn't break the legitimate case.

**The general form is still open** (top table, task #40): the *claim* rule no
longer gates on guild membership, but the *site* still does — two sign-in gates
stand in front of `/me`, so a non-member cannot reach the upload at all. That
one is Hitya's call on shape, not a flag flip.

---

## The Quartermaster shows you YOUR raiders, not everyone's

**The call (Hitya).** *"quartermaster should display raider information for that
user not for everyone. it can display for everyone for admins."*

Board 1 (utility-kit coverage) shipped in #82 naming every owner of every kit
item to every signed-in member — thirteen cards, each listing up to thirty
character names. That is a browsable who-owns-what of the whole guild, sitting
on a page whose stated job is "does anyone have X?". Board 2 had the scoping
right from the start (your characters up top, officer rollup behind
`isOfficer`); Board 1 was the outlier and nobody noticed because the two boards
were written to answer different questions.

**Where it landed.** `scopeKitCoverage(coverage, ownNamesLower, officer)` in
`web/lib/quartermaster.ts`. Coverage is still assembled guild-wide — the count
has to be — and then narrowed: officer sees the full list, a member sees their
own characters and nothing else.

**The count stays, and that is the deliberate part.** `ownerCount` is not
narrowed. It names nobody, it is the ANON tier the visibility policy already
defines, and it is the entire reason a member opens the board: *"eleven people
have a Puppet Strings, none of them you"* is the useful answer. Cut the count
too and a member cannot distinguish a real coverage gap from their own blind
spot — the board would go from over-sharing to useless in one step. So the rule
is **names are scoped, aggregates are not**.

Two things that make it hold:
- **The rule is one function, not a JSX condition.** A `{officer && ...}` in the
  card is a thing the next person edits around; a scoping step between assembly
  and render is a thing they have to walk past.
- **The test asserts on the whole serialized row**, not on `owners`. It
  `JSON.stringify`s a member-scoped coverage row and checks no outsider's name
  appears anywhere in it — so a future field that carries a name (a "top owner",
  a tooltip, a class breakdown) fails in CI instead of in production.

**Also worth saying plainly:** a member with no characters holding an item now
sees *"None of your characters — 11 in the guild have one."* A card that just
went blank next to "11 owners" would read as a bug, and people report bugs that
are actually policy.

---

## A roll call is not a pipe-separated list

**The report (Hitya).** *"These rolls didn't get consolidated to loot in the
website but did on here"* — the /rolls page showing eleven sessions for the
night, every one **unlabeled roll**, LOOTED BY empty, next to a Command Center
screenshot of the same four ranges.

**The cause was one line, and it had been there since #91:**

```js
if (!line || line.indexOf('|') === -1) return;   // the convention always separates with |
```

The convention did not always separate with `|`. Canopy's call was:

```
[G] [Canopy]: Black Tear 111 , Platinum Tear 222 , Poison Tear 333, Runed Tear 444
```

**Why one missing label emptied two columns.** `attributeLoot()` opens with
`if (!session.item) return []`. So the item name is not just the label — it is
the JOIN KEY to `looted_items`. No name, no loot attribution, no LOOTED BY. The
loot itself had been captured perfectly all along: all four Tears were in
`looted_items`, and two of them went to someone **other** than the roll winner
(333 Canopy → looted by Gnomistakes, 444 Fargan → looted by Mammy), which is
precisely the case the column exists to show. The data was there; the join
wasn't.

**What the chat actually looks like.** Reading 45 days of `chat_messages`
instead of trusting the convention, three shapes matter and only the first
worked:

| | example | before |
|---|---|---|
| A pipe | `Choker of the Wretched 111 \| Crown of Narandi 222` | worked |
| B comma | `Black Tear 111 , Platinum Tear 222` | dropped |
| C tier list | `Helmet of Shadow 311 pick, 322 upgrade, 333 alt` | dropped |
| D bare | `Atramentous Shield 333` | dropped |

D is the most common of all, and C is what Tanidian/Rikel type every raid. So
the pipe rule was matching the *documented* convention rather than the *used*
one, and had been quietly dropping most calls for a month.

**Where it landed (agent 3.5.84).** `parseRollItemLine` walks the NUMBERS
instead of splitting on a separator: the text since the previous number names
that number's item. Shape C falls out for free — the text between 311 and 322
is `pick,`, which is a tier, so 322 carries the previous item forward.

**The real work was the negatives, and fixtures did not find them.** A pipe is
nearly proof of intent; a comma is not, and the parser now reads every chat
line. So I swept it over every captured line within 20 minutes of a live roll
set — the actual blast radius — and it wanted to label four of them:

- `I think we were randoming 100.  Hawkner got a 22 I think?`
- `You didn't even bid 100. Doubt!`
- `DI - Guts 100 )`
- `Do a 777 if you want a Shield of the Immaculate`

Each sat minutes from a real 0-100 or 0-777 set, so each would have appeared on
the page as that session's item. They produced four guards — majority-
capitalised significant words, no ALL-CAPS raid shorthand (DI/CH/MT), at least
one ≥4-letter word, and a range must be a bare 3-4 digit number not followed by
a letter or `%`. The same sweep caught two regressions my own fixtures missed,
where a numberless linked drop glued itself onto the next item
(`Golden Ember Powder | Unadorned Plate Boots 444`).

**The lesson is the one the loot fold taught, applied earlier this time:** a
parser is only as good as the corpus you point it at, and the corpus is in the
database, not in your head. Eighteen green tests hid the loot fold's truncation
for a day. Here the tests were written FROM the real lines, and the sweep found
four defects the tests I would otherwise have written never would have.

**Known and accepted:** `Holytomato 111, Emoo 222, Glarez 333, Kaviar 444`
labels player names as items — that roll really was about those four people, so
it is not wrong so much as unusual, and the officer edit button covers it. And
`Do a 777 if you want a Shield of the Immaculate` stays unlabeled: the item is
named after the number, mid-sentence, and every rule that would catch it also
catches real chatter. That exact line is the one cited in the
`roll_set_overrides` migration header as the reason officer edits exist.

**Backfill.** Last night's four Tears were relabelled through
`roll_set_overrides` — additive, reversible with one DELETE, and applied before
loot attribution, so the two pass/re-roll cases now show their real looter.

---

## Agent-Reach evaluated for blocked sources — NO for cloud, marginal for local

**The question (Hitya).** Would `github.com/Panniantong/Agent-Reach` let us read
sources our cloud sessions can't reach?

**What it is.** MIT-licensed CLI that routes "read this URL / platform" through a
set of per-platform backends: **Jina Reader** (`r.jina.ai`) for web pages,
**Exa** (`api.exa.ai`) for search, `yt-dlp` for YouTube, `gh` for GitHub,
`feedparser` for RSS, and browser automation that **reuses the desktop's
already-logged-in Chrome** for Twitter/Reddit/Instagram/Xiaohongshu. It makes
**no claim** to defeat Cloudflare, bot detection or IP blocking — the README
warns the opposite, that cookie-driven platform access risks account bans and
recommends throwaway accounts.

**Measured from a cloud session, which settles it:**

| host | result |
|---|---|
| `r.jina.ai` (its web-page backend) | `CONNECT tunnel failed, 403` |
| `api.exa.ai` (its search backend) | `CONNECT tunnel failed, 403` |
| `pqdi.cc` / `eqemulator.org` / `quarm.guide` | `CONNECT tunnel failed, 403` |
| `api.github.com` | 403 |
| `raw.githubusercontent.com` | 200 |

**Its backends are behind the same wall as the sources.** Our blocks are the
environment's own egress policy, applied at the proxy — not site-side
anti-scraping. A tool that "reaches more of the internet" still needs egress to
reach it, so on a cloud box it fails at the same hop the direct fetch does.
Routing around that proxy is not on the table either: it is a control of the
execution environment, not a site's bot rule.

**And even unblocked it would not fix our actual list:**
- **PQDI** 403s cloud IPs *at the site*. Jina Reader fetches from a datacenter
  IP too, so it would very likely draw the same 403 — swapping one cloud IP for
  another is not a fix. Running it locally is, which is what we already do.
- **`api.porkbun.com`** needs credentials on an API, not page reading.
- **DNS-over-HTTPS** is not a web page.

**Where it is genuinely capable: a LOCAL desktop session** — open egress, plus
browser automation against a real logged-in Chrome, which does things a plain
fetch cannot. But that is also where we *already* have what we need: local
sessions reach pqdi.cc, quarm.guide and eqemulator.org directly, and the
`local session fetches → mirrors into Supabase` rule already covers the handoff
(the `spell_level_seed` and eqemu backfill precedents).

**So the call is no**, and the reason is worth keeping because it generalises:
**a fetch-aggregator cannot solve an egress-policy block.** Check whether the
wall is the environment's or the site's before reaching for a tool — ours is the
environment's, and the tool's own backends prove it by being blocked too.

⚠ **If it is ever reconsidered, the install model is the thing to weigh.** It
installs by handing the agent a URL and letting it run the install script
autonomously, and the only machine it would help is the one holding `A:\EQ`,
`D:\EQServer` (MariaDB creds in `eqemu_config.json`) and our Supabase
service-role key. That is a large amount of trust for a convenience wrapper
around tools (`yt-dlp`, `gh`, `feedparser`) we can invoke directly.

Repo stats not cited: `api.github.com` is blocked here too, so the star/fork
counts on the rendered page could not be verified — and they do not bear on the
measurement above.
