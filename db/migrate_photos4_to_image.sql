-- One-time: after questions_response_type.sql, migrate old PHOTOS_4 to IMAGE and tighten the check (optional).
-- If your constraint only allowed TEXT+PHOTOS_4, run the ALTER that adds the new check including IMAGE..FILE first, then:

update public.questions
  set response_type = 'IMAGE'
  where response_type = 'PHOTOS_4';

-- Optional: then drop PHOTOS_4 from the check in a follow-up migration once no rows use it.
-- alter table public.questions drop constraint questions_response_type_check;
-- alter table public.questions add constraint questions_response_type_check
--   check (response_type in ('TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'FILE'));
