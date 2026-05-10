-- Run in Supabase SQL editor.
-- Legacy ALTER: adds sms_onboarding_stage when onboarding_profiles was created before that column.
-- New projects: column is already in db/onboarding.sql.
--
-- Do NOT run db/onboarding_sms_stage.sql after db/onboarding_sms_v2.sql (v2 widens the stage check).
-- For the full multi-question SMS + transcript schema, use onboarding_sms_v2.sql only (it also ensures this column exists).

alter table public.onboarding_profiles
  add column if not exists sms_onboarding_stage text;
