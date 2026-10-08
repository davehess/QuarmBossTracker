-- 20261008200000_missing_spells_name_key.sql
-- character_missing_spells: owned bard songs (and other possessive-named spells) no longer listed as missing.
--
-- FB-67 (a member, Mimic 2.7.11-beta.2): "Shopping list listed songs that I already have, Kazumi's Preservation
-- and Angstlich's Assonance." The list is the Missing spells page's shopping mode on the website, built by
-- character_missing_spells, which decides "owned" by lower(spell name) equality between the character's
-- spellbook and the SCROLL item's name. Measured on production 2026-10-08, the two sides disagree on bytes:
--   spellbook  Angstlich's Assonance            (apostrophe 0x27)
--   scroll     Song: Angstlich`s Assonance      (backtick 0x60)
--   spellbook  Kazumi's Note of Preservation
--   scroll     Song: Kazumi`s Preservation      (a different NAME, not just a quote)
--   scroll     Song: Angstlichs Appalling Screech  (no quote at all; the spell is Angstlich`s ...)
-- 36 of the scroll names have no spell of the same name, 8 of them songs. Bards only met it now because
-- 20260825060000 first put Song: scrolls into this function.
--
-- Two parts:
--   1. spell_name_key(text): lower-case with everything that is not a letter or digit removed, so apostrophe,
--      backtick, curly quote and a missing quote all compare equal (the agent's _songSlug does the same for log lines).
--   2. spell_scroll_aliases: for the scrolls whose item name is not the spell's name, the spell they teach.
--      Only the unambiguous ones (a quote, a dropped word, a one-letter misspelling in the mirror); the rest stay
--      as they were. A row costs nothing when the scroll name already matches.
--
-- Displayed names, signature and grants are unchanged. Idempotent.

create or replace function public.spell_name_key(t text)
returns text
language sql immutable parallel safe
set search_path to ''
as $$ select lower(regexp_replace(coalesce(t, ''), '[^A-Za-z0-9]', '', 'g')) $$;

comment on function public.spell_name_key(text) is
  'Lower-case letters and digits only. Compares spell and scroll names across apostrophe / backtick / missing-quote spellings.';

grant execute on function public.spell_name_key(text) to service_role;

create table if not exists public.spell_scroll_aliases (
  scroll_key text primary key,   -- spell_name_key of the scroll name without "Spell: "/"Song: "
  spell_key  text not null,      -- spell_name_key of the spell it teaches
  note       text
);
alter table public.spell_scroll_aliases enable row level security;   -- service role only, like the other lookups

insert into public.spell_scroll_aliases (scroll_key, spell_key, note)
select public.spell_name_key(v.scroll), public.spell_name_key(v.spell), v.note
from (values
  ($q$Katta's Sword Dancing$q$,        $q$Katta's Song of Sword Dancing$q$,   'scroll drops "Song of"'),
  ($q$Kazumi`s Preservation$q$,        $q$Kazumi's Note of Preservation$q$,   'scroll drops "Note of" (FB-67)'),
  ($q$Largo's Assonant Binding$q$,     $q$Largo`s Absonant Binding$q$,        'Assonant / Absonant'),
  ($q$Nillipuss' March of the Wee$q$,  $q$Nillipus` March of the Wee$q$,      'Nillipuss / Nillipus'),
  ($q$Saryn's Scream of Pain$q$,       $q$Saryrn's Scream of Pain$q$,         'Saryn / Saryrn'),
  ($q$Selo's Assonant Strain$q$,       $q$Selo`s Assonant Strane$q$,          'Strain / Strane'),
  ($q$Shield of Song$q$,               $q$Shield of Songs$q$,                 'Song / Songs'),
  ($q$Solon`s Bravura$q$,              $q$Solon's Bewitching Bravura$q$,      'scroll drops "Bewitching"'),
  ($q$Covetous Subvention$q$,          $q$Covetous Subversion$q$,             'Subvention / Subversion'),
  ($q$Rapacious Subvention$q$,         $q$Rapacious Subversion$q$,            'Subvention / Subversion'),
  ($q$Elnerick's Rending$q$,           $q$Elnerick's Electrical Rending$q$,   'scroll drops "Electrical"'),
  ($q$Garrison's Superior Sunder$q$,   $q$Garrison's Superior Sundering$q$,   'Sunder / Sundering'),
  ($q$Improved Invis vs Undead$q$,     $q$Improved Invis to Undead$q$,        'vs / to'),
  ($q$Invisibility vs Undead$q$,       $q$Invisibility to Undead$q$,          'vs / to'),
  ($q$Invisibility vs Animals$q$,      $q$Invisibility versus Animals$q$,     'vs / versus'),
  ($q$Mark of Kazad$q$,                $q$Kazad`s Mark$q$,                    'reordered'),
  ($q$Mending of Kragg$q$,             $q$Kragg's Mending$q$,                 'reordered'),
  ($q$Mass Mystical Transvergan$q$,    $q$Mass Mystical Transvergance$q$,     'Transvergan / Transvergance'),
  ($q$Rod of Mystical Transvergan$q$,  $q$Rod of Mystical Transvergance$q$,   'Transvergan / Transvergance'),
  ($q$Share Form of Great Wolf$q$,     $q$Share Form of the Great Wolf$q$,    'scroll drops "the"'),
  ($q$Summon: Muzzle of Mardu$q$,      $q$Muzzle of Mardu$q$,                 'scroll adds "Summon:"'),
  ($q$Wondrous Rapidity$q$,            $q$Wonderous Rapidity$q$,              'Wondrous / Wonderous'),
  ($q$Tears of Aryxil$q$,              $q$Tears of Arlyxir$q$,                'Aryxil / Arlyxir'),
  ($q$O'Kiels Embers$q$,               $q$O'keils Embers$q$,                  'Kiels / keils')
) as v(scroll, spell, note)
on conflict (scroll_key) do nothing;

create or replace function public.character_missing_spells(
  p_guild_id text, p_character text, p_class_bit integer)
returns table(spell_name text, scroll_item_id integer, spell_id integer,
              scribe_level integer, held_by text[], buyable boolean, pop boolean)
language sql stable
set search_path to 'public'
as $function$
  with me as (
    select coalesce(
      (select replace(lower(trim(c.class)), ' ', '')
         from characters c
        where c.guild_id = p_guild_id and lower(c.name) = lower(p_character)
        limit 1),
      (select cb.cls from (values
        (1,'warrior'),(2,'cleric'),(4,'paladin'),(8,'ranger'),(16,'shadowknight'),
        (32,'druid'),(64,'monk'),(128,'bard'),(256,'rogue'),(512,'shaman'),
        (1024,'necromancer'),(2048,'wizard'),(4096,'magician'),(8192,'enchanter'),
        (16384,'beastlord')) cb(bit, cls) where cb.bit = p_class_bit)
    ) as class_key
  ),
  -- Owned = the spellbook name, as a letters-and-digits key (FB-67: apostrophe vs backtick vs none).
  scribed as (
    select public.spell_name_key(spell_name) as nm
    from character_spellbook
    where guild_id = p_guild_id and lower(character_name) = lower(p_character)
  ),
  pool0 as (
    select distinct on (lower(regexp_replace(regexp_replace(i.name, '^(Spell|Song): ', ''), '\*+\s*$', '')))
      regexp_replace(regexp_replace(i.name, '^(Spell|Song): ', ''), '\*+\s*$', '') as spell_name,
      i.id                                                          as scroll_item_id,
      (select s.id from eqemu_spells s
         where lower(s.name) = lower(regexp_replace(regexp_replace(i.name, '^(Spell|Song): ', ''), '\*+\s*$', ''))
         order by s.id limit 1)                                     as spell_id,
      exists(select 1 from eqemu_merchantlist m where m.item = i.id) as buyable
    from eqemu_items i
    where (i.name like 'Spell: %' or i.name like 'Song: %')   -- bards have Songs
      and (i.classes & p_class_bit) > 0
    order by lower(regexp_replace(regexp_replace(i.name, '^(Spell|Song): ', ''), '\*+\s*$', '')),
             (i.name like '%*%'),
             (not exists(select 1 from eqemu_merchantlist m where m.item = i.id)),
             i.id
  ),
  -- match_key: the key the spellbook is compared on. A scroll named differently from its spell goes through
  -- the alias table; spell_id then falls back to a key match (only evaluated for the ~40 rows with no exact name).
  pool as (
    select p0.spell_name, p0.scroll_item_id, p0.buyable,
           coalesce(a.spell_key, public.spell_name_key(p0.spell_name)) as match_key,
           coalesce(p0.spell_id,
                    (select s.id from eqemu_spells s
                      where p0.spell_id is null
                        and public.spell_name_key(s.name) = coalesce(a.spell_key, public.spell_name_key(p0.spell_name))
                      order by s.id limit 1)) as spell_id
    from pool0 p0
    left join spell_scroll_aliases a on a.scroll_key = public.spell_name_key(p0.spell_name)
  ),
  levels as (
    select public.spell_name_key(sb.spell_name) as nm,
           replace(lower(trim(c.class)), ' ', '') as class_key,
           min(sb.spell_level) as lvl
    from character_spellbook sb
    join characters c
      on c.guild_id = sb.guild_id and lower(c.name) = lower(sb.character_name)
    where sb.guild_id = p_guild_id and sb.spell_level is not null
    group by 1, 2
  ),
  holders as (
    select lower(regexp_replace(regexp_replace(ci.item_name, '^(Spell|Song): ', ''), '\*+\s*$', '')) as nm,
           array_agg(distinct ci.character_name order by ci.character_name) as names
    from character_inventory ci
    where ci.guild_id = p_guild_id
      and (ci.item_name like 'Spell: %' or ci.item_name like 'Song: %')
    group by 1
  )
  select p.spell_name, p.scroll_item_id, p.spell_id,
         coalesce(l.lvl, scl.level, sd.level)::integer as scribe_level,
         coalesce(h.names, '{}') as held_by,
         p.buyable,
         (coalesce(sp.pop, false)
           or coalesce(l.lvl, scl.level, sd.level, 0) >= 61) as pop
  from pool p
  cross join me
  left join scribed sc on sc.nm = p.match_key
  left join levels  l  on l.nm  = p.match_key and l.class_key = me.class_key
  left join spell_class_levels scl
                       on scl.spell_id = p.spell_id and scl.class_key = me.class_key
  left join holders h  on h.nm  = lower(p.spell_name)
  left join spell_level_seed sd on sd.spell_id = p.spell_id
  left join eqemu_spell_pop  sp on sp.spell_name_lc = lower(p.spell_name)
  where sc.nm is null
  order by coalesce(l.lvl, scl.level, sd.level) nulls last, p.buyable desc, p.spell_name;
$function$;

grant execute on function public.character_missing_spells(text, text, integer) to service_role;
