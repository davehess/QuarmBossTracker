-- Feedback screenshots (the guild lead, 2026-09-26: "feedback and suggestion needs to be able to
-- take screenshots..top priority").
--
-- feedback.screenshot_paths: object paths in the bucket below, up to 3 per report.
-- The bucket is PRIVATE and has no policies on storage.objects, so anon and signed-in users can
-- neither list nor read it. Only the service role writes (the bot, and the web server's actions);
-- the officer page hands out short-lived signed URLs, and the bot re-posts the images to the
-- feedback thread as Discord attachments.
alter table public.feedback add column if not exists screenshot_paths text[];

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-screenshots', 'feedback-screenshots', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
