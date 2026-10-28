# Brand, media & marketing

Raid Mimic and eqmimic.quest pages, videos, posters, the mascot. Oldest first. Find an entry by its ID in [the index](README.md); new decisions go in `inbox/` and are merged here.

## 2026-09-18/9 — The launch pack — brochure, request page, polish, and the business pass (the guild lead)
*2026-09-18 · DECISIONS-2026-09-18.md · Launch pack: brochure, request page, polish*

> *"the output when I wake up tomorrow is that we'll be able to give our guild
> leaders a brochure style ad to the other guilds on the server … start a
> public request page built into the GitHub perhaps? the app probably needs a
> lot of polish, like making the quiet mode actually say 'quiet mode (no TTS
> audio)' … primarily use sonnet and opus subagents … go through all forms of
> what we need to implement in an architect capacity, from sales and marketing
> to accounting and if we would take payment how we would have to incorporate."*

**How it was run, because the guild lead asked for utilization to last the
week:** one workflow, eleven agents — four Sonnet readers at low effort
(features with evidence, the offer, public-safe numbers, a copy-polish
inventory), three Sonnet brochure angles → one Opus judge, one Opus business
architect, one Opus verifier over the polish inventory, one Opus public-repo
critic. ~1.06M subagent tokens, fourteen minutes, no adversarial fan-out.

**Brochure — `docs/marketing/guild-brochure.html`, a published page, and a
one-page PDF.** The judge chose the *less admin* angle (the reader is an
officer doing bookkeeping) and grafted the "One parse, not six" opener from
the *better data* draft. The critic returned six findings and all six were
applied before anything was published: "5 expansions" implied PoP is live
(it is locked until 10-01 — now "Classic through Luclin, with PoP flag
tracking in preview"); "backed up automatically" overstated a one-click
capture; "tells are filtered out" is false for a raider who opts into the
relay; the self-host CTA now says "budget an evening or two"; the terms are
named as a DRAFT with the no-SLA line on the page itself; and a reputational
claim about a named payment processor in the business doc was neutralised.
Numbers on the page are the public aggregates already used on the site plus
the boss count from `data/bosses.json`. Nobody is named.

**Request page — `.github/ISSUE_TEMPLATE/`.** Three issue forms (a guild's
request, a feature request, a bug report), each opening with the one warning
a public page needs, and a `config.yml` that turns off blank issues and links
SELFHOSTING, LICENSING and the roadmap first. **Enabling Discussions is one
click in Settings → Features — a repository setting, not a file.**

**Polish — beta.8 (agent 3.6.45) and beta.9 (3.6.47).** Quiet mode's wording
was not vague, it was wrong: the first-run page still said it hid overlays and
the tray called it "I use EQLogParser / other parser (Quiet mode)", while the
control has been mute-only since the 09-11 split. All three surfaces now say
"no TTS audio or sounds (overlays still show)". Nine more labels and tooltips
verified against their code before applying.

⚠ **Incident, recorded honestly.** Three things went wrong in that batch and
each has a rule now:
1. **3.6.46 (`e4c89158`) would have blanked the dashboard** — a tooltip with
   "guild's" folded into a single-quoted JS string unescaped. `check:dashboard`
   caught it *and the chain committed anyway*, because the check was piped
   through `tail`, which swallowed the non-zero exit. The release run was
   cancelled 52 seconds in and never published; 3.6.47 is the fix. **Rule: a
   gate's exit code must reach the shell — never `npm run check:dashboard |
   tail`.** This is the third apostrophe-class blank (v2.4.25, v2.4.27, now).
2. **3.6.45's release note described ten changes; three landed.** The apply
   step aborted on the first escaped apostrophe and the chain continued. The
   note reposted to `#mimic-releases` overclaimed for one build; 3.6.46/47's
   notes correct it. **Rule: escape apostrophes in the PROPOSED text whenever
   the target is inside a JS string, not only when the current text had one.**
3. **The verifier approved a change that would have broken a test** — it
   grepped for the full label and missed that `quiet-mode-split.test.js`
   asserts on its *prefix*. Caught by reading the test. **Rule: a verifier
   checks prefixes and regexes, not just whole strings.**

**Business — `docs/DESIGN-business.md`,** §0–§9: positioning and the offer,
channels that reach emulator guilds, the funnel with the tenancy doc's
abandonment estimate, cost-plus pricing from the real infrastructure numbers
and what a merge does to two paying guilds, taking payment as one person,
incorporation as a liability question with the sequence entity → bank →
processor → signed terms, proportionate bookkeeping, a risk register, and a
30/90/270-day plan with the point at which it is not worth doing. Not legal,
tax or accounting advice; it writes the questions for the professionals.

**Stale figure found on the way:** `CLAUDE.md` says 133 bosses;
`data/bosses.json` holds **135** across five expansions.

## §58a — Reworded the same night, and the film posts itself (bot 3.1.159)
*2026-09-21 · DECISIONS-2026-09-21.md · Celebration reworded; film posts itself*

**The guild lead:** *"perhaps it's best to flash 'congrats Wolf Pack on the last Aten Ha Ra of
Luclin!' 'The guild has done approximately N damage to Aten Ha Ra since <First kill>' and post the
video into discord."*

- **The flash is two chips** (two `text_overlay` actions on the same trigger — the agent renders
  every action, so both show at once, both spoken in turn): the congratulations, then *"The guild
  has done approximately 22.6 million damage to Aten Ha Ra since February 26."* The number is
  baked into the trigger text because a trigger cannot compute; it is the parsed total of her
  19 confirmed kills (`encounters.total_damage`, cross-checked against `encounter_players` to
  within 50 points), and "approximately" is the honest word — partial parses make it a floor. The
  first kill was 2026-02-27 02:41 UTC, which is **February 26 in Eastern time**, so the text says
  the 26th; §58's "February 27" above was the UTC date.
- **The embed computes the same two lines live** (`_vtBigNumber`, `_vtKillDate` in New York time)
  from the confirmed kills that started more than two hours ago, and adds the kill number.
- **"Post the video into discord" is automatic.** The link lives in `celebration_video_url`
  (/admin/overlays). If it is set when she dies, the kill embed carries it as message CONTENT so
  Discord unfurls the player (a link inside an embed's text does not unfurl). If it arrives
  later, `_announceVexThalFilmOnce` polls the tuning map once a minute and posts the video once,
  after the kill embed exists (never before — the film is a follow-up, not a spoiler), latched in
  `bot_kv` `announce_vex_thal_film`; the interval clears itself once posted. Fail-closed on an
  unreadable latch, like every announcer.
- **The film brief was rewritten** as an anime opening built class by class, mains only (alts
  collapsed onto their mains from `characters.main_name`; names not in the character table dropped),
  with the two character sheets the guild lead gave. Private file, sent again; not in the repo.
- Test file grown to 10 (the poller's states, the content-vs-embed rule, the rounding, an empty
  history reading as kill number 1 while an unreadable one prints no number).

## §58 — A one-time celebration for every Mimic user on the Aten Ha Ra kill (2026-09-27, bot 3.1.158, web 1.8.28)
*2026-09-27 · DECISIONS-2026-09-21.md · One-time celebration video for final Luclin kill*

**The ask (the guild lead):** *"how can I create a one time celebration for all miMIC users after
tomorrow's defeat of Aten Ha Ra in our last scheduled Vex Thal raid. I have some ideas about an
animated anime style video of our raiders all attacking her, with crash cuts on each player and
their name tag and the things they typically do during a fight against her."*

### The call: no build, three existing channels
Sunday's raid is 20 hours away and every Mimic on the fleet already polls three things that can
carry a one-off. Nothing new ships to Mimic; the celebration is DATA on surfaces that exist.

| Moment | Channel | What happens | Where it is set |
|---|---|---|---|
| The kill line | **guild trigger** `fdf89cd5-dae7-4cb6-971e-275efe35c202` (`Vex Thal cleared — Aten Ha Ra`) | every Mimic in the zone: a 12 s flash *"🐺 ATEN HA RA IS DOWN — VEX THAL CLEARED"*, the spoken line *"Aten Ha Ra is dead. Vex Thal is cleared. Wolf Pack."*, and a 3.4 s brass fanfare | inserted directly in `guild_triggers` (served live by `_guildTriggersFor`; reaches every agent within the 2-min poll). Pattern `^\[.+?\]\s+Aten Ha Ra has been slain by`, cooldown 3600 s |
| The relay of that kill | **bot one-shot** `_announceVexThalClearedOnce` on `/api/agent/bosskill` | one embed in #raid-chat: who landed it, *"Wolf Pack's Aten Ha Ra kill number N since the first, on February 27"* (N from `encounters`, npc 158436, confirmed kills > 2 min that started more than two hours ago — so tonight's own parse is not counted twice), the film link if set, else *"the film is in the works"* | `bot_kv` latch `announce_vex_thal_cleared`, fail-closed like the other announcers; only for `boss = Aten Ha Ra` (the Kaas Thox pair share the name and are excluded) and `guild = Wolf Pack`; pings nobody |
| The film, whenever it is cut | **tuning key** `celebration_video_url` + **Mimic Mail** | the embed prints the link only if it is `https://…`; a Mimic Mail from /admin/notices puts the ✉ dot on every Mimic ≥1.6 | `/admin/overlays` tuning editor; `/admin/notices` |

The sound is `web/public/sounds/vex-thal-cleared.wav` — synthesized (a C-major brass arpeggio into
a held chord; no licensing question), 300 KB, served from `wolfpack.quest`. Guild triggers already
carry a `sound` URL and Mimic plays it with `new Audio(url)`, so this is the first guild-wide use of
a feature that has been there since triggers v2. The TTS passes the #136 allow-list because
"dead" matches its death category — checked, not assumed.

**Why the trigger fires only in the zone:** guild triggers match the local log, and the kill line
is zone-wide. Raiders not in Vex Thal get the Discord embed, not the flash — which is right.

**Deliberately not done:** no Mimic release (nothing would reach the fleet in time, and the
stable just cut is what everyone is on); no confetti/animation in an overlay (a one-night effect
is not worth a permanent code path in the trigger window); no name on the roadmap entry before
the kill (a teaser line only — *"You will know it when it happens"*).

### The film — services, not a prompt
The shot list (style bible, per-raider shot cards with class, race and what each one is seen
doing in the Aten Ha Ra parses, prompt lines) is **private** — it names members — and went to
the guild lead as a file, not into the repo. The service answer, in short: Gemini/Veo for the
handful of hero shots (its 3/day cap fits four establishing beats); a credit-pack service
(Kling, Runway, Hailuo) for crash-cut volume via image-to-video from consistent stills; stills
from one image model with a locked style prefix; **name tags and cuts in an editor (CapCut /
DaVinci), never generated** — text in generated video is the one thing none of them do
reliably. Host unlisted on YouTube; the link goes in the two places above.

### After the raid
1. **Disable trigger `fdf89cd5…`** on /admin/triggers (the 1-hour cooldown stops a double fire on
   the night; the disable stops a fire on a later Vex Thal kill).
2. Paste the film link into `celebration_video_url`; send the Mimic Mail; add the real roadmap line.
3. The bot one-shot stays latched forever in `bot_kv`; the code can be removed in a later tidy.

### Where
- Bot: `_announceVexThalClearedOnce` + the hook after the next-spawn line in `_handleAgentBossKill`.
- Test: `test/announce-vex-thal-cleared.test.js` (5, running the real function against fakes).
- Sound: `web/public/sounds/vex-thal-cleared.wav`; generator kept out of the repo (scratchpad).

## §61 — The Aten Ha Ra film goes on YouTube; `/film` plays it (2026-09-27, web on beta)
*2026-09-27 · DECISIONS-2026-09-21.md · Raid film hosted on YouTube*

**The call** (the guild lead, answering "how can we make these available on wolfpack.quest"): **YouTube**,
option 1 of three that were costed. The full film is hosted on YouTube. The raider clips are to stay
members-only on the site, as the next change.

**Why not the repo or our own storage for the film.** The repo is public, the film carries
members' names, and the two 1080p masters are 230 and 210 MB. Supabase Storage would work for the
720p copies, but YouTube costs the platform nothing in storage or egress and plays well on phones.
The guild lead was uploading there anyway (the covers were made for it).

**Where it landed** (beta `6fa74bef`): `/film`, signed-in members only, in the Stats menu. The two takes
come regular first, then the remix. Each poster is our own cover image, and the YouTube embed loads
only on the click. The takes and links are **data**: bot_kv `film_youtube`, seeded 2026-09-27 with
empty links. Until a link is set the poster reads "On YouTube soon". Setting it is one SQL update, no
deploy. `web/lib/film.ts` accepts any usual YouTube link shape and refuses everything else. Two
layouts for review: the default stacks both takes, `?v=b` is one player with a switch.

**Parked, same night:** a raid-say "Divine Intervention to < X >" should start that cleric's DI
cooldown (the CH chain showed a cleric as "DI ?" right after he announced his DI). Investigated,
not built: the guild lead asked for the YouTube work first. STATUS carries it.

## §61a — Everything into the guild lead's Drive folder, by an import script (2026-09-28)
*2026-09-28 · DECISIONS-2026-09-21.md · Film assets imported to Drive by script*

The guild lead asked for every film asset in the raiders Google Drive folder. The Drive connector cannot
carry video: it only creates files from content typed into a call, and its grant could not even list
files. The guild lead chose an **import script**. Every asset is staged for 24 hours in a public Supabase
bucket, `film-staging`, under a random 32-character path that is not written here. That is 105 objects,
1,073 MB: 78 raider clips, both 1080p films as 19 MiB parts, the 720p copies and the covers. The bucket
cannot be listed without auth, so only the exact links reach anything. The anon upload policy existed
only for the upload, scoped to that path, and was dropped straight after. The guild lead runs a Google Apps
Script that pulls it all into the folder and rebuilds each film from its parts with a resumable upload.
Deletion is scheduled for 2026-09-29 04:00 UTC. The same night one raider got a new clip, breaking their
chains (Gemini still, LTX pro 6 s, about $0.61), which replaced their clip in the set.

**The HQ raider clips (same night).** The guild lead found the clips blurry and smeared. The cause was
our smoothing step, not the generator: 78 of the 104 renders were drawn on twos, and the pipeline had
ffmpeg invent the missing frames (motion-compensated interpolation), which ghosted every fast move. The
name card's punch-in zoom and the song sat on top of that. The clips were rebuilt straight from the
generator's files: the video stream is copied untouched (720p; the one 1080p redo stays 1080p), with no
card and no song. They went up in a new `Raider clips (HQ)` folder. The importer skips files already in
Drive, so re-running it adds only these. Deletion moved to **2026-09-30 04:00 UTC**. **Rule: never
interpolate hand-drawn animation.** On twos is how it is meant to move. A native-1080p re-render was
tested on one raider ($0.48). Its lines are sharper, but it is a fresh take with new motion and some
camera drift. All 78 would cost about $37; that is the guild lead's call.

**Outtakes too (same night).** The guild lead asked for every other generated piece: *"some of them are
worth having a laugh over, others looked better."* Staged under `Outtakes/` in twelve folders: both
rounds of stills with their tries, every animation take (the film's take marked), the class, opening,
ending and transition renders, the cold open and storyboard takes, the one-raider redo, the earlier cuts
of the film, the cover candidates, and the old clips with the song. Only raw generations and finished
cuts went in; intermediates such as frame sheets, smoothed copies and card composites stayed out. The
bucket now holds 676 objects, about 4.1 GB (PNG added to its allowed types). The importer now **books
its own next run** on a one-minute timer when it pauses, and a script lock stops two runs overlapping. A
mocked end-to-end run landed all 630 files, and a second run added nothing.

**Then every attempted version (same night).** The guild lead: *"add all of the other versions ... each
attempted version."* The earlier cut had left out the smoothed copies and composites; those are versions
too, so four more folders went in: `13 Name cards, every round` (all six rounds, 506 clips),
`14 Smoothed animations (the blurry ones)` (118), `15 Class intro versions` (47) and `16 Other versions`
(28). Still left out: files byte-identical to one already in (the hash-named first stills), the same cut at
a second resolution, frame grabs and contact sheets. The bucket now holds 1,375 objects, 6.6 GB. The
script's file list is packed one line per file (folder numbers, not names), which brings it to 74 KB for
1,329 files, below the 82 KB version already saved. Saving new code while the timer chain runs is safe;
the next run reads the new list.

## §62 — Guild media: long-term storage per character; the making-of page and character galleries (2026-09-28, web on beta)
*2026-09-28 · DECISIONS-2026-09-21.md · Making-of page and character galleries*

The guild lead asked for everything behind the film on wolfpack.quest: *"with this process, all of the
pronunciations, everything that went into making it."* Then, mid-build: *"we should have a gallery
available for our players on their character pages, not to hold every picture in the world, but it
would be cool to treat it like a longterm storage of that."* One store serves both.

- **The store.** A private bucket, `guild-media`, and a table, `guild_media` (migration
  `20260928045235`, applied via MCP and committed identically). One row per stored file: `collection`
  (the film is `aten-ha-ra`), `section` (the step it came from), `character_name` (whose gallery it
  belongs in; NULL for shots that are not one raider), `kind`, `path`, `thumb_path`, `title`, and `meta`
  (the generation record: model, resolution, prompt). Neither the table nor the bucket has policies, so
  anon and signed-in users can neither list nor read them. The web server reads with the service role
  and signs links, the same shape as `feedback-screenshots`.
- **What went in.** 628 files for 98 characters, 3.3 GB, plus a 480-wide thumbnail for each (1,256
  objects in all). That is both rounds of stills with their tries, every animation take (the film's
  take marked in `meta.used`), each raider's clean clip and the older clip with the song, the class,
  opening, ending, transition and cold-open renders, the earlier cuts, the covers, and both takes at
  720p. Two cuts over one 50 MB object were re-encoded to fit. The 1080p masters stay on YouTube and
  Drive. Loaded with temporary anon insert grants (on storage, `guild_media` and one `bot_kv` key), each
  revoked straight after and checked at zero.
- **The film's facts are data.** bot_kv `film_making` holds, per raider, how the name was written for
  the song, when each take sings it, and what the speech-to-text model heard. It also holds the lyric
  sheet, the style prompt and the counts. The repo carries none of it: it names raiders.
- **One auth check per page, not per picture.** Pages sign one batch of links per render and show a
  first screenful per section; the rest of a section, or one raider's whole set, comes from
  `/api/media` on a click. That route checks sign-in first and refuses a request with neither a section
  nor a character. The viewer fetches a file's prompt only when "How it was made" is opened. The
  per-picture alternative, a redirect route, would have cost two auth calls per thumbnail, and the
  middleware notes why auth load matters (the 2026-07-13 incident).
- **Pages, two layouts each, on beta.** `/film/making` defaults to the story, chapter by chapter; `?v=b`
  is "find your raider". A character page shows a Gallery card under its header, only when the character
  has media: by default the clip, action still and first picture large with the rest behind "All";
  `?g=b` groups everything by source. `/film` links to the making-of.
- **Not shown:** money. The per-file cost is in `meta` but no page renders it; whether the guild sees
  the spend is the guild lead's call.
- **Retention:** kept indefinitely, no pruning. That is the point of the store, and 3.3 GB sits well
  inside Pro's 100 GB of storage. Recorded in `DESIGN-selfhost-wizard.md` §3.
- **Not built yet:** uploads by players. The table is shaped for it (`collection`, `section`), but an
  upload path needs the public-upload security audit that is already open for the guild-logo page first.

## §62b — Graduated to main, with the filter on top and a #raid-chat card (2026-09-28, web 1.8.30, bot 3.1.162)
*2026-09-28 · DECISIONS-2026-09-21.md · Media pages to main with raider filter*

The guild lead: *"push this up to main and send a link to the guild's raid-chat using this image as the
'come look at the stuff' ... make sure people can filter just see specific characters at the top."* That
is the layout call. `/film/making` now opens with the raider finder (search a name, pick a class, click a
raider for their whole set), and the story follows. `?raider=<name>` opens on that raider, and each
character's Gallery links there. The unpicked alternates (`/film?v=b`, `/film/making?v=b`, Gallery
`?g=b`) were deleted on beta first, so beta and main carry byte-identical files and the main→beta sync
has nothing to conflict on. This was a file-level promotion as always, plus the Film nav link, the
page-meta entries, the roadmap entry and the version bumps.
- **The card** is a bot one-shot, `_announceFilmMakingOnce`, in the shape of the 2.7.1 card: latched in
  `bot_kv` (`announce_film_making_raid_chat`, fail-closed), pings nobody, links `/film/making`, and uses
  the guild lead's picture. It waits until that picture answers 200 on wolfpack.quest, because it ships
  in the same web deploy as the page, so the post can never beat the page. The first try is a minute
  after boot, then every 5 minutes for up to 12 hours.
- **The picture is public** at `web/public/film/making-of.jpg`: a drawing with no name on it, like the
  covers. `/film/making` also unfurls with it when the link is pasted.

The guild lead has acquired `eqmimic.quest` and wants Mimic available there without the Wolf Pack
branding, and asked whether that means moving to a new, closed repository if it is offered as a service.
**Open; the guild lead's call.** What any answer has to carry:
- **Every package is already AGPL-3.0-or-later** (root, Mimic, agent, web). AGPL is the licence built for
  this case: anyone who runs a modified copy as a network service must publish their source. It does not
  stop the copyright holder running their own service. Nearly every commit is either the guild lead's or
  made in their sessions, so relicensing future code is theirs to decide. Code already published under
  AGPL stays AGPL for anyone who has it.
- **The installed fleet updates from THIS repository being public.** Mimic's `electron-updater` publishes
  to and reads from this repo's GitHub releases, and the bot serves agent hot-swaps from
  `raw.githubusercontent.com/davehess/QuarmBossTracker/...`. Making this repo private would silently stop
  updates for every installed Mimic. Moving the update feed (a public releases-only repo, or a feed on
  eqmimic.quest) comes first, through one last release on the old feed that points clients at the new one.
- **Groundwork that is not wasted either way:** one brand config for Mimic (name, icons, colours, default
  server) with Wolf Pack as the first tenant; Mimic fully usable without a guild backend; eqmimic.quest on
  the same Vercel project behind a host rewrite. This is the self-host wizard epic seen from the other
  side.
- The recommendation and the non-technical questions went to the guild lead in chat, not into this file.

## §64 — The lore behind the raids: `docs/LORE-planes-of-power.md` (2026-09-28)
*2026-09-28 · DECISIONS-2026-09-21.md · Raid lore document for narrative*

The guild lead: *"Consume the Lore for Everquest so that we can build a larger narrative around our raids
moving forward. Use Haiku agents to comb through the site and build a better understanding of how Planes
of Power matters and what happens in the pantheon of gods."* Six Haiku agents split
loreofnorrath.wordpress.com (about 990 posts, read through the WordPress public API) into pantheon, PoP
story, timeline, dark gods, light and elemental gods, and Luclin. A second pass checked every
load-bearing claim against the source text before anything went into the doc.
- **The frame it gives us:** PoP is where mortals break into the gods' own realms, kill their champions
  and reach the Plane of Time. Afterwards (EverQuest 2's *Tome of Destiny*) the gods agree mortals are
  too strong and withdraw from Norrath, which leads to the Rending and the Shattering of Luclin. Our
  raids are the cause of the gods' silence.
- **Source tiers are part of the doc.** EQ1 in-game text wins; EQ2 text is canon only for what happens
  AFTER PoP; the tabletop RPG and fan essays are "legend has it".
- **Haiku alone was not good enough for lore.** The first pass put the EQ2 bridge story before PoP,
  called Tallon and Vallon goddesses and Aerin`Dar a priestess, and padded gods with invented "raid
  hooks". The corrections are listed in the doc. Any later lore pass should verify against the source
  text the same way.
- Not built: lore lines on `/pop` zone cards, a story block on `/guide/[bossId]`, a flavour line on
  Discord kill cards. Those are UI changes, so options come first.

## §169 — The announcer cast: miMIC, Bristlebane and Lord Mobsincamp (2026-10-06)
*2026-10-06 · DECISIONS-2026-09-21.md · Announcer cast personalities*

The guild lead: *"Develop me really kickass Raid Announcers and personalities for the miMIC, Bristlebane, and Lord
Mobsincamp. miMIC is the tactical arm of the raid, Bristlebane is the diety of fun in the chaos, and Lord Mobsincamp
is the diety we worship, who praises us with kind fortune for keeping its namesake, mobs-in-camp … This is likely
the last time we all play a game together, and I want it to be easy to enjoy, fun to be with, and have a spark
that's unique to this experience."*

- **Written:** `docs/DESIGN-raid-announcers.md` (the cast bible v0.2) and `docs/DESIGN-announcer-engine.md`. Six
  researchers, three drafts per persona, a judge each, an ensemble pass, five adversarial reviews (raid leader, EQ
  veteran, kindness, engineer, spark) and a final synthesis.
- **Three lanes:** miMIC owns *now* (your ear, you alone); Bristlebane owns *just now* (the room's laugh); the Lord
  owns *always* (meaning and the Ledger).
- **Hard rules the reviews forced:**
  - miMIC is the only voice in a fight. The gods never speak in a fight, over an opted-in caller, or during a loot
    call; otherwise they post text.
  - CH GO gets a priority rung nothing else shares.
  - Every line is written ahead and reviewed; no model speaks live.
  - Today's guild triggers that already speak the same moments ("Enrage on", "Rest in Peace", DI landed) are
    retired as miMIC takes them over, so nothing is called twice.
  - Naming follows one consent setting (`announce_name`).
- **Personas are Character Card V2 files** plus one shared lorebook (§167).
- **Samples:** 24 voice samples (two castings per persona) are on the guild lead's Casting Room page.
- **Private:** the hardware plan and the last-night drafts went to the private briefing (Home lab → Hardware plan),
  per §167.
- **Waiting on the guild lead:** a voice for each persona, and six picks. The recommended option in each:
  - what "mobs in camp" measures: A, a raid-wide streak of clean pulls;
  - how miMIC's new calls ship: A, re-voice today's first, then promote one at a time;
  - whose voice Bristlebane is: B, the guild lead performs it;
  - who is named in praise: A, after a one-time notice;
  - the Thank-You Embargo: B, the Lord only;
  - where the always-on GPU lives: A, the Tower transplant, gated on a bench test.
- **This week, once the picks land:**
  1. Retire the doubled callouts.
  2. Prove Bristlebane can play audio in Discord voice.
  3. Latch each Planes of Power first kill.
  4. Re-voice today's callouts as clips.

## §209~2 — eqmimic.quest becomes a landing page for newcomers, with three layouts and a loud rights notice (2026-10-08/09, web [beta])
*2026-10-08 · DECISIONS-2026-09-21.md · eqmimic.quest newcomer landing page*

**The ask** (the guild lead): *"a landing page for someone that's new to Mimic to be able to deploy it for themselves as
standalone, have an understanding of what each component does as a walk-through. There should be a section that says: do
you want more hive mind? here's how your guild can implement this ... I will provide some video that we can clip and have
some little highlights on the main page ... Make sure there is clear distinction on the page about the rights being
Daybreak's and this being a fan site; use the language from WolfPack.quest."* Built on branch `claude/eqmimic-landing`
(not pushed; one commit, so the web commit is the tip for the Vercel ignore step).
- **Routing changed.** The eqmimic middleware branch used to send EVERY path to the form. Now `eqmimicLandingTarget`
  (`web/lib/eqmimicHost.ts`, shared by the middleware and the tests): `/feedback` -> the form (Mimic opens exactly
  `https://eqmimic.quest/feedback#…` and refuses any other address, so that path is not negotiable); `/`, `/index` and
  every other path -> the landing page, keeping ONLY a `?v=b|c` layout preview, all other parameters dropped. Unknown
  paths land on the landing page as the safest default (a stray link reads a page, not a form). The branch stays FIRST
  in the middleware, before the link-preview rewrite and any session client.
- **The shell lost its width.** The bare eqmimic layout no longer wraps children in `max-w-2xl`; the form page carries its
  own `mx-auto max-w-2xl` (identical look on the host) and the landing sets a wider one per layout (A 3xl, B 5xl, C 6xl).
  On wolfpack.quest the form is now centred in its column; nothing else there changed.
- **Three genuinely different layouts, one content module** (`web/lib/eqmimicLanding.ts`; `?v=`: none = A, `b`, `c`):
  **A, Walk-through:** one column, a numbered journey, sticky section nav, reads like a guide. **B, Ledger:** a two-column
  "On your PC (free, no account)" against "Needs a guild server" first, then highlights, privacy strip, an FAQ accordion,
  the walk-through, hive mind last. **C, Reel-led:** the highlights reel is the hero, an overlay gallery follows, the
  walk-through and hive steps compressed below. Costs: build ~ a day (shared blocks), maintenance LOW (one module, no
  layout logic), runtime near zero (server components, no client JS, no new dependency), change LOW until a layout is
  picked, then delete the other two. When one is picked, graduate it and remove the others in the same change.
- **The rights notice is the loudest block, not the quietest line.** wolfpack.quest keeps it as the footer's last dim
  sentence; here it is a gold-bordered "Fan site notice" panel directly under the hero in all three layouts, repeated in the
  footer, in the wolfpack.quest wording VERBATIM plus one sentence of ours (fan project by a guild, AGPL-3.0-or-later). A
  test reads `web/app/layout.tsx` and compares the sentence sets so the two cannot drift.
- **Content calls.** Windows is the supported target, Linux/Deck labelled experimental. Local mode is described as what it is
  (nothing sent to any guild server; guild-only overlays empty). The guild section carries an "honest list" box: wizard only
  designed, Mimic's links and branding still hard-coded to wolfpack.quest so a guild builds its own Mimic (about a day),
  `.env.example` still holds our defaults, no self-serve game-data catalog (~100 MB), no `doctor`. Costs are the measured
  2026-09 figures (about $30/mo). The one demo guild in the page is invented ("Lantern Watch"); no member, id or address.
- **Video slots.** `HIGHLIGHTS` (4 cards, `src`/`poster` optional): a card with `src` renders a muted, lazy `<video controls>`,
  otherwise a "clip coming" placeholder. Nothing external is fetched or embedded. The guild lead supplies the clips.
- **Metadata.** Title `[beta] Wolf Pack Mimic — a free overlay suite for Project Quarm`, `noindex` like the feedback page. A
  `[beta]` badge heads each layout ("this page is new — tell us what's missing" -> the form) and a corner switch labels A/B/C.
- **Tests.** `test/eqmimic-landing.test.js` (new: routing function, middleware run, verbatim notice, placement, content,
  video slots) and `test/anon-feedback-surface.test.js` (changed ONLY where behaviour deliberately changed: `/` and unknown
  paths now rewrite to the landing page instead of the form; the "first in the middleware" and layout-ordering assertions are
  kept; the middleware slice now expects `eqmimicLandingTarget`). Mutation-checked: a changed word in the notice, the notice
  removed from layout C, the footer notice removed, every query parameter kept, and `muted` removed from the video each
  turn a test red.
- **Not done / for the guild lead.** Pick A, B or C and send the clips. DNS for eqmimic.quest still points elsewhere
  (`docs/RUNBOOK-eqmimic-domain.md`). The sticky-nav offset under the Wolf Pack header on the beta host is a guess (header
  measured 51 px on production, the beta banner height was not measured).
- **Addendum 2026-10-09: the guild lead picked the structure, and it is none of A, B or C.** *"landing page should be a large
  video page to start, where people can click in and view each recorded scenario. then highlights of the overlays, then
  setup."* The three layouts were retired in one change (they stay in git history at the commit before it): `LayoutA/B/C.tsx`,
  the A/B/C switcher, `eqmimicLandingVariant` and the `?v=` handling are gone. `eqmimicLandingTarget` now drops EVERY query
  parameter (a stale `?v=b` link just shows the page). One page, `web/app/eqmimic/_landing/Landing.tsx`, in this order:
  compact header (name, pitch, Download, a small `[beta]` badge linking the feedback form) -> the large player with its
  scenario picker (right column on desktop, a scrollable row of cards on a phone) -> the fan-site notice, directly under the
  video block -> the overlay gallery (name, purpose, `[local]`/`[guild]`; optional `still`/`clip` slots, rendered only when
  set) -> standalone setup (six steps, local-mode box, troubleshooting, and the "On your PC" against "Needs a guild server"
  ledger folded in from the old layout B) -> what each piece does, privacy, "Want more hive mind?" (compact) -> footer with
  the notice again. The FAQ accordion went with layout B (every answer is on the page already).
  **Scenarios.** `SCENARIOS` replaces `HIGHLIGHTS` in `web/lib/eqmimicLanding.ts`: `{slug, title, caption, src?, poster?,
  durationSec?}`; six placeholders (`dps-threat`, `triggers`, `charm-pets`, `hive-mind`, `zone-timers`, `setup`) until the
  guild lead supplies clips. A click loads the scenario into the big player and sets `#clip-<slug>`; opening the page with that
  hash preselects it (`scenarioFromHash`, pure and unit-tested; a fragment that names no scenario, like `#setup`, never resets
  the selection). The player is the only client component; no autoplay, nothing external. Costs: build ~ half a day, maintenance
  LOW (one layout, one module), runtime one small client component (no new dependency), change LOW (a scenario is one array
  entry). Tests: `test/eqmimic-landing.test.js` (order, notice placement, scenario shape, hash helpers, the "query dropped"
  cases that replace the `?v=b|c` ones), `test/anon-feedback-surface.test.js`. Still open: the clips, DNS, and the guild lead
  saying when `[beta]` can come off.

## §289 — Lord Mobsincamp is an ancient wolf god who runs with the pullers; a pre-raid video for Wednesday (2026-10-13)
*2026-10-13 · DECISIONS-2026-09-21.md · Wolf god mascot look and pre-raid video*

- **The look (the guild lead):** an ancient anthropomorphic wolf god, robed and wizened, weary of time, a glowing
  hourglass floating on a chain, lassos and whips in holsters for pulls; runs on the wind, tight around corners,
  vigilant, one eye on the Pack and on where we go next; runs with the pullers and watches for the raid lead's
  eye contact. Written into the cast bible (docs/DESIGN-raid-announcers.md, Lord Mobsincamp → Identity: "Look"
  and a new portrait prompt; the seated-keeper portrait is marked superseded). He still never fights.
- **The video (the guild lead):** *"let's start putting together a video that we will probably have to generate a
  lot of after 1pm est today"* (Wednesday 2026-10-14). Generation runs on V5 (§288). This session prepares the
  production pack first: character reference sheet prompts, a storyboard tied to the pre-raid monologues,
  per-shot image and LTX prompts, and the job list.

## §291 — Lord Mobsincamp's voice: the guild lead performs it, Seed-VC on V5 re-voices it (2026-10-14)
*2026-10-14 · DECISIONS-2026-09-21.md · Mascot voice via voice conversion*

- **The pick (the guild lead):** *"let's do B on v5"*: of A (effects only), B (voice conversion on V5) and C
  (a paid cloud speech-to-speech service). The guild lead records the script; Seed-VC (zero-shot voice
  conversion, GPL-3.0, pinned to commit `51383efd`) keeps the delivery and swaps the timbre; an ffmpeg ghost
  chain (pitch, faint high double, echo, loudness level) goes on top.
- **The target voice is synthetic, on purpose:** four reference clips made with Gemini TTS voices (Algenib,
  Gacrux, Charon, Enceladus) reading a Lord Mobsincamp line, under 25 s each (Seed-VC clips longer references).
  No real person's voice is cloned.
- **Install shape:** a self-contained `C:\wolfvoice` on V5 (own Python 3.10 venv, own PyTorch 2.7.1 cu128,
  own model cache), so it never touches the image-generation stack. Upstream's requirements file names torch
  twice and cannot install as written; the script installs torch first and the rest without the torch lines
  (and without `resemblyzer`, which is evaluation-only and needs a compiler on Windows). The kit lives in the
  session scratchpad and was handed over as a zip; nothing of it is in the repo.
- **Not yet:** a live wolf voice. Home Assistant Voice PE can play the finished files as announcements, but a
  speaking, answering Lord Mobsincamp needs a TTS that can clone the target voice plugged into Home
  Assistant's own voice pipeline. `huggingface/speech-to-speech` speaks the OpenAI Realtime protocol, not Home
  Assistant's, so it does not plug into the PE directly.

## §370 — raidmimic.com is the guild leaders' door; eqmimic.quest stays the players' (2026-10-18, web 1.9.5)
*2026-10-18 · DECISIONS-2026-09-21.md · raidmimic.com for guild leaders, eqmimic for players*

The guild lead: *"C was for raidmimic.com"*. That is option C from §369's list, "two doors": **eqmimic.quest** stays the
free EverQuest player tool, and **raidmimic.com / .net / .quest** becomes the game-agnostic page selling raid
orchestration and analytics as a service to guild leaders.
- **The page (new, so it ships to `main` marked [beta]):** `web/app/raidmimic/`, all words in
  `web/lib/raidmimicLanding.ts`. Two layouts, as usual for a UI pick: **A "The pitch"** (default, text first, reads as
  an argument) and **B "The tour"** (`?v=b`, drawn screens first with the small print folded away). Every block carries
  a status (live / alpha / coming) and one "What is not built yet" list holds every promise; a test fails if anything
  is marked coming that the list does not name. No price list, customer count or testimonial: the one number is our own
  measured hosting bill, labelled as scale and not a quote. "Register interest" opens the existing anonymous form on
  eqmimic.quest as an Idea (AFB rules apply: untrusted text, read by people). Not indexed yet, like eqmimic.
- **Hosts:** `web/lib/raidmimicHost.ts` lists six names; the middleware rewrites every path on them to `/raidmimic`
  with the query dropped (so `?v=b` is only visible on wolfpack.quest), and the root layout drops the Wolf Pack chrome.
- **Vercel, done this session:** all six names are on the project as 307 redirects to eqmimic.quest. They cannot chain,
  so each points straight at eqmimic.quest. DNS is still Porkbun's parking page. **To serve the page on raidmimic.com:**
  set the DNS (apex A `216.198.79.1`, `www` CNAME `cname.vercel-dns.com`; Vercel also suggests a project-specific
  CNAME, either works), then remove the redirects on the six domains.
- **Copy matches the privacy page:** the private-chat line was checked against `docs/PRIVACY.md` and gained the tells
  clause (tells are dropped too unless the player turns relay on).

**Same day — character gender lives in OpenDKP, not in our tables.** The guild lead corrected a "we hold nobody's gender"
claim: OpenDKP's roster (`GET /clients/wolfpack/characters`, the same call `getCharacters` in `utils/opendkp.js` makes)
carries `Gender` per character ("Male" / "Female", occasionally "F", sometimes blank). Of the 69 active mains, 66 have
one; the guild lead confirmed three corrections against it. `utils/openDkpSync.js` copies `race`/`class`/`rank` into
`characters` but not gender, and `raid_night_appearance.gender` stays NULL until Zeal sends entity looks. **Before
saying gender is unknown, read OpenDKP.** The guild-hall sprites (scratch only) now draw from it. Storing it in
`characters` (one column + one line in the sync) waits until the raid spectator needs it from the web.

## §385 — Raid Mimic's business model: managed hosting, billed to the guild (2026-10-20)
*2026-10-20 · DECISIONS-2026-09-21.md · Raid Mimic managed hosting business model*

The guild lead: *"eqmimic can be a spot for self-hosted guilds to redirect their clients… raidmimic would be fully
hosted, but cheap enough to cover costs to start"*; *"truly free can be a limited subset"*.
- **B, managed hosting per GUILD.** The Mimic app and self-hosting stay free and AGPL. No per-player plans (the
  $1/month idea is dropped). The bill goes to the guild, never to a player.
- **Nothing is sold under the eqmimic name.** eqmimic.quest is the free directory (§388); anything paid goes through
  Raid Mimic.
- **Why:** the guild lead, on charging at all: *"feels like justifying domain names and server costs is going to be the
  extent of this, and pqcompanion is free"*. A free per-player tool already covers the solo side, so the only thing worth
  running as a service is the shared layer, and that bill belongs to the guild. A $1/month per-player plan was the first
  idea (2026-10-20) and was dropped: card fees eat up to 43% of it, and it charges players of someone else's game.
- **Next:** nothing built; pricing is §386, data model §387, the interest form is in §393.

## §386 — Raid Mimic's price: flat per guild, sized to about three raid nights a week (2026-10-20)
*2026-10-20 · DECISIONS-2026-09-21.md · Flat monthly price per guild*

The guild lead: *"base the $25/month around 3 raids a week"*.
- **$25/month, or $250/year, up to 60 raiders.** Measured on a real week (10/13–10/19): 567 MB of new rows, 38–44
  players, 3 raid nights. At 60 raiders that is about **$16/month marginal cost after compressing the heavy routes**
  (`/poll`, buff-queue, live-damage), so the margin depends on a compression change that is **not built yet**.
- **Trial:** 14 days. The guild lead: *"this is the last expansion on this server as far as we're aware so giving 2 free
  months may just mean free entirely"*. The annual price is not pitched as "2 months free".
- **Full raw fight data is a +$5/month add-on**, asked at signup: *"someone that wants full data can pay to keep it. ask
  early"*.
- **Revenue floor $60/month confirmed.** The guild lead notes the $100 Claude plan is part of the real cost (about $131
  all in).
- **Revenue mix:** hosting, plus members' cost-share meter (labelled honestly) with GitHub Sponsors as the rail, plus
  direct designer tips. The Decision Desk "kit" option was re-asked after *"nobody will pay these options"*.
- **Next:** compress the three routes (Open table); the guild lead reads Supabase egress in the dashboard.

## §388 — eqmimic.quest directory is lookup only (2026-10-20)
*2026-10-20 · DECISIONS-2026-09-21.md · eqmimic guild directory is lookup only*

- **A, lookup only:** a signed discovery document at `/g/<slug>`, no DNS records. Free tier = one verified name, lookup,
  signed card, status, 24 updates a day. Paid extras only through Raid Mimic (§385).
- **Recommendation recorded: skip the name-server move.** Proxy `/g/` from the existing site to a Worker instead.
- **Next:** not built.

## §393 — raidmimic.com: a "How it works" scene, and its own interest form (2026-10-21)
*2026-10-21 · DECISIONS-2026-09-21.md · raidmimic.com How it works scene and form*

- **B:** the iso-glow about scene goes in as a "How it works" section under the existing layout. Not built; a draft
  artifact exists. The iso-glow kit (MIT) was installed for the session only; committing it under `.claude/skills` is an
  open call.
- **A:** Raid Mimic gets its own register-interest form instead of routing to eqmimic's anonymous feedback. Not built.

## §409 — raidmimic.com: animated overlay clips and three more layouts to pick from (2026-10-22, web 2.0.3, beta)
*2026-10-22 · DECISIONS-2026-09-21.md · raidmimic.com animated clips and layouts*

The guild lead: *"generate more artifacts for raid mimic.com and give me a number of options for layouts site designs on
decision desk. animated versions of the overlays, one of us killing Grummus and then hailing the projections. the extended
targets each with a different tag but the same name for Vallon Zek fight, Target info starting with the boss stats and
bubbles, then getting Tash, Malo, Sha's 65% slow, then Turgur's, snare, etc etc until it's loaded up with dots, and we see
all of the nukers casting on it."*
- **Clips are the REAL overlays, recorded.** `scripts/raidmimic-shots/scenes.mjs` drives the shipping `apps/mimic/*.html`
  in Chromium against a stand-in agent whose answers follow a script second by second (chat lines go through the agent's own
  chat code), captured at ~20 fps and encoded to muted H.264 mp4 + a WebP poster (190–500 KB each), in
  `web/public/raidmimic/clips/`. Invented raiders only (fixtures.mjs `PLAYERS`); mob stats and spell durations are the game's
  own (eqemu_npc_types, eqemu_spells).
- **Target Info is the Vallon Zek fight, not Grummus.** Grummus (205091) is Unslowable and Unsnareable in the game data, so
  the overlay's own chips would contradict the slow landing on him. The Tactics Vallon Zek (214316, L73, 175,000 HP) is
  slowable and snareable, and the real one runs, which is why a raid snares it. Order: Tashanian, Malosini, Sha's Revenge 65%
  (BST), Turgur's Insects 75% (SHM) replacing it on the slow badge, Ensnare, DoTs, nukes in the casting list, 100% → 61%.
- **Extended Target:** the split at ~60% into five rows named Vallon Zek, each tagged (red REAL, orange 2, yellow 3, green 4,
  blue 5: the shapes this overlay draws today; the fork's skull/sword shapes do not render in Extended Target), fakes die first.
- **Hail:** Command Center beside Chat: Grummus dies, the hail board moves 16 names from Still to hail to Hailed, "You have
  received a character flag!". The projection's full reply is not in the repo, so the clip does not invent one.
- **Layouts (previews, beta only):** `?v=d` Scene-first (a tabbed player), `?v=e` Raid-night story (a beat per clip),
  `?v=f` Your screen (all three at once on one dark "monitor"), beside the tour (default) and `?v=b` Output first, still
  unpicked from §404. Posted on the Decision Desk as card `raidmimic-layout-clips`. When one is picked, graduate it and delete
  the others in the same change.

## §418 — raidmimic.com captures never carry a real name — and "invented" names are checked, not assumed (2026-10-23, web 2.1.9 beta)
*2026-10-23 · DECISIONS-2026-09-21.md · Marketing captures use invented checked names*

Screenshots from a real raid cannot go on the public page; the six new views (Map + Target Info, HUD Box, CH chain, DPS list +
meter) are drawn by `scripts/raidmimic-shots` from fixtures. Three names in that pool turned out to be real players (one in our
characters table, two in /who) and had been on beta's captures since web 2.0.3: replaced and every capture re-made. Any new
invented name is checked against `characters`, `who_observations` and `eqemu_npc_types` before use. The old files remain in git
history (not rewritten).

## §427 — The living mimic goes vertical, in the real gamer room, with a sweet voice (2026-10-24)
*2026-10-24 · DECISIONS-2026-09-21.md · Living mimic video goes vertical*

The guild lead, on the first vertical cut: *"I don't like the way the vertical cut looks ... The ears should be on the corners like
this version ... Instead of the screaming noises, please instead remove those super loud noises, equalize the whole thing, and have
it say in a new robotic sounding cheery voice 'Hi! I'm your new raid mimic! Lets get you set up!'"*, then *"he shouldn't be jumping
in front of the screen, he should be slightly further up the desk out of the way"*, then *"The voices are too robotic, it should be
a sweet little voice, but just a little warble variability, just for pzazz"*. Earlier the same day: the realistic-style references
were "not what I envision ... I like our cartoony mimic, but the background and the game screen looks cool, and vertical is great
for both mobile and desktop"; camera pick **A** (front, screen readable); "re-render the whole story in the new look".
- **The look:** our cartoon mascot (never the realistic one) in the guild lead's gamer-room reference (posters, big game screen,
  RGB keyboard, headset), **9:16**, camera from the front. The mascot sits low on the desk, smaller, with a clear band between its
  ears and the monitor, so the whole screen stays readable; **the ears stand on the lid's front top corners** (the official
  mascot anatomy), never at the back. Gemini's edit mode would not move or shrink the chest, so the base frame was built by hand:
  the mascot cut out, the desk painted in behind it, the mascot placed lower and smaller; every other still is a Gemini edit of
  that frame, so the composition cannot drift. Hops are written as small and low, and a beat whose box turned into a furry animal
  (the model's favourite failure, DECISIONS §424) is re-rolled with "it remains a hard-edged wooden box" in the prompt.
- **The sound:** no howls or screams. The soundtrack is ducked where they were, compressed and loudness-normalised, and the greeting
  "Hi! I'm your new Raid Mimic! Let's get you set up!" plays at 8 s as the face appears. **The voice is a sweet one with only a
  hint of warble** (vibrato plus a faint shimmer, no ring-mod, no vocoder); the three robot treatments on the Decision Desk are
  retired for the mascot. Voice pick pending between Leda (recommended), Aoede and Kore.
- **The page:** headline on the left and the 9:16 video on the right on a desktop (the kit's "room for a headline" rule), full
  width on a phone, the strip of real captures below (web 2.1.22 on beta; the new-look cut replaces its files).
- **Later the same night:** the first gentle mix was still "far too much loud noise" with "giggles" and "little squeels", so the
  LTX-generated bed was dropped altogether: the soundtrack is now synthesised cues (low wooden pops, soft whooshes and thumps, a
  faint room tone), the greeting in Leda's voice at half level, and the raid leader low in the background, concerned during the
  fight ("Ramp on <name>, who's got the D.I.?", "Tank down! <name>, pick it up", "Burn, burn, burn", "ten percent", "Down! get
  them rezzed, do loot", "Loot's posted, congrats <name> on the circlet"; invented names). The monitor plays a fight to match: the
  tank goes down, a new tank runs in, the raid burns the boss, it dies, the raid gathers for loot (five LTX clips chained from the
  raid still, cut to the voice timing). The loop's last six seconds carry only the bed, so a voice line never repeats.
- **Where it landed:** web 2.1.25 on beta (`?v=motion`), the Decision Desk's Brand & media tab (the cut, the base frame, the
  greeting), the synth script and mix in the session scratchpad (`final/audio/gentle.py`).

## §428 — The living mimic is built in LAYERS; the raid loses first; the PLAYER wins it (2026-10-24)
*2026-10-24 · DECISIONS-2026-09-21.md · Living mimic scene built in layers*

The guild lead, on the 2.1.25 cut: *"quite a bit of the scene does not look good. there are all sorts of clipping issues, the
mimics box comes apart or gets cut off or the hinge at the back gets undone when it's jumping. the whole point is that the raid is
supposed to be losing the fight at the beginning after the raid mimic comes in and starts watching what's happening from the game.
it should be a little bit longer. the overlays don't really fit well into the gold boxes in this version. the mimics nose starts
out much larger and then goes back into its face and become smaller. everything for the mimic should be rendered in front of
monitor, including the overlays as they jump around. for the raid encounter, another warrior should run in and roar at the ogre
engaging it in a fight. the raid leader that we hear over the computer is not the one that calls for the moves that turn this
fight from a loss into a win. its the player."*
- **Layers, not one generated scene.** Every earlier cut asked the video model for the whole room at once, then cut the mascot
  back out with a segmenter, which is where the clipping, the cut-off box and the misfit overlays came from. Now: the room is
  one still plate; the monitor is a canvas warped onto the glass (the fight + the overlays, **drawn in code, each panel sized to
  its picture's own aspect so it fills its gold frame exactly**, 72% opaque like Mimic's real backdrops so the fight shows
  through); the mimic is animated **alone on pure black** and keyed (bright body + filled holes, so an open mouth stays solid)
  and placed on the desk **in front of everything**; the flying overlays are drawn in code, emerging from the mouth, circling
  the mimic (behind it on the far side of the circle, in front on the near side), then slamming onto their exact frames with
  a shake. **This is the method for any future mascot scene**: a layer the model draws can be wrong; a layer we draw cannot.
- **The box stays whole.** The jumps are moves in code (a lift, a squash, a tilt) applied to the keyed mascot, never asked of
  the model; the model only animates the face, the ears and the lid in place. The stills are one forward chain (closed chest →
  ears out sideways → ears up + snout → face), so **the nose is drawn once and kept**: removing features from a finished face
  (the earlier backwards chain) is what re-sized it. A beat whose ears turned into round bear ears was re-rolled with "the ears
  stay tall, pointed and upright".
- **The story, 64 s.** Asleep; a spark from the monitor wakes it; the ears, the snout, the face; the greeting. The raid on the
  screen is LOSING the whole time it watches (raiders falling, the tank going down, the ogre rampaging through the healers) while
  the raid leader, over the desk speakers, sounds worried ("Tank down! Unity lost... this is going bad", "Ramp on <name>, who's
  got the D.I.?", "Is this one even slowed? We are losing healers"). The mimic drinks the game in (streams from the screen to its
  mouth), howls, the overlays fly out, circle and land. **Then the player calls the fight**, close and clear (a different voice
  from the leader): "<name> has Area Taunt! <name>, D.I.! Skip three, go four!" as **a new warrior in silver with a red cape
  charges in and roars at the ogre** with a burst of red light, "One minute left on Beast Slow!", "Pure Tone Dirging! Pop
  discs!" as the raid burns; the ogre falls; the leader, relieved: "Down! Wow, nice calls. Get them rezzed back up and do loot",
  "Loot is posted, two minutes". The mimic hops proudly from one corner of the desk to the other. The loop is one full hop cycle
  (3.6 s), so it has no seam.
- **Cost of the rebuild:** about $14 of LTX (12 mimic beats at 1080x1080 + re-rolls, 8 fight clips at 1080p) and a few cents of
  Gemini stills and voices.
- **Where it landed:** web 2.1.26 on beta (`?v=motion`, https://b.wolfpack.quest/raidmimic?v=motion); the compositor
  (`v3/comp.py`), keyer (`v3/key.py`) and soundtrack (`v3/sound.py`) in the session scratchpad.

## §429 — The living mimic's ending: the loot card, the fight timeline, a quieter track (2026-10-24)
*2026-10-24 · DECISIONS-2026-09-21.md · Mimic video ending, quieter audio*

The guild lead, on 2.1.26: *"the wooshing fan in the background is actually very annoying and it makes it so that the looping
at the end doesn't work very well. when he says ... pop discs we should see a bunch of characters run in. in the first set of
videos when the overlays slapped against the screen it made a more satisfying sound with a small shake. after the enemy is down
we should see the little pop-up from the mimic saying what loot is. a green button next to the loot gets clicked and it streams
onto the screen. after that the fight timeline view pop up on the mimics little screen and grows from the left beginning of the
fight to the end of the fight on the right with the dip in the middle where many of the players died and a burst damage after
it gets picked back up. the mimic should be able to look back up at the screen and have more animations than just bouncing back
and forth"*; then, on the drops: *"not the spell."*
- **No background bed.** No room tone, no fight hum: between the cues the track is silent. A continuous bed is what made the
  loop audible at its seam; the loop's sound is now the story's own track over the loop span, silent at both ends.
- **The slam is the first cut's slap**, lifted from that cut's generated audio (one clean hit, re-pitched a little per panel)
  over a soft thud, with the small shake kept.
- **"Pop discs" brings the raid in:** a crowd runs in from both sides and the burn starts (the last three fight clips
  re-chained from the warrior's clip, so the fight stays one continuous take).
- **After the kill, drawn in code:** a LOOT card pops out of the mimic with three drops (**no spell scrolls** in the mascot's
  loot), a cursor clicks a green **Post** button, the rows fly onto the monitor into a loot panel with a 2:00 timer as the
  leader says "Loot is posted, two minutes"; then a little gold-framed screen rises from behind the mimic and draws the **fight
  timeline from pull to kill**: steady damage, the dip with the deaths marked, "Area Taunt", the burst after the pickup, the kill.
- **More than hopping:** the 12 s ending loop looks around, hops left, looks up at the screen, looks back, chomps its lid
  happily, hops right and home. A beat whose ears turned round ("look around") was dropped rather than shipped.
- **Where it landed:** web 2.1.27 on beta (https://b.wolfpack.quest/raidmimic?v=motion), 83 s; `v3/ending.py` in the
  session scratchpad holds the loot card, the loot panel and the chart.

## §430 — The player's voice is the gravelly one; raidmimic.com goes live page-first (2026-10-24)
*2026-10-24 · DECISIONS-2026-09-21.md · Gravelly player voice; site goes live*

The guild lead, on the player's calls: *"the players voice just sounds very generic AI blah can you give me a couple of options
to choose from? also the part where it says it's beast slowed sounds bad"*; four voices went on the Decision Desk, each in the
14 s of the video around the calls; then *"A gravely, B now then A"*.
- **Voice A (gravelly)** for the player, read as a gamer on voice chat mid-fight (not an announcer). The slow call is now
  "Slow has a minute left, beasts be ready." Web 2.1.28 on beta.
- **"B now then A":** the page goes live first and the story video follows later. Web 2.1.29 on `main` carries only the
  raidmimic files from `beta` (the page, its words, icons, How it works, robots/sitemap, the middleware's asset pass-through,
  the page's title and the roadmap entry), never the rest of beta (the route planner, /pop and spectator work stay there).
  The `?v=motion` preview is honoured only by a beta build (`IS_BETA` in `page.tsx`), so production can never point at the
  story files, which stay on `beta` until step A; the file checks in `test/raidmimic-landing.test.js` run wherever the files
  ship and a test pins the gate.
- The roadmap entry and `web/package.json` were set identically on both branches, so the main→beta sync merges clean.
- **Where it landed:** web 2.1.28 on `beta`, web 2.1.29 on `main` (https://wolfpack.quest/raidmimic); STATUS.md and
  HOW-ITS-BUILT.md updated.

## §431 — The mimic talks; the overlays answer each call (2026-10-24)
*2026-10-24 · DECISIONS-2026-09-21.md · Mimic lip-sync and overlay call-outs*

The guild lead: *"mimic should move its mouth when saying it's intro and " let's get you set up" pulse some spots on the overlays
as it goes up. who has Area Taunt? where is the CH chain at?"*
- **Lip-sync by replacement, not generation.** Three mouth shapes of the same face (closed, half, open) were made as Gemini
  edits of the face still and pasted into it through ONE fixed mouth mask, so only the mouth changes; each frame's shape comes
  from the greeting's own loudness (a mouth held at least two frames, leading the sound by a frame), with a small bob on the
  syllables. A video model cannot follow a soundtrack; a cartoon mouth chart can. (`v3/talk/talk.py` in the scratchpad.)
- **The overlays answer the calls.** The CH chain capture joins the monitor. The spot each call reads from pulses as the
  player says it: the Command Center's Defensives row (painted to read "Rethlan · Area Taunt · READY"), Zarrin at 31% in the
  HUD's group for "Zarrin, D.I.", CH 003 marked SKIP in red and 004 GO in green ("skip three, go four"), the timeline's
  "01:01 Tagrin - Slow" row, and the bard's song bar and damage line on "Pure Tone Dirging, pop discs". (`v3/spots.py`.)
- **Where it landed:** web 2.1.30 on beta, https://b.wolfpack.quest/raidmimic?v=motion. The live page is unchanged.

## §432 — The story ends on the flags (2026-10-24)
*2026-10-24 · DECISIONS-2026-09-21.md · Video ends on flagging interface*

The guild lead: *"the end of the video should have the mimic show the flagging interface on the menu. have the raid lead say
"make sure you hail the Projection for your flags" highlighting the flagging section of command center"*.
- After the fight timeline, the raid leader (over the desk speakers) says "Make sure you hail the Projection for your flags";
  the Command Center's HAIL section on the monitor glows gold for the length of the line.
- The mimic's little screen flips like a card from the timeline to the flags view: HAIL · A Planar Projection, the time left,
  "Still to hail" and "Hailed" counts, and sixteen names turning green one by one as the raid hails. Drawn in code, at twice
  the size and scaled down, so the small text stays crisp.
- **The little screen is now its own layer:** hidden by the mimic while it rises out from behind the box and while it sinks
  back, in front of it once it is up, so the names beside the mimic's ear stay readable. (`v3/ending.py`.)
- The story is 90 s; the 12 s loop is unchanged, only later. **Where it landed:** web 2.1.31 on beta,
  https://b.wolfpack.quest/raidmimic?v=motion.

## §433 — A square cut for wide screens, captions while muted, a CC0 beat (2026-10-24)
*2026-10-24 · DECISIONS-2026-09-21.md · Square cut, captions, CC0 music*

The guild lead: *"it looks ok to me. we should find an open source low beat to put in the background, and if it's muted have
closed captions"*, then *"can we generate the area around it as well in case we are looking at this on a horizontal monitor? I
basically would make it a square video"*.
- **Music must be CC0 or plainly CC-BY, verified on the track's own page.** Four CC0 lo-fi tracks from opengameart.org were
  checked (each page's licence field reads CC0, linking creativecommons.org/publicdomain/zero/1.0/). In the cut by default:
  **"Lofi again" (Omfgdude)**, about 90 s, quiet; ducked ~8 dB under every voice, faded in and out; the loop carries a slice of
  it with its seam crossfaded. The other three are on the Decision Desk for the guild lead's ear. No credit line is required;
  the page may still credit the author as a courtesy.
- **No background bed beyond the music** (§429 still holds): between cues the track is the beat alone.
- **Captions:** `web/public/raidmimic/motion/story.vtt`, every spoken line with its speaker (MIMIC, RAID LEADER, YOU) and the
  main sounds in brackets, timed from each line's own audio. A captions `<track>`: showing while the story plays muted,
  hidden once Sound is on, disabled during the loop (whose first seconds would otherwise show the story's first cues).
- **Square:** on a wide landscape screen (`(min-width: 1024px) and (orientation: landscape)`, ONE query for the files and the
  box shape) the stage is 1:1 and plays a square cut: the room outpainted to 1920×1920 by Gemini (it kept the original middle
  pixel-exact; the original is pasted back with an inside-only blend), the screen quad measured to the outpainted monitor's
  left bezel, everything else shifted 420 px. Phones and portrait screens keep the 9:16 cut. A browser that ignores
  `<source media>` plays the square inside the 9:16 box, which shows its middle: the vertical frame.
- **Where it landed:** web 2.1.32 on beta, https://b.wolfpack.quest/raidmimic?v=motion (`SQUARE=1` in `v3/comp.py`, `MUSIC=` in
  `v3/sound.py`, in the scratchpad). The live page is unchanged.

## §434 — Nonstop action: the fight never idles, "Unit lost", a focused mimic, battle music first (2026-10-25)
*2026-10-25 · DECISIONS-2026-09-21.md · Nonstop action pacing and battle music*

The guild lead: *"the "unity lost" Expression should say "UNIT LOST" Like a different RTS video game sound where a unit dies.
there's too much idle time where the boss isn't attacking. it shouldn't give everyone out in one shot. it should be one after
the other and faster after the initial tank goes down. don't have the mimic roll it's eyes. it's gaze is focused, not doofy.
it's there to do a job, but it's cute while doing so. the action is meant to be nonstop. the lo fi music works after the mob
does, but start with some quick paced combat music that fades when the boss is downed"*.
- **The fight never idles.** The losing half is five new clips (a 6 s opening that ends on the old chain's first frame, then
  three chained clips, then one interpolated into the warrior clip's first frame, so everything after it stays): the ogre
  swings the whole time, raiders fall one at a time, the tank at ~16.6 s, then faster; the rampage plays at 1.45–1.75x. Any
  slow-motion of game footage is out: it reads as idle.
- **"Unit lost." is the game's announcer, not the raid leader** (crisp computer voice, trimmed, metallic, a short slap), on
  each death that counts and closer together as the raid collapses (8.6, 16.6, 20.6, 24.0, 29.6, 30.6, 31.4 s). The leader's
  line is now "Tank down! This is going bad, guys." Captions name it GAME.
- **The mimic's gaze is focused.** Two new stills, a concerned-but-alert face and a determined little smile, both looking
  steadily at the screen, and six new beats built on them replace every watching beat; idle beats play only their steady
  stretch (`win:a:b` in `v3/comp.py`), since a video model's idle clip drifts (ears folding, the light dimming) part-way.
- **Music in two acts.** CC0 battle music from the start, ducked under voices, fading 53.5–56 s as the ogre falls; the lo-fi
  from 55 s. In the cut: "Determined Pursuit" (Emma_MA, opengameart.org, CC0, licence checked on its page); "Battle Theme B"
  (cynicmusic) and "Epic Boss Battle" (SubspaceAudio) are on the Decision Desk to compare.
- **Where it landed:** web 2.1.33 on beta, https://b.wolfpack.quest/raidmimic?v=motion. The live page is unchanged.

## §437 — The story video: fewer deaths, the greeting first, the player as the hero, and the Desk notes built (2026-10-25)
*2026-10-25 · DECISIONS-2026-09-21.md · Story video: fewer deaths, player as hero*

The guild lead: *"there are too many deaths happening in the video at a few points everyone is knocked down. 5 total unit
lost callouts (make them low like they're coming from the other raid leaders computer). get the mimic to say 'Hi! I'm Raid
Mimic! Let's get you some overlays for this fight, quick!' before anything negative starts in the video. the player who
installed mimic is the hero calling for the things that help win the fight. the mimic can turn around to face the monitor
then start collecting the data right away."* Plus the Desk picks with notes from 2026-10-24 that had not been applied.
- **Nothing goes wrong before the greeting ends** (10.8–16.0 s). Three new fight clips: the ogre presses with nobody down,
  then the tank and four more fall (≈16.3, 16.6, 21.7, 22.0, 26.2 s); casters and healers stay standing throughout.
- **Exactly five "Unit lost."**, quiet and band-limited as if from another raider's speakers (16.3, 19.3, 22.9, 23.7,
  28.1 s). Captions mark them `[faint: "Unit lost."]`.
- **The mimic turns to the screen as soon as it has spoken** and drinks the data straight away (16.2 s); the whole story
  moved 8.5 s earlier and is now 81.5 s.
- **The raid leader is Puck** (brand-lead-voice B): alarmed and stressed at first, encouraging after the kill, with far less
  speaker echo. The leader never calls the plays; every winning call is the player's (YOU).
- **The calls are featured** (brand-checks B): each one pops into a gold pane above the monitor, naming who called it and
  showing the overlay spot it reads from, magnified; it refreshes with a slide and a border flash on every call.
- **The fight timeline is DPS by class** (brand-graph A): a stacked chart; the dead fall off in the dips; rogues and monks
  spike a few seconds after discs, rangers less but longer.
- **Loot** (brand-loot B): the loot panel shows "DKP tick captured" and one bid extended by 30 s.
- **Music** (brand-combat C, brand-beat A): "Epic Boss Battle" (SubspaceAudio, opengameart.org, CC0) from the start, ducked
  harder under voices since it is a loud track, fading 45.8–48.3 s as the ogre falls; the lo-fi from 47 s.
- **Not built yet:** the site-reveal V1 note (a segment extends on an arm or projects like the summoned overlays, rotates
  and locks in, then the next does the same) waits for the site build after the video settles.
- **Where it landed:** web 2.1.34 on beta, https://b.wolfpack.quest/raidmimic?v=motion. The live page is unchanged.

## §438 — The story video: the right calls, real clerics, and a mimic that holds still (2026-10-25)
*2026-10-25 · DECISIONS-2026-09-21.md · Story video corrections: calls, clerics, mimic*

The guild lead, on the 2.1.34 cut: *"casters don't 'pop discs' only melee, like rogues, monks, rangers, and beastlords"*;
*"make sure the clerics are ressurecting people in the screen after the ogre dies. the clerics are wearing heavy metal armor
and white robes over"*; *"dirge is Denon's Desperate Dirge"*; *"we call out the healer that's going to do DI and then we're
saying to skip them in the heal chain so go four. that same healer should be the healer that's number three. the DI should
be the thing that says '<Player Name> DI: Ready'"*; *"the back of the box is coming undone again ... eyes rolling into the
back of its head ... most of the time it should be eyes forward ... it can look back at the monitor and back at the player.
at like 1:10 it starts jumping up and down like a rabbit ... the animation just stutters"*.
- **Discs are melee.** The fight timeline adds beastlords and stacks the melee on top: rogues, monks and beastlords spike
  a few seconds after discs, rangers less but longer, casters stay flat. On the monitor only melee run in on "pop discs";
  the casters hold back and cast.
- **Clerics wear heavy plate with a long white robe over it**, from the close camera on. After the kill they kneel by the
  four fallen and bring them back up in columns of golden light; the ogre stays dead.
- **Every fight clip is pinned to wide frames at both ends.** A free video-model clip drifted into a close-up twice, and
  the close-up ogre came out looking like a famous film character, which the model's content filter then refused. The
  anchor frames are the earlier wide frames, edited for the clerics (`v3/game4/`).
- **The calls line up.** The bard bar reads Denon's Desperate Dirge. The Command Center's Defensives gain a row,
  "Zarrin · DI: Ready", which the D.I. call pulses; Zarrin is number three in the CH chain, which is why the player says
  "skip three, go four".
- **The mimic is drawn from stills from 29 s to the end** (`v3/idle/idle.py`): one still of the box, only the eyes swap.
  Eyes forward most of the time, a glance up at the monitor on each call, the kill, the loot and the flags, a blink every
  six to eight seconds, a slow breath. The box cannot come apart because it never changes, and the loop no longer hops.
- **Where it landed:** web 2.1.35 on beta, https://b.wolfpack.quest/raidmimic?v=motion. The live page is unchanged.

## §439 — The story video goes live; the ogre is not Shrek; what it cost and how the next one is made (2026-10-25)
*2026-10-25 · DECISIONS-2026-09-21.md · Story video live; cost breakdown*

The guild lead: *"the ogre should not be Shrek"*; *"post it to raidmimic.com for now"*; *"how could this have gone differently
and not cost me three times as much as it probably should have? what was the final cost break it down"*.
- **Live:** web 2.1.36 made the story video the hero of https://raidmimic.com and https://wolfpack.quest/raidmimic (no
  query, no beta flag). Web 2.1.37 swaps in the cut with the new ogre.
- **The ogre** is a dark slate-grey warlord with tusks, a horned black iron helmet, spiked armour and a spiked mace, in every
  shot, and the opening wide shot's clerics wear plate under white robes too. The video model's own idea of "a horned ogre"
  is the famous film ogre: an unpinned clip turned into it within seconds, and its close-ups tripped the content filter.
  Every clip is now pinned at both ends to edited frames (`v3/game5/`).
- **What it cost (from the session record; prices read 2026-10-25 on docs.ltx.io/pricing and
  ai.google.dev/gemini-api/docs/pricing):** about 156 video jobs, 1,230 s of 1080p video at $0.17/s = **~$209**; 93 images at
  ~$0.135 = **~$13**; 37 voice lines, under $0.10; music CC0, free. **Paid generation ≈ $222.** Claude time on the video,
  priced at API rates (Opus 5.5: $4/$20 per MTok, cache reads $0.20, 1 h cache writes $8): **≈ $100**, with no separate
  charge on a subscription plan. About 10% of the generated video (~$22) is in the final cut. The rest, by stage: the first
  cut (~$82, replaced by the new look), the vertical re-shoot (~$22), mimic clips re-rolled for drifting faces (~$34), fight
  footage re-made for deaths, clerics, discs and the ogre (~$72). Failed or content-filtered jobs (about six) may or may not
  be billed; LTX's pricing page does not say.
- **How the next one is made (the lesson):** (1) a still-image storyboard with the voice and captions first, and the
  gameplay checked by a raider (who calls what, what the overlay shows, which classes do what) before any paid video;
  (2) the mascot as a rig (one master drawing or model, parts swapped by code, as `v3/idle/idle.py` does from 29 s), never as
  generated video, since a video model re-invents the face every clip (the teeth changing between shots); (3) a model sheet
  for the game cast before generation, every clip pinned at both ends from the first take; (4) drafts on a cheaper tier
  (LTX Fast is $0.13/s at 1080p) and only the final takes on Pro; (5) 10-second samples at each decision, not full renders.
  Estimated: under $100 all-in for the same film.
