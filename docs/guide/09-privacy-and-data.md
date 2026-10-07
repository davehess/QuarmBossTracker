# Privacy and your data (for raiders and officers)

For raiders deciding whether to run Mimic, and for the officers who answer their questions. This says what the software does today. The long version is `docs/PRIVACY.md`, mirrored at `wolfpack.quest/privacy`; if they disagree, that file wins.

## The short version

- The code is public. Anyone can check any claim here.
- **Private chat is filtered on your own PC before anything is sent.**
- **Nothing goes to the guild server until you sign Mimic in with Discord.** *Disconnect* stops every upload.
- Tell relay, crash reports, uploading old logs, UI backups and attaching your log to feedback are **off until you turn them on**.
- No selling, no ads, no analytics or tracking scripts.
- The gaps, plainly: no self-serve download or delete; most data has no deletion date; an opt-out stops *future* uploads, not past ones; and other raiders' Mimic records you.

Source: `docs/PRIVACY.md`.

## What the agent reads, and what it never touches

It reads EverQuest's files, and only for EverQuest: your log files; Zeal's live feed; your EQ and Zeal settings and UI files; the inventory, spellbook and Quarmy exports you create; Zeal's crash files (summarised on your PC); the GINA and EQLogParser folders, to offer a trigger import; and the list of running programs, to see whether EverQuest is up.

It **never** records keystrokes, your screen, browser, passwords or clipboard. The 📸 feedback button photographs the screen only when you press it, and you pick which shots to send.

**Zeal** is the add-on that streams live game state out of the client: your HP, mana, buffs, target, pet, position and group and raid rosters. Without it you lose that live data; log-based features still work.

Source: `docs/PRIVACY.md`.

## What is dropped on your PC before upload

The agent drops these lines at the byte level, before they are parsed or buffered:

| Line | What happens |
|---|---|
| Officer chat, group chat, every custom channel (including the guild's tag channel), `/say`, OOC, shouts, auctions | Dropped. Never leaves your PC |
| Tells | Dropped, unless you switch on tell relay on `/me` |
| **Guild chat (`/gu`) and raid chat (`/rs`)** | **Not private.** Uploaded with each speaker's class, level and race, posted to read-only Discord channels, and stored as chat history |
| A `/say` that begins "Hail" | Passes, as evidence of a Planes of Power flag. Stored: who hailed, up to 48 characters after "Hail", the zone and the time (from old logs you upload, and live for flag NPCs) |

Source: `packages/wolfpack-logsync/index.js` (`DEFAULT_DROP_PATTERNS`); `docs/PRIVACY.md`.

## What is uploaded, and who can see it

Once you are signed in, Mimic sends:

- **Fights**: damage, heals and deaths for everyone in the fight, pets included.
- **`/who` results** at level 50 or above, or anonymous, **from any guild**.
- **Your live status** every few seconds while Zeal is connected: zone, position, HP, mana, buffs, target, pet. This goes out in or out of a raid, **even with EQ logging off**.
- **The raid roster** while you are in a raid, including other guilds' members.
- Buffs and debuffs you see land, your casts, threat, trigger callouts, lockouts, boss and PvP kills, rolls, loot, experience gained (with your group's names), and your inventory and spellbook exports.

| Who | Sees |
|---|---|
| Only you | Relayed tells; your `/me` page |
| You and officers | Inventory, spellbook and quest pages, unless you made them public |
| Signed-in members | Parses, DKP and bids, attendance, loot, `/who` sightings, equipped gear. Members' Mimic can look up your zone, HP and buffs. Your raid position shows on the raid screen |
| Anyone who can read the Discord channel | Relayed guild and raid chat, parse cards (they name deaths), PvP kills |
| Officers | The admin pages, which cover all of it, including chat history, member page views and feedback |
| Anyone, signed out | Public pages only: no member data, no cookie, no logging |

Public pages (the landing page, roadmap, privacy page, Mimic download, feedback form) show no member data. Member pages need a Discord sign-in and a member role. `/admin/*` pages need an officer role.

Source: `docs/PRIVACY.md`; `CLAUDE.md` (Web).

## Your switches, and their exact limits

| Switch (on `/me`, per character) | It does | It does **not** |
|---|---|---|
| **Hide from lists** | Removes the character from site lists; it shows only in your account inventory | Delete anything or stop uploads: it is display only |
| **Stats: EXCLUDED** | Your Mimic stops uploading that character's fights, chat and buffs; hides it on `/me`, the raid review and the quartermaster | Stop other raiders recording it, stop your live status, or delete what is stored |
| **Inventory: EXCLUDED** | Your Mimic stops uploading its inventory and spellbook | Delete earlier uploads |
| **Tells: ON** (opt in) | Uploads tells in both directions to your `/me/tells` page, with an optional Discord DM | Delete tells already stored |
| **Quest / Inventory page: PUBLIC** | Shows that page to signed-in members | Show inventory lists through the quest page |

Mimic's setup asks one question per character. **Main / alt** turns all three off. **Inventory only** is *Hide from lists*. **Hide completely** turns all three on, and that PC stops reading the log. Unticking a character in setup stops Mimic opening its log, but not its Zeal live status. Uploads can slip through briefly after Mimic starts, before it fetches your settings.

**Other raiders' Mimic still records you.** In PRIVACY.md's words: "Your own opt-outs don't stop this — that was a deliberate choice (the guild lead, 2026-08-13), because the fight happened to everyone in it. If you want something removed, ask." That covers your damage, heals and deaths in their fights, your guild and raid chat, your `/who` presence, your HP and position in a shared raid, and buffs landing on you.

Source: `docs/PRIVACY.md`; `web/app/me/ExclusionToggles.tsx`; `docs/DECISIONS-2026-09-21.md` §175.

## How long it is kept

| What | Kept |
|---|---|
| Who targeted what | 1 day |
| Raid roster with positions | About a day |
| Buffs and debuffs seen landing | 7 days |
| Per-hit parse detail (totals stay) | 7 days |
| Experience gained | 30 days |
| `/who` sightings | 60 days, plus each character's latest sighting |
| Threat snapshots | 30 days is the rule; the clean-up has fallen behind, so older rows exist |
| **Everything else**: chat, tells, parses, loot, rolls, crash reports, feedback, page views, sign-in records, your last live status | **No deletion date.** Kept until someone asks |

Two copies sit outside the hosted database, on a server the guild lead runs: a nightly backup kept 30 days (it includes sign-in records and emails) and a permanent archive of what the hosted database prunes. Anything posted to Discord stays until deleted there.

Source: `docs/PRIVACY.md`; `index.js` (nightly retention sweeps).

## Sealed bids and other handlers

Wishlist bids are encrypted with AES-256-GCM. The key lives only in the bot's environment, so officers and database admins see opaque text. Lose the key and the bids cannot be decrypted. OpenDKP's auction and bid history, which we copy, is **not** encrypted.

Other parties that handle data: Supabase, Railway, Vercel, Discord, GitHub, OpenDKP (on AWS), Raid-Helper, Microsoft (callout speech), public time servers, and Anthropic's AI coding sessions, which can query the database while they work.

Source: `utils/bidCrypto.js`; `docs/PRIVACY.md`.

## When another guild's deployment is run for them

`docs/TERMS-hosted.md` is a **draft** (written by non-lawyers) cost-share arrangement, not a product. It promises that the deployment's observations belong to that guild; that nobody operating it reads the guild's data without express consent for a specific troubleshooting request; that only anonymised aggregates computed inside it leave; that `/who` data never enters anyone else's dataset; and that on leaving, data is exported encrypted to a key the guild holds. No uptime guarantee; the deletion window and notice period are placeholders. Self-hosting needs none of this.

Source: `docs/TERMS-hosted.md`; `docs/PRIVACY.md` (tenant edition).

## Deleting your data or opting out

1. **Stop future uploads**: set the switches above, or press *Disconnect* in Mimic.
2. **See your data**: `/me` shows characters, stats, tells and inventory, but not yet your email, page views, sign-in records, chat history, `/who` sightings, positions, hails, crash reports or feedback. Ask an officer for those.
3. **Remove it**: ask an officer or post in `#feedback`. It is removed from the live database by hand. Nightly backups age out within 30 days. The archive copy and Discord posts need separate hand cleanup, so say if you want those gone too.
4. **Raid voice**: `/bristlebane optout` stops it and deletes tonight's recording of you; `/bristlebane forget` deletes every one.

⚠ The root `PrivacyPolicy.md` and `TermsOfService.md` date from April 2025 and describe only the original timer bot. Use `docs/PRIVACY.md`.

Source: `docs/PRIVACY.md`.
