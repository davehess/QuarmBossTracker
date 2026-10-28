# Gear, items, spells & characters

Gear finder, item, spell and NPC pages, inventory, characters, faction. Oldest first. Find an entry by its ID in [the index](README.md); new decisions go in `inbox/` and are merged here.

## 2026-08-13/5 — The item icon atlas draws the wrong art — disabled before raid
*2026-08-13 · DECISIONS-2026-08-13.md · Item icon atlas wrong art; disabled*

**How it surfaced.** Guild lead: *"Gear isn't showing icons… not gear, inventory."*
Two separate problems, and the reported one was the smaller.

**Why the inventory page showed nothing.** `/character/[name]/inventory` has its
OWN `ItemIcon.tsx` that hotlinks PQDI (`https://www.pqdi.cc/Icons/item_<icon>.png`)
and hides the `<img>` on error. The degradation is deliberate — "never a
broken-image square" — but it is **silent**, so the page fails to exactly what
was reported: names, no art, no console error, no placeholder. It was simply
never moved onto the atlas; `web/components/ItemIcon.tsx` was built later for
the loot surfaces and the inventory page kept its own copy.

**Going to make that switch is what found the real bug.** The atlas does not
correspond to the catalog's icon ids. Ground truth from `eqemu_items`, not from
eyeballing art:

| icon | what shares it | what the atlas drew |
|---|---|---|
| 633 | 276 items, every one named `…Boots` | a shovel |
| 1050 | earrings only | a cake |
| 746 | plate helms | a flower |
| 510 | talismans / amulets | boots |

2 of 10 sampled icons matched — chance. **Already live** on `/parses`,
`/parses/[id]` and `/raid/review/[date]` via `LootBlock`, so wrong item art had
been on production since the icon work landed.

**Disabled rather than left (Guild lead: "before raid").** Wrong art is worse than no
art — it reads as bad *data* rather than a missing picture, and the raid review
gets read the morning after a raid. One constant, `ICON_ATLAS_DISABLED`, drops
every surface back to name-only. Web 1.1.50.

**What is NOT wrong — do not re-investigate these:**
- Geometry is exact: 1600×1240 = 40×31 cells for 1224 icons.
- Content is clean: **1191 distinct non-blank cells, ZERO duplicates**.
- Packing walked the sheets correctly: the blank cells form a clean **period-6**
  pattern (2 filled, 4 blank), i.e. a partially-filled 6-wide source sheet read
  row-major.
- **Ruled out:** a lexicographic `dragitem1, dragitem10, dragitem11…` glob
  (predicted cells came out a dagger, a bag, a ring); and any constant
  whole-sheet offset (scanned ±180 in steps of 36 — nothing lands right).

The sheet-to-icon-id mapping is what is wrong, and pinning it needs the source
sheets. ⚠ **Needs a local session**: re-run `scripts/pack-item-icons.ps1` on the
machine with the EQ install, and check whether that install's `uifiles/default`
is stock or a custom UI pack (the guild's own guide recommends Nillipuss/Duxa),
since a custom sheet set would explain coherent-but-differently-ordered art.
**Verify icon 633 renders as boots before flipping the flag back.**

**The testing lesson, which is the part worth keeping.**
`test/item-icon.test.js` passed the entire time the atlas was rendering a cake
for an earring — and its own header warns that a wrong offset "shows the WRONG
ITEM'S picture, which looks like bad data rather than a bug." It checked the
index arithmetic, which was never wrong. **Index maths and art correctness are
different properties, and only one of them is testable without looking at the
image.** The tests were not weak; they were aimed at the wrong half. Guarding
this properly means rendering a known cell and comparing it to a reference — the
kill-switch tests now at least fail loudly when the flag flips, forcing that
check to happen.

## 2026-08-14/10 — The Quartermaster shows you YOUR raiders, not everyone's
*2026-08-14 · DECISIONS-2026-08-14.md · Quartermaster shows only your own raiders*

**The call (the guild lead).** *"quartermaster should display raider information for that
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

## 2026-08-14/9 — Holding the file is the claim
*2026-08-14 · DECISIONS-2026-08-14.md · Holding the file counts as claiming character*

**The call (the guild lead, overruling me the same session).** The mule upload's
`claimVerdict` shipped with four cases; three were uncontroversial and the
fourth was wrong:

> unclaimed but carrying an `opendkp_id` → take the data, do NOT link it

My reasoning was that an OpenDKP row with no `discord_id` is a *real member who
merely hasn't linked Discord*, so linking it to whoever uploaded a file would
silently transfer someone's character. It sounded careful. Guild lead:

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
one is the guild lead's call on shape, not a flag flip.

---

## 2026-08-19/7 — /who shows base classes, never level titles (bot 3.1.55, main)
*2026-08-19 · DECISIONS-2026-08-19.md · Who shows base classes, not level titles*

"Warlock" on an anon row = the level-60 Necromancer TITLE served raw from
who_observations history via who-lookup. Folded through
`utils/classTitles.normalizeClass` at the serve boundary;
`test/who-lookup-class-titles.test.js` pins the bot map ↔ agent CLASS_TITLES
mirror to each other (both said "keep in sync"; nothing enforced it).

---

## 2026-08-20/7 — Shared banks: fingerprint the content, group by account, count once (Guild lead: "build fingerprinting on shared bank lines")
*2026-08-20 · DECISIONS-2026-08-20.md · Fingerprint shared banks, count once per account*

**The problem.** The shared bank is ACCOUNT-level — every character on a game
account exports identical SharedBank rows — so /me/inventory's totals counted
shared-bank items up to 8×, and the auto-upload (3.6.0) made that the default
state. No game-account grouping existed anywhere (person-level family via
Discord/OpenDKP is a different axis), and characters can move between game
accounts (same TAKP forum account), so a curated mapping would rot.

**⚠ SUPERSEDED THE SAME DAY — read the correction below before trusting this paragraph.**

**The first design (web 1.1.81 + `shared_bank_groups` view).** The shared bank's
identity IS the account fingerprint: hash each character's SharedBank row-set
(slot|item|qty, ordered); identical hash = same game account; the freshest
snapshot in a group is its representative and the only one whose shared bank
counts. Regrouping is automatic — a moved character's next upload carries the
new account's shared bank. Verified against live data: the guild lead's alt account
(a member/a member/a member/a member/a member) and the mule accounts
(Zbag/Hurryupandbuy/Morebagsplz/…, a member/a member/…) grouped correctly on
the first query. Designed-in caveats, recorded in the migration: empty shared
banks never group (no rows → no fingerprint); differently-aged snapshots can
transiently split a group until the stale one refreshes (auto-upload closes
that within ~10 min); cross-family collisions on trivial identical banks are
possible, so family-scoped consumers pick the representative within their own
subset.

**Scope corrections made alongside.** `DESIGN-quarmy-gear.md`'s "no bank data
persisted anywhere, by construction" was true for the Quarmy path only — the
`/outputfile inventory` paths deliberately persist bank + shared-bank ITEM
rows (coin never uploads); the doc now says so. `web/lib/quartermaster.ts`'s
"bank already stripped upstream" comment was false — and per-character kit
checks are CORRECT to count bank/shared-bank (reachability), so behavior is
unchanged there; only /me/inventory sums across characters and only it dedups.
Worn/equipped items were already uploaded + searchable on every path (the guild lead
asked — confirmed, no change needed). Follow-up noted, not built: the
`character_missing_spells` `held_by[]` list can still name every same-account
character for a shared-bank scroll (names, not counts — low harm).

## 2026-08-20/8 — Correction: shared-bank grouping had to be rebuilt hours later (skew, then chaining)
*2026-08-20 · DECISIONS-2026-08-20.md · Shared-bank grouping rebuilt after skew problems*

**What was wrong.** The morning's `shared_bank_groups` view hashed each
character's WHOLE SharedBank row-set and grouped exact matches. It grouped
almost nothing, and the guild lead caught it the same evening: *"Fairly certain that
these are duplicates for the shared bank bits of 1 or 3 items"* — ten
characters each reporting `SharedBank6-Slot9 = Words of the Spectre ×3`, one
physical stack counted ten times. Root cause: an inventory file is written
whenever THAT character last ran `/outputfile inventory`, so one account's
snapshots sit minutes-to-hours apart and drift (measured: 107 / 104 / 108 rows
on one account). Whole-bank identity is therefore the EXCEPTION, not the rule —
the "transient split" caveat I wrote into the migration was in fact the normal
case. My error, and the doc said the feature worked.

**What replaced it** (`web/lib/sharedBank.ts`, web 1.1.83): cluster on the
SLOT ADDRESS, which is account-scoped and stable. Two characters are the same
account when their slot→item maps agree, scored **Jaccard over the union** of
both banks. Runs over rows `/me/inventory` already loads — no view, no extra
query. The view is dropped (a brittle view that still looks authoritative is
how the next reader gets a confidently wrong answer).

**Why Jaccard and not overlap.** Scoring agreement over the OVERLAP alone let a
small bank "fully agree" with a big one it is merely a subset of, and union-find
chained those weak links into a 29-character and a 17-character "account".
Over the union a 20-slot mule bank scores 20/108 against a 108-slot bank and
stays separate, while two snapshots of the same bank score 0.99.

**The account model, from the guild lead (this is the authoritative version).** A game
account holds **at most 8 characters**. One person can own **~10 game accounts
under one forum account**, so "same owner" and "same account" are different
questions — ownership is answered by the Discord/OpenDKP family, and this
grouping answers only "same shared bank". Characters move between a person's
accounts with **`#charactertransfer <account name>`**, so account membership
is not stable and the grouping must re-derive itself from fresh uploads rather
than be curated (it does — a transferred character carries the new account's
bank on its next export).

**Two wrong caps before the right one, worth recording.** I first capped
clusters at 8 "because EQ accounts hold 8 characters" — correct number,
asserted without checking. Then a measured 10-character cluster made me
conclude the cap was invented and raise it to 16 — wrong conclusion from real
data: 8 IS the rule, and the 10-cluster was an over-merge. The lesson is not
"don't guess" alone; it is **when measurement contradicts a rule, suspect the
measurement's interpretation too** — here the extra two characters
(a member, a member) were transfers to a second account still carrying a stale
near-copy of the first account's bank.

**Final shape.** Cap is 8 (the server rule). A cluster that comes out larger is
re-clustered at progressively stricter thresholds and split at the FIRST one
that fits, so it breaks at the natural gap instead of shattering. Measured on
the real case: the true account agrees at ≥0.9907 internally, the two
transferred characters at 0.9714 with each other and ≤0.9533 with the account —
so 0.96 separates them into 8 + 2, both plausible accounts. Only a group that
survives every threshold is left un-deduped and logged.

## 2026-08-20/9 — Character filing moves to the MEMBER; traders stop needing a class (the guild lead)
*2026-08-20 · DECISIONS-2026-08-20.md · Members file their own characters; traders classless*

**The call.** *"I need a way for the end user that we suspect these are a part
of to tell us about these users."* Plus the blocker: *"For all of the ones that
uploaded from my files, they are primarily traders and I can't easily make them
traders because of the class requirement."*

**Why officers couldn't do this.** ~110 characters upload from members' machines
with no `characters.discord_id`. An officer cannot classify them — they don't
know whose a member is whose — and the one button that fit (Trader) was
disabled until a class was picked, for a bank mule `/who` has never seen. So
the queue only grew.

**The ownership signal already existed.** The agent authenticates as its owner,
so `agent_upload_stats.uploaded_by_discord_id` says whose machine a character
uploads from — the same first-party signal the web mule-upload already trusts
(`claimVerdict`: unclaimed → yours, someone else's → refuse). `/me` now lists
those characters and their owner files each: **Trader** (one click, no class,
never OpenDKP), **Raid alt** (class + level, through the same
`opendkp_register_requests` queue officers use), **Not mine** (`link_ignored`).
Both surfaces refuse anything your agent never uploaded or that someone else
owns. Filed traders link to the family root, so their inventories join
`/me/inventory` immediately (shared-bank dedup from earlier today applies).

**The raid-alt ladder is DATA, not a number** (`web/lib/characterRoles.ts`,
tested): 46 Classic / 50 Kunark / 55 Velious / 60 Luclin. We never answer
"is this a raid alt" yes/no — we answer WHICH ERAS, because a L50 alt genuinely
raids Classic + Kunark and genuinely cannot raid Velious. Only "below 46, no
era at all" hard-stops OpenDKP registration, and it points at Trader rather
than scolding. Trader placeholders are fixed: level 1, Human, class Unknown.

**Bot fix riding along (3.1.63).** The register queue only stamped
`discord_id`/`rank` on a local-only rank when a family root ALSO resolved — so
a trader whose owner had no OpenDKP family was filed and came back unlinked,
reappearing in the review queue forever. Ownership is now stamped
unconditionally; the parent link is a bonus.

**Two tests earned their keep in review**: the db-read-discipline ratchet
caught a new `.limit(2000)` (PostgREST silently caps at 1000 — switched to the
shared paginator), and the roles test caught `Number(null) === 0` rendering an
unknown level as the nonsense "L0".

## 2026-08-25/2 — Per-class spell levels: `spell_level_seed.level` is the MINIMUM, not the truth
*2026-08-25 · DECISIONS-2026-08-25.md · Seeded spell level is minimum, not truth*

> Lacunanight, following his own catch: "Spell: Petrifying Earth is a Cleric 64
> spell but get it under Ethereal parchment (61-62) spells. Cleric turn in
> quest. … So is the quarm DB incorrect or was it adjusted to give some spells
> at lesser parchments. Who knows."

Neither. The Quarm DB is right, and it wasn't adjusted — **two errors of ours
stacked into one confusing display**, and he'd caught the first one an hour
earlier:

1. **The "(61-62)" label was our own inference**, deleted the same night
   (20260825030000). Vicar Ceraen's Ethereal list genuinely holds Petrifying
   Earth and Pacification. Verified: our cleric pools match his PQDI page
   exactly, 25/25 spells across all three tiers (13/7/5).
2. **The level we showed for Petrifying Earth — 62 — was the NECROMANCER's.**
   `spell_level_seed` stores one integer per spell, and the 2026-07-08 PQDI
   scrape stored the **minimum across all classes**, keeping per-class truth
   only in a free-text `note` ("Cleric 64, Shaman 64, Necromancer 62").
   Verified across all 308 seeds: `level` = min(note levels) in every row.

**Measured blast radius:** 355 class rows over 308 spells; **19 rows (15
spells) show a level wrong for that class**. Worst is 25 levels — Shadow Sight
displays necro 24 to a shadow knight whose level is 49. Infusion of Spirit
shows a beastlord 49 when theirs is 61. This affected every surface reading a
level, not just PoP.

**The fix** (20260825050000): promote the note to a real relation,
`spell_class_levels` (spell_id, class_name, class_key, level), and have
`pop_spell_needs` v3 return `COALESCE(class level, seed minimum)`. The note is
machine-readable and parsed cleanly — 308/308 seeds, 355 rows, 11 class
tokens, all valid class names, zero unknown tokens.

**Guarded because the failure mode is silent.** A regex that stops matching
doesn't error — it drops per-class levels and restores the old wrongness.
`spell_class_levels_parse_ok` is the health view; `test/spell-class-levels.test.js`
extracts the regex FROM the shipped migration and runs it against real notes.
Mutation-checked: narrowing the class pattern to exclude spaces kills two
tests (Shadow Knight).

**The deeper lesson, worth stating.** Both bugs were the same shape: a
single value standing in for a per-class fact — one level for all classes, one
level band for all pools. This platform's spell data is inherently
per-(spell, class), and any future collapse of that will be wrong the same way.

**Still open:** other consumers of `spell_level_seed.level` (character spell
pages, `character_missing_spells`) have the same substitution and should move
to `spell_class_levels` — those pages know the character's class, so the join
is available. Not done tonight (minimal diff); queued in STATUS.

## 2026-08-25/3 — …and the same bug twice more in `character_missing_spells` (the pages he's reading next)
*2026-08-25 · DECISIONS-2026-08-25.md · Same spell-level bug in missing-spells data*

Followed the queued item to the character spell pages before Lacunanight got
there. Same root cause, two more instances, and **the worse one was not the
seed**:

```
scribe_level := coalesce(l.lvl, sd.level)
```

- **`l.lvl` was `min(spell_level)` over `character_spellbook` grouped by SPELL
  NAME ONLY** — a guild-wide minimum across every class, and it takes
  precedence, so it was the value actually shown. Live proof: three
  necromancers hold Shadow Sight at 24, one shadow knight holds it at 49 → the
  function returned **24 to every shadow knight**.
- `sd.level` is the seed minimum (fixed in 20260825050000).

**The spellbook data was never wrong** — necro 24 / SK 49 matches the PQDI
note exactly. Only the `GROUP BY` threw the class away. So group by
(spell, class) and prefer the observed same-class level: it comes from a real
Quarm spellbook export, which outranks a pqdi.cc scrape wherever the two could
disagree (relevant given the open Quarm-fork question above).

Resolution order, most to least authoritative:
1. observed level from a **same-class** spellbook (live Quarm truth)
2. `spell_class_levels` — the class's level from the PQDI note
3. `spell_level_seed.level` — the cross-class minimum, last resort

**Bards, again.** `i.name like 'Spell: %'` matched exactly **1** bard-flagged
item; their scrolls are `'Song: %'`, of which there are **107**. So a bard's
missing-spell page was effectively empty and had been since the function
shipped. Same omission `pop_spell_needs` had — worth noting the filter was
copied between them, which is how one wrong assumption became three.

Verified after: SK Shadow Sight now 49; bards return 42–60 missing rows.
Function signature unchanged, so no web change — the pages just get correct
numbers.

---

## §450 — Faction standing: bound it from cons + tracked hits, and account for temporary bonuses (future, 2026-10-27)
*2026-09-21 · DECISIONS-2026-09-21.md · Faction standing bounded from cons and hits*

Asked how far into Amiable a character is with Frogloks of Guk, the answer came from our own data: Amiable is 100-499
(`common/faction.cpp:70`, EQMacEmu @ 11024c19); a Guk froglok conned the character amiably BEFORE the first tracked hit, the
165 tracked hits since were all +1 (catalog-priced where the kill was named), and a tad still cons amiably today, so the value
is 265-499. The guild lead: *"we should in the future look at these sorts of faction interactions, but also account for the
faction granted from illusions and Ornate Velium Pendant and other faction songs or spells"*. What the server does
(EQMacEmu @ 11024c19):
- **The con value** is personal faction + spell bonus + item bonus + base + class / race / deity mods
  (`zone/client.cpp:5250-5254`). `GetFactionData` takes the illusion into account (texture, gender, base race), unless the
  faction sees through illusions (`eqemu_faction_list_full.see_illusion`).
- **Spell bonus:** SPA 19 (SE_AddFaction) on an NPC gives the CASTER a bonus with that NPC's primary faction, and replaces any
  earlier one (`zone/spell_effects.cpp:541-555`: `ClearFactionBonuses` then `AddFactionBonus`). The Ornate Velium Pendant
  (items 30294 / 30297) clicks Alliance (spell 298: SPA 19, +100, single target, "You feel quite amicable.").
- **Item bonus:** worn items with FactionMod / FactionAmt (`zone/bonuses.cpp:316-327`).
- **Gains are multiplied** by Quarm's XP-potion buff (`spellbonuses.FactionBonus`, `zone/client.cpp:5356-5361`), so a catalog
  value is a floor, not the hit.
- So a con is only an exact bound when no illusion, no SPA 19 bonus and no faction item applied at that moment. A future
  faction view should: read the illusion and Alliance-type buffs at con time (the agent sees buff landings / fades and Zeal's
  buff list), discount cons taken under them, list worn faction items, and widen the range when a potion was up. Not built.

## §5 — Faction page, time-bound — and the aggregate that made it impossible (2026-09-22)
*2026-09-22 · DECISIONS-2026-09-21.md · Faction page time-bound needs event data*

The guild lead: *"I'm working on my faction and I think it would be worthwhile to
have this data be timebound for how recently these hits have come in. Show last
N days worth."*

**It could not be answered as asked.** `faction_standing` is running counters
only (`better_count` / `worse_count` / `better_total` / `worse_total` +
`first_hit_at` / `last_hit_at`), written by the additive `bump_faction_standing`
RPC. No per-hit table existed anywhere — `faction_cons` is latest-standing-per-mob,
not a log. So **749,753 hits across 179 characters existed purely as numbers**,
and no window could be computed from them at any price.

⚠ **The events were reaching the bot the whole time.** `_handleAgentFaction`
loops over them with `kind` / `faction` / `mob` / `ts`, resolves the point value
from the line's magnitude or the catalog, aggregates — and dropped the detail.
Capturing it was one extra row, not a rebuild.

**Both halves shipped together, deliberately:**
- **`faction_hits`** (migration `20260922200000`, applied live + committed
  identical): one row per event. ⚠ Carries a unique index and inserts with
  ignore-duplicates, because **re-running a backfill is the documented way to
  enrich history** and the aggregate path has no such defence (a second pass
  inflates the counters). That same property is what makes the lost history
  recoverable: the database cannot rebuild it, but a `--since` backfill over the
  raiders' own logs replays the identical lines.
- **A recency filter** on `/character/<name>/factions` — 7 / 30 / 90 days,
  filtering *which factions are listed* by `last_hit_at`. "Any time" stays the
  default so nobody's page changes unasked.

⚠ **The filter states in the UI that the totals are still all-time.** A window
that silently showed lifetime numbers under a "last 7 days" heading would be
worse than no window — and that caveat is precisely why the capture had to ship
alongside rather than after.

**Sizing** (database size being the metered thing that only grows): 851 hits/day
measured guild-wide → ~310k rows and tens of MB a year, two orders of magnitude
under `encounter_threat_snapshots`. **No sweep yet**, and the `ts`-leading index
is already there so one will actually work when it is wanted — which is more
than that table ever had.

## §12 — PQDI links, and recipes + quests on the item page (2026-09-24)
*2026-09-24 · DECISIONS-2026-09-21.md · Fix item links; add recipes, quests*

**The report** (a member, relayed by the guild lead): clicking an item on the
inventory pages *"don't ever load — https://pqdi.cc/item/11594 for example.
Our pages don't have tradeskill recipes or quests listed."*

**Links — FIXED on `main`, web 1.8.2.** PQDI answers only on `www.pqdi.cc`; the
bare host resets the connection. Four links used it (`/me/inventory`, the
inventory hover card ×2, `/admin/spells`). The hover card's no-id fallback went
to `pqdi.cc/search?term=`, which PQDI never served — its search is a POST with a
CSRF token, so no GET link can exist; it now searches our `/search`.
`test/pqdi-links.test.js` fails on either shape anywhere in `web/`.

**Quests — the data was the gap, not the page.** `/db/item` already had a
"Quest turn-ins" section, but it reads `scripted_npc_turnins`, parsed from the
**ProjectEQ** scripts and only for branches whose reward is a literal. That
drops every script that computes its reward (Orc Scalp → Captain Ashlan in
Highpass: PQDI has it, we had nothing) and the `count_handed_item` form (most
Bone Chips quests). New RPC `quest_scripts_for_item` reads **Quarm's own**
mirrored scripts (`eqemu_quest_scripts`, via its trigram index — 2–30 ms) and
classifies each hit as component / reward. Checked against PQDI's quest tab on
three items: identical NPC lists, plus two PQDI omits (an alternate-zone copy,
an event script). A bare number match is dropped — item and NPC ids share a
number space.

**Recipes — new RPC `item_recipes`** over the tradeskill mirror (7,448 recipes).
Four roles per recipe: made · used · **tool** (consumed and returned — the
Smithy Hammer is in 777 recipes and comes back from 772; without the split every
one read as "makes a Smithy Hammer") · container (a portable kit). Skill and
world-container labels are read off the EQMacEmu source (`skills.h`,
`item_data.h` `BagTypes`), and PQDI's recipe pages agree wherever they name one.
New page `/db/recipe/<id>`: components, container, tools, results, what a failure
keeps.

**UI on `beta` as two layouts** (`b.wolfpack.quest/db/item/<id>?v=b` / `?v=c`;
no `?v=` is production's page). Both carry the new Quests section; they differ
only in Tradeskills:
- **B · Inline** — each recipe on one line with its whole combine (components →
  result, container, skill + trivial); this item in gold. First 25 recipes get
  the combine, the rest a name list. Build S · maintenance S · runtime: parts for
  25 recipes (~10 KB) · change M (the row is coupled to the recipe shape).
- **C · Grouped** — PQDI's shape: Made by / Used in, split by tradeskill, recipe
  names as chips with the trivial; groups start closed past 40 recipes. Build S ·
  maintenance S · runtime: names only (Water Flask's 744 ≈ 40 KB, collapsed) ·
  change S. Ingredients are one click away on `/db/recipe`.
Migrations landed on `main` and are applied (both functions only read the
mirrors). The recipe page is beta-only until a layout is picked.

## §48 — The alliance gate in front of /who (2026-09-26)
*2026-09-26 · DECISIONS-2026-09-21.md · Alliance gate before sharing who observations*

**The guild lead:** *"I mentioned an alliance gate in front of the /who overlay and page. we
shouldnt just give away our secret weapon. admins can choose to submit who observations, but end
users should ultimately decide on if their characters are linked outside of the guild"*.

**The policy.** It extends §8.6–§8.7 of `DECISIONS-2026-09-18.md`, which covered other guilds'
own deployments, to our own site.
- **The secret weapon stays ours.** That means /who history that fills in anonymous players, the
  Zek flags built from it, and which character is whose alt. Members get it; nobody else gets it
  by default.
- **Allies get in only through an alliance grant**, issued by our officers to an allied guild.
  What a grant shows is limited: what the game itself shows in /who, and no filling-in of
  anonymous players from our history.
- **Guild-level: admins choose whether their guild submits /who observations** to what the
  alliance can see. Off until an admin turns it on.
- **Person-level: each player decides whether their characters are linked outside the guild.**
  That is a switch on /me, off by default, and never an officer's or a guild's choice for them.
  An ally sees a main/alt link only for characters whose owner turned it on.

**Done now (bot 3.1.153):** the Discord `/who`, `/whois` and `/whoall` lookups, their autocomplete
and the Show Family button answer members only (`isGuildMember()` in `utils/roles.js`). Anyone
else gets one line saying the lookup is for members.
`test/who-commands-members-only.test.js`: four deliberate breaks, all caught. The first
autocomplete test passed with its gate removed, because the test roster was empty; it now fails if
the command reads anything before refusing.

**Build order, the rest waiting on the guild lead:**
1. **The member gate on the /who page, its database tables and the Mimic /who lookup**, so every
   /who surface checks membership at the moment of use, not just at sign-in. This is part of the
   membership fix already planned (private briefing), and waits on the guild lead's fix order.
2. **The ally tier:** the alliance grant, the guild-level submit switch, and the per-person link
   switch on /me.

Private specifics (how each surface was reachable) are in the private briefing, not here.

## §67 — Missing spells: vendor names link, 📍 copies `/map Y X` (2026-09-28, web 1.8.32)
*2026-09-28 · DECISIONS-2026-09-21.md · Missing spells vendors link with map copy*

The guild lead, on the Shopping list: *"This page needs to have the people be links and a map icon next
to each with a copy with /map <y><x>"*.
- **Every vendor and dropper name links to its NPC page** (`/db/npc/<id>`: every spawn point, loot,
  faction), in both the By-level dropdowns and the Shopping list.
- **Each vendor gets a 📍 button** that copies `/map Y X` for that zone, Y first, the same order as the
  checklist (§65a). The point comes from `eqemu_spawnentry` → `eqemu_spawn2`, one per vendor per zone,
  lowest spawn id first.
- **Droppers get the link, not a 📍.** Across every spell scroll no vendor has more than 3 spawn points
  (463 in all), while a dropper can have 119; one point for a roaming mob would send people to the
  wrong place. Its NPC page lists them all.
- **Found on the way:** the boss guide (`/guide/[bossId]`) asks PostgREST to embed `eqemu_spawn2` from
  `eqemu_spawnentry`. The two tables share `spawngroup_id` but have no key between them, so the call
  fails (PGRST200) and no boss guide shows a spawn point. Filed as a separate task; not changed here.
- The copy button moved to `web/components/CopyChip.tsx`, shared by the checklist and this page.

## §104 — FB-37 reviewed: XP / AA per hour by zone, group composition, the best groups (2026-09-29)
*2026-09-29 · DECISIONS-2026-09-21.md · XP and AA per hour review*

A member asked for XP per hour by zone, and for "best solo / best group XP per hour this week", in total XP
not percent and per five levels. The guild lead added AA/hr, group composition and *"i see the number 1
groups is doing X mob, i could do the number 2 grouping which is Y mobs"*. **Review only; the options wait
on a pick** (`docs/DESIGN-xp-tracking.md`).
- **Nothing about XP reaches the server today.** Zeal's XP/AA bars and the agent's own per-hour rate stay on
  the machine. Experience lines are not parsed. Group membership and zone have no history.
- **Total XP is exact, not estimated.** TAKP's `GetEXPForLevel` is (L−1)³ × 10 × race × a level band. So
  the change in (level, %) plus the race from `/who` gives total XP per kill. Verify the band table and
  Quarm's AA-per-point rule, and measure label 26's resolution for an evening, before building.
- **Options** (four costs each in the design doc):
  - A: local only (your own XP/AA per hour and total XP per zone, as pieces);
  - B: a guild XP board (agent upload of one event per experience line, `xp_events`, a `/xp` page with
    per-bracket solo and group tables, compositions and top mobs);
  - C: B plus a live "best XP right now" piece.
- **Recommendation:** A, then B.
- **Questions:** retention (7 or 30 days), names (guild by name, others by class), and whether raid XP counts.

## §140 — Traders and characters under 46 leave the character lists (2026-10-03, agent 3.7.73 beta · migration `20261003120000`)
*2026-10-03 · DECISIONS-2026-09-21.md · Traders and low levels leave character lists*

The guild lead: *"low level characters do not need to show up on the pop flag page. all of my traders and
mule characters destroy my views anywhere we display all of our logs."*

- **The rule (`web/lib/listableChars.ts`):** a character is left out when its guild rank is Trader, or its
  level is KNOWN and under 46 (the lowest PoP zone-in level). A non-trader nobody has a level for stays
  listed: hiding a raider because nobody /who'd them is the worse mistake. Level is the higher of /who
  history and the highest scribed spell (`me_levels`).
- **Where (beta):** [b.wolfpack.quest/pop?view=mine](https://b.wolfpack.quest/pop?view=mine) (My Characters,
  your spells needed, the spellbook picker, sightings, and the spell-needs table), with "Show all (N
  hidden)" (`?all=1`); [b.wolfpack.quest/pop/guide](https://b.wolfpack.quest/pop/guide) (character picker);
  [b.wolfpack.quest/me](https://b.wolfpack.quest/me) (they move into the existing collapsed "more" sections,
  nothing removed); the Mimic dashboard's Watched characters and Replay log picker ("show N low-level").
- **Not filtered, on purpose:** `/me/inventory`, `/quartermaster`, mule uploads (a mule's bags are the point
  there), and the dashboard's Watched Logs diagnostic. `/me/ui` is left as it was; say if it should follow.
- On today's data the rule hides 52 of 556 characters: 36 traders and 16 others under 46.
- The dashboard knows levels but not ranks, so a trader with no known level still shows there.
- **`me_levels` sped up** (migration `20261003120000`, applied): it matched names with `ilike any()`, a full
  scan (7 s for 170 names); `lower(name) = any()` uses the existing indexes (53 ms), same rows. `/me` gets
  the same speed-up.

## §143 — Hide from lists; no-known-level characters folded; the spellbook upload fixed (2026-10-03, web 1.8.83–1.8.84 · bot 3.1.193 · agent 3.7.75 beta · migration `20261003170000`)
*2026-10-03 · DECISIONS-2026-09-21.md · Hide characters from lists, spellbook upload*

The guild lead: *"spellbook upload is screwing up the upload. put any unknown characters into a minimized area
and make it so I can hide these characters from anything but account inventory"*, then, with a phone screenshot
of b.wolfpack.quest/pop: *"clarification on breaking the page"*.

- **The page break (live, web 1.8.83):** the "Submit a spellbook for [character] [Upload spellbook]" row on
  /pop sat in a box told never to shrink, so on a phone it ran past the card and the whole page scrolled
  sideways. It wraps now. Production had the same bug.
- **A second upload bug found on the way (live, web 1.8.84):** the upload accepted a character only if its own
  Discord link matched yours. Alts often have none, so 11 alts linked through their main were refused with "not
  your character". It now falls back to the main, the rule the /me switches already used.
- **Hide from lists (beta):** a new switch per character on [b.wolfpack.quest/me](https://b.wolfpack.quest/me),
  "Hide from lists". A hidden character leaves every character list — /pop, the PoP guide, /me's main list,
  Mimic's Watched characters and Replay picker — and still shows in account inventory, the quartermaster and
  every upload. /me keeps them in a closed "Hidden by you" section with Unhide. Column
  `characters.hidden_from_lists` (applied); display only, it stops nothing being collected. The bot passes it to
  Mimic with the other character prefs (3.1.193).
- **No known level → minimized (beta):** characters nobody has a level for are no longer listed with the rest;
  they fold into a closed "N characters with no known level — upload a spellbook or get them seen in /who"
  section (/pop, /me, Mimic) or a "No known level" group at the bottom of a picker (/pop/guide).
- **The spellbook picker keeps everyone**, grouped: your listed characters, then "No known level", then
  "Hidden". A spellbook upload is how an unknown character gets a level, so the filter must never block one.
- Not changed: who may flip the switch is the owner (or the owner's main's account) only, like the other /me
  switches; officers have no bypass there.

## §175 — Main / alt · Inventory only · Hide completely: one choice per character, set in Mimic, the same on the website (2026-10-07, bot 3.1.214 · agent 3.7.96 beta)
*2026-10-07 · DECISIONS-2026-09-21.md · Per-character main, inventory-only, hidden choice*

The guild lead, after "where do i set these characters to inventory only?": *"the complete hide or hide from all but
inventory should be with mimic during onboarding but the denotation on other side should be carried over."*

- **One store, no copy.** The three switches on `wolfpack.quest/me` (`characters.hidden_from_lists`,
  `exclude_from_stats`, `exclude_inventory`) stay the truth. Mimic asks ONE question per character and writes the
  same three columns, so the two sides cannot drift:
  - **Main / alt**: all three off.
  - **Inventory only**: hidden from lists only. The character is kept for the account inventory, left out of
    every list and chart, and still uploads.
  - **Hide completely**: all three on, and this PC stops reading that character's log.
  - Any other mix (the website's switches can make one) shows as "set differently on wolfpack.quest", and Mimic
    never writes one.
- **Bot** (3.1.214, live): `POST /api/agent/character-prefs {character, mode}` and `GET ?mine=1` (the person's whole
  family with its flags). The person is the Mimic session's own Discord id; a character counts as theirs by
  `owned_character_names()` (`20261007010000_owned_character_names.sql`, the same family rule as My parses). Not
  yours or not linked → 403.
- **Mimic** (agent 3.7.96, beta):
  - The setup walkthrough's Send tick became "Show as", with the three choices per character. Each row starts on
    what wolfpack.quest already says.
  - The dashboard's Me card has the same control under "How each character shows", for any time after setup.
    That list includes characters whose log this PC no longer reads, so a hidden one can be brought back.
  - **Hide completely reuses the existing don't-transmit list** (`excludedCharacters`, the "Transmit?" step's own
    list), so "stops reading the log" is the same gate it always was. The engine restarts once when the list
    changes.
- **Signed out, or an older bot:** the choice is saved on this PC and says so. An unsaved "Hide" still takes effect
  at once. An unsaved un-hide does not: privacy only ratchets one way until the website has heard it.
- **Open (the guild lead's call):** should Inventory only also stop uploading that character's fights? Today it
  keeps them (it is a display switch, as on the website).

## §201 — Owned songs listed as missing (FB-67) and the inverted NO DROP tag (2026-10-08, web 1.8.123 · bot 3.1.227 · migrations 20261008200000 + 20261008210000, applied)
*2026-10-08 · DECISIONS-2026-09-21.md · Owned songs wrongly listed missing*

**FB-67** (a member): the shopping list showed songs the character already owns, Kazumi's Preservation and
Angstlich's Assonance. **Confirmed on production bytes**, not guessed: the spellbook says `Angstlich's Assonance`
(apostrophe), the scroll item says `Song: Angstlich`s Assonance` (backtick), `Song: Angstlichs Appalling Screech` has no
quote, and `Song: Kazumi`s Preservation` teaches the spell `Kazumi's Note of Preservation` (a different name). The
function compared `lower(name)` equality, and bards only met it now because 20260825060000 first added `Song:` scrolls.
- **Where it landed:** `spell_name_key(text)` (lower-case letters and digits only) on both sides, plus
  `spell_scroll_aliases` for the 24 scrolls whose item name is not the spell's name (only the unambiguous ones: a
  dropped word, a one-letter misspelling in the mirror, a reordering; the rest are left alone rather than guessed).
  Display names and the signature are unchanged. A bard who owns three of the reported songs went from 27 missing to 6;
  the other 21 were the same bug, not real gaps.
- **Not done:** `pop_spell_needs`, `guild_held_spell_needs` and `pop_extra_scrolls` use the same name equality, and
  take `substring(name from 8)` after "Spell: ", which would cut a `Song: ` name's first letter. Queued, separate.
**NO DROP tag backwards** (the guild lead, on the new loot page: *"All of these ND items are not actually no drop"*).
`eqemu_items.nodrop` is INVERTED on this mirror (false = NO DROP), which the repo already knew in four other places;
the loot code passed it through raw, so Diamonds were tagged ND and real NO DROP items were not. `loot_value_rows` and the
bot's Loot tab (`utils/lootValue.js`) now return plain polarity (true = NO DROP). The "about 90% of looted items are
NO DROP" figure noted while building it was this same inversion.
**FB-68 (resisted clicky should use a charge) is not what the code does**: the counter spends a charge on the
"begins to glow" line, before any resist, so a resisted click is already counted. The likeliest cause is a click that
printed no matching glow line. Waiting on a raw log excerpt from the member before changing anything.

## §261 — Faction maths for the Map and the faction page (2026-10-13, bot 3.1.254 `12b7e20d`, agent 3.7.146 beta `546f20df`, web 1.8.145 beta `ca336d28`)
*2026-10-13 · DECISIONS-2026-09-21.md · Faction maths for map colours and faction page*

- **The ask** (the guild lead): Plane of Tranquility's mobs are indifferent to everyone, so green. Plane of Valor gives
  every player race +1000 on a -1000 base, so a NON-player illusion (no race mod) makes them scowl: *"If someone has a
  non-player illusion on it should switch them to red immediately."* And on the faction page: modifiers by name and
  grouped, your characters' default and current standing, raise / lower lists, and faction colours (*"never KOS by
  default ... green, the ones that can be KOS by default could be orange, the ones that are always KOS should be
  red"*).
- **The maths** (one module, three copies kept in step by tests: `utils/factionCon.js`, `web/lib/factionCon.ts`, the
  Map's own): default value = base + race mod + class mod + deity mod (`eqemu_faction_list_mod` `r<id>/c<id>/d<id>`),
  held to the caps only when a cap is set (0/0 = no cap). Con tiers are EQEmu's `CalculateFaction` bands (ally 1100,
  warmly 750, kindly 500, amiably 100, indifferent 0, apprehensive -100, dubious -700, threatening -999, else scowls).
  **KOS = below -700** (threatening attacks on a roll, scowls always). Never / some / always KOS = the range over all
  14 player races x 15 classes x 17 deities.
- **Map:** the bot sends each NPC's primary faction (`pf`) and the zone's factions; the agent sends who you are
  (class and deity from Zeal labels 3 and 4, race from a /who of you or your last Quarmy export, an illusion from your
  buffs). Order: an illusion the faction does not see through wins (even over an older con); else your con (it
  includes earned faction); else the maths for you, an unknown dimension spreading over every player choice. Red when
  you are or could be KOS; green when the faction is never KOS to anyone; else yellow.
- **Website:** https://b.wolfpack.quest/db/faction/1655?v=b on beta, the default view untouched until a pick.
- **Not done:** the Map knows your race only from a /who of yourself or a Quarmy export; Zeal sends no race. An
  illusion we do not name counts as no race at all. Faction-coloured links elsewhere on the site (the one internal link
  is on /db/npc) wait for the pick.

## §271 — Characters belong to game accounts: login name if we can read it, shared-bank guess otherwise, the owner's word first (2026-10-13)
*2026-10-13 · DECISIONS-2026-09-21.md · Characters grouped into game accounts*

- **The call** (the guild lead): *"C if available, B otherwise. We could let users screenshot their account character
  inventories and paste them, or drag and drop between accounts to start. We could allow users to use alternate names
  for accounts, or just call them account 1 through 10."*
- **Server rules** (the guild lead): a forum account holds up to 10 game logins; a game login holds up to 8
  characters; `#charactertransfer` moves a character only between game logins on the same forum account, and only
  into one with space. The command shows on neither the Zeal pipe nor (as far as anyone has captured) the EQ log, so
  a transfer is seen indirectly: the character's shared bank starts matching another account, or its login changes.
- **Order of evidence:** the owner's placement (drag and drop on `/me/accounts`) beats everything; then the login
  account (option C, once a local session confirms where the client keeps it and the guild lead clears sending a
  salted hash of it, never the name); then the shared-bank guess (option B). Accounts are "Account 1" … "Account
  10" unless the owner names one.
- **Data:** `game_accounts` + `character_accounts` (membership rows with `valid_from` / `valid_to`; a move closes the
  old row and opens a new one, so a transfer keeps its history). Service-role only. **The mapping never goes in the
  repo**: the guild lead removed the old alt list from docs on purpose (2026-09-16).
- **Purpose:** `/me/inventory` counts a shared-bank slot once per account instead of once per character (the guild
  lead's Shield of the Water Dragon screenshot: three characters, one bank, counted three times). The cause on that
  screenshot was the old single-link 0.75 match splitting a group whose snapshots were weeks apart (0.84 / 0.73 /
  0.64 pairwise).
- **Later, not now:** paste a character-select screenshot to fill an account.

## §290 — A mob's swing speed, stats and look are in the mirror (2026-10-14)
*2026-10-14 · DECISIONS-2026-09-21.md · Mob attack speed and stats in mirror*

- **The ask (the guild lead):** *"mob attack speed is in the data on PQDI. I presume we have all of the info for
  each mob in the database, including model and what it [looks like]"*. We had race, gender, texture and size,
  but not the rest: `scripts/sync-from-eqmac.js` picks upstream columns by name and never named them.
- **What landed:** migration `20261014040000_npc_types_combat_and_look` (applied to production via MCP; the same
  file is committed) adds 35 columns to `eqemu_npc_types`: `attack_delay` (tenths of a second per round), the
  seven stats (`_INT` is stored as `int_stat`), `atk`, `accuracy`, `avoidance`, `slow_mitigation`, the regen
  rates, `see_sneak`, `npc_aggro`, and the look (helm, face, armour textures, tint, held-weapon models, light).
  The sync picks them up, and `test/sync-npc-sheet-columns.test.js` guards both ways a column goes silently
  missing. A dump without a column leaves it null; it never nulls a stored value.
- **Verified:** the forced sync (run 38502496697, `force=true`, because the unchanged dump sha would otherwise
  skip) filled all 18,033 rows. Grummus reads attack_delay 18 and see_sneak true, which matches PQDI.
- **Read off it for tonight:** Mujaki swings every 1.0 s, the fastest of the night. Prototypes IX and XI and
  Terris Thule have slow_mitigation 75, so a quarter of a slow lands. This closes the §173 question of whether
  `slow_mitigation` goes in the mirror. Nothing reads the new columns yet: Target Info and the mob-info route
  are the next consumers.
- **Self-host note:** additive columns on a table that is already mirrored; no storage cost worth a §3 line.

## §446 — Gear upgrades: wishlist + pre-bid, paired slots, quest and tradeskill items, cap-aware scoring, icons (2026-10-26)
*2026-10-26 · DECISIONS-2026-09-21.md · Gear upgrades: sources, paired slots, scoring*

The guild lead, on https://wolfpack.quest/me/upgrades, in order:
- *"add in 'add to wishlist' ... so people get those on their list to add a pre-bid amount"*: per-row add, with priority
  and an optional pre-bid. The bid is encrypted by the bot (the key never reaches the website). Drafting.
- *"put wrists and ears together ... since they're interchangeable"*: Ear, Wrist (and Fingers, my addition, easy to
  drop) shown as pairs; `WORN_SLOTS` order is left alone for its other users. Drafting with the wishlist change.
- Comparing against another tool's chest list (*"very different interpretations"*): ours ranks gain over the worn item
  and only knows drops and vendors. *"yes we should have quest and tradeskill items in as well"*: sources from our own
  `eqemu_tradeskill_recipe*`, `eqemu_quest_scripts` / `quest_catalog`, never a guide.
- *"we should be evaluating how close this gets you to maximums on stats, attack, flowing thought, AC, etc. and
  priorities in between"*: cap-aware scoring. Caps from the EQMacEmu source and rules, the character's real totals from
  its worn gear where we can, class weights between.
- *"it would also be a good thing to roll into the gear page, but we need icons in our site"*: the same evaluation on
  `/character/<name>/gear`, and item icons (the atlas `web/public/icons/items.png` + `web/components/ItemIcon.tsx`
  exist, used only by the inventory page today) on both pages.
- Research first (caps, totals, quest-reward parsing, why each of the ten chest items is missing), then one build on
  top of the wishlist change. Existing pages, so all of it goes to beta first.

## §448~2 — Gear finder: quest and tradeskill sources, cap-aware scoring, icons, the gear page's upgrade check (2026-10-26)
*2026-10-26 · DECISIONS-2026-09-21.md · Gear finder quest sources and cap-aware scoring*

The build behind the four asks in §446 (draft `draft/gear-build`, web 2.1.52 for `beta`; not pushed, migration not applied).
- **Sources.** One batch function, `item_alt_sources(int[])` (`supabase/migrations/20261026200000_item_alt_sources.sql`), the batch of
  `quest_scripts_for_item` + `item_recipes`: quest REWARDS only (NPC + zone, instanced copies collapsed) and recipes that MAKE the item
  (quest combines also return components and the bag). Asked only for finalists that have no drop, vendor or bag source. **The page works
  without the migration**: an RPC error is "no alternative sources" and the footnote says so. Era: a quest uses its zone's
  `eqemu_zone.expansion` like a drop; a recipe has no zone, so the item's `required_level` against the level cap is the proxy (it cannot tell
  a PoP-era recipe from a Luclin one when both are level-46 items; with PoP live since 2026-10-01 that only matters for a cap-60 view).
- **Caps are the server's** (`web/lib/gearCaps.ts`, EQMacEmu @ `a3b80b2`, file:line in the header): attributes 255 to 60 then +5 a level
  (280 at 65) plus the AA raise; resists 500; item ATK 250; HP regen 30, level − 30 above 60 (35 at 65; the table said 30); Flowing Thought 15,
  0 for Warrior / Rogue / Monk; AC soft cap per class with 1 / returns past it. **Damage shield's 30 cap was removed**: nothing in the server
  source backs it. Haste stays max-not-stack.
- **AA raises are read, not assumed**: SPA 262 (`SE_RaiseStatCap`) in `eqemu_aa_effects`, base1 per rank into the stat base2 names, joined
  through `eqemu_altadv_vars.skill_id` to the character's `character_aas.aa_index` (= `eqmacid`). In the data today: Planar Power (eqmacid 142,
  skill 418, +5 a rank to all seven attributes, 305 at 65) and Innate Enlightenment (eqmacid 144, skill 426, +10 a rank to WIS and INT for the
  seven casting classes, 355 with both). No AA rows for a character means "+AA unknown", assumed 0.
- **High end / Low end** (the other tool's toggle). Base stats are not in our data, so High end ASSUMES 205 of each attribute before gear
  (`ATTR_ASSUMED_NONGEAR`, 255 minus the 50 a gear set adds) and counts only gear points that fit under the cap; Low end counts them all.
  Default High. A model, labelled on the page, one constant to change. The AA raise widens High end's room (100 points, not 75).
- **AC taper uses item AC only**, so it under-fires (the game caps total mitigation). Monk is 350 as given; the server reads
  `ReducedMonkAC ? 315 : 350` with the rule defaulting on, so if Quarm leaves it on the Monk number is 315 (one constant).
- **Icons**: the atlas is still switched off (wrong art, `ICON_ATLAS_DISABLED`), so `components/ItemIcon` draws nothing. Both pages use
  the inventory page's component, which falls back to PQDI's icon images (the same hotlink the inventory page already makes).
- **Gear page**: the per-slot upgrade check shows only to the character's owner (`ownedCharacters`) and never for an opted-out character,
  because it is the finder's own view; nothing widens who can see a character's gear. Item icons on its Equipped table show to everyone who
  can already see that table.
