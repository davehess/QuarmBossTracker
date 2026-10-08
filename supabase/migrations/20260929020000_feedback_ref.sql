-- Referenceable ids for bug and idea reports: FB-1, FB-2, … (the guild lead, 2026-09-29: "We need to
-- start having referenceable IDs for each bug or enhancement request so the bot can update these when
-- they get implemented"). A commit that names FB-n moves report n on: on beta when it lands on beta,
-- implemented when it lands on main. The uuid stays the key; ref is the short handle people type.
--
-- Existing rows are numbered in the order they were submitted, then the sequence carries on from there.
-- Idempotent: the backfill only touches rows without a ref, and setval never moves the sequence back.

alter table public.feedback add column if not exists ref integer;

create sequence if not exists public.feedback_ref_seq;

update public.feedback f
   set ref = n.rn
  from (select id, row_number() over (order by submitted_at, id) as rn from public.feedback) n
 where f.id = n.id
   and f.ref is null
   and not exists (select 1 from public.feedback x where x.ref is not null);

select setval('public.feedback_ref_seq',
              greatest((select coalesce(max(ref), 0) from public.feedback), 1),
              (select max(ref) is not null from public.feedback));

alter table public.feedback alter column ref set default nextval('public.feedback_ref_seq');
alter sequence public.feedback_ref_seq owned by public.feedback.ref;

create unique index if not exists feedback_ref_key on public.feedback (ref);
