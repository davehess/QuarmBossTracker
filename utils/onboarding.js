// utils/onboarding.js — Per-member onboarding state, DB-backed (2026-05-30+).
// State lives in public.member_onboarding_state ((guild_id, discord_id) PK).
// In-memory cache mirrors the table so existing sync callers (isOptedOut etc.)
// don't have to await. Writes go to cache + DB via write-through.
//
// Previous design stored salted-SHA256 hashes in a hidden embed inside
// ONBOARDING_THREAD_ID — that was the privacy mitigation when state lived in a
// Discord channel. Now that we have service-role-only RLS, plain discord_id is
// fine (we already store it in characters.discord_id and wolfpack_members.discord_id).
// On startup, if the DB table is empty but a legacy thread embed exists, we
// preserve the old per-user "opted-out at version" for that user (under their
// plain discord_id) so nothing is lost in the cutover.
const crypto        = require('crypto');
const { EmbedBuilder } = require('discord.js');

const REGISTRY_TITLE     = '📋 Onboarding Opt-Out Registry';
const INSTRUCTIONS_TITLE = '📖 Wolf Pack Raid Tracker — Quick Start';

// In-memory cache: discord_id → { last_seen_version, opted_out }
// Mirrors member_onboarding_state. Sync getters read from here; setters
// write here AND fire-and-forget the upsert to the DB.
let _state              = {};
let _instructionsMsgId  = null;
let _supabaseEnabled    = false;

// ── Changelog — focus + difference bullets, per minor/patch release ──────────
// Add a new entry every release. Keep each line short — these surface as the
// "what's new since you last looked" diff on /onboarding and the rejoin DM.
// changesSince() uses semver-aware compare, so two-digit minor/patch (e.g.
// "2.5.39") sorts correctly above "2.5.9".
const CHANGELOGS = {
  '3.0.147': [
    '**🌀 PoP Flags (Preview) — wolfpack.quest/pop.** The guild\'s road to Quarm as a live progression chart: every zone gate by tier (modeled on the classic Samanna chart), how many of us hold each flag, who can enter each zone TODAY, and a **raid-night planner** that ranks what to run next by how many raiders each kill pushes through a later gate ("Kill Saryrn → +9 into Sol Ro"). Counts fill automatically from the flag grants agents already detect — nothing to do but raid with Mimic running once PoP unlocks 2026-10-01. The progression catalog was re-verified against the classic sources and two draft errors fixed (Terris Thule gates **Torment**; Manaetic Behemoth gates **Tactics**); gates marked * get confirmed against Quarm\'s documented QoL changes at launch.',
  ],
  '3.0.146': [
    '**Guild chat stops renaming people.** The Adiwen/Wabumkin-posted-as-Starrburst bug (also Jankzer→Dant, Fargan→Bardtholemu): EQ keeps writing your OLD character\'s log file after you swap characters, so your own machine attributed everything you said to the previous character — and its upload usually beat everyone else\'s correct copy to Discord. Three layers of fix: agents 3.2.2+ ask Zeal (which always knows your real character) before trusting a log filename, prefer the server-authoritative "X tells the guild" form when their own logs disagree, and the bot now **edits an already-posted message to the right name within seconds** when a corroborating copy arrives. Bonus fixes: cross-machine corroboration had never actually worked (clock skew between machines broke the matching), the wrong character\'s class tag can no longer decorate a relabeled name, and two people genuinely typing the same thing ("111") both show up instead of the second being swallowed.',
  ],
  '3.0.145': [
    '**/who history stops hoarding — 60% smaller, no info lost.** who_observations had never been pruned (170k rows / 102MB, back to Nov 2023) — one row per player per minute per uploader, mostly redundant. It now keeps the last 60 days of raw sightings (needed for the ±3-min Zek-proximity inference and the ±15-min raid-attendance reconstruction on /admin/encounters + /admin/signups) and, before that, only each character\'s single latest sighting. The /who directory still lists every character ever seen with their last-known class/level/guild/Zek status — all 10,193 of them survived the cleanup — we just dropped 101k duplicate historical rows and sweep nightly going forward (`WHO_OBS_RETENTION_DAYS`).',
  ],
  '3.0.144': [
    '**✉ Mimic Mail + efficiency round 2.** Officers get `/admin/notices` on wolfpack.quest: publish a notice and every running Mimic (1.6+) shows a **pulsing mail icon** on its dashboard within ~90 seconds — mark **critical** and the bot also posts it to Discord within a minute. Works on every future Mimic version with zero further plumbing, so "update before Sunday" style alerts always reach people. Efficiency: the two hottest agent endpoints (buff queue + Extended Target) now compute once per ~2s for the whole raid instead of once per agent (~20× less database traffic), the shaman burst query is cached, and the long-deprecated era-thread chat routing + `/initerathreads` command are gone. Paired with Mimic 1.6.0 (beta): every overlay skips repainting unchanged frames, the melody overlay stops fetching the full state 6×/second, agent log-line parsing got cheap pre-filters across the board, the trigger relay stops polling 24/7 when nobody is playing, and agent.log rotates instead of growing forever.',
  ],
  '3.0.143': [
    '**"✓ cured" — clear stuck cure needs by hand.** When neither the afflicted player nor the curer runs Mimic, no agent can see the cure land, so the curse/poison/disease chip sat on everyone\'s buff-queue overlay until the debuff\'s full catalog duration ran out. Now every chip on an **inferred** row (🔍 = that player isn\'t uploading) has a ✓ button — one click by ANY Mimic user clears it from the whole raid\'s queues within a few seconds. Safeties: Mimic-verified players can\'t be hand-cleared (their own Zeal list is the truth), and if the debuff LANDS AGAIN after the click, the chip comes right back. Needs Mimic 1.5.4+ to see the button; the clear itself works raid-wide immediately (Uilnayar 2026-07-07).',
  ],
  '3.0.142': [
    '**buff_casts stops hoarding — 73% of the table purged, zero user-visible change.** The buff-landing history table had grown to 118MB/232k rows, but every consumer (Mob Info target-buffs, buff/cure queue, Extended Target debuffs, /raid) reads at most **3 hours** back — live "who has what buff" comes from each character\'s own Zeal snapshot, not this table. Purged: 41k rows with no spell name (written but unreadable — now rejected at ingest), 10k phantom **"Kneel Test"** rows (EQEmu\'s internal test spell shares its landing text with 33 knockback effects and kept winning the ambiguous-match), and everything older than 7 days including a Jan-2025 backfill. The midnight chain now sweeps buff_casts to a rolling 7 days (`BUFF_CASTS_RETENTION_DAYS`). Agents 3.1.107+ also stop generating both junk classes at the source.',
  ],
  '3.0.141': [
    '**Faster everything — first fixes from the 2026-07-07 efficiency review.** The `/fun` page had slowed to a crawl: its ~25 counter queries ran one-after-another, and two of them scanned tables that have been growing all along (chat_messages hit 284k rows — the Tunare counter alone cost ~3s; the dirge counter shipped 20k rows of ability data per view AND silently under-counted). All counters now load in parallel with the heavy two moved into indexed SQL (measured 1.5s → 18ms on Tunare). Bot side: the buff queue stops fetching every parked character\'s buffs on every poll, state.json is parsed once instead of on every read (the who-lookup endpoint re-parsed it up to 80× per request), and a missing endpoint agents had been polling for weeks now exists — **cross-client Main Tank HP/buffs on the Tank overlay actually work now** (the "MT runs Mimic → use their real HP" path had silently never fired).',
  ],
  '3.0.140': [
    '**UI Studio comes to wolfpack.quest — `/me/ui`.** Your backed-up UI layouts and **social macros**, viewable and editable from anywhere: edit or add a macro on the web, and Mimic on the machine that plays that character applies it to the ini automatically once the character is **logged out** (safe from EQ\'s camp-time ini rewrite; needs Mimic 1.5.2+). Also on the page: the guild\'s **common-macro library** — any macro carried by 3+ characters (below that your macros stay private) — and the same suggested-macro catalog that ships in Mimic\'s UI Studio (CH chain call, DA announce, bard stopsong→click→melody clickies…). Macro data comes from your UI Studio backups: run Mimic → UI Studio → ☁ Backup once per character to fill it in (Uilnayar 2026-07-06).',
  ],
  '3.0.139': [
    '**Overlay thresholds are now live-tunable — no redeploy, no Mimic update.** Officers get a new `/admin/overlays` page on wolfpack.quest with the knobs that keep needing raid-time adjustment: Extended Target hurt %, hurt-duration, stale-mob grace, off-tank freshness, same-name split tolerance, plus (with Mimic 1.5.0+) the off-heal hurt cutoff and CH-chain GO! flash duration. Changes reach the bot within ~60s and every running Mimic within ~90s. Empty field = built-in default; values clamp to safe ranges (Uilnayar 2026-07-06).',
  ],
  '3.0.138': [
    '**Extended Target actually declutters now — mobs + hurt allies only.** The 3.0.137 fix that was supposed to keep full-health raiders off the bar quietly did nothing: the guild-roster lookup it relied on threw on every call (a missing `require`) and always came back empty, so every raider a healer targeted got misread as a named NPC, cached, and replayed as a full-health "corpse" — the bar filled with 20+ people at "100%". Fixed the lookup, and tightened the rule: **only mobs get a row** (allies surface only when actually hurt, <85%, via the heal-alert pass), since Zeal reports full HP as 99.9% and the old "under 100%" cut matched literally everyone. Also: our own pets (`<Name>\'s warder`) are recognized as pets not mobs, **corpses/dead mobs are dropped**, and a killed mob clears in 90s instead of lingering 5 minutes (Uilnayar 2026-07-06).',
  ],
  '3.0.137': [
    '**Extended Target: full-health players and pets stop cluttering the bar** — the overlay is meant to show mobs and allies who need attention, but a healer targeting a full-HP tank (or a pet at 100%) was surfacing that ally as its own row. Now players and pets only earn a row when they\'re actually below 100% HP; mobs always show. Also fixes raiders who\'d briefly dropped out of the live-state window being misread as named NPCs and appearing as full-health "mobs" — the durable guild roster is now consulted so a known character is always classified as a player (Uilnayar 2026-07-06).',
  ],
  '3.0.136': [
    '**Our own instanced boss kills stop disappearing** — when a Wolf Pack member killed a boss in an instance and *didn\'t run Mimic* (and no Mimic guildmate was in the instance), the kill vanished completely: no #pvp post, no /pvp/hate entry, nothing recorded (Timberr\'s Lord of Ire kill was the report). The bot was dropping our own `(Instanced)` kill echoes on the assumption a Mimic already had them. Now they post an informational notice to #pvp and record to /pvp/hate like any other instance kill — but they still **never** tick the open-world respawn timer, since an instance has its own private spawn (Uilnayar 2026-07-05). *(Needs Mimic 1.4.4+ on at least one guildmate in the instance to relay the kill.)*',
  ],
  '3.0.135': [
    '**Extended Target: off-tanked mobs stop vanishing from the board** — a mob nobody currently targets used to disappear instantly, even mid-fight (a brief targeting gap, someone glancing elsewhere). A previously-targeted mob that was last seen hurt now stays on the board for a grace window instead of dropping off. Also lays the groundwork for surfacing mobs held at 100% HP by an off-tank (Emperor Ssraeshza-style fights where an add is deliberately never damaged) — full support lands with the next Mimic update.',
  ],
  '3.0.134': [
    '**Extended Target overlay stops splitting real targets into fake duplicates** — a single named boss/player was sometimes showing up as two rows ("★1/2", "★2/2") just because two raiders\' agents reported slightly different HP% for it at that instant. HP-based splitting is now only used for genuinely ambiguous generic mob names ("a wolf" etc.) where two same-named spawns really can coexist — a unique player, pet, or named NPC always collapses to one row with the median reported HP.',
  ],
  '3.0.131': [
    '**PvP backfill no longer floods #pvp** — an agent\'s `--since` backfill run mines historical PvP kills from old logs same as it does chat and combat, but the relay was posting every single one live to #pvp as if it just happened, instead of only recording it. A single backfill could dump dozens of months-old kill/death notices into the channel at once. Backfilled kills still get recorded to the ledger and stats (who-observations, fun-event counters, boss-kill history) — they just don\'t replay into Discord or seed the live respawn-timer prediction anymore, matching how historical chat backfill already works (Uilnayar 2026-07-01).',
  ],
  '3.0.130': [
    '**No more phantom "a" character on parses** — a charmed pet that itself owned a summoned sub-pet (e.g. a charmed "a Shadel Bandit") could have that sub-pet\'s damage misattributed to a bogus character literally named "a" on the parse breakdown, both from agent uploads and from pasted EQLogParser text. That damage now correctly falls out as unattributed rather than showing up as a fake player (Uilnayar 2026-07-01).',
  ],
  '3.0.127': [
    '**Dead bosses stop showing as "Engaged" on /parses.** A kill now registers the moment ANY raider\'s agent sees the boss\'s slain line — so a boss whose death line your own client happened to miss no longer lingers in the *Engaged now* section forever. As a backstop, the bot also promotes a still-engaged fight to a confirmed kill when **loot was posted** for that boss (via `/loot`) and there\'s **no other mob of the same name** up in the window (so we never guess which of two same-name mobs died). Runs automatically; clears the backlog within ~30 min of a deploy (Uilnayar 2026-06-29).',
  ],
  '3.0.125': [
    '**Mimic v1.1 line is rolling on beta — three pieces to try.** (1.1.1) Mimic **scans your machine** for GINA + EQ Log Parser libraries on first run and shows what it found (file count, last touched, fingerprint guess like *"looks like Safe Space + custom"*). Visibility only — nothing leaves your dashboard. (1.1.2) every trigger fire now shows three buttons below the alert: **« Earlier · ✓ Good! · » Too early**. Vote on whether the timing was right; the agent\'s durable queue ships your vote up so a momentary disconnect never loses it. (1.1.3) Officers see those votes aggregated on `/admin/triggers` with a per-trigger **recommendation chip** (≥3 votes, ≥60% consensus). Subsequent betas import your high-fidelity triggers (Fittir & co.) and watch which ones actually fire — promotable to the guild pack with one click.',
  ],
  '3.0.123': [
    '**Days since Moash died to enrage** counter — Shavimo\'s hand-typed \"It has been ~~167~~ 0 days since Moash died to enrage\" gag now has a real /fun card. Officers log the moment with **/enragedeath player:<name> [boss:<name>]** and the counter resets to 0, the last-death date renders in bold, the previous record strikes through automatically when a new death breaks it. Generic enough to track anyone, but Moash is the headline (Uilnayar 2026-06-26).',
  ],
  '3.0.122': [
    '**Chat dedup catches drunk slurs + filter censoring** — EQ randomises consonants in a drunk player\'s broadcast PER receiver, so when 5 agents witness "FUCK ZERG" they each report a different mutation ("Esev ZERG", "Ljyu ZERG", "Nnqj ZERG"…), and Discord used to get every variant. The bot now fuzzy-dedups: same speaker + same word count + ≥50% identical token positions ⇒ same line, only the first variant gets relayed. Same fix covers the censor filter (\'f**k zerg\' vs \'fuck zerg\' from a filter-on vs filter-off receiver). New on /fun: **🤬 Pottymouth award** (asterisk redactions caught by the chat filter) and **🍺 Drunkard award** (≥2 distinct slur variants of the same line = confirmed slurred by EQ).',
  ],
  '3.0.121': [
    '**Mimic auto-loads inventory + spellbook** — just like your combat logs flow into wolfpack.quest, your `/outputfile inventory` and `/outputfile spellbook` snapshots now upload on their own whenever you (re-)run the commands. Mimic 1.0.78+ (logsync 3.1.67+) watches the EQ folder for `<Char>-Inventory.txt` and `<Char>-Spellbook.txt` and ships the parsed rows on every file change; reruns over the same content no-op. Quarmy was already doing this; this just adds the other two. Honors the same `exclude_inventory` opt-out on /me as Quarmy — flip that off if you don\'t want gear surfaced. (Inventory page + key inference next.)',
  ],
  '3.0.120': [
    '**Chat misattribution safeguard** — if your agent is tailing a stray/old log (an `eqlog_OldName` file left in the folder Mimic watches), your guild chat used to post under that wrong name (Wabumkin → "Dopefiend"/"Facehack", etc). The bot now only trusts a guild-chat speaker that is in our roster, is one of your linked characters, or is independently confirmed by another raider\'s agent — otherwise it relabels to the corroborated real name. Officers get a new **Chat speaker misattribution** card in the review queue pointing at the exact machine + stray log to clean up. Existing mislabeled lines were scrubbed.',
  ],
  '3.0.119': [
    '**Chat relay attributes the real speaker** — when a player\'s log file is named after a previous character ("eqlog_Dopefiend_pq.proj.txt" while you\'re actually playing Wabumkin), every guild/raid line you typed used to relay under the old name (you saw your own lines as Dopefiend / Facehack / etc). Fixed by cross-checking against the other agents in raid: when at least one of them sees "Wabumkin tells the guild" (the third-person broadcast every other client receives), that wins over your local "You say..." line. No agent update required — works at the bot.',
  ],
  '3.0.118': [
    '**Parse integrity — session blobs no longer pollute fights** — a parser occasionally uploaded a whole raid session as one "encounter" (30m–2h, everyone who did any damage in the zone). Merged into a real ~3min boss kill, that wrongly credited parked alts and passers-by (e.g. a name showing up on a fight they weren\'t in). The bot now drops any parse longer than 30 minutes, and the merge ignores blob uploads when a normal-length parse exists. Cleaned up the existing affected encounters too.',
  ],
  '3.0.117': [
    '**Foreign-guild instance kills surface in #pvp again** — fixed a bug where `(Instanced)` PvE echoes were dropped for every guild, not just our own. Now own-guild echoes still suppress (they\'re already announced via Druzzil) but foreign-guild instance kills (e.g. *Oakin of <Zek> has killed Terror in Plane of Fear (Instanced)!*) post as informational `☠️` notices in #pvp and land on /pvp/hate so you can see who\'s contesting / friend the killer. Open-world timers still tick only on open-world kills.',
    '**PvP boss timer board** sorts open ("camp now") rows by most recent kill so fresh activity floats to the top; pending rows still sort soonest-spawn first.',
  ],
  '3.0.92': [
    '**Trash announces stay trash** — `/announce <zone>` with a note containing "trash" (e.g. *TRASH LOOT!*) no longer adds the zone\'s bosses as kill targets — no boss cards, kill buttons, or auto-tracked timers. The takedown still posts the zone, time, and note for the run.',
  ],
  '3.0.73': [
    '**One-tap Mimic downloads** — `/parsehelp` (and the public `/postparsehelp` board) now has **🐺 Download Mimic** and **Beta** buttons that link straight to the installer .exe of the latest release on each channel — no landing page hop. Resolved live from GitHub, so they always point at the newest build.',
  ],
  '3.0.70': [
    '**/raid got sharper** — the raider card now breaks Resists into all five schools (so a missing Group Resist Magic shows even when Circle of Seasons is up), shows landed bard **songs** separately, auto-refreshes every 15s, and hides parked characters unseen >15 min (toggle to show). The buffer queue flags the specific resist school your class covers. Mimic 1.0.69 betas add "Buffs n/15 · Songs n/6" to Mob Info for player targets.',
  ],
  '3.0.68': [
    '**Quarmy gear ingest** — drop your in-game Quarmy export (`<Name>Quarmy.txt`) in the EQ folder and Mimic ships your equipped gear, clicky bags, and AA ranks to a new **Gear (beta)** page on your character at wolfpack.quest. Bank, shared bank, and coin rows are stripped on YOUR machine before anything uploads — they never leave it. `exclude_inventory` on /me opts a character out entirely (no file read, no upload).',
  ],
  '3.0.51': [
    '**/who directory on wolfpack.quest** (officers) — every character ever seen in a `/who`, sortable + filterable, with inline class fill-in for `/anon` rows and a Zek flag toggle. Web-set class/Zek now flows back to the bot (and `/markzek` writes to the web), so `/whois` + PvP auto-zek stay in sync.',
    '**PvP fixes** — a guild **instance** Lord of Ire kill no longer mis-fires the PvP announce or double-records a PvP timer (only the real PvE instance timer is set). And a **quake** now keeps every PvP boss\'s kill date + latest spawn but opens the **earliest spawn to "available now"** instead of wiping the window.',
  ],
  '3.0.40': [
    '**Voice ripcord on /admin/voice** — officer page to flip the bot\'s voice triggers off, swap the default voice, adjust volume (0–200%), and add per-message or per-trigger-name skip rules. Takes effect within ~30s (bot caches the row). The text-relay surface keeps working when voice is muted. Two raid call-out drafts ship in `guild_triggers` (Emperor Ssra tank-buster countdown + Divine Intervention save) as DISABLED — verify the regex patterns on the next pull and flip them on from /admin/triggers.',
  ],
  '3.0.39': [
    '**Bot speaks in voice now** — agent triggers marked `mode: \'voice\'` will have the bot join `RAID_VOICE_CHANNEL_ID` and read the message aloud via Microsoft Edge\'s free TTS (no API key, several US/UK voices). Connect-on-demand, idle out after 5 minutes of silence — no permanent presence in voice. Officers can verify the chain with `/voicetest`; pick the raid channel, the off-night channel (`OFFNIGHT_VOICE_CHANNEL_ID`), and a voice. Requires the bot role to have **Connect** + **Speak** on the channel.',
  ],
  '3.0.14': [
    '**Triggers can now pipe into Discord** — boss **rampage callouts** (and any trigger with a Discord action) post straight to a channel, so the whole raid sees "🔥 RAMPAGE → \\<target>" without everyone needing the overlay. Every raider\'s agent fires it, but the bot collapses the duplicates so the channel only shows one line per rampage. Officers: set `TRIGGER_BROADCAST_CHANNEL_ID` to turn it on (it\'s off until a channel is configured). This is the first piece of a bigger event-driven trigger system coming to Mimic.',
  ],
  '3.0.11': [
    '**New Mimic Parser install + `/parsehelp`** — the desktop app now signs you in with Discord on first run (no token to copy/paste — it links your account and starts uploading for you), auto-detects your EQ folder, and installs with no admin prompt. Run `/parsehelp` for the full walkthrough, or grab it at wolfpack.quest/mimic. Officers can broadcast the steps to a channel with `/postparsehelp`.',
  ],
  '3.0.9': [
    '**Per-user Parser tokens** — the shared `WOLFPACK_AGENT_TOKEN` is gone. Every uploader (Mimic install or standalone agent) now uses their OWN token tied to their Discord account, so we can trace every row back to a specific person and revoke individuals without breaking everyone. Run `/token` in Discord to see your active sessions, mint a fresh token, or revoke one that\'s no longer yours. New Mimic versions will mint a token automatically the first time you sign in; until you update, paste your `/token` value into Mimic\'s settings (or `--token` on the standalone agent). Old shared-secret uploads are now rejected — if your agent stopped working, that\'s why.',
  ],
  '3.0.8': [
    '**Kill timers now require a confirmed death line** — the agent used to flag a parse as a kill whenever combat ended (death event OR 120s of silence, then "guess the boss = top-damaged target"). Pull-and-flee fights, wipes, and short pulls were getting registered as kills and moving the boards. Now timers only advance when the agent literally saw "<Boss> has been slain by ..." in the log. Parses still record for stats; only the timer side is gated. Update Mimic (or the standalone agent) to pick up the change. If you see leftover false timers from before this patch, `/unkill <boss>` clears them.',
  ],
  '3.0.6': [
    '**Feedback form on the website** — wolfpack.quest/feedback lets anyone drop a bug, idea, or kudos right from the browser (no Discord needed). Each one auto-posts into the #feedback thread just like `/feedback`, and shows up in the officer triage inbox with everything else. We read every one. 🐺',
  ],
  '3.0.5': [
    '**No more pet/vendor spam in your tell DMs** — pet command acks ("Attacking <mob> Master.") and Bazaar merchant quotes ("That\'ll be N platinum for the X") are no longer relayed as `/tell` DMs (they ride the tell channel but aren\'t real tells). Filtered both at the source and on the bot, so it takes effect immediately even on older agents.',
  ],
  '3.0.4': [
    '**New: the Buffs page** (wolfpack.quest/buffs) — a guild-wide buff-coverage grid so buffers can see at a glance who\'s missing HP / haste / mana / regen / DS / resists, with a class filter and per-role "what good looks like" targets that flag gaps in red. Powered by the Zeal feed, so it\'s only accurate for people running Mimic / the agent (the page says so up top). Buffs we don\'t recognize land in an "Other" column — send those names so we can map them.',
    '**Overnight PvP board is now a howl** — the `/pvpnightpings` opt-in board got the wolf treatment ("howling through the night"); the wolves on the list are shown right on it.',
  ],
  '3.0.3': [
    '**Overnight PvP pings are now opt-in** — between **1am–8am Eastern** the automated `@PVP` pings no longer hit the whole role; they go only to people who clocked in. Run `/pvpnightpings` to drop the opt-in board in the PvP channel: 🌙 *ping me tonight* (auto-clears at 8am), 📌 *always ping me overnight*, or 🔕 *stop*. Manual `/pvpalert` & `/pvpspawn` rallies still ping everyone.',
  ],
  '3.0.2': [
    '**PvP quiet hours** — automated `@PVP` pings (timer spawn alerts + live kill/death broadcasts) are now muted overnight (default **1am–8am Eastern**) so nobody gets woken at 3am. The cards still post for history; only the role ping is dropped. Manual `/pvpalert` and `/pvpspawn` rallies are unaffected. Window is configurable via `PVP_QUIET_START` / `PVP_QUIET_END`.',
  ],
  '3.0.1': [
    '**Your buffs + last-seen zone now show on wolfpack.quest/me** — Mimic syncs what each of your characters is carrying (buffs/songs) and the zone they were last seen in, straight from the Zeal pipe. Each character on /me gets a new "Buffs & Zone" panel; open localhost:7777 for live, second-by-second timers. A snapshot that updates when things change — nothing to turn on beyond running the parser with Zeal.',
    '**Mimic overlays got friendlier** — overlays now start OFF on a fresh install (turn on the DPS HUD / triggers / charm from first-run setup or the tray), each overlay has an ✕ in its corner to dismiss it, and the tray\'s Overlays menu gained named panel toggles (Healing, Tanking, Threat, Top Damage, DEEPS). Plus a live pet HP bar on the charm tracker. Update Mimic from wolfpack.quest/mimic.',
  ],
  '3.0.0': [
    '**Mimic is out of beta** — graduated to a stable 1.0.0 release. Bot and agent bumped to 3.0.0, web to 1.0.0, all in one across-the-board major. (Existing Mimic beta installs need a one-time manual reinstall from wolfpack.quest/mimic; the beta update channel was retired. From 1.0.0+ everything auto-updates again.)',
  ],
  '2.7.14': [
    '**Sign in to Wolf Pack from Mimic** — optional Discord login persists across upgrades (Settings → Wolf Pack account). Click the button, paste the 6-char code at wolfpack.quest/auth/mimic-link, and Mimic links itself to your Discord account. Surfaces a "Signed in as <name>" badge on the dashboard. Uploads still work via the agent token; this establishes identity so cross-machine sync, edit-guild-triggers-in-place, and other officer affordances can roll out next.',
  ],
  '2.7.13': [
    '**Pause tell DMs from Mimic** — the tray now has a "Pause Discord DMs" submenu (15m · 1h · 4h · until tomorrow · resume) right where you play. Tells still write to `/me/tells` and the local dashboard while paused; only the Discord ping is muted. Per-machine, so it doesn\'t touch your `/me/tells` snooze.',
  ],
  '2.7.9': [
    '**Tells DM is compact now** — dropped the "you got a tell while you were away" preamble and the per-message mute footer; format matches the local dashboard ("**Other** ← You: text" / "You → **Other**: text"). Outbound tells in the same batch render alongside incoming so the conversation reads end-to-end.',
    '**Snooze Discord DMs** — `/me/tells` has a new pause row (15m · 1h · 4h · 8h · 24h) that mutes the DM relay without losing data; tells still write to the page and the local dashboard while paused. Stored per-user on `wolfpack_members.tells_dm_paused_until` so a 50-character raider flips one switch.',
  ],
  '2.7.8': [
    '**PvP boss timer board on wolfpack.quest/pvp** — every PvP-server boss kill (auto-detected from Druzzil broadcasts or recorded via `/pvpkill`) now mirrors into Supabase with a ±20% spawn window. The new "PvP Boss Timers" section sorts by soonest spawn first; rows whose window has already opened drop to the bottom as "camp now". Existing in-memory timers are backfilled on first deploy after this lands.',
  ],
  '2.7.7': [
    '**Auto-`/pvpkill` from PvP server broadcasts** — when Druzzil announces "X of <Guild> has killed Boss in Zone!" and the victim matches a boss in `data/bosses.json`, the bot auto-starts the respawn timer (±20% window) and posts a kill card to `PVP_KILLS_THREAD_ID`. Fires regardless of which guild made the kill — server-wide respawns tick the same for everyone.',
  ],
  '2.7.6': [
    '**PvP howl edits in place again** — second & later howlers were appending new "X and Y howl back!" lines instead of replacing the existing one (the filter only caught the singular "howls back!" form).',
  ],
  '2.7.5': [
    '**PvP kills now ping `@PVP`** — Wolf Pack PvP kills are the rallying moment, not the scroll-past ones. Deaths still ping for backup; other-guild / NPC kills remain silent.',
  ],
  '2.7.4': [
    '**Tells now actually persist** — the upsert was silently rejected by a partial unique index, so DMs fired but `/me/tells` stayed at 0. Index rebuilt; tells store again.',
    '**Tells DM now shows the conversation** — incoming + outgoing are grouped by counterparty in chronological order, so the DM reads as the back-and-forth instead of just the last incoming line.',
  ],
  '2.7.3': [
    '**Tells fix** — the `/me` toggle now actually saves for alts (was silently rejected when the alt had no linked Discord ID), and the bot stores incoming tells against the family root when an alt is unlinked — so `/me/tells` and Discord DM relay both reach you.',
  ],
  '2.7.0': [
    '**UI Studio (Mimic)** — back up your EQ window layout, hotkeys, chat tabs, bandolier, socials, and `eqclient.ini` to wolfpack.quest. Restore on any computer in one click. Files are encrypted before they leave your machine.',
    '**Multi-folder EQ picker (Mimic)** — scans for `eqgame.exe` in 14 common locations, lets you pick multiple installs, Browse to add more, with a "Where did we look?" disclosure.',
    '**Smoother overlay drag (Mimic)** — replaced the buggy Chromium drag with a small ✥ handle and 1:1 cursor tracking. First-run token gate; in-log NPC-hail character inference catches renamed log files automatically.',
  ],
  '1.0.0': [
    '`/kill <boss>` — log a kill and start the respawn timer',
    '`/timers [zone] [filter]` — view all spawn timers by zone or status',
    '`/announce` — schedule a raid with a thread and Discord event',
  ],
  '1.0.1': [
    '`/onboarding` — show the welcome message again, or toggle your opt-out preference',
  ],
  '1.1.0': [
    '`/rosterimport <file>` — import the OpenDKP roster JSON export (Officers only)',
    '`/who <name>` — look up a character\'s class and main/alt status (ephemeral)',
    '`/whoall <name>` — view a character\'s full family tree (main + alts) (ephemeral)',
  ],
  '2.5.39': [
    'Agent v2.4.26 starts collecting per-ability rollups — verb totals + self-attack counter become available on `/me` for new raids',
  ],
  '2.5.40': [
    'Onboarding moved to the database with diff-only revision pings — `/onboarding` now shows only what\'s new since you last looked, with a [Show full welcome] button for everything else',
    'Parser download link now points to the GitHub release directly (the old subdomain hit a TLS error)',
  ],
  '2.5.41': [
    'Parser release announcements moved to opt-in DMs — only members who\'ve used `/onboarding` get pinged, and only with the diff since their last seen version. The blasting channel post is gone.',
  ],
  '2.5.42': [
    'Self-serve opt-out: every character on `wolfpack.quest /me` has Stats/Inventory toggles you control. Flipping Stats=EXCLUDED stops the agent from uploading for that character within ~10 minutes, and hides their stats from the page.',
  ],
  '2.5.43': [
    'New officer command: `/recoverkills [since] [dry_run]` rebuilds boss timers from Supabase encounters when the boards have drifted (volume wipe, missed updates, the recent re-run-as-backfill bug). Dry-run first to preview.',
  ],
  '2.5.44': [
    'Privacy statement is live at **wolfpack.quest/privacy** — what we keep, what stays local, who sees what, and how to opt out per character. Linked from the footer and the welcome message.',
  ],
  '2.5.45': [
    'Inbound /tell relay (opt-in, default off): flip `Tells: ON` on **wolfpack.quest/me** for a character and the agent forwards its tells to **/me/tells** + Discord DMs when you\'re away. Only you ever see them.',
  ],
  '2.5.46': [
    'Tell notifications now come two ways, each toggleable: per-character `DM: ON/off` for Discord pings, and device-local 🔔 browser notifications (with optional sound) on **/me/tells** — they fire live the moment a tell lands while you\'re looking elsewhere.',
  ],
  '2.6.2': [
    'PvP fyi-pings: when a non-Wolf-Pack character dies in a PvP-zone broadcast (even to an NPC), the bot now gives the `@PVP` role a heads-up ping. Rate-limited to once per 10 min so flurries don\'t spam. Wolf-Pack-death backup pings and our-kill celebration posts unchanged.',
  ],
  '2.6.3': [
    'PvP fyi-pings now silent during raid hours (Sun/Wed/Thu 8:30–11:30 PM Eastern) — raiders aren\'t getting paged about an Old Guk NPC kill against a random Mayhem player mid-pull. Wolf-Pack-death backup pings are unchanged and still fire any time.',
  ],
  '2.6.4': [
    'Parse-card extras (data starts collecting now; display lights up after the next agent push): boss self-heal totals (Lady Vox CH and the like) will show as `27.1k (+10k healed)` on kill cards, and Feral Avatar / Savagery receives will give per-fight `FE×3 SAV×2` badges next to player names plus a totals strip on the `/fun` page.',
  ],
  '2.6.5': [
    'OpenDKP sync now runs every 30 min (was 6h) so the **/parses Tonight** panel reflects in-progress raid attendance as ticks come in. Web also adds pattern-based pet detection so wizard familiars and similar pets stop inflating the "Unknown" bucket on the Damage-by-class chart.',
  ],
  '2.6.6': [
    'Charm sessions: every charm landing (Mistmoore glyphed familiars, etc.) now starts a tracked session — pet name + owner + total damage + duration. Dire Charm casts flag the next landing as a DC session. The `/fun` page gets a new "Longest Dire Charm" card for bragging rights.',
  ],
  '2.6.7': [
    '`@PVP` pings now ONLY fire when Wolf Pack is actually involved (our kill or our death). Non-WP deaths in PvP-zone broadcasts post as plain death notices with no role mention, raid hours or not. Also fixed: a Wolf Pack member killing an NPC (e.g. "Adiwen killed Lord of Ire of <null>") no longer triggers the AWROOOO PvP-celebration path — NPC victims with no real guild post as informational notices.',
  ],
  '2.6.8': [
    'Squashed double-posting: when one Mimic install tails a main + alts, server/guild broadcasts (guild chat, PvP kills) were captured once per log and posted twice. Now deduped at the source + by normalized text on the bot. Also fixed the stray `[]` after some chat names (empty class tag) and the GMT-instead-of-local timestamps on the chat history page.',
  ],
  '2.6.9': [
    'Fixed a PvP-leaderboard undercount: backfilling your full log collapsed every repeat kill of the same player into one (the text-only dedup from 2.6.8 was too aggressive on historical replays). PvP dedup now buckets by time so distinct kills are kept and only true live duplicates collapse.',
  ],
  '2.6.10': [
    'Local dashboard panels (Damage, Recent Parses, PvP) get a `🛰 local | 🌐 server` header toggle — click 🌐 to swap to the wolfpack.quest aggregates (last 30 days / lifetime) right in place. Selection persists per panel.',
  ],
  '2.6.13': [
    'New **💸 Live Bidding** panel on the local dashboard (and as an overlay). Shows OpenDKP auctions in real time with a one-click bid input, marks items already on your wishlist with a ★, and lists your currently-placed bids underneath so you can keep track when you spread DKP across multiple items.',
  ],
  '2.6.15': [
    'Boards now rebuild spawn timers from Supabase (the parse/kill record) automatically on startup and every 6h — so after a redeploy or volume reset the cooldowns repopulate themselves instead of showing everything "Available now." `/recoverkills` still does it on demand.',
  ],
  '2.6.16': [
    'Parses are now scoped to the fight you were actually in. Before, a nearby raider meleeing a *different* mob could show up as a phantom contributor on your kill (e.g. a solo named kill listing 4 extra names). Damage now only counts toward an encounter if it landed on a target the uploader engaged.',
  ],
};

// Semver-aware ascending compare. "2.5.9" < "2.5.10" the right way (regular
// string compare would put "2.5.10" before "2.5.9" because '1' < '9').
function _semverCompare(a, b) {
  const pa = String(a || '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// ── Internal: write-through to Supabase ───────────────────────────────────────
function _guildId() {
  return process.env.DISCORD_GUILD_ID || 'wolfpack-quarm';
}

function _upsertRow(discordId) {
  if (!_supabaseEnabled) return;
  const row = _state[discordId];
  if (!row) return;
  const supabase = require('./supabase');
  supabase.upsert('member_onboarding_state', [{
    guild_id:                _guildId(),
    discord_id:              discordId,
    last_seen_version:       row.last_seen_version       || null,
    last_seen_agent_version: row.last_seen_agent_version || null,
    opted_out:               !!row.opted_out,
    updated_at:              new Date().toISOString(),
  }], 'guild_id,discord_id').catch(err =>
    console.warn('[onboarding] upsert failed:', err?.message));
}

// ── State accessors (sync via cache; writes fire-and-forget to DB) ───────────
function _ensureRow(discordId) {
  if (!_state[discordId]) {
    _state[discordId] = { last_seen_version: null, last_seen_agent_version: null, opted_out: false };
  }
  return _state[discordId];
}

function isOptedOut(userId) {
  return !!_state[userId]?.opted_out;
}

function getOptedOutVersion(userId) {
  // Pre-refactor name kept for compatibility. Semantically this is now
  // "the version they were on when they opted out" — which == last_seen_version
  // at the moment they hit the dismiss button.
  return _state[userId]?.opted_out ? (_state[userId].last_seen_version || null) : null;
}

function setOptedOut(userId, version) {
  const row = _ensureRow(userId);
  row.opted_out         = true;
  row.last_seen_version = version || row.last_seen_version || null;
  _upsertRow(userId);
}

function removeOptOut(userId) {
  if (!_state[userId]) return;
  _state[userId].opted_out = false;
  _upsertRow(userId);
}

function getLastSeenVersion(userId) {
  return _state[userId]?.last_seen_version || null;
}

function setLastSeenVersion(userId, version) {
  const row = _ensureRow(userId);
  if (row.last_seen_version === version) return;
  row.last_seen_version = version;
  _upsertRow(userId);
}

function getLastSeenAgentVersion(userId) {
  return _state[userId]?.last_seen_agent_version || null;
}

function setLastSeenAgentVersion(userId, version) {
  const row = _ensureRow(userId);
  if (row.last_seen_agent_version === version) return;
  row.last_seen_agent_version = version;
  _upsertRow(userId);
}

// Return every member who has opted in (any row exists, not opted out) and
// whose last_seen_agent_version is behind the supplied version. Used by the
// agent-release DM fanout.
function listMembersBehindAgentVersion(currentVersion) {
  const out = [];
  for (const [discordId, row] of Object.entries(_state)) {
    if (row?.opted_out) continue;
    const seen = row?.last_seen_agent_version || null;
    if (!seen || _semverCompare(seen, currentVersion) < 0) {
      out.push({ discordId, lastSeenAgentVersion: seen });
    }
  }
  return out;
}

// Slice an agent-release bullets bag down to the versions strictly between
// (lastSeen, current]. Uses the same semver compare as changesSince so
// 2.4.10 sorts above 2.4.9 correctly.
function sliceAgentBulletsAfter(allBullets, lastSeenAgentVersion) {
  const out = {};
  for (const [v, bullets] of Object.entries(allBullets || {})) {
    if (!Array.isArray(bullets) || !bullets.length) continue;
    if (!lastSeenAgentVersion || _semverCompare(v, lastSeenAgentVersion) > 0) out[v] = bullets;
  }
  return out;
}

// ── Changelog helper ──────────────────────────────────────────────────────────
// Returns an array of new feature strings for versions strictly greater than
// sinceVersion. When sinceVersion is falsy, returns every entry.
function changesSince(sinceVersion) {
  const versions = Object.keys(CHANGELOGS).sort(_semverCompare);
  const out = [];
  for (const v of versions) {
    if (!sinceVersion || _semverCompare(v, sinceVersion) > 0) {
      for (const l of CHANGELOGS[v]) out.push(`**${v}** ${l}`);
    }
  }
  return out;
}

// ── Persistence — load from Supabase ─────────────────────────────────────────
async function loadOnboardingData(client) {
  // 1) Try Supabase first (canonical store).
  try {
    const supabase = require('./supabase');
    if (supabase.isEnabled()) {
      _supabaseEnabled = true;
      const rows = await supabase.select(
        'member_onboarding_state',
        `guild_id=eq.${encodeURIComponent(_guildId())}&select=discord_id,last_seen_version,last_seen_agent_version,opted_out`
      );
      if (Array.isArray(rows)) {
        for (const r of rows) {
          if (!r?.discord_id) continue;
          _state[r.discord_id] = {
            last_seen_version:       r.last_seen_version       || null,
            last_seen_agent_version: r.last_seen_agent_version || null,
            opted_out:               !!r.opted_out,
          };
        }
        console.log(`[onboarding] Loaded ${rows.length} member state row(s) from Supabase`);
      }
    }
  } catch (err) {
    console.warn('[onboarding] Supabase load failed:', err?.message);
  }

  // 2) Locate the instructions message in the onboarding thread so
  // postOrUpdateInstructions edits in place instead of posting fresh.
  const threadId = process.env.ONBOARDING_THREAD_ID;
  if (!threadId) return;
  try {
    const thread = await client.channels.fetch(threadId);
    const msgs   = await thread.messages.fetch({ limit: 100 });
    for (const msg of msgs.values()) {
      if (msg.author.id !== client.user.id) continue;
      if (msg.embeds[0]?.title === INSTRUCTIONS_TITLE) {
        _instructionsMsgId = msg.id;
        break;
      }
    }
  } catch (err) {
    console.warn('[onboarding] Could not load instructions msg id:', err?.message);
  }
}

// ── No-op for compat — DB is canonical now ───────────────────────────────────
// Existing call sites still invoke this after they mutate state. The actual
// write happens inline via _upsertRow() in the setters; this is a stub so we
// don't have to touch every caller.
async function saveOnboardingData(/* client */) { /* no-op */ }

// ── Public instructions embed (visible to the whole channel) ─────────────────
function buildInstructionsEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(INSTRUCTIONS_TITLE)
    .setDescription(
      'Everything you need to run with the pack. Run `/onboarding` at any time to see the full welcome message again.'
    )
    .addFields(
      {
        name: '⚔️ Kill Tracking',
        value: [
          '`/kill <boss>` — Log a kill and start the respawn timer',
          '`/unkill <boss>` — Remove a false kill record',
          '`/updatetimer <boss> <time>` — Override the respawn timer (e.g. `"3d4h30m"`)',
          '`/timers [zone] [filter]` — View all spawn timers by zone or status',
        ].join('\n'),
        inline: false,
      },
      {
        name: '📣 Raid Announcements',
        value: [
          '`/announce time:<when> [boss/zone]` — Create a raid thread + Discord event',
          '`/addtarget` / `/removetarget` — Manage event targets in the announce thread',
          '`/adjusttime` / `/adjustdate` — Update the event time or date',
        ].join('\n'),
        inline: false,
      },
      {
        name: '🛠️ Admin / Setup',
        value: [
          '`/board` — Post or refresh all boards and cooldown cards',
          '`/cleanup` — Remove duplicate/stale messages',
          '`/restore <links...>` — Rebuild kill state from cooldowns or summary messages',
          '`/addboss <pqdi_url>` / `/removeboss <boss>` — Manage the boss list',
        ].join('\n'),
        inline: false,
      },
      {
        name: '📖 Help',
        value: '`/raidbosshelp` — Full command reference (ephemeral)\n`/onboarding` — Show the welcome message again or toggle opt-out',
        inline: false,
      },
    )
    .setFooter({ text: 'Timer data sourced from PQDI.cc • Wolf Pack EQ (Quarm)' });
}

async function postOrUpdateInstructions(client) {
  const threadId = process.env.ONBOARDING_THREAD_ID;
  if (!threadId) return;
  try {
    const thread = await client.channels.fetch(threadId);
    const embed  = buildInstructionsEmbed();

    if (_instructionsMsgId) {
      try {
        const msg = await thread.messages.fetch(_instructionsMsgId);
        await msg.edit({ embeds: [embed] });
        return;
      } catch {}
    }
    const msg          = await thread.send({ embeds: [embed] });
    _instructionsMsgId = msg.id;
    await saveOnboardingData(client);
  } catch (err) {
    console.warn('[onboarding] Could not post/update instructions:', err?.message);
  }
}

// ── Welcome message builders ──────────────────────────────────────────────────
function buildWelcomeEmbed() {
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('🏹 Welcome to the Wolf Pack Raid Tracker!')
    .setDescription(
      'This bot keeps the pack coordinated across three pillars. ' +
      'Hit a button below to tell us how you\'d like to run with the pack.'
    )
    .addFields(
      {
        name: '⚔️ Accountability',
        value:
          'When you kill a boss, click its button on the board. That logs the kill and starts the ' +
          'respawn countdown — accurate tracking means the whole pack knows when to be ready.',
        inline: false,
      },
      {
        name: '⏱️ Timing',
        value:
          'The board and the **Spawning in the Next 24 Hours** card show exactly when each boss is ' +
          'back up. Never miss a window because no one wrote it down.',
        inline: false,
      },
      {
        name: '📣 Coordination',
        value:
          'Use `/announce` to schedule a group takedown — it creates a thread, a Discord event, and ' +
          'rallies the pack.\nRun `/raidbosshelp` for a full command reference.',
        inline: false,
      },
      {
        name: '🔒 Your data, your call',
        value:
          'Your raw logs stay on your machine — only what you opt into syncs. Read the privacy ' +
          'statement and toggle per-character exclusions any time at ' +
          '**https://wolfpack.quest/privacy** and **https://wolfpack.quest/me**.',
        inline: false,
      },
    );
}

function buildOrganizerEmbed() {
  const { getAllowedRoles } = require('./roles');
  const roles = getAllowedRoles().map(r => `**${r}**`).join(', ');
  return new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle('🗡️ Raid organizer — here\'s what to know:')
    .addFields(
      {
        name: 'Scheduling',
        value: [
          'Use `/announce` to schedule a takedown with a thread, Discord event, and role ping.',
          'Use `/addtarget`, `/adjusttime`, and `/adjustdate` inside the raid thread to update details.',
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Kill Tracking',
        value:
          `Board buttons and \`/kill\` require one of these roles: ${roles}.\n` +
          'Run `/raidbosshelp` for a full command reference.',
        inline: false,
      },
    )
    .setFooter({ text: 'You can get this message again at any time with /onboarding' });
}

function buildAttendeeEmbed() {
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('👀 Just here to attend?')
    .setDescription(
      'Keep an eye on Discord events and announcements in raid channels. ' +
      'When you\'re ready to start tracking kills, run `/onboarding` again or use `/raidbosshelp` anytime.'
    )
    .setFooter({ text: 'You can get this message again at any time with /onboarding' });
}

// Direct GitHub-release download URL. The `parser.wolfpack.quest` CNAME-to-
// GitHub can't terminate TLS, so always link the release artifact directly.
const PARSER_DOWNLOAD_URL =
  'https://github.com/davehess/QuarmBossTracker/releases/latest/download/WolfPackParser.zip';

// ── Onboarding action rows ────────────────────────────────────────────────────
// Surfaced when a member clicks "Set up the parser" in the welcome flow. Two
// recommended paths: Mimic (new default — Electron desktop, v1.0.0+, includes
// overlay/triggers/charm/tells) and Parser.bat (classic CLI agent, minimal).
const MIMIC_URL = 'https://wolfpack.quest/mimic';
function buildParseOverviewEmbed() {
  return new EmbedBuilder()
    .setColor(0x1f6feb)
    .setTitle('🐺 Set up parsing — pick one')
    .setDescription('Both share your combat data with the bot so guild stats stay current. Mimic is the all-in-one desktop app (recommended); Parser.bat is the minimal CLI agent.')
    .addFields(
      {
        name: '⭐ Recommended: Wolf Pack Mimic v1.0.0',
        value:
          `[**${MIMIC_URL}**](${MIMIC_URL}) — one-click installer, bundles its own Node, no extras to install.\n` +
          '**Includes:** DPS overlay · trigger TTS · charm tracker · /tells history · Buffs & Zone card · UI layout backup · optional Discord sign-in.\n' +
          'After install, paste your `/token` value into Settings → Agent token.',
        inline: false,
      },
      {
        name: '🧱 Minimal: Parser.bat (CLI)',
        value:
          `[**WolfPackParser.zip**](${PARSER_DOWNLOAD_URL}) — unzip, double-click \`RUN-FIRST-for-Node.js.bat\` once, then \`Parser.bat\` each session.\n` +
          'Full walkthrough: `/parsehelp`',
        inline: false,
      },
    )
    .setFooter({ text: 'Run /raidbosshelp for the full command reference' });
}

// Compact "what's new since you last saw this" embed. Used on /onboarding and
// the GuildMemberAdd DM whenever last_seen_version < current. The full welcome
// is accessible via the [Show full welcome] button next to it.
function buildChangesEmbed(currentVersion, lastSeenVersion, changes) {
  const since = lastSeenVersion ? `since v${lastSeenVersion}` : 'since you were last here';
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📦 What's new ${since}`)
    .setDescription(
      changes.length
        ? changes.map(c => `• ${c}`).join('\n')
        : '_Nothing new since you were last here._'
    )
    .setFooter({ text: `Current: v${currentVersion} • Run /raidbosshelp for the full command reference` });
}

function buildChangesComponents(version) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`onb_show_full:${version}`)
        .setLabel('Show full welcome')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📖'),
      new ButtonBuilder()
        .setCustomId(`onb_ignore:${version}`)
        .setLabel('Don\'t ping me on revisions')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔕'),
    ),
  ];
}

// Agent-release DM body. Sent to opted-in members whose
// last_seen_agent_version < current. Bullets come from
// data/agent_release_notes.json — one bucket per agent version.
function buildAgentReleaseEmbed(currentAgentVersion, lastSeenAgentVersion, bulletsByVersion) {
  const since = lastSeenAgentVersion ? `since v${lastSeenAgentVersion}` : '';
  const versionsAsc = Object.keys(bulletsByVersion).sort(_semverCompare);
  const lines = [];
  for (const v of versionsAsc) {
    const bullets = bulletsByVersion[v] || [];
    if (!bullets.length) continue;
    lines.push(`**v${v}**`);
    for (const b of bullets) lines.push(`• ${b}`);
    lines.push('');
  }
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`📦 Wolf Pack Parser — what's new ${since}`.trim())
    .setDescription(
      lines.length
        ? lines.join('\n').trim()
        : `Parser is now at **v${currentAgentVersion}**. Re-launch **Parser.bat** to update.`
    )
    .setFooter({ text: `Now at v${currentAgentVersion} • Re-launch Parser.bat to update — or click ↻ Check for update at http://localhost:7777` });
}

function buildAgentReleaseComponents(agentVersion) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setURL(PARSER_DOWNLOAD_URL)
        .setLabel('Download latest')
        .setStyle(ButtonStyle.Link)
        .setEmoji('📥'),
      // Reuses the existing dismiss handler — version tag is the AGENT
      // version, which the handler treats as a string token; setOptedOut
      // stores it on row.last_seen_version. That's a slight semantic blur
      // (we're stashing an agent version in a bot-version field), but it's
      // fine: the only thing opted_out gates is the GuildMemberAdd DM.
      new ButtonBuilder()
        .setCustomId(`onb_ignore:${agentVersion}`)
        .setLabel('Don\'t ping me on revisions')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔕'),
    ),
  ];
}

function buildWelcomeComponents(version) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  const roleRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('onb_pvp').setLabel('Count me in for PVP').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('onb_organizer').setLabel('I want to help organize').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('onb_deeps').setLabel('Set up the parser').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('onb_attend').setLabel('Just here to attend').setStyle(ButtonStyle.Secondary),
  );
  const optRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`onb_ignore:${version}`)
      .setLabel('Don\'t show me this again')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔕'),
  );
  return [roleRow, optRow];
}

function buildShowAgainComponents() {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('onb_show_again')
        .setLabel('Show me onboarding again')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🔔'),
    ),
  ];
}

module.exports = {
  isOptedOut,
  getOptedOutVersion,
  setOptedOut,
  removeOptOut,
  getLastSeenVersion,
  setLastSeenVersion,
  getLastSeenAgentVersion,
  setLastSeenAgentVersion,
  listMembersBehindAgentVersion,
  sliceAgentBulletsAfter,
  changesSince,
  loadOnboardingData,
  saveOnboardingData,
  postOrUpdateInstructions,
  buildWelcomeEmbed,
  buildOrganizerEmbed,
  buildAttendeeEmbed,
  buildParseOverviewEmbed,
  buildWelcomeComponents,
  buildShowAgainComponents,
  buildChangesEmbed,
  buildChangesComponents,
  buildAgentReleaseEmbed,
  buildAgentReleaseComponents,
  buildInstructionsEmbed,
  PARSER_DOWNLOAD_URL,
  REGISTRY_TITLE,
  INSTRUCTIONS_TITLE,
};
