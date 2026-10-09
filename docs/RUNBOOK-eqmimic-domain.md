# Set up eqmimic.quest (Vercel + Porkbun)

**For a Claude-in-Chrome tab, with Porkbun and Vercel already open and signed in.** Written 2026-10-08 for the guild lead.
Nothing here needs a password, a token or a card: if a step asks for one, stop and hand the tab back.

## What this is for

> **Superseded in part, 2026-10-09:** the root of the host is now a landing page and only `/feedback` is the form; see "Update
> 2026-10-09" near the end for the current behaviour and checklist. The text below describes the form-only state.

`eqmimic.quest` is a second, neutral front door on the **same Vercel deployment as wolfpack.quest**. It serves ONE page, the
anonymous feedback form, and nothing else of the site. The code is already shipped (web 1.8.119): the middleware rewrites
every path on the `eqmimic.quest` and `www.eqmimic.quest` hosts to `/eqmimic/feedback`, and the layout drops the Wolf Pack
header. Signed-out Mimic users get a button that opens `https://eqmimic.quest/feedback#cat=bug` (or `#cat=idea`).

**The only thing missing is the domain wiring.** Today the domain's DNS points somewhere else, so that button leads nowhere.

## The end state (what "done" looks like)

1. `https://eqmimic.quest/` loads a plain page with the anonymous feedback form: no Wolf Pack header, no sign-in, no menu.
2. `https://eqmimic.quest/feedback#cat=bug` loads the same form with the bug category preselected.
3. `https://www.eqmimic.quest/` ends up on the same page (redirect or direct).
4. Vercel shows both domains as **Valid Configuration** with a certificate.
5. `https://wolfpack.quest/` is exactly as it was.

## Rules for the tab (read first)

- **Do not** buy, renew, transfer or auto-renew anything. **Do not** change the domain's nameservers. **Do not** touch any
  other domain or any wolfpack.quest record.
- **Do not** edit Vercel environment variables, deployments, team settings or billing. **Do not** delete a project.
- **Do not** submit the feedback form to test it (it writes a real report). Looking at it is enough.
- Before deleting or changing ANY existing DNS record, write the full list of records down (step 1) and say what you are
  about to remove. Remove only the records that conflict with the two below.
- If Vercel says the domain **is already in use by another project**, STOP and report which project holds it. Do not move it.
- Trust what the Vercel screen shows over any number written in this note.

## Step 1. Porkbun: look before touching

1. In Porkbun open **Domain Management** and find `eqmimic.quest`. Click **DNS** (the DNS Records panel for that domain).
2. Write down every record: type, host, value, TTL. Include the ones Porkbun adds by default for parking (an `ALIAS`/`A` on the
   root and a `CNAME` on `*`, pointing at a Porkbun parking host). Keep this list: it is the rollback.
3. Also note the nameservers shown for the domain. They should be Porkbun's. If they are not, stop and report.

## Step 2. Vercel: find the right project, add the domain

1. In Vercel open the team's project list. The project to use is the one that serves **wolfpack.quest** in production
   (repository `davehess/QuarmBossTracker`, root directory `web`). Open it. If you cannot tell which project that is, stop and ask.
2. **Settings → Domains → Add Domain**. Add `eqmimic.quest`. Assign it to **Production** (not to a branch).
3. Add `www.eqmimic.quest` too. When Vercel offers it, set `www` to **redirect to `eqmimic.quest`**.
4. Vercel now shows what DNS it wants for each name (usually "Invalid Configuration" with the records to add). **Copy those exact
   values.** Typically: an `A` record on the root, and a `CNAME` for `www`. Use what the screen says.

## Step 3. Porkbun: point the two names at Vercel

1. Back on the Porkbun DNS panel for `eqmimic.quest`: delete ONLY the conflicting default records on the root and on `*`/`www`
   (the parking ones from step 1). Say which ones you are deleting before you do.
2. Add the records Vercel asked for in step 2.4, exactly: the `A` on the root (host left blank) and the `CNAME` for `www`.
   TTL 600 is fine.
3. Leave everything else (for example any `MX` or `TXT` records) alone. Save.

## Step 4. Wait, then check Vercel

1. Return to Vercel **Settings → Domains** and press **Refresh** on each domain. DNS can take a few minutes, sometimes up to
   an hour. Do not change anything while waiting.
2. Both names should turn to **Valid Configuration** and Vercel should issue a certificate by itself. If a name stays invalid
   after an hour, re-compare the records in Porkbun with the ones Vercel shows and report the difference.

## Step 5. Verify (look, do not submit)

Open these in a fresh tab (a private window avoids cached DNS):

- [ ] `https://eqmimic.quest/` shows the anonymous feedback form and nothing from the Wolf Pack site.
- [ ] `https://eqmimic.quest/feedback#cat=bug` shows the same form with the bug category preselected.
- [ ] `https://eqmimic.quest/anything-else` still shows the form (every path on this host is rewritten to it).
- [ ] `https://www.eqmimic.quest/` ends up on the same page.
- [ ] The browser shows a valid padlock on both names.
- [ ] `https://wolfpack.quest/` still loads the normal site.

## Step 6. Report back

Reply with: the Vercel project you used, the records you removed and added (type, host, value), the Domains status for both
names, and the result of each check above. Include anything that looked odd.

## If something goes wrong

- **"Already in use by another project"** in Vercel: stop, report the project name. (A separate landing-page project in the
  guild lead's other repo may hold it; that needs a decision, not a move.)
- **Wrong page shows** (the full Wolf Pack site on `eqmimic.quest`): the domain is on the right project but the new code has not
  deployed to Production, or the host is not matching. Report; do not edit anything.
- **Rollback:** remove both domains in Vercel (Settings → Domains → Remove), then restore the Porkbun records from the step 1
  list. wolfpack.quest is untouched either way.

## Update 2026-10-09: the root is now a landing page (DECISIONS §209)

The routing change this section used to defer has been made (branch `claude/eqmimic-landing`, [beta]; check that it is on
`main` before you rely on the checklist below). On `eqmimic.quest` and `www.eqmimic.quest`:

- `/` (and `/index`, and **every path except `/feedback`**) shows the **landing page** for someone new to Mimic (video first; the
  guild lead picked that structure 2026-10-09 and the three layouts were retired). Every query parameter is dropped; a
  recorded scenario is linked by a `#clip-<slug>` fragment instead.
- `/feedback` still shows the **anonymous form**, and `#cat=bug&text=…` still reaches it (Mimic opens exactly that address).
- The page is `noindex` and carries a `[beta]` badge until the guild lead says it is settled. It is previewed without DNS at
  `https://wolfpack.quest/eqmimic` and `https://b.wolfpack.quest/eqmimic`.

**Verification checklist for the new root behaviour** (replaces the "/ shows the form" lines in step 5 once this is on `main`):

- [ ] `https://eqmimic.quest/` shows the landing page (the "Wolf Pack Mimic" heading, the large video player with its scenario
      picker, the gold "Fan site notice" block directly under it), with no Wolf Pack header or sign-in.
- [ ] `https://eqmimic.quest/#clip-triggers` opens with the "Triggers and timers" scenario selected; clicking another one
      changes the address to its `#clip-…`.
- [ ] `https://eqmimic.quest/?v=b` (or any other query) shows the same single page.
- [ ] `https://eqmimic.quest/feedback#cat=bug` still shows the form with the bug category preselected.
- [ ] `https://eqmimic.quest/anything-else` shows the landing page (not the form).
- [ ] The landing page's Download button opens `https://wolfpack.quest/mimic?direct=1`.
- [ ] `https://wolfpack.quest/` is untouched.

## Not part of this task (for the guild lead to decide later)

- The demo pages in the `hesstastic` repo are a separate design and do not share this domain.
- The Mimic "Send anonymously" button and the officer review page (`/admin/feedback/anonymous`) need nothing more once the
  domain resolves.
