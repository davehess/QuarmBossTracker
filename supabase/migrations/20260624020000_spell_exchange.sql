-- Spell exchange — guild-internal "missing spells" + "who needs spells we hold."
--
-- Inspired by PQDI's Missing Spells parser, but our angle is the part PQDI
-- can't do: cross a character's scribed set against the spells the GUILD is
-- physically holding as scrolls in someone's bank. (Uilnayar 2026-06-23.)
--
-- Data realities baked into this design:
--   • eqemu_spells has NO per-class scribe levels (no classes_1..16). We
--     derive a spell's level empirically from any guild spellbook that has
--     it (character_spellbook.spell_level) — self-improving as people upload.
--   • Spell scrolls are items named 'Spell: <Name>'; we map scroll → spell by
--     name (1,633/1,707 join cleanly). eqemu_items.classes is the class
--     bitmask (Druid=32, Druid+Ranger=40, …).
--   • Scroll items report clicklevel/required_level = 0 and merchantlist
--     min_expansion = -1, so neither scribe level nor PoP-gating is derivable
--     from the catalog. "Where to find" deep-links to PQDI's item page.

-- character_spellbook — applied earlier via MCP; recreated here idempotently
-- so repo and prod migration history stay in sync (CLAUDE.md migrations rule).
create table if not exists character_spellbook (
  id              bigserial   primary key,
  guild_id        text        not null default 'wolfpack',
  character_name  text        not null,
  spell_id        integer     not null,                  -- → eqemu_spells.id
  spell_name      text        not null,
  spell_level     integer,
  observed_at     timestamptz not null default now()
);
create unique index if not exists character_spellbook_uniq
  on character_spellbook (guild_id, lower(character_name), spell_id);
create index if not exists character_spellbook_char_idx
  on character_spellbook (lower(character_name));
create index if not exists character_spellbook_spell_idx
  on character_spellbook (spell_id);
alter table character_spellbook enable row level security;
grant all on character_spellbook to service_role;
grant usage, select on all sequences in schema public to service_role;

-- eq_class_bit(text) — fold an EQ class name OR /who level title to its item
-- class bitmask. Mirrors web/lib/class-titles.ts + utils/classTitles.js; keep
-- them in sync. Stored characters.class is normally the BASE class (the bot
-- folds it), so the title rows are defensive. Returns 0 for unknown input.
create or replace function eq_class_bit(p_class text)
returns integer language sql immutable as $$
  select case lower(trim(coalesce(p_class, '')))
    when 'warrior' then 1 when 'champion' then 1 when 'myrmidon' then 1 when 'warlord' then 1 when 'overlord' then 1
    when 'cleric' then 2 when 'vicar' then 2 when 'templar' then 2 when 'high priest' then 2 when 'archon' then 2
    when 'paladin' then 4 when 'cavalier' then 4 when 'knight' then 4 when 'crusader' then 4 when 'lord protector' then 4
    when 'ranger' then 8 when 'pathfinder' then 8 when 'outrider' then 8 when 'warder' then 8 when 'forest stalker' then 8
    when 'shadow knight' then 16 when 'shadowknight' then 16 when 'reaver' then 16 when 'revenant' then 16 when 'grave lord' then 16 when 'dread lord' then 16
    when 'druid' then 32 when 'wanderer' then 32 when 'preserver' then 32 when 'hierophant' then 32 when 'storm warden' then 32
    when 'monk' then 64 when 'disciple' then 64 when 'master' then 64 when 'grandmaster' then 64 when 'transcendent' then 64
    when 'bard' then 128 when 'minstrel' then 128 when 'troubadour' then 128 when 'virtuoso' then 128 when 'maestro' then 128
    when 'rogue' then 256 when 'rake' then 256 when 'blackguard' then 256 when 'assassin' then 256 when 'deceiver' then 256
    when 'shaman' then 512 when 'mystic' then 512 when 'luminary' then 512 when 'oracle' then 512 when 'prophet' then 512
    when 'necromancer' then 1024 when 'heretic' then 1024 when 'defiler' then 1024 when 'warlock' then 1024 when 'arch lich' then 1024
    when 'wizard' then 2048 when 'channeler' then 2048 when 'evoker' then 2048 when 'sorcerer' then 2048 when 'arcanist' then 2048
    when 'magician' then 4096 when 'elementalist' then 4096 when 'conjurer' then 4096 when 'arch mage' then 4096 when 'arch convoker' then 4096
    when 'enchanter' then 8192 when 'illusionist' then 8192 when 'beguiler' then 8192 when 'phantasmist' then 8192 when 'coercer' then 8192
    when 'beastlord' then 16384 when 'primalist' then 16384 when 'animist' then 16384 when 'savage lord' then 16384 when 'feral lord' then 16384
    else 0
  end;
$$;

-- character_missing_spells — for one character (by class bit), the
-- vendor-purchasable spells they have NOT scribed, with a derived level and
-- which guildmates currently hold the scroll in inventory.
create or replace function character_missing_spells(
  p_guild_id text, p_character text, p_class_bit integer)
returns table(
  spell_name text, scroll_item_id integer, spell_id integer,
  scribe_level integer, held_by text[])
language sql stable as $$
  with scribed as (
    select lower(spell_name) as nm
    from character_spellbook
    where guild_id = p_guild_id and lower(character_name) = lower(p_character)
  ),
  pool as (   -- one row per purchasable spell usable by this class
    select distinct on (lower(substring(i.name from 8)))
      substring(i.name from 8)                         as spell_name,
      i.id                                             as scroll_item_id,
      (select s.id from eqemu_spells s
        where lower(s.name) = lower(substring(i.name from 8))
        order by s.id limit 1)                         as spell_id
    from eqemu_items i
    where i.name like 'Spell: %'
      and (i.classes & p_class_bit) > 0
      and exists (select 1 from eqemu_merchantlist m where m.item = i.id)
    order by lower(substring(i.name from 8)), i.id
  ),
  levels as (   -- empirical scribe level from guild spellbooks
    select lower(spell_name) as nm, min(spell_level) as lvl
    from character_spellbook
    where guild_id = p_guild_id and spell_level is not null
    group by lower(spell_name)
  ),
  holders as (   -- who has the scroll item sitting in inventory
    select lower(substring(ci.item_name from 8)) as nm,
           array_agg(distinct ci.character_name order by ci.character_name) as names
    from character_inventory ci
    where ci.guild_id = p_guild_id and ci.item_name like 'Spell: %'
    group by lower(substring(ci.item_name from 8))
  )
  select p.spell_name, p.scroll_item_id, p.spell_id,
         l.lvl::integer as scribe_level,
         coalesce(h.names, '{}') as held_by
  from pool p
  left join scribed sc on sc.nm = lower(p.spell_name)
  left join levels  l  on l.nm  = lower(p.spell_name)
  left join holders h  on h.nm  = lower(p.spell_name)
  where sc.nm is null     -- missing only
  order by l.lvl nulls last, p.spell_name;
$$;

-- guild_held_spell_needs — officer reverse view. For each spell the guild
-- physically holds as a scroll in someone's inventory: who holds it, the
-- classes that can use it, and which spellbook-uploaded characters of those
-- classes are still missing it. (Absence is only meaningful for characters
-- who've uploaded a spellbook, so "needers" is restricted to uploaders.)
create or replace function guild_held_spell_needs(p_guild_id text)
returns table(
  spell_name text, scroll_item_id integer, class_bitmask integer,
  holders text[], needers text[])
language sql stable as $$
  with held as (   -- spell names physically present as scrolls
    select distinct lower(substring(ci.item_name from 8)) as nm
    from character_inventory ci
    where ci.guild_id = p_guild_id and ci.item_name like 'Spell: %'
  ),
  scrollmeta as (  -- merge scroll variants → one item id + union class bitmask
    select lower(substring(i.name from 8)) as nm,
           min(i.id)                       as scroll_item_id,
           bit_or(i.classes)               as class_bitmask,
           min(substring(i.name from 8))   as spell_name
    from eqemu_items i
    where i.name like 'Spell: %'
    group by lower(substring(i.name from 8))
  ),
  holders as (
    select lower(substring(ci.item_name from 8)) as nm,
           array_agg(distinct ci.character_name order by ci.character_name) as names
    from character_inventory ci
    where ci.guild_id = p_guild_id and ci.item_name like 'Spell: %'
    group by lower(substring(ci.item_name from 8))
  ),
  uploaders as (   -- characters whose spellbook we have (absence is meaningful)
    select distinct lower(character_name) as nm_l, character_name
    from character_spellbook where guild_id = p_guild_id
  )
  select sm.spell_name, sm.scroll_item_id, sm.class_bitmask,
         coalesce(ho.names, '{}') as holders,
         coalesce((
           select array_agg(c.name order by c.name)
           from characters c
           join uploaders u on u.nm_l = lower(c.name)
           where c.guild_id = p_guild_id
             and (eq_class_bit(c.class) & sm.class_bitmask) > 0
             and not exists (
               select 1 from character_spellbook cb
               where cb.guild_id = p_guild_id
                 and lower(cb.character_name) = lower(c.name)
                 and lower(cb.spell_name) = sm.nm)
         ), '{}') as needers
  from held h
  join scrollmeta sm on sm.nm = h.nm
  left join holders ho on ho.nm = h.nm
  order by sm.spell_name;
$$;

grant execute on function eq_class_bit(text) to service_role;
grant execute on function character_missing_spells(text, text, integer) to service_role;
grant execute on function guild_held_spell_needs(text) to service_role;
