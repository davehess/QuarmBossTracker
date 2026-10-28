# Working rules & process

How sessions work, branches and releases, docs rules, tooling assessed. Oldest first. Find an entry by its ID in [the index](README.md); new decisions go in `inbox/` and are merged here.

## 2026-08-07/3 — Releases / process
*2026-08-07 · DECISIONS-2026-08-07.md · Release text written for members, not git log*

**Release-visible text is member-facing, not a git log.** Bullet every
user-facing item, one line each, never a prose paragraph. No technical jargon —
EverQuest mechanics (rampage, DA, slow, CH chain, mez) are fine; code
identifiers are not. Applies to graduation commit bodies (the announcer reposts
them verbatim), `roadmapData.ts`, and any Discord-facing changelog.
→ folded into `CLAUDE.md`.

**The guild lead authors almost all triggers**, until the system is as granular as
EQLogParser. So the officer "authoring floor" question is moot — build trigger
features against the newest shape rather than the oldest deployed Mimic.

**A graduation push must put the Mimic version bump in the LAST commit.**
`release-mimic.yml` diffs `HEAD` vs `HEAD~1`; a docs commit landing after the
bump makes it no-op with a green check. Cost us the v2.3.3 stable build, which
had to be recovered by `workflow_dispatch`.

## 2026-08-07/9 — pq-companion
*2026-08-07 · DECISIONS-2026-08-07.md · Study other project, reimplement, never copy*

**Study and reimplement; never copy.** The repo has no license — all rights
reserved. Five analyses live in `docs/pq-companion/`, and five agent fixes
shipped from them (3.5.44–3.5.48).

---

## 2026-08-07/8 — Branches — beta stops drifting (2026-08-09)
*2026-08-09 · DECISIONS-2026-08-07.md · Beta is main plus Mimic park, re-synced*

**`beta` is `main` + the Mimic park, re-synced after every graduation.** Audited
the divergence: 420 files differed outside Mimic/agent and **416 were pure
staleness** — main ahead, beta never updated. Only four carried beta-only
commits, and three of those (`CLAUDE.md`, `package.json`, `package-lock.json`)
held nothing but obsolete text. The five beta-only files were pre-move copies of
docs `main` had archived plus one deliberately-deleted deprecated command.

So **nothing on `beta` would have broken `main`** — the danger ran the other
way. Re-synced rather than reconciled, because there was nothing to reconcile.
Procedure + rationale now in `CLAUDE.md` → Branches.

**Force-pushing `beta` is safe specifically because release tags anchor the
history.** Every beta build cut a tag (`v2.3.4-beta.1` … `v2.3.5-beta.1`)
pointing at its commit, so the discarded branch history stays reachable. Verify
that before any future force-push; it is what makes this reversible.

**Version call: the graduation shipped as 2.3.4, not 2.4.0** (the guild lead). The park
IS the line's target — cut stable at whatever the line was parked at rather than
re-deriving a number from how big the feature set feels.

**No bot beta — that one never existed.** Railway has ONE project, ONE
environment (`production`), ONE service, `source.branch = main`. Checked rather
than assumed. Nothing to remove.

**The web beta became `b.wolfpack.quest`** (the guild lead, same session). First pass
disabled beta web builds entirely on "we don't run either component
separately"; the guild lead then asked for the better version — *put a `b.` in front of
any page to see the beta of it, with a beta tag at the top*. So the build is
back ON and now has a real address instead of an unguessable preview URL.
Superseded within the hour; the interesting part is WHY the first answer was
wrong. Vercel was already building beta — the waste was not the build, it was
that the output was unreachable. Turning the build off removed a capability;
naming it turned the same build into a review tool.

Verified by building the app both ways rather than reasoning about it: the
production build renders no banner in any prerendered HTML, and the beta build
renders the banner, `robots: noindex, nofollow`, and a "(beta)" title. Then
confirmed against the LIVE beta deployment, which returns
`WolfPack.quest (beta)`, `noindex, nofollow`, the banner, and a path-preserving
link home. The banner component is ~700 bytes of the 17.5 KB layout chunk on
production, where it is bundled but never rendered — accepted rather than
engineered around.

**No Porkbun integration exists, and a cloud session cannot create the DNS
record.** Checked all three routes: no MCP connector in the registry, no
credentials in the repo, and `api.porkbun.com` is refused by the egress proxy
(`CONNECT tunnel failed, 403`) — so even handed API keys this could not be done
from here. DNS-over-HTTPS is blocked too, so a cloud session cannot even READ
the zone to confirm which registrar serves it. Adding `b.wolfpack.quest` in
Vercel → Domains is a human step (or a local session); the Vercel UI reports
whether a registrar record is needed at all.

⚠ Possible pre-existing gap, spotted while reading the Vercel project:
`mimic.wolfpack.quest` has redirect rules in BOTH `vercel.json` and
`next.config.js`, but it is **not in the project's domain list** while `parser.`
and `discord.` are. If it is genuinely unattached that redirect can never fire.
NOT confirmed — the proxy blocks outbound to every host, so the reachability
test returned the same result for a domain that IS attached. Check from a
browser.

⚠ `web/vercel.json` is **strict-schema** — Vercel rejects unknown properties, so
a `comment` key would break production web deploys. Explain in docs, never in
that file.

⚠ **PR #78 is now a live hazard.** It is a `beta`→`main` PR whose diff, post
resync, is exactly one line: the Mimic version park. Merging it would set
`main`'s Mimic to 2.3.5 and cut an unintended stable release. A standing
beta→main PR has no informational value now that beta *is* main.

## 2026-08-10/3 — RULE: when `main` gets something, `beta` gets it too
*2026-08-10 · DECISIONS-2026-08-10.md · Main automatically syncs into beta*

**The call (guild lead, 2026-08-10):** beta must track main continuously, not be
re-synced at graduations.

**Why.** Re-syncing by hand was already the documented practice and it still did
not work, because a re-sync is a snapshot rather than a link. Measured: the
2026-08-09 re-sync landed 02:05 UTC, main took 50 more commits over the next day
and a half, and by the next graduation beta was 7,714 deletions behind — three
test files and a whole `/about` page main had gained *after* the snapshot.
Nothing on beta was deleted; main moved forward, at 12–42 commits/day, because
bot, web and docs all land there. Any rule that depends on remembering loses to
that rate.

**Where it landed.** `.github/workflows/sync-beta.yml` — merges main into beta on
every push to main, serialised so two quick pushes cannot race. Rule + rationale
in `CLAUDE.md` → Branches.

- The two deliberately-ahead version files keep beta's side on conflict: the
  Mimic park (`apps/mimic/package.json`) and the in-flight agent version. A park
  at or below stable would tag prereleases sorting BELOW it and the updater would
  stop offering betas.
- Any other conflict **fails loudly** instead of auto-resolving — that means the
  branches diverged on shared code, and silently picking a side loses work.
- Pushes with `GITHUB_TOKEN`, which by design does not trigger `on: push`
  workflows: no spurious `-beta.N` (the release feed caps at 10 and filling it
  once broke beta updates fleet-wide), no duplicate CI. If anyone swaps it for a
  PAT, add a `[sync]` guard to `release-mimic.yml` in the same change.

**What it does NOT change.** A `beta → main` branch merge is still unsafe: beta
carries the park and in-flight Mimic work, so graduations remain file-level
promotions. The sync removes the drift, not the direction.

**Verified on the first run** (2026-08-10): beta contains all of main, the park
held at 2.3.6 against the 2.3.5 stable, and the files that previously showed as
deletions are present on beta.

## 2026-08-10/5 — RULE: shipping updates the docs at both gates (2026-08-11)
*2026-08-11 · DECISIONS-2026-08-10.md · Update docs at both beta and main gates*

**The call (the guild lead):** *"implementation of a feature or fix must update that
documentation once it graduates to beta, and upon shipping to main it needs to
be updated again with the stable release version."*

**Why:** the 2026-08-11 `/recall` run reported #202 (clock offset at ingest) as
"blocked on the call" — it had shipped in bot 3.1.20 and was extended twice
since. The ledger lagged the code by weeks, and a stale ledger produces
confidently wrong answers for every future session. Landed in `CLAUDE.md`
(Release playbook, above the commit conventions) and as the standing note in
`STATUS.md`'s 2026-08-10→11 section.

## 2026-08-10/14 — Automation that fails where nobody looks (2026-08-12)
*2026-08-12 · DECISIONS-2026-08-10.md · Failed automation needs a visible notification*

`sync-beta` failed on EVERY push for eight consecutive commits and beta sat eight
hours stale — the precise rot the workflow was built to prevent. It behaved
correctly the whole time: it refused to auto-resolve and it left a red X. The
failure was that a red X in the Actions tab is not a notification.

Three fixes, in order of durability: `.gitattributes` sets `merge=union` on the
append-only ledgers (`docs/DECISIONS-*.md`, `docs/STATUS.md`) so the cause cannot
recur — both branches only append, so keeping both sides is always right, and it
is scoped away from code and CLAUDE.md where a conflict is real information;
beta was re-merged by hand with both sides kept; and the workflow now posts to
Discord on failure, gated on a `DISCORD_SYNC_WEBHOOK` secret so forks and
self-hosters do not fail on a missing one.

The general rule this bought: **automation that reports failure only where nobody
looks is indistinguishable from automation that does not run.** Applies equally
to the mirror's autodeploy poller and the nightly backup — both already log, and
both need somewhere the log is actually read.

## 2026-08-10/19 — Anthropic's frontend-design skill, adapted; web-artifacts-builder declined (2026-08-12)
*2026-08-12 · DECISIONS-2026-08-10.md · Adapt frontend-design skill; decline artifacts builder*

Read both upstream skills. **frontend-design is installed** as a project skill at
`.claude/skills/frontend-design/SKILL.md` — not copied verbatim but adapted,
because its own central instruction is "make choices specific to the brief" and
this brief already has answers. It now carries the platform's real tokens
(verified by grep across all four surfaces, not invented) plus the constraints
generic design advice cannot know: overlays are read in peripheral vision mid-
fight, so motion is a cost rather than a delight, screen centre is reserved,
density beats whitespace, and colour is semantic. It also carries the hard rules
that break builds — wpKeep on every `<details>`, byte-stable section HTML, the
`WEB_HTML` escape hazard, the overlay parity checklist.

**web-artifacts-builder is NOT installed.** Its stack is React + Vite + Parcel +
shadcn bundled to a single `bundle.html` for claude.ai artifacts. Nothing here
is that shape: `web/` is Next.js with its own component set, and the Mimic
overlays are deliberately dependency-free single files with byte-stability and
escape-layer constraints that a bundler would fight. Installing it would invite
a rewrite whose risk is entirely on the raid-night surfaces. Its one genuinely
portable idea — the anti-generic guardrail (no purple gradients, no uniform
rounded corners, no Inter, no reflexive centering) — is folded into the design
skill instead.

Recorded surfacing an honest open question rather than acting on it: the palette
is essentially GitHub Primer dark, so the identity comes from a developer tool
rather than from EverQuest. That may still be correct — the audience reads parse
tables and it matches the agent dashboard — but it is a guild-lead call, not a
refactor to slip into an unrelated change.

## 2026-08-14/12 — Agent-Reach evaluated for blocked sources — NO for cloud, marginal for local
*2026-08-14 · DECISIONS-2026-08-14.md · Agent-Reach tool evaluated, not adopted*

**The question (the guild lead).** Would `github.com/Panniantong/Agent-Reach` let us read
sources our cloud sessions can't reach?

**What it is.** MIT-licensed CLI that routes "read this URL / platform" through a
set of per-platform backends: **Jina Reader** (`r.jina.ai`) for web pages,
**Exa** (`api.exa.ai`) for search, `yt-dlp` for YouTube, `gh` for GitHub,
`feedparser` for RSS, and browser automation that **reuses the desktop's
already-logged-in Chrome** for Twitter/Reddit/Instagram/Xiaohongshu. It makes
**no claim** to defeat Cloudflare, bot detection or IP blocking — the README
warns the opposite, that cookie-driven platform access risks account bans and
recommends throwaway accounts.

**Measured from a cloud session, which settles it:**

| host | result |
|---|---|
| `r.jina.ai` (its web-page backend) | `CONNECT tunnel failed, 403` |
| `api.exa.ai` (its search backend) | `CONNECT tunnel failed, 403` |
| `pqdi.cc` / `eqemulator.org` / `quarm.guide` | `CONNECT tunnel failed, 403` |
| `api.github.com` | 403 |
| `raw.githubusercontent.com` | 200 |

**Its backends are behind the same wall as the sources.** Our blocks are the
environment's own egress policy, applied at the proxy — not site-side
anti-scraping. A tool that "reaches more of the internet" still needs egress to
reach it, so on a cloud box it fails at the same hop the direct fetch does.
Routing around that proxy is not on the table either: it is a control of the
execution environment, not a site's bot rule.

**And even unblocked it would not fix our actual list:**
- **PQDI** 403s cloud IPs *at the site*. Jina Reader fetches from a datacenter
  IP too, so it would very likely draw the same 403 — swapping one cloud IP for
  another is not a fix. Running it locally is, which is what we already do.
- **`api.porkbun.com`** needs credentials on an API, not page reading.
- **DNS-over-HTTPS** is not a web page.

**Where it is genuinely capable: a LOCAL desktop session** — open egress, plus
browser automation against a real logged-in Chrome, which does things a plain
fetch cannot. But that is also where we *already* have what we need: local
sessions reach pqdi.cc, quarm.guide and eqemulator.org directly, and the
`local session fetches → mirrors into Supabase` rule already covers the handoff
(the `spell_level_seed` and eqemu backfill precedents).

**So the call is no**, and the reason is worth keeping because it generalises:
**a fetch-aggregator cannot solve an egress-policy block.** Check whether the
wall is the environment's or the site's before reaching for a tool — ours is the
environment's, and the tool's own backends prove it by being blocked too.

⚠ **If it is ever reconsidered, the install model is the thing to weigh.** It
installs by handing the agent a URL and letting it run the install script
autonomously, and the only machine it would help is the one holding `A:\EQ`,
`D:\EQServer` (MariaDB creds in `eqemu_config.json`) and our Supabase
service-role key. That is a large amount of trust for a convenience wrapper
around tools (`yt-dlp`, `gh`, `feedparser`) we can invoke directly.

Repo stats not cited: `api.github.com` is blocked here too, so the star/fork
counts on the rendered page could not be verified — and they do not bear on the
measurement above.

---

## 2026-08-14/14 — Fleet counts are PLAYERS, not characters
*2026-08-14 · DECISIONS-2026-08-14.md · Fleet counts are players not characters*

**The call (guild lead, 2026-08-16).** *"when we talk about who's using the
releases, character counts mean almost nothing. use distinct player counts by
discord ID."*

The worked example that makes the point: this morning's fleet read was "178
characters on agent 3.5.80." Re-measured as distinct `uploaded_by_discord_id`
taking each player's most-recent upload:

| version | players (7d) | active 48h |
|---|---|---|
| 3.5.85 (beta) | 1 | 1 |
| 3.5.83 (beta) | 1 | 0 |
| **3.5.80 (stable 2.5.0)** | **16** | **15** |
| 3.5.72 | 1 | 1 |
| 3.5.71 | 4 | 0 (idle since Thu; auto-update on launch) |
| older | 2 | 0 |

The character figure counts rows in a per-character table, not people, which
is where the order-of-magnitude inflation comes from. Standing
rule (folded into CLAUDE.md domain policies): any adoption gate, graduation
argument, or sentinel invariant that counts the fleet counts distinct
discord ids at their latest-upload version.

Two claims re-checked under the new metric, both survive but read differently:
- **#27's "fleet is on the fix" gate**: 15 of 17 active players are ≥3.5.80 —
  still cleared, but "88% of players" is the honest phrasing, not "178
  characters."
- **The beta channel is effectively ONE player**, plus one tester last seen
  Friday. That is a structural fact about how much real-raid
  validation beta features get before graduation, and part of why the
  beta→stable cadence leans on browser/unit verification: the beta "fleet"
  cannot exercise a raid.

---

## 2026-08-20/12 — Process: a silent Monitor death delayed the freeze-lift landing ~9h
*2026-08-20 · DECISIONS-2026-08-20.md · Cloud session timers are hopes, not schedules*

The 00:31 ET landing (bot 3.1.59 + web 1.1.77) was armed on a persistent
Monitor that died at its 30-min timeout without firing — the second monitor to
do so that night. The landing happened Thursday morning instead (no harm —
freeze-safe window), but the lesson stands: **a cloud-session timer is a hope,
not a schedule.** For time-critical follow-ups, prefer `send_later` /
scheduled triggers (they survive container churn) over Monitors, and write
the pending landing into the task list + docs so ANY next session picks it up.

---

## 2026-08-21/9 — The methodology gets published at wolfpack.quest/ai (guild lead, 2026-08-23)
*2026-08-21 · DECISIONS-2026-08-21.md · Publish methodology page with adoption timeline*

> "publish all of this detail to wolfpack.quest/ai. it should be human and
> agent readable. I would like the current view and be able to unwind a slider
> from the current view to milestones in the adoption of these instructions and
> the linked PRs from the development that they caused … any agentic workflow
> could review that page and understand our methodology for developing and
> maintaining this without GitHub access, but if the agent has GitHub access it
> could see the full picture and set up its own workflow to match."

**One source, three renderings.** `web/lib/aiMethodology.ts` holds the rules,
milestones, workflow stages and gates; `/ai` renders them, `/ai.json` serves
them structured, `/ai.txt` serves them as one plain-markdown document. Never
write methodology prose into any of the three renderings — the JSON and text
would drift from the page within a week.

**Publishing a restatement needed a guard, or it becomes the thing we warn
about.** The page restates rules that live in `CLAUDE.md` and `docs/`, which is
a second copy, and a second copy rots — the exact failure mode several of the
published rules exist to prevent. `test/ai-methodology.test.js` holds the copy
to the source: every cited document must exist, and every `quote` must still
appear verbatim in the file it cites. Rewrite a rule in `CLAUDE.md` and the
test goes red until the published copy follows.
⚠ The first version of that test passed **vacuously** — the quote-pairing regex
had a `\n` after a `\s*` that had already eaten the newline, so it captured
nothing and verified nothing. Caught by deliberately corrupting a quote and
watching it stay green. The test now asserts a minimum number of *captured
quotes*, not just of entries.

**There are no PRs to link.** This repo ships by direct push, so commits are
the durable unit of history; the timeline links commits, and the page says so
rather than leaving an agent looking for a PR workflow that does not exist.

**Documenting the read-discipline footgun tripped the read-discipline
ratchet.** The prose explaining that an over-cap row limit does not lift
PostgREST's cap contained the literal signature, and `aiMethodology.ts` is
inside the ratchet's scan roots — so describing the bug registered as
committing it and failed CI. Fixed by rewording rather than exempting the file:
an exemption would have to be maintained forever, and the ratchet is only worth
having if it has no holes. Noted in that file's header for whoever writes the
next entry.

**The two structures on the page are different on purpose** — chronology is a
line (the scrubbable spine), routing is a tree (the task workflow, with its
branch points drawn as branches). Colour carries the thesis before the prose
does: orange is what went wrong, green is the rule that came out of it, blue is
the commit that implemented it. Gold marks only the slider position.

**Motion is allowed here and almost nowhere else.** The overlay rule is that
animation is a cost because those surfaces are read mid-fight; this page is
read deliberately, and the guild lead asked for smooth transitions. Principle cards stay
mounted and toggle a class rather than unmounting, which is what makes
scrubbing continuous instead of a re-layout flash. All of it is off under
`prefers-reduced-motion`, and every state is also carried by colour and text.

**The page ships with a caveat about itself**: this method suits a repo with two
very large single files, few readers, and consequences that land on a schedule.
Visiting agents are told to adopt the shape and derive their own rules from
their own incidents.

## 2026-08-27/6 — ⚠ Two different people — the attribution rule was wrong for three weeks
*2026-08-27 · DECISIONS-2026-08-27.md · Attribution rule was wrong for three weeks*

The guild lead, seeing the rule quoted back in `GEMINI-SPARK-HELPER.md`:

> "this helper file still references me as a member. they are not me, different
> person"

From 2026-08-09 until now, `CLAUDE.md` and the Gemini helper both carried a
character-to-person mapping that was wrong for one name, and instructed every
agent reading them to re-credit anything under that name to the guild lead.
**That member is a separate person.**

Corrected in both files. What the fix has to preserve, in both directions:

- **Existing dated credits in code comments were CORRECT** and must not be
  rewritten to the guild lead. They predate or survived the bad rule, and they name the
  right person. The death-awareness design, the group-death watcher, the clock-
  correction clerics roster and the trigger scanner all carry real a member
  attributions.
- **Attributions TO the guild lead dated 2026-08-09 → 2026-08-28 are now suspect** —
  there are 234 of them and they cannot be audited from here. Most are genuinely
  The guild lead. The rule now says to treat that window as uncertain and prefer the
  original report where one can be found, rather than trusting the comment.
- a member remains a real character name in fixtures, golden logs and the
  `{s}`-capture worked example. Attribution text only — never a blanket rename.

**Confirmed the next morning** by asking outright rather than inferring. The
list we had been carrying was wrong in BOTH directions — it held a name that did
not belong and missed one that did — which is the whole point: a mapping built
by inference is wrong in ways nobody notices. ⚠ **The list itself is no longer
recorded anywhere in this repo** (2026-09-16); attribution is by role now, and
the database is the only place that knows.

**The lesson is about the rule's shape, not this one name.** A rule that
collapses many names into one person fails in the direction that *erases other
people's contributions*, and it fails silently: the wrong attribution reads
exactly like a right one, and the only way it ever gets caught is a human
noticing their own name. The rule already warned "a name being in a code comment
today is not evidence" — it now also warns that a name being on the alt list is
not evidence either, because this one sat there wrongly for nearly three weeks.

---

## 2026-09-04/4 — UI ships as options, previewed on beta (a standing rule from tonight)
*2026-09-04 · DECISIONS-2026-09-04.md · UI changes ship as options on beta*

The guild lead, after three UI changes landed on production in one day with no
alternatives offered: *"When a request involves UI, don't give me one design.
Give me two or three genuinely different approaches to choose from … deploy
each variant as its own preview and give me URLs to compare … Never touch
production or promote a variant without asking me first."* Now a working rule
in `CLAUDE.md` (with the platform-specific mechanics: `?v=` variants on `beta`,
read at `b.wolfpack.quest`, because member pages cannot sign in on any other
preview host). Cost is broken out four ways — build, maintenance, runtime,
change — never collapsed into "harder".

Applied retroactively to the one design decided unilaterally today, the
attendance layout: the month blocks stay on production as the baseline, and
two genuinely different alternatives go up on beta for a side-by-side.

**Picked the same evening (the guild lead): "I like blocks and strips, let's keep both
as options, default to strips."** So both ship as a member-facing switch on
`/me` and `/raidhistory` (web 1.7.23), strips by default, the choice kept in a
`wp_raid_layout` cookie the way the timezone picker keeps `wp_tz`, with
`?layout=` for a shared link. The mini-calendar variant is deleted, not
parked — a variant nobody chose is dead code. Graduated beta → main by
cherry-pick; the `?v=` preview switcher is gone from both branches.

⚠ **The graduation shipped in two pushes, and the first was wrong twice
over.** `git cherry-pick -q` is not a flag, so the chain failed silently and
the gate ran green against main's OLD web tree; web 1.7.23 went out as docs +
roadmap claiming a switch the code did not contain. Worse, the mutation helper
(`cp file bak; sed; cp bak file`) hit a file that did not exist on main, and
its `cp bak file` restored the PREVIOUS mutation's backup — the review index
page — into `web/lib/raidLayout.ts`, which `git add -A` then committed. Caught
within minutes; the real code landed as **web 1.7.24**. Two rules: a
cherry-pick step gets its own `|| exit`, and a mutation helper must refuse a
missing target and use a per-call backup name. Green tests on the wrong tree
are the same trap as green tests on a SyntaxError slice.

## 2026-09-04/6 — Personal deployment details do not belong in a public repo
*2026-09-04 · DECISIONS-2026-09-04.md · No personal network details in public repo*

The guild lead, on the Tower overview: *"that MD is for my personal deployment. if it
contains personal details or ips or whatnot it should be cleaned up."* It did —
two LAN addresses, and the two runbooks it points at carried the same ones plus
the VM's libvirt UUID and MAC in the pasteable XML. All replaced with
placeholders (`<tower-ip>`, `<coolify-vm-ip>`, `<project-ref>`,
`REPLACE-WITH-OUTPUT-OF-uuidgen`, `52:54:00:XX:XX:XX`), and the rule is now in
`CLAUDE.md` next to the commit-message rule. The Supabase project ref stays in
`CLAUDE.md`'s fixed facts — it is the public API host every browser already
sees — but the Tower doc uses the placeholder so it reads as one person's
deployment, not everyone's.

## 2026-09-10/11 — Graphify run on the codebase (guild lead, 2026-09-13)
*2026-09-10 · DECISIONS-2026-09-10.md · Code graph tool run on codebase*

Guild lead: *"Please graphify our codebase"* (Graphify-Labs/graphify, PyPI
`graphifyy` 0.9.61). Run locally, code-only (no LLM, no API key), on a
`git archive` export of the tracked tree with the two vendored third-party
skills (`.claude/skills/impeccable`, `ponytail`) removed and the SQL grammar
installed so the 236 migrations count: **10,340 nodes · 20,185 edges · 695
communities**, 96% extracted / 4% inferred. Delivered as a private artifact
(interactive graph, vis-network re-pointed from unpkg to jsdelivr for the
artifact CSP) plus `GRAPH_REPORT.md`. Nothing committed: `graph.json` is
15 MB and regenerates in 30 s. What the report says that we did not already:
- **God nodes** are the two Supabase clients (`supabaseAdmin` 303 edges,
  `supabaseServer` 187), then the test harness (`vitest`, `sliceBlock`,
  `readSource`) — the test slicing helpers are load-bearing infrastructure.
- **One import cycle:** `commands/parse.js ↔ commands/raidnight.js`.
- **Cohesion of the three monoliths is ~0.01** (agent `index.js`, bot
  `index.js`, `discord.js` community) — the tool's own "should this be split"
  question, which `ARCHITECT-REBUILD-2026-08-16.md` already answers.
- The "surprising connections" are `execute()` → OpenDKP helpers through
  indirect calls and one false positive (`CompEditor.onSave` → a test's
  `text()` — name collision).
Asked whether the graph would make outcome-driven changes easier, the
honest test was this week's four real problems: the relay leak (a payload
field one process never sent — invisible to a call graph), the quiet-mode
split (a config key through 16 gates — the graph has zero nodes for
`quietMode`), the `#if 0` miss (tree-sitter does not evaluate the
preprocessor) and the target-of-target spot (grep + the index did it). It
helps with "who calls X / what does X reach" and cycles, and as a first probe
for an agent with no repo context. **the guild lead's call, 2026-09-13: regen script
in, outputs out, hook not installed** — `scripts/graphify.sh`.

## 2026-09-10/3 — I pushed main CI red on 2026-09-08 and did not notice
*2026-09-10 · DECISIONS-2026-09-10.md · Pushed CI red by skipping full test suite*

`scripts/mimic-netdiag.ps1` was committed BOM-less with em-dashes, arrows and
box-drawing. `test/powershell-ascii.test.js` has existed since 2026-08-13 and
failed from that commit until 2026-09-10. I ran the targeted tests for that
change and not the full suite.

It was not only a red test: Windows PowerShell 5.1 decodes a `.ps1` with the
system ANSI codepage unless the file opens with a UTF-8 BOM, so the script
handed to a member would not have parsed at all. Fixed with a BOM (matching
`install-node.ps1` / `start-logsync.ps1`); the `.bat` is now pure ASCII.

**Run the full suite before pushing, not the targeted file.** The repo already
had the guard; I just did not consult it.

## 2026-09-10/12 — Two more tools assessed, neither adopted (2026-09-13)
*2026-09-13 · DECISIONS-2026-09-10.md · Two more tools assessed, not adopted*

The guild lead asked about `rtk-ai/rtk` and `nextlevelbuilder/ui-ux-pro-max-skill`.
- **rtk** — a PreToolUse hook that rewrites Bash commands to `rtk <cmd>` and
  compacts their output (claims 60–90% fewer tokens on dev commands). Its own
  README says it does not touch `Read`/`Grep`/`Glob`, and in this repo the
  big context sinks are source reads and MCP results (a GitHub `actions_list`
  returns every run's full commit body), not Bash output — which sessions
  already trim with `tail`/`grep`. Cloud containers are ephemeral, so the
  binary would need a per-session install through a proxy that already blocks
  some hosts. Verdict: skip for cloud sessions; the guild lead may try it on the
  desktop if a local session feels Bash-heavy. Watch that its error grouping
  never hides a failing assertion's text.
- **ui-ux-pro-max-skill** — 79 UI styles, 192 palettes, 74 font pairings,
  industry rules, auto-activating on any UI request; installs a large data
  directory into `.claude/skills/`. It is a generator of generic visual
  identities, which is exactly what `frontend-design` exists to override (the
  palette and monospace grid are fixed, and the mid-raid constraints are not
  in any generic catalog). Its UX-guideline half overlaps impeccable's
  detectors, and a third voice on every UI task would need a third precedence
  rule. Verdict: skip. If one piece is wanted (its accessibility list, say),
  vendor that file into `frontend-design`, not the skill.

## 2026-09-16/1 — The repo is public, so it names nobody (the guild lead)
*2026-09-16 · DECISIONS-2026-09-16.md · Public repo names nobody; comments swept*

> *"i want the references cleaned up. At the very least obscure names and
> anything specifically privacy invasive, credentials."*
> *"Make sure there aren't mentions of who is in what character family."*
> *"sweep the source code comments"*

Four passes in one day. Three over `docs/` + `CLAUDE.md` + `README.md`, then one
over the source.

### 1. Attribution is by ROLE now, and the alt list is gone
The confirmed alt list that lived in `CLAUDE.md` mapped one person to seven
character names — the exact artefact the cleanup exists to delete. It was
removed, not rewritten, and must not be reconstructed from `characters.main_name`
or anywhere else. The replacement is a table of roles (`the guild lead`,
`a member`, `an officer`, `a third party`) and one line that carries the reason:
**you cannot misattribute what you do not name.** Dates and quotes stay; they are
the evidence. Full rule in `CLAUDE.md`.

### 2. The source sweep, and what it deliberately left alone
Comments only — the sweep never edits a string literal, a trigger pattern or a
fixture. Three mechanical categories plus a hand pass:

| | What | Count |
|---|---|---|
| Prose attribution | `(Name 2026-08-11)` → `(the guild lead, 2026-08-11)`; anyone else → `a member` | 1,264 |
| Worked examples | log lines, callout formats, API payloads → invented names | 176 |
| Test-file prose | the same rule over `test/`'s own comments | 313 |
| By hand | ~60 comments where two people were named in one breath, a family was mapped out, or the mechanical pass read as nonsense | — |

**Invented names are a convention, not people.** `Aldenmar`, `Brackwyn`,
`Corvale`, `Rethlan`, `Nyssara`, `Zarrin` and the rest were checked against
`characters` and `eqemu_npc_types` before use, and a stable map was used so a
two-name example still reads as two different people.

**Things fixed that were not just names:**
- an OpenDKP account login and a `char_id → character` map in `index.js`;
- a comment stating one member's family relationship to another (it survived in
  `test/raid-swap-return.test.js` after being cleared from the web page);
- a member's LAN address in `web/lib/request-origin.ts`;
- every comment attributing multiple simultaneous clients to a named member;
- gendered pronouns left dangling on an anonymised subject — they/them per
  `CLAUDE.md`, since after anonymising, `he`/`she` is itself a leak.

**Verification:** 245 test files / 3,416 tests green, lint clean, `golden:check`
matches, `tsc --noEmit` clean, and `check:dashboard` confirms `WEB_HTML` /
`COMMAND_HTML` are back in sync after the `dashboard.html` and `command.html`
edits. A green suite is the evidence that renaming example names in comments
broke no text assertion — `CLAUDE.md`'s stated hazard, checked rather than
assumed.

### 3. What was NOT swept, and why
- **Test fixtures and golden logs** (~1,700 mentions). `CLAUDE.md` forbids
  blanket-renaming them and the reason is real: a fixture's name is load-bearing.
  A rename is its own change, with `golden:update` inside it.
- **The mock data on public pages** (`/about`'s overlay demo, `/mimic/mini`'s
  three mock overlays). These render the real raid — names, classes, groups,
  mana, a DPS ranking — on pages anyone can open. The mini page's cast was a
  deliberate choice so the guild recognises itself, and its vote is still open,
  so all three files were skipped whole rather than edited around.

Both are rows in the table below.

---

## 2026-09-18/1 — The license: Business Source License 1.1 (the guild lead) — ⚠ SUPERSEDED THE SAME DAY BY §10
*2026-09-18 · DECISIONS-2026-09-18.md · Business Source License chosen, then superseded*

> **Read §10 first.** This section is the record of a decision that stood for a
> few hours. The project is now **AGPL-3.0-or-later**. The reasoning below is
> kept because §10 is only intelligible next to it — in particular, the BSL
> limitation it uncovered (the Additional Use Grant cannot impose share-back)
> is what decided the move to AGPL.


> *"we're not making any money from this, but perhaps we could make it off
> hosting the services like opendkp or raid helper does?"*
> *"I want others to use it, then can deploy their own version and fork. if they
> take it and charge with it I should be entitled to a fair percentage."*
> *"can we make it where they can't charge for it without us coming to an
> arrangement?"*

**The call.** Relicense from BSD-3-Clause to **BSL 1.1** with an Additional Use
Grant that lets any guild run, modify and self-host it for its own community,
free; reserves *offering it to third parties for a fee* to the Licensor; and
names **AGPL-3.0-or-later** as the Change License, four years from each
version's publication. Landed as `LICENSE`, `docs/LICENSING.md` (plain
language), a **§9 Licensing** section in `CONTRIBUTING.md`, a License section in
`README.md`, `license: "BUSL-1.1"` in all four `package.json` files (two were
BSD-3-Clause, two declared nothing), and a correction in `docs/code-signing.md`
(the SignPath application claimed OSI status; BSL is not OSI).

**Why not the two obvious choices.**
- *BSD-3 (where it was)* lets anyone take the code, host it, charge for it and
  owe nothing back — including a guild we would decline, which is already
  question 3 in `DESIGN-external-tenancy.md` §10. Permissive licensing funds a
  competitor; that is the story behind every relicensing-under-pressure of the
  last decade.
- *AGPL alone* was the first recommendation and it is **wrong for the stated
  requirement**: AGPL §10 forbids adding any further restriction, royalties
  included, so under it anyone may charge freely as long as they publish their
  changes. "A fair percentage" is impossible on AGPL. It was recommended before
  the revenue requirement was stated and withdrawn the moment it was.
- *BSL → AGPL* reserves commercial use now, so charging requires an
  arrangement, and still ends fully open source on the copyleft license that
  actually reaches hosted services.

**What BSL cannot do, said plainly.** The guild lead also wants self-hosters to
*"provide their optimizations and platform compatibility so others can also use
it."* The BSL Covenants of Licensor (#2) allow the Additional Use Grant only to
*add* permission, never to impose a condition — so share-back **cannot be a term
of the grant**. Until the Change Date it is a norm asked for in `CONTRIBUTING.md`
and served by the fork-per-tenant model (§2 below); on the Change Date AGPL §13
makes it an obligation for anyone running a modified copy as a service.

**Two notes for a lawyer, if there is ever one** (nobody involved is one):
1. Covenant 1 requires the Change License to be GPL-2.0-or-later-compatible.
   AGPL-3.0 combines with GPL-3.0 under GPL-3.0 §13, which is the reading relied
   on. Fallback if judged too thin: GPL-3.0-or-later, losing only the
   network-service clause.
2. The relicense was clean because the repository has effectively one copyright
   holder (`git log`: the guild lead, Claude co-author trailers with no
   competing claim, the Actions bot). **That stops being true at the first
   merged outside contribution**, which is why the contribution grant
   (CONTRIBUTING §9, item 3) landed in the same change and not later.

**The commercial terms themselves — the percentage — are deliberately NOT in
the license.** The license only makes charging require a conversation; the
terms are agreed per arrangement. Nothing about them is decided.

## 2026-09-18/10 — The license again: AGPL-3.0-or-later, open source, not for profit (the guild lead)
*2026-09-18 · DECISIONS-2026-09-18.md · AGPL license, open source, not for profit*

> *"I don't think someone should make money off of the work that I've put in
> without me also making money off of it. that said we're playing a very old
> game that is not for profit and that's specifically how things have been run.
> quite frankly I'd be interested in running in a model that allows us to just
> cover the costs of development and infrastructure if that changes how this
> operates."*

It changes it, and **the project relicensed a second time the same day**: BSD-3
→ BSL 1.1 (§1) → **AGPL-3.0-or-later**. Recording why, because two relicenses in
one day looks like flailing and was not.

**What actually shifted.** The requirement in §1 was two things that pull apart:
nobody profits from this work without the guild lead, *and* this is a
not-for-profit community. BSL served the first at the cost of the second. Cost
recovery collapses the tension, because of one fact that had not been stated
plainly: **cost recovery does not need a restrictive license at all.** Under any
licence, including AGPL, you may charge whatever you like for hosting *you*
operate — no open-source licence restricts that. A restrictive licence only buys
the power to stop *other people* charging.

**The three reasons AGPL won:**
1. **It does the thing BSL structurally could not.** §1 records that BSL's
   Covenants let the Additional Use Grant only *add* permission, so share-back
   from self-hosters was a request in `CONTRIBUTING.md`, not a term. **AGPL §13
   makes it an obligation** — modify it, serve people over a network, offer them
   your source. That is what the guild lead asked for on the 18th and could not
   have under BSL.
2. **It fits where this lives.** An emulated server run as a labour of love, with
   every neighbouring tool free. `DESIGN-business.md` §8.1 already said charging
   "is visibly different from a guild sharing a tool, and it raises the profile
   of the whole thing". Cost recovery reads as the former.
3. **It is genuinely open source** (OSI-approved), which BSL is not — and that
   restores free code-signing eligibility, which BSL had disqualified
   (`docs/code-signing.md`). The unsigned-installer SmartScreen warning is now
   fixable.

**What was given up:** the ability to stop a third party charging for hosting.
Sized honestly — one server, a few hundred players, every competing tool free,
and under §13 even a commercial host must publish its improvements, so the bad
case still returns code. **Retained copyright plus the contribution grant
(`CONTRIBUTING.md` §9 item 3) keeps a commercial licence available** for anyone
wanting to host a modified version without §13. That grant was written for
exactly this and survived the change unaltered.

**The money model.** Not for profit. Cost recovery only: donations (which confer
nothing — no priority, no feature, no support tier) and guilds sharing the cost
of a deployment run for them. No paid tier, no feature behind a paywall.
`docs/TERMS-hosted.md` rewritten from commercial hosting to cost-share;
`DESIGN-business.md` carries a superseding banner plus in-place corrections
where it inverted (its §5.1 had rejected donation platforms as "wrong shape" —
true of a contracted service, wrong for this).

**Landed:** `LICENSE` (canonical AGPL-3.0 text, verified §13 intact, with a
project header), `docs/LICENSING.md` rewritten, `README.md`, `CONTRIBUTING.md`
§9, `docs/TERMS-hosted.md`, `docs/code-signing.md`, the brochure and its PDF,
and `license: "AGPL-3.0-or-later"` in all four `package.json` files.

⚠ **The relicense was clean only because the repository still has one copyright
holder.** That was true for the BSD→BSL move and it is still true now; it stops
being true at the first merged outside contribution. Two relicenses were
affordable because nobody had adopted it yet. A third, later, would not be.

## §1 — Understand-Anything assessed — not adopted, one bounded trial offered
*2026-09-21 · DECISIONS-2026-09-21.md · Codebase knowledge-graph plugin assessed, not adopted*

The guild lead: *"I know we're doing a lot to help people understand things, but
please look at this."* — `github.com/Egonex-AI/Understand-Anything`, MIT
(© Yuxiang Lin and Infinite Universe, Inc.), a Claude Code plugin that builds a
knowledge graph of a codebase and serves an interactive dashboard over it.
Reported at ~83k stars; ⚠ **unverified from here** — this session's GitHub access
is scoped to our own repository, so that figure comes from the project's own page
and a third-party index, not the API.

### What it is
Tree-sitter for the structural half (files, functions, classes, imports,
inheritance) plus a **seven-agent LLM pipeline** for the semantic half:
plain-English per-file summaries, architectural layer assignment, business-domain
mapping, and dependency-ordered guided tours. Writes `.ua/knowledge-graph.json`
(+ `config.json`, `intermediate/`, `diff-overlay.json`) into the repo. Commands:
`/understand`, `-dashboard`, `-chat`, `-diff`, `-explain`, `-domain`,
`-knowledge`.

### ⚠ We already own the deterministic half of this, on purpose
**`scripts/graphify.sh`**, adopted 2026-09-13 (`DECISIONS-2026-09-10.md`). Same
tree-sitter core, **code-only — no LLM, no API key**: 10,340 nodes · 20,185 edges
· 695 communities, rebuild in ~30s, outputs gitignored. The guild lead's call then
was *"regen script in, outputs out, hook not installed"* — the hook specifically
because *"'query the graph before reading files' is the opposite of the lesson
that week (read the block, not the hits)."*

So the question is not "is a code graph useful", which is settled. It is narrower:
**does the LLM layer answer what the graph alone could not?** That test already
exists — the four real problems of that week:

| Problem | Graph? | Would the LLM layer? |
|---|---|---|
| The relay leak — a payload field one process never sent | no (invisible to a call graph) | **no** — it summarises files, it does not diff a data contract across an HTTP boundary |
| Quiet-mode split — one config key through 16 gates | no (zero nodes for `quietMode`) | **maybe** — semantic search over summaries could surface it. But `grep quietMode` already does, in a second, for nothing |
| The `#if 0` miss | no (tree-sitter does not evaluate the preprocessor) | marginal — an LLM reading the file might notice |
| Target-of-target | no — grep + `HOW-ITS-BUILT.md` did it | no |

**One of four, and that one is already a one-second grep.** That is the whole
case against wiring it in.

### What it would genuinely add, and why the timing is not silly
Per-file plain-English summaries, semantic search, a domain view, and
**dependency-ordered guided tours**. Those are *onboarding* features, not
maintenance ones — and onboarding just became a real concern rather than a
hypothetical: the relicense to AGPL, `DESIGN-guild-kit.md`, and the brochure aimed
at other guilds all assume an outside maintainer eventually lands on an 18k-line
`index.js` and a 35k-line agent. Nothing we have is a *reading order*.
`CLAUDE.md` is a map and `HOW-ITS-BUILT.md` is an index; neither says "start here,
then this."

### ⚠ Why it does not go in as-is — four repo-specific hazards
1. **It generates a second architectural authority.** `CLAUDE.md` says at the top
   that it is the authority, and it is hand-maintained precisely because the
   corrections are load-bearing and invisible to a generator: the Zeal spawn-id
   boundary is **superseded** and says so, Supabase is **Pro, not free tier**,
   historical chat is *collection in scope, display not*, Discord is *no longer*
   a source of truth. An LLM summarising this repo will restate the stale version
   of every one of those, confidently. This is the same trap already recorded for
   `/impeccable init`: *"Three competing doc roots is how the next session reads
   the wrong one."*
2. **`--auto-update` is a post-commit hook** that re-analyses changed files on
   every commit. `main` runs 12–42 commits/day. That is a recurring LLM spend
   attached to `git commit`, and it is the same hook-shaped thing already declined
   for graphify.
3. **Cost, at a moment we are counting it.** Its own README warns the first run
   *"can consume a significant number of tokens on large projects"* and gives no
   figure. Our large project is two monoliths, `web/`, Mimic, 236 migrations and
   246 test files. `COSTS.md` puts development tooling at ~5× infrastructure and
   exists to justify donations; an unbounded number does not belong in it.
4. **Install method.** The README offers `curl -fsSL … | bash` and
   `iwr -useb … | iex`. Use neither. The marketplace route
   (`/plugin marketplace add`) is the supported one — and note a plugin install
   does **not** survive a fresh cloud container, which is exactly why `impeccable`
   and `ponytail` were *vendored into committed `.claude/skills/`* instead.

Licence is the one clean part: **MIT**, so vendoring a piece of it is permitted
and compatible with our AGPL.

### The call
**Not adopted.** Same verdict and the same reasoning as `rtk` and
`ui-ux-pro-max-skill` on 2026-09-13: a good tool that overlaps something we
already decided the shape of.

**The one trial worth running**, if the guild lead wants it: point it at
**`packages/wolfpack-logsync/` alone** — one self-contained surface, no bot, no
web, no Mimic — and compare its guided tour against that surface's
`HOW-ITS-BUILT.md` rows. Bounded spend, and a clear pass/fail: *does it say
anything the index does not?* If yes, the output is a **draft for a human to
edit into `CONTRIBUTING.md` or a new onboarding doc** — never a generated file
committed as an authority, and never the auto-update hook.
⚠ A cloud session cannot run this: `/plugin` is a CLI command, and the container
is ephemeral. It is a desktop-session job.

## §398 — What shipped 2026-10-20/21 (ledger)
*2026-09-21 · DECISIONS-2026-09-21.md · Ledger of what shipped Oct 20-21*

- **Web 1.9.17–1.9.19 on main:** `/pvp` Fight cards, `/pop` by essence, the `/zeal-icons` guild index, instruction folds
  ("Click here for more info", `web/components/MoreInfo.tsx`), `/about` is the Tour (beta keeps `?v=b` / `?v=c`
  guild-first previews).
- **Mimic beta:** Canvas 🔒 lock and take-apart keeps Background; Map outlines use the skin's real window sizes
  (`_scanSkinWindowSizes`, `uiClearRects.js` `skinSizeFor`); UI Studio "Move it in game" shows `/raidbars position L T
  [R B]` and `/assistbar position L T` with Copy.
- **Agent 3.8.33:** the guild trigger list moved off `/api/state` to `/api/guild-triggers?rev=` (poll about 540 KB down
  to about 4 KB at 500 rows). **3.8.34:** PQ Companion trigger pack import beside GINA / EQLogParser. **3.8.35:** Map
  engaged = hurt (any live mob under 100%, lowest first), per-spawn health memory fed every Zeal frame and shown with
  its age, kite totals, "killed?" marks for ambiguous same-name deaths, targeting a corpse or a "dead" /tag (chat, rsay,
  gsay, prettyprint off) confirms the kill and starts the respawn timer; limit: Mimic forwards Zeal snapshots every 300
  ms. **3.8.36:** Chat overlay: own guild / raid lines are never lost (dedupe only against copies actually on screen; a
  stood-down chat reporter still uploads its own lines).
- **Bot 3.2.14:** §397. **Bot 3.2.15:** the data pack (§392).

## §424 — The Decision Desk picks of 2026-10-23 (evening), and the mimic's "coming to life" story
*2026-09-21 · DECISIONS-2026-09-21.md · Oct 23 evening desk picks, mimic story*

Picked on the Decision Desk (its picks are the record; this is the pointer).
- **Platform (all the recommended option):** sync circles **A**, a day pass from a raid code (the hub keeps a circle 7 days for
  looking back); your data **A**, local copy + opt-out first, guild requests later; flag-raid board **A**, inside wolfpack.quest
  first; leaderboard **A**, built with the hub's guild sign-up. These feed the open hub (§423); none is built yet.
- **raidmimic.com:** the story is **B**, "Pick your path" (three doors). The stage around the animated mimic is **B**, the strip:
  the mimic alone and big, the four real captures in a readable row below (*"The folded ears on A look weird and awful."*).
- **Brand Kit:** hero image refined **V1** (version 2's layout and double gold rule, version 1's 3D mascot); desk scene revised
  **V3** (corner windows); map **V3** and feature icons **V2** (framed cards) from earlier. The eight icons are on beta (web 2.1.18).
- **The animation (the guild lead):** *"So stiff, so plain. Where's the motion? The Joy? This box has come to life and is supremely
  interested in the user."* Then the storyboard: a plain gold-trimmed chest on a desk; a zap from the computer; the ears pop out of
  the top sides of the lid and quickly spring upright (*"not a jack in the box"*, and not from the sides of the box); the nose pops
  out; it gets excited, looks at the screen, crouches, jumps and howls; pulls streams of data from the computer into its mouth and
  glows; shakes, jumps and howls again; the overlays come out one at a time, circle it, spin, and slam into the monitor with a
  thump and shake, then show the overlays; pleased, it hops corner to corner. **No legs, ever** — the video model invents legs or
  springs whenever it is asked to bounce.
- **How it is made:** Gemini (`gemini-3-pro-image`, the guild lead's API key) draws a still per story moment, each edited from the
  one before so the desk, chest and camera never drift; LTX (`ltx-2-5-pro`, async `/v2/image-to-video` with `last_frame_uri`)
  animates between each pair; the beats are joined with the repeated seam frame dropped. Real overlay captures are laid onto the
  monitor's four panels afterwards, never drawn by the model (§418's garbled-text finding).
- **Where it landed:** drafts and stills in the session scratchpad and on the Decision Desk's Brand & media tab; nothing on the
  site yet. **Next:** the guild lead watches the storyboard cut; then the final pass (captures in the panels, a 9:16 cut, a short
  hero loop for the strip stage).

## §6 — Jev compaction assessed — not adopted; the blocker is a privacy call (2026-09-23)
*2026-09-23 · DECISIONS-2026-09-21.md · Compaction tool assessed; privacy blocks adoption*

The guild lead: *"please review and tell me your view of using Jev"* —
`github.com/tamaratran/fast-jev-compaction`, MIT, v0.2.0, zero runtime
dependencies. Reported on its GitHub page as **6.3k stars / 357 forks / 13
watchers / 27 open issues / 45 open PRs / 30 total commits**; ⚠ figures read off
the page, not the API (our GitHub access is scoped to our own repository).

### What it actually does — read from the source, not the README

A Claude Code plugin that replaces `/compact`'s summary. Instead of asking an
LLM to summarise old turns, it scores every tool call and asks TypeSafe's **Jev**
model two questions per call — *should the call stay* and *should its result stay
verbatim* — then deletes or truncates the losers and leaves everything else byte
for byte. Nothing is ever rewritten. Failures throw and the built-in summary
takes over, so it is fail-open by construction.

The claim worth checking is what leaves the machine, and the code answers it
cleanly (`src/state.ts`):

| Leaves the machine | Stays local |
|---|---|
| Every user and assistant message, **verbatim** (abridged head+tail only when the state will not fit) | **Tool results.** `resultNote()` sends `ok, 4213 chars (omitted)` — the contents are never transmitted |
| Every tool **input**, JSON-serialised, capped at 1000 → 200 → 60 chars as the state is squeezed | |
| `goal` — the last three user prompts, 500 chars each | |

So file contents do not leave via results — but they leave via **inputs**, because
`Edit` inputs carry `old_string`/`new_string`, `Write` carries file bodies, `Bash`
carries whole command lines, and `execute_sql` carries the SQL. For a session like
this one that would have shipped the Tower report, our retention figures, the
database sizes and the guild lead's quotes to `api.typesafe.ai`.

### Why it does not fit here, even though the problem is real

**Our compaction loss is cross-session, and Jev is within-session.** This whole
file exists because *"a decision that lives only in chat is lost: cloud and
desktop sessions cannot share a conversation"* — no compaction strategy touches
that. Jev keeps chat text verbatim inside one context window; committed docs keep
it across sessions, machines and container resets. We already pay for the
stronger mitigation, and it is the one that survives.

Where it genuinely would help is the narrower case: one long session that
compacts mid-task and then re-reads files it had already read. Real, and modest.

### Cost, in the four numbers

- **build** low — install the plugin, set `TYPESAFE_API_KEY`. For cloud sessions
  the key has to live in the environment config, which is the guild lead's action.
- **maintenance** ⚠ high — v0.2.0, 30 commits against 45 open PRs and 27 open
  issues, one author, and a hard dependency on a proprietary early-access model
  behind a waitlist. That ratio says the repo went viral faster than it is being
  maintained.
- **runtime** unknown, and unknowable from here — the full state is resent with
  every request batch, so a long history costs several 25–30k-token calls to a
  paid API, at the moment you are already stalled waiting to compact.
- **change** low — one plugin, removable in a command, and it falls back to the
  built-in summary on any failure.

### The call this needs

Not a tooling question. **Every message either of us types, plus every command
and query, would go to a third party** — that is the same family as the standing
rules on credentials, member privacy and the public repo, and it is the guild
lead's to make, not a session's.

⚠ **And it cannot be answered from a cloud session.** `typesafe.ai` and
`docs.typesafe.ai` are both refused by the egress proxy, so the retention policy,
whether submissions train the model, the price and the waitlist status are all
unverified. Same shape as the eqemulator.org/PQDI block: a desktop session can
read them in a minute.

**Recommendation: do not commit it as a repo plugin.** If it is wanted, run it
from a **desktop** session first, where the key stays on the box — and only after
the retention answer is in hand.

## §14 — Laya assessed as a Jev alternative — not adopted (2026-09-24)
*2026-09-24 · DECISIONS-2026-09-21.md · Compaction alternative assessed, not adopted*

The guild lead: *"Evaluate this Jev alternative https://github.com/NandhaKishorM/laya"*.
Read from the source, cloned at `970dc8c` (v0.3.20). The repo was created
2026-09-18 and had 276 commits by then. Checked against the §6 plugin
(`tamaratran/fast-jev-compaction` at `e3f262a`).

**What it is.** Laya is not a compaction tool. It is an open-weights
replacement for Jev, the *model*: typed `choice` / `score` / `noul` decisions
from an encoder in one forward pass. Three checkpoints (ModernBERT-large 421M
and mmBERT-base 322M), Apache-2.0, run locally on torch + transformers.
`laya-serve` speaks Jev's own `/v1/systemone` wire protocol, so a Jev client
can point at it.

**Why that matters here.** §6's blocker was privacy: the plugin sends every
message and every tool input to `api.typesafe.ai`. A local Laya server would
keep all of that on the machine. That part is real.

**Why it still does not work as a drop-in — each point read from the code:**
1. **The plugin cannot be pointed at it without a fork.** The library takes a
   `baseUrl`, but the Claude Code hook calls `buildJevRequest({ apiKey, model })`
   with no URL (`hooks/fast-jev.ts` `jevAsker`). The plugin settings have no URL
   field either. It always calls `https://api.typesafe.ai/v1/systemone`.
2. **The defaults are rejected outright.** The plugin sends up to 25,000 tokens
   of state (about 100k characters). `laya-serve` refuses more than 50,000
   characters (`MAX_STATE_CHARS`, HTTP 413). A batch of about 40 calls also
   comes to about 80 questions against `MAX_QUESTIONS = 64`. The plugin treats
   any error as failure and falls back to the built-in summary, so it would
   silently never work.
3. **Laya would not see the calls it is asked about.** `laya-serve` passes no
   `max_len`, so each request is cut to the checkpoint default: 512 tokens for
   English, 1,024 for multilingual. It keeps the *start* of the state (`truncate_left`
   is only set for list states), and the plugin's state is an object: the task
   text, the last three prompts, then the history oldest-first. So almost every
   "should call N stay" question would be answered from the same first few
   hundred tokens, before any of the calls.
4. **Even at its longest, it cannot hold the history the plugin sends.**
   `laya-multilingual` goes to 8,192 tokens, and by its own measurements is
   16–18 of 20 correct up to about 4,000 tokens and 8–17 of 20 beyond. The
   plugin wants 25,000.
5. **Nobody has measured it on this task.** Laya was trained and benchmarked
   on support triage, phishing, moderation, retrieval relevance and routing,
   not on "is this tool output still needed". Zero-shot, the base English
   checkpoint scores 0.362 on Laya's own typed-decisions benchmark, against
   0.766 fine-tuned. The Laya-vs-Jev charts use Jev numbers published by a
   third party, which Laya never ran (its `BENCHMARKS.md` says so).
6. **A wrong answer does not fail safe.** The plugin falls back only on errors.
   A confident wrong "drop" deletes context the session still needed, and it
   only shows up later, as re-reading or as a decision made without it.

**Cost, in the four numbers, for the smallest version that could work** — fork
the plugin to add a URL, patch `laya-serve` to pass `max_len=8192`, and shrink
the plugin's state budget to about 6k tokens:
- **build** M — two forks, plus a small labelled set of our own compactions to
  check the answers against. Without that set, nobody would know whether it
  works.
- **maintenance** ⚠ high — a six-day-old project with 23 tagged releases so far,
  two forks to keep rebased, and `torch` + `transformers` 5.x.
- **runtime** ⚠ high, and it lands exactly when the session is stalled waiting to
  compact. Each question re-encodes the whole state, so the cost is questions ×
  state length. Laya's own figure is about 1.7 s for a 4,000-token input on an
  Apple GPU, and a compaction asks tens of questions. On a cloud container
  there is also a CPU-only install of a few GB of dependencies and weights on
  every fresh session, against the disk allowance.
- **change** low — it can be removed, and failures fall back to the built-in
  summary.

**§6's other finding still stands.** Our compaction pain is cross-session, and
this, like Jev, only helps within one session. The committed docs are the fix
that survives.

**Recommendation: do not adopt.** Watch it: a Laya checkpoint fine-tuned on
keep/drop decisions, served with a real context length, would answer §6's
privacy objection properly. The fastest honest test is a desktop session
running `laya-serve` with `max_len=8192` against about 20 compactions we label
by hand. Clones for re-reading: the session scratchpad (not committed).

## §20 — Contributing: the AI brief and the public roadmap brought up to date (2026-09-25, web 1.8.4)
*2026-09-25 · DECISIONS-2026-09-21.md · AI contributor brief and roadmap updated*

The guild lead: *"`docs/AI-CONTRIBUTOR-BRIEF.md` … this and the roadmap need
updating so people can contribute"*, then, mid-raid: *"push it up to either
main because it's just a document … or give me a link to the new version on
beta that I can get to someone."*

**Beta, not main, during the raid.** The change touches the `/roadmap` page as
well as the doc, and any push to `main` redeploys the bot on Railway whatever
the files are — the mid-raid restart the freeze exists to prevent. Beta carries
no bot, and these files cut no Mimic build, so the brief went to `beta` and the
link handed out was the brief's GitHub page on that branch. Main follows after
00:30 ET.

**What was stale, and how it was checked.** A read-only audit of both lists
against the ledger and the code (file:line evidence for each):
- **Roadmap "What's next":** 4 of 23 items had shipped and came off — #75 golden
  log, #80 raid review, #81 raid guide (phase 0), #193 Zeal spawn id (upstream,
  Zeal 1.4.6). Ten more were partly done and now say so in their status line
  (#190 the engine repair is in, the re-count is not; #144 displays guarded,
  source not; #142, #192, #56, #87, #68–70, #199, #194, #195, #196). Three were
  added and numbered: **#209** mini-mode data gaps, **#210** the overlay
  click-throughs + the CH row that turns blue again, **#211** more skills on the
  HUD (a "we need" item, so raiders' answers arrive through the roadmap box).
  Next free number: #212.
- **The brief's menu:** 8 of 10 items had shipped long ago (#134, #132, #133,
  #99, #83, #66, #67, #130; #100 partly). The new menu is #209–#211, #144 at the
  source, the charm too-high-level line, #191, #54, #199 phase one, the
  "| local" / "| merged" parse-paste suffix, and two log-line asks (#169, #142).
- **The page's only contributor link pointed at `docs/roadmap.md`, which does
  not exist** — a 404. It now points at the brief, the coding-assistant helper
  and `STATUS.md`, with drafts sent to `/feedback`, one item per post (the box
  holds 4,000 characters).

**The brief itself** gained what it lacked since July: current sizes and
routing (the dashboard is authored in `dashboard.html`; web previews on beta),
the public-repo rules (attribution by role, never a character → player
mapping, no machine details), UI-as-options, colour semantics, the overlay
chrome + mini mode, test discipline, and Supabase's cost model.

**Names on public pages.** The roadmap's prose carried nineteen member or
character names — credits ("Reported by …"), another member's attendance
record, an alt-family reference ("…'s family has 83 …"), a
character-with-its-player pairing in a fleet example, and a set that read as
one person's mule characters. All are roles now, or the invented placeholders
where an example needs a name-shaped token. ⚠ **Seen and NOT fixed** (outside
this change): names in `docs/STATUS.md` (five places), a member's handle in an
agent comment, a mob-name-shaped member reference in an agent comment, and the
third-party OpenDKP maintainer named in `web/app/opendkp/page.tsx` (the rule
says "the upstream maintainer"). A sweep task is queued.

## §21 — Privacy audit, and the privacy statement rewritten to match the code (2026-09-25, web 1.8.5)
*2026-09-25 · DECISIONS-2026-09-21.md · Privacy audit; statement rewritten to match code*

The guild lead: *"do a privacy audit and update the privacy information. are
there application privacy best practices we can make claims about?"*

**How it was checked.** Three read-only audits ran in parallel — the Mimic
client and agent, the bot and database (aggregate SELECTs only, no personal
data read out), and the website (code, public pages, count-only queries). Each
claim on the old page was marked true, partly true or false with file:line
evidence. `docs/PRIVACY.md` and `/privacy` were then rewritten from the
evidence, not from the old text.

**Fixed live the same night.** Two SECURITY DEFINER functions were executable
with the public key — the 11-argument `bump_agent_upload_stat` (added
2026-09-01; the July lockdown revoked only the two older overloads by exact
signature) and `prune_opendkp_call_stats`. EXECUTE is now service-role only
(`20260925021113_revoke_public_exec_upload_stat_and_prune.sql`, applied and
committed). The bot kept writing upload stats afterwards (133 rows in 15
minutes).

**What the old statement got wrong** (dated 2026-05-30, partly updated since):
- "We never upload tells" — the opt-in tell relay stores tells in both
  directions, the other party's words included.
- "Only what you opt into is synced" / "no agent running = nothing collected" —
  about twenty streams are on by default once Mimic is signed in, and other
  raiders' agents record people who never installed anything.
- "No out-of-raid position collection" — your own live status (position
  included) goes out whenever Zeal is connected, in or out of a raid, even with
  logging off, and it ignores both exclusion switches.
- "Never cross-guild" (raid positions) — the raid roster upload includes
  pick-up members from other guilds.
- "Only opens EQ's own log" / "no startup changes" / "one server plus GitHub" —
  it reads Zeal's feed, ini and UI files, exports and crash files; the installer
  turns on Start with Windows; it also talks to public time servers, Zeal's and
  UI packs' GitHub repos, and Amazon's sign-in for OpenDKP.
- "Exclude any character from stats" — by design it stops only your own
  uploads (the 2026-08-13 decision), and deletes nothing.
- "See everything we have on you on /me" — /me shows a fraction; there is no
  export.
- Crash reports: "metadata only" undersold it, and "nothing older than 30 days"
  holds only on the first sweep.
- Not disclosed at all: the Discord email, sign-in IP/browser records, page-view
  logging, cookies, the retention reality (most data kept indefinitely; a
  permanent archive and 30 days of full backups on the guild lead's server),
  the sub-processors, and AI coding sessions' database access.

**What the new statement promises** — only what the code keeps today: open
source; private channels filtered on the user's PC first; sensitive features
off by default (tell relay, crash reports, old-log uploads, UI backups, log
attachments); no selling, ads or third-party trackers on the site; encrypted in
transit and at rest (with the at-rest layers named); members-only website pages.
And a **"What we can't promise yet"** section: no deletion dates for most data,
no self-serve export or delete, opt-outs that don't reach backwards, and other
raiders' Mimic recording you. Editing rule, in the file's header: *describe what
the software does today; a promise goes in only once the code keeps it.*

**Kept out of the public statement on purpose.** Some audit findings are
security weaknesses rather than data flows. The page does not describe them and
neither does this file; the guild lead has them from the session. A data flow
gets disclosed; a way in does not.

**Best-practice frameworks, and where we stand** (the second half of the ask).
We can say we follow these *in part* — never "compliant", which is a legal
claim we have no basis for:
- **Privacy by Design** (Cavoukian's 7 principles): meets *visibility and
  transparency* (open source + the new page) and partly *privacy as the
  default* (sensitive features off). Misses *full lifecycle protection* (no
  retention for most data) and *respect for user privacy* (no self-serve
  controls).
- **GDPR Article 5 principles, as good practice** (we are a hobby guild, not a
  data controller claiming compliance): *transparency* now met; *data
  minimisation* partly (filtering on the PC; but server-wide /who and position
  every few seconds); *storage limitation* not met; *integrity and
  confidentiality* partly.
- **Mozilla's Lean Data Practices** ("stay lean, build in security, engage your
  users"): engage — met by the page; stay lean — partly.
- **OWASP Top 10 Privacy Risks**: *non-transparent policies* is addressed by
  the rewrite; the ones that still apply most are *insufficient deletion of
  personal data*, *collection of data not required for the primary purpose*
  (server-wide /who), and *missing or insufficient session expiration* (Mimic's
  sign-in tokens never expire).

Also in this change: the real character name in the page's hail example became
the invented `Brackwyn`; the relayed-tell quote in §4 lost the character name;
`CLAUDE.md`'s "HTTP-only cookies" and "excluded characters never contribute or
display" lines were corrected; the roadmap gained the Web 1.8.5 entry.

## §36 — Security audit before a public guild-logo page; two fixes live; 3.0 = the overlay engine (2026-09-26)
*2026-09-26 · DECISIONS-2026-09-21.md · Security audit before public logo page*

**The guild lead:** *"could we make a site for the other guilds to upload their
consolidated logos to turn into zeal icons? it's inviting traffic into our site so
we need to do a security audit first. so far people are receptive to more icons"*

**How it was checked.**
- **In parallel:**
  - a read-only audit of the website (sign-in, every route handler and server
    action, headers, uploads);
  - a read-only audit of the bot's HTTP surface (every route, auth, limits);
  - the database: Supabase security advisors, and every policy that lets
    `anon`/`authenticated` read. Schema and counts only; no member data was read.
- **The most severe claim was reproduced before anything was reported**, locally,
  against a fake Supabase that logged each query.

**Kept out of this file on purpose**, as in §21: the findings themselves, how they
could be used, and their evidence. The guild lead has the full report privately. A
data flow gets disclosed; a way in does not.

**Fixed live the same night:**
- **web 1.8.10**: every `/admin` page that loads data now calls `requireOfficer()`
  (`web/lib/officer.ts`) as its first statement, instead of relying on the admin
  layout alone.
  - Verified locally before and after.
  - `test/admin-pages-officer-gate.test.js` walks every admin page and was
    mutation-checked.
- **bot 3.1.150**: `_tuningForAgent()` sends each agent only the tuning keys its role
  needs.
  - `test/tuning-for-agent.test.js` covers it.
  - The guild lead is to rotate the credential it concerned.

**Decided for the logo page (recommendation, the guild lead to confirm):**
- **Outsiders never get a member-grade session.** The membership work in the private
  report lands before any page invites outsiders to sign in.
- **Near-term: a public gallery plus a Discord intake.** Logos go to an officer; no
  upload on our site.
- **Later: an anonymous upload with a CAPTCHA** into a private bucket, officer-
  approved. PNG only, checked by content, capped, re-encoded; originals are never
  shown publicly.
- **Conversion stays offline, on our side.** Each new icon is a Zeal build, the same
  as the 30 guild marks (§33).

**Also decided tonight (the guild lead):**
- **Mimic 3.0 = the overlay engine.** *"a HUD/overlay builder engine where we could
  combine everything into a single transparent freeform view, or be able to have it
  see the screen and move windows accordingly"* · *"in fact that will be 3.0. can
  we have an alpha channel"*.
  - It gets an **alpha channel** of its own.
  - Traps to design around:
    - Mimic treats any pre-release as beta, so alpha needs its own updater channel
      and an opt-in;
    - old alpha releases must be pruned so they never push betas out of GitHub's
      10-entry release feed (the Linux lesson, 2026-07-30);
    - the build workflow must live on the alpha branch itself.
  - Planned, not built.
- **Clicky charge counters on the HUD.** A zeal-suggestions thread asks for a
  last-charge warning (`/protect expendable`). The Quarmy export's per-item count,
  merged with the clicks the agent sees, gives charges left.
  - Queued, not built.

## §37 — A private briefing doc for read-aloud status and private decisions (2026-09-26)
*2026-09-26 · DECISIONS-2026-09-21.md · Private briefing doc for read-aloud status*

**The guild lead** (while driving, after asking for the status to be read back):
*"a secure place for the outputs … and for the decisions … so that we can more
easily turn that over for text to speech to tell me what the current status is
without exposing all of the decisions publicly"*.

**The call:**
- The home is a **private claude.ai doc**, titled "Wolf Pack — private briefing".
  It is not a repo file, because the repo is public.
- **What it holds:**
  - a Read aloud status, rewritten at the end of each session's work;
  - the Waiting on you list;
  - private decisions;
  - one tab per private audit report. The September 26 audit report is its
    first tab.
- **This file stays the default** for every decision that isn't sensitive. A
  private call gets a pointer here only when other sessions need to know about it.
- **Where it landed:** CLAUDE.md, under the "decisions get written down" rule.
  - Sessions find the doc by its title. Its link is never committed.
  - **Untested:** whether Claude in the phone app can open the doc by voice
    request. The fallback is the phone's own read-aloud on the open doc.

## §94 — Companion suite review, round two: settings pages, bandolier, spell sets, maps, the gear finder (2026-09-29)
*2026-09-29 · DECISIONS-2026-09-21.md · Companion app review, ideas to borrow*

The guild lead kept sending screenshots of the same app: *"bandolier builder looks really clean as are
spellsets"*, its Settings pages (audio, accessibility, navigation, overlays, spell timers, DPS meters,
Discord, maps, advanced), its raid summary, and *"THIS GEAR UPGRADE FINDER IS INTERESTING"* / *"Overview
tells me what gear scores i could replace"*.
- **All of it is in the review doc** (a claude.ai doc in the guild lead's artifacts, "Companion suite review —
  what we don't have yet"; the other app is not named there by request). **Counts now: 28 missing, 38
  partial, 19 covered.** Each item was checked on all four surfaces.
- **The gaps worth knowing about first:**
  - **A client version check.** Our Client versions card shows the eqgame.dll build from `/zeal version`
    but compares it with nothing. A check against known-good builds would have flagged §88's wrong
    eqgame.dll.
  - **The gear upgrade finder** (L), written up in the doc's closer look:
    - by slot, and an overview of each slot's best upgrade by score;
    - class weights (off / low / med / high / crit) with rules for the attack, haste, mana-regen and
      weapon-damage caps; filters.
    Ours would build on the gear page's worn totals and caps, the item mirror and the wishlist. Ours could
    also rank against what the guild actually loots.
  - **Zone maps with in-game map markers** written to Zeal's map files (L).
  - **Per-overlay lock modes:** interactive, click-through, display only.
  - **Timers that stay red until recast.**
  - **Mimic's own voice settings:** volume, speed, voice.
- **Nothing is queued.** Waiting on the guild lead to say which gaps to build.

## §135 — New pages go live marked [beta]; beta pages come with links; Sonnet agents do the scoping (2026-10-03)
*2026-10-03 · DECISIONS-2026-09-21.md · New pages live with beta marker*

The guild lead, opening an eight-part request: *"for research or preliminary coding you need to do spin
up sonnet agents. first, give me the links for beta pages when you reference them. I'm not always going
to scroll through beta to check. push them up to live to start if it's a new page that didn't exist
previously, and mark the page as a [beta] at the top so people know it's new. we can iterate over the
preview b.wolfpack.quest for new versions of existing pages unless I say to make main changes."*

- **A new page ships to `main`, with a `[beta]` marker at the top.** A route that does not exist on
  `main` no longer waits on `beta` for a pick. Changes to a page that already exists keep iterating on
  `b.wolfpack.quest` until the guild lead says to put them on main. This narrows the 2026-09-04
  "never straight to production" rule to existing pages. CLAUDE.md updated.
- **Every beta page I mention comes with its link** — `https://b.wolfpack.quest/<path>`, with the `?v=`
  for a variant.
- **Scoping and first-draft code go to Sonnet subagents**, several in parallel. The shipping session
  still reviews, runs the gate and writes the docs. CLAUDE.md has the rule.
- **The two new pages that were waiting on beta went live (web 1.8.81):**
  [`wolfpack.quest/zeal-icons`](https://wolfpack.quest/zeal-icons) (and layout B at `?v=b`, with a page
  per guild) and `wolfpack.quest/db/recipe/<id>`. Both carry the tag, built once as
  `web/components/NewPageTag.tsx`, and their titles and link previews start with `[beta]`. The recipe
  page is linked only from the item page's beta layouts, so on production it is reached by its
  address until the item page graduates. Everything else on beta is a change to an existing page
  (about, the item page, /pop, /pop/guide, /pvp) and stays there.
- The other seven parts of the same message are below as they land (§136 onward).

## §148 — Options carry a few-word "what makes it different"; Discord setup belongs on the website (2026-10-04)
*2026-10-04 · DECISIONS-2026-09-21.md · Options need short what's-different lines*

The guild lead, answering the onboarding A/B/C (`docs/DESIGN-onboarding-overhaul.md`, 2026-10-03 refresh):
*"when you ask me a/b/c I need you to give me a few word view of the suggestion, what makes it different or
special.. I feel like the discord setup is probably frustrating for people. setting up the threads should
just be a spot in the website, wolfpack.quest and then permissions reviews, scheduled tasks, etc"*.

- **Rule, standing:** every option offered for a pick leads with its letter, a short name and a few-word
  line on what makes it different, before any mock or cost. Landed in CLAUDE.md under the reply-shape rule.
- **Direction:** the bot's Discord setup — which channel or thread each card goes to, checking the bot's
  permissions, the scheduled jobs — should be a place on wolfpack.quest, not env vars and Discord commands.
  Same line as "Discord is a projection" (2026-08-16) and the self-host wizard epic. Being mapped; options
  follow in the same shape.

## §279 — Every page named in a reply is a full link (2026-10-13, docs)
*2026-10-13 · DECISIONS-2026-09-21.md · Replies name pages as full links*

- **The call** (the guild lead): *"give me direct links from now on not just the /page"*. A reply names a page as
  `https://wolfpack.quest/<path>` (live) or `https://b.wolfpack.quest/<path>` (beta), never a bare `/<path>`.
  It widens the beta-link rule (§135) to every page. Landed in CLAUDE.md under the UI working rule.
- **Also asked:** *"this stuff can also go on /screen"*: the raid plan on https://wolfpack.quest/screen.
  Options offered the same night; the pick is open.

## §332 — Tonight's release: what landed where, the Vercel cap, and the #raid-chat card (2026-10-14, before the raid freeze)
*2026-10-14 · DECISIONS-2026-09-21.md · Release day ledger and Vercel build cap*

The guild lead: *"after that push all of this up to main, update the linux client and alpha"*, *"also push the updates for web to main,
the popflags pages, links to latest"*, then *"make a raid chat post about all of the updates"*; timing picked: before 19:30 ET.
- **Main, in push order:** web 1.8.158 `42c117c4` (/pop pages from beta, `/pop/latest` new and marked [beta], linked from /pop) ·
  bot 3.1.265–3.1.267 (`2954945a`, `7de550ea`, `e4ec8827`, the one-shot card) · **stable Mimic 2.9.1** `0cf809fb` (agent 3.7.176,
  web 1.8.159 roadmap; pushed on its own, so the release body is its player notes, verified) · golden expectations `7c7b2203`.
  The 2.9.1 release carries its installer.
- **Beta:** chat breakout merge + 🔗 lock-together `acd4f048`, then a hand merge of main with the 2.9.2 re-park `5d24287b`: sync-beta
  would have stopped on `web/package.json`, `web/lib/roadmapData.ts` and `docs/HOW-ITS-BUILT.md` (main's side taken; beta's 1.8.151
  pronunciation roadmap entry kept, its 1.8.152–1.8.157 entries dropped as superseded by 1.8.158).
- **Alpha:** hand-merged from beta `106e9a7c` (sync-alpha had failed since 05:33 UTC); later beta pushes merge clean.
- **Linux:** `claude/deck-156-refresh` merged beta `acd4f048`; `build-mimic-linux` run 41 → `2.9.1-linux.41`. Focus-gate switches stay
  Windows-only in the Linux tray (`7247a5ec`). Untested on a Deck.
- ⚠ **Vercel refused the web push: "Deployment rate limited".** Hobby's 100-a-day cap: 100 deployments since 00:38 UTC (62 beta,
  38 main; 85 of them skipped builds, which still count). So production does NOT yet show web 1.8.158/1.8.159 (`/pop/latest` answers
  404). Slots free as yesterday's deployments age past 24 h; a redeploy of main's head is scheduled for 00:40 ET, after the freeze.
  Every push to main also spends a beta slot through sync-beta, so the busy days are the ones that hit this.
- **The #raid-chat card** (`_announceMimic291Once`, latched `announce_mimic_2_9_1_raid_chat`): the 2.7.8 card's shape, pings nobody,
  and waits for BOTH the v2.9.1 installer and `/pop/latest` answering something other than 404, because the card links it. It looks
  every 5 minutes for 24 hours. It reads the guild id through `supabase.guildId()`; an inline fallback broke `guild-tag-rest`'s ceiling (3.1.267).
- **Golden log** had failed on beta since agent 3.7.172 (avoid lines now carry the swing verb) and on main since the cut: the
  expectations were never regenerated. Additive change, regenerated.

## §354 — Security round one: Mimic's local server, bot floods, share-link abuse; live replay; the sync was broken (2026-10-17)
*2026-10-17 · DECISIONS-2026-09-21.md · Security audit round one fixes*

The guild lead asked how exposed we are (doxing, DDoS and script kiddies, someone signed in, a member's PC or login
stolen), then *"go ahead, fix 1 and 2, and also account for abusing views of the external sharing links"*. Two audits
ran; every finding below was re-checked by hand before it was acted on. **The unfixed findings are in the private
briefing, not here** — they name ways in.
- **Mimic's local server answers only Mimic** (agent 3.7.195, beta). Any web page open while Mimic ran could POST to
  127.0.0.1 (DKP ticks, bids, the Mimic login, shutdown). One guard runs first in the router: Host must be loopback
  (DNS rebinding), a present Origin must be loopback or file:, `Origin: null` needs a per-launch secret Mimic adds to its
  own requests (`x-wolfpack-local`; allowed when no secret is configured, so a new agent under an older shell still
  works), no Origin passes. The dashboard's damage table also printed other members' names as HTML; escaped now.
  ⏳ Not run in Electron here: a beta tester confirms the overlays still load.
- **Bot floods** (bot 3.1.292). The login cache only grew (every random `wpms_` token cost a store read and stayed
  cached). Now: token shape checked before any lookup; found logins capped at 10,000, misses in a separate 2,000-entry
  60 s cache; per-IP limit 1,200/min (`/health` exempt) and failed logins 60/min (tuning `ip_limit_per_min`,
  `ip_failauth_per_min`, 0 = off); client IP from Railway's `X-Real-IP` (the first `X-Forwarded-For` hop was spoofable);
  `unhandledRejection` logs instead of exiting. Railway showed 14 M requests/week, almost all the fleet; the 4xx rise
  since 2026-10-14 is one install with a dead login retrying ~1.5/s, not an attack.
- **Share links** (web 1.8.176). Per-IP 30 page loads/min per share and 300 API calls/min (a long scrub is ~150);
  per share 600 views and 20,000 calls an hour; lookup memoised 60 s; replay and bosses cached across visitors for
  **60 s** (an opt-out leaves a share within about a minute — chosen over the drafted 5 min); revoke clears and
  revalidates at once; views counted once per visitor per 30 min; robots.txt and noindex on every share response.
  Limits are per server instance.
- **Checked and false:** "anonymous key can read Mimic link codes / live state" — both tables are RLS-on with no anon
  grant, and no public table lacks RLS (queried live).
- **Live replay** (web, beta — https://b.wolfpack.quest/spectator/replay; the guild lead: *"spectator should continuously
  pull fresh raid days so it can be used live"*). Night list re-pulled every 60 s while visible, merged in place; a short
  window refetches as the night grows; **● Live** follows the newest minute. Recording is per minute, so Live trails by
  ~1–2.5 min. `/spectator` already polls every ~3 s.
- **The main → beta sync had failed on every push since bot 3.1.290** (web `package.json` 1.8.172 on beta vs main's
  bumps, plus two roadmap entries). Merged by hand. **Rule from now: a beta-only web change does not bump
  `web/package.json`** — the version lives on main, and a beta bump collides with the next main bump and stops the sync.
  Check `sync-beta.yml` runs when beta looks stale.
- ⏳ The guild lead (dashboards): Supabase → Auth → confirm "Allow new users to sign up" is off; a Vercel Firewall
  rate rule on wolfpack.quest; hardware-key 2FA on GitHub, Railway, Vercel, Supabase, Discord, Porkbun.

## §355 — Minor versions, the release name, and the road to 3.0 (2026-10-17)
*2026-10-17 · DECISIONS-2026-09-21.md · Minor version bump, release name, road to 3.0*

- **Bot 3.2.0 and web 1.9.0** (the guild lead: *"move to the next minor versions"*): onboarding "what's new" for 3.2.0 and
  a roadmap entry.
- **Release name: "Security Metapod and Live Optics"** (the guild lead: *"call this one security metapod and live
  optics"*) — bot 3.2.0 / web 1.9.0 and the Mimic 2.10.0 / agent 3.8.0 line. On the roadmap entry; use it in the
  Mimic park commit and any announcement.
- **No 2.10.0 stable** (the guild lead: *"we're going to work on 3.0 next, so park 2.10.0 but probably going to swap over
  to 3"*): beta parks at 2.10.0 (agent 3.8.0) once the encrypted chat cache and the session-review class labels land;
  the next stable is expected to be 3.0.
- **Alpha vs beta regression check:** every beta commit is in alpha (the beta → alpha sync is green again); alpha's
  diff is Mimic files and their tests only (+6.4k / −108). Every removed line was traced to a deliberate alpha rewrite
  (Canvas, group hotkeys, larger but still bounded layout limits, `lock`/`group` set verbs, HUD presets); `/pipe mimic
  edit` coverage moved to `test/canvas-pieces.test.js`. Alpha passes 13,809 tests with the same 9 long-standing failures
  as beta (tray-menu-layout ×5, mimic-agent-only-mode, mimic-destroyed-window-guard, window-process-names,
  my-logs-local). ⏳ Fix those nine before a 3.0 stable so they stop masking real breaks.
- **Update-or-pause plan** drafted in `docs/PLAN-update-or-pause-2026-10.md` (fleet: 33 players on 2.9.1, 7 older, 4
  beta). ⏳ The guild lead: what "shut off" means (pause uploads vs blank guild overlays), 7 or 14 days, beta testers in
  or out.

## §380 — One page for every open pick: the Decision Desk (2026-10-19)
*2026-10-19 · DECISIONS-2026-09-21.md · Decision Desk page for open picks*

The guild lead: *"give me one page with all the outstanding decisions to make and generate previews for each one so i
don't have to bounce back and forth finding them"*.
- A private claude.ai page titled **"Wolf Pack Decision Desk"** (find it by title in the guild lead's artifact list; the
  repo does not carry its link) lists every open pick from the Open table, each with its options, a one-line difference,
  a preview picture per option and a live link where one exists. Security round two stays in the private briefing.
- Four agents checked each Open row against later § entries and commits; rows already settled are listed at the
  bottom of the page as such (e.g. the Command Center hail slot, §165; the 3.0 name, §368; /pop alts, web 1.8.158).
  **The Open table still carries some of those rows: prune them when they come up.**
- Picks are stored in the page's database, collection `picks`, one document per decision id: `{choice, extras, note,
  at}`. A session reads them with `ArtifactData` (`action: list`, `collection: picks`) and builds from them.
- raidmimic.com went live the same hour (§370 row).

## §382 — The first Decision Desk picks, built; CI quarantine (2026-10-19, agent 3.8.20–3.8.25, web 1.9.10)
*2026-10-19 · DECISIONS-2026-09-21.md · First Decision Desk picks built, CI quarantine*

The guild lead picked nine decisions on the Decision Desk (§380), read back from its `picks` store. Built:
- **Timer row, A** (agent 3.8.24, `cd427777`): ⋮ beside the ✕ → Move to ▸ another timers panel / New panel (Canvas,
  by effect name, so every row with that name moves), Mute this session / always / this spell on this mob only.
  Mutes are `timer:<trigger|spell|spellmob|bar>:…` rules in trigger_rules.json (always) or a session Set, filtered where
  rows are built so every surface agrees; loot/auction rows cannot be muted. A 🔇 Muted timers card under Recent fires.
  Muting hides the row; a muted countdown's spoken pre-end warning goes quiet with it (the row is never sent).
- **Canvas across screens, A** (agent 3.8.25 for the dashboard switch, `13793efd`): "Span all screens", off by default,
  refused for mixed scaling. Panels carry `scr` + per-screen fractions; absent = home screen; panels on a missing screen
  hide (the callouts and catch-all timers panels come home instead); the screen-change question counts Canvas panels;
  exports keep the home screen only. Tray + dashboard Overlays tab.
- **Extended Target, A** (agent 3.8.20, `17e9d495`): a targeted player's timers ride on their row, same source as Target
  Info (`_targetPlayerTimers`), ≤ 8 lookups a poll, 3 chips then `+N`.
- **#petstats, B** (Mimic, `afc0e269`): click a Pet or Charm row to fold out the whole sheet (`apps/mimic/petsheet.js`).
- **Voice volume, A** (agent 3.8.22, `7b735a6c`): a 10–100 % slider beside Speed and Pitch, every voice engine.
- **Buff-dropped triggers, B** (agent 3.8.23, `1e44471e`): the five suggested triggers match each buff's own
  `spell_fades` line (Clarity "The cool breeze fades.", Aegolism, POTG "Your skin returns to normal.", haste "Your speed
  returns to normal.", damage shields); saved rows migrate on start. The guild lead's note asked for "dropping soon" on
  run speed, levitation and invisibility: invisibility already warns ("You feel yourself starting to appear.", server
  string 275); **the server sends no warning before levitation or run speed end**, so none was invented. Their after-the-
  fact fade lines are sourced ("You can no longer levitate.", "The spirit of wolf leaves you.", …) if wanted.
- **raidmimic layout, B** (web 1.9.10, `3449a678`, main): "The tour" is the page; layout A and its block copy removed.
- **Other games migration, A**: approved. `wow-land` holds the WoW reader rebased on main as bot 3.2.9 / web 1.9.11, with
  a guard found in the process: `/parses/[id]` would have failed every EverQuest parse page until the columns existed.
  Lands after the SQL paste.
- **PoP recast, A**: nothing to build (the data fix stays).
- **CI quarantine** (the guild lead: *"quarantine the five failing tests so CI goes green"*; main `a54ad1c3`, beta
  `970fca4e`): `test/quarantine.json` (main: my-logs-local, a dated fixture) and `test/quarantine.beta.json` (beta only,
  so the sync never conflicts: tray-menu-layout, window-process-names, mimic-agent-only-mode,
  mimic-destroyed-window-guard, and rampage-multi-boss, a fixture that only passes near 20:00). `vitest.config.js`
  excludes them; `test/quarantine-guard.test.js` fails on an expired or malformed entry. **All expire 2026-11-02.** Parked
  passing coverage: 46 tests on main, 160 on beta.

## §383 — Decision Desk round two: 32 more picks recorded, and an evaluation of the desk (2026-10-19)
*2026-10-19 · DECISIONS-2026-09-21.md · Second round of desk picks recorded*

Read from the desk's `picks` store (41 of 42 open decisions answered between 19:34 and 20:57; only `potime-model` is
unanswered). The nine of §382 are built; these 32 are recorded here so they do not live only in the page. Notes are
the guild lead's, condensed.

| Decision (§) | Pick | Note / what it adds |
|---|---|---|
| about-layout (§47) | B Tour | make new pictures for Planes of Power; add older pictures from previous expansions |
| buffs-groups (§149) | B Buff lines | |
| canvas-bg-lock (§44, §360) | leaning B Lock place and size | **do not build**: wants more detail and examples of the difference |
| chat-overlay (§300) | A all three channels | split channels by **Zeal's** channel options, not only the log's EQ breakdown ("a LOT ends up in Other"); officer + group in game are useful because the overlay can sit off the streamed screen |
| companion-gaps (§94) | A Gear upgrade finder; extra: Both | |
| discord-onboarding | A Doorway | the agent-release-DM extra was not answered |
| discord-setup (§148) | B Pick on the site | |
| eqmimic-demo (§123) | B, as a combination | one long scroll with a table of contents at the side |
| export-title (§376) | A use the set's name | already how it behaves |
| fb51-log-archive (§162) | A wire archiving into watch mode | renames logs over 500 MB on members' machines (first time watch mode does) |
| haste-foci (§155) | A fix the haste-focus reader | the trigger-votes extra was not answered |
| history-tank | A same list on both tabs | |
| history-target | A Pager | add a tab of recents |
| instruction-text (§168) | A fold in place | the "Also found straight to main" extra was not answered |
| item-page-b-c (§12) | C Grouped | **new request**: a Tradeskill overlay that highlights recipes for an item linked in raid/guild/group/say/tell, starred/pinned recipes, and an anonymous "who has this?" request that sends the holder a Mimic mail |
| keepers-outreach (§368) | A approve the draft; send when Publish works on beta | the draft was agent-written: re-read before any DM |
| npc-deaths-pvp (§132) | A keep posting | no change |
| pieces-way (§125) | B rebuild from pieces | **reverses §125's "A taken"**; condition: "too far apart … compactness is what made Target Info nice … B if we can make it look nice and keep all functionality"; both previews were judged too spread out |
| pop-essences (§96) | B by essence | |
| pvp-fights-layout (§46) | A Fight cards | |
| quest-nav | A drill-down blocks | the end-of-plane ▶ extra was not answered |
| raid-announcers (§169) | B the guild lead performs Bristlebane's voice | the eight persona extras were not answered |
| raid-split (§124) | B tick per raid | "we won't do ticks in multiple raids most likely; if we do, capture both"; **new**: capture a tick from the combined view, not only submit |
| session-parse-tables (§338) | A graduate to main | |
| setup-walkthrough (§93) | A the trail | |
| share-setup (§91) | A file + share code | |
| state-payload (§114/115) | leaning B trigger notes out of `/api/state` | **do not build**: wants a breakdown first |
| targetpet (§59e) | A `/targetpet` command | |
| tick-bars-dials (§56) | A Bars | |
| unfurl-boss (§215) | B name the boss in parse unfurls | **changes a CLAUDE.md rule** ("Metadata is PUBLIC" never names a parse's boss) and `test/page-metadata.test.js` |
| xp-defaults (§127) | A keep defaults | **new**: smooth XP/AA per hour so a `/resetexp` drop to zero followed by a spike is evened out |
| zeal-icons (§39/§213) | B Guild index | |

**Evaluation of the desk (what to change before round three):**
- It worked: 41 picks in ~85 minutes, after weeks of the same items sitting in the Open table.
- Follow-up chips get skipped: 7 of 8 decisions with `extra` questions came back with them blank (raid-announcers' 8
  all blank). Put each follow-up inside the option it belongs to, or make it its own card.
- Notes carry new work: 6 notes add features (Tradeskill overlay + Mimic mail, Zeal channel split, recents tab, PoP
  pictures, combined-view tick, XP smoothing). The desk needs a way to turn a note into a new item, and the reader must
  treat a note as a request, not as colour.
- "Not yet, more detail" is a real answer: 2 picks say do not implement. Add a "Need more detail" button so a lean is
  not mistaken for a go.
- Previews must be faithful: pieces-way's mocks were "too far apart", which steered the pick. Layout picks should use
  screenshots of the real thing, not drawn mocks.
- Engineering trade-offs (state-payload, haste-foci) were pushed to the desk although §10.6 rule 6 says the agent
  decides those; one came back "give me a breakdown". Apply rule 6.
- Policy changes hide inside a pick (unfurl-boss changes a CLAUDE.md rule; pieces-way reverses §125). Mark such cards
  "changes an earlier decision" with the reference.
- No lifecycle on the page: built picks still read "Picked". Show Built / In progress / Needs detail, and rebuild the
  desk after each round so it reflects §382/§383.

## §384 — Tranche 1 of the round-two picks, and Plane of Time C, built (2026-10-19)
*2026-10-19 · DECISIONS-2026-09-21.md · First tranche of picks and Plane of Time*

The guild lead: *"go on tranche 1, C for Plane of Time"*.
- **Tick overlay, bars only** (Mimic, `76f2015f`; agent 3.8.27): dials, the switch and `wp:tick:layout` removed.
- **Setup walkthrough, the trail** (`2349b01f`): the other layout and the tray/dashboard A/B entries removed; the stable
  hold lifted. Not made the first-run page (loading.html stays): a separate call. Web /start still describes the classic
  first-run order.
- **Log archiving in watch mode** (agent 3.8.29, `f3c9d797`, Fixes FB-51): see HOW-ITS-BUILT. A Windows check is owed: a
  log over 500 MB, its character logged out 15 min, then `[log-archive]` and a fresh log on login.
- **Chat channels from Zeal** (agent 3.8.30, `5c79f941`): Zeal's colour index on each printed line is a local hint for
  lines the log parser cannot place. Seven new chips under More (Money, Emotes, Pets, Who, Deaths, Broadcast, Zeal);
  "Other" on the golden logs 33 → 12; an `/abc 2` slot seen as officer stays Officer. The colour table is from Zeal's
  headers, unchecked against a live capture. §300's abbreviated tags are settled from Zeal's `chat.cpp` (G R P S O Sh A B
  Fr To + slot).
- **Share a whole setup by file or code** (bot 3.2.13 `dc28dc17` on main; agent 3.8.31 `a6e3e527` on beta): a 6-char
  code (no 0/O/1/I/L) valid 24 h in `bot_kv`, reusable, members only; 512 KB; 10 codes / 60 reads / 15 wrong codes an
  hour. Bundle = layouts, curated overlay options, HUD parts, personal triggers and rules; characters travel as slots
  c1–c12, never names; `utils/portableSetup.js` (byte-identical in Mimic) refuses private keys/values. Import previews
  with ticks, saves "Before <title>" first, one Undo. Version-pinning tests removed when renumbered.
- **Target Info pager + Recent** (agent 3.8.32, `adfaaaea`): last 50 targets in `logsync.targets.json` (24 h); ◀ ▶,
  All / Killed / Left alive, "killed 4m ago", ⟲ Recent. Whether an NPC corpse keeps the spawn id on Quarm is unmeasured.
- **Meter History on DPS or Tank** (`9febb42d`): while History is open, DPS/Tank choose the view (a behaviour change:
  they no longer leave History); tank rows store damage taken, biggest hit and damage shield.
- **Quest drill-down** (`f683e600`): era → plane → step blocks, ▲ climbs, ◀ ▶ inside the plane; 79 steps in 23 plane
  blocks from `scripts/pop-quest-planes.js` (groupings to check); end of plane = `QUEST_PLANE_END = 'stop'`.
- **Haste foci** (bot 3.2.11): read from `focus_effect`; detrimental-only foci limited to detrimental spells.
- **Plane of Time C, hybrid** (bot 3.2.12, `utils/potimeCycle.js`): an inferred 162 h cycle from the first PoTime
  activity, overwritten by an observed end; the Quarm /sll relay counts as observed (unconfirmed that a character's
  lockout equals the guild cycle; one line to unwire, `_handleAgentLockout`). `#timelockout` has no captured line yet.
  The board says "⏳ estimated" / "from /sll" / "from #timelockout".
- **Gear upgrade finder** (web 1.9.12 + 1.9.13 guild-tag fix): `/me/upgrades` [beta]; first slice; 14k-row first load
  per server cache (a SQL function is the next slice).
- **/targetpet**: `docs/upstream/zeal-targetpet/` (uncompiled; `set_target`'s signature is the likely compile fix).
- Process: several helpers used `sed`/python for single edits despite the Edit/Write rule; three helper changes met on
  beta and failed the share-setup key guard and the guild-tag guard until reconciled (`a9eae2b8`, web 1.9.13).

## §395 — Working rule: always give a recommendation (2026-10-20)
*2026-10-20 · DECISIONS-2026-09-21.md · Always give a recommendation rule*

The guild lead: *"always give me recommendations"*. Every set of options and every end-of-task reply says which option
would be picked and why. Written into the reply-shape rule in `CLAUDE.md`.

## §396 — Land a shared web change once (2026-10-20)
*2026-10-20 · DECISIONS-2026-09-21.md · Land shared web changes once*

Website commits that exist on both `main` and `beta` must not be landed as cherry-picked COPIES on `main` after `beta`
already merged them: it broke `sync-beta.yml` on 2026-10-20 (12 conflicts, resolved by hand keeping beta's side).
Land a shared web change once, then let the sync carry it.

## §406 — Encounter mechanics come from the server's scripts and our database, not guides (2026-10-21)
*2026-10-21 · DECISIONS-2026-09-21.md · Mechanics come from scripts and database*

The guild lead: *"we should always go off of the scripts and database instead of the guides."*
- **The rule:** timers, windows, add cadences, emote text, leashes and NPC facts are read from the server's quest scripts
  (`SecretsOTheP/quests`, cited by file and line at a pinned commit) and our `eqemu_*` mirror. Community guides
  (eqprogression, quarm.guide, PQDI write-ups) are leads to check, never the source; a guide-only claim is marked unverified.
- **What triggered it:** the Tactics timeline carried guide rules (both Decorins within 6 minutes, Tallon and Vallon within
  about 20) that `potactics/encounters/Rallos.lua` does not have: no window between the Decorins or the brothers, a leash
  past x 820, a 150-minute idle clock per boss paused while fighting.
- **Where it landed:** web 1.9.26 (`PAIR_RULES = []`), agent 3.8.54 (pair countdowns removed, `pop-raids.js` reworded), the
  Rallos guild triggers re-sourced from the script (`source_pack potactics-rallos-script`), and a paragraph in CLAUDE.md's
  Domain policies. The Tower of Solusek Ro planner data (§407) was built the same way: every rule cites its `.lua` lines.
- **Sweep still to do:** re-source the rest of `apps/mimic/pop-raids.js` from the scripts.

## §410 — The 2026-10-22 Decision Desk picks, and what shipped on them (2026-10-22)
*2026-10-22 · DECISIONS-2026-09-21.md · Oct 22 desk picks and what shipped*

The guild lead picked on the Decision Desk (cards are the record; picks are the page's `picks` collection):
- **Planner 3D: C (true 3D), keep both as buttons** → live on main, web 2.1.0: a 3D button with **Real** (default, the EQEmu
  collision mesh) and **Floors** (stacked slabs). Officers drag pins in 3D. *"the 3d format looks really good and helpful for
  guidance. can we make dragging possible there"*.
- **Replay path: B (whole-night path, numbered kills)** → live on main (spectator replay and shared raids); the trail preview deleted.
- **Walk route: A (a switch)** → live: Straight · Walk route · Recorded; routes reach the saved plan only through Use this route.
  Walk route reads Quarm's own navmesh (EQMacEmu/Maps `<zone>.nav`, GPL-derived like the walls) through `/api/raid/navmesh`.
  Recorded (our live nights, averaged) beats walked where both exist. *"we should be able to take from that and average out the
  actual path rather than these straight lines"*.
- **Floor clutter: A (follow the current leg's floors)** → not built yet.
- **Brother-reset callout: A** → two guild triggers on the server's own line ("<brother> withdraws from battle and waits for you in
  the War Room", Rallos.lua:788 @ quests ea0c766), live in the guild set 2026-10-22.
- **Guest raids: A (tag them)** → not built yet (§408).
- **Off-night targets: A (Tallon and Vallon home wings), headline counts everyone present** → the planner's default already.
- **Next feedback batch: A (FB-92, FB-85, FB-80)** → queued.
- **raidmimic.com: D (Scene-first) with E's beats folded in**, next scene "Loot rolls + DKP bids"; note: *"Individual raiders or
  players get quite a bit out of the overlays, Raid Leaders and guild leaders get more out of the coordination and orchestration
  bits. It should really be a combination of these. Add in the items from E into D"* → not built yet.
Also shipped 2026-10-22: **Raid Mimic 3.0.1 stable** (agent 4.0.5: Map facing arrows by default with Slice/Off, raiders in another
zone kept off the Map — Zeal sends no loc for them and the agent had turned that into (0,0,0) — live/instance from the zone server
port, the saved raid route on the Map, Extended Target same-name rows, patch-corrected raid cards); **bot 4.0.5** (no Planar
Projection hail window when the raid stands in the War Room: the event Tallon/Vallon spawn none); **bot 4.0.6** (gallery accepts
"When charming"); **web 2.1.0** (the above). Beta re-parked at 3.0.2 with: HUD pieces (whole group → Ring arc, Thin/Normal/Thick,
Left/Center/Right, label turn), Charm "When charming", one Disc timer ("Disc: <name>" while running; all disciplines share one
reuse timer, `GetDiscTimerID`), warrior Shield (3 min reuse, 12 s, `Mob::StartShield`).

## §436 — Every bot error line is a bug: the sweep, the ledger and a daily watch (2026-10-25)
*2026-10-25 · DECISIONS-2026-09-21.md · Treat every bot error line as a bug*

The guild lead, after a Railway redeploy came up green with errors in its log: *"let's start watching these errors and
resolving them cleanly instead"*.
- **The rule (now in CLAUDE.md):** Railway shows every stderr line (`console.error` and `console.warn`) as an error.
  Each error signature is fixed at its cause, or, if it is an expected condition, logged once on stdout. A real
  failure stays loud.
- **The sweep, bot 4.0.14:** `/enragedeath` had never registered since 2026-06-26 (a 101-character description,
  Discord allows 100; `test/commands-load.test.js` now builds every command); the Raid-Helper sync stopped calling
  the retired v2 per-event route (~120 404s a day; the v4 listing already carries the signups, and `getEvent` moved to
  v4); chat_messages and character_aas batches are de-duplicated (Postgres 21000 / 23505); zeal tags go through
  `insertIgnoreDuplicates`; unmatched trash-mob uploads (~420 lines in 90 minutes), unmodeled DS formulas and partial
  quarm-notes reads moved to stdout, once. Zero error lines after the 4.0.14 boot.
- **The ledger:** `docs/ERROR-LEDGER.md`, one row per signature with its status. Watching: the 10 s Supabase timeouts
  (one on `encounter_threat_snapshots`). By design: the log-only admission budget line.
- **The watch:** a daily scheduled task, "Bot error watch", 9:44 am Eastern, reads 24 h of Railway error lines,
  compares them with the ledger and drafts fixes on a `claude/error-watch-<date>` branch (never main). **The guild
  lead picked A (2026-10-25): the watch drafts on a branch and reports; nothing reaches the bot until they say "ship
  it"** (B, shipping small fixes to main itself, was declined). It was saved
  without connectors, so the Railway connector has to be added to it in claude.ai's scheduled-task settings, or its
  runs stop at step 1 and say so.
- **Railway build failures** (`failed to fetch snapshot`, deployments 797f74f8 and 542e03cf, 2026-10-24) were Railway's
  builder: the snapshot uploaded, then could not be read back; a redeploy of the same commit built. In the ledger as
  infrastructure.

## §456 — Decisions live by feature set in docs/decisions/, searchable on the Decision Desk (2026-10-28)
*2026-10-28 · decisions/inbox/2026-10-28.md*

The guild lead: *"can we rip down all the decisions and just make one directory of decisions per feature set? we can
still carry forward new decision docs but they should get periodically merged into our structure"*, then *"build these
all into my decision deck with search ability"*.
- **622 entries** from the 22 dated logs, each sorted into one of 18 feature sets (`docs/decisions/<set>.md`, oldest
  first). The sort was made per entry from its title and opening by three Sonnet agents; a misfiled entry is moved by
  editing its set file and running `npm run decisions:merge`.
- **IDs are kept**, so every `DECISIONS §N` in code, tests and docs still resolves (`docs/decisions/README.md` indexes
  all of them). Entries of the older logs, which were cited by file, are `<date>/<n>`. The old files are pointers.
- **New decisions** go to `inbox/<date>.md` as `### <N>. [<set>] <title>` and are merged into the set files at least
  weekly; the session digest names the oldest inbox file. `docs/decisions/OPEN.md` replaces the old "Open — read this
  first" table.
- **The Decision Desk** gets an "All decisions" tab: search across every entry, filter by feature set, open any entry in
  full, link straight to one (`#log/§117`). Its data is `build.js json`, republished when the inbox is merged.
- Lost on purpose: only each old log's opening "previous file" lines; the old logs' superseded open tables stay in git
  (`git show 89d3c5f1:docs/DECISIONS-<date>.md`).
