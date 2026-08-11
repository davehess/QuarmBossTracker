# Runbook — a local copy of wolfpack.quest on Unraid, via Coolify

**Decided 2026-08-11 (Hitya):** Coolify in a **VM on Unraid**, and the local site
points at the **local Supabase stack** (`RUNBOOK-unraid-supabase-replica.md`), so
nothing clicked locally can touch production.

**Why a VM and not bare Unraid.** Coolify's installer expects systemd and control
of the Docker daemon, and it runs its own proxy on ports 80/443 — Unraid's web UI
is on port 80. A VM sidesteps all of it and lets Coolify work exactly as
documented. (Coolify's dashboard is on `:8000`, same number as the Supabase
gateway, but they are different hosts so there is no clash.)

---

## Part A — the VM

Unraid → **VMS** → Add VM → Debian 12 (or Ubuntu Server):
- 2 vCPU, **4 GB RAM**, 40 GB vdisk
- Network: **br0** so it gets its own LAN IP (not the NAT default) — Coolify and
  the site need to be reachable from your desktop
- Install with SSH enabled; note the IP (referred to below as `<VM-IP>`)

## Part B — Coolify

SSH into the VM:
```
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
```
Then open `http://<VM-IP>:8000` and create the admin account.

## Part C — connect the private repo

The repo is private, so Coolify needs credentials. Easiest path:
**Projects → New Resource → Private Repository (with deploy key)**. Coolify
generates an SSH public key; paste it into GitHub → repo → Settings → Deploy keys
(read-only is enough). Then point it at `davehess/QuarmBossTracker`, branch `main`.

## Part D — application settings

The repo is a monorepo and the site is NOT at the root:

| Setting | Value |
|---|---|
| Build Pack | Nixpacks |
| **Base Directory** | `/web` ← the load-bearing one |
| Port | `3000` |
| Branch | `main` (or `beta` for a mirror of the beta line) |

`web/` has its own `package-lock.json`, so `npm ci` inside that directory works —
there is no npm-workspaces wiring to fight.

## Part E — environment variables

⚠ **`NEXT_PUBLIC_*` are baked in at BUILD time by Next.js.** In Coolify they must
be marked as **Build Variables**, not just runtime env, or the browser bundle
ships with them undefined and the site loads but can't reach Supabase.

```
NEXT_PUBLIC_SUPABASE_URL=http://192.168.1.5:8000
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY from the Supabase stack's .env>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY from the same .env>
NEXT_PUBLIC_SITE_URL=http://<VM-IP>:3000
DISCORD_GUILD_ID=1168893924329402420
ALLOWED_ROLE_NAMES=Pack Member,Officer,Guild Leader
NIXPACKS_NODE_VERSION=20
```

Use the LOCAL stack's keys — the ones generated for the Unraid compose, never the
cloud project's. They are different trust domains and the local anon key is the
only one the local GoTrue will honor.

At this point Deploy gives you the public pages. Sign-in needs Part F.

## Part F — Discord sign-in against the LOCAL stack

The sign-in gate (`web/app/auth/callback/route.ts`) does three things: confirms
guild membership via Discord's live API, resolves role IDs through the restored
`wolfpack_roles`, then upserts `wolfpack_members` **`onConflict: 'discord_id'`**.
That last detail is why this works locally at all: the row keys on Discord ID, so
a local GoTrue user with a brand-new `auth.users` UUID still lands on the restored
member row. **No second Discord app and no second Supabase project** — the trap
documented in CLAUDE.md for `b.wolfpack.quest` does not apply, because we are
adding a redirect URI to the SAME Discord app.

### F1 — prerequisite: the Discord client secret

⚠ **Check this BEFORE anything else.** Discord shows a client secret once, at
creation. If it was never saved, the only way to get one is **Reset Secret**,
**which immediately breaks production sign-in** until the cloud project's Discord
provider is updated with the new value. If you must reset: update the cloud
Supabase provider config in the same sitting, and do it outside a raid window.
Look first in the cloud Dashboard → Authentication → Providers → Discord.

### F2 — enable the provider in the local GoTrue

Compose → `auth` service → `environment:` (the file already has commented
Google/GitHub/Azure examples in exactly this shape):
```yaml
      GOTRUE_EXTERNAL_DISCORD_ENABLED: "true"
      GOTRUE_EXTERNAL_DISCORD_CLIENT_ID: ${DISCORD_CLIENT_ID}
      GOTRUE_EXTERNAL_DISCORD_SECRET: ${DISCORD_SECRET}
      GOTRUE_EXTERNAL_DISCORD_REDIRECT_URI: ${API_EXTERNAL_URL}/callback
```
`.env`:
```
DISCORD_CLIENT_ID=<from the Discord app>
DISCORD_SECRET=<from the Discord app>
SITE_URL=http://<VM-IP>:3000
ADDITIONAL_REDIRECT_URLS=http://<VM-IP>:3000/**
```

⚠ **`ADDITIONAL_REDIRECT_URLS` is the same trap that broke beta sign-in**
(Hitya, 2026-08-10). `SignInButton` sends `redirectTo = window.location.origin +
'/auth/callback'`, and GoTrue **silently ignores a redirectTo that is not on the
allow list and uses SITE_URL instead** — nothing errors, sign-in just never takes.

### F3 — add the callback to the Discord app

Discord Developer Portal → your existing app → OAuth2 → Redirects → **Add**:
```
http://192.168.1.5:8000/auth/v1/callback
```
That is the Supabase GATEWAY's address, not the website's — Discord talks to
GoTrue, which then bounces the user back to the site. Keep every existing redirect
URI in place; this is an addition, never a replacement.

Then Compose Up the Supabase stack and redeploy in Coolify.

---

## What this gets you, and what it does not

- **Full site, real restored data, zero production risk.** Officer pages can be
  clicked freely; the writes land in the local copy.
- **The data is a SNAPSHOT**, refreshed only when you restore a newer nightly
  dump. It does not track production live (that was the deliberately-deferred
  replication path).
- **`/me` surfaces work** because they key off `characters.discord_id`, which is
  stable across the two auth stores.
- **Not a failover site.** If Vercel is down, this does not serve the guild — it
  has no public DNS, no TLS, and its database stops at the last restore.
