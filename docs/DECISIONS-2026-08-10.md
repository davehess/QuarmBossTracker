# Decisions — 2026-08-10

## Tank-buster callout moved from "as it happens" to a prep sequence

**The call (Hitya, post-Ssra):** the Emperor tank buster needs a warning at
**10s** ("big heals and spell shields") and at **4s** ("start curse cures") —
not a single announcement when it lands.

**Why.** The prep is a sequence, not a reaction: shaman/druid off-heals want to
be in flight ~10s out so they land *into* the hit, spellshields have to be up
before it, and curse cures started at 5/4/3s strip the curse the instant it
lands so the follow-up heal is fully effective. A callout at T-0 is too late for
every one of those. On the wipe pull Bardtholemu — who normally calls this
verbally — was busy stabilising after Lenolshot died, so the raid got nothing.
**That is the case automation exists for: the raid leader is a single point of
failure and is least available exactly when the raid most needs the call.**

**What was actually wrong.** Nothing missing in code. `guild_triggers` supports
multiple warnings via the `timer_warnings` jsonb column (agent 3.5.52, the
EQLogParser-parity work; the fleet is on 3.5.54/3.5.55, so every raider already
has it). The trigger `Emperor Ssra Tank Buster — countdown`
(`0680b9f6-e5e4-4a29-87cb-78c0b1ae1b83`) simply had `warning_seconds = null` and
no `timer_warnings` — it spoke once on match, then counted 60s in silence.

**Applied 2026-08-10, DB only, no release:**

```sql
update guild_triggers set timer_warnings = '[
  {"seconds": 10, "text": "10 SECONDS. BIG HEALS AND SPELL SHIELDS.", "tts": true},
  {"seconds": 4,  "text": "START CURSE CURES", "tts": true}
]'::jsonb where id = '0680b9f6-e5e4-4a29-87cb-78c0b1ae1b83';
```

Shape per `_timerWarnings`: `seconds` counts *before* expiry, `text` drives both
the overlay and the spoken line, `tts` defaults true. Sorted descending, so 10s
fires before 4s.

**Revert** (back to silence): `set timer_warnings = null`.

**Caveats.**
- The warnings inherit whatever accuracy the 60s cadence has. If the buster
  drifts, they drift with it — the « Earlier / ✓ Good! / » Too early buttons on
  the callout remain the way to correct it.
- This adds two spoken lines per 60s cycle, raid-wide, for the whole Emperor
  fight. That is a deliberate raid-noise trade against the alternative of the
  prep not happening. If it reads as too chatty, drop the 10s line first — the
  curse-cure call is the one with no verbal substitute mid-crisis.
