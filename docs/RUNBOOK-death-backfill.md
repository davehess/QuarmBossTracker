# RUNBOOK — correcting the death record (#200 / #201 / #202)

*Written 2026-08-04 (overnight). **Rehearsed, not executed.** Every query below
was run read-only against prod; nothing was written. This stops at a confirm
gate because #200 is Hitya's call, not mine.*

---

## 0. The original complaint, fully explained

Uilnayar, 2026-08-03, on a Vex Thal parse card:

> the deaths on this parse aren't accurate. dongru did not die twice at the
> beginning of the fight. Uilinayer didn't either

Three names, **three different causes**. Here is the evidence.

### Uilnayar — one death, seven observers, one bad clock

Uilnayar died **once**. Seven machines recorded it:

| observer | stamp | corrected (`+offset`) |
|---|---|---|
| **Fargan** | **00:52:32** | **00:53:14** |
| Seaman | 00:53:17 | 00:53:17 |
| Ikibob | 00:53:17 | 00:53:17 |
| Ashieron | 00:53:19 | 00:53:19 |
| Hitya | 00:53:19 | 00:53:19 |
| Menttok | 00:53:20 | 00:53:20 |
| Dant | 00:53:23 | 00:53:23 |

Six observers agree inside **6 seconds**. Fargan is **45 seconds early** — and
Fargan's install is the one measured at `offset_ms = +42,280` (their clock runs
42.3s slow). The dedup window is **30s**, so the 45s gap read as two separate
deaths and the card said Uilnayar died twice.

**Correcting Fargan's stamp moves it to 00:53:14 — 2.7s before the cluster, well
inside the 30s window, and it collapses to one death.** No window retune needed.
This is the whole argument for doing #202 (apply the offset) *before* #201 (retune
the window): with the timestamps corrected, the existing window is already right.

Uilnayar is a **Cleric** and cannot feign. This one is pure clock skew.

### Syko — feign spam

119 death rows, 15 observers, 5 fights. Shadow Knight. `"<Name> dies."` is the
`cast_on_other` of Death Peace. Worst single fight: **63 "deaths" for one
character**. Nobody dies 63 times in a fight.

### Dongru — both

Shadow Knight, 13 rows / 10 observers / 3 fights. Some feign, some multi-observer
skew. Needs the feign fix *and* the offset correction to come out right.

---

## 1. What is actually at stake (smaller than it sounds)

**Deaths do not have a durable home.** They live in `contributions.raw_parse`,
and the midnight job **nulls `raw_parse` after 7 days** (`index.js` ~2895 —
`encounter_players` keeps the merged damage totals permanently; the JSONB blob is
considered debugging data). `utils/raidReview.js` says it plainly: *"nulled by the
midnight compaction after 7 days, so an old night renders without the deaths
section."*

So the entire stored death corpus, as of 2026-08-04:

| | |
|---|---|
| raw death rows | **534** |
| spanning | 2026-07-28 → 2026-08-03 (**7 days**) |
| contributions carrying deaths | 129 |
| dropped by the phantom rule before display | **193** |
| **actually displayed** after phantom + 30s dedup | **83** (51 people, 22 fights) |
| of those, from feign-capable classes (SK/Necro) | **19** |

Two consequences, and they point in opposite directions:

1. **The urgency is low.** This window ages out on its own around **2026-08-10**.
   Doing nothing is a real option with a real end date.
2. **The loss is bigger than the error.** We have *no death history at all* beyond
   7 days. "Who dies most", "are we improving on this boss", "which mechanic kills
   us" — none of those are answerable, and never have been. **That** is the thing
   worth fixing, and now is the right moment: everything from agent 3.5.11 forward
   is trustworthy for the first time.

### The phantom rule was doing the right thing for the wrong reason

`utils/parseDeaths.js` drops a name entirely from a fight if **any single
contributor** reported it dying ≥2 times — written for the "Syphon" NPC-namesake
bug (2026-06-25). It also happened to absorb most feign spam, which is why the
cards weren't showing 63 deaths.

**After the feign fix, this rule becomes actively harmful.** Its premise — *"a
real player can only die once per encounter"* — is false: rez, re-engage, die
again is normal on a long fight, and a **rogue corpse pull deliberately eats a
death** (`DESIGN-death-semantics.md`). With feigns gone, the rule's only remaining
job is the NPC-namesake case, which is better solved by name disambiguation than
by discarding data. Revisit it as part of #200.

---

## 2. Order of operations (this order, for a reason)

> **Do not reorder.** Each step's correctness depends on the previous one having
> run. This is the same trap as the two-pass consensus estimator: a single pass
> is dragged by the very skew it is trying to measure.

### Step 1 — stop making it worse (agent floor)

The feign fix is agent **3.5.11**, which is on **`beta`**. `main`'s agent copy —
what stable Mimic bundles and what `release-parser.yml` ships — **still has the
bug** (`packages/wolfpack-logsync/index.js` line ~964, `/die[ds]\./`). That is
correct per the routing rule, but it means **stable installs are still generating
false deaths right now.**

Any correction applied before the fleet is on ≥3.5.11 will be re-polluted by the
next raid. Either graduate the beta to stable first, or scope the correction to
`contributions.agent_version >= 3.5.11` and accept that older rows stay wrong
until they expire.

*Check the fleet before deciding:*
```sql
select agent_version, count(*) uploads, max(created_at) last_seen
from contributions where created_at > now() - interval '14 days'
group by 1 order by string_to_array(agent_version,'.')::int[] desc;
```

### Step 2 — apply the clock offset (#202)

Nothing downstream is trustworthy until stamps are comparable. Store the
correction, **keep the raw value** — provenance is not optional, and the offsets
themselves get better over time (`spread_ms` on most rows is currently 12–15s,
which is honest noise; the two outliers sit far outside it).

Recommended: `corrected_at` alongside `at`, applied at ingest, with a read-time
fallback for existing rows. Read-time-only means every consumer must remember,
and they won't.

*Sanity check after:* re-run the Uilnayar query in §0 and confirm the seven
stamps collapse to one cluster.

### Step 3 — remove feigns from the stored window (#200) ← **CONFIRM GATE**

Only now. A feign filter run on skewed timestamps mis-attributes which rows are
duplicates of which.

The identification is not "SK/Necro rows are feigns" — SKs really die. Rank by
evidence:

- **Certain:** the same name dying ≥3 times in one fight from one observer.
  Physically impossible.
- **Strong:** a feign-capable class with no corpse-run tail (`confirmed:false`)
  *and* another death by the same name within the fight.
- **Weak, leave alone:** a single unconfirmed death by an SK. Might be real.
  `confirmed:false` means **"no proof either way"**, never "this was a feign"
  (`DESIGN-death-semantics.md`) — a rezzed death is real and unconfirmable, and a
  rogue corpse pull looks identical.

**Do not delete. Mark.** Add a `suspect_feign` flag on the death entry and have
the display filter it. A deletion is unreviewable and unwindable; a flag can be
audited on Wednesday and flipped back.

> **⚠ STOP HERE.** Three options for Hitya:
> **(a)** do nothing — the window self-clears ~2026-08-10;
> **(b)** flag + a roadmap note explaining that death counts changed *(recommended)*;
> **(c)** flag silently.
> Option (b) costs one paragraph and prevents "why did my death count change".

### Step 4 — re-derive the dedup window (#201)

**Only after steps 2 and 3, and only from a clean raid night.** The current 30s
was fitted against feign-inflated, skew-spread data — both premises are now
false. Measure the residual multi-observer spread on confirmed single deaths and
set the window from that distribution. Given step 2, expect the answer to be
*smaller* than 30s, not larger.

Do not eyeball it. That's how we got 30s.

### Step 5 — give deaths a durable home (the actual win)

Promote deaths out of the expiring blob into a real table, the way
`encounter_players` holds damage. Carry `confirmed`, `suspect_feign`, the raw and
corrected stamps, and the observer count. Everything from 3.5.11 forward is
trustworthy, so **start the durable record at that version** and don't backfill
the untrustworthy part.

---

## 3. Re-runnable diagnostics

**Current corpus + display funnel:**
```sql
with raw as (
  select c.encounter_id, c.id contrib_id, (e->>'name') nm, (e->>'ts')::timestamptz ts
  from contributions c, jsonb_array_elements(c.raw_parse->'deaths') e
  where jsonb_typeof(c.raw_parse->'deaths')='array'),
phantom as (select encounter_id, lower(nm) nk from raw
            group by encounter_id, contrib_id, lower(nm) having count(*)>=2),
surviving as (select r.* from raw r where not exists
  (select 1 from phantom p where p.encounter_id=r.encounter_id and p.nk=lower(r.nm))),
w as (select encounter_id, lower(nm) nk, ts,
        ts - lag(ts) over (partition by encounter_id, lower(nm) order by ts) gap
      from surviving)
select (select count(*) from raw) raw_rows,
       (select count(*) from surviving) after_phantom,
       (select count(*) from w where gap is null or gap > interval '30 seconds') displayed;
```

**Multi-observer spread on a single death** (the skew detector — swap the name):
```sql
select c.contributor_character obs, (e->>'ts')::timestamptz ts, o.offset_ms
from contributions c, jsonb_array_elements(c.raw_parse->'deaths') e
left join agent_clock_offsets o
  on o.discord_id = c.contributor_discord_id and o.method='consensus'
where lower(e->>'name') = 'uilnayar' order by ts;
```

**Worst offenders by deaths-per-fight** (feign detector):
```sql
with u as (select distinct c.encounter_id, (e->>'name') nm, (e->>'ts')::timestamptz ts
  from contributions c, jsonb_array_elements(c.raw_parse->'deaths') e
  where jsonb_typeof(c.raw_parse->'deaths')='array')
select nm, encounter_id, count(*) n from u group by 1,2 having count(*) > 3
order by n desc limit 20;
```

---

## 4. Loose end worth one minute

`agent_clock_offsets.discord_id = 272226525426876416` — the +42.3s install, the
one that caused the Uilnayar double-death — has **no matching `characters` row**,
so it renders as an anonymous id everywhere. The contributor character on those
uploads is **Fargan**. Linking that account would make the skew report name a
person instead of a number, which matters for #203 ("tell the two skewed
installs").
