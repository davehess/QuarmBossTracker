# Every `/tag` shape, to try in game

*2026-09-25, for the `test-all` build (`d32bed1` since 2026-09-26): Bandolier + tag shapes
(`3c02f65`) + tag persistence with player tags kept by name (`9a3fd09`) + corpse tags
(`aa975e1`) + tag pictures (`ac5d177`). Each line below is one command to paste into EQ chat.
**Each tag's text is the key you typed, then the name**, so what you see names the command.*

## Build it

In the Developer Command Prompt for VS 2022, with no inline `#` comments:

```
cd C:\dev\zeal-pr\Zeal
git fetch origin
git switch test-all
git reset --hard origin/test-all
msbuild /m /p:Configuration=Release /p:Platform=x86 /p:zeal_build_version=testall Zeal.sln
copy C:\dev\zeal-pr\Zeal\Release\Zeal.asi A:\EQ\Zeal.asi
```

## Before you start

- `/tag on`, then target any NPC.
- **`/tag local` only changes your own screen**, so nobody else sees the test.
- **A new tag on the same target replaces its shape.** You can stay on one mob and
  paste the lines one after another.
- A tag's text is capped at **32 characters, counting the `^key^`**. Only the Here
  There Be Monsters lines go over: they read "…Be Monster".
- Walk around the mob: every shape turns to face you, and letters and numbers never
  read backwards.
- **Tags survive a relog.** When you finish, run `/tag clear` to clear them.

## The ones that were already there (should look unchanged)

```
/tag local ^R^R Red
/tag local ^O^O Orange
/tag local ^Y^Y Yellow
/tag local ^G^G Green
/tag local ^B^B Blue
/tag local ^W^W White
/tag local ^P^P Paw
/tag local ^S^S Stop
```

## Icons

```
/tag local ^K^K Skull
/tag local ^X^X X
/tag local ^A^A Sword
/tag local ^D^D Diamond
/tag local ^F^F Flame
/tag local ^T^T Star
/tag local ^WP^WP Wolf
/tag local ^M^M Moon
/tag local ^U^U Lasso
/tag local ^N^N Lute
/tag local ^H^H Shield
/tag local ^$^$ Dollar
/tag local ^E^E Euro
```

## Numbered badges

```
/tag local ^1^1 #1
/tag local ^2^2 #2
/tag local ^3^3 #3
/tag local ^4^4 #4
/tag local ^5^5 #5
/tag local ^6^6 #6
/tag local ^7^7 #7
/tag local ^8^8 #8
/tag local ^9^9 #9
/tag local ^10^10 #10
/tag local ^11^11 #11
/tag local ^12^12 #12
```

## Paw with a letter or digit (a charmer's initial)

```
/tag local ^P0^P0 Paw 0
/tag local ^P1^P1 Paw 1
/tag local ^P2^P2 Paw 2
/tag local ^P3^P3 Paw 3
/tag local ^P4^P4 Paw 4
/tag local ^P5^P5 Paw 5
/tag local ^P6^P6 Paw 6
/tag local ^P7^P7 Paw 7
/tag local ^P8^P8 Paw 8
/tag local ^P9^P9 Paw 9
/tag local ^PA^PA Paw A
/tag local ^PB^PB Paw B
/tag local ^PC^PC Paw C
/tag local ^PD^PD Paw D
/tag local ^PE^PE Paw E
/tag local ^PF^PF Paw F
/tag local ^PG^PG Paw G
/tag local ^PH^PH Paw H
/tag local ^PI^PI Paw I
/tag local ^PJ^PJ Paw J
/tag local ^PK^PK Paw K
/tag local ^PL^PL Paw L
/tag local ^PM^PM Paw M
/tag local ^PN^PN Paw N
/tag local ^PO^PO Paw O
/tag local ^PP^PP Paw P
/tag local ^PQ^PQ Paw Q
/tag local ^PR^PR Paw R
/tag local ^PS^PS Paw S
/tag local ^PT^PT Paw T
/tag local ^PU^PU Paw U
/tag local ^PV^PV Paw V
/tag local ^PW^PW Paw W
/tag local ^PX^PX Paw X
/tag local ^PY^PY Paw Y
/tag local ^PZ^PZ Paw Z
```

## Guild banners (`B` + code)

`/tag guilds` prints the codes in game.

```
/tag local ^BWP^BWP Wolf Pack
/tag local ^BMAY^BMAY Mayhem
/tag local ^BEUR^BEUR Europa
/tag local ^BTRQ^BTRQ Tranquility
/tag local ^BSOW^BSOW Squirrels of War
/tag local ^BINT^BINT Intervention
/tag local ^BECG^BECG Erud's Crossing Guard
/tag local ^BSAV^BSAV Savage
/tag local ^BBRN^BBRN Burnouts
/tag local ^BFG^BFG Former Glory
/tag local ^BAX^BAX Axiom
/tag local ^BHVN^BHVN Haven
/tag local ^BFRE^BFRE Freedom
/tag local ^BSOS^BSOS Seekers of Souls
/tag local ^BHC^BHC Hardened Casuals
/tag local ^BNOC^BNOC Nocturnal
/tag local ^BDND^BDND Dungeons and Dragons
/tag local ^BZEK^BZEK Zek
/tag local ^BDRF^BDRF The Drift
/tag local ^BCON^BCON Continuum
/tag local ^BECL^BECL Eclipse
/tag local ^BLSF^BLSF Loot & Some Fun
/tag local ^BNOV^BNOV Novae
/tag local ^BMGE^BMGE Mass Group Ego
/tag local ^BBC^BBC Breakfast Club
/tag local ^BHBM^BHBM Here There Be Monsters
/tag local ^BSEN^BSEN Sentinels
/tag local ^BALZ^BALZ Alianza
/tag local ^BCMP^BCMP Camped
/tag local ^BCVT^BCVT Convicts
```

## Guild icons (`I` + code)

Wolf Pack, Europa and Loot & Some Fun show the wolf, € and $.

```
/tag local ^IWP^IWP Wolf Pack
/tag local ^IMAY^IMAY Mayhem
/tag local ^IEUR^IEUR Europa
/tag local ^ITRQ^ITRQ Tranquility
/tag local ^ISOW^ISOW Squirrels of War
/tag local ^IINT^IINT Intervention
/tag local ^IECG^IECG Erud's Crossing Guard
/tag local ^ISAV^ISAV Savage
/tag local ^IBRN^IBRN Burnouts
/tag local ^IFG^IFG Former Glory
/tag local ^IAX^IAX Axiom
/tag local ^IHVN^IHVN Haven
/tag local ^IFRE^IFRE Freedom
/tag local ^ISOS^ISOS Seekers of Souls
/tag local ^IHC^IHC Hardened Casuals
/tag local ^INOC^INOC Nocturnal
/tag local ^IDND^IDND Dungeons and Dragons
/tag local ^IZEK^IZEK Zek
/tag local ^IDRF^IDRF The Drift
/tag local ^ICON^ICON Continuum
/tag local ^IECL^IECL Eclipse
/tag local ^ILSF^ILSF Loot & Some Fun
/tag local ^INOV^INOV Novae
/tag local ^IMGE^IMGE Mass Group Ego
/tag local ^IBC^IBC Breakfast Club
/tag local ^IHBM^IHBM Here There Be Monsters
/tag local ^ISEN^ISEN Sentinels
/tag local ^IALZ^IALZ Alianza
/tag local ^ICMP^ICMP Camped
/tag local ^ICVT^ICVT Convicts
```

## Corpses (new: the `tag-corpses` branch)

1. On a **live** mob: `/tag local ^K^K Skull`. Kill it. **The skull does not appear
   on the corpse.** A marker from its life never lingers on the body.
2. Target that corpse: `/tag local ^PL^Loot`. **This one shows** (a tag set on the
   corpse itself).
3. On a **player corpse**: `/tag local ^H^Rez me`. It shows text and a shield. Try
   `/tag local Rez first` too: plain text gets the default arrow, which is on unless
   you turned it off.
4. Target something else, then `/tag target Loot`: it targets the corpse from step 2.
   The match must be the whole text, which is why step 2 has no key prefix in its
   label. A tag the mob had while alive never makes `/tag target` pick its body.

## Pictures (new: the `tag-icon-files` branch, 2026-09-26)

Setup: make the folder `A:\EQ\uifiles\zeal\tagicons` and copy in the three test files.
- `UP.png` and `UP2.tga` are in `../zeal-tag-icon-files/test-pictures/`.
- `EUR.png` (Europa's shield) was sent to you privately. It is another guild's logo, so it
  is not in the public repo.

1. `/tag icons` lists **EUR, UP, UP2** and prints the folder path.
2. `/tag local ^IUP^IUP Orientation`: a flat card above the name. **The arrow and "UP" point
   up, red is on the left and blue on the right.** Walk all the way round the mob: it keeps
   facing you and never reads backwards or upside down. If it does, tell me which way.
3. `/tag local ^IUP2^IUP2 TGA`: the same card, loaded from the `.tga` file.
4. `/tag local ^IEUR^IEUR Europa`: **Europa's shield replaces the built-in € icon.** Only
   the shield shows, with no black box around it.
5. Rename `EUR.png` to `EUR.off`, run `/tag icons`, and tag again with
   `/tag local ^IEUR^IEUR Europa`: the **built-in €** is back. Rename it back and run
   `/tag icons` again.
6. Stand where the mob is far away: the picture shrinks with distance like the text, and
   stays behind walls.
7. Put a picture on two mobs and a shape on a third: all three draw. Line them up so one
   picture sits in front of another mob's name: the see-through parts of the picture never
   blank out what is behind them.
8. Copy any JPG into the folder as `JPG.png`, run `/tag icons`, then
   `/tag local ^IJPG^IJPG Refused`: chat says "Tag picture skipped" **once**, and the tag
   shows a white arrow. Delete the file afterwards.
9. Known gap: **a picture tag does not survive a relog yet.** After a relog it comes back
   as the built-in shape, or a white arrow. The saved-tags file predates pictures.

## Tagged players keep their tags (new: `tag-persistence` `9a3fd09`, 2026-09-26)

A player's tag is kept by name, because their spawn id changes every time they zone in.

1. Tag a guildmate with `/tag local ^H^H Shield`. Ask them to zone out and straight back.
   **The shield is back over them within about a second.**
2. Zone somewhere together. **It follows them into the new zone.**
3. If they die: **the corpse has no tag. After the rez, the shield is back on them.**
4. Target them and `/tag clear`, then ask them to zone out and back: **no tag.** A clear
   sticks.
5. Your `<character>_tags.txt` in the EverQuest folder shows a tagged player as a line
   starting `-1	0`.

## Things that should NOT change

| Command | Expected |
|---|---|
| `/tag local ^Blue^Kill` | a **blue arrow**; "lue" is not a guild code |
| `/tag local ^BXYZ^x` | a blue arrow |
| `/tag local ^BC^x` | a blue arrow; Breakfast Club's banner is `^BBC^` |
| `/tag local ^W^x` | a white arrow; the wolf is only an exact `^WP^` |
| `/tag local ^L^x` | text only; `L` was the wolf's old key and is free again |
| `/tag local ^-^` | clears the shape, keeps the text |
| `/tag clear` | clears the target's tag; with no target, clears every tag |

## Other checks

- **`/tag`** with nothing after it prints the help, including the new lines for icons,
  banners and guilds.
- **Prettyprint:** with `/tag prettyprint on`, a `/tag rsay ^BEUR^x` (or gsay) reads
  "… => <name> (Banner EUR)". An icon reads "(Icon MAY)", a badge "(#7)", and a
  lettered paw "(Paw K)".
- **Tooltip:** with `/tag tooltip on`, the target window names the shape.
- **Many at once:** tag five or six mobs with different shapes. Every shape draws and
  none flickers.
- **On a client without this build:** a banner shows as a blue arrow, `^WP^` as a white
  arrow, and an icon (`^IMAY^`) or picture (`^IUP^`) as text only.
- **Prettyprint for a picture:** `/tag rsay ^IUP^x` reads "… (Picture UP)".

## Still refused: a target whose model is not drawn

"Must have a valid target with a visible nameplate to tag" still appears when the
target's model is not drawn: too far away, or not loaded yet.
- Zeal keeps a tag on the nameplate it draws, so a mob without one has nowhere to put
  it.
- Race-hidden nameplates and "names off" are different. Those mobs still have an
  entry, so they can be tagged.
