-- Fight Cards (task #43 — the Quartermaster's original concept, Hitya
-- 2026-08-16: a per-fight readiness card — comp needed, kit present, tactics
-- armed and correct, pipeline alive). docs/DESIGN-fight-cards.md.
--
-- v1 columns: comp/kit are officer TEXT notes, not the structured
-- comp-template / kit-key joins the design ultimately wants — those land with
-- the #93 comp-matcher integration, under NEW columns (comp jsonb, kit_keys
-- text[]) so nothing here has to migrate. trigger_ids resolve live against
-- guild_triggers at render time — the card stores the link, never a copy, so
-- a trigger edit is reflected on the card immediately.
--
-- Writes are service-role only (officer server actions), reads authenticated —
-- same posture as intentional_death_rules.

create table if not exists fight_cards (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null default 'wolfpack',
  boss_npc_id integer not null,
  title text,
  comp_notes text,
  kit_notes text,
  tactics text,
  trigger_ids uuid[] not null default '{}',
  guide_ref text,
  sort_order integer not null default 0,
  active boolean not null default true,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fight_cards_guild_active_idx
  on fight_cards (guild_id, active, sort_order);

alter table fight_cards enable row level security;

do $$ begin
  create policy fight_cards_read on fight_cards
    for select to authenticated using (true);
exception when duplicate_object then null; end $$;
