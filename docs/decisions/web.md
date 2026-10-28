# Website & sign-in

wolfpack.quest pages, sign-in, link previews, admin pages, the beta site. Oldest first. Find an entry by its ID in [the index](README.md); new decisions go in `inbox/` and are merged here.

## 2026-08-24/1 — Officer-assisted Mimic linking (from a member's "verify your account" wall)
*2026-08-24 · DECISIONS-2026-08-24.md · Officer-assisted Mimic linking without Discord*

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

## 2026-08-24/2 — Site access without Discord: officer invites + username/password
*2026-08-24 · DECISIONS-2026-08-24.md · Site access via officer invite and password*

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

## 2026-09-02/1 — The website checklist: four real gaps, and the rest is marketing advice
*2026-09-02 · DECISIONS-2026-09-02.md · Website checklist audit: four real gaps*

The guild lead brought a "your vibe coded site is missing 20 things" checklist and asked
what we have, what we lack, and what matters. Audited against the real `web/`.

**Had already:** custom 404, CTA above the fold, alt text on **12 of 12** real
`<img>` tags, 418 responsive utilities, form error states, privacy policy.

**Genuinely missing and now fixed (web 1.7.9):**

1. **The favicon was BROKEN, not absent** — `layout.tsx` declared
   `icons: { icon: '/favicon.ico' }` against a file nobody ever committed. Every
   tab rendered the blank default, silently, for as long as that line has existed.
   A missing favicon errors nowhere, which is exactly why it survived.
2. **No Open Graph image at all.** The single highest-value item on the list *for
   this site*, and not for the reason the video gives. **Discord is the guild's
   distribution channel** — people paste `/parses/<id>` links all day, and every
   one of them unfurled as a bare title with the same generic description.
3. **Per-page metadata on 16 of 84 pages**, so 68 shared links read identically.
4. **One loading boundary across 84 Supabase-backed routes, and zero error
   boundaries.** A throw in a server component dropped a raider onto Next's raw
   error screen.

## 2026-09-02/2 — Deliberately NOT done, and why — this is the part worth keeping
*2026-09-02 · DECISIONS-2026-09-02.md · Checklist items deliberately skipped for members site*

The checklist is written for a public marketing site. **wolfpack.quest is a
member-gated guild tool behind Discord OAuth**, which inverts several items. Doing
them anyway would make the site worse, not better:

- **Cookie banner — actively wrong for us.** We run no analytics and set no
  tracking cookies. The only cookie is the Supabase auth session, which is
  strictly necessary and exempt under GDPR/ePrivacy. A banner would be pure
  cargo cult and would put a dismissal click in front of every raider.
- **robots.txt / sitemap.xml** — the surface is gated. A sitemap of pages that
  redirect to sign-in is noise, and there is no SEO goal. (The beta mirror is
  already deliberately `noindex`.)
- **Analytics** — costs egress on the meter that actually bills us, and
  installing it is what would *create* the cookie-banner obligation we currently
  do not have. `agent_upload_stats` is better telemetry than a page-view counter.
- **Terms page** — nothing is sold and there is no commercial relationship.
  Privacy matters because we handle log data; terms do not follow from that.
- **Sticky mobile CTA** — the CTA is "sign in", which members do once.
- **Thank-you page** — the inline confirmation on the feedback form is better UX
  than a redirect.

⚠ **The general lesson, which is why this is written down:** a checklist aimed at
a different kind of site will look authoritative and will be about 60% wrong for
ours. Ask what each item is *for* before adopting it. Two of these (the cookie
banner, analytics) would have cost us something real.

## 2026-09-02/3 — Notes on the fixes that will bite later
*2026-09-02 · DECISIONS-2026-09-02.md · Icon and share-image gotchas for later*

- ⚠ **Never re-add an `icons:` key to `layout.tsx` metadata.** It OVERRIDES
  `app/icon.png` / `app/apple-icon.png`, which is precisely how the dangling
  `/favicon.ico` reference survived being obviously wrong.
- ⚠ **`opengraph-image.tsx` runs on the nodejs runtime and inlines the mark as a
  data URI.** `ImageResponse` cannot fetch `/public` by path — there is no origin
  at build time — and `<img src="/mimic-logo.png">` there renders as *nothing*,
  silently. Same failure class as the favicon.
- ⚠ **`error.tsx` must never print `error.message`.** These pages read Supabase
  with the service role, and a thrown Postgres error can carry table and column
  names into its message. The digest is the safe handle and is what Vercel logs.
- `generateMetadata` on `/parses/[id]` runs its **own narrow query** rather than
  reusing `load()`, which pulls the full encounter with every player row.
  Supabase calls are not request-deduped the way `fetch()` is, so reusing it
  would double the heaviest read on the site to produce a string. Both
  generateMetadata functions fail soft: an unfurl is never worth a 500.

## §2 — Also today
*2026-09-21 · DECISIONS-2026-09-21.md · Nav menu clipping and review column fixes*

- **Web 1.7.44** — the top nav's category menus were clipped out of existence on
  the full-width bar (`overflow-hidden` on the header row vs Nav's `absolute
  top-full` panel); fixed with `overflow-x-clip`, which was measured in Chromium
  to leave the fold's `scrollWidth` reading identical. Review-page time columns
  went `w-14` → `w-16` (measured: `10:47 PM` is 57.8px against 56px). The agents
  page now always lists the two most recent stables, which a fast beta line had
  pushed off the list entirely.
- **Agent 3.6.48** (`beta`, `v2.6.9-beta.10`, installer verified attached) — the
  crash review's driver-churn verdict now prints the dgVoodoo2 URL, both
  filenames and the destination. A member lost an evening hunting the Zeal repo
  for files that were never in it.
- **`eqgame.exe` @ `0x004E138A` identified** as the client failing to survive a
  graphics-driver reset — see `RUNBOOK-client-crash-triage.md`.

## §47 — /about gets pictures: two layouts on beta (2026-09-26)
*2026-09-26 · DECISIONS-2026-09-21.md · About page gets pictures, two layouts*

**The guild lead:** *"https://wolfpack.quest/about could use some updating, possibly some generated
images and assets so it's not just blocks of text"*.

**What "generated" could honestly mean here:** there is no image model in a session. So the
pictures are made from the platform itself:
- figures drawn in the overlays' own look: the boss board, a log line being filtered on your PC,
  a merged parse card, the follow-you log folder, a raid night's ticks and bid windows, and the
  week's deploy freeze;
- a real render of the Melody Dirge board;
- ten of the Zeal tag marks;
- the landing page's wolf.
Every name in them is from the invented set, because /about is public and gets shared outside the
guild.

**Two layouts, beta `f2db9423`** (with no `?v=` the page is still the old one):
- **B, `b.wolfpack.quest/about?v=b` (Illustrated):** the story as it was, each chapter opening
  with its picture.
- **C, `b.wolfpack.quest/about?v=c` (Tour):** pictures first with one line each, and the long
  text folded under "The long version".

**Facts refreshed in both:** "five months" (was "six weeks"), 4,000+ tests in 290+ files (was
1,372 in 84), 240-odd migrations (was 189), and an eighth chapter for Zeal marks and PvP fights.
The old page still carries the stale numbers until one layout graduates.

**Next:** the guild lead picks B or C. It then graduates to main, the other layout and the old page
are deleted, and the roadmap gets an entry.

## §134 — The website stops saying PoP is locked; stable Mimic 2.7.7 (2026-10-02, web 1.8.80 · Mimic 2.7.7 · agent 3.7.71)
*2026-10-02 · DECISIONS-2026-09-21.md · Site drops PoP lock, stable 2.7.7*

The guild lead: *"go through the site and remove all the locks from pop release, or mentions of things not
being available yet. please roll out a fresh stable release"*.

- **The PoP sweep (web).**
  - Raid guide index and boss pages: the date lock (`POP_UNLOCK_MS`), the 🔒 and the "locked until
    2026-10-01" banner are gone. They had stopped rendering on Oct 1; this removes the dead code.
  - /pop: the "(Preview)" title and badge are gone, and the empty state no longer says "PoP unlocks
    2026-10-01".
  - Missing spells: PoP spells are no longer greyed out or labelled "locked until Oct 1, don't chase it
    yet". The count reads "PoP"; the PoP pill stays as a label.
  - Gear: PoP AAs join "Available to train"; the "+N more arrive with PoP (locked until Oct 1)" line is
    gone.
  - The bot-board runbook text and two comments updated.
  - Left as they are, on purpose: roadmap entries (they are history), dated incident notes, the lockouts
    page (raid lockouts, not PoP), and the bot's own `isPopLocked`, which is date-based and has done
    nothing since Oct 1.
- **Stable Mimic 2.7.7, agent 3.7.71.** File-level promotion from beta `b5684da0`:
  - `apps/mimic/` and `packages/wolfpack-logsync/` byte-identical to beta, plus their tests.
  - **Not promoted:** the website previews still on beta for the guild lead's pick — the about page,
    the PoP guide redesign, the Essences queue, /who flags, PvP fights, tradeskills, Zeal icons — and
    their nine tests. `test/pop-planner-mains-alts.test.js` keeps main's version.
  - Gate on the promoted tree: 384 test files, 5,118 tests, lint, the dashboard check, golden logs.
  - Carries everything since 2.7.6 (agent 3.7.55–3.7.71). That includes the §133 update fix, so updating
    2.7.6 → 2.7.7 is the first update that starts quietly in the tray while EverQuest is open.
  - Repeats FB-46, FB-49 and FB-50 so the bot marks them implemented.
  - Beta re-parks at 2.7.8.
- **The website deploy was skipped once, and why.** The sweep (web 1.8.79, `aab72c65`) and the stable
  commit (`7dcba505`) went up in one push. Vercel builds only the push's last commit, and its Ignored
  Build Step (`git diff --quiet HEAD^ HEAD -- .`) saw no `web/` change in that last commit, so it
  skipped the build and the sweep never deployed. Fixed by web 1.8.80 on top. Rule added to
  CLAUDE.md: a push whose last commit does not touch `web/` deploys nothing for the website, even if
  an earlier commit in the same push did.

## §154 — /fun crash card: a /quit can be forgiven, and only real raid nights count (2026-10-04, web beta preview)
*2026-10-04 · DECISIONS-2026-09-21.md · Fun crash card forgives quits*

The guild lead: *"since this is a fun item, Peopleslayer should be able to override Linkdeaths if he used /quit
or /q to leave the game. it looks like a crash but it happens much faster"*, then *"also last night wasn't a
real raid"*. The card showed "1 raid since", counting a Saturday group night.

- **Why it has to be manual:**
  - The LD comes from other raiders' logs ("<name> has gone Linkdead.").
  - A /quit drops the connection exactly like a crash, so no log can tell them apart.
- **Override:**
  - "It was a /quit" sits next to the card's Last LD line, drawn only for the Discord account that owns
    the character or an officer (`isOfficer`).
  - The server action re-checks that, and refuses if the LD on screen is not the one it would mark.
  - It merges `{quit, by, at}` into `fun_events.detail` on every row within ±2 minutes, since several
    raiders upload the same LD. No migration.
  - A row arriving later within 2 minutes of a marked one is forgiven too.
  - Forgiven LDs drop out of last LD, raids-since, the record and the lifetime count. The card says
    "N /quit forgiven", and "Undo /quit" takes it back.
- **Raid nights:**
  - "Raids since" and the record now count `raid_nights` dates he took part in. That table holds all 228
    raid nights since 2025-01, all Sun/Wed/Thu, written by the bot at the first fight of each raid.
  - An encounter maps to the Eastern date of (start − 5 h).
  - The two old encounter queries were silently capped at 1,000 rows; he has 1,739. Now `selectAll`.
- **Display:** the card stays up top at 0 ("0 raids since" is the joke), not in "Quiet for now".
- **On today's data:**
  - Unmarked, the card reads 0. The Oct 3 LD stands, and no raid night since.
  - Once the Oct 3 LD is marked a /quit, it reads 3 (Sep 24, Sep 27, Oct 1) since the Sep 14 LD.
- Files: `web/lib/funLd.ts` (rules), `web/lib/funLdAuth.ts` (gate), `web/lib/funLdRaids.ts`,
  `web/app/fun/actions.ts`, `QuitButton.tsx`. Test: `test/fun-ld-quit.test.js`.
- **Ruling, same day:** *"Saturday wasn't a raid, so it doesn't count. it should only happen during actual
  raids and ours doesn't happen next until Oct 14th. promote it"*. Live in **web 1.8.93**.
  - **A raid is an OpenDKP raid the officers logged** (`opendkp_raids`, date = the UTC date of its
    noon-UTC `ts`). It is not a `raid_nights` row.
  - **He attended it** when his name is in one of its `opendkp_ticks`.
  - **An LD counts only during a raid:** its night (the Eastern date of ts − 5 h) is a raid date, and it
    happened 19:00–05:00 ET.
  - On today's data, 2 of 15 LDs count, both Fri Jan 16 2026 around 20:15 ET. Raids since: 63 (stays
    there until the next raid). Lifetime: 2.
  - Next guild raid: **2026-10-14** (the guild lead).
- **Found on the way, not fixed (follow-up, in the open-items table):** `raid_nights` is not a record of real raids.
  - `linkEncounterToRaidNight` opens a row for any encounter on Sun/Wed/Thu after 20:30 ET.
  - Since mid-August it holds every Wednesday and Oct 1, with no raid, and misses the off-schedule raids
    (Sat 8/22, Tue 9/1).
  - Anything that reads `raid_nights` or `encounters.raid_night_id` as "a raid" inherits that. Until
    Oct 14, any group night on Sun/Wed/Thu adds a false one.

## §168 — The site's instruction text, swept: 130 blocks nobody reads first (2026-10-06)
*2026-10-06 · DECISIONS-2026-09-21.md · Site instruction text swept*

The guild lead: *"send lower level agents through the entirety of our site and find large instruction monologues
that nobody will read, or if they will it'll be when they have a question."*

- **Swept:** 11 Haiku agents read all 96 routes and the shared components; Sonnet verified every finding (51
  dropped) and wrote a one-line replacement for each. Full ranked list, repeats and appendix:
  `docs/AUDIT-site-monologues-2026-10-06.md`.
- **Found:** 130 blocks, ~9,900 words, ~8,900 of them on screen by default. Worst pages: `/admin` (825, the card
  menu), `/admin/overlays` (682), `/pop` (533), then `/raid` and `/roadmap`. 13 explanations are written on several
  pages ("blank means unseen", "how your data gets here", "install Mimic", privacy, "how fast a change applies"),
  and one copy is already wrong: `/admin/triggers` says agents poll every 10 minutes; it is 2.
- **Out of date or wrong (fix whatever the pick):** among them a Raid-Helper pitch for an API already live,
  `/admin/voice` asking officers to enable two triggers deliberately turned off, empty states blaming bot
  v2.5.35, "Loot lockouts" as a title, and a member named in rendered text on `/admin/overlays`.
- **Waiting on the guild lead:** A, fold in place (each explanation stays beside what it explains, closed behind
  "How this works" or an ⓘ, repeats become shared components), recommended; or B, one help drawer per page. Both
  are changes to existing pages, so the pick is built as beta variants first.

## §215 — Every page unfurls with its own name and summary: a standing rule, and the Discord card was never reading the page (2026-10-10, web)
*2026-10-10 · DECISIONS-2026-09-21.md · Every page unfurls with own name*

**The ask** (the guild lead, looking at Discord's card for `https://wolfpack.quest/feedback/FB-71`, which was the site-wide
"Guild-wide build planner…" card): *"discord embedded links for the feedback links are generic. all links from our site
should include at least top level information and the page name. make it a rule"*.
- **The rule** is in `CLAUDE.md` ("every page unfurls with its own name and summary") and is enforced by
  `test/page-metadata.test.js`, which walks every `web/app/**/page.tsx`.
- **The finding that changed the fix:** Discord never reads a page's `metadata`. The middleware rewrites every preview
  crawler to `/api/embed-meta`, which serves `metaForPath()` in `web/lib/pageMeta.ts` (crawlers cannot sign in, and the
  pages redirect to sign-in). Confirmed on a local dev server: a bot user agent gets the rewrite, any other anonymous
  request gets a 307 to `/auth/signin`. So a route missing from `pageMeta.ts` unfurls as the site card whatever its page
  exports. FB-71 was missing; so were dozens of other routes (every admin page shared one "Officer Tools" card).
- **Built (web 1.8.135; 1.8.133 and 1.8.134 are taken on `beta`):**
  - `pageMeta.ts` gets an entry or a pattern for every route, plus pure builders (`feedbackMeta`, `entityMeta`,
    `characterMeta`, `pvpMeta`, `raidReviewMeta`) and `lookupFor()` naming the routes that need one read.
  - `pageMetaData.ts` (new) does those reads, one small select each, and `/api/embed-meta` and every dynamic page's
    `generateMetadata` both call it, so the Discord card and the browser tab cannot disagree.
  - Every page exports `metadata` (title + one sentence) or, for a dynamic route, `generateMetadata`. The admin layout
    carries `robots: noindex` once for all officer pages.
  - The root layout no longer pins `openGraph.title`, `description` or `url`. Next fills an empty OG title/description
    from the page, but a pinned root value wins over the page's, so every OG/twitter title read "WolfPack.quest" (measured
    on `/roadmap` before and after: og:title "WolfPack.quest" -> "Roadmap — Wolf Pack EQ · WolfPack.quest").
- **Privacy calls (the crawler is anonymous, so a card carries only what a signed-out visitor could see):**
  - `/feedback/FB-n`: `[beta] FB-71 · Bug report · Seen`. Selects `ref, category, status` only; the category and status go
    through closed vocabularies, so no raw string reaches the card. Never the message, submitter, notes, replies or log.
    The `[beta]` tag stays while the page wears NewPageTag.
  - Items, spells, NPCs, factions, recipes, bosses and raid guides: the catalog name and the kind (`Ragebringer · Item`),
    one `name` column. Game data, not guild data, though the pages behind them need sign-in. The description is the
    kind's sentence, never stats or drops.
  - Characters and PvP records: the name comes from the URL alone, no database read, so a hidden or stats-excluded
    character leaks nothing the link did not already say and a made-up name is not confirmed to exist.
  - **Parses stay "Parse Breakdown"** on the card. The page's own tab title names the boss, night and DPS, but that is
    guild data a signed-out visitor cannot see. The guild lead can overrule this; parse ids are UUIDs, not enumerable.
- **Not verified:** the live Vercel rewrite. On a local dev server the rewrite's query string is ignored by the route (the
  original query wins), so `/api/embed-meta` was checked by calling it directly with `?path=`. The middleware does emit the
  right rewrite header. It has served per-page cards on production since July, so this is a dev-server quirk, but nobody
  has re-checked a production card after this change; Discord caches per URL, so test with a fresh link.
- **Open:** a `?v=` variant URL or a trailing query is dropped from the card path (the middleware passes the pathname only).

## §252 — Member lockout: officers pause a member out of our tools whatever their Discord roles (2026-10-13, bot 3.1.251, web 1.8.143)
*2026-10-13 · DECISIONS-2026-09-21.md · Officer page to lock members out of tools*

- **The ask** (the guild lead): *"I need an admin page to lock out members despite discord roles and invalidate mimic
  sessions."* Picked **A** (a lock switch an officer sets and lifts) over B (also follow Discord departures
  automatically) and C (a revoke button only): *"A seems the most straightforward."*
- **Shipped:** `member_lockouts` (one row per locked member, optional end date; migration `20261013030000`, applied).
  `/admin/access` [beta] locks and unlocks, revokes the member's Mimic sessions and logs both to `audit_log`. The bot
  (20 s refresh) refuses their Mimic token, new Mimic links and every Discord command or button; the website signs
  them out and refuses sign-in. Discord roles and channels are untouched; their data stays. Map in `HOW-ITS-BUILT.md`
  (Identity & auth).
- **Rules set:** officers only; nobody can lock themselves; a reason is required. **Officers cannot be locked out**
  (the guild lead, same day: *"officers can't lock out other officers"*; web 1.8.144): the picker leaves anyone with
  an officer role out, and `lockMember` refuses one before writing. Officer = `OFFICER_ROLE_NAMES` on the member's
  synced `role_names` (`roleNamesAreOfficer` in `web/lib/officer.ts`), so a member promoted in Discord is protected
  from the next member sync (6 h) or their next sign-in. A lock that already stands is not lifted by a promotion.
- **Not done:** Mimic still shows nothing when its token is refused (it just stops uploading quietly), so a locked
  member sees "paused" only on the website and in Discord. A Mimic-side "you have been signed out" message is a beta
  follow-up. Option B (departures lock automatically) stays open.
- **Officer brief** (for the officers, kept outside the repo): a claude.ai doc, "Member lockout — officer brief".
- Security findings made while scoping this went to the private briefing, not here.

## §414 — Officer actions are stored under the Discord name, never an email address (2026-10-23, web 2.1.2 main)
*2026-10-23 · DECISIONS-2026-09-21.md · Officer actions stored under Discord name*

*"Needs to remove email from this and instead do username"* (a parse page read "marked by <address>"). `web/lib/actorName.ts`:
`actorName` writes, `shownActor` hides an address or account id left in an old row; the 33 stored fight marks were rewritten to
names. Six other pages still write an address as the actor (attendance, encounters admin, triggers, raid plan, who, spell notes):
the sweep is the guild lead's pick (A recommended).

## §426 — First sign-in: pick your characters from the logs, stage a recruit main, offer the spellbook / inventory / Quarmy upload (2026-10-24, DRAFT)
*2026-10-24 · DECISIONS-2026-09-21.md · First sign-in character pick and recruit staging*

The guild lead: *"[a new member] had to create his account on opendkp before he could log in. we should check for the discord role
and let them in, then prestage as a new recruit main. but also ask if they want to upload their spellbook and inventory now"*, then
*"We should be asking what characters the player would like to upload (from their logs). If none show up, they can type in their
character name to get started. A lot of things won't work without logs. And we should ask about grabbing an upload of their
quarmy/spellbook/inventory if it shows up."*
- **What went wrong that day:** a new member's `characters` row existed with NULL class, rank, main_name and discord_id. Every
  ownership check (`ownsOrOfficer` in `web/app/me/spellbook-actions.ts`) said "not your character", the PoP spell view
  (`pop_spell_needs`, which joins `characters.class`) showed nothing, and Mimic's Voice tab refused the name pronunciation. The
  spellbook had uploaded fine (it needs no characters row). An officer fixed it with a hand UPDATE. The site sign-in itself already
  admits by Discord role (`web/app/auth/callback/route.ts`, `ALLOWED_ROLE_NAMES`) and was not touched.
- **The call:** a signed-in Mimic whose account has NO linked character shows a one-time **"Your characters"** card on the
  dashboard: every `eqlog_<Name>_pq.proj.txt` in the EQ folder (newest first, with the log's date and size, so a main reads apart from
  a forgotten alt), a tick each, a "this is my main" radio, the newest pre-ticked and pre-selected. No logs: it says why and offers a
  box to type a name. "Also found: <Name>-Spellbook.txt, <Name>-Inventory.txt, Quarmy export" with **Save** and **Save and upload
  these now** (the second runs the SAME three export scans the timers run, limited to the staged names, with every gate they keep:
  raid hold, privacy prefs known, exclusions, checksums). Saving or "Not now" is remembered in the opt-in file and the card never
  returns.
- **Bot: `POST /api/agent/characters/stage`** (`utils/recruitStage.js`). Per name, on the `characters` row only: `discord_id` set only
  where NULL; `rank` = Recruit for the main, Non-raid Alt for the rest, only while empty; `main_name` = the main (the main points at
  itself, as the OpenDKP sync writes a family root); `class` from Discord only when the roles name exactly one EQ class, and for the
  MAIN only (an alt's class cannot be read off a role); `registered_via_web_at` / `_by_discord_id` stamped once. Owned by another
  Discord id -> `conflicts` (`owned_by_another`), untouched. Nothing is created in OpenDKP. Re-saving writes nothing.
- **The signal to show the card (no new read route):** the existing `GET /api/agent/character-prefs?mine=1` (Mimic's onboarding
  already calls it). Empty `characters` = nothing linked = show. It is also the smaller change: no bot edit for the read half.
- **Judgement calls to confirm (the draft made them; any is a one-line change):**
  1. A character that is unowned but already has an `opendkp_id` is a conflict (`in_opendkp_unclaimed`), not claimable. The brief said
     "only where discord_id is NULL"; without this, any signed-in member could take a roster main by typing its name. Those go
     through the existing claim flow.
  2. If the main conflicts, its alts are staged with no `main_name` rather than under someone else's family.
  3. The second button is labelled "Save and upload these now" (the card has one Save; uploading needs the save first).
- **⚠ Officer visibility gap, NOT fixed here (web, out of this draft's scope):** the audit pair is stamped, but a staged row will not
  appear in either `/admin/links` queue in `web/lib/admin-queue.ts`. "Not in OpenDKP" lists only names with NO `characters` row, and
  "Registered, awaiting OpenDKP claim" requires `discord_id IS NULL`; a staged recruit has a row AND a discord_id. An officer finds it
  under `/admin/links?show=linked`. A fix is a small web change (list `registered_via_web_at` rows with `opendkp_id IS NULL`).
- **Where it landed (shipped the same night):** bot 4.0.13 on `main` (`utils/recruitStage.js`, the route in `index.js`;
  `test/recruit-stage.test.js`), agent 4.0.21 on `beta` (`packages/wolfpack-logsync/index.js` + `dashboard.html`;
  `test/recruit-card-agent.test.js`), and web 2.1.23 on `main` adds the `/admin/links` queue "Staged by their owner, not in
  OpenDKP yet" (`test/admin-links-staged.test.js`), which closes the gap above. The bot half went first; the card's Save needs it.
  The report that prompted it was closed as implemented by the bot commit. Still open: a rank-aware Register button on that
  queue (the shared row offers Raid Alt / Trader only); the officer queue in `web/lib/admin-queue.ts` still has no staged state.
- **The member who hit it** was fixed by hand first (class from the Discord class role, rank Recruit, main = self, Discord id
  linked); the spellbook had uploaded all along.
