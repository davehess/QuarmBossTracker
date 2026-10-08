# Decisions — 2026-08-24

Previous file: `DECISIONS-2026-08-21.md`.

## Mimic defends the chosen resolution against the client (#156, Hitya)

**The call.** *"make sure we're resetting the height and width each time the
game tries to overwrite it into the crapped 4:3 formats it expects."*

**The problem.** The old EQ client owns `eqclient.ini` and rewrites its
`[VideoMode]` block — on exit, and from the first-run display dialog. A Steam
Deck set to its native **1280×800** (or the **1440×900** supersample
quarm.guide's Bonus Step 7 recommends) comes back as **640×480 / 800×600 /
1024×768**, and every session after that is letterboxed until the player edits
the file by hand again. It is not a one-time setup problem; the client re-does
it every time.

**Where it landed.** `apps/mimic/resolutionLock.js` (new) + wiring in
`apps/mimic/main.js`, tests in `test/resolution-lock.test.js`. Indexed in
`docs/HOW-ITS-BUILT.md`.

### The decisions inside it

**Off by default, and the Deck value is a SUGGESTION not a switch.**
`cfg.resolutionLock = { enabled, width, height }` ships `enabled: false`.
Detecting a Deck fills in 1280×800 when the user leaves the numbers blank —
it never turns the lock on. Silently pinning somebody's resolution is the same
class of surprise we are fixing, pointed the other way. Off-Deck, an enabled
lock with no numbers stays inert rather than guessing.

**Timing is the whole design: every write is gated on EQ being DOWN.** EQ holds
`eqclient.ini` open and flushes it *on exit*, so a write landing mid-session is
overwritten anyway **and** risks a torn file — two writers, one file, and a
half-written `eqclient.ini` is a client that will not start. The three live
triggers are the running→stopped edge (+2.5s so the client's own flush lands
first), an `fs.watch` on the EQ folder, and a settings save; all three re-check
`_isEqRunning()` before touching anything.

**A no-op must not write.** An already-correct file is returned byte-identical
with `changed: false` and never rewritten — a pointless rewrite churns the
mtime and, through our own `fs.watch`, feeds straight back as another change
event. Pinned by test.

**Regex-level edits, never a parse-and-re-serialize.** We rewrite only `Width=`
and `Height=`, only inside `[VideoMode]`, preserving CRLF and every untouched
byte. We never invent the section or its keys: if the client has not written
the block there is no user choice to defend, and guessing at a file format we
only half-understand is how you brick someone's client. One-time `.mimic-bak`
(never overwritten — it is the pristine pre-Mimic copy), then tmp + rename.

**Watcher is Linux-only for now.** Windows users manage resolution in-client
and their behaviour is deliberately unchanged. The module itself is
platform-agnostic, so graduating it is a wiring change, not a rewrite.

**No launch-time trigger, because there is no launcher.** Mimic does not start
EverQuest today. The hook is documented in the module header for whoever adds
one — enforce immediately before spawning the client.

---

## Open — read this first

| Item | State |
|---|---|
| Resolution lock UI | The config key is live and readable/writable through the existing `get-config` / `save-config` IPC, but no Settings card exposes it yet — turning it on needs a hand-edited config. A Settings control (with the Deck suggestion prefilled) is the next step. |
| Resolution lock on Windows | Watcher is Linux-gated. Whether the Windows fleet wants this at all is Hitya's call — Windows users have an in-client display dialog that mostly sticks. |
| 1280×800 vs 1440×900 as the Deck suggestion | Shipped as 1280×800 (native panel) per tonight's call. quarm.guide's Bonus Step 7 recommends 1440×900, and UI Studio offers both presets — worth a second look once a Deck tester has run both. |

## Officer-assisted Mimic linking (from a member's "verify your account" wall)

> "a member wants to install but doesn't have discord auth working. we need a
> secondary access method finally, backup email with password reset and
> everything, BUT TO START a 4 character bind in mimic and then link that to
> Wolfpack.quest"

**What already existed** (found by reading, not building): the bind flow is
the mimic-link device-code dance — Mimic shows a short code, `/auth/mimic-link`
confirms it — and the bot's poll handler has accepted a **discord-only**
authorization since 2026-07-31, added for exactly this class of member. What
never existed was a writer for that shape: the only page that could stamp a
code required the member themself to complete Discord OAuth, which is the one
thing an unverified account cannot do. Such a member could chat in the guild
all day and still never pass the consent screen.

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
the actual person: they can run Mimic with their real identity TODAY; site
sign-in for OAuth-blocked members is the follow-up.

## Site access without Discord: officer invites + username/password

> "he doesn't want to install but wants site access. we need that alternative
> below the discord signin. login and pass and an invite link"

The wall is Discord demanding a phone number for OAuth consent even when the
account already has 2FA; the member is fully present in the guild — only
consent is blocked.

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
generated, claimed, and signed in the same night. The one defect the
live run exposed: the sign-in form flattened every auth error into "wrong
password", which sent diagnosis down the credentials road while the server
showed the sign-in had already succeeded — fixed in web 1.1.95 (credential
failures keep the friendly line; everything else surfaces verbatim).
Officer procedure for both no-Discord paths: `docs/RUNBOOK-site-access.md`.
Deployment-shaped choices (login domain constants, Email provider, signups
toggle, no-SMTP reset): recorded in `DESIGN-selfhost-wizard.md` §3.
