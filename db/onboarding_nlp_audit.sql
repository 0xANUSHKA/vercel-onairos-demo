-- If you already ran `onboarding.sql` before intro NLP audit columns, run this once in Supabase SQL.

alter table public.onboarding_profiles
  add column if not exists intro_nlp_model text;

alter table public.onboarding_profiles
  add column if not exists intro_nlp_version text;
