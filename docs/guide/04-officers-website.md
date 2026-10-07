# Stand up the website (for officers)

For an officer or host. At the end `https://<your-site>` serves the guild site from Vercel, members can sign in with Discord, officers reach `/admin`, and an optional beta mirror at `https://<beta-host>` shows the `beta` branch. You need the Discord application and Supabase project from chapters 03 and 05, and the bot running, because it fills the role tables the site's sign-in reads.

## 1. Create the Vercel project

1. Vercel → **Add New Project** → import the GitHub repo.
2. Set **Root Directory** to `web`. The repo is a monorepo and nothing builds without this.
3. Leave the framework on Next.js. `web/vercel.json` already sets `next build`, `npm install` and `.next`.
4. Add the environment variables (next section) **before** the first deploy, then deploy.

`web/vercel.json` also does three things you must know about:

- `git.deploymentEnabled` builds **only `main` and `beta`**. Every other branch is off.
- `ignoreCommand` is `git diff --quiet HEAD^ HEAD -- .`, so a push that changes nothing under `web/` is skipped.
- Three `redirects` belong to Wolf Pack's own subdomains (parser, discord, mimic). Delete or replace them.

⚠ `vercel.json` is strict-schema: Vercel rejects unknown keys, so never add a `comment` key.

**Check it worked:** the first deployment finishes and its `*.vercel.app` address renders the landing page. Sign-in will not work until section 4.

## 2. Environment variables

Enable **every** variable for both **Production and Preview**. The beta mirror is a Preview deployment, and a Production-only value leaves public pages rendering while server paths fail ("SUPABASE_SERVICE_ROLE_KEY not set"). Changes need a redeploy; `NEXT_PUBLIC_*` values are baked in at build time.

| Variable | Needed | Meaning |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | your Supabase project; the anon key is safe in the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | server only; the sign-in callback writes `wolfpack_members` past RLS |
| `NEXT_PUBLIC_SITE_URL` | yes | `https://<your-site>`, for canonical tags and admin links |
| `DISCORD_GUILD_ID` | yes | the server whose membership gates sign-in |
| `ALLOWED_ROLE_NAMES` | yes | role names allowed in; empty admits any guild member |
| `OFFICER_ROLE_NAMES` | yes | role names that open `/admin` |
| `SCREEN_TOKEN_SECRET`, `SCREEN_LIVE_URL` | optional | raid-screen feed from the bot; the secret must equal the bot's; the URL is `https://<your-bot-host>/api/screen/live` |
| `DEMO_OBFUSCATE_SALT`, `PARSER_DOWNLOAD_URL`, `DISCORD_INVITE_URL`, `NEXT_PUBLIC_EQ_ICON_BASE` | optional | demo-mode name salt, redirect targets, item-icon base |

> ⚠ `DISCORD_GUILD_ID` falls back to Wolf Pack's server in `web/lib/discord.ts`. Unset it and you check the wrong guild.

> ⚠ The website's `OFFICER_ROLE_NAMES` default is `Officer,Pack Leader`; the bot's is `Officer,Guild Leader`. Set it on both.

**Check it worked:** **Settings → Environment Variables** lists every name with Production and Preview ticked.

`NEXT_PUBLIC_IS_BETA` is not set by hand: `next.config.js` derives it from the branch being built (`VERCEL_GIT_COMMIT_REF` is `beta`; locally, `WP_FORCE_BETA=1`). It adds the banner, `noindex, nofollow` and "(beta)" titles. Keep the `noindex`: the mirror serves duplicate pages.

## 3. Domains and the beta mirror

1. **Settings → Domains:** add `<your-site>` and `www`. Vercel shows the DNS records to create at your registrar; set the apex as primary.
2. Beta: add `<beta-host>`, choose the **Preview** environment, and set **Git Branch** to `beta`. There is no "beta" environment.
   ⚠ A blank Git Branch makes the domain follow the newest preview from any branch.

`components/BetaBanner.tsx` links back to a hard-coded production host; edit it in a fork.

**Check it worked:** `https://<your-site>/` loads, and `https://<beta-host>/` shows the beta banner.

## 4. Supabase sign-in

All dashboard-only (Supabase has no API for it).

1. In the Discord application: **OAuth2 → General**, copy Client ID and Secret. Add `https://<your-project-ref>.supabase.co/auth/v1/callback` under **Redirects**.
2. Supabase → **Authentication → Sign In / Providers → Discord**: enable it and paste the Client ID and Secret. The site asks for `identify guilds.members.read` and uses the member's own token, so the application need not be in your guild.
3. **Authentication → URL Configuration:** Site URL `https://<your-site>`. Redirect URLs: `https://<your-site>/**`, `https://<beta-host>/**`, `http://localhost:3000/**`.

Why the beta entry matters: Supabase ignores a `redirectTo` that is not listed and uses Site URL instead. The member finishes Discord consent, lands signed in on production, and the beta page still says Sign in. Nothing errors.

Why only one Discord provider: Supabase allows one per project. A second Discord app would need a second project, members would get different `auth.users` ids, `wolfpack_members.user_id` would diverge and the mirror would stop matching production. Discord never sees the app host, only Supabase's callback.

For members Discord's verification wall blocks, an officer can issue username-and-password invites (`docs/RUNBOOK-site-access.md`); that needs the Email provider enabled and "Allow new users to sign up" left on.

## 5. Who gets in

Two gates run in `web/app/auth/callback/route.ts`:

1. **Guild membership,** checked with Discord using the member's token.
2. **Role,** where the member's role ids are turned into names through the `wolfpack_roles` table and compared with `ALLOWED_ROLE_NAMES`.

The bot fills `wolfpack_roles` and `wolfpack_members`: 30 seconds after boot, then every 6 hours (`/syncmembers` forces it). A newly promoted officer signs out and in again to refresh `role_names`. Mimic's sign-in page, `/auth/mimic-link`, also lives on this site; point the bot's `MIMIC_LINK_VERIFICATION_URL` at it (chapter 03).

The site logs each signed-in page view (page, referrer, browser) to `page_views` for officers' analytics. Signed-out visits are not logged.

**Check it worked:** open `/loadouts` signed out and you land on `/auth/signin`. **Continue with Discord**, approve, and the header shows your avatar. Repeat on `<beta-host>`.

## 6. Vercel Hobby limits (as recorded in CLAUDE.md)

- **100 deployments a day.** Every push to every branch spends one, skipped builds included; hence two branches only.
- **10 GB of deployment storage.** Each build keeps its output (about 40 MB of `web/public`) for 30 days by default. `ignoreCommand` stops web-free pushes storing anything.
- ⚠ `ignoreCommand` compares only a push's last commit with its parent: a web commit followed by a non-web commit in one push deploys nothing. Push the web commit last or alone.
- About 1M function calls a month, which is why the raid screen reads from the bot.

## Local development

```
cd web
cp .env.example .env.local   # fill in Supabase values
npm install
npm run dev                  # http://localhost:3000
```

Without Vercel, `docs/RUNBOOK-local-web-coolify.md` covers Coolify: base directory `/web`, `NEXT_PUBLIC_*` as build variables, and about 8 GB of RAM for `next build`.

## If it goes wrong

- **Signed in on production, beta still says Sign in:** the beta host is missing from Redirect URLs.
- **"SUPABASE_SERVICE_ROLE_KEY not set on the server" on beta:** the variable is Production-only.
- **"You need one of these roles… You have: (none)":** the bot has not synced roles, or its Server Members intent is off.
- **Everyone is "not a member":** `DISCORD_GUILD_ID` is unset or wrong.
- **`<beta-host>` shows another branch:** Git Branch was left blank.
- **Pages show `undefined` Supabase values:** `NEXT_PUBLIC_*` was added after the build; redeploy.
- **"Deployment rate limited":** Hobby's 100 a day; wait or reduce pushes.
