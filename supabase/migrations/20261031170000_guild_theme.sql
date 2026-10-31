-- The guild theme (docs/DESIGN-theming.md section 4; the guild lead, 2026-10-31: "theming is very important to
-- guilds"). One row per guild, edited by officers on /admin/theme, read by the website's root layout (which emits
-- the slots as --wp-* variables on <html>) and by the bot's embedColor() (neutral embeds only).
--
-- slots      jsonb  { "bg": "#0d1117", ... } hex per THEMABLE slot only. The meaning colours (green, red, gold,
--                   orange) are fixed and never stored. A slot that is absent means "today's value".
-- logo_url   text   https URL, or null for the built-in wolf.
-- font       text   a key from the short list in web/lib/guildThemeCore.ts, or null for the default.
-- embed_color text  '#RRGGBB' for neutral Discord embeds, or null for blurple.
-- updated_by text   the Discord id of the officer who saved it.
--
-- Service role only: RLS on, no policies, no grants to anon/authenticated. The site reads it server-side.
-- Idempotent: the seed row is today's values and is never overwritten once an officer has edited it.

create table if not exists public.guild_theme (
    guild_id     text primary key default 'wolfpack',
    slots        jsonb not null default '{}'::jsonb,
    logo_url     text,
    font         text,
    embed_color  text,
    updated_at   timestamptz default now(),
    updated_by   text
);

alter table public.guild_theme enable row level security;
revoke all on public.guild_theme from anon, authenticated;
grant all on public.guild_theme to service_role;

insert into public.guild_theme (guild_id, slots, logo_url, font, embed_color)
values (
    'wolfpack',
    '{"bg":"#0d1117","panel":"#161b22","border":"#30363d","text":"#c9d1d9","dim":"#6e7681","accent":"#1f6feb","blue":"#58a6ff","purple":"#a371f7"}'::jsonb,
    null,
    'default',
    '#5865f2'
)
on conflict (guild_id) do nothing;
