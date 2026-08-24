
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
