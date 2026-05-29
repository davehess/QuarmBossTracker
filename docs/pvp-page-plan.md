# PvP Page — design & spike

Status: **design + WIP code** on `claude/pvp-page-prototype`. Nothing
deploys (Railway/Vercel only watch `main`).

## Locked decisions (from user, this session)
- **Pet attribution**: pets credit to their owner. Hold the pet's name
  during parsing; the line `<PetName> tells you, 'Attacking <Target>
  Master.'` is the canonical owner-of-pet signal (only the pet's owner
  sees `tells you`). Combine with the existing pet_leaders capture
  (`My leader is <X>` line on pet summon) for redundancy.
- **Privacy gate**: officers see all deaths; everyone else sees only
  their own. Reuses the existing officer-role check from `/admin`.
- **Backfill scope**: forward-only **plus** opt-in agent log backfill
  (covers history; no Discord channel scrape needed).

## Verified log signals (from Wahumpkin's 115k-line log)
- **Pet attack confirmation**: `Xekab tells you, 'Attacking a dwarf
  skeleton Master.'` — Xekab is Wahumpkin's brazier-pet. Pattern is
  reliable and captures the pet name alongside the target.
- **No `My leader is` lines** in this particular log because the pet
  was summoned before the log starts. The `Attacking … Master` line
  is itself an implicit ownership signal (only the owner sees
  `tells you`), so it stands alone as the attribution source.
- ("Brazier pet" is guild slang for a pet summoned by the
  *Brazier of Elemental Summoning* item — not a character or pet
  name. The actual pet has a generated name like Xekab.)

## Build plan

1. **`pvp_kills` Supabase table** — every PvP-channel broadcast that
   involves WP (kill or death) persists here. Columns:
   `guild_id, killer, killer_guild, victim, victim_guild, zone,
   via_pet (bool), pet_name (nullable), killed_at, source
   ('pvp_channel' | 'log_backfill'), raw_text, dedup_key`.
   Unique key on `dedup_key = guild|killer_lower|victim_lower|ts_sec`
   so multi-parser uploads and backfill replays don't double-count.

2. **Persist on every broadcast** in `_handleAgentPvp` — the WIP edit
   already on this branch. Writes BEFORE the dupe check and Discord
   fetch so a Discord hiccup or a backfill replay (with intent to skip
   posting) still persists the row.

3. **Pet ownership map** — agent extracts `<PetName> tells you,
   'Attacking <Target> Master.'` lines, uploads them as a side stream
   keyed by `(owner_character, pet_name)`. Bot maintains a per-guild
   `pet_owners` map. When a kill broadcast names a player whose
   lowercase name appears in that map, credit the owner and tag
   `via_pet=true, pet_name=<the pet name>`.

4. **`/pvp` page** (Next.js):
   - Top: leaderboard of WP killers, columns
     `Kills (unique victims)`. Click into a name.
   - Player page: full kill history + per-victim breakdown
     ("killed Versaci 3 times, Cosinex 2 times..."). Pet kills
     marked with `*` and a tooltip naming the pet.
   - Officer-only or self-only: deaths section + per-attacker
     breakdown. Use existing `isOfficer(user.id)` helper +
     `characters.discord_id` for the self-match.

5. **Agent backfill detector** — opt-in backfill regex on
   `PVP_BARE_PLAYER_RX` + `Attacking … Master` lines. Replays into the
   same `pvp_kills` table; `dedup_key` keeps it idempotent.

## Current WIP state (uncommitted-then-committed-here)
- `index.js`: started persisting kills inside `_handleAgentPvp` —
  builds `pvpKillRows` per broadcast, credits to pet owner when the
  killer name is a known pet, uses a per-second `dedup_key`. **Not
  yet wired**: needs the Supabase migration (step 1) and the upsert
  call after the broadcast loop. References `_petOwners` and
  `pvpKillRows` which aren't declared yet — finish in next pass.
