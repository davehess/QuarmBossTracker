-- Signal tables for the /test-server planning page on wolfpack.quest.
-- Members can mark themselves "interested" in a specific topic (phase, host
-- option, skill they can contribute) and post discussion comments. Officers
-- can delete comments; everyone else manages their own rows.
--
-- Kept minimal: no threading, no upvotes, no edit history. This is a
-- proposal-discussion page, not a forum.

create table if not exists test_server_interests (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null,                -- auth.users.id
  topic       text        not null,                -- one of the topic keys baked into the page
  notes       text,                                -- optional "how I can help" detail
  created_at  timestamptz not null default now(),
  unique (user_id, topic)
);
create index if not exists test_server_interests_topic_idx
  on test_server_interests (topic);

create table if not exists test_server_comments (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null,                -- auth.users.id
  body        text        not null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz                           -- soft-delete for officer moderation
);
create index if not exists test_server_comments_created_idx
  on test_server_comments (created_at desc);

-- Same RLS posture as the rest of the member-facing tables: writes through
-- the web's service-role client (server actions), no anon access at all.
alter table test_server_interests enable row level security;
alter table test_server_comments  enable row level security;
grant all on test_server_interests to service_role;
grant all on test_server_comments  to service_role;
