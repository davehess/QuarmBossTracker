# eqmimic.quest "about" — source copy lifted from wolfpack.quest/about

**Status:** scratch. Lifted 2026-10-18 so the platform story can move to the eqmimic product page
(a different repo) when the guild lead picks a guild-first `/about` variant. **Nothing was deleted from
the live page**: `web/app/about/page.tsx` (the default, no `?v=`) still carries all of it, and the two
earlier picture-led layouts are still on beta at `?v=pb` and `?v=pc` (`web/app/about/Story.tsx`).

Where to find each piece, so a port can copy the JSX instead of retyping:

| Piece | Source |
|---|---|
| Hero, chapters 01-07, stats band, close | `web/app/about/page.tsx` (the default page) |
| The same chapters, facts refreshed 2026-09-26, plus chapter 08 | `web/app/about/Story.tsx` (`chapters()`) |
| Chapter pictures (boss board, log line, parse card, follow-you, raid night, freeze week, tag strip) | `web/components/about/Figures.tsx` |
| The playable overlay miniatures and their captions | `web/components/about/OverlayDemo.tsx` |
| Scroll-reveal + counters | `web/components/about/Reveal.tsx` |
| Live numbers | RPC `about_stats()` (`supabase/migrations/20260809040000_about_stats.sql`) |

Notes for whoever ports it:
- The overlay demos use INVENTED names on purpose (see the header of `OverlayDemo.tsx`). Keep them invented.
- Counts that were refreshed on 2026-09-26: tests `4,000+`, test files `290+`, migrations `240`. They are
  hand-typed, so re-count before publishing on a new site.
- "Four pieces" = Discord bot, log parser (the agent), desktop overlays (Mimic), the website.
- The guild-facing numbers (raid size, raids on the books) stay on wolfpack.quest; on eqmimic.quest the
  honest stats are the product's own (fights recorded, damage parsed, characters followed).

---

## Hero

- Eyebrow: Wolf Pack · Project Quarm  (on eqmimic: drop the guild name, keep "Project Quarm")
- Headline: **It started as a bot that answered one question.**
- Lede: "When does the boss come back?" Everything on this site grew out of that — and out of the fact that
  EverQuest will happily tell you what just happened, as long as something is reading the log.
- Chips: 1. Discord bot · 2. log parser · 3. desktop overlays · 4. this website
- Tagline: Four pieces, built in about six weeks, still shipping. (Story.tsx: "Four pieces, five months in,
  still shipping." and "From one question to a raid platform. A Discord bot, a log reader, this website, and
  overlays on top of the game. Eight stops, five months. Tap any stop for the long version.")

## 01 · 21 April 2026 · A Discord bot, and a text file

**What the guild got.** Someone kills a boss, someone types it in Discord, and the bot does the arithmetic
nobody wants to do at 11pm — respawn windows, variance, the whole board of who is up and who is hours away.
That was the entire product. It was already worth it.

**What had to exist.** One Node process on Railway, redeploying on every push to `main`. State lived in a
JSON file on disk. Which is fine, right up until the host restarts and the file is gone. That single fact is
why the next chapter exists.

## 02 · 25 May 2026 · The agent — reading the log, on your machine

**What the guild got.** EverQuest writes everything you see to a text file. A small program watches that
file and turns it into parses, attendance, buff coverage and boss kills — with no typing, and no one having
to remember.

And not everyone has to run it. Each log sees the whole fight, so the uploads merge into one record — a raid
night here averages `{raid_avg}` raiders, and a fraction of them parsing covers everyone. The most we've seen
upload in one night is `{max_parsers}`.

Officer chat, tells and private channels are filtered out on your own PC, before anything is sent. That is a
design constraint, not a setting.

**What had to exist.** A JSON file could not hold this. Supabase (Postgres) became the memory — `{migrations}`
migrations later it still is. The bot grew an authenticated HTTP surface for uploads, and GitHub Actions
started building and publishing the agent so people could actually get it.

## 03 · 27 May 2026 · wolfpack.quest — somewhere to look at it

**What the guild got.** Parses you can open and read. Attendance that explains itself. Every character's
gear, buffs, spells and DKP. A raid guide, boards, leaderboards — and /me, where you can see exactly what we
hold on you and switch any of it off.

**What had to exist.** Next.js on Vercel, signing in through Discord, gated on guild role. Officer pages sit
behind a second check. Same Postgres as the bot, read directly — no second copy of the truth to drift.

## 04 · 31 May 2026 · Mimic — the part you see mid-fight

**What the guild got.** A desktop app that carries the agent, installs without admin rights, updates itself,
and puts overlays on top of the game: DPS, tank, triggers, charm, pets, mob info, the buff queue.

**What had to exist.** Electron bundling its own Node runtime, shipping on three separate update channels —
stable, beta, and one for Steam Deck. Releases are cut by version bump, built in CI, and pulled by the app
itself. Nobody hand-installs anything.

### The overlay demos (captions, verbatim)

Strip heading: *Three seats, three views — there's an overlay for every job in the raid. Swipe →*
(Story.tsx: *Three seats, three views. These run the way they run in a raid.*)

- **Tank overlay** (`TankOverlayDemo`): The tank bar with the CH chain landing on it, and the rampage target
  riding out the hits under Divine Aura — with the heals already in the air for the moment it drops.
- **Command Center** (`CommandCenterDemo`): Boss HP, the death-touch clock, who is being rampaged, healer
  mana lowest-first, and which clerics still have Divine Intervention — pulled from every raider's log at once.
- **CH chain** (`ChChainDemo`): The Complete Heal rotation as a rhythm game: your number comes up, you get the
  GO!, your cast bar runs, and the landing is graded. Nobody counts to ten out loud anymore.
- **Melody / Dirge board** (picture `/about/melody-dirge.png`): The real Melody overlay, rendered: a bard's
  Dirge board. Watch it run → `/mimic/dirge`
- **Loot TTS** (`LootTtsDemo`, under chapter 06): Mimic says it out loud and puts the countdowns on screen.
  Two minutes is not long when you are mid-fight, tabbed out, or not reading chat — this way the window
  reaches you anyway, and nobody misses their shot at a bid.

## 05 · the part nothing else does · It follows *you*, not one character

Every other log parser points at **one selected log file**. Change character and it is watching the wrong one
until you go and re-point it.

Mimic tails **every** character's log in your EQ folder at once and follows whoever you are actually playing.
The overlays re-aim themselves. Nothing to switch, mid-raid, with eleven people waiting.

*Which matters if you fill whatever the raid is short of:*
- **Short a healer** — Swap to the cleric and the CH chain overlay is already up, already knows your slot,
  already counting your beat.
- **Short a shaman** — The buff queue re-aims — who still needs Feral Avatar, who has a curse counter waiting
  to be cured.
- **On the bard** — See which casters are missing Lcea's, and go and stand near them.

It is also why the platform counts **people**, not character names: plenty of raiders are on a different
character by the last pull than the one they zoned in on, and everything — attendance, parses, loot — has to
know those are the same person.

## 06 · through the summer · Ticks, loot, and not missing your shot at it

**What the guild got.** Attendance records itself at 8:30, 9:30, 10:30 and 11:30 — who was actually in the
raid at that moment, written down before the live roster is overwritten. Filing the tick stays a deliberate
officer action; the record is just there so nobody gets missed, including on the nights we take the last
tick early.

Loot is read straight out of guild and raid chat — by the time an officer opens the post screen, the drops
are already listed and two clicks from being up for bids. (Pasting works too.) Each item comes back tagged
NEW if the guild has never seen it and ULTRA RARE if it has dropped once and sits in the bottom quarter of
that boss's table — checked against our own history and the drop tables, not somebody's memory.

**What had to exist.** The live raid roster is overwritten every few seconds and pruned within the hour, so
who was there at 8:30 genuinely cannot be recovered at 9:30. It has to be captured at the moment or it is
gone — that is why this is a scheduled job and not a query. Bids are sealed: encrypted at rest and readable
only by the bot, so nobody can see what anyone else put in — including whoever is running the auction.

**Bid without leaving the game.** The bid box is on the dashboard, next to the parse. Your characters come
from OpenDKP, your DKP balance is right there, and it remembers what the item last went for and what you bid
last time. Which matters when the auction opens while you are tanking.

## 07 · 18 July 2026 · And then: not breaking it

**What the guild got.** Raids happen three nights a week at a fixed time. Something that breaks at 8pm on a
Wednesday does not stop the raid — the guild raided for years without any of this — but every convenience
that fails becomes hand-work for the people already spending their evening running the night. They volunteer
their time; the platform's job is to never hand it back to them broken.

**What had to exist.** `{tests}` tests over `{test_files}` files (the default page still says 1,372 over 84),
a golden-log fixture that replays real combat through the parser, and a deploy freeze that blocks pushes
during the raid window. Plus a kill switch: the whole fleet of agents can be paused from a web page, without
anyone updating anything.

## 08 · September 2026 · Into the game itself   (Story.tsx only)

Coming to Zeal: a wolf, a skull, a number over a mob's head. **Tag marks** the whole raid sees, so a pull or
a mez target is called once, not five times, and guilds can have their own icon.

PvP fights are grouped into **fights with a history**, every death kept whoever was fighting, with the
night's videos hung on the fight they belong to.

*What had to exist:* The marks are changes to Zeal, the open-source client plugin, being tested in game
before they go to its maintainers. The fights are one table of every PvP death broadcast and a query that
groups them into waves and fights.

## Live numbers (the platform's own)

Heading: **Live numbers** — "Read from the database when this page was built. Nothing here is illustrative."

- Fights recorded (since April) · Damage parsed (since April, in millions) · Distinct bosses (since April)
- PvP broadcasts captured (kills and assists on Zek)
- /who sightings · Combat snapshots (every few seconds, per fight) · Buff landings tracked · Parse uploads
  merged (many people, one record per fight)
- Characters known · Discord members

(The raid-size tiles — a raid night's average, the most parsers in one night, raids this expansion — are the
GUILD's numbers and are used by the guild variants on wolfpack.quest instead.)

## Close

**All of it is optional, and all of it is yours.** Turn logging off and nothing is collected. Exclude a
character and it stops counting. Every line of this is open source, and the privacy page says plainly what is
kept and who can see it.

Buttons: Get Mimic · What shipped lately (/roadmap) · How it fits together (/platform/architecture) ·
Read the code ↗ (GitHub) · ☕ Tip on Ko-fi ↗
