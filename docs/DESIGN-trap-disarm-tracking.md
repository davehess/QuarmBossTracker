# Trap disarm tracking — by disarmer location, 10-minute timer

Hitya, 2026-08-10 (mid-raid): *"We should start tracking the disarmed traps by
location of the person disarming them — 10 minute timer."*

## What exists today: nothing, and the location half is already solved

Checked all four surfaces before writing this (the `HOW-ITS-BUILT.md` rule) —
`packages/wolfpack-logsync/index.js`, `index.js` + `commands/`, `apps/mimic/*`,
`web/`. There is no trap or disarm handling anywhere, and no
`HOW-ITS-BUILT.md` entry. The only `trap` hits in the codebase are English
prose in comments.

The part that *sounds* hard — "location of the person disarming" — is the part
we already ship. Two independent sources, both live:

| Source | Where | Precision |
|---|---|---|
| **Own position**, Zeal `loc {x,y,z}` | `st.loc` → `character_live_state.loc_*` (`packages/wolfpack-logsync/index.js:29724`) | exact, at the moment of the line |
| **Any raider's position**, Zeal type-5 raid pipe | `_lastRaidPipe.members[].loc_x/y/z` (`packages/wolfpack-logsync/index.js:8300`) | stale up to the pipe cadence |

The first one is the one that matters here, for a reason that also settles the
architecture: **EQ's disarm messages are self-only.** Another player disarming
a trap produces no line in your log. So the event can only be detected on the
disarmer's own machine — which is precisely the machine whose position we want.
The agent reads its own `st.loc` at fire time and the answer is exact. No
cross-client correlation, no clustering, none of the #194 machinery.

Corollary worth stating plainly: **coverage equals Mimic+Zeal adoption among
the people who disarm.** A rogue not running Mimic contributes nothing, and
there is no fallback that recovers it — nobody else's log saw the event.

## The one thing that blocks a line of code being written

**The exact log line is not established, and it cannot be established from this
session.** There is no trap line in `test/fixtures/golden/`, no server source in
this container, and cloud sessions are cut off from eqemulator.org and PQDI
(`CLAUDE.md` → Working across sessions). Every candidate string I can produce
would be a guess, and a guessed pattern fails *silently* — it compiles, it
installs, it simply never fires, which is the worst failure mode because it
looks like it works until someone checks.

Two ways to close it, either is enough:

1. **Paste the line.** Next time a rogue disarms something, from their client:
   `grep -i disarm eqlog_<Name>_pq.proj.txt | tail -5`. One real line ends this.
2. **A local session reads it from the server source** — `D:\EQServer`,
   `zone/string_ids.h`, the disarm-trap strings. This is the route the Divine
   Intervention work took, and it gave us three facts no secondary source had.
   Filed as a ⚠ needs-a-local-session item.

Both the success line and the failure line are worth having — a failed disarm
still tells you a trap is *there*, which for a position map is most of the value.

## Design

### Data path

```
rogue's log line  →  agent detects (own log only)
                  →  stamps st.loc {x,y,z} + zone + character + ts
                  →  POST /api/agent/trap_disarm   (new, ephemeral-class stream)
                  →  Supabase trap_disarms
                  →  bot serves live rows; overlay/web draw them with a countdown
```

`trap_disarm` should be registered **sheddable** (`flag_shed_trap_disarm`) like
the other ephemeral streams — it is re-derivable and must never compete with the
durable five (`_SHED_NEVER`).

### Table

```sql
create table if not exists trap_disarms (
  id           bigserial primary key,
  guild_id     text not null,
  character    text not null,
  zone_short   text,
  loc_x        double precision,
  loc_y        double precision,
  loc_z        double precision,
  outcome      text not null default 'disarmed',   -- 'disarmed' | 'failed' | 'sprung'
  disarmed_at  timestamptz not null default now(),
  expires_at   timestamptz generated always as (disarmed_at + interval '10 minutes') stored
);
create index if not exists trap_disarms_live on trap_disarms (guild_id, zone_short, disarmed_at desc);
```

Ten minutes is Hitya's number, from raid practice. Put it in the schema as the
generated column above **and** nowhere else — one place to change it if the real
respawn turns out to differ.

### Surfaces

- **Overlay** — a row per live trap: `⚙ Trap — Ssra @ (-412, 806) — 7:31`. This
  should NOT be a new overlay; it belongs on the trigger/timer surface that
  already exists, or as a section of the Command Center. A new overlay drags in
  the whole feature-parity checklist (✕, ✥, hover handshake, `_HIDEALL_FLAGS`,
  `_overlayEntries`, dashboard row) for one line of text.
- **Web** — a `/raid` panel listing live traps with their coordinates, so
  someone not in the zone can call them out.
- **Loc format** — EQ's `/loc` prints `y, x, z`, and Zeal's pipe order has bitten
  this repo before (`CLAUDE.md` → zone map overlay is *blocked* on exactly this
  x/y transposition question). **Resolve the axis order against a known landmark
  before shipping any coordinate to a human**, or the whole feature confidently
  points the raid at the wrong wall. This is the same spike that blocks the zone
  map, so doing it here unblocks both.

### Interim, DB-only (available the moment the log line is known)

A guild trigger gets the countdown without any release:

- `pattern`: the disarm line, anchored
- `default_scope`: `personal` — nobody else's client can see the line anyway,
  so a broadcast scope is pure relay traffic (this is what the "Too Far" /
  "Can Not See" triggers were doing wrong tonight)
- `timer_duration_sec`: 600

One wrinkle from tonight's P1 (`FINDINGS-2026-08-10-trigger-overlay.md`): the
timer row's label falls back to `captures['0']`, the whole timestamped line.
Give the pattern a named capture called **`target`** and the label reads cleanly
instead — `timerTarget` checks `captures.target` first. For a line with no name
in it, `(?<target>You)` is enough to produce `You - Trap disarmed`.

This interim gives the disarmer a countdown. It does **not** give anyone the
location — that needs the agent change above. Don't let it stand in for the
feature.

## Order of work

1. Get the log line (either route above). Everything is blocked on this.
2. Resolve the x/y axis order against a landmark — shared with the zone map spike.
3. Agent: detect + stamp loc + POST. Ships to `beta`.
4. Bot: ingest, table, live query, shed registration. Ships to `main`.
5. Surface it on the existing timer overlay, then `/raid`.
