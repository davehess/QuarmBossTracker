# Every `/tag` shape, to try in game

*2026-09-25, for the `test-all` build (`dfe6143`): Bandolier + tag shapes (`3c02f65`) + tag
persistence. Each line below is one command to paste into EQ chat.*

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
- The text after the second `^` is the tag's label, so you can tell which command you
  are looking at.
- Walk around the mob: every shape turns to face you, and letters and numbers never
  read backwards.
- **Tags now survive a relog** (the persistence branch). When you finish, run
  `/tag clear` to clear them.

## The ones that were already there (should look unchanged)

```
/tag local ^R^red
/tag local ^O^orange
/tag local ^Y^yellow
/tag local ^G^green
/tag local ^B^blue
/tag local ^W^white
/tag local ^P^paw
/tag local ^S^stop
```

## Icons

```
/tag local ^K^skull
/tag local ^X^X
/tag local ^A^sword
/tag local ^D^diamond
/tag local ^F^flame
/tag local ^T^star
/tag local ^WP^wolf
/tag local ^M^moon mez
/tag local ^U^lasso pull
/tag local ^N^lute bard
/tag local ^H^shield tank
/tag local ^$^dollar
/tag local ^E^euro
```

## Numbered badges

```
/tag local ^1^one
/tag local ^2^two
/tag local ^3^three
/tag local ^4^four
/tag local ^5^five
/tag local ^6^six
/tag local ^7^seven
/tag local ^8^eight
/tag local ^9^nine
/tag local ^10^ten
/tag local ^11^eleven
/tag local ^12^twelve
```

## Paw with a letter or digit (a charmer's initial)

Any of `0`–`9` and `A`–`Z` after the `P`. A sample, then try your own initial:

```
/tag local ^P0^paw 0
/tag local ^P7^paw 7
/tag local ^PA^paw A
/tag local ^PK^paw K
/tag local ^PM^paw M
/tag local ^PW^paw W
/tag local ^PZ^paw Z
```

## Guilds: a banner (`B`) and an icon (`I`) for each

`/tag guilds` prints this list in game.

| Guild | Banner | Icon | Icon shows |
|---|---|---|---|
| Wolf Pack | `/tag local ^BWP^WP` | `/tag local ^IWP^WP` | the wolf (same as `^WP^`) |
| Mayhem | `/tag local ^BMAY^MAY` | `/tag local ^IMAY^MAY` | lightning bolt |
| Europa | `/tag local ^BEUR^EUR` | `/tag local ^IEUR^EUR` | euro sign (same as `^E^`) |
| Tranquility | `/tag local ^BTRQ^TRQ` | `/tag local ^ITRQ^TRQ` | lotus |
| Squirrels of War | `/tag local ^BSOW^SOW` | `/tag local ^ISOW^SOW` | acorn |
| Intervention | `/tag local ^BINT^INT` | `/tag local ^IINT^INT` | ankh |
| Erud's Crossing Guard | `/tag local ^BECG^ECG` | `/tag local ^IECG^ECG` | anchor |
| Savage | `/tag local ^BSAV^SAV` | `/tag local ^ISAV^SAV` | claw marks |
| Burnouts | `/tag local ^BBRN^BRN` | `/tag local ^IBRN^BRN` | burnt-out match |
| Former Glory | `/tag local ^BFG^FG` | `/tag local ^IFG^FG` | toppled crown |
| Axiom | `/tag local ^BAX^AX` | `/tag local ^IAX^AX` | triangle and point |
| Haven | `/tag local ^BHVN^HVN` | `/tag local ^IHVN^HVN` | house, window lit |
| Freedom | `/tag local ^BFRE^FRE` | `/tag local ^IFRE^FRE` | bird |
| Seekers of Souls | `/tag local ^BSOS^SOS` | `/tag local ^ISOS^SOS` | eye |
| Hardened Casuals | `/tag local ^BHC^HC` | `/tag local ^IHC^HC` | tankard |
| Nocturnal | `/tag local ^BNOC^NOC` | `/tag local ^INOC^NOC` | crescent moon |
| Dungeons and Dragons | `/tag local ^BDND^DND` | `/tag local ^IDND^DND` | d20 |
| Zek | `/tag local ^BZEK^ZEK` | `/tag local ^IZEK^ZEK` | war axe |
| The Drift | `/tag local ^BDRF^DRF` | `/tag local ^IDRF^DRF` | waves |
| Continuum | `/tag local ^BCON^CON` | `/tag local ^ICON^CON` | infinity |
| Eclipse | `/tag local ^BECL^ECL` | `/tag local ^IECL^ECL` | eclipse ring |
| Loot & Some Fun | `/tag local ^BLSF^LSF` | `/tag local ^ILSF^LSF` | dollar sign (same as `^$^`) |
| Novae | `/tag local ^BNOV^NOV` | `/tag local ^INOV^NOV` | starburst |
| Mass Group Ego | `/tag local ^BMGE^MGE` | `/tag local ^IMGE^MGE` | hand mirror |
| Breakfast Club | `/tag local ^BBC^BC` | `/tag local ^IBC^BC` | fried egg |
| Here There Be Monsters | `/tag local ^BHBM^HBM` | `/tag local ^IHBM^HBM` | sea serpent |
| Sentinels | `/tag local ^BSEN^SEN` | `/tag local ^ISEN^SEN` | watchtower |
| Alianza | `/tag local ^BALZ^ALZ` | `/tag local ^IALZ^ALZ` | chain links |
| Camped | `/tag local ^BCMP^CMP` | `/tag local ^ICMP^CMP` | tent |
| Convicts | `/tag local ^BCVT^CVT` | `/tag local ^ICVT^CVT` | ball and chain |

The codes also work in lower case (`^beur^`).

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
  arrow, and an icon (`^IMAY^`) as text only.

