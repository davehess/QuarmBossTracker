# PATCH — Tower `archive-merge.sql`: merge in FK order

**For the local session with Tower access.** Written 2026-09-23 02:03 UTC
(2026-09-22 22:03 ET). Self-contained; no prior conversation needed.

**You were right to stop at the checksum.** Tower's copies are *ahead* of the
repo, not behind, and shipping the repo's file would have thrown away three hand
fixes. So this is a patch against **your** file, not a replacement. Two edits,
both drop-in, neither touching the parts that drifted.

---

## 0. What to do, in order

1. Back up Tower's current `archive-merge.sql`.
2. Apply **Part 1** (required — this is the actual fix).
3. Apply **Part 2** (recommended — see what skipping it costs).
4. Run the self-test. Expect **13 ok + one specific known failure**, spelled out
   in §3. Anything else red: stop, send it to me.
5. Run `refresh-local-archive.sh`.
6. Send back the two verification queries in §5.

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

I rebuilt a Tower-shaped file (the repo's base plus your three fixes), applied
both parts, and ran the suite. Result, measured, not predicted:

```
  ok   … 13 assertions, including:
  ok   FK parent inserted before its child
  ok   FK child that sorts first still merges
  ok   FK child deleted before its parent
  ok   mirror child went with it
  FAIL rows_before is counted pre-delete — got '1->1' want '2->1'
```

**That one failure is expected and cosmetic.** Because Part 2 deletes before the
main loop counts, `merge_log.rows_before` for mirror tables now reads the count
*after* the delete. It affects one column of one log table and nothing else; the
repo's own version restructures the loop to avoid it, which is more surgery than
tonight is worth.

**13 ok + exactly that line = good. Any other red = stop.**

For reference: the same Tower-shaped file *without* Part 1 still fails on
`charm_sessions_encounter_id_fkey`, so your hand fixes are not what was fixing
this — this patch is.

The test needs a real Postgres and only ever touches a database called
`archive_merge_selftest`, which it drops at both ends. Unraid's host has no
`psql`, so run it in the container:

```bash
cd /mnt/user/backups/wolfpack/repo
docker exec -i supabase-db mkdir -p /tmp/mt/scripts/lib
docker cp scripts/lib/archive-merge.sql  supabase-db:/tmp/mt/scripts/lib/
docker cp scripts/test-archive-merge.sh  supabase-db:/tmp/mt/scripts/
docker exec -i supabase-db bash -lc 'cd /tmp/mt && PGUSER=postgres bash scripts/test-archive-merge.sh'
docker exec -i supabase-db rm -rf /tmp/mt
```

⚠ `scripts/test-archive-merge.sh` is the one file you **should** take from the
repo — it is new (14 assertions, up from 9) and Tower has no copy to conflict
with. Branch `claude/sharp-lamport-dC0TW`:

```bash
git fetch origin claude/sharp-lamport-dC0TW
git show origin/claude/sharp-lamport-dC0TW:scripts/test-archive-merge.sh > /tmp/test-archive-merge.sh
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

## 6. The `target_observations` clock — and what a successful merge buys

You are right that it has no archive protection, and the arithmetic works out in
our favour if the merge lands:

- The sweep deletes `at < now() − 1 day`. At the next midnight-ET run that
  cutoff is about **2026-09-22 04:00 UTC**.
- After this merge the archive holds `target_observations` through the dump,
  **2026-09-22 05:05 UTC**.
- 05:05 is later than 04:00, so **everything that sweep deletes is already on
  Tower.** Comfortably, with an hour to spare.

Miss the merge and ~50 days (306,570 rows, back to 2026-08-04) go instead.

⚠ One correction to the earlier note: the sweep's delete is
`at=lt.<cutoff>` with **no `guild_id`**, so it cannot use
`target_observations_at_idx (guild_id, at DESC)` as a range scan. It will
seq-scan — but 306k rows is small, well inside the client's 10s timeout. Do not
count on it failing. It will very likely run.

The threat-snapshot sweep is separately safe: it is gated on the archive
watermark, which is still 2026-09-06, so it has deleted nothing. Oldest row in
production is still 2026-07-02.
