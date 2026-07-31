# DESIGN — same-name mob serialization via player-position clustering

Four `a crypt guardian` pulled at once collapse into **one** NPC everywhere in
the platform — one Extended Target row, one debuff list, one HP number, one
damage bucket. This doc proposes the next honest increment: stop trying to
locate the *mob* (impossible from the pipe) and instead cluster the **players
engaged with it**, whose positions we already collect. Mobs tanked apart produce
spatially separate clusters of engaged raiders; each cluster is one instance.

**Status:** design / not started. Author: cloud session 2026-07-31, from Hitya's
2026-07-30 raid-night report and his refined framing ("we don't need the mob's
position — we need to know which players are on which one").
**Routing: docs → `main`, no version bump.**
**Extends, does not replace, `docs/DESIGN-dedup-and-mob-serialization.md`** —
that doc owns the dedup/per-observer bounds and the #56 separator-only track
engine (already built, running dark). This one adds *position* as a new
separator and states what it buys.

---

## The problem, as reported

Raid night 2026-07-30 (Hitya): four `a crypt guardian` pulled simultaneously.
In every surface that reads mob identity by NAME, they merged:

- **Extended Target** showed fewer rows than mobs, and every row carried the
  same debuff list — `debuffs = debuffsFor(g.key)` is computed once per NAME and
  attached to every HP cluster (`index.js:9762`).
- **HP** was whichever cluster's median won.
- **Damage** aggregated into one name-keyed bucket (`this.targets`,
  `packages/wolfpack-logsync/index.js:5876`).

None of this is a bug in the sense of a wrong line of code. It is the direct
consequence of the ceiling below.

---

## The ceiling (VERIFIED — do not re-derive, do not design around)

The Zeal named pipe's **entire mob surface** is two gauge slots:

| Slot | Meaning | Payload |
|---|---|---|
| 6 | current target | display `text` + `value` (HP per-mille 0–1000) |
| 16 | pet | display `text` + `value` |

**That is all.** No spawn id, no level, no body type, no location, no
range/bearing, no nameplate tag. Confirmed against a live 71.5s raw capture in
which four `an orc warrior` spawns were byte-identical across 2,386 events
(`docs/zeal-spawn-id-request.md`, `docs/zeal-pipe-protocol.md:112` and the
"Known ceilings" section at `:125`).

Therefore:

1. **Triangulating the MOB is mathematically impossible.** There is no range, no
   bearing, no loc, and no id in the stream. Multiple observers of the same mob
   give you N copies of `name + HP‰` and nothing that varies with geometry. No
   amount of consumer-side cleverness manufactures a coordinate.
2. **≥3 simultaneous same-name identities are unsupportable from pipe data
   alone**, and that stays true after everything in this doc. This is the
   CLAUDE.md scope boundary and it is not being relaxed here.

Rich per-entity data (name, level, class, **loc**, heading) is serialized only
for **raid (type 5)** and **group (type 6)** — i.e. *our own people*, never for
arbitrary NPCs (`docs/zeal-pipe-protocol.md:29-30`). That asymmetry is the whole
opening: we can't see mobs, but we can see *us*, precisely, in world
coordinates.

---

## The reframe

> A mob being tanked is, physically, a mob standing on top of a tank.

Melee combat in EQ happens inside a very small radius. If two mobs of the same
name are being held in two different places, then the **players in melee with
them are in two different places** — and those players' coordinates we have,
every heartbeat, already in Supabase. So:

**cluster count over engaged players ⇒ instance count**, and each cluster is a
handle we can hang a tank, an HP track, and a debuff set on.

Position separates two mobs at equal HP. HP separates two mobs standing on the
same spot. Used together they cover each other's blind spot. Neither is a
*joiner* — see the separator-only law inherited from
`DESIGN-dedup-and-mob-serialization.md:186-232`.

---

## What we actually have per stream (VERIFIED 2026-07-31 by reading source)

Anchors below were read, not assumed. (The prompt for this doc cited
`packages/wolfpack-logsync/index.js` ~13032/~13051 for loc + group loc — those
are the **dashboard explorer's render** of the data, inside `WEB_HTML`
(`:13039`, `:13059`). The ingest/upload anchors are the ones listed here.)

### Agent — `packages/wolfpack-logsync/index.js`

| Signal | Where | Shape / notes |
|---|---|---|
| Zeal state ingest from Mimic | `:18924` handler, stored at `:18981` (`_zealState[character] = { ...st, updatedAt }`) | whole per-character snapshot |
| **Self loc + heading** | built in Mimic at `apps/mimic/main.js:1170-1172` from the type-3 player payload (`location {x,y,z}`, `heading`) | raw Zeal x/y/z; EQ `/loc` prints Y,X,Z — transpose only for display |
| **Group-member loc + heading** | `apps/mimic/main.js:1282-1305` (type-6), lands in `st.group_members` | `{ name, loc, heading, hp_current, hp_max, class, level, zone_id }`; loc/heading always, the rest needs `/pipeverbose on` |
| **Raid roster (type 5)** | `:7331 _maybeUploadRaidRoster`, compacted at `:7360-7395` | Zeal sends `loc` + `heading` per member — **the compact mapping drops both**; only name/class/group/level/rank/hp survive |
| Self position → bot | `:26951 flushLiveStateToBot`, fields at `:27030-27032` | `loc_x/loc_y/loc_z` |
| Current target → bot | `:27024-27025` | `target_name`, `target_hp_pct` (Zeal slot 6) |
| **"Which mob is hitting me"** | computed `:26982-26988`, sent `:27033-27034` | `incoming_mob` + `incoming_mob_since`, from `stats.recentTankHits` within 20s |
| `recentTankHits` source | pushed at `:5644-5646` | `{ mob, mobDisplay, tank, tsMs }` — rampage hits deliberately excluded (`:5640-5643`) |
| Per-mob damage window | `:5884-5885` | `{ mob, amount, tsMs }` — **no attacker field**; who dealt it is not retained |
| Cumulative damage per mob NAME | `:5876` (`this.targets`) | name-keyed, the merge Hitya saw |
| #56 serial-track engine | `:26144-26310` | separator-only tracks, K per name, death-boundary close, HP-continuity assignment (`MOBTRACK_CONT_UP = 15`, `:26180`), stale expiry 90s (`:26179`); hooked at `:18380` (ext payload) and `:29747` (death line); kill switch `WP_SERIAL_TRACKS=0`, display gated by `WP_SERIAL_TRACKS_DISPLAY` (`:26183-26184`) |

### Bot — `index.js`

| Signal | Where | Shape / notes |
|---|---|---|
| live-state ingest | `_handleAgentLiveState` `:11556`, row built `:11654-11681` | writes `loc_x/loc_y/loc_z` (`:11651-11653`, `:11668-11670`), `target_name`/`target_hp_pct` |
| Extended Target aggregate | `_handleAgentExtendedTarget` `:9586` | the cross-client merge |
| **Existing HP serialization (#56 precedent)** | `clusterByHp` `:9686`, applied `:9759` | sorts a name's observations by HP, splits on a gap > `EXT_HP_SPLIT_TOL` (= 8, `:9546`, officer-tunable `ext_hp_split_tol`); emits `same_name_count` + `dup_index`, keeps `ambiguous` set |
| Debuffs per row | `debuffsFor` `:9720`, applied `:9762` | **one list per NAME, copied to every cluster** — the merge |
| Off-tank surfacing | `:9811-9840` | consumes `incoming_mob` (+ 30s freshness, `EXT_OFFTANK_FRESH_MS :9566`) |
| Distance helper | `utils/range.js:29 distance`, `:42 isLikelyOutOfRange` | 3D distance, fail-open on missing coords, `BUFF_RANGE_UNITS = 200` |

### Three gaps found while verifying (all load-bearing for this design)

1. **`incoming_mob` is dropped on ingest.** The agent sends it
   (`packages/wolfpack-logsync/index.js:27033`), the migration created the
   columns (`supabase/migrations/20260704221918_live_state_incoming_mob.sql`),
   and the Extended Target handler both selects (`index.js:9632`) and consumes
   it (`:9822-9829`) — but `_handleAgentLiveState`'s `rows.push`
   (`index.js:11654-11681`) never includes it. Verified against prod:
   `select count(*), count(incoming_mob) from character_live_state` →
   **555 rows, 0 non-null**. The off-tank feature has been reading a
   permanently-NULL column. **This is the single highest-value fix in the doc
   and it is two lines** — and it is precisely the "which player is tanking a
   mob of name N" signal the clustering needs. *(Bot change → `main`; flag it
   to the coordinator rather than folding it into a serialization feature.)*
2. **Extended Target does not select position.** `:9629-9633` selects
   `character, zone_name, self_hp*, target_name, target_hp_pct, pet_*,
   incoming_mob*, updated_at` — no `loc_*`. The data is in the table (286/555
   rows carry `loc_x` today); the handler simply doesn't ask for it.
3. **Raid/group positions never leave the machine.** Zeal gives loc for every
   raid member (type 5) and every group member (type 6); the agent keeps them in
   `_zealState` for the dashboard explorer only. `raid_roster` has no loc
   columns at all (verified: `guild_id, name, class, group_num, level, rank,
   captured_at, uploaded_by_discord_id, hp_pct, hp_current, hp_max`). So
   raid-wide position coverage today = **only raiders running Mimic**, via
   `character_live_state`. Forwarding type-5 loc would give position for
   *every raider in the raid window* from a handful of uploaders — a large
   coverage multiplier for one field pair. (Privacy note: intra-guild raid
   positions of guildmates, same class of data as HP; needs the `docs/PRIVACY.md`
   pass before shipping.)

---

## The clustering approach

### Step 1 — the engaged set

For a mob name `N` in one zone, `E(N)` = raiders with recent evidence of melee
engagement with something called `N`:

- `incoming_mob == N` and `incoming_mob_since` within ~20-30s (they are being
  hit by it → they are standing in it), **and/or**
- `target_name == N` **and** they are a melee class (from `raid_roster.class`).

**Only melee-proximate evidence may enter `E(N)`.** A cleric healing the tank is
up to 200 units away; a wizard is further; a ranger is wherever. Their positions
carry no information about where the mob is, and including them is the fastest
way to manufacture a phantom cluster. This restriction is what makes the
clustering sound, and it is also its main coverage cost.

### Step 2 — cluster

Single-linkage (agglomerative) over `E(N)` on 3D distance
(`utils/range.js:29 distance`, which already fails open on missing coords):

```
MELEE_CLUSTER_UNITS = 25          // tunable; EQ melee reach + client jitter + heartbeat staleness
clusters = []
for p in E(N) sorted by name:                 // stable order ⇒ stable ordinals
  hit = [c for c in clusters if min(distance(p, q) for q in c) <= MELEE_CLUSTER_UNITS]
  if hit is empty:      clusters.append([p])
  elif len(hit) == 1:   hit[0].append(p)
  else:                 merge(hit) + [p]      // p bridges them ⇒ one mob, not two
K_pos = len(clusters)
```

Single-linkage is the right family precisely because a bridging player *merges*
clusters — the conservative direction. We want to under-report instance count,
never over-report it (a phantom split is the visible failure; an honest merge is
today's behavior).

**`K_pos` is a LOWER BOUND on instance count, never an upper bound.** Two mobs
on one spot give `K_pos = 1`. That is correct behavior for a lower bound.

### Step 3 — combine with HP

```
K = max(K_pos, K_hp, K_track)
```

- `K_hp` = clusters from the existing `clusterByHp` (`index.js:9686`).
- `K_track` = the agent's #56 open-track count (`_mobTrackK`, `:26262`).

`max` because each is a **separator**: each can only ever *prove* that two
observations are different mobs. None can prove two observations are the same
mob, so none may lower `K`. This is the identical logic to the existing
never-merge law (`DESIGN-dedup-and-mob-serialization.md:228`).

Where `K_pos` and `K_hp` both fire, cross-check them: a position cluster whose
members report HP within tolerance and a HP cluster whose members are co-located
are the *same* instance, and that agreement is what lets us bind a tank name to
an HP track with confidence. Where they disagree (2 position clusters, 1 HP
cluster — two mobs both at 100%), position wins and `K = 2`.

### Step 4 — assignment of events to instances

Each instance gets a key: `zone | name | ordinal`, ordinal assigned first-seen
and stable until the instance's track closes (mirrors the #56 ordinal rule,
`DESIGN-dedup-and-mob-serialization.md:280-283`).

| Event | Assignment rule | Confidence |
|---|---|---|
| HP sample from observer `O` targeting `N` | the instance whose cluster contains `O`, if `O ∈ E(N)`; else the HP-continuity match (#56 `_mobTrackObserveHpBatch`) | high / medium |
| Melee damage by player `P` onto `N` | the instance whose cluster contains `P` | high |
| Incoming damage on tank `T` from `N` | the instance whose cluster contains `T` | high |
| **Debuff landing** cast by `C` onto `C`'s target `N` | the instance matching `C`'s **target's HP** at cast time, and — when `C` is melee-range — `C`'s cluster | **medium; this is the one that must not be wrong** |
| Ranged/spell damage by a non-melee `P` | not assignable by position; falls back to name-level aggregate | low → stays aggregate |

Debuff attribution is the payload feature (it's the merge Hitya actually
noticed) *and* the one with the worst failure mode. Rule 2 of the existing
design applies unchanged and is restated as law here: **a track never inherits
timers from another track**, and where attribution is ambiguous the UI shows
ambiguity ("on #1: tash", dimmed) rather than guessing. Wrong timer capture is
strictly worse than an honest "we don't know".

### Step 5 — cross-client merge through the bot

All of this belongs **bot-side**, in `_handleAgentExtendedTarget`, for the same
reason `clusterByHp` does: only the bot sees every uploader at once, and
ordinals must agree across clients or the overlays disagree with each other.
Concretely, in the existing handler:

1. add `loc_x,loc_y,loc_z` to the select at `:9629-9633` (gap 2 above);
2. build `E(N)` from `incoming_mob` (gap 1) + melee-class targeters;
3. run the position clustering, then reconcile with `clusterByHp` at `:9759`;
4. replace `debuffs = debuffsFor(g.key)` (`:9762`) with a per-instance debuff
   set when `K ≥ 2`, and leave it **byte-identical** when `K = 1`.

The existing 1.5s bundle memo (`globalThis._extBundleCache`, `:9624-9634`)
already absorbs ~20 agents polling every 2-3s, so this adds clustering CPU once
per 1.5s per zone, not per request.

**The K = 1 guarantee is non-negotiable**: while a name has one instance —
overwhelmingly the common case, and every single-boss raid fight — every byte of
every payload must be what it is today. Same fixture/byte-compare discipline as
`DESIGN-dedup-and-mob-serialization.md:271-275`.

---

## HP-continuity pairing

Position and HP fail in exactly opposite conditions, which is the argument for
carrying both:

| | mobs apart | mobs piled together |
|---|---|---|
| **HP differs** | both work | HP separates |
| **HP equal** | position separates | **nothing works — collapse** |

The #56 engine already does the HP half (per-name tracks, continuity assignment,
`MOBTRACK_CONT_UP = 15` treats a rise >15pp as a retarget/new instance rather
than a heal, death closes exactly one track). Position clustering slots in as a
new *separator input* to the same engine rather than a parallel system: a batch
of same-name HP samples whose observers sit in two clusters is proven-simultaneous
even at identical HP, so `_mobTrackObserveHpBatch` (`:26207`) can open the
parallel track it would otherwise decline to open.

**Correction from 2026-07-30 (keep this — it reversed an earlier assumption):**
the two-pull observed at **44% vs 90%** showed that in practice HP variance
between simultaneous same-name mobs is usually a **real, large signal**, not
noise. The earlier framing treated HP proximity as the common case and position
as the rescue; the field data says HP alone already separates most real pulls,
and position is the rescue for the *minority* case of equal-HP mobs (fresh
simultaneous pulls, AE-equalized adds). That changes the sequencing: HP
clustering is the workhorse, position is the second separator. It does **not**
change the algorithm — `max()` over separators is correct either way.

---

## Failure modes (stated honestly)

1. **Mobs piled on one spot.** Tanks standing on each other → one position
   cluster → `K_pos = 1`. If HP is also equal, they collapse, exactly as today.
   No fix exists in this data. This is the designed-for degradation, not a bug.
2. **Coverage scales with Mimic adoption, and adoption is partial.** Measured
   2026-07-30/31: `raid_roster` saw **42 then 73** distinct members with
   **16 then 20-21** distinct Mimic uploaders — roughly **30-45% adoption**. On
   the same nights `character_live_state` carried **44/46 and 54/55** rows with
   position, so *among Mimic runners* position coverage is ~96%; the gap is
   adoption, not the pipe. If nobody tanking a given crypt guardian runs Mimic,
   that instance is invisible to the clustering. Forwarding type-5 raid loc
   (gap 3) is the highest-leverage mitigation: a handful of uploaders would
   cover the whole raid.
3. **AE damage equalizing HP.** A raid AE drives several same-name adds to
   near-identical HP and collapses `K_hp`. Position is the only separator left,
   and it only works if they're tanked apart.
4. **Position staleness.** `loc_*` rides the live-state heartbeat, not the
   change signature — it is deliberately excluded from the change signature
   because it churns on every step (`packages/wolfpack-logsync/index.js:27026-27029`).
   A moving fight (kiting, a train) can cluster on stale coordinates. Mitigation:
   require `updated_at` freshness before a raider may enter `E(N)`, and prefer
   `incoming_mob_since` proximity to the sample time.
5. **Melee-only restriction shrinks the engaged set.** On a caster-heavy pull
   `E(N)` may be one tank per mob, i.e. clusters of size 1 — workable, but a
   single stale coordinate then decides an instance. Require ≥1 fresh member per
   cluster; otherwise don't raise `K`.
6. **Rampage / riposte pollution.** Already handled upstream: `recentTankHits`
   excludes rampage hits at record time (`:5640-5643`), and the #56 engine
   structurally refuses to let the victim signal raise `K`
   (`DESIGN-dedup-and-mob-serialization.md:196-226`). Position clustering must
   inherit that: a rampage victim standing across the room must not open a
   second cluster. Since rampage victims are themselves in melee range this is
   mostly self-correcting, but the `E(N)` predicate should prefer
   `incoming_mob` evidence that survived the rampage filter.
7. **Zone boundaries and instanced zones.** Cluster only within a zone;
   `_handleAgentExtendedTarget` already scopes by zone (#113/#141), and #141's
   lesson — same-name mobs in *different* zones merged catastrophically — is the
   precedent for never letting a cluster span zones.

---

## Explicit non-goals

- **≥3 co-located same-name mobs remain unsupportable.** Nothing here changes
  the CLAUDE.md scope boundary. If three crypt guardians are tanked on one spot
  with similar HP, we get one row and we say so.
- **We are not deriving mob coordinates.** The clusters are *player* clusters.
  Nothing in this design ever claims to know where a mob is; it claims to know
  which raiders are standing in the same fight.
- **Parse/encounter splitting is out of scope.** Damage totals stay name-keyed
  with the existing death-boundary segmentation (#47/#51) and the RPC's
  sequential-kill splitter. Serialization is a **live-display** layer.
  (`DESIGN-dedup-and-mob-serialization.md:257-260`.)
- **No memory reading, ever.** A companion-side spawn-list walker would answer
  all of this and is refused on principle
  (`docs/zeal-spawn-id-request.md:106-111`).
- **This is not a substitute for the upstream fix.** One additive `spawn_id`
  field on gauge slots 6 and 16 collapses every heuristic in this document into
  an exact key. `docs/zeal-spawn-id-request.md` is written, low-risk by
  construction (additive, no new spawn-list walk, two slots), and has been
  sitting as a **draft** since 2026-07-08. **Recommendation: actually send it to
  CoastalRedwood/Zeal.** Cost is one issue filed; upside is that phases 1-2
  below become unnecessary. It should be sent *before* we build phase 2, not
  after.

---

## Phased plan

### Phase 0 — the two-line correctness fix (do this regardless)
Persist `incoming_mob` / `incoming_mob_since` in `_handleAgentLiveState`'s row
(`index.js:11654-11681`). Fixes the already-shipped off-tank feature
(`:9811-9840`) which has been reading NULLs, and is a prerequisite for `E(N)`.
Bot → `main`. Independent of everything below; route it as its own change.

### Phase 1 — two-instance separation on existing uploads (no agent change)
Bot-side only, behind a tuning flag, using data already in
`character_live_state`:
- select `loc_*` in the ext-target handler;
- build `E(N)`, cluster, compute `K_pos`, take `max(K_pos, K_hp)`;
- at `K ≥ 2`: per-instance HP + tank label + **per-instance debuff sets**
  (the actual fix for the reported symptom);
- at `K = 1`: byte-identical output, enforced by a fixture.
- Soak in shadow first — log `K_pos` vs `K_hp` vs reality on raid nights, same
  P0 discipline the #56 engine already uses (`WP_SERIAL_TRACKS_DISPLAY`).
Scope: two instances. Deliberately capped — two is what the data supports well,
and it covers the common "two adds tanked apart" case.

### Phase 2 — N instances + overlay surfacing + raid-wide position
- Forward Zeal type-5 `loc`/`heading` (agent `:7382-7395` + `raid_roster`
  columns + PRIVACY.md pass) so position coverage stops being adoption-limited.
- Feed `K_pos` into the agent's #56 engine as a separator so local tracks and
  the bot aggregate agree.
- Extended Target / Target Info render per-instance rows with ordinals, tank
  tags, and per-instance debuff chips (components C2/C3 of the existing #56
  design — they were specified there and stay valid).
- Cap `N` at whatever the soak shows is trustworthy, and hard-stop at the
  co-located ceiling with an honest "≥N tracked, some may be the same".

### Phase 3 — only if the upstream ask lands
`spawn_id` on slots 6/16 → replace every heuristic with an exact key; keep the
clustering only as a fallback for pre-upgrade clients.

---

## Open questions (for Hitya)

1. **Is the debuff split the actual want, or is it per-instance HP?** They're
   separable — per-instance HP is easier and lower-risk; per-instance debuffs is
   the one with real false-attribution downside. Which does raid night need
   first?
2. **False split vs honest merge.** When we're unsure, do you want two rows
   marked "possibly the same" (the existing design's choice), or one merged row
   marked "possibly 2 mobs"? The current shipped behavior is the latter.
3. **Send the Zeal `spawn_id` request?** It's drafted and has been idle three
   weeks. If yes, who files it — and do we offer CoastalRedwood the
   four-same-name-mob repro capture we already have?
4. **Raid-wide position forwarding** (phase 2): guildmate coordinates leaving
   the machine is a new data class. Comfortable? Officer-only, or fine raid-wide?
   Needs a `docs/PRIVACY.md` line either way.
5. **Mimic adoption target.** Clustering coverage is a direct function of it
   (30-45% today). Is pushing adoption a lever you want to pull, or should the
   design assume it stays where it is?
6. **`MELEE_CLUSTER_UNITS` (proposed 25)** — better set from a live capture than
   guessed. Worth a raid-night measurement of tank-to-tank distance on a
   two-add pull?

---

## Dependencies / cross-refs

- **Parent design:** `docs/DESIGN-dedup-and-mob-serialization.md` — dedup
  classes, the separator/joiner asymmetry, the rampage correction, the K-invariant,
  and the #56 component breakdown. Everything here inherits those laws.
- **The ceiling:** `docs/zeal-spawn-id-request.md` (the clean fix — **send it**),
  `docs/zeal-pipe-protocol.md` (full field reference + known ceilings).
- **Shipped precedent:** #56 HP serialization — bot `clusterByHp`
  (`index.js:9686`), agent track engine
  (`packages/wolfpack-logsync/index.js:26144-26310`, running dark).
- **Sequential tooling that already works and is untouched:** #47/#51
  death-boundary segmentation; the `find_or_create_encounter` sequential-kill
  splitter (CLAUDE.md → Supabase).
- **Zone-scoping precedent that must not regress:** #113 (Extended Target) and
  #141 (Mob Info / target-buffs / target-casts).
- **Reused helper:** `utils/range.js` (3D distance, fail-open).
- **Roadmap placement:** `docs/DESIGN-platform-queue.md:147` Wave 5 data-quality
  tail, alongside [#47]/[#51]/[#56].
