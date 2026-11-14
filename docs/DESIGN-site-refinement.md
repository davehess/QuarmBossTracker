# Site refinement: the audit, the design lab, and what is drafted

Started 2026-11-14 at the guild lead's request (DECISIONS §582). Covers both sites: `wolfpack.quest` (the guild's
pages) and `raidmimic.com` (the product pages, served from the same app).

The brief: remove the slop, add quality-of-life changes, condense areas that show too much at once (unless the page
is meant to be a full list of people or characters), and make the important data stand out, because the reader is
usually looking at the game as well. Everything is a draft with a few versions; the guild lead picks on the
Decision Desk.

## Where things are

| Thing | Where |
|---|---|
| The drafts, with made-up data | `https://b.wolfpack.quest/lab` (beta branch only) |
| A draft's versions | `https://b.wolfpack.quest/lab/<slug>?v=a` (b, c); `&bare=1` hides the lab frame |
| The recommended version on real data | the real page on beta behind a query, listed per draft below |
| The picks | the guild lead's Decision Desk, one card per draft |
| Code | `web/app/lab`, `web/components/lab`, `web/lib/lab` (registry, made-up people, fixtures) |
| The rule that keeps the lab closed | `test/lab-drafts.test.js`: nothing under the lab reads the database, the session, the request or a secret |

Nothing here is on `main`.

## What the audit found (nine themes)

The audit read every public page as a screenshot at desktop and phone width, and every member and officer page as
source (they need a sign-in). Ten area reports, merged.

1. **Explanation before the answer.** Pages open with a card whose heading repeats the nav label, then a paragraph
   on how the page works, then the data. The most common finding.
2. **Developer voice in member-facing copy.** Table names, version floors, docs paths, "mockup, stage 1", "option A /
   option B", an internal codename, the database vendor's name, a localhost address.
3. **Every number the same weight.** Rows of 4 to 12 identical stat tiles; roster rows with nine small items; danger
   and blocked states set no louder than the rest.
4. **Decorative colour and emoji.** Section headings rotate gold, orange, red, blue and purple with an emoji and no
   meaning, on a platform whose rule is that colour is semantic.
5. **Wayfinding is hand-written per page.** Four different link rows across the Planes of Power pages; no link from
   the flags page to "tonight"; five beta pills on one character page.
6. **Nothing is remembered and nothing knows who is looking.** Filters, tabs and the chosen character reset on every
   visit; no page marks the viewer's own rows.
7. **Phone layout.** Side columns land above the data, tables push the page sideways, data is set in dim 10px.
8. **Beta and new-page marks everywhere.** A new-page tag in 45 files, "[beta]" in titles and link labels.
9. **Unpicked variants are piling up.** 17 pages already carry a `?v=` variant.

## The targets, ranked by how often the page is read mid-raid

| # | Slug | Page | State |
|---|---|---|---|
| 1 | `boards-next-up` | Spawn boards | **Drafted.** A next up list (rec), B watch list with pins, C one table. Staged: `/boards?v=a` |
| 2 | `raid-roster-calm` | Raid HQ | **Drafted.** A alert first (rec), B group tiles, C job tabs. Staged: `/raid?v=a` |
| 3 | `site-header` | The top bar on every page | **Drafted.** A doors stay (rec), B plus a raid-tonight pill, C jump box. Staged: any page with `?hdr=a` (b, c; `?hdr=off` ends it) |
| 4 | `parse-result-first` | One fight's parse | **Drafted.** A result then table (rec), B tabs, C your role first. Staged: `/parses/<id>?v=a` |
| 5 | `pop-tonight-blockers` | Planes of Power raid night | **Drafted.** A blockers strip (rec), B one page with Raid and Mine tabs, C zone cards. Staged: `/pop/raid?v=a` |
| 6 | `rm-first-screen` | raidmimic.com first screen | **Drafted.** A hook beside the video (rec), B captures first, C two doors. Staged: `/raidmimic?hero=a` on the beta host |
| 7 | `page-chrome` | A shared page header, section tabs and table wrapper | Listed |
| 8 | `db-answer-first` | Database item and mob pages | Listed |
| 9 | `me-front-door` | /me | Listed |
| 10 | `character-identity` | Character page | Listed |
| 11 | `rm-guild-path` | raidmimic.com guild-leader path | Listed |
| 12 | `pop-flags-lead` | Planes of Power flags | Listed |

What each staged version does NOT have yet, so a pick knows its distance from done:

- **Raid HQ A** leaves out the old page's class bar, the mana and twitch lists, the buffer queues and the parked
  rows. Its thresholds (healer out of mana at 10%, hurt under 61% HP) are first guesses.
- **Parse A** marks no "you" rows on the real page: the page does not load the viewer's characters, and no database
  read was added for a draft.
- **Top bar A** paints today's bar for one frame before swapping (it is chosen in the browser). Gone at graduation.
- **PoP raid night B and C** are lab only: B needs the personal page's data on the raid page, C needs two new
  one-line fields per zone in the plan data.
- **raidmimic.com** drops every query on its own host, so the first-screen drafts run on the beta host only.

## Quick wins (small, no design choice; listed for one yes or no)

1. Raid HQ: remove the mockup subtitle and the "wiring next" box.
2. Buffs: drop the "stage 1 mockup" card above the grid; keep a small "Grouped view" link.
3. Boards: cut the paragraph under the title.
4. PoP flags: fix the link labels, add the missing "Tonight" link, remove the build-notes card.
5. Character page: remove the back link that always says "back to parses".
6. Fun page: remove the stale "What's new" block.
7. Admin sign-ups: remove the standing pitch for an integration that is not built.
8. raidmimic.com: "Register interest" opens in the same tab.
9. raidmimic.com: the band says "no sales form" above a twelve-field form; reword it.
10. raidmimic.com setup: a copy button on the PowerShell fix.
11. Database pages: the back link goes to the database and loses the internal codename.
12. Two tables that push a phone sideways: add the scroll wrapper.
13. Four long tables: keep the header row in view.
14. Tells: say "showing 50 of N" when the list is cut.
15. Footer: drop the sentence naming the database vendor.

## Rules a draft follows

- Versions are different trade-offs, never one layout in three colours.
- The answer is the largest thing on the first screen. Explanation is cut or folded.
- A full list of people or characters stays a full list.
- A healthy state is quiet; a problem is the loudest thing on the screen.
- Tokens only (`.claude/skills/frontend-design/SKILL.md`): no new colours, fonts, gradients or motion.
- Each version states four costs: build, maintenance, runtime, change.
- Made-up people come from one fixed list (`web/lib/lab/people.ts`); none of them is anybody.

## When a version is picked

1. Move its components from `web/components/lab/<slug>/` into the page's own folder; keep the pure mapping function
   (`web/lib/<name>View.ts`) and its tests.
2. Make it the page's default; delete the query switch, the other versions, the lab page, its fixture and its
   registry entry, in the same change.
3. See it with real data on beta before it goes to `main`: none of the staged versions has been seen that way.
