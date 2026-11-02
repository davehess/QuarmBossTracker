# Design: a catalog of guild loot systems and raid rules

Status: **catalog, 8 systems (2026-11-02)** (DECISIONS §520). The guild lead, sharing other guilds' loot channels and handbooks:
*"We should start building a categorization of the different loot systems and raiding rules that guilds have"*. Why it
matters: Raid Mimic hosts many guilds (`docs/DESIGN-raidmimic-hosted.md`), and the flag exchange puts guests in other guilds'
raids (`docs/DESIGN-flag-exchange.md`), where the host's loot rules apply. A guild should be able to describe its rules once,
in fields Raid Mimic understands, so the tools that run loot (rolls, bids, reserves, attendance) follow them, and a guest sees
them before signing up.

Sources (all 2026-11-02): Wolf Pack's own system, and seven Project Quarm guilds' published loot channels, handbooks and
policy documents, called Guild A to Guild G here. **This public file names no other guild and no person**; which letter is
which, and the links, are in the private briefing's Server outreach tab. Add a new guild as a new letter in section 2.

## 1. The dimensions every system answers

| # | Question | Values seen |
|---|---|---|
| 1 | **How is an item decided?** | DKP bid: sealed (Wolf Pack), open in guild chat (C, D, F, G), or on a DKP site with a timer (E) · EPGP priority, EP ÷ GP (A) · rolls by tier (B) · ranked picks, rolled among same-rank pickers (B on declared raids; C for no-drops) · loot council (C for progression; spells in D, F) · all greed (B for one zone) |
| 2 | **What tiers are there, in order?** | epic (main) > high > medium > low > epic (alt) > alt loot (A) · upgrade > pet-kit replacement > greed (B) · primary main ≥ second main > alt = trial (D) · raid-attending main (25%+) > main = alt > trial (F) · raider > member (E) · one pool, no tiers (G) |
| 3 | **What does winning cost?** | the bid (DKP) · GP by tier, 0/10/50/100 (A) · nothing (rolls) · a pick used up · a roll still costs 3 DKP if won (F) · double drop: both winners pay the lower of the top two bids (G) |
| 4 | **Bid limits** | minimum 1, 2 or 3 · win by 1 over the minimum · steps that grow with the bid: 1 to 25, 5 to 100, 10 to 250, 25 above (F) · caps by tier: second main 150, alt 25 (D); member 75 (E); under 25% attendance, 30 (D) · bids must be unique (G) |
| 5 | **Who may claim?** | main only unless the raid leader asks (A) · up to two mains sharing one pool, officer-approved (D, F) · level floors per era: 60, then 65 in Planes of Power (C); 61/63/65 by PoP tier (G); 60 + 50 AA (F) · attendance floor: 2 raids in 2 months (B), one of the last two raids (C, no-drops), 25% over 30 days (D, F) · gear and key checklists for "raider" status (E) · the guild's tag only (C instances, G) · guests may not loot on rot (A) · AFK or not contributing: no bid or roll (C) · no characters in other raiding guilds (D, G) |
| 6 | **How is the currency earned?** | attendance ticks (5/hour, D; 3/hour + 2 on time, F) · on-time tick · boss bonuses (D) · full night paid if targets clear early (D, F) · guild bank donations (A) · member-run events, 12+ people (A) · one-time level, epic or "raid ready" bonuses (A; F: 150 then 50 DKP) · new members earn 3× for 30 days, paid at the end (G) |
| 7 | **Limits and decay** | EP cap per 2-week cycle (A, 900) · 20% decay per cycle with a floor, and a large decay each 6 months or expansion (A) · no decay, inactive members keep everything (D, F) |
| 8 | **Special item lists** | once per character set for named high-demand items (A) · free-for-all lists, no tiers, trials excluded (F) · class priority at a set price (F) · priority-loot lists for gameplay-changing items (D) · earmarked items straight to the bank (G) · items excluded from pet kits (B) |
| 9 | **Quest items** | no-drop pieces cost GP (A) · bid only for the character who does the quest (D, F) · droppables banked and handed out to whoever holds the rest (A, B); for a set price, first come (F 3 DKP; G 250/1,000 pp) · rot rescue: any tagged character may loot an at-risk epic piece for 3 DKP (F) · keys: rolled mains first, lowest wins (A); by keying order (F); by bid (G) |
| 10 | **Spells** | claim if at level and able to scribe now, ties rolled (A, F) · council early in an expansion (D) · cheap spells rolled, valuable ones auctioned (G) · from the bank for mains (A, F) |
| 11 | **Ties** | /random LOWEST wins (A, B) · first all-in bid wins (F) · bids must be unique (G) · highest roll wins (D off-nights; Wolf Pack roll nights) |
| 12 | **Nobody wants it** | droppable to the guild bank to sell; no-drop rots (A, B) · rots below the minimum bid (E) · everything unbid belongs to the bank, even after rot (G) · officers may sell loot rights to a no-drop that would rot (D) · winner who lets it rot is still charged (F) |
| 13 | **Selling and returns** | no raid loot sales for the first 3 months of an expansion (C) · current-expansion droppables only once released by council or officers (D, E, F) · return for a refund up to the price paid, re-auctioned (D, F) · no upgrade roll or bid to sell (B, D) |
| 14 | **Per-raid overrides** | a declared system for one raid (B picks; B all greed for one zone) · off-night and member-run raids state their loot rules at formation, default every item /random (C, D, F) · off-night rolls cost nothing (F) · an auctioned raid: the best bid buys a 3-hour raid on a target of their choice and its item (F, monthly) |
| 15 | **When flags are limited** | flags to mains on progression kills; if limited, auto-invite off and flags handed out by raid composition, one per person, then seconds, then thirds, never first come (C) · not stated elsewhere |
| 16 | **Applicants and trials** | 2 weeks, earn but cannot spend, may bid on rot (C) · 1 month or 4 raids (D) · 2 months, 8 raids or 40 ticks, wins only if no main or alt bids (F) · 30 days and a member vote at 75% (G) · not in rolls for tradables and no picks (C, earlier rules) |
| 17 | **Honour and discipline** | no loot shaming (D, F) · no bidding up others or bidding as a main for an alt (D, F) · escalating DKP penalties for bid mistakes and early "grats", warning cards, records clear after 30 clean days (G) |
| 18 | **Who owns the rules** | officers may edit wording; rule changes need all officers and an announcement (A, B) · a council, never one person (D) · officer majority; quartermasters have no vote (G) · guild leader writes, DKP officers run (F) |
| 19 | **Raid nights** | Wolf Pack Sun/Wed/Thu 8 to midnight Eastern · C Mon/Tue/Fri/Sat 9 to midnight Pacific · F Sun/Mon/Wed/Thu, forms 7:30, starts 8, hard stop midnight Eastern · D starts 6:30 Pacific · E from its allied guild's event list · be online 15 minutes early (C, D, F) |

## 2. The systems seen

| | Kind | Decided by | Tiers | Attendance gate | Ties | Where it runs |
|---|---|---|---|---|---|---|
| Wolf Pack | DKP | sealed bids | none (soft reserve on some nights) | RA set by officers | n/a | OpenDKP + our bot |
| A | EPGP | priority rating at the highest tier claimed | 6 tiers, main before alt | earn only while tagged | lowest roll | spreadsheet + own site |
| B | Rolls | roll within the highest tier claimed | upgrade > replacement > greed | 2 raids in 2 months for upgrade | not stated | Discord threads |
| C | DKP (open), ranked no-drop picks before it | bid; picks by rank, roll order kept | none for bids; pick ranks 1 to 5 | one of the last two raids (picks) | roll | own DKP site + a sheet |
| D | DKP (open, chat) | bid, typed `item amount P/S/A` | two mains > alt = trial | 25% over 30 days or alt caps | highest roll (off-nights) | OpenDKP |
| E | DKP (site, timer) | highest bid when the timer ends | raider > member (member cap 75) | raider checklist (gear, keys) | not stated | OpenDKP |
| F | DKP (open, chat) | bid, typed `item RA M/A/T bid`; a 0 bid means roll | RA main > main = alt > trial | 25% over 30 days | first all-in bid | OpenDKP |
| G | DKP (open, chat) | bid, countdown `2:00`, `1:00`, `!grats` | one pool | tag, voice, level floor by PoP tier | bids unique | own site + bots |

Per-guild notes beyond the table (the full extraction lives with the private links):

- **A (EPGP).** GP 0 epic main / 100 high / 50 medium / 10 low / 0 epic alt / 10 alt. EP from attendance, bank donations,
  member events of 12+, level and epic bonuses. Cap 900 EP per 2-week cycle; 20% decay per cycle, none under 100 EP / 150 GP; a
  large decay each 6 months. Once-per-character-set list for named items. Spells claimed at level; ST keys rolled lowest wins.
  *As their own site runs it (seen 2026-11-02 with a guest login):* priority is computed as (EP + 150) ÷ (GP + 100), base
  values 150 / 100, though the rules page says EP ÷ (GP + 1); decay is configured at 10% compounding per cycle, not 20%; EP and
  GP pool across every character on an account; a main swap costs 500 GP. Ledgers: about 42k EP rows, 6k GP rows, 1.4k bids
  with the priority at bid time, and an audit trail of officer edits. **Lesson for the rulebook (section 4): render the rules
  page from the same settings the maths uses, so the two cannot drift.**
- **B (rolls).** Upgrade means you will use it; no upgrade to sell. Pet-kit upgrade once per item, then replacement priority
  behind upgrade. A "pick" system on declared raids (picks locked at the start, rolled among pickers; unpicked items roll as
  usual). All greed allowed for one zone and with an allied guild doing the same. Roll right limited to the tag when raiding
  with another guild.
- **C.** Earlier: /random for tradables, council when progression needs it, "pick 5" (later "pick 10") for no-drops, ranked
  1st to 5th, ties rolled and the roll order kept for later drops of the same item, an absent player keeps the slot. Now DKP
  on its own site, bids final. Level 60, then 65 in PoP, to earn and bid; lower alts may loot; PoTime drops only to a level-65
  raid-ready character meeting an AA list. Member-run raids: any member, an officer opens it, targets and loot rules announced,
  15 minutes to travel, default /random. **Flags: see dimension 15.**
- **D.** Two mains (level 60, approved, one shared pool); second main capped at 150, alts at 25, a main under 25% attendance
  at 30. 5 DKP an hour (present at the top of the hour and active 30 of its minutes), 2 on time, +6 for two named bosses. No
  decay. Main change once in 6 months. Guild-paid reagents list; bank takes spells/parchments, gems, scales. Return-for-refund.
  No raiding with other guilds. Council decides majors.
- **E.** An allied guild's DKP site (OpenDKP) that a second guild's members join as equals: raider status by a gear and key
  checklist; members capped at 75 a bid. Missed ticks claimed with a raid-chat command and logs. A locked-out character earns
  nothing and must leave the raid. About one item a month reserved to refill funds.
- **F.** Bids `Item | RA | M/A/T | Bid`, 0 = roll (a won roll costs 3), steps grow with the bid, all-in exempt. 3 an hour + 2 on
  time; one-time 150 and 50 for "raid ready" checklists. Free-for-all and class-priority lists. Epic pieces to epic use first;
  rot rescue for 3. Keys by keying order. Off-nights: rolls free. A monthly auctioned raid. Members may raid with other guilds if
  lockouts for scheduled targets are kept.
- **G.** Bids in guild chat with a countdown the high bidder runs, machine-read by the guild's bots; double drops priced at the
  lower of the top two. Level floors by PoP tier (61/63/65). New members 3× DKP for 30 days, once. Earmarked items to the bank;
  cheap spells rolled; legacy keys by bid. Detailed penalty ladder. No characters in other raiding guilds.

## 3. What Raid Mimic already has, and what is missing

| Piece | Have | Serves | Missing |
|---|---|---|---|
| Roll capture | `roll_sets` merged from every uploader, winners ranked (`web/lib/rolls.ts`, `utils/rollLoot.js`) | B, off-nights for C, D, F | a "lowest wins" switch (A, B); per-tier rolls (B) |
| Picks / reserve | soft reserve (`web/lib/softReserve.ts`, `/raid/sr`): unranked picks for one character | B's picks | ranked picks 1 to 5 with the roll order kept per item (C) |
| DKP | OpenDKP read and write (`utils/opendkp.js`), sealed bids (`utils/bidCrypto.js`) | Wolf Pack, D, E, F (all OpenDKP) | per-guild OpenDKP connection (flag exchange §8); a chat-bid reader for `P/S/A`, `M/A/T` and countdown formats (D, F, G) |
| Attendance | ticks, RA, raids per character | gates for B, C, D, F | "present at the top of the hour and active 30 minutes" (D, F) |
| Loot record | `looted_items`, `loot_drops` | GP charges, once-per-set lists, pet-kit "won before", refunds | GP ledger (A) |
| Flags | the gate tables (`web/lib/popGatePieces.ts`), the flag events board | C's limited-flag rule | the "one per person, then seconds" hand-out order (C) as a sort on the event's needers |

## 4. Proposed shape (for a later build; nothing here is built)

A guild's **rulebook**: `hub_loot_rules (guild_id, kind, settings jsonb, updated_by, updated_at)`, where `kind` is one of `dkp`,
`epgp`, `roll_tiers`, `picks`, `soft_reserve`, `council`, `all_greed`, and `settings` holds that kind's fields from section 1
(tiers and costs, bid limits, eligibility, earn, cap, decay, lists, quest, spell and key rules, tie rule, rot, selling, trials,
flag hand-out). An **event override** names another kind for one raid. The rulebook renders as a plain page
(`/guilds/<slug>/loot`) and as a short block on every event a guest can join ("Loot: open DKP, mains first; guests may not loot
on rot"). The tools read the fields they need.

Order: (1) the rulebook as text-with-fields and the guest block; (2) tie rule, tiers and ranked picks in the roll tracker and
soft reserve; (3) a chat-bid reader for the common formats; (4) an EPGP ledger, if a guild using it signs up.
