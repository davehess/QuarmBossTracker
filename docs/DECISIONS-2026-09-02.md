# Decisions — 2026-09-02

## The website checklist: four real gaps, and the rest is marketing advice

Hitya brought a "your vibe coded site is missing 20 things" checklist and asked
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

## Deliberately NOT done, and why — this is the part worth keeping

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

## Notes on the fixes that will bite later

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

## The 2.6.4 graduation, and the file it should not have touched

**A partial promotion must exclude the excluded file's TESTS too.** The Mimic
2.6.4 cut promoted beta → main file-by-file (the documented shape — beta must
never promote stale bot/web files), deliberately holding back
`web/app/globals.css` and `web/components/WolfPack.tsx`, which carry beta-only
web work still under review at b.wolfpack.quest. But it promoted
`test/wolf-eyeglow.test.js` along with everything else, and that test asserts
on the reveal ORDERING those two files implement. It failed on main, correctly.

⚠ **The fix taken at the time was to delete it — and main had owned that file
since `ee3fddd8`.** It was never beta's to promote; both branches had a valid
version of the same test, each matching its own branch's web code. Deleting it
removed 13 real assertions from main, and then produced a modify/delete
conflict on the next main→beta sync, which is the only reason it was noticed.

Restored on main as `034acd4a` (main's own copy, verbatim from `4ae5bccb`,
13/13 green). Beta keeps its own version, which adds the one ordering
assertion for the held-back reveal.

**The rule:** when a graduation's file list excludes a source file, grep for
tests that read it and exclude those too. And when a test fails after a partial
promotion, that is evidence the FILE LIST is wrong — check whether the target
branch already had its own copy before touching the test.

## Open — read this first

| Item | State |
|---|---|
| ✅ **Zeal PR #229 — MERGED** | Waiting on a tagged Zeal RELEASE, then on raiders updating. Everything our side is shipped and inert until a client sends an id |
| ⚠ **The issue #218 comment, still unposted** | `docs/upstream/zeal-spawn-id/issue-218-comment.md`; drop its stale "no Windows/MSVC setup" paragraph first |
| **`mob-info` is still name-keyed** | ✅ `target-casts` joined `target-buffs` on spawn-id-first keying (bot 3.1.113 · agent 3.6.24). `mob-info` is the last of the three |
| ⚠ **The Buffs tab has never been LOOKED at** | It ships in Mimic 2.6.4 and its logic is tested, but no session has seen it render. First raider to open it is the first visual check |
| **The API request to Moncs** | Still unsent |
| **Two local OpenDKP fixes, recommended before sending** | Gate the roster walk on a `Character Created/Updated` audit signal; make `dkpTick._resolveCharacterIds` read `characters.opendkp_id` |
| **`_logStandingsShapeOnce`** | Prints on the next raid-window standings refresh — resolves the DKP field-name question |
| **Autobid button** | Deliberately NOT shipped; needs a ceiling column that does not exist |
| **`bump_agent_upload_stat` has three overloads** | Nothing broken; drop the two stale ones once the fleet is on bot ≥3.1.107 |
| **The weekly OpenDKP sweep is TEMPORARY** | Revert to `OPENDKP_LIST_FULL_SWEEP_DAYS=0,3,4` when OpenDKP ships `since` |
| 🔴 **`encounter_threat_snapshots` retention has never run** | 920 MB / 57% of the DB, 448k rows past cutoff. Needs an index + a batched delete. Destructive — awaiting a go-ahead |
| ⚠ **Supabase Spend Cap + current egress** | Both dashboard-only, both unread |
| **Tag channel autojoin file-write** | Still blocked on one line from a real character ini |

_Carried forward from `DECISIONS-2026-09-01.md`._
