-- Run in Supabase SQL. Question answer shapes for onboarding.

alter table public.questions
  add column if not exists response_type text not null default 'TEXT';

alter table public.questions
  drop constraint if exists questions_response_type_check;

-- Supports TEXT, IMAGE, AUDIO, VIDEO, FILE. Legacy values may be migrated separately.
alter table public.questions
  add constraint questions_response_type_check
  check (response_type in ('TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'FILE', 'PHOTOS_4'));

comment on column public.questions.response_type is
  'TEXT: freeform. IMAGE/AUDIO/VIDEO/FILE: answers stored as JSON { "files": [{ "url" } ] } in onboarding_answers. PHOTOS_4 is legacy; treat as IMAGE in app.';
