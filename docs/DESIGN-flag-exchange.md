# Design: the server-wide flag exchange on raidmimic.com

Status: **direction set, design open** (2026-11-02, DECISIONS §516, §517). Nothing below is built except where it says so.
The open choices go back to the guild lead as options with pictures (the `/demo` clickthrough) before any build.

## 1. What the guild lead asked for

> "raid leaders from each guild could put what they're going to be doing on a schedule and be able to fill in the gaps in
> their raid based on people that have uploaded their pop flags into our site. This would be a nice way to coordinate what's
> coming up so that people that do need to backflag from any of the guilds would be available to do so. And it would give us
> a way to get people included into the platform to actually generate more interest in using the agent. We need to be very
> upfront about what's available. And quite frankly, we need to be ready to pull in that data into very restricted and data
> sensitive database tables. Guilds should be able to see who's uploaded their pop flags and be able to reference them
> accordingly. And individual players or their guild leadership should be able to grant other officers rights within that
> platform and also be able to do their raid mimic Discord bot integration, and a wizard for picking which roles should show
> up for them." (the guild lead, 2026-11-02)

Earlier the same day (§516): capture flags for other players' characters, the owner signs in to confirm or correct; a posted
event shows who still needs it, so leaders stop asking one by one.

Added the same day:

> "guild leaders should be able to integrate into their openDKP accounts to import their own guildies that are not shown.
> People can request to be notified of open raids for flags they're missing (for mains or alts)
> guilds can set a limit on how many guests could come through" … "add in links to their discords or servers"
> (the guild lead, 2026-11-02)

Eleven parts:

| # | Part | Today |
|---|---|---|
| 1 | A guild's raid leaders post a schedule (target + time) | Raid-Helper events exist for Wolf Pack only, and name no target (0 of 24 in ±30 days) |
| 2 | Fill a raid's gaps from players in ANY guild whose flags say they need that target | "Who needs what" is computed (`web/lib/popGateStatus.ts`), Wolf Pack only |
| 3 | Plain disclosure of what is shared, with whom, before sharing | The privacy pages promise the opposite (section 5) |
| 4 | Restricted tables for the cross-guild data | Pattern exists (`hub_*`, `terms_acceptances`); no exchange tables |
| 5 | A guild sees which of its players uploaded flags | Wolf Pack only, by reading `pop_flags` |
| 6 | Owners and leadership grant officer rights | Roles exist (`hub_memberships.role`); nothing promotes, demotes or transfers |
| 7 | Each guild adds the Raid Mimic Discord bot, with a wizard to pick which roles appear | Nothing for a hosted guild |
| 8 | A guild connects its OpenDKP account to import its own members who are not shown yet | Wolf Pack's OpenDKP is read by the bot (`utils/opendkp.js`) with one guild's credentials; no per-guild connection |
| 9 | A player asks to be told about open raids for flags they are missing, for a main or an alt | Nothing; Discord DMs exist only for feedback (`utils/feedbackRefs.js`) |
| 10 | A guild caps how many guests (players from other guilds) an event takes | Nothing |
| 11 | Each guild's card links to its Discord server or website | `hub_guilds` has a Discord server id, no invite link or website |

## 2. What exists (research, 2026-11-02)

- **Who needs what.** `web/lib/popGatePieces.ts` (each gate as kill / task / hand-in pieces) and `web/lib/popGateStatus.ts`
  (done / held by the Seer / missing / unknown per piece) are pure and reusable. `utils/hailBoard.js` maps flagging bosses to
  their hail NPCs and flags (`HAIL_BOSSES`, `HAIL_TRIALS`). A "flag event" catalog needs only a small table joining those:
  event key → boss/NPC ids → piece keys.
- **When.** `rh_events` / `rh_signups` (Raid-Helper mirror, 30-minute sync) for Wolf Pack. Event titles are generic; a leader
  must pick the target once. Soft reserve (`npc_ids int[]`) is the only structured event → target link today.
- **Flags.** `pop_flags` (65k rows, all `guild_id = 'wolfpack'`; ~2,600 "characters" are `unmapped` lines every reader skips).
  Writers: the agent (`POST /api/agent/pop_flags`, own characters only), the Seer and #popflags paste (own characters only),
  ticks (own, or an officer). Readers treat every `source` alike; "a full read" (`recital`, `popflags`, `popflags_paste`) is
  what turns a missing flag from ❓ into ❌.
- **Hosted guilds.** `hub_guilds` / `hub_players` / `hub_memberships` (role owner / officer / member / guest; one owner) /
  `hub_invites`. Production: 0 hosted guilds. Officers can only make invite codes. (As researched: a hosted player's agent
  could upload fights only and `pop_flags` was refused; changed 2026-11-02, see Supply below.)
- **The bot.** The Raid Mimic app (§507) runs the community server. No invite flow for a hosted guild, no per-guild role table
  (`guild_roles` is named in `docs/DESIGN-raidmimic-hosted.md`, unbuilt), and `hub_guilds.discord_guild_id` is typed in by hand.
- **Restricted-table pattern.** `hub_*` and `terms_acceptances`: RLS on, no policies, grants revoked from `anon` and
  `authenticated`, read only by the web's service role after a server-side check. The guild-scope ratchet
  (`scripts/guild-scope-audit.js`) must be told about a deliberately cross-guild table.

## 3. Proposed shape (for the guild lead to confirm; section 6 lists the choices)

**Consent belongs to the player.** Sharing is off until the player turns it on, per character, after a plain panel: "your
character's name, class, level and which Planes of Power steps it still needs are shown to raid leaders of guilds on Raid
Mimic. Not your zone, not when you got a flag, nothing from your logs. Turn it off any time." The guild never flips it.

**Separate tables, a copy at publish time.** `pop_flags` stays as it is. Publishing writes a coarse copy:

- `flag_exchange_consents (player_id, character, scope, granted_at, withdrawn_at)`.
- `flag_exchange_entries (player_id, character, class, level, needs text[], verified_at, consent_id)`: what is "still
  needed", never `earned_at`, zone, boss or raw source.
- `flag_exchange_views (viewer_guild, viewer_player, character, at)`: append-only, so a player can see which guilds looked.
- All three: RLS on, no policies, grants revoked; read only through the web's server actions after checking the caller's
  grant and the entry's live consent. Never through the bot's service role.

**Supply.** A hosted player's flags need a way in: a hub-scoped `pop_flags` route for the agent and the web paste on
raidmimic.com. **Built 2026-11-02 (bot 4.0.50, slice 1 of free syncing, §526):** `utils/mimicLink.js` splits the hub
routes into `FREE_ROUTES` (poll, latest-version, link routes, `pop_flags`) and `PAID_HUB_ROUTES` (adds the fight upload,
for a guild on the `managed` plan); a free session hitting a paid route gets 403 `plan_required` before any body is read
(§527). A **player session** (link start `{player:true}`, code hub `'~player'`, no guild needed, only a raidmimic.com
account) resolves through `hub_players` alone. Its flags go to `utils/hubSync.js` → `hub_flags` (person-scoped, no
guild_id) with the characters in `hub_characters` (proof `claimed` by uploading as the character; a name Wolf Pack links to
another member is refused; two players on one name both become `contested`). Neither table is Wolf Pack's: the dispatch in
`_handleAgentPopFlags` runs before any Wolf Pack write (`test/hub-sync.test.js`). Still to do: Mimic's "no guild, just sync"
choice (beta), kills, the player page, the guild feed, and **self-delete and export covering `hub_flags` / `hub_characters`
(a launch blocker: `member_self_delete` anonymises `hub_players`, so the cascade never fires)**. Third-party capture (§516) lands as
"reported", shows ✅ marked reported, never ❌, until the owner confirms.

**Events.** `flag_events (guild_id, target_key, starts_at, posted_by, note, visibility)`, `target_key` from the catalog;
`flag_event_interest (event_id, player_id, character, at)`. Visibility: own guild, or open to the exchange.

**Officer rights.** Owner-only promote / demote, ownership transfer, leave and remove, each written to an audit table.
Capabilities as grants (`hub_grants (guild_id, player_id, capability)`): post schedule, see the exchange, manage bot, manage
roles, so "officer" is not all-or-nothing.

**Bot and role wizard.** "Add Raid Mimic to your Discord": a bot invite for the server the owner manages (proved by
Discord's Manage Server permission on the sign-in's server list), then the wizard lists the server's roles (read through the
bot, never by the website holding the token) and the owner ticks which map to member / officer / which show on the guild's
pages. Stored in `hub_guild_roles (guild_id, discord_role_id, name, maps_to)`.

**OpenDKP import.** A guild leader connects the guild's OpenDKP (its own client name and a read credential, stored sealed like
the bid key: `utils/bidCrypto.js`-style, never readable back), and the roster read fills the guild's member list with characters
not yet seen on Raid Mimic, marked "from OpenDKP, not signed in". Import only: nothing is written to OpenDKP. Needs the per-guild
credential shape the OpenDKP ask already describes (`docs/DESIGN-opendkp-audit-cursor.md`).

**Ask to be told.** `flag_exchange_watches (player_id, character, target_key, created_at)`: "tell me when a guild opens a raid
for this", per character (main or alt), filled from the character's own "still needs". When an event opens with guest places,
watchers who still need it get one Discord DM (opt-in, through the Raid Mimic bot) or a line on their raidmimic.com page. One
message per event, never repeated; a watch ends once the flag is held.

**Guest places.** `flag_events.guest_limit` (0 = guild only). Guests sign up as interest; the leader accepts up to the limit;
the page shows "3 of 5 guest places taken". A guild's own members never count against it.

**Guild links.** `hub_guilds` gains a Discord invite link and a website, set by the owner, shown on the guild's card and on each
open event, so a guest can find the guild. Links are checked to be `discord.gg` / `discord.com/invite` or `https://`.

**Guild suggestion** (the guild lead, 2026-11-02: "if we recognize a character name in our /who directory data we can suggest
their guild to them"). When a player on raidmimic.com has proved a character is theirs (the claim rule above), and the /who
directory has seen that name with a guild tag that is a guild on Raid Mimic, `/guilds` says "Aldenmar was last seen in
<guild>: ask its officers for a code, or find it with Find my guilds". Never for a name the player typed but has not proved
(that would let anyone look up anyone's guild), and never naming a guild that is not on Raid Mimic: the /who directory is read
only by guilds that saw the name (`docs/DESIGN-raidmimic-hosted.md` §8c). In-game /who is public, but our copy of it is not a
lookup service.

**Trust gate.** A guild sees other guilds' players only once it is verified: a confirmed Discord server, a minimum size, and
not suspended. A one-click guild sees nothing cross-guild.

**Guilds that already run their own site** (first seen 2026-11-02: a guild's member site, viewed with a guest login, §523).
Some guilds have built most of this themselves: a roster with characters pooled per account, EPGP ledgers with an audit
trail, raid nights with attendance snapshots from parses, a bank synced from inventory exports, a live bid board fed by an
officer desktop app, a 47-step PoP checklist and a flag matrix. For them Raid Mimic is a set of **layers that plug into their
stack**, not a replacement, ranked by value against migration pain:

1. **A Discord bot layer** for what officers do by hand today: EP claims for level and epic bonuses and bank donations
   (screenshot, then an officer types the EP), member-run event submissions, bid-board notifications. Additive, no migration.
2. **Flags derived from logs** (the agent's #popflags, Seer and grant reading) delivered INTO their matrix: an outbound feed
   per guild (a signed webhook or a pull API returning character, flag step and time), only for players who opted in. Their
   flags are manual check-offs today.
3. **Rules rendered from configuration**: their rules page and their maths had drifted apart (section 2 of
   `docs/DESIGN-loot-systems.md`, Guild A).
4. **Checks at bid time**: once-per-account items, main/alt tier eligibility, the EP cap.
5. **Hosting the whole ledger** only if they want out of maintaining it (tens of thousands of ledger rows and a custom decay
   history to migrate).

So two shapes are needed besides the hosted guild: an **outbound feed** (flags and fights to a guild's own system) and a
**bot that works beside a guild's own site**. Whether the guild's own maintainers want to keep their site decides which
to lead with.

**What that guild's raid leader asked for** (a long conversation, 2026-11-02; §524), strongest first, with what we have:

| Need | Their words, in short | What Raid Mimic has | Gap |
|---|---|---|---|
| A spawn / time-of-death board | what is up, when it died, when it is due; automatic, with a manual "we just killed it"; inside THEIR site and bot | the bot's boss timers with kill buttons, kills from the agent (`/api/agent/bosskill`, lockouts), slow mode | a read feed for another guild's site; an honest coverage line per boss ("from a log" / "by hand"); kills reported from outside Wolf Pack |
| Flags with no member effort | "we can't get half the guild to read Discord, let alone do a manual step" | the agent reads #popflags, the Seer and grants from the player's own log | it covers only players who run the agent; the feed into their site |
| Raid-lead timers | slow timers, AE warnings, curse timers; "I just can't not have all the info" | guild triggers, timers, curse counters, the GINA-compatible import | a timer pack exported for their trigger tools |
| Wipe review | the shared raid replay "could pinpoint the actual wipe causes" | raid replay and share links | none for viewing; uploads need the agent |
| Alt-flag logistics | keys carried, ports, click timing for an alt push | the flag events board | step lists per event |

Their limits, which shape any offer: **nobody is required to run anything** (so target the raid leader and a few officers
running the agent, and say plainly what is missed when nobody in a fight runs it); **feed their site and bot** through an
API or webhook their builder consumes, never a platform switch; **Raid Mimic must not become their single point of failure**
(their data stays in their site; our feed is an addition); and they will test our sign-in, role gating and export as hard as
they would their own. They did not ask about loot.

**Cost.** Flags and kills are tiny (all 65k flag rows ever stored are 15 MB with their indexes, measured 2026-11-02; the last
week held about 3,500 recorded fights, of which boss kills are a small share), and a feed is a push of a few hundred bytes per
event, so syncing them costs us almost nothing to run. The guild lead,
2026-11-02: *"it's gotta be cheap for users to be able to get their popflags and mob kills synced"*. Plan change in §525.

## 4. Phases

1. **Demo** (`raidmimic.com/demo`, static, invented guild): what a guild gets, the "record for someone else" flow and both
   event-board options. No data. Live 2026-11-02 (web 2.1.97): https://raidmimic.com/demo.
2. **Wolf Pack first, on raidmimic.com:** flag events and "who needs it" for one guild, on today's data.
3. **Hosted guilds:** officer rights and audit, the bot add + role wizard, hosted players' flag uploads.
4. **The exchange:** consent panel, the restricted tables, cross-guild "who needs it", view log, the privacy rewrite (section 5)
   in the same change.

## 5. Privacy text that turns false the day the exchange opens (rewrite in the same change, never after)

- `web/app/raidmimic/privacy/page.tsx`: "A guild owns its members' raid records…"; "Anything combined across guilds is
  anonymised counts and totals, never names or characters"; "One guild's observations are never merged into another's as
  fact"; the "Your guilds" bullet.
- `web/app/privacy/page.tsx`: the hosted-deployment section's "anonymised aggregates only … never names or characters" and "No
  tenant's observations are merged into another's"; the scope table needs a new tier (other guilds' raid leaders, opt-in);
  "Your own PoP flags" needs the sharing switch.

## 6. Choices for the guild lead

1. Sharing: opt-in per player and off by default (proposed), or implied by guild membership.
2. What other guilds see: named characters that need a target (proposed, opt-in), or counts only; and whether the player's
   guild is shown.
3. Who grants officer rights: the owner only (proposed), or officers too, up to a cap; one role or capabilities.
4. How a hosted guild earns cross-guild visibility: verified Discord + minimum size (proposed), or manual approval.
5. One shared Raid Mimic bot for every guild (proposed for the start) or one per paying guild (§490 option C).
6. How hosted players' flags get in: the agent route, the web paste, or both (proposed: both).
7. How long a shared entry stays after the player stops uploading, leaves or deletes (proposed: withdrawn at once on leave or
   delete; hidden after 30 days without a fresh read).
8. ~~Event board: post-first (option A) or needs-first (option B)~~ **Picked A, 2026-11-02 (§522)**: being built for Wolf Pack
   at `/pop/events`.
9. Telling watchers: a Discord DM through the Raid Mimic bot (proposed, opt-in) or only a list on their page.
10. Guest places: the leader accepts each guest (proposed) or first come, first served up to the limit.
