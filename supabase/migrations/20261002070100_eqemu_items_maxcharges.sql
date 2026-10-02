-- How many charges a clicky holds (-1 = unlimited), mirrored from the eqmac dump by the weekly sync
-- (scripts/sync-from-eqmac.js). The HUD's clicky counters need it to tell "one charge left" from
-- "never runs out" (the guild lead, 2026-10-02: "On the hud, there should be clicky counters for each
-- item you have"). NULL until the next sync fills it.
alter table public.eqemu_items add column if not exists maxcharges int;
