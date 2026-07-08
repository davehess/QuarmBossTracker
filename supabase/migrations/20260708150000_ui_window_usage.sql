-- Time-window picker usage telemetry (Uilnayar 2026-07-08: "track which
-- elements are being frequently expanded for usage and the ones that aren't
-- may be less important to end users, worth turning off").
--
-- One row per (page, window, day), incremented every time a signed-in member
-- CLICKS a window chip (default renders don't count — only explicit picks).
-- Read it ad-hoc / future /admin card:
--   select page, win, sum(count) from ui_window_usage group by 1,2 order by 3 desc;

create table if not exists public.ui_window_usage (
  page  text not null,
  win   text not null,
  day   date not null default current_date,
  count int  not null default 0,
  primary key (page, win, day)
);

alter table public.ui_window_usage enable row level security;
drop policy if exists ui_window_usage_read on public.ui_window_usage;
create policy ui_window_usage_read on public.ui_window_usage
  for select to authenticated using (true);

-- Atomic increment (service role calls this from the web server action).
create or replace function public.bump_ui_window(p_page text, p_win text)
returns void language sql security definer as $$
  insert into public.ui_window_usage (page, win, day, count)
  values (left(p_page, 40), left(p_win, 16), current_date, 1)
  on conflict (page, win, day) do update set count = ui_window_usage.count + 1;
$$;
