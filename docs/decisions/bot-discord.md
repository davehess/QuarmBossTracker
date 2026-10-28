# Discord bot & community

Bot commands, Discord cards, feedback reports, onboarding, roster, Bristlebane. Oldest first. Find an entry by its ID in [the index](README.md); new decisions go in `inbox/` and are merged here.

## 2026-08-14/13 — "Discord was a source of semi-truth. Now it should just be a projection."
*2026-08-14 · DECISIONS-2026-08-14.md · Discord becomes a projection of the database*

**The call (guild lead, 2026-08-16, verbatim above).** Ratifies the architect doc's
decision #1 as direction, not just assessment. The rule going forward: **no new
durable state in Discord messages or state.json — Postgres is the home, Discord
renders it.** Migration of the existing estate is opportunistic and ordered by
blast radius (ARCHITECT doc Part II): state.json's ~10 dynamic keys first (the
redeploy-race class), then roster chunks, then hate embeds, then the parses
thread last — after which boot no longer reads Discord back at all.

Same session, the database layer got its first structural pass ("complexity I
have not designed in" — designed in tonight):

- **Award identity is schema, not code.** `loot_observations_award_uniq`,
  partial on `raid_id IS NOT NULL` so drop observations never collide, NULLS
  NOT DISTINCT inside the raid-bound world. 560 dupes deleted (backed up,
  droppable after 2026-09-16), verified refusing re-inserts. The fold and the
  backfill command write ignore-duplicates — re-runs are no-ops now.
- **One paginator per runtime, enforced.** Bot: `utils/supabase.js` (where the
  cap was documented all along). Web: `lib/selectAll.ts`; `supabase-paged.ts`
  retired. `test/db-read-discipline.test.js` fails on a second paginator, on
  lost load-bearing properties, and on any GROWTH of the 85 `.limit(>1000)`
  sites — the ratchet only tightens.
- **The advisor sweep found one real hole**: `rollup_threat_ranks`, SECURITY
  DEFINER and WRITING, executable by `anon` — any internet caller could burn
  the jsonb rollup and touch `rolled_up_at`. Revoked. Plus 4 per-row
  `auth.uid()` policies rewritten as InitPlans (`tells` was the worst) and
  `search_path` pinned on 4 functions. The 46 "RLS enabled no policy" INFOs
  are our intended deny-all posture, not omissions.

---

## 2026-08-21/5 — The officer channel is wired from Discord, not from an env var (Guild lead: "wire it to officer channel")
*2026-08-21 · DECISIONS-2026-08-21.md · Officer channel wired from Discord, not env*

**The finding that forced this.** `OFFICER_CHAT_CHANNEL_ID` is **not set on
Railway** (checked against the live service, 2026-08-21). Both officer posts I
had just shipped would have skipped silently with "not set" — the same
shipped-but-never-fires shape as the inventory uploader earlier this week, and
for the same reason: nothing forces a config value to exist just because the
code reads one.

**Why not simply set the env var.** It can only be set by a human in the
Railway UI, and it needs a redeploy to take effect. That is a poor dependency
for "which channel do officer posts go to" — a thing an officer should be able
to point at themselves, in Discord, at the moment they care.

**Resolution order** (`utils/officerChannel.js`): bot_kv `officer_channel_id`
→ `OFFICER_CHAT_CHANNEL_ID` → `OFFICER_ALERT_CHANNEL_ID`. `/preraid here:true`
run in a channel stores its id in **bot_kv**, which survives deploys (state.json
does not — the eleven-copies-of-the-raid-review lesson). When nothing resolves,
callers SAY so and post nothing: an officer briefing in the wrong channel is
worse than no briefing.

---

# 2026-08-22

## 2026-09-10/9 — Lord Mobsincamp — the assistant is named, configurable, and designed (guild lead, 2026-09-12)
*2026-09-10 · DECISIONS-2026-09-10.md · Named configurable member-facing search assistant*

Guild lead: *"could we hook up a local LLM agent that would be exposed to our members
as the search element and run off of the larger local database copy? if we
experience issues to our supabase hosted database could we fail back to the
copy on tower and offload? I'd like to name it Lord Mobsincamp and have that be
a configurable name in the setup."*

Decided: the name is **Lord Mobsincamp**, carried as `ASSISTANT_NAME` (default
that value; the self-host wizard asks for it). Design + assessment in
`docs/DESIGN-lord-mobsincamp.md`: model on Tower (P40, 14B tool-caller), a
read-only allowlisted tool service over the archive (no free SQL, site scopes
enforced, every Q&A logged), reached through a broker via the bot so Tower
stays unexposed; the site's search box gains an "Ask" mode. Honest failover:
READS can fail over to Tower (with a staleness banner), WRITES queue at the
agents and must not; auth is the wall (local JWT verification first). Offload of
heavy reads to Tower is the part that pays. The enabler for both freshness and
failover is a live logical replica, which needs the Supabase IPv4 add-on.

## §59a — Feedback acknowledgement — built (bot 3.1.160, main)
*2026-09-21 · DECISIONS-2026-09-21.md · Mimic feedback posts get acknowledge buttons*

**Cause:** the Mimic route (`_handleAgentFeedback`) posted a plain message with no components. Only
`/feedback` and web reports carried 📬 Acknowledge / ❌ Not Implementing, and their handlers read the
submitter from an embed footer, so a plain post could not be acknowledged even with buttons.
**Fix:** the Mimic post carries the same pair (`_feedbackRecvRow`); `handleFeedbackRecv` /
`handleFeedbackClose` handle a plain post by looking the row up by its `discord_msg_id`, DM the
reporter on ack, and write the status onto the post's FIRST line (everything after it is a `>>>`
quote, so a trailing line would read as part of the report). Every button now also moves the row
(`acked` + `acked_by/at`, or `addressed` + `addressed_by/at`) so `/admin/feedback` agrees with the
thread — the embed path did not do this before either. The 11 Mimic reports still open got the
buttons once at boot (`_backfillMimicFeedbackButtonsOnce`, bot_kv `feedback_mimic_buttons_backfill`,
fail-closed, skips any post that already has buttons). Test `feedback-ack` (7, real functions,
3 of 3 mutants caught).

## §59b — The timers report posted twice — the web relay raced the Mimic route (bot 3.1.161, main)
*2026-09-21 · DECISIONS-2026-09-21.md · Stop duplicate feedback posts in Discord*

The guild lead: *"double posted in the feedback channel"* (the timers report, row `7ed3116b`,
12:40 UTC). **Cause:** the Mimic route inserts the row, uploads to Discord, and only THEN stamps
`discord_msg_id`. `relayWebFeedback` runs every 60 s and posts any row with `discord_msg_id IS
NULL`, so a report that landed just before a relay tick was posted by both. The relay's stamp won,
so the row points at the "via web" embed and the Mimic post is the orphan: acking the Mimic post
marks it but finds no row, so no DM. (§51's "Mimic feedback posted twice" was a different cause —
a retried upload.) **Fix:** the relay posts web rows (`client IS NULL`) at once, and a client row
only once it has sat unstamped for 5 minutes — which still rescues a Mimic report whose own post
failed. Test `feedback-ack` +1 (the query at a frozen clock; reverting the filter fails it).
**The one duplicate:** acknowledge the "via web" embed (it is the one the row points to — DM +
row write), then delete the plain Mimic post.

## §4 — NPC tells were reaching Discord DMs (2026-09-22)
*2026-09-22 · DECISIONS-2026-09-21.md · NPC tells were reaching member DMs*

The guild lead: *"Some NPCs will tell you things like this privately."* The DM
thread read **`Gage → <character>: Welcome to my bank!`** and **`Come back soon!`**,
twice over.

`Gage` is a real `eqemu_npc_types` row, and it defeats **both** existing guards:
the sender is one capitalised word (so it has a player's name shape, and the
multi-word/lowercase heuristic passes it) and the text carries no `Master` and
no coin (so `_isNpcTellText` passes it too).

⚠ **String-matching the greeting was the obvious fix and is the wrong one.**
Banker and merchant lines are **not in our mirror** — checked
`eqemu_npc_emotes`, which holds 4,144 combat/quest emotes and neither of these —
so the list could only ever be guessed at and extended forever. And *"Come back
soon!"* is something a player might genuinely type. The rule already stated in
that source file is the one that governs: **an NPC tell slipping through is
harmless; dropping a real one is not.**

**Shipped instead (agent 3.6.52):** drop only when the sender is **the mob we
are looking at** *and* that name resolves to a catalog NPC. Both halves matter —
you target a banker to bank with it, and requiring the target match means a real
player who shares an NPC's name is silenced only if they tell you in the very
moment you are targeting their namesake. Fails open on every error; never
applies to outgoing tells. Mutation-checked both ways.

## §25 — The sharing change announced in #wlfpck-general; HUD hit numbers can sit outside the ring (2026-09-25)
*2026-09-25 · DECISIONS-2026-09-21.md · Inventory sharing change announced in general channel*

**The post.** The guild lead: *"post the inventory change to Wlfpck-general
channel."* No session can post to Discord directly, so it went out the way the
2.7.1 card did: a one-time post in the bot (bot 3.1.149,
`_announceInventorySplitOnce`), latched in `bot_kv`
(`announce_inventory_split_general`) so no redeploy can repeat it. Posted
2026-09-25 12:37 UTC. It says what the "Quest page" and "Inventory page"
switches do, that the old switch also shared inventory, and how to turn
inventory back on; it names and pings nobody.

**HUD numbers outside.** The guild lead: *"add an option for the HUD to have
damage numbers outside the circle."* ⚙ builder → Hits → *Numbers inside or
outside the ring* (default inside), on `beta` (`cfb53ee5`, Mimic 2.7.2 beta).
Outside, the columns mirror — your hits flush left against the right side of
the ring, hits on you flush right against the left — starting clear of the
health/mana labels (r ≈ 197) and running outward. The window widens 1.6× about
its centre when the option flips (and narrows back), so the ring keeps its
size; nothing else had to move because both SVG layers were already
`overflow: visible`. One layout, as asked — the inside/outside choice *is* the
option. The picker row now sits by the ring's height (`--ring-h`), since the
window is no longer square.

## §43 — When a character dies, Discord DMs the owner the zone and corpse /loc (2026-09-26)
*2026-09-26 · DECISIONS-2026-09-21.md · Death DMs owner zone and corpse location*

**The guild lead:** *"when a character dies we should discord message them to send them their
corpse coordinates and what zone they were in. we have all of that detail"*.

**Built:** bot 3.1.151 on main, and agent 3.7.21 on beta. Only beta agents send it for now.
- **Agent (`_corpseNoteLine`, on the live tail only, so a backfill never DMs):**
  - At your own "You died.", it notes the zone and position Zeal has for that character
    right then. That is where the corpse lies; the move to the home point comes seconds
    later.
  - It sends once the death is confirmed real: "You are bleeding to death!" or "Returning
    to home point", which a feign never prints. The confirmation must come within 60 s.
  - It uses the durable queue, as upload kind `corpse`.
  - Zeal data more than 30 s old counts as unknown. The DM then says the position is
    unknown rather than quoting an old one.
- **Bot (`POST /api/agent/corpse`):** the same owner rules as the tell relay.
  - The owner is the character's `discord_id`, or its family root's.
  - **The uploading Mimic must own the character**, so nobody can aim a corpse DM at
    someone else.
  - A re-sent death is DMed only once, and each owner gets at most 6 an hour.
  - `flag_shed_corpse=1` turns it off.
- **The DM reads:** "💀 **Aldenmar** died in **Plane of Sky** 9:42 PM (5 minutes ago).
  Corpse at `/loc` **1234, -568, 89**". The time is a Discord timestamp, so it shows in
  each reader's own time zone.

**Coordinates, settled from Zeal's source, because this repo had it both ways:**
- `zone_map.cpp` notes "Position is y,x,z".
- Zeal's own `/loc noprint` prints `Position.x, .y, .z`.
- So the pipe's x, y, z are already the numbers `/loc` shows, in that order.
- The agent dashboard's Position line shows Zeal's `y` first, labelled "Y". That is
  backwards, and it is flagged as a separate small fix, not changed here.

**Left for the guild lead:**
- **An off switch per person.** Today it is only officer-wide (`flag_shed_corpse`).
  The tells relay has a toggle on /me; the same could go next to it.
- **Deaths that get rezzed still DM**, since a rez is not visible to the agent at the
  moment of death. The cap keeps a bad raid night to 6.

**Tests:**
- `test/corpse-dm.test.js` runs the bot handler: owner match, family root, a mismatched
  uploader, no linked account, a bad name, duplicate, the cap, and mentions suppressed.
  Six deliberate breaks, all caught.
- `test/corpse-dm-agent.test.js` (on beta) runs the agent side: confirmed, feign or
  unconfirmed, the position at death not at home point, another character, the 60 s
  window, and stale Zeal. Five breaks, all caught.

## §51 — Feedback and suggestions take screenshots (2026-09-26, bot 3.1.154, web 1.8.20; Mimic next)
*2026-09-26 · DECISIONS-2026-09-21.md · Feedback and suggestions accept screenshots*

**The guild lead:** *"feedback and suggestion needs to be able to take screenshots..top priority"*.

**Where:** every feedback path writes the same `feedback` table, now with `screenshot_paths`
(migration `20260927003234`, applied), pointing into a **private** Storage bucket,
`feedback-screenshots`, which has no policies (service role only).
- **Web `/feedback` and the roadmap's "submit here"** get 📷 and paste (Ctrl+V), up to three images,
  shrunk in the browser to ≤1600 px JPEGs. **Signed-in pack members only**: an anonymous form that
  stores images and reposts them into Discord is an open door. Anonymous text feedback is unchanged.
- **Discord `/feedback`** already took a screenshot but only linked Discord's signed CDN URL, which
  expires. The image is now copied into the post and into the bucket.
- **Mimic/Parser feedback card**: the bot route takes `screenshots` (body cap 1 MB → 16 MB). The 📸
  button that captures the screen is the Mimic half, next on beta.
- **Officers** see thumbnails in `/admin/feedback` through one-hour signed links; the bot re-posts
  every image into the feedback thread as a real attachment.

**Safety:** the bytes are sniffed, never the client's label. Only JPEG, PNG or WebP of at most 5 MB
is stored, three per report. Storage paths are month/source/random — no names.

**Fixed on the way:** feedback from Mimic was posted **twice** — plain text by the agent route, then
again a minute later as an embed by the web-feedback relay (it posts every row with no
`discord_msg_id`, and the agent route never set one). The agent route now stamps its post.

**Noticed, not changed:** `/feedback` says "(Officers only)" in its description but anyone can run
it.

**Mimic half shipped (agent 3.7.26, `v2.7.2-beta.15`):**
- The dashboard feedback card has 📸 "Screenshot my screen" (Mimic only): the dashboard hides for
  the shot, and every display is captured.
- With one monitor, the shot is attached for review. With several, nothing is attached until the
  reporter picks a screen.
- 📎 attach and Ctrl+V paste work in any browser, so Parser and the tray route get them too.

## §78 — Reports get numbers: FB-<n>, closed by commits (2026-09-29, bot 3.1.172, web 1.8.41)
*2026-09-29 · DECISIONS-2026-09-21.md · Feedback gets FB numbers closed by commits*

The guild lead: *"We need to start having referenceable IDs for each bug or enhancement request so the bot
can update these when they get implemented"*.
- **The number:** `feedback.ref`, a sequence (migration `20260929020000_feedback_ref`, applied); the 33
  existing reports were numbered in submission order, FB-1 … FB-33. New cards carry it: a Mimic post's
  first line ("🐞 Bug FB-34 from …"), a web or `/feedback` embed's title; the open cards were numbered in
  place once (`_backfillFeedbackRefsOnce`, latched in bot_kv). `/admin/feedback` shows it.
- **Closing by commit:** every 10 minutes the bot reads the public repo's last 40 commits on `beta`,
  then `main` (no token; last sha seen per branch in bot_kv). A line saying fixes / implements / closes /
  resolves and FB-n moves report n: beta → `on_beta` (🧪 On beta, buttons kept), main → `addressed`
  (✅ Implemented, buttons removed). The card is edited, the row gets a dated note, the submitter a DM.
  A mention alone moves nothing; a report never moves backwards, and won't-fix / duplicate stay closed.
  Rule in `CLAUDE.md`; logic in `utils/feedbackRefs.js`, `test/feedback-refs.test.js`.
- **Open reports that earlier work looks to have answered** (for the guild lead to confirm, not closed
  here): FB-9 (the /who fixed size + scroll, 2026-09-26), FB-10 (pasting screenshots into feedback),
  FB-13 (the server tick as its own timer: the Tick overlay), FB-19 (timers can start at the top, agent
  3.7.34), FB-3 / FB-4 (June's PvP kill reports), and tonight FB-27 / FB-25 (bard charm, §75) and FB-32
  (switching characters, §76) pending a beta check.

## §158 — The bot mirrors Quarm's patch-notes channel into Supabase (2026-10-04, bot 3.1.199)
*2026-10-04 · DECISIONS-2026-09-21.md · Bot mirrors patch-notes channel*

The guild lead: *"1175117242682331146 is the Quarm patch notes channel id in our discord. pull everything from
there"*.

- **What:** every message in that channel goes into `quarm_patch_notes`, one row per Discord message.
  - The channel is `QUARM_PATCH_NOTES_CHANNEL_ID`, defaulting to the id above.
  - Each row keeps the content, embeds flattened, attachments, author, posted and edited times.
  - Signed-in members can read it; only the service role writes.
- **How:**
  - A sweep a minute after boot and every 6 h. It pages backward 100 at a time.
  - The first run takes the whole history, capped at 20,000 per run with a resume point.
  - Later runs stop at already-stored territory.
  - New posts are caught by the existing messageCreate handler, before its bot-author early-out
    (crossposts are bot posts). Edits are caught by a new messageUpdate listener.
  - Status lives in bot_kv `quarm_patch_notes_sync`.
- **⚠ The Message Content intent:** without it, Discord returns blank content, embeds and attachments. Those
  rows are stored flagged `content_missing` and counted in the status. Turning the intent on (portal toggle,
  then `MESSAGE_CONTENT_INTENT=1`) makes the next sweep re-walk and rewrite them.
- **Not done, deliberately:** `Partials.Message` on the client would catch edits to posts from before the last
  restart, but it changes every message handler's inputs. The sweep plus the live listener cover the
  common case.
- **Migration:** `20261004160000_quarm_patch_notes.sql`. The MCP `apply_migration` call timed out three times,
  so it went in as four separate `execute_sql` statements. The version was then recorded in
  `supabase_migrations.schema_migrations` by hand. Same SQL, same version as the committed file.
- **Only Quarm's own posts (bot 3.1.200, the same day).** The first sweep stored all 4,265 messages in the
  channel. Only 1,348 were Quarm's: the channel follows Quarm's #patch-notes, #announcements and
  #server-status-downtimes, and members talk in it too.
  - A followed-channel post is written by a webhook. So the sweep and the live writer now keep only messages
    with a `webhookId`.
  - The sweep's "already stored" stop looks at the oldest Quarm post on the page. A member's message is never
    stored, so it cannot be the stop.
  - **Cleanup:** the sweep deletes any member message on a page it reads. A `feed_only` flag in the bot_kv
    status forces one full walk after the upgrade, so the 2,917 member rows go on the first run.
  - Why the bot cleans up and not SQL: the Supabase MCP holds a `DELETE` for a confirmation, and a
    non-interactive session cannot give one (both `execute_sql` and `apply_migration` timed out on it).
    A migration file would not help either: the GitHub integration does not apply files pushed to `main`.
  - Every stored row is still blank: the intent is off. The open-items row has the two steps.
  - **Verified after the deploy** (first run 20:34 UTC): 4,265 messages read, 1,350 rows left, `feed_only`
    set. The 1,350 are the 1,348 Quarm posts plus two of Discord's own "Community Updates" notices from 2024.
    Those are webhook posts too, so the filter keeps them; harmless, left in.

## §166 — Bristlebane, the raid's voice; how raiders look, kept per night (2026-10-05)
*2026-10-05 · DECISIONS-2026-09-21.md · Bristlebane raid voice bot*

The guild lead: *"set me up a discord bot on tower to join when there is a raid going"* → *"this will be the
common callout point that people can listen to stream and loot, and be able to change content to slides,
maps, overviews. this will be bristlebane's job"* → *"mostly the theme and the view of the area and how we
look as characters so if we animate something in the future it looks good and we can recreate from point
map during raids."*

- **A separate Discord application, "Bristlebane"** (app id 1556801422689837240 — ⚠ since renamed **miMIC** in Discord; the
  Bristlebane persona is now a different app, see §323; private bot; no privileged
  intents), its own component `apps/bristlebane/` running as a Coolify app on Tower. Separate because a bot
  holds one voice connection per server and a second login on the RaidBosses token would answer every
  command twice. `CLAUDE.md`'s component table now lists five.
- **Phase 1 built (bristlebane 0.1.0 + bot 3.1.208):** joins the raid voice channel when the main bot's new
  `GET /api/agent/raid-live` says a raid is on the ground (6+ raiders placed on two polls, End raid not
  pressed, a person in the channel), leaves on End raid / 10 min not live / 5 min empty. That route answers
  from the position recorder's memory and takes `BRISTLEBANE_API_KEY` (that route only). No speech yet.
- **Voice recording is opt-in only** (the guild lead: *"we don't need to have voices in from those that don't
  consent"*). `/bristlebane optin | optout | forget | status`; optout deletes tonight's audio of you, forget
  opts you out and deletes all of it (a session call: "delete everything" that left you recording would be
  a trap). Nobody else is subscribed, decrypted or named. Discord's Developer Terms make publishing a
  member's voice need their express direction, so a cinematic needs its own yes on top of the opt-in.
- **Video is not Bristlebane's.** A bot cannot receive Go Live or camera video (no API; Go Live is end-to-end
  encrypted since 2026-03-01), and the tools that can are user-account automation Discord forbids. The
  footage comes from members' own recordings and Discord clips (the guild lead: *"I record on my machine,
  clipping exists on discord. I'm not the only one that streams"*). Recording members' Twitch streams on
  Tower was offered and withdrawn: Twitch's terms forbid downloading streams.
- **Shared screen: waiting on the pick** (pictures sent): B a `/screen` page the raid leader drives (map /
  slides / loot / overview), A the leader Go Lives that page, C a Discord Activity. C is blocked as things
  stand: unverified Activities run only in servers under 25 members and ours has ~387.
- **How raiders look, per night (bot 3.1.208):** `raid_night_appearance`, one row per raider per distinct
  look, written when a night's first track minute lands and hourly after: race, deity and worn armor and
  weapons from Quarmy gear (else the inventory file), turned into models by the new `eqemu_items.idfile /
  material / color` columns. `exclude_from_stats` is never written; `exclude_inventory` gets no item data.
  The catalog also gains each zone's sky, fog colours and clip distances (`eqemu_zone`). Gender, face, hair,
  beard and dyes need a Zeal fork change (the entity carries them; the pipe's raid loop already holds the
  pointer) — prepared, not pushed: this session cannot push to the fork.
- **Waiting on the guild lead:** whether a local session may extract zone and character models from their
  own installed client for private animation only (never the site or the repo). Until then: walls, colours,
  positions and appearance data.
- **Found on the way:** the RaidBosses bot's spoken callouts very likely stopped working on 2026-03-01 — it
  runs `@discordjs/voice` 0.18 on Node 20, before Discord made end-to-end voice encryption mandatory. Not
  fixed here: Bristlebane is meant to take the callouts over. `/voicetest` confirms either way.
- **For a new guild it is ONE bot** (the guild lead, 2026-10-06: *"for future guilds the same discord bot
  should do both. give me the permissions"*). Permissions, read off the code and discord.js's own flags:
  View Channels, Send Messages, Send Messages in Threads, Create Public Threads, Manage Threads, Embed
  Links, Attach Files, Read Message History, Manage Messages, Pin Messages (split out of Manage Messages
  by Discord), Manage Events, Manage Roles, Connect, Speak, Use Voice Activity, Change Nickname =
  `2252135193504768`; + Create Invite and Use Activities for a Discord-Activity screen = `2252684949318657`.
  README's old list (six) had drifted. Wolf Pack keeps its two apps. Before one token can carry both, the
  two command registrations must become one (each bulk-overwrites the guild's commands today) — written into
  `DESIGN-selfhost-wizard.md` §3.
- **Screen picked: B now, C planned** (the guild lead, 2026-10-06: *"B now, start the C planning"*). B is
  `wolfpack.quest/screen`, a new page, so it goes live with the [beta] tag (§135): Map / Slides / Loot /
  Overview, officers switch it, everyone follows within ~3 s. C (a Discord Activity) is planned in
  `docs/DESIGN-raid-screen-activity.md`. It is blocked until Discord verifies the app. A one-server app may
  not be allowed to apply, so the first step is the guild lead reading the portal's App Verification tab.
- **The raid screen's 3-second read is served by the Railway bot, not Vercel** (2026-10-06). Vercel Hobby
  allows 1,000,000 function invocations a month, and going over means waiting 30 days. As first drafted,
  `/screen` would have spent ~600k of them in one raid night with 60 viewers, and every one of those polls
  also called GoTrue. The bot already holds every raider's latest position in memory (`utils/raidTrack.js`),
  so it answers `GET /api/screen/live` with positions and the screen state:
  - Supabase reads are memoized to a few per minute in total.
  - The page signs in to the bot with a 2-hour HMAC screen ticket (`SCREEN_TOKEN_SECRET`, the same value on
    Vercel and Railway), minted by `/api/screen/ticket` from the site's sign-in. C's Activity will mint the
    same ticket.
  - While the secret is unset, the page polls Vercel as `/spectator` does today.
  - Slow reads (zone maps, the loot and kill feed once a minute) stay on Vercel.
- **Shipped 2026-10-06 (web 1.8.106 · bot 3.1.209), live with the [beta] tag**, after an adversarial review:
  31 agents, 13 findings, 8 confirmed by two skeptics each, all fixed with tests that fail without the fix.
  - **Sealed bids:** the screen showed the high bidder and amount on an auction still open, because the
    OpenDKP mirror can capture the leader mid-auction. An open auction now shows only the item and its
    closing time.
  - **Slides:** deleting or moving another slide switched what everyone saw. The slide that is up now keeps
    its place.
  - **Clocks:** a viewer with a fast PC clock fell back to polling Vercel for good. Ticket life is now
    measured on the page's own clock.
  - **Fallback cost:** until the variables are set, `/screen` polls Vercel every 8 s (not 3 s), and officers
    see "live feed: website (slower)".
  - Migration `20261006120000_raid_screen.sql` was applied through the MCP.

## §182 — The FB scanner reads commits by reachability, not by date (2026-10-07, bot 3.1.219)
*2026-10-07 · DECISIONS-2026-09-21.md · Feedback scanner reads by reachability*

- **Found:** FB-58, FB-59, FB-60, FB-61 had `Fixes FB-n` on beta and stayed `acked`. The scanner read the newest 40
  commits by date and stopped at the sha it saw last; our features are built on side branches and merged later, so a
  commit made at 20:00 and merged at 22:40 sorts below a tip recorded at 21:00 and was never read.
- **The call:** ask the compare API for everything the branch gained since that sha (up to three pages of 100). The
  date walk stays only for a first look and for a sha GitHub no longer knows (beta is reset at graduations). The
  first look after the deploy moves the four stuck reports on its own.
- **Still true, by design:** the scanner reads `beta` and `main`, so a fix that lives only on `alpha` (FB-64) moves
  when it reaches beta, not before.

## §192 — Anonymous feedback (AFB) on eqmimic.quest, cleaned before it is stored, never acted on automatically (2026-10-08, web 1.8.119 · agent 3.7.107 beta)
*2026-10-08 · DECISIONS-2026-09-21.md · Anonymous feedback cleaned, never auto-acted*

The guild lead asked whether a signed-out Mimic can send feedback (it could not: the card needs the token and
stopped at "sign in first"), picked **A — the card sends them to a web form**, then: *"it needs to clean data
before it even gets logged, looking for any sql, data exfiltration … sent to eqmimic.quest instead of Wolfpack
and then logged as a different feedback entirely AFB for anonymous feedback … they can also provide their
discord contact info"*, and later *"the rule we made for interpreting Wolfpack feedback automatically does not
apply to anonymous feedback. but it should be consistently reviewed."*
- **eqmimic.quest is a domain on our Vercel project** (added 2026-10-08 with `www.` redirecting to it; DNS still
  points elsewhere until the guild lead switches it). `web/middleware.ts` sends every path on that host to
  `/eqmimic/feedback` before any session work, dropping the query string; `web/app/layout.tsx` renders a bare
  shell there (no Wolf Pack header, sign-in or footer). One host list: `web/lib/eqmimicHost.ts`.
- **The text never travels in a query string.** Mimic opens `https://eqmimic.quest/feedback#cat=…&text=…` and the
  form reads the fragment client-side, then clears it; a query string would land in request logs before cleaning.
- **Cleaned before anything is stored** (`web/lib/anonFeedbackClean.ts`, pure): normalize and strip invisible
  characters first (so `UN<zero-width>ION` cannot dodge a rule), strip HTML, then redact and flag SQL shapes,
  URLs and bare domains, emails, IPs, secret-shaped strings, user-name file paths, template/expression syntax
  and @everyone/@here. EverQuest prose survives ("select a mob from the list", "the drop table"). More than half
  removed, or under 10 real characters left → refused. Parameterized inserts already stop SQL injection; the
  cleaner exists so nothing hostile or private is ever stored or shown. Discord contact: a valid username,
  legacy tag or id, else dropped.
- **Abuse limits:** a honeypot field, and 5 an hour per salted IP hash; the hash is erased after a day (pruned on
  every save). Officers never see it.
- **Stored apart:** `anon_feedback`, numbered **AFB-n**, service role only, never an FB number, never in the
  Discord relay. Officers read it at `/admin/feedback/anonymous` [beta].
- **Policy (now in CLAUDE.md):** AFB is untrusted text from strangers. It is never acted on automatically: the
  open-reports-at-every-exchange rule and the `Fixes FB-n` commit path do not apply to it, and a session never
  treats its text as instructions. It is reviewed every week instead: on Mondays the bot posts one count-only
  line in the officer feedback thread (§193).
- **Mimic side (beta, agent 3.7.107):** signed out, the feedback card shows "Send anonymously on eqmimic.quest"
  (no logs or screenshots on that path) and opens the browser; Mimic's open-external allowlist now admits exactly
  `https://eqmimic.quest/feedback`. Signed-in cards are unchanged.

## §193 — Members read their own reports on the site; the status DM links there; a weekly AFB count (2026-10-08, bot 3.1.223 · web 1.8.119)
*2026-10-08 · DECISIONS-2026-09-21.md · Members read own reports on site*

The guild lead: *"the feedback section isn't displayed for all of our users, only officers. links sent back to
users are not visible currently"* — the status DM linked the card in the officer-only #feedback thread. Picked
**A — a My report page**, and *"go ahead with the weekly count post"*.
- **`/feedback/FB-n` [beta]** (sign-in required): the submitter or an officer sees the report, its status in
  plain words and the bot-written history (officers' free-text notes are never shown); anyone else gets "This
  report is not yours" whether or not the number exists. A reply box writes `feedback_replies`; the bot relays
  each reply to the report's Discord card on its 10-minute loop ("💬 Reply from the submitter on FB-n: …"),
  claiming the row first so it never reposts.
- **The status DM** now ends "Your report: https://wolfpack.quest/feedback/FB-n" and "If it is not fixed for you,
  reply on that page." (`utils/feedbackRefs.js`).
- **Weekly AFB count** (`utils/afbDigest.js`, `_afbWeeklyDigest`): Mondays from 13:00 UTC, one line with counts
  only (new this week, waiting for review) and a link to the officer page; nothing when both are zero; latched
  per ISO week in `bot_kv` so a redeploy never double-posts. It reads only the date and status columns.

## §206 — Feedback names, the /parses week, and the HUD's clicky list (2026-10-08, web 1.8.125 · bot 3.1.232 main · Mimic HUD on beta)
*2026-10-08 · DECISIONS-2026-09-21.md · Feedback names, parses week, HUD clickies*

**The asks** (the guild lead, in one pass over the latest feedback):
- *"Don't use email in here for 'Addressed by' instead say my discord name"*. `/admin/feedback` wrote the officer's sign-in
  email into `acked_by` / `addressed_by`. The server action now reads `nickname`, then `global_name`, from `wolfpack_members`
  (keyed by the signed-in user), and never touches the email. The one stored email was rewritten to the Discord name.
- *"All of the submissions for [the alt's character name] should be coming from [the main]"*. A report sent from Mimic carried
  the character the sender had up as `submitter_name`, so the same person showed under two names (15 rows, FB-52 to FB-70, shared
  one Discord id). The bot now looks the name up from `wolfpack_members` by Discord id when it knows it, the character as the
  fallback (`_handleAgentFeedback`); the 15 stored rows were rewritten. Attribution in docs stays by role.
- *"Have you changed the default to FB-59 to 7 days?"*. **No: it was on beta only** (`b.wolfpack.quest/parses`, STATUS said so).
  `main` still opened on 60 days. `/parses` now resolves `'7d'` on main too; the picker still offers 30/60/90d, expansion and
  lifetime, and `?w=60d` is the old window. Only the default moved: the parallel-reads rewrite and the guild-tag swap stay on beta.
- *"The rod and all unlimited should not show up."* The agent has dropped unlimited clickies from the counters since 3.7.101, but a
  Mimic running an older agent still sent them (with an ∞) and the HUD drew them. `clickyList` in `apps/mimic/me.html` now drops
  any item with `unlimited` or no charge count, whatever the agent sends (beta).
- **Clicky counter report (FB-68 / FB-70), what the logs showed.** FB-70's numbers were right (7 of one potion, 8 of Larrikan's
  Mask); nothing wrong there. FB-68 is a **zero-cast-time clicky** (the Wooly Spider Silk Net, a 3-charge Root): it prints no
  "begins to glow" line, which is the only thing the counter listened for, so those uses were never counted. What it does print is
  an outcome the member can see: "Your target resisted the Root spell." or "<mob> adheres to the ground." The fix (count a
  resist and a landing for a zero-cast clicky, skipping a spell the member began casting by hand) shipped on beta as agent
  3.7.113. The guild lead's word on the log: *"the root click is not invisible, it will show a resist or it will show that the
  mob adheres to the ground"*.
- **Linux:** *"the linux client looks for the eq client and hides the windows when not on, like the Windows 'Hide Overlays when
  Everquest is not running'"* (FB-66) and *"Linux client needs to be revisioned when we revision the windows client"*. The poller
  fix is on the Deck branch, refreshed to Mimic 2.7.11 / agent 3.7.113. **The guild lead picked A (every Windows beta and
  stable cut): "A".** Built as `linux-follow-windows.yml` (STATUS has the mechanics): merge the Windows commit into the Deck
  branch, build there, so the Linux-only code never has to ride to Windows or stable. Rejected: B (stable only), because Deck
  testers would trail a whole beta line.

## §233 — Better bot voices with KittenTTS 2: pinned (2026-10-11)
*2026-10-11 · DECISIONS-2026-09-21.md · Better bot voices with KittenTTS pinned*

- **The ask** (the guild lead): *"maybe we can use kittentts2 to make the voices better for the bots"*, then
  *"put a pin in this."*
- **What was found:** KittenTTS 2 is 1.7B parameters (~947 MiB) and needs ~6 GB RAM on CPU. It is Python-only,
  with 47 voices, voice cloning and its own Stellon Labs licence. It would join the §169 announcer candidates
  (Kokoro / Chatterbox / Qwen3 on Tower). Today the bot speaks through msedge-tts + `@discordjs/voice` 0.18 (which
  may have broken under Discord's 2026-03-01 voice-encryption change, unchecked), and Mimic through the browser's
  `speechSynthesis`.
- **Pinned, nothing built.** The options put out were: A, a listening test on Tower; B, KittenTTS 2 everywhere;
  C, keep the §169 plan. When it is unpinned, run `/voicetest` first: if the bot's Discord voice is down, that
  comes before any voice-quality work.

## §283 — miMIC streams /screen to the raid and posts the next target (2026-10-13, direction; nothing built yet)
*2026-10-13 · DECISIONS-2026-09-21.md · Announcer persona streams screen, posts next target*

- **The guild lead:** *"the persona is in discord as mimic, ready to stream this screen and send encouragement and
  details to the raid"*. The miMIC announcer persona is already present in Discord; it will stream
  https://wolfpack.quest/screen to the raid and post encouragement plus details.
- **Asked the same night, to be built (options first where it is UI):** a deep link in the Discord raid thread to
  the next target, its instructions and the step the raid is on; the same copyable from Mimic's Command Center and
  the HUD; a map button that expands to pathing to the next spot with ?, mob and quest markers; tracking your own
  character toward the next quest marker with a copyable, labelled Zeal `/map` coordinate.
- **Also:** the Command Center hail board did not show the Nightmare hedge-maze flag (the Terris Thule unlock) or
  how many already held the flags; it should open when more than one raid group hails one flagging NPC.
- **Data asks for Wednesday's raid:** average the routes raiders take; directions players and mobs go; severe
  injuries and deaths; engagement order; feed these into gold splits for fast fights and into what Lord
  Mobsincamp looks for. Recording is on (§161, §280); the analysis is not built.
- Research fanned out to Sonnet agents the same night; results and options follow in the session's reply.

## §284 — Announcers stay quiet in a fight; post-kill comparisons; Map rings for mez, pacify and harmony (2026-10-13)
*2026-10-13 · DECISIONS-2026-09-21.md · Announcers silent in fights except critical*

- **In-fight rule (the guild lead):** *"don't interrupt the fight unless there's a critical thing, like less than 1
  minute left on a non bard slow"*. Applies to every announcer persona (miMIC, Bristlebane, Lord Mobsincamp):
  nothing spoken or posted during a fight except a critical alert. The worked example: a slow from a non-bard
  (shaman, enchanter, beastlord) with under a minute left on the boss. Bard slows are not critical (bards
  re-apply constantly).
- **Post-kill comparisons (asked):** mine the guild's earlier kills (Grummus and the rest) for stats an announcer
  can say after a kill, e.g. how much faster than last time. Research handed to a Sonnet agent the same night.
- **Map overlay rings (the guild lead):** *"add zzz's if it's mezzed, if it's truly pacified make the circle light
  pink and have it fill in the outside like a clock wipe more red until the pacify wears off. bard pacify is much
  shorter. druid harmony is still red on the inside at the lowered range, since it doesn't make aggro radius 0
  like pacify"*. Follows the Harmony-is-not-Pacify policy (CLAUDE.md): pacify family (targettype 5) = pink, will
  not aggro; Harmony / Wake of Tranquility (targettype 8) = still red inside at the reduced radius. Durations come
  from each spell, so bard lulls run shorter on their own. Drafting on beta (agent + map.html).

## §288 — Bristlebane gets lore to talk about; Lord Mobsincamp transmits through Mimic; V5 renders the scenes (2026-10-13)
*2026-10-13 · DECISIONS-2026-09-21.md · Announcer lore, transmissions, scene rendering*

- **Lore (the guild lead):** *"lookup the lore associated with the story for bristlebane to be able to talk
  about"*. A sourced brief on Bristlebane Fizzlethorpe and each PoP target, with post-kill lines in his voice,
  is being drafted for the cast bible (docs/DESIGN-raid-announcers.md). In-game quest text preferred over fan lore.
- **Transmissions (the guild lead):** *"Lord Mobsincamp can send audio via mimic as a transmission"*. His voice
  reaches raiders through Mimic on their own PC (a card + audio), not only through a Discord voice bot. Same
  rules: nothing during a fight except critical alerts (§284), respects Mimic's mute and quiet mode. Options
  (text-to-speech vs pre-rendered clips) follow the research.
- **Scene renders:** the guild lead will run image generation and LTX on the V5 box while playing and streaming
  on V4. This session builds the conditioning frames, animatics and a job sheet from `raid_track_minutes`
  (EQEmu wall layer only, class colours, no names) and hands over a zip.
- **/screen recap card:** on beta (`3c25a53f`), waiting on the bot side to serve `recap`.

## §323 — Bristlebane's chat agent moves from V5 to Tower (Coolify); cloud sessions get a deploy token (2026-10-14)
*2026-10-14 · DECISIONS-2026-09-21.md · Bristlebane chat agent moves to Tower*

- **What broke:** the OpenClaw agent wearing the Bristlebane Discord app, on V5, died on a setup step with "Auto-compaction could not
  recover this turn" (its fix hint: `agents.defaults.compaction.reserveTokensFloor` ≥ 20000) — a local model's small context window
  filled by one step's output.
- **The guild lead (2026-10-14):** *"this is on V5 not on tower. If you can set this up on tower for me in coolify, GO"*; then picked
  **A — give the cloud session a deploy token** (over B, a compose the guild lead clicks in) and **the model stays V5's local model over
  the LAN**.
- **Access change (widens §9):** a second Coolify token with **write + deploy, still no `read:sensitive`**, in the cloud environment's
  `COOLIFY_TOKEN`. Secrets (the Discord bot token) are pasted in Coolify's UI by the guild lead, never sent through a session. The
  tailnet policy is unchanged (Coolify API 8000 + Tower 5432 only).
- **Found on the way:** the existing Coolify app `bristlebane` (the voice bot, `apps/bristlebane`) is `exited:unhealthy` since
  2026-10-06; its logs need `read:sensitive`, so they are unread.
- **Which Discord app is which (the guild lead, 2026-10-14):** the Coolify app `bristlebane` runs Discord application
  `1556801422689837240`, which §166 called "Bristlebane" and which now shows in the server as **miMIC**. The OpenClaw chat agent on V5
  is a **separate** application, `1549680353747406858`, named **Bristlebane**. Different tokens, so the two never fight over a login.
  (The component and folder are still called `apps/bristlebane`; renaming them is a separate change.)
- **Open:** the token; V5's model server must listen on the LAN at a real context that matches the declared one (see §325 — not
  `reserveTokensFloor`); the step files (`01-step0-discover.md`) live on V5 and are not in the repo.

## §325 — The Bristlebane chat agent's Tower deploy is in the repo; `reserveTokensFloor` is a trap (2026-10-14)
*2026-10-14 · DECISIONS-2026-09-21.md · Bristlebane Tower deploy in repo, config trap*

- **Research (sourced, OpenClaw docs + source):** the V5 error's hint is stale. `reserveTokensFloor` defaulted to 20000 already, and
  from OpenClaw 2026.8 the key is **removed** — an unknown key makes the gateway refuse to start. The overflow comes from one big tool
  result or a context window smaller than declared. ⚠ This corrects this session's earlier advice to set it.
- **Landed (main):** `deploy/openclaw-bristlebane/` — `docker-compose.yml` (Coolify Compose from Git; busybox init service chowns the
  named volumes to uid 1000 and seeds the config once; pinned `ghcr.io/openclaw/openclaw:2026.10.3`; no ports), `openclaw.seed.json5`
  (`tools.profile: "messaging"`, an honest 64K `contextWindow` = `num_ctx`, `midTurnPrecheck`, smaller bootstrap caps, Discord via
  env SecretRef, placeholders only), `README.md` (deploy + V5 cutover). Self-host wizard §3 entry added.
- **Open:** the deploy token (§323), V5's model server on the LAN at a real 64K context, the `<…>` ids, stopping V5's gateway first,
  and resetting the Bristlebane token on the cutover. Untested on Coolify: volume naming and `service_completed_successfully`.

## §344 — Two mid-raid hotfixes: slow mode to #raid-chat, and a boss hail slot without a death line (2026-10-15, bot 3.1.280–3.1.281, `[hotfix]` at the guild lead's call)
*2026-10-15 · DECISIONS-2026-09-21.md · Slow-mode post to raid chat, hail slot hotfix*

- **Slow-mode announcement** (the guild lead: *"This should go in raid-chat channel 1193692008812920863"*, *"it should also
  tag the raider roles"*): `utils/slowMode.js` `announce()` posts to `RAID_CHAT_CHANNEL_ID`, then the #raid-chat id,
  then `TIMER_CHANNEL_ID`, and pings `SLOWMODE_PING_ROLES` (default `Raid Pack,Raid Recruit`; only those role ids may ping).
- **Hail slot without a confirmed kill** (the guild lead: *"sTILL NO pLANAR PROJECTION on the command center"*,
  *"many of us died, but we got a lockout"*): the Bertoxxulous upload had no death line, so `openWindow` never ran, and
  `noteGrants` only knew the kill-less flaggers. `grantOpener()` in `utils/hailBoard.js` now lets a `HAIL_BOSSES` entry
  open from the first fresh grant of its own `done[0]` flag in its own zone; one window per NPC still holds.
- **Shipped mid-raid** with `[hotfix]` because the raid was heading to Agnarr next. (Agnarr itself is not on the hail
  board: Karana wants a phrase, not a hail.) Live 01:32 UTC; tonight's Bertox grants (01:16–01:25 UTC) came before it,
  and `noteGrants` only reads grants fresh at ingest (15 min), so tonight's slot was not back-filled — the next boss is
  the first. The flags themselves were all recorded.
- **Open:** the agent should read *"You have incurred a lockout for <boss>"* as a confirmed kill (Mimic beta), so a
  wipe on the last tick still confirms the kill. Not built.

## §375 — Feedback sweep: acknowledged reports checked against shipped code (2026-10-19)
*2026-10-19 · DECISIONS-2026-09-21.md · Feedback sweep marking shipped reports*

The guild lead: *"go through the raid-bosses bot feedback and mark any of the acknowledged feedback as implemented when
they have been"*. Every open report was checked against `origin/main` and `origin/beta`, with code or commit evidence.
- **Implemented on main (marked by this commit):**
  - FB-59: the parses page defaults to 7 days, `d3cde6f1`.
  - FB-70: the counts were right, no bug (§206). The related zero-cast-time clicky fix (FB-68, agent 3.7.113) is on main via 2.8.0.
- **On beta (marked by a beta commit the same night):** FB-83, debuffs shown only on the spawn they landed on (`3947fa39`, agent 3.7.187, §349).
- **Already "on beta"; they close at the 3.0 stable cut:** FB-40 (`f7881fc3`), FB-64 (`fc18eaa1`).
- **Partial:**
  - FB-27: bard charm from Zeal (§75); the charm-break speech and Recharm bar are unbuilt.
  - FB-32: §76 is fixed; the boxed-character layout debounce is not.
  - FB-37: XP per hour on the HUD; no per-zone or best-zone view.
  - FB-44: upright bars exist; no text side or rotation.
  - FB-3: PvP last-hit kills need a repro.
- **Not done:**
  - FB-24: Test still runs an imported trigger that is stored disabled.
  - FB-76: "Sees Invis" should read "May see invis"; a wording fix.
  - FB-78: the spells page's wrong and missing spells; uninvestigated.
  - FB-80: two "a war boar" bodies collapse into one; no level hint.
  - FB-81: a vendor/quest button for held loot.
  - FB-84: the death log, scoped in §373.
  - FB-1: map pathfinder.
  - FB-17: click-target a pet; the pipe is outbound only.
- **Unclear, need the reporter or the screenshot:** FB-20, FB-28, FB-74 (Linux, a Wine path), FB-79 ("cOMMAND CENTER"). FB-8 is probably not ours.
