-- Run in Supabase SQL editor. Links waitlist signups to onboarding (SMS beta) and stores each answer per question.
-- Admin APIs use the service role and bypass RLS. If you add client-side access later, add RLS policies.

create table if not exists public.onboarding_profiles (
  id uuid primary key default gen_random_uuid(),
  -- One profile per waitlist row (they joined via the landing page with this phone).
  -- Type must match public.waitlist.id (yours is bigint, not uuid).
  waitlist_id bigint references public.waitlist (id) on delete set null,
  -- Copied from waitlist.value for SMS / lookups; keep even if waitlist is deleted.
  phone_e164 text not null,
  -- Set from the first exchange (admin or future SMS). Questions list is filtered by this.
  gender text,
  -- Parsed or typed from the intro reply: "name, age, height"
  display_name text,
  age integer,
  height text,
  -- Full first user message for audit / future NLP
  intro_reply_raw text,
  -- Last successful NLP run (bump `intro_nlp_version` in app when the prompt changes)
  intro_nlp_model text,
  intro_nlp_version text,
  sms_onboarding_stage text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onboarding_profiles_gender_check check (gender is null or gender in ('MALE', 'FEMALE')),
  constraint onboarding_profiles_age_check check (age is null or (age between 1 and 120)),
  constraint onboarding_profiles_sms_onboarding_stage_check check (
    sms_onboarding_stage is null
    or sms_onboarding_stage in ('awaiting_intro', 'intro_answered')
  ),
  constraint onboarding_profiles_waitlist_id_key unique (waitlist_id)
);

create index if not exists idx_onboarding_profiles_phone on public.onboarding_profiles (phone_e164);

create table if not exists public.onboarding_answers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.onboarding_profiles (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  response_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onboarding_answers_profile_question_key unique (profile_id, question_id)
);

create index if not exists idx_onboarding_answers_profile on public.onboarding_answers (profile_id);

-- Touch updated_at (dedicated to these tables; avoids clobbering a shared app trigger fn)
create or replace function public._onboarding_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_onboarding_profiles_updated on public.onboarding_profiles;
create trigger trg_onboarding_profiles_updated
  before update on public.onboarding_profiles
  for each row execute function public._onboarding_touch_updated_at();

drop trigger if exists trg_onboarding_answers_updated on public.onboarding_answers;
create trigger trg_onboarding_answers_updated
  before update on public.onboarding_answers
  for each row execute function public._onboarding_touch_updated_at();

alter table public.onboarding_profiles enable row level security;
alter table public.onboarding_answers enable row level security;

-- No policies: only service role / direct SQL from dashboard by default

-- For newer SMS fields (transcript, extra stages, etc.) run add-on SQL in db/ — e.g. onboarding_sms_v2.sql (ALTER-only).
