# Raid screen as a Discord Activity (option C)

Status: PLAN 2026-10-06. Research only, nothing built. Decision owner: the guild lead.
Context: DECISIONS §166 offered the shared raid screen three ways: A (the leader Go Lives the page), B (a
`/screen` page on wolfpack.quest), C (a Discord Activity). The guild lead, 2026-10-06: *"B now, start the C
planning."* B ships first and this doc plans C, built as a thin wrapper over B.
Tags: **[doc]** read on Discord's own pages 2026-10-06 · **[3rd]** third-party, a hint only · **[infer]**
reasoned and untested; the Phase 0 spike settles it.

## TL;DR

- **Not possible today as-is.** An unverified Activity runs only in servers with fewer than 25 members.
  Ours has ~387. App testers and team members do not lift that cap.
- **Possible with conditions once verified.** Verification is the only gate, and the docs name no minimum
  server count. The conditions:
  - a Developer Team whose owner passes the Stripe ID check;
  - public Privacy and Terms URLs;
  - the bot becomes permanently public (so add a guild allowlist);
  - the portal lets a one-server app click Verify. This last one is undocumented. **Check it first; it
    takes about 5 minutes.**
- **Auth:** exchange the Discord code on our server, check guild membership and role, then mint a scoped
  2-hour signed **screen ticket**. Do not mint a Supabase session. B's live feed uses the same ticket
  (section 5), so C adds a second way to get one, not a second token.
- **Sync:** keep polling, but not against Vercel. Vercel Hobby's monthly cap is 1M function invocations,
  and 60 viewers polling every 3 s use ~288k in one raid night. **Decided for B (2026-10-06): the 3-second
  read is served by the Railway bot from memory.** The Activity adds a second URL mapping for that host.
- **Everything except the launch in the big server can be built and tested now**, in a test server under
  25 members. If verification stalls, B and A still stand.

## 1. Requirements and the verification gate

| Fact | Source | As of |
|---|---|---|
| Unverified: "Only visible to you, your development team, and app testers"; "Limited to servers with fewer than 25 members" | [Verified vs Unverified Activities](https://support-dev.discord.com/hc/en-us/articles/26576097154199-What-are-Verified-and-Unverified-Activities) | updated 2026-09-15 |
| Restated: "By design, unverified Activities … can only be launched in servers with fewer than 25 members" | [Discover and Play](https://support-dev.discord.com/hc/en-us/articles/21204493235991-How-Can-Users-Discover-and-Play-My-Activity) | 2026-09-26 |
| Testers: up to 50, must be Discord friends of the owner, accept an email invite, then switch on Advanced > Application Test Mode and paste the app id. Team: up to 100, same friend and email steps, and members get portal access | same article | 2026-09-26 |
| Verified: "Playable in any server, regardless of size", no member limit. Discovery is a separate, optional switch | Verified vs Unverified Activities | 2026-09-15 |
| Verification "is required for your app to scale past 100 servers". The checklist is in the portal's App Verification tab, and the team owner's identity check goes through Stripe. **No minimum server count is stated** | [How Do I Get My App Verified?](https://support-dev.discord.com/hc/en-us/articles/23926564536471-How-Do-I-Get-My-App-Verified) | 2026-10-05 |
| App Verification and privileged-intent review "are now separate". The old 75/100-server figures came from the combined review | [Changelog 2026-06-10](https://docs.discord.com/developers/change-log), [help article](https://support-dev.discord.com/hc/en-us/articles/40281523410967-Changes-to-Privileged-Intent-Access-for-Discord-Apps) | 2026-06-10 / 2026-10-04 |
| A Developer Team is required for verification | [Teams](https://support-dev.discord.com/hc/en-us/articles/34905563063703-Creating-and-Managing-a-Developer-Team) | 2026-10-04 |
| Stripe: re-verify about every 3 years. The owner must be 16+ and use their own ID | [Stripe FAQ](https://support-dev.discord.com/hc/en-us/articles/6226051178775-Stripe-Identity-Verification-FAQ), [under-16 note](https://support-dev.discord.com/hc/en-us/articles/6276106082583-An-Update-on-Verifications-for-Users-Under-16) | 2026-10-01 / 2026-09-27 |
| Changing the team owner of a verified app removes verification and deletes the ID data | [Team ownership transfer](https://support-dev.discord.com/hc/en-us/articles/34905402845591-How-to-Transfer-Ownership-of-a-Developer-Team) | 2026-09-16 |
| Once verified, "you will not be able to turn off the public bot setting" | Discover and Play | 2026-09-26 |
| [3rd] One third party's reading of the checklist: team plus Stripe, public Privacy Policy and ToS URLs, name/description/icon, "human review" | [issue, 2026-09-29](https://github.com/merlin-pinpin-org/kingdoms-services/issues/154) | unconfirmed |

**Answers to the specific questions**
- **Is there a minimum server count?** None appears on any current Discord page we could open. The
  75-server rule is from 2020-era posts, and we found no separate path for Activities. [infer] An
  unverified Activity cannot launch beyond tiny servers, so Activity verification can hardly require an
  install base. That is a moderate-confidence inference, not a source.
- **What does the 25 count?** The wording is the server's member count, not the people in the voice
  channel or the Activity. Nothing says whether bots count. A test launch in the big server will show the
  exact error.
- **Are testers or team members exempt?** No exemption is documented. Even the "testers only" text ends
  "can only be launched in servers with less than 25 members". Adding raiders to the team would also hand
  them portal access, so don't.
- **The portal checklist** needs a login, so a cloud session could not read it.

**Verdict: possible with conditions.** If the App Verification tab will not let a one-server app submit,
ask [Developer Support](https://support-dev.discord.com) before building anything more. Until then B
(and A) carry the raid.

## 2. Architecture

```text
 Discord client (desktop / web / iOS / Android)
   iframe: https://<app-id>.discordsays.com/?frame_id&instance_id&platform
        | Embedded App SDK (postMessage): ready(), authorize() -> code
        v
 Discord proxy (URL mappings:  "/" -> wolfpack.quest,  "/live" -> the Railway bot)
        |                                         |
        v                                         v
 Vercel / Next.js 14                         Railway bot (index.js)
   GET  / (query has frame_id) -> /activity     GET /api/screen/live   ticket -> positions + screen
   POST /api/activity/session                     state, from memory (the B live feed, section 5)
        code -> Discord token exchange -> guild+role check -> screen ticket (2 h)
   GET  /api/spectator/map, /api/screen/*   ticket OR Supabase cookie (screen routes only)
        v
 Supabase (service role, as today)          Bristlebane (Tower): posts the Open button, answers LAUNCH_ACTIVITY
```

## 3. Auth

**Flow** (client code from the [SDK reference](https://docs.discord.com/developers/developer-tools/embedded-app-sdk)
and [Build an Activity](https://docs.discord.com/developers/activities/building-an-activity)):
1. Call `new DiscordSDK(<app-id>)`, then `await ready()`, then
   `authorize({ response_type:'code', prompt:'none', scope:['identify','guilds.members.read'] })`. Consent
   shows once; after that it is silent.
2. `POST /api/activity/session {code}`. The server exchanges the code at `discord.com/api/oauth2/token`
   with the app's client secret, then calls `GET /users/@me/guilds/<guild>/member` with that access token.
   That is the same call `fetchGuildMember` in `web/lib/discord.ts` makes. A 404 there becomes a 403 (not
   in the guild).
3. Apply the same role gate as `web/app/auth/callback/route.ts` (`ALLOWED_ROLE_NAMES` against
   `wolfpack_roles`) through a new shared helper. Leave the callback itself untouched. `auth/claim` already
   holds a second copy, so a third one is a later cleanup, not part of this work.
4. Mint the **screen ticket** `{sub: discord_id, aud:'screen', exp: now+2h}`, HMAC-signed with
   `SCREEN_TOKEN_SECRET`. B's page mints the same ticket from the site's sign-in cookie (section 5). **Throw
   away the Discord access token and store nothing.** Return `{token, exp, name, avatar}`.
5. The client keeps the ticket in memory and sends it as `Authorization: Bearer`. On a 401 it silently
   re-runs step 1 once. Skip the SDK's `authenticate()` in v1: our server does not need it, and the
   participants and layout events need no scopes.
6. A new `memberFromRequest(req)` accepts the Supabase cookie or a valid ticket. Use it in **only** the
   screen reads (`/api/spectator/map` and `/api/screen/*`). Everything else (`/me`, tells, admin) stays
   cookie-only. The Railway bot checks the same ticket on `/api/screen/live`.

**Why this one: it is the simplest safe option**

| Option | Verdict |
|---|---|
| **A. Scoped HMAC ticket** | **Chosen.** About 1 day of work, with no Supabase change. A leaked ticket reads only the raid screen, for at most 2 hours. Checking it is a local HMAC check, so no poll waits on GoTrue (the `middleware.ts` comment records the 2026-07-13 GoTrue incident). |
| B. Mint a real Supabase session | Rejected. Anyone who never signed in on the site has no `auth.users` row. Cookies would need `SameSite=None; Partitioned` on the discordsays host, which is unproven through the proxy. A stolen session reaches every member page. Minting needs Supabase [signing keys](https://supabase.com/docs/guides/auth/signing-keys) (import your own key, then "Rotate key"), a project-wide change. |
| C. `signInWithIdToken` | Dead end. The installed `@supabase/auth-js` 2.65.0 lists google, apple, azure, facebook, kakao and keycloak. Discord's [OAuth2 scope table](https://docs.discord.com/developers/topics/oauth2) has no `openid`, so no ID token exists. |
| D. Trust the SDK's user object | Rejected. Discord's [networking guide](https://docs.discord.com/developers/activities/development-guides/networking) says client data "could be falsified". |

**Env vars** for Vercel, enabled for **Production and Preview** per the CLAUDE.md rule:
- `NEXT_PUBLIC_DISCORD_ACTIVITY_CLIENT_ID`
- `DISCORD_ACTIVITY_CLIENT_SECRET`
- `SCREEN_TOKEN_SECRET`, which is already needed for B. It holds 32 random bytes, and the same value goes
  on Railway.

The secrets never go in the repo or in chat.

**Later hardening:** Discord can sign proxy requests (`X-Signature-Ed25519`, and an
`X-Discord-Proxy-Payload` header carrying "user context"; see the
[multiplayer guide](https://docs.discord.com/developers/activities/development-guides/multiplayer-experience)).
That page does not document the payload's fields, so the spike should log one. If it carries user and
instance ids, it could replace the code exchange.

## 4. URL mappings, CSP, Next.js

**Mappings needed: two.**
- **`/` → `wolfpack.quest`.** The dev app points at `b.wolfpack.quest` instead. The docs say "The URL for
  your application's html should be set to the `/` route"
  ([local development](https://docs.discord.com/developers/activities/development-guides/local-development)).
- **`/live` → the Railway bot host**, for B's live feed. The client must call it as `/live/api/screen/live`
  (a relative path, never the absolute Railway URL), and the bot must answer CORS for the discordsays
  origin as well as wolfpack.quest.

Why nothing else needs a mapping:
- `SpectatorBoard.tsx` otherwise makes only same-origin `fetch` calls. It has no client-side Supabase, no
  WebSocket and no external images.
- Discord avatars load directly, because `cdn.discordapp.com/avatars/` is on the CSP exception list.
- `next/font/google` self-hosts at build time, so there is no runtime font request.

**Known [doc]:**
- WebSocket works; WebRTC and WebTransport do not.
- Cookies need `Domain={app-id}.discordsays.com; SameSite=None; Partitioned`.
- HTML responses lose their cache headers, so hashed `_next/static` assets are fine.
- A library that calls an unmapped host fails with `blocked:csp`
  ([networking](https://docs.discord.com/developers/activities/development-guides/networking)).
- The official starter calls `/api/token` with a root-relative path
  ([starter](https://github.com/discord/embedded-app-sdk-examples/tree/main/discord-activity-starter)), so
  root-relative same-origin paths are the supported pattern.

**Next.js pitfalls.** No source we found tests the Next App Router behind the proxy, so every item below
is [infer] until Phase 0.
1. **The iframe loads `/` with the SDK's query parameters**, and the SDK throws without `frame_id`,
   `instance_id` and `platform` ([SDK source](https://github.com/discord/embedded-app-sdk/blob/main/src/Discord.ts)).
   Serve the shell with a `beforeFiles` rewrite in `next.config.js`: `source:'/'`,
   `has:[{type:'query',key:'frame_id'}]`, destination `/activity`. An `afterFiles` rewrite would lose to
   `app/page.tsx`. This is one config entry and no middleware change. Check that hydration survives the
   rewrite.
2. **No `redirect('/auth/signin')`.** Sign-in cannot run inside the iframe, so the Activity page shows an
   in-page "open from Discord" or "not a member" state. Do not reuse the `/spectator` page's redirect.
3. **The Activity gets its own root layout** (route group `(activity)`). That keeps out `SiteHeader`,
   `AuthBadge`, `GlobalSearch`, `GuidedTour`, `BetaBanner` and the per-render `getSessionUser()`.
4. **Inline scripts are the biggest risk.** The App Router emits inline `<script>` tags for its payload,
   and no page we opened says whether Discord's CSP allows them. If it does not, Plan B is a client-only
   bundle, which costs more.
5. **No absolute `https://wolfpack.quest/...` URLs** in Activity code, because they are blocked. External
   links go through `discordSdk.commands.openExternalLink`.
6. **Upstream redirects:** pin each mapping to the canonical host. A 30x to another host leaves the
   sandbox.
7. **Shared egress IP:** the
   [production readiness](https://docs.discord.com/developers/activities/development-guides/production-readiness)
   page warns that dynamic cloud IPs can inherit a Cloudflare ban on Discord API calls for up to an hour.
   The token exchange runs on Vercel. If it ever returns 403, move the exchange to the Railway bot.
8. **Dev loop:** use a tunnel (`cloudflared`; a 2024 [3rd] note says the free ngrok tier is unreliable) or
   the client's "Application URL Override". Preview deployments are unstable targets, so use
   `b.wolfpack.quest`.

## 5. Sync

Keep polling. Zeal data lands every ~3 s, and `SpectatorBoard` already polls at `POLL_MS = 3000` and pauses
when the tab is hidden. Alternatives that were rejected:
- **The SDK's participants command and event**
  ([multiplayer guide](https://docs.discord.com/developers/activities/development-guides/multiplayer-experience))
  carry presence only, with no data channel. Use them later for a "N watching" chip.
- **Supabase Realtime from the iframe** would need a `wss` mapping, the anon key, and RLS on tables that
  today are served only through a service-role route.
- **A WebSocket server** would be new infrastructure for no gain.

**The transport is fine; the host is the problem.**
[Vercel Hobby](https://vercel.com/docs/plans/hobby) (page updated 2026-09-14) includes 1,000,000 function
invocations a month, and going over means waiting 30 days. The math:
- 60 viewers × 20 requests a minute × 4 hours is **~288k invocations per raid night**, ~3.7M across ~13
  nights a month.
- Even 20 viewers is ~1.2M a month.
- Edge caching does not help: Hobby counts every edge request too.

The plan is Hobby per CLAUDE.md (2026-09-29). This session could not check this month's count, because the
Vercel connector needs sign-in.

**Decided for B, 2026-10-06, and C inherits it:**
- **The 3-second read moves to the Railway bot.**
  - The bot already holds every raider's latest position in memory: `utils/raidTrack.js` `latest`, fed by
    the raid-roster ingest.
  - So `GET /api/screen/live` answers with positions plus the screen state (which tab, which slide, the
    loot line) without reading the database on each poll.
  - Railway bills compute and egress, with no request cap.
- **Signing in:** the page asks Vercel once for a screen ticket from the site's sign-in cookie
  (`/api/screen/ticket`, one call per 2 hours per viewer). It then polls the bot with that ticket. The
  Activity gets the same ticket from `/api/activity/session`.
- **Fallback:** while `SCREEN_TOKEN_SECRET` is unset on either side, the page keeps polling the Vercel
  routes as `/spectator` does today. B therefore ships working before the secret exists, and the cap
  protection turns on when it is set.
- **Low-frequency reads stay on Vercel:** the zone map layers (`/api/spectator/map`, once per zone) and
  the slide list.

Further mitigations, cheapest first:
1. Poll every 5 s inside the Activity.
2. Back off on the mobile `THERMAL_STATE_UPDATE` event.

## 6. Launch flow and mobile

1. **App Launcher / Activity shelf (zero code).** Enabling Activities auto-creates an Entry Point command
   "Launch" (type 4, handler `DISCORD_LAUNCH_ACTIVITY` = 2). Discord opens the Activity and posts the
   follow-up ([user actions](https://docs.discord.com/developers/activities/development-guides/user-actions)).
2. **A Bristlebane button.** `apps/bristlebane/index.js` already routes `i.isButton()`.
   - Add a `screen:open` handler that calls `i.launchActivity()` (callback type 12,
     [interaction responses](https://docs.discord.com/developers/interactions/receiving-and-responding)).
   - It must be the first and only response, with no defer.
   - discord.js `launchActivity` exists in the installed 14.26.x and works on button interactions.
   - Post the button where Bristlebane already posts its raid notice (`post()`), or add
     `/bristlebane screen`.
3. **A custom Entry Point** (`APP_HANDLER`, handler 1) only if we want to gate the launch. The data is
   already gated on the server, so skip it.

Gotchas:
- **Keep the Entry Point.** It is global, so Bristlebane's guild-scoped command overwrite does not touch it.
  A future global reconciler, or the merged one-bot registration (§166), must keep it too. A
  [reconciler that deleted it](https://github.com/openclaw/openclaw/issues/127421) (2026-08-21) left
  `sdk.ready()` hanging.
- **Permission:** "Use Activities" is already in the §166 permission integer.
- **Unverified:** where the Activity opens from a text-channel button, and what happens to a user who is
  not in voice. Post the button in the raid voice channel's own text chat and test it.

**Mobile: yes, with work.**
- Tick Web, iOS and Android under Activities > Settings > Supported Platforms
  ([mobile](https://docs.discord.com/developers/activities/development-guides/mobile)).
- Use the `--discord-safe-area-inset-*` CSS variables.
- Use `setOrientationLockState` (landscape), the PiP layout event and the thermal events.
- `SpectatorBoard` is 815 lines and needs a touch pass.
- For unverified dev builds on mobile, switch on Developer Mode under Appearance.
- A raider playing EQ fullscreen cannot see Discord. The Activity is for officers, second screens and
  phones; Mimic overlays remain the in-game answer.

## 7. Phases

| Phase | Needs verification? | Work |
|---|---|---|
| **0 Spike** | No | A second, dev app with mappings to `b.wolfpack.quest` and the bot, in a test server under 25 members. Prove the `/` rewrite, the inline-script CSP, root-relative `_next`, `/api/*` through `/`, `/live/*` through the second mapping, avatars and mobile. Also try a launch in the big server, to read the exact error and see whether team members bypass the cap. Log the proxy payload. **Go/no-go.** |
| **1 Build, ships dark** | No | The `/api/activity/session` route (minting the B ticket), `memberFromRequest` on the screen reads, the `(activity)` layout, the rewrite, and the Bristlebane button with a lib test. Web goes to `main` (a new route with the `[beta]` marker, not linked); Bristlebane ships as its own component. No `main` pushes in the raid window. |
| **2 Launch** | **Yes** | Verify, point the live mappings at `wolfpack.quest` and the bot, launch in the big server, run an officer dry run on a non-raid evening, then a raid night. |
| **3 Polish** | Yes | Participants chip, thermal back-off, orientation lock, an optional proxy-header check. |

## 8. Cost (four numbers)

- **Build:** ~4–6 dev days (spike 1, auth 1, shell and rewrite 1, gate and tests 1, bot 0.5, mobile 1),
  plus the guild lead's time and an unknown verification wait. The ticket and the bot live feed are
  already paid for by B.
- **Maintenance:** low to medium. A second auth path must track the member gate. Then there is SDK drift
  (2.5.0, 2026-05-05) and client drift, two secrets to rotate, an ID re-verify every three years, and
  policy drift (this gate last changed on 2026-06-10).
- **Runtime:** no new infrastructure. The proxy adds a hop, which is fine for a 3–5 s poll. A route-group
  layout keeps the bundle small. The 3-second reads land on Railway, not Vercel (section 5).
- **Change:** low while the Activity wraps the same components as B; high if it forks the UI. Verification
  ties the app to its owner's identity, and handing the app off later removes the verification.

## 9. Risks

1. **Verification is unavailable, slow or denied.** Mitigation: the Phase 0 check, then fall back to B or
   A.
2. **Next.js behind the proxy** (inline scripts, the rewrite). Mitigation: Phase 0, then the Plan B
   bundle.
3. **The Hobby invocation cap.** Handled by moving the hot read to the bot (section 5).
4. **The bot becomes public after verification**, so anyone could add Bristlebane. Add a `guildCreate`
   handler that leaves any guild that is not `DISCORD_GUILD_ID`. Our data routes still reject non-members.
5. **Owner accountability.** The person who passes the ID check becomes the app's owner of record, and
   Discord sends questions to their account email.
6. **The self-host epic.** Another guild needs its own verified app, or fewer than 25 members. Record this
   in `DESIGN-selfhost-wizard.md` §3 when it is decided.
7. **Ticket theft.** Each ticket is scoped to the screen, read-only and lasts 2 hours.
8. **The rules move.** Several of these pages changed within the last three weeks. Re-read them before
   Phase 2.

## 10. Guild-lead steps (only you can do these)

1. In the Developer Portal, open the app's **App Verification** tab. Read the checklist and tell a session
   whether Verify is available for a one-server app. This takes about 5 minutes.
2. Create a Developer Team. Its owner is whoever will show ID (16 or older, 2FA on). Then transfer the app
   under General Information > Transfer App to Team.
3. Do the Stripe ID check as the team owner.
4. Provide public Privacy and Terms URLs. A privacy page exists, but there is no Terms page (`web/app` has
   none), so a session needs to build one.
5. Under Activities > Settings, enable Activities and tick Web, iOS and Android. Add the URL mappings `/` →
   the site and `/live` → the bot. Under OAuth2 > Redirects, add the placeholder `https://127.0.0.1`. Put
   the client secret in Vercel (Production and Preview), never in chat or the repo.
6. Create a small test server and a second dev app for Phase 0.
7. Decide whether to keep Discovery off (recommended), which keeps the Activity out of the App Directory.

## 11. Open questions

- Does the portal let a one-server app verify, and what exactly is on the checklist?
- Does the 25-member count include bots? Do team members bypass it? (The Phase 0 launch test answers both.)
- Does the proxy's CSP allow Next's inline scripts, and does hydration survive the `/` rewrite?
- Does a button posted in the voice channel's text chat open the Activity in that voice channel?
- Which fields does `X-Discord-Proxy-Payload` carry?
- Does the proxy rate-limit ~20 requests a second of polling? Nothing is documented.
- Is Vercel really on Hobby, and what is this month's invocation count?
- Should the ticket also unlock the `/api/screen/*` write controls for the raid leader? Assume not at
  first: the Activity is read-only.

## Sources (opened 2026-10-06; "as of" is the page's own date)

- **Discord help center**, read through its JSON API (the HTML pages return 403 here): the articles linked
  in section 1.
- **Discord developer docs** (pages are undated; the newest changelog entry is 2026-09-28): the pages
  linked above, plus
  [how activities work](https://docs.discord.com/developers/activities/how-activities-work),
  [Application resource (activity-instances)](https://docs.discord.com/developers/resources/application)
  and [discovery](https://docs.discord.com/developers/discovery/enabling-discovery).
- **Older:** [Using Apps on Discord](https://support.discord.com/hc/en-us/articles/21334461140375-Using-Apps-on-Discord)
  (2024-09-26: Activities can launch from chat or voice).
- **npm:** `@discord/embedded-app-sdk` 2.5.0 (2026-05-05), `discord.js` 14.27.0 (2026-07-15).
- **[3rd]:** the [robojs proxy page](https://robojs.dev/discord-activities/proxy) (2025-11-28) and an
  [Activities backend guide](https://crux.supercraft.host/blog/discord-activities-backend/) (2026-09-12).
