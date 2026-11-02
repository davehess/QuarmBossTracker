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

Seven parts:

| # | Part | Today |
|---|---|---|
| 1 | A guild's raid leaders post a schedule (target + time) | Raid-Helper events exist for Wolf Pack only, and name no target (0 of 24 in ±30 days) |
| 2 | Fill a raid's gaps from players in ANY guild whose flags say they need that target | "Who needs what" is computed (`web/lib/popGateStatus.ts`), Wolf Pack only |
| 3 | Plain disclosure of what is shared, with whom, before sharing | The privacy pages promise the opposite (section 5) |
| 4 | Restricted tables for the cross-guild data | Pattern exists (`hub_*`, `terms_acceptances`); no exchange tables |
| 5 | A guild sees which of its players uploaded flags | Wolf Pack only, by reading `pop_flags` |
| 6 | Owners and leadership grant officer rights | Roles exist (`hub_memberships.role`); nothing promotes, demotes or transfers |
| 7 | Each guild adds the Raid Mimic Discord bot, with a wizard to pick which roles appear | Nothing for a hosted guild |

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
  `hub_invites`. Production: 0 hosted guilds. Officers can only make invite codes. A hosted player's agent can upload fights
  only (`HUB_ALLOWED_ROUTES` in `utils/mimicLink.js`); `pop_flags` is not on that list, and the handler writes the process's
  own guild.
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

**Supply.** A hosted player's flags need a way in: a hub-scoped `pop_flags` route for the agent (added to
`HUB_ALLOWED_ROUTES`, writing the player's own guild) and the web paste on raidmimic.com. Third-party capture (§516) lands as
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

**Trust gate.** A guild sees other guilds' players only once it is verified: a confirmed Discord server, a minimum size, and
not suspended. A one-click guild sees nothing cross-guild.

## 4. Phases

1. **Demo** (`raidmimic.com/demo`, static, invented guild): what a guild gets, the "record for someone else" flow and both
   event-board options. No data. In progress 2026-11-02.
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
8. Event board: post-first (option A) or needs-first (option B); shown in `/demo`.
