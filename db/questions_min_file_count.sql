-- Run in Supabase after questions exist. Enforces minimum separate file URLs for SMS (and can be set in admin).
-- Default null = 1 (legacy behavior: at least one file).

alter table public.questions
  add column if not exists min_file_count smallint;

comment on column public.questions.min_file_count is
  'Minimum separate upload URLs (MMS) required before advancing for IMAGE/AUDIO/VIDEO/FILE. Null or 1 = at least one file.';

alter table public.questions drop constraint if exists questions_min_file_count_check;
alter table public.questions
  add constraint questions_min_file_count_check
  check (min_file_count is null or (min_file_count >= 1 and min_file_count <= 20));
