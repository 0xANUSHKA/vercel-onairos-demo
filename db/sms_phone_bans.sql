-- Run in Supabase SQL editor: block abusive numbers from SMS bot + new waitlist joins.
create table if not exists public.sms_phone_bans (
  phone_e164 text primary key,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sms_phone_bans_created_at on public.sms_phone_bans (created_at desc);

comment on table public.sms_phone_bans is 'Hard block for SMS onboarding and POST /api/waitlist/join for this E.164 (use normalized +1… form).';
