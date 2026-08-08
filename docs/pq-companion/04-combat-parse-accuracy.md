# 04 — Combat-log parsing accuracy: pq-companion vs. wolfpack-logsync

**Scope:** every combat line shape each project parses, how each attributes it, threat/hate
weights on both sides, and a ranked plan for what we should adopt.

**Legal note (hard constraint):** `pq-companion` ships with **no licence — all rights reserved**.
Everything below that describes their code is either a factual observation (which line shapes
exist in an EverQuest log is a fact about EQ, not their IP) or a short marked quote (<10 lines).
**Every code sketch in §5 is original**, written against *our* `parseEvent`/`EncounterBuilder`
conventions. Do not copy their Go source into our repo.

Paths:
- Theirs: `…/scratchpad/pq-companion/backend/internal/…` (abbreviated `be/` below)
- Ours: `/home/user/QuarmBossTracker/packages/wolfpack-logsync/index.js` (abbreviated `agent`)

---

## 1. Their parse catalog

All classification lives in one function, `classifyMessage`, dispatched in a fixed priority
order. Timestamp is fixed-width (26 chars) and sliced, not regexed
(`be/logparser/parser.go:17-21, 318-353`).

### 1a. Damage / combat

| # | Line shape (example) | File:line | Event → fields | Attribution rule |
|---|---|---|---|---|
| 1 | `You slash a gnoll for 150 points of damage.` — also multi-word skills: `You harm touch Griklor for 500…`, `You flying kick…`, `You dragon punch…`, `You eagle strike…`, `You tiger claw…`, `You round kick…` | parser.go:66, 487-504 | `CombatHit{Actor:"You", Skill:<verb>, Target, Damage}` | Verb alternation tries the **six known two-word skills first**, then falls back to `\w+`. Guard rejects auxiliaries (`have/are/were/been/is`) so `You have been healed for N points of damage.` is not a hit. |
| 2 | `A gnoll slashes you for 50 points of damage.` / `A wolf bites YOU for 10 points of damage.` | parser.go:73, 607-620 | `CombatHit{Actor:<npc>, Skill:<any word>, Target:"You"}` | **Verb is a wildcard `\w+`** — any unknown NPC verb still parses. Skill recovered afterwards by `extractVerb` (strip actor prefix, take first token, parser.go:962). `YOU` case-insensitive. |
| 3 | `Playerone slashes a gnoll for 75 points of damage.` / `an enchanted golem slashes Hakammer for 100…` | parser.go:84, 658-677 | `CombatHit{Actor,Skill,Target,Damage}` | Anchored on a **closed 20-verb list** incl. `frenzies on`. Rejected when actor is `You`, target is `you`, or actor is a bare article (`a`/`an`/`the` — means the lazy capture ate only the article of a multi-word NPC name). |
| 4 | `a giant wasp drone was hit by non-melee for 4 points of damage.` | parser.go:95, 506-518 | `CombatHit{Actor:"You", Skill:"spell", Target, Damage}` | **Hard-attributed to the local player.** No damage-shield discrimination — a DS proc on an incoming swing lands in the player's spell bucket. |
| 5 | `Takkisina hit a temple skirmisher for 18 points of non-melee damage.` / `A Shissar Arch Arcanist hit Takkisina for 640…` | parser.go:100, 588-605 | `CombatHit{Actor,Skill:"spell",Target,Damage}` | Third-party spell/proc damage. `you` folded to `"You"`. Note the verb is **past-tense `hit` only**; `hits`/`Your <Spell> hits` forms are not parsed. |
| 6 | `Pli Thall Xakra has taken 48 damage from your Asphyxiate.` | parser.go:107, 520-535 | `CombatHit{Actor:"You", Skill:"dot", Target, Damage, SpellName}` | Own DoT ticks only. **No third-party DoT pattern** (`… from Playername's Spell.`) exists. |
| 7 | `Sandrian Scores a critical hit!(62)` | parser.go:114, 540-546 | `CritHit{Actor, Damage}` | Standalone announcement line; the paren value is treated as the **total damage of the crit**, correlated to the *next* damage line from the same actor with the same amount (`be/combat/tracker.go:1035, 1376-1411`, queue capped at 8/actor). |
| 8 | `Narya delivers a critical blast! (274)` / `You deliver a critical blast! (274)` | parser.go:124-125, 548-564 | `CritHit{Actor, Damage}` | Same correlation, spell side. Self form normalised to `"You"`. |
| 9 | `You try to slash a gnoll, but miss!` | parser.go:87, 622-632 | `CombatMiss{Actor:"You", Target, MissType:"miss"}` | Only the literal `but miss!` tail. No dodge/parry/riposte/block variants on the *outgoing* side. |
| 10 | `A gnoll tries to slash you, but misses!` | parser.go:91, 634-644 | `CombatMiss{Actor:<npc>, Target:"You", MissType:"miss"}` | Same — only `misses`. |
| 11 | `You dodge a gnoll's attack!` / `You parry…` / `You riposte…` / `You block…` | parser.go:179, 646-656 | `CombatMiss{Actor:<npc>, Target:"You", MissType:<dodge\|parry\|riposte\|block>}` | **Self-defence form.** This is the only place defensive types are produced. |
| 12 | `You healed Playerone for 150 hit points.` / `You healed yourself for 150…` | parser.go:225, 679-690 | `Heal{Actor:"You", Target, Amount}` | `yourself` → `"You"`. |
| 13 | `Playerone healed you for 150 hit points.` | parser.go:229, 692-699 | `Heal{Actor, Target:"You", Amount}` | |
| 14 | `Playerone healed Playertwo for 150 hit points.` | parser.go:234, 701-710 | `Heal{Actor,Target,Amount}` | Single-token actor only. |

### 1b. Death / kill

| # | Line shape | File:line | Event | Attribution |
|---|---|---|---|---|
| 15 | `You have slain a gnoll!` | parser.go:188, 712-718 | `Kill{Killer:"You", Target}` | |
| 16 | `Playerone has slain a gnoll!` | parser.go:192, 720-726 | `Kill{Killer,Target}` | Single-token killer. |
| 17 | `a lightcrawler has been slain by Ineka!` / `… by Gygr\`s warder!` | parser.go:205, 728-739 | `Kill{Killer,Target}` | Loose captures both sides so possessive pet killers work. |
| 18 | `a gnoll died.` / `a gnoll has died.` | parser.go:220, 741-754 | `Kill{Killer:"", Target}` | DoT/swarm kill with no killing blow. **`has` optional.** Guarded so `You died.` falls through. |
| 19 | `You have been slain by a gnoll.` | parser.go:182, 756-762 | `Death{SlainBy}` | |
| 20 | `You died.` | parser.go:185, 763-768 | `Death{}` | |
| 21 | `<Name> dies.` | parser.go:201-205 (comment), tested at parser_test.go:595-598 | **deliberately NOT a kill** | Same feign-death false-positive we fixed; they route it to the spell-landed pipeline. Parity with us. |

### 1c. Threat-relevant non-damage

| # | Line shape | File:line | Event | Notes |
|---|---|---|---|---|
| 22 | `You begin casting X.` / `You begin singing X.` | parser.go:34, 376-381 | `SpellCast{SpellName}` | Bard verb included. |
| 23 | `Your target resisted the X spell.` | parser.go:42, 397-403 | `SpellResist` | Resisted detrimental still lands aggro. |
| 24 | `Your spell is interrupted.` / `Your X spell is interrupted.` | parser.go:38-39, 384-395 | `SpellInterrupt` | Kills the pending cast → zero hate. |
| 25 | `Your spell did not take hold.` (+ `on your target`) | parser.go:56, 449-455 | `SpellDidNotTakeHold` | Treated like a resist for aggro. |
| 26 | `Your charm spell has worn off.` | parser.go:139, 405-414 | `CharmBroken` | Matched **before** the generic spell-fade so it doesn't degrade to `SpellFade{"charm"}`. |
| 27 | `You feign death.` | parser.go:140, 416-423 | `FeignDeath` | ⚠️ **Unverified against a live Quarm log** — see §3, item D. |
| 28 | `You duck away from the main combat.` | parser.go:146, 425-431 | `RogueEvade` | Different wording from the line we match. |
| 29 | `a sand giant says 'I'll teach you to interfere with me Borg.'` | parser.go:248, 787-794 | `Taunt{Mob, Taunter}` | **Bystander-visible successful-taunt emote.** Server sends it on a *successful* single-target taunt when the NPC `CanTalk()`. This is the only public "someone's taunt landed" signal in EQ. |
| 30 | `<pet> tells you, 'Attacking <target> Master.'` | parser.go:133, 566-574 | `CharmedPet{Pet}` | The tell channel itself is the binding proof. |
| 31 | `Kebartik says 'My leader is Kildrey.'` / `Grimrose\`s warder says 'My leader is Grimrose.'` | parser.go:240, 778-785 | `PetOwner{Pet,Owner}` | |
| 32 | `<Name> tells the guild/raid/group/you/…,` | parser.go:157, 576-586 | `VerifiedPlayer{Name}` | Proves a single-token name is a **player**, used to break ties in NPC routing. |
| 33 | `Tashanian effect fades from Soandso.` | parser.go:48, 441-447 | `SpellFadeFrom` | Feeds departure/threat cleanup. |
| 34 | `You have entered <Zone>.` | parser.go:25, 368-374 | `Zone` | Zone/gate/evac ⇒ wipes personal hate. |

Plus non-combat families we can ignore for this analysis: `/con` buckets, faction deltas,
`/random` roll pairs, `/who` rows + summary, `/guildstat`, skill-ups, NPC dialogue, illusion fades.

### 1d. Attribution & routing rules (`be/combat/tracker.go`)

- **`looksLikeNPC`** (`:31-45`): `X\`s Y` ⇒ pet, not NPC; anything containing a space or backtick
  ⇒ NPC; leading lowercase ⇒ NPC; otherwise a single capitalised token ⇒ player.
- **`CanonicalNPCName`** (`parser.go:996-1005`): folds a leading `A `/`An ` to lowercase at every
  ingest point so `A wolf bites YOU` and `you slash a wolf` key to the same mob. `The <Name>`
  untouched. Shared by combat, threat and raidthreat.
- **`isGeneratedPetName`** (`:90-119`): models the EQMac pet-name generator positionally
  (initial ∈ {G,J,K,L,V,X,Z} + optional 2nd/3rd syllable + closed ending set) to recognise
  *other* raiders' summoned pets, whose "My leader is" line our log never sees. Always
  overridable by an authoritative signal, and guarded by `verifiedPlayers`.
- **`isEyeOfXPet`** (`:846-856`): `Eye of <Player>` self-dismiss never seeds a fight.
- **`resolveNPC`** (`:754-840`) — 6-rule ladder deciding which side of a hit is the mob:
  1. `Target=="You"` ⇒ actor is the NPC; `Actor=="You"` ⇒ target is.
  2. Pet on one side ⇒ the *other* side is the NPC (checked before active-fight lookup, so a
     damaged-then-charmed mob doesn't capture its own new damage).
  3. An already-active fight name wins.
  4. `verifiedPlayers` asymmetry.
  4.5 **Zeal pipe target** asymmetry (authoritative over structure).
  5. `looksLikeNPC` / `confirmedHostiles` asymmetry; tie ⇒ target.
  6. Both ambiguous ⇒ **drop the event** rather than guess.
- **Charm-break detection** (`:949-958`): a known pet hitting `You` ⇒ delete its owner binding.
- **Heal-based pet binding** (`:1286-1312`): a heal naming both caster and target is the only
  owner signal that survives for *another raider's* summoned pet.
- Incoming damage is tracked separately (`f.incoming`) and never enters a DPS row; the actor is
  stamped into `confirmedHostiles`.

### 1e. Encounter boundaries & rollup

- Per-NPC `Fight` objects, keyed by canonical mob name (`:860-875`).
- Inactivity windows (`be/combat/models.go:11-34`): **60 s pre-damage**, **30 s default with
  damage** (user-configurable), floored to **120 s when the session "looks like a raid"**
  (≥6 distinct verified players seen on guild/raid/group/tell this session).
- Generation-guarded timers (`:880-938`) so a stale expiry can't split one encounter in two.
- **Zoning no longer ends a fight** (`:573-587`) — evac/Abscond/gate and run-back keep the parse.
- **Player death no longer ends a fight** (`:628-646`) — die, rez, continue.
- `EventSpellLanded` extends the most-recent fight's timer but never seeds one (`:559-564`).
- Misses extend timers but never seed a fight (`:1098-1114`).
- **Live view merges every active fight into one synthetic encounter** (`mergedActiveFightLocked`,
  `:1172-1227`) so a boss+adds pull shows as one combat; `PrimaryTarget` = the mob with the most
  player damage. Archiving/history stay per-NPC.

### 1f. `frontend/src/lib/dpsRollup.ts` — rollup semantics

- Pure client-side pet folding, toggled by a localStorage flag (`:4-42`).
- Combined row (`:81-114`): damage/hits/crits **summed**; `max_hit` = per-entity max;
  **`active_seconds` = `max(owner, …pets)` not the sum** — deliberate, so an owner+pet row's
  active DPS stays comparable to a non-pet class (`:92-96`).
- Synthesises an owner row when only the pet dealt damage (`:116-144`), inheriting the pet's
  stamped class.
- Three DPS denominators are computed **server-side** (`be/combat/tracker.go:1682-1712`):
  `DPS` = total ÷ fight wall-clock; `ActiveDPS` = total ÷ that player's first→last span
  (no gap removal, EQLogParser's headline "personal DPS"); `RaidDPS` = total ÷ the raid's
  first→last span across all combatants+healers (`raidSecondsForFight`, `:1650-1680`),
  floored at 1.0 s.
- Scoping: personal = per-entity span; raid = union span; encounter = wall-clock. All three
  ride on every row so the UI can switch without re-deriving.

---

## 2. Our parse catalog (`packages/wolfpack-logsync/index.js`)

Two gates run before `parseEvent`: `DEFAULT_DROP_PATTERNS` (`:258-312`, privacy — officer/tells/
group/custom channels dropped at byte level), `PRIORITY_KEEP_PATTERNS` (`:318-368`), then
`KEEP_PATTERNS` (`:384-471`). Anything not kept never reaches the parser.

### 2a. Damage

| # | Line shape | agent line | Event → fields | Attribution |
|---|---|---|---|---|
| 1 | `Your <Ability> hits/strikes X for N points of [non-melee] damage.` | 682-685 | `damage{attacker:null, defender, ability, amount}` | `attacker:null` = uploader, resolved in `EncounterBuilder.add`. |
| 2 | `<Name>'s <Spell> hits X for N points of [non-melee] damage.` | 688-691 | `damage{attacker, defender, ability, amount, spellName}` | Third-party **named** spell — no equivalent on their side. |
| 3 | `X is <verb> by YOUR\|<Name>'s <DS source> for N points of non-melee damage.` | 749-764 | `damage{…, ds:true}` | Gated by a **curated DS allow-list** `DS_SOURCE_RX` (`:748`) so ordinary passive nukes aren't mis-tagged as damage shields. |
| 4 | `X was hit by <SPELL\|non-melee> for N [points of] damage.` | 767-770 | `damage{attacker:null, defender, ability, amount, spellName}` | **Left unattributed on purpose.** Resolved later by: DS swing-correlation (`_lastIncomingHit`, `:5407-5411`), the two-line DS flavor retag (`_dsPending`, `:5419-5424`), or bard-dirge cast correlation (`SOURCELESS_SPELLS`, `:141-159`, `:6245-6255`). |
| 5 | `X has taken N [points of] damage from your <Spell>.` | 773-776 | `damage{attacker:null, defender, ability, amount}` | Own DoT ticks. |
| 6 | `X has taken N [points of] damage from <Name>'s <Spell>.` | 779-782 | `damage{attacker, defender, ability, amount, spellName}` | **Third-party DoT — they have no equivalent.** |
| 7 | `You <verb> X for N points of [non-melee] damage.` | 785-790 | `damage{attacker:null, defender, ability:<normalised verb>, amount}` | `ATTACK_VERBS_RX` (`:708-717`, ~50 single-token verbs incl. ranged `shoots/fires/throws/flings`). Verb normalised (`crushes`→`crush`). Hits > `MELEE_HIT_MAX` (default 15000, `:665`) dropped as finishing blows. |
| 8 | `<Name> <verb> X for N points of [non-melee] damage.` | 796-806 | same, `attacker:<name>` | `isPlausibleAttacker` (`:` helper) rejects lowercase single tokens; same finishing-blow cap. |
| 9 | `<Name> hit X for N points of non-melee damage.` | 809-813 | `damage{ability:'non-melee'}` | ⚠️ **Dead code** — pattern #8's bare `hit` alternative matches first, so this shape lands as `ability:'hit'` (melee bucket). See §3-H. |
| 10 | `X was <flavor verb> by <source>.` (no number) | 825-828 | `ds_flavor{defender, ability}` | Second half of Quarm's two-line DS pair; retags the buffered hit. |
| 11 | `X has taken N [points of] damage.` (no source) | 908-911 | `damage{attacker:null, ability:'dot'}` | Anonymous DoT tick. |
| 12 | `<Boss> goes on a RAMPAGE against <Target>!` | 835-836 | `rampage{attacker, defender}` | No equivalent on their side. |

### 2b. Misses / defensives / crits

| # | Line shape | agent line | Event |
|---|---|---|---|
| 13 | `You try to <verb> X, but <reason>!` | 896-899 | `avoid{attacker:null, defender, kind}` |
| 14 | `<Name> tries to <verb> X, but <reason>!` | 902-905 | `avoid{attacker, defender, kind}` |
| — | `_classifyAvoid` (`:885-893`) resolves **miss / dodge / parry / riposte / block / invulnerable** from the reason clause — richer than theirs, which only knows `miss` on the offensive side. |
| 15 | `X Scores a critical hit!(N)` | 914-917 | `critical{kind:'melee', attacker, amount}` |
| 16 | `X delivers a critical blast!(N)` | 923-926 | `critical{kind:'spell', attacker, amount}` |
| — | Both feed `_bumpDeeps(attacker,'crit',amount)` into a **separate `crits{count,bonusDmg,maxBonus}` bucket** — never added to damage totals (no double-count), but treated as a *bonus* rather than the crit's total (see §3-G). |

### 2c. Death / heals / threat-relevant

| # | Line shape | agent line | Event |
|---|---|---|---|
| 17 | `X has been slain by Y!` | 969-972 | `death{defender, attacker}` |
| 18 | `You have slain X!` | 973-976 | `death{defender, attacker:null}` |
| 19 | `X died.` | 993-996 | `death{defender, attacker:null}` — ⚠️ **no optional `has`**, see §3-B |
| 20 | `You died.` | 997-1000 | `death{defender:'You'}` |
| 21 | `You are bleeding to death!` / `Returning to home point…` | 1005-1008 | `death_confirm` — **corpse-run proof, unique to us** |
| — | `<Name> dies.` is **explicitly not a death** (`:977-992`, `_DEATH_DIED_RX` `:29416`) — the feign-death fix. Parity with theirs. |
| 22 | `X has been healed [by Y] for N points.` | 1031-1034 | `heal{defender, attacker, amount}` |
| 23 | `You have been healed for N points of damage.` | 1035-1041 | `heal{defender:'You', attacker:null}` → `healsReceived` |
| 24 | `You have healed X for N points.` | 1048+ | `heal` (defensive; unconfirmed line) |
| 25 | `<Healer> performs an exceptional heal! (N)` | (crit-heal branch) | `crit_heal{attacker, amount}` — **bystander-visible crit heal, unique to us** |
| 26 | `You resist the <Spell> spell!` | 946-949 | `resist{spell}` |
| 27 | `Your target resisted the <Spell> spell.` / `<Mob> resisted your <Spell> spell.` | 959-966 | `spell_resisted{ability, defender}` |
| 28 | `You attempt to taunt X.` / `You have taunted X.` | (taunt branch) | `taunt{attacker:null, target, success}` — **self only** |
| 29 | `You have stunned X.` / `You stun X.` | (stun branch) | `stun{attacker:null, target}` |
| 30 | `[You/<Name>] ha[s|ve] fallen to the ground.` | (fd branch) | `feign_death{attacker, success:false}` — treated as a **failed** FD |
| 31 | `You have momentarily ducked away from the main combat.` / `Your attempts at ducking clear of combat fail.` | (evade branch) | `evade{attacker:null, success}` |
| 32 | `<Pet> says, 'My leader is <Owner>.'` | priority-keep `:319` | `pet_leader{pet, owner}` |
| 33 | `<Pet> tells you, 'Attacking <T> Master.'` | priority-keep `:326,342` | `pet_leader{pet, owner:'__SELF__', source:'charm_land'}` |
| 34 | `<Mob> regards <Charmer> as an ally.` | priority-keep `:347` | `pet_leader{owner:<charmer>}` — **bystander-visible charm land** |
| 35 | `<Mob> snaps out of the charm.` / `is no longer charmed` / `has been freed of the charm` | priority-keep `:350` | `charm_break{pet}` |
| 36 | `Your charm spell has worn off.` | | `charm_break{pet:'__SELF__'}` |
| 37 | `<Name> is a[n] Member/Officer/Leader of <Guild>.` | 936-940 | `guildstatus` |
| 38 | bandolier ×5 (`:845-854`), mend ×3 (`:862-867`), melody start/stop, dirge casts, `/who` rows | | — |

### 2d. Our attribution & encounter boundaries

- Pet/charm identity: `petLeaders` (from #32/#33/#34), `_activeCharms` sessions, and the
  gauge-driven `_charmTickTracker`. Our pets **bypass** the anti-NPC filters
  (`agent:6634-6648`) so charm-pet damage rolls up under the owner.
- Anti-NPC filters for the threat/DEEPS scoreboard (`agent:6626-6648`): reject PvP hits,
  reject any attacker already in `this.targets` (i.e. something we've damaged), reject
  multi-word attackers — **unless** proven ours.
- Encounter boundary: **single global builder per watched log**, flushed on
  (a) a boss-class death (`agent:7103-7136` — the dead mob is the top-damaged target, or took
  >100 k and ≥85 % of the top target's damage), or (b) `tickIdle` at **120 s** of silence
  (`agent:7138-7144`).
- No merged multi-mob view, no per-NPC fight objects, no personal/raid/encounter DPS split.

---

## 3. DIFF — what they get right that we get wrong

Ordered by damage to our numbers.

### A. Multi-word melee skill verbs (monk specials + Harm Touch) — **the big one**

Our `ATTACK_VERBS_RX` is single-token only, and pattern #8's lazy attacker capture happily
eats the first word of a two-word skill.

| Raw line | They produce | We produce | Impact |
|---|---|---|---|
| `You flying kick a gnoll for 452 points of damage.` | `CombatHit{Actor:"You", Skill:"flying kick", Target:"a gnoll", 452}` | `damage{attacker:"You flying", defender:"a gnoll", ability:"kick", 452}` (via #8, `isPlausibleAttacker` passes because it contains a space) | Damage credited to a **phantom combatant**; then dropped from the scoreboard entirely by the multi-word anti-NPC filter (`agent:6647`). Monk specials are a monk's *largest* hits. |
| `Torvahk round kicks Lord of Ire for 388 points of damage.` | `Actor:"Torvahk", Skill:"round"…` (their single-word fallback also splits third-person forms; they only special-case the first-person list) | `attacker:"Torvahk round"` — phantom row, dropped | Every monk in the raid under-parses. |
| `You harm touch Griklor for 3200 points of damage.` | `Actor:"You", Skill:"harm touch", 3200` | **no match at all** (`touch` isn't in our verb list) → event dropped | SK Harm Touch damage is **completely absent** from DPS, threat and encounter uploads. We only capture it as a *fun event* (`HARM_TOUCH_RX`, `agent:24982`). |
| `an ancient guardian frenzies on Torvahk for 210 points of damage.` | `frenzies on` is in their verb list ⇒ parsed | no match → dropped | Incoming rampage/frenzy damage missing from the Tank tab. |

Note our own `ABILITY_CLASS` map (`agent:5298-5310`) already *expects* abilities named
`'flying kick'`, `'round kick'`, `'dragon punch'`, `'eagle strike'`, `'harm touch'`,
`'tail rake'` — the class-inference path is written for data `parseEvent` can never emit.

### B. `X has died.` — our capture eats the `has`

| Raw | They | We | Impact |
|---|---|---|---|
| `a greater gnoll pup has died.` | `Kill{Target:"a greater gnoll pup"}` (`(?:has )?` optional, parser.go:220) | `death{defender:"a greater gnoll pup has"}` (`agent:993`, `_DEATH_DIED_RX` `agent:29416`) | Corrupted mob name ⇒ boss-death flush never fires for that name, timer cancellation (`_cancelTimersOnMobDeath`) misses, and a junk `death` row uploads. |

### C. Unknown NPC attack verbs on incoming damage

Theirs uses a wildcard verb when the target is `YOU` (`reNPCHitYou`, parser.go:73). Ours
requires the verb to be in the ~50-token list. Any Quarm NPC verb we haven't catalogued
(`rakes`, `batters`, `slaps`, `pounds`, `drubs`, `headbutts`, `cleaves`, …) drops the line
outright — silently removing incoming damage from the Tank tab, `defenderStats`,
`tookMax`, and the rampage/invuln math.

### D. `You feign death.` → real hate model

They classify a dedicated `FeignDeath` event and model `EntityList::ClearFeignAggro`:
mobs at level ≥35 keep the player on the hate list at a **residual 64**; lower/unknown-level
mobs fully clear (`be/threat/tracker.go:45-50, 943-991`). We treat *only* the failure line
(`has fallen to the ground`) and explicitly say a successful FD is invisible to us
(`agent:6795-6805`).

> ⚠️ **Verify before adopting.** Their `reFeignDeath` (`^You feign death\.$`) is not covered by
> a captured line in their test corpus. If Quarm really emits it, this is a free upgrade for
> monk/SK threat. If it doesn't, their model is dead code and ours is correct.

### E. Bystander-visible successful-taunt emote

`a sand giant says 'I'll teach you to interfere with me Borg.'` is EQ's public
successful-taunt broadcast. They parse it (`parser.go:248`) and use it two ways:
personal threat pins *you* to `topHate + 10` (`be/threat/tracker.go:1029-1055`) and the raid
assembler pins *any named player* to `top + 10` on that mob
(`be/raidthreat/assembler.go:302-351`).

We model taunts **only for the uploading character** (`agent:6753-6772`, from
`You have taunted X`). Every other tank's taunt is invisible to our `threat-snapshot`
stream — which is exactly the stream officers read to answer "why did the boss turn".
Our `DEFAULT_DROP_PATTERNS` currently drops all `says, '…'` lines (`agent:286`), so this
needs a `PRIORITY_KEEP` entry.

### F. Other raiders' summoned pets become phantom players

A magician pet named `Gabantik` is a single capitalised token with no space ⇒
`isPlausibleAttacker` passes ⇒ we open a `threatBy` row for it and upload it as a distinct
combatant. Their `isGeneratedPetName` (`be/combat/tracker.go:90-119`) recognises the EQMac
generator's name space and routes the row to a pet (never the fight target), while
`inferPetOwnerFromHealLocked` (`:1286-1312`) binds an owner from a heal line — the only owner
signal for a *remote* raider's pet that survives in our log.

Impact on us: phantom "players" in `encounter_players`, and the mage's real damage split
across two rows so nobody looks right on the parse card.

### G. Crit semantics

`Sandrian Scores a critical hit!(62)` immediately **precedes** `Sandrian slashes Zun Thall
for 62 points of damage.` — the paren number is the crit's **total** damage. They correlate
by (actor, amount) and flag the matching hit (`be/combat/tracker.go:1035, 1376-1411`).
We label it `bonusDmg` (`agent:6707-6717`, `_bumpDeeps` `crit` branch) and never link it to a
hit. Totals are safe (crits never enter damage sums), but our "crit bonus damage" and
"max crit" stats are roughly **2× the true bonus** and the crit *rate* per ability is unknown.
Also note their ordering assumption (crit line first) is the real EQ order — our golden
fixture has it reversed, which means the fixture can't catch a correlation regression.

### H. `<Name> hit X for N points of non-melee damage.` mis-bucketed

Our pattern #8 (`agent:796`) contains a bare `hit` alternative, so it matches
`Takkisina hit a temple skirmisher for 18 points of non-melee damage.` **before** the dedicated
pattern at `agent:809` ever runs. Result: another raider's nuke is recorded as
`ability:'hit'` ⇒ `deepsCategory 'melee'` ⇒ threat `swing` bucket. Theirs classifies it as
`Skill:"spell"`. Totals unaffected; the melee/spell split and the threat breakdown are wrong,
and `agent:809-813` is unreachable dead code.

### I. Self-defence lines

They parse `You dodge a gnoll's attack!` / `parry` / `riposte` / `block`
(`parser.go:179`). We only handle the `X tries to <verb> Y, but Y dodges!` construction —
neither our `KEEP_PATTERNS` nor `parseEvent` will accept the self-defence phrasing.
If Quarm emits it for the local player, our own avoidance % is undercounted.
**Verify against a live tank log before adding** — the two phrasings are client/era
dependent and we already handle the one our golden fixture uses.

### J. Rogue Evade wording

Ours: `You have momentarily ducked away from the main combat.` / `Your attempts at ducking
clear of combat fail.` Theirs: `You duck away from the main combat.` (`parser.go:146`).
Cheap to accept both.

### K. Article-case folding

Their `CanonicalNPCName` folds `A `/`An ` at every ingest point so `A wolf bites YOU` and
`you slash a wolf` key identically. We normalise nothing — `this.targets`, `petLeaders` and
`threatBy` are keyed on the raw string, so a mob that appears in both subject and object
position can split across two keys. We partially compensate with `.toLowerCase()` lookups in
the pet paths (`agent:6641-6646`), but `this.targets` / the boss-name derivation
(`agent:7115-7130`) are case-sensitive.

### L. Encounter boundaries

| | Theirs | Ours |
|---|---|---|
| Fight identity | per-NPC `Fight` objects | one global builder |
| Idle timeout | 60 s pre-damage / 30 s with damage / **120 s raid-detected** | flat 120 s |
| Raid detection | ≥6 verified players on chat channels | none |
| Multi-mob | merged live view, per-NPC archive | single blended encounter |
| Zone / death | never end a fight | never end a fight (parity) |
| DPS denominators | encounter / personal-active / raid-span, all three per row | encounter only |

Their per-NPC split + merged live view is strictly more informative, but it's a
re-architecture of `EncounterBuilder`, not a patch. The cheap win is the **personal-active
span** denominator (first→last activity per player), which fixes the perennial "the wizard
who cast twice looks bad" complaint.

### Reverse — what we handle that they don't

1. **Damage-shield discrimination.** They hard-attribute every `X was hit by non-melee for N`
   to the local player as spell damage (`parser.go:506-518`). On Quarm a DS proc uses that exact
   shape, so **their DS damage lands in the player's nuke bucket and generates spell hate** —
   the same "credit damage shields to the tank" class of error our CLAUDE.md flags for
   chat-extracted parses. We gate on `DS_SOURCE_RX`, correlate the anonymous form to the last
   incoming swing, and retag from the two-line flavor pair.
2. **Third-party DoT ticks** (`X has taken N damage from <Name>'s <Spell>.`) — we parse them,
   they have no pattern. This is precisely the DoT-class undercount our CLAUDE.md warns about.
3. **Named third-party spell damage** (`<Name>'s <Spell> hits X for N…`) — no equivalent.
4. **Ranged attacks** (`shoots/fires/throws/flings`) — absent from their verb list, so ranger
   bow damage silently vanishes on their side.
5. **Full defensive taxonomy on third-party lines** (dodge/parry/riposte/block/invulnerable);
   they only produce `miss` on offence.
6. **Finishing-blow / anomalous-hit cap** (`MELEE_HIT_MAX`, `agent:665`) — they have none, so
   their parses carry the exact 1.4–2× inflation we diagnosed and fixed.
7. **Rampage announcements**, **exceptional (crit) heals**, **corpse-run death confirmation**,
   **bandolier**, **mend**, **melody/dirge correlation**, **incoming + outgoing resists**,
   **`/guildstatus`**, **PvP assists**.
8. **Byte-level privacy filter** before parse (`docs/PRIVACY.md`) — they parse everything and
   filter later.
9. **Charm-land via bystander `regards X as an ally`** and three independent charm-break
   phrasings; their charm handling is charmer-local only.

---

## 4. Threat weights — theirs vs. ours

Their personal meter is a port of `Mob::CheckAggroAmount` from the EQMacEmu fork Quarm runs,
backed by the local `quarm.db` spell + NPC tables (`be/threat/calculator.go`).

| Event | Theirs (weight + source) | Ours (`agent`) | Verdict |
|---|---|---|---|
| Melee swing (hit) | **Flat per-swing** = weapon damage + primary-hand damage bonus, *independent of damage rolled* (`melee.go:28-85`). Hate modifier never applies. | `t.swing += event.amount` (1:1 observed damage, `agent:6682`) | Theirs is the server formula. Ours over-weights big rolls, under-weights fast weapons. |
| Melee **miss** | Same flat per-swing hate as a hit; falls back to that mob's **average landed swing** when the weapon is unknown (`tracker.go:714-742`) | **0 — misses generate no hate** | Real gap. A tank missing 30 % of swings loses 30 % of melee threat on our meter. |
| Backstab | Flat `((skill*0.02)+2) * weaponDamage`, **not** the rolled number (`melee.go:104-113`) | 1:1 rolled damage (falls into `swing`) | We massively over-rank rogues. |
| Direct spell damage | Spell's **BASE** damage from the DB, resolved at cast; crits and partial resists never change it (`calculator.go:271-278`, `tracker.go:649-675`) | 1:1 observed damage | Ours inflates crit-heavy casters. |
| DoT tick | Observed per-tick damage (matches `DoBuffTic`) | 1:1 observed damage | **Parity.** |
| Weapon proc (unknown spell) | Observed damage as proxy (`tracker.go:670`) | `PROC_HATE` catalog first (`agent:186-194`: enraging blow 700, provoke/taunt 500, stun 200), else observed | Ours is better where the catalog has an entry. |
| Non-damage detrimental (snare/slow/stun/mez/AC) | `maxHP / 15`, clamped **[25, 1200]**, from `eqemu` NPC HP (`calculator.go:91-98, 315-326`) | Flat `RESIST_HATE_DEFAULT = 120`, with 3 named overrides at 320 (`agent:238-243`) | Theirs is the real formula. **We can implement it** — see §5-5. |
| Flat instant hate (SPA 92: Terror +200…+510, Jolt/Concussion negative) | Read from the spell row, added **unscaled** by any hate modifier (`calculator.go:66-72, 308-310`) | Hand-curated `CAST_HATE` map (`agent:201-221`: voice of thule 3000, provocation 1000, jolt −400, fading memories −1500…) | Same idea; theirs is data-driven and complete, ours is curated and Quarm-tuned. |
| Flat debuff hate | +10 per negative stat/resist effect, +50 `ResistAll`, +70 `AllStats`, +10 root, +1 dispel (`calculator.go:290-307`) | none | Small but free if we ever get the spell catalog client-side. |
| Hate-generation modifiers (SPA 114/130 — Glamorous Visage −10 %, Voice of Terris +10 %, Spell Casting Subtlety) | Tracked as timed active modifiers; scale spell + heal hate only, **never melee**, and **never a non-positive total** (`tracker.go:612-636`, `calculator.go:74-88`) | none | Real modelling gap; matters for enchanters/wizards. |
| Heal | `1 + 2*amount/3`, capped **1500** (`calculator.go:379-388`); **spread across every mob on the hate list**, not just the target (`tracker.go:769-788`) | `min(amount * 2/3, 1500)` (`agent:7020-7027`) — same formula, **single bucket** | Formula parity (both cite the same research). The multi-mob spread is theirs only; matters on AoE pulls. |
| Resisted detrimental | Full offensive hate still commits (`tracker.go:400-405`) | Flat `RESIST_HATE` (`agent:6780-6795`) | Same intent, theirs exact. |
| Interrupted cast | **Zero hate** — pending dropped (`tracker.go:406-409`) | Not modelled (we credit on the resist line only) | Parity in effect. |
| Cast that fizzled / never resolved | Pending expires after a 30 s `castResolveWindow`, no hate (`tracker.go:36`) | n/a | Theirs cleaner. |
| Successful taunt (self) | `SetHate(top + 10)` — a direct set, bypasses hate modifiers (`tracker.go:1020-1055`); no-op if already top | `t.proc += max(1, maxThreat + 1 - current)` (`agent:6763-6771`) | **Essentially identical**, +1 vs +10. Ours is fine. |
| Successful taunt (**another player**) | Modelled from the public emote, per-mob per-player offset (`raidthreat/assembler.go:302-351`) | not modelled | Adopt — see §5-3. |
| Feign Death | ≥lvl 35 ⇒ residual 64; below ⇒ full clear (`tracker.go:943-991`) | Failure line only; counted as a failed attempt, no hate change | Adopt if the success line exists. |
| Rogue Evade | `hate *= 55 %`, floored at 100 (`tracker.go:52-61, 1000-1018`) | halve every bucket (`agent:6805+`) | Near-parity; theirs has the floor and the exact midpoint. |
| Zone / gate / evac / own death | `endAll` — wipe every hate list (`tracker.go:422-425`) | not modelled | Cheap to add: a zone line should zero our per-encounter threat for the uploader. |
| **Another player** leaving the zone (Evacuate/Succor/CoH/Circle) | Their raid assembler zeroes that player's displayed hate on every mob (`assembler.go:353-430`) | not modelled | Nice-to-have; medium effort (needs cast_on_other text matching). |
| Class/player hate multipliers | User-configurable signed %, default **0 for every class** (`assembler.go:15-21`) — they deliberately model taunt instead of a blanket tank boost | none | Agree with their conclusion; don't add class fudge factors. |
| Confidence flags | DoT classes (Nec/Sha/Dru) and heal classes (Clr/Dru/Sha) rows flagged low-confidence because their ticks/heals aren't in the local log (`assembler.go:29-32, 538-554`) | none | **Cheap, high value** for our `threat-snapshot` UI honesty. |

**What of theirs would actually improve our threat meter, ranked:**
1. Miss hate (flat per-swing, avg-swing fallback) — biggest single correction for tanks.
2. `maxHP/15` standard hate for resisted/non-damaging detrimentals, using the NPC HP we
   already serve from `mob-info`.
3. Backstab flat-hate cap.
4. Bystander taunt emote → other players' threat.
5. Heal hate spread across all engaged mobs.
6. Confidence flags on DoT/heal classes.

---

## 5. Ranked adaptation plan (original code sketches)

All sketches target `packages/wolfpack-logsync/index.js`; each names the golden-log fixture line
to add. Remember the two-branch routing rule from CLAUDE.md: agent-only changes for beta users
land on `beta` with a `packages/wolfpack-logsync/package.json` bump.

---

### P1 — Multi-word melee skill verbs (monk specials, Harm Touch, frenzy) — **do first**

*Fixes §3-A. Effort S. Highest damage-accuracy payoff of anything here.*

Insert **before** the existing `You <verb>` pattern (`agent:785`), so the lazy attacker
capture never gets a chance to split the skill name.

```js
// ── Multi-word melee skill verbs ────────────────────────────────────────────
// EQ logs class skills as their literal skill name, which is two words for the
// monk line, Harm Touch, and Frenzy. These MUST be tried before ATTACK_VERBS_RX:
// the single-token pattern's lazy `(.+?)` attacker capture otherwise absorbs the
// first word ("You flying" / "Torvahk round"), producing a phantom combatant
// whose damage the multi-word anti-NPC filter then discards.
const SPECIAL_VERB_RX =
  '(?:harm\\s+touch(?:es)?|flying\\s+kicks?|round\\s+kicks?|dragon\\s+punch(?:es)?|' +
  'eagle\\s+strikes?|tiger\\s+claws?|tail\\s+rakes?|frenzies\\s+on|frenzy\\s+on)';

// "flying kicks" → "flying kick"; "frenzies on" → "frenzy".
function normalizeSpecialVerb(raw) {
  const v = String(raw).toLowerCase().replace(/\s+/g, ' ').trim();
  if (/^frenz/.test(v)) return 'frenzy';
  return v.replace(/(?:es|s)$/, '');
}
```

then, immediately above the current line 785:

```js
  // Second person: "You flying kick a gnoll for 452 points of damage."
  m = line.match(new RegExp(
    `\\]\\s+You\\s+(${SPECIAL_VERB_RX})\\s+(.+?)\\s+for\\s+(\\d+)` +
    `(?:\\s+\\((\\d+)\\))?\\s+points?\\s+of\\s+damage`, 'i'));
  if (m) {
    if (parseInt(m[3], 10) > MELEE_HIT_MAX) { _finishingBlowsDropped++; return null; }
    return { ts: tsIso, type: 'damage', attacker: null /* self */,
             defender: m[2], ability: normalizeSpecialVerb(m[1]),
             amount: parseInt(m[3], 10) };
  }

  // Third person: "Torvahk round kicks Lord of Ire for 388 points of damage."
  m = line.match(new RegExp(
    `\\]\\s+(.+?)\\s+(${SPECIAL_VERB_RX})\\s+(.+?)\\s+for\\s+(\\d+)` +
    `(?:\\s+\\((\\d+)\\))?\\s+points?\\s+of\\s+damage`, 'i'));
  if (m) {
    if (!isPlausibleAttacker(m[1])) return null;
    if (parseInt(m[4], 10) > MELEE_HIT_MAX) { _finishingBlowsDropped++; return null; }
    return { ts: tsIso, type: 'damage', attacker: m[1],
             defender: m[3], ability: normalizeSpecialVerb(m[2]),
             amount: parseInt(m[4], 10) };
  }
```

Also add the new ability names to `MELEE_ABILITIES` (`agent:21146`) so they bucket as melee:
`'flying kick','round kick','dragon punch','eagle strike','tiger claw','tail rake','harm touch','frenzy'`.
(`'harm touch'` is arguably a burst discipline, not a swing — their tracker deliberately routes
it to the damage-scaled path rather than the flat melee path, `be/threat/tracker.go:359-364`.
Recommend: melee for **DEEPS**, damage-scaled for **threat**.)

**Golden test — append to `test/fixtures/golden/line-families.log`:**

```
[Sun Aug 02 21:11:00 2026] You flying kick Lord Nagafen for 452 points of damage.
[Sun Aug 02 21:11:01 2026] Torvahk round kicks Lord Nagafen for 388 points of damage.
[Sun Aug 02 21:11:02 2026] You harm touch Lord Nagafen for 3200 points of damage.
[Sun Aug 02 21:11:03 2026] an ancient guardian frenzies on Torvahk for 210 points of damage.
```

Expected: four `damage` events, abilities `flying kick` / `round kick` / `harm touch` / `frenzy`,
attackers `null` / `Torvahk` / `null` / `an ancient guardian`, **no** attacker string containing
a space that isn't a real NPC name.

---

### P2 — `X has died.` optional `has`

*Fixes §3-B. Effort XS.*

```js
  // "X died." / "X has died." — a real death with no named killer (drowning,
  // falling, a DoT tick finishing a swarmed mob). The optional "has" matters:
  // without it the lazy capture swallows it into the mob name ("a gnoll has"),
  // which breaks the boss-flush comparison and the respawn-timer cancel.
  m = line.match(/\]\s+(.+?)\s+(?:has\s+)?died\.\s*$/i);
```

Same change to `_DEATH_DIED_RX` (`agent:29416`) so `_deadMobNameFromLine` agrees, and widen the
`KEEP_PATTERNS` entry at `agent:404` (`/\bdie[ds]\./i` already matches — no change needed).

**Golden test:** `[Sun Aug 02 21:11:04 2026] a greater gnoll pup has died.`
→ `death{defender:"a greater gnoll pup"}` (assert the trailing `has` is gone).

---

### P3 — Bystander taunt emote → per-player taunt threat

*Fixes §3-E. Effort S–M (parser S, threat wiring M).*

Priority-keep (add to `PRIORITY_KEEP_PATTERNS`, `agent:318`) so the generic `says, '…'` drop
at `agent:286` can't eat it:

```js
  // Public successful-taunt emote. The server broadcasts this only on a
  // SUCCESSFUL single-target taunt by a player, naming both mob and taunter —
  // the one signal in the log that another tank's taunt landed.
  /\bsays,?\s*['"]I'?ll teach you to interfere with me\b/i,
```

Parser (place next to the existing self-taunt branch):

```js
  // "a sand giant says 'I'll teach you to interfere with me Borg.'"
  m = line.match(
    /\]\s+(.+?)\s+says,?\s*['"]I'?ll teach you to interfere with me\s+(.+?)[.!]?\s*['"]/i);
  if (m) {
    return { ts: tsIso, type: 'taunt', attacker: m[2].trim(), target: m[1].trim(),
             success: true, source: 'emote' };
  }
```

Then in `EncounterBuilder.add` (`agent:6753`) change the hard-coded self attribution:

```js
    // was: const attacker = this.character;
    const attacker = event.attacker || this.character;   // emote names the taunter
```

The existing "set to current max + 1" logic (`agent:6763-6771`) then applies to whoever
taunted, which is exactly their model.

**Golden test:**
`[Sun Aug 02 21:11:05 2026] Lord Nagafen says 'I'll teach you to interfere with me Torvahk.'`
→ `taunt{attacker:"Torvahk", target:"Lord Nagafen", success:true, source:"emote"}`, `keep:true`.
Add a negative case too — a normal NPC `says, '…'` line must still be dropped by the
privacy/noise filter.

---

### P4 — Wildcard-verb fallback for incoming damage

*Fixes §3-C. Effort S. Guarded so it can only ever ADD lines we currently drop.*

Place **after** all existing damage patterns (so it is a pure fallback, never a competitor):

```js
  // Fallback: an NPC hits a player with a verb we haven't catalogued.
  // Anchored on "<Name> <oneword> <Defender> for N points of damage." and gated
  // on the defender being YOU or a /who-confirmed player, so it can never fire
  // on a shape one of the specific patterns above already owns.
  m = line.match(/\]\s+(.+?)\s+([a-z][a-z-]+)\s+(YOU|[A-Z][a-zA-Z]{2,19})\s+for\s+(\d+)\s+points?\s+of\s+damage/);
  if (m && isPlausibleAttacker(m[1])) {
    const def = /^you$/i.test(m[3]) ? 'You' : m[3];
    if (/^you$/i.test(m[3]) || isConfirmedPlayer(def)) {
      return { ts: tsIso, type: 'damage', attacker: m[1], defender: def,
               ability: m[2].toLowerCase().replace(/(?:sh|ch|ss|x)es$/, s => s.slice(0, -2))
                                          .replace(/s$/, ''),
               amount: parseInt(m[4], 10) };
    }
  }
```

**Golden test:**
`[Sun Aug 02 21:11:06 2026] an ancient guardian rakes Torvahk for 505 points of damage.`
→ `damage{attacker:"an ancient guardian", defender:"Torvahk", ability:"rake", amount:505}`.
Plus a regression guard: the existing `Lord of Ire hits Torvahk for 398…` line must still parse
with `ability:"hit"` (i.e. the fallback did not steal it).

---

### P5 — Real hate for non-damaging detrimentals (`maxHP/15`) + miss hate + backstab cap

*Fixes the top three rows of §4. Effort M.*

**5a — `maxHP/15` standard hate.** Our own comment at `agent:231-237` says we can't do this
because "the agent has no per-mob maxHP data. Revisit if/when the agent gains access to
`eqemu_npc_types` maxHP." **That comment is now stale.** The agent already has the catalog:
`fetchMobInfo` (`agent:27725`) pulls `GET /api/agent/mob-info` — backed by `eqemu_npc_types` —
into `_mobInfoByName` with a 6 h TTL (`agent:27707-27723`).

One real caveat: `fetchMobInfo` is currently driven **only from `buildMobInfo()`**, i.e. only for
the character's live *Zeal target*. So the cache is warm for whatever the player is targeting and
cold for everything else. Step one of this change is a second call site — fetch on first sight of
a new name in `EncounterBuilder.this.targets` — before the hate formula can rely on it.

```js
// EQ's "standard hate" for a non-damaging detrimental (snare/slow/stun/mez/fear/
// AC debuff): the target's max HP / 15, clamped to [25, 1200] — EQMacEmu
// Mob::CheckAggroAmount. Reads the NPC catalog row the agent already caches for
// Mob Info; falls back to the flat proxy while the row is cold or unknown.
const STANDARD_HATE_DIVISOR = 15;
const STANDARD_HATE_MIN     = 25;
const STANDARD_HATE_MAX     = 1200;
function standardHateFor(mobName, zoneId) {
  const row = _mobInfoByName.get(_mobInfoCacheKey(mobName, zoneId));
  const hp  = row && row.mob ? Number(row.mob.hp) : 0;
  if (!hp || hp <= 0) return RESIST_HATE_DEFAULT;
  return Math.min(STANDARD_HATE_MAX,
         Math.max(STANDARD_HATE_MIN, Math.floor(hp / STANDARD_HATE_DIVISOR)));
}
```

and at `agent:6786` use
`RESIST_HATE[sl] ?? standardHateFor(event.defender || this.topTargetName(), this.zoneId)`.
Verify the exact HP column name on the `mob-info` payload before wiring (`row.mob.hp` is the
assumed field).

**5b — miss hate.** Melee hate is per-swing and identical hit or miss. We don't know the
equipped weapon, so use their fallback: this character's **average landed swing on that mob**.
Track it alongside the existing threat buckets:

```js
// Per-attacker running melee average, used to price a MISS. EQ adds the same
// per-swing hate whether or not the swing connects, so a miss that adds nothing
// systematically under-ranks anyone with low accuracy (i.e. every tank).
// No-op until at least one swing has landed this fight.
function meleeMissHate(t) {
  if (!t || !t.swingCount) return 0;
  return t.swingSum / t.swingCount;
}
```

In the melee branch (`agent:6681-6683`) also do `t.swingSum += event.amount; t.swingCount++;`,
and in the `avoid` handler, when `attacker` resolves to a tracked player and
`kind !== 'invulnerable'`, `t.swing += meleeMissHate(t)`.

**5c — backstab cap.** Rogues currently get 1:1 hate on a 2 500-damage backstab. Their model
says hate is the flat base (`((skill*0.02)+2) * weaponDamage`, ~6–7 × weapon damage ≈ a few
hundred). Without weapon data, the honest fix is a cap:

```js
// A backstab's hate is its BASE damage, not the rolled number — the server adds
// it with a zero damage component. Without the equipped piercer we can't compute
// the base, so cap the hate contribution at this character's average landed
// swing on the mob (their non-backstab melee), which is the right order of
// magnitude and can never over-credit.
if (a === 'backstab') {
  t.swing += Math.min(event.amount, Math.max(meleeMissHate(t), BACKSTAB_HATE_FLOOR));
} else { /* existing */ }
```

**Golden tests:** these are threat-meter numbers, so assert on the encounter digest
(`expected-encounter.json` `per_player` buckets), not on `parseEvent`:
- a fixture with 3 landed swings (100/120/140) + 2 `avoid{kind:'miss'}` from the same attacker
  ⇒ `swing` = 360 + 2×120 = 600.
- a `Your target resisted the Song of Highsun spell.` line with a cached mob HP of 90 000
  ⇒ `spell` bucket += 1200 (clamped), not 120.
- a backstab of 2 500 with an average swing of 180 ⇒ `swing` += 180, not 2 500.

---

### P6 — Fix the `hit … non-melee` bucket (§3-H)

*Effort XS.* Move the dedicated pattern (`agent:809-813`) **above** the generic third-person
pattern (`agent:796`), or exclude the bare `hit` alternative when the line ends in
`non-melee damage`:

```js
  // "<Name> hit X for N points of non-melee damage." — another player's nuke or
  // proc. MUST be tried before the generic verb pattern, whose bare "hit"
  // alternative would otherwise claim it and bucket a nuke as a melee swing.
  m = line.match(/\]\s+(.+?)\s+hit\s+(.+?)\s+for\s+(\d+)\s+points?\s+of\s+non-melee\s+damage/i);
```

**Golden test:** the existing fixture line
`a fear touched drolvarg hit Torvahk for 91 points of non-melee damage.` — its expected
`ability` flips from `"hit"` to `"non-melee"`. That is a deliberate golden update; call it out
in the commit message per `test/golden-log.test.js`'s "READ THE DIFF" rule.

---

### P7 — Suppress phantom summoned-pet combatants (§3-F)

*Effort M. Deliberately weaker than theirs — suppress, never invent an owner.*

```js
// EQMac's summoned-pet name generator emits a closed name space (a fixed initial
// consonant + optional syllables + a fixed ending). We use it ONLY to stop
// another raider's pet from opening a phantom player row — never to guess an
// owner, because the name space overlaps a handful of real player names.
// Any authoritative signal wins: a /who row, a chat-channel line, "My leader is",
// a charm tell, or the Zeal pet gauge.
const _PET_NAME_INITIALS = new Set(['G', 'J', 'K', 'L', 'V', 'X', 'Z']);
const _PET_NAME_ENDINGS  = ['tik', 'ab', 'er', 'n'];
function looksLikeGeneratedPetName(name) {
  if (!name || /[\s`']/.test(name)) return false;
  if (name.length < 4 || name.length > 15) return false;
  if (!_PET_NAME_INITIALS.has(name[0])) return false;
  if (isConfirmedPlayer(name) || whoData.has(name.toLowerCase())) return false;
  const tail = name.slice(1).toLowerCase();
  return _PET_NAME_ENDINGS.some(e => tail.endsWith(e));
}
```

Use it in the `threatBy` admission test (`agent:6644-6648`) to route such an attacker into an
`unowned_pets` aggregate instead of a named player row, and surface it on the parse card as
`(unclaimed pet)`. If a later `My leader is` line arrives, re-key it — `petLeaders` already wins.

**Golden test:** add a summoned pet doing damage with no `My leader is` line and assert it does
**not** appear in `per_player`, and that its damage still counts toward the encounter total.

---

### P8 — Rogue Evade + FD wording (§3-D, §3-J)

*Effort XS each; both gated on log verification.*

Accept the alternate evade phrasing (`KEEP_PATTERNS` + the evade branch):
`/\byou\s+duck\s+away\s+from\s+the\s+main\s+combat\b/i` → `evade{success:true}`.

For FD: **do not ship** `You feign death.` until someone confirms it in a live monk log.
If confirmed, emit `feign_death{success:true}` and model the residual — zero the buckets for
mobs below level 35 and set 64 otherwise (level from `mob-info`).

**Golden tests:** one line per accepted phrasing; the FD one stays out of the fixture until
verified.

---

### P9 — Personal-active DPS denominator

*Effort M. Adopts their `ActiveDPS`, which is EQLogParser's headline metric.*

Track `firstActivity` / `lastActivity` per attacker in `threatBy`, emit
`active_seconds` on the upload payload alongside the existing totals, floored at 1.0 s.
The bot's parse card can then show "personal DPS" without changing any stored totals — it's
purely additive to the payload, so `merge_encounter_players` is unaffected.

---

### P10 — Article-case folding (§3-K)

*Effort S, but touches every keyed map.* Add a single `canonicalMobName(name)` that folds a
leading `A `/`An ` to lowercase (leave `The ` alone) and apply it at each ingest point in
`EncounterBuilder.add` — `this.targets`, `_lastIncomingHit`, `petLeaders`, `threatBy`,
`defenderStats`. Low urgency for us because most of our lookups already lowercase, but it
removes a whole class of split-key bug.

---

## 6. Risks, effort, skip list

### Double-count hazards (read before touching `parseEvent`)

`parseEvent` is a **first-match-wins ladder**; every pattern added is a chance to (a) steal a
line a later pattern owns, or (b) *duplicate* a line an earlier pattern already emitted.
Concrete hazards in the plan above:

1. **P1 (multi-word verbs) must go BEFORE the single-token patterns**, not after. Placed after,
   they never fire (the single-token pattern already matched with a phantom attacker). Placed
   before, they consume the line exactly once. Regression net: the golden per-line tier asserts
   *one* event per line, so a duplicate is impossible to sneak through — but a *steal* is only
   caught if the stolen shape is in the fixture. **Every new pattern needs both a positive
   fixture line and a "the old shape still parses the old way" line.**
2. **P4 (wildcard incoming verb) is a fallback and must stay last** among damage patterns, and
   must keep its defender gate (`YOU` or a confirmed player). Without the gate it will match
   `X was hit by non-melee for N points of damage` fragments and NPC-on-NPC lines, creating a
   second damage event for lines the DS/non-melee patterns already own.
3. **P3 (taunt emote) is a `says` line.** It must be added to `PRIORITY_KEEP_PATTERNS`, not to
   `KEEP_PATTERNS` — the drop list runs first for anything that isn't a priority keep. And the
   emote must **not** also be counted by the existing self-taunt branch when the taunter is us
   (we'd get both `You have taunted X` and the emote). Guard: if
   `event.source === 'emote' && event.attacker === this.character`, skip — the self line is
   authoritative and arrives in the same second.
4. **P5's miss hate touches `avoid` events, which currently affect nothing in `threatBy`.**
   Ensure the `avoid` handler only credits when the attacker is a *tracked player*, otherwise
   every NPC miss on the tank inflates the NPC's (unused) row and, worse, `dmg`/`took` numbers
   stay untouched but `swing` moves — verify the parse card's damage column doesn't move.

### Supabase / dedup implications

- `find_or_create_encounter` dedups by **±30 min window on (guild, npc, started_at)**, so a
  re-run of an old log after these fixes **attaches to the existing encounter rather than
  duplicating it**. That is exactly the enrichment path CLAUDE.md describes for the
  `has_ability_detail` watermark.
- `merge_encounter_players` takes **max damage per player across submitters**. This is a
  double-edged guard:
  - **Protects us**: an un-upgraded agent in the raid can't drag a player's number down.
  - **Bites us**: any change that *reduces* a player's damage (e.g. correcting an over-count)
    will **not** take effect for that encounter — the older, higher row wins forever. So
    fixes that *lower* numbers are effectively one-way-blocked on historical data. All of
    P1–P4 *raise* numbers, so they propagate cleanly; the crit-semantics fix (§3-G) *lowers*
    a stat, so plan for it to only affect new encounters.
- **Phantom-player rows already in `encounter_players`** (from §3-A and §3-F) are not cleaned up
  by a re-run — the merge only adds/maxes. If we want them gone, that's a separate one-off
  cleanup keyed on names containing a space that aren't in `pet_leaders`, or single-token names
  matching `looksLikeGeneratedPetName` with zero `who_observations`.
- Threat changes (P3, P5) affect `threat_snapshot` rows only — no dedup interaction, but note
  the 6 s cadence and the 120/min per-uploader ingest budget: don't add per-event uploads.

### Effort summary

| Item | Effort | Risk | Blocks on |
|---|---|---|---|
| P1 multi-word verbs | S | Low (ordering) | — |
| P2 `has died.` | XS | None | — |
| P6 non-melee bucket | XS | Low (golden update) | — |
| P4 wildcard incoming verb | S | Medium (must stay last + gated) | — |
| P3 taunt emote | S / M | Medium (privacy filter interaction) | — |
| P8 evade wording | XS | None | — |
| P5 hate model (maxHP/15, miss, backstab) | M | Medium | a 2nd `fetchMobInfo` call site (encounter targets, not just the Zeal target) |
| P7 generated-pet suppression | M | Medium (false positives on real names) | — |
| P9 personal-active DPS | M | Low (additive payload) | bot-side card change |
| P10 article folding | S | Medium (touches every map) | — |

### Skip list — deliberately not adopting

1. **Their `X was hit by non-melee → Actor "You"` rule.** It is wrong on Quarm (damage shields
   share the shape) and would re-introduce the "credit the damage shield to the tank" error our
   own CLAUDE.md calls out. Our anonymous-then-correlate approach is better; keep it.
2. **Per-NPC `Fight` objects + merged live view.** Architecturally nicer, but it's a rewrite of
   `EncounterBuilder` and our boss-share flush heuristic (`agent:7103-7136`) already solves the
   specific problem we had (add deaths splitting a boss pull). Revisit only if we hear real
   complaints about multi-mob pulls.
3. **Class-based hate multipliers.** They ship `defaultClassMods` empty on purpose and say so
   (`assembler.go:15-21`); we should not invent them either.
4. **Their spell-DB-driven hate (SPA table, base damage, SPA 114/130 modifiers).** Correct but
   it needs the full `spells_new` table on the client. We have `spell-catalog` over HTTP but not
   the effect columns, and the per-effect port is a large, error-prone surface. Our curated
   `CAST_HATE`/`PROC_HATE`/`RESIST_HATE` maps cover the Quarm-relevant cases at ~1 % of the cost.
   Revisit only if `spell-catalog` gains effect IDs + base values.
5. **`You dodge <X>'s attack!` self-defence form (§3-I)** until verified. Our fixtures and our
   live logs use the `tries to … but … dodges!` construction; adding an unverified phrasing is
   free but so is its absence.
6. **Their `/con` bucket classifier, `/random` pairing, faction deltas, skill-ups.** Out of
   scope for combat accuracy; we already have our own or don't want them.
7. **Departure-spell hate zeroing (Evacuate/Succor/CoH).** Correct modelling, but it needs
   `cast_on_other` text matching we don't currently do and it only affects the *raid* threat
   view, which we render bot-side from `threat_snapshot` anyway.
