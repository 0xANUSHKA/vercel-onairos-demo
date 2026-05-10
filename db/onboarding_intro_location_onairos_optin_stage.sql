-- Run in Supabase SQL editor.
-- Adds intro location fields and allows the new SMS stage for Onairos opt-in.

alter table public.onboarding_profiles
  add column if not exists city text,
  add column if not exists country text;

alter table public.onboarding_profiles
  drop constraint if exists onboarding_profiles_sms_onboarding_stage_check;

alter table public.onboarding_profiles
  add constraint onboarding_profiles_sms_onboarding_stage_check
  check (
    sms_onboarding_stage is null
    or sms_onboarding_stage in (
      'awaiting_intro',
      'awaiting_gender',
      'awaiting_onairos_opt_in',
      'awaiting_sms_q',
      'sms_onboarding_complete',
      'intro_answered'
    )
  );

comment on column public.onboarding_profiles.city is
  'Parsed from intro response; participant city.';

comment on column public.onboarding_profiles.country is
  'Parsed from intro response; participant country.';
