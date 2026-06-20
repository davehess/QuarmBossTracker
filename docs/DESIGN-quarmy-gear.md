# Quarmy / Gear Integration — Design (queued)

Owner ask (2026-06-10): pull members' gear into character pages — full focus
effects, missing spells, AAs; recommend items to fill focus/+ATK gaps with
drop sources + recent DKP prices; compute stats (base / self-buffed /
clickies); PvP buff best-practice; hotkey set recommendations; WORN effects
(Fire Fist, infravision — vision items matter to night-blind races).

## Decision: Quarmy IS the source (revised 2026-06-10)

Initial design favored our existing `<Char>-Inventory.txt` parser as
self-sufficient. Owner confirmation + sample profile
(https://quarmy.com/b/q3taYC-VMyau5jEq) shows Quarmy genuinely carries
more than the dump:

- Equipped slots + stats on each item (we have this)
- **AAs by category with current/max ranks** (inventory dump lacks this)
- **Spell book** keyed by level + spell line (lacks this)
- **Disciplines / songs** (lacks this)
- Stat rollups (base / total / per-slot contribution)
- Worn buffs / focus effects breakdown
- Hotbar / bandolier already captured by us; cross-reference

Inventory dump still useful as a fallback for members who don't maintain a
Quarmy profile, but Quarmy is the primary feed when a URL is on file.

## Privacy contract (owner-confirmed 2026-06-10)

| Datum | Scope | Notes |
|---|---|---|
| Equipped gear | GUILD on `/character/<name>` | Focus / worn-effect analysis publishable |
| Bank / inventory totals | **NEVER public** | Aggregated counts even on `/me` only |
| Wishlist | **PRIVATE `/me` only** | Existing encrypted-bid model |
| AAs / spells / discs | GUILD on character page | Same surface as gear |

`characters.exclude_inventory` opt-out (already in DB from the data-floor
migration) is the kill switch — **no Quarmy fetch fires for an excluded
character**, no row written, page section shows "opted out" instead of
blanks. Same agent-side gate as `exclude_from_stats`.

## Source shape — CONFIRMED 2026-06-10 (v1 SHIPPED)

The owner supplied the page source + three real export files
(Hitya/monk, Manamana/cleric, Melting/bard). Two viable feeds:

1. **The local export file `<Name>Quarmy.txt`** (in the EQ folder; the same
   file members feed to quarmy.com — its "verified" badge means "imported
   from an unmodified Quarmy export"). Plain TSV, stable across classes:
   - `Character` header + row: Name, LastName, Level, Class, Race, Gender,
     **Deity**, Guild, GuildRank, base stats. (Deity! — fixes the faction
     page's "deity isn't tracked" caveat.)
   - `Location / Name / ID / Count / Slots` rows: equipped slots (Ear/Wrist/
     Fingers repeat — number them Ear1/Ear2 etc.), `GeneralN` bags +
     `GeneralN-SlotM` contents, `General-Coin`, `Held`, then `BankN…`,
     `SharedBankN…`, `Bank-Coin`. Bank + shared bank + coin are
     **account-level** (identical across same-account exports).
   - `AAIndex / Rank` rows: purchased AAs by in-game index.
   - `Checksum <n>` — perfect change-detection key.
   **This is the primary feed** — the agent reads it locally, which means
   bank/coin rows are dropped BEFORE upload: they never leave the machine
   (stronger than "never public").

2. **quarmy.com page** — Next.js RSC flight payload in `self.__next_f.push`
   script chunks; the chunk containing `"buildData"` carries gear sets
   (incl. PoP BIS planning sets, each with its own visibility flag!), buff
   sets, AA selections, bags, plus a fully-resolved `itemsMap`. Anonymous
   fetches only see what Quarmy itself marks shared, so a bot-side fetcher
   inherits Quarmy's own privacy model. **Follow-up** for members who keep
   a profile but don't run Mimic.

## Phased plan

1. **URL collection** — already done: `/quarmy set <char> <url>` writes to
   roster chunks; `characters.quarmy_url` column exists.

2. **Agent-side file ingest — SHIPPED** (agent v3.1.10 / bot v3.0.68).
   Scans the log dir for `<Name>Quarmy.txt` on startup + every 10 min,
   parses locally, drops Bank/SharedBank/coin at parse, gates on
   `exclude_inventory`/`exclude_from_stats` (and refuses to upload before
   the prefs poll has answered at least once), dedups by export checksum,
   ships via the durable queue to `POST /api/agent/quarmy`. The bot
   re-checks the opt-out server-side and strips banned slots again.

3. **Bot-side quarmy.com fetcher** — follow-up (shape known, see above);
   only needed for members without Mimic.

4. **Storage — SHIPPED** (migration 20260610210000): `character_gear`
   (guild, character, loc equipped|bag, slot → item_id, name, count) +
   `character_aas` (aa_index → rank), both latest-state delete-and-replace;
   `characters` gains deity_id / quarmy_checksum / quarmy_synced_at;
   `eqemu_items` gains worneffect/worntype/attack/haste/regen/manaregen/
   damageshield (populated by the next weekly sync — sync-from-eqmac.js
   updated). No bank data persisted anywhere, by construction.
   Web: `/character/<name>/gear` (BETA) — equipped table with
   focus/worn/click/proc joins, item-sum totals, vision-item callout,
   clicky list, raw AA ranks.

5. **Effects analysis** (read-time, no new tables) — join `character_gear`
   to `eqemu_items.focuseffect` / `worneffect` / `proceffect` / `clickeffect`.
   Per-character: focus effects present vs the era's expected focus list,
   worn effects present (**vision items — infravision/ultravision — flagged
   prominently** for night-blind races), clicky inventory. PvP best-practice
   layer references existing UI Studio `uiStudioListPvpSets` instead of
   duplicating.

6. **Recommendations** — missing focus / +ATK / vision gaps → candidate
   items from the `eqemu_npc_drops` view (drop source) + `opendkp_auctions`
   history (last N winning bids — already mirrored) + wishlist cross-ref
   (private — owner only sees their own wishlist matches). Melee +ATK is
   just `eqemu_items.attack` sort filtered to slots the character has gaps
   in.

7. **Stat calculator** — base by race/class/level, sum worn from gear,
   layer self-buffs (already in `eqemu_spells`), add clickies. PvP buff
   template is a curated list per class.

## Storage estimate (final)

| Table | Rows | Size |
|---|---|---|
| `character_gear` | ~130 (equipped + bags) × ~120 raiders = 16k | <10 MB, never grows |
| `character_aas` | ~20 × 120 = 2.4k | <2 MB, never grows |

Negligible. Both follow the faction v2 "latest-state overwrite" philosophy.
(`character_spellbook` was cut from v1 — the local export carries no spell
book; that data only exists on quarmy.com and rides the bot-side fetcher
follow-up.)

## Roadmap follow-ups (not v1)

- **AA index → name catalog** — the export carries in-game AA table
  indices; the gear page shows raw `AA #n rank r` until a catalog lands
  (Quarmy's own AA names live in its client JS chunks, or mirror
  `aa_actions` from the eqemu dump in the weekly sync).
- **Focus/+ATK gap recommendations** — join gaps against `eqemu_npc_drops`
  (drop source) + OpenDKP auction history + private wishlist cross-ref.
- **Stat calculator** — base by race/class/level (+ the export's BaseSTR…
  columns), worn sums (shipped), self-buffs, clickies, PvP best-practice.
- Bot-side quarmy.com fetcher for non-Mimic members (RSC flight parse).
- Spells/AAs *missing*: cross-reference observed casts (`stats.castCounts`)
  against `eqemu_spells` × class/level — the `/me` missing-spells advisor
  already in CLAUDE.md roadmap.
- Hotkey set recommendations: layer over the existing UI Studio PvP sets
  + cross-reference equipped clickies (so the hotkey suggests items the
  character actually has).
