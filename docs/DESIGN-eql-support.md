# DESIGN — EverQuest Legends (EQL) support

Scoping doc for running the Wolf Pack platform against **EverQuest Legends** as
well as Project Quarm, as guild members start playing both. Triggered by a look
at **eql-meter** (`github.com/kpxcoolx/eql-meter`) + `eqlmeter.com`, 2026-07-27.

**Status:** design / not started. Nothing here is built. Author: cloud session.
**Decision needed from Hitya:** whether EQL is a real second track or a
side-interest (see Open Questions) — that sets how far past Phase 1 we go.

---

## Headline finding

**EQ Legends logs combat essentially the way classic EQ does, so our existing
agent already does most of what eql-meter does.** EQL support is an *extension
of our stack*, not a second app to adopt and not a rewrite.

eql-meter is worth reading, not adopting: it's **local-only** (no upload, no
server, clipboard-copy parses), which is the opposite of our model (agent →
bot → Supabase → web + cross-client overlays). Its real value to us is as an
**MIT-licensed reference** for the handful of EQL-specific log-format deltas.

---

## What eql-meter is (surveyed 2026-07-27)

| | |
|---|---|
| Stack | **Tauri** (Rust backend + TypeScript/Vue frontend) |
| Platforms | Windows `.exe` (NSIS), macOS `.dmg` — but **releases are Windows-only in practice**; Mac = build from source |
| License | **MIT** |
| Data source | Tails the character log file; "Find / Auto-detect log" |
| Server | **None.** Entirely local; parses, displays, copy-to-clipboard |
| Features | Live DPS, multi-mob combined view, ability breakdown + DPS charts, healing done/received, `/who all raid` roster, loot tracking, click-through always-on-top overlay, session persistence (last log + window positions) |

Parser modules (`src-tauri/src/parse/`): `damage.rs`, `heal.rs`, `avoid.rs`,
`who.rs`, `stance.rs`, `misc.rs`. Log tailing: `log_tail.rs`, `log_find.rs`.

> **`stance.rs` is the tell** — EQL has a combat *stance* mechanic classic EQ
> doesn't. That module is the clearest marker of genuinely EQL-only content.

---

## EQL log format vs ours

EQL uses the standard EverQuest convention: **`eqlog_<character>_<server>.txt`**,
enabled with `/log on` (persists between sessions). Windows default path:

```
C:\Users\Public\Daybreak Game Company\Installed Games\EverQuest Legends\Logs\
```

Line formats, taken from eql-meter's `parse/damage.rs`:

| Kind | EQL format | We parse it today? |
|---|---|---|
| Melee | `You hit a dar ghoul knight for 43 points of damage.` | ✅ yes |
| Non-melee | `You hit X for 123 points of non-melee damage.` | ✅ yes |
| DoT (self) | `X has taken 44 damage from your Blood Siphon Strike.` | ✅ yes |
| DoT (other) | `X has taken N damage from <spell> by <attacker>.` | ⚠️ we handle the `from PlayerName's SPELL` shape — **word order differs** |
| Pet/possessive | `Francis's flame lick hits X for 40 points of non-melee damage.` | ✅ yes |
| **Typed spell** | **`You hit X for 123 points of magic damage by Smiting Strike.`** | ❌ **no — see below** |
| Frenzy | `You frenzy on X for N points of damage.` | ❌ no (`frenzy on` phrasing) |

Melee verbs EQL uses: hit, slash, crush, pierce, kick, bash, **strike**, claw,
bite, punch, backstab, **smite**, **cleave**, **frenzy**. Our verb alternation
(`packages/wolfpack-logsync/index.js:683`) already covers most; `strike`/`smite`
are present, **`cleave`/`frenzy` are not**.

### The one genuinely valuable format upgrade
EQL's modern client emits **inline per-spell attribution with resist type**:

```
You hit a dar ghoul knight for 123 points of magic damage by Smiting Strike.
```

Our Titanium-era Quarm client gives us `points of non-melee damage` with **no
spell name**, which is exactly why per-ability attribution has been hard-won
(the `contributions.has_ability_detail` watermark, the combat-rollup work).
Adding this one regex gives **free, exact ability breakdown on EQL** — the
highest-value single thing to take from eql-meter.

### Our current gate (the concrete blocker)
```js
// apps/mimic/main.js:532
const EQ_LOG_CANONICAL_RX = /^eqlog_.+_pq\.proj\.txt$/i;
```
Hardcoded to Quarm's `_pq.proj` server suffix. **An EQL log is rejected before
anything else runs** — this is change-point #1.

---

## The real work is the game dimension, not the parser

Combat parsing is a small delta. The heavy lift is that the whole platform is
**Quarm-specific by assumption**:

- `data/bosses.json` (133 Quarm bosses), raid timers, expansion boards
- the `eqemu_*` mirror = the PEQ/Quarm catalog (NPCs, items, spells, zones,
  spawns) — EQL is a *different game* with different content and different ids
- `encounters` / `encounter_players` / `contributions` carry no game column
- wpqdi (`docs/DESIGN-wpqdi.md`), `/boss`, `/parses`, DKP — all assume Quarm

**Without a game tag, EQL parses would silently pollute Quarm records** —
wrong-game encounters on the boards, bogus `find_or_create_encounter` matches
against Quarm `npc_id`s, EQL damage inflating Quarm leaderboards. That's the
one thing this design must not get wrong.

**Proposal: a `game` dimension, defaulting to `quarm`.**
- New column `game text NOT NULL DEFAULT 'quarm'` on the tables that record
  gameplay: `encounters`, `contributions`, `chat_messages`, `who_observations`,
  and any new EQL-side tables. Backfill is a no-op (everything existing *is*
  Quarm), so the migration is cheap and non-breaking.
- The agent stamps `game` per watched log, derived from the log filename's
  server suffix (`_pq.proj` → `quarm`, else `eql`).
- Every existing query keeps working because the default is `quarm`; web/bot
  surfaces filter `game = 'quarm'` explicitly where they assume Quarm content.
- `find_or_create_encounter` must include `game` in its match predicate, or an
  EQL fight can dedup into a Quarm encounter.

---

## Where we'd beat eql-meter

1. **Upload + history.** eql-meter is local-only. We already have the whole
   pipeline: durable queue → bot → Supabase → `/parses`, character pages,
   leaderboards, Discord cards. An EQL parse becomes *permanent guild history*.
2. **Cross-client overlays.** Our HUD shows what *the raid* is doing, not just
   your client. eql-meter shows one machine.
3. **Cross-platform.** eql-meter ships Windows binaries only; Mac users build
   from source. EQL on Mac runs under **osxEQL** (open-source Wine + DXMT/Metal,
   Apple Silicon M1+, macOS 13+). Our Mimic is Electron and we *just* did the
   Wine-prefix log-detection work for the Steam Deck (#156) — `_linuxDriveCRoots()`
   already enumerates Bottles/Lutris/Proton/`~/.wine` `drive_c` trees. **That
   same code path is most of Mac/Linux EQL log discovery**, which would make us
   a better cross-platform EQL companion than eql-meter is today.

---

## Phased plan

### Phase 0 — capture real EQL logs ⚠ NEEDS A LOCAL SESSION
Everything below is built on **one MIT source file + a blocked wiki page**
(`eqlwiki.com/Logfiles` and `eqlmeter.com/docs.html` both 403 the cloud proxy).
Before writing regexes we want ground truth from `D:\EQLegends`:
- a real `eqlog_<char>_<server>.txt` with a few fights (melee, spells, DoTs,
  heals, pet damage, a death, a `/who all raid`, and a **stance** change)
- the exact filename (what *is* the EQL server suffix?) and full path
- confirm `/log on` + any `eqclient.ini` logging keys

Add as a `docs/STATUS.md` "⚠ Needs a local session" item. **Do not write the
EQL regexes from guesswork** — that's how we ship a parser that silently
under-counts.

### Phase 1 — read-only EQL parsing (the 80%)
- Generalize `EQ_LOG_CANONICAL_RX` to `^eqlog_.+\.txt$` + derive `game` from the
  server suffix; keep Quarm detection byte-identical.
- Add the format deltas: typed-spell-damage regex, `frenzy on`, `cleave`,
  the `damage from <spell> by <attacker>` word order.
- Stamp `game` on uploads; add the column + default (one migration).
- DPS/heal HUD works as-is once events flow.
**Deliberately out of scope:** boss timers, boards, DKP, wpqdi, raid detection.
EQL parses land as history + a live meter, nothing more.

### Phase 2 — EQL-native surfaces (only if EQL becomes a real track)
- `/parses?game=eql`, EQL leaderboards, per-character EQL split
- stance tracking, EQL-specific abilities
- an EQL catalog (mob/item/spell) — a *large* piece of work with no PEQ mirror
  to lean on; would need its own data source. Do not start without a decision.

---

## Open questions (Hitya)

1. **Is EQL a real second raid track, or a few people dabbling?** Phase 1 is
   cheap and safe either way; Phase 2 is a big investment and shouldn't start
   on a maybe.
2. **Should EQL data be visible to the whole guild** (mixed into /parses with a
   game filter) or quarantined to its own page?
3. **Does EQL activity count for anything social** — attendance, DKP, raid
   credit? Default assumption: **no**, EQL is history-only.
4. Do we care about EQL on Mac (osxEQL) enough to test there, given we already
   have the Wine-prefix detection from the Deck work?

## Cross-refs
- eql-meter (MIT): `https://github.com/kpxcoolx/eql-meter` — reference for the
  format deltas; `src-tauri/src/parse/damage.rs` is the useful file.
- osxEQL (EQL on Apple Silicon): `https://github.com/sowoky/osxEQL`
- Our parser: `packages/wolfpack-logsync/index.js` (verbs ~:683, damage
  patterns ~:746-800). Log gate: `apps/mimic/main.js:532`.
- Deck/Wine log discovery to reuse: `apps/mimic/main.js:589` `_linuxDriveCRoots()`.
- Catalog constraints: `docs/eqemu-catalog-cheatsheet.md` (Quarm-only).
