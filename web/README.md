# Wolf Pack EQ — Tracker (web)

**Production:** <https://wolfpack.quest>

Next.js 14 (App Router) + Tailwind + Supabase. Vercel-hosted companion to the
Discord bot and the local agent dashboard. Reads from the same Supabase the
bot writes to.

## Architecture

```
Local agent (your machine)
  └─ HTTP localhost:7777 → in-raid HUD, live damage, threat, mend counter

Discord bot (Railway)
  ├─ Persists to Supabase: parses, characters, bosses, chat, ...
  └─ Discord embeds: parse cards, scoreboards, /commands

This Vercel app
  ├─ Reads Supabase: shared loadouts, build planner, parse browser
  └─ Discord OAuth login (next iteration)
```

The agent + bot continue to do real-time work. The web app is the SHARED
view across the guild — historical, comparative, planner-style.

## Local dev

```sh
cd web
cp .env.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY from
# the same Supabase project the bot uses.
npm install
npm run dev
```

Open <http://localhost:3000>.

## Deploy to Vercel

1. Connect this repo on vercel.com → **Add New Project**.
2. **Root directory:** `web` (very important — it's a monorepo).
3. Set env vars in Vercel project settings (Production scope):
   - `NEXT_PUBLIC_SITE_URL=https://wolfpack.quest`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy. Vercel auto-detects Next.js 14.

## Custom domain (wolfpack.quest)

1. Vercel project → **Settings → Domains** → add `wolfpack.quest` and `www.wolfpack.quest`.
2. Vercel shows you DNS records to add at your registrar:
   - `A` record `@` → `76.76.21.21`
   - `CNAME` record `www` → `cname.vercel-dns.com`
3. Vercel issues TLS certs automatically once DNS propagates (usually a few minutes).
4. In **Domain → Edit**, set `wolfpack.quest` as the **primary** domain; the
   `www` host redirects to it.

Once the domain is live, also set the Discord OAuth redirect URI to
`https://wolfpack.quest/auth/callback` in:
- Discord developer portal (your app → OAuth2 → Redirects)
- Supabase Auth → Providers → Discord → Redirect URLs

## Discord OAuth setup

The site uses **Supabase Auth** with the **Discord provider**. End-to-end wiring:

### 1. Discord Developer Portal

1. Go to <https://discord.com/developers/applications> → pick the app you use for the bot (or create one).
2. **OAuth2 → General**:
   - Copy the **Client ID** and **Client Secret** (the secret may need to be reset if it isn't in your vault).
   - **Redirects:** add `https://<your-project>.supabase.co/auth/v1/callback` (Supabase's own callback — the user never sees this URL).

### 2. Supabase Dashboard

1. Open the same project the bot uses → **Authentication → Sign In / Providers**
   (NOT "OAuth Server" — that section is for making Supabase itself act as an
   identity provider for other apps, which is the opposite direction).
2. Scroll to the provider list → click **Discord** → toggle **Enable**.
3. Paste the Client ID + Client Secret from step 1.
4. Copy the **Callback URL (for OAuth)** Supabase shows you here — looks like
   `https://<your-project>.supabase.co/auth/v1/callback`. That's the value
   that goes in Discord Dev Portal → OAuth2 → Redirects (step 1 above).
5. Go to **Authentication → URL Configuration**:
   - **Site URL:** `https://wolfpack.quest`
   - **Redirect URLs** (add both):
     - `https://wolfpack.quest/auth/callback`
     - `http://localhost:3000/auth/callback` (for local dev)
6. Save.

### 3. Verify

1. Visit <https://wolfpack.quest/loadouts> while signed out — should redirect to `/auth/signin`.
2. Click **Continue with Discord** → Discord consent → bounces back signed in.
3. The header now shows your Discord avatar + a **Sign out** button.

### Notes
- Scopes requested: `identify` only (Discord ID + username + avatar). No DMs, no guild reads.
- Guild-membership gating (only Wolf Pack members can sign in) is a follow-up; right now any Discord user can sign in but only members will have data joined to them downstream.
- Sessions are HTTP-only cookies refreshed by `middleware.ts` on every request.

## Pages

| Route        | What it does                                            | Status        |
|--------------|---------------------------------------------------------|---------------|
| `/`          | Landing + nav                                           | Live          |
| `/loadouts`  | Every tank's bandolier sets, joined with proc info      | Schema check  |
| `/planner`   | Theoretical TPS calculator                              | Placeholder   |
| `/parses`    | Recent parse browser                                    | Auto-probe    |

## Next milestones

- [x] Discord OAuth via Supabase Auth (gate `/loadouts` and `/parses`)
- [ ] Guild-membership check on sign-in (currently any Discord user can sign in)
- [ ] Agent → bot inventory upload endpoint + `character_inventories` table
- [ ] Planner UI: 4-slot picker → DMG / Delay / proc / theoretical hate-per-min
- [ ] Parse filters: by boss, by night, by raider
- [ ] Embed-style parse card to mirror the Discord post

## Data shape — what we read

- `eqemu_items` — item catalog including DMG / Delay / proc_effect (spell ID)
- `eqemu_spells` — spell catalog so proc_effect resolves to a name + hate hint
- `item_with_proc` view — pre-joined items + their proc spell, populated by the new migration
- `characters`, `bosses_local`, `wishlists`, `loot_drops` — existing bot tables

All writes happen from the agent or bot side. This app is **read-only** by
design — it never sends data into Supabase outside of the user's own
opt-in records (when Discord OAuth lands).
