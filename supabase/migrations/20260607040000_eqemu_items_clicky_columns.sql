-- Clicky item cast-time support — needed so the Mimic melody overlay can
-- show the right progress-bar duration when a player triggers an item's
-- effect (e.g. Robe of the Spring → "Skin like Nature", Casting Time: 12.0s).
-- Without these columns we fall back to the underlying spell's cast_time
-- which is wrong for items that override it.
--
-- All four columns are nullable since not every item has a click effect
-- and not every dump version populates every field.

alter table public.eqemu_items
  add column if not exists casttime    int,         -- click effect cast time, in ms
  add column if not exists clickeffect int,         -- spell id of click effect
  add column if not exists clicktype   int,         -- 0=combatable, 1=worn, 4=must equip, 5=must equip combatable
  add column if not exists clicklevel  int;         -- level requirement for click

-- The clicky-by-name lookup the agent needs runs frequently; an index helps
-- when the spell-catalog endpoint extends to cover items with click effects.
create index if not exists eqemu_items_clickeffect_idx
  on public.eqemu_items (clickeffect) where clickeffect is not null;
