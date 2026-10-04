# Design — Discord setup on wolfpack.quest (threads, permissions, scheduled jobs)

Status: **options, awaiting the guild lead's pick.** No code yet.

Trigger: the guild lead, 2026-10-04: *"I feel like the discord setup is probably frustrating for people.
setting up the threads should just be a spot in the website, wolfpack.quest and then permissions reviews,
scheduled tasks, etc"* (DECISIONS-2026-09-21 §148). This is the same screen the self-host wizard needs:
`docs/DESIGN-selfhost-wizard.md` §3 (2026-10-04 line) and §4 (guild kit), `docs/DESIGN-guild-kit.md` slice 3
(the Discord provisioner) and `wolfpack doctor`.

## What exists today (mapped 2026-10-04, bot 3.1.194)

**Where things post:**
- 45 channel or thread destinations, all read straight from `process.env` at about 54 sites. There is no
  central resolver.
- Only the officer channel can be changed at runtime: `bot_kv.officer_channel_id`, set by
  `/preraid here:true`, read in `utils/officerChannel.js`.
- 8 Wolf Pack channel ids are hardcoded as fallbacks: hate, raid-chat, event-chat, loot, forum,
  mimic-release, slop and general.
- 17 message-id anchors (slot cards, cooldown cards, boards) self-heal by scanning their threads. They
  are not user choices and stay out of any page.
- `guild/discord.json` fills unset env vars at boot, so a change still needs a commit and a deploy.

**Permissions:**
- The bot's own Discord permissions are checked in only three places: `_canOpenThreadIn`
  (`utils/raidNight.js`), `/voicetest`, and three commands with `setDefaultMemberPermissions`.
- There is no startup check, and the README's permission list is shorter than what the code uses.
- The role gates (`ALLOWED_ROLE_NAMES`, `OFFICER_ROLE_NAMES`, `PVP_ROLE`) are env vars held twice, on
  Railway and on Vercel. The bot and web officer defaults disagree (`Officer,Guild Leader` vs
  `Officer,Pack Leader`).

**Scheduled jobs:**
- About 20 bot loops: the spawn checker, the midnight chain, raid ticks, the pre-raid health line, the
  member/role sync, the OpenDKP sync, the Raid-Helper sync, the feedback relay, the FB-ref watch,
  announcers and others. GitHub Actions adds one weekly schedule (`sync-quarm.yml`).
- There is no last-run record for any of them. `/health` shows only the Supabase breaker and budgets.
- The only no-deploy controls are the tuning flags: `flag_opendkp_halt`, `flag_shed_*`,
  `flag_agent_kill`, `flag_raid_hold` and the voice ripcord.

**How the website reaches the bot:**
- The web writes a Supabase row and the bot polls it on a 30-60s cache. That is how `overlay_tuning`,
  `voice_settings`, `mimic_notices` and the OpenDKP register queue already work.
- The web has no bot token, and the bot never lists the guild's channels.
- The tuning map is served to every agent, so anchors must not ride on it.

## The options

Leads per the 2026-10-04 rule: each option opens with a few-word "what makes it different".

- **A — Health page: see what's wired; changes still go through Railway.**
  - A new `/admin/discord` page shows every destination by name with ✅/❌: does it resolve, and can the
    bot post there.
  - It also shows the role gates, and every job with its last run and whether it worked.
  - Bot work: a channel/thread catalog synced like `wolfpack_roles`, a per-slot permission check written
    to a table, and a heartbeat row per job.
- **B — Pick on the site: a dropdown per destination, live within a minute, no redeploy.**
  - Everything in A, plus a dropdown per slot that writes a stored choice (a `discord_anchors` table).
  - The bot reads it through one cached resolver: env var (override) → stored choice → today's fallback.
    The ~54 env read sites move onto that resolver, which is the bulk of the work and the blast radius.
  - Job pause toggles use the existing flag pattern.
  - The role gates move to one table read by both bot and web, ending the Railway/Vercel hand sync. This
    needs care: it is the site sign-in gate.
- **C — The bot builds it: one button creates missing channels and threads with the right permissions.**
  - Everything in B, plus "Create missing" per slot, so the bot provisions and stores the id.
  - This is the self-host wizard's provisioner. For Wolf Pack, already set up, it adds little today; for
    another guild it removes the hardest step.

| | Build | Maintenance | Runtime | Change |
|---|---|---|---|---|
| A | ~1 day | Low: one more sync, like roles | One catalog sync + permission pass every few hours; a heartbeat write per job run | Making it editable later is all of B's work |
| B | ~3–4 days (resolver refactor across ~54 sites is most of it) | Low–medium | One cached 60s read | Cheap once the resolver exists: a new slot is one row |
| C | ~1–1.5 weeks | Medium (Discord create/permission edge cases) | Nil | Medium |

Recommended: **B, delivered as A first.** The health page is B's first slice and is useful on its own;
the dropdowns follow behind the same page.

Rules that hold for any option:
- the env var stays an override, and the bot keeps working with the website down;
- officer-only (`requireOfficer`);
- anchors never ride the agent tuning map;
- message-id anchors stay hidden;
- fix on the way: the dead `RELEASE_ANNOUNCE_CHANNEL_ID`, the unused `BOT_BASE_URL`, and the
  officer-role default mismatch.
