-- Who is running which Zeal, and whose client can actually give us a spawn id.
--
-- Hitya, 2026-09-01: "let me start tracking zeal versions so we can work
-- towards knowing when someone has that Target and spawn ID. fall back is if
-- they tag."
--
-- TWO COLUMNS, BECAUSE THEY ANSWER TWO DIFFERENT QUESTIONS AND ONE CANNOT
-- SUBSTITUTE FOR THE OTHER:
--
--   zeal_version      what the client reports (`/zeal` prints "Zeal version:
--                     1.4.5 (hash)"). Good for chasing adoption -- who is
--                     behind, who needs to update.
--
--   spawn_id_seen_at  the last time this character's client actually SENT a
--                     target spawn id. This is the capability, observed.
--
-- ⚠ THE VERSION CANNOT TELL YOU THE CAPABILITY, and that is why both exist.
-- Zeal PR #229 is not released: the author's own patched build reports
-- "1.4.5", the identical string a STOCK 1.4.5 reports, so a version test would
-- call a capable client incapable. After it merges the mapping will be
-- version >= <whatever ships it>, but we do not know that number yet and
-- guessing it would bake in a wrong answer. Observation is right today and
-- stays right afterwards, so it is the one consumers should branch on.
--
-- ⚠ BOTH ARE STICKY, deliberately. A client that is not targeting anything
-- sends no id, and that is not evidence it cannot -- so spawn_id_seen_at only
-- ever moves FORWARD (greatest()), and zeal_version keeps its last known value
-- when an upload does not carry one (coalesce(), the pattern agent_version
-- already uses on this table). "Capable" is a thing you prove once.
--
-- THE FALLBACK IS UNCHANGED AND STILL MATTERS: a raider whose client sends no
-- id can still be separated by /tag, which broadcasts the same
-- Entity::SpawnId over chat (see docs/zeal-tag-spawn-id-collision.md). These
-- columns say who needs that fallback, not whether it exists.
alter table public.agent_upload_stats
  add column if not exists zeal_version     text,
  add column if not exists spawn_id_seen_at timestamptz;

comment on column public.agent_upload_stats.zeal_version is
  'Zeal version this client reports (from /zeal output). Adoption tracking only - it CANNOT be used to infer spawn-id capability, because a patched build reports the same string as a stock one. Branch on spawn_id_seen_at instead.';
comment on column public.agent_upload_stats.spawn_id_seen_at is
  'Last time this character actually sent a target spawn id (Zeal PR #229). Forward-only: not targeting anything is not evidence of incapability. This is the authoritative "can this client separate same-name mobs passively" signal; without it the /tag channel is the fallback.';

create or replace function public.bump_agent_upload_stat(
  p_guild text, p_character text, p_endpoint text, p_version text,
  p_ok boolean, p_status integer, p_error text, p_agent_state jsonb,
  p_uploaded_by text default null,
  p_zeal_version text default null,
  p_spawn_id_seen boolean default false
) returns void
  language sql security definer set search_path to 'public'
as $function$
  insert into public.agent_upload_stats as s
    (guild_id, character, endpoint, upload_count, error_count,
     first_uploaded_at, last_uploaded_at, agent_version, last_ok, last_status_code,
     last_error, last_agent_state, uploaded_by_discord_id,
     zeal_version, spawn_id_seen_at)
  values
    (coalesce(p_guild,'wolfpack'), coalesce(nullif(p_character,''),'(unknown)'), p_endpoint,
     1, case when p_ok then 0 else 1 end, now(), now(), p_version, p_ok, p_status,
     p_error, p_agent_state, p_uploaded_by,
     p_zeal_version, case when p_spawn_id_seen then now() else null end)
  on conflict (guild_id, character, endpoint) do update set
    upload_count     = s.upload_count + 1,
    error_count      = s.error_count + case when p_ok then 0 else 1 end,
    last_uploaded_at = now(),
    agent_version    = coalesce(p_version, s.agent_version),
    last_ok          = p_ok,
    last_status_code = p_status,
    last_error       = case when p_ok then s.last_error else p_error end,
    last_agent_state = coalesce(p_agent_state, s.last_agent_state),
    uploaded_by_discord_id = coalesce(p_uploaded_by, s.uploaded_by_discord_id),
    -- Sticky: an upload that carries no version must not erase the last one.
    zeal_version     = coalesce(p_zeal_version, s.zeal_version),
    -- Forward-only: greatest() ignores NULLs, so a pass with no id seen leaves
    -- an earlier proof standing rather than retracting it.
    spawn_id_seen_at = greatest(s.spawn_id_seen_at,
                                case when p_spawn_id_seen then now() else null end);
$function$;
