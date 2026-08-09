# resume/ — personal engineering profile (mimic.hesstastic.com)

A standalone, single-file static site. **Not part of the guild platform** — it
shares the repo only because that is where the Vercel account already points.
It has its own Vercel project, its own domain, and no build step.

## Why it is isolated

`web/` is the wolfpack.quest Next.js app and has its own `vercel.json`; its
Vercel project has Root Directory `web/`, so nothing in this folder can trigger
or break that deploy. This folder gets a SEPARATE Vercel project with Root
Directory `resume/`. Keep it that way — one project per site.

## Deploying it

**Root Directory depends on which repo this is sitting in** — that one setting
is the whole difference:

| Repo | Vercel Root Directory |
|---|---|
| Its own repo (`davehess/Hesstastic`) | **`.`** (repo root — the default) |
| Inside the QuarmBossTracker monorepo | **`resume`** |

Getting it wrong means Vercel builds the wrong directory and fails.

1. **Vercel → Add New → Project → import the repo.**
2. Set **Root Directory** per the table above.
3. Framework Preset: **Other**. There is no build step — `vercel.json` here
   pins `framework: null` so a stray auto-detect cannot start one.
4. Deploy. It will come up on a `*.vercel.app` URL immediately.
5. **Domains → Add `mimic.hesstastic.com`** to THIS project (not the
   wolfpack.quest one). Leave the Git Branch field on `main`.

## Moving it to its own repo

The site is fully self-contained, so the move is a subtree split — which keeps
the commit history for these files instead of landing them as one squashed
"initial commit":

```sh
git subtree split --prefix=resume -b resume-site   # already run; branch exists
git remote add hesstastic https://github.com/davehess/Hesstastic.git
git push hesstastic resume-site:main
```

Files land at the repo root (no `resume/` wrapper), so set Vercel's Root
Directory to `.` per the table above. Once it is live from the new repo, delete
`resume/` from the monorepo — leaving both copies means edits silently diverge
and the deployed one stops matching the one you are editing.

## DNS (Porkbun — human-only step)

There is no Porkbun integration: no MCP connector exists, no credentials live
in this repo, and `api.porkbun.com` is unreachable from cloud sessions. So the
DNS record is added by hand, in the Porkbun dashboard for `hesstastic.com`:

| Type | Host | Answer |
|---|---|---|
| CNAME | `mimic` | `cname.vercel-dns.com` |

Vercel's Domains tab shows the exact record it wants after you add the domain —
**believe that screen over this table** if they ever disagree, and use the ALIAS
/ A-record form it offers instead if you ever point the apex (`hesstastic.com`)
rather than a subdomain.

Propagation is usually minutes. Vercel issues the TLS certificate automatically
once the record resolves.

## Editing

One file: `index.html`. No framework, no dependencies, no build. Styles and the
scroll/count-up script are inline so the page has zero network dependencies at
render time and cannot be broken by a CDN outage.

The "To fill in" section near the bottom is a deliberate placeholder block —
title, contact, employment history, education. Delete that whole `<section>`
once those are filled in.

Every number on the page is measured from the production database
(`about_stats()`) or counted from the repo, as of 2026-08-09. Re-check them
before sending the link anywhere that matters.

## Why the "Pace & method" section never mentions hours

Deliberate. The section argues leverage — durable written state, gates, and
automation — and says nothing about when the work happens, because the commit
history does not support a "nights and weekends" claim and a reader can check:

| Window (ET) | Commits | Share |
|---|---|---|
| Outside 09:00–17:00 | 1,328 | 71% |
| Inside 09:00–17:00 | 523 | 28% |
| Mon–Fri / Sat–Sun | 1,381 / 470 | — |

A good chunk of the business-hours commits are automated or agent-driven rather
than hands-on, but a timestamp cannot tell a reader that. So the page makes the
throughput argument on method instead, which is both stronger and unfalsifiable
by `git log`. **Do not add an "evenings and weekends" line** — it is the one
claim on the page that could be checked and found wanting.

The token/spend figure is left out for the same reason: the repo does not record
it, and an estimated number on a page whose whole pitch is "measured, not
estimated" would undercut everything around it. Real number from the Anthropic
Console, or nothing.
