-- insert_buff_casts(p_rows jsonb): insert a batch of buff landings, skipping any row that one of
-- buff_casts' unique indexes already holds (2026-10-15, hotfix during the raid).
--
-- Why. buff_casts dedups through two PARTIAL unique indexes (buff_casts_resolved_uniq when spell_id <> 0,
-- buff_casts_ambiguous_uniq when spell_id = 0). The bot posted with PostgREST's
-- `Prefer: resolution=ignore-duplicates`, which only skips conflicts on the primary key, so ONE duplicate
-- landing failed the WHOLE batch with a 409 and every new landing in that batch was lost. With ~40 Mimics
-- in one zone reporting the same landings, that happened constantly (the Postgres log on 2026-10-14 was
-- mostly "duplicate key value violates unique constraint buff_casts_resolved_uniq").
--
-- ON CONFLICT DO NOTHING with no conflict target skips a violation of ANY unique index, partial ones
-- included, and also a duplicate inside the same batch. Returns how many rows were actually inserted.
-- Called only by the bot (service_role).

create or replace function public.insert_buff_casts(p_rows jsonb)
returns integer
language sql
set search_path = public
as $$
  with ins as (
    insert into public.buff_casts
      (guild_id, target, spell_id, spell_name, landing_text, dur_ticks, dur_formula, cast_at,
       observer, uploaded_by_discord_id, is_charm_spell, target_id)
    select r.guild_id, r.target, coalesce(r.spell_id, 0), r.spell_name, r.landing_text, r.dur_ticks,
           r.dur_formula, r.cast_at, r.observer, r.uploaded_by_discord_id, coalesce(r.is_charm_spell, false),
           r.target_id
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      guild_id text, target text, spell_id integer, spell_name text, landing_text text, dur_ticks integer,
      dur_formula integer, cast_at timestamptz, observer text, uploaded_by_discord_id text,
      is_charm_spell boolean, target_id integer)
    on conflict do nothing
    returning 1
  )
  select count(*)::integer from ins;
$$;

revoke all on function public.insert_buff_casts(jsonb) from public, anon, authenticated;
grant execute on function public.insert_buff_casts(jsonb) to service_role;
