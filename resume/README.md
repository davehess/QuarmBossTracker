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

1. **Vercel → Add New → Project → import this repo.**
2. **Root Directory: `resume`.** This is the load-bearing setting; without it
   Vercel builds the monorepo root and fails.
3. Framework Preset: **Other**. There is no build step — `vercel.json` here
   pins `framework: null` so a stray auto-detect cannot start one.
4. Deploy. It will come up on a `*.vercel.app` URL immediately.
5. **Domains → Add `mimic.hesstastic.com`** to THIS project (not the
   wolfpack.quest one). Leave the Git Branch field on `main`.

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
