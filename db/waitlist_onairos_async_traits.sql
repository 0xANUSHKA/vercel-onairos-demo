-- Run in Supabase SQL editor: support async Onairos traits processing via cron.
alter table public.waitlist
  add column if not exists onairos_completion jsonb,
  add column if not exists onairos_traits_status text,
  add column if not exists onairos_traits_error text,
  add column if not exists onairos_traits_fetched_at timestamptz;

update public.waitlist
set onairos_traits_status = 'pending'
where onairos_traits_status is null and onairos_completion is not null and onairos_traits is null;

update public.waitlist
set onairos_traits_status = 'complete'
where onairos_traits_status is null and onairos_traits is not null;

alter table public.waitlist
  alter column onairos_traits_status set default 'pending';

comment on column public.waitlist.onairos_completion is 'Raw Onairos onComplete payload needed to fetch traits server-side.';
comment on column public.waitlist.onairos_traits_status is 'Async traits pipeline status: pending, processing, complete, failed.';
comment on column public.waitlist.onairos_traits_error is 'Last error while fetching onairos_traits.';
comment on column public.waitlist.onairos_traits_fetched_at is 'Timestamp when onairos_traits was last fetched successfully.';
