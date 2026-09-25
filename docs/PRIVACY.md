# Wolf Pack — Privacy, in plain words

> Source of truth for the public privacy statement. Mirrored on
> `wolfpack.quest/privacy` (`web/app/privacy/page.tsx`) and linked from the
> global footer + the welcome onboarding embed. Keep this file and the page
> in sync, and change the date on both.
>
> **Rewritten 2026-09-25 from a three-part audit** (the Mimic client, the bot
> and database, the website) that checked every claim against the code and the
> live database. The previous version made several promises the software did
> not keep; the history is in `docs/DECISIONS-2026-09-21.md` §21. Rule for
> editing this file: **describe what the software does today, not what we
> intend.** A promise goes in only once the code keeps it.

*Last updated: 2026-09-25*

## The spirit

This stuff exists to make raids easier to run when things get hectic — and to
carry some of the load for the officers who prep at all hours. It is **not**
here to grade anyone. We don't track who caused a wipe, and we never will.
Parses are for coordination and a little friendly fun. Healers, tanks, DPS: a
rough night is just a rough night. It's a game. Nobody here is "not doing
enough."

## Our privacy practices — what we can promise today

Each of these was checked against the code on the date above.

- **Open source.** Every line of Mimic, the bot and this website is public on
  GitHub (github.com/davehess/QuarmBossTracker). You, or a friend who codes,
  can check anything on this page.
- **Private chat is filtered on your own PC first.** Officer chat, group chat,
  custom channels, `/say`, OOC, shouts and auctions are dropped on your machine
  before anything is sent. Tells are too, unless you turn tell relay on.
- **The sensitive things are off until you turn them on:** tell relay, crash
  reports, uploading old logs, UI backups, and attaching your log to feedback.
- **No selling, no ads, no third-party trackers.** wolfpack.quest loads no
  analytics, advertising or tracking scripts, and serves its own fonts (one
  diagram page is the exception — see *The website*).
- **Encrypted in transit and at rest.** Everything travels over HTTPS. The
  hosted database is encrypted on disk by its provider (Supabase). On Windows,
  Mimic keeps its sign-in token in Windows' own encrypted storage. Sealed bids
  made with `/wishlist` and UI backups are encrypted again inside the database.
- **Members-only means members-only on the website.** Signing in admits only
  people in our Discord with a member role. Signed-out visitors see no member
  data, get no sign-in cookie and are not logged.
- **Plain words, kept current.** This page says what the software does today,
  including the parts we are not proud of yet (next section).

## What we can't promise yet

We would rather tell you than have you find out.

- **Most data has no deletion date.** A few things expire (see *How long we keep
  it*); everything else is kept until someone asks us to remove it.
- **There is no self-serve download or delete.** You ask an officer, and it is
  done by hand.
- **Opt-outs stop future uploads, not past ones.** Switching something off does
  not delete what was already collected.
- **Other raiders' Mimic records you too.** Your own settings control your own
  Mimic, not theirs (see *What other raiders' Mimic records about you*).

## Is it a keylogger? Is it a virus?

**No — and you don't have to take our word for it.**

**What Mimic reads.** EverQuest's files, and only for EverQuest:
- your EQ log files (and any old-log folders you point it at);
- Zeal's live data feed — your HP, mana, buffs, target, pet, zone and
  position, plus your group and raid;
- your EQ and Zeal settings and UI files, and the inventory, spellbook and
  Quarmy export files you create;
- Zeal's crash files, which it summarises on your own PC;
- the folders of GINA and EQLogParser, if you have them, so it can offer to
  import your triggers;
- the list of running programs, to see whether EverQuest is running.

It **never** records keystrokes, captures your screen, or reads your browser,
passwords or clipboard. It uses a few global hotkeys you set; that is not a
keyboard hook.

**What Mimic changes on your PC.**
- Installs for your Windows user only. No admin rights, no drivers, no services.
- **Starts with Windows by default.** Turn it off: tray menu → *Start with
  Windows*.
- In your EQ folder, only when you click the button for it: installs or updates
  Zeal and UI packs, and adjusts `eqclient.ini` / `zeal.ini` (*Set up for me*).
- **On by default:** moves a large EQ log that has gone quiet into a
  `LogArchive` folder, so EQ starts a fresh one. Nothing is deleted. It also
  keeps a few local backups of `eqclient.ini`.
- Two optional buttons ask for admin through the normal Windows prompt: adding a
  Defender exclusion, and fixing the Windows clock.
- It stops another program only when you click *retire the old Parser*.
- Uninstalling removes Mimic, not the changes above that you made in your EQ
  folder.

**Who Mimic talks to:** our guild's server; GitHub (updates for Mimic, and for
Zeal and UI packs); public internet time servers (Microsoft, the NTP Pool and
Cloudflare), so raid timers line up; and, only if you sign in to OpenDKP
through it, Amazon's sign-in service, which OpenDKP uses.

**Verify it yourself:** scan the installer on VirusTotal (an unsigned installer
can trip one or two over-cautious scanners); read the code; open the local
dashboard, which shows how many items each stream is waiting to send. The
pending-upload file is plain text you can open. Your live status goes out
directly, so it never sits in that file.

The **"unknown publisher"** warning means the installer isn't code-signed. That
costs money we haven't spent; it says nothing about safety.

*The older standalone Parser (`Parser.bat`) works like Mimic, but keeps its token
in a plain-text file in your EQ folder and sets itself up to start when you log
in to Windows.*

## What leaves your PC

Nothing goes to our server until you sign Mimic in with Discord. Every upload
then carries a personal token tied to your Discord account. **Signing Mimic out
(*Disconnect*) stops every upload to our server.**

**Sent by default once you are signed in:**
- **Fights:** damage, heals and deaths for everyone in the fight, pets included.
- **Guild and raid chat** (`/gu`, `/rs`), with each speaker's class, level and
  race.
- **`/who` results:** every player shown who is level 50+ or anonymous, **from
  any guild** — name, level, class, race, guild and zone.
- **Your live status**, every few seconds while Zeal is connected: zone,
  position (x/y/z), HP, mana, buffs, target, pet and what is hitting you. This
  goes out **in or out of a raid, and even with EQ logging off**.
- **The raid roster** while you are in a raid: every raid member — including
  people from other guilds — with class, level, group, HP and position.
- Buffs and debuffs you see land; your casts; threat; guild trigger callouts;
  `/sll` lockouts; boss kills; PvP kills; faction; your PoP flags; `/random`
  rolls; what you loot.
- Your inventory, spellbook and Quarmy exports, if the files exist.
- Housekeeping: app versions, your main character, zone and a clock check.

**Only if you turn them on:** tell relay, crash reports, uploading old logs,
UI backups, and attaching your log to feedback.

**Never sent as chat:** officer chat, group chat, custom channels (including
the guild's tag channel), `/say`, OOC, shouts, auctions, and tells unless you
turn tell relay on. The one exception is a hail — see below.

## Tells

- **Off by default.** The switch is **tell relay on wolfpack.quest/me**, per
  character.
- When it is on, your tells in both directions — including **the other
  person's words** — are uploaded, stored, and sent to you as a Discord DM.
  They are never posted to a channel, and on the website only you can see them.
- The person on the other side of the tell has not agreed to this. Please keep
  that in mind before you turn it on.
- Turning relay off stops new uploads; it does not delete tells already stored.
- **Mimic's own Tells setting (Off / Local / Synced) currently changes nothing**
  — its description says tells are never uploaded and that Synced is encrypted
  with a key only you hold, and neither is true. The web switch is the one that
  counts. We are fixing the wording in Mimic.

## Hails (the one `/say` exception)

A `/say` line starting with **Hail** (*Brackwyn says, 'Hail, Seer Mal Nae'*)
gets past the filter, because hailing an NPC is how Planes of Power flags are
granted, and the game shows the confirmation only to the person who got it.
When someone **uploads old logs**, we store who hailed, up to 48 characters of
what followed "Hail", the zone, the time, and whose log saw it. Nothing else
that was said. This is evidence of a possible flag, never proof, and is shown
that way. A player greeting another player the same way ("Hail, friend") is
stored too — we can't tell them apart.

## What other raiders' Mimic records about you

Even if you never install Mimic, raiders who run it record what their game
shows them:
- your damage, heals and deaths in fights they're in;
- your guild and raid chat;
- your `/who` presence — **from any guild**, at level 50+ or anonymous;
- your HP and position while you're in a raid with them;
- buffs landing on you, your `/random` rolls, PvP kills, and hails.

Your own opt-outs don't stop this — that was a deliberate choice (the guild
lead, 2026-08-13), because the fight happened to everyone in it. If you want
something removed, ask.

## Crash reports (off by default)

Turn on *Share crash reports* in the tray menu. Mimic then sends, for each Zeal
crash: the crash details Zeal writes (including your character and zone), your
Windows version, memory and graphics card and driver, fingerprints of nine game
files, and a summary Mimic works out from the memory dump. **The memory dump
itself never leaves your PC.** Crashes older than 30 days are skipped the first
time you turn it on, but older ones can still be sent later.

## Feedback

The feedback form stores your message and, if you're signed in, your Discord id
and nickname, and reposts it to our Discord `#feedback` thread. From Mimic you
can tick *attach log*: up to 6,000 recent lines go with it, after Mimic removes
tells, group chat, officer chat and custom channels. The filter isn't perfect —
guild and raid chat stay in, and some chat can slip through when Zeal's
short-chat format is on — so **read the preview before you send**.

## The website (wolfpack.quest)

- **Signing in** uses Discord. We ask Discord who you are and which roles you
  have in our server, to check you're a member. Our sign-in provider also
  receives **your email** from Discord and stores it; we don't use it and
  never email you.
- **Sign-in records:** each signed-in session keeps your IP address and browser
  type.
- **Page views:** while signed in, each page you open is logged (the page, the
  page you came from, your browser). Officers can see how often each member
  visits and when they were last on. Signed-out visits are not logged.
- **Cookies:** the sign-in cookie (lasts up to 400 days), and two preference
  cookies for your time zone and raid layout (1 year). Other preferences stay
  in your browser. No advertising or analytics cookies.
- **Third-party requests:** none on member pages except your Discord avatar,
  which loads from Discord. The diagrams on `/platform/architecture` load
  fonts from Google. The beta mirror (`b.wolfpack.quest`) loads a Vercel
  preview script.

## Who sees what

- 🔒 **Only you** — your relayed tells; your `/me` page.
- 🛡 **You and officers** — your inventory, spellbook and quest pages. Officers
  can also upload inventory for any character. **Turning "Quests: public" on
  shows your inventory and spellbook to all members too** — it's one switch
  today.
- 🐺 **Signed-in members** — parses, DKP and bids, attendance, loot, kill
  timers, `/who` sightings, and each character's equipped gear and AAs.
  Members' Mimic can look up your current zone, HP and buffs — that's how the
  buff queue and Target Info work.
- 🛠 **Officers** — the admin pages cover all of it, including chat history,
  member page views and feedback.
- 💬 **Whoever can read the Discord channel** — relayed guild and raid chat,
  parse cards (which name deaths), the night's damage leaderboard, deathrolls,
  PvP kills and feedback.
- 👤 **Anonymous** — guild-wide totals with no names ("the Pack summoned 4,000
  stacks of food").

Your stats on `/me` only count from **when you joined us** (PvP kills are public
server events, counted from the start).

## What your switches actually do

| Switch | Where | What it does | What it doesn't do |
|---|---|---|---|
| **Exclude from stats** | `/me`, per character | Your Mimic stops uploading that character's fights, chat, buffs and similar; hidden from your `/me` stats, the raid review and the quartermaster | Stop other raiders recording it; stop your live status; delete what's stored. Uploads can slip through for a moment after Mimic starts, before it has fetched your settings |
| **Exclude inventory** | `/me` | Your Mimic stops uploading that character's inventory and spellbook; hides its gear page | Delete what was uploaded; hide the inventory and spellbook pages (you and officers still see the old data) |
| **Tell relay** | `/me` | Off by default. On: tells upload, are stored and DM'd to you | Delete past tells when turned off |
| **Quests: public** | `/me` | Shows your quests to members | …and also shows your inventory and spellbook — it's one switch |
| **Unticking a character** | Mimic's setup screen | Mimic never opens that character's log | Stop that character's live status (it comes from Zeal, not the log) |
| **Crash reports** | Mimic tray | Off by default | — |
| **Start with Windows** | Mimic tray | On by default | — |
| **Zeal update notices** | Mimic Settings | Stops the twice-a-day check for a new Zeal | — |
| **Disconnect** | Mimic | Stops everything going to our server | Delete what's stored |

## How long we keep it

| What | Kept |
|---|---|
| Who targeted what | 1 day |
| Raid roster with positions | about a day |
| Buffs and debuffs seen landing | 7 days |
| Per-hit parse detail | 7 days (the parse totals are kept) |
| Threat snapshots | 30 days is the rule; the clean-up has fallen behind, so older ones exist today |
| `/who` sightings | 60 days, plus the most recent sighting of each character, indefinitely |
| **Everything else** — chat, tells, parses, loot, rolls, crash reports, feedback, page views, sign-in records, your last live status, the Discord member list (including people who have left) | **No deletion date.** Kept until someone asks |

Two copies live outside the hosted database, both on a server the guild lead
runs (not a cloud provider):
- **Backups:** a full copy of the database every night, including sign-in
  records and emails, kept for 30 days.
- **Archive:** a permanent copy of what the hosted database deletes on the
  schedule above — positions, `/who` sightings, buffs and threat — plus chat,
  tells and page views.

Anything posted to Discord stays there until someone deletes it in Discord.

## Who else handles it

| Who | What for | What they get |
|---|---|---|
| **Supabase** | Our database and website sign-in | Everything above, including emails |
| **Railway** | Runs the Discord bot and the upload server | Everything that's uploaded passes through; its logs hold character names |
| **Vercel** | Hosts wolfpack.quest | The pages you view |
| **Discord** | Sign-in, the bot, channels and DMs | Relayed chat, parse cards, DMs, the roster |
| **GitHub** | Code, Mimic downloads and updates; a few automated jobs with database access | Downloads, and whatever those jobs read |
| **OpenDKP** (on Amazon Web Services) | Our DKP system | Character names, attendance, auctions and bids. We keep a copy of its auction and bid history, not encrypted |
| **Raid-Helper** | Raid sign-ups | Discord id, name, class, notes |
| **Microsoft** | Turns callout text into speech for the Discord voice channel | The callout text, which can name a player |
| **Public time servers** | Keep Mimic's clock right | Your IP address |
| **The guild lead's own server**, reached over **Tailscale** | Backups and the archive | Everything, as above |
| **Anthropic** (Claude AI coding assistants) | Building and fixing the platform | Those sessions can query the database, including private data such as tells, while they work |

## See it, fix it, remove it

- **See:** `/me` shows your characters, stats, tells and inventory. It doesn't
  yet show your email, page views, sign-in records, chat history, `/who`
  sightings, positions, hails, crash reports or feedback — ask and we'll pull
  them.
- **Download:** no export yet. Ask.
- **Remove:** ask an officer (or `#feedback`). We remove it from the live
  database; the nightly backups age out within 30 days; the archive copy and
  anything already posted in Discord have to be cleaned up by hand, so say if
  you want those gone too.

**That's it.** No selling, no ads, no leaderboards of who whispered whom. Just
tools to help the Pack run smoother on a crazy night.

---

## If your guild runs this — the tenant edition (2026-09-18)

Everything above applies to a deployment run for or by another guild exactly as
it applies to ours. Five rules on top, decided by the guild lead and written
into the hosted terms (`docs/TERMS-hosted.md` §5):

- **Observations made under your deployment belong to your guild** — parses,
  timers, rosters, chat relays, everything your members' clients upload.
- **Nobody operating the platform reads your guild's data without your express
  consent for a specific troubleshooting request.** Access is per incident,
  never standing; the support tooling is built so its output cannot carry your
  secrets or your members' data in the first place.
- **Anonymised aggregates only, computed inside your deployment** before
  anything leaves it — counts and totals, never names or characters.
- **Your `/who` observations are never ingested into anyone else's dataset.** A
  future per-person "be known" opt-in may let an individual publish their own
  presence; it will be that person's choice, never the guild's, and it does not
  exist today.
- **No tenant's observations are merged into another's as fact.** Observations
  can be fabricated; separation is the protection.

If you self-host under the free license, these are yours to keep for your own
members; the software is built to make them the default.
