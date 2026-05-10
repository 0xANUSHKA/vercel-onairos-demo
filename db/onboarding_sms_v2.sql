-- Run in Supabase SQL editor.
-- ALTER-only migration. Extends SMS onboarding: multi-question flow, clarify loops, transcript.
-- (Do not add these to db/onboarding.sql; keep base schema stable for existing installs.)
--
-- Stages: awaiting_intro; awaiting_sms_q; sms_onboarding_complete; intro_answered.
-- Safe to re-run: uses IF NOT EXISTS and drops/recreates the stage check.

alter table public.onboarding_profiles
  add column if not exists sms_onboarding_stage text;

alter table public.onboarding_profiles
  add column if not exists sms_active_question_id uuid references public.questions (id) on delete set null;

alter table public.onboarding_profiles
  drop constraint if exists onboarding_profiles_sms_onboarding_stage_check;
alter table public.onboarding_profiles
  add constraint onboarding_profiles_sms_onboarding_stage_check
  check (
    sms_onboarding_stage is null
    or sms_onboarding_stage in (
      'awaiting_intro',
      'awaiting_sms_q',
      'sms_onboarding_complete',
      'intro_answered'
    )
  );

comment on column public.onboarding_profiles.sms_active_question_id is
  'For awaiting_sms_q: which TEXT question we are collecting; null during intro.';

create table if not exists public.onboarding_sms_transcript (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.onboarding_profiles (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  body text not null,
  question_id uuid null references public.questions (id) on delete set null,
  message_kind text not null default 'turn'
    check (message_kind in ('turn', 'outbound', 'clarify', 'question', 'system')),
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_onboarding_sms_transcript_profile
  on public.onboarding_sms_transcript (profile_id, created_at);

alter table public.onboarding_sms_transcript enable row level security;

comment on table public.onboarding_sms_transcript is
  'Semantic SMS turn log for matchmaking; parallel to raw sms_messages.';
