# PATCH — Tower `archive-merge.sql`: merge in FK order

**For the local session with Tower access.** Written 2026-09-23 02:03 UTC
(2026-09-22 22:03 ET). Self-contained; no prior conversation needed.

---

## ★ Updated 2026-09-23 ~03:30 UTC — skip the hand-patching. Take the repo file.

The first version of this doc said Tower was *ahead* of the repo, so you had to
patch your own file. That was true then. **It is not now:** the repo's
`archive-merge.sql` has absorbed all three of Tower's hand fixes, plus the FK
order, the two-pass delete, and the unique-index fix. It is a functional superset
of anything you could hand-build from the Parts below, and it passes **19 of 19**
— no cosmetic failure. A full merge of a 200k-row table over postgres_fdw runs in
1.55 s.

⚠ And one of your three fixes turned out to be the important one. `=` instead of
`is not distinct from` is **not** cosmetic: DISTINCT FROM cannot hash, so every
join across the foreign table becomes a Nested Loop. Measured on 200k rows —
`=` 224 ms, DISTINCT FROM still running at a 60 s cap, growing quadratically.
At the archive's ~1.2M rows the old repo file would effectively never finish.
That is very likely why you changed it on 09-06.

This ends the two-copies drift that made tonight hard. Run these in order; each
step says what it should print.

**1 — Gate: is Tower's drift exactly the three known fixes?** Compares your
pre-tonight backup against the repo version it came from, and filters out the
three fixes. **Nothing printed = clean.** Anything printed = unknown drift: stop
and send it to me, and fall back to the Parts below.

```bash
cd /mnt/user/backups/wolfpack/repo
curl -fsSL https://raw.githubusercontent.com/davehess/QuarmBossTracker/2bc7b900480c7ed045eb0d201511142081d52269/scripts/lib/archive-merge.sql \
  | diff - scripts/lib/archive-merge.sql.bak-20260923 | grep '^[<>]' \
  | grep -v -e is_generated -e 'overriding system value' -e '= d\.%1\$I' \
            -e 'is not distinct from d\.%1\$I' -e 'insert into public\.%1\$I (%2\$s) select %2\$s from snap\.%1\$I'
```

(Validated here both ways: silent on a simulated `.bak` carrying exactly your
three fixes, and it printed an injected `order by c.relname desc` straight away.)

**2 — Keep your hand-patched copy, then take the repo file.**

```bash
cp scripts/lib/archive-merge.sql scripts/lib/archive-merge.sql.handpatched-20260923
curl -fsSL -o scripts/lib/archive-merge.sql \
  https://raw.githubusercontent.com/davehess/QuarmBossTracker/bffb587132df37aeb6052ccb6a0f26a33d796118/scripts/lib/archive-merge.sql
md5sum scripts/lib/archive-merge.sql    # 92f6a42c1c90658b9e8b0956c161a520
```

(Pinned to the commit, not the branch: raw GitHub caches branch URLs for a few
minutes, so a branch fetch right after a push can quietly serve the previous
file. A commit URL cannot change. If the md5 still differs, stop.)

Leave **`refresh-local-archive.sh` exactly as it is** — your `drop … with
(force)` and snapshot connection settings are not in the repo yet.

**3 — Test. Expect 19 `ok` and `PASS`.** (You already have the 19-assertion test
at `/tmp/test-archive-merge.sh`, md5 `a35e0943…`.)

```bash
docker exec -i supabase-db mkdir -p /tmp/mt/scripts/lib
docker cp scripts/lib/archive-merge.sql  supabase-db:/tmp/mt/scripts/lib/
docker cp /tmp/test-archive-merge.sh     supabase-db:/tmp/mt/scripts/test-archive-merge.sh
docker exec -i supabase-db bash -lc 'cd /tmp/mt && PGUSER=postgres bash scripts/test-archive-merge.sh'
docker exec -i supabase-db rm -rf /tmp/mt
```

**4 — Merge**, then send me the two queries in §5.

```bash
bash scripts/refresh-local-archive.sh
```

Everything below this line is the hand-patch route. Use it only if the gate in
step 1 prints something.

---

## The hand-patch route (fallback only)

**You were right to stop at the checksum.** Tower's copies were *ahead* of the
repo when this was first written, and shipping the repo's file then would have
thrown away three hand fixes. This route patches **your** file instead.

## 0. What to do, in order

1. Back up Tower's current `archive-merge.sql`.
2. Apply **Part 1** (required — FK merge order).
3. Apply **Part 3** (required — the `who_obs_dedup` failure; 17 tables can hit it).
4. Apply **Part 2** (recommended — see what skipping it costs).
5. Re-fetch the self-test (it grew to **19 assertions** tonight) and run it.
   Expect **18 ok + one specific known failure**, spelled out in §3. Anything
   else red: stop, send it to me.
6. Run `refresh-local-archive.sh`.
7. Send back the two verification queries in §5.

⚠ **Two bugs down, and the second was hiding behind the first.** Each failure is
atomic — the archive is untouched, your own verification proved it (915,340 rows,
`merge_log` still 2026-09-06). There may be a third. Re-running is free, so the
loop is: patch, test, merge, send me whatever it says.

Do **not** write anything to production Supabase. The watermark is set
separately, from the cloud side, after you confirm the new `max(snapshot_at)`.

## 1. Why your copies win, and the repo's file is the broken one

Two of your three `archive-merge.sql` fixes I could verify directly, on a
throwaway Postgres 16:

- **`overriding system value`** — on an ordinary table it is completely inert
  (`INSERT 0 1`, no error, no warning). On a `generated always as identity`
  column, an insert **without** it fails outright:
  `ERROR: cannot insert a non-DEFAULT value into column "id"`. So your clause is
  correct and costs nothing, and **the repo's version is the one that breaks.**
- **skipping generated columns** — same class: a generated column cannot be
  inserted into at all.
- **`=` instead of `is not distinct from`** — faster and indexable; the only
  thing it gives up is matching a NULL key column against a NULL, which cannot
  happen in a primary key.

`refresh-local-archive.sh`'s `drop … with (force)` and the snapshot connection
settings (fetch size, remote estimates) are yours too, and nothing in this patch
touches that file. Leave it exactly as it is.

⚠ **Follow-up, not tonight:** when there is time, send me Tower's current
`archive-merge.sql` and `refresh-local-archive.sh` so the repo can absorb these.
Right now the published version would fail on any table with an identity or
generated column, and nobody would know until it did.

## 2. The patch

### Part 1 — required. Order by the FK graph instead of by name.

In the main `for t in … loop`, replace the single line:

```sql
    order by c.relname
```

with:

```sql
    order by (
      with recursive fk_edges as (
        select cl.relname::text as child, pl.relname::text as parent
          from pg_constraint con
          join pg_class cl on cl.oid = con.conrelid
          join pg_class pl on pl.oid = con.confrelid
          join pg_namespace cn on cn.oid = cl.relnamespace
          join pg_namespace pn on pn.oid = pl.relnamespace
         where con.contype = 'f'
           and cn.nspname = 'public' and pn.nspname = 'public'
           and cl.relname <> pl.relname
      ),
      up (tbl, depth) as (
        select c.relname::text, 0
        union all
        select e.parent, u.depth + 1
          from up u join fk_edges e on e.child = u.tbl
         where u.depth < 32
      )
      select max(depth) from up
    ), c.relname
```

**That is the whole fix.** It walks each table *up* to its FK ancestors and
sorts by how deep it sits, so `encounters` is merged before `charm_sessions`.
Nothing else in the header, the loop body, or your three hand fixes is touched —
which is why it is safe against drift I cannot see. `depth < 32` is the cycle
guard; production's graph is a clean DAG four levels deep, so it never bites.

### Part 3 — required, added 2026-09-23 03:00 UTC after the second failure.

With Parts 1 and 2 in, the merge got past `charm_sessions` and died further
along on a **different, older bug**:

```
ERROR:  duplicate key value violates unique constraint "who_obs_dedup"
DETAIL: Key (guild_id, "character", observed_minute, uploaded_by)=(…) already exists.
```

`ON CONFLICT (id)` nominates **one** index, and Postgres allows only one. But
**17 of the 25 archive tables carry a second unique index** beside the primary
key — `who_obs_dedup`, `chat_messages_dedup`, `tells_dedup`, `looted_items_dedup`,
`encounter_threat_snapshots_unique`, and a dozen more. When the archive keeps a
row production later pruned and re-created under a fresh surrogate id, the
snapshot offers the same observation under a *different* id: no primary-key
conflict, so `ON CONFLICT (id)` never fires and the dedup index raises instead —
taking the whole run down. Latent since 2026-08-12; invisible only because the FK
bug aborted first. A per-table fix is worthless here.

**Edit A** — one line. Find:

```sql
    select string_agg(format('%1$s = excluded.%1$s', c), ', ')
```

Replace with:

```sql
    select string_agg(format('%1$s = s.%1$s', c), ', ')
```

**Edit B** — replace the whole `if update_set is null then … end if;` insert
block (both branches) with:

```sql
    -- Update matched rows by primary key, then insert the rest with a BARE
    -- `on conflict do nothing` so EVERY unique index is covered, not just the
    -- primary key. (17 of 25 archive tables carry a second one.)
    if update_set is not null then
      execute format('update public.%1$I d set %2$s from snap.%1$I s where %3$s',
                     t.tbl, update_set,
                     (select string_agg(format('s.%1$I = d.%1$I', c), ' and ')
                        from unnest(pk_cols) c));
    end if;

    execute format('insert into public.%1$I (%2$s) overriding system value
                    select %2$s from snap.%1$I on conflict do nothing',
                   t.tbl, col_list);
```

A row skipped by `do nothing` is one the archive already holds under a different
id — the same observation, not a loss. Mirror tables cannot reach that case at
all: Part 2 has already removed anything the snapshot lacks, and two rows sharing
a dedup key could never have coexisted upstream.

### Part 2 — recommended. Delete children before parents.

Part 1 makes the single loop run **parents first**, which is right for inserts
and *wrong for deletes*: a mirror parent whose row vanished upstream still has
local children until their own turn. So the deletes get their own pass, first,
in the reverse order.

This is **purely additive** — paste it immediately after `begin`, before the
existing `for t in`. The delete already inside the main loop then finds nothing
left to delete and succeeds trivially, so you do not remove anything.

```sql
  -- PASS 0 — mirror deletes, CHILDREN FIRST (Part 1's ordering, reversed).
  for t in
    select c.relname as tbl
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and exists (select 1 from pg_class c2 join pg_namespace n2 on n2.oid = c2.relnamespace
                  where n2.nspname = 'snap' and c2.relname = c.relname)
    order by (
      with recursive fk_edges as (
        select cl.relname::text as child, pl.relname::text as parent
          from pg_constraint con
          join pg_class cl on cl.oid = con.conrelid
          join pg_class pl on pl.oid = con.confrelid
          join pg_namespace cn on cn.oid = cl.relnamespace
          join pg_namespace pn on pn.oid = pl.relnamespace
         where con.contype = 'f'
           and cn.nspname = 'public' and pn.nspname = 'public'
           and cl.relname <> pl.relname
      ),
      up (tbl, depth) as (
        select c.relname::text, 0
        union all
        select e.parent, u.depth + 1
          from up u join fk_edges e on e.child = u.tbl
         where u.depth < 32
      )
      select max(depth) from up
    ) desc, c.relname desc
  loop
    select array_agg(a.attname order by k.ord)
      into pk_cols
    from pg_constraint con
    cross join lateral unnest(con.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
    where con.conrelid = ('public.' || quote_ident(t.tbl))::regclass
      and con.contype = 'p';
    if pk_cols is null then continue; end if;

    if not (t.tbl = any (archive_tables)) then
      execute format(
        'delete from public.%1$I d where not exists (select 1 from snap.%1$I s where %2$s)',
        t.tbl,
        (select string_agg(format('s.%1$I = d.%1$I', c), ' and ')
           from unnest(pk_cols) c));
    end if;
  end loop;
```

⚠ **Two things to check as you paste it.** The PK block and the `delete` are
copied from your file's own main loop — I wrote the `delete` with `s.%1$I =
d.%1$I` to match your `=` fix. If your main loop's versions differ from what is
above, **use yours, not mine.** They are the same statements, just run earlier.

**If you skip Part 2:** tonight's merge still works unless a mirror parent lost
a row upstream since 09-06 (plausible — `eqemu_npc_types` and `eqemu_items` both
have `restrict` children). If it happens the merge fails atomically with a
*different* error — `update or delete on table … violates foreign key constraint
… on table …` — the archive is untouched, nothing is lost, and you send me that
line. It is a safe thing to gamble on; it is not a safe thing to be surprised by.

## 3. Self-test — and the one failure you should expect

The suite is now **19 assertions** (was 14, was 9). I rebuilt a Tower-shaped file
— the repo's base plus your three fixes — applied all three parts, and ran it.
Measured, not predicted:

```
  ok   … 18 assertions, including:
  ok   FK parent inserted before its child
  ok   FK child deleted before its parent
  ok   second unique index does not abort the run
  ok   archive keeps ITS id, skips the new one
  ok   the genuinely new row still lands
  ok   generated column is recomputed, not copied
  ok   identity column takes the snapshot's id
  FAIL rows_before is counted pre-delete — got '1->1' want '2->1'
```

**That one failure is expected and cosmetic.** Because Part 2 deletes before the
main loop counts, `merge_log.rows_before` for mirror tables now reads the count
*after* the delete. It affects one column of one log table and nothing else; the
repo's own version restructures the loop to avoid it, which is more surgery than
tonight is worth.

**18 ok + exactly that line = good. Any other red = stop.**

Each fix is mutation-checked against the Tower-shaped file: revert the ordering
and it fails on `charm_sessions_encounter_id_fkey`; revert the bare
`on conflict do nothing` and it fails on `who_obs_dedup` — your two live errors,
reproduced on demand. Your own hand fixes are mutation-checked too: drop the
generated-column filter and Postgres says *"column can only be updated to
DEFAULT"*; drop `overriding system value` and it says *"cannot insert a
non-DEFAULT value into column id"*.

⚠⚠ **FETCH THE TEST FIRST. Tower already has an OLD `test-archive-merge.sh`
with 9 assertions and none of them touch FK ordering** — it passes against the
broken file and against the fixed one equally, so a `PASS` from Tower's copy
proves nothing about this patch. (It caught one of us out on the first run: nine
`ok` lines and `PASS`, with the FK assertions simply absent.) **If the run does
not print 14 lines, you ran the wrong script.**

The repo is public, so pull it straight from the branch — no checkout needed:

```bash
curl -fsSL -o /tmp/test-archive-merge.sh \
  https://raw.githubusercontent.com/davehess/QuarmBossTracker/claude/sharp-lamport-dC0TW/scripts/test-archive-merge.sh
md5sum /tmp/test-archive-merge.sh    # 96f6318bde77b1b37c65b981b293f496
grep -c '^check ' /tmp/test-archive-merge.sh   # 14
```

The test needs a real Postgres and only ever touches a database called
`archive_merge_selftest`, which it drops at both ends. Unraid's host has no
`psql`, so run it in the container — note the second `docker cp` takes the
file from `/tmp`, **not** from Tower's `scripts/`:

```bash
cd /mnt/user/backups/wolfpack/repo
docker exec -i supabase-db mkdir -p /tmp/mt/scripts/lib
docker cp scripts/lib/archive-merge.sql   supabase-db:/tmp/mt/scripts/lib/
docker cp /tmp/test-archive-merge.sh      supabase-db:/tmp/mt/scripts/test-archive-merge.sh
docker exec -i supabase-db bash -lc 'cd /tmp/mt && PGUSER=postgres bash scripts/test-archive-merge.sh'
docker exec -i supabase-db rm -rf /tmp/mt
```

(`docker cp` is fine for these — they are ordinary files. The standing rule about
never using `docker cp` is specifically for `latest.dump`, which is a *symlink*.)

## 4. Run it

No fresh dump — today's is current (`wolfpack-2026-09-22.dump`, 268 MB, 05:05),
and a new `pg_dump` is real egress off a paid plan for nothing.

```bash
cd /mnt/user/backups/wolfpack/repo
bash scripts/refresh-local-archive.sh
```

Expect it to be slow: 17 days of backlog across every archive table at once,
~275,000 threat-snapshot rows among them. The local archive's own dump has sat
at exactly 357.28 MB since 09-06; it should jump.

## 5. Verify, then send these back

```bash
docker exec -i supabase-db psql -U postgres -d postgres -c \
  "select count(*), min(snapshot_at), max(snapshot_at) from encounter_threat_snapshots;"

docker exec -i supabase-db psql -U postgres -d postgres -c \
  "select table_name, mode, rows_before, rows_after, rows_kept, ran_at
     from archive_meta.merge_log
    where table_name in ('encounter_threat_snapshots','charm_sessions','target_observations')
    order by ran_at desc, table_name limit 9;"
```

Expect `count` up from 915,340 by roughly 275,000, `max(snapshot_at)` at
**2026-09-22 05:0x UTC** (the dump's timestamp, not "now"), `mode` = `archive`,
and `charm_sessions` finally present as `mirror`.

## 6. The `target_observations` clock — softer than I first said

⚠ **Correction to my own earlier framing.** I said missing tonight's merge would
cost ~50 days of `target_observations`. That was wrong, and the reason matters:
**the merge reads the dump on disk, never production.** Those rows were captured
in `wolfpack-2026-09-22.dump` at 05:05 and are safe there whatever production
does tonight. The sweep removes production's copy; it cannot reach the dump.

The arithmetic, for the record:

- The sweep deletes `at < now() − 1 day` — at the next midnight-ET run, about
  **2026-09-22 04:00 UTC**. It has no archive gate, unlike the threat sweep.
- The dump, and so the archive after any successful merge, holds
  `target_observations` through **2026-09-22 05:05 UTC**.
- 05:05 is later than 04:00, so everything that sweep deletes is already
  captured — tonight, tomorrow, or whenever the merge actually runs.

So run the merge because the backlog only grows and it is ready, not because
something burns at midnight. The real deadline is dump rotation, which is days
out, not hours.

⚠ Still true and unchanged: **`buff_casts` 2026-09-06 → 09-15 is gone for good.**
That one was not captured by any dump the box still holds — production's 7-day
sweep got there first. It is the concrete cost of the 17 nights.

⚠ One correction to the earlier note: the sweep's delete is
`at=lt.<cutoff>` with **no `guild_id`**, so it cannot use
`target_observations_at_idx (guild_id, at DESC)` as a range scan. It will
seq-scan — but 306k rows is small, well inside the client's 10s timeout. Do not
count on it failing. It will very likely run.

The threat-snapshot sweep is separately safe: it is gated on the archive
watermark, which is still 2026-09-06, so it has deleted nothing. Oldest row in
production is still 2026-07-02.
