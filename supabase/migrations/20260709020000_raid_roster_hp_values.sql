-- raid_roster + exact per-member HP values (cur/max)
--
-- hp_pct (added 20260606040000) is all we had cross-client: a percentage from a
-- groupmate's Zeal gauge. When a raider runs /pipeverbose, the Zeal type-5 raid
-- sample carries EXACT hp_current/hp_max for every member their client can see —
-- which we were computing hp_pct from and then throwing away. Persist the raw
-- values too so the Tank/Target overlays can show "4211 / 4348" instead of just
-- "97%" whenever anyone in that person's group has verbose on. Null when only a
-- gauge % is available (no verbose broadcaster in their group).
alter table public.raid_roster add column if not exists hp_current integer;
alter table public.raid_roster add column if not exists hp_max     integer;

comment on column public.raid_roster.hp_current is 'Exact current HP from a Zeal /pipeverbose raid sample uploaded by a Mimic-running groupmate. Null when only a gauge percentage (hp_pct) is available.';
comment on column public.raid_roster.hp_max is 'Exact max HP from a Zeal /pipeverbose raid sample. Pairs with hp_current.';
