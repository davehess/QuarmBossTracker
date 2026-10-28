# Buffs, debuffs, charm & healing

Buff and debuff queues, landings, charm and pets, CH chain, mez and slow. Oldest first. Find an entry by its ID in [the index](README.md); new decisions go in `inbox/` and are merged here.

## 2026-08-10/15 — CH conflict rows: one line per claimant (the guild lead, live test 2026-08-12)
*2026-08-10 · DECISIONS-2026-08-10.md · CH conflict rows show one line per claimant*

An impromptu test of the 3.5.61 ORDER CONFLICT work showed the merged row was
half a fix: `002 | Norwood / Stupidric… | 54% | NEXT` truncated both names and,
worse, drove ONE cast bar for TWO clerics — the display told you the slot was
contested but not what either of them was actually doing, which is the thing you
need mid-chain. Agent 3.5.62 renders one row per claimant, each with its own cast
timer and its own mana (claimants now store mana individually; a shared number
would print the caller's mana against the other cleric's name). The DDR grade
stays on the first row only — it grades the slot's beat, and stamping it twice
would double-count one graded cast.

## 2026-08-10/6 — Buff/debuff queue: anyone resolves, ephemeral store (guild lead, 2026-08-11)
*2026-08-10 · DECISIONS-2026-08-10.md · Anyone resolves buff queue; ephemeral store*

The two questions that were still live in `DESIGN-buff-debuff-queue.md`:
**anyone can resolve** a queue item (everyone-workflow philosophy — a wrong
resolve costs one re-enqueue; a locked resolve costs a stale queue mid-fight),
and the store is **ephemeral** (in-memory ring on the bot, ~1h TTL, trigger-relay
shape — no table, no migration). The other three questions were overtaken by
shipped code and are marked so in the design doc. Remaining build: the shared
manual layer + one-click resolve on the existing auto queues.

## 2026-08-10/8 — CH chain: show both claimants + ORDER CONFLICT; cast bar right-to-left, blue (guild lead, 2026-08-11)
*2026-08-10 · DECISIONS-2026-08-10.md · CH chain shows conflicting claimants, blue cast bar*

Two calls, both shipped in agent 3.5.61:

**Slot conflicts display, never overwrite.** Two callers on one number → both
names on the row in first-claimed order, plus an ORDER CONFLICT banner (bright
yellow letters, red outline) at the top of the CH overlay. Claimants self-evict
after 120s of silence so a corrected mis-call heals without a restart. This is
the display half of the §5 slot-stealing bug; the officer-pushed rotation stays
open as the structural fix.

**The cast bar fills RIGHT-TO-LEFT and is BLUE.** Every countdown on every
overlay fills left-to-right, so the CH cast bar ran the same direction as the
timers around it and read as one of them. It now runs the other way in its own
color: one glance tells a cast from a countdown. GO stays green (green = go);
an interrupted cast stays red-and-frozen, inheriting the right anchor so it
reads as the same bar, stopped.

## 2026-08-14/1 — The number is what makes it a CH chain
*2026-08-14 · DECISIONS-2026-08-14.md · Chain slot needs the call number*

**The call (the guild lead, live on the Aten Ha Ra pull).** a member was spot-healing the
RAMPAGE target and shouting each heal:

```
[R] [Quillon]: TUNARE'S RENEWAL Inc to Lorne - 98% Mana Left
```

Tunare's Renewal is in `CH_EQUIVALENT_SPELLS`, so the agent auto-assigned her a
chain slot the first time it saw one. She landed on **006 — where a member
actually was** — which lit the ORDER CONFLICT banner and dropped a druid who was
nowhere near the rotation into the middle of it. *"She shouldn't be placed back
onto the CH chain even though she's posting CHs."*

**Where it landed.** The auto-slot branch is gone (agent 3.5.79). An un-numbered
personal-macro shout now becomes a **spot heal**, whatever the spell is, keeping
its CH-equivalent label so the banner can read "a member spot healing (Druid CH)".
A druid who calls a number still joins the rotation exactly as before.

**Why the old reasoning was wrong, since it sounded right.** The auto-slot
existed so a rotation member who doesn't say their number out loud still keeps a
stable row (#148, 2026-07-02). The flaw: **a spot-healer shouting the same spell
is indistinguishable from that person.** One shape of evidence, two very
different situations, and the failure is silent — a corrupted rotation looks
exactly like a working one until a beat is missed.

## 2026-08-14/2 — ✕ removes someone from the chain — and keeps them off
*2026-08-14 · DECISIONS-2026-08-14.md · Remove button evicts and keeps them off chain*

**The call (the guild lead).** *"we should be able to remove from
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
  This matters more than it looks: the LAST caller owns the row, so in a member's
  own scenario she is the row's owner by the time anyone reaches for the ✕.
  Deleting the slot would have taken a member's 006 down with her.

## 2026-09-06/4 — Target Info went blank on debuffs, and 0 was the reason (live, mid-fight)
*2026-09-06 · DECISIONS-2026-09-06.md · Target Info blank because target id zero*

The guild lead, on Kaas Thox Xi Aten Ha Ra in Vex Thal: *"not seeing any of this
target's debuffs at all during this fight"* — Target Info showed three, all
"fell off", while Extended Target showed eight with live timers.

**The server was fine.** 129 `buff_casts` rows on that exact target name in 24
minutes, 17 distinct debuffs, still arriving as we looked. Not shed, not a
keying mismatch, not the ingest.

**`target_id = 0` is what did it.** Zeal reports a target id of **0** when
there is no target — it does not omit the field, which is what
`apps/mimic/main.js` still says it does — and `Number.isFinite(0)` is true, so
the id was stamped onto the row as a real spawn. `_idScopeKeep` only treated
`null` as unproven, so a requester whose Zeal DID send a real id evaluated
`0 === 592` and dropped every one of those rows.

The measurement, taken live on that boss:

| `target_id` | rows | observers |
|---|---|---|
| **0** | 111 | 13 |
| 592 | 16 | 1 |
| 153 | 7 | 1 |

The three debuffs left on screen — Boil Blood, Ignite Blood, Splurt — are
exactly the spells carried by the id-matching rows. Extended Target sends no
spawn id, so it never reaches this filter, which is why the same data rendered
correctly one overlay over.

**Blast radius was one person.** In the trailing hour exactly one client sent
real ids (a member), so only that raider saw it. That is not luck, it is the
leading edge: every raider who updates Zeal walks into it next.

**Fixed in `_idScopeKeep` (bot 3.1.123): 0 is unproven on BOTH sides.** Done in
the read path rather than the write path deliberately — it repairs the 111 rows
already stored, and needs no Mimic update.

⚠ **This overrode a test that asserted the opposite** ("spawn id 0 is a real
slot", guarding a real falsy-zero trap). The premise was wrong, and the live
data is what settles it: 13 observers wrote ONLY 0, and the one spawn-id-capable
client wrote 0 on 169 observations against 51 real ids. Nobody targets slot 0
that often. The guard is an explicit `Number(v) === 0`, never `!v`, so the trap
that test feared still cannot creep back in.

**Two follow-ups, neither shipped:**
- `apps/mimic/main.js` should map a pipe `target_id` of 0 to null at the edge,
  and its comment claiming the pipe OMITS the field is wrong — Zeal sends 0.
- The agent's `_provableTargetId` should refuse 0 for the same reason, so we
  stop writing rows that need the read-side guard at all.

## §59c — The charm break is called the moment the line is read (agent 3.7.34, beta)
*2026-09-21 · DECISIONS-2026-09-21.md · Charm break called instantly from log*

**Cause of the lag:** the Charm overlay's own call (`charm.html`) saw the break only on its 500 ms
`/api/state` poll, behind the agent's 400 ms state cache, and then held a 600 ms guard to tell an
intentional kill from a break. Worst case ~1.5 s after the line, which matches the member's "1 or 2
seconds". EQLogParser speaks straight off the log line.
**Fix:** the agent's `charm_break` handler calls `_pushCharmBreakInstant` for the player's OWN charm
(a `__self__` line, or the owner is this character), only for a live line (within 15 s of now, so a
backfill never speaks) and once per pet per 4 s (the self line and a bystander line both arrive). It
pushes a `charm` fire down the existing `/api/fires/wait` long-poll — the same path the trigger
overlay already uses, so no new route. The Charm overlay long-polls it and speaks; the trigger
overlay's `fire()` skips `charm` fires so it is never said twice; the deferred call stays as the
fallback for a break with no log line and is skipped when the instant one came (8 s). If the "Your
charm broke" suggested trigger is on with speech, the fire carries `charm_spoken` and the Charm
overlay stays quiet. **A trap it hit:** the overlay's long-poll had no floor between requests, so a
stub `fetch` that answered at once spun a test worker at 100% CPU forever
(`test/mini-popraid-charm`). It now waits 250 ms after a fast answer with nothing new. The trigger
overlay's older `waitFires` loop has the same shape and no floor; the agent holds the request 20 s,
so it is safe in practice, and it was left alone (minimal diff). Test `charm-break-instant`.

## §308 — Charm overlay "Best pets here" (agent 3.7.170 Mimic beta `f4f3b917`, bot 3.1.264 main `4ef29778`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Charm overlay lists best pets for zone*

- **The ask (the guild lead, 2026-10-14):** *"integrate a list of the better charm pets for the highest level charm a player has for the
  zone that they're in"*, pointing at a third-party pet finder. It states no licence: we took the idea only, with our own data and
  Quarm's server source for the rules.
- **Charm immunity (from EQMacEmu `Mob::IsImmuneToSpell`):** special ability 14 (Uncharmable, already `utils/mobSpecials.js` code 14);
  merchant 41, banker 40, guildmasters 20–34; Veksar at level 50+; level above the spell's SPA 22 max; body type for animal (21),
  undead (3/8/12), summoned (24/27/28) and plant (25) charms. We also drop placeholder and untargetable bodies and raid targets (the
  server's "too powerful for your charm" engage notice is not in our mirror, and a false positive costs a pull).
- **Split:** the bot serves a spell-independent candidate list per zone; the agent owns the spell, cap, body type and ranking.
- **Ranking:** damage per second (average hit ÷ swing time, `attack_delay` in tenths) in 10 % steps, then HP, then level; up to 3
  chips (summons, flurry, triple, dual wield, rampage, proc, fast) — chips only, no invented multipliers.
- **Spell:** the spellbook file (`/outputfile spellbook`, read locally) first, else the class's highest charm at its level, labelled
  "assumed from level". Class levels are PQDI's. Dictate is never assumed.
- **Not done:** Dire Charm AA; resist modelling; a Map highlight (costed in the report: medium build, colour meaning hard to retract).

## §50 — Charm overlay: server tick + mob tick (2026-09-26, agent 3.7.25 beta)
*2026-09-26 · DECISIONS-2026-09-21.md · Charm overlay shows server and mob tick*

**The guild lead:** *"charm overlay needs both server and mob tick on them (they're different, and
we can tell because of the interval the mob sees a DOT land it's non-initial damage typically. same
thing for when a charm breaks, that indicates the mob tick. the charm overlay is the priority"*.

**Shipped (beta `fff90e1e`):**
- The charm card shows two rows, **server** (blue, from Zeal's gauge 24, the HUD's source) and
  **mob** (purple). The mini keeps its voted two rows and carries both as "S 3.2 M 1.4".
- The mob tick is **learned**, per mob name:
  - **from DoT damage** ("*<mob>* has taken N damage from …"), counted only when the same source hit
    the same mob a whole number of ticks earlier — that interval is what rules out a cast-time hit;
  - **from a charm break read from the log**. A break noticed through the Zeal pet slot does not
    count: it is only seen after a 6-second grace.
- Each log line is stamped to the second, so an observation is a window from the second's start to
  when the agent read the line. Windows are intersected, and several ticks narrow the estimate
  below a second. One stray observation cannot replace a good estimate; two agreeing ones can.
- **Until a mob's tick is known, the overlay says "learning"** rather than guessing. The old
  "next mob tick" counted from the charm landing, which has no relation to the mob's tick.
- The Recharm tick timer bar (§49) now follows the learned tick, and appears once it is known.

**Limits:** keyed by name, like the other per-name trackers, so two live mobs with one name share a
tick; a death clears it, so the next spawn learns its own. Precision is capped by the second-stamped
log: at best a few hundred ms.

## §63 — #petstats feeds the Pet and Charm windows (2026-09-28, agent 3.7.35 beta)
*2026-09-28 · DECISIONS-2026-09-21.md · Pet stats feed Pet and Charm windows*

The guild lead, with a #petstats screenshot: *"We will be able to see what pets are using and build this
into the pet window and charm window for sure. This will help with haste percentage and damage
expectations, as well as negative MR of charm pets or positive stats."* #petstats is a live player command
from the PoP patch (the notes list it under New Player Commands), not a test hook.
- **What the agent reads:** the block the server prints into the owner's log: pet HP, AC, ATK, damage range
  and average, attack delay, melee DPS, the five resists (signed, so a Tashed pet shows negative MR) and
  21 equipment slots. `applyPetSheetLine` in the agent, per owner, a 3-second line window, lines that do
  not belong skipped. It rides `/api/state` as `sheet` on the petHealth row that both `pets.html` and
  `charm.html` already read, only when the sheet's pet is the row's pet. Local only, like all pet state.
- **Haste is "observed":** the catalog carries no NPC attack delay, so haste is measured against the
  slowest delay seen for that pet. A pet first read while slowed over-states its later haste.
- **Charmed mobs expire, summoned pets keep:** a sheet for an "a/an/the" name expires with the 30-minute
  pet TTL, because the next mob of that name is a different mob. A proper-named summoned pet keeps it.
- **Display is not built.** Overlay rule: options first. Pending the guild lead's pick.
- An equipped slot's exact wording has not been seen yet (the screenshot's pet wore nothing), so the
  parser stores the text after the slot name as it comes.

## §75 — Bard charm: the class comes from Zeal; the recharm callout speaks; clicky buffs on the pet (2026-09-29, agent 3.7.39–3.7.40 beta)
*2026-09-29 · DECISIONS-2026-09-21.md · Bard charm class, recharm callout, clickies*

The guild lead, a bard holding Dragen Faux under Solon's Bewitching Bravura: *"why is bard charm tracking not
working?"*, *"a character's class is output by zeal pipes, on top of us knowing their class. we shouldn't
need to rely on anything else"*, *"I SOWed my pet using my sow sword clicky and it did not register, and i
did not get a recharm pet tts at 4 seconds left"*, *"i'm not hearing the recharm pet tts, where is that"*.
- **Class from Zeal:** a pet with no a/an/the only counts as a charm when the owner is a bard or a charm
  was just cast. The bard test read /who and the raid roster only. `_classOf()` now reads Zeal's class
  label (3) first, then /who, then the raid roster; the charm test and the melody overlay's bard checks
  use it (both also read a `zealSt.class` that was never filled in).
- **Recharm:** a charm opened from the gauge had no duration, so the tracker showed "~" and kept its
  callouts quiet. A bard's charm now takes the duration of the charm song in their twist, else Solon's
  Bewitching Bravura. The bard last call now says **"recharm pet" at 4s left** (was "recharm now" at
  3.1s); "charm breaking" at 12s and the user-set "recharm warn at N s" (setup bar, seconds since the
  charm, 0 = off) are unchanged.
- **Clicky:** "Your Blood Orchid Katana begins to glow." logs no "You begin casting", and SoW's landing
  text on another target is shared by five spells, so the pet's SoW stayed "SOW (?)". The glow line now
  records the item's click spell as a self-cast.
- Tests: `bard-charm-zeal-class` (real agent, fake clock), mutation-checked.

## §128 — Mark of the Plague Lords turns the shield OFF; a Boastful Bellow timer; Fading Memories answered (2026-10-02, bot 3.1.188 · web 1.8.75 · agent 3.7.69 beta `a66d208d`)
*2026-10-02 · DECISIONS-2026-09-21.md · Plague Lords mark turns damage shield off*

The guild lead, with a screenshot of the debuff on a tank whose HUD still read "DS 23": *"how long does
faded memories last for? Note that this debuff exists for damage shield reduction and should be reflected in
the hud and overlays"* — then, mid-session: *"add Boastful Bellow AA as a timer for Bards that have the AA"*.

- **The debuff is not a reduction, it is an off switch.** Mark of the Plague Lords (spell 1067: SPA 59
  base **+50**, 3m12s, PBAE range 50, unresistable) reads "Decrease Damage Shield by 50" in game, but the
  Quarm server's spell-bonus sum (`zone/bonuses.cpp`, `SE_DamageShield`) lets a positive value REPLACE the
  shields already summed, and skips any shield after it. A positive total then runs the "healing shield"
  branch of `Mob::DamageShield` (`zone/attack.cpp`): **each melee hit that lands on the wearer heals the
  attacker 50**, and item and AA shields never get added (they only join a negative total). So the HUD's
  "DS 23" was wrong twice: the shield returns nothing, and the mob is being fed. Mark of Karn (+6, a cleric's
  spell on a mob) is the same mechanic pointed the other way. Nine catalog spells carry a positive SPA 59.
- **Where it landed.** The bot's spell catalog carries the positive value as `ds_heal` beside `ds` (it used
  to drop it as an "NPC guard mechanic"). The agent's `_dsOffFrom` reads it off any buff list; while one is up
  `_knownDsPerHitFor` is 0 (so the anonymous-hit settle stops crediting shield hits), `/api/me` and
  `/api/tank-state` carry `off` {name, heals, seconds}. HUD: the DS button goes red, dashed, "DS OFF" with
  the time left. Tank overlay: the card leads with the debuff and its time, says "each hit heals the mob 50",
  and strikes the worn shields through; the mini box reads "DS OFF" in red. One design, in the family the
  thorns/lava button already set; the alternative was a struck-through number that kept the shield's value,
  rejected because it reads as "still 23, slightly less".
- **Boastful Bellow.** Reuse **18 s** (Quarm `aa_actions` row for AA 592, spell 3282 — a 10–50 magic nuke
  with a short stun). It is instant, and the server sends the begin-cast only when `cast_time > 0`
  (`zone/spells.cpp`), so no "You begin casting" line exists. Started by the resist line ("Your target
  resisted the Boastful Bellow spell.", seen only by the caster), or by "<mob> is shaken by a loud bellow."
  paired within 1.5 s with your own "You hit <mob> for N points of non-melee damage." — the landing alone is
  seen by every bard near the mob, and raids run several. Bards only. An early press's refusal line corrects
  the same timer rather than opening a second AA slot. The HUD shows **BB** once a bard has used it (the
  pipe does not carry AAs owned — use is the proof), kept 12 hours past ready like the other timers. The
  Triggers tab has a "Boastful Bellow reuse" timer bar, off until ticked, per character.
- **Fading Memories (the question).** It has **no duration**. It is the bard PoP AA (6 points, one rank),
  costs **900 mana**, and its reuse is **1 second** (`aa_actions` aaid 630: reuse_time 1, nonspell_mana 900,
  nonspell_duration 0). The server runs `Escape()` (`zone/client.cpp`): you are wiped from every NPC's hate
  list and made **invisible** — ordinary invisibility, held until you break it (attack, cast, and so on), not
  a timed buff. A rogue gets hide instead. Mana is the limit, not a timer.

**Not done:** the sibling path in the raid card's spell decode (`_spellFxMap` takes `Math.abs` of SPA 59, so
a positive value would read as a shield there) — left alone, it never sees the Mark today; the bundled
local-mode spell snapshot gains `ds_heal` only when it is next regenerated.

## §149 — Buffs grouped by raid group, on /buffs and in the buff queue (2026-10-04, bot 3.1.195 · web beta · Mimic beta)
*2026-10-04 · DECISIONS-2026-09-21.md · Buffs grouped by raid group*

The guild lead: *"we should be grouping people for buffs on https://wolfpack.quest/buffs — treat that like the
buff queue as well"*.

- **The rule everything rests on:** in this era a GROUP buff lands on the CASTER'S OWN group (no Target
  Group Buff before Omens of War; Quarm's behaviour unverified, and the wording is right either way). So a
  hint only ever names a caster IN the group that is short ("Haste ×4 → Corvale: Vallon's Quickening"), or
  says nobody there can ("no enchanter in G3", meaning single-target it or move someone). Never "an
  enchanter somewhere in the raid".
- **Bot 3.1.195 (live):**
  - `raid-buff-queue` gains `groups[]`, built from every raid member before the 40-row caps, plus
    `self_group` and per-line `classes`. Pure builder: `utils/buffGroups.js`.
  - `GROUP_SPELLS` (`utils/raidBuffs.js`): the group version of each line per class, with the level it
    needs. A caster is named for the best spell their level allows. All 28 ids verified in
    `eqemu_spells`: targettype 41, except Kazad`s Mark, which is 3.
- **Keyword gaps fixed** (they read as "missing" before):
  - the Marzin / Naltron / Kazad marks;
  - Focus of the Seventh, Vallon's Quickening, Spirit of Bih`Li (the backtick never matched), Spirit of
    Eagle;
  - Spirit of the Predator, Spiritual Vigor (attack) and Spiritual Dominion (mana regen, verified by its
    effects);
  - Boon of the Clear Mind, Maelstrom of Ro and Aegis of Ro.
  - Comments corrected: Aegolism, Temperance and POTC are single-target; Khura's Focusing is group.
- **Website, beta previews** (default page unchanged):
  - [b.wolfpack.quest/buffs?v=b](https://b.wolfpack.quest/buffs?v=b) — **Group cards: one card per raid
    group**, each saying who's short and who in that group can cast it.
  - [?v=c](https://b.wolfpack.quest/buffs?v=c) — **Buff lines: one section per buff**, listing the groups
    that need it.
  - Both split by raid first: two raids both have a group 1.
  - Fixed for all three views: the freshest roster row wins. A regroup used to show a stale group for up
    to 15 minutes.
  - `web/lib/buffGroups.ts` carries the same `GROUP_SPELLS`; a test fails if the two tables differ.
- **Mimic beta (the buff queue overlay):**
  - a **By buff | By group** switch;
  - By group puts your group first, with the caster hints;
  - By buff clusters each buff's people by group;
  - mini adds the group that needs each buff most.
- **Open, for the guild lead:** pick ?v=b or ?v=c.
- **"Ungrouped" settled from Zeal's source** (2026-10-04, §150's research): `named_pipe.cpp` sends
  `"0"` for `kRaidUngrouped` and `GroupNumber + 1` otherwise, so groups are 1–12 and 0 is ungrouped,
  which is what all three surfaces already assume.
- **Left alone, on purpose:**
  - Spiritual Purity sits in HP slot C though it is a regen buff;
  - `UPGRADE_CHAINS` still spells Bih`Li without the backtick;
  - Mark of the Predator is uncategorized.

## §157 — A buff-block picker in Mimic for Quarm's `#blockbuff` (2026-10-04, agent 3.7.79 on beta)
*2026-10-04 · DECISIONS-2026-09-21.md · Buff-block picker for blockbuff*

**Shipped to beta** as `f1b9a4e2`: a Buff blocks tab on the dashboard. The agent side has
`logsync.buffblocks.json`, `GET /api/buffblocks`, `POST /api/buffblocks/{sets,state,socials}`, and the
`_bb*` helpers. It reuses `_applyIniKeyEditsToFile` behind `_charLooksLoggedIn`. Tests are in
`test/buff-blocks.test.js` (44). The details below are the research and the calls behind it.

Quarm added three player commands (patch notes Oct 2–4): `#blockbuff <id>` (alone, it lists your blocks),
`#blockbuffif <id> <active id>` and `#allowbuff <id> [active id]`. Blocks live on the character, server-side.

- **The ask (the guild lead):** *"start building out a picker for this on mimic so that people can see their own
  sets of block and allow lists buffs and make some for any of the songs that are bards use some monks can
  toggle them off while pulling and toggle them back on when they're in camp"*.
- **The delivery call (the guild lead):** *"mimic builds the copy for the player or makes a hotkey if desired if
  the user is currently logged in on next log out update the social"*. So:
  - Mimic shows the command lines to copy.
  - On request, it writes Block and Allow socials into `<Char>_pq.proj.ini`, five lines each.
  - While the character is logged in, the write is queued until logout. It uses the agent's existing
    web-edit gate (no Zeal sample for 2 min, log idle 90 s) and its key-level ini writer.
- **Why nothing else:** Quarm rule 3 forbids software "interacting with the game client", and Zeal's pipe is
  outbound only (`named_pipe.cpp`, `PIPE_ACCESS_OUTBOUND`). Mimic never types into the game.
- **Alternative, not built:** Zeal's page-10 social keybinds (Zeal 1.4.4+) re-read
  `Page10Button<N>Line1-5` from the ini on every press (`page10_binds.cpp` `execute_social`). That would
  make a live write work without a logout, after a one-time keybind setup. Still five lines per key, and keys
  can't chain.
- **Unknowns, which shape v1:**
  - The server's reply text for all three commands is in no public source. The upstream EQMacEmu has only
    a stub `IsBlockedBuff()`. v1 records what the player's sets did and reads nothing from the log.
  - A real `#blockbuff` reply, pasted by anyone, unlocks a list parser beside `parseSllLine`.
  - Upstream calls `AddHealAggro` before buff slotting (`zone/spells.cpp`). A blocked song may still put
    the bard on the hate list of the monk's pull. A live test is needed before anyone relies on the pulling
    set.
  - Block cap: undocumented. EQEmu's analogue is 20, so the UI warns past 20.
- **Data:** 66 bard songs that land on others, from `eqemu_spells`. Skills 12/41/49/54/70, good effect,
  group/AE/single targets. Levels from PQDI, since `spell_class_levels` has no bard rows. Starter sets:
  "Pulling: bard twist (L47+)" (20 ids), "every rank" (40), "No bard run speed" (717, 2605, 1750, 1330), and
  a `#blockbuffif` damage-shield pair.

## §183 — Another raider's charm pet is credited from its own fresh, single "My leader is" line (2026-10-07, agent 3.7.100 beta, FB-52, FB-22)
*2026-10-07 · DECISIONS-2026-09-21.md · Other raider's charm pet credited*

- **Found in the report's log:** the pet answered its owner's /pet leader nine times in ten minutes, and the agent
  parsed every one; the meter still showed "(charmed)" because `_publishLiveThreat` refuses `petLeaders` for
  article-prefixed names. That refusal is right on its own — `petLeaders` never forgets, and one revenant claim once
  labelled every revenant all raid (2026-07-31) — but for anyone except the owner the pet's public line is the only
  proof there is.
- **The call:** keep the claim WITH ITS TIME and credit it only while it is fresh (no earlier than 15 minutes before
  the pull, the bot's own number for the same lines) and unambiguous (one raider claims that name in the window).
  Two claimants (the three-revenants night) stay "(charmed)", crediting nobody. It ranks below every proof the
  agent holds itself, and a charm-break line ends it.
- **The 📋 copy line folds pets into owners** with EQLogParser's `+Pets` mark, so each owner's line carries their
  pet and the lines add up to the header.
- **Open — the upload (the guild lead's call):**
  - **A — Meter only:** the claim credits the owner on everyone's live meter and local History; the guild's settled
    numbers still miss a pet whose owner runs no Mimic. As shipped.
  - **B — Upload too:** `_provenPets` also sends fresh single claims as `pet_leaders`, so the settled parse credits
    that owner. It changes durable, bot-visible data, and a wrong claim would be stored, not just shown.

## §209 — Charm sessions record the spell and whether the charm ran its course (2026-10-09, bot · agent beta · migration `20261009010000`, NOT applied)
*2026-10-09 · DECISIONS-2026-09-21.md · Charm sessions record spell and outcome*

**The ask** (the guild lead, 2026-10-08, *"A plus B's instrumentation"*): enchanters say charms break early, and we could not
say how long each charm spell lasts when nothing interferes, so the warning cannot be set per spell. This is the collecting
half only; no warning, no page, no threshold changes here.
- **The data finding.** Over the last 30 days, enchanter `charm_sessions` rows with `end_reason = 'charm_break'` have a median
  `duration_sec` of **36 s (n = 285)** against spells that last 6 to 12 minutes. That number cannot be used for per-spell
  warnings, and two things make it unusable rather than merely noisy: (1) the sessions carry no spell at all; (2) `duration_sec`
  is the gap between the agent's `lastEvent` at the land and at the break, and `lastEvent` is advanced only by combat events
  (the charm handlers `return` before the line that sets it), so it measures the time between two fights' last blows, not the
  charm. The old rows stay as they are; nothing is backfilled or recomputed.
- **What the log can and cannot say.** `Your charm spell has worn off.` is the spell-fades line: it prints for a natural fade
  and for a resist break alike. So `end_reason` keeps its two values (`charm_break`, `encounter_flush`) and is NOT split into
  `expired` / `resisted`; a guess there would put a number on a chart that looks like a measurement.
- **What is collected instead.** Agent (beta): each session gains `spell` (the staged cast name, lower-cased as in the agent's
  charm table, null if the cast was not seen) and `ran_full` (lived at least 90% of that spell's max duration, null when
  unknown). `ran_full` is timed from the land line's and the break line's own timestamps. It is null when the owner recast
  mid-session (the span covers two spells), when another charmer took the mob (the break line was never seen), and when the
  encounter flushed short; a flush that already reached 90% is still true. Every existing field and value is untouched.
- **Bot:** `charm_sessions.spell_name text` and `ran_full boolean`, both nullable, no default, `IF NOT EXISTS`. The upsert
  writes `spell_name` only when it is a non-empty string of 80 characters or fewer and `ran_full` only when it is a real
  boolean (`utils/charmSession.js`); an older agent that sends neither writes two nulls, so nothing changes for it. The bot
  validates no `end_reason` allow-list today, so there was none to extend.
- **Order matters: apply the migration BEFORE the bot reaches `main`.** The upsert now names both columns; without them every
  charm-carrying encounter's `charm_sessions` write fails and is swallowed by the catch-warn, the same silent failure that
  left the table uncreated until 2026-07-13 (migration 20260713123000). The migration is not applied by this change.
- **Read it as:** per spell, the share of sessions with `ran_full = true` among those with a known spell, and the duration
  of the true ones. Sessions older than the agent change, and every row from an agent that has not updated, stay null and are
  simply not in the sample. Do not read null as "broke early".
- **Found on the way, not fixed (outside this change):** the same-owner recast branch of the charm-land handler tests
  `pcSpell.dur || pcSpell.cls`, but `_consumePendingCharmSpell` returns `charm_class` / `duration_sec`, so that test is never
  true and a recast never refreshes the charm overlay's timer. The new `ran_full` handling keys off the consumed spell instead,
  so it is not affected.
- Tests: `test/charm-session-ran-full.test.js` (agent, beta), `test/charm-session-spell-ran-full.test.js` (bot; mutation-checked).

## §212 — "Your target looks unaffected." is the too-high-level lull message; it drops the phantom timer (2026-10-09, agent + Mimic Target Info, `beta`)
*2026-10-09 · DECISIONS-2026-09-21.md · Unaffected lull message drops phantom timer*

**The evidence** (the guild lead, 2026-10-09, in-game screenshot): Pacify on a level-58 mob that is NOT ability-31 immune
printed `Your target looks unaffected.` in red, twice, while Target Info kept a Pacify bar "56/60 · 5:33". That is the phantom
timer the Harmony policy in CLAUDE.md predicted, and the string `docs/STATUS.md` had been waiting on. The guild lead's note:
*"This mob doesn't say if it can or can't be lulled or pacified"*, so the catalog gives no warning before the cast.
- **The call.** The line carries no target and no spell, so it is attributed to the newest own cast, and only when that cast
  is a lull-family spell (`_isPacifySpell`, the existing set) and the line falls within the spell's cast time plus 4 seconds
  (cast time from the spell catalog, capped at 6 s). After any other cast, with no cast, or later, it does nothing to lull state.
  An invented or broader match was rejected: other spells may print the same words.
- **What it does.** (a) Withdraws that spell's row from the cast's target (the Zeal target when "You begin casting" printed, a
  provably different spawn id excepted, an older separate landing left alone), clears the pending revert, and removes the
  caster's own copy from the not-yet-uploaded `buff_casts` batch. (b) Remembers "unaffected by <spell>, cast at level N" per mob
  name + zone bucket (the Mob Info cache key) for the session; it is not written to the mob-info zone packs, which are shared
  catalog data. (c) `buildMobInfo` returns `target_lull`: `{verdict:'immune'}` (ability 31, which always wins),
  `{verdict:'unaffected', spell, caster_level, at_ms}`, or null.
- **Target Info.** An amber "Pacify: unaffected" chip on the Stats chip row; the tooltip carries the spell, the level, the time
  and "too high a level for that spell, or immune. Try a stronger lull." so the row stays byte-stable between polls. The
  "Immune Pacify" chip already existed (ability 31 on `mob.specials`, blue) and was not duplicated. Unknown draws nothing.
- **Not built.** A green "Lull OK" (`landed`): the agent only holds landings while they are active, and a landing line is not
  proof the lull worked (the screenshot's bar was one), so a "worked" verdict would be an invention. Needs a signal first.
- **Accepted limits.** (1) The mirror already uploaded to other raiders before the line arrived is not retracted (it is
  withdrawn only if still in the batch; a flush can beat the line). (2) Only the caster's agent sees the line. (3) Not known
  whether AE lulls print it once per mob. (4) A different, stronger lull cast later is not auto-cleared; the chip names the
  spell it was learned from.
- **CLAUDE.md** (Harmony policy) now names the captured string instead of "a message we have not captured".
- **Shipped:** agent 3.7.124 on `beta` (`10901c15`). Same day, agent 3.7.123: the Loot tab's platinum values always carry one
  decimal, matching web 1.8.132 (*"we need consistent sig figs on this. either show a decimal or not."*).
- Tests: `test/lull-unaffected.test.js` (the cast-then-line, non-lull cast, 10 s late, other raiders, immune-wins, zone bucket,
  the chip, and the call sites; mutation-checked).

## §265 — Songs sung from /melody count as cast, so their landings reach Target Info (2026-10-13, agent 3.7.152 beta `133a2548`)
*2026-10-13 · DECISIONS-2026-09-21.md · Melody-sung songs count as cast for landings*

- **The ask** (the guild lead): *"Pacify songs like Silent Song of Quelius should show on the target info."*
- **Cause:** Quarm logs no "You begin singing X." for songs queued by `/melody`, and `resolveSelfCastLanding` only
  attributes a landing ("A gnoll appears at ease.") to a cast it saw. Silent Song of Quellious (3361) was already a
  known pacify and Target Info already draws pacifies (blue "aggro reduced"); the cast was the missing link.
- **Fix:** during an active `/melody`, Zeal's casting label changing to a song is recorded as that cast (a
  `'[] You begin singing X.'` stand-in through `noteSelfCast`, the shape the clicky path already uses). Every melody
  song, not only pacifies. Test: `test/melody-song-landing.test.js`.
- **Left:** the song lasts 12 s (+6 s linger); if a pulse does not re-print its landing line the row may flap. Not seen
  in game yet.

## §266 — A mez or charm you cast goes on the timers at any length (2026-10-13, agent 3.7.153 beta `2f4504b5`)
*2026-10-13 · DECISIONS-2026-09-21.md · Own mez and charm always show on timers*

- **The ask** (the guild lead, bard melody screenshot): *"a mez you cast should end up on the timers, same for charm."*
- **Cause:** the built-in spell timers drop anything under 30 s, and a bard mez (Dreams of Terris) is 18 s.
- **Fix:** mez (catalog `cc` includes `mez`) and charm spells you cast show at any length. Mez gets its own group
  ("Mezzes" on the Canvas), charm keeps its own, and a new suggested-timer switch "Mez and charm you cast" turns them
  on. "Your X spell has worn off." ends a mez bar early. Tests: `test/timer-bars-and-trigger-fixes.test.js`.

## §268 — A pet keeps its buffs across a zone, and after Suspended Minion 2 (2026-10-13, agent 3.7.154 beta `c7599927`)
*2026-10-13 · DECISIONS-2026-09-21.md · Pet keeps buffs across zoning and suspend*

- **The report** (FB-77, a member): *"Pets lose their buffs on their pet overlay (and timers) when zoning."* Its log:
  Visions of Grandeur on an enchanter animation, a zone, then `/pet health` still listing the buff. Closed by the
  beta test commit `4de9185e` (`Fixes FB-77`).
- **The rule** (the guild lead): *"when you suspend with your second level of the AA it keeps its buffs. When you
  suspend with 1 it removes the buffs and you get back a fresh pet with no timers."*
- **Cause:** `_reconcilePetIdentity` dropped a pet's buffs whenever its Zeal spawn id changed (added for same-named
  re-charms, 2026-08-31). A spawn id is a slot in the zone's entity table, so every zone gave the same pet a new
  id. It only bit on Zeal builds that send `pet_id`.
- **Fix:** a new id after the owner zoned keeps the buffs. In the same zone (an unsuspended pet) the buffs are kept
  only at Suspended Minion rank 2, read from the owner's Quarmy export (eqmac AA 176 = `eqemu_altadv_vars` skill 526).
  Rank 1, or no export: fresh pet, as before. A different pet name is still a new pet. Test:
  `test/pet-buff-landing.test.js`.
- **Known edges:** rank 1 + suspend + zone + unsuspend keeps buffs it should not (indistinguishable from a zone). At
  rank 2, re-charming a same-named mob in the same zone keeps the old buffs until `/pet health` or the charm-land clear
  reconciles. No suspend log line is used: we have not captured Quarm's wording, so none is invented.
- **Confirm in game:** the agent log prints `[pet] … kept its buffs` on the new path, and `dropped the previous pet's
  buffs` on the old one.

## §269 — A charm land keeps what is on the mob; an NPC's cast is timed at its level (2026-10-13, agent 3.7.155 beta `2bb282ec`)
*2026-10-13 · DECISIONS-2026-09-21.md · Charm land keeps mob buffs; NPC cast timing*

- **The call** (the guild lead): *"Charm landing should not clear buffs and debuffs if we have the timers and know the
  focus effects and the AAs of the caster. If it is done via an NPC we treat it as that level mob's cast timer."*
- **Shipped:**
  - Re-charming the same spawn after a break keeps the pet's buffs (the charm tracker remembers the spawn id).
    Another spawn of the same name, or no id, still starts clean: a same-named mob cannot be ruled out.
  - A pre-charm debuff proven by spawn id to be on this mob carries over at any age while its timer runs. One proven
    on another spawn never does. An unproven one keeps the 60 s window (the razorfiend case in the code comment).
  - A landing an NPC provably cast (it began casting inside 15 s and the spell is in its own list, one known level)
    is timed at that NPC's level instead of the era cap of 65.
- **Not shipped, and why: the caster's duration focus and AAs.** We apply neither today. Item focus is computable:
  `eqemu_items.focus_effect` → the Extended Enhancement line (SPA 128, +15%, with a max spell level), read off the
  caster's Quarmy-exported gear. AA duration is not: `eqemu_aa_effects` has one row per AA and no rank, so Spell
  Casting Reinforcement's per-rank values cannot be read from our data, and its effect id collides with another AA.
  Both only stretch BENEFICIAL spells, so pre-charm debuffs are unaffected; buffs cast on the pet after the charm are
  where it shows (they read as falling off early). Next step needs a verified per-rank table (EQMacEmu source or a
  measured Zeal remaining-ticks reading, which the agent already records per character in `buffDurationFactorFor`).
- **Test:** `test/charm-keeps-buffs.test.js`.

## §270 — Your own and your pet's buff timers pause while you are logged out, and live in the database (2026-10-13, agent 3.7.156 beta `deaf08e1`, bot 3.1.257 main `e7fe036c`)
*2026-10-13 · DECISIONS-2026-09-21.md · Buff timers pause on logout, stored in database*

- **The call** (the guild lead): *"My buffs on my pet and myself should pause if I log out … synced to the database so
  if I logged on from a different machine or if my installation failed I would still have those buff timers.
  Conversely, if I logged back in to reclaim a charmed pet or kill a buffed/debuffed mob those timers should continue
  to tick while the server is online."*
- **Self buffs needed nothing:** after login Zeal reports the client's own remaining ticks. The log-derived timers were
  the wrong ones: the pet's (`_petBuffLandings`) and the entries under your own and your summoned pet's name.
- **Pause:** the agent remembers each character's last log line. "Welcome to EverQuest!" after a gap of a minute or
  more moves every still-running own/summoned-pet entry forward by the gap. A charmed pet and every NPC key keep
  ticking; an expired or worn-off entry is never revived. While logged out nothing prunes those entries (they read
  against the frozen clock), across an agent restart too. The pet's new spawn id after login is not a new pet.
- **Database:** `POST/GET /api/agent/own-timers`, one `bot_kv` row per character (`own_timers:<name>`, service-role
  only, no migration), same ownership rule as `/character-prefs`. Sent after a pet buff lands, after a resume, on a
  wipe and at logout; a PC that has never seen the character pulls it on first sight. Local mode, dry run and
  `exclude_from_stats` send nothing. Self-host note: a few hundred bytes per character, one row each.
- **Known edges:** no Welcome line seen (agent off at login) → nothing shifts; a standalone agent with no Zeal and a
  quiet log reads as offline until the next line; the Timers canvas still counts own spells on the wall clock while
  logged out (it catches up at the resume).
- **Tests:** `test/own-timers-pause.test.js`, `test/own-timers-endpoint.test.js`.

## §276 — Requiem of Time is a slow, called out as "Bard Slow (55%)" (2026-10-13, agent 3.7.160 beta `34657c5c`)
*2026-10-13 · DECISIONS-2026-09-21.md · Requiem of Time recognised as bard slow*

- **The call** (the guild lead, with the spell window): *"Requiem of Time is a slow as well, call out Bard Slow
  (55%)"*. It was on none of the slow lists, so it had no badge, no timeline mark and no callouts.
- **Grounded:** spell 3066, SPA 11 max 45 = 55%. Its land line, "<mob>'s rhythm slows.", is its own, so a
  bystander knows which slow landed.
- **Shipped:** the agent's three slow tables (badge "BRD SLOW 55%"), Mimic Extended Target's copy, and the raid
  review's list. Callouts name it "Bard Slow": "Slowed <mob> — Bard Slow (55%)", spoken "Slowed. Bard Slow".
  Every other slow keeps its spell name.
- **Not added (not asked):** the other bard slows, Selo's Consonant Chain (40%) and the two Largo's bindings (35%).
  Both Largo's share one land line, so they would read as "slowed" without a name. Also still missing from the raid
  review: the four Beastlord slows, which the agent and Extended Target have carried since 2026-10-08.

## §286 — Map rings for mez, pacify and harmony; the re-slow warning a minute ahead, never for bards (2026-10-13, agent 3.7.161 beta `ad36ffbe`)
*2026-10-13 · DECISIONS-2026-09-21.md · Map rings for mez, pacify; re-slow warning*

- Built per §284. `_mapCcStates` (agent) sends each mob's mez and calm state from the existing buff landings;
  `map.html` draws: mezzed = pulsing "zzz"; pacify family (incl. bard lulls) = light-pink disc, outer band filling
  red clockwise from 12 o'clock as it runs out; Harmony / Wake of Tranquility = the normal red ring at the shrunk
  radius, old radius dotted, same band. Durations are each landing's own, so bard lulls end sooner on their own.
  A landing with no spawn id marks only your own target (an unproven name never turns every same-name mob pink).
- **Guess, flagged:** the harmony shrink is 0.5 of the aggro radius; the spell data carries no radius. The guild
  lead to measure or confirm in game.
- **Not knowable:** a mez broken by damage, or a pacify that failed on a too-high mob, has no log line; the ring
  holds until the landing's own end.
- **Slow warning (§284's in-fight rule):** "re-slow soon" fires at 60 s left (was 30) and never for a bard slow
  (`SLOW_FADING_WARN_SECS`, `best.cls !== 'BRD'`). Every slow LANDING still announces, as before; whether those
  go quiet during a fight is the guild lead's call.

## §349 — Same-name mobs: a debuff belongs to one spawn; Map helper NPCs get no ring (2026-10-16, agent 3.7.187 beta, bot 3.1.285)
*2026-10-16 · DECISIONS-2026-09-21.md · Debuffs tracked per spawn for same-name mobs*

- **FB-83** (the guild lead): *"We're clearly not putting the right debuffs on the right mobs - this one had Tepid
  Deeds display but it was not actually slowed."* Several "A War Boar" were up at once. Two faults: the slow tracker
  was keyed by mob NAME (one boar's slow showed on all of them), and a landing line names only the mob TYPE, yet the
  agent stamped the observer's current target id on any landing whose name matched it. So boar B's slow was
  recorded as boar A's, as proven fact.
- **The rule now:** a landing carries a spawn id only for our OWN cast (the target captured when we cast it) or for a
  named mob (no "a/an/the" in front, so one spawn). A generic bystander landing stays id-less. Readers that know the
  spawn treat an id'd entry as certain for that spawn and excluded for any other; an id-less entry on a generic name
  shows as uncertain ("SLOW?" dimmed, "slowed?", a "?" on Target Info's effect chip) and never as fact. Old Zeal (no
  spawn id) behaves as before. `_landingTargetId` in the agent; `test/slow-by-spawn.test.js`.
- **Map helper NPCs** (the guild lead: *"These emotes show up as red"*): body types 65 (traps, voices), 66
  (invisible men, zone controllers) and 67 (scripted spawners, emote NPCs) go out with no aggro or faction ring
  (`utils/zoneSpawns.js`, bot 3.1.285). Race 127 alone is not the test — real fighters use it.

## §417 — The CH chain reads a chain tool's setup line (2026-10-23, agent 4.0.13–4.0.14 beta)
*2026-10-23 · DECISIONS-2026-09-21.md · CH chain reads other tool's setup line*

Another guild's raid: `D&D 111 CH - <target> - 84%` calls (4.0.13) and the tool's `set_chain: 111 <name>, 222 <name>, … set_delay: 3`
(4.0.14) — the order seats the slots through the original roster path, and set_delay is the declared beat until one is measured.
Hard rule kept: *"DO NOT disrupt the shout ones for wolf pack"* — the Wolf Pack snapshot is byte-identical (golden test).
