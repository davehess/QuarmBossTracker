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

## Phased plan

1. **URL collection** — already done: `/quarmy set <char> <url>` writes to
   roster chunks. Add a `quarmy_url` column on `characters` (mirror) so
   the bot has a single source instead of re-parsing roster on each fetch.

2. **Bot-side fetcher** — Railway has full outbound; the bot polls quarmy.com
   on a sane cadence (every N days per character, plus on-demand when a
   member runs `/quarmy refresh`). Honors `exclude_inventory` strictly: no
   request fires for opted-out chars. Failure modes (URL 404, layout
   change) record the error, retry with backoff, never delete prior data.

3. **Parser** — the actual code is one focused session of work once we know
   Quarmy's shape:
   - **If quarmy.com serves a JSON API** (e.g. `/api/b/<id>` or `?format=json`)
     — trivial, structured extract.
   - **If it's server-rendered HTML** — parse with `cheerio` against the
     screenshot-confirmed sections (Inventory / Stats / AAs / Spells /
     Discs).
   - **If it's a SPA with embedded JSON** — pull `window.__PRELOADED_STATE__`
     or equivalent from a `<script>` tag.

   ⚠ I cannot determine which from this dev sandbox (outbound HTTP blocked
   network-wide — same reason TAKP wiki, PQDI pages, eqprogression all
   403'd this session). **Unblocker**: paste the raw response body from
   `curl https://quarmy.com/b/q3taYC-VMyau5jEq` (or the page source via
   browser DevTools → Sources / "View page source"). The head section plus
   a representative chunk of gear + AA markup is enough to write the parser.

4. **Storage** — `character_gear` (slot → item_id, latest-state overwrite,
   compact like faction v2), `character_aas` (aa_key → current_rank /
   max_rank), `character_spellbook` (spell_id only — `eqemu_spells` joins
   the rest). All overwrite-in-place; ~25–80 rows per character, total a
   few MB, zero growth. No bank inventory persisted to DB at all — the
   parser drops bank slots on the floor before write.

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
| `character_gear` | ~25 × ~120 raiders = 3k | <5 MB, never grows |
| `character_aas` | ~80 × 120 = 10k | <10 MB, never grows |
| `character_spellbook` | ~60 × 120 = 7k | <5 MB, never grows |

Negligible. All three follow the faction v2 "latest-state overwrite"
philosophy — counters/timelines kept only where they earn it.

## Blocked on the one thing

Owner pasting **one Quarmy profile's HTML** (or confirming a JSON endpoint
exists) so the parser shape is known. Everything else is already decided.

## Roadmap follow-ups (not v1)

- Spells/AAs *missing*: cross-reference observed casts (`stats.castCounts`)
  against `eqemu_spells` × class/level — the `/me` missing-spells advisor
  already in CLAUDE.md roadmap.
- Hotkey set recommendations: layer over the existing UI Studio PvP sets
  + cross-reference equipped clickies (so the hotkey suggests items the
  character actually has).
