
## Officer-assisted Mimic linking (Hitya, from Gonner's "verify your account" wall)

> "gonner wants to install but doesn't have discord auth working. we need a
> secondary access method finally, backup email with password reset and
> everything, BUT TO START a 4 character bind in mimic and then link that to
> Wolfpack.quest"

**What already existed** (found by reading, not building): the bind flow is
the mimic-link device-code dance — Mimic shows a short code, `/auth/mimic-link`
confirms it — and the bot's poll handler has accepted a **discord-only**
authorization since 2026-07-31, added for exactly this class of member. What
never existed was a writer for that shape: the only page that could stamp a
code required the member themself to complete Discord OAuth, which is the one
thing an unverified account cannot do. Gonner could chat in the guild all day
and still never pass the consent screen.

**The call: officers attest identity.** A card on `/admin/links` takes the
code plus a member picked from `wolfpack_members` and stamps the code
discord-only with `authorized_via='officer'` and the attesting officer's own
discord_id. The trust model is stated in the action's header: the member never
proves control of the account — the officer vouches, the same trust we already
extend for character↔member links on that page, and the only model possible
when OAuth is off the table. Audit survives the code row's deletion by riding
`mimic_sessions.linked_via/linked_by_discord_id`. The target must be a current
member row — an officer cannot stamp an arbitrary Discord id.

**Kept the code at 6 characters, not the requested 4.** The 6-char code
already ships on every Mimic (`_generateUserCode`, unambiguous alphabet, ~2.18B
space behind a 10-min TTL and per-IP rate limit); shrinking it to 4 (~923K
space) would touch agent + bot + web for zero functional gain and put a
guessing margin in play on an UNAUTHENTICATED start endpoint. The web form
accepts ≥4 chars, so if a shorter code ever ships, the entry side is ready.

**The real secondary auth — email + password with reset — is QUEUED, not
built.** Supabase Auth supports an email provider, but wiring it means: linking
email identities to `wolfpack_members` without a discord_id at sign-up,
deciding what gates member pages when role_names can't come from Discord,
reset-mail deliverability, and the merge story when a member later verifies
Discord. That is a design doc, not a midnight patch. Tonight's path unblocks
the actual person: Gonner can run Mimic with his real identity TODAY; site
sign-in for OAuth-blocked members is the follow-up.

## Site access without Discord: officer invites + username/password (Hitya, from Lacunanight)

> "he doesn't want to install but wants site access. we need that alternative
> below the discord signin. login and pass and an invite link"

Lacunanight's wall is Discord demanding a phone number for OAuth consent ("I
have 2FA already"); he is fully present in the guild — only consent is blocked.

**The architectural key that made this small:** every gate on the site
resolves `auth.uid() → wolfpack_members.user_id`; Discord OAuth's only
structural job is stamping that binding in `/auth/callback`. So the feature is
just a second, officer-attested way to create the SAME binding for a
password-based `auth.users` — zero changes to any page gate, officer check, or
the /me ownership walk.

**The flow:** officer picks the member on `/admin/links` → single-use 7-day
invite link (`/auth/claim?token=…`, 32-byte token, service-role-only table) →
member picks username + password (≥10 chars) → account created PRE-CONFIRMED
via the admin API with email `<username>@login.wolfpack.quest` — synthesized,
never mailed — and stamped onto the member row (only where `user_id` is NULL,
so a concurrent OAuth can't be clobbered). Sign-in is a username+password form
below "Continue with Discord"; a bare username gets the login domain appended.

**Deliberate mirrors and models:**
- The `ALLOWED_ROLE_NAMES` gate runs at CLAIM time — the OAuth callback runs
  it at sign-in time, and claim is this flow's equivalent moment. Roles come
  from the member row (bot-synced every 6h).
- **Password reset = officer re-invite.** No SMTP dependency anywhere: a fresh
  invite for a member whose bound account carries `wp_invited` metadata RESETS
  that account's password instead of creating a second identity. The reset is
  attested by an officer exactly like the original grant.
- **The later-OAuth merge story, stated not solved:** if an invited member
  ever completes Discord OAuth, the callback re-stamps `user_id` with the
  OAuth account and the password account stops resolving to a member row. A
  subsequent re-invite REFUSES (the bound account is no longer `wp_invited`)
  rather than silently minting a second identity. Cleanup of the orphaned
  password account is manual; acceptable at guild scale, revisit if it recurs.
- **Dashboard prerequisite, unverifiable from cloud:** Supabase Auth's Email
  provider must be enabled (default on; the MCP has no auth-config read —
  same shape as the 2026-08-10 redirect-URL finding).

**Outcome (same night):** first live use succeeded end to end — invite
generated, claimed as `gonner`, signed in at 02:47 UTC. The one defect the
live run exposed: the sign-in form flattened every auth error into "wrong
password", which sent diagnosis down the credentials road while the server
showed the sign-in had already succeeded — fixed in web 1.1.95 (credential
failures keep the friendly line; everything else surfaces verbatim).
Officer procedure for both no-Discord paths: `docs/RUNBOOK-site-access.md`.
Deployment-shaped choices (login domain constants, Email provider, signups
toggle, no-SMTP reset): recorded in `DESIGN-selfhost-wizard.md` §3.
