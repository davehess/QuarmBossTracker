# Decisions — 2026-09-03

## Raid attendance heatmaps: what a night is, and what "full" means

Hitya asked for a GitHub-style attendance grid on `/me` and a guild-wide
`/raidhistory` page coloured "red at half raiders to green full raiders, orange
middle of the way." Shipped web 1.7.19. The calls that had to be made, and why:

- **The reality signal is the OpenDKP tick mirror** (`opendkp_raids` +
  `opendkp_ticks`), the same one `/admin/attendance` and `/roster` read. Not
  `raid_attendance_ticks` (capture-only), not the Raid-Helper signups (declared
  intent, not presence).
- **A night is the Eastern day of `opendkp_raids.ts`.** OpenDKP stamps `ts` at
  noon UTC on the raid's calendar date, so the Eastern day-key is the night.
  Measured: 416 raids on 389 nights; 25 nights carry two raids (e.g. "7-22-26
  SSRA" and "7-23-26 Seru + Misc" both stamped 2026-07-22). Both raids fold into
  one cell and both names show in its tooltip.
- **Attended = present in ANY of the night's ticks.** Per-night raiders is the
  DISTINCT union across every tick of every raid that night — one person on two
  characters is one raider. On `/me` the union runs across the member's whole
  character family, so an alt night counts exactly like a main night.
- **Empty-attendee ticks are sync gaps, not empty raids** (14 of 1,546), and
  they drop before anything is counted — the `/admin/attendance` rule. A raid
  row with no valid ticks is therefore not a night; it is not coloured red.
- **"Full" is the guild's own raid target: the 60-man `raid_targets` row set
  summed (60 today), edited on `/admin/attendance`.** Fallback 60 if the table
  is empty; `?full=` overrides for a what-if read. Two columns that LOOK like
  the answer and are not: `opendkp_raids.attendance` is null on 406 of 416 rows
  and `1` on the rest, and `raid_nights.raid_size_expected` is a stale 30 on all
  207 rows. Neither is read.
- **The scale is a three-stop interpolation on the platform's own tokens** —
  red (`#f85149`) up to half, orange (`#ffa657`) at three-quarters, green
  (`#56d364`) from full — not a gradient from zero. Median night is 46 of 60,
  which reads orange-going-green; the 72-raider alt nights are solid green.
- **On `/me`, gold intensity = the member's tick share** (one tick of four reads
  dimmer, still gold), and a missed night is an OUTLINE in gold, not a red
  square. Red on this platform means death or conflict; missing a Wednesday is
  neither.
- **Only Sun/Wed/Thu rows are labelled.** The guild's cadence is visible in the
  structure, and a lit Saturday stands out as the exception it is.
- **The tooltip is one `position: fixed` element in a client component.** A
  CSS-only tooltip is clipped by the horizontal scroller the grid needs on a
  phone (overflow-x clips both axes), and a native `title` cannot put the raid
  name on its own line. Every night cell is also a real link to
  `/raid/review/<date>`, so a tap on a phone still goes somewhere.
- **Reads are paged (`selectAll`), never `.limit()`ed.** `/raidhistory` pulls
  attendee arrays for the window (~150 raids × 4 ticks × ~50 names for a year —
  the one wide read, and it needs them for the distinct count). `/me` pulls
  tick IDS only, twice: held ticks and the family's ticks via
  `.overlaps('attendees', names)`.

⚠ **Not verified from this session: the `/me` loader's `.neq('attendees', '{}')`
PostgREST filter.** The REST endpoint is blocked by the cloud egress proxy
(CONNECT 403), so the ids-only "held ticks" read could not be exercised. The
SQL it should emit (`attendees <> '{}'`) was run directly and is correct. It
fails soft — no held ticks while raids exist ⇒ the section hides rather than
drawing a year of "missed" — so the symptom, if the filter is wrong, is a
MISSING section for everyone, and the fix is to fetch the arrays and filter in
JS as `/raidhistory` does.

## Open — read this first

| Item | State |
|---|---|
| ⚠ **`/me` attendance section missing for everyone?** | The `.neq('attendees', '{}')` filter above is the first suspect — unverified from a cloud session |
| ✅ **Zeal PR #229 — MERGED** | Waiting on a tagged Zeal RELEASE, then on raiders updating. Everything our side is shipped and inert until a client sends an id |
| ⚠ **The issue #218 comment, still unposted** | `docs/upstream/zeal-spawn-id/issue-218-comment.md`; drop its stale "no Windows/MSVC setup" paragraph first |
| **`mob-info` is still name-keyed** | ✅ `target-casts` joined `target-buffs` on spawn-id-first keying (bot 3.1.113 · agent 3.6.24). `mob-info` is the last of the three |
| ⚠ **The Buffs tab has never been LOOKED at** | It ships in Mimic 2.6.4 and its logic is tested, but no session has seen it render. First raider to open it is the first visual check |
| **The API request to Moncs** | Still unsent |
| **Two local OpenDKP fixes, recommended before sending** | Gate the roster walk on a `Character Created/Updated` audit signal; make `dkpTick._resolveCharacterIds` read `characters.opendkp_id` |
| **`_logStandingsShapeOnce`** | Prints on the next raid-window standings refresh — resolves the DKP field-name question |
| **Autobid button** | Deliberately NOT shipped; needs a ceiling column that does not exist |
| **`bump_agent_upload_stat` has three overloads** | Nothing broken; drop the two stale ones once the fleet is on bot ≥3.1.107 |
| **The weekly OpenDKP sweep is TEMPORARY** | Revert to `OPENDKP_LIST_FULL_SWEEP_DAYS=0,3,4` when OpenDKP ships `since` |
| 🔴 **`encounter_threat_snapshots` retention has never run** | 920 MB / 57% of the DB, 448k rows past cutoff. Needs an index + a batched delete. Destructive — awaiting a go-ahead |
| ⚠ **Supabase Spend Cap + current egress** | Both dashboard-only, both unread |
| ✅ **Tag channel autojoin file-write** | Shipped (agent 3.6.34): `_applyAutojoin` writes `[Defaults] ChannelAutoJoin` in eqclient.ini. Still needs `TAG_CHANNEL_SPEC` / `OFFICER_CHANNEL_SPEC` set on Railway or in `/admin/overlays` |
| **Silverwing encounter d78bcea4 (2025-03-21)** | Players wiped by the old merge RPC; restore via the Parses Log `/restore` is Hitya's call |

_Carried forward from `DECISIONS-2026-09-02.md`._
