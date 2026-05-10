-- Run in Supabase SQL editor: store Onairos traits payload with waitlist signup.
alter table public.waitlist
  add column if not exists onairos_traits jsonb;

comment on column public.waitlist.onairos_traits is 'Traits JSON from Onairos after background training + fetch (landing flow).';
