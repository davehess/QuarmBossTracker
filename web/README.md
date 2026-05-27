# Wolf Pack EQ — Tracker (web)

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
3. Set env vars in Vercel project settings:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy. Vercel auto-detects Next.js 14.

## Pages

| Route        | What it does                                            | Status        |
|--------------|---------------------------------------------------------|---------------|
| `/`          | Landing + nav                                           | Live          |
| `/loadouts`  | Every tank's bandolier sets, joined with proc info      | Schema check  |
| `/planner`   | Theoretical TPS calculator                              | Placeholder   |
| `/parses`    | Recent parse browser                                    | Auto-probe    |

## Next milestones

- [ ] Discord OAuth via Supabase Auth (gate `/loadouts` and `/parses` to guild members)
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
