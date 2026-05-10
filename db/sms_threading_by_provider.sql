-- Run in Supabase SQL editor.
-- Makes conversations unique per provider + participant for strict threading.

alter table public.sms_conversations
  drop constraint if exists sms_conversations_participant_phone_e164_key;

drop index if exists public.sms_conversations_participant_phone_e164_key;
drop index if exists public.uq_sms_conversations_provider_participant;

create unique index if not exists uq_sms_conversations_provider_participant
  on public.sms_conversations (provider, participant_phone_e164);
