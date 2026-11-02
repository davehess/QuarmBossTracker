# Design: a catalog of guild loot systems and raid rules

Status: **catalog started 2026-11-02** (DECISIONS §520). The guild lead, sharing two other guilds' loot channels: *"We should
start building a categorization of the different loot systems and raiding rules that guilds have"*. Why it matters: Raid
Mimic hosts many guilds (`docs/DESIGN-raidmimic-hosted.md`), and the flag exchange puts guests in other guilds' raids
(`docs/DESIGN-flag-exchange.md`), where the host's loot rules apply. A guild should be able to describe its rules once, in
fields Raid Mimic understands, so the tools that run loot (rolls, bids, reserves, attendance) follow them, and a guest sees
them before signing up.

Sources so far: Wolf Pack's own system, and two guilds' published loot channels (seen 2026-11-02; this public file names
neither guild, see the private briefing's Server outreach tab). Add a guild's system as a new column in section 2 rather
than a new document.

## 1. The dimensions every system answers

| # | Question | Values seen |
|---|---|---|
| 1 | **How is an item decided?** | DKP bid (open or sealed) · EPGP priority (EP ÷ GP, highest wins) · roll (one roll per tier) · picks before the raid, rolled among pickers · soft reserve · loot council · all greed (free roll) |
| 2 | **What tiers are there, in order?** | e.g. epic drop (main) > high > medium > low bid (main) > epic drop (alt) > alt loot; or upgrade > replacement (pet kit) > greed; or reservers > everyone |
| 3 | **What does winning cost?** | DKP spent · GP added by tier (0 / 10 / 50 / 100) · nothing (rolls) · a pick used up |
| 4 | **Who may claim?** | main only unless the leader asks for an alt · the character you start the raid on, or another raid-ready one if you tell the leader at the start · level floor (50+) · attendance floor (2 raids in the last 2 months before upgrade or picks; levelling with the guild waives it) · guild tag only on some events · guests may not loot on rot |
| 5 | **How is the currency earned?** | attendance ticks · guild bank donations (listed items) · member-run events with a minimum turnout (12) and a log sent to the raid leader · one-time level and epic bonuses (screenshot proof, main only, earned while in the guild) |
| 6 | **Limits and decay** | EP cap per raid cycle (900) with the excess forfeited · decay per cycle (20% of EP and GP; cycles of 2 weeks, extendable with notice) · no decay under a floor (100 EP / 150 GP) · a large decay every 6 months or before an expansion, set by the raid leader and announced a month ahead |
| 7 | **Special item lists** | once per character set (a main and their alts) for named high-demand items · items excluded from a tier (pet kit) · items with special callouts |
| 8 | **Quest items** | no-drop quest pieces cost GP per piece · droppable quest items go to the guild bank and are handed out on request to whoever has the rest of the quest, first to win their final no-drop piece first · symbol hand-outs only with every required piece shown · keys rolled (mains before alts) |
| 9 | **Spells** | claim during the raid if you are the level and can scribe it now; ties rolled · from the guild bank for mains at level; alts if more than 2 in stock or a guild leader approves |
| 10 | **Ties** | /random, LOWEST wins (two guilds seen) or highest wins (Wolf Pack's roll nights) |
| 11 | **Nobody wants it** | droppable goes to the guild bank to sell · no-drop rots, free for all (a loot-after-rot may still cost GP) |
| 12 | **Per-raid overrides** | a different system declared before a raid (picks; all greed for one zone or for back-to-back runs with an allied guild) · roll right limited to the guild's tag when raiding with another guild · one-off changes posted in the event description |
| 13 | **Honour rules** | no upgrade roll to sell the item (up to removal from the guild) · picks are for the character picked for |
| 14 | **Who owns the rules** | officers may edit wording; rule changes need all officers and an announcement · one officer runs the system and the data |

## 2. The systems seen

| | Wolf Pack | Guild A | Guild B |
|---|---|---|---|
| Kind | DKP (OpenDKP), sealed bids; soft reserve and rolls on some nights | EPGP | Rolls: upgrade, then greed; a pick system on declared raids; all greed allowed for one zone |
| Decided by | highest sealed bid | highest priority rating (EP ÷ GP) at the highest tier bid | roll within the highest tier claimed; picks rolled among pickers |
| Cost | DKP | GP by tier: 0 epic (main) · 100 high · 50 medium · 10 low · 0 epic (alt) · 10 alt loot | none |
| Earn | attendance ticks | attendance, bank donations, member events (12+), level and epic bonuses; cap 900 a cycle | none |
| Decay | per OpenDKP settings | 20% a 2-week cycle, floor 100 EP / 150 GP; a large decay each 6 months or expansion | none |
| Eligibility | members; RA gates set by officers | tagged members earn; main unless asked | 2 raids in 2 months for upgrade or picks (greed open to all); start-of-raid character or a raid-ready 50+ alt announced |
| Pets | none | none | pet-kit upgrade once per item, then replacement priority behind upgrade, ahead of greed |
| Quest / keys / spells | officer call | GP per no-drop piece; bank droppables; keys rolled, lowest wins, mains first; spell rules above | no-drop rolled; droppables to the bank, requested by whoever holds the rest |
| Ties | n/a (bids) | lowest /random | (not stated) |
| Where it lives | OpenDKP + our bot | a spreadsheet and the guild's own site | Discord threads |

## 3. What Raid Mimic already has, and what each kind would need

| Piece | Have | For |
|---|---|---|
| Roll capture | `roll_sets` from every uploader's log, merged; winners ranked (`web/lib/rolls.ts`, `utils/rollLoot.js`) | roll systems; ties (needs a "lowest wins" switch) |
| Soft reserve | `web/lib/softReserve.ts`, `/raid/sr` | reserves; Guild B's picks are the same shape (pick before, locked at the start, rolled among pickers) |
| DKP | OpenDKP read and write (`utils/opendkp.js`), sealed bids (`utils/bidCrypto.js`) | DKP guilds; the per-guild OpenDKP connection is the flag exchange's §8 |
| Attendance | ticks, RA, raids per character | eligibility floors ("2 raids in the last 2 months"), EP for attendance |
| Loot record | `looted_items`, `loot_drops` | GP charges, once-per-character-set lists, pet-kit "won before" checks |
| EPGP | nothing | EP and GP ledgers, priority rating, cap per cycle, decay with a floor, the large decay |
| Tier claims | nothing structured | each system's tier list, so a roll or bid is read against its tier |

## 4. Proposed shape (for a later build; nothing here is built)

A guild's **rulebook**: `hub_loot_rules (guild_id, kind, settings jsonb, updated_by, updated_at)`, where `kind` is one of `dkp`,
`epgp`, `roll_tiers`, `picks`, `soft_reserve`, `council`, `all_greed`, and `settings` holds that kind's fields from section 1
(tiers and costs, eligibility, earn, cap, decay, lists, quest, spell and key rules, tie rule, rot). An **event override** names
another kind for one raid. The rulebook renders as a plain page (`/guilds/<slug>/loot`) and as a short block on every event a
guest can join ("Loot: rolls, upgrade then greed; guests may not loot on rot"). The tools read the fields they need: the roll
tracker its tie rule and tiers; soft reserve its caps and lock time; an EPGP ledger, when built, its cap and decay.

Order: (1) the rulebook as text-with-fields and the guest block (useful at once, no automation); (2) tie rule and tiers in the
roll tracker; (3) EPGP ledger, if a guild using it signs up.
