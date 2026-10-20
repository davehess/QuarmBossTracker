-- insert_ignore_duplicates — the bot's "insert, skip anything a unique index already holds".
--
-- Why this exists (measured in the Supabase postgres log, 2026-10-20, 24 h):
--   220 x 23505 on "encounter_events_dedup" and 3 x on "faction_hits_dedup_idx", each from
--     INSERT INTO encounter_events (...) ... ON CONFLICT("id") DO NOTHING
--   utils/supabase.js insertIgnoreDuplicates sent `Prefer: resolution=ignore-duplicates` with no
--   on_conflict and assumed PostgREST turns that into a bare ON CONFLICT DO NOTHING. It does not:
--   it targets the PRIMARY KEY. Any other unique index (an expression index, a partial one, a plain
--   one) therefore still raises 23505, and the WHOLE batch is rejected — rows lost, not just logged.
--
-- A function can write the statement PostgREST will not: ON CONFLICT DO NOTHING with NO target, which
-- covers every unique index on the table, partial and expression ones included.
--
-- Contract: p_rows is a JSON array of objects. The column list is the keys of the FIRST element, so
-- the caller groups rows by key set (a row that omits a column keeps that column's DEFAULT; one that
-- sends null overrides it, exactly as a PostgREST insert would). Returns the rows actually inserted
-- (duplicates skipped by an index are absent), '[]' when none. Table and every key are validated
-- against the catalog, so a bad name raises instead of reaching the statement.
--
-- service_role only: the bot is the sole caller. SECURITY INVOKER, so RLS still applies to anyone else.

-- p_return_rows: false (the default, the bot's hot paths) inserts and returns '[]' without sending the rows back,
-- because rows read back out of Supabase are billed egress; true returns the inserted rows (the loot fold's count).
create or replace function public.insert_ignore_duplicates(p_table text, p_rows jsonb, p_return_rows boolean default false)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_rel      regclass;
  v_keys     text[];
  v_bad      text;
  v_cols     text;
  v_result   jsonb;
begin
  if p_table is null or p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'insert_ignore_duplicates: p_table and a JSON array p_rows are required';
  end if;

  v_rel := to_regclass(format('public.%I', p_table));
  if v_rel is null
     or not exists (select 1 from pg_class c where c.oid = v_rel and c.relkind in ('r', 'p')) then
    raise exception 'insert_ignore_duplicates: public.% is not a table', p_table;
  end if;

  if jsonb_array_length(p_rows) = 0 then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(p_rows -> 0) <> 'object' then
    raise exception 'insert_ignore_duplicates: p_rows must be an array of objects';
  end if;

  select array_agg(k order by k) into v_keys from jsonb_object_keys(p_rows -> 0) as k;
  if v_keys is null then
    raise exception 'insert_ignore_duplicates: the first row has no columns';
  end if;

  -- Every key must be a real, insertable (not dropped, not generated) column of the table.
  select k into v_bad
    from unnest(v_keys) as k
   where not exists (
     select 1 from pg_attribute a
      where a.attrelid = v_rel and a.attname = k
        and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
   )
   limit 1;
  if v_bad is not null then
    raise exception 'insert_ignore_duplicates: public.% has no insertable column %', p_table, v_bad;
  end if;

  select string_agg(format('%I', k), ', ' order by k) into v_cols from unnest(v_keys) as k;

  if not coalesce(p_return_rows, false) then
    execute format(
      'insert into public.%1$I (%2$s) '
      'select %2$s from jsonb_populate_recordset(null::public.%1$I, $1) '
      'on conflict do nothing',
      p_table, v_cols)
    using p_rows;
    return '[]'::jsonb;
  end if;

  execute format(
    'with ins as ('
    '  insert into public.%1$I (%2$s) '
    '  select %2$s from jsonb_populate_recordset(null::public.%1$I, $1) '
    '  on conflict do nothing '
    '  returning *'
    ') select coalesce(jsonb_agg(to_jsonb(ins)), ''[]''::jsonb) from ins',
    p_table, v_cols)
  into v_result
  using p_rows;

  return v_result;
end;
$$;

revoke execute on function public.insert_ignore_duplicates(text, jsonb, boolean) from public, anon, authenticated;
grant  execute on function public.insert_ignore_duplicates(text, jsonb, boolean) to service_role;

comment on function public.insert_ignore_duplicates(text, jsonb, boolean) is
  'Bot-side insert that skips rows any unique index already holds (ON CONFLICT DO NOTHING, no target). Returns the inserted rows. PostgREST''s own ignore-duplicates targets the primary key only.';

-- PostgREST caches the schema; without this the function is a 404 until the next reload.
notify pgrst, 'reload schema';
