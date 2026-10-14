# DESIGN — every class's active abilities on the HUD, and a home for `/pipe` commands (2026-10-10)

**The ask** (the guild lead, 2026-10-10): *"go through the full active ability set for every class, trained, AAs, long
recast times for certain spells. like we have with monks"* and *"make a spot for pipe commands where users can pipe
something out like my FD pipe message and trigger UI with it, like with pacify or harmony or messages that do not have
a success message like hide or sneak for non rogues."*

**Data:** `docs/data/class-abilities.json` — 281 abilities, one row each:
`class, kind (skill|disc|aa|spell), name, level, aa_cost, reuse_s, timer_group, detect, log_text, success_text,
fail_text, pipe_word, verified, source, notes`. `detect` says how Mimic can see the press: `log` (a line on use),
`success_only` / `fail_only` (only one outcome prints), `none` (no line at all — needs a `/pipe` word on the hotkey).

## Sources, and which one wins
1. **Quarm's own database dump** (`quarm_2026-09-27-22_44.tar.gz`, streamed, not saved): `aa_actions` reuse for 77 AAs
   (`reuse_source = quarm_dump_aa_actions_2026-09-27`). This wins over everything else. It corrected seven research
   values: Mend Companion 2160 s (not 4320), Divine Resurrection 129600 s / 36 h (not 72 h), Mana Burn 8640 s,
   Frenzied Burnout 4320 s, Host of the Elements 1320 s, Turn Summoned 4320 s, Project Illusion 1 s.
2. **Quarm's upstream server source** (EQMacEmu `zone/aa.cpp`, `effects.cpp`, `spells.cpp`, `client_packet.cpp`,
   `string_ids.h`, `features.h`) for message strings and hard-coded timers.
3. Our Supabase mirror (`eqemu_spells`, `eqemu_altadv_vars`) and www.pqdi.cc for levels and spell rows.
4. Wikis only where nothing above has the value; those rows are `verified: false`.

## Per class (counts: skill / disc / AA / spell)
| Class | Rows | Mix | Needs `/pipe` (no log line) |
|---|---|---|---|
| Warrior | 21 | 7 / 11 / 3 / 0 | taunt, rampage, beg, disarm |
| Monk | 25 | 13 / 10 / 2 / 0 | fd (success), beg, disarm, hide, sneak |
| Rogue | 20 | 10 / 8 / 2 / 0 | beg, disarm, pickpocket (hide/sneak print for rogues) |
| Bard | 16 | 8 / 4 / 2 / 2 | beg, hide, sneak |
| Paladin | 21 | 3 / 4 / 5 / 9 | taunt, hop (Hand of Piety), aov, steed |
| Shadow Knight | 29 | 4 / 4 / 3 / 18 | taunt, hide, steed |
| Ranger | 16 | 5 / 4 / 4 / 3 | taunt, hide, sneak |
| Beastlord | 20 | 1 / 4 / 5 / 10 | — |
| Cleric | 24 | 1 / 0 / 9 / 14 | bda, celregen, divrez, psoul |
| Druid | 17 | 1 / 0 / 7 / 9 | sotw |
| Shaman | 13 | 0 / 0 / 6 / 7 | rabid |
| Necromancer | 22 | 0 / 0 / 8 / 14 | mendpet |
| Wizard | 10 | 0 / 0 / 8 / 2 | — |
| Magician | 14 | 0 / 0 / 10 / 3 + mod rods | mendpet |
| Enchanter | 13 | 0 / 0 / 5 / 8 | — |

Every proposed word was checked against the built-ins (`fd`, `feign`, `feign death`, `mend`, `taunt`, `loh`,
`lay on hands`, `ht`, `harm touch`, `kick`, `bash`, `backstab`, `flying kick`, `round kick`, `dragon punch`,
`eagle strike`, `tiger claw`, `at`, `area taunt`, and the `aa …` / `cd …` / `mimic …` prefixes).

## Things the research says are wrong today (fix with the build)
- **Taunt — CORRECTED by the guild lead, 2026-10-10:** a successful Taunt **does** print "You taunt <mob> to ignore
  others and attack you!" on Quarm (the research read the upstream source and concluded it did not; that was wrong).
  The HUD's 5 s Taunt timer off that line is right. `/pipe taunt` adds the presses that do not land. The Area Taunt AA
  prints the same line once per mob it taunts.
- **Resisted casts still add hate** (the guild lead, 2026-10-10): the threat meter already credits a resisted
  detrimental spell with a flat proxy (`RESIST_HATE_DEFAULT` 120, per-spell overrides in `RESIST_HATE`), because a
  resist stops the effect, not the aggro. A later improvement is the spell's real base hate in place of the proxy.
- **Hand of Piety** lands with "You feel a healing touch.", the same text as Lay on Hands, so a paladin's Hand of
  Piety starts the Lay on Hands slot. Tell them apart by the begin-cast line, or `/pipe hop`.
- **Feign Death — the rank is in the Quarmy export** (AA index 100, Rapid Feign). The client button lockout is the
  real limit: 10 / 9 / 7.5 / 5 s at Rapid Feign 0 / 1 / 2 / 3 (server: 8 / 7 / 6 / 3 s). Of 8 exported monks, the
  ranks were 0 (2), 1 (1), 2 (1), 3 (4), so the current "level 59+ = 5 s" guess is wrong for half. Fix:
  `_quarmyLocalItems` keeps `aas`, `_meSkillSecs` reads index 100; with no export, use 10 s. **Mend is a constant
  289 s** (no AA changes it on Quarm). Earlier note: the monk skill is 8 s on the server (7/6/3 s with Rapid Feign 1/2/3); Mimic shows 10 s (5 s at
  59+), which may be the client button's own lockout — confirm in game before changing. **Necromancer and Shadow
  Knight Feign Death are spells** (15 s recast; begin-cast line on the press, silent success, "<Name> has fallen to
  the ground." on failure); the `fd` word must use the caster's class.
- **`/pipe` is only read while the HUD is open** (`_meNotePipeCooldowns` runs inside the `/api/me` build), and Mimic
  keeps only the last 8 pipe lines. Read them when they arrive instead, with a "newer than 5 s" guard because the
  ring replays after an agent restart.
- **Disciplines:** Quarm has `UseDiscTimerGroups` off, so **every discipline shares one timer**; the mirror's
  `recast_time` for discs is not what the server uses (base minus 54 s per level above unlock, clamped 234–4320 s).
  The existing `_ME_DISCS` table already matches the server.
- **Cancel line:** "Your ability failed. Timer has been reset." prints when an AA cast fizzles, is interrupted or is
  resisted. Clear that AA's timer on it. AA timers start at the press; spell timers start when the cast finishes.
- **Mirror gap:** `eqemu_spells` stops at id 4678, so Quarm's own spells above that (Mass Group Buff 5228, Project
  Illusion 5227, Suspended Minion 5844, Turn Summoned 8133–8135) are missing. Worth checking in the weekly import.

## Lull line (closes the open STATUS ask)
"Your target looks unaffected." is the failure for the whole Pacify / Calm / Harmony / Lull family when the mob is
above the spell's level cap or has Immune Pacify; an AE cast prints it once per mob. Resists print
"Your target resisted the <spell> spell." Harmony (unresistable) and Harmony of Nature / Lull Animal have **no success
line**: the only evidence is a begin-cast with no unaffected/resisted/fizzle/interrupt after it. Their useful timer is
the duration, not the 3–18 s recast. These are prime `/pipe` + trigger candidates.

## The pipe-commands spot (options put to the guild lead)
How a press travels: Zeal sends `/pipe` text the instant the hotkey runs (and expands `%t` to the target); Mimic
stamps it and flushes every 300 ms. `/pipe` fires on the press, not on success, so a failed Hide still starts it.
- **A — Source toggle:** a personal trigger can listen to `/pipe` text instead of log lines (`source: 'pipe'`),
  reusing timers, TTS warnings, captures and per-target timers via `%t`. ~40 agent lines, no Mimic change.
  Build Low · Maintenance Low · Runtime Low · Change Med.
- **B — Pipe commands card (recommended, on A):** a Triggers-tab home with templates from this catalog, a live
  "last thing you piped" line, a copy button for the hotkey line, and "Make a trigger" on the Info tab's pipe list.
  Build Med · Maintenance Med · Runtime Low · Change Low.
- **C — HUD chips:** user words become HUD cooldown chips. Build High · Maintenance High · Change High. Better as a
  later "also show on HUD" checkbox on B.
User triggers on a built-in word run alongside the built-in, not instead of it. Personal triggers only for now
(guild-wide pipe triggers need a bot change).

## Still unverified (rows marked `verified: false`)
A few AA buy levels (51 assumed), the Iksar Dragon Punch verb, Pick Pockets result lines, forage/fishing lines, the
bard begin-singing wording, Hide's client button timer, Turn Summoned's cast name (spell missing from the mirror),
and three AAs where the dump and live wikis differ but the dump was used (Improved Familiar, Elemental Forms,
Mana Burn).
